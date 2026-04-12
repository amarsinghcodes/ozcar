import { Severity } from "../contracts/finding";
import { FindingDecisionBundle } from "../contracts/validation";

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function buildConfirmedFindingsReport(bundles: readonly FindingDecisionBundle[]): string {
  const validated = sortValidatedBundles(bundles);
  const lines = [
    "# Confirmed Findings",
    "",
    "Generated from validated finding artifacts only.",
    "",
  ];

  if (validated.length === 0) {
    lines.push("No validated findings.");
    return `${lines.join("\n")}\n`;
  }

  for (const bundle of validated) {
    const locations =
      bundle.finding.locations.length > 0
        ? bundle.finding.locations.map(formatInlineText).join(", ")
        : "None recorded";

    lines.push(`## [${bundle.finding.severity}] ${formatInlineText(bundle.finding.title)}`);
    lines.push("");
    lines.push(`- Finding ID: \`${bundle.finding.findingId}\``);
    lines.push(`- Scan ID: \`${bundle.finding.scanId}\``);
    lines.push(`- Locations: \`${locations}\``);
    lines.push("");
    appendQuotedTextSection(lines, "Summary", bundle.finding.summary);
    appendQuotedTextSection(lines, "Triage Rationale", bundle.triage.rationale);
    appendQuotedTextSection(lines, "Validation Rationale", bundle.validation.rationale);
  }

  return `${lines.join("\n")}\n`;
}

function appendQuotedTextSection(lines: string[], label: string, value: string): void {
  lines.push(`### ${label}`);

  for (const line of normalizeNewlines(value).split("\n")) {
    lines.push(line.length > 0 ? `> ${line}` : ">");
  }

  lines.push("");
}

function formatInlineText(value: string): string {
  return normalizeNewlines(value).replace(/\s*\n\s*/gu, " ").trim();
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
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
