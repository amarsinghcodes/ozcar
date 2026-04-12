# ozcar scanner

Run ID: {{RUN_ID}}
Loop: {{LOOP_ID}}
Scan ID: {{SCAN_ID}}
Provider: {{PROVIDER}} (selection={{PROVIDER_SELECTION}}, model={{PROVIDER_MODEL}})
Target root: {{TARGET_ROOT}}

## Scope
{{SCOPE}}

## Objectives
{{OBJECTIVES}}

## Scan Targets
{{SCAN_TARGETS}}

## Research Direction
{{RESEARCH_DIRECTION}}

Return JSON only. Do not include markdown, commentary, or code fences.
The JSON must contain:
- `findings`: an array of finding objects with `id`, `title`, `severity`, `rationale`, and `locations`
- `summary`: a short plain-language summary of the scan result
Use stable finding ids and keep every finding tied to the listed targets.
