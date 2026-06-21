import { DEFAULTS, DESTINATION_SERVER, SOURCE_SERVER } from "./config.js";
import { createCheckpointStore } from "./checkpoint.js";
import { getMailboxCount, scanMailbox, withTransientRetry } from "./imap.js";
import { runImapsync } from "./imapsync.js";
import { finalizeMatches, matchInventories } from "./matcher.js";
import { join } from "node:path";

const SYNC_BATCH_SIZE = 200;

function chunks(values, size = SYNC_BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function cutoffDate(days) {
  if (days === null || days === undefined) return null;
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

function inboxCount(counts = []) {
  return counts.find((item) => item.folderKey === "\\inbox")?.messages
    ?? counts.find((item) => item.folder.toLowerCase() === "inbox")?.messages
    ?? 0;
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
  const output = String(error?.output ?? "").slice(-2_000);
  let message = `${server}${kind}${response ? `: ${response}` : ""}${status ? ` (${status})` : ""}`
    + `${output ? `: ${output}` : ""}`;
  for (const secret of [account.yandexPassword, account.guzelPassword]) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message.replace(/[\r\n\t]+/gu, " ").trim();
}

function migrationIdentity(account, options) {
  return {
    email: account.email,
    source: { host: SOURCE_SERVER.host, port: SOURCE_SERVER.port, secure: SOURCE_SERVER.secure },
    destination: {
      host: DESTINATION_SERVER.host,
      port: DESTINATION_SERVER.port,
      secure: DESTINATION_SERVER.secure,
    },
    days: options.days ?? null,
    destinationLookbackBufferDays: DEFAULTS.destinationLookbackBufferDays,
  };
}

function batchesForMatches(matches) {
  const batches = [];
  for (const [folder, uids] of missingByFolder(matches)) {
    for (const uidBatch of chunks(uids)) batches.push({ folder, uids: uidBatch });
  }
  return batches;
}

function uidValidityMatches(savedCounts = [], currentCounts = []) {
  const current = new Map(currentCounts.map((item) => [item.folderKey, item.uidValidity]));
  return savedCounts.every((item) => item.uidValidity == null
    || current.has(item.folderKey) && current.get(item.folderKey) === item.uidValidity);
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
  const readInboxCount = dependencies.getMailboxCount ?? getMailboxCount;
  const log = options.log ?? (() => {});
  const freshSourceSince = cutoffDate(options.days);
  const freshDestinationSince = options.days === null || options.days === undefined
    ? null
    : cutoffDate(options.days + DEFAULTS.destinationLookbackBufferDays);
  let sourceSince = freshSourceSince;
  let destinationSince = freshDestinationSince;
  const started = Date.now();
  const identity = migrationIdentity(account, options);
  const checkpointStore = options.dryRun
    ? null
    : dependencies.checkpointStore
      ?? (options.reportDir ? createCheckpointStore(join(options.reportDir, "state"), identity) : null);

  const result = {
    email: account.email,
    success: false,
    status: "FAILED",
    durationMs: 0,
    counts: [],
    inboxCounts: { before: null, iterations: [], after: null },
    messages: [],
  };

  const retryOptions = {
    onRetry: () => log(account.email, "Transient IMAP failure; retrying once"),
  };

  try {
    if (options.restart) await checkpointStore?.remove();
    let checkpoint = await checkpointStore?.load() ?? null;
    if (checkpoint) {
      sourceSince = checkpoint.auditWindow.sourceSince
        ? new Date(checkpoint.auditWindow.sourceSince)
        : null;
      destinationSince = checkpoint.auditWindow.destinationSince
        ? new Date(checkpoint.auditWindow.destinationSince)
        : null;
    }
    log(account.email, checkpoint ? "Validating saved migration checkpoint" : "Reading Yandex and Guzel inventories");
    const progress = (provider) => (event) => {
      if (event.phase === "metadata") {
        log(account.email, `${provider}: ${event.folder} metadata ${event.processed}/${event.total}`);
      }
      if (event.phase === "hydrate") {
        log(account.email, `${provider}: fingerprinting ${event.messages} ambiguous message(s) in ${event.folder}`);
      }
    };
    if (checkpoint) {
      const sourceState = await withTransientRetry(() => scan({
        server: SOURCE_SERVER,
        email: account.email,
        password: account.yandexPassword,
        since: sourceSince,
        includeMessages: false,
      }), retryOptions);
      if (!uidValidityMatches(checkpoint.sourceInventory?.counts, sourceState.counts)) {
        log(account.email, "Source UIDVALIDITY changed; discarding saved checkpoint");
        await checkpointStore.remove();
        checkpoint = null;
        sourceSince = freshSourceSince;
        destinationSince = freshDestinationSince;
      }
    }

    let sourceInventory;
    let destinationBefore;
    let workDestination;
    if (checkpoint) {
      sourceInventory = checkpoint.sourceInventory;
      destinationBefore = checkpoint.destinationBefore;
      workDestination = await withTransientRetry(() => scan({
        server: DESTINATION_SERVER,
        email: account.email,
        password: account.guzelPassword,
        since: destinationSince,
        onProgress: progress("Guzel"),
      }), retryOptions);
      log(account.email, "Resuming saved migration after reconciling the destination");
    } else {
      [sourceInventory, destinationBefore] = await Promise.all([
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
      workDestination = destinationBefore;
    }

    const beforeMatches = matchInventories(sourceInventory.messages, destinationBefore.messages);
    const sourceInbox = inboxCount(sourceInventory.counts);
    const destinationInboxBefore = inboxCount(destinationBefore.counts);
    result.inboxCounts = checkpoint?.inboxCounts ?? result.inboxCounts;
    result.inboxCounts.before ??= { yandex: sourceInbox, guzel: destinationInboxBefore };
    log(account.email, `Inbox totals before: Yandex=${sourceInbox}, Guzel=${destinationInboxBefore}`);
    const missingBefore = beforeMatches.filter((item) => item.status === "missing").length;
    const elsewhereBefore = beforeMatches.filter((item) => item.status === "present-in-other-folder").length;
    log(
      account.email,
      `${sourceInventory.messages.length} recent Yandex message(s): ${missingBefore} missing, ${elsewhereBefore} in other folders`,
    );

    let pendingBatches;
    let totalSyncBatches;
    let completedSyncBatches;
    if (checkpoint) {
      const stillMissing = new Set(matchInventories(
        sourceInventory.messages,
        workDestination.messages,
      ).filter((item) => item.status === "missing")
        .map((item) => `${item.source.folder}\0${item.source.uid}`));
      const reconciledBatches = checkpoint.pendingBatches.map((batch) => ({
        folder: batch.folder,
        uids: batch.uids.filter((uid) => stillMissing.has(`${batch.folder}\0${uid}`)),
      }));
      pendingBatches = reconciledBatches.filter((batch) => batch.uids.length);
      totalSyncBatches = checkpoint.totalSyncBatches;
      completedSyncBatches = checkpoint.completedSyncBatches
        + reconciledBatches.filter((batch) => !batch.uids.length).length;
    } else {
      pendingBatches = batchesForMatches(beforeMatches);
      totalSyncBatches = pendingBatches.length;
      completedSyncBatches = 0;
    }

    const saveCheckpoint = async () => checkpointStore?.save({
      auditWindow: {
        sourceSince: sourceSince?.toISOString() ?? null,
        destinationSince: destinationSince?.toISOString() ?? null,
      },
      sourceInventory,
      destinationBefore,
      pendingBatches,
      totalSyncBatches,
      completedSyncBatches,
      inboxCounts: result.inboxCounts,
    });
    await saveCheckpoint();

    while (pendingBatches.length) {
      const { folder, uids: uidBatch } = pendingBatches[0];
      log(
        account.email,
        `${options.dryRun ? "Previewing" : "Copying"} ${uidBatch.length} missing message(s) `
        + `from ${folder} (overall batch ${completedSyncBatches + 1}/${totalSyncBatches})`,
      );
      await sync({
        account,
        sourceServer: SOURCE_SERVER,
        destinationServer: DESTINATION_SERVER,
        dryRun: options.dryRun,
        folder,
        uids: uidBatch,
        signal: options.signal,
        onRetry: () => log(account.email, "Transient imapsync failure; retrying once"),
      });
      pendingBatches.shift();
      completedSyncBatches += 1;
      await saveCheckpoint();
      const guzelInbox = await withTransientRetry(() => readInboxCount({
        server: DESTINATION_SERVER,
        email: account.email,
        password: account.guzelPassword,
      }), retryOptions);
      result.inboxCounts.iterations.push({
        iteration: completedSyncBatches,
        totalIterations: totalSyncBatches,
        folder,
        yandex: sourceInbox,
        guzel: guzelInbox,
      });
      await saveCheckpoint();
      log(
        account.email,
        `Inbox totals after batch ${completedSyncBatches}/${totalSyncBatches}: `
        + `Yandex=${sourceInbox}, Guzel=${guzelInbox}`,
      );
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
        for (const uidBatch of chunks(uids)) {
          log(account.email, `Retrying ${uidBatch.length} unresolved message(s) from ${folder}`);
          pendingBatches.push({ folder, uids: uidBatch });
          totalSyncBatches += 1;
          await saveCheckpoint();
          await sync({
            account,
            sourceServer: SOURCE_SERVER,
            destinationServer: DESTINATION_SERVER,
            dryRun: false,
            folder,
            uids: uidBatch,
            signal: options.signal,
            onRetry: () => log(account.email, "Transient targeted sync failure; retrying once"),
          });
          pendingBatches.shift();
          completedSyncBatches += 1;
          await saveCheckpoint();
        }
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
    const destinationInboxAfter = inboxCount(destinationAfter.counts);
    result.inboxCounts.after = { yandex: sourceInbox, guzel: destinationInboxAfter };
    log(account.email, `Inbox totals after: Yandex=${sourceInbox}, Guzel=${destinationInboxAfter}`);
    const unresolved = finalMatches.filter((item) => item.status === "unresolved").length;
    result.success = unresolved === 0;
    if (options.dryRun && missingBefore) {
      result.success = false;
      result.error = `Dry run found ${missingBefore} message(s) requiring migration`;
    }
    result.status = result.success ? "PASS" : "FAILED";
    if (result.success) await checkpointStore?.remove();
    else if (!options.dryRun) {
      pendingBatches = batchesForMatches(afterMatches);
      await saveCheckpoint();
    }
    log(account.email, result.success ? "Verification passed" : `${unresolved} message(s) unresolved`);
  } catch (error) {
    result.errorCode = error?.code;
    result.status = error?.code === "quota_exceeded" ? "PAUSED_QUOTA" : "FAILED";
    result.error = redactError(error, account);
    log(account.email, result.status === "PAUSED_QUOTA"
      ? `Paused: ${result.error}`
      : `Failed: ${result.error}`);
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
