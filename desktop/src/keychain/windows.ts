import { $ } from "bun";

function target(service: string, account: string): string {
  return `${service}/${account}`;
}

export async function set(service: string, account: string, password: string): Promise<void> {
  const t = target(service, account);
  await $`cmdkey /generic:${t} /user:${account} /pass:${password}`.quiet();
}

export async function get(service: string, account: string): Promise<string> {
  const t = target(service, account);
  const script = `(Get-StoredCredential -Target '${t}').GetNetworkCredential().Password`;
  const result = await $`powershell -NoProfile -Command ${script}`.quiet();
  return result.stdout.toString().trim();
}

export async function del(service: string, account: string): Promise<void> {
  const t = target(service, account);
  await $`cmdkey /delete:${t}`.quiet().nothrow();
}
