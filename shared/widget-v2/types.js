/**
 * @typedef {"narrow" | "medium" | "wide"} DisplayWidth
 *
 * @typedef {"pharma" | "training" | "nutrition" | "evidence" | "progress" | "calculator"} WidgetFamily
 *
 * @typedef {Object} WidgetBase
 * @property {string} title
 * @property {DisplayWidth} display_width
 * @property {string | null} summary
 * @property {string[]} follow_up_chips          // max 4
 * @property {string} type                       // template slug, family-specific enum
 * @property {Record<string, unknown>} data      // per-template schema
 *
 * @typedef {Object} WidgetV2Envelope
 * @property {WidgetFamily} family
 * @property {WidgetBase} payload
 */

// Runtime re-export stubs (JSDoc types are erased at runtime; these are for
// code that wants to import a "type" token for documentation).
export const DISPLAY_WIDTHS = /** @type {const} */ (["narrow", "medium", "wide"]);
export const WIDGET_FAMILIES = /** @type {const} */ ([
  "pharma", "training", "nutrition", "evidence", "progress", "calculator",
]);
