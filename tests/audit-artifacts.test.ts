import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectAuditArtifactFreshness, materializeAuditArtifacts, rebuildAuditArtifacts } from "../src/artifacts/rebuild";
import { getAuditArtifactPaths, readAuditArtifactSnapshot } from "../src/artifacts/store";
import type { AuditArtifactSnapshot } from "../src/contracts/export";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      fs.rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("Phase 4 audit artifacts and Phase 6 export surface", () => {
  it("materializes audit contracts and rebuilds reports plus export from stored JSON only", async () => {
    const workspaceRoot = await createWorkspace();
    const snapshot = createAuditSnapshot(["needs-follow-up", "unchecked-accounting", "reentrant-withdraw"]);

    const result = await materializeAuditArtifacts({
      snapshot,
      workspaceRoot,
    });
    const paths = getAuditArtifactPaths(workspaceRoot, snapshot.audit.auditId);
    const originalSummary = await fs.readFile(paths.summaryFile, "utf8");
    const originalConfirmedFindings = await fs.readFile(paths.confirmedFindingsFile, "utf8");
    const originalExport = await fs.readFile(paths.findingsExportFile, "utf8");
    const restoredSnapshot = await readAuditArtifactSnapshot({
      auditId: snapshot.audit.auditId,
      workspaceRoot,
    });

    expect(result.validatedFindings).toBe(2);
    expect(restoredSnapshot).toEqual(sortSnapshotFindingsById(snapshot));
    expect(originalSummary).toContain("Reentrant withdraw path");
    expect(originalSummary).toContain("Unchecked accounting delta");
    expect(originalSummary).not.toContain("Needs follow-up");
    expect(originalConfirmedFindings).toContain("Root Cause");
    expect(originalConfirmedFindings).toContain("Validation Rationale");

    const exportPayload = JSON.parse(originalExport) as {
      findings: Array<{ findingId: string }>;
      generatedAt: string;
    };
    expect(exportPayload.generatedAt).toBe("2026-04-12T20:08:00.000Z");
    expect(exportPayload.findings.map((finding) => finding.findingId)).toEqual([
      "reentrant-withdraw",
      "unchecked-accounting",
    ]);

    await fs.writeFile(paths.summaryFile, "# stale summary\n", "utf8");
    await fs.writeFile(paths.confirmedFindingsFile, "# stale confirmed findings\n", "utf8");
    await fs.writeFile(paths.findingsExportFile, "{\n", "utf8");

    const rebuilt = await rebuildAuditArtifacts({
      auditId: snapshot.audit.auditId,
      workspaceRoot,
    });

    expect(rebuilt.validatedFindings).toBe(2);
    expect(await fs.readFile(paths.summaryFile, "utf8")).toBe(originalSummary);
    expect(await fs.readFile(paths.confirmedFindingsFile, "utf8")).toBe(originalConfirmedFindings);
    expect(await fs.readFile(paths.findingsExportFile, "utf8")).toBe(originalExport);
  });

  it("detects stale report and export artifacts against the stored JSON contracts", async () => {
    const workspaceRoot = await createWorkspace();
    const snapshot = createAuditSnapshot(["unchecked-accounting", "reentrant-withdraw", "needs-follow-up"]);
    const paths = getAuditArtifactPaths(workspaceRoot, snapshot.audit.auditId);

    await materializeAuditArtifacts({
      snapshot,
      workspaceRoot,
    });

    await fs.writeFile(paths.summaryFile, "# stale summary\n", "utf8");
    await fs.writeFile(paths.confirmedFindingsFile, "# stale confirmed\n", "utf8");
    await fs.writeFile(paths.findingsExportFile, "{\"findings\":[]}\n", "utf8");

    const freshness = await inspectAuditArtifactFreshness({
      auditId: snapshot.audit.auditId,
      workspaceRoot,
    });

    expect(freshness.summaryFresh).toBe(false);
    expect(freshness.confirmedFindingsFresh).toBe(false);
    expect(freshness.findingsExportFresh).toBe(false);
    expect(freshness.issues.map((issue) => issue.code)).toEqual([
      "report.summary.stale",
      "report.confirmed.stale",
      "export.findings.stale",
    ]);
  });

  it("fails closed when embedded audit ids drift from the requested audit root", async () => {
    const workspaceRoot = await createWorkspace();
    const snapshot = createAuditSnapshot(["unchecked-accounting", "reentrant-withdraw", "needs-follow-up"]);
    const paths = getAuditArtifactPaths(workspaceRoot, snapshot.audit.auditId);

    await materializeAuditArtifacts({
      snapshot,
      workspaceRoot,
    });
    await rewriteStoredAuditIds(paths, "authorization-audit");

    await expect(
      rebuildAuditArtifacts({
        auditId: snapshot.audit.auditId,
        workspaceRoot,
      }),
    ).rejects.toThrow(/expected auditId payments-vault but found authorization-audit/);
    await expect(
      fs.access(path.join(workspaceRoot, ".ai-auditor", "audits", "authorization-audit")),
    ).rejects.toBeDefined();
  });

  it("reports finding-directory identity drift during freshness inspection", async () => {
    const workspaceRoot = await createWorkspace();
    const snapshot = createAuditSnapshot(["unchecked-accounting", "reentrant-withdraw", "needs-follow-up"]);
    const paths = getAuditArtifactPaths(workspaceRoot, snapshot.audit.auditId);

    await materializeAuditArtifacts({
      snapshot,
      workspaceRoot,
    });

    await fs.rename(
      path.join(paths.findingsRoot, "reentrant-withdraw"),
      path.join(paths.findingsRoot, "mismatched-directory-name"),
    );

    const freshness = await inspectAuditArtifactFreshness({
      auditId: snapshot.audit.auditId,
      workspaceRoot,
    });

    expect(freshness.summaryFresh).toBeNull();
    expect(freshness.confirmedFindingsFresh).toBeNull();
    expect(freshness.findingsExportFresh).toBeNull();
    expect(freshness.issues).toEqual([
      expect.objectContaining({
        code: "store.identity",
      }),
    ]);
  });

  it("canonicalizes equivalent timestamp encodings to stable stored and export bytes", async () => {
    const firstWorkspace = await createWorkspace();
    const secondWorkspace = await createWorkspace();
    const canonicalSnapshot = createAuditSnapshot(["needs-follow-up", "unchecked-accounting", "reentrant-withdraw"]);
    const offsetSnapshot = withEquivalentOffsetTimestamps(
      createAuditSnapshot(["needs-follow-up", "unchecked-accounting", "reentrant-withdraw"]),
    );

    await materializeAuditArtifacts({
      snapshot: canonicalSnapshot,
      workspaceRoot: firstWorkspace,
    });
    await materializeAuditArtifacts({
      snapshot: offsetSnapshot,
      workspaceRoot: secondWorkspace,
    });

    const canonicalPaths = getAuditArtifactPaths(firstWorkspace, "payments-vault");
    const offsetPaths = getAuditArtifactPaths(secondWorkspace, "payments-vault");

    expect(await fs.readFile(canonicalPaths.auditFile, "utf8")).toBe(await fs.readFile(offsetPaths.auditFile, "utf8"));
    expect(await fs.readFile(canonicalPaths.findingsExportFile, "utf8")).toBe(
      await fs.readFile(offsetPaths.findingsExportFile, "utf8"),
    );
    expect(await fs.readFile(offsetPaths.findingsExportFile, "utf8")).toContain("\"generatedAt\": \"2026-04-12T20:08:00.000Z\"");
  });

  it("pins the stable findings export bytes for downstream Phase 6 consumers", async () => {
    const workspaceRoot = await createWorkspace();
    const snapshot = createAuditSnapshot(["needs-follow-up", "unchecked-accounting", "reentrant-withdraw"]);

    await materializeAuditArtifacts({
      snapshot,
      workspaceRoot,
    });

    const paths = getAuditArtifactPaths(workspaceRoot, snapshot.audit.auditId);
    const expectedFixture = await fs.readFile(new URL("./fixtures/phase6/findings-export.expected.json", import.meta.url), "utf8");

    expect(await fs.readFile(paths.findingsExportFile, "utf8")).toBe(expectedFixture);
  });

  it("falls back to audit.createdAt when no validated findings are exported", async () => {
    const workspaceRoot = await createWorkspace();
    const snapshot = withNoValidatedFindings(
      createAuditSnapshot(["needs-follow-up", "unchecked-accounting", "reentrant-withdraw"]),
    );

    const result = await materializeAuditArtifacts({
      snapshot,
      workspaceRoot,
    });
    const paths = getAuditArtifactPaths(workspaceRoot, snapshot.audit.auditId);
    const exportPayload = JSON.parse(await fs.readFile(paths.findingsExportFile, "utf8")) as {
      findings: Array<unknown>;
      generatedAt: string;
    };

    expect(result.validatedFindings).toBe(0);
    expect(exportPayload.findings).toEqual([]);
    expect(exportPayload.generatedAt).toBe(snapshot.audit.createdAt);
  });

  it("keeps findings export bytes stable when only non-validated bundle timestamps change", async () => {
    const firstWorkspace = await createWorkspace();
    const secondWorkspace = await createWorkspace();
    const canonicalSnapshot = createAuditSnapshot(["needs-follow-up", "unchecked-accounting", "reentrant-withdraw"]);
    const churnedSnapshot = withNonValidatedTimestampChurn(
      createAuditSnapshot(["needs-follow-up", "unchecked-accounting", "reentrant-withdraw"]),
    );

    await materializeAuditArtifacts({
      snapshot: canonicalSnapshot,
      workspaceRoot: firstWorkspace,
    });
    await materializeAuditArtifacts({
      snapshot: churnedSnapshot,
      workspaceRoot: secondWorkspace,
    });

    const canonicalPaths = getAuditArtifactPaths(firstWorkspace, "payments-vault");
    const churnedPaths = getAuditArtifactPaths(secondWorkspace, "payments-vault");

    expect(await fs.readFile(canonicalPaths.findingsExportFile, "utf8")).toBe(
      await fs.readFile(churnedPaths.findingsExportFile, "utf8"),
    );
    expect(await fs.readFile(churnedPaths.findingsExportFile, "utf8")).toContain("\"generatedAt\": \"2026-04-12T20:08:00.000Z\"");
  });

  it("reports missing report and export artifacts as freshness issues", async () => {
    const workspaceRoot = await createWorkspace();
    const snapshot = createAuditSnapshot(["unchecked-accounting", "reentrant-withdraw", "needs-follow-up"]);
    const paths = getAuditArtifactPaths(workspaceRoot, snapshot.audit.auditId);

    await materializeAuditArtifacts({
      snapshot,
      workspaceRoot,
    });

    await fs.rm(paths.summaryFile, { force: true });
    await fs.rm(paths.confirmedFindingsFile, { force: true });
    await fs.rm(paths.findingsExportFile, { force: true });

    const freshness = await inspectAuditArtifactFreshness({
      auditId: snapshot.audit.auditId,
      workspaceRoot,
    });

    expect(freshness.summaryFresh).toBeNull();
    expect(freshness.confirmedFindingsFresh).toBeNull();
    expect(freshness.findingsExportFresh).toBeNull();
    expect(freshness.issues.map((issue) => issue.code)).toEqual([
      "report.summary.missing",
      "report.confirmed.missing",
      "export.findings.missing",
    ]);
  });

  it("keeps findings export and rebuilt markdown stable when input finding order changes", async () => {
    const firstWorkspace = await createWorkspace();
    const secondWorkspace = await createWorkspace();

    await materializeAuditArtifacts({
      snapshot: createAuditSnapshot(["needs-follow-up", "unchecked-accounting", "reentrant-withdraw"]),
      workspaceRoot: firstWorkspace,
    });
    await materializeAuditArtifacts({
      snapshot: createAuditSnapshot(["reentrant-withdraw", "needs-follow-up", "unchecked-accounting"]),
      workspaceRoot: secondWorkspace,
    });

    const firstPaths = getAuditArtifactPaths(firstWorkspace, "payments-vault");
    const secondPaths = getAuditArtifactPaths(secondWorkspace, "payments-vault");

    expect(await fs.readFile(firstPaths.summaryFile, "utf8")).toBe(await fs.readFile(secondPaths.summaryFile, "utf8"));
    expect(await fs.readFile(firstPaths.confirmedFindingsFile, "utf8")).toBe(
      await fs.readFile(secondPaths.confirmedFindingsFile, "utf8"),
    );
    expect(await fs.readFile(firstPaths.findingsExportFile, "utf8")).toBe(
      await fs.readFile(secondPaths.findingsExportFile, "utf8"),
    );
  });
});

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ozcar-audit-artifacts-"));
  tempRoots.push(workspaceRoot);
  return workspaceRoot;
}

function createAuditSnapshot(order: readonly string[]): AuditArtifactSnapshot {
  const findingById = new Map(
    [
      createFindingBundle({
        findingId: "unchecked-accounting",
        title: "Unchecked accounting delta",
        severity: "high",
        summary: "Accounting updates can drift before the vault settles balances.",
        locations: ["src/Vault.sol:42", "src/Vault.sol:87"],
        rootCause: "The accounting accumulator updates before external transfers succeed.",
        whatGoesWrong: "A reverting downstream path leaves the vault in an overstated state.",
        impact: "Users can observe incorrect share pricing after failed withdrawals.",
        triageDisposition: "confirmed",
        triageRationale: "The path is reachable and the failed transfer leaves state behind.",
        validationOutcome: "validated",
        validationRationale: "Manual review confirmed the state update happens before the external call.",
        timestamps: {
          createdAt: "2026-04-12T20:01:00.000Z",
          updatedAt: "2026-04-12T20:02:00.000Z",
          triagedAt: "2026-04-12T20:04:00.000Z",
          validatedAt: "2026-04-12T20:06:00.000Z",
        },
      }),
      createFindingBundle({
        findingId: "reentrant-withdraw",
        title: "Reentrant withdraw path",
        severity: "critical",
        summary: "The withdraw callback can reenter before the nonce is burned.",
        locations: ["src/WithdrawRouter.sol:18"],
        rootCause: "Nonce invalidation happens after the callback into user-controlled code.",
        whatGoesWrong: "A malicious receiver can execute a second withdraw with the same authorization.",
        impact: "Funds can be withdrawn twice from the same signed authorization.",
        triageDisposition: "confirmed",
        triageRationale: "The callback is attacker-controlled and no guard closes the nonce first.",
        validationOutcome: "validated",
        validationRationale: "Trace review shows nonce invalidation only after external control returns.",
        timestamps: {
          createdAt: "2026-04-12T20:00:00.000Z",
          updatedAt: "2026-04-12T20:01:00.000Z",
          triagedAt: "2026-04-12T20:05:00.000Z",
          validatedAt: "2026-04-12T20:08:00.000Z",
        },
      }),
      createFindingBundle({
        findingId: "needs-follow-up",
        title: "Needs follow-up",
        severity: "medium",
        summary: "An edge-case rounding path still needs reproduction.",
        locations: ["src/Accounting.sol:133"],
        triageDisposition: "pending",
        triageRationale: "The suspected rounding loss needs a concrete counterexample.",
        validationOutcome: "pending",
        validationRationale: "Validation held the issue pending until the edge-case input is reproduced.",
        timestamps: {
          createdAt: "2026-04-12T20:01:30.000Z",
          updatedAt: "2026-04-12T20:02:30.000Z",
          triagedAt: "2026-04-12T20:04:30.000Z",
          validatedAt: "2026-04-12T20:07:00.000Z",
        },
      }),
    ].map((bundle) => [bundle.finding.findingId, bundle] as const),
  );

  return {
    audit: {
      schemaVersion: 1,
      auditId: "payments-vault",
      focus: "Investigate payments vault invariants",
      status: "completed",
      branchKind: "root",
      source: "session:materialize",
      createdAt: "2026-04-12T20:00:00.000Z",
      updatedAt: "2026-04-12T20:08:00.000Z",
    },
    scope: {
      schemaVersion: 1,
      auditId: "payments-vault",
      focus: "Investigate payments vault invariants",
      targets: ["src/Vault.sol", "src/WithdrawRouter.sol"],
      objectives: ["Confirm balance invariants", "Confirm withdraw authorization safety"],
      notes: ["Rebuilds should ignore pending findings in human-facing reports."],
      updatedAt: "2026-04-12T20:03:00.000Z",
    },
    findings: order.map((findingId) => {
      const bundle = findingById.get(findingId);
      if (!bundle) {
        throw new Error(`Missing fixture finding ${findingId}`);
      }

      return bundle;
    }),
  };
}

function sortSnapshotFindingsById(snapshot: AuditArtifactSnapshot): AuditArtifactSnapshot {
  return {
    ...snapshot,
    findings: [...snapshot.findings].sort((left, right) =>
      left.finding.findingId.localeCompare(right.finding.findingId),
    ),
  };
}

function withEquivalentOffsetTimestamps(snapshot: AuditArtifactSnapshot): AuditArtifactSnapshot {
  return {
    ...snapshot,
    audit: {
      ...snapshot.audit,
      createdAt: "2026-04-12T16:00:00-04:00",
      updatedAt: "2026-04-12T16:08:00-04:00",
    },
    scope: {
      ...snapshot.scope,
      updatedAt: "2026-04-12T16:03:00-04:00",
    },
    findings: snapshot.findings.map((bundle) => ({
      finding: {
        ...bundle.finding,
        createdAt: toOffsetTimestamp(bundle.finding.createdAt),
        updatedAt: toOffsetTimestamp(bundle.finding.updatedAt),
      },
      triage: {
        ...bundle.triage,
        triagedAt: toOffsetTimestamp(bundle.triage.triagedAt),
      },
      validation: {
        ...bundle.validation,
        validatedAt: toOffsetTimestamp(bundle.validation.validatedAt),
      },
    })),
  };
}

function withNonValidatedTimestampChurn(snapshot: AuditArtifactSnapshot): AuditArtifactSnapshot {
  return {
    ...snapshot,
    findings: snapshot.findings.map((bundle) =>
      bundle.validation.outcome === "validated"
        ? bundle
        : {
            finding: {
              ...bundle.finding,
              createdAt: "2026-04-12T20:05:30.000Z",
              updatedAt: "2026-04-12T20:06:30.000Z",
            },
            triage: {
              ...bundle.triage,
              triagedAt: "2026-04-12T20:07:30.000Z",
            },
            validation: {
              ...bundle.validation,
              validatedAt: "2026-04-12T20:09:00.000Z",
            },
          },
    ),
  };
}

function withNoValidatedFindings(snapshot: AuditArtifactSnapshot): AuditArtifactSnapshot {
  return {
    ...snapshot,
    findings: snapshot.findings.map((bundle) =>
      bundle.validation.outcome === "validated"
        ? {
            finding: {
              ...bundle.finding,
            },
            triage: {
              ...bundle.triage,
            },
            validation: {
              ...bundle.validation,
              outcome: "rejected",
            },
          }
        : bundle,
    ),
  };
}

function toOffsetTimestamp(value: string): string {
  return value.replace("T20:", "T16:").replace(".000Z", "-04:00");
}

async function rewriteStoredAuditIds(paths: ReturnType<typeof getAuditArtifactPaths>, auditId: string): Promise<void> {
  await rewriteJsonFile(paths.auditFile, (payload) => ({
    ...payload,
    auditId,
  }));
  await rewriteJsonFile(paths.scopeFile, (payload) => ({
    ...payload,
    auditId,
  }));

  const findingIds = await fs.readdir(paths.findingsRoot);
  await Promise.all(
    findingIds.map(async (findingId) => {
      const findingRoot = path.join(paths.findingsRoot, findingId);
      await rewriteJsonFile(path.join(findingRoot, "finding.json"), (payload) => ({
        ...payload,
        auditId,
      }));
      await rewriteJsonFile(path.join(findingRoot, "triage.json"), (payload) => ({
        ...payload,
        auditId,
      }));
      await rewriteJsonFile(path.join(findingRoot, "validation.json"), (payload) => ({
        ...payload,
        auditId,
      }));
    }),
  );
}

async function rewriteJsonFile(
  filePath: string,
  update: (payload: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  await fs.writeFile(filePath, `${JSON.stringify(update(payload), null, 2)}\n`, "utf8");
}

function createFindingBundle(options: {
  findingId: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  summary: string;
  locations: string[];
  rootCause?: string;
  whatGoesWrong?: string;
  impact?: string;
  triageDisposition: "confirmed" | "pending" | "rejected";
  triageRationale: string;
  validationOutcome: "pending" | "rejected" | "validated";
  validationRationale: string;
  timestamps: {
    createdAt: string;
    updatedAt: string;
    triagedAt: string;
    validatedAt: string;
  };
}) {
  return {
    finding: {
      schemaVersion: 1,
      auditId: "payments-vault",
      findingId: options.findingId,
      title: options.title,
      severity: options.severity,
      summary: options.summary,
      locations: options.locations,
      ...(options.rootCause ? { rootCause: options.rootCause } : {}),
      ...(options.whatGoesWrong ? { whatGoesWrong: options.whatGoesWrong } : {}),
      ...(options.impact ? { impact: options.impact } : {}),
      source: "validated-snapshot",
      createdAt: options.timestamps.createdAt,
      updatedAt: options.timestamps.updatedAt,
    },
    triage: {
      schemaVersion: 1,
      auditId: "payments-vault",
      findingId: options.findingId,
      disposition: options.triageDisposition,
      rationale: options.triageRationale,
      source: "validated-snapshot",
      triagedAt: options.timestamps.triagedAt,
    },
    validation: {
      schemaVersion: 1,
      auditId: "payments-vault",
      findingId: options.findingId,
      outcome: options.validationOutcome,
      validator: "phase4-test",
      rationale: options.validationRationale,
      validatedAt: options.timestamps.validatedAt,
    },
  };
}
