import { ImapFlow } from "imapflow";
import { fingerprintMessage, normalizeMessageId } from "./fingerprint.js";

const AUTH_PATTERN = /auth|authentication|credentials|login failed|invalid password|wrong password/iu;
const METADATA_BATCH_SIZE = 250;
const BODY_BATCH_SIZE = 25;

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

class LegacySessionImapFlow extends ImapFlow {
  async startSession() {
    // BeautifulHosting already supplies CAPABILITY data in its greeting and rejects a
    // separate CAPABILITY command until after authentication. Authenticate
    // from the greeting data, then derive namespace information via LIST.
    await this.authenticate();
    await this.run("NAMESPACE");
    this.usable = true;
  }

  async setAuthenticationState() {
    this.state = this.states.AUTHENTICATED;
    this.authenticated = true;
    this.expectCapabilityUpdate = false;
  }
}

export function isAuthenticationError(error) {
  return error?.authenticationFailed === true
    || error?.responseStatus === "NO" && AUTH_PATTERN.test(error?.responseText ?? "")
    || AUTH_PATTERN.test(error?.message ?? "");
}

export async function withTransientRetry(operation, { retries = 1, onRetry = () => {} } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (isAuthenticationError(error) || attempt === retries) throw error;
      onRetry(error, attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError;
}

function canonicalFolder(entry) {
  if (entry.specialUse) return entry.specialUse.toLowerCase();
  return entry.path.normalize("NFKC").toLowerCase();
}

function createClient(server, email, password) {
  const Client = server.legacyGreetingCapabilities ? LegacySessionImapFlow : ImapFlow;
  return new Client({
    host: server.host,
    port: server.port,
    secure: server.secure,
    auth: {
      user: email,
      pass: password,
      ...(server.loginMethod ? { loginMethod: server.loginMethod } : {}),
    },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 120_000,
  });
}

export async function scanMailbox({
  server,
  email,
  password,
  since,
  includeMessages = true,
  onProgress = () => {},
}) {
  const client = createClient(server, email, password);
  const counts = [];
  const messages = [];

  try {
    await client.connect();
    const folders = await client.list();

    for (const folder of folders) {
      if (folder.flags?.has?.("\\Noselect")) continue;
      let lock;
      try {
        lock = await client.getMailboxLock(folder.path, { readOnly: true });
        counts.push({
          folder: folder.path,
          folderKey: canonicalFolder(folder),
          messages: client.mailbox?.exists ?? 0,
          uidValidity: client.mailbox?.uidValidity == null
            ? null
            : String(client.mailbox.uidValidity),
        });

        if (!includeMessages) continue;
        const uids = await client.search(since ? { since } : { all: true }, { uid: true });
        onProgress({ phase: "folder", folder: folder.path, recent: uids.length });
        if (!uids.length) continue;

        let processedInFolder = 0;
        for (const uidBatch of chunks(uids, METADATA_BATCH_SIZE)) {
          for await (const item of client.fetch(
            uidBatch,
            { uid: true, envelope: true, flags: true, internalDate: true, size: true },
            { uid: true },
          )) {
            const internalDate = item.internalDate instanceof Date
              ? item.internalDate
              : item.internalDate ? new Date(item.internalDate) : null;
            messages.push({
              uid: item.uid,
              folder: folder.path,
              folderKey: canonicalFolder(folder),
              internalDate: internalDate && !Number.isNaN(internalDate.valueOf())
                ? internalDate.toISOString()
                : null,
              flags: [...(item.flags ?? [])],
              size: item.size,
              messageId: normalizeMessageId(item.envelope?.messageId),
              semanticHash: null,
              sender: item.envelope?.from?.map((address) => address.address).join(", ") ?? "",
              subject: item.envelope?.subject ?? "",
              sentAt: item.envelope?.date?.toISOString?.() ?? null,
            });
          }
          processedInFolder += uidBatch.length;
          onProgress({
            phase: "metadata",
            folder: folder.path,
            processed: Math.min(processedInFolder, uids.length),
            total: uids.length,
          });
        }
      } finally {
        lock?.release();
      }
    }

    if (includeMessages && messages.length) {
      const idCounts = new Map();
      for (const message of messages) {
        if (message.messageId) {
          idCounts.set(message.messageId, (idCounts.get(message.messageId) ?? 0) + 1);
        }
      }
      const hydrationFolders = new Map();
      for (const message of messages) {
        if (message.messageId && idCounts.get(message.messageId) === 1) continue;
        const values = hydrationFolders.get(message.folder) ?? [];
        values.push(message);
        hydrationFolders.set(message.folder, values);
      }

      for (const [folder, folderMessages] of hydrationFolders) {
        onProgress({ phase: "hydrate", folder, messages: folderMessages.length });
        let lock;
        try {
          lock = await client.getMailboxLock(folder, { readOnly: true });
          const byUid = new Map(folderMessages.map((message) => [message.uid, message]));
          for (const uidBatch of chunks(
            folderMessages.map((message) => message.uid),
            BODY_BATCH_SIZE,
          )) {
            for await (const item of client.fetch(
              uidBatch,
              { uid: true, envelope: true, source: true },
              { uid: true },
            )) {
              if (!item.source) {
                throw new Error(`IMAP server did not return message source for ${folder} UID ${item.uid}`);
              }
              Object.assign(byUid.get(item.uid), await fingerprintMessage(item.source, {
                messageId: item.envelope?.messageId,
                sender: item.envelope?.from?.map((address) => address.address).join(", "),
                subject: item.envelope?.subject,
                sentAt: item.envelope?.date?.toISOString?.(),
              }));
            }
          }
        } finally {
          lock?.release();
        }
      }
    }

    return { counts, messages };
  } catch (error) {
    error.serverName = server.name;
    throw error;
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function getMailboxCount({ server, email, password, folder = "INBOX" }) {
  const client = createClient(server, email, password);
  try {
    await client.connect();
    const status = await client.status(folder, { messages: true });
    return status?.messages ?? 0;
  } catch (error) {
    error.serverName = server.name;
    throw error;
  } finally {
    await client.logout().catch(() => {});
  }
}
