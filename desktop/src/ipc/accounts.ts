import { join } from "node:path";
import { homedir } from "node:os";
import type { AccountMeta } from "../types.ts";
import { deletePasswords, storePassword } from "../keychain/index.ts";

const CONFIG_DIR = join(homedir(), ".config", "imap-migrate");
const ACCOUNTS_PATH = join(CONFIG_DIR, "accounts.json");

async function load(): Promise<AccountMeta[]> {
  try {
    const text = await Bun.file(ACCOUNTS_PATH).text();
    return JSON.parse(text);
  } catch {
    return [];
  }
}

async function save(accounts: AccountMeta[]): Promise<void> {
  await Bun.write(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

export async function listAccounts(): Promise<AccountMeta[]> {
  return load();
}

export async function addAccount(email: string): Promise<void> {
  const accounts = await load();
  if (accounts.some((a) => a.email === email)) return;
  accounts.push({ email, addedAt: new Date().toISOString() });
  await save(accounts);
}

export async function removeAccount(email: string): Promise<void> {
  const accounts = await load();
  await save(accounts.filter((a) => a.email !== email));
  await deletePasswords(email).catch(() => {});
}

export async function setPassword(
  email: string,
  type: "source" | "dest",
  password: string,
): Promise<void> {
  await storePassword(email, type, password);
}

export { deletePasswords };
