import * as macos from "./macos.ts";
import * as linux from "./linux.ts";
import * as windows from "./windows.ts";

const SOURCE_SERVICE = "imap-migrate-source";
const DEST_SERVICE = "imap-migrate-dest";

type Backend = typeof macos;

function backend(): Backend {
  switch (process.platform) {
    case "darwin": return macos;
    case "linux":  return linux;
    case "win32":  return windows;
    default: throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

export type PasswordType = "source" | "dest";

function service(type: PasswordType): string {
  return type === "source" ? SOURCE_SERVICE : DEST_SERVICE;
}

export async function storePassword(email: string, type: PasswordType, password: string): Promise<void> {
  await backend().set(service(type), email, password);
}

export async function getPassword(email: string, type: PasswordType): Promise<string> {
  return backend().get(service(type), email);
}

export async function deletePasswords(email: string): Promise<void> {
  const b = backend();
  await Promise.all([
    b.del(SOURCE_SERVICE, email),
    b.del(DEST_SERVICE, email),
  ]);
}
