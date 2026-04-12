import path from "node:path";

import { inspectRunHealth } from "../store/run-health";
import { readRunSnapshot } from "../store/run-store";

export async function statusCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: ozcar status <run-id> [--root <path>]");
    return 0;
  }

  let workspaceRoot = process.cwd();
  let runId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--root") {
      workspaceRoot = path.resolve(readRequiredValue(args, index, "--root"));
      index += 1;
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown option for status: ${argument}`);
    }

    if (runId) {
      throw new Error(`Unexpected positional argument for status: ${argument}`);
    }

    runId = argument;
  }

  if (!runId) {
    throw new Error("Missing run id for status");
  }

  const snapshot = await readRunSnapshot({ runId, workspaceRoot });
  const health = await inspectRunHealth(snapshot);

  console.log(
    JSON.stringify(
      {
        counts: health.counts,
        eventCount: health.eventCount,
        healthy: health.ok,
        issues: health.issues,
        lastEventType: health.lastEventType,
        loop: health.loop,
        reportState: health.reportState,
        run: snapshot.run,
        runRoot: snapshot.paths.runRoot,
      },
      null,
      2,
    ),
  );

  return 0;
}

function readRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}
