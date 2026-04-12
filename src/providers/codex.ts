import type {
  ProviderAuthResult,
  ProviderCommandResult,
  ProviderDefinition,
  ProviderFailureClassification,
  ProviderFailureClassificationOptions,
  ProviderInvocationBuildOptions,
  ProviderParsedResponse,
} from "./base";

const TRANSIENT_OUTPUT_PATTERN =
  /\b(429|500|502|503|504|connection reset|connection refused|connection timed out|deadline exceeded|econnreset|etimedout|overloaded|rate limit|service unavailable|temporarily unavailable|timeout|timed out|try again later)\b/iu;
const AUTH_OUTPUT_PATTERN =
  /\b(authentication failed|invalid api key|log(?:ged)? in|not authenticated|not logged in|login required)\b/iu;
const MODEL_OUTPUT_PATTERN = /\b(invalid model|model .* not found)\b/iu;

export const codexProvider: ProviderDefinition = {
  name: "codex",
  command: "codex",
  capabilities: {
    modelOverride: true,
    plan: true,
    scan: true,
  },
  defaultModels: {
    plan: "codex-default",
    scan: "codex-default",
  },
  detectionCommands: ["codex"],
  guidance: {
    auth: "Run `codex login` or `printenv OPENAI_API_KEY | codex login --with-api-key`, then retry the live provider run.",
    install: "Install Codex CLI and ensure `codex` is on PATH before retrying the live provider run.",
  },
  retryPolicy: {
    maxAttempts: 2,
    retryDelayMs: 250,
    retryOnParseFailure: true,
  },
  authCommandArgs: ["login", "status"],
  versionCommandArgs: ["--version"],
  buildInvocation(options: ProviderInvocationBuildOptions) {
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--color",
      "never",
      "--output-schema",
      options.schemaFile,
      "--output-last-message",
      options.responseFile,
    ];

    if (shouldPassExplicitModel(options.model)) {
      args.push("-m", options.model);
    }

    args.push("-");

    return {
      args,
      command: "codex",
      cwd: options.cwd,
      stdin: options.prompt,
    };
  },
  classifyFailure(options: ProviderFailureClassificationOptions): ProviderFailureClassification {
    return classifyFailure("Codex", options);
  },
  parseAuthResult(result: ProviderCommandResult): ProviderAuthResult {
    const combined = joinOutput(result);
    const line = firstMeaningfulLine(combined) ?? "Codex authentication status could not be determined.";

    if (result.exitCode === 0 && /\blogged in\b/iu.test(combined)) {
      return {
        message: line,
        status: "ready",
      };
    }

    if (AUTH_OUTPUT_PATTERN.test(combined) || result.exitCode !== 0) {
      return {
        message: "Codex authentication is not ready. Run `codex login` or `printenv OPENAI_API_KEY | codex login --with-api-key`.",
        status: "missing",
      };
    }

    return {
      message: line,
      status: "unknown",
    };
  },
  parseResponse(options: { readonly responseText?: string; readonly stderr: string; readonly stdout: string }): ProviderParsedResponse {
    return {
      format: options.responseText && options.responseText.trim().length > 0 ? "codex-last-message" : "stdout",
      rawText: options.responseText?.trim() || options.stdout.trim(),
    };
  },
  parseVersion(result: ProviderCommandResult): string | null {
    const lines = joinOutput(result)
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const versionLine = lines.find((line) => /\bcodex(?:-cli)?\b/iu.test(line)) ?? lines[0];
    return versionLine ?? null;
  },
};

function classifyFailure(
  providerLabel: string,
  options: ProviderFailureClassificationOptions,
): ProviderFailureClassification {
  if (options.parseError) {
    return {
      code: "parse",
      message: `${providerLabel} returned a response that did not match the expected structured output: ${options.parseError}`,
      retryable: true,
    };
  }

  const combined = joinOutput(options);
  const line = firstMeaningfulLine(combined) ?? `${providerLabel} execution failed.`;

  if (AUTH_OUTPUT_PATTERN.test(combined)) {
    return {
      code: "auth",
      message: `${providerLabel} execution failed because authentication is not ready.`,
      retryable: false,
    };
  }

  if (MODEL_OUTPUT_PATTERN.test(combined)) {
    return {
      code: "model",
      message: `${providerLabel} rejected the requested model.`,
      retryable: false,
    };
  }

  if (TRANSIENT_OUTPUT_PATTERN.test(combined)) {
    return {
      code: "transient",
      message: `${providerLabel} reported a transient execution failure: ${line}`,
      retryable: true,
    };
  }

  return {
    code: "execution",
    message: `${providerLabel} execution failed: ${line}`,
    retryable: false,
  };
}

function firstMeaningfulLine(value: string): string | null {
  const line = value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return line ?? null;
}

function joinOutput(result: Pick<ProviderCommandResult, "stderr" | "stdout">): string {
  return [result.stdout, result.stderr]
    .filter((value) => value.trim().length > 0)
    .join("\n")
    .trim();
}

function shouldPassExplicitModel(model: string): boolean {
  return !model.endsWith("-default") && model !== "default";
}
