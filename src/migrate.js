import { DEFAULTS, DESTINATION_SERVER, SOURCE_SERVER } from "./config.js";
import { scanMailbox, withTransientRetry } from "./imap.js";
import { runImapsync } from "./imapsync.js";
import { finalizeMatches, matchInventories } from "./matcher.js";

function cutoffDate(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
}

function mergeCounts(source = [], before = [], after = []) {
  const rows = new Map();
  const add = (items, field) => {
    for (const item of items) {
      const row = rows.get(item.folderKey) ?? { folder: item.folder };
      row[field] = item.messages;
      if (field === "source") row.folder = item.folder;
      rows.set(item.folderKey, row);
    }
  };
  add(source, "source");
  add(before, "destinationBefore");
  add(after, "destinationAfter");
  return [...rows.values()].sort((a, b) => a.folder.localeCompare(b.folder));
}

function reportMessages(matches) {
  return matches.map(({ source, destination, status }) => ({
    status,
    sender: source.sender,
    subject: source.subject,
    date: source.sentAt ?? source.internalDate,
    sourceFolder: source.folder,
    destinationFolder: destination?.folder ?? null,
    messageId: source.messageId,
    semanticHash: source.semanticHash,
  }));
}

function redactError(error, account) {
  const server = error?.serverName ? `${error.serverName} ` : "";
  const kind = error?.authenticationFailed ? "authentication failed" : (error?.message ?? String(error));
  const response = error?.responseText || (typeof error?.response === "string" ? error.response : "");
  const status = error?.responseStatus ? `IMAP ${error.responseStatus}` : "";
  let message = `${server}${kind}${response ? `: ${response}` : ""}${status ? ` (${status})` : ""}`;
  for (const secret of [account.yandexPassword, account.guzelPassword]) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message.replace(/[\r\n\t]+/gu, " ").trim();
}

function missingByFolder(matches) {
  const folders = new Map();
  for (const result of matches) {
    if (result.status !== "missing") continue;
    const values = folders.get(result.source.folder) ?? [];
    values.push(result.source.uid);
    folders.set(result.source.folder, values);
  }
  return folders;
}

export async function processAccount(account, options, dependencies = {}) {
  const scan = dependencies.scanMailbox ?? scanMailbox;
  const sync = dependencies.runImapsync ?? runImapsync;
  const log = options.log ?? (() => {});
  const sourceSince = cutoffDate(options.days);
  const destinationSince = cutoffDate(options.days + DEFAULTS.destinationLookbackBufferDays);
  const started = Date.now();

  const result = {
    email: account.email,
    success: false,
    durationMs: 0,
    counts: [],
    messages: [],
  };

  const retryOptions = {
    onRetry: () => log(account.email, "Transient IMAP failure; retrying once"),
  };

  try {
    log(account.email, "Reading Yandex and Guzel inventories");
    const progress = (provider) => (event) => {
      if (event.phase === "hydrate") {
        log(account.email, `${provider}: fingerprinting ${event.messages} ambiguous message(s) in ${event.folder}`);
      }
    };
    const [sourceInventory, destinationBefore] = await Promise.all([
      withTransientRetry(() => scan({
        server: SOURCE_SERVER,
        email: account.email,
        password: account.yandexPassword,
        since: sourceSince,
        onProgress: progress("Yandex"),
      }), retryOptions),
      withTransientRetry(() => scan({
        server: DESTINATION_SERVER,
        email: account.email,
        password: account.guzelPassword,
        since: destinationSince,
        onProgress: progress("Guzel"),
      }), retryOptions),
    ]);

    const beforeMatches = matchInventories(sourceInventory.messages, destinationBefore.messages);
    const missingBefore = beforeMatches.filter((item) => item.status === "missing").length;
    const elsewhereBefore = beforeMatches.filter((item) => item.status === "present-in-other-folder").length;
    log(
      account.email,
      `${sourceInventory.messages.length} recent Yandex message(s): ${missingBefore} missing, ${elsewhereBefore} in other folders`,
    );

    const missingFolders = missingByFolder(beforeMatches);
    for (const [folder, uids] of missingFolders) {
      log(
        account.email,
        `${options.dryRun ? "Previewing" : "Copying"} ${uids.length} missing message(s) from ${folder}`,
      );
      await sync({
        account,
        sourceServer: SOURCE_SERVER,
        destinationServer: DESTINATION_SERVER,
        dryRun: options.dryRun,
        folder,
        uids,
        signal: options.signal,
        onRetry: () => log(account.email, "Transient imapsync failure; retrying once"),
      });
    }

    let destinationAfter = await withTransientRetry(() => scan({
      server: DESTINATION_SERVER,
      email: account.email,
      password: account.guzelPassword,
      since: destinationSince,
      onProgress: progress("Guzel"),
    }), retryOptions);
    let afterMatches = matchInventories(sourceInventory.messages, destinationAfter.messages);

    if (!options.dryRun) {
      const retryFolders = missingByFolder(afterMatches);
      for (const [folder, uids] of retryFolders) {
        log(account.email, `Retrying ${uids.length} unresolved message(s) from ${folder}`);
        await sync({
          account,
          sourceServer: SOURCE_SERVER,
          destinationServer: DESTINATION_SERVER,
          dryRun: false,
          folder,
          uids,
          signal: options.signal,
          onRetry: () => log(account.email, "Transient targeted sync failure; retrying once"),
        });
      }
      if (retryFolders.size) {
        destinationAfter = await withTransientRetry(() => scan({
          server: DESTINATION_SERVER,
          email: account.email,
          password: account.guzelPassword,
          since: destinationSince,
          onProgress: progress("Guzel"),
        }), retryOptions);
        afterMatches = matchInventories(sourceInventory.messages, destinationAfter.messages);
      }
    }

    const finalMatches = finalizeMatches(beforeMatches, afterMatches);
    result.messages = reportMessages(finalMatches);
    result.counts = mergeCounts(
      sourceInventory.counts,
      destinationBefore.counts,
      destinationAfter.counts,
    );
    const unresolved = finalMatches.filter((item) => item.status === "unresolved").length;
    result.success = unresolved === 0;
    if (options.dryRun && missingBefore) {
      result.success = false;
      result.error = `Dry run found ${missingBefore} message(s) requiring migration`;
    }
    log(account.email, result.success ? "Verification passed" : `${unresolved} message(s) unresolved`);
  } catch (error) {
    result.error = redactError(error, account);
    log(account.email, `Failed: ${result.error}`);
  } finally {
    result.durationMs = Date.now() - started;
  }

  return result;
}

export async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}
