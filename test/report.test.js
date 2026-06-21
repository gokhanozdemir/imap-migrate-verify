import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeReports } from "../src/report.js";

test("writes private JSON and text reports", async () => {
  const parent = await mkdtemp(join(tmpdir(), "migration-report-test-"));
  const report = {
    startedAt: "2025-06-20T10:00:00.000Z",
    finishedAt: "2025-06-20T10:01:00.000Z",
    days: null,
    dryRun: false,
    success: true,
    accounts: [],
  };
  const paths = await writeReports(report, join(parent, "reports"));
  assert.equal((await stat(paths.jsonPath)).mode & 0o777, 0o600);
  assert.equal((await stat(paths.textPath)).mode & 0o777, 0o600);
  assert.match(await readFile(paths.textPath, "utf8"), /Overall: PASS/);
  assert.match(await readFile(paths.textPath, "utf8"), /Audit window: all time/);
});
