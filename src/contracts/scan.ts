import { z } from "zod";

import { ProviderNameSchema, ProviderSelectionSchema } from "../providers/base";
import { FindingIdSchema, SeveritySchema } from "./finding";
import { ScanIdSchema } from "./plan";
import { IsoTimestampSchema, RunIdSchema } from "./run";

export const ScanProviderSchema = z.object({
  available: z.boolean(),
  model: z.string().trim().min(1),
  name: ProviderNameSchema,
  selection: ProviderSelectionSchema,
});

export const ScanFindingSchema = z.object({
  id: FindingIdSchema,
  locations: z.array(z.string().trim().min(1)),
  rationale: z.string().trim().min(1),
  severity: SeveritySchema,
  title: z.string().trim().min(1),
});

export const ScanRequestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  loop: z.number().int().positive(),
  scanId: ScanIdSchema,
  createdAt: IsoTimestampSchema,
  dryRun: z.boolean(),
  objectives: z.array(z.string().trim().min(1)).min(1),
  promptSource: z.string().trim().min(1),
  provider: ScanProviderSchema,
  researchDirection: z.string().trim().min(1),
  scope: z.array(z.string().trim().min(1)).min(1),
  targetRoot: z.string().trim().min(1),
  targets: z.array(z.string().trim().min(1)).min(1),
  dryRunFindings: z.array(ScanFindingSchema).optional(),
});

export const ScanOutputSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  loop: z.number().int().positive(),
  scanId: ScanIdSchema,
  createdAt: IsoTimestampSchema,
  findings: z.array(ScanFindingSchema),
  mode: z.enum(["dry-run"]),
  summary: z.string().trim().min(1),
});

export type ScanRequest = z.infer<typeof ScanRequestSchema>;
export type ScanFinding = z.infer<typeof ScanFindingSchema>;
export type ScanOutput = z.infer<typeof ScanOutputSchema>;
