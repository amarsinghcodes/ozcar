import { z } from "zod";

import { FindingContractSchema, FindingIdSchema } from "./finding";
import { ScanIdSchema } from "./plan";
import { TriageContractSchema } from "./triage";
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

export const FindingDecisionBundleSchema = z.object({
  finding: FindingContractSchema,
  triage: TriageContractSchema,
  validation: ValidationContractSchema,
});

export type FindingDecisionBundle = z.infer<typeof FindingDecisionBundleSchema>;
