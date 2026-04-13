import type { ZodIssue } from "zod";

import { AuditArtifactSnapshotSchema } from "../../../../src/contracts/export";
import type { PiExtensionApiLike, PiExtensionContextLike } from "../types";
import {
  checkpointAuditArtifactSnapshot,
} from "../state/audit-artifact-snapshot";
import { type AuditRuntimeState, getCurrentAuditState, renderMissingAuditStateMessage } from "../state/audit-session";

export const OZCAR_STORE_AUDIT_SNAPSHOT_TOOL = "ozcar_store_audit_snapshot";

export function registerAuditArtifactSnapshotTool(
  pi: Pick<PiExtensionApiLike, "appendEntry" | "registerTool">,
  runtime: AuditRuntimeState,
): void {
  pi.registerTool<{ snapshot?: unknown }, { auditId: string; findingCount: number; validatedFindings: number }>({
    description:
      "Validate and store the current Phase 4 audit snapshot on the active Pi branch for later /ozcar-audit-export.",
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runAuditArtifactSnapshotTool(pi, runtime, ctx, params),
    label: "Ozcar Store Audit Snapshot",
    name: OZCAR_STORE_AUDIT_SNAPSHOT_TOOL,
    parameters: {
      additionalProperties: false,
      properties: {
        snapshot: {
          description: "The validated Phase 4 audit snapshot to store on the current Pi branch.",
          type: "object",
        },
      },
      required: ["snapshot"],
      type: "object",
    },
  });
}

async function runAuditArtifactSnapshotTool(
  pi: Pick<PiExtensionApiLike, "appendEntry">,
  runtime: AuditRuntimeState,
  ctx: PiExtensionContextLike,
  params: unknown,
) {
  const state = getCurrentAuditState(runtime, ctx.sessionManager);
  if (!state) {
    return {
      content: [
        {
          type: "text" as const,
          text: renderMissingAuditStateMessage(),
        },
      ],
      details: {
        auditId: "",
        findingCount: 0,
        validatedFindings: 0,
      },
    };
  }

  const snapshot = readSnapshotParam(params);
  if (snapshot === undefined) {
    return {
      content: [
        {
          type: "text" as const,
          text: "ozcar_store_audit_snapshot requires { snapshot } matching the Phase 4 audit artifact snapshot contract.",
        },
      ],
      details: {
        auditId: "",
        findingCount: 0,
        validatedFindings: 0,
      },
    };
  }

  const result = AuditArtifactSnapshotSchema.safeParse(snapshot);
  if (!result.success) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Invalid audit snapshot: ${formatIssues(result.error.issues)}.`,
        },
      ],
      details: {
        auditId: "",
        findingCount: 0,
        validatedFindings: 0,
      },
    };
  }

  try {
    const storedSnapshot = checkpointAuditArtifactSnapshot(pi, result.data, state);
    const validatedFindings = storedSnapshot.findings.filter(
      (bundle) => bundle.validation.outcome === "validated",
    ).length;

    return {
      content: [
        {
          type: "text" as const,
          text: `Stored validated audit snapshot for audit ${storedSnapshot.audit.auditId}. Findings: ${storedSnapshot.findings.length}. Export next with /ozcar-audit-export.`,
        },
      ],
      details: {
        auditId: storedSnapshot.audit.auditId,
        findingCount: storedSnapshot.findings.length,
        validatedFindings,
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
        findingCount: 0,
        validatedFindings: 0,
      },
    };
  }
}

function readSnapshotParam(params: unknown): unknown | undefined {
  if (!isRecord(params) || !("snapshot" in params)) {
    return undefined;
  }

  return params.snapshot;
}

function formatIssues(issues: readonly ZodIssue[]): string {
  return issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
