import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OZCAR_AUDIT_BRANCH_COMMAND,
  OZCAR_AUDIT_RESUME_COMMAND,
  OZCAR_AUDIT_START_COMMAND,
  OZCAR_AUDIT_STATE_COMMAND,
  registerAuditCommands,
} from "./commands/audit";
import {
  OZCAR_AUDIT_CHECKPOINT_COMMAND,
  registerAuditCheckpointCommand,
} from "./commands/checkpoint";
import { OZCAR_AUDIT_EXPORT_COMMAND, registerAuditExportCommand } from "./commands/export";
import { OZCAR_AUDIT_MODEL_COMMAND, registerAuditModelCommand } from "./commands/model";
import { OZCAR_STORE_AUDIT_SNAPSHOT_TOOL, registerAuditArtifactSnapshotTool } from "./tools/audit-artifact-snapshot";
import {
  buildAuditTreeConventionResult,
  createAuditRuntimeState,
  persistSummarizedAuditState,
  renderMissingAuditStateMessage,
  syncAuditRuntimeState,
} from "./state/audit-session";
import { OZCAR_AUDIT_BRANCH_TOOL, registerAuditBranchTool } from "./tools/audit-branch";
import type {
  PiCommandContextLike,
  PiExtensionApiLike,
  PiResourceDiscoveryLike,
} from "./types";

export const OZCAR_COMMAND = "ozcar";
export const OZCAR_PROMPT_TEMPLATE = "ozcar-audit";
export const OZCAR_SKILL = "ozcar-audit";

export interface OzcarPaths {
  extensionDir: string;
  promptsDir: string;
  repoRoot: string;
  skillsDir: string;
}

export function resolveOzcarPaths(moduleUrl: string = import.meta.url): OzcarPaths {
  const extensionDir = dirname(fileURLToPath(moduleUrl));
  const repoRoot = path.resolve(extensionDir, "../../..");

  return {
    extensionDir,
    promptsDir: path.join(repoRoot, ".pi", "prompts"),
    repoRoot,
    skillsDir: path.join(repoRoot, ".pi", "skills"),
  };
}

export function createResourceDiscovery(paths: OzcarPaths): PiResourceDiscoveryLike {
  return {
    promptPaths: [paths.promptsDir],
    skillPaths: [paths.skillsDir],
  };
}

function formatRepoPath(paths: OzcarPaths, absolutePath: string): string {
  return path.relative(paths.repoRoot, absolutePath) || ".";
}

export function renderOzcarHelp(paths: OzcarPaths): string {
  return [
    "ozcar Pi audit workflow ready.",
    `Load this package from another repo or cwd with pi -e ${paths.repoRoot}. Starting Pi inside ${paths.repoRoot} still auto-discovers the local .pi surface.`,
    `Use /${OZCAR_AUDIT_START_COMMAND} <focus> for a collision-resistant default audit id, or /${OZCAR_AUDIT_START_COMMAND} <audit-id> :: <focus> to pin a custom audit root.`,
    `Use /${OZCAR_AUDIT_MODEL_COMMAND} [balanced|deep|economy] to queue a repo-local Pi /model command from the current shell preset.`,
    `Use /${OZCAR_PROMPT_TEMPLATE} [focus] to enter the repo-local audit prompt once state exists.`,
    `Use /skill:${OZCAR_SKILL} [focus] when you want the repo-local audit skill loaded explicitly.`,
    `Use /${OZCAR_AUDIT_RESUME_COMMAND} or /${OZCAR_AUDIT_STATE_COMMAND} after /resume, /tree, or /reload.`,
    `Use /${OZCAR_AUDIT_BRANCH_COMMAND} <hypothesis|confirmed> <slug> [:: note] to label active audit branches.`,
    `Use /${OZCAR_AUDIT_CHECKPOINT_COMMAND} <snapshot.json> to validate and store a Phase 4 snapshot file on this branch before export.`,
    `Use /${OZCAR_AUDIT_EXPORT_COMMAND} to materialize .ai-auditor/audits/<audit-id>/ artifacts and the stable exports/findings.json comparison surface from the latest validated audit snapshot stored on this Pi branch.`,
    `Human export flow: /${OZCAR_AUDIT_CHECKPOINT_COMMAND} <snapshot.json> -> /${OZCAR_AUDIT_EXPORT_COMMAND}.`,
    `LLM tool: ${OZCAR_AUDIT_BRANCH_TOOL} mirrors the same branch checkpointing surface for agent turns.`,
    `LLM tool: ${OZCAR_STORE_AUDIT_SNAPSHOT_TOOL} mirrors the same snapshot backend for agent turns.`,
    "Use /tree with summarization enabled when leaving a hypothesis or confirmed branch so ozcar can persist the abandoned summary state.",
    "Use /reload after editing `.pi/` resources.",
    `Prompt resource: ${formatRepoPath(paths, path.join(paths.promptsDir, `${OZCAR_PROMPT_TEMPLATE}.md`))}`,
    `Skill resource: ${formatRepoPath(paths, path.join(paths.skillsDir, OZCAR_SKILL, "SKILL.md"))}`,
  ].join("\n");
}

export function handleOzcarCommand(
  args: string,
  ctx: PiCommandContextLike,
  paths: OzcarPaths,
): void {
  const trimmed = args.trim();

  if (trimmed.length > 0 && trimmed !== "help") {
    ctx.ui.notify("Usage: /ozcar or /ozcar help", "warning");
    return;
  }

  ctx.ui.notify(renderOzcarHelp(paths), "info");
}

export function registerOzcarExtension(
  pi: PiExtensionApiLike,
  paths: OzcarPaths = resolveOzcarPaths(),
): void {
  const runtime = createAuditRuntimeState();

  pi.on("resources_discover", () => createResourceDiscovery(paths));
  pi.on("session_start", async (_event, ctx) => {
    syncAuditRuntimeState(pi, runtime, ctx);
  });
  pi.on("session_tree", async (event, ctx) => {
    if (event.summaryEntry) {
      persistSummarizedAuditState(pi, runtime, ctx, event.summaryEntry);
    }
    syncAuditRuntimeState(pi, runtime, ctx);
  });
  pi.on("session_before_tree", async (event, ctx) => buildAuditTreeConventionResult(runtime, ctx, event));

  pi.registerCommand(OZCAR_COMMAND, {
    description: "Show repo-local ozcar Pi commands, audit workflow entrypoints, and tree conventions",
    handler: async (args, ctx) => {
      handleOzcarCommand(args, ctx, paths);
    },
  });

  registerAuditCommands(pi, runtime, paths);
  registerAuditModelCommand(pi);
  registerAuditCheckpointCommand(pi, runtime);
  registerAuditExportCommand(pi, runtime);
  registerAuditBranchTool(pi, runtime);
  registerAuditArtifactSnapshotTool(pi, runtime);
}

export { renderMissingAuditStateMessage } from "./state/audit-session";
export * from "./commands/audit";
export * from "./commands/checkpoint";
export * from "./commands/export";
export * from "./commands/model";
export * from "./providers/presets";
export * from "./state/audit-session";
export * from "./state/audit-artifact-snapshot";
export * from "./state/labels";
export * from "./tools/audit-branch";
export * from "./tools/audit-artifact-snapshot";
export * from "./types";

export default function ozcarExtension(pi: PiExtensionApiLike): void {
  registerOzcarExtension(pi);
}
