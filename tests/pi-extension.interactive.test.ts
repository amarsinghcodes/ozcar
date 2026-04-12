import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants as fsConstants, accessSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const expectBinary = findExecutable("expect");
const piBinary = findExecutable("pi");
const livePiModel = process.env.OZCAR_PI_LIVE_MODEL ?? (process.env.OPENAI_API_KEY ? "openai/gpt-4o-mini" : undefined);
const runInteractiveTreeProof = process.env.OZCAR_RUN_INTERACTIVE_TREE_PROOF === "1";

function buildInteractiveProofHelperExtension(markerPath: string): string {
  return `
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const markerPath = ${JSON.stringify(markerPath)};

function record(payload: Record<string, unknown>) {
  appendFileSync(markerPath, JSON.stringify(payload) + "\\n");
}

function serializeBranch(ctx: any) {
  return ctx.sessionManager.getBranch().map((entry) => ({
    auditId:
      entry.type === "custom" &&
      entry.customType === "ozcar-audit-state" &&
      entry.data &&
      typeof entry.data === "object"
        ? entry.data.auditId
        : undefined,
    branchKind:
      entry.type === "custom" &&
      entry.customType === "ozcar-audit-state" &&
      entry.data &&
      typeof entry.data === "object"
        ? entry.data.branchKind
        : undefined,
    customType: "customType" in entry ? entry.customType : undefined,
    id: entry.id,
    label: ctx.sessionManager.getLabel(entry.id),
    parentId: entry.parentId,
    summary: entry.type === "branch_summary" ? entry.summary : undefined,
    type: entry.type,
  }));
}

export default function (pi: ExtensionAPI) {
  pi.on("session_tree", async (event, ctx) => {
    if (!event.summaryEntry) {
      return;
    }

    record({
      branch: serializeBranch(ctx),
      event: "dump",
      leafId: ctx.sessionManager.getLeafId(),
      name: "after-summary",
    });
  });

  pi.registerCommand("phase3-dump", {
    description: "Dump the current session branch for the ozcar interactive proof",
    handler: async (args, ctx) => {
      const name = args.trim() || "unnamed";
      record({
        branch: serializeBranch(ctx),
        event: "dump",
        leafId: ctx.sessionManager.getLeafId(),
        name,
      });
    },
  });
}
`.trimStart();
}

function buildInteractiveTreeProofScript(options: {
  cwd: string;
  helperExtensionPath: string;
  ozcarExtensionPath: string;
  piBinary: string;
  transcriptPath: string;
}) {
  return `
set timeout 120
match_max 100000

proc fail {message} {
  send_user "$message\\n"
  exit 1
}

set cwd ${JSON.stringify(options.cwd)}
set piBinary ${JSON.stringify(options.piBinary)}
set ozcarExtensionPath ${JSON.stringify(options.ozcarExtensionPath)}
set helperExtensionPath ${JSON.stringify(options.helperExtensionPath)}
set model ${JSON.stringify(livePiModel)}
log_file -a ${JSON.stringify(options.transcriptPath)}

cd $cwd
spawn -noecho env TERM=xterm-256color $piBinary --no-session --no-extensions --no-skills --no-prompt-templates --no-themes --model $model -e $ozcarExtensionPath -e $helperExtensionPath

expect {
  -re "for commands" {}
  timeout { fail "Pi interactive session did not finish startup" }
}

send -- "/ozcar-audit-start Payments vault invariants\\r"
expect {
  -re "Started ozcar audit" {}
  timeout { fail "Start command did not report success" }
}

send -- "/ozcar-audit-branch hypothesis balance invariant :: Track missing balance invariant\\r"
expect {
  -re "Marked the current audit branch as hypothesis" {}
  timeout { fail "Branch command did not report success" }
}

send -- "/phase3-dump after-hypothesis\\r"
after 1500

send -- "/tree\\r"
expect {
  -re "Session Tree" {}
  timeout { fail "Interactive /tree selector did not open" }
}

send -- "\\001"
after 300
send -- "ozcar-audit-state"
after 500
send -- "\\033\\[A"
after 300
send -- "\\r"

expect {
  -re "Summarize branch\\\\?" {}
  timeout { fail "Summarize branch selector did not open" }
}

send -- "\\033\\[B"
after 300
send -- "\\r"

expect {
  -re "Navigated to selected point" {}
  timeout { fail "Interactive /tree navigation did not complete" }
}

send -- "/ozcar-audit-state\\r"
expect {
  -re "Branch: abandoned:balance-invariant" {}
  timeout { fail "Interactive /tree navigation did not restore abandoned audit state" }
}

send -- "\\003\\003"
expect eof
`.trimStart();
}

function findExecutable(name: string): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) {
      continue;
    }

    const candidate = path.join(directory, name);

    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function readMarkerEvents(markerPath: string): Promise<Array<Record<string, unknown>>> {
  const contents = await fs.readFile(markerPath, "utf8").catch(() => "");

  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const describeIfInteractiveProof =
  runInteractiveTreeProof && piBinary && expectBinary && livePiModel ? describe : describe.skip;

describeIfInteractiveProof("ozcar Pi interactive tree proof", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("proves the interactive /tree selector uses Pi's default summarizer and restores abandoned audit state", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-phase3-interactive-pi-"));

    const helperExtensionPath = path.join(tempRoot, "interactive-helper.ts");
    const markerPath = path.join(tempRoot, "interactive-events.jsonl");
    const transcriptPath = path.join(tempRoot, "interactive-transcript.txt");
    const proofScriptPath = path.join(tempRoot, "interactive-proof.expect");

    await fs.writeFile(helperExtensionPath, buildInteractiveProofHelperExtension(markerPath), "utf8");
    await fs.writeFile(
      proofScriptPath,
      buildInteractiveTreeProofScript({
        cwd: tempRoot,
        helperExtensionPath,
        ozcarExtensionPath: path.join(repoRoot, ".pi", "extensions", "ozcar", "index.ts"),
        piBinary: piBinary!,
        transcriptPath,
      }),
      "utf8",
    );

    try {
      await execFileAsync(expectBinary!, [proofScriptPath], {
        cwd: tempRoot,
        env: process.env,
        timeout: 180_000,
      });
    } catch (error) {
      const transcript = await fs.readFile(transcriptPath, "utf8").catch(() => "");
      const failure = error as Error & { stderr?: string; stdout?: string };
      throw new Error(
        [
          "Interactive Pi /tree proof failed.",
          failure.message,
          failure.stdout ? `stdout:\n${failure.stdout}` : undefined,
          failure.stderr ? `stderr:\n${failure.stderr}` : undefined,
          transcript ? `transcript:\n${transcript}` : undefined,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    const events = await readMarkerEvents(markerPath);
    const afterHypothesisDump = events.find((event) => event.event === "dump" && event.name === "after-hypothesis");
    const afterSummaryDump = events.find((event) => event.event === "dump" && event.name === "after-summary");

    expect(afterHypothesisDump).toMatchObject({
      event: "dump",
      leafId: expect.any(String),
      name: "after-hypothesis",
    });
    const afterHypothesisBranch = (afterHypothesisDump?.branch as Array<Record<string, unknown>> | undefined) ?? [];
    expect(afterHypothesisBranch.some((entry) => entry.label === "audit:hypothesis:balance-invariant")).toBe(true);

    expect(afterSummaryDump).toMatchObject({
      event: "dump",
      leafId: expect.any(String),
      name: "after-summary",
    });
    const afterSummaryBranch = (afterSummaryDump?.branch as Array<Record<string, unknown>> | undefined) ?? [];
    expect(afterSummaryBranch.some((entry) => entry.label === "audit:abandoned:balance-invariant")).toBe(true);
    expect(
      afterSummaryBranch.some((entry) => typeof entry.summary === "string" && String(entry.summary).trim().length > 0),
    ).toBe(true);
    expect(
      afterSummaryBranch.some(
        (entry) =>
          entry.customType === "ozcar-audit-state" &&
          entry.branchKind === "abandoned" &&
          entry.auditId === "payments-vault-invariants",
      ),
    ).toBe(true);
  }, 180_000);
});
