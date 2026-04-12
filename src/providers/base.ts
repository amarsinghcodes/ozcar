import { constants, promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";

export const ProviderNameSchema = z.enum(["codex", "claude"]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const ProviderPhaseSchema = z.enum(["plan", "scan"]);
export type ProviderPhase = z.infer<typeof ProviderPhaseSchema>;

export const ProviderSelectionSchema = z.enum(["auto", "override"]);
export type ProviderSelection = z.infer<typeof ProviderSelectionSchema>;

export type ProviderAuthStatus = "ready" | "missing" | "unknown";

export interface ProviderCapabilities {
  readonly modelOverride: boolean;
  readonly plan: boolean;
  readonly scan: boolean;
}

export interface ProviderRetryPolicy {
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly retryOnParseFailure: boolean;
}

export interface ProviderCommandSpec {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly stdin?: string;
}

export interface ProviderCommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
}

export interface ProviderInvocationBuildOptions {
  readonly cwd: string;
  readonly model: string;
  readonly phase: ProviderPhase;
  readonly prompt: string;
  readonly promptFile: string;
  readonly responseFile: string;
  readonly schemaFile: string;
  readonly schemaText: string;
}

export interface ProviderAuthResult {
  readonly message: string;
  readonly status: ProviderAuthStatus;
}

export interface ProviderFailureClassification {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ProviderFailureClassificationOptions extends ProviderCommandResult {
  readonly parseError?: string;
}

export interface ProviderParsedResponse {
  readonly format: string;
  readonly rawText: string;
}

export interface ProviderDefinition {
  readonly name: ProviderName;
  readonly command: string;
  readonly capabilities: ProviderCapabilities;
  readonly defaultModels: Record<ProviderPhase, string>;
  readonly detectionCommands: readonly string[];
  readonly guidance: {
    readonly auth: string;
    readonly install: string;
  };
  readonly retryPolicy: ProviderRetryPolicy;
  readonly authCommandArgs: readonly string[];
  readonly versionCommandArgs: readonly string[];
  buildInvocation(options: ProviderInvocationBuildOptions): ProviderCommandSpec;
  classifyFailure(options: ProviderFailureClassificationOptions): ProviderFailureClassification;
  parseAuthResult(result: ProviderCommandResult): ProviderAuthResult;
  parseResponse(options: {
    readonly responseText?: string;
    readonly stderr: string;
    readonly stdout: string;
  }): ProviderParsedResponse;
  parseVersion(result: ProviderCommandResult): string | null;
}

export interface ResolvedProvider extends ProviderDefinition {
  readonly available: boolean;
  readonly detectedProviders: ProviderName[];
  readonly requested: "auto" | ProviderName;
  readonly selection: ProviderSelection;
}

export interface ResolveProviderOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly isCommandAvailable?: (command: string, env: NodeJS.ProcessEnv) => Promise<boolean>;
  readonly requested?: string;
}

export interface ResolveStoredProviderOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly isCommandAvailable?: (command: string, env: NodeJS.ProcessEnv) => Promise<boolean>;
}

export interface ProviderSnapshotLike {
  readonly name: ProviderName;
  readonly selection: ProviderSelection;
}

export class ProviderResolutionError extends Error {
  readonly requested: string;

  constructor(requested: string, message: string) {
    super(message);
    this.name = "ProviderResolutionError";
    this.requested = requested;
  }
}

const BUILTIN_PROVIDERS: readonly ProviderDefinition[] = [codexProvider, claudeProvider];
const DEFAULT_PROVIDER_REQUEST = "auto";

export async function resolveProvider(options: ResolveProviderOptions = {}): Promise<ResolvedProvider> {
  const env = options.env ?? process.env;
  const requested = normalizeProviderRequest(options.requested ?? env.OZCAR_PROVIDER ?? DEFAULT_PROVIDER_REQUEST);
  const commandAvailable = options.isCommandAvailable ?? commandExists;

  const detectedProviders = await detectProviders(commandAvailable, env);

  if (requested === "auto") {
    const detected = detectedProviders[0];

    if (!detected) {
      const hints = BUILTIN_PROVIDERS.flatMap((provider) => provider.detectionCommands).join(", ");
      throw new ProviderResolutionError(
        requested,
        `No built-in provider detected on PATH. Looked for: ${hints}. Install Codex CLI or Claude Code, or use --provider <codex|claude> to force an explicit preflight check.`,
      );
    }

    return {
      ...providerByName(detected),
      available: true,
      detectedProviders,
      requested,
      selection: "auto",
    };
  }

  const provider = providerByName(requested);

  return {
    ...provider,
    available: detectedProviders.includes(provider.name),
    detectedProviders,
    requested,
    selection: "override",
  };
}

export async function resolveStoredProvider(
  snapshot: ProviderSnapshotLike,
  options: ResolveStoredProviderOptions = {},
): Promise<ResolvedProvider> {
  const env = options.env ?? process.env;
  const commandAvailable = options.isCommandAvailable ?? commandExists;
  const detectedProviders = await detectProviders(commandAvailable, env);
  const provider = providerByName(snapshot.name);

  return {
    ...provider,
    available: detectedProviders.includes(provider.name),
    detectedProviders,
    requested: snapshot.selection === "auto" ? "auto" : snapshot.name,
    selection: snapshot.selection,
  };
}

export function resolveProviderModel(
  provider: ResolvedProvider,
  phase: ProviderPhase,
  explicitModel?: string,
): string {
  const requestedModel = explicitModel?.trim();

  if (requestedModel) {
    return requestedModel;
  }

  return provider.defaultModels[phase];
}

export async function commandExists(command: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const pathValue = env.PATH ?? "";

  if (!pathValue) {
    return false;
  }

  const candidates = process.platform === "win32" ? windowsCommandCandidates(command, env) : [command];

  for (const pathEntry of pathValue.split(path.delimiter)) {
    if (!pathEntry) {
      continue;
    }

    for (const candidate of candidates) {
      const commandPath = path.join(pathEntry, candidate);

      try {
        await fs.access(commandPath, constants.X_OK);
        return true;
      } catch {
        continue;
      }
    }
  }

  return false;
}

async function detectProviders(
  commandAvailable: (command: string, env: NodeJS.ProcessEnv) => Promise<boolean>,
  env: NodeJS.ProcessEnv,
): Promise<ProviderName[]> {
  const detected: ProviderName[] = [];

  for (const provider of BUILTIN_PROVIDERS) {
    for (const command of provider.detectionCommands) {
      if (await commandAvailable(command, env)) {
        detected.push(provider.name);
        break;
      }
    }
  }

  return detected;
}

function providerByName(name: ProviderName): ProviderDefinition {
  const provider = BUILTIN_PROVIDERS.find((candidate) => candidate.name === name);

  if (!provider) {
    throw new ProviderResolutionError(name, `Unsupported provider: ${name}`);
  }

  return provider;
}

function normalizeProviderRequest(requested: string): "auto" | ProviderName {
  const normalized = requested.trim().toLowerCase();

  if (normalized === DEFAULT_PROVIDER_REQUEST) {
    return normalized;
  }

  const parsed = ProviderNameSchema.safeParse(normalized);
  if (parsed.success) {
    return parsed.data;
  }

  throw new ProviderResolutionError(
    requested,
    `Unsupported provider request "${requested}". Expected "auto", "codex", or "claude".`,
  );
}

function windowsCommandCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
  if (command.includes(".")) {
    return [command];
  }

  const extensions = (env.PATHEXT ?? ".EXE;.CMD;.BAT")
    .split(";")
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0);

  return [command, ...extensions.map((extension) => `${command}${extension}`)];
}
