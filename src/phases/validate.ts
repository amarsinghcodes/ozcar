import { promises as fs } from "node:fs";
import path from "node:path";

import { FindingContract } from "../contracts/finding";
import { PlanContract } from "../contracts/plan";
import { TriageContract } from "../contracts/triage";
import { ValidationContract, ValidationContractSchema, ValidationOutcome } from "../contracts/validation";
import { assertTriageGate } from "../gates/triage";
import { assertValidationGate } from "../gates/validate";
import { TriagePhaseResult } from "./triage";

const PHASE3_VALIDATOR_NAME = "phase3-dry-seam";
const VALIDATOR_PROMPT_SOURCE = "src/prompts/validator.md";

export interface ValidatePhaseOptions {
  readonly loop: number;
  readonly now?: () => Date;
  readonly plan: PlanContract;
  readonly reuseExisting?: boolean;
  readonly runId: string;
  readonly runRoot: string;
  readonly triageResults: readonly TriagePhaseResult[];
}

export interface ValidatePhaseResult {
  readonly artifactId: string;
  readonly finding: FindingContract;
  readonly findingFile: string;
  readonly outcomeRoot: string;
  readonly promptFile: string;
  readonly triage: TriageContract;
  readonly triageFile: string;
  readonly validation: ValidationContract;
  readonly validationFile: string;
}

export async function runValidatePhase(options: ValidatePhaseOptions): Promise<ValidatePhaseResult[]> {
  const now = options.now ?? (() => new Date());
  const loopId = formatSequence(options.loop);
  const promptTemplate = await fs.readFile(resolvePromptSource("validator.md"), "utf8");
  const loopRoot = path.join(options.runRoot, "loops", loopId);
  const results: ValidatePhaseResult[] = [];

  for (const triageResult of options.triageResults) {
    const triaged = await assertTriageGate({
      expectedFindingId: triageResult.finding.findingId,
      expectedLoop: options.loop,
      expectedRunId: options.runId,
      expectedScanId: triageResult.finding.scanId,
      triageRoot: triageResult.triageRoot,
    });
    const outcome = validationOutcomeForDisposition(triaged.triage.disposition);
    const validation = ValidationContractSchema.parse({
      findingId: triaged.finding.findingId,
      loop: options.loop,
      outcome,
      rationale: buildValidationRationale(triaged.finding, triaged.triage, outcome),
      runId: options.runId,
      scanId: triaged.finding.scanId,
      schemaVersion: 1,
      validatedAt: now().toISOString(),
      validator: PHASE3_VALIDATOR_NAME,
    });
    const outcomeRoot = path.join(loopRoot, outcomeToDirectory(outcome), triageResult.artifactId);
    if (options.reuseExisting && (await pathExists(outcomeRoot))) {
      const existing = await assertValidationGate({
        expectedFindingId: triaged.finding.findingId,
        expectedLoop: options.loop,
        expectedOutcome: outcome,
        expectedRunId: options.runId,
        expectedScanId: triaged.finding.scanId,
        validationRoot: outcomeRoot,
      });

      results.push({
        artifactId: triageResult.artifactId,
        finding: existing.finding,
        findingFile: existing.findingFile,
        outcomeRoot,
        promptFile: existing.promptFile,
        triage: existing.triage,
        triageFile: existing.triageFile,
        validation: existing.validation,
        validationFile: existing.validationFile,
      });
      continue;
    }

    const prompt = renderPrompt(promptTemplate, {
      FINDING_ID: triaged.finding.findingId,
      LOCATIONS: formatMarkdownList(triaged.finding.locations, "None recorded"),
      LOOP_ID: loopId,
      OBJECTIVES: formatMarkdownList(options.plan.objectives),
      PROVIDER: options.plan.provider.name,
      PROVIDER_MODEL: options.plan.provider.model,
      PROVIDER_SELECTION: options.plan.provider.selection,
      RUN_ID: options.runId,
      SCAN_ID: triaged.finding.scanId,
      SCOPE: formatMarkdownList(options.plan.scope),
      SEVERITY: triaged.finding.severity,
      SUMMARY: triaged.finding.summary,
      TITLE: triaged.finding.title,
      TRIAGE_DISPOSITION: triaged.triage.disposition,
      TRIAGE_RATIONALE: triaged.triage.rationale,
    });
    const findingFile = path.join(outcomeRoot, "finding.json");
    const promptFile = path.join(outcomeRoot, "prompt.md");
    const triageFile = path.join(outcomeRoot, "triage.json");
    const validationFile = path.join(outcomeRoot, "validation.json");

    await fs.mkdir(outcomeRoot, { recursive: true });
    await fs.writeFile(findingFile, `${JSON.stringify(triaged.finding, null, 2)}\n`, "utf8");
    await fs.writeFile(promptFile, `${prompt.trimEnd()}\n`, "utf8");
    await fs.writeFile(triageFile, `${JSON.stringify(triaged.triage, null, 2)}\n`, "utf8");
    await fs.writeFile(validationFile, `${JSON.stringify(validation, null, 2)}\n`, "utf8");

    await assertValidationGate({
      expectedFindingId: triaged.finding.findingId,
      expectedLoop: options.loop,
      expectedOutcome: outcome,
      expectedRunId: options.runId,
      expectedScanId: triaged.finding.scanId,
      validationRoot: outcomeRoot,
    });

    results.push({
      artifactId: triageResult.artifactId,
      finding: triaged.finding,
      findingFile,
      outcomeRoot,
      promptFile,
      triage: triaged.triage,
      triageFile,
      validation,
      validationFile,
    });
  }

  return results;
}

function buildValidationRationale(
  finding: FindingContract,
  triage: TriageContract,
  outcome: ValidationOutcome,
): string {
  switch (outcome) {
    case "validated":
      return `Dry validation accepted the ${finding.severity} finding after triage confirmed it for reporting.`;
    case "pending":
      return `Dry validation kept the finding pending because triage requested more evidence: ${triage.rationale}`;
    case "rejected":
      return `Dry validation kept the finding rejected because triage did not retain it for confirmation: ${triage.rationale}`;
  }
}

export function validationOutcomeForDisposition(disposition: TriageContract["disposition"]): ValidationOutcome {
  switch (disposition) {
    case "confirmed":
      return "validated";
    case "pending":
      return "pending";
    case "rejected":
      return "rejected";
  }
}

function formatMarkdownList(entries: readonly string[], emptyLabel = "None"): string {
  if (entries.length === 0) {
    return `- ${emptyLabel}`;
  }

  return entries.map((entry) => `- ${entry}`).join("\n");
}

function formatSequence(value: number): string {
  return value.toString().padStart(4, "0");
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function outcomeToDirectory(outcome: ValidationOutcome): ValidationOutcome {
  return outcome;
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

export { PHASE3_VALIDATOR_NAME, VALIDATOR_PROMPT_SOURCE, outcomeToDirectory };
