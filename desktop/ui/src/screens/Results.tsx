import { useState, useEffect } from "preact/hooks";
import { call } from "../bridge.ts";
import type { HistoryRecord } from "../../src/types.ts";

function fmtDate(iso: string) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function Results() {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setBusy(true);
    try {
      setHistory(await call<HistoryRecord[]>("history.list"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { reload(); }, []);

  return (
    <div class="screen">
      <div class="section-title">▸ RESULTS / HISTORY</div>

      <div class="toolbar">
        <button class="btn" onClick={reload} disabled={busy}>
          {busy ? "LOADING…" : "↺ REFRESH"}
        </button>
        <button class="btn" onClick={() => call("history.openDir")}>
          OPEN REPORT DIR ↗
        </button>
      </div>

      {history.length === 0 && !busy && (
        <div class="text-dim" style="padding:20px;text-align:center;">
          NO COMPLETED RUNS YET
        </div>
      )}

      {history.map((rec) => (
        <div key={rec.path} class="panel" style="margin-bottom:12px;">
          <div
            class="panel-header"
            style="cursor:pointer;"
            onClick={() => setExpanded(expanded === rec.path ? null : rec.path)}
          >
            <span>
              <span class={`badge ${rec.success ? "badge-pass" : "badge-fail"}`} style="margin-right:8px;">
                {rec.success ? "PASS" : "FAIL"}
              </span>
              {rec.dryRun && <span class="badge badge-idle" style="margin-right:8px;">DRY-RUN</span>}
              {fmtDate(rec.startedAt)}
            </span>
            <span class="text-dim" style="font-size:10px;">
              {rec.accounts.length} ACCOUNT{rec.accounts.length !== 1 ? "S" : ""}
              {" "}— {expanded === rec.path ? "▲ COLLAPSE" : "▼ EXPAND"}
            </span>
          </div>

          {expanded === rec.path && (
            <div class="panel-body" style="padding:0;">
              <table class="data-table" style="margin:0;">
                <thead>
                  <tr>
                    <th>EMAIL</th>
                    <th>STATUS</th>
                    <th>COPIED</th>
                    <th>UNRESOLVED</th>
                    <th>DURATION</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.accounts.map((a) => (
                    <tr key={a.email}>
                      <td><strong>{a.email}</strong></td>
                      <td>
                        <span
                          class={`badge ${
                            a.status === "PASS" ? "badge-pass"
                            : a.status.startsWith("PAUSED") ? "badge-paused"
                            : "badge-fail"
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td class="text-green">{a.copied}</td>
                      <td class={a.unresolved > 0 ? "text-red" : "text-dim"}>{a.unresolved}</td>
                      <td class="text-dim">{fmtDuration(a.durationMs)}</td>
                      <td>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                          {(a.status === "PAUSED_QUOTA" || a.status === "PAUSED_USER") && (
                            <button
                              class="btn btn-amber"
                              style="font-size:10px;padding:2px 8px;"
                              onClick={() => call("migration.resume", a.email, { days: null, concurrency: 3, force: false, yes: true, dryRun: false })}
                            >
                              RESUME
                            </button>
                          )}
                          {a.status === "PASS" && (
                            <button
                              class="btn"
                              style="font-size:10px;padding:2px 8px;"
                              onClick={() => call("migration.start", [a.email], { days: null, concurrency: 1, force: true, yes: true, dryRun: false })}
                            >
                              REVERIFY
                            </button>
                          )}
                          {a.status !== "PASS" && (
                            <button
                              class="btn btn-danger"
                              style="font-size:10px;padding:2px 8px;"
                              onClick={() => call("migration.restart", a.email, { days: null, concurrency: 1, force: true, yes: true, dryRun: false })}
                            >
                              RESTART
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style="padding:8px 12px;border-top:1px solid var(--border);">
                <span class="text-dim" style="font-size:10px;">
                  REPORT: <code style="color:#aaa;">{rec.path}</code>
                </span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
