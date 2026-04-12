import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { IsoTimestampSchema } from "../contracts/run";

const LOCK_DIR_NAME = ".lock";
const LOCK_FILE_NAME = "lock.json";

export interface RunLockMetadata {
  pid: number;
  hostname: string;
  acquiredAt: string;
}

export interface RunLockHandle {
  readonly lockDir: string;
  readonly metadata: RunLockMetadata;
  release(): Promise<void>;
}

export class RunLockError extends Error {
  readonly metadata: RunLockMetadata | null;
  readonly lockDir: string;

  constructor(runRoot: string, lockDir: string, metadata: RunLockMetadata | null) {
    const owner = metadata
      ? ` by pid ${metadata.pid} on ${metadata.hostname} since ${metadata.acquiredAt}`
      : "";

    super(`Run store at ${runRoot} is locked${owner}.`);

    this.name = "RunLockError";
    this.metadata = metadata;
    this.lockDir = lockDir;
  }
}

export async function acquireRunLock(runRoot: string, now: () => Date = () => new Date()): Promise<RunLockHandle> {
  const lockDir = path.join(runRoot, LOCK_DIR_NAME);
  const metadata: RunLockMetadata = {
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: now().toISOString(),
  };

  while (true) {
    try {
      await fs.mkdir(lockDir);
      break;
    } catch (error: unknown) {
      if (!isErrnoException(error, "EEXIST")) {
        throw error;
      }

      const existingMetadata = await readLockMetadata(lockDir);

      if (await shouldReclaimStaleLock(existingMetadata)) {
        await fs.rm(lockDir, { force: true, recursive: true });
        continue;
      }

      throw new RunLockError(runRoot, lockDir, existingMetadata);
    }
  }

  try {
    await fs.writeFile(lockMetadataPath(lockDir), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  } catch (error) {
    await fs.rm(lockDir, { force: true, recursive: true });
    throw error;
  }

  let released = false;

  return {
    lockDir,
    metadata,
    async release(): Promise<void> {
      if (released) {
        return;
      }

      released = true;
      await fs.rm(lockDir, { force: true, recursive: true });
    },
  };
}

async function readLockMetadata(lockDir: string): Promise<RunLockMetadata | null> {
  try {
    const raw = await fs.readFile(lockMetadataPath(lockDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<RunLockMetadata>;

    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.hostname === "string" &&
      typeof parsed.acquiredAt === "string" &&
      IsoTimestampSchema.safeParse(parsed.acquiredAt).success
    ) {
      return {
        acquiredAt: parsed.acquiredAt,
        hostname: parsed.hostname,
        pid: parsed.pid,
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function shouldReclaimStaleLock(metadata: RunLockMetadata | null): Promise<boolean> {
  if (!metadata) {
    return false;
  }

  if (metadata.hostname !== os.hostname()) {
    return false;
  }

  return !isProcessRunning(metadata.pid);
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (isErrnoException(error, "ESRCH")) {
      return false;
    }

    if (isErrnoException(error, "EPERM")) {
      return true;
    }

    throw error;
  }
}

function lockMetadataPath(lockDir: string): string {
  return path.join(lockDir, LOCK_FILE_NAME);
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
