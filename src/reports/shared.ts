import { Severity } from "../contracts/finding";

export interface ReportFindingLike {
  readonly auditId?: string | undefined;
  readonly findingId: string;
  readonly impact?: string | undefined;
  readonly locations: readonly string[];
  readonly rootCause?: string | undefined;
  readonly scanId?: string | undefined;
  readonly severity: Severity;
  readonly summary: string;
  readonly title: string;
  readonly whatGoesWrong?: string | undefined;
}

export interface ReportTriageLike {
  readonly disposition?: string | undefined;
  readonly rationale: string;
}

export interface ReportValidationLike {
  readonly outcome: string;
  readonly rationale: string;
}

export interface ReportBundleLike {
  readonly finding: ReportFindingLike;
  readonly triage: ReportTriageLike;
  readonly validation: ReportValidationLike;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

export function formatInlineText(value: string): string {
  return normalizeNewlines(value).replace(/\s*\n\s*/gu, " ").trim();
}

export function formatFindingLocations(finding: Pick<ReportFindingLike, "locations">): string {
  if (finding.locations.length === 0) {
    return "None recorded";
  }

  return finding.locations.map(formatInlineText).join(", ");
}

export function formatFindingReference(finding: Pick<ReportFindingLike, "findingId" | "scanId">): string {
  return finding.scanId ? `${finding.scanId}/${finding.findingId}` : finding.findingId;
}

export function sortValidatedBundles<T extends ReportBundleLike>(bundles: readonly T[]): T[] {
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
