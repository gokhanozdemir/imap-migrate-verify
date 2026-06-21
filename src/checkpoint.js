import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export const CHECKPOINT_VERSION = 1;

function hasValidShape(checkpoint) {
  return checkpoint
    && checkpoint.version === CHECKPOINT_VERSION
    && checkpoint.identity
    && checkpoint.sourceInventory
    && Array.isArray(checkpoint.sourceInventory.counts)
    && Array.isArray(checkpoint.sourceInventory.messages)
    && checkpoint.destinationBefore
    && Array.isArray(checkpoint.destinationBefore.counts)
    && Array.isArray(checkpoint.destinationBefore.messages)
    && Array.isArray(checkpoint.pendingBatches)
    && checkpoint.auditWindow
    && (checkpoint.auditWindow.sourceSince === null
      || typeof checkpoint.auditWindow.sourceSince === "string")
    && (checkpoint.auditWindow.destinationSince === null
      || typeof checkpoint.auditWindow.destinationSince === "string")
    && Number.isSafeInteger(checkpoint.totalSyncBatches)
    && Number.isSafeInteger(checkpoint.completedSyncBatches);
}

function checkpointName(email) {
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 20);
  return `account-${digest}.json`;
}

async function atomicPrivateWrite(path, content) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export function createCheckpointStore(directory, identity) {
  const stateDirectory = resolve(directory);
  const path = join(stateDirectory, checkpointName(identity.email));

  return {
    path,
    async load() {
      try {
        const checkpoint = JSON.parse(await readFile(path, "utf8"));
        if (!hasValidShape(checkpoint)) return null;
        if (JSON.stringify(checkpoint.identity) !== JSON.stringify(identity)) return null;
        return checkpoint;
      } catch (error) {
        if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
        throw error;
      }
    },
    async save(checkpoint) {
      await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
      await chmod(stateDirectory, 0o700);
      await atomicPrivateWrite(path, `${JSON.stringify({
        ...checkpoint,
        version: CHECKPOINT_VERSION,
        identity,
        updatedAt: new Date().toISOString(),
      }, null, 2)}\n`);
    },
    async remove() {
      await rm(path, { force: true });
    },
  };
}
