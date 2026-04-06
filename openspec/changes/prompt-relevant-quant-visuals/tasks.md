## 1. Visual Router and Contract

- [x] 1.1 Define a normalized `visual_artifact` payload with `artifact_type`, `title`, `subtitle`, `data`, `sources`, and optional `debug` fields.
- [x] 1.2 Add a visual relevance gate that considers prompt intent, answer content, retrieved/source material, and whether a visual would improve the answer.
- [x] 1.3 Add artifact family routing for `diagram`, `chart`, `mockup`, `interactive_explainer`, and `art_illustration`.
- [x] 1.4 Add suppression reasons for cases where the user asks for a visual but the available data, structure, or prompt intent is insufficient.
- [x] 1.5 Keep legacy `dashboard_artifact` rendering as a temporary fallback until `visual_artifact` covers the same prompts.

## 2. Artifact Planning

- [x] 2.1 Add chart planning with quantitative fact extraction from relevant source chunks and answer text, including value, unit, unit type, label, context, source attribution, relevance score, and confidence.
- [x] 2.2 Add chart type selection for metric grids, bars, lines/timelines, pie/donut or stacked proportions, scatter/bubble, and ranges.
- [x] 2.3 Add diagram planning with nodes, edges, groups, labels, direction, and optional click/follow-up metadata.
- [x] 2.4 Add mockup planning with layout type, sections, fields, card/form/dashboard content, states, and actions.
- [x] 2.5 Add interactive explainer planning with controls, defaults, bounds, formulas/calculation descriptions, output fields, and assumptions.
- [x] 2.6 Add art/illustration planning with scene primitives, palette, labels when useful, and a flag that the visual is decorative/conceptual.

## 3. Frontend Rendering

- [x] 3.1 Update the React chat renderer to branch artifact rendering by `artifact_type`.
- [x] 3.2 Implement iframe layouts for diagram artifacts using SVG nodes and connectors.
- [x] 3.3 Implement iframe layouts for chart artifacts using safe predefined chart templates.
- [x] 3.4 Implement iframe layouts for mockup artifacts such as cards, dashboards, forms, modals, and app screens.
- [x] 3.5 Implement iframe layouts for interactive explainers with safe controls such as sliders, toggles, calculators, simulations, and step-through states.
- [x] 3.6 Implement iframe layouts for art/illustration artifacts using safe SVG primitives.
- [x] 3.7 Add safe fallback behavior for unsupported or malformed visual artifact payloads.
- [x] 3.8 Preserve the existing chat answer, source rail, and history behavior while rendering visual artifacts.

## 4. Verification

- [x] 4.1 Add fixture tests for prompts that should generate diagrams.
- [x] 4.2 Add fixture tests for prompts that should generate charts from quantitative source/answer data.
- [x] 4.3 Add fixture tests for prompts that should generate UI mockups.
- [x] 4.4 Add fixture tests for prompts that should generate interactive explainers.
- [x] 4.5 Add fixture tests for prompts that should generate art/illustrations.
- [x] 4.6 Add fixture tests for prompts with incidental numbers or vague visual intent that should not generate visuals.
- [x] 4.7 Run JavaScript syntax checks for backend and frontend modules after implementation.
- [ ] 4.8 Manually test the chat page with at least one prompt for each visual family and one prompt that correctly suppresses visuals.
