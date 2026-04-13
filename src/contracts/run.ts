import { z } from "zod";

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export const RunIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Run ids may only contain letters, numbers, dot, underscore, and dash.");

export function normalizeIsoTimestamp(value: string): string {
  const trimmed = value.trim();

  if (!ISO_TIMESTAMP_PATTERN.test(trimmed)) {
    throw new Error("Expected an ISO-8601 timestamp");
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Expected an ISO-8601 timestamp");
  }

  return date.toISOString();
}

export const IsoTimestampSchema = z
  .string()
  .trim()
  .refine(
    (value) => {
      try {
        normalizeIsoTimestamp(value);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "Expected an ISO-8601 timestamp",
    },
  )
  .transform((value) => normalizeIsoTimestamp(value));

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
