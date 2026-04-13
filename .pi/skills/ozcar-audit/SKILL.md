---
name: ozcar-audit
description: Starts or continues ozcar's repo-local audit workflow inside Pi. Use when you need the project-local prompt, skill, and current phase guardrails for this repo.
---

# Ozcar Audit

## When To Use

Use this skill when you are working inside `/Users/x/oz/ozcar` with Pi and need the repo-local audit scaffold instead of the standalone `ozcar` CLI.

## Guardrails

- Read `AGENTS.md` and `PLAN.md` first.
- Stay inside the current phase from `PLAN.md`; do not pull later phases forward.
- Pi owns auth, provider resolution, model registry, session storage, and `/tree`.
- Keep audit-specific work TypeScript-only and JSON-first.
- Treat the standalone CLI as transition-era dry-run surface only unless the user explicitly requests it.

## Pi-First Entry

1. Run `/ozcar` to confirm the repo-local extension surface is loaded.
2. Run `/ozcar-audit-model` to inspect the repo-local audit presets, or `/ozcar-audit-model balanced|deep|economy` to queue a Pi `/model` command from `OZCAR_AUDIT_MODEL_*`.
3. Run `/ozcar-audit-start <focus>` to create the current branch's session-backed ozcar audit state.
4. Run `/ozcar-audit <focus>` to start the prompt-led audit entrypoint.
5. Use `/ozcar-audit-state` or `/ozcar-audit-resume` after `/resume`, `/tree`, or `/reload` to verify restored state.
6. Use `/ozcar-audit-branch <hypothesis|confirmed> <slug> [:: note]` or the `ozcar_audit_branch` tool to mark important audit branches before navigating with `/tree`.
7. Use the `ozcar_store_audit_snapshot` tool when validated findings are ready to checkpoint the Phase 4 snapshot on the current Pi branch, then run `/ozcar-audit-export` to materialize repo-owned JSON contracts, rebuilt reports, and `exports/findings.json`.
8. Use `/tree` with summarization enabled to park a branch; ozcar restores the abandoned summary state from Pi's branch summary and session entries.

## Repo-Local Surface

- Extension entrypoint: `.pi/extensions/ozcar/index.ts`
- Prompt entrypoint: `.pi/prompts/ozcar-audit.md`
- Skill entrypoint: `.pi/skills/ozcar-audit/SKILL.md`

## Current Scope

This skill now covers the approved Pi-native audit workflow, the Phase 4 artifact seam, and the Phase 5 audit model-preset helper. It proves session-backed ozcar audit-state restoration on `session_start` and `session_tree`, tree-aware label conventions for hypotheses, confirmed findings, and abandoned branches, plus the repo-owned export path that checkpoints validated audit snapshots into Pi state and materializes deterministic JSON artifacts and rebuilt reports from that stored branch state. Pi still owns `/login`, provider resolution, the model registry, and streaming, while provider overrides and benchmark-comparison orchestration remain later phases from `PLAN.md`.
