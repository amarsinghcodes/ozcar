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

export interface ProviderCapabilities {
  readonly modelOverride: boolean;
  readonly plan: boolean;
  readonly scan: boolean;
}

export interface ProviderDefinition {
  readonly name: ProviderName;
  readonly capabilities: ProviderCapabilities;
  readonly defaultModels: Record<ProviderPhase, string>;
  readonly detectionCommands: readonly string[];
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
        `No built-in provider detected on PATH. Looked for: ${hints}. Use --provider <codex|claude> to force a provider during a Phase 2 dry run.`,
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
