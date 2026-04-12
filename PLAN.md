# ozcar

## Outcome

Build `ozcar` as a TypeScript-only, filesystem-first, resumable audit runner that is ergonomic for real audits by users who already have a Codex or Claude Code account. The completed v1 foundation remains the base contract: durable run storage, gated JSON artifacts, replay, rebuild, and mechanical report generation stay canonical. The next planned slices convert that dry-run foundation into a live provider-backed auditor through a thin execution seam, a higher-level audit UX, and a stable benchmark/export surface.

Provider parity follows a strict sequence. First, make the existing `codex` and `claude` CLIs usable through one small live runner with explicit preflight and persisted raw artifacts. Second, make that runner ergonomic with a minimal audit flow and auth-aware diagnostics. Third, optionally add native `ozcar` login/logout and direct API modes if they improve ergonomics without reshaping the repo. Benchmark work begins only after live execution is real.

The research that informed this plan was written from `~/oz`. From this repo root, translate those references to parent-relative paths such as `../fuzzing-team-foz/...`, `../apprentice-victor/...`, and `../auditor-bench/...` where applicable. Those repos and upstream projects remain read-only design references unless the user expands scope; `PLAN.md` and `AGENTS.md` are the canonical contract for `ozcar`.

## Architecture Guardrails

- Keep the core runtime TypeScript-only. Short-lived subprocess execution at the provider boundary is allowed for live CLI parity, but do not move core orchestration into shell or Python.
- Make the run store filesystem-first and resumable. Every phase must leave durable, human-inspectable artifacts.
- Keep machine contracts JSON-first. `plan.json`, `finding.json`, `triage.json`, `validation.json`, and benchmark exports are canonical; Markdown is generated mechanically from validated JSON.
- Give every phase a deterministic gate backed by typed validation. Prefer `zod` plus structured parsing over regex-only checks.
- Keep providers behind one small interface. Detection/preflight, execution, auth, and model defaults must stay behind typed contracts instead of leaking provider-specific control flow into phases.
- Prefer CLI-backed provider execution first. Native OAuth and direct API transports are later phases, not prerequisites for Claude/Codex parity.
- Keep the dry-run fixture seam even after live execution ships. Replayable fixture coverage remains part of the test strategy.
- If adopting `@mariozechner/pi-ai`, limit scope to OAuth/provider helpers or vendored patterns. Do not import the broader `pi-mono` coding-agent stack, TUI, or session framework.
- Any `pi-ai` reuse must cross the current CommonJS/ESM boundary intentionally. Do not let module-format interop become implicit repo-wide drift.
- Generate `summary.md`, `confirmed-findings.md`, and benchmark-facing exports mechanically from validated findings.
- Ship one built-in Solidity audit pack until the live core loop is stable.
- Avoid FOZ's duplicated helper layout, CritFinder's monolithic bash orchestrator, and plugin-surface creep.

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
- `pi-mono` OAuth and provider references:
  - `badlogic/pi-mono/packages/ai/README.md`
  - `badlogic/pi-mono/packages/ai/src/utils/oauth/index.ts`
  - `badlogic/pi-mono/packages/ai/src/utils/oauth/types.ts`
  - `badlogic/pi-mono/packages/ai/src/utils/oauth/anthropic.ts`
  - `badlogic/pi-mono/packages/ai/src/utils/oauth/openai-codex.ts`
  - `badlogic/pi-mono/packages/ai/src/providers/anthropic.ts`
  - `badlogic/pi-mono/packages/ai/src/providers/openai-codex-responses.ts`
  - `badlogic/pi-mono/packages/coding-agent/src/core/auth-storage.ts`
- Benchmark harness references:
  - `../auditor-bench/src/auditor_benchmark/adapters/ozcar.py`
  - `../auditor-bench/tests/test_adapters.py`

Borrow the explicit artifact contract, guarded regeneration pattern, deterministic gates, provider preflight, retryable live runner seam, narrow auth store, optional OAuth registry, and stable benchmark export surface. Do not copy duplicated helpers, monolithic shell orchestration, markdown-only machine contracts, or the larger `pi-mono` coding-agent runtime.

## Target Layout

```text
src/
  cli.ts
  commands/
    init.ts
    run.ts
    audit.ts
    login.ts
    logout.ts
    auth.ts
    resume.ts
    status.ts
    replay.ts
    rebuild.ts
    doctor.ts
    export-findings.ts
  providers/
    base.ts
    runtime.ts
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
    scan.ts
    finding.ts
    triage.ts
    validation.ts
    provider-execution.ts
    export.ts
  store/
    run-store.ts
    lock.ts
    events.ts
    auth-store.ts
  prompts/
    planner.md
    scanner.md
    triager.md
    validator.md
  reports/
    summary.ts
    confirmed-findings.ts
    export-findings.ts
```

Run artifacts should converge on:

```text
.ai-auditor/
  runs/<run-id>/
    run.json
    memory.md
    summary.md
    confirmed-findings.md
    exports/
      findings.json
    provider/
      preflight.json
    events.jsonl
    loops/0001/
      plan.json
      plan-prompt.md
      plan-stdout.txt
      plan-stderr.txt
      scans/
        0001/
          request.json
          prompt.md
          stdout.txt
          stderr.txt
          output.json
      triage/
      validated/
      rejected/
      pending/
      loop-summary.md
```

## Non-Goals For Current Program

- A public plugin API or prompt-pack marketplace
- Multiple built-in audit packs before the live core loop is stable
- Agent-authored canonical summaries
- Helper duplication across install locations
- Importing the full `pi-mono` coding-agent stack
- Native OAuth before CLI-backed live execution works end to end
- Headline benchmark comparisons before live provider execution exists
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
- minimal tests for run directory creation, locking, and event append or reload behavior

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
- fixture-backed component tests for provider detection, parser or dedup behavior, replay, gate failures, and report rebuilds
- a sample end-to-end run fixture that proves resumability and deterministic report generation

Acceptance criteria:
- seam tests cover the core failure modes called out in the research
- a sample run can be replayed and rebuilt without manual patching
- the v1 surface remains TypeScript-only and phase-gated

### Phase 6: Live Provider Runner And Preflight

Status: current

Objective:
Replace the metadata-only provider seam with a live CLI-backed execution contract for `plan` and `scan`, while preserving the durable store, dry-run fixtures, and deterministic parsing gates.

Deliverables:
- `src/providers/runtime.ts` defining preflight and execution operations shared by Codex and Claude
- upgraded `src/providers/{codex,claude}.ts` with CLI invocation metadata, retries, and parsed execution results
- live execution updates in `src/phases/{plan,scan}.ts` and `src/commands/{run,resume,replay,doctor}.ts`
- raw provider artifact capture for prompt, stdout, stderr, exit status, and parsed output
- deterministic seam tests for preflight, retries, parsing, and live-artifact persistence

Acceptance criteria:
- a logged-in `codex` or `claude` CLI can complete a real `run` without `--dry-run`
- preflight fails with actionable install or login guidance when the selected provider is unavailable or unusable
- plan and scan persist raw provider artifacts alongside canonical JSON outputs
- `--dry-run` remains available for deterministic fixture and replay coverage

### Phase 7: Ergonomic Audit UX

Status: planned

Objective:
Make the live runner usable as a one-command audit tool for users who already have Codex or Claude Code access.

Deliverables:
- `src/commands/audit.ts` or equivalent high-level audit wrapper over the lower-level operational commands
- smarter scope, target, and research defaults inferred from the target repository when safe
- auth-aware `status` and `doctor` output that reports detected provider, model, and missing prerequisites
- a root quickstart or README that documents the first-run Claude and Codex paths

Acceptance criteria:
- a user with a logged-in `codex` or `claude` CLI can run `ozcar audit <target-root>` with minimal required flags
- `doctor` reports provider detection, auth hints, model resolution, and missing prerequisites clearly
- the first-run path is documented without requiring users to understand the full low-level `run` flag surface
- advanced `run` flags remain available for reproducibility, replay, and bench harnesses

### Phase 8: Native Auth Surface And Model Introspection

Status: planned

Objective:
Add optional `ozcar`-managed login, logout, auth status, and model discovery without making native auth a prerequisite for basic parity.

Deliverables:
- `src/store/auth-store.ts` with locked `auth.json` persistence and refresh-safe writes
- `src/commands/{login,logout,auth}.ts` and any supporting model-listing surface needed for provider inspection
- a small OAuth adapter layer, ideally reusing `@mariozechner/pi-ai/oauth` patterns or a narrow vendored equivalent
- deterministic tests for auth storage, refresh paths, locking, and redacted status output

Acceptance criteria:
- a user can log in, log out, and inspect auth state without editing raw token files
- the CLI-backed runner continues to work when users prefer upstream CLI auth instead of `ozcar login`
- concurrent auth refresh or login work does not corrupt stored credentials
- `pi-mono` reuse stays limited to the small OAuth and auth-store seam and does not pull in the broader coding-agent runtime

### Phase 9: Direct API Provider Mode

Status: planned

Objective:
Add an opt-in direct API transport for Claude and Codex so `ozcar` can run without the upstream CLI when stored credentials or API keys are available.

Deliverables:
- direct API transport implementations for Codex and Claude behind the same provider runtime interface
- provider-specific request shaping for OAuth and API-key modes, including any account or identity headers required by the upstream services
- mode selection and validation so CLI-backed and direct API execution can coexist without ambiguity
- deterministic tests for direct transport requests, headers, parsing, and fallback behavior

Acceptance criteria:
- both providers can execute `plan` and `scan` through direct API mode with stored credentials or environment-backed auth
- provider-specific header and token requirements are captured in tests
- CLI-backed mode remains the default until direct API mode reaches comparable reliability
- adding direct mode does not reshape the phase contracts or durable artifact layout

### Phase 10: Benchmark Export And Comparative Verification

Status: planned

Objective:
Make live `ozcar` runs benchmarkable against CritFinder and other auditors through a stable export contract and fixture-backed verification.

Deliverables:
- `src/commands/export-findings.ts` and supporting report code that emit normalized findings directly from validated bundles
- an explicit export contract under `src/contracts/export.ts`
- fixture-backed tests for export stability across validated, rejected, and pending findings
- benchmark guidance that holds provider, model, time budget, and scoring constant across tools

Acceptance criteria:
- external harnesses can ingest `ozcar` through a stable export surface instead of scraping internal directories
- benchmark comparisons are run on live provider-backed `ozcar` outputs rather than dry-run fixtures
- export output clearly distinguishes validated, rejected, and pending findings
- downstream harness mismatches are treated as adapter work, not as reasons to destabilize `ozcar`'s internal artifact contracts

Current state:
Phases 1 through 5 are complete and form the stable dry-run foundation. Phase 6 is the current implementation slice and must land before ergonomic UX, native auth, direct API work, or benchmark and export comparisons move forward. Benchmark claims about `ozcar` remain non-authoritative until Phase 6 and Phase 10 both pass.

## Global Validation Rules

- Phases execute sequentially unless this document explicitly says otherwise.
- Every implementation slice must add or update tests for new durable seams.
- Live provider phases must add deterministic seam tests for preflight, execution persistence, parser behavior, and failure handling. Opt-in live-provider smoke tests may supplement those tests but must not replace them.
- Auth phases must add file-locking, refresh-path, and redaction tests.
- Export and benchmark phases must add fixture-backed compatibility tests for the normalized export surface.
- Every persisted implementation run writes `docs/execs/{UTC_TIMESTAMP}_EXEC.md` using the local template.
- Every persisted review run writes `docs/reviews/{UTC_TIMESTAMP}_REVIEW.md` using the local template.
- Later phases do not start until earlier phase acceptance criteria pass.

## Resume Protocol

1. Read `AGENTS.md`.
2. Read this `PLAN.md`.
3. Read the newest `docs/plans/*_PLAN.md` record for the active slice.
4. If implementation has started, read the active `docs/execs/*_EXEC.md`; for review or repair loops, read the corresponding artifact under `docs/reviews/` or `docs/fixes/`.
5. Continue only the current phase unless the defined gates explicitly move work forward.
