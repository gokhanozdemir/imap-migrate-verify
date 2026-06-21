import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCheckpointStore } from "../src/checkpoint.js";

test("writes private atomic checkpoints and ignores corrupt state", async () => {
  const parent = await mkdtemp(join(tmpdir(), "migration-checkpoint-test-"));
  const identity = {
    email: "person@example.com",
    source: { host: "source.example.com", port: 993, secure: true },
    destination: { host: "destination.example.com", port: 993, secure: true },
    days: null,
    destinationLookbackBufferDays: 2,
  };
  const store = createCheckpointStore(join(parent, "state"), identity);
  await store.save({
    auditWindow: { sourceSince: null, destinationSince: null },
    sourceInventory: { counts: [], messages: [] },
    destinationBefore: { counts: [], messages: [] },
    pendingBatches: [{ folder: "INBOX", uids: [1, 2] }],
    totalSyncBatches: 1,
    completedSyncBatches: 0,
  });

  assert.equal((await stat(store.path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(parent, "state"))).mode & 0o777, 0o700);
  const text = await readFile(store.path, "utf8");
  assert.doesNotMatch(text, /password|message body/iu);
  assert.deepEqual((await store.load()).pendingBatches[0].uids, [1, 2]);

  await writeFile(store.path, "{interrupted", { mode: 0o600 });
  assert.equal(await store.load(), null);
});
