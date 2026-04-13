import { promises as fs } from "node:fs";

import { AuditIdSchema } from "../contracts/audit";
import { AuditArtifactSnapshot, FindingsExportDocument } from "../contracts/export";
import { buildConfirmedFindingsReport } from "../reports/confirmed-findings";
import { buildFindingsExportDocument } from "../reports/export-findings";
import { buildSummaryReport } from "../reports/summary";
import {
  AuditArtifactStoreError,
  getAuditArtifactPaths,
  readAuditArtifactSnapshot,
  renderStableJson,
  writeAuditSnapshotContracts,
} from "./store";

export interface AuditArtifactIssue {
  readonly artifactPath: string;
  readonly code: string;
  readonly message: string;
}

export interface AuditArtifactFreshnessReport {
  readonly auditId: string;
  readonly auditRoot: string;
  readonly confirmedFindingsFresh: boolean | null;
  readonly findingsExportFresh: boolean | null;
  readonly issues: AuditArtifactIssue[];
  readonly summaryFresh: boolean | null;
}

export interface RebuildAuditArtifactsResult {
  readonly auditId: string;
  readonly auditRoot: string;
  readonly confirmedFindingsFile: string;
  readonly findingsExport: FindingsExportDocument;
  readonly findingsExportFile: string;
  readonly summaryFile: string;
  readonly validatedFindings: number;
}

export async function materializeAuditArtifacts(options: {
  readonly snapshot: AuditArtifactSnapshot;
  readonly workspaceRoot: string;
}): Promise<RebuildAuditArtifactsResult> {
  const snapshot = options.snapshot;
  await writeAuditSnapshotContracts({
    snapshot,
    workspaceRoot: options.workspaceRoot,
  });

  return rebuildAuditArtifacts({
    auditId: snapshot.audit.auditId,
    workspaceRoot: options.workspaceRoot,
  });
}

export async function rebuildAuditArtifacts(options: {
  readonly auditId: string;
  readonly workspaceRoot: string;
}): Promise<RebuildAuditArtifactsResult> {
  const requestedAuditId = AuditIdSchema.parse(options.auditId);
  const snapshot = await readAuditArtifactSnapshot(options);
  const paths = getAuditArtifactPaths(options.workspaceRoot, requestedAuditId);
  const findingsExport = buildFindingsExportDocument(snapshot);

  await fs.mkdir(paths.exportsRoot, { recursive: true });
  await fs.writeFile(paths.summaryFile, buildSummaryReport(snapshot.findings), "utf8");
  await fs.writeFile(paths.confirmedFindingsFile, buildConfirmedFindingsReport(snapshot.findings), "utf8");
  await fs.writeFile(paths.findingsExportFile, renderStableJson(findingsExport), "utf8");

  return {
    auditId: requestedAuditId,
    auditRoot: paths.auditRoot,
    confirmedFindingsFile: paths.confirmedFindingsFile,
    findingsExport,
    findingsExportFile: paths.findingsExportFile,
    summaryFile: paths.summaryFile,
    validatedFindings: findingsExport.findings.length,
  };
}

export async function inspectAuditArtifactFreshness(options: {
  readonly auditId: string;
  readonly workspaceRoot: string;
}): Promise<AuditArtifactFreshnessReport> {
  const requestedAuditId = AuditIdSchema.parse(options.auditId);
  const paths = getAuditArtifactPaths(options.workspaceRoot, requestedAuditId);
  const issues: AuditArtifactIssue[] = [];
  let snapshot: AuditArtifactSnapshot;

  try {
    snapshot = await readAuditArtifactSnapshot(options);
  } catch (error: unknown) {
    if (error instanceof AuditArtifactStoreError) {
      issues.push({
        artifactPath: error.artifactPath,
        code: error.code,
        message: error.message,
      });

      return {
        auditId: requestedAuditId,
        auditRoot: paths.auditRoot,
        confirmedFindingsFresh: null,
        findingsExportFresh: null,
        issues,
        summaryFresh: null,
      };
    }

    throw error;
  }

  const expectedSummary = buildSummaryReport(snapshot.findings);
  const expectedConfirmedFindings = buildConfirmedFindingsReport(snapshot.findings);
  const expectedExport = renderStableJson(buildFindingsExportDocument(snapshot));

  const summaryFresh = await compareArtifact(paths.summaryFile, expectedSummary, issues, {
    missingCode: "report.summary.missing",
    staleCode: "report.summary.stale",
  });
  const confirmedFindingsFresh = await compareArtifact(paths.confirmedFindingsFile, expectedConfirmedFindings, issues, {
    missingCode: "report.confirmed.missing",
    staleCode: "report.confirmed.stale",
  });
  const findingsExportFresh = await compareArtifact(paths.findingsExportFile, expectedExport, issues, {
    missingCode: "export.findings.missing",
    staleCode: "export.findings.stale",
  });

  return {
    auditId: requestedAuditId,
    auditRoot: paths.auditRoot,
    confirmedFindingsFresh,
    findingsExportFresh,
    issues,
    summaryFresh,
  };
}

async function compareArtifact(
  filePath: string,
  expected: string,
  issues: AuditArtifactIssue[],
  codes: {
    missingCode: string;
    staleCode: string;
  },
): Promise<boolean | null> {
  let actual: string;

  try {
    actual = await fs.readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isErrnoException(error, "ENOENT")) {
      issues.push({
        artifactPath: filePath,
        code: codes.missingCode,
        message: `Expected artifact ${filePath} is missing.`,
      });
      return null;
    }

    throw error;
  }

  const fresh = actual === expected;
  if (!fresh) {
    issues.push({
      artifactPath: filePath,
      code: codes.staleCode,
      message: `${filePath} does not match a mechanical rebuild from stored JSON contracts.`,
    });
  }

  return fresh;
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
