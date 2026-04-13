import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants, accessSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const piBinary = findExecutable("pi");
const livePiModel = process.env.OZCAR_PI_LIVE_MODEL ?? (process.env.OPENAI_API_KEY ? "openai/gpt-4o-mini" : undefined);

interface RpcSlashCommand {
  name: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo: {
    path?: string;
    source?: string;
  };
}

interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: {
    commands?: RpcSlashCommand[];
  };
}

interface RpcExtensionUiRequest {
  id?: string;
  message?: string;
  method?: string;
  notifyType?: string;
  statusKey?: string;
  statusText?: string;
  text?: string;
  type: "extension_ui_request";
  widgetKey?: string;
  widgetLines?: string[];
}

class RpcPiProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    string,
    {
      reject: (error: Error) => void;
      resolve: (response: RpcResponse) => void;
    }
  >();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly uiRequests: RpcExtensionUiRequest[] = [];

  constructor(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
    this.child = spawn(binary, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.flushStdout();
    });

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer += chunk;
    });

    this.child.on("exit", (code, signal) => {
      const error = new Error(
        `pi exited before the integration test completed (code=${code}, signal=${signal}). stderr: ${this.stderrBuffer}`,
      );

      for (const pending of this.pending.values()) {
        pending.reject(error);
      }

      this.pending.clear();
    });
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
      this.child.kill("SIGTERM");
    });
  }

  async send(command: { id: string; type: string; [key: string]: unknown }): Promise<RpcResponse> {
    return await new Promise<RpcResponse>((resolve, reject) => {
      this.pending.set(command.id, { reject, resolve });
      this.child.stdin.write(`${JSON.stringify(command)}\n`);
    });
  }

  getUiRequestCount(): number {
    return this.uiRequests.length;
  }

  async waitForUiRequest(
    predicate: (request: RpcExtensionUiRequest) => boolean,
    fromIndex: number = 0,
    timeoutMs: number = 10_000,
  ): Promise<RpcExtensionUiRequest> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const match = this.uiRequests.slice(fromIndex).find(predicate);

      if (match) {
        return match;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const recentRequests = this.uiRequests.slice(Math.max(0, this.uiRequests.length - 10));
    throw new Error(
      `Timed out waiting for extension UI request. Recent requests: ${JSON.stringify(recentRequests)}. stderr: ${this.stderrBuffer}`,
    );
  }

  async waitForNotify(pattern: RegExp | string, fromIndex: number = 0, timeoutMs: number = 10_000): Promise<RpcExtensionUiRequest> {
    return await this.waitForUiRequest((request) => {
      if (request.method !== "notify" || !request.message) {
        return false;
      }

      if (typeof pattern === "string") {
        return request.message.includes(pattern);
      }

      return pattern.test(request.message);
    }, fromIndex, timeoutMs);
  }

  private flushStdout(): void {
    let newlineIndex = this.stdoutBuffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        const parsed = JSON.parse(line) as { id?: string; type?: string };

        if (parsed.type === "response" && parsed.id) {
          const pending = this.pending.get(parsed.id);

          if (pending) {
            this.pending.delete(parsed.id);
            pending.resolve(parsed as RpcResponse);
          }
        } else if (parsed.type === "extension_ui_request") {
          this.uiRequests.push(parsed as RpcExtensionUiRequest);
        }
      }

      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }
}

function assertOzcarCommands(commands: RpcSlashCommand[]): void {
  expect(commands.filter((command) => command.name === "ozcar-audit")).toHaveLength(1);
  expect(commands.filter((command) => command.name === "skill:ozcar-audit")).toHaveLength(1);

  const commandByName = new Map(commands.map((command) => [command.name, command]));

  expect(commandByName.get("ozcar")).toEqual(
    expect.objectContaining({
      name: "ozcar",
      source: "extension",
    }),
  );
  expect(commandByName.get("ozcar-audit-start")).toEqual(
    expect.objectContaining({
      name: "ozcar-audit-start",
      source: "extension",
    }),
  );
  expect(commandByName.get("ozcar-audit-model")).toEqual(
    expect.objectContaining({
      name: "ozcar-audit-model",
      source: "extension",
    }),
  );
  expect(commandByName.get("ozcar-audit-resume")).toEqual(
    expect.objectContaining({
      name: "ozcar-audit-resume",
      source: "extension",
    }),
  );
  expect(commandByName.get("ozcar-audit-state")).toEqual(
    expect.objectContaining({
      name: "ozcar-audit-state",
      source: "extension",
    }),
  );
  expect(commandByName.get("ozcar-audit-branch")).toEqual(
    expect.objectContaining({
      name: "ozcar-audit-branch",
      source: "extension",
    }),
  );
  expect(commandByName.get("ozcar-audit-checkpoint")).toEqual(
    expect.objectContaining({
      name: "ozcar-audit-checkpoint",
      source: "extension",
    }),
  );
  expect(commandByName.get("ozcar-audit-export")).toEqual(
    expect.objectContaining({
      name: "ozcar-audit-export",
      source: "extension",
    }),
  );
  expect(commandByName.get("ozcar-audit")).toEqual(
    expect.objectContaining({
      name: "ozcar-audit",
      source: "prompt",
      sourceInfo: expect.objectContaining({
        path: path.join(repoRoot, ".pi", "prompts", "ozcar-audit.md"),
        source: "extension:index",
      }),
    }),
  );
  expect(commandByName.get("skill:ozcar-audit")).toEqual(
    expect.objectContaining({
      name: "skill:ozcar-audit",
      source: "skill",
      sourceInfo: expect.objectContaining({
        path: path.join(repoRoot, ".pi", "skills", "ozcar-audit", "SKILL.md"),
        source: "extension:index",
      }),
    }),
  );
}

function assertOzcarPackageCommands(commands: RpcSlashCommand[]): void {
  expect(commands.filter((command) => command.name === "ozcar-audit")).toHaveLength(1);
  expect(commands.filter((command) => command.name === "skill:ozcar-audit")).toHaveLength(1);

  const commandByName = new Map(commands.map((command) => [command.name, command]));

  expect(commandByName.get("ozcar")).toEqual(
    expect.objectContaining({
      name: "ozcar",
      source: "extension",
    }),
  );
  expect(commandByName.get("ozcar-audit-checkpoint")).toEqual(
    expect.objectContaining({
      name: "ozcar-audit-checkpoint",
      source: "extension",
    }),
  );
  expect(commandByName.get("ozcar-audit")).toEqual(
    expect.objectContaining({
      name: "ozcar-audit",
      source: "prompt",
      sourceInfo: expect.objectContaining({
        path: path.join(repoRoot, ".pi", "prompts", "ozcar-audit.md"),
      }),
    }),
  );
  expect(commandByName.get("skill:ozcar-audit")).toEqual(
    expect.objectContaining({
      name: "skill:ozcar-audit",
      source: "skill",
      sourceInfo: expect.objectContaining({
        path: path.join(repoRoot, ".pi", "skills", "ozcar-audit", "SKILL.md"),
      }),
    }),
  );
}

function buildReloadHelperExtension(markerPath: string): string {
  return `
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const markerPath = ${JSON.stringify(markerPath)};

function record(payload: Record<string, unknown>) {
  appendFileSync(markerPath, JSON.stringify(payload) + "\\n");
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event) => {
    record({ event: "session_start", reason: event.reason });
  });

  pi.on("resources_discover", async (event) => {
    record({ event: "resources_discover", reason: event.reason });
    return {};
  });

  pi.registerCommand("trigger-reload", {
    description: "Trigger session reload for the ozcar integration test",
    handler: async (_args, ctx) => {
      await ctx.reload();
      return;
    },
  });

  pi.registerCommand("phase3-dump", {
    description: "Dump the current session branch for the ozcar integration test",
    handler: async (args, ctx) => {
      const name = args.trim() || "unnamed";
      const branch = ctx.sessionManager.getBranch().map((entry) => ({
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
      record({
        branch,
        event: "dump",
        leafId: ctx.sessionManager.getLeafId(),
        name,
      });
    },
  });

  pi.registerCommand("phase3-navigate-root", {
    description: "Navigate back to the first ozcar audit root state",
    handler: async (_args, ctx) => {
      const rootState = ctx.sessionManager.getEntries().find((entry) => {
        if (entry.type !== "custom" || entry.customType !== "ozcar-audit-state") {
          return false;
        }
        const data = entry.data as { branchKind?: string } | undefined;
        return data?.branchKind === "root";
      });

      if (!rootState) {
        ctx.ui.notify("No ozcar audit root state found", "warning");
        return;
      }

      await ctx.navigateTree(rootState.id, { summarize: false });
    },
  });

  pi.registerCommand("phase3-summarize-root", {
    description: "Navigate back to the first ozcar audit root state with Pi's default summarizer",
    handler: async (_args, ctx) => {
      const rootState = ctx.sessionManager.getEntries().find((entry) => {
        if (entry.type !== "custom" || entry.customType !== "ozcar-audit-state") {
          return false;
        }
        const data = entry.data as { branchKind?: string } | undefined;
        return data?.branchKind === "root";
      });

      if (!rootState) {
        ctx.ui.notify("No ozcar audit root state found", "warning");
        return;
      }

      await ctx.navigateTree(rootState.id, { summarize: true });
    },
  });
}
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

async function waitForReloadMarkers(
  markerPath: string,
  expectedReloadCount: number = 1,
  timeoutMs: number = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const contents = await fs.readFile(markerPath, "utf8").catch(() => "");
    const sessionStartReloads = contents.match(/"event":"session_start","reason":"reload"/g)?.length ?? 0;
    const resourcesDiscoverReloads = contents.match(/"event":"resources_discover","reason":"reload"/g)?.length ?? 0;

    if (sessionStartReloads >= expectedReloadCount && resourcesDiscoverReloads >= expectedReloadCount) {
      return contents;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for reload markers in ${markerPath}`);
}

async function readMarkerEvents(markerPath: string): Promise<Array<Record<string, unknown>>> {
  const contents = await fs.readFile(markerPath, "utf8").catch(() => "");

  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const describeIfPi = piBinary ? describe : describe.skip;
const itIfLivePi = livePiModel ? it : it.skip;

describeIfPi("ozcar Pi integration", () => {
  let process: RpcPiProcess | undefined;
  let tempRoot: string | undefined;

  afterEach(async () => {
    await process?.close();

    if (tempRoot) {
      await fs.rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("keeps the isolated extension surface coherent across reload", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-pi-"));

    const markerPath = path.join(tempRoot, "reload-events.jsonl");
    const helperExtensionPath = path.join(tempRoot, "reload-helper.ts");

    await fs.writeFile(helperExtensionPath, buildReloadHelperExtension(markerPath), "utf8");

    process = new RpcPiProcess(
      piBinary!,
      [
        "--mode",
        "rpc",
        "--offline",
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "-e",
        "./.pi/extensions/ozcar/index.ts",
        "-e",
        helperExtensionPath,
      ],
      repoRoot,
    );

    const startupCommands = await process.send({
      id: "commands-before-reload",
      type: "get_commands",
    });
    assertOzcarCommands(startupCommands.data?.commands ?? []);

    const promptResponse = await process.send({
      id: "trigger-reload",
      type: "prompt",
      message: "/trigger-reload",
    });
    expect(promptResponse).toMatchObject({
      command: "prompt",
      success: true,
    });

    const markers = await waitForReloadMarkers(markerPath, 1);
    expect(markers).toContain('"event":"session_start","reason":"startup"');
    expect(markers).toContain('"event":"resources_discover","reason":"startup"');

    const reloadedCommands = await process.send({
      id: "commands-after-reload",
      type: "get_commands",
    });
    assertOzcarCommands(reloadedCommands.data?.commands ?? []);
  }, 20_000);

  it("loads ozcar through the package root from another cwd", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-pi-package-"));

    process = new RpcPiProcess(
      piBinary!,
      [
        "--mode",
        "rpc",
        "--offline",
        "--no-session",
        "--no-extensions",
        "-e",
        repoRoot,
      ],
      tempRoot,
    );

    const packageCommands = await process.send({
      id: "package-root-commands",
      type: "get_commands",
    });
    assertOzcarPackageCommands(packageCommands.data?.commands ?? []);
  }, 20_000);

  it("stages a configured audit model preset through Pi RPC editor requests", async () => {
    process = new RpcPiProcess(
      piBinary!,
      [
        "--mode",
        "rpc",
        "--offline",
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "-e",
        "./.pi/extensions/ozcar/index.ts",
      ],
      repoRoot,
      {
        ...globalThis.process.env,
        OZCAR_AUDIT_MODEL_BALANCED: "openrouter/unsloth/qwen3.5-35b-a3b",
      },
    );

    const initialCommands = await process.send({
      id: "phase5-commands-before",
      type: "get_commands",
    });
    assertOzcarCommands(initialCommands.data?.commands ?? []);

    const uiOffset = process.getUiRequestCount();
    const promptResponse = await process.send({
      id: "phase5-audit-model-balanced",
      type: "prompt",
      message: "/ozcar-audit-model balanced",
    });
    expect(promptResponse).toMatchObject({
      command: "prompt",
      success: true,
    });

    const editorRequest = await process.waitForUiRequest(
      (request) =>
        request.method === "set_editor_text" && request.text === "/model openrouter/unsloth/qwen3.5-35b-a3b",
      uiOffset,
    );
    expect(editorRequest.text).toBe("/model openrouter/unsloth/qwen3.5-35b-a3b");

    const notifyRequest = await process.waitForNotify("Queued Pi /model command for ozcar preset", uiOffset);
    expect(notifyRequest.message).toContain("/model openrouter/unsloth/qwen3.5-35b-a3b");
  }, 20_000);

  itIfLivePi("restores Phase 3 audit state across reload, summarized tree navigation, and newer root state", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-phase3-pi-"));

    const markerPath = path.join(tempRoot, "phase3-events.jsonl");
    const helperExtensionPath = path.join(tempRoot, "phase3-helper.ts");

    await fs.writeFile(helperExtensionPath, buildReloadHelperExtension(markerPath), "utf8");

    process = new RpcPiProcess(
      piBinary!,
      [
        "--mode",
        "rpc",
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--model",
        livePiModel!,
        "-e",
        "./.pi/extensions/ozcar/index.ts",
        "-e",
        helperExtensionPath,
      ],
      repoRoot,
    );

    const initialCommands = await process.send({
      id: "phase3-commands-before",
      type: "get_commands",
    });
    assertOzcarCommands(initialCommands.data?.commands ?? []);

    let uiOffset = process.getUiRequestCount();
    await process.send({
      id: "phase3-start",
      type: "prompt",
      message: "/ozcar-audit-start Payments vault invariants",
    });
    await process.waitForNotify("Started ozcar audit", uiOffset);

    uiOffset = process.getUiRequestCount();
    await process.send({
      id: "phase3-branch",
      type: "prompt",
      message: "/ozcar-audit-branch hypothesis balance invariant :: Track missing balance invariant",
    });
    await process.waitForNotify("Marked the current audit branch as hypothesis", uiOffset);

    uiOffset = process.getUiRequestCount();
    await process.send({
      id: "phase3-state-before-reload",
      type: "prompt",
      message: "/ozcar-audit-state",
    });
    await process.waitForNotify("Branch: hypothesis:balance-invariant", uiOffset);

    await process.send({
      id: "phase3-dump-before-tree",
      type: "prompt",
      message: "/phase3-dump after-hypothesis",
    });

    await process.send({
      id: "phase3-trigger-reload-before-summary",
      type: "prompt",
      message: "/trigger-reload",
    });
    await waitForReloadMarkers(markerPath, 1);

    uiOffset = process.getUiRequestCount();
    await process.send({
      id: "phase3-state-after-hypothesis-reload",
      type: "prompt",
      message: "/ozcar-audit-state",
    });
    await process.waitForNotify("Branch: hypothesis:balance-invariant", uiOffset);

    await process.send({
      id: "phase3-summarize-root",
      type: "prompt",
      message: "/phase3-summarize-root",
    });

    uiOffset = process.getUiRequestCount();
    await process.send({
      id: "phase3-state-after-summary",
      type: "prompt",
      message: "/ozcar-audit-state",
    });
    const abandonedStateNotice = await process.waitForNotify("Branch: abandoned:balance-invariant", uiOffset);
    expect(abandonedStateNotice.message).toContain("Branch summary:");

    await process.send({
      id: "phase3-dump-after-summary",
      type: "prompt",
      message: "/phase3-dump after-summary",
    });

    await process.send({
      id: "phase3-trigger-reload-after-summary",
      type: "prompt",
      message: "/trigger-reload",
    });
    await waitForReloadMarkers(markerPath, 2);

    uiOffset = process.getUiRequestCount();
    await process.send({
      id: "phase3-state-after-summary-reload",
      type: "prompt",
      message: "/ozcar-audit-state",
    });
    const abandonedReloadNotice = await process.waitForNotify("Branch: abandoned:balance-invariant", uiOffset);
    expect(abandonedReloadNotice.message).toContain("Branch summary:");

    await process.send({
      id: "phase3-start-new-root",
      type: "prompt",
      message: "/ozcar-audit-start Authorization invariants",
    });

    uiOffset = process.getUiRequestCount();
    await process.send({
      id: "phase3-state-after-new-root",
      type: "prompt",
      message: "/ozcar-audit-state",
    });
    const newRootNotice = await process.waitForNotify("Audit: authorization-invariants", uiOffset);
    expect(newRootNotice.message).toContain("Branch: root");

    await process.send({
      id: "phase3-trigger-reload-after-new-root",
      type: "prompt",
      message: "/trigger-reload",
    });
    await waitForReloadMarkers(markerPath, 3);

    uiOffset = process.getUiRequestCount();
    await process.send({
      id: "phase3-state-after-new-root-reload",
      type: "prompt",
      message: "/ozcar-audit-state",
    });
    const newRootReloadNotice = await process.waitForNotify("Audit: authorization-invariants", uiOffset);
    expect(newRootReloadNotice.message).toContain("Branch: root");

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
    expect(afterHypothesisBranch.filter((entry) => entry.customType === "ozcar-audit-state")).toHaveLength(2);

    expect(afterSummaryDump).toMatchObject({
      event: "dump",
      name: "after-summary",
    });
    const afterSummaryBranch = (afterSummaryDump?.branch as Array<Record<string, unknown>> | undefined) ?? [];
    expect(afterSummaryBranch.some((entry) => entry.label === "audit:abandoned:balance-invariant")).toBe(true);
    expect(
      afterSummaryBranch.some((entry) => typeof entry.summary === "string" && String(entry.summary).trim().length > 0),
    ).toBe(true);
    expect(
      afterSummaryBranch.filter(
        (entry) =>
          entry.customType === "ozcar-audit-state" &&
          entry.branchKind === "abandoned" &&
          entry.auditId === "payments-vault-invariants",
      ),
    ).toHaveLength(1);
  }, 30_000);
});
