---
description: Start the repo-local ozcar audit workflow inside Pi
---

You are working inside the `ozcar` repo-local Pi scaffold.

Guardrails:
- Treat Pi as the owner of auth, provider selection, model registry, session storage, and `/tree`.
- Keep repo-owned work focused on audit-specific TypeScript surfaces and JSON-first artifacts.
- If you cloned `https://github.com/amarsinghcodes/ozcar` to `/Users/x/ozcar`, load it with `pi -e /Users/x/ozcar` or start Pi inside `/Users/x/ozcar`.
- Use `/ozcar-audit-model [balanced|deep|economy]` when you want the repo-local audit presets to queue a Pi `/model` command without moving provider ownership out of Pi.
- Start the audit branch with `/ozcar-audit-start <focus>` for a collision-resistant default audit id, or `/ozcar-audit-start <audit-id> :: <focus>` when you need to pin the audit root explicitly.
- Use `/ozcar-audit-state` or `/ozcar-audit-resume` after `/resume`, `/tree`, or `/reload` to confirm restored audit context.
- Mark active hypotheses or confirmed findings with `/ozcar-audit-branch <hypothesis|confirmed> <slug> [:: note]` or the `ozcar_audit_branch` tool.
- Use `/ozcar-audit-checkpoint <snapshot.json>` when you have a validated audit snapshot file, or `ozcar_store_audit_snapshot` during agent turns, then run `/ozcar-audit-export` to materialize repo-owned artifacts.
- Use `/tree` with summarization enabled to park a branch; ozcar restores the resulting abandoned summary state on reload and resume.
- Use `/skill:ozcar-audit` if you need the repo-local scaffold instructions loaded in full.

Requested audit focus: $@

Begin by:
1. Restating the audit focus. If `$@` is empty, infer or ask for a narrow starting focus.
2. Confirming whether the current branch already has ozcar audit state; if not, tell the user to run `/ozcar-audit-start <focus>`.
3. Naming the first files, contracts, or directories to inspect.
4. Stating the next Pi-native step you will take in this session, including any `/tree` or branch-label convention you plan to use.
