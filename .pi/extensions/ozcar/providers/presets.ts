export const AUDIT_MODEL_PRESET_KEYS = ["balanced", "deep", "economy"] as const;

export type AuditModelPresetKey = (typeof AUDIT_MODEL_PRESET_KEYS)[number];
export type AuditModelPresetEnvironment = Record<string, string | undefined>;

export interface AuditModelPreset {
  description: string;
  envVar: string;
  guidance: string;
  invalidModel?: string;
  model?: string;
  name: AuditModelPresetKey;
}

const AUDIT_MODEL_PRESET_DEFINITIONS = {
  balanced: {
    description: "Default interactive audit pass for most repo work.",
    envVar: "OZCAR_AUDIT_MODEL_BALANCED",
    guidance: "Use for the main audit loop when you want a reasoning-capable default.",
  },
  deep: {
    description: "Highest-effort audit pass for ambiguous or high-risk code.",
    envVar: "OZCAR_AUDIT_MODEL_DEEP",
    guidance: "Use when the audit needs a slower, stronger reasoning model.",
  },
  economy: {
    description: "Lower-cost replay or follow-up validation pass.",
    envVar: "OZCAR_AUDIT_MODEL_ECONOMY",
    guidance: "Use for cheaper rechecks after the main audit direction is already set.",
  },
} satisfies Record<
  AuditModelPresetKey,
  {
    description: string;
    envVar: string;
    guidance: string;
  }
>;

function isProviderModelReference(value: string): boolean {
  const slashIndex = value.indexOf("/");

  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    return false;
  }

  const provider = value.slice(0, slashIndex);
  const model = value.slice(slashIndex + 1);

  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(provider) && /^\S+$/.test(model);
}

function normalizeConfiguredModel(value: string | undefined): Pick<AuditModelPreset, "invalidModel" | "model"> {
  const trimmed = value?.trim();

  if (!trimmed) {
    return {};
  }

  if (!isProviderModelReference(trimmed)) {
    return {
      invalidModel: trimmed,
    };
  }

  return {
    model: trimmed,
  };
}

export function resolveAuditModelPreset(
  name: AuditModelPresetKey,
  env: AuditModelPresetEnvironment = process.env,
): AuditModelPreset {
  const definition = AUDIT_MODEL_PRESET_DEFINITIONS[name];
  const normalizedModel = normalizeConfiguredModel(env[definition.envVar]);

  return {
    description: definition.description,
    envVar: definition.envVar,
    guidance: definition.guidance,
    name,
    ...normalizedModel,
  };
}

export function listAuditModelPresets(
  env: AuditModelPresetEnvironment = process.env,
): AuditModelPreset[] {
  return AUDIT_MODEL_PRESET_KEYS.map((name) => resolveAuditModelPreset(name, env));
}

export function buildAuditModelCommand(preset: Pick<AuditModelPreset, "model">): string {
  return `/model ${preset.model ?? "<provider/model>"}`;
}

function renderPresetLine(preset: AuditModelPreset): string {
  if (preset.model) {
    return `- ${preset.name}: ${preset.description} ${preset.guidance} Current: ${preset.model}`;
  }

  if (preset.invalidModel) {
    return `- ${preset.name}: ${preset.description} ${preset.guidance} Ignoring invalid ${preset.envVar} value ${JSON.stringify(preset.invalidModel)}; expected <provider>/<model>.`;
  }

  return `- ${preset.name}: ${preset.description} ${preset.guidance} Configure ${preset.envVar}=<provider/model>.`;
}

export function renderAuditModelPresetHelp(
  env: AuditModelPresetEnvironment = process.env,
): string {
  return [
    "ozcar audit model presets keep Pi in charge of /login, provider resolution, and model execution.",
    ...listAuditModelPresets(env).map(renderPresetLine),
    "Use /login for subscription providers or Pi's env/auth.json support for API-key providers.",
    "Run /ozcar-audit-model <balanced|deep|economy> to queue a Pi /model command in the editor.",
  ].join("\n");
}
