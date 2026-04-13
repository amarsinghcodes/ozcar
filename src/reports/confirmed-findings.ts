import { type ReportBundleLike, formatFindingLocations, formatInlineText, normalizeNewlines, sortValidatedBundles } from "./shared";

export function buildConfirmedFindingsReport(bundles: readonly ReportBundleLike[]): string {
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
    lines.push(`## [${bundle.finding.severity}] ${formatInlineText(bundle.finding.title)}`);
    lines.push("");
    if (bundle.finding.auditId) {
      lines.push(`- Audit ID: \`${bundle.finding.auditId}\``);
    }
    lines.push(`- Finding ID: \`${bundle.finding.findingId}\``);
    if (bundle.finding.scanId) {
      lines.push(`- Scan ID: \`${bundle.finding.scanId}\``);
    }
    lines.push(`- Locations: \`${formatFindingLocations(bundle.finding)}\``);
    lines.push("");
    appendQuotedTextSection(lines, "Summary", bundle.finding.summary);
    if (bundle.finding.rootCause) {
      appendQuotedTextSection(lines, "Root Cause", bundle.finding.rootCause);
    }
    if (bundle.finding.whatGoesWrong) {
      appendQuotedTextSection(lines, "What Goes Wrong", bundle.finding.whatGoesWrong);
    }
    if (bundle.finding.impact) {
      appendQuotedTextSection(lines, "Impact", bundle.finding.impact);
    }
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
