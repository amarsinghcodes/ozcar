import type { ZodIssue } from "zod";

import { AuditArtifactSnapshotSchema } from "../../../../src/contracts/export";
import type { AuditArtifactSnapshot } from "../../../../src/contracts/export";
import { normalizeIsoTimestamp } from "../../../../src/contracts/run";
import type { PiCustomEntryLike, PiExtensionApiLike, PiReadonlySessionManagerLike } from "../types";
import type { RestoredAuditState } from "./audit-session";

export const OZCAR_AUDIT_ARTIFACT_SNAPSHOT_CUSTOM_TYPE = "ozcar-audit-artifact-snapshot";

export function checkpointAuditArtifactSnapshot(
  pi: Pick<PiExtensionApiLike, "appendEntry">,
  snapshot: AuditArtifactSnapshot,
  state: RestoredAuditState,
): AuditArtifactSnapshot {
  const alignedSnapshot = alignSnapshotToActiveAuditState(snapshot, state);
  pi.appendEntry(OZCAR_AUDIT_ARTIFACT_SNAPSHOT_CUSTOM_TYPE, alignedSnapshot);
  return alignedSnapshot;
}

export function restoreAuditArtifactSnapshot(
  sessionManager: PiReadonlySessionManagerLike,
  state: RestoredAuditState,
): AuditArtifactSnapshot | undefined {
  const branch = sessionManager.getBranch();

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry.type !== "custom") {
      continue;
    }

    const customEntry = entry as PiCustomEntryLike;
    if (customEntry.customType !== OZCAR_AUDIT_ARTIFACT_SNAPSHOT_CUSTOM_TYPE) {
      continue;
    }

    return parseStoredAuditArtifactSnapshot(customEntry, state);
  }

  return undefined;
}

export function renderMissingAuditArtifactSnapshotMessage(auditId: string): string {
  return [
    `No validated audit snapshot is stored for audit \`${auditId}\` on this branch.`,
    "Use the ozcar_store_audit_snapshot tool before /ozcar-audit-export.",
  ].join("\n");
}

export function alignSnapshotToActiveAuditState(
  snapshot: AuditArtifactSnapshot,
  state: RestoredAuditState,
): AuditArtifactSnapshot {
  const expectedAuditId = state.auditId;

  assertAuditId("audit", snapshot.audit.auditId, expectedAuditId);
  assertAuditId("scope", snapshot.scope.auditId, expectedAuditId);
  snapshot.findings.forEach((bundle) => {
    assertAuditId(`finding ${bundle.finding.findingId}`, bundle.finding.auditId, expectedAuditId);
    assertAuditId(`triage ${bundle.finding.findingId}`, bundle.triage.auditId, expectedAuditId);
    assertAuditId(`validation ${bundle.finding.findingId}`, bundle.validation.auditId, expectedAuditId);
  });

  const branchSlug = state.branchKind === "root" ? undefined : state.branchSlug;
  const updatedAt = maxIsoTimestamp(snapshot.audit.updatedAt, state.updatedAt);

  return AuditArtifactSnapshotSchema.parse({
    ...snapshot,
    audit: {
      ...snapshot.audit,
      auditId: expectedAuditId,
      branchKind: state.branchKind,
      ...(branchSlug ? { branchSlug } : {}),
      focus: state.focus,
      updatedAt,
    },
    scope: {
      ...snapshot.scope,
      auditId: expectedAuditId,
      focus: state.focus,
      updatedAt: maxIsoTimestamp(snapshot.scope.updatedAt, updatedAt),
    },
    findings: snapshot.findings.map((bundle) => ({
      finding: {
        ...bundle.finding,
        auditId: expectedAuditId,
      },
      triage: {
        ...bundle.triage,
        auditId: expectedAuditId,
      },
      validation: {
        ...bundle.validation,
        auditId: expectedAuditId,
      },
    })),
  });
}

function parseStoredAuditArtifactSnapshot(
  entry: PiCustomEntryLike,
  state: RestoredAuditState,
): AuditArtifactSnapshot {
  const result = AuditArtifactSnapshotSchema.safeParse(entry.data);
  if (!result.success) {
    throw new Error(`Stored audit snapshot entry ${entry.id} is invalid: ${formatIssues(result.error.issues)}.`);
  }

  const snapshot = result.data;
  assertAuditId("audit", snapshot.audit.auditId, state.auditId, entry.id);
  assertAuditId("scope", snapshot.scope.auditId, state.auditId, entry.id);

  if (snapshot.audit.focus !== state.focus || snapshot.scope.focus !== state.focus) {
    throw new Error(
      `Stored audit snapshot entry ${entry.id} focus \`${snapshot.audit.focus}\` does not match current audit focus \`${state.focus}\`.`,
    );
  }

  snapshot.findings.forEach((bundle) => {
    assertAuditId(`finding ${bundle.finding.findingId}`, bundle.finding.auditId, state.auditId, entry.id);
    assertAuditId(`triage ${bundle.finding.findingId}`, bundle.triage.auditId, state.auditId, entry.id);
    assertAuditId(`validation ${bundle.finding.findingId}`, bundle.validation.auditId, state.auditId, entry.id);
  });

  return snapshot;
}

function assertAuditId(label: string, actual: string, expected: string, entryId?: string): void {
  if (actual === expected) {
    return;
  }

  const subject = entryId ? `Stored audit snapshot entry ${entryId}` : "Audit snapshot";
  throw new Error(`${subject} ${label} auditId \`${actual}\` does not match current branch audit \`${expected}\`.`);
}

function formatIssues(issues: readonly ZodIssue[]): string {
  return issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}

function maxIsoTimestamp(left: string, right: string): string {
  const normalizedLeft = normalizeIsoTimestamp(left);
  const normalizedRight = normalizeIsoTimestamp(right);
  return Date.parse(normalizedLeft) >= Date.parse(normalizedRight) ? normalizedLeft : normalizedRight;
}
