import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { RunIdSchema, RunRecord, RunRecordSchema } from "../contracts/run";
import {
  JsonValue,
  RunEventRecord,
  appendEventRecord,
  ensureEventLog,
  readEventRecords,
} from "./events";
import { RunLockHandle, acquireRunLock } from "./lock";

const STORE_ROOT = ".ai-auditor";
const RUNS_DIR = "runs";

export interface RunPaths {
  storeRoot: string;
  runsRoot: string;
  runRoot: string;
  runFile: string;
  eventsFile: string;
  lockDir: string;
}

export interface CreateRunStoreOptions {
  workspaceRoot: string;
  targetRoot?: string;
  runId?: string;
  now?: () => Date;
}

export interface ReopenRunStoreOptions {
  workspaceRoot: string;
  runId: string;
  now?: () => Date;
}

export interface ReadRunSnapshotOptions {
  workspaceRoot: string;
  runId: string;
}

export interface AppendRunEventInput {
  type: string;
  at?: string;
  details?: Record<string, JsonValue>;
}

export type RunUpdate = Partial<Pick<RunRecord, "activeLoop" | "currentPhase" | "status">>;

export interface RunSnapshot {
  paths: RunPaths;
  run: RunRecord;
  events: RunEventRecord[];
}

export interface RunStoreHandle {
  readonly paths: RunPaths;
  readonly run: RunRecord;
  appendEvent(input: AppendRunEventInput): Promise<RunEventRecord>;
  readEvents(): Promise<RunEventRecord[]>;
  updateRun(patch: RunUpdate): Promise<RunRecord>;
  close(): Promise<void>;
}

export class RunStoreExistsError extends Error {
  readonly runRoot: string;

  constructor(runId: string, runRoot: string) {
    super(`Run ${runId} already exists at ${runRoot}.`);
    this.name = "RunStoreExistsError";
    this.runRoot = runRoot;
  }
}

export class RunStoreNotFoundError extends Error {
  readonly runRoot: string;

  constructor(runId: string, runRoot: string) {
    super(`Run ${runId} does not exist at ${runRoot}.`);
    this.name = "RunStoreNotFoundError";
    this.runRoot = runRoot;
  }
}

export class RunStoreIdentityError extends Error {
  readonly actualRunId: string;
  readonly expectedRunId: string;
  readonly runFile: string;

  constructor(runFile: string, expectedRunId: string, actualRunId: string) {
    super(`Run record at ${runFile} expected runId ${expectedRunId} but found ${actualRunId}.`);
    this.name = "RunStoreIdentityError";
    this.actualRunId = actualRunId;
    this.expectedRunId = expectedRunId;
    this.runFile = runFile;
  }
}

class FileRunStoreHandle implements RunStoreHandle {
  private closed = false;
  private currentRun: RunRecord;

  constructor(
    readonly paths: RunPaths,
    run: RunRecord,
    private readonly lock: RunLockHandle,
    private readonly now: () => Date,
  ) {
    this.currentRun = run;
  }

  get run(): RunRecord {
    return this.currentRun;
  }

  async appendEvent(input: AppendRunEventInput): Promise<RunEventRecord> {
    this.assertOpen();

    const at = input.at ?? this.now().toISOString();
    const event = buildRunEvent(this.currentRun.runId, input, at);

    await appendEventRecord(this.paths.eventsFile, event);
    await this.persistRun({
      updatedAt: at,
    });

    return event;
  }

  async readEvents(): Promise<RunEventRecord[]> {
    this.assertOpen();
    return readEventRecords(this.paths.eventsFile, this.currentRun.runId);
  }

  async updateRun(patch: RunUpdate): Promise<RunRecord> {
    this.assertOpen();
    return this.persistRun({
      ...patch,
      updatedAt: this.now().toISOString(),
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.lock.release();
  }

  private async persistRun(patch: RunUpdate & Pick<RunRecord, "updatedAt">): Promise<RunRecord> {
    this.currentRun = RunRecordSchema.parse({
      ...this.currentRun,
      ...patch,
    });

    await writeRunRecord(this.paths.runFile, this.currentRun);
    return this.currentRun;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Run store handle is closed.");
    }
  }
}

export async function createRunStore(options: CreateRunStoreOptions): Promise<RunStoreHandle> {
  const now = options.now ?? (() => new Date());
  const runId = RunIdSchema.parse(options.runId ?? randomUUID());
  const paths = getRunPaths(options.workspaceRoot, runId);

  await fs.mkdir(paths.runsRoot, { recursive: true });

  try {
    await fs.mkdir(paths.runRoot);
  } catch (error: unknown) {
    if (isErrnoException(error, "EEXIST")) {
      throw new RunStoreExistsError(runId, paths.runRoot);
    }

    throw error;
  }

  const lock = await acquireRunLock(paths.runRoot, now);

  try {
    const createdAt = now().toISOString();
    const run = RunRecordSchema.parse({
      schemaVersion: 1,
      runId,
      targetRoot: path.resolve(options.targetRoot ?? options.workspaceRoot),
      status: "initialized",
      currentPhase: null,
      activeLoop: 0,
      createdAt,
      updatedAt: createdAt,
    });

    await writeRunRecord(paths.runFile, run);
    await ensureEventLog(paths.eventsFile);

    const handle = new FileRunStoreHandle(paths, run, lock, now);

    await handle.appendEvent({
      at: createdAt,
      details: {
        currentPhase: null,
        status: run.status,
        targetRoot: run.targetRoot,
      },
      type: "run.created",
    });

    return handle;
  } catch (error) {
    await lock.release();
    throw error;
  }
}

export async function reopenRunStore(options: ReopenRunStoreOptions): Promise<RunStoreHandle> {
  const now = options.now ?? (() => new Date());
  const runId = RunIdSchema.parse(options.runId);
  const paths = getRunPaths(options.workspaceRoot, runId);

  await ensureRunArtifacts(paths, runId);

  const lock = await acquireRunLock(paths.runRoot, now);

  try {
    const { run } = await readVerifiedRunState(paths, runId);

    const handle = new FileRunStoreHandle(paths, run, lock, now);

    await handle.appendEvent({
      details: {
        currentPhase: run.currentPhase,
        status: run.status,
      },
      type: "run.opened",
    });

    return handle;
  } catch (error) {
    await lock.release();
    throw error;
  }
}

export async function readRunSnapshot(options: ReadRunSnapshotOptions): Promise<RunSnapshot> {
  const runId = RunIdSchema.parse(options.runId);
  const paths = getRunPaths(options.workspaceRoot, runId);

  await ensureRunArtifacts(paths, runId);

  const { events, run } = await readVerifiedRunState(paths, runId);

  return {
    events,
    paths,
    run,
  };
}

export function getRunPaths(workspaceRoot: string, runId: string): RunPaths {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const storeRoot = path.join(resolvedWorkspaceRoot, STORE_ROOT);
  const runsRoot = path.join(storeRoot, RUNS_DIR);
  const runRoot = path.join(runsRoot, runId);

  return {
    storeRoot,
    runsRoot,
    runRoot,
    runFile: path.join(runRoot, "run.json"),
    eventsFile: path.join(runRoot, "events.jsonl"),
    lockDir: path.join(runRoot, ".lock"),
  };
}

export async function readRunRecord(runFile: string, expectedRunId?: string): Promise<RunRecord> {
  const raw = await fs.readFile(runFile, "utf8");
  const run = RunRecordSchema.parse(JSON.parse(raw));

  if (expectedRunId !== undefined && run.runId !== expectedRunId) {
    throw new RunStoreIdentityError(runFile, expectedRunId, run.runId);
  }

  return run;
}

async function ensureRunArtifacts(paths: RunPaths, runId: string): Promise<void> {
  if (!(await pathExists(paths.runRoot)) || !(await pathExists(paths.runFile)) || !(await pathExists(paths.eventsFile))) {
    throw new RunStoreNotFoundError(runId, paths.runRoot);
  }
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function readVerifiedRunState(paths: RunPaths, expectedRunId: string): Promise<Pick<RunSnapshot, "events" | "run">> {
  const run = await readRunRecord(paths.runFile, expectedRunId);
  const events = await readEventRecords(paths.eventsFile, expectedRunId);

  return {
    events,
    run,
  };
}

function buildRunEvent(runId: string, input: AppendRunEventInput, at: string): RunEventRecord {
  if (input.details !== undefined) {
    return {
      schemaVersion: 1,
      runId,
      type: input.type,
      at,
      details: input.details,
    };
  }

  return {
    schemaVersion: 1,
    runId,
    type: input.type,
    at,
  };
}

async function writeRunRecord(runFile: string, run: RunRecord): Promise<void> {
  await fs.writeFile(runFile, `${JSON.stringify(RunRecordSchema.parse(run), null, 2)}\n`, "utf8");
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
