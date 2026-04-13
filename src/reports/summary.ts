import { type ReportBundleLike, formatFindingLocations, formatFindingReference, formatInlineText, sortValidatedBundles } from "./shared";

export function buildSummaryReport(bundles: readonly ReportBundleLike[]): string {
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
    lines.push(
      `- [${bundle.finding.severity}] ${formatInlineText(bundle.finding.title)} (\`${formatFindingReference(bundle.finding)}\`) at \`${formatFindingLocations(bundle.finding)}\``,
    );
  }

  return `${lines.join("\n")}\n`;
}

function countBySeverity(bundles: readonly ReportBundleLike[]) {
  return bundles.reduce<Record<"critical" | "high" | "low" | "medium", number>>(
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
