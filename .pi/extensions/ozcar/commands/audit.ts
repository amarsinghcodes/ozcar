import type { OzcarPaths } from "../index";
import type { PiExtensionApiLike } from "../types";
import { type AuditRuntimeState, getCurrentAuditState, markAuditBranch, renderAuditStateSummary, renderMissingAuditStateMessage, startAuditSession } from "../state/audit-session";
import { deriveAuditId, normalizeAuditSlug } from "../state/labels";

export const OZCAR_AUDIT_BRANCH_COMMAND = "ozcar-audit-branch";
export const OZCAR_AUDIT_RESUME_COMMAND = "ozcar-audit-resume";
export const OZCAR_AUDIT_START_COMMAND = "ozcar-audit-start";
export const OZCAR_AUDIT_STATE_COMMAND = "ozcar-audit-state";

const START_USAGE = "Usage: /ozcar-audit-start <focus> or /ozcar-audit-start <audit-id> :: <focus>";
const BRANCH_USAGE =
  "Usage: /ozcar-audit-branch <hypothesis|confirmed> <slug> or /ozcar-audit-branch <kind> <slug> :: <note>";

interface ParsedDelimitedArgs {
  head: string;
  note?: string;
}

interface ParsedStartArgs {
  auditId: string;
  focus: string;
}

interface ParsedBranchArgs {
  kind: "confirmed" | "hypothesis";
  note?: string;
  slug: string;
}

function splitDelimitedArgs(raw: string): ParsedDelimitedArgs | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const separatorIndex = trimmed.indexOf("::");
  if (separatorIndex < 0) {
    return {
      head: trimmed,
    };
  }

  const head = trimmed.slice(0, separatorIndex).trim();
  const note = trimmed.slice(separatorIndex + 2).trim();

  if (!head) {
    return undefined;
  }

  return {
    head,
    ...(note ? { note } : {}),
  };
}

export function parseAuditStartArgs(args: string): ParsedStartArgs | undefined {
  const parsed = splitDelimitedArgs(args);
  if (!parsed) {
    return undefined;
  }

  if (!parsed.note) {
    const focus = parsed.head.trim();
    const auditId = deriveAuditId(focus);
    if (!auditId) {
      return undefined;
    }

    return {
      auditId,
      focus,
    };
  }

  const auditId = normalizeAuditSlug(parsed.head);
  const focus = parsed.note.trim();

  if (!auditId || !focus) {
    return undefined;
  }

  return {
    auditId,
    focus,
  };
}

export function parseAuditBranchArgs(args: string): ParsedBranchArgs | undefined {
  const parsed = splitDelimitedArgs(args);
  if (!parsed) {
    return undefined;
  }

  const [kindToken, ...slugParts] = parsed.head.split(/\s+/).filter(Boolean);
  if (kindToken !== "confirmed" && kindToken !== "hypothesis") {
    return undefined;
  }

  const slug = normalizeAuditSlug(slugParts.join(" "));
  if (!slug) {
    return undefined;
  }

  return {
    kind: kindToken,
    ...(parsed.note ? { note: parsed.note } : {}),
    slug,
  };
}

export function registerAuditCommands(
  pi: Pick<PiExtensionApiLike, "appendEntry" | "registerCommand" | "setLabel" | "setSessionName">,
  runtime: AuditRuntimeState,
  _paths: OzcarPaths,
): void {
  pi.registerCommand(OZCAR_AUDIT_START_COMMAND, {
    description: "Start an ozcar audit session on the current Pi branch",
    handler: async (args, ctx) => {
      const parsed = parseAuditStartArgs(args);
      if (!parsed) {
        ctx.ui.notify(START_USAGE, "warning");
        return;
      }

      const state = startAuditSession(pi, runtime, ctx, {
        auditId: parsed.auditId,
        focus: parsed.focus,
        source: "command:start",
      });

      ctx.ui.notify(
        [
          `Started ozcar audit \`${state.auditId}\`.`,
          `Next: /ozcar-audit ${state.focus}`,
          `Use /${OZCAR_AUDIT_STATE_COMMAND} for current state and /${OZCAR_AUDIT_BRANCH_COMMAND} to mark hypotheses or findings before /tree.`,
        ].join("\n"),
        "info",
      );
    },
  });

  pi.registerCommand(OZCAR_AUDIT_RESUME_COMMAND, {
    description: "Resume the current ozcar audit branch after /resume, /tree, or /reload",
    handler: async (args, ctx) => {
      const state = getCurrentAuditState(runtime, ctx.sessionManager);
      if (!state) {
        ctx.ui.notify(renderMissingAuditStateMessage(), "warning");
        return;
      }

      const expectedAuditId = normalizeAuditSlug(args.trim());
      if (expectedAuditId && expectedAuditId !== state.auditId) {
        ctx.ui.notify(
          `Current branch is attached to audit \`${state.auditId}\`, not \`${expectedAuditId}\`. Use /tree to switch branches first.`,
          "warning",
        );
        return;
      }

      ctx.ui.notify(
        [
          `Resumed ozcar audit \`${state.auditId}\`.`,
          `Current branch: ${state.branchKind}${state.branchSlug ? ` (${state.branchSlug})` : ""}`,
          `Use /${OZCAR_AUDIT_STATE_COMMAND} for the full restored state.`,
        ].join("\n"),
        "info",
      );
    },
  });

  pi.registerCommand(OZCAR_AUDIT_STATE_COMMAND, {
    description: "Inspect the current ozcar audit state and tree conventions",
    handler: async (_args, ctx) => {
      const state = getCurrentAuditState(runtime, ctx.sessionManager);
      if (!state) {
        ctx.ui.notify(renderMissingAuditStateMessage(), "warning");
        return;
      }

      ctx.ui.notify(renderAuditStateSummary(state, true), "info");
    },
  });

  pi.registerCommand(OZCAR_AUDIT_BRANCH_COMMAND, {
    description: "Mark the current audit branch as a hypothesis or confirmed finding",
    handler: async (args, ctx) => {
      const parsed = parseAuditBranchArgs(args);
      if (!parsed) {
        ctx.ui.notify(BRANCH_USAGE, "warning");
        return;
      }

      try {
        const result = markAuditBranch(pi, runtime, ctx, {
          kind: parsed.kind,
          slug: parsed.slug,
          source: "command:branch",
          ...(parsed.note ? { note: parsed.note } : {}),
        });

        ctx.ui.notify(
          [
            `Marked the current audit branch as ${parsed.kind}.`,
            `Label: ${result.label}`,
            `State: ${result.state.auditId} -> ${result.state.branchKind}${result.state.branchSlug ? ` (${result.state.branchSlug})` : ""}`,
            "When you leave this branch through /tree with summarization enabled, ozcar will persist the abandoned branch summary automatically.",
          ].join("\n"),
          "info",
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
      }
    },
  });
}
