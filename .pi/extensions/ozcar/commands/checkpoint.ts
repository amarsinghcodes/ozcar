import { promises as fs } from "node:fs";
import path from "node:path";

import type { PiExtensionApiLike } from "../types";
import {
  storeAuditArtifactSnapshot,
  validateAuditArtifactSnapshot,
} from "../state/audit-artifact-snapshot";
import { type AuditRuntimeState, getCurrentAuditState, renderMissingAuditStateMessage } from "../state/audit-session";

export const OZCAR_AUDIT_CHECKPOINT_COMMAND = "ozcar-audit-checkpoint";

const CHECKPOINT_USAGE = "Usage: /ozcar-audit-checkpoint <snapshot.json>";

export function registerAuditCheckpointCommand(
  pi: Pick<PiExtensionApiLike, "appendEntry" | "registerCommand">,
  runtime: AuditRuntimeState,
): void {
  pi.registerCommand(OZCAR_AUDIT_CHECKPOINT_COMMAND, {
    description: "Validate and store an audit snapshot file on the current Pi branch for later /ozcar-audit-export",
    handler: async (args, ctx) => {
      const state = getCurrentAuditState(runtime, ctx.sessionManager);
      if (!state) {
        ctx.ui.notify(renderMissingAuditStateMessage(), "warning");
        return;
      }

      const snapshotPathArg = parseSnapshotPathArg(args);
      if (!snapshotPathArg) {
        ctx.ui.notify(CHECKPOINT_USAGE, "warning");
        return;
      }

      const snapshotPath = path.resolve(ctx.cwd, snapshotPathArg);

      try {
        const snapshotInput = await readSnapshotFile(snapshotPath);
        const validatedSnapshot = validateAuditArtifactSnapshot(snapshotInput);
        const storedResult = storeAuditArtifactSnapshot(pi, validatedSnapshot, state);

        ctx.ui.notify(
          [
            `Stored validated audit snapshot for audit \`${storedResult.storedSnapshot.audit.auditId}\`.`,
            `Snapshot file: ${formatDisplayPath(ctx.cwd, snapshotPath)}`,
            `Findings: ${storedResult.findingCount} (${storedResult.validatedFindings} validated)`,
            "Next: /ozcar-audit-export",
          ].join("\n"),
          "success",
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
      }
    },
  });
}

function parseSnapshotPathArg(args: string): string | undefined {
  const trimmed = args.trim();
  if (!trimmed) {
    return undefined;
  }

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted || undefined;
  }

  return trimmed;
}

async function readSnapshotFile(snapshotPath: string): Promise<unknown> {
  let raw: string;

  try {
    raw = await fs.readFile(snapshotPath, "utf8");
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      throw new Error(`Snapshot file not found: ${snapshotPath}.`);
    }

    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Snapshot file ${snapshotPath} does not contain valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}

function formatDisplayPath(cwd: string, absolutePath: string): string {
  const relativePath = path.relative(cwd, absolutePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return absolutePath;
  }

  return relativePath;
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
