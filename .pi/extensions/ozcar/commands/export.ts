import { materializeAuditArtifacts } from "../../../../src/artifacts/rebuild";
import type { PiExtensionApiLike } from "../types";
import {
  renderMissingAuditArtifactSnapshotMessage,
  restoreAuditArtifactSnapshot,
} from "../state/audit-artifact-snapshot";
import {
  type AuditRuntimeState,
  getCurrentAuditState,
  renderMissingAuditStateMessage,
} from "../state/audit-session";

export const OZCAR_AUDIT_EXPORT_COMMAND = "ozcar-audit-export";

const EXPORT_USAGE = "Usage: /ozcar-audit-export";

export function registerAuditExportCommand(
  pi: Pick<PiExtensionApiLike, "registerCommand">,
  runtime: AuditRuntimeState,
): void {
  pi.registerCommand(OZCAR_AUDIT_EXPORT_COMMAND, {
    description:
      "Materialize repo-owned audit artifacts plus the stable findings.json comparison surface, including authoritative reported metrics when present in the stored audit contract, from the latest validated audit snapshot stored on the current Pi branch through /ozcar-audit-checkpoint or the LLM tool",
    handler: async (args, ctx) => {
      const state = getCurrentAuditState(runtime, ctx.sessionManager);
      if (!state) {
        ctx.ui.notify(renderMissingAuditStateMessage(), "warning");
        return;
      }

      if (args.trim().length > 0) {
        ctx.ui.notify(EXPORT_USAGE, "warning");
        return;
      }

      try {
        const snapshot = restoreAuditArtifactSnapshot(ctx.sessionManager, state);
        if (!snapshot) {
          ctx.ui.notify(renderMissingAuditArtifactSnapshotMessage(state.auditId), "warning");
          return;
        }

        const result = await materializeAuditArtifacts({
          snapshot,
          workspaceRoot: ctx.cwd,
        });
        const reportedMetricsMessage = renderReportedMetricsMessage(result.findingsExport.reportedMetrics);

        ctx.ui.notify(
          [
            `Materialized stable export surface for audit \`${result.auditId}\`.`,
            `Audit root: .ai-auditor/audits/${result.auditId}`,
            `Downstream comparison input: .ai-auditor/audits/${result.auditId}/exports/findings.json`,
            "Source discipline: validated findings only; Pi transcripts are not part of this contract.",
            reportedMetricsMessage,
            "Comparison assumptions: capture provider/model/time budget separately from Pi or the benchmark harness.",
            `Rebuilt: summary.md, confirmed-findings.md, exports/findings.json`,
            `Validated findings: ${result.validatedFindings}`,
          ].join("\n"),
          "success",
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
      }
    },
  });
}

function renderReportedMetricsMessage(metrics: {
  costUsd?: number | undefined;
  durationSeconds?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
} | undefined): string {
  if (!metrics) {
    return "Authoritative reported metrics: none stored in the audit contract; measured wall-clock stays external.";
  }

  const parts: string[] = [];

  if (metrics.durationSeconds !== undefined) {
    parts.push(`duration=${metrics.durationSeconds}s`);
  }

  if (metrics.costUsd !== undefined) {
    parts.push(`cost=$${metrics.costUsd}`);
  }

  if (metrics.inputTokens !== undefined || metrics.outputTokens !== undefined) {
    parts.push(`tokens=${metrics.inputTokens ?? "n/a"} in / ${metrics.outputTokens ?? "n/a"} out`);
  }

  return `Authoritative reported metrics: ${parts.join("; ")}. Measured wall-clock stays external.`;
}
