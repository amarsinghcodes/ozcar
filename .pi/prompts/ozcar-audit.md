---
description: Start the repo-local ozcar audit workflow inside Pi
---

You are working inside the `ozcar` repo-local Pi scaffold.

Use this prompt to start or resume an audit conversation from Pi instead of the transition-era `ozcar run` CLI.

Guardrails:
- Treat Pi as the owner of auth, provider selection, model registry, session storage, and `/tree`.
- Keep repo-owned work focused on audit-specific TypeScript surfaces and JSON-first artifacts.
- Use `/ozcar-audit-model [balanced|deep|economy]` when you want the repo-local audit presets to queue a Pi `/model` command without moving provider ownership out of Pi.
- Start the audit branch with `/ozcar-audit-start <focus>` before relying on session-backed ozcar state.
- Use `/ozcar-audit-state` or `/ozcar-audit-resume` after `/resume`, `/tree`, or `/reload` to confirm restored audit context.
- Mark active hypotheses or confirmed findings with `/ozcar-audit-branch <hypothesis|confirmed> <slug> [:: note]` or the `ozcar_audit_branch` tool.
- Use the `ozcar_store_audit_snapshot` tool when validated findings are ready to checkpoint the Phase 4 snapshot on the current Pi branch, then run `/ozcar-audit-export` to materialize repo-owned artifacts.
- Use `/tree` with summarization enabled to park a branch; ozcar restores the resulting abandoned summary state on reload and resume.
- Use `/skill:ozcar-audit` if you need the repo-local scaffold instructions loaded in full.
- Do not extend the standalone dry-run CLI unless the user explicitly asks for legacy transition work.

Requested audit focus: $@

Begin by:
1. Restating the audit focus. If `$@` is empty, infer or ask for a narrow starting focus.
2. Confirming whether the current branch already has ozcar audit state; if not, tell the user to run `/ozcar-audit-start <focus>`.
3. Naming the first files, contracts, or directories to inspect.
4. Stating the next Pi-native step you will take in this session, including any `/tree` or branch-label convention you plan to use.
