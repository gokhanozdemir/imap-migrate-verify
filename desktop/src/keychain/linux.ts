import { $ } from "bun";

export async function set(service: string, account: string, password: string): Promise<void> {
  const label = `imap-migrate: ${service}/${account}`;
  const proc = Bun.spawn(
    ["secret-tool", "store", "--label", label, "service", service, "account", account],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  proc.stdin.write(password);
  proc.stdin.end();
  await proc.exited;
}

export async function get(service: string, account: string): Promise<string> {
  const result = await $`secret-tool lookup service ${service} account ${account}`.quiet();
  return result.stdout.toString().trim();
}

export async function del(service: string, account: string): Promise<void> {
  await $`secret-tool clear service ${service} account ${account}`.quiet().nothrow();
}
