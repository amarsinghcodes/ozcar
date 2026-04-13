# ozcar

`ozcar` is a Pi-first audit extension package. Pi owns auth, provider selection, model registry, session storage, and `/tree`; this repo owns the audit-specific prompts, skills, JSON-first artifacts, and extension entrypoints that sit on top of Pi.

The primary way to load `ozcar` is as a Pi package from any repo or cwd with `pi -e /Users/x/oz/ozcar`. Starting Pi inside this checkout still auto-discovers `.pi/extensions/ozcar/index.ts`. The standalone `ozcar` CLI remains compatibility-only for transition-era dry-run testing.

## Pi Package Quickstart

1. From another repo or cwd, load the package with `pi -e /Users/x/oz/ozcar`.
2. If you are already in `/Users/x/oz/ozcar`, starting Pi there still auto-discovers `.pi/extensions/ozcar/index.ts`.
3. Run `/ozcar` to confirm the repo-local scaffold is loaded.
4. Run `/ozcar-audit-model` to inspect the repo-local audit presets, or `/ozcar-audit-model balanced` to queue a Pi `/model` command from the current shell configuration.
5. Run `/ozcar-audit-start <focus>` to create the current branch's session-backed audit state with a collision-resistant default audit id, or run `/ozcar-audit-start <audit-id> :: <focus>` to pin a custom durable audit root.
6. Run `/ozcar-audit <focus>` to start the repo-local audit prompt.
7. Run `/ozcar-audit-state` or `/ozcar-audit-resume` after `/resume`, `/tree`, or `/reload` to confirm restored state.
8. Run `/ozcar-audit-branch <hypothesis|confirmed> <slug> [:: note]` to label important audit branches before navigating with `/tree`.
9. Save a validated Phase 4 snapshot JSON file and run `/ozcar-audit-checkpoint path/to/snapshot.json` to checkpoint it on the current Pi branch.
10. Run `/ozcar-audit-export` to materialize the stored Pi-backed snapshot into `.ai-auditor/audits/<audit-id>/`, including the stable `exports/findings.json` comparison surface.
11. Use `/tree` with summarization enabled to park a branch; ozcar persists the abandoned summary state on the summarized branch automatically.
12. Run `/skill:ozcar-audit <focus>` when you want the fuller repo-local instructions loaded explicitly.
13. Run `/reload` after editing files under `.pi/`.

For agent turns, the extension still mirrors the checkpoint backend through `ozcar_store_audit_snapshot`, but the human workflow is `/ozcar-audit-checkpoint <snapshot.json>` then `/ozcar-audit-export`.

## Pi Package Surface

- `package.json` `pi` manifest: package-level Pi entrypoint for `pi -e /path/to/ozcar`
- `.pi/extensions/ozcar/index.ts`: project-local extension entrypoint
- `.pi/prompts/ozcar-audit.md`: prompt-led audit kickoff
- `.pi/skills/ozcar-audit/SKILL.md`: repo-local audit skill

The current extension commands are:

- `/ozcar-audit-model`: list or queue the repo-local `balanced`, `deep`, and `economy` Pi `/model` presets from `OZCAR_AUDIT_MODEL_*`
- `/ozcar-audit-start`: create or restart the branch-local audit state, with explicit `<audit-id> :: <focus>` support when you want to pin the audit root manually
- `/ozcar-audit-resume`: re-surface the restored state on the current branch
- `/ozcar-audit-state`: inspect the current audit state plus branch-label conventions
- `/ozcar-audit-branch`: checkpoint the current branch as a hypothesis or confirmed finding before a summarized `/tree`
- `/ozcar-audit-checkpoint`: validate and store a Phase 4 snapshot JSON file on the current branch before export
- `/ozcar-audit-export`: materialize deterministic audit artifacts plus the stable validated-only `exports/findings.json` comparison surface from the latest snapshot stored on the current Pi branch

Branch conventions use Pi's native tree features instead of a parallel store:

- hypotheses => `audit:hypothesis:<slug>`
- confirmed findings => `audit:confirmed:<finding-id>`
- abandoned summarized branches => `audit:abandoned:<slug>`

If the agent needs to checkpoint a branch during a turn, the extension also registers the `ozcar_audit_branch` tool with the same active-branch semantics.
When validated findings are ready for durable export, humans should use `/ozcar-audit-checkpoint <snapshot.json>` and agent turns can still use `ozcar_store_audit_snapshot`; both paths store the same validated Phase 4 snapshot contract before `/ozcar-audit-export`.

Phase 4 durable artifacts live under `.ai-auditor/audits/<audit-id>/`:

- `audit.json`
- `scope.json`
- `findings/<finding-id>/{finding,triage,validation}.json`
- `summary.md`
- `confirmed-findings.md`
- `exports/findings.json`

## Phase 6 Comparison Contract

Downstream comparison work should consume `.ai-auditor/audits/<audit-id>/exports/findings.json`.

- The export is rebuilt from validated findings only; Pi transcripts, branch summaries, and session files are not part of the comparison contract.
- The checked-in fixture at `tests/fixtures/phase6/findings-export.expected.json` pins the byte-stable surface downstream adapters should read.
- The export now supports an optional top-level `reportedMetrics` block with authoritative `durationSeconds`, `costUsd`, `inputTokens`, and `outputTokens` values sourced only from ozcar contract data.
- When no authoritative reported metrics are stored, `reportedMetrics` is omitted entirely; when only some are available, ozcar emits only those present fields and leaves measured wall-clock external.
- Provider and model are comparison assumptions captured externally from Pi's active `/model` selection or the benchmark harness configuration; they are not authoritative `findings.json` fields.
- Time budget remains a comparison assumption captured externally by the benchmark harness, and measured wall-clock remains external to ozcar's authoritative reported-metrics surface.
- Downstream adapter updates that read `reportedMetrics` remain external follow-up outside this repo.

## Transition-Era CLI

The compiled CLI and dry-run runtime under `src/` remain available for transition-era testing only. It is compatibility-only; the Pi package surface is the primary entrypoint now.

Repo validation stays the same:

- `npm run build`
- `npm test`

Optional live Pi proofs for the Pi extension surface:

- `npm test -- tests/pi-extension.integration.test.ts`
- `OZCAR_RUN_INTERACTIVE_TREE_PROOF=1 npm test -- tests/pi-extension.interactive.test.ts`
