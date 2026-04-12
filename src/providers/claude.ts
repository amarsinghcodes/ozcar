import type { ProviderDefinition } from "./base";

export const claudeProvider: ProviderDefinition = {
  name: "claude",
  capabilities: {
    modelOverride: true,
    plan: true,
    scan: true,
  },
  defaultModels: {
    plan: "claude-default",
    scan: "claude-default",
  },
  detectionCommands: ["claude"],
};
