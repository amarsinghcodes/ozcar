import { promises as fs } from "node:fs";
import path from "node:path";

import { PhaseName, RunRecord } from "../contracts/run";
import { assertPlanGate } from "../gates/plan";
import { assertScanGate } from "../gates/scan";
import { assertTriageGate } from "../gates/triage";
import { assertValidationGate } from "../gates/validate";
import { formatFindingArtifactId } from "../phases/triage";
import { outcomeToDirectory, validationOutcomeForDisposition } from "../phases/validate";
import { buildConfirmedFindingsReport } from "../reports/confirmed-findings";
import { buildSummaryReport } from "../reports/summary";
import { RunSnapshot } from "./run-store";

type ValidationDirectory = "pending" | "rejected" | "validated";

export interface RunHealthIssue {
  readonly artifactPath?: string;
  readonly code: string;
  readonly message: string;
}

export interface RunHealthCounts {
  readonly pendingArtifacts: number;
  readonly rejectedArtifacts: number;
  readonly scanFindings: number;
  readonly scansPlanned: number;
  readonly triageArtifacts: number;
  readonly validatedArtifacts: number;
}

export interface RunHealthReport {
  readonly counts: RunHealthCounts;
  readonly eventCount: number;
  readonly issues: RunHealthIssue[];
  readonly lastEventType: string | null;
  readonly loop: number;
  readonly ok: boolean;
  readonly reportState: {
    readonly confirmedFindingsFile: string;
    readonly confirmedFindingsFresh: boolean | null;
    readonly summaryFile: string;
    readonly summaryFresh: boolean | null;
  };
  readonly run: RunRecord;
  readonly runId: string;
  readonly runRoot: string;
}

export async function inspectRunHealth(snapshot: RunSnapshot): Promise<RunHealthReport> {
  const loop = snapshot.run.activeLoop;
  const issues: RunHealthIssue[] = [];
  const counts: MutableRunHealthCounts = {
    pendingArtifacts: 0,
    rejectedArtifacts: 0,
    scanFindings: 0,
    scansPlanned: 0,
    triageArtifacts: 0,
    validatedArtifacts: 0,
  };
  const summaryFile = path.join(snapshot.paths.runRoot, "summary.md");
  const confirmedFindingsFile = path.join(snapshot.paths.runRoot, "confirmed-findings.md");
  let summaryFresh: boolean | null = null;
  let confirmedFindingsFresh: boolean | null = null;

  if (loop > 0 && expectsPhase(snapshot.run, "plan")) {
    const loopRoot = path.join(snapshot.paths.runRoot, "loops", formatSequence(loop));

    try {
      const planResult = await assertPlanGate({
        expectedLoop: loop,
        expectedRunId: snapshot.run.runId,
        loopRoot,
      });
      counts.scansPlanned = planResult.plan.scans.length;

      const scanResults: Awaited<ReturnType<typeof assertScanGate>>[] = [];
      let scansHealthy = true;

      if (expectsPhase(snapshot.run, "scan")) {
        for (const scan of planResult.plan.scans) {
          const scanRoot = path.join(loopRoot, "scans", scan.scanId);

          try {
            const gated = await assertScanGate({
              expectedLoop: loop,
              expectedRunId: snapshot.run.runId,
              expectedScanId: scan.scanId,
              scanRoot,
            });

            scanResults.push(gated);
            counts.scanFindings += gated.output?.findings.length ?? 0;
          } catch (error: unknown) {
            scansHealthy = false;
            issues.push(toIssue("scan.gate", error));
          }
        }
      }

      const triageRoot = path.join(loopRoot, "triage");
      const actualTriageIds = await listDirectoryNames(triageRoot);
      const triageResults: Awaited<ReturnType<typeof assertTriageGate>>[] = [];
      const expectedTriageIds = new Set<string>();
      let triageHealthy = true;

      if (expectsPhase(snapshot.run, "triage") || actualTriageIds.length > 0) {
        for (const scanResult of scanResults) {
          for (const finding of scanResult.output?.findings ?? []) {
            const artifactId = formatFindingArtifactId(scanResult.request.scanId, finding.id);
            expectedTriageIds.add(artifactId);

            try {
              const gated = await assertTriageGate({
                expectedFindingId: finding.id,
                expectedLoop: loop,
                expectedRunId: snapshot.run.runId,
                expectedScanId: scanResult.request.scanId,
                triageRoot: path.join(triageRoot, artifactId),
              });

              triageResults.push(gated);
              counts.triageArtifacts += 1;
            } catch (error: unknown) {
              triageHealthy = false;
              issues.push(toIssue("triage.gate", error));
            }
          }
        }

        for (const artifactId of actualTriageIds) {
          if (!expectedTriageIds.has(artifactId)) {
            triageHealthy = false;
            issues.push({
              artifactPath: path.join(triageRoot, artifactId),
              code: "triage.extra",
              message: `Triage artifact ${artifactId} is not backed by a current scan finding.`,
            });
          }
        }
      }

      const actualValidation = await listValidationArtifacts(loopRoot);
      const validationResults: Awaited<ReturnType<typeof assertValidationGate>>[] = [];
      const expectedValidation = new Map<string, ValidationDirectory>();
      let validationHealthy = true;

      if (expectsPhase(snapshot.run, "validate") || actualValidation.total > 0) {
        for (const triageResult of triageResults) {
          const artifactId = formatFindingArtifactId(triageResult.finding.scanId, triageResult.finding.findingId);
          const expectedOutcome = validationOutcomeForDisposition(triageResult.triage.disposition);
          const directory = outcomeToDirectory(expectedOutcome);

          expectedValidation.set(artifactId, directory);

          try {
            const gated = await assertValidationGate({
              expectedFindingId: triageResult.finding.findingId,
              expectedLoop: loop,
              expectedOutcome,
              expectedRunId: snapshot.run.runId,
              expectedScanId: triageResult.finding.scanId,
              validationRoot: path.join(loopRoot, directory, artifactId),
            });

            validationResults.push(gated);
            incrementValidationCount(counts, directory);
          } catch (error: unknown) {
            validationHealthy = false;
            issues.push(toIssue("validate.gate", error));
          }
        }

        for (const [artifactId, directories] of actualValidation.byArtifact.entries()) {
          if (!expectedValidation.has(artifactId)) {
            validationHealthy = false;
            issues.push({
              artifactPath: path.join(loopRoot, directories[0], artifactId),
              code: "validate.extra",
              message: `Validation artifact ${artifactId} is not backed by a current triage decision.`,
            });
            continue;
          }

          if (directories.length > 1) {
            validationHealthy = false;
            issues.push({
              artifactPath: path.join(loopRoot, directories[0], artifactId),
              code: "validate.duplicate",
              message: `Validation artifact ${artifactId} is duplicated across outcome directories: ${directories.join(", ")}.`,
            });
            continue;
          }

          const expectedDirectory = expectedValidation.get(artifactId);
          if (expectedDirectory && directories[0] !== expectedDirectory) {
            validationHealthy = false;
            issues.push({
              artifactPath: path.join(loopRoot, directories[0], artifactId),
              code: "validate.stale-location",
              message: `Validation artifact ${artifactId} is stored under ${directories[0]} but triage expects ${expectedDirectory}.`,
            });
          }
        }
      }

      const shouldCheckReports =
        expectsPhase(snapshot.run, "summarize") ||
        (await pathExists(summaryFile)) ||
        (await pathExists(confirmedFindingsFile));
      const canCompareReports =
        scansHealthy &&
        triageHealthy &&
        validationHealthy &&
        validationResults.length === expectedValidation.size;

      if (shouldCheckReports) {
        if (!(await pathExists(summaryFile))) {
          issues.push({
            artifactPath: summaryFile,
            code: "report.summary.missing",
            message: `Expected report ${summaryFile} is missing.`,
          });
        } else if (canCompareReports) {
          const actualSummary = await fs.readFile(summaryFile, "utf8");
          const expectedSummary = buildSummaryReport(validationResults.map((result) => result.bundle));
          summaryFresh = actualSummary === expectedSummary;

          if (!summaryFresh) {
            issues.push({
              artifactPath: summaryFile,
              code: "report.summary.stale",
              message: `${summaryFile} does not match a mechanical rebuild from validated artifacts.`,
            });
          }
        }

        if (!(await pathExists(confirmedFindingsFile))) {
          issues.push({
            artifactPath: confirmedFindingsFile,
            code: "report.confirmed.missing",
            message: `Expected report ${confirmedFindingsFile} is missing.`,
          });
        } else if (canCompareReports) {
          const actualConfirmedFindings = await fs.readFile(confirmedFindingsFile, "utf8");
          const expectedConfirmedFindings = buildConfirmedFindingsReport(
            validationResults.map((result) => result.bundle),
          );
          confirmedFindingsFresh = actualConfirmedFindings === expectedConfirmedFindings;

          if (!confirmedFindingsFresh) {
            issues.push({
              artifactPath: confirmedFindingsFile,
              code: "report.confirmed.stale",
              message: `${confirmedFindingsFile} does not match a mechanical rebuild from validated artifacts.`,
            });
          }
        }
      }
    } catch (error: unknown) {
      issues.push(toIssue("plan.gate", error));
    }
  }

  return {
    counts,
    eventCount: snapshot.events.length,
    issues,
    lastEventType: snapshot.events[snapshot.events.length - 1]?.type ?? null,
    loop,
    ok: issues.length === 0,
    reportState: {
      confirmedFindingsFile,
      confirmedFindingsFresh,
      summaryFile,
      summaryFresh,
    },
    run: snapshot.run,
    runId: snapshot.run.runId,
    runRoot: snapshot.paths.runRoot,
  };
}

type MutableRunHealthCounts = {
  -readonly [K in keyof RunHealthCounts]: RunHealthCounts[K];
};

function expectsPhase(run: RunRecord, phase: PhaseName): boolean {
  if (run.status === "completed") {
    return true;
  }

  if (!run.currentPhase) {
    return false;
  }

  return phaseRank(run.currentPhase) >= phaseRank(phase);
}

function formatSequence(value: number): string {
  return value.toString().padStart(4, "0");
}

function incrementValidationCount(counts: MutableRunHealthCounts, directory: ValidationDirectory): void {
  switch (directory) {
    case "validated":
      counts.validatedArtifacts += 1;
      break;
    case "pending":
      counts.pendingArtifacts += 1;
      break;
    case "rejected":
      counts.rejectedArtifacts += 1;
      break;
  }
}

async function listDirectoryNames(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error: unknown) {
    if (isErrnoException(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function listValidationArtifacts(loopRoot: string): Promise<{
  readonly byArtifact: Map<string, ValidationDirectory[]>;
  readonly total: number;
}> {
  const byArtifact = new Map<string, ValidationDirectory[]>();
  let total = 0;

  for (const directory of ["validated", "pending", "rejected"] as const) {
    const artifactIds = await listDirectoryNames(path.join(loopRoot, directory));
    total += artifactIds.length;

    for (const artifactId of artifactIds) {
      const existing = byArtifact.get(artifactId) ?? [];
      existing.push(directory);
      byArtifact.set(artifactId, existing);
    }
  }

  return {
    byArtifact,
    total,
  };
}

function phaseRank(phase: PhaseName): number {
  switch (phase) {
    case "plan":
      return 0;
    case "scan":
      return 1;
    case "triage":
      return 2;
    case "validate":
      return 3;
    case "summarize":
      return 4;
  }
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function toIssue(code: string, error: unknown): RunHealthIssue {
  const message = error instanceof Error ? error.message : String(error);
  const artifactPath =
    typeof error === "object" && error !== null && "artifactPath" in error && typeof error.artifactPath === "string"
      ? error.artifactPath
      : undefined;

  return {
    ...(artifactPath ? { artifactPath } : {}),
    code,
    message,
  };
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
