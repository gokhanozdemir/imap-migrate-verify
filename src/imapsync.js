import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TRANSIENT_EXIT_CODES = new Set([101, 102]);
const AUTH_EXIT_CODES = new Set([161, 162]);

function runProcess(command, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { signal, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, processSignal) => resolve({ code, signal: processSignal, stdout, stderr }));
  });
}

export async function checkImapsync() {
  try {
    const result = await runProcess("imapsync", ["--version"]);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout);
    return result.stdout.trim() || result.stderr.trim();
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("imapsync is not installed. Install it with: brew install imapsync");
    }
    throw error;
  }
}

function baseArguments({ account, sourceServer, destinationServer, passfile1, passfile2, dryRun }) {
  const args = [
    "--host1", sourceServer.host,
    "--port1", String(sourceServer.port),
    "--ssl1",
    "--user1", account.email,
    "--passfile1", passfile1,
    "--host2", destinationServer.host,
    "--port2", String(destinationServer.port),
    "--ssl2",
    "--user2", account.email,
    "--passfile2", passfile2,
    "--automap",
    "--syncinternaldates",
    "--noexpunge1",
    "--nofoldersizes",
    "--nolog",
    "--errorsmax", "20",
    "--timeout1", "120",
    "--timeout2", "120",
  ];
  if (sourceServer.authMechanism) args.push("--authmech1", sourceServer.authMechanism);
  if (destinationServer.authMechanism) args.push("--authmech2", destinationServer.authMechanism);
  if (dryRun) args.push("--dry");
  return args;
}

async function createPasswordFiles(account) {
  const directory = await mkdtemp(join(tmpdir(), "imap-migrate-"));
  await chmod(directory, 0o700);
  const source = join(directory, "source.pass");
  const destination = join(directory, "destination.pass");
  await writeFile(source, `${account.yandexPassword}\n`, { mode: 0o600 });
  await writeFile(destination, `${account.guzelPassword}\n`, { mode: 0o600 });
  return { directory, source, destination };
}

function uidSet(uids) {
  return [...new Set(uids)].sort((a, b) => a - b).join(",");
}

export async function runImapsync(options) {
  const passwords = await createPasswordFiles(options.account);
  try {
    const args = baseArguments({
      ...options,
      passfile1: passwords.source,
      passfile2: passwords.destination,
    });
    if (options.folder && options.uids?.length) {
      args.push("--folder", options.folder, "--search1", `UID ${uidSet(options.uids)}`);
    }

    let result = await runProcess("imapsync", args, { signal: options.signal });
    if (TRANSIENT_EXIT_CODES.has(result.code)) {
      options.onRetry?.(result);
      result = await runProcess("imapsync", args, { signal: options.signal });
    }
    if (result.code !== 0) {
      const kind = AUTH_EXIT_CODES.has(result.code) ? "authentication" : "migration";
      const error = new Error(`imapsync ${kind} failure (exit ${result.code})`);
      error.exitCode = result.code;
      error.kind = kind;
      error.output = `${result.stdout}\n${result.stderr}`.trim();
      throw error;
    }
    return result;
  } finally {
    await rm(passwords.directory, { recursive: true, force: true });
  }
}
