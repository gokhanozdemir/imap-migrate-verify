import { useState, useEffect, useCallback } from "preact/hooks";
import { call, on } from "../bridge.ts";
import type { AccountMeta, MigrationProgress, MigrationDone, MigrationStatus } from "../../src/types.ts";
import { MigrationBadge } from "../components/StatusBadge.tsx";
import { ProgressBar } from "../components/ProgressBar.tsx";
import { LogPanel } from "../components/LogPanel.tsx";

interface AccountState {
  status: MigrationStatus;
  phase: string;
  batchDone: number;
  batchTotal: number;
  copied: number;
  checked: number;
  unresolved: number;
  elapsedMs: number;
  logs: { timestamp: string; message: string }[];
  expanded: boolean;
  requiresPasswordCleanup?: boolean;
}

interface Props {
  focusEmail?: string;
  onMigrationStateChange: (state: Record<string, { status: MigrationStatus; pct: number }>) => void;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function MigrationDashboard({ focusEmail, onMigrationStateChange }: Props) {
  const [accounts, setAccounts] = useState<AccountMeta[]>([]);
  const [state, setState] = useState<Record<string, AccountState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pwCleanupEmail, setPwCleanupEmail] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);

  useEffect(() => {
    call<AccountMeta[]>("accounts.list").then((list) => {
      setAccounts(list);
      if (focusEmail) setSelected(new Set([focusEmail]));
    });
  }, [focusEmail]);

  // Sync migration state up to parent (for Accounts screen badges)
  useEffect(() => {
    const summary: Record<string, { status: MigrationStatus; pct: number }> = {};
    for (const [email, s] of Object.entries(state)) {
      const pct = s.batchTotal > 0 ? Math.round((s.batchDone / s.batchTotal) * 100) : 0;
      summary[email] = { status: s.status, pct };
    }
    onMigrationStateChange(summary);
  }, [state]);

  const updateAccount = useCallback((email: string, patch: Partial<AccountState>) => {
    setState((prev) => ({
      ...prev,
      [email]: { ...(prev[email] ?? defaultState()), ...patch },
    }));
  }, []);

  function defaultState(): AccountState {
    return {
      status: "idle",
      phase: "",
      batchDone: 0,
      batchTotal: 0,
      copied: 0,
      checked: 0,
      unresolved: 0,
      elapsedMs: 0,
      logs: [],
      expanded: false,
    };
  }

  useEffect(() => {
    const offs = [
      on("migration:progress", (p: any) => {
        updateAccount(p.email, {
          status: "running",
          phase: p.phase,
          batchDone: p.batchDone,
          batchTotal: p.batchTotal,
          copied: p.copied,
          checked: p.checked,
          unresolved: p.unresolved,
          elapsedMs: p.elapsedMs,
        });
      }),
      on("migration:log", (l: any) => {
        setState((prev) => {
          const cur = prev[l.email] ?? defaultState();
          return {
            ...prev,
            [l.email]: {
              ...cur,
              logs: [...cur.logs, { timestamp: l.timestamp, message: l.message }],
            },
          };
        });
      }),
      on("migration:done", (d: any) => {
        updateAccount(d.email, { status: d.status });
        if (d.requiresPasswordCleanup) setPwCleanupEmail(d.email);
      }),
      on("migration:paused", (d: any) => {
        updateAccount(d.email, {
          status: d.reason === "quota" ? "paused_quota" : "paused_user",
        });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [updateAccount]);

  const options = { dryRun, days: null, concurrency: 3, force: false, yes: true };

  function runningEmails() {
    return Object.entries(state)
      .filter(([, s]) => s.status === "running")
      .map(([e]) => e);
  }

  async function startSelected() {
    const emails = [...selected];
    if (emails.length === 0) return;
    for (const e of emails) updateAccount(e, { ...defaultState(), status: "running", logs: [] });
    await call("migration.start", emails, options);
  }

  async function pauseAll() {
    for (const e of runningEmails()) await call("migration.pause", e);
  }

  async function stopAll() {
    for (const e of runningEmails()) await call("migration.stop", e);
  }

  function toggleSelect(email: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(email) ? n.delete(email) : n.add(email);
      return n;
    });
  }

  function toggleAll() {
    if (selected.size === accounts.length) setSelected(new Set());
    else setSelected(new Set(accounts.map((a) => a.email)));
  }

  const anyRunning = runningEmails().length > 0;

  return (
    <div class="screen">
      <div class="section-title">▸ MIGRATION DASHBOARD</div>

      <div class="toolbar">
        <button
          class="btn btn-green"
          disabled={selected.size === 0 || anyRunning}
          onClick={startSelected}
        >
          ▶ START ({selected.size})
        </button>
        <button class="btn btn-amber" disabled={!anyRunning} onClick={pauseAll}>
          ⏸ PAUSE ALL
        </button>
        <button class="btn btn-danger" disabled={!anyRunning} onClick={stopAll}>
          ■ STOP ALL
        </button>
        <div class="toolbar-sep" />
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun((e.target as HTMLInputElement).checked)} />
          DRY-RUN
        </label>
      </div>

      {accounts.length === 0 ? (
        <div class="text-dim" style="padding:20px;text-align:center;">
          NO ACCOUNTS — ADD THEM FIRST
        </div>
      ) : (
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:30px;">
                <input
                  type="checkbox"
                  checked={selected.size === accounts.length && accounts.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <th>EMAIL</th>
              <th>STATUS</th>
              <th>PHASE</th>
              <th>BATCH</th>
              <th>COPIED</th>
              <th>UNRESOLVED</th>
              <th>ELAPSED</th>
              <th>PROGRESS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const s = state[a.email] ?? defaultState();
              const pct = s.batchTotal > 0 ? Math.round((s.batchDone / s.batchTotal) * 100) : 0;
              const isRunning = s.status === "running";
              const isPaused = s.status === "paused_user" || s.status === "paused_quota";

              return (
                <>
                  <tr key={a.email} class={selected.has(a.email) ? "selected" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(a.email)}
                        onChange={() => toggleSelect(a.email)}
                      />
                    </td>
                    <td>
                      <strong>{a.email}</strong>
                    </td>
                    <td><MigrationBadge status={s.status} /></td>
                    <td class="text-dim" style="font-size:11px;">{s.phase || "—"}</td>
                    <td class="text-dim" style="font-size:11px;">
                      {s.batchTotal > 0 ? `${s.batchDone}/${s.batchTotal}` : "—"}
                    </td>
                    <td class="text-green">{s.copied || "—"}</td>
                    <td class={s.unresolved > 0 ? "text-red" : "text-dim"}>{s.unresolved || "—"}</td>
                    <td class="text-dim" style="font-size:11px;">
                      {s.elapsedMs > 0 ? formatElapsed(s.elapsedMs) : "—"}
                    </td>
                    <td style="min-width:100px;">
                      <ProgressBar pct={pct} status={s.status} label={`${pct}%`} />
                    </td>
                    <td>
                      <div style="display:flex;gap:4px;flex-wrap:wrap;">
                        {!isRunning && !isPaused && (
                          <button
                            class="btn btn-green"
                            style="font-size:10px;padding:2px 8px;"
                            onClick={() => {
                              updateAccount(a.email, { ...defaultState(), status: "running", logs: [] });
                              call("migration.start", [a.email], options);
                            }}
                          >▶</button>
                        )}
                        {isRunning && (
                          <button
                            class="btn btn-amber"
                            style="font-size:10px;padding:2px 8px;"
                            onClick={() => call("migration.pause", a.email)}
                          >⏸</button>
                        )}
                        {isPaused && (
                          <button
                            class="btn btn-green"
                            style="font-size:10px;padding:2px 8px;"
                            onClick={() => {
                              updateAccount(a.email, { status: "running" });
                              call("migration.resume", a.email, options);
                            }}
                          >▶ RESUME</button>
                        )}
                        {(isRunning || isPaused) && (
                          <button
                            class="btn btn-danger"
                            style="font-size:10px;padding:2px 8px;"
                            onClick={() => call("migration.stop", a.email)}
                          >■</button>
                        )}
                        <button
                          class="expand-btn"
                          style="margin-left:4px;"
                          onClick={() =>
                            setState((prev) => ({
                              ...prev,
                              [a.email]: { ...(prev[a.email] ?? defaultState()), expanded: !s.expanded },
                            }))
                          }
                        >
                          {s.expanded ? "▲ HIDE LOG" : "▼ LOGS"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {s.expanded && (
                    <tr key={`${a.email}-log`}>
                      <td colSpan={10} style="padding:0;">
                        <LogPanel lines={s.logs} maxHeight="180px" />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      )}

      {pwCleanupEmail && (
        <div class="modal-overlay">
          <div class="modal">
            <div class="modal-header">MIGRATION COMPLETE — {pwCleanupEmail}</div>
            <div class="modal-body">
              <p style="margin-bottom:12px;">
                <strong class="text-green">PASS</strong> — all messages verified.
              </p>
              <p class="text-dim" style="font-size:11px;line-height:1.7;">
                The stored passwords for this account are no longer needed.
                Remove them from your OS keychain now?
                You can always re-add them later if you need to re-run.
              </p>
            </div>
            <div class="modal-footer">
              <button class="btn" onClick={() => setPwCleanupEmail(null)}>
                KEEP PASSWORDS
              </button>
              <button
                class="btn btn-danger"
                onClick={async () => {
                  await call("accounts.deletePasswords", pwCleanupEmail);
                  setPwCleanupEmail(null);
                }}
              >
                DELETE FROM KEYCHAIN
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
