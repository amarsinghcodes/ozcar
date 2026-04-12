#!/usr/bin/env node

import { doctorCommand } from "./commands/doctor";
import { initCommand } from "./commands/init";
import { rebuildCommand } from "./commands/rebuild";
import { replayCommand } from "./commands/replay";
import { resumeCommand } from "./commands/resume";
import { runCommand } from "./commands/run";
import { statusCommand } from "./commands/status";

type CommandHandler = (args: string[]) => Promise<number>;

const commands: Record<string, CommandHandler> = {
  doctor: doctorCommand,
  init: initCommand,
  rebuild: rebuildCommand,
  replay: replayCommand,
  resume: resumeCommand,
  run: runCommand,
  status: statusCommand,
};

function renderHelp(): string {
  return [
    "Usage: ozcar <command> [options]",
    "",
    "Commands:",
    "  init     Create a new durable run store",
    "  resume   Continue a durable run from stored state",
    "  status   Read the current run snapshot and artifact health",
    "  run      Execute the dry-run operational loop end to end",
    "  replay   Rerun a stored scan from durable inputs",
    "  rebuild  Rebuild reports from validated artifacts",
    "  doctor   Diagnose missing, invalid, or stale run artifacts",
  ].join("\n");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [commandName, ...commandArgs] = argv;

  if (!commandName || commandName === "--help" || commandName === "-h") {
    console.log(renderHelp());
    return 0;
  }

  const command = commands[commandName];
  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    console.error(renderHelp());
    return 1;
  }

  return command(commandArgs);
}

if (require.main === module) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    });
}
