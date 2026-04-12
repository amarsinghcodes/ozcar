import { z } from "zod";

export const RunIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Run ids may only contain letters, numbers, dot, underscore, and dash.");

export const IsoTimestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO-8601 timestamp",
});

export const PhaseNameSchema = z.enum(["plan", "scan", "triage", "validate", "summarize"]);
export type PhaseName = z.infer<typeof PhaseNameSchema>;

export const RunStatusSchema = z.enum(["initialized", "running", "completed", "failed"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunRecordSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  targetRoot: z.string().min(1),
  status: RunStatusSchema,
  currentPhase: PhaseNameSchema.nullable(),
  activeLoop: z.number().int().nonnegative(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export type RunRecord = z.infer<typeof RunRecordSchema>;
