import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderTextReport, writeReports } from "../src/report.js";

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
  assert.equal(await readFile(join(parent, "reports", ".gitignore"), "utf8"), "*\n!.gitignore\n");
});

test("reports already-synchronized accounts and their last sync time", () => {
  const text = renderTextReport({
    startedAt: "2026-06-21T11:00:00.000Z",
    finishedAt: "2026-06-21T11:00:01.000Z",
    days: null,
    dryRun: false,
    success: true,
    accounts: [{
      email: "person@example.com",
      success: true,
      status: "SKIPPED_ALREADY_SYNCED",
      lastSuccessfulSyncAt: "2026-06-21T10:00:00.000Z",
      counts: [],
      messages: [],
      inboxCounts: { iterations: [] },
    }],
  });
  assert.match(text, /Result: SKIPPED \(SYNCED\)/u);
  assert.match(text, /Last successful sync: 2026-06-21T10:00:00.000Z/u);
});

test("reports quota pauses with resume instructions", () => {
  const text = renderTextReport({
    startedAt: "2025-06-20T10:00:00.000Z",
    finishedAt: "2025-06-20T10:01:00.000Z",
    days: null,
    dryRun: false,
    success: false,
    accounts: [{
      email: "person@example.com",
      success: false,
      status: "PAUSED_QUOTA",
      error: "destination mailbox is full",
      counts: [],
      messages: [],
      inboxCounts: { iterations: [] },
    }],
  });
  assert.match(text, /Result: PAUSED \(QUOTA\)/u);
  assert.match(text, /Free destination mailbox space and rerun/u);
});
