import { chmod, mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/gu, "-");
}

function printable(value) {
  return String(value ?? "").replace(/[\r\n\t]+/gu, " ").trim();
}

export function renderTextReport(report) {
  const lines = [
    "IMAP migration verification report",
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Audit window: ${report.days} day(s)`,
    `Dry run: ${report.dryRun ? "yes" : "no"}`,
    "",
  ];

  for (const account of report.accounts) {
    lines.push(`ACCOUNT ${account.email}`, `Result: ${account.success ? "PASS" : "FAIL"}`);
    if (account.error) lines.push(`Error: ${printable(account.error)}`);
    lines.push("Folder counts are informational only:");
    for (const count of account.counts ?? []) {
      lines.push(
        `  ${printable(count.folder)}: Yandex=${count.source ?? "-"}, `
        + `Guzel before=${count.destinationBefore ?? "-"}, Guzel after=${count.destinationAfter ?? "-"}`,
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
  const base = `migration-${safeTimestamp(new Date(report.startedAt))}`;
  const jsonPath = join(directory, `${base}.json`);
  const textPath = join(directory, `${base}.txt`);
  await secureWrite(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await secureWrite(textPath, renderTextReport(report));
  return { jsonPath, textPath };
}
