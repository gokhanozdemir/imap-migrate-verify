export interface AccountMeta {
  email: string;
  addedAt: string;
}

export interface AppSettings {
  source: ServerConfig;
  destination: ServerConfig;
  concurrency: number;
  days: number | null;
  reportDir: string;
  imapsyncPath: string;
}

export interface ServerConfig {
  host: string;
  port: number;
  secure: boolean;
  authMechanism?: string;
}

export type ConnectionStatus = "connected" | "auth_failed" | "network_error" | "not_checked";

export interface ConnectionResult {
  status: ConnectionStatus;
  detail?: string;
}

export type MigrationStatus =
  | "idle"
  | "running"
  | "paused_user"
  | "paused_quota"
  | "pass"
  | "failed"
  | "skipped";

export interface MigrationProgress {
  email: string;
  phase: string;
  batchDone: number;
  batchTotal: number;
  copied: number;
  checked: number;
  unresolved: number;
  elapsedMs: number;
}

export interface MigrationDone {
  email: string;
  status: MigrationStatus;
  durationMs: number;
  counts: FolderCount[];
  requiresPasswordCleanup: boolean;
}

export interface FolderCount {
  folder: string;
  source: number;
  destinationBefore: number;
  destinationAfter: number;
}

export interface HistoryRecord {
  path: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  dryRun: boolean;
  accounts: HistoryAccountSummary[];
}

export interface HistoryAccountSummary {
  email: string;
  status: string;
  copied: number;
  unresolved: number;
  durationMs: number;
}

export interface LogLine {
  email: string;
  message: string;
  timestamp: string;
}

// RPC method map — must stay in sync with bridge.ts on the UI side
export interface IpcMethods {
  // accounts
  "accounts.list": { args: []; result: AccountMeta[] };
  "accounts.add": { args: [email: string]; result: void };
  "accounts.remove": { args: [email: string]; result: void };
  "accounts.setPassword": { args: [email: string, type: "source" | "dest", password: string]; result: void };
  "accounts.deletePasswords": { args: [email: string]; result: void };

  // connection
  "connection.test": {
    args: [email: string, type: "source" | "dest"];
    result: ConnectionResult;
  };

  // migration
  "migration.start": { args: [emails: string[], options: MigrationStartOptions]; result: void };
  "migration.pause": { args: [email: string]; result: void };
  "migration.resume": { args: [email: string]; result: void };
  "migration.stop": { args: [email: string]; result: void };
  "migration.restart": { args: [email: string]; result: void };

  // settings
  "settings.get": { args: []; result: AppSettings };
  "settings.save": { args: [settings: AppSettings]; result: void };

  // history
  "history.list": { args: []; result: HistoryRecord[] };
  "history.getReport": { args: [path: string]; result: unknown };
  "history.openDir": { args: []; result: void };
}

export interface MigrationStartOptions {
  dryRun: boolean;
  days: number | null;
  concurrency: number;
  force: boolean;
  yes: boolean;
}
