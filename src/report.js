import { chmod, mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/gu, "-");
}

function printable(value) {
  return String(value ?? "").replace(/[\r\n\t]+/gu, " ").trim();
}

export function renderTextReport(report) {
  const source = printable(report.source || "Source");
  const destination = printable(report.destination || "Destination");
  const lines = [
    "IMAP migration verification report",
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Audit window: ${report.days === null ? "all time" : `${report.days} day(s)`}`,
    `Dry run: ${report.dryRun ? "yes" : "no"}`,
    "",
  ];

  for (const account of report.accounts) {
    const result = account.status === "PAUSED_QUOTA"
      ? "PAUSED (QUOTA)"
      : account.status === "SKIPPED_ALREADY_SYNCED" ? "SKIPPED (SYNCED)" : account.success ? "PASS" : "FAIL";
    lines.push(`ACCOUNT ${account.email}`, `Result: ${result}`);
    if (account.lastSuccessfulSyncAt) {
      lines.push(`Last successful sync: ${printable(account.lastSuccessfulSyncAt)}`);
    }
    if (account.error) lines.push(`Error: ${printable(account.error)}`);
    if (account.status === "PAUSED_QUOTA") {
      lines.push("Action: Free destination mailbox space and rerun the same command to resume.");
    }
    if (account.inboxCounts?.before) {
      lines.push(
        `Inbox totals before: ${source}=${account.inboxCounts.before.yandex}, `
        + `${destination}=${account.inboxCounts.before.guzel}`,
      );
    }
    for (const iteration of account.inboxCounts?.iterations ?? []) {
      lines.push(
        `Inbox totals after batch ${iteration.iteration}/${iteration.totalIterations}: `
        + `${source}=${iteration.yandex}, ${destination}=${iteration.guzel}`,
      );
    }
    if (account.inboxCounts?.after) {
      lines.push(
        `Inbox totals after: ${source}=${account.inboxCounts.after.yandex}, `
        + `${destination}=${account.inboxCounts.after.guzel}`,
      );
    }
    lines.push("Folder counts are informational only:");
    for (const count of account.counts ?? []) {
      lines.push(
        `  ${printable(count.folder)}: ${source}=${count.source ?? "-"}, `
        + `${destination} before=${count.destinationBefore ?? "-"}, `
        + `${destination} after=${count.destinationAfter ?? "-"}`,
      );
    }
    lines.push("Recent source messages:");
    for (const item of account.messages ?? []) {
      lines.push(
        `  [${item.status}] ${printable(item.date)} | ${printable(item.sender)} | `
        + `${printable(item.subject)} | ${printable(item.sourceFolder)}`
        + (item.destinationFolder ? ` -> ${printable(item.destinationFolder)}` : ""),
      );
    }
    lines.push("");
  }

  lines.push(`Overall: ${report.success ? "PASS" : "FAIL"}`);
  return `${lines.join("\n")}\n`;
}

async function secureWrite(path, content) {
  const handle = await open(path, "w", 0o600);
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
}

export async function writeReports(report, reportDirectory) {
  const directory = resolve(reportDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await secureWrite(join(directory, ".gitignore"), "*\n!.gitignore\n");
  const base = `migration-${safeTimestamp(new Date(report.startedAt))}`;
  const jsonPath = join(directory, `${base}.json`);
  const textPath = join(directory, `${base}.txt`);
  await secureWrite(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await secureWrite(textPath, renderTextReport(report));
  return { jsonPath, textPath };
}
