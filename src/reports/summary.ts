import { Severity } from "../contracts/finding";
import { FindingDecisionBundle } from "../contracts/validation";

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function buildSummaryReport(bundles: readonly FindingDecisionBundle[]): string {
  const validated = sortValidatedBundles(bundles);
  const counts = countBySeverity(validated);
  const lines = [
    "# Audit Summary",
    "",
    "Generated from validated finding artifacts only.",
    "",
    `Validated findings: ${validated.length}`,
    "",
    "## Severity Breakdown",
    "",
    `- Critical: ${counts.critical}`,
    `- High: ${counts.high}`,
    `- Medium: ${counts.medium}`,
    `- Low: ${counts.low}`,
    "",
    "## Confirmed Findings",
    "",
  ];

  if (validated.length === 0) {
    lines.push("- None.");
    return `${lines.join("\n")}\n`;
  }

  for (const bundle of validated) {
    const location =
      bundle.finding.locations.length > 0
        ? bundle.finding.locations.map(formatInlineText).join(", ")
        : "None recorded";
    lines.push(
      `- [${bundle.finding.severity}] ${formatInlineText(bundle.finding.title)} (\`${bundle.finding.scanId}/${bundle.finding.findingId}\`) at \`${location}\``,
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatInlineText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").replace(/\s*\n\s*/gu, " ").trim();
}

function countBySeverity(bundles: readonly FindingDecisionBundle[]): Record<Severity, number> {
  return bundles.reduce<Record<Severity, number>>(
    (counts, bundle) => {
      counts[bundle.finding.severity] += 1;
      return counts;
    },
    {
      critical: 0,
      high: 0,
      low: 0,
      medium: 0,
    },
  );
}

function sortValidatedBundles(bundles: readonly FindingDecisionBundle[]): FindingDecisionBundle[] {
  return [...bundles]
    .filter((bundle) => bundle.validation.outcome === "validated")
    .sort((left, right) => {
      const severityRank = SEVERITY_ORDER[left.finding.severity] - SEVERITY_ORDER[right.finding.severity];
      if (severityRank !== 0) {
        return severityRank;
      }

      const titleOrder = left.finding.title.localeCompare(right.finding.title);
      if (titleOrder !== 0) {
        return titleOrder;
      }

      return left.finding.findingId.localeCompare(right.finding.findingId);
    });
}
