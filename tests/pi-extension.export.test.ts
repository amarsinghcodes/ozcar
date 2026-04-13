import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OZCAR_AUDIT_EXPORT_COMMAND,
  OZCAR_AUDIT_ARTIFACT_SNAPSHOT_CUSTOM_TYPE,
  OZCAR_STORE_AUDIT_SNAPSHOT_TOOL,
  createAuditRuntimeState,
  registerAuditExportCommand,
  registerAuditArtifactSnapshotTool,
  type PiCommandRegistrationLike,
  type PiToolDefinitionLike,
} from "../.pi/extensions/ozcar/index";
import type { AuditArtifactSnapshot } from "../src/contracts/export";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      fs.rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("ozcar Phase 6 export command", () => {
  it("materializes audit artifacts from Pi-backed stored snapshot state", async () => {
    const workspaceRoot = await createWorkspace();
    const snapshot = createAuditSnapshot();
    const runtime = createActiveRuntimeState("payments-vault", "Investigate payments vault invariants");
    const harness = createHarness(workspaceRoot);
    registerPhase4Surfaces(harness, runtime);

    const tool = harness.toolRegistry.get(OZCAR_STORE_AUDIT_SNAPSHOT_TOOL);
    await tool?.execute(
      "tool-1",
      {
        snapshot,
      },
      undefined,
      undefined,
      harness.ctx,
    );

    expect(harness.allEntries.at(-1)).toMatchObject({
      customType: OZCAR_AUDIT_ARTIFACT_SNAPSHOT_CUSTOM_TYPE,
      data: expect.objectContaining({
        audit: expect.objectContaining({
          auditId: "payments-vault",
          focus: "Investigate payments vault invariants",
        }),
      }),
      type: "custom",
    });

    const command = harness.commandRegistry.get(OZCAR_AUDIT_EXPORT_COMMAND);
    await command?.handler("", harness.ctx);

    const exportFile = path.join(
      workspaceRoot,
      ".ai-auditor",
      "audits",
      "payments-vault",
      "exports",
      "findings.json",
    );
    const payload = JSON.parse(await fs.readFile(exportFile, "utf8")) as { findings: Array<{ findingId: string }> };

    expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Materialized stable export surface"),
      "success",
    );
    expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Downstream comparison input: .ai-auditor/audits/payments-vault/exports/findings.json"),
      "success",
    );
    expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("validated findings only"),
      "success",
    );
    expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("provider/model/time budget separately"),
      "success",
    );
    expect(payload.findings.map((finding) => finding.findingId)).toEqual(["reentrant-withdraw"]);
  });

  it("warns when the current branch has no stored audit snapshot", async () => {
    const workspaceRoot = await createWorkspace();
    const runtime = createActiveRuntimeState("payments-vault", "Investigate payments vault invariants");
    const harness = createHarness(workspaceRoot);
    registerPhase4Surfaces(harness, runtime);

    const command = harness.commandRegistry.get(OZCAR_AUDIT_EXPORT_COMMAND);
    await command?.handler("", harness.ctx);

    await expect(
      fs.access(path.join(workspaceRoot, ".ai-auditor", "audits", "payments-vault", "audit.json")),
    ).rejects.toBeDefined();
    expect(harness.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("No validated audit snapshot is stored"), "warning");
  });

  it("fails closed when the latest stored snapshot belongs to another audit", async () => {
    const workspaceRoot = await createWorkspace();
    const runtime = createActiveRuntimeState("authorization-audit", "Investigate auth invariants");
    const harness = createHarness(workspaceRoot);
    registerPhase4Surfaces(harness, runtime);

    harness.appendCustomEntry(OZCAR_AUDIT_ARTIFACT_SNAPSHOT_CUSTOM_TYPE, createAuditSnapshot());

    const command = harness.commandRegistry.get(OZCAR_AUDIT_EXPORT_COMMAND);
    await command?.handler("", harness.ctx);

    await expect(
      fs.access(path.join(workspaceRoot, ".ai-auditor", "audits", "authorization-audit", "audit.json")),
    ).rejects.toBeDefined();
    expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("does not match current branch audit"),
      "warning",
    );
  });
});

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-pi-export-"));
  tempRoots.push(workspaceRoot);
  return workspaceRoot;
}

function createActiveRuntimeState(auditId: string, focus: string): ReturnType<typeof createAuditRuntimeState> {
  const runtime = createAuditRuntimeState();
  runtime.current = {
    auditId,
    branchKind: "root",
    focus,
    schemaVersion: 1,
    source: "command:start",
    updatedAt: "2026-04-12T20:09:00.000Z",
  };
  return runtime;
}

function createHarness(workspaceRoot: string) {
  const allEntries: Array<{
    customType: string;
    data?: unknown;
    id: string;
    parentId: string | null;
    timestamp: string;
    type: "custom";
  }> = [];
  const entryById = new Map(allEntries.map((entry) => [entry.id, entry]));
  const commandRegistry = new Map<string, PiCommandRegistrationLike>();
  const toolRegistry = new Map<string, PiToolDefinitionLike>();
  let currentLeafId: string | null = null;
  let nextId = 0;

  const sessionManager = {
    getBranch(fromId?: string) {
      const branch: typeof allEntries = [];
      let current = (fromId ?? currentLeafId) ? entryById.get(fromId ?? currentLeafId!) : undefined;

      while (current) {
        branch.unshift(current);
        current = current.parentId ? entryById.get(current.parentId) : undefined;
      }

      return branch;
    },
    getEntries() {
      return [...allEntries];
    },
    getEntry(id: string) {
      return entryById.get(id);
    },
    getLabel() {
      return undefined;
    },
    getLeafId() {
      return currentLeafId;
    },
  };

  const ctx = {
    cwd: workspaceRoot,
    isIdle: () => true,
    sessionManager,
    ui: {
      notify: vi.fn(),
    },
  };

  return {
    allEntries,
    appendCustomEntry(customType: string, data?: unknown) {
      const entry = {
        customType,
        data,
        id: `e${nextId += 1}`,
        parentId: currentLeafId,
        timestamp: `2026-04-12T20:30:${String(nextId).padStart(2, "0")}Z`,
        type: "custom" as const,
      };
      allEntries.push(entry);
      entryById.set(entry.id, entry);
      currentLeafId = entry.id;
      return entry;
    },
    commandRegistry,
    ctx,
    pi: {
      appendEntry(customType: string, data?: unknown) {
        return undefined;
      },
      registerCommand(name: string, options: PiCommandRegistrationLike) {
        commandRegistry.set(name, options);
      },
      registerTool(tool: PiToolDefinitionLike) {
        toolRegistry.set(tool.name, tool);
      },
    },
    toolRegistry,
  };
}

function registerPhase4Surfaces(
  harness: ReturnType<typeof createHarness>,
  runtime: ReturnType<typeof createAuditRuntimeState>,
): void {
  registerAuditExportCommand(
    {
      registerCommand(name, options) {
        harness.commandRegistry.set(name, options);
      },
    },
    runtime,
  );

  registerAuditArtifactSnapshotTool(
    {
      appendEntry(customType, data) {
        harness.appendCustomEntry(customType, data);
      },
      registerTool(tool) {
        harness.toolRegistry.set(tool.name, tool);
      },
    },
    runtime,
  );
}

function createAuditSnapshot(): AuditArtifactSnapshot {
  return {
    audit: {
      schemaVersion: 1,
      auditId: "payments-vault",
      focus: "Investigate payments vault invariants",
      status: "completed",
      branchKind: "root",
      source: "validated-snapshot",
      createdAt: "2026-04-12T20:00:00.000Z",
      updatedAt: "2026-04-12T20:08:00.000Z",
    },
    scope: {
      schemaVersion: 1,
      auditId: "payments-vault",
      focus: "Investigate payments vault invariants",
      targets: ["src/Vault.sol"],
      objectives: ["Confirm withdraw safety"],
      notes: [],
      updatedAt: "2026-04-12T20:03:00.000Z",
    },
    findings: [
      {
        finding: {
          schemaVersion: 1,
          auditId: "payments-vault",
          findingId: "reentrant-withdraw",
          title: "Reentrant withdraw path",
          severity: "critical",
          summary: "The withdraw callback can reenter before the nonce is burned.",
          locations: ["src/WithdrawRouter.sol:18"],
          source: "validated-snapshot",
          createdAt: "2026-04-12T20:00:00.000Z",
          updatedAt: "2026-04-12T20:01:00.000Z",
        },
        triage: {
          schemaVersion: 1,
          auditId: "payments-vault",
          findingId: "reentrant-withdraw",
          disposition: "confirmed",
          rationale: "The callback is attacker-controlled.",
          source: "validated-snapshot",
          triagedAt: "2026-04-12T20:05:00.000Z",
        },
        validation: {
          schemaVersion: 1,
          auditId: "payments-vault",
          findingId: "reentrant-withdraw",
          outcome: "validated",
          validator: "phase4-test",
          rationale: "Trace review confirmed the nonce burn is late.",
          validatedAt: "2026-04-12T20:08:00.000Z",
        },
      },
    ],
  };
}
