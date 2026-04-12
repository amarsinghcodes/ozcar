import type { ProviderDefinition } from "./base";

export const codexProvider: ProviderDefinition = {
  name: "codex",
  capabilities: {
    modelOverride: true,
    plan: true,
    scan: true,
  },
  defaultModels: {
    plan: "codex-default",
    scan: "codex-default",
  },
  detectionCommands: ["codex"],
};
