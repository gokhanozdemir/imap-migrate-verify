import { ImapFlow } from "imapflow";
import { fingerprintMessage } from "./fingerprint.js";

const AUTH_PATTERN = /auth|authentication|credentials|login failed|invalid password|wrong password/iu;

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
  return new ImapFlow({
    host: server.host,
    port: server.port,
    secure: server.secure,
    auth: { user: email, pass: password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 120_000,
  });
}

export async function scanMailbox({ server, email, password, since, includeMessages = true }) {
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
        });

        if (!includeMessages) continue;
        const uids = await client.search({ since }, { uid: true });
        if (!uids.length) continue;

        for await (const item of client.fetch(
          uids,
          { uid: true, envelope: true, source: true, flags: true, internalDate: true, size: true },
          { uid: true },
        )) {
          if (!item.source) {
            throw new Error(`IMAP server did not return message source for ${folder.path} UID ${item.uid}`);
          }
          const internalDate = item.internalDate instanceof Date
            ? item.internalDate
            : item.internalDate ? new Date(item.internalDate) : null;
          const fingerprint = await fingerprintMessage(item.source, {
            messageId: item.envelope?.messageId,
            sender: item.envelope?.from?.map((address) => address.address).join(", "),
            subject: item.envelope?.subject,
            sentAt: item.envelope?.date?.toISOString?.(),
          });
          messages.push({
            uid: item.uid,
            folder: folder.path,
            folderKey: canonicalFolder(folder),
            internalDate: internalDate && !Number.isNaN(internalDate.valueOf())
              ? internalDate.toISOString()
              : null,
            flags: [...(item.flags ?? [])],
            size: item.size,
            ...fingerprint,
          });
        }
      } finally {
        lock?.release();
      }
    }

    return { counts, messages };
  } finally {
    await client.logout().catch(() => {});
  }
}
