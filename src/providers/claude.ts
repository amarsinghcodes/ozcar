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
  /\b(429|500|502|503|504|connection reset|connection refused|connection timed out|deadline exceeded|etimedout|overloaded|rate limit|service unavailable|temporarily unavailable|timeout|timed out|try again later)\b/iu;
const AUTH_OUTPUT_PATTERN =
  /\b(auth(?:entication)? failed|invalid api key|login required|not authenticated|not logged in|permission denied)\b/iu;
const MODEL_OUTPUT_PATTERN = /\b(invalid model|model .* not found)\b/iu;

export const claudeProvider: ProviderDefinition = {
  name: "claude",
  command: "claude",
  capabilities: {
    modelOverride: true,
    plan: true,
    scan: true,
  },
  defaultModels: {
    plan: "claude-default",
    scan: "claude-default",
  },
  detectionCommands: ["claude"],
  guidance: {
    auth: "Run `claude auth login` and retry the live provider run.",
    install: "Install Claude Code and ensure `claude` is on PATH before retrying the live provider run.",
  },
  retryPolicy: {
    maxAttempts: 2,
    retryDelayMs: 250,
    retryOnParseFailure: true,
  },
  authCommandArgs: ["auth", "status"],
  versionCommandArgs: ["--version"],
  buildInvocation(options: ProviderInvocationBuildOptions) {
    const args = [
      "-p",
      "--permission-mode",
      "bypassPermissions",
      "--no-session-persistence",
      "--output-format",
      "json",
      "--json-schema",
      options.schemaText,
    ];

    if (shouldPassExplicitModel(options.model)) {
      args.push("--model", options.model);
    }

    args.push(options.prompt);

    return {
      args,
      command: "claude",
      cwd: options.cwd,
    };
  },
  classifyFailure(options: ProviderFailureClassificationOptions): ProviderFailureClassification {
    return classifyFailure("Claude Code", options);
  },
  parseAuthResult(result: ProviderCommandResult): ProviderAuthResult {
    const combined = joinOutput(result);

    try {
      const parsed = JSON.parse(result.stdout);
      if (typeof parsed === "object" && parsed !== null && "loggedIn" in parsed) {
        const loggedIn = Boolean((parsed as { loggedIn?: unknown }).loggedIn);
        return {
          message: loggedIn
            ? "Claude Code authentication is ready."
            : "Claude Code authentication is not ready. Run `claude auth login`.",
          status: loggedIn ? "ready" : "missing",
        };
      }
    } catch {
      // Fall back to text heuristics below.
    }

    if (AUTH_OUTPUT_PATTERN.test(combined) || result.exitCode !== 0) {
      return {
        message: "Claude Code authentication is not ready. Run `claude auth login`.",
        status: "missing",
      };
    }

    return {
      message: firstMeaningfulLine(combined) ?? "Claude Code authentication status could not be determined.",
      status: "unknown",
    };
  },
  parseResponse(options: { readonly responseText?: string; readonly stderr: string; readonly stdout: string }): ProviderParsedResponse {
    return {
      format: "json-stdout",
      rawText: options.stdout.trim(),
    };
  },
  parseVersion(result: ProviderCommandResult): string | null {
    const line = firstMeaningfulLine(joinOutput(result));
    return line ?? null;
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
