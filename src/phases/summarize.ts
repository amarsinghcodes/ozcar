import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import { FindingDecisionBundle } from "../contracts/validation";
import { ValidationGateError, assertValidationGate } from "../gates/validate";
import { buildConfirmedFindingsReport } from "../reports/confirmed-findings";
import { buildSummaryReport } from "../reports/summary";

export interface SummarizePhaseOptions {
  readonly loop: number;
  readonly runId: string;
  readonly runRoot: string;
}

export interface SummarizePhaseResult {
  readonly confirmedFindingsFile: string;
  readonly summaryFile: string;
  readonly validatedFindings: FindingDecisionBundle[];
}

export async function runSummarizePhase(options: SummarizePhaseOptions): Promise<SummarizePhaseResult> {
  const loopId = formatSequence(options.loop);
  const validatedRoot = path.join(options.runRoot, "loops", loopId, "validated");
  const validatedFindings = await readValidatedFindings(validatedRoot, options.runId, options.loop);
  const summaryFile = path.join(options.runRoot, "summary.md");
  const confirmedFindingsFile = path.join(options.runRoot, "confirmed-findings.md");

  await fs.writeFile(summaryFile, buildSummaryReport(validatedFindings), "utf8");
  await fs.writeFile(confirmedFindingsFile, buildConfirmedFindingsReport(validatedFindings), "utf8");

  return {
    confirmedFindingsFile,
    summaryFile,
    validatedFindings,
  };
}

async function readValidatedFindings(
  validatedRoot: string,
  runId: string,
  loop: number,
): Promise<FindingDecisionBundle[]> {
  let entries: Dirent[];

  try {
    entries = await fs.readdir(validatedRoot, { withFileTypes: true });
  } catch (error: unknown) {
    if (isErrnoException(error, "ENOENT")) {
      return [];
    }

    throw error;
  }

  const roots = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(validatedRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const results: FindingDecisionBundle[] = [];

  for (const validationRoot of roots) {
    const artifactIdentity = parseValidatedArtifactIdentity(validationRoot);
    const gated = await assertValidationGate({
      expectedFindingId: artifactIdentity.findingId,
      expectedLoop: loop,
      expectedOutcome: "validated",
      expectedRunId: runId,
      expectedScanId: artifactIdentity.scanId,
      validationRoot,
    });

    results.push(gated.bundle);
  }

  return results;
}

function formatSequence(value: number): string {
  return value.toString().padStart(4, "0");
}

function parseValidatedArtifactIdentity(validationRoot: string): { findingId: string; scanId: string } {
  const artifactId = path.basename(validationRoot);
  const match = artifactId.match(/^(\d{4})-(.+)$/u);

  if (!match) {
    throw new ValidationGateError(
      validationRoot,
      `Validation gate rejected ${validationRoot}: expected validated artifact directory name <scanId>-<findingId>.`,
    );
  }

  return {
    findingId: match[2],
    scanId: match[1],
  };
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
