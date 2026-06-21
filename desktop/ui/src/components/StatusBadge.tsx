import type { ConnectionStatus, MigrationStatus } from "../../src/types.ts";

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connected:     "CONNECTED",
  auth_failed:   "AUTH FAILED",
  network_error: "NET ERROR",
  not_checked:   "NOT CHECKED",
};

const CONNECTION_CLASS: Record<ConnectionStatus, string> = {
  connected:     "badge-connected",
  auth_failed:   "badge-auth",
  network_error: "badge-network",
  not_checked:   "badge-idle",
};

const MIGRATION_LABELS: Record<MigrationStatus, string> = {
  idle:          "IDLE",
  running:       "RUNNING",
  paused_user:   "PAUSED",
  paused_quota:  "QUOTA",
  pass:          "PASS",
  failed:        "FAIL",
  skipped:       "SKIPPED",
};

const MIGRATION_CLASS: Record<MigrationStatus, string> = {
  idle:          "badge-idle",
  running:       "badge-running",
  paused_user:   "badge-paused",
  paused_quota:  "badge-paused",
  pass:          "badge-pass",
  failed:        "badge-fail",
  skipped:       "badge-idle",
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span class={`badge ${CONNECTION_CLASS[status]}`}>
      {CONNECTION_LABELS[status]}
    </span>
  );
}

export function MigrationBadge({ status }: { status: MigrationStatus }) {
  return (
    <span class={`badge ${MIGRATION_CLASS[status]}`}>
      {MIGRATION_LABELS[status]}
    </span>
  );
}
