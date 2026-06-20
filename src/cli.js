#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadAccounts } from "./accounts.js";
import { DEFAULTS } from "./config.js";
import { checkImapsync } from "./imapsync.js";
import { mapConcurrent, processAccount } from "./migrate.js";
import { writeReports } from "./report.js";

const HELP = `Usage: npm run migrate -- <accounts-file> [options]

Options:
  --days <n>          Recent-message audit window (default: 7)
  --concurrency <n>   Mailboxes processed simultaneously (default: 3)
  --report-dir <path> Report directory (default: reports)
  --dry-run           Compare and preview imapsync without copying
  -h, --help          Show this help
`;

export function parseArguments(argv) {
  const options = {
    days: DEFAULTS.days,
    concurrency: DEFAULTS.concurrency,
    reportDir: DEFAULTS.reportDir,
    dryRun: false,
    accountsFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { ...options, help: true };
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (["--days", "--concurrency", "--report-dir"].includes(argument)) {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${argument} requires a value`);
      if (argument === "--report-dir") options.reportDir = value;
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
    if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    if (options.accountsFile) throw new Error(`Unexpected argument: ${argument}`);
    options.accountsFile = argument;
  }
  if (!options.accountsFile) throw new Error("An accounts file is required");
  return options;
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

  const accounts = await loadAccounts(resolve(options.accountsFile));
  const version = await checkImapsync();
  process.stdout.write(`Using ${version}\n`);
  process.stdout.write(
    `${options.dryRun ? "Previewing" : "Migrating"} ${accounts.length} account(s), `
    + `${options.concurrency} at a time, with a ${options.days}-day message audit\n`,
  );

  const startedAt = new Date().toISOString();
  const log = (email, message) => process.stdout.write(`[${email}] ${message}\n`);
  const accountResults = await mapConcurrent(accounts, options.concurrency, (account) =>
    processAccount(account, { ...options, signal: controller.signal, log }));
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    days: options.days,
    dryRun: options.dryRun,
    success: accountResults.every((account) => account.success),
    accounts: accountResults,
  };
  const paths = await writeReports(report, options.reportDir);
  process.stdout.write(`Reports:\n  ${paths.textPath}\n  ${paths.jsonPath}\n`);
  process.stdout.write(`Overall: ${report.success ? "PASS" : "FAIL"}\n`);
  if (!report.success) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
