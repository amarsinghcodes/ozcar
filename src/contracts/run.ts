import { z } from "zod";

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

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
