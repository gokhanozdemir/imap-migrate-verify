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
    { scanMailbox, runImapsync: async () => { syncCalls += 1; } },
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
    { scanMailbox, runImapsync: async (options) => { syncOptions.push(options); } },
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
