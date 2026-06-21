import assert from "node:assert/strict";
import test from "node:test";
import { mapConcurrent, processAccount } from "../src/migrate.js";

test("mapConcurrent preserves order and respects its limit", async () => {
  let active = 0;
  let maximum = 0;
  const result = await mapConcurrent([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.equal(maximum, 2);
});

test("processAccount repairs a missing message despite a higher destination count", async () => {
  const sourceMessage = {
    uid: 42,
    folder: "INBOX",
    folderKey: "\\inbox",
    messageId: "missing@example.com",
    semanticHash: "semantic",
    sender: "sender@example.com",
    subject: "Missing message",
    sentAt: "2025-06-19T07:00:00.000Z",
  };
  let destinationScans = 0;
  let syncCalls = 0;
  const scanMailbox = async ({ server }) => {
    if (server.name === "Yandex") {
      return {
        counts: [{ folder: "INBOX", folderKey: "\\inbox", messages: 100 }],
        messages: [sourceMessage],
      };
    }
    destinationScans += 1;
    return {
      counts: [{ folder: "INBOX", folderKey: "\\inbox", messages: destinationScans === 1 ? 102 : 103 }],
      messages: destinationScans === 1
        ? [
            { ...sourceMessage, messageId: "destination-new-1" },
            { ...sourceMessage, messageId: "destination-new-2" },
          ]
        : [sourceMessage],
    };
  };
  const result = await processAccount(
    { email: "person@example.com", yandexPassword: "source", guzelPassword: "destination" },
    { days: 7, dryRun: false },
    {
      scanMailbox,
      runImapsync: async () => { syncCalls += 1; },
      getMailboxCount: async () => 103,
    },
  );
  assert.equal(result.success, true);
  assert.equal(result.messages[0].status, "copied-and-verified");
  assert.equal(syncCalls, 1);
  assert.deepEqual(result.counts[0], {
    folder: "INBOX",
    source: 100,
    destinationBefore: 102,
    destinationAfter: 103,
  });
});

test("processAccount retries a targeted UID when the first copy remains unresolved", async () => {
  const sourceMessage = {
    uid: 77,
    folder: "Archive",
    folderKey: "archive",
    messageId: "retry@example.com",
    semanticHash: "retry-semantic",
    sender: "sender@example.com",
    subject: "Retry me",
    sentAt: "2025-06-19T07:00:00.000Z",
  };
  let destinationScans = 0;
  const syncOptions = [];
  const scanMailbox = async ({ server }) => {
    if (server.name === "Yandex") return { counts: [], messages: [sourceMessage] };
    destinationScans += 1;
    return {
      counts: [],
      messages: destinationScans >= 3 ? [sourceMessage] : [],
    };
  };
  const result = await processAccount(
    { email: "person@example.com", yandexPassword: "source", guzelPassword: "destination" },
    { days: 7, dryRun: false },
    {
      scanMailbox,
      runImapsync: async (options) => { syncOptions.push(options); },
      getMailboxCount: async () => 1,
    },
  );
  assert.equal(result.success, true);
  assert.equal(result.messages[0].status, "copied-and-verified");
  assert.equal(syncOptions.length, 2);
  assert.equal(syncOptions[0].folder, "Archive");
  assert.deepEqual(syncOptions[0].uids, [77]);
  assert.equal(syncOptions[1].folder, "Archive");
  assert.deepEqual(syncOptions[1].uids, [77]);
});

test("processAccount does not copy a message already present in another folder", async () => {
  const sourceMessage = {
    uid: 8,
    folder: "INBOX",
    folderKey: "\\inbox",
    messageId: "elsewhere@example.com",
    semanticHash: "elsewhere",
    sender: "sender@example.com",
    subject: "Already archived",
    sentAt: "2025-06-19T07:00:00.000Z",
  };
  const destinationMessage = {
    ...sourceMessage,
    uid: 88,
    folder: "Archive",
    folderKey: "\\archive",
  };
  let syncCalls = 0;
  const result = await processAccount(
    { email: "person@example.com", yandexPassword: "source", guzelPassword: "destination" },
    { days: 7, dryRun: false },
    {
      scanMailbox: async ({ server }) => server.name === "Yandex"
        ? { counts: [], messages: [sourceMessage] }
        : { counts: [], messages: [destinationMessage] },
      runImapsync: async () => { syncCalls += 1; },
    },
  );
  assert.equal(result.success, true);
  assert.equal(result.messages[0].status, "present-in-other-folder");
  assert.equal(syncCalls, 0);
});

test("processAccount splits thousands of missing UIDs into bounded sync batches", async () => {
  const sourceMessages = Array.from({ length: 401 }, (_, index) => ({
    uid: index + 1,
    folder: "INBOX",
    folderKey: "\\inbox",
    messageId: `message-${index}@example.com`,
    semanticHash: null,
    sender: "sender@example.com",
    subject: `Message ${index}`,
    sentAt: "2025-06-19T07:00:00.000Z",
  }));
  let destinationScans = 0;
  const syncBatches = [];
  const result = await processAccount(
    { email: "person@example.com", yandexPassword: "source", guzelPassword: "destination" },
    { days: null, dryRun: false },
    {
      scanMailbox: async ({ server }) => {
        if (server.name === "Yandex") return { counts: [], messages: sourceMessages };
        destinationScans += 1;
        return { counts: [], messages: destinationScans === 1 ? [] : sourceMessages };
      },
      runImapsync: async ({ uids }) => { syncBatches.push(uids); },
      getMailboxCount: async () => 401,
    },
  );
  assert.equal(result.success, true);
  assert.deepEqual(syncBatches.map((batch) => batch.length), [200, 200, 1]);
  assert.deepEqual(
    result.inboxCounts.iterations.map((iteration) => iteration.guzel),
    [401, 401, 401],
  );
});

test("pauses on quota and resumes only messages still missing from a partial batch", async () => {
  const sourceMessages = Array.from({ length: 401 }, (_, index) => ({
    uid: index + 1,
    folder: "INBOX",
    folderKey: "\\inbox",
    messageId: `resume-${index}@example.com`,
    semanticHash: null,
    sender: "sender@example.com",
    subject: `Message ${index}`,
    sentAt: "2025-06-19T07:00:00.000Z",
  }));
  const counts = [{
    folder: "INBOX",
    folderKey: "\\inbox",
    messages: 401,
    uidValidity: "7",
  }];
  let saved = null;
  const checkpointStore = {
    load: async () => saved,
    save: async (value) => { saved = structuredClone(value); },
    remove: async () => { saved = null; },
  };
  let firstDestinationScan = true;
  let firstSyncCalls = 0;
  const first = await processAccount(
    { email: "person@example.com", yandexPassword: "source-secret", guzelPassword: "destination-secret" },
    { days: null, dryRun: false },
    {
      checkpointStore,
      scanMailbox: async ({ server }) => {
        if (server.name === "Yandex") return { counts, messages: sourceMessages };
        if (firstDestinationScan) {
          firstDestinationScan = false;
          return { counts: [], messages: [] };
        }
        throw new Error("final scan should not run after quota failure");
      },
      runImapsync: async () => {
        firstSyncCalls += 1;
        if (firstSyncCalls === 2) {
          throw Object.assign(new Error("destination mailbox is full"), {
            code: "quota_exceeded",
            output: "[OVERQUOTA] destination-secret mailbox is full",
          });
        }
      },
      getMailboxCount: async () => 200,
    },
  );

  assert.equal(first.status, "PAUSED_QUOTA");
  assert.match(first.error, /\[REDACTED\]/u);
  assert.deepEqual(saved.pendingBatches.map((batch) => batch.uids.length), [200, 1]);
  assert.doesNotMatch(JSON.stringify(saved), /source-secret|destination-secret/u);

  let destinationScans = 0;
  const resumedBatches = [];
  const resumed = await processAccount(
    { email: "person@example.com", yandexPassword: "source-secret", guzelPassword: "destination-secret" },
    { days: null, dryRun: false },
    {
      checkpointStore,
      scanMailbox: async ({ server, includeMessages }) => {
        if (server.name === "Yandex") {
          assert.equal(includeMessages, false);
          return { counts, messages: [] };
        }
        destinationScans += 1;
        return {
          counts,
          messages: destinationScans === 1 ? sourceMessages.slice(0, 250) : sourceMessages,
        };
      },
      runImapsync: async ({ uids }) => { resumedBatches.push(uids); },
      getMailboxCount: async () => 401,
    },
  );

  assert.equal(resumed.success, true);
  assert.deepEqual(resumedBatches.map((uids) => uids.length), [150, 1]);
  assert.equal(resumedBatches[0][0], 251);
  assert.equal(saved, null);
});

test("discards a checkpoint when source UIDVALIDITY changes", async () => {
  const sourceMessage = {
    uid: 1,
    folder: "INBOX",
    folderKey: "\\inbox",
    messageId: "fresh@example.com",
    semanticHash: null,
  };
  let saved = {
    auditWindow: { sourceSince: null, destinationSince: null },
    sourceInventory: {
      counts: [{ folder: "INBOX", folderKey: "\\inbox", messages: 1, uidValidity: "1" }],
      messages: [sourceMessage],
    },
    destinationBefore: { counts: [], messages: [] },
    pendingBatches: [{ folder: "INBOX", uids: [1] }],
    totalSyncBatches: 1,
    completedSyncBatches: 0,
    inboxCounts: { before: null, iterations: [], after: null },
  };
  let removals = 0;
  let sourceScans = 0;
  const checkpointStore = {
    load: async () => saved,
    save: async (value) => { saved = structuredClone(value); },
    remove: async () => { removals += 1; saved = null; },
  };
  let destinationScans = 0;
  const result = await processAccount(
    { email: "person@example.com", yandexPassword: "source", guzelPassword: "destination" },
    { days: null, dryRun: false },
    {
      checkpointStore,
      scanMailbox: async ({ server, includeMessages }) => {
        if (server.name === "Yandex") {
          sourceScans += 1;
          if (includeMessages === false) {
            return { counts: [{ folder: "INBOX", folderKey: "\\inbox", messages: 1, uidValidity: "2" }], messages: [] };
          }
          return { counts: [], messages: [sourceMessage] };
        }
        destinationScans += 1;
        return { counts: [], messages: destinationScans === 1 ? [] : [sourceMessage] };
      },
      runImapsync: async () => {},
      getMailboxCount: async () => 1,
    },
  );

  assert.equal(result.success, true);
  assert.equal(sourceScans, 2);
  assert.ok(removals >= 2);
});

test("dry runs never load, save, or remove checkpoints", async () => {
  const calls = [];
  const result = await processAccount(
    { email: "person@example.com", yandexPassword: "source", guzelPassword: "destination" },
    { days: 7, dryRun: true, restart: true },
    {
      checkpointStore: {
        load: async () => { calls.push("load"); },
        save: async () => { calls.push("save"); },
        remove: async () => { calls.push("remove"); },
      },
      scanMailbox: async () => ({ counts: [], messages: [] }),
    },
  );
  assert.equal(result.success, true);
  assert.deepEqual(calls, []);
});

test("restart discards saved progress before loading", async () => {
  const calls = [];
  const checkpointStore = {
    remove: async () => { calls.push("remove"); },
    load: async () => { calls.push("load"); return null; },
    save: async () => { calls.push("save"); },
  };
  const result = await processAccount(
    { email: "person@example.com", yandexPassword: "source", guzelPassword: "destination" },
    { days: null, dryRun: false, restart: true },
    {
      checkpointStore,
      scanMailbox: async () => ({ counts: [], messages: [] }),
    },
  );
  assert.equal(result.success, true);
  assert.deepEqual(calls.slice(0, 2), ["remove", "load"]);
});

test("a quota-paused account does not prevent another account from completing", async () => {
  const accounts = ["full@example.com", "ok@example.com"];
  const results = await mapConcurrent(accounts, 2, (email) => processAccount(
    { email, yandexPassword: "source", guzelPassword: "destination" },
    { days: null, dryRun: false },
    {
      scanMailbox: async ({ server }) => ({
        counts: [],
        messages: server.name === "Yandex" ? [{
          uid: 1,
          folder: "INBOX",
          folderKey: "\\inbox",
          messageId: email,
        }] : email === "ok@example.com" ? [{
          uid: 2,
          folder: "INBOX",
          folderKey: "\\inbox",
          messageId: email,
        }] : [],
      }),
      runImapsync: async () => {
        throw Object.assign(new Error("destination mailbox is full"), { code: "quota_exceeded" });
      },
    },
  ));
  assert.equal(results[0].status, "PAUSED_QUOTA");
  assert.equal(results[1].status, "PASS");
});

test("skips an account with a matching successful-sync record", async () => {
  let scans = 0;
  const result = await processAccount(
    { email: "person@example.com", yandexPassword: "source", guzelPassword: "destination" },
    { days: null, dryRun: false },
    {
      checkpointStore: {
        loadSuccess: async () => ({ lastSuccessfulSyncAt: "2026-06-21T10:00:00.000Z" }),
      },
      scanMailbox: async () => { scans += 1; return { counts: [], messages: [] }; },
    },
  );
  assert.equal(result.success, true);
  assert.equal(result.status, "SKIPPED_ALREADY_SYNCED");
  assert.equal(result.lastSuccessfulSyncAt, "2026-06-21T10:00:00.000Z");
  assert.equal(scans, 0);
});
