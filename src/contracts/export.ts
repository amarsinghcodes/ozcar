import { z } from "zod";

import {
  AuditIdSchema,
  AuditStatusSchema,
  ReportedAuditMetricsSchema,
  StoredAuditSchema,
  StoredAuditScopeSchema,
} from "./audit";
import { IsoTimestampSchema } from "./run";
import { SeveritySchema, StoredFindingSchema } from "./finding";
import { TriageDispositionSchema, StoredTriageSchema } from "./triage";
import { StoredFindingBundleSchema, StoredValidationSchema, ValidationOutcomeSchema } from "./validation";

export const AuditArtifactSnapshotSchema = z
  .object({
    audit: StoredAuditSchema,
    scope: StoredAuditScopeSchema,
    findings: z.array(StoredFindingBundleSchema),
  })
  .superRefine((snapshot, ctx) => {
    if (snapshot.scope.auditId !== snapshot.audit.auditId) {
      ctx.addIssue({
        code: "custom",
        message: `scope.auditId must match audit.auditId ${snapshot.audit.auditId}.`,
        path: ["scope", "auditId"],
      });
    }

    if (snapshot.scope.focus !== snapshot.audit.focus) {
      ctx.addIssue({
        code: "custom",
        message: "scope.focus must match audit.focus.",
        path: ["scope", "focus"],
      });
    }

    const findingIds = new Set<string>();
    snapshot.findings.forEach((bundle, index) => {
      if (bundle.finding.auditId !== snapshot.audit.auditId) {
        ctx.addIssue({
          code: "custom",
          message: `finding.auditId must match audit.auditId ${snapshot.audit.auditId}.`,
          path: ["findings", index, "finding", "auditId"],
        });
      }

      if (bundle.triage.auditId !== snapshot.audit.auditId) {
        ctx.addIssue({
          code: "custom",
          message: `triage.auditId must match audit.auditId ${snapshot.audit.auditId}.`,
          path: ["findings", index, "triage", "auditId"],
        });
      }

      if (bundle.validation.auditId !== snapshot.audit.auditId) {
        ctx.addIssue({
          code: "custom",
          message: `validation.auditId must match audit.auditId ${snapshot.audit.auditId}.`,
          path: ["findings", index, "validation", "auditId"],
        });
      }

      if (findingIds.has(bundle.finding.findingId)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate finding id ${bundle.finding.findingId}.`,
          path: ["findings", index, "finding", "findingId"],
        });
        return;
      }

      findingIds.add(bundle.finding.findingId);
    });
  });
export type AuditArtifactSnapshot = z.infer<typeof AuditArtifactSnapshotSchema>;

export const FindingsExportFindingSchema = z.object({
  findingId: StoredFindingSchema.shape.findingId,
  title: StoredFindingSchema.shape.title,
  summary: StoredFindingSchema.shape.summary,
  severity: SeveritySchema,
  affectedCode: z.array(z.string().trim().min(1)),
  rootCause: StoredFindingSchema.shape.rootCause,
  whatGoesWrong: StoredFindingSchema.shape.whatGoesWrong,
  impact: StoredFindingSchema.shape.impact,
  triageDisposition: TriageDispositionSchema,
  validationOutcome: ValidationOutcomeSchema,
  labels: z.record(z.string(), z.string()).default({}),
});
export type FindingsExportFinding = z.infer<typeof FindingsExportFindingSchema>;

export const FindingsExportDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  audit: z.object({
    auditId: AuditIdSchema,
    focus: z.string().trim().min(1),
    status: AuditStatusSchema,
  }),
  scope: z.object({
    targets: StoredAuditScopeSchema.shape.targets,
    objectives: StoredAuditScopeSchema.shape.objectives,
    notes: StoredAuditScopeSchema.shape.notes,
  }),
  generatedAt: IsoTimestampSchema,
  reportedMetrics: ReportedAuditMetricsSchema.optional(),
  findings: z.array(FindingsExportFindingSchema),
});
export type FindingsExportDocument = z.infer<typeof FindingsExportDocumentSchema>;

export type StoredAuditArtifacts = {
  audit: z.infer<typeof StoredAuditSchema>;
  scope: z.infer<typeof StoredAuditScopeSchema>;
  findings: Array<z.infer<typeof StoredFindingBundleSchema>>;
};

export type StoredArtifactContracts = {
  finding: z.infer<typeof StoredFindingSchema>;
  triage: z.infer<typeof StoredTriageSchema>;
  validation: z.infer<typeof StoredValidationSchema>;
};
