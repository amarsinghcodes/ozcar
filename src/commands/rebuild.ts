import path from "node:path";

import { runSummarizePhase } from "../phases/summarize";
import { reopenRunStore } from "../store/run-store";

export async function rebuildCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: ozcar rebuild <run-id> [--root <path>] [--loop <number>]");
    return 0;
  }

  let workspaceRoot = process.cwd();
  let runId: string | undefined;
  let loop: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    switch (argument) {
      case "--root":
        workspaceRoot = path.resolve(readRequiredValue(args, index, "--root"));
        index += 1;
        break;
      case "--loop":
        loop = parseLoopValue(readRequiredValue(args, index, "--loop"));
        index += 1;
        break;
      default:
        if (argument.startsWith("--")) {
          throw new Error(`Unknown option for rebuild: ${argument}`);
        }

        if (runId) {
          throw new Error(`Unexpected positional argument for rebuild: ${argument}`);
        }

        runId = argument;
        break;
    }
  }

  if (!runId) {
    throw new Error("Missing run id for rebuild");
  }

  const handle = await reopenRunStore({ runId, workspaceRoot });

  try {
    const targetLoop = loop ?? handle.run.activeLoop;

    if (targetLoop <= 0) {
      throw new Error(
        `Run ${handle.run.runId} has no active loop to rebuild. Start the run with \`ozcar run\` before using \`ozcar rebuild\`.`,
      );
    }

    const result = await runSummarizePhase({
      loop: targetLoop,
      runId: handle.run.runId,
      runRoot: handle.paths.runRoot,
    });

    await handle.appendEvent({
      details: {
        confirmedFindingsFile: result.confirmedFindingsFile,
        loop: targetLoop,
        summaryFile: result.summaryFile,
        validatedFindings: result.validatedFindings.length,
      },
      type: "phase.summarize.rebuilt",
    });

    console.log(
      JSON.stringify(
        {
          confirmedFindingsFile: result.confirmedFindingsFile,
          loop: targetLoop,
          run: handle.run,
          runRoot: handle.paths.runRoot,
          summaryFile: result.summaryFile,
          validatedFindings: result.validatedFindings.length,
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
