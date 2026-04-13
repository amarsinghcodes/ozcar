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
