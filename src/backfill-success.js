#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCheckpointStore } from "./checkpoint.js";

export async function backfillSuccessfulAccounts(reportPath) {
  const absoluteReportPath = resolve(reportPath);
  const report = JSON.parse(await readFile(absoluteReportPath, "utf8"));
  if (report.dryRun) throw new Error("Cannot backfill successful syncs from a dry-run report");
  if (typeof report.finishedAt !== "string" || !Array.isArray(report.accounts)) {
    throw new Error("Invalid migration report");
  }

  const stateDirectory = join(dirname(absoluteReportPath), "state");
  const successful = report.accounts.filter((account) =>
    account?.success === true && account.status !== "SKIPPED_ALREADY_SYNCED");

  for (const account of successful) {
    if (typeof account.email !== "string" || !account.email) continue;
    const store = createCheckpointStore(stateDirectory, {
      email: account.email,
      backfilledFrom: report.startedAt ?? report.finishedAt,
    });
    await store.saveSuccess({
      lastSuccessfulSyncAt: report.finishedAt,
      sourceMessageCount: account.messages?.length ?? null,
      backfilled: true,
    });
  }
  return { count: successful.length, stateDirectory };
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error("Usage: node src/backfill-success.js <migration-report.json>");
  const result = await backfillSuccessfulAccounts(reportPath);
  process.stdout.write(`Recorded ${result.count} successful account(s) in ${result.stateDirectory}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
