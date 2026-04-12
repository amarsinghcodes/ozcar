import { promises as fs } from "node:fs";
import path from "node:path";

import type { ZodIssue } from "zod";

import { FindingContract, FindingContractSchema } from "../contracts/finding";
import { FindingDecisionBundle, FindingDecisionBundleSchema, ValidationContract, ValidationContractSchema, ValidationOutcome } from "../contracts/validation";
import { TriageContract, TriageContractSchema } from "../contracts/triage";

export interface ValidationGateOptions {
  readonly expectedFindingId: string;
  readonly expectedLoop: number;
  readonly expectedOutcome?: ValidationOutcome;
  readonly expectedRunId: string;
  readonly expectedScanId: string;
  readonly validationRoot: string;
}

export interface ValidationGateResult {
  readonly bundle: FindingDecisionBundle;
  readonly finding: FindingContract;
  readonly findingFile: string;
  readonly promptFile: string;
  readonly triage: TriageContract;
  readonly triageFile: string;
  readonly validation: ValidationContract;
  readonly validationFile: string;
}

export class ValidationGateError extends Error {
  readonly artifactPath: string;

  constructor(artifactPath: string, message: string) {
    super(message);
    this.name = "ValidationGateError";
    this.artifactPath = artifactPath;
  }
}

export async function assertValidationGate(options: ValidationGateOptions): Promise<ValidationGateResult> {
  const findingFile = path.join(options.validationRoot, "finding.json");
  const promptFile = path.join(options.validationRoot, "prompt.md");
  const triageFile = path.join(options.validationRoot, "triage.json");
  const validationFile = path.join(options.validationRoot, "validation.json");

  await requireFile(findingFile, "finding.json");
  await requireFile(promptFile, "prompt.md");
  await requireFile(triageFile, "triage.json");
  await requireFile(validationFile, "validation.json");

  const prompt = await fs.readFile(promptFile, "utf8");
  if (prompt.trim().length === 0) {
    throw new ValidationGateError(promptFile, `Validation gate rejected ${promptFile}: rendered validator prompt is empty.`);
  }

  const finding = await readFindingFile(findingFile);
  const triage = await readTriageFile(triageFile);
  const validation = await readValidationFile(validationFile);

  assertArtifactIdentity(
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
  assertArtifactIdentity(
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
  assertArtifactIdentity(
    validationFile,
    validation.runId,
    options.expectedRunId,
    validation.loop,
    options.expectedLoop,
    validation.scanId,
    options.expectedScanId,
    validation.findingId,
    options.expectedFindingId,
  );

  if (triage.scanId !== finding.scanId || triage.findingId !== finding.findingId) {
    throw new ValidationGateError(
      triageFile,
      `Validation gate rejected ${triageFile}: triage identity drifted from ${findingFile}.`,
    );
  }

  if (validation.scanId !== finding.scanId || validation.findingId !== finding.findingId) {
    throw new ValidationGateError(
      validationFile,
      `Validation gate rejected ${validationFile}: validation identity drifted from ${findingFile}.`,
    );
  }

  if (options.expectedOutcome && validation.outcome !== options.expectedOutcome) {
    throw new ValidationGateError(
      validationFile,
      `Validation gate rejected ${validationFile}: expected outcome ${options.expectedOutcome} but found ${validation.outcome}.`,
    );
  }

  if (validation.outcome === "validated" && triage.disposition !== "confirmed") {
    throw new ValidationGateError(
      validationFile,
      `Validation gate rejected ${validationFile}: validated findings require triage disposition confirmed.`,
    );
  }

  const bundle = FindingDecisionBundleSchema.parse({
    finding,
    triage,
    validation,
  });

  return {
    bundle,
    finding,
    findingFile,
    promptFile,
    triage,
    triageFile,
    validation,
    validationFile,
  };
}

async function readFindingFile(findingFile: string): Promise<FindingContract> {
  const raw = await fs.readFile(findingFile, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new ValidationGateError(
      findingFile,
      `Validation gate rejected ${findingFile}: invalid JSON (${String(error)}).`,
    );
  }

  const result = FindingContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationGateError(
      findingFile,
      `Validation gate rejected ${findingFile}: ${formatIssues(result.error.issues)}.`,
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
    throw new ValidationGateError(
      triageFile,
      `Validation gate rejected ${triageFile}: invalid JSON (${String(error)}).`,
    );
  }

  const result = TriageContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationGateError(
      triageFile,
      `Validation gate rejected ${triageFile}: ${formatIssues(result.error.issues)}.`,
    );
  }

  return result.data;
}

async function readValidationFile(validationFile: string): Promise<ValidationContract> {
  const raw = await fs.readFile(validationFile, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new ValidationGateError(
      validationFile,
      `Validation gate rejected ${validationFile}: invalid JSON (${String(error)}).`,
    );
  }

  const result = ValidationContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationGateError(
      validationFile,
      `Validation gate rejected ${validationFile}: ${formatIssues(result.error.issues)}.`,
    );
  }

  return result.data;
}

async function requireFile(filePath: string, artifactLabel: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new ValidationGateError(
      filePath,
      `Validation gate rejected ${filePath}: missing required validation artifact ${artifactLabel}.`,
    );
  }
}

function assertArtifactIdentity(
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
    throw new ValidationGateError(
      artifactPath,
      `Validation gate rejected ${artifactPath}: expected runId ${expectedRunId} but found ${actualRunId}.`,
    );
  }

  if (actualLoop !== expectedLoop) {
    throw new ValidationGateError(
      artifactPath,
      `Validation gate rejected ${artifactPath}: expected loop ${expectedLoop} but found ${actualLoop}.`,
    );
  }

  if (actualScanId !== expectedScanId) {
    throw new ValidationGateError(
      artifactPath,
      `Validation gate rejected ${artifactPath}: expected scanId ${expectedScanId} but found ${actualScanId}.`,
    );
  }

  if (actualFindingId !== expectedFindingId) {
    throw new ValidationGateError(
      artifactPath,
      `Validation gate rejected ${artifactPath}: expected findingId ${expectedFindingId} but found ${actualFindingId}.`,
    );
  }
}

function formatIssues(issues: readonly ZodIssue[]): string {
  return issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}
