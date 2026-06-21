import type { ConnectionResult } from "../types.ts";
import { getPassword } from "../keychain/index.ts";
import { getSettings } from "./settings.ts";

// Dynamically import from the CLI src — Bun resolves ESM natively
const { testConnection: testImapConnection } = await import(
  "../../../src/imap.js"
);

export async function testConnection(
  email: string,
  type: "source" | "dest",
): Promise<ConnectionResult> {
  const settings = await getSettings();
  const server = type === "source" ? settings.source : settings.destination;

  let password: string;
  try {
    password = await getPassword(email, type);
  } catch {
    return { status: "auth_failed", detail: "Password not found in keychain" };
  }

  try {
    return await testImapConnection(server, email, password);
  } catch (err: any) {
    return { status: "network_error", detail: err?.message ?? String(err) };
  }
}
