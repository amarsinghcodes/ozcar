import path from "node:path";

import { replayStoredScanPhase } from "../phases/scan";
import { reopenRunStore } from "../store/run-store";

export async function replayCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: ozcar replay <run-id> --scan-id <id> [--root <path>] [--loop <number>]");
    return 0;
  }

  let workspaceRoot = process.cwd();
  let runId: string | undefined;
  let scanId: string | undefined;
  let loop: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    switch (argument) {
      case "--root":
        workspaceRoot = path.resolve(readRequiredValue(args, index, "--root"));
        index += 1;
        break;
      case "--scan-id":
        scanId = readRequiredValue(args, index, "--scan-id");
        index += 1;
        break;
      case "--loop":
        loop = parseLoopValue(readRequiredValue(args, index, "--loop"));
        index += 1;
        break;
      default:
        if (argument.startsWith("--")) {
          throw new Error(`Unknown option for replay: ${argument}`);
        }

        if (runId) {
          throw new Error(`Unexpected positional argument for replay: ${argument}`);
        }

        runId = argument;
        break;
    }
  }

  if (!runId) {
    throw new Error("Missing run id for replay");
  }

  if (!scanId) {
    throw new Error("Missing --scan-id for replay");
  }

  const handle = await reopenRunStore({ runId, workspaceRoot });

  try {
    const targetLoop = loop ?? handle.run.activeLoop;

    if (targetLoop <= 0) {
      throw new Error(
        `Run ${handle.run.runId} has no active loop to replay. Start the run with \`ozcar run\` before using \`ozcar replay\`.`,
      );
    }

    const result = await replayStoredScanPhase({
      loop: targetLoop,
      runId: handle.run.runId,
      runRoot: handle.paths.runRoot,
      scanId,
    });

    await handle.appendEvent({
      details: {
        findings: result.output.findings.length,
        loop: targetLoop,
        outputFile: result.outputFile,
        scanId,
      },
      type: "phase.scan.replayed",
    });

    console.log(
      JSON.stringify(
        {
          loop: targetLoop,
          outputFile: result.outputFile,
          promptFile: result.promptFile,
          requestFile: result.requestFile,
          run: handle.run,
          runRoot: handle.paths.runRoot,
          scan: {
            findingCount: result.output.findings.length,
            scanId: result.scanId,
            summary: result.output.summary,
          },
        },
        null,
        2,
      ),
    );
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
