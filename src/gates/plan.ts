import { promises as fs } from "node:fs";
import path from "node:path";

import type { ZodIssue } from "zod";

import { PlanContract, PlanContractSchema } from "../contracts/plan";

export interface PlanGateOptions {
  readonly expectedLoop: number;
  readonly expectedRunId: string;
  readonly loopRoot: string;
}

export interface PlanGateResult {
  readonly plan: PlanContract;
  readonly planFile: string;
  readonly promptFile: string;
}

export class PlanGateError extends Error {
  readonly artifactPath: string;

  constructor(artifactPath: string, message: string) {
    super(message);
    this.name = "PlanGateError";
    this.artifactPath = artifactPath;
  }
}

export async function assertPlanGate(options: PlanGateOptions): Promise<PlanGateResult> {
  const planFile = path.join(options.loopRoot, "plan.json");
  const promptFile = path.join(options.loopRoot, "plan.prompt.md");

  await requireFile(planFile, "plan.json");
  await requireFile(promptFile, "plan.prompt.md");

  const prompt = await fs.readFile(promptFile, "utf8");
  if (prompt.trim().length === 0) {
    throw new PlanGateError(promptFile, `Plan gate rejected ${promptFile}: rendered planner prompt is empty.`);
  }

  const plan = await readPlanFile(planFile);

  if (plan.runId !== options.expectedRunId) {
    throw new PlanGateError(
      planFile,
      `Plan gate rejected ${planFile}: expected runId ${options.expectedRunId} but found ${plan.runId}.`,
    );
  }

  if (plan.loop !== options.expectedLoop) {
    throw new PlanGateError(
      planFile,
      `Plan gate rejected ${planFile}: expected loop ${options.expectedLoop} but found ${plan.loop}.`,
    );
  }

  return {
    plan,
    planFile,
    promptFile,
  };
}

async function readPlanFile(planFile: string): Promise<PlanContract> {
  const raw = await fs.readFile(planFile, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new PlanGateError(planFile, `Plan gate rejected ${planFile}: invalid JSON (${String(error)}).`);
  }

  const result = PlanContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new PlanGateError(
      planFile,
      `Plan gate rejected ${planFile}: ${formatIssues(result.error.issues)}.`,
    );
  }

  return result.data;
}

async function requireFile(filePath: string, artifactLabel: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new PlanGateError(filePath, `Plan gate rejected ${filePath}: missing required plan artifact ${artifactLabel}.`);
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
