import { promises as fs } from "node:fs";
import path from "node:path";

import type { ZodIssue, ZodType } from "zod";

import { AuditIdSchema, StoredAuditSchema, StoredAuditScopeSchema } from "../contracts/audit";
import { AuditArtifactSnapshot, AuditArtifactSnapshotSchema } from "../contracts/export";
import { FindingIdSchema, StoredFindingSchema } from "../contracts/finding";
import { StoredTriageSchema } from "../contracts/triage";
import { StoredFindingBundleSchema, StoredValidationSchema } from "../contracts/validation";

export const AUDIT_STORE_ROOT = ".ai-auditor";
export const AUDITS_DIR = "audits";

export interface AuditArtifactPaths {
  readonly storeRoot: string;
  readonly auditsRoot: string;
  readonly auditRoot: string;
  readonly auditFile: string;
  readonly scopeFile: string;
  readonly findingsRoot: string;
  readonly summaryFile: string;
  readonly confirmedFindingsFile: string;
  readonly exportsRoot: string;
  readonly findingsExportFile: string;
}

export class AuditArtifactStoreError extends Error {
  readonly artifactPath: string;
  readonly code: string;

  constructor(code: string, artifactPath: string, message: string) {
    super(message);
    this.name = "AuditArtifactStoreError";
    this.artifactPath = artifactPath;
    this.code = code;
  }
}

export function getAuditArtifactPaths(workspaceRoot: string, auditId: string): AuditArtifactPaths {
  const normalizedAuditId = AuditIdSchema.parse(auditId);
  const storeRoot = path.join(path.resolve(workspaceRoot), AUDIT_STORE_ROOT);
  const auditsRoot = path.join(storeRoot, AUDITS_DIR);
  const auditRoot = path.join(auditsRoot, normalizedAuditId);

  return {
    storeRoot,
    auditsRoot,
    auditRoot,
    auditFile: path.join(auditRoot, "audit.json"),
    scopeFile: path.join(auditRoot, "scope.json"),
    findingsRoot: path.join(auditRoot, "findings"),
    summaryFile: path.join(auditRoot, "summary.md"),
    confirmedFindingsFile: path.join(auditRoot, "confirmed-findings.md"),
    exportsRoot: path.join(auditRoot, "exports"),
    findingsExportFile: path.join(auditRoot, "exports", "findings.json"),
  };
}

export async function writeAuditSnapshotContracts(options: {
  readonly snapshot: AuditArtifactSnapshot;
  readonly workspaceRoot: string;
}): Promise<AuditArtifactPaths> {
  const snapshot = AuditArtifactSnapshotSchema.parse(options.snapshot);
  const paths = getAuditArtifactPaths(options.workspaceRoot, snapshot.audit.auditId);

  await fs.mkdir(paths.findingsRoot, { recursive: true });
  await fs.mkdir(paths.exportsRoot, { recursive: true });

  await fs.writeFile(paths.auditFile, renderStableJson(snapshot.audit), "utf8");
  await fs.writeFile(paths.scopeFile, renderStableJson(snapshot.scope), "utf8");
  await reconcileFindingDirectories(paths.findingsRoot, snapshot.findings.map((bundle) => bundle.finding.findingId));

  for (const bundle of snapshot.findings) {
    const findingRoot = path.join(paths.findingsRoot, bundle.finding.findingId);
    await fs.mkdir(findingRoot, { recursive: true });
    await fs.writeFile(path.join(findingRoot, "finding.json"), renderStableJson(bundle.finding), "utf8");
    await fs.writeFile(path.join(findingRoot, "triage.json"), renderStableJson(bundle.triage), "utf8");
    await fs.writeFile(path.join(findingRoot, "validation.json"), renderStableJson(bundle.validation), "utf8");
  }

  return paths;
}

export async function readAuditArtifactSnapshot(options: {
  readonly auditId: string;
  readonly workspaceRoot: string;
}): Promise<AuditArtifactSnapshot> {
  const requestedAuditId = AuditIdSchema.parse(options.auditId);
  const paths = getAuditArtifactPaths(options.workspaceRoot, requestedAuditId);
  const audit = await readJsonFile(paths.auditFile, StoredAuditSchema, "audit.json");
  assertAuditPathIdentity(paths.auditFile, audit.auditId, requestedAuditId, "audit.json");
  const scope = await readJsonFile(paths.scopeFile, StoredAuditScopeSchema, "scope.json");
  assertAuditPathIdentity(paths.scopeFile, scope.auditId, requestedAuditId, "scope.json");
  const findings = await readStoredFindingBundles(paths.findingsRoot, requestedAuditId);

  const parsed = AuditArtifactSnapshotSchema.safeParse({
    audit,
    scope,
    findings,
  });
  if (!parsed.success) {
    throw new AuditArtifactStoreError(
      "store.contract",
      paths.auditRoot,
      `Invalid audit artifact snapshot under ${paths.auditRoot}: ${formatIssues(parsed.error.issues)}.`,
    );
  }

  return parsed.data;
}

export function renderStableJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

async function readStoredFindingBundles(findingsRoot: string, expectedAuditId: string) {
  const entries = await fs.readdir(findingsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (isErrnoException(error, "ENOENT")) {
      return [];
    }

    throw error;
  });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  return Promise.all(
    directories.map(async (findingId) => {
      const findingRoot = path.join(findingsRoot, findingId);
      try {
        FindingIdSchema.parse(findingId);
      } catch {
        throw new AuditArtifactStoreError(
          "store.identity",
          findingRoot,
          `Finding bundle directory ${findingRoot} does not use a valid finding id.`,
        );
      }

      const parsed = StoredFindingBundleSchema.safeParse({
        finding: await readJsonFile(path.join(findingRoot, "finding.json"), StoredFindingSchema, "finding.json"),
        triage: await readJsonFile(path.join(findingRoot, "triage.json"), StoredTriageSchema, "triage.json"),
        validation: await readJsonFile(
          path.join(findingRoot, "validation.json"),
          StoredValidationSchema,
          "validation.json",
        ),
      });
      if (!parsed.success) {
        throw new AuditArtifactStoreError(
          "store.contract",
          findingRoot,
          `Invalid finding bundle under ${findingRoot}: ${formatIssues(parsed.error.issues)}.`,
        );
      }

      assertAuditPathIdentity(findingRoot, parsed.data.finding.auditId, expectedAuditId, "finding bundle");
      assertFindingDirectoryIdentity(findingRoot, parsed.data.finding.findingId, findingId);

      return parsed.data;
    }),
  );
}

async function reconcileFindingDirectories(findingsRoot: string, findingIds: readonly string[]): Promise<void> {
  const entries = await fs.readdir(findingsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (isErrnoException(error, "ENOENT")) {
      return [];
    }

    throw error;
  });
  const expectedIds = new Set(findingIds);

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !expectedIds.has(entry.name))
      .map((entry) =>
        fs.rm(path.join(findingsRoot, entry.name), {
          force: true,
          recursive: true,
        }),
      ),
  );
}

async function readJsonFile<T>(filePath: string, schema: ZodType<T>, artifactLabel: string): Promise<T> {
  let raw: string;

  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isErrnoException(error, "ENOENT")) {
      throw new AuditArtifactStoreError(
        "store.missing",
        filePath,
        `Missing required ${artifactLabel} at ${filePath}.`,
      );
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new AuditArtifactStoreError(
      "store.contract",
      filePath,
      `Invalid JSON in ${filePath}: ${String(error)}.`,
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AuditArtifactStoreError(
      "store.contract",
      filePath,
      `Invalid contract in ${filePath}: ${formatIssues(result.error.issues)}.`,
    );
  }

  return result.data;
}

function assertAuditPathIdentity(
  artifactPath: string,
  actualAuditId: string,
  expectedAuditId: string,
  artifactLabel: string,
): void {
  if (actualAuditId !== expectedAuditId) {
    throw new AuditArtifactStoreError(
      "store.identity",
      artifactPath,
      `${artifactLabel} at ${artifactPath} expected auditId ${expectedAuditId} but found ${actualAuditId}.`,
    );
  }
}

function assertFindingDirectoryIdentity(
  findingRoot: string,
  actualFindingId: string,
  expectedFindingId: string,
): void {
  if (actualFindingId !== expectedFindingId) {
    throw new AuditArtifactStoreError(
      "store.identity",
      findingRoot,
      `Finding bundle at ${findingRoot} expected findingId ${expectedFindingId} but found ${actualFindingId}.`,
    );
  }
}

function formatIssues(issues: readonly ZodIssue[]): string {
  return issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((result, key) => {
      const nextValue = (value as Record<string, unknown>)[key];
      if (typeof nextValue !== "undefined") {
        result[key] = sortJsonValue(nextValue);
      }
      return result;
    }, {});
}
