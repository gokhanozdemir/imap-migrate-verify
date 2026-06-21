import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

  const success = await store.saveSuccess({ sourceMessageCount: 2 });
  assert.equal((await stat(store.successPath)).mode & 0o777, 0o600);
  assert.equal((await store.loadSuccess()).lastSuccessfulSyncAt, success.lastSuccessfulSyncAt);
  assert.equal((await store.loadSuccess()).sourceMessageCount, 2);
  const differentAudit = createCheckpointStore(join(parent, "state"), { ...identity, days: 7 });
  assert.equal(differentAudit.successPath, store.successPath);
  assert.equal((await differentAudit.loadSuccess()).lastSuccessfulSyncAt, success.lastSuccessfulSyncAt);
  const differentDestination = createCheckpointStore(join(parent, "state"), {
    ...identity,
    destination: { ...identity.destination, host: "another.example.com" },
  });
  assert.equal(await differentDestination.loadSuccess(), null);
  assert.equal(await readFile(join(parent, "state", ".gitignore"), "utf8"), "*\n!.gitignore\n");

  await writeFile(store.path, "{interrupted", { mode: 0o600 });
  assert.equal(await store.load(), null);
});

test("migrates settings-scoped success records and still skips the account", async () => {
  const parent = await mkdtemp(join(tmpdir(), "migration-legacy-success-test-"));
  const directory = join(parent, "state");
  const identity = {
    email: "legacy@example.com",
    source: { host: "source.example.com", port: 993, secure: true },
    destination: { host: "destination.example.com", port: 993, secure: true },
    days: 7,
    destinationLookbackBufferDays: 2,
  };
  const store = createCheckpointStore(directory, identity);
  await store.saveSuccess();
  await rm(store.successPath);
  const oldDigest = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 20);
  const oldPath = join(directory, `success-${oldDigest}.json`);
  await writeFile(oldPath, `${JSON.stringify({
    identity,
    lastSuccessfulSyncAt: "2026-06-21T12:00:00.000Z",
  })}\n`, { mode: 0o600 });

  const changedOptions = createCheckpointStore(directory, { ...identity, days: null });
  const record = await changedOptions.loadSuccess();
  assert.equal(record.lastSuccessfulSyncAt, "2026-06-21T12:00:00.000Z");
  assert.equal((await stat(changedOptions.successPath)).mode & 0o777, 0o600);
});
