## Context

The current visual pipeline can render sandboxed iframe artifacts in chat, but it still behaves like a narrow dashboard/card system. The user expects Claude-like generated artifacts: prompt-specific visuals that match the shape of the request. In Claude's examples, the visual can be a flow diagram, Chart.js-style chart, UI mockup, interactive calculator/simulation, or SVG illustration.

The target behavior is a visual router that decides whether a visual belongs in the answer at all, then chooses the correct family and builds a safe typed artifact. The visual should be about the user's subject matter, not internal Emersus concepts like system confidence, evidence verdicts, or source bookkeeping.

## Goals / Non-Goals

**Goals:**

- Support five visual families: diagrams, charts, mockups, interactive explainers, and art/illustrations.
- Gate visuals by prompt intent, answer content, available source/data support, and the usefulness of the visual type.
- Extract quantitative facts only for chart-like artifacts, with labels, units, source references, surrounding context, and confidence.
- Extract structural relationships for diagrams, UI hierarchy for mockups, deterministic variables for interactive explainers, and scene primitives for art/illustrations.
- Render visual artifacts through the existing sandboxed iframe pattern.
- Suppress visuals when the selected family would be weak, off-topic, misleading, or better represented as prose.

**Non-Goals:**

- This change does not require the model to generate arbitrary executable code.
- This change does not replace the main text answer or the right-rail source list.
- This change does not require visuals for every response.
- This change does not create an unrestricted browser app builder.
- This change does not use decorative art to represent quantitative or evidence-backed claims.

## Decisions

1. Use a visual router before any artifact builder.

The backend should first decide whether a visual is relevant, then classify the request into one of five families:

- `diagram`: flowcharts, structural diagrams, lifecycle diagrams, architecture diagrams, causal/relationship maps, process explainers.
- `chart`: bar, line, pie/donut, scatter, bubble, timeline, range, or KPI grids built from quantitative data.
- `mockup`: UI cards, dashboards, forms, modals, app screens, product concepts, feature layouts.
- `interactive_explainer`: calculators, sliders, toggles, simulations, step-through explainers, scenario tools.
- `art_illustration`: decorative SVG art, conceptual illustrations, geometric patterns, landscapes, abstract visuals.

Alternative considered: keep one generic `dashboard_artifact`. That is simpler, but it repeats the current problem: visuals feel generic and fail to match the user's mental model.

2. Use family-specific planners instead of one quantitative extractor.

Charts should extract quantitative facts with source/context metadata. Diagrams should extract entities and relationships. Mockups should extract UI content and hierarchy. Interactive explainers should define inputs, calculations, and outputs. Art should define a scene/palette/primitives and remain clearly illustrative.

Alternative considered: infer everything from final answer text with regexes. That can work for a few dashboard metrics, but it cannot reliably create diagrams, mockups, or interactive tools.

3. Keep the frontend sandboxed but structured.

The frontend should keep the Claude-like iframe container. The backend should send typed data, not arbitrary HTML. A normalized payload can look like:

```json
{
  "type": "visual_artifact",
  "artifact_type": "chart",
  "title": "Market size and investor signal",
  "subtitle": "Relevant segments for Emersus",
  "data": {},
  "sources": [],
  "debug": {}
}
```

The renderer then chooses an iframe document layout based on `artifact_type`.

Alternative considered: ask the model to emit complete HTML/CSS/JS. That is more flexible, but it raises safety, validation, and consistency risks. Typed artifacts are safer for the first implementation.

4. Charts require relevance and data integrity.

Chart artifacts should require relevant quantitative facts. Each fact should include `label`, `value`, `unit`, `unit_type`, `display_value`, `context`, `source_id`, `source_title`, `relevance_score`, and `confidence` when available. The chart builder should select the chart form based on data shape:

- Comparable categories with the same unit -> bar/ranked bars.
- Values over time -> line/timeline.
- Part-to-whole percentages -> pie/donut/stacked bar.
- Two numeric dimensions -> scatter/bubble.
- Standalone KPIs -> metric grid.
- Protocol min/max values -> range plot.

5. Non-chart visuals must not pretend to be evidence.

Diagrams, mockups, interactive explainers, and art can use sourced or answer-derived content, but they should not display decorative or simulated content as if it were retrieved evidence. If a number drives a calculation in an interactive explainer, the artifact should expose assumptions/defaults.

6. Suppress visuals instead of degrading to misleading artifacts.

If the router cannot identify a useful visual family or the chosen planner lacks enough structure/data, the backend should return no visual card. If the user explicitly asks for a visual but the system cannot support it, the assistant should explain in prose what is missing.

## Risks / Trade-offs

- Weak routing could emit the wrong visual family -> add fixtures for each family and negative prompts.
- Weak chart extraction could produce incorrect charts -> require source references, confidence thresholds, and suppression rules.
- Interactive explainers can be misleading if formulas are invented -> restrict them to deterministic, named formulas or clearly labeled approximations.
- Mockups can drift into arbitrary app generation -> keep them as visual static mockups unless the artifact type is explicitly interactive.
- Art/illustrations may feel off-brand -> use the existing Emersus visual system and keep art clearly decorative.
- Typed renderers are less flexible than arbitrary generated HTML -> start typed for safety, then expand layouts once reliability is proven.

## Migration Plan

1. Replace the current prompt-specific dashboard builder with a `visual_artifact_plan` router.
2. Add artifact builders for the five families, starting with chart and diagram, then mockup, interactive explainer, and art/illustration.
3. Keep legacy `dashboard_artifact` support as a fallback until `visual_artifact` covers existing prompts.
4. Update the React artifact renderer to branch by `artifact_type`.
5. Add debug fields explaining why a visual was generated or suppressed.
6. Validate with prompt fixtures for market charts, process diagrams, UI mockups, calculators/simulations, SVG illustrations, and non-visual prompts.

## Open Questions

- Should explicit visual requests lower the confidence threshold for chart artifacts, or only for non-chart artifacts?
- Should interactive explainers be allowed to use simple inline JavaScript inside the iframe, or should interactions be driven by prebuilt renderer templates only?
- Should a user be able to ask for a specific family, such as "make this a diagram," and override the router when the content supports it?
