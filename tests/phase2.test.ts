import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "../src/commands/run";
import { PlanContractSchema } from "../src/contracts/plan";
import { ScanOutputSchema, ScanRequestSchema } from "../src/contracts/scan";
import { PlanGateError, assertPlanGate } from "../src/gates/plan";
import { ScanGateError, assertScanGate } from "../src/gates/scan";
import { runPlanPhase } from "../src/phases/plan";
import { ScanPhaseProviderMismatchError, runScanPhase } from "../src/phases/scan";
import { resolveProvider } from "../src/providers/base";
import { readRunSnapshot } from "../src/store/run-store";

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

describe("phase 2 run seam", () => {
  it("emits loop 0001 plan.json and replayable scan artifacts", async () => {
    const workspaceRoot = await createWorkspace();
    const targetRoot = path.join(workspaceRoot, "target");

    await fs.mkdir(targetRoot, { recursive: true });
    await fs.writeFile(path.join(targetRoot, "Sample.sol"), "contract Sample {}", "utf8");

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await runCommand([
      "--root",
      workspaceRoot,
      "--target-root",
      targetRoot,
      "--run-id",
      "phase2-dry",
      "--provider",
      "claude",
      "--dry-run",
      "--scope",
      "Sample.sol",
      "--scan-target",
      "Sample.sol",
      "--research-direction",
      "Investigate balance accounting invariants.",
    ]);

    expect(exitCode).toBe(0);
    expect(consoleLog).toHaveBeenCalledOnce();

    const snapshot = await readRunSnapshot({
      runId: "phase2-dry",
      workspaceRoot,
    });

    expect(snapshot.run.activeLoop).toBe(1);
    expect(snapshot.run.currentPhase).toBe("summarize");
    expect(snapshot.run.status).toBe("completed");
    expect(snapshot.events.map((event) => event.type)).toEqual([
      "run.created",
      "provider.selected",
      "phase.plan.started",
      "phase.plan.completed",
      "phase.scan.started",
      "phase.scan.completed",
      "phase.triage.started",
      "phase.triage.completed",
      "phase.validate.started",
      "phase.validate.completed",
      "phase.summarize.started",
      "phase.summarize.completed",
    ]);

    const loopRoot = path.join(snapshot.paths.runRoot, "loops", "0001");
    const plan = PlanContractSchema.parse(
      JSON.parse(await fs.readFile(path.join(loopRoot, "plan.json"), "utf8")),
    );

    expect(plan.provider.name).toBe("claude");
    expect(plan.provider.selection).toBe("override");
    expect(typeof plan.provider.available).toBe("boolean");
    expect(plan.scans).toHaveLength(1);
    expect(plan.scans[0]?.scanId).toBe("0001");

    const promptText = await fs.readFile(path.join(loopRoot, "plan.prompt.md"), "utf8");
    expect(promptText).toContain("Investigate balance accounting invariants.");

    const scanRoot = path.join(loopRoot, "scans", "0001");
    const request = ScanRequestSchema.parse(
      JSON.parse(await fs.readFile(path.join(scanRoot, "request.json"), "utf8")),
    );
    const output = ScanOutputSchema.parse(
      JSON.parse(await fs.readFile(path.join(scanRoot, "output.json"), "utf8")),
    );
    const scanPrompt = await fs.readFile(path.join(scanRoot, "prompt.md"), "utf8");

    expect(request.promptSource).toBe("src/prompts/scanner.md");
    expect(request.targets).toEqual(["Sample.sol"]);
    expect(request.provider).toEqual(plan.provider);
    expect(output.mode).toBe("dry-run");
    expect(output.findings).toEqual([]);
    expect(output.summary).toContain("Sample.sol");
    expect(scanPrompt).toContain("Investigate balance accounting invariants.");

    await expect(fs.readFile(path.join(snapshot.paths.runRoot, "summary.md"), "utf8")).resolves.toContain(
      "Generated from validated finding artifacts only.",
    );
    await expect(
      fs.readFile(path.join(snapshot.paths.runRoot, "confirmed-findings.md"), "utf8"),
    ).resolves.toContain("No validated findings.");
  });

  it("preserves the planned provider snapshot across a separate scan invocation", async () => {
    const workspaceRoot = await createWorkspace();
    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", "phase2-separate");
    const provider = await resolveProvider({
      isCommandAvailable: async () => false,
      requested: "claude",
    });

    await fs.mkdir(runRoot, { recursive: true });

    const planResult = await runPlanPhase({
      dryRun: true,
      loop: 1,
      model: "custom-phase2-model",
      provider,
      researchDirection: "Investigate settlement edge cases.",
      runId: "phase2-separate",
      runRoot,
      scanTargets: ["Sample.sol"],
      scope: ["Sample.sol"],
      targetRoot: workspaceRoot,
    });

    const scanResults = await runScanPhase({
      dryRun: true,
      loop: 1,
      plan: planResult.plan,
      provider,
      runId: "phase2-separate",
      runRoot,
      targetRoot: workspaceRoot,
    });

    expect(scanResults).toHaveLength(1);

    const scanRoot = path.join(runRoot, "loops", "0001", "scans", "0001");
    const request = ScanRequestSchema.parse(
      JSON.parse(await fs.readFile(path.join(scanRoot, "request.json"), "utf8")),
    );
    const promptText = await fs.readFile(path.join(scanRoot, "prompt.md"), "utf8");

    expect(request.provider).toEqual(planResult.plan.provider);
    expect(request.provider.model).toBe("custom-phase2-model");
    expect(promptText).toContain("Provider: claude (selection=override, model=custom-phase2-model)");
  });

  it("rejects a separate scan invocation when the runtime provider drifts from plan.json", async () => {
    const workspaceRoot = await createWorkspace();
    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", "phase2-provider-drift");
    const plannedProvider = await resolveProvider({
      isCommandAvailable: async () => false,
      requested: "claude",
    });
    const driftedProvider = await resolveProvider({
      isCommandAvailable: async () => false,
      requested: "codex",
    });

    await fs.mkdir(runRoot, { recursive: true });

    const planResult = await runPlanPhase({
      dryRun: true,
      loop: 1,
      model: "custom-phase2-model",
      provider: plannedProvider,
      researchDirection: "Investigate settlement edge cases.",
      runId: "phase2-provider-drift",
      runRoot,
      scanTargets: ["Sample.sol"],
      scope: ["Sample.sol"],
      targetRoot: workspaceRoot,
    });

    await expect(
      runScanPhase({
        dryRun: true,
        loop: 1,
        plan: planResult.plan,
        provider: driftedProvider,
        runId: "phase2-provider-drift",
        runRoot,
        targetRoot: workspaceRoot,
      }),
    ).rejects.toBeInstanceOf(ScanPhaseProviderMismatchError);

    await expect(
      runScanPhase({
        dryRun: true,
        loop: 1,
        plan: planResult.plan,
        provider: driftedProvider,
        runId: "phase2-provider-drift",
        runRoot,
        targetRoot: workspaceRoot,
      }),
    ).rejects.toThrow(/plan\.json selected claude but the scan invocation requested codex/);
  });

  it("fails the plan gate deterministically when plan.json has the wrong run id", async () => {
    const workspaceRoot = await createWorkspace();
    const loopRoot = path.join(workspaceRoot, "loops", "0001");

    await fs.mkdir(loopRoot, { recursive: true });
    await fs.writeFile(path.join(loopRoot, "plan.prompt.md"), "# planner\n", "utf8");
    await fs.writeFile(
      path.join(loopRoot, "plan.json"),
      `${JSON.stringify(
        {
          createdAt: "2026-04-12T00:40:00.000Z",
          loop: 1,
          objectives: ["Keep it durable."],
          provider: {
            available: false,
            model: "claude-default",
            name: "claude",
            selection: "override",
          },
          runId: "wrong-run",
          scans: [
            {
              researchDirection: "Investigate state drift.",
              scanId: "0001",
              targets: ["Sample.sol"],
            },
          ],
          schemaVersion: 1,
          scope: ["Sample.sol"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      assertPlanGate({
        expectedLoop: 1,
        expectedRunId: "expected-run",
        loopRoot,
      }),
    ).rejects.toBeInstanceOf(PlanGateError);

    await expect(
      assertPlanGate({
        expectedLoop: 1,
        expectedRunId: "expected-run",
        loopRoot,
      }),
    ).rejects.toThrow(/expected runId expected-run but found wrong-run/);
  });

  it("fails the scan gate deterministically when output.json is missing", async () => {
    const workspaceRoot = await createWorkspace();
    const scanRoot = path.join(workspaceRoot, "loops", "0001", "scans", "0001");

    await fs.mkdir(scanRoot, { recursive: true });
    await fs.writeFile(path.join(scanRoot, "prompt.md"), "# scanner\n", "utf8");
    await fs.writeFile(
      path.join(scanRoot, "request.json"),
      `${JSON.stringify(
        {
          createdAt: "2026-04-12T00:41:00.000Z",
          dryRun: true,
          loop: 1,
          objectives: ["Emit replayable scan inputs."],
          promptSource: "src/prompts/scanner.md",
          provider: {
            available: false,
            model: "claude-default",
            name: "claude",
            selection: "override",
          },
          researchDirection: "Investigate state drift.",
          runId: "phase2-gate",
          scanId: "0001",
          schemaVersion: 1,
          scope: ["Sample.sol"],
          targetRoot: workspaceRoot,
          targets: ["Sample.sol"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      assertScanGate({
        expectedLoop: 1,
        expectedRunId: "phase2-gate",
        expectedScanId: "0001",
        scanRoot,
      }),
    ).rejects.toBeInstanceOf(ScanGateError);

    await expect(
      assertScanGate({
        expectedLoop: 1,
        expectedRunId: "phase2-gate",
        expectedScanId: "0001",
        scanRoot,
      }),
    ).rejects.toThrow(/missing required scan artifact output\.json/);
  });

  it("fails the scan gate deterministically when request.json drifts from plan.json provider snapshot", async () => {
    const workspaceRoot = await createWorkspace();
    const loopRoot = path.join(workspaceRoot, "loops", "0001");
    const scanRoot = path.join(loopRoot, "scans", "0001");

    await fs.mkdir(scanRoot, { recursive: true });
    await fs.writeFile(
      path.join(loopRoot, "plan.json"),
      `${JSON.stringify(
        {
          createdAt: "2026-04-12T00:42:00.000Z",
          loop: 1,
          objectives: ["Emit replayable scan inputs."],
          provider: {
            available: false,
            model: "custom-phase2-model",
            name: "claude",
            selection: "override",
          },
          runId: "phase2-gate-provider",
          scans: [
            {
              researchDirection: "Investigate state drift.",
              scanId: "0001",
              targets: ["Sample.sol"],
            },
          ],
          schemaVersion: 1,
          scope: ["Sample.sol"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(path.join(scanRoot, "prompt.md"), "# scanner\n", "utf8");
    await fs.writeFile(
      path.join(scanRoot, "request.json"),
      `${JSON.stringify(
        {
          createdAt: "2026-04-12T00:43:00.000Z",
          dryRun: true,
          loop: 1,
          objectives: ["Emit replayable scan inputs."],
          promptSource: "src/prompts/scanner.md",
          provider: {
            available: false,
            model: "codex-default",
            name: "codex",
            selection: "auto",
          },
          researchDirection: "Investigate state drift.",
          runId: "phase2-gate-provider",
          scanId: "0001",
          schemaVersion: 1,
          scope: ["Sample.sol"],
          targetRoot: workspaceRoot,
          targets: ["Sample.sol"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(scanRoot, "output.json"),
      `${JSON.stringify(
        {
          createdAt: "2026-04-12T00:43:00.000Z",
          findings: [],
          loop: 1,
          mode: "dry-run",
          runId: "phase2-gate-provider",
          scanId: "0001",
          schemaVersion: 1,
          summary: "Dry run prepared replayable scan inputs.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      assertScanGate({
        expectedLoop: 1,
        expectedRunId: "phase2-gate-provider",
        expectedScanId: "0001",
        scanRoot,
      }),
    ).rejects.toBeInstanceOf(ScanGateError);

    await expect(
      assertScanGate({
        expectedLoop: 1,
        expectedRunId: "phase2-gate-provider",
        expectedScanId: "0001",
        scanRoot,
      }),
    ).rejects.toThrow(/provider\.name drifted/);
  });
});

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-phase2-"));
  tempRoots.push(workspaceRoot);
  return workspaceRoot;
}
