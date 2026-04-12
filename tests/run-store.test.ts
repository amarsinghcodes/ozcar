import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunEventIdentityError } from "../src/store/events";
import { RunLockError } from "../src/store/lock";
import { RunStoreIdentityError, createRunStore, getRunPaths, readRunSnapshot, reopenRunStore } from "../src/store/run-store";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      fs.rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("run-store", () => {
  it("creates a durable run directory with run.json and events.jsonl", async () => {
    const workspaceRoot = await createWorkspace();
    const handle = await createRunStore({
      now: () => new Date("2026-04-11T23:30:00.000Z"),
      runId: "phase1-create",
      targetRoot: workspaceRoot,
      workspaceRoot,
    });

    await handle.close();

    const snapshot = await readRunSnapshot({
      runId: "phase1-create",
      workspaceRoot,
    });

    expect(snapshot.run.runId).toBe("phase1-create");
    expect(snapshot.run.createdAt).toBe("2026-04-11T23:30:00.000Z");
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.type).toBe("run.created");
    await expect(fs.access(snapshot.paths.runFile)).resolves.toBeUndefined();
    await expect(fs.access(snapshot.paths.eventsFile)).resolves.toBeUndefined();
  });

  it("reopens an existing run without rewriting its original creation timestamp", async () => {
    const workspaceRoot = await createWorkspace();
    const initialHandle = await createRunStore({
      now: () => new Date("2026-04-11T23:31:00.000Z"),
      runId: "phase1-resume",
      targetRoot: workspaceRoot,
      workspaceRoot,
    });

    await initialHandle.close();

    const resumedHandle = await reopenRunStore({
      now: () => new Date("2026-04-11T23:32:00.000Z"),
      runId: "phase1-resume",
      workspaceRoot,
    });

    expect(resumedHandle.run.createdAt).toBe("2026-04-11T23:31:00.000Z");
    expect(resumedHandle.run.updatedAt).toBe("2026-04-11T23:32:00.000Z");
    await resumedHandle.close();

    const snapshot = await readRunSnapshot({
      runId: "phase1-resume",
      workspaceRoot,
    });

    expect(snapshot.events.map((event) => event.type)).toEqual(["run.created", "run.opened"]);
  });

  it("rejects a second open while the first handle still holds the lock", async () => {
    const workspaceRoot = await createWorkspace();
    const handle = await createRunStore({
      runId: "phase1-locked",
      targetRoot: workspaceRoot,
      workspaceRoot,
    });

    await expect(
      reopenRunStore({
        runId: "phase1-locked",
        workspaceRoot,
      }),
    ).rejects.toBeInstanceOf(RunLockError);

    await handle.close();
  });

  it("reclaims a stale same-host lock before reopening the run", async () => {
    const workspaceRoot = await createWorkspace();
    const handle = await createRunStore({
      runId: "phase1-stale-lock",
      targetRoot: workspaceRoot,
      workspaceRoot,
    });

    await handle.close();

    const paths = getRunPaths(workspaceRoot, "phase1-stale-lock");
    await writeStaleLock(paths.lockDir);

    const reopenedHandle = await reopenRunStore({
      runId: "phase1-stale-lock",
      workspaceRoot,
    });

    expect(reopenedHandle.run.runId).toBe("phase1-stale-lock");
    await reopenedHandle.close();

    const snapshot = await readRunSnapshot({
      runId: "phase1-stale-lock",
      workspaceRoot,
    });

    expect(snapshot.events.map((event) => event.type)).toEqual(["run.created", "run.opened"]);
  });

  it("does not reclaim a cross-host dead-pid lock", async () => {
    const workspaceRoot = await createWorkspace();
    const handle = await createRunStore({
      runId: "phase1-cross-host-lock",
      targetRoot: workspaceRoot,
      workspaceRoot,
    });

    await handle.close();

    const paths = getRunPaths(workspaceRoot, "phase1-cross-host-lock");
    const foreignHostname = await writeCrossHostLock(paths.lockDir);

    try {
      await reopenRunStore({
        runId: "phase1-cross-host-lock",
        workspaceRoot,
      });
      throw new Error("Expected reopenRunStore() to reject the cross-host lock.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RunLockError);
      expect((error as RunLockError).metadata?.hostname).toBe(foreignHostname);
    }
  });

  it("persists appended events and reloads them in order", async () => {
    const workspaceRoot = await createWorkspace();
    const timestamps = [
      "2026-04-11T23:33:00.000Z",
      "2026-04-11T23:34:00.000Z",
      "2026-04-11T23:35:00.000Z",
    ];

    let index = 0;
    const handle = await createRunStore({
      now: () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]),
      runId: "phase1-events",
      targetRoot: workspaceRoot,
      workspaceRoot,
    });

    await handle.appendEvent({
      details: {
        phase: "plan",
        step: "bootstrapped",
      },
      type: "phase.note",
    });

    await handle.appendEvent({
      details: {
        attempt: 2,
        nested: {
          ok: true,
        },
      },
      type: "phase.note",
    });

    await handle.close();

    const snapshot = await readRunSnapshot({
      runId: "phase1-events",
      workspaceRoot,
    });

    expect(snapshot.events.map((event) => event.type)).toEqual(["run.created", "phase.note", "phase.note"]);
    expect(snapshot.events[2]?.details).toEqual({
      attempt: 2,
      nested: {
        ok: true,
      },
    });
    expect(snapshot.run.updatedAt).toBe("2026-04-11T23:35:00.000Z");
  });

  it("rejects snapshot and reopen when run.json no longer matches the requested run id", async () => {
    const workspaceRoot = await createWorkspace();
    const handle = await createRunStore({
      runId: "phase1-runid-mismatch",
      targetRoot: workspaceRoot,
      workspaceRoot,
    });

    await handle.close();

    const paths = getRunPaths(workspaceRoot, "phase1-runid-mismatch");
    await replaceRunJsonRunId(paths.runFile, "other-run");

    await expect(
      readRunSnapshot({
        runId: "phase1-runid-mismatch",
        workspaceRoot,
      }),
    ).rejects.toBeInstanceOf(RunStoreIdentityError);

    await expect(
      reopenRunStore({
        runId: "phase1-runid-mismatch",
        workspaceRoot,
      }),
    ).rejects.toBeInstanceOf(RunStoreIdentityError);
  });

  it("rejects snapshot and reopen when events.jsonl contains another run id", async () => {
    const workspaceRoot = await createWorkspace();
    const handle = await createRunStore({
      runId: "phase1-event-runid-mismatch",
      targetRoot: workspaceRoot,
      workspaceRoot,
    });

    await handle.close();

    const paths = getRunPaths(workspaceRoot, "phase1-event-runid-mismatch");
    await replaceFirstEventRunId(paths.eventsFile, "other-event-run");

    await expect(
      readRunSnapshot({
        runId: "phase1-event-runid-mismatch",
        workspaceRoot,
      }),
    ).rejects.toBeInstanceOf(RunEventIdentityError);

    await expect(
      reopenRunStore({
        runId: "phase1-event-runid-mismatch",
        workspaceRoot,
      }),
    ).rejects.toBeInstanceOf(RunEventIdentityError);
  });
});

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-phase1-"));
  tempRoots.push(workspaceRoot);
  return workspaceRoot;
}

async function replaceRunJsonRunId(runFile: string, runId: string): Promise<void> {
  const run = JSON.parse(await fs.readFile(runFile, "utf8")) as Record<string, unknown>;
  run.runId = runId;
  await fs.writeFile(runFile, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

async function replaceFirstEventRunId(eventsFile: string, runId: string): Promise<void> {
  const lines = (await fs.readFile(eventsFile, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);

  const firstEvent = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  firstEvent.runId = runId;
  lines[0] = JSON.stringify(firstEvent);

  await fs.writeFile(eventsFile, `${lines.join("\n")}\n`, "utf8");
}

async function writeStaleLock(lockDir: string): Promise<void> {
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(
    path.join(lockDir, "lock.json"),
    `${JSON.stringify(
      {
        acquiredAt: "2026-04-11T23:56:00.000Z",
        hostname: os.hostname(),
        pid: findDeadPid(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writeCrossHostLock(lockDir: string): Promise<string> {
  const hostname = deriveForeignHostname();

  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(
    path.join(lockDir, "lock.json"),
    `${JSON.stringify(
      {
        acquiredAt: "2026-04-12T00:04:00.000Z",
        hostname,
        pid: findDeadPid(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return hostname;
}

function findDeadPid(): number {
  let candidate = 999_999;

  while (isProcessRunning(candidate)) {
    candidate += 1;
  }

  return candidate;
}

function deriveForeignHostname(): string {
  return `${os.hostname()}-foreign-lock-owner`;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    return code === "EPERM";
  }
}
