import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  OZCAR_AUDIT_BRANCH_COMMAND,
  OZCAR_AUDIT_EXPORT_COMMAND,
  OZCAR_AUDIT_MODEL_COMMAND,
  OZCAR_AUDIT_BRANCH_TOOL,
  OZCAR_STORE_AUDIT_SNAPSHOT_TOOL,
  OZCAR_AUDIT_RESUME_COMMAND,
  OZCAR_AUDIT_START_COMMAND,
  OZCAR_AUDIT_STATE_COMMAND,
  OZCAR_COMMAND,
  OZCAR_PROMPT_TEMPLATE,
  OZCAR_SKILL,
  createResourceDiscovery,
  handleOzcarCommand,
  registerOzcarExtension,
  resolveOzcarPaths,
  type OzcarPaths,
  type PiCommandRegistrationLike,
  type PiExtensionApiLike,
  type PiResourceDiscoveryLike,
  type PiToolDefinitionLike,
} from "../.pi/extensions/ozcar/index";

function createRepoPaths(): OzcarPaths {
  return resolveOzcarPaths(new URL("../.pi/extensions/ozcar/index.ts", import.meta.url).href);
}

function createPiMock() {
  const commandRegistry = new Map<string, PiCommandRegistrationLike>();
  const eventRegistry = new Map<
    string,
    Array<(event: unknown, ctx: unknown) => unknown | Promise<unknown>>
  >();
  const toolRegistry = new Map<string, PiToolDefinitionLike>();

  const pi: PiExtensionApiLike = {
    appendEntry() {},
    on(event, handler) {
      const handlers = eventRegistry.get(event) ?? [];
      handlers.push(handler);
      eventRegistry.set(event, handlers);
    },
    registerCommand(name, options) {
      commandRegistry.set(name, options);
    },
    registerTool(tool) {
      toolRegistry.set(tool.name, tool);
    },
    setLabel() {},
    setSessionName() {},
  };

  return {
    commandRegistry,
    eventRegistry,
    pi,
    toolRegistry,
  };
}

describe("ozcar Pi extension scaffold", () => {
  it("discovers the repo-local prompt and skill directories", () => {
    const paths = createRepoPaths();
    const discovery = createResourceDiscovery(paths);

    expect(path.relative(paths.repoRoot, paths.promptsDir)).toBe(path.join(".pi", "prompts"));
    expect(path.relative(paths.repoRoot, paths.skillsDir)).toBe(path.join(".pi", "skills"));
    expect(discovery).toEqual({
      promptPaths: [paths.promptsDir],
      skillPaths: [paths.skillsDir],
    });
    expect(existsSync(path.join(paths.promptsDir, `${OZCAR_PROMPT_TEMPLATE}.md`))).toBe(true);
    expect(existsSync(path.join(paths.skillsDir, OZCAR_SKILL, "SKILL.md"))).toBe(true);
  });

  it("registers the resources_discover hook and /ozcar command", async () => {
    const paths = createRepoPaths();
    const { commandRegistry, eventRegistry, pi, toolRegistry } = createPiMock();

    registerOzcarExtension(pi, paths);

    expect(commandRegistry.get(OZCAR_COMMAND)?.description).toContain("repo-local ozcar Pi");
    expect(commandRegistry.get(OZCAR_AUDIT_EXPORT_COMMAND)?.description).toContain("findings.json comparison surface");
    expect(commandRegistry.has(OZCAR_AUDIT_START_COMMAND)).toBe(true);
    expect(commandRegistry.has(OZCAR_AUDIT_RESUME_COMMAND)).toBe(true);
    expect(commandRegistry.has(OZCAR_AUDIT_STATE_COMMAND)).toBe(true);
    expect(commandRegistry.has(OZCAR_AUDIT_BRANCH_COMMAND)).toBe(true);
    expect(commandRegistry.has(OZCAR_AUDIT_MODEL_COMMAND)).toBe(true);
    expect(commandRegistry.has(OZCAR_AUDIT_EXPORT_COMMAND)).toBe(true);
    expect(toolRegistry.get(OZCAR_AUDIT_BRANCH_TOOL)?.description).toContain("Pi session state");
    expect(toolRegistry.get(OZCAR_STORE_AUDIT_SNAPSHOT_TOOL)?.description).toContain("Phase 4 audit snapshot");

    const resourcesDiscoverHandlers = eventRegistry.get("resources_discover") ?? [];
    expect(resourcesDiscoverHandlers).toHaveLength(1);

    for (const reason of ["startup", "reload"] as const) {
      expect(
        resourcesDiscoverHandlers[0]?.(
          {
            cwd: paths.repoRoot,
            reason,
          },
          {},
        ),
      ).toEqual(createResourceDiscovery(paths));
    }
  });

  it("renders repo-local help for /ozcar", () => {
    const notify = vi.fn();

    handleOzcarCommand(
      "",
      {
        isIdle: () => true,
        ui: {
          notify,
        },
      },
      createRepoPaths(),
    );

    expect(notify).toHaveBeenCalledWith(expect.stringContaining(`/${OZCAR_PROMPT_TEMPLATE}`), "info");
    expect(notify.mock.calls[0]?.[0]).toContain(`/${OZCAR_AUDIT_START_COMMAND}`);
    expect(notify.mock.calls[0]?.[0]).toContain(`/${OZCAR_AUDIT_MODEL_COMMAND}`);
    expect(notify.mock.calls[0]?.[0]).toContain(`/${OZCAR_AUDIT_STATE_COMMAND}`);
    expect(notify.mock.calls[0]?.[0]).toContain(`<hypothesis|confirmed>`);
    expect(notify.mock.calls[0]?.[0]).not.toContain(`<hypothesis|confirmed|abandoned>`);
    expect(notify.mock.calls[0]?.[0]).toContain(`/${OZCAR_AUDIT_EXPORT_COMMAND}`);
    expect(notify.mock.calls[0]?.[0]).toContain("exports/findings.json");
    expect(notify.mock.calls[0]?.[0]).not.toContain("<snapshot.json>");
    expect(notify.mock.calls[0]?.[0]).toContain(`/skill:${OZCAR_SKILL}`);
    expect(notify.mock.calls[0]?.[0]).toContain(OZCAR_AUDIT_BRANCH_TOOL);
    expect(notify.mock.calls[0]?.[0]).toContain(OZCAR_STORE_AUDIT_SNAPSHOT_TOOL);
    expect(notify.mock.calls[0]?.[0]).toContain("/reload");
  });

  it("rejects unsupported /ozcar subcommands", () => {
    const notify = vi.fn();

    handleOzcarCommand(
      "audit",
      {
        isIdle: () => true,
        ui: {
          notify,
        },
      },
      createRepoPaths(),
    );

    expect(notify).toHaveBeenCalledWith("Usage: /ozcar or /ozcar help", "warning");
  });
});
