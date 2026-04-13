import {
  AuditArtifactSnapshot,
  AuditArtifactSnapshotSchema,
  FindingsExportDocument,
  FindingsExportDocumentSchema,
} from "../contracts/export";
import { sortValidatedBundles } from "./shared";

export function buildFindingsExportDocument(snapshot: AuditArtifactSnapshot): FindingsExportDocument {
  const normalizedSnapshot = AuditArtifactSnapshotSchema.parse(snapshot);
  const validated = sortValidatedBundles(normalizedSnapshot.findings);

  return FindingsExportDocumentSchema.parse({
    schemaVersion: 1,
    audit: {
      auditId: normalizedSnapshot.audit.auditId,
      focus: normalizedSnapshot.audit.focus,
      status: normalizedSnapshot.audit.status,
    },
    scope: {
      notes: [...normalizedSnapshot.scope.notes],
      objectives: [...normalizedSnapshot.scope.objectives],
      targets: [...normalizedSnapshot.scope.targets],
    },
    generatedAt: deriveFindingsExportTimestamp(validated, normalizedSnapshot.audit.createdAt),
    findings: validated.map((bundle) => ({
      findingId: bundle.finding.findingId,
      title: bundle.finding.title,
      summary: bundle.finding.summary,
      severity: bundle.finding.severity,
      affectedCode: [...bundle.finding.locations],
      ...(bundle.finding.rootCause ? { rootCause: bundle.finding.rootCause } : {}),
      ...(bundle.finding.whatGoesWrong ? { whatGoesWrong: bundle.finding.whatGoesWrong } : {}),
      ...(bundle.finding.impact ? { impact: bundle.finding.impact } : {}),
      triageDisposition: bundle.triage.disposition,
      validationOutcome: bundle.validation.outcome,
      labels: {
        auditId: normalizedSnapshot.audit.auditId,
      },
    })),
  });
}

export function deriveFindingsExportTimestamp(
  validated: ReadonlyArray<AuditArtifactSnapshot["findings"][number]>,
  fallbackTimestamp: string,
): string {
  if (validated.length === 0) {
    return fallbackTimestamp;
  }

  const timestamps = validated.flatMap((bundle) => [
    bundle.finding.createdAt,
    bundle.finding.updatedAt,
    bundle.triage.triagedAt,
    bundle.validation.validatedAt,
  ]);

  let latest = timestamps[0];
  let latestTime = Date.parse(latest);

  for (const timestamp of timestamps.slice(1)) {
    const nextTime = Date.parse(timestamp);
    if (nextTime > latestTime) {
      latest = timestamp;
      latestTime = nextTime;
    }
  }

  return latest;
}
