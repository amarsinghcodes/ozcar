# ozcar

## Outcome

Build `ozcar` as a TypeScript-only, filesystem-first, resumable audit runner. The v1 must orchestrate `plan`, `scan`, `triage`, `validate`, and `summarize` phases through durable artifacts under `.ai-auditor/runs/<run-id>/...`, with JSON machine contracts and mechanically generated Markdown reports.

The research that informed this plan was written from `~/oz`. From this repo root, translate those references to parent-relative paths such as `../fuzzing-team-foz/...` and `../apprentice-victor/...`. Those sibling repos are design references only; `PLAN.md` and `AGENTS.md` are the canonical contract for `ozcar`.

## Architecture Guardrails

- Keep the core runtime TypeScript-only. Do not introduce shell or Python orchestration unless a later validator explicitly requires it.
- Make the run store filesystem-first and resumable. Every phase must leave durable, human-inspectable artifacts.
- Keep machine contracts JSON-first. `plan.json`, `finding.json`, `triage.json`, and `validation.json` are canonical; Markdown is generated from validated JSON.
- Give every phase a deterministic gate backed by typed validation. Prefer `zod` plus structured parsing over regex-only checks.
- Keep providers behind one small interface. Phase logic should depend on capability flags and defaults, not provider-specific control flow.
- Generate `summary.md`, `confirmed-findings.md`, and loop summaries mechanically from validated findings.
- Ship one built-in Solidity audit pack in v1. Do not build a public plugin system yet.
- Avoid FOZ's duplicated helper layout and CritFinder's monolithic bash orchestrator.

## External Reference Map

- FOZ artifact and regeneration references:
  - `../fuzzing-team-foz/expected-artifacts.md`
  - `../fuzzing-team-foz/scripts/foz-init.js`
  - `../fuzzing-team-foz/skills/fuzz-bootstrap/scripts/stage_gate.py`
- CritFinder provider, resume, replay, and test references:
  - `../apprentice-victor/CritFinder/README.md`
  - `../apprentice-victor/CritFinder/lib/provider.sh`
  - `../apprentice-victor/CritFinder/orchestrator.sh`
  - `../apprentice-victor/CritFinder/scripts/run_isolated_scan.sh`
  - `../apprentice-victor/CritFinder/tests/component-tests.sh`

Borrow the explicit artifact contract, guarded regeneration pattern, deterministic stage gates, provider abstraction, resumable file-backed state, replay command shape, and seam tests. Do not copy duplicated helpers, monolithic shell orchestration, markdown-only machine contracts, or a public plugin system.

## Target Layout

```text
src/
  cli.ts
  commands/
    init.ts
    run.ts
    resume.ts
    status.ts
    replay.ts
    rebuild.ts
    doctor.ts
  providers/
    base.ts
    codex.ts
    claude.ts
  phases/
    plan.ts
    scan.ts
    triage.ts
    validate.ts
    summarize.ts
  gates/
    plan.ts
    scan.ts
    triage.ts
    validate.ts
  contracts/
    run.ts
    plan.ts
    finding.ts
    triage.ts
    validation.ts
  store/
    run-store.ts
    lock.ts
    events.ts
  prompts/
    planner.md
    scanner.md
    triager.md
    validator.md
  reports/
    summary.ts
    confirmed-findings.ts
```

Run artifacts should converge on:

```text
.ai-auditor/
  runs/<run-id>/
    run.json
    memory.md
    summary.md
    confirmed-findings.md
    protocol-context.md
    compressed-codebase.md
    events.jsonl
    loops/0001/
      plan.json
      scans/
      triage/
      validated/
      rejected/
      pending/
      loop-summary.md
```

## Non-Goals For V1

- A public plugin API or prompt-pack marketplace
- Multiple built-in audit packs before the core loop is stable
- Agent-authored canonical summaries
- Helper duplication across install locations
- Shell- or Python-based core orchestration

## Phase Plan

### Phase 1: Workspace Foundation And Run Store

Status: complete

Objective:
Establish the TypeScript workspace, CLI entrypoint, durable run-store contract, and typed module skeleton that later phases can extend without reshaping the repo.

Deliverables:
- package/tooling files for a runnable TypeScript CLI, tests, and validation scripts
- `src/cli.ts`
- `src/commands/{init,run,resume,status,replay,rebuild,doctor}.ts`
- `src/contracts/{run,plan,finding,triage,validation}.ts`
- `src/store/{run-store,lock,events}.ts`
- minimal tests for run directory creation, locking, and event append/reload behavior

Acceptance criteria:
- `npm run build` succeeds
- `npm test` covers run creation, resume-safe reopen, lock contention, and event append semantics
- a dry local invocation can create `.ai-auditor/runs/<run-id>/run.json` and `events.jsonl`

### Phase 2: Plan And Scan Phases

Status: complete

Objective:
Implement provider selection plus the `plan` and `scan` phases with deterministic gates and resumable artifact output.

Deliverables:
- `src/providers/{base,codex,claude}.ts`
- `src/prompts/{planner,scanner}.md`
- `src/phases/{plan,scan}.ts`
- `src/gates/{plan,scan}.ts`

Acceptance criteria:
- provider detection and explicit override are supported through one small interface
- loop `0001` can emit `plan.json` plus replayable scan artifacts
- gate failures are deterministic and actionable

### Phase 3: Triage, Validate, And Summarize

Status: complete

Objective:
Turn raw findings into gated triage and validation outputs, then generate human-facing reports from validated JSON only.

Deliverables:
- `src/prompts/{triager,validator}.md`
- `src/phases/{triage,validate,summarize}.ts`
- `src/gates/{triage,validate}.ts`
- `src/reports/{summary,confirmed-findings}.ts`

Acceptance criteria:
- triage and validation outputs are stored as typed JSON sidecars
- `summary.md` and `confirmed-findings.md` are rebuilt mechanically from validated findings
- rejected and pending findings stay separated from validated findings

### Phase 4: Operational Commands And Replay

Status: complete

Objective:
Wire the runtime into the full operational CLI and support safe resume, replay, rebuild, and doctor flows from filesystem state.

Deliverables:
- complete command handlers for `run`, `resume`, `status`, `replay`, `rebuild`, and `doctor`
- replay support for isolated scan reruns
- doctor checks for missing, invalid, or stale artifacts

Acceptance criteria:
- `resume` continues from durable state without hidden session memory
- `replay` can rerun a scan from stored inputs
- `rebuild` regenerates reports from validated artifacts only
- `doctor` identifies missing contracts, gate failures, and invalid report state

### Phase 5: Verification Hardening And V1 Readiness

Status: complete

Objective:
Harden the seams that are most likely to drift: parsers, dedup logic, summary rebuilds, replay behavior, and artifact gates.

Deliverables:
- fixture-backed component tests for provider detection, parser/dedup behavior, replay, gate failures, and report rebuilds
- a sample end-to-end run fixture that proves resumability and deterministic report generation

Acceptance criteria:
- seam tests cover the core failure modes called out in the research
- a sample run can be replayed and rebuilt without manual patching
- the v1 surface remains TypeScript-only and phase-gated

Current state:
All planned v1 phases are complete. No active implementation slice is approved until a new request updates this canonical plan.

## Global Validation Rules

- Phases execute sequentially unless this document explicitly says otherwise.
- Every implementation slice must add or update tests for new durable seams.
- Every persisted implementation run writes `docs/execs/{UTC_TIMESTAMP}_EXEC.md` using the local template.
- Every persisted review run writes `docs/reviews/{UTC_TIMESTAMP}_REVIEW.md` using the local template.
- Later phases do not start until earlier phase acceptance criteria pass.

## Resume Protocol

1. Read `AGENTS.md`.
2. Read this `PLAN.md`.
3. Read the newest `docs/plans/*_PLAN.md` record for the active slice.
4. If implementation has started, read the active `docs/execs/*_EXEC.md`; for review or repair loops, read the corresponding artifact under `docs/reviews/` or `docs/fixes/`.
5. Continue only the current phase unless the defined gates explicitly move work forward.
