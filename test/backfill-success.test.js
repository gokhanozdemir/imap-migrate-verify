import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { backfillSuccessfulAccounts } from "../src/backfill-success.js";
import { createCheckpointStore } from "../src/checkpoint.js";

test("backfills only PASS accounts from an earlier report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-backfill-test-"));
  const reportPath = join(directory, "migration.json");
  await writeFile(reportPath, JSON.stringify({
    startedAt: "2026-06-21T00:00:00.000Z",
    finishedAt: "2026-06-21T02:00:00.000Z",
    dryRun: false,
    accounts: [
      { email: "pass@example.com", success: true, status: "PASS", messages: [{}, {}] },
      { email: "fail@example.com", success: false, status: "FAILED", messages: [] },
    ],
  }));

  const result = await backfillSuccessfulAccounts(reportPath);
  assert.equal(result.count, 1);
  const passStore = createCheckpointStore(join(directory, "state"), { email: "pass@example.com" });
  const failStore = createCheckpointStore(join(directory, "state"), { email: "fail@example.com" });
  assert.equal((await passStore.loadSuccess()).lastSuccessfulSyncAt, "2026-06-21T02:00:00.000Z");
  assert.equal(await failStore.loadSuccess(), null);
});
