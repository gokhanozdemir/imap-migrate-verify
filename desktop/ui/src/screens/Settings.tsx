import { useState, useEffect } from "preact/hooks";
import { call } from "../bridge.ts";
import type { AppSettings, ServerConfig } from "../../src/types.ts";

function ServerForm({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ServerConfig;
  onChange: (v: ServerConfig) => void;
}) {
  const set = (k: keyof ServerConfig, v: any) => onChange({ ...value, [k]: v });
  return (
    <div class="panel">
      <div class="panel-header">{label} SERVER</div>
      <div class="panel-body">
        <div class="field-row">
          <div class="field" style="flex:3;">
            <label>HOST</label>
            <input
              value={value.host}
              onInput={(e) => set("host", (e.target as HTMLInputElement).value)}
              placeholder="imap.example.com"
            />
          </div>
          <div class="field" style="flex:1;">
            <label>PORT</label>
            <input
              type="number"
              value={value.port}
              onInput={(e) => set("port", parseInt((e.target as HTMLInputElement).value, 10))}
            />
          </div>
          <div class="field" style="flex:1;">
            <label>TLS</label>
            <select
              value={value.secure ? "true" : "false"}
              onChange={(e) => set("secure", (e.target as HTMLSelectElement).value === "true")}
            >
              <option value="true">TLS (993)</option>
              <option value="false">STARTTLS / plain</option>
            </select>
          </div>
        </div>
        <div class="field" style="max-width:240px;">
          <label>AUTH MECHANISM (optional)</label>
          <input
            value={value.authMechanism ?? ""}
            onInput={(e) =>
              set("authMechanism", (e.target as HTMLInputElement).value || undefined)
            }
            placeholder="PLAIN, LOGIN, …"
          />
        </div>
      </div>
    </div>
  );
}

export function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<AppSettings>("settings.get").then(setSettings);
  }, []);

  async function handleSave() {
    if (!settings) return;
    setBusy(true);
    try {
      await call("settings.save", settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setSettings((s) => s ? { ...s, [k]: v } : s);

  if (!settings) return <div class="screen text-dim">LOADING…</div>;

  return (
    <div class="screen">
      <div class="section-title">▸ SETTINGS</div>

      <div class="grid-2" style="margin-bottom:16px;">
        <ServerForm
          label="SOURCE"
          value={settings.source}
          onChange={(v) => set("source", v)}
        />
        <ServerForm
          label="DESTINATION"
          value={settings.destination}
          onChange={(v) => set("destination", v)}
        />
      </div>

      <div class="panel">
        <div class="panel-header">MIGRATION PARAMETERS</div>
        <div class="panel-body">
          <div class="field-row">
            <div class="field">
              <label>CONCURRENCY (parallel accounts)</label>
              <input
                type="number"
                min={1}
                max={10}
                value={settings.concurrency}
                onInput={(e) => set("concurrency", parseInt((e.target as HTMLInputElement).value, 10))}
              />
            </div>
            <div class="field">
              <label>AUDIT PERIOD — DAYS (blank = all time)</label>
              <input
                type="number"
                min={1}
                value={settings.days ?? ""}
                placeholder="all time"
                onInput={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  set("days", v ? parseInt(v, 10) : null);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">PATHS</div>
        <div class="panel-body">
          <div class="field">
            <label>REPORT DIRECTORY</label>
            <input
              value={settings.reportDir}
              onInput={(e) => set("reportDir", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label>IMAPSYNC BINARY PATH</label>
            <input
              value={settings.imapsyncPath}
              onInput={(e) => set("imapsyncPath", (e.target as HTMLInputElement).value)}
              placeholder="imapsync"
            />
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px;align-items:center;">
        <button class="btn btn-primary" disabled={busy} onClick={handleSave}>
          {busy ? "SAVING…" : "SAVE SETTINGS"}
        </button>
        {saved && <span class="text-green" style="font-size:11px;">✓ SAVED</span>}
      </div>
    </div>
  );
}
