import { promises as fs } from "node:fs";
import path from "node:path";

import type { ZodIssue } from "zod";

import {
  ProviderExecutionArtifact,
  ProviderExecutionArtifactSchema,
  ProviderPreflight,
  ProviderPreflightSchema,
} from "../contracts/provider-execution";
import { ProviderName, ProviderPhase, ProviderSelection } from "../providers/base";

const ATTEMPTS_DIR = "attempts";

export interface ProviderPreflightGateOptions {
  readonly expectedProvider: {
    readonly name: ProviderName;
    readonly selection?: ProviderSelection;
  };
  readonly runRoot: string;
}

export interface ProviderPreflightGateResult {
  readonly preflight: ProviderPreflight;
  readonly preflightFile: string;
}

export interface ProviderExecutionGateOptions {
  readonly expectedPhase: ProviderPhase;
  readonly expectedProvider: {
    readonly name: ProviderName;
    readonly model?: string;
    readonly selection?: ProviderSelection;
  };
  readonly providerRoot: string;
}

export interface ProviderExecutionGateResult {
  readonly attempts: ProviderExecutionArtifact[];
  readonly execution: ProviderExecutionArtifact;
  readonly executionFile: string;
}

export class ProviderExecutionGateError extends Error {
  readonly artifactPath: string;

  constructor(artifactPath: string, message: string) {
    super(message);
    this.name = "ProviderExecutionGateError";
    this.artifactPath = artifactPath;
  }
}

export async function assertProviderPreflightGate(
  options: ProviderPreflightGateOptions,
): Promise<ProviderPreflightGateResult> {
  const preflightFile = path.join(options.runRoot, "provider", "preflight.json");

  await requireFile(preflightFile, "preflight.json");

  const preflight = await readPreflightFile(preflightFile);

  if (preflight.provider.name !== options.expectedProvider.name) {
    throw new ProviderExecutionGateError(
      preflightFile,
      `Provider gate rejected ${preflightFile}: expected provider ${options.expectedProvider.name} but found ${preflight.provider.name}.`,
    );
  }

  if (
    options.expectedProvider.selection !== undefined &&
    preflight.provider.selection !== options.expectedProvider.selection
  ) {
    throw new ProviderExecutionGateError(
      preflightFile,
      `Provider gate rejected ${preflightFile}: expected selection ${options.expectedProvider.selection} but found ${preflight.provider.selection}.`,
    );
  }

  if (!preflight.ok) {
    throw new ProviderExecutionGateError(
      preflightFile,
      `Provider gate rejected ${preflightFile}: persisted preflight is not ready for live execution.`,
    );
  }

  return {
    preflight,
    preflightFile,
  };
}

export async function assertProviderExecutionGate(
  options: ProviderExecutionGateOptions,
): Promise<ProviderExecutionGateResult> {
  const attemptsRoot = path.join(options.providerRoot, ATTEMPTS_DIR);
  let attemptDirs: string[];

  try {
    const entries = await fs.readdir(attemptsRoot, { withFileTypes: true });
    attemptDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    throw new ProviderExecutionGateError(
      attemptsRoot,
      `Provider gate rejected ${attemptsRoot}: missing live provider attempt artifacts.`,
    );
  }

  if (attemptDirs.length === 0) {
    throw new ProviderExecutionGateError(
      attemptsRoot,
      `Provider gate rejected ${attemptsRoot}: no live provider attempts were captured.`,
    );
  }

  const attempts: ProviderExecutionArtifact[] = [];
  let finalExecutionFile = "";

  for (const attemptDir of attemptDirs) {
    const attemptRoot = path.join(attemptsRoot, attemptDir);
    const executionFile = path.join(attemptRoot, "execution.json");

    await requireFile(executionFile, "execution.json");

    const execution = await readExecutionFile(executionFile);
    assertExecutionIdentity(executionFile, execution, attemptDir, options);
    await requireArtifactSet(attemptRoot, execution);

    attempts.push(execution);
    finalExecutionFile = executionFile;
  }

  const execution = attempts[attempts.length - 1];

  if (!execution || finalExecutionFile.length === 0) {
    throw new ProviderExecutionGateError(
      attemptsRoot,
      `Provider gate rejected ${attemptsRoot}: no successful execution artifact could be loaded.`,
    );
  }

  if (execution.result.status !== "succeeded" || execution.result.exitCode !== 0 || !execution.parse.ok) {
    throw new ProviderExecutionGateError(
      finalExecutionFile,
      `Provider gate rejected ${finalExecutionFile}: final live provider attempt did not succeed.`,
    );
  }

  return {
    attempts,
    execution,
    executionFile: finalExecutionFile,
  };
}

async function readPreflightFile(preflightFile: string): Promise<ProviderPreflight> {
  const raw = await fs.readFile(preflightFile, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new ProviderExecutionGateError(
      preflightFile,
      `Provider gate rejected ${preflightFile}: invalid JSON (${String(error)}).`,
    );
  }

  const result = ProviderPreflightSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProviderExecutionGateError(
      preflightFile,
      `Provider gate rejected ${preflightFile}: ${formatIssues(result.error.issues)}.`,
    );
  }

  return result.data;
}

async function readExecutionFile(executionFile: string): Promise<ProviderExecutionArtifact> {
  const raw = await fs.readFile(executionFile, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new ProviderExecutionGateError(
      executionFile,
      `Provider gate rejected ${executionFile}: invalid JSON (${String(error)}).`,
    );
  }

  const result = ProviderExecutionArtifactSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProviderExecutionGateError(
      executionFile,
      `Provider gate rejected ${executionFile}: ${formatIssues(result.error.issues)}.`,
    );
  }

  return result.data;
}

function assertExecutionIdentity(
  executionFile: string,
  execution: ProviderExecutionArtifact,
  attemptDir: string,
  options: ProviderExecutionGateOptions,
): void {
  if (execution.phase !== options.expectedPhase) {
    throw new ProviderExecutionGateError(
      executionFile,
      `Provider gate rejected ${executionFile}: expected phase ${options.expectedPhase} but found ${execution.phase}.`,
    );
  }

  if (execution.provider.name !== options.expectedProvider.name) {
    throw new ProviderExecutionGateError(
      executionFile,
      `Provider gate rejected ${executionFile}: expected provider ${options.expectedProvider.name} but found ${execution.provider.name}.`,
    );
  }

  if (
    options.expectedProvider.selection !== undefined &&
    execution.provider.selection !== options.expectedProvider.selection
  ) {
    throw new ProviderExecutionGateError(
      executionFile,
      `Provider gate rejected ${executionFile}: expected selection ${options.expectedProvider.selection} but found ${execution.provider.selection}.`,
    );
  }

  if (options.expectedProvider.model !== undefined && execution.provider.model !== options.expectedProvider.model) {
    throw new ProviderExecutionGateError(
      executionFile,
      `Provider gate rejected ${executionFile}: expected model ${options.expectedProvider.model} but found ${execution.provider.model}.`,
    );
  }

  if (execution.attempt !== Number.parseInt(attemptDir, 10)) {
    throw new ProviderExecutionGateError(
      executionFile,
      `Provider gate rejected ${executionFile}: attempt metadata ${execution.attempt} does not match directory ${attemptDir}.`,
    );
  }
}

async function requireArtifactSet(attemptRoot: string, execution: ProviderExecutionArtifact): Promise<void> {
  const requiredFiles = [
    execution.artifacts.promptFile,
    execution.artifacts.responseFile,
    execution.artifacts.schemaFile,
    execution.artifacts.stderrFile,
    execution.artifacts.stdoutFile,
  ];

  for (const artifactFile of requiredFiles) {
    await requireFile(path.join(attemptRoot, artifactFile), artifactFile);
  }
}

async function requireFile(filePath: string, artifactLabel: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new ProviderExecutionGateError(
      filePath,
      `Provider gate rejected ${filePath}: missing required provider artifact ${artifactLabel}.`,
    );
  }
}

function formatIssues(issues: readonly ZodIssue[]): string {
  return issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}
