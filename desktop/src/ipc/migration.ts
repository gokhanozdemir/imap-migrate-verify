import { join } from "node:path";
import type { MigrationDone, MigrationProgress, MigrationStartOptions } from "../types.ts";
import { getPassword } from "../keychain/index.ts";
import { getSettings } from "./settings.ts";

// Dynamically import core CLI modules (ESM, no transpile needed)
const { processAccount } = await import("../../../src/migrate.js");
const { loadConfig } = await import("../../../src/config.js");

export type Emitter = (event: string, payload: unknown) => void;

interface AccountState {
  pauseController: AbortController;
  stopController: AbortController;
  startedAt: number;
}

const active = new Map<string, AccountState>();

export async function startMigration(
  emails: string[],
  options: MigrationStartOptions,
  emit: Emitter,
): Promise<void> {
  const settings = await getSettings();

  const config = {
    source: settings.source,
    destination: settings.destination,
  };

  const migrateOptions = {
    days: options.days ?? settings.days,
    concurrency: options.concurrency ?? settings.concurrency,
    reportDir: settings.reportDir,
    dryRun: options.dryRun,
    yes: options.yes ?? true,
    force: options.force ?? false,
    imapsyncPath: settings.imapsyncPath,
  };

  const runners = emails.map(async (email) => {
    const stopController = new AbortController();
    const pauseController = new AbortController();
    const startedAt = Date.now();

    active.set(email, { pauseController, stopController, startedAt });

    let sourcePassword: string;
    let destinationPassword: string;
    try {
      [sourcePassword, destinationPassword] = await Promise.all([
        getPassword(email, "source"),
        getPassword(email, "dest"),
      ]);
    } catch (err: any) {
      emit("migration:done", {
        email,
        status: "failed",
        durationMs: Date.now() - startedAt,
        counts: [],
        requiresPasswordCleanup: false,
        error: `Keychain error: ${err?.message ?? err}`,
      } satisfies MigrationDone & { error: string });
      active.delete(email);
      return;
    }

    const account = { email, sourcePassword, destinationPassword };

    let batchDone = 0;
    let batchTotal = 0;

    const result = await processAccount(account, config, {
      ...migrateOptions,
      signal: stopController.signal,
      pauseSignal: pauseController.signal,
      log: (msg: string) => {
        emit("migration:log", {
          email,
          message: msg,
          timestamp: new Date().toISOString(),
        });

        // parse batch progress from log lines like "Copying batch 3/7"
        const m = msg.match(/batch\s+(\d+)\/(\d+)/i);
        if (m) {
          batchDone = parseInt(m[1], 10);
          batchTotal = parseInt(m[2], 10);
        }
      },
      onProgress: (p: any) => {
        emit("migration:progress", {
          email,
          phase: p.phase ?? "scanning",
          batchDone,
          batchTotal,
          copied: p.copied ?? 0,
          checked: p.checked ?? 0,
          unresolved: p.unresolved ?? 0,
          elapsedMs: Date.now() - startedAt,
        } satisfies MigrationProgress);
      },
    });

    active.delete(email);

    const status = (result.status as string).toLowerCase().replace("_", "_") as any;
    const isPassed = result.status === "PASS";

    emit("migration:done", {
      email,
      status: isPassed ? "pass" : status,
      durationMs: result.durationMs,
      counts: result.counts ?? [],
      requiresPasswordCleanup: isPassed,
    } satisfies MigrationDone);
  });

  await Promise.allSettled(runners);
}

export function pauseAccount(email: string): void {
  active.get(email)?.pauseController.abort();
}

export function resumeAccount(email: string, options: MigrationStartOptions, emit: Emitter): void {
  // Resume reuses startMigration — checkpoint is loaded automatically by processAccount
  startMigration([email], { ...options, force: false }, emit);
}

export function stopAccount(email: string): void {
  active.get(email)?.stopController.abort();
}

export async function restartAccount(
  email: string,
  options: MigrationStartOptions,
  emit: Emitter,
): Promise<void> {
  stopAccount(email);
  // Brief pause to let the running task finish abort handling
  await Bun.sleep(200);
  startMigration([email], { ...options, force: true }, emit);
}
