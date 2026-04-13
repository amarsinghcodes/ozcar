import { z } from "zod";

import { AuditIdSchema } from "./audit";
import { ScanIdSchema } from "./plan";
import { IsoTimestampSchema, RunIdSchema } from "./run";

export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Finding ids may only contain letters, numbers, dot, underscore, and dash.");
export type FindingId = z.infer<typeof FindingIdSchema>;

export const FindingContractSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  loop: z.number().int().positive(),
  scanId: ScanIdSchema,
  findingId: FindingIdSchema,
  title: z.string().trim().min(1),
  severity: SeveritySchema,
  summary: z.string().trim().min(1),
  locations: z.array(z.string().trim().min(1)),
  createdAt: IsoTimestampSchema,
});

export type FindingContract = z.infer<typeof FindingContractSchema>;

export const StoredFindingSchema = z.object({
  schemaVersion: z.literal(1),
  auditId: AuditIdSchema,
  findingId: FindingIdSchema,
  title: z.string().trim().min(1),
  severity: SeveritySchema,
  summary: z.string().trim().min(1),
  locations: z.array(z.string().trim().min(1)).default([]),
  rootCause: z.string().trim().min(1).optional(),
  whatGoesWrong: z.string().trim().min(1).optional(),
  impact: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export type StoredFinding = z.infer<typeof StoredFindingSchema>;
