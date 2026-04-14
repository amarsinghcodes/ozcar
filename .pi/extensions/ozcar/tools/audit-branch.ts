import type { PiExtensionApiLike, PiExtensionContextLike } from "../types";
import { type AuditRuntimeState, markAuditBranch } from "../state/audit-session";
import { normalizeAuditSlug } from "../state/labels";

export const OZCAR_AUDIT_BRANCH_TOOL = "ozcar_audit_branch";

export interface AuditBranchToolParams {
  kind: "confirmed" | "hypothesis";
  note?: string;
  slug: string;
}

export function registerAuditBranchTool(
  pi: Pick<PiExtensionApiLike, "appendEntry" | "registerTool" | "setLabel" | "setSessionName">,
  runtime: AuditRuntimeState,
): void {
  pi.registerTool<AuditBranchToolParams, { auditId: string; branchKind: string; branchSlug?: string; label: string }>({
    description:
      "Mark the current ozcar audit branch as a hypothesis or confirmed finding using Pi session state and tree labels.",
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runAuditBranchTool(pi, runtime, ctx, params),
    label: "Ozcar Audit Branch",
    name: OZCAR_AUDIT_BRANCH_TOOL,
    parameters: {
      additionalProperties: false,
      properties: {
        kind: {
          description: "The audit branch state to record on the current Pi branch.",
          enum: ["hypothesis", "confirmed"],
          type: "string",
        },
        note: {
          description: "Optional note to keep with the branch checkpoint.",
          type: "string",
        },
        slug: {
          description: "Short stable identifier such as a hypothesis slug or finding id.",
          type: "string",
        },
      },
      required: ["kind", "slug"],
      type: "object",
    },
  });
}

export function parseAuditBranchToolParams(params: unknown): AuditBranchToolParams | undefined {
  if (!isRecord(params)) {
    return undefined;
  }

  const kind = params.kind;
  const slug = typeof params.slug === "string" ? normalizeAuditSlug(params.slug) : "";
  const note = typeof params.note === "string" ? params.note.trim() : undefined;

  if ((kind !== "confirmed" && kind !== "hypothesis") || !slug) {
    return undefined;
  }

  return {
    kind,
    ...(note ? { note } : {}),
    slug,
  };
}

async function runAuditBranchTool(
  pi: Pick<PiExtensionApiLike, "appendEntry" | "setLabel" | "setSessionName">,
  runtime: AuditRuntimeState,
  ctx: PiExtensionContextLike,
  params: unknown,
) {
  const parsed = parseAuditBranchToolParams(params);
  if (!parsed) {
    return {
      content: [
        {
          type: "text" as const,
          text: "ozcar_audit_branch requires { kind: hypothesis|confirmed, slug, note? }.",
        },
      ],
      details: {
        auditId: "",
        branchKind: "invalid",
        label: "",
      },
    };
  }

  try {
    const result = markAuditBranch(pi, runtime, ctx, {
      kind: parsed.kind,
      slug: parsed.slug,
      source: "tool:branch",
      ...(parsed.note ? { note: parsed.note } : {}),
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Recorded ${parsed.kind} branch ${parsed.slug} for audit ${result.state.auditId}. Label: ${result.label}.`,
        },
      ],
      details: {
        auditId: result.state.auditId,
        branchKind: result.state.branchKind,
        ...(result.state.branchSlug ? { branchSlug: result.state.branchSlug } : {}),
        label: result.label,
      },
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      details: {
        auditId: "",
        branchKind: "error",
        label: "",
      },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
