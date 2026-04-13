import { z } from "zod";

import { AuditIdSchema } from "./audit";
import { FindingIdSchema, StoredFindingSchema } from "./finding";
import { StoredTriageSchema } from "./triage";
import { IsoTimestampSchema } from "./run";

export const ValidationOutcomeSchema = z.enum(["pending", "validated", "rejected"]);
export type ValidationOutcome = z.infer<typeof ValidationOutcomeSchema>;

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
