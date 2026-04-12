import { promises as fs } from "node:fs";
import path from "node:path";

import { PlanContract, PlanContractSchema } from "../contracts/plan";
import { ProviderPreflight } from "../contracts/provider-execution";
import { assertPlanGate } from "../gates/plan";
import { ResolvedProvider, resolveProviderModel } from "../providers/base";
import {
  ProviderRuntimeDependencies,
  runLivePlanExecution,
} from "../providers/runtime";

const PLANNER_PROMPT_SOURCE = "src/prompts/planner.md";
const DEFAULT_SCAN_ID = "0001";

export interface PlanPhaseOptions extends ProviderRuntimeDependencies {
  readonly dryRun: boolean;
  readonly loop: number;
  readonly model?: string;
  readonly now?: () => Date;
  readonly objectives?: string[];
  readonly preflight?: ProviderPreflight;
  readonly provider: ResolvedProvider;
  readonly researchDirection: string;
  readonly runId: string;
  readonly runRoot: string;
  readonly scanTargets: string[];
  readonly scope: string[];
  readonly targetRoot: string;
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
  const requestedObjectives =
    objectives.length > 0 ? objectives : buildDefaultObjectives(loopId, scanTargets, options.researchDirection);
  const model = resolveProviderModel(options.provider, "plan", options.model);
  const promptTemplate = await fs.readFile(resolvePromptSource("planner.md"), "utf8");
  const prompt = renderPrompt(promptTemplate, {
    LOOP_ID: loopId,
    OBJECTIVES: formatMarkdownList(requestedObjectives),
    PROVIDER: options.provider.name,
    PROVIDER_MODEL: model,
    PROVIDER_SELECTION: options.provider.selection,
    RESEARCH_DIRECTION: options.researchDirection.trim(),
    RUN_ID: options.runId,
    SCAN_TARGETS: formatMarkdownList(scanTargets),
    SCOPE: formatMarkdownList(scope),
  });
  const promptFile = path.join(loopRoot, "plan.prompt.md");
  const planFile = path.join(loopRoot, "plan.json");

  await fs.mkdir(loopRoot, { recursive: true });
  await fs.writeFile(promptFile, `${prompt.trimEnd()}\n`, "utf8");

  const plan = options.dryRun
    ? PlanContractSchema.parse({
        createdAt,
        loop: options.loop,
        mode: "dry-run",
        objectives: requestedObjectives,
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
      })
    : await buildLivePlan({
        createdAt,
        loopRoot,
        model,
        now,
        phaseOptions: options,
        prompt,
        runId: options.runId,
        scope,
      });

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

async function buildLivePlan(options: {
  readonly createdAt: string;
  readonly loopRoot: string;
  readonly model: string;
  readonly now: () => Date;
  readonly phaseOptions: PlanPhaseOptions;
  readonly prompt: string;
  readonly runId: string;
  readonly scope: string[];
}): Promise<PlanContract> {
  const execution = await runLivePlanExecution({
    ...(options.phaseOptions.env ? { env: options.phaseOptions.env } : {}),
    ...(options.phaseOptions.executeCommand ? { executeCommand: options.phaseOptions.executeCommand } : {}),
    ...(options.phaseOptions.isCommandAvailable
      ? { isCommandAvailable: options.phaseOptions.isCommandAvailable }
      : {}),
    invocationRoot: path.join(options.loopRoot, "provider"),
    model: options.model,
    now: options.now,
    phase: "plan",
    ...(options.phaseOptions.preflight ? { preflight: options.phaseOptions.preflight } : {}),
    prompt: options.prompt,
    provider: options.phaseOptions.provider,
    runRoot: options.phaseOptions.runRoot,
    ...(options.phaseOptions.sleep ? { sleep: options.phaseOptions.sleep } : {}),
    targetRoot: options.phaseOptions.targetRoot,
  });

  return PlanContractSchema.parse({
    createdAt: options.createdAt,
    loop: options.phaseOptions.loop,
    mode: "live",
    objectives: execution.parsed.objectives,
    provider: {
      available: options.phaseOptions.provider.available,
      model: options.model,
      name: options.phaseOptions.provider.name,
      selection: options.phaseOptions.provider.selection,
    },
    runId: options.runId,
    scans: execution.parsed.scans,
    schemaVersion: 1,
    scope: options.scope,
  });
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
