import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TRANSIENT_EXIT_CODES = new Set([101, 102]);
const AUTH_EXIT_CODES = new Set([161, 162]);
const OVER_QUOTA_EXIT_CODE = 113;
const OVER_QUOTA_PATTERN = /OVERQUOTA|mailbox is full|quota limit (?:will be|has been) exceeded|not enough (?:disk )?quota/iu;

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
    ...(sourceServer.secure ? ["--ssl1"] : []),
    "--user1", account.email,
    "--passfile1", passfile1,
    "--host2", destinationServer.host,
    "--port2", String(destinationServer.port),
    ...(destinationServer.secure ? ["--ssl2"] : []),
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
  await writeFile(source, `${account.sourcePassword ?? account.yandexPassword}\n`, { mode: 0o600 });
  await writeFile(destination, `${account.destinationPassword ?? account.guzelPassword}\n`, { mode: 0o600 });
  return { directory, source, destination };
}

export function formatUidSet(uids) {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = start;
  for (const uid of sorted.slice(1)) {
    if (uid === end + 1) {
      end = uid;
      continue;
    }
    ranges.push(start === end ? String(start) : `${start}:${end}`);
    start = uid;
    end = uid;
  }
  if (start !== undefined) ranges.push(start === end ? String(start) : `${start}:${end}`);
  return ranges.join(",");
}

export function classifyImapsyncFailure(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.code === OVER_QUOTA_EXIT_CODE || OVER_QUOTA_PATTERN.test(output)) {
    return {
      code: "quota_exceeded",
      kind: "quota",
      retryable: false,
      message: "destination mailbox is full; free space on the destination and rerun the same command",
      output,
    };
  }
  const authentication = AUTH_EXIT_CODES.has(result.code);
  return {
    code: authentication ? "authentication_failed" : "migration_failed",
    kind: authentication ? "authentication" : "migration",
    retryable: TRANSIENT_EXIT_CODES.has(result.code),
    message: `imapsync ${authentication ? "authentication" : "migration"} failure (exit ${result.code})`,
    output,
  };
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
      args.push("--folder", options.folder, "--search1", `UID ${formatUidSet(options.uids)}`);
    }

    let result = await runProcess("imapsync", args, { signal: options.signal });
    if (TRANSIENT_EXIT_CODES.has(result.code)) {
      options.onRetry?.(result);
      result = await runProcess("imapsync", args, { signal: options.signal });
    }
    if (result.code !== 0) {
      const failure = classifyImapsyncFailure(result);
      const error = new Error(failure.message);
      error.exitCode = result.code;
      error.code = failure.code;
      error.kind = failure.kind;
      error.retryable = failure.retryable;
      error.output = failure.output;
      throw error;
    }
    return result;
  } finally {
    await rm(passwords.directory, { recursive: true, force: true });
  }
}
