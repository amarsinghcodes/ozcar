import { promises as fs } from "node:fs";
import path from "node:path";

import type { ZodIssue } from "zod";

import { PlanContract, PlanContractSchema } from "../contracts/plan";
import { ScanOutput, ScanOutputSchema, ScanRequest, ScanRequestSchema } from "../contracts/scan";

export interface ScanGateOptions {
  readonly expectedLoop: number;
  readonly expectedRunId: string;
  readonly expectedScanId: string;
  readonly requireOutput?: boolean;
  readonly scanRoot: string;
}

export interface ScanGateResult {
  readonly output: ScanOutput | null;
  readonly outputFile: string;
  readonly plan: PlanContract;
  readonly planFile: string;
  readonly promptFile: string;
  readonly request: ScanRequest;
  readonly requestFile: string;
}

export class ScanGateError extends Error {
  readonly artifactPath: string;

  constructor(artifactPath: string, message: string) {
    super(message);
    this.name = "ScanGateError";
    this.artifactPath = artifactPath;
  }
}

export async function assertScanGate(options: ScanGateOptions): Promise<ScanGateResult> {
  const loopRoot = path.resolve(options.scanRoot, "..", "..");
  const planFile = path.join(loopRoot, "plan.json");
  const requestFile = path.join(options.scanRoot, "request.json");
  const promptFile = path.join(options.scanRoot, "prompt.md");
  const outputFile = path.join(options.scanRoot, "output.json");
  const requireOutput = options.requireOutput ?? true;

  await requireFile(requestFile, "request.json");
  await requireFile(promptFile, "prompt.md");

  if (requireOutput) {
    await requireFile(outputFile, "output.json");
  }

  const prompt = await fs.readFile(promptFile, "utf8");
  if (prompt.trim().length === 0) {
    throw new ScanGateError(promptFile, `Scan gate rejected ${promptFile}: rendered scanner prompt is empty.`);
  }

  const request = await readRequestFile(requestFile);
  assertScanIdentity(requestFile, request.runId, options.expectedRunId, request.loop, options.expectedLoop, request.scanId, options.expectedScanId);
  await requireFile(planFile, "plan.json");
  const plan = await readPlanFile(planFile);
  assertPlanIdentity(planFile, plan.runId, options.expectedRunId, plan.loop, options.expectedLoop);
  assertPlannedScanProvider(requestFile, request.provider, plan.provider, planFile);

  let output: ScanOutput | null = null;

  if (requireOutput) {
    output = await readOutputFile(outputFile);
    assertScanIdentity(outputFile, output.runId, options.expectedRunId, output.loop, options.expectedLoop, output.scanId, options.expectedScanId);

    if (request.dryRun && output.mode !== "dry-run") {
      throw new ScanGateError(
        outputFile,
        `Scan gate rejected ${outputFile}: expected dry-run output for replayable dry-run scan artifacts.`,
      );
    }
  }

  return {
    output,
    outputFile,
    plan,
    planFile,
    promptFile,
    request,
    requestFile,
  };
}

async function readPlanFile(planFile: string): Promise<PlanContract> {
  const raw = await fs.readFile(planFile, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new ScanGateError(planFile, `Scan gate rejected ${planFile}: invalid JSON (${String(error)}).`);
  }

  const result = PlanContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new ScanGateError(
      planFile,
      `Scan gate rejected ${planFile}: ${formatIssues(result.error.issues)}.`,
    );
  }

  return result.data;
}

async function readRequestFile(requestFile: string): Promise<ScanRequest> {
  const raw = await fs.readFile(requestFile, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new ScanGateError(requestFile, `Scan gate rejected ${requestFile}: invalid JSON (${String(error)}).`);
  }

  const result = ScanRequestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ScanGateError(
      requestFile,
      `Scan gate rejected ${requestFile}: ${formatIssues(result.error.issues)}.`,
    );
  }

  return result.data;
}

async function readOutputFile(outputFile: string): Promise<ScanOutput> {
  const raw = await fs.readFile(outputFile, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new ScanGateError(outputFile, `Scan gate rejected ${outputFile}: invalid JSON (${String(error)}).`);
  }

  const result = ScanOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new ScanGateError(
      outputFile,
      `Scan gate rejected ${outputFile}: ${formatIssues(result.error.issues)}.`,
    );
  }

  return result.data;
}

async function requireFile(filePath: string, artifactLabel: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new ScanGateError(filePath, `Scan gate rejected ${filePath}: missing required scan artifact ${artifactLabel}.`);
  }
}

function assertScanIdentity(
  artifactPath: string,
  actualRunId: string,
  expectedRunId: string,
  actualLoop: number,
  expectedLoop: number,
  actualScanId: string,
  expectedScanId: string,
): void {
  if (actualRunId !== expectedRunId) {
    throw new ScanGateError(
      artifactPath,
      `Scan gate rejected ${artifactPath}: expected runId ${expectedRunId} but found ${actualRunId}.`,
    );
  }

  if (actualLoop !== expectedLoop) {
    throw new ScanGateError(
      artifactPath,
      `Scan gate rejected ${artifactPath}: expected loop ${expectedLoop} but found ${actualLoop}.`,
    );
  }

  if (actualScanId !== expectedScanId) {
    throw new ScanGateError(
      artifactPath,
      `Scan gate rejected ${artifactPath}: expected scanId ${expectedScanId} but found ${actualScanId}.`,
    );
  }
}

function assertPlanIdentity(artifactPath: string, actualRunId: string, expectedRunId: string, actualLoop: number, expectedLoop: number): void {
  if (actualRunId !== expectedRunId) {
    throw new ScanGateError(
      artifactPath,
      `Scan gate rejected ${artifactPath}: expected runId ${expectedRunId} but found ${actualRunId}.`,
    );
  }

  if (actualLoop !== expectedLoop) {
    throw new ScanGateError(
      artifactPath,
      `Scan gate rejected ${artifactPath}: expected loop ${expectedLoop} but found ${actualLoop}.`,
    );
  }
}

function assertPlannedScanProvider(
  artifactPath: string,
  actualProvider: ScanRequest["provider"],
  expectedProvider: PlanContract["provider"],
  planFile: string,
): void {
  const comparisons: Array<["available" | "model" | "name" | "selection", boolean]> = [
    ["name", actualProvider.name === expectedProvider.name],
    ["selection", actualProvider.selection === expectedProvider.selection],
    ["model", actualProvider.model === expectedProvider.model],
    ["available", actualProvider.available === expectedProvider.available],
  ];

  for (const [field, matches] of comparisons) {
    if (!matches) {
      throw new ScanGateError(
        artifactPath,
        `Scan gate rejected ${artifactPath}: provider.${field} drifted from ${planFile}; expected ${JSON.stringify(
          expectedProvider[field],
        )} but found ${JSON.stringify(actualProvider[field])}.`,
      );
    }
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
