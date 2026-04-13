# ozcar

## Outcome

Build `ozcar` as a TypeScript-only, project-local Pi extension pack for audit workflows, not as a standalone provider-orchestration CLI. Pi owns the interactive session runtime, auth/login, model registry, provider selection, session tree, and context compaction. `ozcar` owns audit-specific slash commands, tools, skills, prompt packs, JSON artifact contracts, and mechanical report/export generation.

The durable v1 outcome is an ergonomic audit loop that runs inside Pi using project-local `.pi/extensions`, `.pi/skills`, `.pi/prompts`, and AGENTS/context files. Scope exploration, alternate hypotheses, and long-running audit branches should use Pi's `/tree`, labels, and branch summaries instead of a parallel run-store conversation system. Audit outputs remain repo-owned and JSON-first so downstream harnesses can rebuild Markdown and benchmark exports from validated findings.

The research that informed this pivot was written from `~/oz`. From this repo root, translate those references to parent-relative paths such as `../fuzzing-team-foz/...` and `../apprentice-victor/...` where applicable. Upstream Pi repos remain read-only design references; `PLAN.md` and `AGENTS.md` remain the canonical contract for `ozcar`.

## Architecture Guardrails

- Keep the audit-specific code TypeScript-only.
- Pi owns provider auth, `/login`, model registry, provider resolution, session storage, and tree navigation. Do not add a repo-owned live provider runtime, CLI preflight layer, OAuth store, or duplicate conversation tree.
- Prefer Pi built-ins and project-local extension packaging. Put user-facing workflow entrypoints in `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`, and `resources_discover` instead of wrapping Pi in another CLI.
- If provider customization becomes necessary, use `pi.registerProvider()` plus existing `@mariozechner/pi-ai` streaming implementations or thin baseUrl/header/model overrides. Do not copy OAuth or streaming internals from `pi-mono`; treat `custom-provider-anthropic` as an anti-pattern and `custom-provider-gitlab-duo` as the preferred shape.
- Use Pi session labels, branch summaries, and `/tree` for scope branches, alternative hypotheses, and context recovery. Do not maintain a second session-history state machine inside `ozcar`.
- Keep machine contracts JSON-first. Findings, triage, validation, and export JSON remain canonical; Markdown reports are rebuilt mechanically from validated JSON.
- Keep extension modules small and boring. Prefer focused commands, tools, and state helpers over one monolithic extension or duplicated helper trees.
- Paths outside this repo are read-only design references unless the user expands scope.

## External Reference Map

- Core Pi extension and session docs:
  - `badlogic/pi-mono/packages/coding-agent/docs/extensions.md`
  - `badlogic/pi-mono/packages/coding-agent/docs/tree.md`
  - `badlogic/pi-mono/packages/coding-agent/docs/session.md`
  - `badlogic/pi-mono/packages/coding-agent/docs/providers.md`
  - `badlogic/pi-mono/packages/coding-agent/docs/custom-provider.md`
  - `badlogic/pi-mono/packages/coding-agent/docs/sdk.md`
  - `badlogic/pi-mono/packages/coding-agent/docs/skills.md`
- Core Pi examples to mirror:
  - `badlogic/pi-mono/packages/coding-agent/examples/sdk/06-extensions.ts`
  - `badlogic/pi-mono/packages/coding-agent/examples/sdk/07-context-files.ts`
  - `badlogic/pi-mono/packages/coding-agent/examples/sdk/09-api-keys-and-oauth.ts`
  - `badlogic/pi-mono/packages/coding-agent/examples/extensions/dynamic-resources/index.ts`
  - `badlogic/pi-mono/packages/coding-agent/examples/extensions/tools.ts`
  - `badlogic/pi-mono/packages/coding-agent/examples/extensions/questionnaire.ts`
  - `badlogic/pi-mono/packages/coding-agent/examples/extensions/plan-mode/README.md`
  - `badlogic/pi-mono/packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/index.ts`
  - `badlogic/pi-mono/packages/coding-agent/examples/extensions/custom-provider-anthropic/index.ts`
- Pi ecosystem packaging and context-management references:
  - `badlogic/pi-skills/README.md`
  - `nicobailon/pi-boomerang/README.md`
  - `ttttmr/pi-context/README.md`
- Existing audit and artifact references worth preserving:
  - `../fuzzing-team-foz/expected-artifacts.md`
  - `../fuzzing-team-foz/scripts/foz-init.js`
  - `../apprentice-victor/CritFinder/README.md`
  - `../auditor-bench/tests/test_adapters.py`

Borrow Pi's extension discovery, resource loading, auth storage, model registry, session tree, branch summaries, slash-command ergonomics, and thin provider registration. Borrow FOZ/CritFinder only for durable audit artifact contracts and benchmark-facing export expectations. Do not copy standalone provider runners, OAuth stores, monolithic shell orchestration, or duplicated context-management layers.

## Target Layout

```text
.pi/
  extensions/
    ozcar/
      index.ts
      commands/
        audit.ts
        findings.ts
        export.ts
        context.ts
      tools/
        capture-finding.ts
        triage-finding.ts
        validate-finding.ts
      state/
        audit-session.ts
        labels.ts
      resources/
        prompts/
        skills/
      providers/
        register.ts
  prompts/
    audit.md
    export-findings.md
  skills/
    ozcar-audit/
      SKILL.md
src/
  contracts/
    audit.ts
    finding.ts
    triage.ts
    validation.ts
    export.ts
  reports/
    summary.ts
    confirmed-findings.ts
    export-findings.ts
  artifacts/
    store.ts
    rebuild.ts
tests/
  extension/
  contracts/
  reports/
```

Audit outputs should converge on:

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

Pi session transcripts, tree state, labels, and branch summaries remain under Pi's session store. `ozcar` should export from that session context rather than duplicating it.

## Non-Goals For Current Program

- A repo-owned live provider runner, preflight engine, or OAuth/token store
- A second conversation/session store parallel to Pi's session tree
- Copying `pi-mono` provider/OAuth/streaming internals into this repo
- A public plugin marketplace beyond Pi's existing extension/skill/package surfaces
- Multiple audit packs before the core extension workflow is stable
- Agent-authored canonical reports
- Shell- or Python-based core orchestration
- Benchmark claims based on dry-run fixtures or transcript scraping

## Phase Plan

### Phase 1: Pivot Reset And Contract Cut

Status: complete

Objective:
Roll back the abandoned live-provider slice, stop growing the standalone provider runtime, and replace the canonical roadmap with a Pi-extension-first contract.

Deliverables:
- rollback of the failed Phase 6 live-provider runtime additions
- updated `PLAN.md` and repo-local artifacts documenting the pivot
- no repo-owned live provider runtime, preflight contract, or raw provider-attempt capture remaining in active code

Acceptance criteria:
- the Phase 6 live-provider files are removed or restored to the pre-slice state
- `npm run build` and `npm test` pass on the reverted dry-run seam
- `PLAN.md` no longer targets repo-owned provider/OAuth/runtime work as the primary path

### Phase 2: Project-Local Extension Scaffold

Status: complete

Objective:
Create the project-local Pi extension entrypoint and resource discovery surface that turns this repo into an ergonomic Pi add-on instead of a separate orchestrator.

Deliverables:
- `.pi/extensions/ozcar/index.ts`
- project-local `.pi/skills/` and `.pi/prompts/` surfaces, either directly or through `resources_discover`
- minimal slash commands for loading the audit workflow and exposing repo-local help
- README or usage notes for Pi-first setup inside this repo

Acceptance criteria:
- opening Pi in this repo auto-discovers the `ozcar` extension or can load it with one local path
- `/reload` keeps the extension and its resources coherent
- the core audit workflow is entered through Pi commands/tools rather than `ozcar run`

### Phase 3: Audit Workflow And Tree Navigation

Status: complete

Objective:
Move scope capture, audit execution guidance, finding capture, and branch management into Pi commands/tools that explicitly exploit the session tree.

Deliverables:
- slash commands for starting or resuming an audit session, checking audit state, and exporting results
- tools for structured finding capture, triage, validation, and user clarification when needed
- label or branch-summary conventions for hypotheses, confirmed findings, and abandoned branches
- integration guidance for `/tree`, labels, and context summarization

Acceptance criteria:
- a user can branch alternative audit directions and recover them through `/tree`
- audit state restores correctly on `session_start` and `session_tree`
- long audits can summarize or checkpoint context without losing the canonical JSON finding state

### Phase 4: JSON Artifact Export And Mechanical Reports

Status: complete

Objective:
Materialize durable audit artifacts from Pi session state into repo-owned JSON contracts and mechanically rebuilt reports.

Deliverables:
- shared TypeScript contracts for audit, finding, triage, validation, and export data
- artifact storage helpers that write deterministic JSON under `.ai-auditor/`
- mechanical builders for `summary.md`, `confirmed-findings.md`, and benchmark-facing export JSON
- deterministic tests for rebuilds, stale artifact detection, and export stability

Acceptance criteria:
- validated findings can rebuild all Markdown reports without re-running the session
- exported JSON is deterministic and benchmark-friendly
- report drift is detected from stored JSON contracts rather than transcript text

### Phase 5: Thin Provider Overrides And Model Presets

Status: complete

Objective:
Add only the minimum provider or model customization required for audit ergonomics while keeping Pi responsible for auth and streaming.

Deliverables:
- optional model presets, audit-specific system-prompt helpers, or thin `registerProvider()` overrides
- any provider-specific extension code kept behind one small module and delegated to Pi or pi-ai primitives
- verification that custom provider work is not required when Pi built-ins already cover the use case

Acceptance criteria:
- audit users can select supported Pi providers/models without repo-owned login flows
- any custom provider code is limited to thin configuration or built-in-stream delegation
- no copied OAuth or custom streaming stacks remain in `ozcar`

### Phase 6: Benchmark Export And Comparative Verification

Status: current

Objective:
Expose a stable export surface so live Pi-hosted `ozcar` audits can be compared against other auditors without scraping session files.

Deliverables:
- stable `findings.json` export from validated artifact bundles
- adapter notes or fixtures for downstream benchmark harnesses
- comparison validation that keeps provider, model, and time-budget assumptions explicit

Acceptance criteria:
- downstream harnesses consume the export surface instead of Pi session transcripts
- benchmark comparisons operate on exported validated findings, not raw session text
- adapter drift is treated as downstream integration work rather than a reason to reshape the internal contracts

Current state:
The Phase 4 JSON artifact export and mechanical report seam remains in place, validated, repaired, and reviewed, including deterministic on-disk contract enforcement, canonical export timestamps, and Pi-backed snapshot checkpointing for `/ozcar-audit-export`. The Phase 5 model-preset seam is now implemented, repaired, and reviewed, including repo-local `/ozcar-audit-model` presets that stay Pi-owned, live Pi RPC proof for editor-staged `/model` commands, and slash-containing model-id support aligned with Pi's canonical `provider/modelId` behavior. The standalone TypeScript CLI and dry-run artifact code remain as transition-era prototype surfaces. The next approved implementation work is Phase 6: expose the stable export surface and comparative-verification notes without scraping Pi transcripts, reshaping the internal JSON contracts, or reopening provider/runtime ownership.

## Global Validation Rules

- Phases execute sequentially unless this document explicitly says otherwise.
- Every implementation slice must add or update tests for the touched extension, contract, or report seam.
- Extension state that survives reloads or tree navigation must be reconstructed from Pi session entries on `session_start` and `session_tree`.
- New audit commands or tools must validate against both non-interactive fallbacks and interactive Pi UI behavior where applicable.
- JSON/report slices must add deterministic rebuild tests from stored contracts.
- Provider-related work must prove it delegates to Pi or `@mariozechner/pi-ai`; copied OAuth or streaming code is a plan violation.
- Every persisted implementation run writes `docs/execs/{UTC_TIMESTAMP}_EXEC.md` using the local template.
- Every persisted review run writes `docs/reviews/{UTC_TIMESTAMP}_REVIEW.md` using the local template.
- Later phases do not start until earlier phase acceptance criteria pass.

## Resume Protocol

1. Read `AGENTS.md`.
2. Read this `PLAN.md`.
3. Read the newest `docs/plans/*_PLAN.md` record for the active slice.
4. If implementation has started, read the active `docs/execs/*_EXEC.md`; for review or repair loops, read the corresponding artifact under `docs/reviews/` or `docs/fixes/`.
5. Before extension-design work, re-read the relevant Pi references from the External Reference Map instead of relying on memory.
6. Continue only the current phase unless the defined gates explicitly move work forward.
