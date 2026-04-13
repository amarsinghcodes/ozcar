import { z } from "zod";

import { AuditIdSchema } from "./audit";
import { FindingContractSchema, FindingIdSchema, StoredFindingSchema } from "./finding";
import { ScanIdSchema } from "./plan";
import { StoredTriageSchema, TriageContractSchema } from "./triage";
import { IsoTimestampSchema, RunIdSchema } from "./run";

export const ValidationOutcomeSchema = z.enum(["pending", "validated", "rejected"]);
export type ValidationOutcome = z.infer<typeof ValidationOutcomeSchema>;

export const ValidationContractSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  loop: z.number().int().positive(),
  scanId: ScanIdSchema,
  findingId: FindingIdSchema,
  outcome: ValidationOutcomeSchema,
  validator: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  validatedAt: IsoTimestampSchema,
});

export type ValidationContract = z.infer<typeof ValidationContractSchema>;

export const StoredValidationSchema = z.object({
  schemaVersion: z.literal(1),
  auditId: AuditIdSchema,
  findingId: FindingIdSchema,
  outcome: ValidationOutcomeSchema,
  validator: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  validatedAt: IsoTimestampSchema,
});

export type StoredValidation = z.infer<typeof StoredValidationSchema>;

export const FindingDecisionBundleSchema = z.object({
  finding: FindingContractSchema,
  triage: TriageContractSchema,
  validation: ValidationContractSchema,
});

export type FindingDecisionBundle = z.infer<typeof FindingDecisionBundleSchema>;

export const StoredFindingBundleSchema = z
  .object({
    finding: StoredFindingSchema,
    triage: StoredTriageSchema,
    validation: StoredValidationSchema,
  })
  .superRefine((bundle, ctx) => {
    if (bundle.finding.auditId !== bundle.triage.auditId || bundle.finding.auditId !== bundle.validation.auditId) {
      ctx.addIssue({
        code: "custom",
        message: "auditId must match across finding, triage, and validation.",
        path: ["finding", "auditId"],
      });
    }

    if (
      bundle.finding.findingId !== bundle.triage.findingId ||
      bundle.finding.findingId !== bundle.validation.findingId
    ) {
      ctx.addIssue({
        code: "custom",
        message: "findingId must match across finding, triage, and validation.",
        path: ["finding", "findingId"],
      });
    }

    if (bundle.validation.outcome === "validated" && bundle.triage.disposition !== "confirmed") {
      ctx.addIssue({
        code: "custom",
        message: "validated findings require triage disposition confirmed.",
        path: ["validation", "outcome"],
      });
    }
  });

export type StoredFindingBundle = z.infer<typeof StoredFindingBundleSchema>;
