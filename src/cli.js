#!/usr/bin/env node
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { loadAccounts } from "./accounts.js";
import { DEFAULTS, loadMigrationConfig } from "./config.js";
import { checkImapsync } from "./imapsync.js";
import { mapConcurrent, processAccount } from "./migrate.js";
import { writeReports } from "./report.js";
import { inboxTimelineRows, renderTable, summaryRows } from "./table.js";

const HELP = `Yandex Escape — IMAP mailbox migration with message-level verification

Usage:
  npm run migrate -- --config <migration.json> --accounts <accounts.json> [options]

Options:
  --config <path>     Source and destination provider configuration
  --accounts <path>   JSON account credentials file
  --days <n>          Limit audit to the most recent N days (default: all time)
  --concurrency <n>   Mailboxes processed simultaneously (default: 3)
  --report-dir <path> Report directory (default: reports)
  --dry-run           Scan and report without copying messages
  --yes               Approve proposed copies without an interactive prompt
  --force             Reverify accounts that previously passed
  --restart           Retry failed/paused accounts from a fresh inventory
  -h, --help          Show this help
`;

export function parseArguments(argv) {
  const options = {
    days: DEFAULTS.days,
    concurrency: DEFAULTS.concurrency,
    reportDir: DEFAULTS.reportDir,
    dryRun: false,
    yes: false,
    force: false,
    restart: false,
    configFile: null,
    accountsFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { ...options, help: true };
    if (["--dry-run", "--yes", "--force", "--restart"].includes(argument)) {
      const key = argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
      options[key] = true;
      continue;
    }
    if (["--days", "--concurrency", "--report-dir", "--config", "--accounts"].includes(argument)) {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${argument} requires a value`);
      if (argument === "--report-dir") options.reportDir = value;
      else if (argument === "--config") options.configFile = value;
      else if (argument === "--accounts") options.accountsFile = value;
      else {
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < 1) {
          throw new Error(`${argument} must be a positive integer`);
        }
        if (argument === "--days") options.days = number;
        else options.concurrency = number;
      }
      continue;
    }
    // One-release compatibility for `npm run migrate -- accounts.txt`.
    if (!argument.startsWith("-") && !options.accountsFile) {
      options.accountsFile = argument;
      options.configFile ??= "migration.json";
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    throw new Error(`Unexpected argument: ${argument}`);
  }
  if (!options.configFile) throw new Error("--config is required");
  if (!options.accountsFile) throw new Error("--accounts is required");
  return options;
}

export function createRepairConfirmer({ yes, input = process.stdin, output = process.stdout } = {}) {
  if (yes) return async () => true;
  let queue = Promise.resolve();
  return (plan) => {
    const request = async () => {
      if (!input.isTTY) {
        throw new Error(
          `Repair requires confirmation for ${plan.email}; rerun with --yes for non-interactive use`,
        );
      }
      output.write(
        `\n${plan.email}: copy ${plan.missing} missing message(s) `
        + `from ${plan.sourceServer.name} to ${plan.destinationServer.name}.\n`,
      );
      const prompt = createInterface({ input, output });
      try {
        return (await prompt.question('Type "yes" to continue: ')).trim().toLowerCase() === "yes";
      } finally {
        prompt.close();
      }
    };
    const result = queue.then(request, request);
    queue = result.catch(() => {});
    return result;
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const controller = new AbortController();
  process.once("SIGINT", () => {
    process.stderr.write("\nStopping safely...\n");
    controller.abort();
  });

  const [accounts, migration] = await Promise.all([
    loadAccounts(resolve(options.accountsFile)),
    loadMigrationConfig(resolve(options.configFile)),
  ]);
  if (!options.dryRun) {
    const version = await checkImapsync();
    process.stdout.write(`Using ${version}\n`);
  }
  process.stdout.write(
    `${options.dryRun ? "Auditing" : "Migrating"} ${accounts.length} account(s) from `
    + `${migration.source.name} to ${migration.destination.name}, ${options.concurrency} at a time, `
    + `with an ${options.days === null ? "all-time" : `${options.days}-day`} message audit\n`,
  );

  const startedAt = new Date().toISOString();
  const log = (email, message) => process.stdout.write(`[${email}] ${message}\n`);
  const confirmRepair = options.dryRun
    ? null
    : createRepairConfirmer({ yes: options.yes });
  const accountResults = await mapConcurrent(accounts, options.concurrency, (account) =>
    processAccount(account, {
      ...options,
      sourceServer: migration.source,
      destinationServer: migration.destination,
      signal: controller.signal,
      confirmRepair,
      log,
    }));
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    source: migration.source.name,
    destination: migration.destination.name,
    days: options.days,
    dryRun: options.dryRun,
    success: accountResults.every((account) => account.success),
    accounts: accountResults,
  };
  const inboxRows = inboxTimelineRows(accountResults);
  if (inboxRows.length) {
    process.stdout.write(`\nInbox totals\n${renderTable([
      { key: "account", label: "Account" },
      { key: "stage", label: "Stage" },
      { key: "folder", label: "Folder" },
      { key: "yandex", label: migration.source.name, align: "right" },
      { key: "guzel", label: migration.destination.name, align: "right" },
    ], inboxRows)}\n`);
  }
  process.stdout.write(`\nVerification summary\n${renderTable([
    { key: "account", label: "Account" },
    { key: "result", label: "Result" },
    { key: "checked", label: "Checked", align: "right" },
    { key: "copied", label: "Copied", align: "right" },
    { key: "elsewhere", label: "Elsewhere", align: "right" },
    { key: "unresolved", label: "Unresolved", align: "right" },
    { key: "seconds", label: "Seconds", align: "right" },
  ], summaryRows(accountResults))}\n`);
  const paths = await writeReports(report, options.reportDir);
  process.stdout.write(`Reports:\n  ${paths.textPath}\n  ${paths.jsonPath}\n`);
  process.stdout.write(`Overall: ${report.success ? "PASS" : "FAIL"}\n`);
  if (accountResults.some((account) => account.status === "PAUSED_QUOTA")) {
    process.stdout.write("One or more accounts are paused because the destination is full. Free space and rerun the same command.\n");
  }
  if (!report.success) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
