import path from "node:path";

import { PhaseName } from "../contracts/run";
import { reopenRunStore } from "../store/run-store";
import { resumeRunFromStore } from "./operational-runtime";

export async function resumeCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: ozcar resume <run-id> [--root <path>] [--loop <number>]");
    return 0;
  }

  let workspaceRoot = process.cwd();
  let runId: string | undefined;
  let loop: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--root") {
      workspaceRoot = path.resolve(readRequiredValue(args, index, "--root"));
      index += 1;
      continue;
    }

    if (argument === "--loop") {
      loop = parseLoopValue(readRequiredValue(args, index, "--loop"));
      index += 1;
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown option for resume: ${argument}`);
    }

    if (runId) {
      throw new Error(`Unexpected positional argument for resume: ${argument}`);
    }

    runId = argument;
  }

  if (!runId) {
    throw new Error("Missing run id for resume");
  }

  const handle = await reopenRunStore({ runId, workspaceRoot });
  let activePhase: PhaseName = handle.run.currentPhase ?? "scan";

  try {
    const result = await resumeRunFromStore({
      handle,
      ...(loop ? { loop } : {}),
      setActivePhase: (phase) => {
        activePhase = phase;
      },
    });
    const events = await handle.readEvents();

    console.log(
      JSON.stringify(
        {
          confirmedFindingsFile: result.summarizeResult.confirmedFindingsFile,
          eventCount: events.length,
          lastEventType: events[events.length - 1]?.type ?? null,
          loop: result.loop,
          planFile: result.planFile,
          provider: result.plan.provider,
          replayedScans: result.replayedScanIds,
          run: handle.run,
          runRoot: handle.paths.runRoot,
          scans: result.scanResults.map((scanResult) => ({
            findingCount: scanResult.output.findings.length,
            outputFile: scanResult.outputFile,
            promptFile: scanResult.promptFile,
            requestFile: scanResult.requestFile,
            scanId: scanResult.scanId,
          })),
          summaryFile: result.summarizeResult.summaryFile,
          triage: result.triageResults.map((triageResult) => ({
            disposition: triageResult.triage.disposition,
            findingFile: triageResult.findingFile,
            findingId: triageResult.finding.findingId,
            triageFile: triageResult.triageFile,
          })),
          validation: result.validationResults.map((validationResult) => ({
            findingId: validationResult.finding.findingId,
            outcome: validationResult.validation.outcome,
            validationFile: validationResult.validationFile,
          })),
        },
        null,
        2,
      ),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    await handle.updateRun({
      activeLoop: loop ?? handle.run.activeLoop,
      currentPhase: activePhase,
      status: "failed",
    });
    await handle.appendEvent({
      details: {
        loop: loop ?? handle.run.activeLoop,
        message,
        phase: activePhase,
      },
      type: "phase.failed",
    });

    throw error;
  } finally {
    await handle.close();
  }

  return 0;
}

function parseLoopValue(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --loop value "${value}". Expected a positive integer.`);
  }

  return parsed;
}

function readRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}
