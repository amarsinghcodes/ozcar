import { describe, expect, it } from "vitest";

import { ProviderResolutionError, resolveProvider } from "../src/providers/base";

describe("provider resolution", () => {
  it("auto-selects codex before claude when both providers are detected", async () => {
    const provider = await resolveProvider({
      isCommandAvailable: async (command) => command === "codex" || command === "claude",
    });

    expect(provider.name).toBe("codex");
    expect(provider.selection).toBe("auto");
    expect(provider.available).toBe(true);
    expect(provider.detectedProviders).toEqual(["codex", "claude"]);
  });

  it("supports an explicit override even when the provider is not detected", async () => {
    const provider = await resolveProvider({
      isCommandAvailable: async () => false,
      requested: "claude",
    });

    expect(provider.name).toBe("claude");
    expect(provider.selection).toBe("override");
    expect(provider.available).toBe(false);
    expect(provider.detectedProviders).toEqual([]);
  });

  it("fails auto resolution with an actionable error when nothing is detected", async () => {
    await expect(
      resolveProvider({
        isCommandAvailable: async () => false,
      }),
    ).rejects.toBeInstanceOf(ProviderResolutionError);

    await expect(
      resolveProvider({
        isCommandAvailable: async () => false,
      }),
    ).rejects.toThrow(/No built-in provider detected on PATH/);
  });
});
