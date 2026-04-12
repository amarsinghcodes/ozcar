import type {
  PiExtensionApiLike,
  PiBranchSummaryEntryLike,
  PiCustomEntryLike,
  PiExtensionContextLike,
  PiReadonlySessionManagerLike,
  PiSessionBeforeTreeEventLike,
  PiSessionBeforeTreeResultLike,
} from "../types";
import {
  buildAuditAbandonedSummaryInstructions,
  buildAuditLabel,
  findLatestAuditLabel,
  formatAuditBranch,
  parseAuditLabel,
  resolveAuditLabelTargetId,
} from "./labels";

export const OZCAR_AUDIT_STATE_CUSTOM_TYPE = "ozcar-audit-state";
export const OZCAR_AUDIT_STATUS_KEY = "ozcar-audit";
export const OZCAR_AUDIT_WIDGET_KEY = "ozcar-audit";

export type AuditBranchKind = "abandoned" | "confirmed" | "hypothesis" | "root";
export type AuditCheckpointKind = Exclude<AuditBranchKind, "abandoned" | "root">;

export interface StoredAuditState {
  auditId: string;
  branchKind: AuditBranchKind;
  branchSlug?: string;
  focus: string;
  note?: string;
  schemaVersion: 1;
  source: string;
  updatedAt: string;
}

export interface RestoredAuditState extends StoredAuditState {
  label?: string;
  summary?: string;
  targetEntryId?: string;
}

export interface AuditRuntimeState {
  current: RestoredAuditState | undefined;
}

interface MutableRecord {
  [key: string]: unknown;
}

export interface StartAuditStateOptions {
  auditId: string;
  focus: string;
  note?: string;
  source: string;
  updatedAt?: string;
}

export interface MarkAuditBranchOptions {
  kind: AuditCheckpointKind;
  note?: string;
  slug: string;
  source: string;
  updatedAt?: string;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null;
}

function isAuditBranchKind(value: unknown): value is AuditBranchKind {
  return value === "abandoned" || value === "confirmed" || value === "hypothesis" || value === "root";
}

export function createAuditRuntimeState(): AuditRuntimeState {
  return {
    current: undefined,
  };
}

export function createStoredAuditState(options: {
  auditId: string;
  branchKind: AuditBranchKind;
  branchSlug?: string;
  focus: string;
  note?: string;
  source: string;
  updatedAt?: string;
}): StoredAuditState {
  const auditId = normalizeText(options.auditId);
  const focus = normalizeText(options.focus);
  const branchSlug = options.branchSlug ? normalizeText(options.branchSlug) : undefined;
  const note = options.note ? normalizeText(options.note) : undefined;

  if (!auditId) {
    throw new Error("Audit id is required.");
  }

  if (!focus) {
    throw new Error("Audit focus is required.");
  }

  return {
    auditId,
    branchKind: options.branchKind,
    ...(branchSlug ? { branchSlug } : {}),
    focus,
    ...(note ? { note } : {}),
    schemaVersion: 1,
    source: options.source,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
  };
}

export function restoreAuditStateFromBranch(
  sessionManager: PiReadonlySessionManagerLike,
): RestoredAuditState | undefined {
  const branch = sessionManager.getBranch();
  let current: StoredAuditState | undefined;
  let currentIndex = -1;

  for (const [index, entry] of branch.entries()) {
    if (entry.type !== "custom") {
      continue;
    }

    const customEntry = entry as PiCustomEntryLike;
    if (customEntry.customType !== OZCAR_AUDIT_STATE_CUSTOM_TYPE) {
      continue;
    }

    if (isStoredAuditState(customEntry.data)) {
      current = customEntry.data;
      currentIndex = index;
    }
  }

  if (!current) {
    return undefined;
  }

  const restored: RestoredAuditState = {
    ...current,
    ...(current.branchKind !== "root" && current.branchSlug
      ? {
          label: buildAuditLabel(current.branchKind, current.branchSlug),
        }
      : {}),
  };

  const latestMatchingStateLabel =
    current.branchKind === "root" || !current.branchSlug
      ? undefined
      : findLatestAuditLabel(
          sessionManager,
          branch,
          (parsed) =>
            parsed.kind === current.branchKind &&
            normalizeText(parsed.slug) === normalizeText(current.branchSlug ?? ""),
        );

  if (latestMatchingStateLabel) {
    restored.label = latestMatchingStateLabel.parsed.label;
    restored.targetEntryId = latestMatchingStateLabel.entry.id;

    if (latestMatchingStateLabel.entry.type === "branch_summary") {
      restored.summary = (latestMatchingStateLabel.entry as PiBranchSummaryEntryLike).summary;
    }
  }

  const latestBranchSummaryLabel = findLatestAuditLabel(
    sessionManager,
    branch,
    (_parsed, entry) => entry.type === "branch_summary",
  );
  if (
    latestBranchSummaryLabel &&
    latestBranchSummaryLabel.entry.type === "branch_summary" &&
    latestBranchSummaryLabel.index > currentIndex
  ) {
    restored.branchKind = latestBranchSummaryLabel.parsed.kind;
    restored.branchSlug = latestBranchSummaryLabel.parsed.slug;
    restored.label = latestBranchSummaryLabel.parsed.label;
    restored.summary = (latestBranchSummaryLabel.entry as PiBranchSummaryEntryLike).summary;
    restored.targetEntryId = latestBranchSummaryLabel.entry.id;
  }

  return restored;
}

export function syncAuditRuntimeState(
  pi: Pick<PiExtensionApiLike, "setSessionName">,
  runtime: AuditRuntimeState,
  ctx: PiExtensionContextLike,
): RestoredAuditState | undefined {
  const state = restoreAuditStateFromBranch(ctx.sessionManager);
  runtime.current = state;
  applyAuditUi(pi, ctx, state);
  return state;
}

export function persistSummarizedAuditState(
  pi: Pick<PiExtensionApiLike, "appendEntry">,
  runtime: AuditRuntimeState,
  ctx: PiExtensionContextLike,
  summaryEntry: PiBranchSummaryEntryLike,
): RestoredAuditState | undefined {
  const parsedLabel = parseAuditLabel(ctx.sessionManager.getLabel(summaryEntry.id));
  if (!parsedLabel || parsedLabel.kind !== "abandoned") {
    return undefined;
  }

  const current = runtime.current ?? restoreAuditStateFromBranch(ctx.sessionManager);
  if (!current) {
    return undefined;
  }

  const stored = createStoredAuditState({
    auditId: current.auditId,
    branchKind: parsedLabel.kind,
    branchSlug: parsedLabel.slug,
    focus: current.focus,
    source: "session:tree-summary",
    ...(current.note ? { note: current.note } : {}),
    updatedAt: summaryEntry.timestamp,
  });

  pi.appendEntry(OZCAR_AUDIT_STATE_CUSTOM_TYPE, stored);
  runtime.current = {
    ...stored,
    label: parsedLabel.label,
    summary: summaryEntry.summary,
    targetEntryId: summaryEntry.id,
  };

  return runtime.current;
}

export function getCurrentAuditState(
  runtime: AuditRuntimeState,
  sessionManager: PiReadonlySessionManagerLike,
): RestoredAuditState | undefined {
  return runtime.current ?? restoreAuditStateFromBranch(sessionManager);
}

export function startAuditSession(
  pi: Pick<PiExtensionApiLike, "appendEntry" | "setSessionName">,
  runtime: AuditRuntimeState,
  ctx: PiExtensionContextLike,
  options: StartAuditStateOptions,
): RestoredAuditState {
  const stored = createStoredAuditState({
    auditId: options.auditId,
    branchKind: "root",
    focus: options.focus,
    source: options.source,
    ...(options.note ? { note: options.note } : {}),
    ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
  });

  pi.appendEntry(OZCAR_AUDIT_STATE_CUSTOM_TYPE, stored);
  return setRuntimeAuditState(pi, runtime, ctx, stored);
}

export function markAuditBranch(
  pi: Pick<PiExtensionApiLike, "appendEntry" | "setLabel" | "setSessionName">,
  runtime: AuditRuntimeState,
  ctx: PiExtensionContextLike,
  options: MarkAuditBranchOptions,
): {
  label: string;
  state: RestoredAuditState;
  targetEntryId?: string;
} {
  const current = getCurrentAuditState(runtime, ctx.sessionManager);
  if (!current) {
    throw new Error("No ozcar audit state is active on this branch. Run /ozcar-audit-start first.");
  }

  const stored = createStoredAuditState({
    auditId: current.auditId,
    branchKind: options.kind,
    branchSlug: options.slug,
    focus: current.focus,
    source: options.source,
    ...(options.note ? { note: options.note } : {}),
    ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
  });
  const label = buildAuditLabel(options.kind, stored.branchSlug ?? options.slug);
  const targetEntryId = resolveAuditLabelTargetId(ctx.sessionManager);

  if (targetEntryId) {
    pi.setLabel(targetEntryId, label);
  }

  pi.appendEntry(OZCAR_AUDIT_STATE_CUSTOM_TYPE, stored);

  const state = setRuntimeAuditState(pi, runtime, ctx, {
    ...stored,
    label,
    ...(targetEntryId ? { targetEntryId } : {}),
  });

  return {
    label,
    state,
    ...(targetEntryId ? { targetEntryId } : {}),
  };
}

export function buildAuditTreeConventionResult(
  runtime: AuditRuntimeState,
  ctx: PiExtensionContextLike,
  event: PiSessionBeforeTreeEventLike,
): PiSessionBeforeTreeResultLike | undefined {
  if (!event.preparation.userWantsSummary) {
    return undefined;
  }

  const state = getCurrentAuditState(runtime, ctx.sessionManager);
  if (!state || state.branchKind === "abandoned" || state.branchKind === "root") {
    return undefined;
  }

  const abandonedLabel = buildAuditLabel("abandoned", state.branchSlug ?? state.auditId);
  const auditInstructions = buildAuditAbandonedSummaryInstructions({
    auditId: state.auditId,
    branchKind: state.branchKind,
    focus: state.focus,
    ...(state.branchSlug ? { branchSlug: state.branchSlug } : {}),
    ...(state.note ? { note: state.note } : {}),
  });
  const existingInstructions = event.preparation.customInstructions?.trim();

  return {
    customInstructions: existingInstructions
      ? `${existingInstructions}\n\n${auditInstructions}`
      : auditInstructions,
    label: abandonedLabel,
    replaceInstructions: false,
  };
}

export function renderAuditStateSummary(state: RestoredAuditState, includeConventions: boolean = false): string {
  const lines = [
    `Audit: ${state.auditId}`,
    `Focus: ${state.focus}`,
    `Branch: ${formatAuditBranch(state.branchKind, state.branchSlug)}`,
    `Updated: ${state.updatedAt}`,
  ];

  if (state.label) {
    lines.push(`Label: ${state.label}`);
  }

  if (state.note) {
    lines.push(`Note: ${state.note}`);
  }

  if (state.summary) {
    lines.push(`Branch summary: ${state.summary}`);
  }

  if (includeConventions) {
    lines.push("Tree conventions:");
    lines.push("- hypotheses => audit:hypothesis:<slug>");
    lines.push("- confirmed findings => audit:confirmed:<finding-id>");
    lines.push("- abandoned summaries => audit:abandoned:<slug>");
  }

  return lines.join("\n");
}

export function renderMissingAuditStateMessage(): string {
  return [
    "No ozcar audit state is active on this branch.",
    "Run /ozcar-audit-start <focus> to initialize the Phase 3 audit workflow.",
  ].join("\n");
}

function isStoredAuditState(value: unknown): value is StoredAuditState {
  if (!isRecord(value)) {
    return false;
  }

  if (value.schemaVersion !== 1) {
    return false;
  }

  if (typeof value.auditId !== "string" || normalizeText(value.auditId) === "") {
    return false;
  }

  if (typeof value.focus !== "string" || normalizeText(value.focus) === "") {
    return false;
  }

  if (!isAuditBranchKind(value.branchKind)) {
    return false;
  }

  if (value.branchSlug !== undefined && typeof value.branchSlug !== "string") {
    return false;
  }

  if (value.note !== undefined && typeof value.note !== "string") {
    return false;
  }

  if (typeof value.updatedAt !== "string" || normalizeText(value.updatedAt) === "") {
    return false;
  }

  if (typeof value.source !== "string" || normalizeText(value.source) === "") {
    return false;
  }

  return true;
}

function setRuntimeAuditState(
  pi: Pick<PiExtensionApiLike, "setSessionName">,
  runtime: AuditRuntimeState,
  ctx: PiExtensionContextLike,
  state: RestoredAuditState | StoredAuditState,
): RestoredAuditState {
  const restored: RestoredAuditState = {
    ...state,
    ...(state.branchKind !== "root" && state.branchSlug
      ? {
          label: buildAuditLabel(state.branchKind, state.branchSlug),
        }
      : {}),
  };

  runtime.current = restored;
  applyAuditUi(pi, ctx, restored);
  return restored;
}

function applyAuditUi(
  pi: Pick<PiExtensionApiLike, "setSessionName">,
  ctx: PiExtensionContextLike,
  state: RestoredAuditState | undefined,
): void {
  if (!state) {
    ctx.ui.setStatus?.(OZCAR_AUDIT_STATUS_KEY, undefined);
    ctx.ui.setWidget?.(OZCAR_AUDIT_WIDGET_KEY, undefined);
    return;
  }

  pi.setSessionName(`ozcar audit: ${state.auditId}`);
  ctx.ui.setStatus?.(OZCAR_AUDIT_STATUS_KEY, `${state.auditId} [${formatAuditBranch(state.branchKind, state.branchSlug)}]`);
  ctx.ui.setWidget?.(OZCAR_AUDIT_WIDGET_KEY, renderAuditWidget(state));
}

function renderAuditWidget(state: RestoredAuditState): string[] {
  const lines = [
    `Audit: ${state.auditId}`,
    `Focus: ${state.focus}`,
    `Branch: ${formatAuditBranch(state.branchKind, state.branchSlug)}`,
  ];

  if (state.label) {
    lines.push(`Label: ${state.label}`);
  }

  if (state.note) {
    lines.push(`Note: ${state.note}`);
  }

  return lines;
}
