# ozcar

`ozcar` is currently a Pi-first audit extension pack. Pi owns auth, provider selection, model registry, session storage, and `/tree`; this repo owns the audit-specific prompts, skills, JSON-first artifacts, and extension entrypoints that sit on top of Pi.

The standalone `ozcar` CLI still exists as a transition-era dry-run seam, but new workflow entry should happen in Pi inside this repo.

## Pi-First Quickstart

1. Open the repo root in a terminal: `cd /Users/x/oz/ozcar`
2. Start Pi in this directory. Pi auto-discovers `.pi/extensions/ozcar/index.ts`.
3. Run `/ozcar` to confirm the repo-local scaffold is loaded.
4. Run `/ozcar-audit-start <focus>` to create the current branch's session-backed audit state.
5. Run `/ozcar-audit <focus>` to start the repo-local audit prompt.
6. Run `/ozcar-audit-state` or `/ozcar-audit-resume` after `/resume`, `/tree`, or `/reload` to confirm restored state.
7. Run `/ozcar-audit-branch <hypothesis|confirmed> <slug> [:: note]` to label important audit branches before navigating with `/tree`.
8. Use `/tree` with summarization enabled to park a branch; ozcar persists the abandoned summary state on the summarized branch automatically.
9. Run `/skill:ozcar-audit <focus>` when you want the fuller repo-local instructions loaded explicitly.
10. Run `/reload` after editing files under `.pi/`.

If auto-discovery is unavailable in your Pi session, load the extension explicitly with `pi -e ./.pi/extensions/ozcar/index.ts`.

## Repo-Local Pi Surface

- `.pi/extensions/ozcar/index.ts`: project-local extension entrypoint
- `.pi/prompts/ozcar-audit.md`: prompt-led audit kickoff
- `.pi/skills/ozcar-audit/SKILL.md`: repo-local audit skill

The current Phase 3 extension commands are:

- `/ozcar-audit-start`: create or restart the branch-local audit state
- `/ozcar-audit-resume`: re-surface the restored state on the current branch
- `/ozcar-audit-state`: inspect the current audit state plus branch-label conventions
- `/ozcar-audit-branch`: checkpoint the current branch as a hypothesis or confirmed finding before a summarized `/tree`

Branch conventions use Pi's native tree features instead of a parallel store:

- hypotheses => `audit:hypothesis:<slug>`
- confirmed findings => `audit:confirmed:<finding-id>`
- abandoned summarized branches => `audit:abandoned:<slug>`

If the agent needs to checkpoint a branch during a turn, the extension also registers the `ozcar_audit_branch` tool with the same active-branch semantics.

## Transition-Era CLI

The compiled CLI and dry-run runtime under `src/` remain available for transition-era testing only. Phase 3 work should not extend that surface; the Pi extension pack is the primary entrypoint now.

Repo validation stays the same:

- `npm run build`
- `npm test`

Optional live Pi proofs for the Phase 3 extension surface:

- `npm test -- tests/pi-extension.integration.test.ts`
- `OZCAR_RUN_INTERACTIVE_TREE_PROOF=1 npm test -- tests/pi-extension.interactive.test.ts`
