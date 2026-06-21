import type { MigrationStatus } from "../../src/types.ts";

interface Props {
  pct: number;          // 0–100
  status: MigrationStatus;
  label?: string;
}

export function ProgressBar({ pct, status, label }: Props) {
  const cls =
    status === "pass"
      ? "done"
      : status === "paused_user" || status === "paused_quota"
        ? "paused"
        : "";

  return (
    <div style="display:flex;align-items:center;gap:8px;">
      <div class="progress-wrap" style="flex:1;">
        <div
          class={`progress-fill ${cls}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      {label && <span class="text-dim" style="font-size:10px;white-space:nowrap;">{label}</span>}
    </div>
  );
}
