import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import type { HistoryRecord } from "../types.ts";
import { getSettings } from "./settings.ts";

export async function listHistory(): Promise<HistoryRecord[]> {
  const settings = await getSettings();
  const dir = settings.reportDir;

  let files: string[];
  try {
    const entries = await readdir(dir);
    files = entries
      .filter((f) => f.startsWith("migration-") && f.endsWith(".json"))
      .sort()
      .reverse();
  } catch {
    return [];
  }

  const records: HistoryRecord[] = [];
  for (const file of files) {
    try {
      const text = await Bun.file(join(dir, file)).text();
      const data = JSON.parse(text);
      records.push({
        path: join(dir, file),
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        success: data.success,
        dryRun: data.dryRun ?? false,
        accounts: (data.accounts ?? []).map((a: any) => ({
          email: a.email,
          status: a.status,
          copied: (a.messages ?? []).filter((m: any) => m.status === "copied-and-verified").length,
          unresolved: (a.messages ?? []).filter((m: any) => m.status === "unresolved").length,
          durationMs: a.durationMs ?? 0,
        })),
      });
    } catch {
      // skip malformed report
    }
  }
  return records;
}

export async function getReport(path: string): Promise<unknown> {
  const text = await Bun.file(path).text();
  return JSON.parse(text);
}

export async function openDir(): Promise<void> {
  const settings = await getSettings();
  const dir = settings.reportDir;
  switch (process.platform) {
    case "darwin": await $`open ${dir}`.quiet().nothrow(); break;
    case "linux":  await $`xdg-open ${dir}`.quiet().nothrow(); break;
    case "win32":  await $`explorer ${dir}`.quiet().nothrow(); break;
  }
}
