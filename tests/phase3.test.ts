import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "../src/commands/run";
import { FindingContractSchema, Severity } from "../src/contracts/finding";
import { ScanOutputSchema } from "../src/contracts/scan";
import { TriageContractSchema, TriageDisposition } from "../src/contracts/triage";
import { ValidationContractSchema, ValidationOutcome } from "../src/contracts/validation";
import { TriageGateError, assertTriageGate } from "../src/gates/triage";
import { ValidationGateError, assertValidationGate } from "../src/gates/validate";
import { runSummarizePhase } from "../src/phases/summarize";
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

describe("phase 3 dry seam", () => {
  it("emits typed triage and validation sidecars and rebuilds reports from validated artifacts only", async () => {
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
      "phase3-dry",
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
      phase3FixturePath(),
    ]);

    expect(exitCode).toBe(0);
    expect(consoleLog).toHaveBeenCalledOnce();

    const snapshot = await readRunSnapshot({
      runId: "phase3-dry",
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
    const scanOutput = ScanOutputSchema.parse(
      JSON.parse(await fs.readFile(path.join(loopRoot, "scans", "0001", "output.json"), "utf8")),
    );

    expect(scanOutput.findings).toHaveLength(3);

    const triageRoots = await listArtifactDirectories(path.join(loopRoot, "triage"));
    const validatedRoots = await listArtifactDirectories(path.join(loopRoot, "validated"));
    const pendingRoots = await listArtifactDirectories(path.join(loopRoot, "pending"));
    const rejectedRoots = await listArtifactDirectories(path.join(loopRoot, "rejected"));

    expect(triageRoots).toEqual(["0001-confirmed-high", "0001-pending-medium", "0001-rejected-low"]);
    expect(validatedRoots).toEqual(["0001-confirmed-high"]);
    expect(pendingRoots).toEqual(["0001-pending-medium"]);
    expect(rejectedRoots).toEqual(["0001-rejected-low"]);

    const triagedConfirmed = await assertTriageGate({
      expectedFindingId: "confirmed-high",
      expectedLoop: 1,
      expectedRunId: "phase3-dry",
      expectedScanId: "0001",
      triageRoot: path.join(loopRoot, "triage", "0001-confirmed-high"),
    });
    const validatedConfirmed = await assertValidationGate({
      expectedFindingId: "confirmed-high",
      expectedLoop: 1,
      expectedOutcome: "validated",
      expectedRunId: "phase3-dry",
      expectedScanId: "0001",
      validationRoot: path.join(loopRoot, "validated", "0001-confirmed-high"),
    });
    const pendingFinding = await assertValidationGate({
      expectedFindingId: "pending-medium",
      expectedLoop: 1,
      expectedOutcome: "pending",
      expectedRunId: "phase3-dry",
      expectedScanId: "0001",
      validationRoot: path.join(loopRoot, "pending", "0001-pending-medium"),
    });
    const rejectedFinding = await assertValidationGate({
      expectedFindingId: "rejected-low",
      expectedLoop: 1,
      expectedOutcome: "rejected",
      expectedRunId: "phase3-dry",
      expectedScanId: "0001",
      validationRoot: path.join(loopRoot, "rejected", "0001-rejected-low"),
    });

    expect(triagedConfirmed.triage.disposition).toBe("confirmed");
    expect(validatedConfirmed.validation.outcome).toBe("validated");
    expect(pendingFinding.validation.outcome).toBe("pending");
    expect(rejectedFinding.validation.outcome).toBe("rejected");

    const summary = await fs.readFile(path.join(snapshot.paths.runRoot, "summary.md"), "utf8");
    const confirmedFindings = await fs.readFile(
      path.join(snapshot.paths.runRoot, "confirmed-findings.md"),
      "utf8",
    );

    expect(summary).toContain("Missing balance invariant enforcement");
    expect(summary).not.toContain("Unproven medium-path invariant");
    expect(summary).not.toContain("Noise-level event mismatch");
    expect(confirmedFindings).toContain("Missing balance invariant enforcement");
    expect(confirmedFindings).not.toContain("Unproven medium-path invariant");
    expect(confirmedFindings).not.toContain("Noise-level event mismatch");
  });

  it("fails the triage gate deterministically when triage.json drifts from finding.json identity", async () => {
    const workspaceRoot = await createWorkspace();
    const triageRoot = path.join(workspaceRoot, "loops", "0001", "triage", "0001-confirmed-high");

    await fs.mkdir(triageRoot, { recursive: true });
    await fs.writeFile(path.join(triageRoot, "prompt.md"), "# triager\n", "utf8");
    await fs.writeFile(
      path.join(triageRoot, "finding.json"),
      `${JSON.stringify(
        FindingContractSchema.parse({
          createdAt: "2026-04-12T01:10:00.000Z",
          findingId: "confirmed-high",
          locations: ["Sample.sol:12"],
          loop: 1,
          runId: "phase3-gate",
          scanId: "0001",
          schemaVersion: 1,
          severity: "high",
          summary: "Confirmed finding summary.",
          title: "Confirmed finding",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(triageRoot, "triage.json"),
      `${JSON.stringify(
        TriageContractSchema.parse({
          disposition: "confirmed",
          findingId: "wrong-finding",
          loop: 1,
          rationale: "Identity drifted.",
          runId: "phase3-gate",
          scanId: "0001",
          schemaVersion: 1,
          triagedAt: "2026-04-12T01:10:01.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      assertTriageGate({
        expectedFindingId: "confirmed-high",
        expectedLoop: 1,
        expectedRunId: "phase3-gate",
        expectedScanId: "0001",
        triageRoot,
      }),
    ).rejects.toBeInstanceOf(TriageGateError);

    await expect(
      assertTriageGate({
        expectedFindingId: "confirmed-high",
        expectedLoop: 1,
        expectedRunId: "phase3-gate",
        expectedScanId: "0001",
        triageRoot,
      }),
    ).rejects.toThrow(/expected findingId confirmed-high but found wrong-finding/);
  });

  it("fails the validation gate deterministically when validation.json has the wrong outcome", async () => {
    const workspaceRoot = await createWorkspace();
    const validationRoot = path.join(workspaceRoot, "loops", "0001", "validated", "0001-confirmed-high");

    await fs.mkdir(validationRoot, { recursive: true });
    await fs.writeFile(path.join(validationRoot, "prompt.md"), "# validator\n", "utf8");
    await fs.writeFile(
      path.join(validationRoot, "finding.json"),
      `${JSON.stringify(
        FindingContractSchema.parse({
          createdAt: "2026-04-12T01:11:00.000Z",
          findingId: "confirmed-high",
          locations: ["Sample.sol:12"],
          loop: 1,
          runId: "phase3-validate-gate",
          scanId: "0001",
          schemaVersion: 1,
          severity: "high",
          summary: "Confirmed finding summary.",
          title: "Confirmed finding",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(validationRoot, "triage.json"),
      `${JSON.stringify(
        TriageContractSchema.parse({
          disposition: "confirmed",
          findingId: "confirmed-high",
          loop: 1,
          rationale: "Retained for validation.",
          runId: "phase3-validate-gate",
          scanId: "0001",
          schemaVersion: 1,
          triagedAt: "2026-04-12T01:11:01.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(validationRoot, "validation.json"),
      `${JSON.stringify(
        ValidationContractSchema.parse({
          findingId: "confirmed-high",
          loop: 1,
          outcome: "pending",
          rationale: "Drifted outcome.",
          runId: "phase3-validate-gate",
          scanId: "0001",
          schemaVersion: 1,
          validatedAt: "2026-04-12T01:11:02.000Z",
          validator: "phase3-dry-seam",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      assertValidationGate({
        expectedFindingId: "confirmed-high",
        expectedLoop: 1,
        expectedOutcome: "validated",
        expectedRunId: "phase3-validate-gate",
        expectedScanId: "0001",
        validationRoot,
      }),
    ).rejects.toBeInstanceOf(ValidationGateError);

    await expect(
      assertValidationGate({
        expectedFindingId: "confirmed-high",
        expectedLoop: 1,
        expectedOutcome: "validated",
        expectedRunId: "phase3-validate-gate",
        expectedScanId: "0001",
        validationRoot,
      }),
    ).rejects.toThrow(/expected outcome validated but found pending/);
  });

  it("fails summarize with ValidationGateError when a validated artifact has malformed JSON", async () => {
    const workspaceRoot = await createWorkspace();
    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", "phase3-summary-malformed");
    const loopRoot = path.join(runRoot, "loops", "0001");
    const malformedRoot = path.join(loopRoot, "validated", "0001-validated-high");

    await writeValidationArtifact({
      disposition: "confirmed",
      findingId: "validated-high",
      loopRoot,
      outcome: "validated",
      runId: "phase3-summary-malformed",
      scanId: "0001",
      severity: "high",
      summary: "Validated issue summary.",
      title: "Validated issue",
    });
    await fs.writeFile(path.join(malformedRoot, "finding.json"), "{\n", "utf8");

    await expect(
      runSummarizePhase({
        loop: 1,
        runId: "phase3-summary-malformed",
        runRoot,
      }),
    ).rejects.toBeInstanceOf(ValidationGateError);

    await expect(
      runSummarizePhase({
        loop: 1,
        runId: "phase3-summary-malformed",
        runRoot,
      }),
    ).rejects.toThrow(/Validation gate rejected .*finding\.json: invalid JSON/);
  });

  it("rebuilds reports from validated artifacts only", async () => {
    const workspaceRoot = await createWorkspace();
    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", "phase3-summary");
    const loopRoot = path.join(runRoot, "loops", "0001");

    await writeValidationArtifact({
      disposition: "confirmed",
      findingId: "validated-high",
      loopRoot,
      outcome: "validated",
      runId: "phase3-summary",
      scanId: "0001",
      severity: "high",
      summary: "Validated issue summary.",
      title: "Validated issue",
    });
    await writeValidationArtifact({
      disposition: "pending",
      findingId: "pending-medium",
      loopRoot,
      outcome: "pending",
      runId: "phase3-summary",
      scanId: "0001",
      severity: "medium",
      summary: "Pending issue summary.",
      title: "Pending issue",
    });
    await writeValidationArtifact({
      disposition: "rejected",
      findingId: "rejected-low",
      loopRoot,
      outcome: "rejected",
      runId: "phase3-summary",
      scanId: "0001",
      severity: "low",
      summary: "Rejected issue summary.",
      title: "Rejected issue",
    });

    await fs.mkdir(path.join(loopRoot, "scans", "0001"), { recursive: true });
    await fs.writeFile(
      path.join(loopRoot, "scans", "0001", "output.json"),
      `${JSON.stringify(
        ScanOutputSchema.parse({
          createdAt: "2026-04-12T01:12:00.000Z",
          findings: [
            {
              id: "raw-only",
              locations: ["Sample.sol:99"],
              rationale: "Raw finding that should never reach reports without validation artifacts.",
              severity: "critical",
              title: "Raw-only issue",
            },
          ],
          loop: 1,
          mode: "dry-run",
          runId: "phase3-summary",
          scanId: "0001",
          schemaVersion: 1,
          summary: "Raw-only scan artifact.",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await runSummarizePhase({
      loop: 1,
      runId: "phase3-summary",
      runRoot,
    });

    expect(result.validatedFindings).toHaveLength(1);

    const summary = await fs.readFile(result.summaryFile, "utf8");
    const confirmedFindings = await fs.readFile(result.confirmedFindingsFile, "utf8");

    expect(summary).toContain("Validated issue");
    expect(summary).not.toContain("Pending issue");
    expect(summary).not.toContain("Rejected issue");
    expect(summary).not.toContain("Raw-only issue");
    expect(confirmedFindings).toContain("Validated issue");
    expect(confirmedFindings).not.toContain("Pending issue");
    expect(confirmedFindings).not.toContain("Rejected issue");
    expect(confirmedFindings).not.toContain("Raw-only issue");
  });

  it("renders multiline validated report fields without malformed confirmed-findings bullets", async () => {
    const workspaceRoot = await createWorkspace();
    const runRoot = path.join(workspaceRoot, ".ai-auditor", "runs", "phase3-summary-multiline");
    const loopRoot = path.join(runRoot, "loops", "0001");

    await writeValidationArtifact({
      disposition: "confirmed",
      findingId: "validated-multiline",
      locations: ["Sample.sol:12", "Sample.sol:33\nbranch"],
      loopRoot,
      outcome: "validated",
      runId: "phase3-summary-multiline",
      scanId: "0001",
      severity: "high",
      summary: "Validated issue summary line 1.\nValidated issue summary line 2.",
      title: "Validated issue\nwrapped",
      triageRationale: "Triage rationale line 1.\nTriage rationale line 2.",
      validationRationale: "Validation rationale line 1.\nValidation rationale line 2.",
    });

    const result = await runSummarizePhase({
      loop: 1,
      runId: "phase3-summary-multiline",
      runRoot,
    });

    const summary = await fs.readFile(result.summaryFile, "utf8");
    const confirmedFindings = await fs.readFile(result.confirmedFindingsFile, "utf8");

    expect(summary).toContain("Validated issue wrapped");
    expect(summary).toContain("Sample.sol:12, Sample.sol:33 branch");

    expect(confirmedFindings).toContain("## [high] Validated issue wrapped");
    expect(confirmedFindings).toContain("- Locations: `Sample.sol:12, Sample.sol:33 branch`");
    expect(confirmedFindings).toContain("### Summary");
    expect(confirmedFindings).toContain("> Validated issue summary line 1.");
    expect(confirmedFindings).toContain("> Validated issue summary line 2.");
    expect(confirmedFindings).not.toContain("- Summary: Validated issue summary line 1.\nValidated issue summary line 2.");
    expect(confirmedFindings).toContain("### Triage Rationale");
    expect(confirmedFindings).toContain("> Triage rationale line 1.");
    expect(confirmedFindings).toContain("> Triage rationale line 2.");
    expect(confirmedFindings).toContain("### Validation Rationale");
    expect(confirmedFindings).toContain("> Validation rationale line 1.");
    expect(confirmedFindings).toContain("> Validation rationale line 2.");
  });
});

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-phase3-"));
  tempRoots.push(workspaceRoot);
  return workspaceRoot;
}

async function listArtifactDirectories(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function phase3FixturePath(): string {
  return path.resolve(process.cwd(), "tests", "fixtures", "phase3-scan-findings.json");
}

async function writeValidationArtifact(options: {
  readonly disposition: TriageDisposition;
  readonly findingId: string;
  readonly locations?: string[];
  readonly loopRoot: string;
  readonly outcome: ValidationOutcome;
  readonly runId: string;
  readonly scanId: string;
  readonly severity: Severity;
  readonly summary: string;
  readonly title: string;
  readonly triageRationale?: string;
  readonly validationRationale?: string;
}): Promise<void> {
  const outcomeRoot = path.join(
    options.loopRoot,
    options.outcome,
    `${options.scanId}-${options.findingId}`,
  );
  const finding = FindingContractSchema.parse({
    createdAt: "2026-04-12T01:12:01.000Z",
    findingId: options.findingId,
    locations: options.locations ?? ["Sample.sol:12"],
    loop: 1,
    runId: options.runId,
    scanId: options.scanId,
    schemaVersion: 1,
    severity: options.severity,
    summary: options.summary,
    title: options.title,
  });
  const triage = TriageContractSchema.parse({
    disposition: options.disposition,
    findingId: options.findingId,
    loop: 1,
    rationale: options.triageRationale ?? `${options.disposition} rationale`,
    runId: options.runId,
    scanId: options.scanId,
    schemaVersion: 1,
    triagedAt: "2026-04-12T01:12:02.000Z",
  });
  const validation = ValidationContractSchema.parse({
    findingId: options.findingId,
    loop: 1,
    outcome: options.outcome,
    rationale: options.validationRationale ?? `${options.outcome} rationale`,
    runId: options.runId,
    scanId: options.scanId,
    schemaVersion: 1,
    validatedAt: "2026-04-12T01:12:03.000Z",
    validator: "phase3-dry-seam",
  });

  await fs.mkdir(outcomeRoot, { recursive: true });
  await fs.writeFile(path.join(outcomeRoot, "finding.json"), `${JSON.stringify(finding, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outcomeRoot, "prompt.md"), "# validator\n", "utf8");
  await fs.writeFile(path.join(outcomeRoot, "triage.json"), `${JSON.stringify(triage, null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(outcomeRoot, "validation.json"),
    `${JSON.stringify(validation, null, 2)}\n`,
    "utf8",
  );
}
