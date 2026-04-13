import {
  AUDIT_MODEL_PRESET_KEYS,
  buildAuditModelCommand,
  renderAuditModelPresetHelp,
  resolveAuditModelPreset,
  type AuditModelPresetEnvironment,
  type AuditModelPresetKey,
} from "../providers/presets";
import type { PiExtensionApiLike } from "../types";

export const OZCAR_AUDIT_MODEL_COMMAND = "ozcar-audit-model";

const MODEL_USAGE = `Usage: /${OZCAR_AUDIT_MODEL_COMMAND} [${AUDIT_MODEL_PRESET_KEYS.join("|")}]`;

export function parseAuditModelPresetArg(args: string): AuditModelPresetKey | "help" | undefined {
  const trimmed = args.trim().toLowerCase();

  if (!trimmed || trimmed === "help") {
    return "help";
  }

  return AUDIT_MODEL_PRESET_KEYS.find((candidate) => candidate === trimmed);
}

export function registerAuditModelCommand(
  pi: Pick<PiExtensionApiLike, "registerCommand">,
  env: AuditModelPresetEnvironment = process.env,
): void {
  pi.registerCommand(OZCAR_AUDIT_MODEL_COMMAND, {
    description:
      "Show repo-local audit model presets and queue a Pi /model command without taking over auth or provider ownership",
    handler: async (args, ctx) => {
      const parsed = parseAuditModelPresetArg(args);
      if (!parsed) {
        ctx.ui.notify(MODEL_USAGE, "warning");
        return;
      }

      if (parsed === "help") {
        ctx.ui.notify(renderAuditModelPresetHelp(env), "info");
        return;
      }

      const preset = resolveAuditModelPreset(parsed, env);
      const command = buildAuditModelCommand(preset);

      ctx.ui.setEditorText?.(command);

      if (preset.model) {
        ctx.ui.notify(
          [
            `Queued Pi /model command for ozcar preset \`${preset.name}\`.`,
            `Command: ${command}`,
            `Use /login if this provider still needs Pi-managed auth.`,
          ].join("\n"),
          "info",
        );
        return;
      }

      if (preset.invalidModel) {
        ctx.ui.notify(
          [
            `Preset \`${preset.name}\` has an invalid ${preset.envVar} value.`,
            `Ignored: ${JSON.stringify(preset.invalidModel)}`,
            "Expected <provider>/<model>.",
            `Placeholder command: ${command}`,
          ].join("\n"),
          "warning",
        );
        return;
      }

      ctx.ui.notify(
        [
          `Preset \`${preset.name}\` is not configured in this repo shell.`,
          `Set ${preset.envVar}=<provider/model> to make this a one-shot preset.`,
          `Placeholder command: ${command}`,
        ].join("\n"),
        "warning",
      );
    },
  });
}
