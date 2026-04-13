# ozcar

`ozcar` is a [Pi](https://github.com/badlogic/pi-mono)-first audit extension package published as `@4meta5/pi-ozcar`.

- Pi owns auth, provider selection, model registry, session storage, and `/tree`.
- `ozcar` owns the audit commands, prompts, skills, JSON contracts, and deterministic exports.

The simplest mental model is: Pi is the engine, and `ozcar` is the audit backpack.

## Quickstart

Install dependencies in a local checkout:

```bash
git clone https://github.com/amarsinghcodes/ozcar.git
cd ozcar
npm install
```

Use the checkout in either of these ways:

1. Start Pi inside `<ozcar-checkout>` and let it auto-discover the local `.pi` surface.
2. From another repo, load the local package directly:

```bash
pi -e <path-to-ozcar>
```

Once the package is published to npm, you can install or try it directly through Pi:

```bash
pi install npm:@4meta5/pi-ozcar
pi -e npm:@4meta5/pi-ozcar
```

Then run:

```text
/ozcar
```

## Core Commands

- `/ozcar`
- `/ozcar-audit-model [balanced|deep|economy]`
- `/ozcar-audit-start <focus>`
- `/ozcar-audit-start <audit-id> :: <focus>`
- `/ozcar-audit <focus>`
- `/ozcar-audit-state`
- `/ozcar-audit-resume`
- `/ozcar-audit-branch <hypothesis|confirmed> <slug> [:: note]`
- `/ozcar-audit-checkpoint <snapshot.json>`
- `/ozcar-audit-export`

## Typical Workflow

```text
/ozcar
/ozcar-audit-start Investigate withdrawal authorization invariants
/ozcar-audit Investigate withdrawal authorization invariants
/ozcar-audit-branch hypothesis replay-path :: suspicious shared nonce path
/tree
/ozcar-audit-resume
/ozcar-audit-checkpoint artifacts/withdraw-audit.snapshot.json
/ozcar-audit-export
```

That flow does three things:

- keeps the live audit inside Pi
- uses `/tree` for branching and recovery
- writes stable repo-owned artifacts only when you checkpoint and export

Humans and agents share the same backend:

- human branch checkpoint: `/ozcar-audit-branch ...`
- agent branch checkpoint: `ozcar_audit_branch`
- human snapshot checkpoint: `/ozcar-audit-checkpoint <snapshot.json>`
- agent snapshot checkpoint: `ozcar_store_audit_snapshot`
- shared export step: `/ozcar-audit-export`

## How The Auditor Works

### Live Runtime

- Pi owns auth, provider selection, model execution, session storage, and `/tree`.
- `ozcar` stores lightweight audit state on the active Pi branch as custom entries plus labels such as `audit:hypothesis:<slug>` and `audit:confirmed:<slug>`.
- `/ozcar-audit-start` initializes the audit root on the current branch, and `/ozcar-audit-state` or `/ozcar-audit-resume` reconstructs that state after `/resume`, `/tree`, or `/reload`.
- `/tree` is the branching and recovery mechanism. If you leave summarization enabled when parking a branch, `ozcar` restores the resulting `audit:abandoned:<slug>` summary state on resume and reload.
- `/ozcar-audit` is the prompt entrypoint; the other slash commands and tools manage audit state, checkpointing, and export.

### Durable Artifacts

- `/ozcar-audit-checkpoint <snapshot.json>` and `ozcar_store_audit_snapshot` validate the same audit snapshot contract and store it on the active Pi branch.
- `/ozcar-audit-export` restores the latest stored snapshot for the current audit, writes canonical JSON under `.ai-auditor/`, and rebuilds Markdown mechanically from that JSON.
- Downstream comparison should read `exports/findings.json`, not Pi transcripts, branch summaries, or session files.

```text
Pi session tree + labels
  -> ozcar audit state on the active branch
  -> validated audit snapshot stored back into Pi
  -> .ai-auditor/audits/<audit-id>/*.json
  -> mechanically rebuilt markdown + exports/findings.json
```

## What Gets Written

After export, `ozcar` writes canonical JSON plus derived Markdown:

```text
.ai-auditor/
  audits/<audit-id>/
    audit.json
    scope.json
    findings/
      <finding-id>/
        finding.json
        triage.json
        validation.json
    summary.md
    confirmed-findings.md
    exports/
      findings.json
```

JSON is canonical. Markdown is rebuilt from stored JSON.

## Comparison Contract

Downstream comparison work should read:

```text
.ai-auditor/audits/<audit-id>/exports/findings.json
```

Rules:

- only validated findings are exported
- JSON is canonical and Markdown is derived
- transcripts, branch summaries, and session files are not part of the contract
- `reportedMetrics`, when present, is authoritative `ozcar`-reported duration, cost, and token data
- if some reported metrics are missing, only the present fields are emitted
- measured wall-clock time stays external
- provider, model, and time-budget assumptions stay external
- snapshot validation is strict; audit-id or finding-id drift fails closed instead of being inferred from transcripts

Example:

```json
{
  "schemaVersion": 1,
  "audit": {
    "auditId": "payments-vault",
    "focus": "Investigate payments vault invariants",
    "status": "completed"
  },
  "scope": {
    "targets": ["src/Vault.sol", "src/WithdrawRouter.sol"],
    "objectives": ["Confirm balance invariants"],
    "notes": []
  },
  "generatedAt": "2026-04-12T20:08:00.000Z",
  "reportedMetrics": {
    "durationSeconds": 4.2,
    "costUsd": 0.031,
    "inputTokens": 321,
    "outputTokens": 123
  },
  "findings": [
    {
      "findingId": "reentrant-withdraw",
      "title": "Reentrant withdraw path",
      "summary": "The withdraw callback can reenter before the nonce is burned.",
      "severity": "critical",
      "affectedCode": ["src/WithdrawRouter.sol:18"],
      "triageDisposition": "confirmed",
      "validationOutcome": "validated",
      "labels": {
        "auditId": "payments-vault"
      }
    }
  ]
}
```

## Why It Is Built This Way

`ozcar` is intentionally thin.

- Pi does the general-purpose agent work.
- `ozcar` adds the audit-specific workflow and durable artifact contract.
- The repo avoids a second CLI runtime, a second session store, and transcript-scraping comparison logic.

That keeps the package closer to Sutton's "bitter lesson" direction: rely on stronger general systems, and keep the wrapper small.

## Development

```bash
npm run build
npm test
```

Focused Pi-surface tests:

```bash
npm test -- tests/pi-extension.test.ts tests/pi-extension.audit.test.ts tests/pi-extension.export.test.ts tests/pi-extension.providers.test.ts
```
