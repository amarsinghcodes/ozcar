import { promises as fs } from "node:fs";
import path from "node:path";

import { type PlanContract } from "../contracts/plan";
import { ProviderPreflight } from "../contracts/provider-execution";
import { ScanFinding, ScanOutput, ScanOutputSchema, ScanRequest, ScanRequestSchema } from "../contracts/scan";
import { assertPlanGate } from "../gates/plan";
import { ScanGateResult, assertScanGate } from "../gates/scan";
import { ResolvedProvider, resolveStoredProvider } from "../providers/base";
import {
  ProviderRuntimeDependencies,
  runLiveScanExecution,
} from "../providers/runtime";

const SCANNER_PROMPT_SOURCE = "src/prompts/scanner.md";

export interface ScanPhaseOptions extends ProviderRuntimeDependencies {
  readonly dryRun: boolean;
  readonly dryRunFindings?: readonly ScanFinding[];
  readonly loop: number;
  readonly model?: string;
  readonly now?: () => Date;
  readonly plan: PlanContract;
  readonly preflight?: ProviderPreflight;
  readonly provider: ResolvedProvider;
  readonly runId: string;
  readonly runRoot: string;
  readonly targetRoot: string;
}

export interface ScanPhaseResult {
  readonly output: ScanOutput;
  readonly outputFile: string;
  readonly promptFile: string;
  readonly request: ScanRequest;
  readonly requestFile: string;
  readonly scanId: string;
  readonly scanRoot: string;
}

export interface ReadStoredScanPhaseOptions extends ProviderRuntimeDependencies {
  readonly loop: number;
  readonly now?: () => Date;
  readonly repairOutput?: boolean;
  readonly runId: string;
  readonly runRoot: string;
  readonly scanIds?: readonly string[];
}

export interface ReadStoredScanPhaseResult {
  readonly replayedScanIds: string[];
  readonly results: ScanPhaseResult[];
}

export interface ReplayStoredScanPhaseOptions extends ProviderRuntimeDependencies {
  readonly loop: number;
  readonly now?: () => Date;
  readonly runId: string;
  readonly runRoot: string;
  readonly scanId: string;
}

export class ScanPhaseProviderMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanPhaseProviderMismatchError";
  }
}

export async function runScanPhase(options: ScanPhaseOptions): Promise<ScanPhaseResult[]> {
  if (!options.provider.capabilities.scan) {
    throw new Error(`Provider ${options.provider.name} does not support the scan phase.`);
  }

  const now = options.now ?? (() => new Date());
  const loopId = formatSequence(options.loop);
  const loopRoot = path.join(options.runRoot, "loops", loopId);
  const promptTemplate = await fs.readFile(resolvePromptSource("scanner.md"), "utf8");
  const plannedProvider = resolvePlannedProviderSnapshot(options.plan, options.provider, options.model);
  const results: ScanPhaseResult[] = [];

  for (const scan of options.plan.scans) {
    const createdAt = now().toISOString();
    const scanRoot = path.join(loopRoot, "scans", scan.scanId);
    const prompt = renderPrompt(promptTemplate, {
      LOOP_ID: loopId,
      OBJECTIVES: formatMarkdownList(options.plan.objectives),
      PROVIDER: plannedProvider.name,
      PROVIDER_MODEL: plannedProvider.model,
      PROVIDER_SELECTION: plannedProvider.selection,
      RESEARCH_DIRECTION: scan.researchDirection,
      RUN_ID: options.runId,
      SCAN_ID: scan.scanId,
      SCAN_TARGETS: formatMarkdownList(scan.targets),
      SCOPE: formatMarkdownList(options.plan.scope),
      TARGET_ROOT: options.targetRoot,
    });
    const request = ScanRequestSchema.parse({
      createdAt,
      dryRun: options.dryRun,
      ...(options.dryRunFindings
        ? {
            dryRunFindings: options.dryRunFindings.map((finding) => ({
              ...finding,
              locations: [...finding.locations],
            })),
          }
        : {}),
      loop: options.loop,
      objectives: options.plan.objectives,
      promptSource: SCANNER_PROMPT_SOURCE,
      provider: plannedProvider,
      researchDirection: scan.researchDirection,
      runId: options.runId,
      scanId: scan.scanId,
      schemaVersion: 1,
      scope: options.plan.scope,
      targetRoot: options.targetRoot,
      targets: scan.targets,
    });
    const promptFile = path.join(scanRoot, "prompt.md");
    const requestFile = path.join(scanRoot, "request.json");
    const outputFile = path.join(scanRoot, "output.json");

    await fs.mkdir(scanRoot, { recursive: true });
    await fs.writeFile(promptFile, `${prompt.trimEnd()}\n`, "utf8");
    await fs.writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`, "utf8");

    const output = options.dryRun
      ? createDryRunScanOutput(request, now, options.dryRunFindings ?? [])
      : await buildLiveScanOutput({
          ...(options.env ? { env: options.env } : {}),
          ...(options.executeCommand ? { executeCommand: options.executeCommand } : {}),
          ...(options.isCommandAvailable ? { isCommandAvailable: options.isCommandAvailable } : {}),
          model: plannedProvider.model,
          now,
          ...(options.preflight ? { preflight: options.preflight } : {}),
          prompt,
          provider: options.provider,
          request,
          runRoot: options.runRoot,
          ...(options.sleep ? { sleep: options.sleep } : {}),
        });

    await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

    await assertScanGate({
      expectedLoop: options.loop,
      expectedRunId: options.runId,
      expectedScanId: scan.scanId,
      scanRoot,
    });

    results.push({
      output,
      outputFile,
      promptFile,
      request,
      requestFile,
      scanId: scan.scanId,
      scanRoot,
    });
  }

  return results;
}

export async function readStoredScanPhase(options: ReadStoredScanPhaseOptions): Promise<ReadStoredScanPhaseResult> {
  const loopId = formatSequence(options.loop);
  const loopRoot = path.join(options.runRoot, "loops", loopId);
  const { plan } = await assertPlanGate({
    expectedLoop: options.loop,
    expectedRunId: options.runId,
    loopRoot,
  });
  const requestedIds = options.scanIds ? normalizeScanIds(options.scanIds) : null;
  const scans = requestedIds ? plan.scans.filter((scan) => requestedIds.has(scan.scanId)) : plan.scans;

  if (requestedIds && scans.length !== requestedIds.size) {
    const missing = [...requestedIds].filter((scanId) => !scans.some((scan) => scan.scanId === scanId));
    throw new Error(`Stored scan replay rejected unknown scan ids: ${missing.join(", ")}.`);
  }

  const replayedScanIds: string[] = [];
  const results: ScanPhaseResult[] = [];

  for (const scan of scans) {
    const scanRoot = path.join(loopRoot, "scans", scan.scanId);
    const result = options.repairOutput
      ? await ensureStoredScanResult({
          ...(options.env ? { env: options.env } : {}),
          ...(options.executeCommand ? { executeCommand: options.executeCommand } : {}),
          ...(options.isCommandAvailable ? { isCommandAvailable: options.isCommandAvailable } : {}),
          loop: options.loop,
          ...(options.now ? { now: options.now } : {}),
          runId: options.runId,
          runRoot: options.runRoot,
          scanId: scan.scanId,
          scanRoot,
          ...(options.sleep ? { sleep: options.sleep } : {}),
        })
      : {
          replayed: false,
          result: await readStoredScanResult({
            loop: options.loop,
            runId: options.runId,
            scanId: scan.scanId,
            scanRoot,
          }),
        };

    if (result.replayed) {
      replayedScanIds.push(scan.scanId);
    }

    results.push(result.result);
  }

  return {
    replayedScanIds,
    results,
  };
}

export async function replayStoredScanPhase(options: ReplayStoredScanPhaseOptions): Promise<ScanPhaseResult> {
  const scanRoot = path.join(options.runRoot, "loops", formatSequence(options.loop), "scans", options.scanId);
  return replayStoredScanResult({
    ...(options.env ? { env: options.env } : {}),
    ...(options.executeCommand ? { executeCommand: options.executeCommand } : {}),
    ...(options.isCommandAvailable ? { isCommandAvailable: options.isCommandAvailable } : {}),
    loop: options.loop,
    ...(options.now ? { now: options.now } : {}),
    runId: options.runId,
    runRoot: options.runRoot,
    scanId: options.scanId,
    scanRoot,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
}

function resolvePlannedProviderSnapshot(
  plan: PlanContract,
  runtimeProvider: ResolvedProvider,
  explicitModel?: string,
): PlanContract["provider"] {
  const plannedProvider = plan.provider;
  const requestedModel = explicitModel?.trim();

  if (runtimeProvider.name !== plannedProvider.name) {
    throw new ScanPhaseProviderMismatchError(
      `Scan phase rejected provider mismatch: plan.json selected ${plannedProvider.name} but the scan invocation requested ${runtimeProvider.name}.`,
    );
  }

  if (runtimeProvider.selection !== plannedProvider.selection) {
    throw new ScanPhaseProviderMismatchError(
      `Scan phase rejected provider selection mismatch: plan.json recorded ${plannedProvider.selection} but the scan invocation requested ${runtimeProvider.selection}.`,
    );
  }

  if (requestedModel && requestedModel !== plannedProvider.model) {
    throw new ScanPhaseProviderMismatchError(
      `Scan phase rejected provider model mismatch: plan.json recorded ${plannedProvider.model} but the scan invocation requested ${requestedModel}.`,
    );
  }

  return plannedProvider;
}

function createDryRunScanOutput(request: ScanRequest, now: () => Date, dryRunFindings: readonly ScanFinding[]): ScanOutput {
  const findings = dryRunFindings.map((finding) => ({
    ...finding,
    locations: [...finding.locations],
  }));

  return ScanOutputSchema.parse({
    createdAt: now().toISOString(),
    findings,
    loop: request.loop,
    mode: "dry-run",
    runId: request.runId,
    scanId: request.scanId,
    schemaVersion: 1,
    summary:
      findings.length === 0
        ? `Dry run prepared replayable scan inputs for ${request.targets.join(", ")} using provider ${request.provider.name}.`
        : `Dry run prepared ${findings.length} replayable scan findings for ${request.targets.join(", ")} using provider ${request.provider.name}.`,
  });
}

async function buildLiveScanOutput(options: ProviderRuntimeDependencies & {
  readonly model: string;
  readonly now: () => Date;
  readonly preflight?: ProviderPreflight;
  readonly prompt: string;
  readonly provider: ResolvedProvider;
  readonly request: ScanRequest;
  readonly runRoot: string;
}): Promise<ScanOutput> {
  const execution = await runLiveScanExecution({
    ...(options.env ? { env: options.env } : {}),
    ...(options.executeCommand ? { executeCommand: options.executeCommand } : {}),
    ...(options.isCommandAvailable ? { isCommandAvailable: options.isCommandAvailable } : {}),
    invocationRoot: path.join(options.runRoot, "loops", formatSequence(options.request.loop), "scans", options.request.scanId, "provider"),
    model: options.model,
    now: options.now,
    phase: "scan",
    ...(options.preflight ? { preflight: options.preflight } : {}),
    prompt: options.prompt,
    provider: options.provider,
    runRoot: options.runRoot,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    targetRoot: options.request.targetRoot,
  });

  return ScanOutputSchema.parse({
    createdAt: options.now().toISOString(),
    findings: execution.parsed.findings.map((finding) => ({
      ...finding,
      locations: [...finding.locations],
    })),
    loop: options.request.loop,
    mode: "live",
    runId: options.request.runId,
    scanId: options.request.scanId,
    schemaVersion: 1,
    summary: execution.parsed.summary,
  });
}

function formatMarkdownList(entries: string[]): string {
  return entries.map((entry) => `- ${entry}`).join("\n");
}

async function ensureStoredScanResult(options: ProviderRuntimeDependencies & {
  readonly loop: number;
  readonly now?: () => Date;
  readonly runId: string;
  readonly runRoot: string;
  readonly scanId: string;
  readonly scanRoot: string;
}): Promise<{ readonly replayed: boolean; readonly result: ScanPhaseResult }> {
  await assertScanGate({
    expectedLoop: options.loop,
    expectedRunId: options.runId,
    expectedScanId: options.scanId,
    requireOutput: false,
    scanRoot: options.scanRoot,
  });

  try {
    return {
      replayed: false,
      result: await readStoredScanResult(options),
    };
  } catch {
    return {
      replayed: true,
      result: await replayStoredScanResult(options),
    };
  }
}

async function readStoredScanResult(options: {
  readonly loop: number;
  readonly runId: string;
  readonly scanId: string;
  readonly scanRoot: string;
}): Promise<ScanPhaseResult> {
  const gated = await assertScanGate({
    expectedLoop: options.loop,
    expectedRunId: options.runId,
    expectedScanId: options.scanId,
    scanRoot: options.scanRoot,
  });

  return buildStoredScanResult(options.scanRoot, gated);
}

async function replayStoredScanResult(options: ProviderRuntimeDependencies & {
  readonly loop: number;
  readonly now?: () => Date;
  readonly runId: string;
  readonly runRoot: string;
  readonly scanId: string;
  readonly scanRoot: string;
}): Promise<ScanPhaseResult> {
  const now = options.now ?? (() => new Date());
  const input = await assertScanGate({
    expectedLoop: options.loop,
    expectedRunId: options.runId,
    expectedScanId: options.scanId,
    requireOutput: false,
    scanRoot: options.scanRoot,
  });
  const output = input.request.dryRun
    ? createDryRunScanOutput(input.request, now, input.request.dryRunFindings ?? [])
    : await replayLiveStoredScanOutput({
        ...(options.env ? { env: options.env } : {}),
        ...(options.executeCommand ? { executeCommand: options.executeCommand } : {}),
        ...(options.isCommandAvailable ? { isCommandAvailable: options.isCommandAvailable } : {}),
        now,
        promptFile: input.promptFile,
        request: input.request,
        runRoot: options.runRoot,
        ...(options.sleep ? { sleep: options.sleep } : {}),
      });

  await fs.mkdir(options.scanRoot, { recursive: true });
  await fs.writeFile(input.outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  const gated = await assertScanGate({
    expectedLoop: options.loop,
    expectedRunId: options.runId,
    expectedScanId: options.scanId,
    scanRoot: options.scanRoot,
  });

  return buildStoredScanResult(options.scanRoot, gated);
}

async function replayLiveStoredScanOutput(options: ProviderRuntimeDependencies & {
  readonly now: () => Date;
  readonly promptFile: string;
  readonly request: ScanRequest;
  readonly runRoot: string;
}): Promise<ScanOutput> {
  const provider = await resolveStoredProvider(
    {
      name: options.request.provider.name,
      selection: options.request.provider.selection,
    },
    {
      ...(options.env ? { env: options.env } : {}),
      ...(options.isCommandAvailable ? { isCommandAvailable: options.isCommandAvailable } : {}),
    },
  );
  const prompt = await fs.readFile(options.promptFile, "utf8");

  return buildLiveScanOutput({
    ...(options.env ? { env: options.env } : {}),
    ...(options.executeCommand ? { executeCommand: options.executeCommand } : {}),
    ...(options.isCommandAvailable ? { isCommandAvailable: options.isCommandAvailable } : {}),
    model: options.request.provider.model,
    now: options.now,
    prompt,
    provider,
    request: options.request,
    runRoot: options.runRoot,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
}

function buildStoredScanResult(scanRoot: string, gated: ScanGateResult): ScanPhaseResult {
  if (!gated.output) {
    throw new Error(`Stored scan ${scanRoot} is missing output.json after replay validation.`);
  }

  return {
    output: gated.output,
    outputFile: gated.outputFile,
    promptFile: gated.promptFile,
    request: gated.request,
    requestFile: gated.requestFile,
    scanId: gated.request.scanId,
    scanRoot,
  };
}

function formatSequence(value: number): string {
  return value.toString().padStart(4, "0");
}

function normalizeScanIds(scanIds: readonly string[]): Set<string> {
  return new Set(
    scanIds
      .map((scanId) => scanId.trim())
      .filter((scanId) => scanId.length > 0),
  );
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

export { SCANNER_PROMPT_SOURCE };
