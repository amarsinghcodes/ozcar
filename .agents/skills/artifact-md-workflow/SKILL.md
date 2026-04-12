---
name: artifact-markdown-workflow
description: Writes workflow outputs to repo-local Markdown artifacts under docs/ using the checked-in local templates. Use when plan, execution, fix, or review work should persist in this repo.
---

# Artifact Markdown Workflow

This repo owns its persisted Markdown artifact contract locally.

Use this skill when the workflow result should be written under `docs/`
instead of existing only in terminal output.

If the current request does not call for repo-local persistence, terminal-only
output is valid and no `docs/*` artifact is required.

## Local Ownership

- `.agents/skills/artifact-md-workflow/SKILL.md` owns the persistence rules.
- `.agents/templates/*.md` own the canonical section order and comments.
- `docs/plans/`, `docs/execs/`, `docs/fixes/`, and `docs/reviews/` are the
  canonical artifact output locations for this repo.
- `PLAN.md` remains the canonical implementation contract unless `AGENTS.md`
  explicitly says otherwise. Historical `docs/plans/` files are records.
- A missing `docs/execs/`, `docs/fixes/`, or `docs/reviews/` file is not drift
  by itself; require a persisted-turn trigger before expecting one.

## Prompt-Bank Compatibility

`prompt-bank` may target this repo's local persistence surface, but it does not
own it.

When prompt-authoring workflows such as `fp`, `pp`, or `pup` persist output
here:

- shared `init` reaches this local `docs/plans/` path only through its
  delegated `pp` handoff; treat that prompt-authoring write as `pp` behavior,
  not as a separate local `init` contract
- write a new `docs/plans/{UTC_TIMESTAMP}_PLAN.md` artifact using the local
  plan template
- keep `PLAN.md` canonical unless repo instructions explicitly promote another
  path
- keep the persisted plan artifact focused on the request, next slice,
  constraints, validation, and gates
- keep the generated prompt packets separate from later execution artifacts
- make those prompt packets point later implementation at `docs/execs/` and
  later review or repair loops at `docs/reviews/` and `docs/fixes/`
- if the same turn proceeds from that prompt-authoring step into actual
  implementation, write a separate `docs/execs/{UTC_TIMESTAMP}_EXEC.md`
  artifact that references the new plan artifact before finishing
- routine same-phase fix or review follow-ups do not need a fresh
  `docs/plans/{UTC_TIMESTAMP}_PLAN.md` when `PLAN.md` is unchanged and the user
  wants direct implementation or review instead of prompt authoring

When execution work persists here:

- write `docs/execs/{UTC_TIMESTAMP}_EXEC.md`

When fix work persists here:

- write `docs/fixes/{UTC_TIMESTAMP}_FIX.md`

When review work persists here:

- write `docs/reviews/{UTC_TIMESTAMP}_REVIEW.md`

## Filename Contract

- plan: `docs/plans/{UTC_TIMESTAMP}_PLAN.md`
- execution: `docs/execs/{UTC_TIMESTAMP}_EXEC.md`
- fix: `docs/fixes/{UTC_TIMESTAMP}_FIX.md`
- review: `docs/reviews/{UTC_TIMESTAMP}_REVIEW.md`

UTC timestamps must use `YYYY-MM-DDTHH-MM-SSZ`.

## Required Behavior

- Create a new artifact file for each new persisted result unless the user
  explicitly asks to update an existing artifact.
- If one turn spans both plan persistence and execution, emit both artifacts in
  order: plan first, execution second.
- Do not treat metadata-only drift in older artifacts as phase-blocking by
  default. Fix it opportunistically when touched, but only escalate it to a
  blocking gap when current-loop traceability is wrong or the next step would
  be pointed at the wrong artifact.
- Use the local template for the artifact type.
- Do not rename, remove, or reorder template sections.
- Fill every required section.
- Keep `## REFERENCE` terse. Use only the required identifier line(s); do not
  spill rationale, status, or evidence into that section.
- `## REFERENCE` is required metadata, but it is not the first dynamic section
  in this repo's local artifact contract.
- Within each section, lead with durable repo or workflow framing before
  request-specific detail when the template allows it.
- Move temp paths, timestamps, command transcripts, and one-off evidence later,
  usually into `## VALIDATION` or the trailing part of the section instead of
  the earliest body lines.
- Write `None` for empty optional sections.
- Keep terminal responses short and artifact-oriented once the file exists.

## Reference Rules

- plan artifact:
  - `- REQUEST: <short description>`
  - optionally `- PRIOR PLAN: docs/plans/<timestamp>_PLAN.md`
- execution artifact:
  - `- PLAN: docs/plans/<timestamp>_PLAN.md`
- fix artifact:
  - `- REVIEW: docs/reviews/<timestamp>_REVIEW.md`
  - if no file exists, use `- REVIEW MESSAGE: <short identifier>`
  - use the review artifact that directly triggered the current fix loop rather
    than an older ancestor review unless the user explicitly asks otherwise
- review artifact:
  - `- TARGET: docs/execs/<timestamp>_EXEC.md`
  - or `- TARGET: docs/fixes/<timestamp>_FIX.md`

## Canonical Section Order

- plan artifact:
  - `## GOAL`
  - `## SCOPE`
  - `## CONSTRAINTS`
  - `## PHASES`
  - `## VALIDATION`
  - `## GATES`
  - `## REFERENCE`
  - `## OPEN QUESTIONS`
- execution artifact:
  - `## PLAN`
  - `## CHANGES`
  - `## VALIDATION`
  - `## REFERENCE`
  - `## OPEN QUESTIONS`
  - `## NEXT`
- review artifact:
  - `## VERDICT`
  - `## BUGS`
  - `## GAPS`
  - `## ANTI-PATTERNS`
  - `## IMPROVEMENTS`
  - `## REFERENCE`
- fix artifact:
  - `## PLAN`
  - `## CHANGES`
  - `## VALIDATION`
  - `## RISKS`
  - `## REFERENCE`
