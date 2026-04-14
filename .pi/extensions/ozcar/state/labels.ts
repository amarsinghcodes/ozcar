import { createHash } from "node:crypto";

import type { PiReadonlySessionManagerLike, PiSessionEntryLike } from "../types";

export const AUDIT_LABEL_PREFIX = "audit";
export const FOCUS_DERIVED_AUDIT_ID_MAX_LENGTH = 64;

const FOCUS_DERIVED_AUDIT_ID_HASH_LENGTH = 10;
const FOCUS_DERIVED_AUDIT_ID_SEPARATOR = "-";
const FOCUS_DERIVED_AUDIT_ID_PREFIX_LENGTH =
  FOCUS_DERIVED_AUDIT_ID_MAX_LENGTH -
  FOCUS_DERIVED_AUDIT_ID_HASH_LENGTH -
  FOCUS_DERIVED_AUDIT_ID_SEPARATOR.length;

export const AUDIT_LABELED_BRANCH_KINDS = ["abandoned", "confirmed", "hypothesis"] as const;
export type AuditLabeledBranchKind = (typeof AUDIT_LABELED_BRANCH_KINDS)[number];

export interface ParsedAuditLabel {
  kind: AuditLabeledBranchKind;
  label: string;
  slug: string;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeAuditSlug(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveAuditId(focus: string): string {
  const slug = normalizeAuditSlug(focus);
  if (!slug) {
    return "";
  }

  if (slug.length <= FOCUS_DERIVED_AUDIT_ID_MAX_LENGTH) {
    return slug;
  }

  const hash = createHash("sha256").update(slug).digest("hex").slice(0, FOCUS_DERIVED_AUDIT_ID_HASH_LENGTH);
  const prefix = slug.slice(0, FOCUS_DERIVED_AUDIT_ID_PREFIX_LENGTH).replace(/[-._]+$/g, "");

  return prefix ? `${prefix}${FOCUS_DERIVED_AUDIT_ID_SEPARATOR}${hash}` : hash;
}

export function buildAuditLabel(kind: AuditLabeledBranchKind, slug: string): string {
  const normalizedSlug = normalizeAuditSlug(slug);
  if (!normalizedSlug) {
    throw new Error(`Cannot build an audit label for ${kind} without a slug.`);
  }
  return `${AUDIT_LABEL_PREFIX}:${kind}:${normalizedSlug}`;
}

export function parseAuditLabel(label: string | undefined): ParsedAuditLabel | undefined {
  if (!label) {
    return undefined;
  }

  const match = new RegExp(`^${AUDIT_LABEL_PREFIX}:(abandoned|confirmed|hypothesis):(.+)$`).exec(label);
  if (!match) {
    return undefined;
  }

  const slug = normalizeAuditSlug(match[2] ?? "");
  if (!slug) {
    return undefined;
  }

  return {
    kind: match[1] as AuditLabeledBranchKind,
    label,
    slug,
  };
}

export function formatAuditBranch(branchKind: "abandoned" | "confirmed" | "hypothesis" | "root", branchSlug?: string): string {
  if (!branchSlug || branchKind === "root") {
    return branchKind;
  }
  return `${branchKind}:${branchSlug}`;
}

export function resolveAuditLabelTargetId(sessionManager: PiReadonlySessionManagerLike): string | undefined {
  const branch = sessionManager.getBranch();

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!entry || entry.type === "custom" || entry.type === "label") {
      continue;
    }
    return entry.id;
  }

  return branch[branch.length - 1]?.id;
}

export function buildAuditAbandonedSummaryInstructions(options: {
  auditId: string;
  branchSlug?: string;
  branchKind: "abandoned" | "confirmed" | "hypothesis" | "root";
  focus: string;
  note?: string;
}): string {
  const summarySubject =
    options.branchKind === "confirmed"
      ? "the confirmed finding branch"
      : options.branchKind === "hypothesis"
        ? "the hypothesis branch"
        : "the audit branch";
  const qualifier = options.branchSlug ? ` identified by \`${options.branchSlug}\`` : "";
  const noteLine = options.note ? ` Preserve this branch note: ${options.note}.` : "";

  return [
    `Summarize ${summarySubject}${qualifier} for the ozcar audit session \`${options.auditId}\`.`,
    `Keep the summary terse and tree-friendly. Include the focus, strongest evidence, and why the branch is being parked before switching.`,
    `Audit focus: ${options.focus}.${noteLine}`,
  ].join(" ");
}

export function renderAuditConventions(): string[] {
  return [
    `Hypotheses: ${buildAuditLabel("hypothesis", "<slug>")}`,
    `Confirmed findings: ${buildAuditLabel("confirmed", "<finding-id>")}`,
    `Abandoned tree summaries: ${buildAuditLabel("abandoned", "<slug>")}`,
  ];
}

export function findLatestAuditLabel(
  sessionManager: PiReadonlySessionManagerLike,
  branch: PiSessionEntryLike[],
  matches?: (parsed: ParsedAuditLabel, entry: PiSessionEntryLike) => boolean,
): { entry: PiSessionEntryLike; index: number; parsed: ParsedAuditLabel } | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!entry) {
      continue;
    }

    const parsed = parseAuditLabel(sessionManager.getLabel(entry.id));
    if (parsed && (!matches || matches(parsed, entry))) {
      return { entry, index, parsed };
    }
  }

  return undefined;
}
