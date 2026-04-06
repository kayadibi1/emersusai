## ADDED Requirements

### Requirement: Visuals are relevance gated
The system SHALL generate an in-chat visual artifact only when the user's prompt, the generated answer, and the available source or structural material indicate that a visual would help answer the prompt.

#### Scenario: Explicit visual request with a supportable artifact
- **WHEN** the user asks for a visual, diagram, chart, mockup, interactive widget, or illustration and the system can plan the requested artifact from relevant material
- **THEN** the response SHALL include a typed visual artifact in `cards[]`

#### Scenario: Explicit visual request without enough support
- **WHEN** the user asks for a visual but the system cannot identify enough relevant data, structure, UI intent, interaction model, or illustration content
- **THEN** the response SHALL omit the visual artifact and answer in prose

#### Scenario: Non-visual prompt with incidental numbers or concepts
- **WHEN** the user asks a normal prose question and the answer includes incidental numbers, steps, UI terms, or imagery
- **THEN** the response SHALL NOT include a visual artifact unless the visual is central to answering the prompt

### Requirement: Visual router supports five artifact families
The system SHALL classify relevant visual requests into one of five artifact families: `diagram`, `chart`, `mockup`, `interactive_explainer`, or `art_illustration`.

#### Scenario: Diagram request
- **WHEN** the prompt asks to explain a process, architecture, lifecycle, relationship, or how something works visually
- **THEN** the visual artifact SHALL use `artifact_type: "diagram"`

#### Scenario: Chart request
- **WHEN** the prompt asks to visualize quantitative data, compare metrics, show trends, show proportions, or summarize market/statistical data
- **THEN** the visual artifact SHALL use `artifact_type: "chart"`

#### Scenario: Mockup request
- **WHEN** the prompt asks for a UI, app screen, card, dashboard, form, modal, or product interface visualization
- **THEN** the visual artifact SHALL use `artifact_type: "mockup"`

#### Scenario: Interactive explainer request
- **WHEN** the prompt asks for a calculator, simulation, slider/toggle widget, scenario explorer, or step-through explainer
- **THEN** the visual artifact SHALL use `artifact_type: "interactive_explainer"`

#### Scenario: Art or illustration request
- **WHEN** the prompt asks for decorative SVG art, a conceptual illustration, geometric pattern, landscape, or abstract visual
- **THEN** the visual artifact SHALL use `artifact_type: "art_illustration"`

### Requirement: Chart artifacts use relevant quantitative data
The system SHALL represent chartable quantitative facts with normalized values, display values, units, unit types, labels, surrounding context, relevance scores, confidence scores, and source attribution when available.

#### Scenario: Source-backed chart extraction
- **WHEN** a quantitative fact is extracted from a retrieved source chunk
- **THEN** the fact SHALL include the source identifier or title and the text context that supports the value

#### Scenario: Answer-derived chart extraction
- **WHEN** a quantitative fact is extracted from the model answer rather than a retrieved source
- **THEN** the fact SHALL be marked as answer-derived or assigned lower extraction confidence

#### Scenario: Ambiguous chart unit
- **WHEN** a number cannot be assigned a meaningful unit type or label
- **THEN** the system SHALL exclude it from chartable visual data

#### Scenario: Chart type matches data shape
- **WHEN** chartable data contains comparable categories, trends, proportions, ranges, scatter dimensions, or standalone KPIs
- **THEN** the chart artifact SHALL choose a matching visual form such as bars, lines/timelines, pie/donut or stacked bars, ranges, scatter/bubble charts, or metric grids

### Requirement: Diagram artifacts represent structure
The system SHALL represent diagram artifacts with nodes, edges, labels, groups, and direction when useful.

#### Scenario: Process flow
- **WHEN** the prompt asks how a system, user journey, or workflow operates
- **THEN** the diagram SHALL include ordered nodes and directional edges that match the described process

#### Scenario: Relationship map
- **WHEN** the prompt asks how concepts, entities, or components relate
- **THEN** the diagram SHALL include labeled relationships rather than rendering an unrelated chart or dashboard

### Requirement: Mockup artifacts represent interface layouts
The system SHALL represent mockup artifacts with layout type, sections, fields, content hierarchy, states, and actions.

#### Scenario: Product screen mockup
- **WHEN** the prompt asks what an Emersus screen, card, dashboard, modal, or form could look like
- **THEN** the artifact SHALL render a mock UI layout using prompt-specific labels and realistic interface hierarchy

#### Scenario: Mockup without interaction request
- **WHEN** the prompt asks only for a static UI mockup
- **THEN** the artifact SHALL NOT add unrelated interactive controls

### Requirement: Interactive explainers use safe deterministic controls
The system SHALL represent interactive explainer artifacts with controls, defaults, bounds, formulas or calculation descriptions, output fields, and assumptions.

#### Scenario: Calculator prompt
- **WHEN** the prompt asks for a calculator or scenario model
- **THEN** the artifact SHALL expose controls and deterministic outputs based on declared assumptions

#### Scenario: Step-through prompt
- **WHEN** the prompt asks for a step-through explainer
- **THEN** the artifact SHALL provide step controls and update the displayed explanation without requiring external network access

### Requirement: Art artifacts are decorative or conceptual
The system SHALL represent art/illustration artifacts with safe SVG primitives, palettes, scene descriptions, and optional labels.

#### Scenario: Decorative art prompt
- **WHEN** the prompt asks for abstract, geometric, landscape, or decorative SVG art
- **THEN** the artifact SHALL render art as an illustration and SHALL NOT present it as evidence or quantitative analysis

#### Scenario: Conceptual illustration prompt
- **WHEN** the prompt asks for a conceptual visual metaphor
- **THEN** the artifact SHALL render an illustrative scene that supports the concept without inventing factual claims

### Requirement: Visual artifacts are prompt-specific
The system SHALL make artifact titles, labels, metrics, nodes, controls, panels, and mockup content describe the user's subject matter rather than internal Emersus implementation concepts.

#### Scenario: Market analysis prompt
- **WHEN** the user asks whether there is a market for Emersus and whether investors would support it
- **THEN** the generated visual SHALL use labels such as market size, growth rate, investor signal, comparable raise, risk, or differentiation instead of evidence verdict, source count, or system confidence

#### Scenario: Fitness evidence prompt
- **WHEN** the user asks for a supplement, training, or nutrition comparison
- **THEN** the generated visual SHALL use labels that describe the compared interventions and outcomes instead of generic internal source labels

### Requirement: Renderer supports typed visual artifacts
The frontend SHALL render visual artifacts from a typed contract that includes `artifact_type`, `title`, `subtitle`, `data`, and optional `sources` and `debug` fields.

#### Scenario: Supported visual artifact
- **WHEN** the frontend receives a valid visual artifact with a supported `artifact_type`
- **THEN** it SHALL render a sandboxed iframe artifact using the matching visual family template

#### Scenario: Unsupported visual artifact
- **WHEN** the frontend receives a visual artifact with an unsupported or malformed `artifact_type`
- **THEN** it SHALL safely skip that visual rather than rendering a misleading or broken card

### Requirement: Visual generation is explainable in debug mode
The system SHALL expose debug information describing why a visual was generated or suppressed when debug output is requested.

#### Scenario: Visual generated
- **WHEN** debug output is requested and a visual artifact is generated
- **THEN** the response debug data SHALL include the artifact type, planner reason, and relevant extracted data or structure count

#### Scenario: Visual suppressed
- **WHEN** debug output is requested and a visual artifact is suppressed
- **THEN** the response debug data SHALL include the suppression reason
