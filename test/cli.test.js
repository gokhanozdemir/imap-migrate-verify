import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "../src/cli.js";

test("parses CLI defaults and overrides", () => {
  assert.deepEqual(parseArguments(["accounts.txt"]), {
    days: 7,
    concurrency: 3,
    reportDir: "reports",
    dryRun: false,
    accountsFile: "accounts.txt",
  });
  const custom = parseArguments([
    "accounts.txt", "--days", "14", "--concurrency", "2", "--dry-run", "--report-dir", "private",
  ]);
  assert.equal(custom.days, 14);
  assert.equal(custom.concurrency, 2);
  assert.equal(custom.dryRun, true);
  assert.equal(custom.reportDir, "private");
});

test("rejects unsafe or ambiguous CLI values", () => {
  assert.throws(() => parseArguments(["accounts.txt", "--days", "0"]), /positive integer/);
  assert.throws(() => parseArguments(["accounts.txt", "--unknown"]), /Unknown option/);
});
