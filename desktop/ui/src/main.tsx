import { render } from "preact";
import { useState } from "preact/hooks";
import type { MigrationStatus } from "../src/types.ts";
import { Accounts } from "./screens/Accounts.tsx";
import { ConnectionCheck } from "./screens/ConnectionCheck.tsx";
import { MigrationDashboard } from "./screens/MigrationDashboard.tsx";
import { Settings } from "./screens/Settings.tsx";
import { Results } from "./screens/Results.tsx";

type Tab = "accounts" | "connection" | "dashboard" | "settings" | "results";

const TABS: { id: Tab; label: string }[] = [
  { id: "accounts",   label: "ACCOUNTS" },
  { id: "connection", label: "CONNECTION CHECK" },
  { id: "dashboard",  label: "MIGRATION" },
  { id: "settings",   label: "SETTINGS" },
  { id: "results",    label: "RESULTS" },
];

function App() {
  const [tab, setTab] = useState<Tab>("accounts");
  const [dashFocus, setDashFocus] = useState<string | undefined>();
  const [migrationState, setMigrationState] = useState<
    Record<string, { status: MigrationStatus; pct: number }>
  >({});

  function navigateDashboard(email: string) {
    setDashFocus(email);
    setTab("dashboard");
  }

  return (
    <div id="app">
      <header class="app-header">
        <span class="wordmark">IMAP MIGRATION CONTROL</span>
        <span class="text-dim" style="font-size:10px;">v2 · DESKTOP EDITION</span>
      </header>

      <nav class="app-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            class={`nav-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => {
              if (t.id !== "dashboard") setDashFocus(undefined);
              setTab(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "accounts" && (
        <Accounts
          migrationState={migrationState}
          onNavigateDashboard={navigateDashboard}
        />
      )}
      {tab === "connection" && <ConnectionCheck />}
      {tab === "dashboard" && (
        <MigrationDashboard
          focusEmail={dashFocus}
          onMigrationStateChange={setMigrationState}
        />
      )}
      {tab === "settings" && <Settings />}
      {tab === "results" && <Results />}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
