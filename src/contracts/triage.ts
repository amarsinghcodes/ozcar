import { z } from "zod";

import { AuditIdSchema } from "./audit";
import { FindingIdSchema } from "./finding";
import { ScanIdSchema } from "./plan";
import { IsoTimestampSchema, RunIdSchema } from "./run";

export const TriageDispositionSchema = z.enum(["pending", "rejected", "confirmed"]);
export type TriageDisposition = z.infer<typeof TriageDispositionSchema>;

export const TriageContractSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  loop: z.number().int().positive(),
  scanId: ScanIdSchema,
  findingId: FindingIdSchema,
  disposition: TriageDispositionSchema,
  rationale: z.string().trim().min(1),
  triagedAt: IsoTimestampSchema,
});

export type TriageContract = z.infer<typeof TriageContractSchema>;

export const StoredTriageSchema = z.object({
  schemaVersion: z.literal(1),
  auditId: AuditIdSchema,
  findingId: FindingIdSchema,
  disposition: TriageDispositionSchema,
  rationale: z.string().trim().min(1),
  source: z.string().trim().min(1),
  triagedAt: IsoTimestampSchema,
});

export type StoredTriage = z.infer<typeof StoredTriageSchema>;
