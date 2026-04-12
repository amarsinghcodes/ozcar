import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { doctorCommand } from "../src/commands/doctor";
import { rebuildCommand } from "../src/commands/rebuild";
import { replayCommand } from "../src/commands/replay";
import { resumeCommand } from "../src/commands/resume";
import { runCommand } from "../src/commands/run";
import { ScanOutputSchema } from "../src/contracts/scan";
import { ProviderResolutionError, resolveProvider } from "../src/providers/base";
import { readRunSnapshot } from "../src/store/run-store";

const SAMPLE_RUN_ID = "phase5-sample-run";
const WORKSPACE_TOKEN = "__WORKSPACE_ROOT__";
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

describe("phase 5 verification hardening", () => {
  it("detects providers from fixture-backed PATH directories in deterministic priority order", async () => {
    const bothBin = await prepareProviderFixture("both");
    const claudeOnlyBin = await prepareProviderFixture("claude-only");
    const emptyBin = await prepareProviderFixture("empty");

    const bothProvider = await resolveProvider({
      env: {
        ...process.env,
        PATH: bothBin,
      },
    });
    const claudeOnlyProvider = await resolveProvider({
      env: {
        ...process.env,
        PATH: claudeOnlyBin,
      },
    });

    expect(bothProvider.name).toBe("codex");
    expect(bothProvider.selection).toBe("auto");
    expect(bothProvider.available).toBe(true);
    expect(bothProvider.detectedProviders).toEqual(["codex", "claude"]);

    expect(claudeOnlyProvider.name).toBe("claude");
    expect(claudeOnlyProvider.selection).toBe("auto");
    expect(claudeOnlyProvider.available).toBe(true);
    expect(claudeOnlyProvider.detectedProviders).toEqual(["claude"]);

    await expect(
      resolveProvider({
        env: {
          ...process.env,
          PATH: emptyBin,
        },
      }),
    ).rejects.toBeInstanceOf(ProviderResolutionError);

    await expect(
      resolveProvider({
        env: {
          ...process.env,
          PATH: emptyBin,
        },
      }),
    ).rejects.toThrow(/No built-in provider detected on PATH/);
  });

  it("rejects malformed finding fixtures before any run artifacts are created", async () => {
    const workspaceRoot = await createWorkspace();
    const targetRoot = await seedTargetRoot(workspaceRoot);
    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", "phase5-invalid-fixture");

    await expect(
      runCommand([
        "--root",
        workspaceRoot,
        "--target-root",
        targetRoot,
        "--run-id",
        "phase5-invalid-fixture",
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
        fixturePath("phase5", "findings", "schema-invalid-findings.json"),
      ]),
    ).rejects.toThrow(/Invalid finding fixture .*0\.title/);

    await expect(fs.access(runRoot)).rejects.toBeDefined();
  });

  it("fails triage deterministically when a fixture-backed scan emits duplicate finding ids", async () => {
    const workspaceRoot = await createWorkspace();
    const targetRoot = await seedTargetRoot(workspaceRoot);

    await expect(
      runCommand([
        "--root",
        workspaceRoot,
        "--target-root",
        targetRoot,
        "--run-id",
        "phase5-duplicate-fixture",
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
        fixturePath("phase5", "findings", "duplicate-findings.json"),
      ]),
    ).rejects.toThrow(/Triage phase rejected duplicate finding artifact 0001-duplicate-high\./);

    const snapshot = await readRunSnapshot({
      runId: "phase5-duplicate-fixture",
      workspaceRoot,
    });

    expect(snapshot.run.status).toBe("failed");
    expect(snapshot.run.currentPhase).toBe("triage");
    expect(snapshot.events[snapshot.events.length - 1]?.type).toBe("phase.failed");

    const output = ScanOutputSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(snapshot.paths.runRoot, "loops", "0001", "scans", "0001", "output.json"),
          "utf8",
        ),
      ),
    );

    expect(output.findings).toHaveLength(2);
    expect(output.findings.map((finding) => finding.id)).toEqual(["duplicate-high", "duplicate-high"]);
  });

  it("resumes the checked-in sample run fixture and regenerates the expected durable outputs", async () => {
    const workspaceRoot = await createWorkspace();
    await copySampleRunFixtureWorkspace(workspaceRoot);

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await resumeCommand([SAMPLE_RUN_ID, "--root", workspaceRoot]);

    expect(exitCode).toBe(0);

    const payload = readLoggedJson(consoleLog);
    const snapshot = await readRunSnapshot({
      runId: SAMPLE_RUN_ID,
      workspaceRoot,
    });
    const output = await readStableScanOutput(workspaceRoot);
    const summary = await fs.readFile(path.join(snapshot.paths.runRoot, "summary.md"), "utf8");
    const confirmedFindings = await fs.readFile(
      path.join(snapshot.paths.runRoot, "confirmed-findings.md"),
      "utf8",
    );

    expect(payload.replayedScans).toEqual(["0001"]);
    expect(snapshot.run.status).toBe("completed");
    expect(snapshot.run.currentPhase).toBe("summarize");
    expect(snapshot.events.map((event) => event.type)).toContain("phase.scan.replayed");
    expect(await listArtifactDirectories(path.join(snapshot.paths.runRoot, "loops", "0001", "validated"))).toEqual([
      "0001-confirmed-high",
    ]);
    expect(await listArtifactDirectories(path.join(snapshot.paths.runRoot, "loops", "0001", "pending"))).toEqual([
      "0001-pending-medium",
    ]);
    expect(await listArtifactDirectories(path.join(snapshot.paths.runRoot, "loops", "0001", "rejected"))).toEqual([
      "0001-rejected-low",
    ]);
    expect(output).toEqual(await readExpectedStableScanOutput());
    expect(summary).toBe(await fs.readFile(sampleRunExpectedPath("summary.md"), "utf8"));
    expect(confirmedFindings).toBe(
      await fs.readFile(sampleRunExpectedPath("confirmed-findings.md"), "utf8"),
    );
  });

  it("replays scan output and rebuilds reports back to the checked-in stable sample outputs", async () => {
    const workspaceRoot = await createWorkspace();
    await resumeSampleRunFixture(workspaceRoot);

    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", SAMPLE_RUN_ID);
    const outputFile = path.join(runRoot, "loops", "0001", "scans", "0001", "output.json");
    const summaryFile = path.join(runRoot, "summary.md");
    const confirmedFindingsFile = path.join(runRoot, "confirmed-findings.md");

    await fs.writeFile(outputFile, "{\n", "utf8");
    await fs.writeFile(summaryFile, "# stale summary\n", "utf8");
    await fs.writeFile(confirmedFindingsFile, "# stale confirmed findings\n", "utf8");

    const replayLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const replayExitCode = await replayCommand([SAMPLE_RUN_ID, "--root", workspaceRoot, "--scan-id", "0001"]);

    expect(replayExitCode).toBe(0);
    expect(readLoggedJson(replayLog).scan.findingCount).toBe(3);
    expect(await readStableScanOutput(workspaceRoot)).toEqual(await readExpectedStableScanOutput());

    replayLog.mockRestore();

    const rebuildLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const rebuildExitCode = await rebuildCommand([SAMPLE_RUN_ID, "--root", workspaceRoot]);

    expect(rebuildExitCode).toBe(0);
    expect(readLoggedJson(rebuildLog).validatedFindings).toBe(1);
    expect(await fs.readFile(summaryFile, "utf8")).toBe(await fs.readFile(sampleRunExpectedPath("summary.md"), "utf8"));
    expect(await fs.readFile(confirmedFindingsFile, "utf8")).toBe(
      await fs.readFile(sampleRunExpectedPath("confirmed-findings.md"), "utf8"),
    );

    rebuildLog.mockRestore();

    const doctorLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const doctorExitCode = await doctorCommand([SAMPLE_RUN_ID, "--root", workspaceRoot]);

    expect(doctorExitCode).toBe(0);

    const doctorPayload = readLoggedJson(doctorLog);

    expect(doctorPayload.ok).toBe(true);
    expect(doctorPayload.issues).toEqual([]);
    expect(doctorPayload.reportState.summaryFresh).toBe(true);
    expect(doctorPayload.reportState.confirmedFindingsFresh).toBe(true);
  });

  it("surfaces validation gate failures against the sample fixture when required artifacts drift", async () => {
    const workspaceRoot = await createWorkspace();
    await resumeSampleRunFixture(workspaceRoot);

    const validationFile = path.join(
      workspaceRoot,
      ".ai-auditor",
      "runs",
      SAMPLE_RUN_ID,
      "loops",
      "0001",
      "validated",
      "0001-confirmed-high",
      "validation.json",
    );

    await fs.rm(validationFile, { force: true });

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await doctorCommand([SAMPLE_RUN_ID, "--root", workspaceRoot]);

    expect(exitCode).toBe(1);

    const payload = readLoggedJson(consoleLog);
    const issueCodes = payload.issues.map((issue: { code: string }) => issue.code);

    expect(issueCodes).toContain("validate.gate");
  });
});

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-phase5-"));
  tempRoots.push(workspaceRoot);
  return workspaceRoot;
}

async function seedTargetRoot(workspaceRoot: string): Promise<string> {
  const targetRoot = path.join(workspaceRoot, "target");

  await fs.mkdir(targetRoot, { recursive: true });
  await fs.writeFile(path.join(targetRoot, "Sample.sol"), "contract Sample {}\n", "utf8");

  return targetRoot;
}

async function prepareProviderFixture(name: "both" | "claude-only" | "empty"): Promise<string> {
  const workspaceRoot = await createWorkspace();
  const sourceRoot = fixturePath("phase5", "providers", name);

  await copyTreeContents(sourceRoot, workspaceRoot);

  const binRoot = path.join(workspaceRoot, "bin");
  const entries = await fs.readdir(binRoot, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => fs.chmod(path.join(binRoot, entry.name), 0o755)),
  );

  return binRoot;
}

async function copySampleRunFixtureWorkspace(workspaceRoot: string): Promise<void> {
  const sourceRoot = fixturePath("phase5", "sample-run", "workspace");

  await copyTreeContents(sourceRoot, workspaceRoot);
  await replaceTokenInTree(workspaceRoot, WORKSPACE_TOKEN, workspaceRoot);
}

async function resumeSampleRunFixture(workspaceRoot: string): Promise<void> {
  await copySampleRunFixtureWorkspace(workspaceRoot);

  const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

  const exitCode = await resumeCommand([SAMPLE_RUN_ID, "--root", workspaceRoot]);

  expect(exitCode).toBe(0);
  expect(readLoggedJson(consoleLog).replayedScans).toEqual(["0001"]);
  consoleLog.mockRestore();
}

async function copyTreeContents(sourceRoot: string, destinationRoot: string): Promise<void> {
  await fs.mkdir(destinationRoot, { recursive: true });

  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });

  await Promise.all(
    entries.map((entry) =>
      fs.cp(path.join(sourceRoot, entry.name), path.join(destinationRoot, entry.name), {
        recursive: true,
      }),
    ),
  );
}

async function replaceTokenInTree(root: string, token: string, value: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);

      if (entry.isDirectory()) {
        await replaceTokenInTree(entryPath, token, value);
        return;
      }

      const content = await fs.readFile(entryPath, "utf8");
      if (!content.includes(token)) {
        return;
      }

      await fs.writeFile(entryPath, content.replaceAll(token, value), "utf8");
    }),
  );
}

async function listArtifactDirectories(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function readLoggedJson(consoleLog: ReturnType<typeof vi.spyOn>): any {
  const payload = consoleLog.mock.calls[consoleLog.mock.calls.length - 1]?.[0];

  if (typeof payload !== "string") {
    throw new Error("Expected a JSON string from console.log.");
  }

  return JSON.parse(payload);
}

async function readStableScanOutput(workspaceRoot: string): Promise<Record<string, unknown>> {
  const output = ScanOutputSchema.parse(
    JSON.parse(
      await fs.readFile(
        path.join(
          workspaceRoot,
          ".ai-auditor",
          "runs",
          SAMPLE_RUN_ID,
          "loops",
          "0001",
          "scans",
          "0001",
          "output.json",
        ),
        "utf8",
      ),
    ),
  );
  const { createdAt: _createdAt, ...stable } = output;

  return stable;
}

async function readExpectedStableScanOutput(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(sampleRunExpectedPath("scan-output-stable.json"), "utf8"));
}

function sampleRunExpectedPath(fileName: string): string {
  return fixturePath("phase5", "sample-run", "expected", fileName);
}

function fixturePath(...segments: string[]): string {
  return path.resolve(process.cwd(), "tests", "fixtures", ...segments);
}
