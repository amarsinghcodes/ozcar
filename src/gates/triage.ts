import { promises as fs } from "node:fs";
import path from "node:path";

import type { ZodIssue } from "zod";

import { FindingContract, FindingContractSchema } from "../contracts/finding";
import { TriageContract, TriageContractSchema } from "../contracts/triage";

export interface TriageGateOptions {
  readonly expectedFindingId: string;
  readonly expectedLoop: number;
  readonly expectedRunId: string;
  readonly expectedScanId: string;
  readonly triageRoot: string;
}

export interface TriageGateResult {
  readonly finding: FindingContract;
  readonly findingFile: string;
  readonly promptFile: string;
  readonly triage: TriageContract;
  readonly triageFile: string;
}

export class TriageGateError extends Error {
  readonly artifactPath: string;

  constructor(artifactPath: string, message: string) {
    super(message);
    this.name = "TriageGateError";
    this.artifactPath = artifactPath;
  }
}

export async function assertTriageGate(options: TriageGateOptions): Promise<TriageGateResult> {
  const findingFile = path.join(options.triageRoot, "finding.json");
  const promptFile = path.join(options.triageRoot, "prompt.md");
  const triageFile = path.join(options.triageRoot, "triage.json");

  await requireFile(findingFile, "finding.json");
  await requireFile(promptFile, "prompt.md");
  await requireFile(triageFile, "triage.json");

  const prompt = await fs.readFile(promptFile, "utf8");
  if (prompt.trim().length === 0) {
    throw new TriageGateError(promptFile, `Triage gate rejected ${promptFile}: rendered triager prompt is empty.`);
  }

  const finding = await readFindingFile(findingFile);
  const triage = await readTriageFile(triageFile);

  assertFindingIdentity(
    findingFile,
    finding.runId,
    options.expectedRunId,
    finding.loop,
    options.expectedLoop,
    finding.scanId,
    options.expectedScanId,
    finding.findingId,
    options.expectedFindingId,
  );
  assertTriageIdentity(
    triageFile,
    triage.runId,
    options.expectedRunId,
    triage.loop,
    options.expectedLoop,
    triage.scanId,
    options.expectedScanId,
    triage.findingId,
    options.expectedFindingId,
  );

  if (triage.scanId !== finding.scanId || triage.findingId !== finding.findingId) {
    throw new TriageGateError(
      triageFile,
      `Triage gate rejected ${triageFile}: triage identity drifted from ${findingFile}.`,
    );
  }

  return {
    finding,
    findingFile,
    promptFile,
    triage,
    triageFile,
  };
}

async function readFindingFile(findingFile: string): Promise<FindingContract> {
  const raw = await fs.readFile(findingFile, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new TriageGateError(findingFile, `Triage gate rejected ${findingFile}: invalid JSON (${String(error)}).`);
  }

  const result = FindingContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new TriageGateError(
      findingFile,
      `Triage gate rejected ${findingFile}: ${formatIssues(result.error.issues)}.`,
    );
  }

  return result.data;
}

async function readTriageFile(triageFile: string): Promise<TriageContract> {
  const raw = await fs.readFile(triageFile, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new TriageGateError(triageFile, `Triage gate rejected ${triageFile}: invalid JSON (${String(error)}).`);
  }

  const result = TriageContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new TriageGateError(
      triageFile,
      `Triage gate rejected ${triageFile}: ${formatIssues(result.error.issues)}.`,
    );
  }

  return result.data;
}

async function requireFile(filePath: string, artifactLabel: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new TriageGateError(
      filePath,
      `Triage gate rejected ${filePath}: missing required triage artifact ${artifactLabel}.`,
    );
  }
}

function assertFindingIdentity(
  artifactPath: string,
  actualRunId: string,
  expectedRunId: string,
  actualLoop: number,
  expectedLoop: number,
  actualScanId: string,
  expectedScanId: string,
  actualFindingId: string,
  expectedFindingId: string,
): void {
  if (actualRunId !== expectedRunId) {
    throw new TriageGateError(
      artifactPath,
      `Triage gate rejected ${artifactPath}: expected runId ${expectedRunId} but found ${actualRunId}.`,
    );
  }

  if (actualLoop !== expectedLoop) {
    throw new TriageGateError(
      artifactPath,
      `Triage gate rejected ${artifactPath}: expected loop ${expectedLoop} but found ${actualLoop}.`,
    );
  }

  if (actualScanId !== expectedScanId) {
    throw new TriageGateError(
      artifactPath,
      `Triage gate rejected ${artifactPath}: expected scanId ${expectedScanId} but found ${actualScanId}.`,
    );
  }

  if (actualFindingId !== expectedFindingId) {
    throw new TriageGateError(
      artifactPath,
      `Triage gate rejected ${artifactPath}: expected findingId ${expectedFindingId} but found ${actualFindingId}.`,
    );
  }
}

function assertTriageIdentity(
  artifactPath: string,
  actualRunId: string,
  expectedRunId: string,
  actualLoop: number,
  expectedLoop: number,
  actualScanId: string,
  expectedScanId: string,
  actualFindingId: string,
  expectedFindingId: string,
): void {
  assertFindingIdentity(
    artifactPath,
    actualRunId,
    expectedRunId,
    actualLoop,
    expectedLoop,
    actualScanId,
    expectedScanId,
    actualFindingId,
    expectedFindingId,
  );
}

function formatIssues(issues: readonly ZodIssue[]): string {
  return issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}
