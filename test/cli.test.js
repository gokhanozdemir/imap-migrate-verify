import assert from "node:assert/strict";
import test from "node:test";
import { createRepairConfirmer, parseArguments } from "../src/cli.js";

test("parses CLI defaults and overrides", () => {
  assert.deepEqual(parseArguments([
    "--config", "migration.json", "--accounts", "accounts.json",
  ]), {
    days: null,
    concurrency: 3,
    reportDir: "reports",
    dryRun: false,
    yes: false,
    force: false,
    restart: false,
    configFile: "migration.json",
    accountsFile: "accounts.json",
  });
  const custom = parseArguments([
    "--config", "custom.json", "--accounts", "people.json", "--days", "14",
    "--concurrency", "2", "--dry-run", "--yes", "--force", "--restart",
    "--report-dir", "private",
  ]);
  assert.equal(custom.days, 14);
  assert.equal(custom.concurrency, 2);
  assert.equal(custom.dryRun, true);
  assert.equal(custom.yes, true);
  assert.equal(custom.force, true);
  assert.equal(custom.restart, true);
  assert.equal(custom.reportDir, "private");
});

test("keeps the old positional account path for one compatibility release", () => {
  const options = parseArguments(["accounts.txt"]);
  assert.equal(options.accountsFile, "accounts.txt");
  assert.equal(options.configFile, "migration.json");
});

test("rejects unsafe or incomplete CLI values", () => {
  assert.throws(
    () => parseArguments(["--config", "migration.json", "--accounts", "accounts.json", "--days", "0"]),
    /positive integer/,
  );
  assert.throws(() => parseArguments(["--unknown"]), /Unknown option/);
  assert.throws(() => parseArguments(["--config", "migration.json"]), /--accounts is required/);
});

test("--yes authorizes repairs without reading input", async () => {
  const confirm = createRepairConfirmer({ yes: true });
  assert.equal(await confirm({ email: "person@example.com", missing: 2 }), true);
});

test("non-interactive repair requires --yes", async () => {
  const confirm = createRepairConfirmer({ yes: false, input: { isTTY: false } });
  await assert.rejects(
    confirm({
      email: "person@example.com",
      missing: 2,
      sourceServer: { name: "Source" },
      destinationServer: { name: "Destination" },
    }),
    /rerun with --yes/,
  );
});
