## Why

Emersus visuals are currently too narrow and too tied to internal evidence/status concepts. The product should instead generate Claude-style prompt-specific artifacts only when they help answer the user's request. Those artifacts need to cover five visual families: diagrams, charts, mockups, interactive explainers, and SVG art/illustrations.

The important distinction is that not every visual is a data chart. Charts need quantitative data from relevant sources. Diagrams need process or relationship structure. Mockups need UI/product layout intent. Interactive explainers need variables, controls, and deterministic calculations. Art/illustrations need a decorative or conceptual visual request and must not be used to imply evidence.

## What Changes

- Add a prompt-relevant visual router that chooses among five visual families: `diagram`, `chart`, `mockup`, `interactive_explainer`, and `art_illustration`.
- Add family-specific relevance gates so visuals are emitted only when the user's prompt and answer benefit from that visual type.
- Add quantitative extraction for chart artifacts, including value, unit, label, context, source attribution, and confidence.
- Add structural extraction for diagram artifacts, including nodes, edges, groups, labels, and flow direction.
- Add UI planning for mockup artifacts, including screen/card/form sections, content hierarchy, states, and actions.
- Add safe interaction planning for explainer artifacts, including controls, formulas, defaults, bounds, and output fields.
- Add SVG illustration planning for decorative or conceptual visuals, including scene primitives, palette, and labels when useful.
- Add a typed visual artifact contract so the frontend can render prompt-specific iframe artifacts without hard-coding internal concepts like evidence verdict, source count, or system confidence.
- Add suppression safeguards when the prompt does not call for a visual, data/structure is insufficient, or the requested visual would mislead.

## Capabilities

### New Capabilities

- `prompt-relevant-visual-artifacts`: Selects and renders diagrams, charts, mockups, interactive explainers, and art/illustrations only when relevant to the user's prompt and supported by the available answer/source material.

### Modified Capabilities

None.

## Impact

- Affects the Emersus recommendation workflow in `api/emersus/workflow.js`.
- Affects the chat visual renderer in `shared/react-chat-app.js`.
- Extends the response payload with typed visual artifacts in `cards[]`.
- Requires fixtures for visual family routing, chart data extraction, artifact suppression, and safe frontend fallback behavior.
