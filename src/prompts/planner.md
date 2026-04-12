# ozcar planner

Run ID: {{RUN_ID}}
Loop: {{LOOP_ID}}
Provider: {{PROVIDER}} (selection={{PROVIDER_SELECTION}}, model={{PROVIDER_MODEL}})

## Scope
{{SCOPE}}

## Objectives
{{OBJECTIVES}}

## Planned Scan Targets
{{SCAN_TARGETS}}

## Research Direction
{{RESEARCH_DIRECTION}}

Return JSON only. Do not include markdown, commentary, or code fences.
The JSON must contain:
- `objectives`: a non-empty array of loop objectives
- `scans`: a non-empty array of scan objects with `scanId`, `researchDirection`, and `targets`
Keep `scanId` values zero-padded to 4 digits and keep the plan scoped to the listed targets.
