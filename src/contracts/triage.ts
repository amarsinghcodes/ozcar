import { z } from "zod";

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
