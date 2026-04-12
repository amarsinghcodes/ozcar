import path from "node:path";

import { inspectRunHealth } from "../store/run-health";
import { getRunPaths, readRunSnapshot } from "../store/run-store";

export async function doctorCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: ozcar doctor <run-id> [--root <path>]");
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
      throw new Error(`Unknown option for doctor: ${argument}`);
    }

    if (runId) {
      throw new Error(`Unexpected positional argument for doctor: ${argument}`);
    }

    runId = argument;
  }

  if (!runId) {
    throw new Error("Missing run id for doctor");
  }

  try {
    const snapshot = await readRunSnapshot({ runId, workspaceRoot });
    const report = await inspectRunHealth(snapshot);

    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  } catch (error: unknown) {
    const paths = getRunPaths(workspaceRoot, runId);
    const message = error instanceof Error ? error.message : String(error);

    console.log(
      JSON.stringify(
        {
          counts: {
            pendingArtifacts: 0,
            rejectedArtifacts: 0,
            scanFindings: 0,
            scansPlanned: 0,
            triageArtifacts: 0,
            validatedArtifacts: 0,
          },
          eventCount: 0,
          issues: [
            {
              artifactPath: paths.runRoot,
              code: "run-store",
              message,
            },
          ],
          lastEventType: null,
          loop: 0,
          ok: false,
          reportState: {
            confirmedFindingsFile: path.join(paths.runRoot, "confirmed-findings.md"),
            confirmedFindingsFresh: null,
            summaryFile: path.join(paths.runRoot, "summary.md"),
            summaryFresh: null,
          },
          run: null,
          runId,
          runRoot: paths.runRoot,
        },
        null,
        2,
      ),
    );

    return 1;
  }
}

function readRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}
