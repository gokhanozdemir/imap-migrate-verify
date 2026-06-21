/**
 * Browser-based dev server — use when Elektrobun is not yet installed.
 * Run: bun run src/devserver.ts
 * Open: http://localhost:3131
 *
 * IPC calls go over WebSocket; the server dispatches them to the same
 * handlers used by the real Elektrobun main process.
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { listAccounts, addAccount, removeAccount, setPassword, deletePasswords } from "./ipc/accounts.ts";
import { testConnection } from "./ipc/connection.ts";
import { startMigration, pauseAccount, resumeAccount, stopAccount, restartAccount } from "./ipc/migration.ts";
import { getSettings, saveSettings } from "./ipc/settings.ts";
import { listHistory, getReport, openDir } from "./ipc/history.ts";

await mkdir(join(homedir(), ".config", "imap-migrate"), { recursive: true });

const clients = new Set<ServerWebSocket<unknown>>();

type Handler = (...args: any[]) => unknown;

const handlers: Record<string, Handler> = {
  "accounts.list": () => listAccounts(),
  "accounts.add": (email: string) => addAccount(email),
  "accounts.remove": (email: string) => removeAccount(email),
  "accounts.setPassword": (email: string, type: any, password: string) =>
    setPassword(email, type, password),
  "accounts.deletePasswords": (email: string) => deletePasswords(email),
  "connection.test": (email: string, type: any) => testConnection(email, type),
  "migration.start": (emails: string[], options: any) =>
    startMigration(emails, options, (event, payload) => {
      const msg = JSON.stringify({ type: "event", event, payload });
      for (const c of clients) c.send(msg);
    }),
  "migration.pause": (email: string) => pauseAccount(email),
  "migration.resume": (email: string, options: any) =>
    resumeAccount(email, options, (event, payload) => {
      const msg = JSON.stringify({ type: "event", event, payload });
      for (const c of clients) c.send(msg);
    }),
  "migration.stop": (email: string) => stopAccount(email),
  "migration.restart": (email: string, options: any) =>
    restartAccount(email, options, (event, payload) => {
      const msg = JSON.stringify({ type: "event", event, payload });
      for (const c of clients) c.send(msg);
    }),
  "settings.get": () => getSettings(),
  "settings.save": (settings: any) => saveSettings(settings),
  "history.list": () => listHistory(),
  "history.getReport": (path: string) => getReport(path),
  "history.openDir": () => openDir(),
};

const UI_DIR = new URL("../ui", import.meta.url).pathname;

Bun.serve({
  port: 3131,
  async fetch(req, server) {
    if (server.upgrade(req)) return;
    const url = new URL(req.url);
    let filePath = join(UI_DIR, url.pathname === "/" ? "index.html" : url.pathname);
    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file);
    // fallback — serve index.html for SPA routing
    return new Response(Bun.file(join(UI_DIR, "index.html")));
  },
  websocket: {
    open(ws) { clients.add(ws); },
    close(ws) { clients.delete(ws); },
    async message(ws, raw) {
      const { id, method, args } = JSON.parse(String(raw));
      try {
        const handler = handlers[method];
        if (!handler) throw new Error(`Unknown method: ${method}`);
        const result = await handler(...(args ?? []));
        ws.send(JSON.stringify({ id, result }));
      } catch (err: any) {
        ws.send(JSON.stringify({ id, error: err?.message ?? String(err) }));
      }
    },
  },
});

console.log("Dev server: http://localhost:3131");
