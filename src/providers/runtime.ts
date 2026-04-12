import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { type ZodType } from "zod";

import {
  LIVE_PLAN_RESPONSE_JSON_SCHEMA,
  LIVE_SCAN_RESPONSE_JSON_SCHEMA,
  LivePlanResponse,
  LivePlanResponseSchema,
  LiveScanResponse,
  LiveScanResponseSchema,
  ProviderExecutionArtifact,
  ProviderExecutionArtifactSchema,
  ProviderPreflight,
  ProviderPreflightSchema,
} from "../contracts/provider-execution";
import {
  commandExists,
  ProviderCommandResult,
  ProviderPhase,
  ResolvedProvider,
} from "./base";

const ATTEMPTS_DIR = "attempts";
const EXECUTION_FILE = "execution.json";
const PROMPT_FILE = "prompt.md";
const RESPONSE_FILE = "response.txt";
const SCHEMA_FILE = "schema.json";
const STDERR_FILE = "stderr.txt";
const STDOUT_FILE = "stdout.txt";

export interface ExecuteProviderCommandInput {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin?: string;
}

export interface ProviderRuntimeDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly executeCommand?: (input: ExecuteProviderCommandInput) => Promise<ProviderCommandResult>;
  readonly isCommandAvailable?: (command: string, env: NodeJS.ProcessEnv) => Promise<boolean>;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface EnsureProviderPreflightOptions extends ProviderRuntimeDependencies {
  readonly provider: ResolvedProvider;
  readonly runRoot: string;
}

export interface ExecuteLiveProviderPhaseOptions extends ProviderRuntimeDependencies {
  readonly invocationRoot: string;
  readonly model: string;
  readonly phase: ProviderPhase;
  readonly preflight?: ProviderPreflight;
  readonly prompt: string;
  readonly provider: ResolvedProvider;
  readonly runRoot: string;
  readonly targetRoot: string;
}

export interface ExecuteProviderPhaseResult<T> {
  readonly execution: ProviderExecutionArtifact;
  readonly parsed: T;
  readonly preflight: ProviderPreflight;
  readonly providerRoot: string;
}

export class ProviderPreflightError extends Error {
  readonly artifactPath: string;
  readonly preflight: ProviderPreflight;

  constructor(artifactPath: string, preflight: ProviderPreflight) {
    super(
      `Provider preflight failed for ${preflight.provider.name}: ${preflight.auth.message} ${preflight.guidance.join(" ")}`.trim(),
    );
    this.name = "ProviderPreflightError";
    this.artifactPath = artifactPath;
    this.preflight = preflight;
  }
}

export class ProviderExecutionError extends Error {
  readonly artifactPath: string;
  readonly execution: ProviderExecutionArtifact;

  constructor(artifactPath: string, execution: ProviderExecutionArtifact) {
    const failureMessage =
      execution.result.failureMessage ??
      `Provider ${execution.provider.name} ${execution.phase} execution failed; see ${artifactPath}.`;
    super(failureMessage);
    this.name = "ProviderExecutionError";
    this.artifactPath = artifactPath;
    this.execution = execution;
  }
}

export async function ensureProviderPreflight(options: EnsureProviderPreflightOptions): Promise<ProviderPreflight> {
  const env = options.env ?? process.env;
  const executeCommand = options.executeCommand ?? defaultExecuteCommand;
  const isCommandAvailable = options.isCommandAvailable ?? commandExists;
  const now = options.now ?? (() => new Date());
  const providerRoot = path.join(options.runRoot, "provider");
  const preflightFile = path.join(providerRoot, "preflight.json");

  await fs.mkdir(providerRoot, { recursive: true });

  const binaryOk = await isCommandAvailable(options.provider.command, env);
  const checks: ProviderPreflight["checks"] = [
    {
      code: "binary",
      message: binaryOk
        ? `Detected ${options.provider.command} on PATH.`
        : `Command ${options.provider.command} is not available on PATH.`,
      ok: binaryOk,
    },
  ];

  let version: string | null = null;
  let auth = {
    message: binaryOk ? "Authentication status not checked." : `${options.provider.command} is unavailable.`,
    status: binaryOk ? "unknown" : "missing",
  } as ProviderPreflight["auth"];

  if (binaryOk) {
    const versionResult = await executeCommand({
      args: options.provider.versionCommandArgs,
      command: options.provider.command,
      cwd: options.runRoot,
      env,
    });
    version = options.provider.parseVersion(versionResult);
    checks.push({
      code: "version",
      message: version ?? `Unable to determine ${options.provider.name} version from CLI output.`,
      ok: version !== null,
    });

    const authResult = await executeCommand({
      args: options.provider.authCommandArgs,
      command: options.provider.command,
      cwd: options.runRoot,
      env,
    });
    auth = options.provider.parseAuthResult(authResult);
    checks.push({
      code: "auth",
      message: auth.message,
      ok: auth.status === "ready",
    });
  }

  const guidance = [
    ...(binaryOk ? [] : [options.provider.guidance.install]),
    ...(auth.status === "ready" ? [] : [options.provider.guidance.auth]),
  ];
  const preflight = ProviderPreflightSchema.parse({
    schemaVersion: 1,
    createdAt: now().toISOString(),
    provider: {
      name: options.provider.name,
      selection: options.provider.selection,
    },
    command: options.provider.command,
    detected: binaryOk,
    ok: binaryOk && auth.status === "ready",
    version,
    auth,
    checks,
    guidance,
  });

  await fs.writeFile(preflightFile, `${JSON.stringify(preflight, null, 2)}\n`, "utf8");

  if (!preflight.ok) {
    throw new ProviderPreflightError(preflightFile, preflight);
  }

  return preflight;
}

export async function runLivePlanExecution(
  options: ExecuteLiveProviderPhaseOptions,
): Promise<ExecuteProviderPhaseResult<LivePlanResponse>> {
  return executeLiveProviderPhase({
    ...options,
    jsonSchema: LIVE_PLAN_RESPONSE_JSON_SCHEMA,
    responseSchema: LivePlanResponseSchema,
  });
}

export async function runLiveScanExecution(
  options: ExecuteLiveProviderPhaseOptions,
): Promise<ExecuteProviderPhaseResult<LiveScanResponse>> {
  return executeLiveProviderPhase({
    ...options,
    jsonSchema: LIVE_SCAN_RESPONSE_JSON_SCHEMA,
    responseSchema: LiveScanResponseSchema,
  });
}

async function executeLiveProviderPhase<T>(options: ExecuteLiveProviderPhaseOptions & {
  readonly jsonSchema: Record<string, unknown>;
  readonly responseSchema: ZodType<T>;
}): Promise<ExecuteProviderPhaseResult<T>> {
  const env = options.env ?? process.env;
  const executeCommand = options.executeCommand ?? defaultExecuteCommand;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const preflight =
    options.preflight ??
    (await ensureProviderPreflight({
      env,
      executeCommand,
      now,
      provider: options.provider,
      runRoot: options.runRoot,
      ...(options.isCommandAvailable ? { isCommandAvailable: options.isCommandAvailable } : {}),
    }));

  if (!preflight.ok) {
    throw new ProviderPreflightError(path.join(options.runRoot, "provider", "preflight.json"), preflight);
  }

  const providerRoot = options.invocationRoot;
  const attemptsRoot = path.join(providerRoot, ATTEMPTS_DIR);
  const startingAttempt = (await nextAttemptNumber(attemptsRoot)) - 1;

  await fs.mkdir(attemptsRoot, { recursive: true });

  for (let localAttempt = 1; localAttempt <= options.provider.retryPolicy.maxAttempts; localAttempt += 1) {
    const attemptNumber = startingAttempt + localAttempt;
    const attemptRoot = path.join(attemptsRoot, formatSequence(attemptNumber));
    const promptFile = path.join(attemptRoot, PROMPT_FILE);
    const schemaFile = path.join(attemptRoot, SCHEMA_FILE);
    const stdoutFile = path.join(attemptRoot, STDOUT_FILE);
    const stderrFile = path.join(attemptRoot, STDERR_FILE);
    const responseFile = path.join(attemptRoot, RESPONSE_FILE);
    const executionFile = path.join(attemptRoot, EXECUTION_FILE);
    const startedAt = now();

    await fs.mkdir(attemptRoot, { recursive: true });
    await fs.writeFile(promptFile, normalizeFileText(options.prompt), "utf8");
    await fs.writeFile(schemaFile, `${JSON.stringify(options.jsonSchema, null, 2)}\n`, "utf8");

    const invocation = options.provider.buildInvocation({
      cwd: options.targetRoot,
      model: options.model,
      phase: options.phase,
      prompt: options.prompt,
      promptFile,
      responseFile,
      schemaFile,
      schemaText: JSON.stringify(options.jsonSchema),
    });
    const result = await executeCommand({
      args: invocation.args,
      command: invocation.command,
      cwd: invocation.cwd,
      env,
      ...(invocation.stdin !== undefined ? { stdin: invocation.stdin } : {}),
    });
    const completedAt = now();
    const responseText = await readTextFileIfPresent(responseFile);
    const parsedResponse = options.provider.parseResponse({
      ...(responseText !== undefined ? { responseText } : {}),
      stderr: result.stderr,
      stdout: result.stdout,
    });

    await fs.writeFile(stdoutFile, result.stdout, "utf8");
    await fs.writeFile(stderrFile, result.stderr, "utf8");
    await fs.writeFile(responseFile, parsedResponse.rawText, "utf8");

    let parsed: T | null = null;
    let parseError: string | undefined;
    let wrapperPath: string | null = null;

    try {
      const extracted = parseStructuredResponse(parsedResponse.rawText, options.responseSchema);
      parsed = extracted.value;
      wrapperPath = extracted.wrapperPath;
    } catch (error: unknown) {
      parseError = error instanceof Error ? error.message : String(error);
    }

    const classification =
      result.exitCode === 0 && parseError === undefined
        ? {
            code: "",
            message: "",
            retryable: false,
          }
        : options.provider.classifyFailure({
            exitCode: result.exitCode,
            ...(parseError ? { parseError } : {}),
            signal: result.signal,
            stderr: result.stderr,
            stdout: result.stdout,
          });
    const execution = ProviderExecutionArtifactSchema.parse({
      schemaVersion: 1,
      attempt: attemptNumber,
      phase: options.phase,
      provider: {
        model: options.model,
        name: options.provider.name,
        selection: options.provider.selection,
      },
      invocation: {
        args: [...invocation.args],
        command: invocation.command,
        cwd: invocation.cwd,
      },
      artifacts: {
        promptFile: PROMPT_FILE,
        responseFile: RESPONSE_FILE,
        schemaFile: SCHEMA_FILE,
        stderrFile: STDERR_FILE,
        stdoutFile: STDOUT_FILE,
      },
      result: {
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(completedAt.getTime() - startedAt.getTime(), 0),
        exitCode: result.exitCode,
        failureCode: classification.code.length > 0 ? classification.code : null,
        failureMessage: classification.message.length > 0 ? classification.message : null,
        retryable: classification.retryable,
        signal: result.signal,
        startedAt: startedAt.toISOString(),
        status: result.exitCode === 0 && parsed !== null ? "succeeded" : "failed",
      },
      parse: {
        format: parsedResponse.format,
        issues: parseError ? [parseError] : [],
        ok: parsed !== null,
        rawTextBytes: Buffer.byteLength(parsedResponse.rawText, "utf8"),
        sourceFile: RESPONSE_FILE,
        wrapperPath,
      },
    });

    await fs.writeFile(executionFile, `${JSON.stringify(execution, null, 2)}\n`, "utf8");

    if (parsed !== null && result.exitCode === 0) {
      return {
        execution,
        parsed,
        preflight,
        providerRoot,
      };
    }

    if (
      classification.retryable &&
      localAttempt < options.provider.retryPolicy.maxAttempts &&
      (parseError === undefined || options.provider.retryPolicy.retryOnParseFailure)
    ) {
      await sleep(options.provider.retryPolicy.retryDelayMs);
      continue;
    }

    throw new ProviderExecutionError(executionFile, execution);
  }

  throw new Error(`Provider ${options.provider.name} exhausted retry attempts for ${options.phase}.`);
}

function parseStructuredResponse<T>(
  rawText: string,
  schema: ZodType<T>,
): { readonly value: T; readonly wrapperPath: string | null } {
  const candidates = collectJsonCandidates(rawText);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.text);
      const matched = findMatchingSchemaValue(parsed, schema, candidate.path);

      if (matched) {
        return matched;
      }

      errors.push(`Parsed JSON from ${candidate.path} but no object matched the expected schema.`);
    } catch (error: unknown) {
      errors.push(`Invalid JSON from ${candidate.path}: ${String(error)}`);
    }
  }

  throw new Error(errors.join(" "));
}

function findMatchingSchemaValue<T>(
  value: unknown,
  schema: ZodType<T>,
  pathLabel: string,
): { readonly value: T; readonly wrapperPath: string | null } | null {
  const direct = schema.safeParse(value);
  if (direct.success) {
    return {
      value: direct.data,
      wrapperPath: pathLabel === "response" ? null : pathLabel,
    };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0 || trimmed === pathLabel) {
      return null;
    }

    try {
      return findMatchingSchemaValue(JSON.parse(trimmed), schema, `${pathLabel}::<json-string>`);
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const matched = findMatchingSchemaValue(value[index], schema, `${pathLabel}[${index}]`);
      if (matched) {
        return matched;
      }
    }
    return null;
  }

  if (!isPlainObject(value)) {
    return null;
  }

  const keys = orderObjectKeys(value);

  for (const key of keys) {
    const matched = findMatchingSchemaValue(value[key], schema, `${pathLabel}.${key}`);
    if (matched) {
      return matched;
    }
  }

  return null;
}

function collectJsonCandidates(rawText: string): Array<{ readonly path: string; readonly text: string }> {
  const trimmed = rawText.trim();
  const candidates: Array<{ readonly path: string; readonly text: string }> = [];

  if (trimmed.length > 0) {
    candidates.push({
      path: "response",
      text: trimmed,
    });
  }

  const fenceMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)];
  for (const [index, match] of fenceMatches.entries()) {
    const fenced = match[1]?.trim();
    if (fenced && fenced.length > 0) {
      candidates.push({
        path: `response::fence[${index}]`,
        text: fenced,
      });
    }
  }

  const objectSlice = extractJsonSlice(trimmed);
  if (objectSlice && !candidates.some((candidate) => candidate.text === objectSlice)) {
    candidates.push({
      path: "response::slice",
      text: objectSlice,
    });
  }

  return candidates;
}

function extractJsonSlice(value: string): string | null {
  const starts = ["{", "["];

  for (const startToken of starts) {
    const startIndex = value.indexOf(startToken);
    if (startIndex < 0) {
      continue;
    }

    const endToken = startToken === "{" ? "}" : "]";
    const endIndex = value.lastIndexOf(endToken);

    if (endIndex > startIndex) {
      return value.slice(startIndex, endIndex + 1).trim();
    }
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function orderObjectKeys(value: Record<string, unknown>): string[] {
  const preferred = ["result", "output", "data", "response", "content", "message", "last_message"];
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const key of preferred) {
    if (key in value) {
      ordered.push(key);
      seen.add(key);
    }
  }

  for (const key of Object.keys(value)) {
    if (!seen.has(key)) {
      ordered.push(key);
    }
  }

  return ordered;
}

async function nextAttemptNumber(attemptsRoot: string): Promise<number> {
  try {
    const entries = await fs.readdir(attemptsRoot, { withFileTypes: true });
    const numericEntries = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => Number.parseInt(entry.name, 10))
      .filter((value) => Number.isInteger(value) && value > 0);

    return numericEntries.length > 0 ? Math.max(...numericEntries) + 1 : 1;
  } catch {
    return 1;
  }
}

function formatSequence(value: number): string {
  return value.toString().padStart(4, "0");
}

function normalizeFileText(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

async function readTextFileIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function defaultExecuteCommand(input: ExecuteProviderCommandInput): Promise<ProviderCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdio: "pipe",
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const finish = (result: ProviderCommandResult) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    child.on("error", (error: Error) => {
      finish({
        exitCode: null,
        signal: null,
        stderr: appendError(stderrChunks, error.message),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      });
    });
    child.on("close", (exitCode, signal) => {
      finish({
        exitCode,
        signal,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      });
    });

    if (input.stdin !== undefined) {
      child.stdin.end(input.stdin);
      return;
    }

    child.stdin.end();
  });
}

function appendError(chunks: Buffer[], message: string): string {
  const existing = Buffer.concat(chunks).toString("utf8");
  return existing.length > 0 ? `${existing}\n${message}` : message;
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
