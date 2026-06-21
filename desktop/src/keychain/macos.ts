import { $ } from "bun";

const BIN = "/usr/bin/security";

export async function set(service: string, account: string, password: string): Promise<void> {
  await $`${BIN} add-generic-password -U -a ${account} -s ${service} -w ${password}`.quiet();
}

export async function get(service: string, account: string): Promise<string> {
  const result = await $`${BIN} find-generic-password -a ${account} -s ${service} -w`.quiet();
  return result.stdout.toString().trim();
}

export async function del(service: string, account: string): Promise<void> {
  await $`${BIN} delete-generic-password -a ${account} -s ${service}`.quiet().nothrow();
}
