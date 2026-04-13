# ozcar

`ozcar` is currently a Pi-first audit extension pack. Pi owns auth, provider selection, model registry, session storage, and `/tree`; this repo owns the audit-specific prompts, skills, JSON-first artifacts, and extension entrypoints that sit on top of Pi.

The standalone `ozcar` CLI still exists as a transition-era dry-run seam, but new workflow entry should happen in Pi inside this repo.

## Pi-First Quickstart

1. Open the repo root in a terminal: `cd /Users/x/oz/ozcar`
2. Start Pi in this directory. Pi auto-discovers `.pi/extensions/ozcar/index.ts`.
3. Run `/ozcar` to confirm the repo-local scaffold is loaded.
4. Run `/ozcar-audit-model` to inspect the repo-local audit presets, or `/ozcar-audit-model balanced` to queue a Pi `/model` command from the current shell configuration.
5. Run `/ozcar-audit-start <focus>` to create the current branch's session-backed audit state.
6. Run `/ozcar-audit <focus>` to start the repo-local audit prompt.
7. Run `/ozcar-audit-state` or `/ozcar-audit-resume` after `/resume`, `/tree`, or `/reload` to confirm restored state.
8. Run `/ozcar-audit-branch <hypothesis|confirmed> <slug> [:: note]` to label important audit branches before navigating with `/tree`.
9. Use the `ozcar_store_audit_snapshot` tool when you have a validated Phase 4 audit snapshot ready to checkpoint on the current Pi branch.
10. Run `/ozcar-audit-export` to materialize the stored Pi-backed snapshot into `.ai-auditor/audits/<audit-id>/`, including the stable `exports/findings.json` comparison surface.
11. Use `/tree` with summarization enabled to park a branch; ozcar persists the abandoned summary state on the summarized branch automatically.
12. Run `/skill:ozcar-audit <focus>` when you want the fuller repo-local instructions loaded explicitly.
13. Run `/reload` after editing files under `.pi/`.

If auto-discovery is unavailable in your Pi session, load the extension explicitly with `pi -e ./.pi/extensions/ozcar/index.ts`.

## Repo-Local Pi Surface

- `.pi/extensions/ozcar/index.ts`: project-local extension entrypoint
- `.pi/prompts/ozcar-audit.md`: prompt-led audit kickoff
- `.pi/skills/ozcar-audit/SKILL.md`: repo-local audit skill

The current extension commands are:

- `/ozcar-audit-model`: list or queue the repo-local `balanced`, `deep`, and `economy` Pi `/model` presets from `OZCAR_AUDIT_MODEL_*`
- `/ozcar-audit-start`: create or restart the branch-local audit state
- `/ozcar-audit-resume`: re-surface the restored state on the current branch
- `/ozcar-audit-state`: inspect the current audit state plus branch-label conventions
- `/ozcar-audit-branch`: checkpoint the current branch as a hypothesis or confirmed finding before a summarized `/tree`
- `/ozcar-audit-export`: materialize deterministic audit artifacts plus the stable validated-only `exports/findings.json` comparison surface from the latest snapshot stored on the current Pi branch

Branch conventions use Pi's native tree features instead of a parallel store:

- hypotheses => `audit:hypothesis:<slug>`
- confirmed findings => `audit:confirmed:<finding-id>`
- abandoned summarized branches => `audit:abandoned:<slug>`

If the agent needs to checkpoint a branch during a turn, the extension also registers the `ozcar_audit_branch` tool with the same active-branch semantics.
When validated findings are ready for durable export, the extension also registers `ozcar_store_audit_snapshot` so the Phase 4 snapshot can be stored on the branch before `/ozcar-audit-export`.

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
- Provider and model are comparison assumptions captured externally from Pi's active `/model` selection or the benchmark harness configuration; they are not authoritative `findings.json` fields.
- Time budget is a comparison assumption captured externally by the benchmark harness or measured wall-clock; `ozcar` does not currently persist authoritative reported runtime, token, or cost fields in the export contract.

## Transition-Era CLI

The compiled CLI and dry-run runtime under `src/` remain available for transition-era testing only. Phase 5 work should not extend that surface; the Pi extension pack is the primary entrypoint now.

Repo validation stays the same:

- `npm run build`
- `npm test`

Optional live Pi proofs for the Pi extension surface:

- `npm test -- tests/pi-extension.integration.test.ts`
- `OZCAR_RUN_INTERACTIVE_TREE_PROOF=1 npm test -- tests/pi-extension.interactive.test.ts`
