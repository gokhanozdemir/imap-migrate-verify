import { useState, useEffect } from "preact/hooks";
import { call } from "../bridge.ts";
import type { AccountMeta, MigrationStatus } from "../../src/types.ts";
import { MigrationBadge } from "../components/StatusBadge.tsx";
import { ProgressBar } from "../components/ProgressBar.tsx";

interface Props {
  migrationState: Record<string, { status: MigrationStatus; pct: number }>;
  onNavigateDashboard: (email: string) => void;
}

export function Accounts({ migrationState, onNavigateDashboard }: Props) {
  const [accounts, setAccounts] = useState<AccountMeta[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [pwModal, setPwModal] = useState<{ email: string; type: "source" | "dest" } | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    setAccounts(await call<AccountMeta[]>("accounts.list"));
  }

  useEffect(() => { reload(); }, []);

  async function handleAdd() {
    const email = newEmail.trim();
    if (!email || !email.includes("@")) return;
    await call("accounts.add", email);
    setNewEmail("");
    reload();
  }

  async function handleRemove(email: string) {
    if (!confirm(`Remove ${email} and delete stored passwords?`)) return;
    await call("accounts.remove", email);
    reload();
  }

  async function handleSetPassword() {
    if (!pwModal || !pwValue) return;
    setBusy(true);
    try {
      await call("accounts.setPassword", pwModal.email, pwModal.type, pwValue);
    } finally {
      setBusy(false);
      setPwModal(null);
      setPwValue("");
    }
  }

  return (
    <div class="screen">
      <div class="section-title">▸ ACCOUNTS</div>

      <div class="toolbar">
        <input
          class="field input"
          style="width:280px;padding:5px 8px;border:1px solid #444;background:#111;color:#ddd;font-family:monospace;font-size:12px;"
          placeholder="user@domain.com"
          value={newEmail}
          onInput={(e) => setNewEmail((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <button class="btn btn-primary" onClick={handleAdd}>+ ADD</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>EMAIL</th>
            <th>SOURCE PW</th>
            <th>DEST PW</th>
            <th>MIGRATION</th>
            <th>PROGRESS</th>
            <th>ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {accounts.length === 0 && (
            <tr>
              <td colSpan={6} class="text-dim" style="padding:20px;text-align:center;">
                NO ACCOUNTS CONFIGURED
              </td>
            </tr>
          )}
          {accounts.map((a) => {
            const ms = migrationState[a.email] ?? { status: "idle" as MigrationStatus, pct: 0 };
            return (
              <tr key={a.email}>
                <td><strong>{a.email}</strong></td>
                <td>
                  <button
                    class="btn"
                    style="font-size:10px;padding:3px 10px;"
                    onClick={() => setPwModal({ email: a.email, type: "source" })}
                  >
                    SET ●●●
                  </button>
                </td>
                <td>
                  <button
                    class="btn"
                    style="font-size:10px;padding:3px 10px;"
                    onClick={() => setPwModal({ email: a.email, type: "dest" })}
                  >
                    SET ●●●
                  </button>
                </td>
                <td><MigrationBadge status={ms.status} /></td>
                <td style="min-width:120px;">
                  <ProgressBar pct={ms.pct} status={ms.status} label={`${ms.pct}%`} />
                </td>
                <td>
                  <div style="display:flex;gap:6px;">
                    <button
                      class="btn"
                      style="font-size:10px;padding:3px 8px;"
                      onClick={() => onNavigateDashboard(a.email)}
                    >
                      MONITOR
                    </button>
                    <button
                      class="btn btn-danger"
                      style="font-size:10px;padding:3px 8px;"
                      onClick={() => handleRemove(a.email)}
                    >
                      DEL
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {pwModal && (
        <div class="modal-overlay" onClick={() => { setPwModal(null); setPwValue(""); }}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              SET {pwModal.type.toUpperCase()} PASSWORD — {pwModal.email}
            </div>
            <div class="modal-body">
              <p class="text-dim" style="font-size:11px;margin-bottom:12px;">
                Password will be stored in your OS keychain — not on disk.
              </p>
              <div class="field">
                <label>PASSWORD</label>
                <input
                  type="password"
                  value={pwValue}
                  onInput={(e) => setPwValue((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSetPassword()}
                  autofocus
                />
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn" onClick={() => { setPwModal(null); setPwValue(""); }}>CANCEL</button>
              <button class="btn btn-primary" disabled={busy || !pwValue} onClick={handleSetPassword}>
                {busy ? "STORING…" : "STORE IN KEYCHAIN"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
