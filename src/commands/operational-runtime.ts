import path from "node:path";

import { PlanContract } from "../contracts/plan";
import { PhaseName } from "../contracts/run";
import { assertPlanGate } from "../gates/plan";
import { ScanPhaseResult, readStoredScanPhase } from "../phases/scan";
import { SummarizePhaseResult, runSummarizePhase } from "../phases/summarize";
import { TriagePhaseResult, runTriagePhase } from "../phases/triage";
import { ValidatePhaseResult, runValidatePhase } from "../phases/validate";
import { RunStoreHandle } from "../store/run-store";

export interface OperationalRunResult {
  readonly loop: number;
  readonly plan: PlanContract;
  readonly planFile: string;
  readonly replayedScanIds: string[];
  readonly scanResults: ScanPhaseResult[];
  readonly summarizeResult: SummarizePhaseResult;
  readonly triageResults: TriagePhaseResult[];
  readonly validationResults: ValidatePhaseResult[];
}

export interface ContinueRunFromScansOptions {
  readonly handle: RunStoreHandle;
  readonly loop: number;
  readonly plan: PlanContract;
  readonly planFile: string;
  readonly replayedScanIds?: readonly string[];
  readonly reuseExistingArtifacts?: boolean;
  readonly scanResults: readonly ScanPhaseResult[];
  readonly setActivePhase?: (phase: PhaseName) => void;
}

export interface ResumeRunFromStoreOptions {
  readonly handle: RunStoreHandle;
  readonly loop?: number;
  readonly setActivePhase?: (phase: PhaseName) => void;
}

export async function continueRunFromScans(options: ContinueRunFromScansOptions): Promise<OperationalRunResult> {
  const replayedScanIds = [...(options.replayedScanIds ?? [])];
  const runId = options.handle.run.runId;
  const runRoot = options.handle.paths.runRoot;
  const findings = options.scanResults.reduce((count, result) => count + result.output.findings.length, 0);

  setActivePhase(options, "triage");
  await options.handle.updateRun({
    activeLoop: options.loop,
    currentPhase: "triage",
    status: "running",
  });
  await options.handle.appendEvent({
    details: {
      findings,
      loop: options.loop,
      resumeSafe: options.reuseExistingArtifacts ?? false,
    },
    type: "phase.triage.started",
  });

  const triageResults = await runTriagePhase({
    loop: options.loop,
    plan: options.plan,
    ...(options.reuseExistingArtifacts !== undefined ? { reuseExisting: options.reuseExistingArtifacts } : {}),
    runId,
    runRoot,
    scanOutputs: options.scanResults.map((result) => result.output),
  });

  await options.handle.appendEvent({
    details: {
      loop: options.loop,
      triagedFindings: triageResults.length,
    },
    type: "phase.triage.completed",
  });

  setActivePhase(options, "validate");
  await options.handle.updateRun({
    activeLoop: options.loop,
    currentPhase: "validate",
    status: "running",
  });
  await options.handle.appendEvent({
    details: {
      loop: options.loop,
      triagedFindings: triageResults.length,
      resumeSafe: options.reuseExistingArtifacts ?? false,
    },
    type: "phase.validate.started",
  });

  const validationResults = await runValidatePhase({
    loop: options.loop,
    plan: options.plan,
    ...(options.reuseExistingArtifacts !== undefined ? { reuseExisting: options.reuseExistingArtifacts } : {}),
    runId,
    runRoot,
    triageResults,
  });

  await options.handle.appendEvent({
    details: {
      loop: options.loop,
      pendingFindings: validationResults.filter((result) => result.validation.outcome === "pending").length,
      rejectedFindings: validationResults.filter((result) => result.validation.outcome === "rejected").length,
      validatedFindings: validationResults.filter((result) => result.validation.outcome === "validated").length,
    },
    type: "phase.validate.completed",
  });

  setActivePhase(options, "summarize");
  await options.handle.updateRun({
    activeLoop: options.loop,
    currentPhase: "summarize",
    status: "running",
  });
  await options.handle.appendEvent({
    details: {
      loop: options.loop,
      validatedFindings: validationResults.filter((result) => result.validation.outcome === "validated").length,
    },
    type: "phase.summarize.started",
  });

  const summarizeResult = await runSummarizePhase({
    loop: options.loop,
    runId,
    runRoot,
  });

  await options.handle.appendEvent({
    details: {
      confirmedFindingsFile: summarizeResult.confirmedFindingsFile,
      loop: options.loop,
      summaryFile: summarizeResult.summaryFile,
      validatedFindings: summarizeResult.validatedFindings.length,
    },
    type: "phase.summarize.completed",
  });
  await options.handle.updateRun({
    activeLoop: options.loop,
    currentPhase: "summarize",
    status: "completed",
  });

  return {
    loop: options.loop,
    plan: options.plan,
    planFile: options.planFile,
    replayedScanIds,
    scanResults: [...options.scanResults],
    summarizeResult,
    triageResults,
    validationResults,
  };
}

export async function resumeRunFromStore(options: ResumeRunFromStoreOptions): Promise<OperationalRunResult> {
  const loop = options.loop ?? options.handle.run.activeLoop;

  if (loop <= 0) {
    throw new Error(
      `Run ${options.handle.run.runId} has no active loop to resume. Start the run with \`ozcar run\` before using \`ozcar resume\`.`,
    );
  }

  const planResult = await assertPlanGate({
    expectedLoop: loop,
    expectedRunId: options.handle.run.runId,
    loopRoot: path.join(options.handle.paths.runRoot, "loops", formatSequence(loop)),
  });

  setActivePhase(options, "scan");
  await options.handle.updateRun({
    activeLoop: loop,
    currentPhase: "scan",
    status: "running",
  });

  const storedScans = await readStoredScanPhase({
    loop,
    repairOutput: true,
    runId: options.handle.run.runId,
    runRoot: options.handle.paths.runRoot,
  });

  for (const scanId of storedScans.replayedScanIds) {
    await options.handle.appendEvent({
      details: {
        loop,
        scanId,
      },
      type: "phase.scan.replayed",
    });
  }

  await options.handle.appendEvent({
    details: {
      emittedScans: storedScans.results.length,
      loop,
      replayedScans: storedScans.replayedScanIds.length,
    },
    type: "phase.scan.completed",
  });

  return continueRunFromScans({
    handle: options.handle,
    loop,
    plan: planResult.plan,
    planFile: planResult.planFile,
    replayedScanIds: storedScans.replayedScanIds,
    reuseExistingArtifacts: true,
    scanResults: storedScans.results,
    ...(options.setActivePhase ? { setActivePhase: options.setActivePhase } : {}),
  });
}

function formatSequence(value: number): string {
  return value.toString().padStart(4, "0");
}

function setActivePhase(
  options: Pick<ContinueRunFromScansOptions | ResumeRunFromStoreOptions, "setActivePhase">,
  phase: PhaseName,
): void {
  options.setActivePhase?.(phase);
}
