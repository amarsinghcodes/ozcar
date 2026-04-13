import { describe, expect, it, vi } from "vitest";

import {
  OZCAR_AUDIT_BRANCH_COMMAND,
  OZCAR_AUDIT_BRANCH_TOOL,
  OZCAR_AUDIT_RESUME_COMMAND,
  OZCAR_AUDIT_START_COMMAND,
  OZCAR_AUDIT_STATE_COMMAND,
  OZCAR_AUDIT_STATE_CUSTOM_TYPE,
  FOCUS_DERIVED_AUDIT_ID_MAX_LENGTH,
  buildAuditLabel,
  normalizeAuditSlug,
  parseAuditBranchArgs,
  parseAuditBranchToolParams,
  parseAuditStartArgs,
  registerOzcarExtension,
  resolveOzcarPaths,
  restoreAuditStateFromBranch,
  type PiCommandRegistrationLike,
  type PiExtensionApiLike,
  type PiBranchSummaryEntryLike,
  type PiSessionBeforeTreeEventLike,
  type PiSessionEntryLike,
  type PiSessionBeforeTreeResultLike,
  type PiToolDefinitionLike,
} from "../.pi/extensions/ozcar/index";
import { getAuditArtifactPaths } from "../src/artifacts/store";

function createRepoPaths() {
  return resolveOzcarPaths(new URL("../.pi/extensions/ozcar/index.ts", import.meta.url).href);
}

function createAssistantEntry(id: string, parentId: string | null, text: string = "assistant note"): PiSessionEntryLike {
  return {
    id,
    message: {
      content: [
        {
          text,
          type: "text",
        },
      ],
      role: "assistant",
    },
    parentId,
    timestamp: `2026-04-12T20:00:0${id.length}Z`,
    type: "message",
  };
}

function createCustomEntry(
  id: string,
  parentId: string | null,
  data: unknown,
  customType: string = OZCAR_AUDIT_STATE_CUSTOM_TYPE,
): PiSessionEntryLike {
  return {
    customType,
    data,
    id,
    parentId,
    timestamp: `2026-04-12T20:10:0${id.length}Z`,
    type: "custom",
  };
}

function createBranchSummaryEntry(id: string, parentId: string | null, summary: string): PiSessionEntryLike {
  return {
    fromId: parentId ?? "root",
    id,
    parentId,
    summary,
    timestamp: `2026-04-12T20:20:0${id.length}Z`,
    type: "branch_summary",
  };
}

function createHarness(options: {
  entries?: PiSessionEntryLike[];
  labels?: Record<string, string>;
  leafId?: string | null;
} = {}) {
  const allEntries = [...(options.entries ?? [])];
  const entryById = new Map(allEntries.map((entry) => [entry.id, entry]));
  const labels = new Map(Object.entries(options.labels ?? {}));
  const commandRegistry = new Map<string, PiCommandRegistrationLike>();
  const eventRegistry = new Map<string, Array<(event: unknown, ctx: unknown) => Promise<unknown> | unknown>>();
  const toolRegistry = new Map<string, PiToolDefinitionLike>();
  let currentLeafId = options.leafId ?? allEntries[allEntries.length - 1]?.id ?? null;
  let nextId = allEntries.length + 1;
  let sessionName: string | undefined;

  const ui = {
    notify: vi.fn(),
    setEditorText: vi.fn(),
    setStatus: vi.fn(),
    setWidget: vi.fn(),
  };

  const sessionManager = {
    getBranch(fromId?: string) {
      const path: PiSessionEntryLike[] = [];
      let current = (fromId ?? currentLeafId) ? entryById.get(fromId ?? currentLeafId!) : undefined;

      while (current) {
        path.unshift(current);
        current = current.parentId ? entryById.get(current.parentId) : undefined;
      }

      return path;
    },
    getEntries() {
      return [...allEntries];
    },
    getEntry(id: string) {
      return entryById.get(id);
    },
    getLeafId() {
      return currentLeafId;
    },
    getLabel(id: string) {
      return labels.get(id);
    },
  };

  const ctx = {
    cwd: "/Users/x/ozcar",
    isIdle: () => true,
    sessionManager,
    ui,
  };

  const pi: PiExtensionApiLike = {
    appendEntry(customType, data) {
      const id = `e${nextId += 1}`;
      const entry: PiSessionEntryLike = {
        customType,
        data,
        id,
        parentId: currentLeafId,
        timestamp: `2026-04-12T21:00:${String(nextId).padStart(2, "0")}Z`,
        type: "custom",
      };
      allEntries.push(entry);
      entryById.set(id, entry);
      currentLeafId = id;
    },
    on(event, handler) {
      const handlers = eventRegistry.get(event) ?? [];
      handlers.push(handler);
      eventRegistry.set(event, handlers);
    },
    registerCommand(name, options) {
      commandRegistry.set(name, options);
    },
    registerTool(tool) {
      toolRegistry.set(tool.name, tool);
    },
    setLabel(entryId, label) {
      if (!label) {
        labels.delete(entryId);
        return;
      }
      labels.set(entryId, label);
    },
    setSessionName(name) {
      sessionName = name;
    },
  };

  return {
    addEntry(entry: PiSessionEntryLike) {
      allEntries.push(entry);
      entryById.set(entry.id, entry);
      currentLeafId = entry.id;
    },
    allEntries,
    commandRegistry,
    ctx,
    eventRegistry,
    labels,
    pi,
    sessionManager,
    setLeaf(entryId: string | null) {
      currentLeafId = entryId;
    },
    sessionName: () => sessionName,
    toolRegistry,
    async emitSessionBeforeTree(event: PiSessionBeforeTreeEventLike): Promise<PiSessionBeforeTreeResultLike | undefined> {
      const handlers = eventRegistry.get("session_before_tree") ?? [];
      let result: PiSessionBeforeTreeResultLike | undefined;

      for (const handler of handlers) {
        const nextResult = (await handler(event, ctx)) as PiSessionBeforeTreeResultLike | undefined;
        if (nextResult) {
          result = nextResult;
        }
      }

      return result;
    },
    async emitSessionStart(reason: "fork" | "new" | "reload" | "resume" | "startup" = "startup"): Promise<void> {
      const handlers = eventRegistry.get("session_start") ?? [];
      for (const handler of handlers) {
        await handler(
          {
            reason,
            type: "session_start",
          },
          ctx,
        );
      }
    },
    async emitSessionTree(
      newLeafId: string | null,
      oldLeafId: string | null,
      summaryEntry?: PiBranchSummaryEntryLike,
    ): Promise<void> {
      const handlers = eventRegistry.get("session_tree") ?? [];
      currentLeafId = newLeafId;
      for (const handler of handlers) {
        await handler(
          {
            newLeafId,
            oldLeafId,
            ...(summaryEntry ? { summaryEntry } : {}),
            type: "session_tree",
          },
          ctx,
        );
      }
    },
  };
}

describe("ozcar Phase 3 audit workflow", () => {
  it("parses start and branch command arguments into stable audit ids and labels", () => {
    expect(parseAuditStartArgs("Investigate balance accounting invariants")).toEqual({
      auditId: "investigate-balance-accounting-invariants",
      focus: "Investigate balance accounting invariants",
    });
    expect(parseAuditStartArgs("payments-vault :: Investigate balance accounting invariants")).toEqual({
      auditId: "payments-vault",
      focus: "Investigate balance accounting invariants",
    });
    expect(parseAuditStartArgs("   ")).toBeUndefined();

    expect(parseAuditBranchArgs("hypothesis balance invariant :: Track a missing balance invariant")).toEqual({
      kind: "hypothesis",
      note: "Track a missing balance invariant",
      slug: "balance-invariant",
    });
    expect(parseAuditBranchArgs("confirmed confirmed-high")).toEqual({
      kind: "confirmed",
      slug: "confirmed-high",
    });
    expect(parseAuditBranchArgs("abandoned false positive")).toBeUndefined();
    expect(parseAuditBranchArgs("branch unknown")).toBeUndefined();
    expect(parseAuditBranchToolParams({ kind: "confirmed", note: "Keep it", slug: "confirmed high" })).toEqual({
      kind: "confirmed",
      note: "Keep it",
      slug: "confirmed-high",
    });
    expect(parseAuditBranchToolParams({ kind: "abandoned", note: "Park it", slug: "false positive" })).toBeUndefined();
  });

  it("derives distinct audit roots for long similar focuses that used to collide under truncation", () => {
    const sharedFocusPrefix =
      "Investigate payments vault invariants around withdrawal callback ordering and nonce accounting for collision regression coverage";
    const focusA = `${sharedFocusPrefix} alpha branch evidence`;
    const focusB = `${sharedFocusPrefix} beta branch evidence`;

    const normalizedA = normalizeAuditSlug(focusA);
    const normalizedB = normalizeAuditSlug(focusB);

    expect(normalizedA.slice(0, FOCUS_DERIVED_AUDIT_ID_MAX_LENGTH)).toBe(
      normalizedB.slice(0, FOCUS_DERIVED_AUDIT_ID_MAX_LENGTH),
    );

    const parsedA = parseAuditStartArgs(focusA);
    const parsedB = parseAuditStartArgs(focusB);

    expect(parsedA).toBeDefined();
    expect(parsedB).toBeDefined();
    expect(parsedA?.auditId).not.toBe(parsedB?.auditId);
    expect(parsedA?.auditId.length).toBeLessThanOrEqual(FOCUS_DERIVED_AUDIT_ID_MAX_LENGTH);
    expect(parsedB?.auditId.length).toBeLessThanOrEqual(FOCUS_DERIVED_AUDIT_ID_MAX_LENGTH);
    expect(
      getAuditArtifactPaths("/Users/x/ozcar", parsedA?.auditId ?? "").auditRoot,
    ).not.toBe(getAuditArtifactPaths("/Users/x/ozcar", parsedB?.auditId ?? "").auditRoot);
  });

  it("starts an audit, marks a hypothesis branch, and reports restored state through commands", async () => {
    const harness = createHarness({
      entries: [createAssistantEntry("a1", null)],
    });

    registerOzcarExtension(harness.pi, createRepoPaths());

    await harness.commandRegistry.get(OZCAR_AUDIT_START_COMMAND)?.handler("Payments vault invariants", harness.ctx);

    expect(harness.sessionName()).toBe("ozcar audit: payments-vault-invariants");
    expect(harness.allEntries.at(-1)).toMatchObject({
      customType: OZCAR_AUDIT_STATE_CUSTOM_TYPE,
      data: expect.objectContaining({
        auditId: "payments-vault-invariants",
        branchKind: "root",
      }),
      type: "custom",
    });

    await harness.commandRegistry
      .get(OZCAR_AUDIT_BRANCH_COMMAND)
      ?.handler("hypothesis balance invariant :: Track missing balance invariant", harness.ctx);

    expect(harness.labels.get("a1")).toBe(buildAuditLabel("hypothesis", "balance-invariant"));
    expect(harness.allEntries.at(-1)).toMatchObject({
      customType: OZCAR_AUDIT_STATE_CUSTOM_TYPE,
      data: expect.objectContaining({
        auditId: "payments-vault-invariants",
        branchKind: "hypothesis",
        branchSlug: "balance-invariant",
      }),
      type: "custom",
    });

    await harness.commandRegistry.get(OZCAR_AUDIT_STATE_COMMAND)?.handler("", harness.ctx);

    expect(harness.ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Branch: hypothesis:balance-invariant"),
      "info",
    );
  });

  it("restores abandoned summary state from the active tree branch and ignores stale older labels or summaries", () => {
    const rootState = createCustomEntry("s1", null, {
      auditId: "payments-vault",
      branchKind: "root",
      focus: "Investigate accounting invariants",
      schemaVersion: 1,
      source: "command:start",
      updatedAt: "2026-04-12T20:00:00.000Z",
    });
    const abandonedSummary = createBranchSummaryEntry("b1", "s1", "Hypothesis could not reproduce after switching branches.");
    const abandonedHarness = createHarness({
      entries: [rootState, abandonedSummary],
      labels: {
        b1: buildAuditLabel("abandoned", "balance-invariant"),
      },
      leafId: "b1",
    });

    expect(restoreAuditStateFromBranch(abandonedHarness.sessionManager)).toMatchObject({
      auditId: "payments-vault",
      branchKind: "abandoned",
      branchSlug: "balance-invariant",
      label: buildAuditLabel("abandoned", "balance-invariant"),
      summary: "Hypothesis could not reproduce after switching branches.",
    });

    const staleLabelHarness = createHarness({
      entries: [
        createAssistantEntry("a1", null),
        createCustomEntry("h1", "a1", {
          auditId: "payments-vault",
          branchKind: "hypothesis",
          branchSlug: "balance-invariant",
          focus: "Investigate accounting invariants",
          schemaVersion: 1,
          source: "command:branch",
          updatedAt: "2026-04-12T20:10:00.000Z",
        }),
        createCustomEntry("s2", "h1", {
          auditId: "new-audit",
          branchKind: "root",
          focus: "Investigate authorization invariants",
          schemaVersion: 1,
          source: "command:start",
          updatedAt: "2026-04-12T20:20:00.000Z",
        }),
      ],
      labels: {
        a1: buildAuditLabel("hypothesis", "balance-invariant"),
      },
      leafId: "s2",
    });

    expect(restoreAuditStateFromBranch(staleLabelHarness.sessionManager)).toMatchObject({
      auditId: "new-audit",
      branchKind: "root",
      focus: "Investigate authorization invariants",
    });

    const staleSummaryHarness = createHarness({
      entries: [
        createCustomEntry("r1", null, {
          auditId: "payments-vault",
          branchKind: "root",
          focus: "Investigate accounting invariants",
          schemaVersion: 1,
          source: "command:start",
          updatedAt: "2026-04-12T20:00:00.000Z",
        }),
        createBranchSummaryEntry("b2", "r1", "The parked branch did not reproduce."),
        createCustomEntry("r2", "b2", {
          auditId: "new-audit",
          branchKind: "root",
          focus: "Investigate authorization invariants",
          schemaVersion: 1,
          source: "command:start",
          updatedAt: "2026-04-12T20:30:00.000Z",
        }),
      ],
      labels: {
        b2: buildAuditLabel("abandoned", "balance-invariant"),
      },
      leafId: "r2",
    });

    expect(restoreAuditStateFromBranch(staleSummaryHarness.sessionManager)).toMatchObject({
      auditId: "new-audit",
      branchKind: "root",
      focus: "Investigate authorization invariants",
    });
  });

  it("adds abandoned-branch summary conventions for /tree when a hypothesis branch is active", async () => {
    const harness = createHarness({
      entries: [createAssistantEntry("a1", null)],
    });

    registerOzcarExtension(harness.pi, createRepoPaths());
    await harness.commandRegistry.get(OZCAR_AUDIT_START_COMMAND)?.handler("Payments vault invariants", harness.ctx);
    await harness.commandRegistry
      .get(OZCAR_AUDIT_BRANCH_COMMAND)
      ?.handler("hypothesis balance invariant :: Track missing balance invariant", harness.ctx);

    const result = await harness.emitSessionBeforeTree({
      preparation: {
        commonAncestorId: "a1",
        entriesToSummarize: [],
        oldLeafId: harness.sessionManager.getLeafId(),
        targetId: "a1",
        userWantsSummary: true,
      },
      type: "session_before_tree",
    });

    expect(result).toMatchObject({
      label: buildAuditLabel("abandoned", "balance-invariant"),
      replaceInstructions: false,
    });
    expect(result?.customInstructions).toContain("Summarize the hypothesis branch");
    expect(result?.customInstructions).toContain("Payments vault invariants");
  });

  it("uses the ozcar_audit_branch tool to checkpoint a confirmed finding and reports missing-state errors deterministically", async () => {
    const missingStateHarness = createHarness({
      entries: [createAssistantEntry("a1", null)],
    });
    registerOzcarExtension(missingStateHarness.pi, createRepoPaths());

    const tool = missingStateHarness.toolRegistry.get(OZCAR_AUDIT_BRANCH_TOOL);
    const missingStateResult = await tool?.execute(
      "tool-1",
      {
        kind: "confirmed",
        slug: "confirmed-high",
      },
      undefined,
      undefined,
      missingStateHarness.ctx,
    );

    expect(missingStateResult?.content[0]?.text).toContain("Run /ozcar-audit-start first");

    const harness = createHarness({
      entries: [createAssistantEntry("a2", null)],
    });
    registerOzcarExtension(harness.pi, createRepoPaths());
    await harness.commandRegistry.get(OZCAR_AUDIT_START_COMMAND)?.handler("Payments vault invariants", harness.ctx);

    const confirmedResult = await harness.toolRegistry.get(OZCAR_AUDIT_BRANCH_TOOL)?.execute(
      "tool-2",
      {
        kind: "confirmed",
        note: "Validated missing balance invariant enforcement.",
        slug: "confirmed-high",
      },
      undefined,
      undefined,
      harness.ctx,
    );

    expect(harness.labels.get("a2")).toBe(buildAuditLabel("confirmed", "confirmed-high"));
    expect(confirmedResult).toMatchObject({
      content: [
        {
          text: expect.stringContaining("Recorded confirmed branch confirmed-high"),
          type: "text",
        },
      ],
      details: {
        auditId: "payments-vault-invariants",
        branchKind: "confirmed",
        branchSlug: "confirmed-high",
        label: buildAuditLabel("confirmed", "confirmed-high"),
      },
    });

    const invalidParamsResult = await harness.toolRegistry.get(OZCAR_AUDIT_BRANCH_TOOL)?.execute(
      "tool-3",
      {
        kind: "abandoned",
        slug: "false-positive",
      },
      undefined,
      undefined,
      harness.ctx,
    );

    expect(invalidParamsResult?.content[0]?.text).toContain("kind: hypothesis|confirmed");
  });

  it("persists abandoned summary state on session_tree and restores it on session_start", async () => {
    const harness = createHarness({
      entries: [createAssistantEntry("a1", null)],
    });
    registerOzcarExtension(harness.pi, createRepoPaths());

    await harness.commandRegistry.get(OZCAR_AUDIT_START_COMMAND)?.handler("Payments vault invariants", harness.ctx);
    await harness.commandRegistry
      .get(OZCAR_AUDIT_BRANCH_COMMAND)
      ?.handler("hypothesis balance invariant :: Track missing balance invariant", harness.ctx);

    const rootStateEntry = harness.allEntries.find(
      (entry) =>
        entry.type === "custom" &&
        entry.customType === OZCAR_AUDIT_STATE_CUSTOM_TYPE &&
        (entry.data as { branchKind?: string }).branchKind === "root",
    );
    const hypothesisStateEntry = harness.allEntries.at(-1);
    expect(rootStateEntry).toBeDefined();
    expect(hypothesisStateEntry).toBeDefined();

    const summaryEntry = createBranchSummaryEntry(
      "b-summary",
      rootStateEntry?.id ?? null,
      "Hypothesis could not reproduce after switching branches.",
    ) as PiBranchSummaryEntryLike;
    harness.addEntry(summaryEntry);
    harness.labels.set(summaryEntry.id, buildAuditLabel("abandoned", "balance-invariant"));

    await harness.emitSessionTree(summaryEntry.id, hypothesisStateEntry?.id ?? null, summaryEntry);
    await harness.commandRegistry.get(OZCAR_AUDIT_STATE_COMMAND)?.handler("", harness.ctx);

    expect(harness.allEntries.at(-1)).toMatchObject({
      customType: OZCAR_AUDIT_STATE_CUSTOM_TYPE,
      data: expect.objectContaining({
        auditId: "payments-vault-invariants",
        branchKind: "abandoned",
        branchSlug: "balance-invariant",
        source: "session:tree-summary",
      }),
      parentId: summaryEntry.id,
      type: "custom",
    });
    expect(harness.ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Branch: abandoned:balance-invariant"),
      "info",
    );
    expect(harness.ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Branch summary: Hypothesis could not reproduce after switching branches."),
      "info",
    );

    harness.ctx.ui.setStatus.mockClear();
    await harness.emitSessionStart("reload");
    expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
      "ozcar-audit",
      "payments-vault-invariants [abandoned:balance-invariant]",
    );

    await harness.commandRegistry.get(OZCAR_AUDIT_RESUME_COMMAND)?.handler("", harness.ctx);
    expect(harness.ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Current branch: abandoned (balance-invariant)"),
      "info",
    );
  });
});
