import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { doctorCommand } from "../src/commands/doctor";
import { rebuildCommand } from "../src/commands/rebuild";
import { replayCommand } from "../src/commands/replay";
import { resumeCommand } from "../src/commands/resume";
import { runCommand } from "../src/commands/run";
import { statusCommand } from "../src/commands/status";
import { ScanFindingSchema, ScanOutputSchema, ScanRequestSchema } from "../src/contracts/scan";
import { runPlanPhase } from "../src/phases/plan";
import { runScanPhase } from "../src/phases/scan";
import { resolveProvider } from "../src/providers/base";
import { createRunStore, readRunSnapshot } from "../src/store/run-store";

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

describe("phase 4 operational commands", () => {
  it("resume completes from durable scan state and replays a missing scan output from stored request inputs", async () => {
    const workspaceRoot = await createWorkspace();
    const { requestFile, scanOutputFile } = await seedPartialRun(workspaceRoot, "phase4-resume");
    const request = ScanRequestSchema.parse(JSON.parse(await fs.readFile(requestFile, "utf8")));

    expect(request.dryRunFindings).toHaveLength(3);
    await expect(fs.access(scanOutputFile)).rejects.toBeDefined();

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await resumeCommand(["phase4-resume", "--root", workspaceRoot]);

    expect(exitCode).toBe(0);

    const payload = readLoggedJson(consoleLog);
    const snapshot = await readRunSnapshot({
      runId: "phase4-resume",
      workspaceRoot,
    });
    const output = ScanOutputSchema.parse(JSON.parse(await fs.readFile(scanOutputFile, "utf8")));
    const summary = await fs.readFile(path.join(snapshot.paths.runRoot, "summary.md"), "utf8");

    expect(payload.replayedScans).toEqual(["0001"]);
    expect(snapshot.run.currentPhase).toBe("summarize");
    expect(snapshot.run.status).toBe("completed");
    expect(snapshot.events.map((event) => event.type)).toContain("phase.scan.replayed");
    expect(output.findings).toHaveLength(3);
    expect(summary).toContain("Missing balance invariant enforcement");
  });

  it("status reports artifact counts and healthy report freshness for a completed run", async () => {
    const workspaceRoot = await createWorkspace();

    await runCompletedFixtureRun(workspaceRoot, "phase4-status");

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await statusCommand(["phase4-status", "--root", workspaceRoot]);

    expect(exitCode).toBe(0);

    const payload = readLoggedJson(consoleLog);

    expect(payload.healthy).toBe(true);
    expect(payload.counts.scansPlanned).toBe(1);
    expect(payload.counts.scanFindings).toBe(3);
    expect(payload.counts.triageArtifacts).toBe(3);
    expect(payload.counts.validatedArtifacts).toBe(1);
    expect(payload.counts.pendingArtifacts).toBe(1);
    expect(payload.counts.rejectedArtifacts).toBe(1);
    expect(payload.reportState.summaryFresh).toBe(true);
    expect(payload.reportState.confirmedFindingsFresh).toBe(true);
    expect(payload.issues).toEqual([]);
  });

  it("replay reruns a stored scan from request.json inputs", async () => {
    const workspaceRoot = await createWorkspace();

    await runCompletedFixtureRun(workspaceRoot, "phase4-replay");

    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", "phase4-replay");
    const requestFile = path.join(runRoot, "loops", "0001", "scans", "0001", "request.json");
    const outputFile = path.join(runRoot, "loops", "0001", "scans", "0001", "output.json");
    const request = ScanRequestSchema.parse(JSON.parse(await fs.readFile(requestFile, "utf8")));

    expect(request.dryRunFindings).toHaveLength(3);

    await fs.writeFile(outputFile, "{\n", "utf8");

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await replayCommand([
      "phase4-replay",
      "--root",
      workspaceRoot,
      "--scan-id",
      "0001",
    ]);

    expect(exitCode).toBe(0);

    const payload = readLoggedJson(consoleLog);
    const output = ScanOutputSchema.parse(JSON.parse(await fs.readFile(outputFile, "utf8")));
    const snapshot = await readRunSnapshot({
      runId: "phase4-replay",
      workspaceRoot,
    });

    expect(payload.scan.findingCount).toBe(3);
    expect(output.findings).toHaveLength(3);
    expect(snapshot.events.map((event) => event.type)).toContain("phase.scan.replayed");
  });

  it("rebuild regenerates summary.md and confirmed-findings.md from validated artifacts only", async () => {
    const workspaceRoot = await createWorkspace();

    await runCompletedFixtureRun(workspaceRoot, "phase4-rebuild");

    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", "phase4-rebuild");
    const summaryFile = path.join(runRoot, "summary.md");
    const confirmedFindingsFile = path.join(runRoot, "confirmed-findings.md");
    const originalSummary = await fs.readFile(summaryFile, "utf8");
    const originalConfirmedFindings = await fs.readFile(confirmedFindingsFile, "utf8");

    await fs.writeFile(summaryFile, "# stale\n", "utf8");
    await fs.writeFile(confirmedFindingsFile, "# stale\n", "utf8");

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await rebuildCommand(["phase4-rebuild", "--root", workspaceRoot]);

    expect(exitCode).toBe(0);

    const payload = readLoggedJson(consoleLog);
    const rebuiltSummary = await fs.readFile(summaryFile, "utf8");
    const rebuiltConfirmedFindings = await fs.readFile(confirmedFindingsFile, "utf8");

    expect(payload.validatedFindings).toBe(1);
    expect(rebuiltSummary).toBe(originalSummary);
    expect(rebuiltConfirmedFindings).toBe(originalConfirmedFindings);
  });

  it("doctor reports stale report state against validated artifacts", async () => {
    const workspaceRoot = await createWorkspace();

    await runCompletedFixtureRun(workspaceRoot, "phase4-doctor-stale");

    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", "phase4-doctor-stale");

    await fs.writeFile(path.join(runRoot, "summary.md"), "# stale summary\n", "utf8");
    await fs.writeFile(path.join(runRoot, "confirmed-findings.md"), "# stale confirmed\n", "utf8");

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await doctorCommand(["phase4-doctor-stale", "--root", workspaceRoot]);

    expect(exitCode).toBe(1);

    const payload = readLoggedJson(consoleLog);
    const issueCodes = payload.issues.map((issue: { code: string }) => issue.code);

    expect(issueCodes).toContain("report.summary.stale");
    expect(issueCodes).toContain("report.confirmed.stale");
  });

  it("doctor reports duplicate validation artifacts across outcome directories", async () => {
    const workspaceRoot = await createWorkspace();

    await runCompletedFixtureRun(workspaceRoot, "phase4-doctor-duplicate");

    const loopRoot = path.join(
      workspaceRoot,
      ".ai-auditor",
      "runs",
      "phase4-doctor-duplicate",
      "loops",
      "0001",
    );

    await fs.cp(
      path.join(loopRoot, "validated", "0001-confirmed-high"),
      path.join(loopRoot, "pending", "0001-confirmed-high"),
      { recursive: true },
    );

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await doctorCommand(["phase4-doctor-duplicate", "--root", workspaceRoot]);

    expect(exitCode).toBe(1);

    const payload = readLoggedJson(consoleLog);
    const issueCodes = payload.issues.map((issue: { code: string }) => issue.code);

    expect(issueCodes).toContain("validate.duplicate");
  });

  it("doctor reports validation artifacts that are stored under a stale outcome directory", async () => {
    const workspaceRoot = await createWorkspace();

    await runCompletedFixtureRun(workspaceRoot, "phase4-doctor-stale-location");

    const loopRoot = path.join(
      workspaceRoot,
      ".ai-auditor",
      "runs",
      "phase4-doctor-stale-location",
      "loops",
      "0001",
    );

    await fs.rename(
      path.join(loopRoot, "validated", "0001-confirmed-high"),
      path.join(loopRoot, "pending", "0001-confirmed-high"),
    );

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await doctorCommand(["phase4-doctor-stale-location", "--root", workspaceRoot]);

    expect(exitCode).toBe(1);

    const payload = readLoggedJson(consoleLog);
    const issueCodes = payload.issues.map((issue: { code: string }) => issue.code);

    expect(issueCodes).toContain("validate.gate");
    expect(issueCodes).toContain("validate.stale-location");
  });

  it("doctor reports validation gate failures when required artifacts are missing", async () => {
    const workspaceRoot = await createWorkspace();

    await runCompletedFixtureRun(workspaceRoot, "phase4-doctor-missing");

    const validationFile = path.join(
      workspaceRoot,
      ".ai-auditor",
      "runs",
      "phase4-doctor-missing",
      "loops",
      "0001",
      "validated",
      "0001-confirmed-high",
      "validation.json",
    );

    await fs.rm(validationFile, { force: true });

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await doctorCommand(["phase4-doctor-missing", "--root", workspaceRoot]);

    expect(exitCode).toBe(1);

    const payload = readLoggedJson(consoleLog);
    const issueCodes = payload.issues.map((issue: { code: string }) => issue.code);

    expect(issueCodes).toContain("validate.gate");
  });
});

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-phase4-"));
  tempRoots.push(workspaceRoot);
  return workspaceRoot;
}

function fixturePath(): string {
  return path.resolve(process.cwd(), "tests", "fixtures", "phase3-scan-findings.json");
}

async function readFixtureFindings() {
  const parsed = JSON.parse(await fs.readFile(fixturePath(), "utf8"));
  return ScanFindingSchema.array().parse(parsed);
}

function readLoggedJson(consoleLog: ReturnType<typeof vi.spyOn>): any {
  const payload = consoleLog.mock.calls[consoleLog.mock.calls.length - 1]?.[0];

  if (typeof payload !== "string") {
    throw new Error("Expected a JSON string from console.log.");
  }

  return JSON.parse(payload);
}

async function runCompletedFixtureRun(workspaceRoot: string, runId: string): Promise<void> {
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
    runId,
    "--provider",
    "claude",
    "--dry-run",
    "--scope",
    "Sample.sol",
    "--scan-target",
    "Sample.sol",
    "--research-direction",
    "Investigate balance accounting invariants.",
    "--finding-fixture",
    fixturePath(),
  ]);

  expect(exitCode).toBe(0);
  expect(consoleLog).toHaveBeenCalledOnce();
  consoleLog.mockRestore();
}

async function seedPartialRun(
  workspaceRoot: string,
  runId: string,
): Promise<{ readonly requestFile: string; readonly scanOutputFile: string }> {
  const targetRoot = path.join(workspaceRoot, "target");
  const findings = await readFixtureFindings();

  await fs.mkdir(targetRoot, { recursive: true });
  await fs.writeFile(path.join(targetRoot, "Sample.sol"), "contract Sample {}", "utf8");

  const provider = await resolveProvider({
    isCommandAvailable: async () => false,
    requested: "claude",
  });
  const handle = await createRunStore({
    runId,
    targetRoot,
    workspaceRoot,
  });

  try {
    await handle.updateRun({
      activeLoop: 1,
      currentPhase: "plan",
      status: "running",
    });
    await handle.appendEvent({
      details: {
        available: provider.available,
        provider: provider.name,
        selection: provider.selection,
      },
      type: "provider.selected",
    });
    await handle.appendEvent({
      details: {
        loop: 1,
      },
      type: "phase.plan.started",
    });

    const planResult = await runPlanPhase({
      loop: 1,
      provider,
      researchDirection: "Investigate balance accounting invariants.",
      runId,
      runRoot: handle.paths.runRoot,
      scanTargets: ["Sample.sol"],
      scope: ["Sample.sol"],
    });

    await handle.appendEvent({
      details: {
        loop: 1,
        planFile: planResult.planFile,
      },
      type: "phase.plan.completed",
    });
    await handle.updateRun({
      activeLoop: 1,
      currentPhase: "scan",
      status: "running",
    });
    await handle.appendEvent({
      details: {
        loop: 1,
        scansPlanned: planResult.plan.scans.length,
      },
      type: "phase.scan.started",
    });

    const scanResults = await runScanPhase({
      dryRun: true,
      dryRunFindings: findings,
      loop: 1,
      plan: planResult.plan,
      provider,
      runId,
      runRoot: handle.paths.runRoot,
      targetRoot,
    });
    const requestFile = scanResults[0]!.requestFile;
    const scanOutputFile = scanResults[0]!.outputFile;

    await fs.rm(scanOutputFile, { force: true });

    return {
      requestFile,
      scanOutputFile,
    };
  } finally {
    await handle.close();
  }
}
