import path from "node:path";

import { createRunStore } from "../store/run-store";

export async function initCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: ozcar init [--root <path>] [--target-root <path>] [--run-id <id>]");
    return 0;
  }

  let workspaceRoot = process.cwd();
  let targetRoot: string | undefined;
  let runId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    switch (argument) {
      case "--root":
        workspaceRoot = path.resolve(readRequiredValue(args, index, "--root"));
        index += 1;
        break;
      case "--target-root":
        targetRoot = path.resolve(readRequiredValue(args, index, "--target-root"));
        index += 1;
        break;
      case "--run-id":
        runId = readRequiredValue(args, index, "--run-id");
        index += 1;
        break;
      default:
        throw new Error(`Unknown option for init: ${argument}`);
    }
  }

  const options = {
    workspaceRoot,
    targetRoot: targetRoot ?? workspaceRoot,
  };

  const handle = await createRunStore(
    runId
      ? {
          ...options,
          runId,
        }
      : options,
  );

  try {
    const events = await handle.readEvents();
    console.log(
      JSON.stringify(
        {
          eventCount: events.length,
          eventsFile: handle.paths.eventsFile,
          runFile: handle.paths.runFile,
          runId: handle.run.runId,
          runRoot: handle.paths.runRoot,
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

function readRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}
