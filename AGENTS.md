# ozcar Agents

## Read Order

1. `AGENTS.md`
2. `PLAN.md`
3. `.agents/skills/artifact-md-workflow/SKILL.md`
4. The relevant local template under `.agents/templates/`
5. The newest record under `docs/plans/`
6. The active artifact under `docs/execs/`, `docs/reviews/`, or `docs/fixes/` when continuing an existing slice
7. Sibling research repos only when `PLAN.md` explicitly needs them:
   - `../fuzzing-team-foz/...`
   - `../apprentice-victor/...`

Any research notes that mention `~/oz/...` must be translated to these parent-relative paths from this repo root.

## Canonical Contract

- `PLAN.md` is the canonical implementation contract for this repo.
- `docs/plans/*.md` are prompt-authoring records, not replacements for `PLAN.md`.
- Use the local artifact workflow in `.agents/skills/artifact-md-workflow/SKILL.md` for persisted plan, execution, review, and fix work.
- Keep the core runtime TypeScript-only.
- Keep machine contracts JSON-first and generate Markdown reports from validated JSON.
- Keep providers behind one small interface.
- Do not introduce a public plugin system, duplicated helper trees, or shell/Python core orchestration in v1.
- Paths outside this repo are read-only design references unless the user expands scope.

## Write Ownership

- `src/commands/*`: CLI entry points and dispatch
- `src/providers/*`: provider interfaces and adapters
- `src/phases/*`: phase orchestration
- `src/gates/*`: deterministic phase gates and validators
- `src/contracts/*`: serialized contracts and schemas
- `src/store/*`: run-store, locks, resume state, and events
- `src/prompts/*`: phase prompt sources
- `src/reports/*`: mechanical report builders
- `docs/*`: persisted artifacts only through the local templates
- root config files: only when required by the active phase

## Execution Rules

- Work one phase at a time. Do not pull later phases forward unless `PLAN.md` marks them current.
- Start each persisted implementation run with a new `docs/execs/{UTC_TIMESTAMP}_EXEC.md` using `.agents/templates/execution.md`.
- Start each persisted review run with a new `docs/reviews/{UTC_TIMESTAMP}_REVIEW.md` using `.agents/templates/review.md`.
- Start each persisted fix run with a new `docs/fixes/{UTC_TIMESTAMP}_FIX.md` using `.agents/templates/fix.md`.
- Do not create new `docs/plans/` records for routine same-phase fix or review follow-ups when `PLAN.md` is unchanged and the user wants direct implementation or review instead of prompt authoring.
- Do not block the active slice on metadata-only artifact drift unless it breaks the current loop's traceability, points at the wrong artifact under repair, or would misdirect the next implementation or review pass.
- Keep `## REFERENCE` terse and limited to the required identifier lines from the local template.
- Use `apply_patch` for manual edits.
- Validate the touched slice before finishing. If a required script is missing, add the minimal script needed for the current phase and then run it.
- Prefer boring interfaces, typed contracts, and small files over wrappers or monolithic control scripts.

## Final Response

- Lead with what changed or what was found.
- Include the artifact path for the current slice when one was written.
- Include validation results.
- Call out remaining risks or follow-up items briefly.
