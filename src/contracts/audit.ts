import { z } from "zod";

import { IsoTimestampSchema } from "./run";

export const AuditIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Audit ids may only contain letters, numbers, dot, underscore, and dash.");
export type AuditId = z.infer<typeof AuditIdSchema>;

export const AuditBranchKindSchema = z.enum(["abandoned", "confirmed", "hypothesis", "root"]);
export type AuditBranchKind = z.infer<typeof AuditBranchKindSchema>;

export const AuditStatusSchema = z.enum(["active", "completed"]);
export type AuditStatus = z.infer<typeof AuditStatusSchema>;

const NonNegativeFiniteNumberSchema = z.number().finite().nonnegative();
const NonNegativeIntegerSchema = z.number().int().nonnegative();

const ReportedAuditMetricsValueSchema = z.object({
  durationSeconds: NonNegativeFiniteNumberSchema.optional(),
  costUsd: NonNegativeFiniteNumberSchema.optional(),
  inputTokens: NonNegativeIntegerSchema.optional(),
  outputTokens: NonNegativeIntegerSchema.optional(),
});
export type ReportedAuditMetrics = z.infer<typeof ReportedAuditMetricsValueSchema>;

export function normalizeReportedAuditMetrics(
  metrics: ReportedAuditMetrics | undefined,
): ReportedAuditMetrics | undefined {
  if (!metrics) {
    return undefined;
  }

  const normalized = {
    ...(metrics.durationSeconds !== undefined ? { durationSeconds: metrics.durationSeconds } : {}),
    ...(metrics.costUsd !== undefined ? { costUsd: metrics.costUsd } : {}),
    ...(metrics.inputTokens !== undefined ? { inputTokens: metrics.inputTokens } : {}),
    ...(metrics.outputTokens !== undefined ? { outputTokens: metrics.outputTokens } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export const ReportedAuditMetricsSchema = ReportedAuditMetricsValueSchema.transform((metrics) =>
  normalizeReportedAuditMetrics(metrics),
);

export const StoredAuditSchema = z
  .object({
    schemaVersion: z.literal(1),
    auditId: AuditIdSchema,
    focus: z.string().trim().min(1),
    status: AuditStatusSchema,
    branchKind: AuditBranchKindSchema,
    branchSlug: AuditIdSchema.optional(),
    source: z.string().trim().min(1),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    reportedMetrics: ReportedAuditMetricsSchema.optional(),
  })
  .superRefine((audit, ctx) => {
    if (audit.branchKind !== "root" && !audit.branchSlug) {
      ctx.addIssue({
        code: "custom",
        message: `branchSlug is required when branchKind is ${audit.branchKind}.`,
        path: ["branchSlug"],
      });
    }

    if (audit.branchKind === "root" && audit.branchSlug) {
      ctx.addIssue({
        code: "custom",
        message: "branchSlug must be omitted when branchKind is root.",
        path: ["branchSlug"],
      });
    }
  });
export type StoredAudit = z.infer<typeof StoredAuditSchema>;

export const StoredAuditScopeSchema = z.object({
  schemaVersion: z.literal(1),
  auditId: AuditIdSchema,
  focus: z.string().trim().min(1),
  targets: z.array(z.string().trim().min(1)).default([]),
  objectives: z.array(z.string().trim().min(1)).default([]),
  notes: z.array(z.string().trim().min(1)).default([]),
  updatedAt: IsoTimestampSchema,
});
export type StoredAuditScope = z.infer<typeof StoredAuditScopeSchema>;
