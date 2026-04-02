# Design System Specification: Clinical Precision & Kinetic Growth

## 1. Overview & Creative North Star: "The Synthetic Laboratory"
The Creative North Star for this design system is **The Synthetic Laboratory**. This aesthetic rejects the "generic SaaS" look in favor of a high-performance, editorial atmosphere that feels like a premium scientific journal meets an elite athletic performance dashboard. 

We break the "template" look by utilizing **Kinetic Asymmetry**. Instead of perfectly centered grids, we use heavy left-aligned typography contrasted against expansive negative space and overlapping data visualizations. We treat the UI not as a flat screen, but as a series of high-fidelity glass plates layered over a deep, charcoal void.

## 2. Colors: Tonal Depth & Bioluminescent Accents
Our palette is rooted in the "Deep Charcoal" of the void, punctuated by "Electric Blue" and "Lime Green" to represent biological energy and data accuracy.

### Color Strategy
- **Primary (`#85adff`):** Used for data-critical paths and progress tracking. It represents the "Scientific" mind.
- **Secondary (`#9ffb00`):** Our "Bioluminescent" accent. Reserved for peak performance metrics and "Success" states. It is the "Motivating" force.
- **Surface Strategy:** We use `surface_container_lowest` (#000000) for the most recessed areas and `surface_bright` (#292c31) for elements that need to feel physically closer to the user.

### The "No-Line" Rule
**Explicit Instruction:** 1px solid borders are strictly prohibited for sectioning. Boundaries must be defined solely through background color shifts. To separate a sidebar from a main feed, transition from `surface` (#0c0e11) to `surface_container_low` (#111417). This creates a sophisticated, seamless environment that feels engineered rather than "boxed in."

### The "Glass & Gradient" Rule
Floating elements (modals, popovers) must utilize **Glassmorphism**. 
- **Recipe:** Use `surface_container` at 70% opacity with a `24px` backdrop-blur. 
- **Signature Textures:** Apply a subtle linear gradient to main CTAs transitioning from `primary_dim` (#0c70ea) to `primary` (#85adff). This mimics the refraction of light through a laboratory lens.

## 3. Typography: The Editorial Authority
We utilize a high-contrast pairing: **Space Grotesk** for scientific headers and **Inter** for data-heavy body text.

- **Display & Headlines (Space Grotesk):** These are the "Statement" elements. Use `display-lg` (3.5rem) with tight letter-spacing (-0.02em) to create a bold, professional presence.
- **Body & Labels (Inter):** Designed for maximum readability. Use `body-md` (0.875rem) for all data descriptors.
- **Visual Hierarchy:** Headlines should feel "oversized" compared to body text to create an editorial, high-end feel. Use `on_surface_variant` (#aaabaf) for labels to ensure the primary headlines "pop" against the charcoal background.

## 4. Elevation & Depth: Tonal Layering
We do not use shadows to simulate height; we use light.

- **The Layering Principle:** Place a `surface_container_high` (#1d2024) card on top of a `surface_container_low` (#111417) section. The delta in charcoal depth provides all the "lift" required.
- **Ambient Shadows:** Only for detached floating elements (e.g., Tooltips). Use a 32px blur, 0% spread, and a color derived from `surface_container_lowest` at 40% opacity. It should look like a soft atmospheric glow, not a drop shadow.
- **The "Ghost Border" Fallback:** If a divider is functionally required for accessibility, use `outline_variant` (#46484b) at **15% opacity**. It should be felt, not seen.

## 5. Components: Engineered Primitives

### Buttons
- **Primary:** Gradient fill (`primary_dim` to `primary`). Corner radius: `md` (0.375rem). Text: `label-md` bold, uppercase.
- **Secondary:** Transparent background with a `Ghost Border`. Text color: `secondary` (#9ffb00).
- **Tertiary:** No background, no border. Underlined only on hover.

### Input Fields
- **Architecture:** No bottom line or full box. Use a `surface_container_high` fill. 
- **States:** On focus, the background shifts to `surface_bright` with a 2px `primary` left-border (accent "indicator" style).

### Data Progress Trackers (Signature Component)
Incorporate "Biological Pulse" elements. Progress bars should not be flat colors. Use a `primary` to `secondary` gradient to show "Growth." Background of the track should be `surface_container_highest` (#23262a).

### Cards & Lists
- **Forbid Dividers:** Use `8` (2rem) from the Spacing Scale to separate list items. 
- **Nesting:** A card (`surface_container_highest`) should contain its internal metadata in a slightly darker `surface_container_high` nested area.

## 6. Do’s and Don’ts

### Do:
- **Use "Data Ink":** Every element must serve a purpose. If a decorative element doesn't suggest "Progress" or "Science," remove it.
- **Embrace Asymmetry:** Offset your headlines to the left while keeping your primary CTAs anchored to the right.
- **Heavy Breathing Room:** Use the `20` (5rem) and `24` (6rem) spacing tokens for top-level section padding to maintain a premium feel.

### Don’t:
- **Don't Use 100% White:** Avoid `tertiary_fixed` (#ffffff) for large blocks of text. Use `on_surface` (#f9f9fd) to prevent eye strain against the dark background.
- **Don't Use Standard Grids:** Avoid the "3-column card row" whenever possible. Try a 2/3 and 1/3 split to create more visual tension and interest.
- **No Sharp Corners:** While we are "Scientific," we aren't "Brutalist." Use the `DEFAULT` (0.25rem) or `md` (0.375rem) radius to keep the feel "Advanced" but approachable.