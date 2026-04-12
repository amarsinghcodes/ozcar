import { promises as fs } from "node:fs";
import path from "node:path";

import { continueRunFromScans } from "./operational-runtime";
import { type PhaseName } from "../contracts/run";
import { ScanFinding, ScanFindingSchema } from "../contracts/scan";
import { runPlanPhase } from "../phases/plan";
import { runScanPhase } from "../phases/scan";
import { resolveProvider } from "../providers/base";
import { ensureProviderPreflight, ProviderPreflightError } from "../providers/runtime";
import { createRunStore } from "../store/run-store";

const ACTIVE_LOOP = 1;

export async function runCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      [
        "Usage: ozcar run --run-id <id> [options]",
        "",
        "Live execution:",
        "  Runs provider preflight once, executes live plan and scan calls, then completes triage, validation, and report rebuilds from durable state.",
        "",
        "Dry-run seam:",
        "  Add --dry-run to emit replayable plan and scan artifacts without live provider calls.",
        "",
        "Fixture seam:",
        "  Add --finding-fixture <path> together with --dry-run to seed replayable scan findings into request.json for resume and replay coverage.",
        "",
        "Options:",
        "  --root <path>                 Workspace root (defaults to cwd)",
        "  --target-root <path>          Audit target root (defaults to workspace root)",
        "  --run-id <id>                 Required run id",
        "  --provider <auto|codex|claude>",
        "  --model <name>                Optional explicit provider model override",
        "  --scope <value>               Repeatable; may also contain comma-separated entries",
        "  --objective <value>           Repeatable; may also contain comma-separated entries",
        "  --scan-target <value>         Repeatable; may also contain comma-separated entries",
        "  --research-direction <text>   Required scan direction",
        "  --finding-fixture <path>      Optional JSON array of dry scan findings (requires --dry-run)",
        "  --dry-run                     Keep plan and scan on the fixture-backed replay seam",
      ].join("\n"),
    );
    return 0;
  }

  const parsed = parseRunArgs(args);

  if (!parsed.dryRun && parsed.findingFixture) {
    throw new Error("`--finding-fixture` is only supported with `--dry-run`.");
  }

  const dryRunFindings = parsed.findingFixture ? await readFindingFixture(parsed.findingFixture) : undefined;
  const provider = await resolveProvider(parsed.provider ? { requested: parsed.provider } : {});

  const handle = await createRunStore({
    runId: parsed.runId,
    targetRoot: parsed.targetRoot,
    workspaceRoot: parsed.workspaceRoot,
  });

  let activePhase: PhaseName = "plan";

  try {
    await handle.updateRun({
      activeLoop: ACTIVE_LOOP,
      currentPhase: activePhase,
      status: "running",
    });
    await handle.appendEvent({
      details: {
        available: provider.available,
        provider: provider.name,
        selection: provider.selection,
      },
      type: "provider.selected",
    });

    const preflight = parsed.dryRun
      ? undefined
      : await runProviderPreflight({
          handle,
          provider,
        });

    await handle.appendEvent({
      details: {
        loop: ACTIVE_LOOP,
        mode: parsed.dryRun ? "dry-run" : "live",
      },
      type: "phase.plan.started",
    });

    const planResult = await runPlanPhase({
      dryRun: parsed.dryRun,
      ...(preflight ? { preflight } : {}),
      loop: ACTIVE_LOOP,
      objectives: parsed.objectives,
      provider,
      researchDirection: parsed.researchDirection,
      runId: handle.run.runId,
      runRoot: handle.paths.runRoot,
      scanTargets: parsed.scanTargets,
      scope: parsed.scope,
      targetRoot: handle.run.targetRoot,
      ...(parsed.model ? { model: parsed.model } : {}),
    });

    await handle.appendEvent({
      details: {
        loop: ACTIVE_LOOP,
        mode: planResult.plan.mode,
        planFile: planResult.planFile,
      },
      type: "phase.plan.completed",
    });

    activePhase = "scan";
    await handle.updateRun({
      activeLoop: ACTIVE_LOOP,
      currentPhase: activePhase,
      status: "running",
    });
    await handle.appendEvent({
      details: {
        loop: ACTIVE_LOOP,
        mode: parsed.dryRun ? "dry-run" : "live",
        scansPlanned: planResult.plan.scans.length,
      },
      type: "phase.scan.started",
    });

    const scanResults = await runScanPhase({
      dryRun: parsed.dryRun,
      ...(dryRunFindings ? { dryRunFindings } : {}),
      loop: ACTIVE_LOOP,
      ...(preflight ? { preflight } : {}),
      plan: planResult.plan,
      provider,
      runId: handle.run.runId,
      runRoot: handle.paths.runRoot,
      targetRoot: handle.run.targetRoot,
      ...(parsed.model ? { model: parsed.model } : {}),
    });

    await handle.appendEvent({
      details: {
        emittedScans: scanResults.length,
        loop: ACTIVE_LOOP,
        mode: parsed.dryRun ? "dry-run" : "live",
      },
      type: "phase.scan.completed",
    });
    await handle.updateRun({
      activeLoop: ACTIVE_LOOP,
      currentPhase: activePhase,
      status: "running",
    });

    const operationalResult = await continueRunFromScans({
      handle,
      loop: ACTIVE_LOOP,
      plan: planResult.plan,
      planFile: planResult.planFile,
      replayedScanIds: [],
      scanResults,
      setActivePhase: (phase) => {
        activePhase = phase;
      },
    });

    console.log(
      JSON.stringify(
        {
          confirmedFindingsFile: operationalResult.summarizeResult.confirmedFindingsFile,
          loopRoot: planResult.loopRoot,
          planFile: operationalResult.planFile,
          plan: {
            file: operationalResult.planFile,
            mode: operationalResult.plan.mode,
          },
          provider: {
            available: provider.available,
            detectedProviders: provider.detectedProviders,
            name: provider.name,
            preflightFile: parsed.dryRun ? null : path.join(handle.paths.runRoot, "provider", "preflight.json"),
            selection: provider.selection,
          },
          replayedScans: operationalResult.replayedScanIds,
          runId: handle.run.runId,
          runRoot: handle.paths.runRoot,
          scans: operationalResult.scanResults.map((result) => ({
            findingCount: result.output.findings.length,
            mode: result.output.mode,
            outputFile: result.outputFile,
            promptFile: result.promptFile,
            requestFile: result.requestFile,
            scanId: result.scanId,
          })),
          summaryFile: operationalResult.summarizeResult.summaryFile,
          triage: operationalResult.triageResults.map((result) => ({
            disposition: result.triage.disposition,
            findingFile: result.findingFile,
            findingId: result.finding.findingId,
            triageFile: result.triageFile,
          })),
          validation: operationalResult.validationResults.map((result) => ({
            findingId: result.finding.findingId,
            outcome: result.validation.outcome,
            validationFile: result.validationFile,
          })),
        },
        null,
        2,
      ),
    );

    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    await handle.updateRun({
      activeLoop: ACTIVE_LOOP,
      currentPhase: activePhase,
      status: "failed",
    });
    await handle.appendEvent({
      details: {
        loop: ACTIVE_LOOP,
        message,
        phase: activePhase,
      },
      type: "phase.failed",
    });

    throw error;
  } finally {
    await handle.close();
  }
}

interface ParsedRunArgs {
  readonly dryRun: boolean;
  readonly findingFixture?: string;
  readonly model?: string;
  readonly objectives: string[];
  readonly provider?: string;
  readonly researchDirection: string;
  readonly runId: string;
  readonly scanTargets: string[];
  readonly scope: string[];
  readonly targetRoot: string;
  readonly workspaceRoot: string;
}

function parseRunArgs(args: string[]): ParsedRunArgs {
  let workspaceRoot = process.cwd();
  let targetRoot: string | undefined;
  let runId: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let researchDirection: string | undefined;
  let findingFixture: string | undefined;
  let dryRun = false;
  const scope: string[] = [];
  const objectives: string[] = [];
  const scanTargets: string[] = [];

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
      case "--provider":
        provider = readRequiredValue(args, index, "--provider");
        index += 1;
        break;
      case "--model":
        model = readRequiredValue(args, index, "--model");
        index += 1;
        break;
      case "--scope":
        appendListValues(scope, readRequiredValue(args, index, "--scope"));
        index += 1;
        break;
      case "--objective":
        appendListValues(objectives, readRequiredValue(args, index, "--objective"));
        index += 1;
        break;
      case "--scan-target":
        appendListValues(scanTargets, readRequiredValue(args, index, "--scan-target"));
        index += 1;
        break;
      case "--research-direction":
        researchDirection = readRequiredValue(args, index, "--research-direction").trim();
        index += 1;
        break;
      case "--finding-fixture":
        findingFixture = path.resolve(readRequiredValue(args, index, "--finding-fixture"));
        index += 1;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        throw new Error(`Unknown option for run: ${argument}`);
    }
  }

  if (!runId) {
    throw new Error("Missing --run-id for run");
  }

  if (!researchDirection) {
    throw new Error("Missing --research-direction for run");
  }

  if (scope.length === 0) {
    throw new Error("Missing at least one --scope entry for run");
  }

  if (scanTargets.length === 0) {
    throw new Error("Missing at least one --scan-target entry for run");
  }

  return {
    dryRun,
    ...(findingFixture ? { findingFixture } : {}),
    ...(model ? { model } : {}),
    objectives,
    ...(provider ? { provider } : {}),
    researchDirection,
    runId,
    scanTargets,
    scope,
    targetRoot: targetRoot ?? workspaceRoot,
    workspaceRoot,
  };
}

function appendListValues(target: string[], value: string): void {
  target.push(
    ...value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function readRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

async function readFindingFixture(fixtureFile: string): Promise<ScanFinding[]> {
  const raw = await fs.readFile(fixtureFile, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Invalid finding fixture ${fixtureFile}: invalid JSON (${String(error)}).`);
  }

  const result = ScanFindingSchema.array().safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const location = issue.path.length > 0 ? issue.path.join(".") : "root";
        return `${location}: ${issue.message}`;
      })
      .join("; ");

    throw new Error(`Invalid finding fixture ${fixtureFile}: ${issues}.`);
  }

  return result.data;
}

async function runProviderPreflight(options: {
  readonly handle: Awaited<ReturnType<typeof createRunStore>>;
  readonly provider: Awaited<ReturnType<typeof resolveProvider>>;
}) {
  try {
    const preflight = await ensureProviderPreflight({
      provider: options.provider,
      runRoot: options.handle.paths.runRoot,
    });

    await options.handle.appendEvent({
      details: {
        preflightFile: path.join(options.handle.paths.runRoot, "provider", "preflight.json"),
        provider: options.provider.name,
      },
      type: "provider.preflight.completed",
    });

    return preflight;
  } catch (error: unknown) {
    if (error instanceof ProviderPreflightError) {
      await options.handle.appendEvent({
        details: {
          message: error.message,
          preflightFile: error.artifactPath,
          provider: options.provider.name,
        },
        type: "provider.preflight.failed",
      });
    }

    throw error;
  }
}
