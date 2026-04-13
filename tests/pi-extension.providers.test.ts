import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  OZCAR_AUDIT_MODEL_COMMAND,
  buildAuditModelCommand,
  registerAuditModelCommand,
  renderAuditModelPresetHelp,
  resolveAuditModelPreset,
  type PiCommandRegistrationLike,
} from "../.pi/extensions/ozcar/index";

function createHarness(env: Record<string, string | undefined>) {
  const commandRegistry = new Map<string, PiCommandRegistrationLike>();
  const notify = vi.fn();
  const setEditorText = vi.fn();

  registerAuditModelCommand(
    {
      registerCommand(name, options) {
        commandRegistry.set(name, options);
      },
    },
    env,
  );

  return {
    commandRegistry,
    ctx: {
      cwd: "/Users/x/ozcar",
      isIdle: () => true,
      sessionManager: {
        getBranch: () => [],
        getEntries: () => [],
        getEntry: () => undefined,
        getLabel: () => undefined,
        getLeafId: () => null,
      },
      ui: {
        notify,
        setEditorText,
      },
    },
    notify,
    setEditorText,
  };
}

describe("ozcar Phase 5 audit model presets", () => {
  it("renders configured and unconfigured preset help", () => {
    const help = renderAuditModelPresetHelp({
      OZCAR_AUDIT_MODEL_BALANCED: "openrouter/unsloth/qwen3.5-35b-a3b",
      OZCAR_AUDIT_MODEL_DEEP: "anthropic/claude-sonnet-4-5",
    });

    expect(help).toContain("openrouter/unsloth/qwen3.5-35b-a3b");
    expect(help).toContain("anthropic/claude-sonnet-4-5");
    expect(help).toContain("OZCAR_AUDIT_MODEL_ECONOMY=<provider/model>");
    expect(help).toContain("/login");
  });

  it("queues a configured preset into Pi's /model surface", async () => {
    const harness = createHarness({
      OZCAR_AUDIT_MODEL_BALANCED: "openrouter/unsloth/qwen3.5-35b-a3b",
    });

    await harness.commandRegistry.get(OZCAR_AUDIT_MODEL_COMMAND)?.handler("balanced", harness.ctx);

    expect(harness.setEditorText).toHaveBeenCalledWith("/model openrouter/unsloth/qwen3.5-35b-a3b");
    expect(harness.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Queued Pi /model command for ozcar preset `balanced`."),
      "info",
    );
  });

  it("accepts valid slash-containing model ids in canonical provider/model references", () => {
    const preset = resolveAuditModelPreset("balanced", {
      OZCAR_AUDIT_MODEL_BALANCED: "openrouter/unsloth/qwen3.5-35b-a3b",
    });

    expect(preset.model).toBe("openrouter/unsloth/qwen3.5-35b-a3b");
    expect(preset.invalidModel).toBeUndefined();
  });

  it("warns and stages a placeholder when a preset is unset", async () => {
    const harness = createHarness({});

    await harness.commandRegistry.get(OZCAR_AUDIT_MODEL_COMMAND)?.handler("deep", harness.ctx);

    expect(harness.setEditorText).toHaveBeenCalledWith("/model <provider/model>");
    expect(harness.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Set OZCAR_AUDIT_MODEL_DEEP=<provider/model>"),
      "warning",
    );
  });

  it("rejects malformed configured preset values and falls back to a placeholder command", async () => {
    const harness = createHarness({
      OZCAR_AUDIT_MODEL_DEEP: "openai/gpt-5-codex\n/model hacked",
    });

    await harness.commandRegistry.get(OZCAR_AUDIT_MODEL_COMMAND)?.handler("deep", harness.ctx);

    expect(harness.setEditorText).toHaveBeenCalledWith("/model <provider/model>");
    expect(harness.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("has an invalid OZCAR_AUDIT_MODEL_DEEP value"),
      "warning",
    );
  });

  it("keeps the Phase 5 preset seam free of provider runtime ownership and Phase 6 creep", () => {
    const providersSource = readFileSync(new URL("../.pi/extensions/ozcar/providers/presets.ts", import.meta.url), "utf8");
    const commandSource = readFileSync(new URL("../.pi/extensions/ozcar/commands/model.ts", import.meta.url), "utf8");

    for (const source of [providersSource, commandSource]) {
      expect(source).not.toMatch(/registerProvider|streamSimple|oauth|apiKey/i);
      expect(source).not.toMatch(/benchmark|comparison|findings\.json/i);
      expect(source).not.toMatch(/src\/providers|src\/commands\/run/i);
    }
  });

  it("builds a placeholder /model command until the preset is configured", () => {
    const preset = resolveAuditModelPreset("economy", {});

    expect(buildAuditModelCommand(preset)).toBe("/model <provider/model>");
  });

  it("ignores malformed configured preset values in help output", () => {
    const help = renderAuditModelPresetHelp({
      OZCAR_AUDIT_MODEL_ECONOMY: "bad preset",
    });

    expect(help).toContain("Ignoring invalid OZCAR_AUDIT_MODEL_ECONOMY value");
    expect(help).not.toContain("Current: bad preset");
  });
});
