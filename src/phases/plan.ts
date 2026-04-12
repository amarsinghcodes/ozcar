import { promises as fs } from "node:fs";
import path from "node:path";

import { PlanContract, PlanContractSchema } from "../contracts/plan";
import { assertPlanGate } from "../gates/plan";
import { ResolvedProvider, resolveProviderModel } from "../providers/base";

const PLANNER_PROMPT_SOURCE = "src/prompts/planner.md";
const DEFAULT_SCAN_ID = "0001";

export interface PlanPhaseOptions {
  readonly loop: number;
  readonly model?: string;
  readonly now?: () => Date;
  readonly objectives?: string[];
  readonly provider: ResolvedProvider;
  readonly researchDirection: string;
  readonly runId: string;
  readonly runRoot: string;
  readonly scanTargets: string[];
  readonly scope: string[];
}

export interface PlanPhaseResult {
  readonly loopId: string;
  readonly loopRoot: string;
  readonly plan: PlanContract;
  readonly planFile: string;
  readonly promptFile: string;
}

export async function runPlanPhase(options: PlanPhaseOptions): Promise<PlanPhaseResult> {
  if (!options.provider.capabilities.plan) {
    throw new Error(`Provider ${options.provider.name} does not support the plan phase.`);
  }

  const now = options.now ?? (() => new Date());
  const loopId = formatSequence(options.loop);
  const loopRoot = path.join(options.runRoot, "loops", loopId);
  const createdAt = now().toISOString();
  const scope = normalizeEntries(options.scope);
  const scanTargets = normalizeEntries(options.scanTargets);
  const objectives = normalizeEntries(options.objectives ?? []);
  const planObjectives =
    objectives.length > 0 ? objectives : buildDefaultObjectives(loopId, scanTargets, options.researchDirection);
  const model = resolveProviderModel(options.provider, "plan", options.model);
  const promptTemplate = await fs.readFile(resolvePromptSource("planner.md"), "utf8");
  const prompt = renderPrompt(promptTemplate, {
    LOOP_ID: loopId,
    OBJECTIVES: formatMarkdownList(planObjectives),
    PROVIDER: options.provider.name,
    PROVIDER_MODEL: model,
    PROVIDER_SELECTION: options.provider.selection,
    RESEARCH_DIRECTION: options.researchDirection.trim(),
    RUN_ID: options.runId,
    SCAN_TARGETS: formatMarkdownList(scanTargets),
    SCOPE: formatMarkdownList(scope),
  });

  const plan = PlanContractSchema.parse({
    createdAt,
    loop: options.loop,
    objectives: planObjectives,
    provider: {
      available: options.provider.available,
      model,
      name: options.provider.name,
      selection: options.provider.selection,
    },
    runId: options.runId,
    scans: [
      {
        researchDirection: options.researchDirection.trim(),
        scanId: DEFAULT_SCAN_ID,
        targets: scanTargets,
      },
    ],
    schemaVersion: 1,
    scope,
  });

  const promptFile = path.join(loopRoot, "plan.prompt.md");
  const planFile = path.join(loopRoot, "plan.json");

  await fs.mkdir(loopRoot, { recursive: true });
  await fs.writeFile(promptFile, `${prompt.trimEnd()}\n`, "utf8");
  await fs.writeFile(planFile, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  await assertPlanGate({
    expectedLoop: options.loop,
    expectedRunId: options.runId,
    loopRoot,
  });

  return {
    loopId,
    loopRoot,
    plan,
    planFile,
    promptFile,
  };
}

function buildDefaultObjectives(loopId: string, scanTargets: string[], researchDirection: string): string[] {
  return [
    `Establish a durable plan for loop ${loopId}.`,
    `Prepare replayable scan inputs for ${scanTargets.join(", ")}.`,
    `Preserve the requested research direction: ${researchDirection.trim()}`,
  ];
}

function formatMarkdownList(entries: string[]): string {
  return entries.map((entry) => `- ${entry}`).join("\n");
}

function formatSequence(value: number): string {
  return value.toString().padStart(4, "0");
}

function normalizeEntries(entries: string[]): string[] {
  return entries
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function renderPrompt(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (current, [key, value]) => current.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function resolvePromptSource(fileName: string): string {
  return path.resolve(__dirname, "../../src/prompts", fileName);
}

export { PLANNER_PROMPT_SOURCE };
