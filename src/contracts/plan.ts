import { z } from "zod";

import { ProviderNameSchema, ProviderSelectionSchema } from "../providers/base";
import { IsoTimestampSchema, RunIdSchema } from "./run";

export const ScanIdSchema = z
  .string()
  .regex(/^\d{4}$/u, "Expected a zero-padded 4-digit scan id.");

export const PlanProviderSchema = z.object({
  available: z.boolean(),
  model: z.string().trim().min(1),
  name: ProviderNameSchema,
  selection: ProviderSelectionSchema,
});

export const PlannedScanSchema = z.object({
  researchDirection: z.string().trim().min(1),
  scanId: ScanIdSchema,
  targets: z.array(z.string().trim().min(1)).min(1),
});

export const PlanContractSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  loop: z.number().int().positive(),
  createdAt: IsoTimestampSchema,
  mode: z.enum(["dry-run", "live"]).default("dry-run"),
  scope: z.array(z.string().trim().min(1)).min(1),
  objectives: z.array(z.string().trim().min(1)).min(1),
  provider: PlanProviderSchema,
  scans: z.array(PlannedScanSchema).min(1),
});

export type PlanContract = z.infer<typeof PlanContractSchema>;
export type PlannedScan = z.infer<typeof PlannedScanSchema>;
