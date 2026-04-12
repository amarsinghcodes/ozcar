import { z } from "zod";

import { PlannedScanSchema } from "./plan";
import { ScanFindingSchema } from "./scan";
import { IsoTimestampSchema } from "./run";
import { ProviderNameSchema, ProviderPhaseSchema, ProviderSelectionSchema } from "../providers/base";

export const ProviderAuthStatusSchema = z.enum(["ready", "missing", "unknown"]);
export type ProviderAuthStatus = z.infer<typeof ProviderAuthStatusSchema>;

export const ProviderPreflightCheckSchema = z.object({
  code: z.enum(["binary", "version", "auth"]),
  message: z.string().trim().min(1),
  ok: z.boolean(),
});

export const ProviderPreflightSchema = z.object({
  schemaVersion: z.literal(1),
  createdAt: IsoTimestampSchema,
  provider: z.object({
    name: ProviderNameSchema,
    selection: ProviderSelectionSchema,
  }),
  command: z.string().trim().min(1),
  detected: z.boolean(),
  ok: z.boolean(),
  version: z.string().trim().min(1).nullable(),
  auth: z.object({
    message: z.string().trim().min(1),
    status: ProviderAuthStatusSchema,
  }),
  checks: z.array(ProviderPreflightCheckSchema).min(1),
  guidance: z.array(z.string().trim().min(1)),
});

export const ProviderExecutionArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  attempt: z.number().int().positive(),
  phase: ProviderPhaseSchema,
  provider: z.object({
    model: z.string().trim().min(1),
    name: ProviderNameSchema,
    selection: ProviderSelectionSchema,
  }),
  invocation: z.object({
    args: z.array(z.string()),
    command: z.string().trim().min(1),
    cwd: z.string().trim().min(1),
  }),
  artifacts: z.object({
    promptFile: z.string().trim().min(1),
    responseFile: z.string().trim().min(1),
    schemaFile: z.string().trim().min(1),
    stderrFile: z.string().trim().min(1),
    stdoutFile: z.string().trim().min(1),
  }),
  result: z.object({
    completedAt: IsoTimestampSchema,
    durationMs: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    failureCode: z.string().trim().min(1).nullable(),
    failureMessage: z.string().trim().min(1).nullable(),
    retryable: z.boolean(),
    signal: z.string().trim().min(1).nullable(),
    startedAt: IsoTimestampSchema,
    status: z.enum(["succeeded", "failed"]),
  }),
  parse: z.object({
    format: z.string().trim().min(1),
    issues: z.array(z.string().trim().min(1)),
    ok: z.boolean(),
    rawTextBytes: z.number().int().nonnegative(),
    sourceFile: z.string().trim().min(1),
    wrapperPath: z.string().trim().min(1).nullable(),
  }),
});

export const LivePlanResponseSchema = z.object({
  objectives: z.array(z.string().trim().min(1)).min(1),
  scans: z.array(PlannedScanSchema).min(1),
});

export const LiveScanResponseSchema = z.object({
  findings: z.array(ScanFindingSchema),
  summary: z.string().trim().min(1),
});

export type ProviderPreflight = z.infer<typeof ProviderPreflightSchema>;
export type ProviderExecutionArtifact = z.infer<typeof ProviderExecutionArtifactSchema>;
export type LivePlanResponse = z.infer<typeof LivePlanResponseSchema>;
export type LiveScanResponse = z.infer<typeof LiveScanResponseSchema>;

const plannedScanSchema = {
  additionalProperties: false,
  properties: {
    researchDirection: {
      minLength: 1,
      type: "string",
    },
    scanId: {
      pattern: "^\\d{4}$",
      type: "string",
    },
    targets: {
      items: {
        minLength: 1,
        type: "string",
      },
      minItems: 1,
      type: "array",
    },
  },
  required: ["scanId", "researchDirection", "targets"],
  type: "object",
} as const;

const scanFindingSchema = {
  additionalProperties: false,
  properties: {
    id: {
      minLength: 1,
      type: "string",
    },
    locations: {
      items: {
        minLength: 1,
        type: "string",
      },
      type: "array",
    },
    rationale: {
      minLength: 1,
      type: "string",
    },
    severity: {
      enum: ["critical", "high", "medium", "low"],
      type: "string",
    },
    title: {
      minLength: 1,
      type: "string",
    },
  },
  required: ["id", "title", "severity", "rationale", "locations"],
  type: "object",
} as const;

export const LIVE_PLAN_RESPONSE_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  additionalProperties: false,
  properties: {
    objectives: {
      items: {
        minLength: 1,
        type: "string",
      },
      minItems: 1,
      type: "array",
    },
    scans: {
      items: plannedScanSchema,
      minItems: 1,
      type: "array",
    },
  },
  required: ["objectives", "scans"],
  type: "object",
} as const;

export const LIVE_SCAN_RESPONSE_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  additionalProperties: false,
  properties: {
    findings: {
      items: scanFindingSchema,
      type: "array",
    },
    summary: {
      minLength: 1,
      type: "string",
    },
  },
  required: ["findings", "summary"],
  type: "object",
} as const;
