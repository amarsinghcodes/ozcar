import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { doctorCommand } from "../src/commands/doctor";
import { rebuildCommand } from "../src/commands/rebuild";
import { replayCommand } from "../src/commands/replay";
import { resumeCommand } from "../src/commands/resume";
import { runCommand } from "../src/commands/run";
import {
  ProviderExecutionArtifactSchema,
  ProviderPreflightSchema,
} from "../src/contracts/provider-execution";
import { ScanOutputSchema } from "../src/contracts/scan";
import { resolveProvider } from "../src/providers/base";
import {
  ensureProviderPreflight,
  ProviderExecutionError,
  ProviderPreflightError,
  runLivePlanExecution,
} from "../src/providers/runtime";
import { readRunSnapshot } from "../src/store/run-store";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();

  await Promise.all(
    tempRoots.splice(0).map((root) =>
      fs.rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe.sequential("phase 6 live provider runner", () => {
  it("fails preflight with actionable codex auth guidance and persists preflight.json", async () => {
    const workspaceRoot = await createWorkspace();
    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", "phase6-preflight");

    await fs.mkdir(runRoot, { recursive: true });

    const provider = await resolveProvider({
      isCommandAvailable: async () => true,
      requested: "codex",
    });
    const executeCommand = vi.fn(async ({ args }: { readonly args: readonly string[] }) => {
      if (args[0] === "--version") {
        return {
          exitCode: 0,
          signal: null,
          stderr: "",
          stdout: "codex-cli 0.120.0\n",
        };
      }

      if (args[0] === "login" && args[1] === "status") {
        return {
          exitCode: 1,
          signal: null,
          stderr: "not logged in\n",
          stdout: "",
        };
      }

      throw new Error(`Unexpected command args: ${args.join(" ")}`);
    });

    await expect(
      ensureProviderPreflight({
        executeCommand,
        isCommandAvailable: async () => true,
        provider,
        runRoot,
      }),
    ).rejects.toBeInstanceOf(ProviderPreflightError);

    await expect(
      ensureProviderPreflight({
        executeCommand,
        isCommandAvailable: async () => true,
        provider,
        runRoot,
      }),
    ).rejects.toThrow(/codex login/);

    const preflight = ProviderPreflightSchema.parse(
      JSON.parse(await fs.readFile(path.join(runRoot, "provider", "preflight.json"), "utf8")),
    );

    expect(preflight.ok).toBe(false);
    expect(preflight.auth.status).toBe("missing");
    expect(preflight.guidance.join(" ")).toContain("codex login");
  });

  it("retries transient live plan failures, unwraps structured output, and persists attempt artifacts", async () => {
    const workspaceRoot = await createWorkspace();
    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", "phase6-runtime");
    let liveAttempts = 0;

    await fs.mkdir(runRoot, { recursive: true });

    const provider = await resolveProvider({
      isCommandAvailable: async () => true,
      requested: "claude",
    });
    const executeCommand = vi.fn(async ({ args }: { readonly args: readonly string[] }) => {
      if (args[0] === "--version") {
        return {
          exitCode: 0,
          signal: null,
          stderr: "",
          stdout: "2.1.76 (Claude Code)\n",
        };
      }

      if (args[0] === "auth" && args[1] === "status") {
        return {
          exitCode: 0,
          signal: null,
          stderr: "",
          stdout: '{"loggedIn":true}\n',
        };
      }

      liveAttempts += 1;

      if (liveAttempts === 1) {
        return {
          exitCode: 1,
          signal: null,
          stderr: "rate limit\n",
          stdout: "",
        };
      }

      return {
        exitCode: 0,
        signal: null,
        stderr: "",
        stdout: JSON.stringify({
          result: {
            objectives: ["Establish a durable live plan for loop 0001."],
            scans: [
              {
                researchDirection: "Investigate balance accounting invariants.",
                scanId: "0001",
                targets: ["Sample.sol"],
              },
            ],
          },
        }),
      };
    });

    const preflight = await ensureProviderPreflight({
      executeCommand,
      isCommandAvailable: async () => true,
      provider,
      runRoot,
    });
    const result = await runLivePlanExecution({
      executeCommand,
      invocationRoot: path.join(runRoot, "loops", "0001", "provider"),
      model: "claude-default",
      phase: "plan",
      preflight,
      prompt: "# planner\n",
      provider,
      runRoot,
      targetRoot: workspaceRoot,
    });

    expect(result.parsed.objectives).toEqual(["Establish a durable live plan for loop 0001."]);

    const attemptOne = ProviderExecutionArtifactSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(runRoot, "loops", "0001", "provider", "attempts", "0001", "execution.json"),
          "utf8",
        ),
      ),
    );
    const attemptTwo = ProviderExecutionArtifactSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(runRoot, "loops", "0001", "provider", "attempts", "0002", "execution.json"),
          "utf8",
        ),
      ),
    );

    expect(attemptOne.result.status).toBe("failed");
    expect(attemptOne.result.failureCode).toBe("transient");
    expect(attemptOne.result.retryable).toBe(true);
    expect(attemptTwo.result.status).toBe("succeeded");
    expect(attemptTwo.parse.ok).toBe(true);
    expect(attemptTwo.parse.wrapperPath).toContain("result");
    await expect(
      fs.readFile(path.join(runRoot, "loops", "0001", "provider", "attempts", "0002", "response.txt"), "utf8"),
    ).resolves.toContain("objectives");
  });

  it("runs a live end-to-end loop and keeps resume, replay, rebuild, and doctor coherent", async () => {
    const workspaceRoot = await createWorkspace();
    const targetRoot = await seedTargetRoot(workspaceRoot);
    const runId = "phase6-live";

    vi.stubEnv("PATH", phase6ProviderBin());
    vi.stubEnv("OZCAR_FAKE_CLAUDE_AUTH", "ready");
    vi.stubEnv("OZCAR_FAKE_CLAUDE_SCENARIO", "success");

    const runLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const runExitCode = await runCommand([
      "--root",
      workspaceRoot,
      "--target-root",
      targetRoot,
      "--run-id",
      runId,
      "--provider",
      "claude",
      "--scope",
      "Sample.sol",
      "--scan-target",
      "Sample.sol",
      "--research-direction",
      "Investigate balance accounting invariants.",
    ]);

    expect(runExitCode).toBe(0);

    const runPayload = readLoggedJson(runLog);
    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", runId);
    const outputFile = path.join(runRoot, "loops", "0001", "scans", "0001", "output.json");
    const summaryFile = path.join(runRoot, "summary.md");
    const confirmedFindingsFile = path.join(runRoot, "confirmed-findings.md");
    const originalSummary = await fs.readFile(summaryFile, "utf8");
    const originalConfirmedFindings = await fs.readFile(confirmedFindingsFile, "utf8");
    const snapshot = await readRunSnapshot({
      runId,
      workspaceRoot,
    });
    const scanOutput = ScanOutputSchema.parse(JSON.parse(await fs.readFile(outputFile, "utf8")));

    expect(runPayload.plan.mode).toBe("live");
    expect(runPayload.scans[0]?.mode).toBe("live");
    expect(snapshot.events.map((event) => event.type)).toContain("provider.preflight.completed");
    expect(scanOutput.mode).toBe("live");
    await expect(fs.readFile(path.join(runRoot, "provider", "preflight.json"), "utf8")).resolves.toContain(
      '"ok": true',
    );

    runLog.mockRestore();

    await fs.rm(outputFile, { force: true });

    const resumeLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const resumeExitCode = await resumeCommand([runId, "--root", workspaceRoot]);

    expect(resumeExitCode).toBe(0);
    expect(readLoggedJson(resumeLog).replayedScans).toEqual(["0001"]);
    expect(
      ScanOutputSchema.parse(JSON.parse(await fs.readFile(outputFile, "utf8"))).mode,
    ).toBe("live");

    resumeLog.mockRestore();

    await fs.writeFile(outputFile, "{\n", "utf8");

    const replayLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const replayExitCode = await replayCommand([runId, "--root", workspaceRoot, "--scan-id", "0001"]);

    expect(replayExitCode).toBe(0);
    expect(readLoggedJson(replayLog).scan.mode).toBe("live");
    expect(
      ScanOutputSchema.parse(JSON.parse(await fs.readFile(outputFile, "utf8"))).mode,
    ).toBe("live");

    replayLog.mockRestore();

    await fs.writeFile(summaryFile, "# stale summary\n", "utf8");
    await fs.writeFile(confirmedFindingsFile, "# stale confirmed\n", "utf8");

    const rebuildLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const rebuildExitCode = await rebuildCommand([runId, "--root", workspaceRoot]);

    expect(rebuildExitCode).toBe(0);
    expect(readLoggedJson(rebuildLog).validatedFindings).toBe(1);
    expect(await fs.readFile(summaryFile, "utf8")).toBe(originalSummary);
    expect(await fs.readFile(confirmedFindingsFile, "utf8")).toBe(originalConfirmedFindings);

    rebuildLog.mockRestore();

    const doctorLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const doctorExitCode = await doctorCommand([runId, "--root", workspaceRoot]);

    expect(doctorExitCode).toBe(0);
    expect(readLoggedJson(doctorLog).ok).toBe(true);
    expect(readLoggedJson(doctorLog).issues).toEqual([]);
  });

  it("fails a non-dry run at preflight with actionable guidance", async () => {
    const workspaceRoot = await createWorkspace();
    const targetRoot = await seedTargetRoot(workspaceRoot);
    const runId = "phase6-preflight-fail";

    vi.stubEnv("PATH", phase6ProviderBin());
    vi.stubEnv("OZCAR_FAKE_CLAUDE_AUTH", "missing");

    await expect(
      runCommand([
        "--root",
        workspaceRoot,
        "--target-root",
        targetRoot,
        "--run-id",
        runId,
        "--provider",
        "claude",
        "--scope",
        "Sample.sol",
        "--scan-target",
        "Sample.sol",
        "--research-direction",
        "Investigate balance accounting invariants.",
      ]),
    ).rejects.toThrow(/claude auth login/);

    const snapshot = await readRunSnapshot({
      runId,
      workspaceRoot,
    });
    const preflight = ProviderPreflightSchema.parse(
      JSON.parse(
        await fs.readFile(path.join(workspaceRoot, ".ai-auditor", "runs", runId, "provider", "preflight.json"), "utf8"),
      ),
    );

    expect(snapshot.run.status).toBe("failed");
    expect(snapshot.events.map((event) => event.type)).toContain("provider.preflight.failed");
    expect(preflight.ok).toBe(false);
    expect(preflight.guidance.join(" ")).toContain("claude auth login");
  });

  it("keeps dry-run behavior intact without running preflight", async () => {
    const workspaceRoot = await createWorkspace();
    const targetRoot = await seedTargetRoot(workspaceRoot);
    const runId = "phase6-dry";

    vi.stubEnv("PATH", phase6ProviderBin());
    vi.stubEnv("OZCAR_FAKE_CLAUDE_AUTH", "missing");

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
      phase3FindingFixture(),
    ]);

    expect(exitCode).toBe(0);

    const payload = readLoggedJson(consoleLog);
    const snapshot = await readRunSnapshot({
      runId,
      workspaceRoot,
    });
    const output = ScanOutputSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(workspaceRoot, ".ai-auditor", "runs", runId, "loops", "0001", "scans", "0001", "output.json"),
          "utf8",
        ),
      ),
    );

    expect(payload.plan.mode).toBe("dry-run");
    expect(payload.provider.preflightFile).toBeNull();
    expect(output.mode).toBe("dry-run");
    expect(snapshot.events.map((event) => event.type)).not.toContain("provider.preflight.completed");
    expect(snapshot.events.map((event) => event.type)).not.toContain("provider.preflight.failed");
    await expect(
      fs.access(path.join(workspaceRoot, ".ai-auditor", "runs", runId, "provider", "preflight.json")),
    ).rejects.toBeDefined();
  });
});

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-phase6-"));
  tempRoots.push(workspaceRoot);
  return workspaceRoot;
}

async function seedTargetRoot(workspaceRoot: string): Promise<string> {
  const targetRoot = path.join(workspaceRoot, "target");

  await fs.mkdir(targetRoot, { recursive: true });
  await fs.writeFile(path.join(targetRoot, "Sample.sol"), "contract Sample {}\n", "utf8");

  return targetRoot;
}

function phase3FindingFixture(): string {
  return path.resolve(process.cwd(), "tests", "fixtures", "phase3-scan-findings.json");
}

function phase6ProviderBin(): string {
  return path.resolve(process.cwd(), "tests", "fixtures", "phase6", "providers", "claude", "bin");
}

function readLoggedJson(consoleLog: ReturnType<typeof vi.spyOn>): any {
  const payload = consoleLog.mock.calls[consoleLog.mock.calls.length - 1]?.[0];

  if (typeof payload !== "string") {
    throw new Error("Expected a JSON string from console.log.");
  }

  return JSON.parse(payload);
}
