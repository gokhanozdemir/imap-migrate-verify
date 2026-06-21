import { join } from "node:path";
import { homedir } from "node:os";
import type { AppSettings } from "../types.ts";

const CONFIG_DIR = join(homedir(), ".config", "imap-migrate");
const SETTINGS_FILE = join(CONFIG_DIR, "settings.json");

const DEFAULTS: AppSettings = {
  source: { host: "", port: 993, secure: true },
  destination: { host: "", port: 993, secure: true },
  concurrency: 3,
  days: null,
  reportDir: join(homedir(), "imap-migrate-reports"),
  imapsyncPath: "imapsync",
};

async function ensureConfigDir(): Promise<void> {
  await Bun.file(CONFIG_DIR).exists().catch(() => null);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const text = await Bun.file(SETTINGS_FILE).text();
    return { ...DEFAULTS, ...JSON.parse(text) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureConfigDir();
  await Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}
