/**
 * Elektrobun main process.
 *
 * Elektrobun is not yet on the public npm registry. Install from source:
 *   https://github.com/nicholasgasior/elektrobun
 * then run: bun run dev
 *
 * Until then, run `bun run src/devserver.ts` to test the UI in a browser.
 */

// @ts-ignore — available once elektrobun is installed
import { createWindow, createWebviewBridge } from "elektrobun";

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { listAccounts, addAccount, removeAccount, setPassword, deletePasswords } from "./ipc/accounts.ts";
import { testConnection } from "./ipc/connection.ts";
import {
  startMigration,
  pauseAccount,
  resumeAccount,
  stopAccount,
  restartAccount,
} from "./ipc/migration.ts";
import { getSettings, saveSettings } from "./ipc/settings.ts";
import { listHistory, getReport, openDir } from "./ipc/history.ts";

// Ensure config directory exists
await mkdir(join(homedir(), ".config", "imap-migrate"), { recursive: true });

const win = createWindow({
  title: "IMAP MIGRATION CONTROL — v2",
  url: new URL("../ui/index.html", import.meta.url).pathname,
  width: 1280,
  height: 820,
  minWidth: 900,
  minHeight: 600,
});

const bridge = createWebviewBridge(win);

// Emitter — pushes events from main → webview
function emit(event: string, payload: unknown): void {
  bridge.emit(event, payload);
}

// ── RPC Handlers ───────────────────────────────────────────────────────────

bridge.handle("accounts.list", () => listAccounts());
bridge.handle("accounts.add", (_e: unknown, email: string) => addAccount(email));
bridge.handle("accounts.remove", (_e: unknown, email: string) => removeAccount(email));
bridge.handle(
  "accounts.setPassword",
  (_e: unknown, email: string, type: "source" | "dest", password: string) =>
    setPassword(email, type, password),
);
bridge.handle("accounts.deletePasswords", (_e: unknown, email: string) =>
  deletePasswords(email),
);

bridge.handle("connection.test", (_e: unknown, email: string, type: "source" | "dest") =>
  testConnection(email, type),
);

bridge.handle(
  "migration.start",
  (_e: unknown, emails: string[], options: any) =>
    startMigration(emails, options, emit),
);
bridge.handle("migration.pause", (_e: unknown, email: string) => pauseAccount(email));
bridge.handle("migration.resume", (_e: unknown, email: string, options: any) =>
  resumeAccount(email, options, emit),
);
bridge.handle("migration.stop", (_e: unknown, email: string) => stopAccount(email));
bridge.handle("migration.restart", (_e: unknown, email: string, options: any) =>
  restartAccount(email, options, emit),
);

bridge.handle("settings.get", () => getSettings());
bridge.handle("settings.save", (_e: unknown, settings: any) => saveSettings(settings));

bridge.handle("history.list", () => listHistory());
bridge.handle("history.getReport", (_e: unknown, path: string) => getReport(path));
bridge.handle("history.openDir", () => openDir());
