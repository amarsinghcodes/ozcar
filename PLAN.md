# ozcar

## Outcome

Build `ozcar` as a TypeScript-only, project-local Pi extension pack for audit workflows, not as a standalone provider-orchestration CLI. Pi owns the interactive session runtime, auth/login, model registry, provider selection, session tree, and context compaction. `ozcar` owns audit-specific slash commands, tools, skills, prompt packs, JSON artifact contracts, and mechanical report/export generation.

The durable v1 outcome is an ergonomic audit loop that runs inside Pi using project-local `.pi/extensions`, `.pi/skills`, `.pi/prompts`, and AGENTS/context files, and that can also load as a reusable Pi package in other repos without falling back to the transition CLI as the primary interface. Scope exploration, alternate hypotheses, and long-running audit branches should use Pi's `/tree`, labels, and branch summaries instead of a parallel run-store conversation system. Audit outputs remain repo-owned and JSON-first so downstream harnesses can rebuild Markdown and benchmark exports from validated findings plus authoritative reported metrics emitted by `ozcar` itself.

The research that informed this pivot was written from `~/oz`. From this repo root, translate those references to parent-relative paths such as `../fuzzing-team-foz/...` and `../apprentice-victor/...` where applicable. Upstream Pi repos remain read-only design references; `PLAN.md` and `AGENTS.md` remain the canonical contract for `ozcar`.

## Architecture Guardrails

- Keep the audit-specific code TypeScript-only.
- Pi owns provider auth, `/login`, model registry, provider resolution, session storage, and tree navigation. Do not add a repo-owned live provider runtime, CLI preflight layer, OAuth store, or duplicate conversation tree.
- Prefer Pi built-ins and project-local extension packaging. Put user-facing workflow entrypoints in `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`, and `resources_discover` instead of wrapping Pi in another CLI.
- When the repo-local Pi surface needs to load outside this checkout, expose it through a package-level `pi` manifest and keep the package surface extension-first. Do not make the transition CLI or raw extension file paths the primary long-term integration contract.
- If provider customization becomes necessary, use `pi.registerProvider()` plus existing `@mariozechner/pi-ai` streaming implementations or thin baseUrl/header/model overrides. Do not copy OAuth or streaming internals from `pi-mono`; treat `custom-provider-anthropic` as an anti-pattern and `custom-provider-gitlab-duo` as the preferred shape.
- Use Pi session labels, branch summaries, and `/tree` for scope branches, alternative hypotheses, and context recovery. Do not maintain a second session-history state machine inside `ozcar`.
- Keep machine contracts JSON-first. Findings, triage, validation, and export JSON remain canonical; Markdown reports are rebuilt mechanically from validated JSON.
- Keep reported comparison metrics authoritative and repo-owned. Duration, cost, and token fields must be emitted by `ozcar` contracts and exports, not inferred later from transcripts or benchmark-side regex scraping.
- Keep extension modules small and boring. Prefer focused commands, tools, and state helpers over one monolithic extension or duplicated helper trees.
- Paths outside this repo are read-only design references unless the user expands scope.

## External Reference Map

- Core Pi extension and session docs:
  - `badlogic/pi-mono/packages/coding-agent/docs/extensions.md`
  - `badlogic/pi-mono/packages/coding-agent/docs/packages.md`
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
  - `../auditor-bench/src/auditor_benchmark/adapters/ozcar.py`
  - `../auditor-bench/src/auditor_benchmark/models.py`
  - `../auditor-bench/src/auditor_benchmark/reporting.py`
  - `../auditor-bench/src/auditor_benchmark/runner.py`

Borrow Pi's extension discovery, resource loading, auth storage, model registry, session tree, branch summaries, slash-command ergonomics, package manifests, and thin provider registration. Borrow FOZ/CritFinder only for durable audit artifact contracts and benchmark-facing export expectations. Borrow `../auditor-bench` only for the comparison-dimension semantics around authoritative reported duration, cost, and token metrics. Do not copy standalone provider runners, OAuth stores, monolithic shell orchestration, benchmark-side regex extraction, or duplicated context-management layers.

## Target Layout

```text
package.json
  pi:
    extensions:
      - ./.pi/extensions/ozcar/index.ts
    prompts:
      - ./.pi/prompts
    skills:
      - ./.pi/skills
.pi/
  extensions/
    ozcar/
      index.ts
      commands/
        audit.ts
        checkpoint.ts
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

Status: complete

Objective:
Expose a stable export surface so live Pi-hosted `ozcar` audits can be compared against other auditors without scraping session files.

Deliverables:
- stable `findings.json` export from validated artifact bundles
- adapter notes or fixtures for downstream benchmark harnesses
- comparison validation that keeps provider, model, and time-budget assumptions explicit

Acceptance criteria:
- repo-local guidance and fixtures point downstream harnesses at the export surface instead of Pi session transcripts
- benchmark comparisons in this repo are defined against exported validated findings, not raw session text
- adapter drift remains downstream integration work rather than a reason to reshape the internal contracts

### Phase 7: Pi-Native Ergonomics Hardening

Status: complete

Objective:
Eliminate the remaining root-cause ergonomics defects from the latest Pi-SOTA review by making audit identities collision-resistant, exposing a human-usable checkpoint seam, and promoting `ozcar`'s package surface to Pi-first instead of CLI-first.

Deliverables:
- collision-resistant audit id generation for focus-only `/ozcar-audit-start <focus>` flows, plus regression coverage for long similar focuses
- a human-facing checkpoint surface that shares the same backend contract as `ozcar_store_audit_snapshot` instead of leaving durable export preparation as an agent-only tool path
- `package.json` Pi package metadata and resource exposure so this repo can load ergonomically through package-level Pi conventions in addition to project-local auto-discovery
- package-first README/help/test coverage that proves the repo-local extension surface works both in this checkout and when loaded from another repo without teaching the transition CLI as the primary user workflow

Acceptance criteria:
- focus-only audit starts no longer risk `.ai-auditor/audits/<audit-id>/` collisions from truncated slug prefixes
- a human can checkpoint a validated audit snapshot and run `/ozcar-audit-export` without relying on an agent-only tool call
- Pi can load this repo through a package-level manifest or equivalent package surface, and repo docs/help no longer present the legacy CLI as the primary integration contract

### Phase 8: Authoritative Reported Metrics Export

Status: current

Objective:
Extend the repo-local export contract so `ozcar` emits authoritative reported runtime, token, and cost metrics in a JSON-first form aligned with the comparison dimensions consumed by `../auditor-bench`.

Deliverables:
- export-contract support for authoritative reported duration, cost, input-token, and output-token data emitted by `ozcar`, with a schema/version update if required
- deterministic export/rebuild wiring that keeps measured wall-clock concerns separate from `ozcar`-reported duration, cost, and token facts
- guidance and fixtures that align the repo-local metric semantics one-to-one with the `../auditor-bench` reported comparison dimensions while preserving `ozcar`'s existing JSON conventions
- regression coverage for missing, partial, and full reported-metric exports without relying on transcript scraping or benchmark-side inference

Acceptance criteria:
- the canonical export contract emits authoritative reported duration, cost, input-token, and output-token fields when `ozcar` has them, with explicit deterministic behavior when some fields are unavailable
- the metric semantics align directly with `../auditor-bench`'s reported runtime and reported cost/token comparison dimensions without requiring transcript scraping
- deterministic tests and fixtures prove the reported-metric surface remains stable across rebuilds and future adapter work

Current state:
The Phase 4 JSON artifact export and mechanical report seam remains in place, validated, repaired, and reviewed, including deterministic on-disk contract enforcement, canonical export timestamps, and Pi-backed snapshot checkpointing for `/ozcar-audit-export`. The Phase 5 model-preset seam is now implemented, repaired, and reviewed, including repo-local `/ozcar-audit-model` presets that stay Pi-owned, live Pi RPC proof for editor-staged `/model` commands, and slash-containing model-id support aligned with Pi's canonical `provider/modelId` behavior. Phase 6 is now implemented, repaired, and reviewed inside this repo, including the stable validated-only `exports/findings.json` surface, downstream-facing guidance and golden fixtures, validated-only export timestamp derivation, zero-validated export fallback coverage, and explicit same-phase handling for metadata-only artifact cross-link drift.

Phase 7 is now implemented, validated, and reviewed inside this repo, including collision-resistant focus-derived audit ids for long similar focuses, a human-facing `/ozcar-audit-checkpoint` command that reuses the same validated snapshot backend as `ozcar_store_audit_snapshot`, and package-first Pi metadata/help/load coverage that works both repo-local and from another cwd without presenting the legacy CLI as the primary contract. Phase 8 is now the active repo-local slice and will extend the export contract with authoritative reported runtime, cost, and token metrics aligned to the comparison dimensions already modeled in `../auditor-bench` while keeping measured wall-clock concerns separate from `ozcar`-reported facts. Sibling-repo adapter changes remain external follow-up unless the user expands scope.

## Global Validation Rules

- Phases execute sequentially unless this document explicitly says otherwise.
- Every implementation slice must add or update tests for the touched extension, contract, or report seam.
- Extension state that survives reloads or tree navigation must be reconstructed from Pi session entries on `session_start` and `session_tree`.
- New audit commands or tools must validate against both non-interactive fallbacks and interactive Pi UI behavior where applicable.
- JSON/report slices must add deterministic rebuild tests from stored contracts.
- Provider-related work must prove it delegates to Pi or `@mariozechner/pi-ai`; copied OAuth or streaming code is a plan violation.
- Pi packaging or ergonomics slices must validate both project-local auto-discovery and one package-level load path that works from another repo or cwd.
- Reported-metrics slices must keep measured wall-clock time separate from `ozcar`-reported duration/cost/token facts and must not rely on transcript scraping or benchmark-side regex extraction to populate authoritative fields.
- Metadata-only review/fix/plan cross-link drift should be repaired opportunistically inside the active same-phase loop and must not block phase progress by itself unless it points the next worker at the wrong target artifact or makes the active slice ambiguous.
- Every persisted implementation run writes `docs/execs/{UTC_TIMESTAMP}_EXEC.md` using the local template.
- Every persisted review run writes `docs/reviews/{UTC_TIMESTAMP}_REVIEW.md` using the local template.
- Later phases do not start until earlier phase acceptance criteria pass.

## Resume Protocol

1. Read `AGENTS.md`.
2. Read this `PLAN.md`.
3. Read the newest `docs/plans/*_PLAN.md` record for the active slice.
4. If implementation has started, read the active `docs/execs/*_EXEC.md`; for review or repair loops, read the corresponding artifact under `docs/reviews/` or `docs/fixes/`.
5. Before extension-design or export-contract work, re-read the relevant Pi and `../auditor-bench` references from the External Reference Map instead of relying on memory.
6. Continue only the current phase unless the defined gates explicitly move work forward.
