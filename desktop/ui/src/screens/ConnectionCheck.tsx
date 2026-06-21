import { useState, useEffect } from "preact/hooks";
import { call } from "../bridge.ts";
import type { AccountMeta, ConnectionStatus } from "../../src/types.ts";
import { ConnectionBadge } from "../components/StatusBadge.tsx";

type SideResults = Record<string, ConnectionStatus>;

export function ConnectionCheck() {
  const [accounts, setAccounts] = useState<AccountMeta[]>([]);
  const [srcStatus, setSrcStatus] = useState<SideResults>({});
  const [dstStatus, setDstStatus] = useState<SideResults>({});
  const [testing, setTesting] = useState<Set<string>>(new Set());

  useEffect(() => {
    call<AccountMeta[]>("accounts.list").then(setAccounts);
  }, []);

  async function testOne(email: string, type: "source" | "dest") {
    const key = `${email}:${type}`;
    setTesting((s) => new Set(s).add(key));
    try {
      const result = await call<{ status: ConnectionStatus }>("connection.test", email, type);
      if (type === "source") {
        setSrcStatus((s) => ({ ...s, [email]: result.status }));
      } else {
        setDstStatus((s) => ({ ...s, [email]: result.status }));
      }
    } finally {
      setTesting((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  }

  async function testAll(type: "source" | "dest") {
    await Promise.all(accounts.map((a) => testOne(a.email, type)));
  }

  async function testAllBoth() {
    await Promise.all(accounts.flatMap((a) => [testOne(a.email, "source"), testOne(a.email, "dest")]));
  }

  return (
    <div class="screen">
      <div class="section-title">▸ CONNECTION CHECK</div>

      <div class="toolbar">
        <button class="btn btn-primary" onClick={testAllBoth}>TEST ALL</button>
        <div class="toolbar-sep" />
        <button class="btn" onClick={() => testAll("source")}>SOURCE ONLY</button>
        <button class="btn" onClick={() => testAll("dest")}>DEST ONLY</button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>EMAIL</th>
            <th>SOURCE</th>
            <th></th>
            <th>DESTINATION</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {accounts.length === 0 && (
            <tr>
              <td colSpan={5} class="text-dim" style="padding:20px;text-align:center;">
                NO ACCOUNTS — ADD THEM ON THE ACCOUNTS SCREEN
              </td>
            </tr>
          )}
          {accounts.map((a) => {
            const srcBusy = testing.has(`${a.email}:source`);
            const dstBusy = testing.has(`${a.email}:dest`);
            return (
              <tr key={a.email}>
                <td><strong>{a.email}</strong></td>
                <td>
                  <ConnectionBadge status={srcStatus[a.email] ?? "not_checked"} />
                </td>
                <td>
                  <button
                    class="btn"
                    style="font-size:10px;padding:3px 10px;"
                    disabled={srcBusy}
                    onClick={() => testOne(a.email, "source")}
                  >
                    {srcBusy ? "TESTING…" : "TEST"}
                  </button>
                </td>
                <td>
                  <ConnectionBadge status={dstStatus[a.email] ?? "not_checked"} />
                </td>
                <td>
                  <button
                    class="btn"
                    style="font-size:10px;padding:3px 10px;"
                    disabled={dstBusy}
                    onClick={() => testOne(a.email, "dest")}
                  >
                    {dstBusy ? "TESTING…" : "TEST"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div class="panel" style="margin-top:20px;">
        <div class="panel-header">STATUS LEGEND</div>
        <div class="panel-body" style="display:flex;gap:24px;flex-wrap:wrap;">
          {(["connected","auth_failed","network_error","not_checked"] as ConnectionStatus[]).map((s) => (
            <div key={s} style="display:flex;align-items:center;gap:8px;">
              <ConnectionBadge status={s} />
              <span class="text-dim" style="font-size:11px;">
                {s === "connected"     && "IMAP handshake OK"}
                {s === "auth_failed"   && "Bad credentials"}
                {s === "network_error" && "Host unreachable / TLS error"}
                {s === "not_checked"   && "Not yet tested"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
