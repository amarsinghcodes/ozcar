import { promises as fs } from "node:fs";
import path from "node:path";

import { FindingContract, FindingContractSchema, Severity } from "../contracts/finding";
import { PlanContract } from "../contracts/plan";
import { ScanOutput } from "../contracts/scan";
import { TriageContract, TriageContractSchema, TriageDisposition } from "../contracts/triage";
import { assertTriageGate } from "../gates/triage";

const TRIAGER_PROMPT_SOURCE = "src/prompts/triager.md";

export interface TriagePhaseOptions {
  readonly loop: number;
  readonly now?: () => Date;
  readonly plan: PlanContract;
  readonly reuseExisting?: boolean;
  readonly runId: string;
  readonly runRoot: string;
  readonly scanOutputs: readonly ScanOutput[];
}

export interface TriagePhaseResult {
  readonly artifactId: string;
  readonly finding: FindingContract;
  readonly findingFile: string;
  readonly promptFile: string;
  readonly triage: TriageContract;
  readonly triageFile: string;
  readonly triageRoot: string;
}

export async function runTriagePhase(options: TriagePhaseOptions): Promise<TriagePhaseResult[]> {
  const now = options.now ?? (() => new Date());
  const loopId = formatSequence(options.loop);
  const promptTemplate = await fs.readFile(resolvePromptSource("triager.md"), "utf8");
  const triageRoot = path.join(options.runRoot, "loops", loopId, "triage");
  const results: TriagePhaseResult[] = [];
  const seenArtifactIds = new Set<string>();

  for (const scanOutput of options.scanOutputs) {
    if (scanOutput.runId !== options.runId || scanOutput.loop !== options.loop) {
      throw new Error(
        `Triage phase rejected scan output ${scanOutput.scanId}: expected run ${options.runId} loop ${options.loop} but found run ${scanOutput.runId} loop ${scanOutput.loop}.`,
      );
    }

    for (const scanFinding of scanOutput.findings) {
      const finding = FindingContractSchema.parse({
        createdAt: scanOutput.createdAt,
        findingId: scanFinding.id,
        locations: scanFinding.locations,
        loop: options.loop,
        runId: options.runId,
        scanId: scanOutput.scanId,
        schemaVersion: 1,
        severity: scanFinding.severity,
        summary: scanFinding.rationale,
        title: scanFinding.title,
      });
      const artifactId = formatFindingArtifactId(finding.scanId, finding.findingId);

      if (seenArtifactIds.has(artifactId)) {
        throw new Error(`Triage phase rejected duplicate finding artifact ${artifactId}.`);
      }

      seenArtifactIds.add(artifactId);

      const disposition = determineDisposition(finding.severity);
      const triage = TriageContractSchema.parse({
        disposition,
        findingId: finding.findingId,
        loop: options.loop,
        rationale: buildTriageRationale(finding, disposition),
        runId: options.runId,
        scanId: finding.scanId,
        schemaVersion: 1,
        triagedAt: now().toISOString(),
      });
      const findingRoot = path.join(triageRoot, artifactId);
      if (options.reuseExisting && (await pathExists(findingRoot))) {
        const existing = await assertTriageGate({
          expectedFindingId: finding.findingId,
          expectedLoop: options.loop,
          expectedRunId: options.runId,
          expectedScanId: finding.scanId,
          triageRoot: findingRoot,
        });

        results.push({
          artifactId,
          finding: existing.finding,
          findingFile: existing.findingFile,
          promptFile: existing.promptFile,
          triage: existing.triage,
          triageFile: existing.triageFile,
          triageRoot: findingRoot,
        });
        continue;
      }

      const prompt = renderPrompt(promptTemplate, {
        FINDING_ID: finding.findingId,
        LOCATIONS: formatMarkdownList(finding.locations, "None recorded"),
        LOOP_ID: loopId,
        OBJECTIVES: formatMarkdownList(options.plan.objectives),
        PROVIDER: options.plan.provider.name,
        PROVIDER_MODEL: options.plan.provider.model,
        PROVIDER_SELECTION: options.plan.provider.selection,
        RUN_ID: options.runId,
        SCAN_ID: finding.scanId,
        SCOPE: formatMarkdownList(options.plan.scope),
        SEVERITY: finding.severity,
        SUMMARY: finding.summary,
        TITLE: finding.title,
      });
      const findingFile = path.join(findingRoot, "finding.json");
      const promptFile = path.join(findingRoot, "prompt.md");
      const triageFile = path.join(findingRoot, "triage.json");

      await fs.mkdir(findingRoot, { recursive: true });
      await fs.writeFile(findingFile, `${JSON.stringify(finding, null, 2)}\n`, "utf8");
      await fs.writeFile(promptFile, `${prompt.trimEnd()}\n`, "utf8");
      await fs.writeFile(triageFile, `${JSON.stringify(triage, null, 2)}\n`, "utf8");

      await assertTriageGate({
        expectedFindingId: finding.findingId,
        expectedLoop: options.loop,
        expectedRunId: options.runId,
        expectedScanId: finding.scanId,
        triageRoot: findingRoot,
      });

      results.push({
        artifactId,
        finding,
        findingFile,
        promptFile,
        triage,
        triageFile,
        triageRoot: findingRoot,
      });
    }
  }

  return results;
}

function buildTriageRationale(finding: FindingContract, disposition: TriageDisposition): string {
  switch (disposition) {
    case "confirmed":
      return `Severity ${finding.severity} is retained for validation in the dry Phase 3 seam.`;
    case "pending":
      return `Severity ${finding.severity} stays pending until a later pass adds stronger evidence.`;
    case "rejected":
      return `Severity ${finding.severity} is rejected in the dry Phase 3 seam because it does not meet the confirmation threshold.`;
  }
}

function determineDisposition(severity: Severity): TriageDisposition {
  switch (severity) {
    case "critical":
    case "high":
      return "confirmed";
    case "medium":
      return "pending";
    case "low":
      return "rejected";
  }
}

function formatFindingArtifactId(scanId: string, findingId: string): string {
  return `${scanId}-${findingId}`;
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

function renderPrompt(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (current, [key, value]) => current.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function resolvePromptSource(fileName: string): string {
  return path.resolve(__dirname, "../../src/prompts", fileName);
}

export { TRIAGER_PROMPT_SOURCE, formatFindingArtifactId };
