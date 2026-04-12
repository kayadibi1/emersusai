// shared/nutrition-log-confirm-widget.js
//
// Iframe-hosted React widget for confirming a parsed food-log entry.
// Rendered by emersus-renderer.js / WidgetFrame for the theoretical future
// iframe path. The production code path is NutritionLogConfirmCard in
// shared/react-chat-app.js (Amendment A8).
//
// The widget shows:
//   - Resolved items: per-row amount + meal_slot editors with remove buttons
//   - Unresolved items: read-only info rows explaining why they weren't matched
//   - A "Confirm log (N)" button that POSTs to /api/emersus/meal-journal/entries
//   - Post-save: "✓ Logged N items" confirmation banner
//
// Auth: reads window.EMERSUS_AUTH (injected by the iframe bootstrap) since
// there is no supabase.js in the iframe sandbox.
//
// Sub-components are named-exported at the bottom so NutritionLogConfirmCard
// in react-chat-app.js can import and reuse them directly without duplication.

import React, { useState } from "https://esm.sh/react@18.2.0";

const h = React.createElement;

// ---------------------------------------------------------------------------
// MEAL_SLOT_LABELS
// ---------------------------------------------------------------------------
const MEAL_SLOT_LABELS = {
  breakfast: "Breakfast",
  mid_morning: "Mid morning",
  lunch: "Lunch",
  afternoon: "Afternoon",
  dinner: "Dinner",
  evening: "Evening",
  pre_workout: "Pre-workout",
  post_workout: "Post-workout",
  supplements_am: "Supplements AM",
  supplements_pm: "Supplements PM",
};

// ---------------------------------------------------------------------------
// ResolvedRow
// ---------------------------------------------------------------------------
// An editable row for a successfully-matched food item. Lets the user adjust
// the amount (number input) and meal slot (select), or remove the item.
//
// Props:
//   item     — the resolved item object
//   index    — position in the resolved list (used for keys / callbacks)
//   onUpdate — (index, field, value) → void
//   onRemove — (index) → void
function ResolvedRow({ item, index, onUpdate, onRemove }) {
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 0",
        borderBottom: "1px solid var(--color-border-tertiary, rgba(255,255,255,0.08))",
      },
    },
    // Food name + optional brand
    h(
      "div",
      { style: { flex: "1 1 0", minWidth: 0 } },
      h(
        "div",
        {
          style: {
            fontSize: 13,
            fontWeight: 500,
            color: "var(--color-text-primary, #f9f9fd)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        },
        item.food_name || item.food_id || "Unknown food"
      ),
      item.brand_name
        ? h(
            "div",
            {
              style: {
                fontSize: 11,
                color: "var(--color-text-tertiary, #6f7480)",
                marginTop: 2,
              },
            },
            item.brand_name
          )
        : null
    ),
    // Amount input
    h("input", {
      type: "number",
      min: 0,
      step: 0.5,
      value: item.amount,
      onChange: (e) => onUpdate(index, "amount", parseFloat(e.target.value) || 0),
      style: {
        width: 64,
        padding: "4px 6px",
        background: "var(--color-background-secondary, rgba(255,255,255,0.06))",
        color: "var(--color-text-primary, #f9f9fd)",
        border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.14))",
        borderRadius: 6,
        fontSize: 12,
        textAlign: "right",
      },
    }),
    // Unit label
    h(
      "span",
      { style: { fontSize: 12, color: "var(--color-text-secondary, #a7adb4)", minWidth: 28 } },
      item.amount_unit || "g"
    ),
    // Meal slot selector
    h(
      "select",
      {
        value: item.meal_slot,
        onChange: (e) => onUpdate(index, "meal_slot", e.target.value),
        style: {
          padding: "4px 6px",
          background: "var(--color-background-secondary, rgba(255,255,255,0.06))",
          color: "var(--color-text-primary, #f9f9fd)",
          border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.14))",
          borderRadius: 6,
          fontSize: 12,
          cursor: "pointer",
        },
      },
      Object.entries(MEAL_SLOT_LABELS).map(([value, label]) =>
        h("option", { key: value, value, style: { background: "#1a1d23", color: "#f9f9fd" } }, label)
      )
    ),
    // Remove button
    h(
      "button",
      {
        onClick: () => onRemove(index),
        title: "Remove item",
        style: {
          padding: "3px 7px",
          background: "transparent",
          color: "var(--color-text-danger, #ff8f9d)",
          border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.14))",
          borderRadius: 6,
          fontSize: 12,
          cursor: "pointer",
          flexShrink: 0,
        },
      },
      "\u00d7"
    )
  );
}

// ---------------------------------------------------------------------------
// UnresolvedRow
// ---------------------------------------------------------------------------
// A read-only info row for an item the parser couldn't confidently match to
// a food in the database. Shows the raw text and a reason if provided.
//
// Props:
//   item  — the unresolved item object
//   index — position in the unresolved list (used for keys)
function UnresolvedRow({ item, index }) {
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "8px 0",
        borderBottom: "1px solid var(--color-border-tertiary, rgba(255,255,255,0.08))",
        opacity: 0.7,
      },
    },
    // Warning icon
    h(
      "span",
      {
        style: {
          fontSize: 13,
          color: "var(--color-text-warning, #ffd57a)",
          flexShrink: 0,
          marginTop: 1,
        },
      },
      "\u26a0"
    ),
    h(
      "div",
      { style: { flex: "1 1 0", minWidth: 0 } },
      h(
        "div",
        {
          style: {
            fontSize: 13,
            color: "var(--color-text-primary, #f9f9fd)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        },
        item.raw_text || item.food_name || `Unresolved item ${index + 1}`
      ),
      item.reason
        ? h(
            "div",
            {
              style: {
                fontSize: 11,
                color: "var(--color-text-warning, #ffd57a)",
                marginTop: 2,
              },
            },
            item.reason
          )
        : null
    ),
    h(
      "span",
      {
        style: {
          fontSize: 11,
          color: "var(--color-text-secondary, #a7adb4)",
          flexShrink: 0,
          padding: "2px 6px",
          background: "var(--color-background-warning, rgba(255,196,102,0.12))",
          borderRadius: 4,
        },
      },
      "not found"
    )
  );
}

// ---------------------------------------------------------------------------
// NutritionLogConfirmWidget (default export — iframe path)
// ---------------------------------------------------------------------------
export default function NutritionLogConfirmWidget({ payload }) {
  const resolvedInit = Array.isArray(payload?.resolved_items)
    ? payload.resolved_items.map((it) => ({
        ...it,
        meal_slot: it.meal_slot || payload.meal_slot_default || "lunch",
      }))
    : [];

  const [items, setItems] = useState(resolvedInit);
  const [submitState, setSubmitState] = useState("idle"); // idle | saving | saved | error
  const [error, setError] = useState("");

  const unresolved = Array.isArray(payload?.unresolved) ? payload.unresolved : [];

  function handleUpdate(index, field, value) {
    setItems((prev) => {
      const next = prev.slice();
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function handleRemove(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function confirm() {
    if (submitState === "saving" || submitState === "saved") return;
    if (items.length === 0) return;
    setSubmitState("saving");
    setError("");
    try {
      // Iframe context — auth token is injected by the parent page.
      const auth = window.EMERSUS_AUTH || {};
      const accessToken = auth.access_token || "";
      if (!accessToken) throw new Error("Sign in to log food.");

      const entries = items.map((it) => ({
        food_id: it.food_id,
        logged_date: payload.logged_date,
        meal_slot: it.meal_slot,
        amount: it.amount,
        amount_unit: it.amount_unit,
        source: "chat_parser",
        confidence: it.confidence,
      }));

      const res = await fetch("/api/emersus/meal-journal/entries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Log failed (HTTP ${res.status}).`);
      }
      setSubmitState("saved");
    } catch (err) {
      setError(String(err?.message || err) || "Log failed.");
      setSubmitState("error");
    }
  }

  if (submitState === "saved") {
    return h(
      "div",
      {
        style: {
          padding: 16,
          background: "var(--color-background-success, rgba(159,251,0,0.10))",
          borderRadius: "var(--border-radius-md, 12px)",
          border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.12))",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: "var(--color-text-success, #b9f47a)",
          fontWeight: 500,
        },
      },
      "\u2713 Logged ",
      items.length,
      " item",
      items.length !== 1 ? "s" : ""
    );
  }

  const hasParseError = Boolean(payload?.parse_error);

  return h(
    "div",
    {
      style: {
        background: "var(--color-background-secondary, rgba(255,255,255,0.06))",
        border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.08))",
        borderRadius: "var(--border-radius-md, 12px)",
        padding: 14,
        fontFamily: "var(--font-sans, Inter, sans-serif)",
      },
    },
    // Header
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        },
      },
      h(
        "div",
        {
          style: {
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-text-primary, #f9f9fd)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          },
        },
        "Confirm food log"
      ),
      payload?.logged_date
        ? h(
            "span",
            {
              style: {
                fontSize: 11,
                color: "var(--color-text-tertiary, #6f7480)",
              },
            },
            payload.logged_date
          )
        : null
    ),
    // Parse-error banner
    hasParseError
      ? h(
          "div",
          {
            style: {
              padding: "6px 10px",
              background: "var(--color-background-warning, rgba(255,196,102,0.12))",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--color-text-warning, #ffd57a)",
              marginBottom: 10,
            },
          },
          "\u26a0 Some items could not be parsed: ",
          payload.parse_error
        )
      : null,
    // Resolved items
    items.length > 0
      ? h(
          "div",
          { style: { marginBottom: 8 } },
          items.map((item, i) =>
            h(ResolvedRow, {
              key: item.food_id ? `r-${item.food_id}-${i}` : `r-${i}`,
              item,
              index: i,
              onUpdate: handleUpdate,
              onRemove: handleRemove,
            })
          )
        )
      : h(
          "div",
          {
            style: {
              fontSize: 12,
              color: "var(--color-text-tertiary, #6f7480)",
              padding: "6px 0",
              fontStyle: "italic",
            },
          },
          "No items to log — all items removed."
        ),
    // Unresolved items
    unresolved.length > 0
      ? h(
          "div",
          { style: { marginTop: 8 } },
          h(
            "div",
            {
              style: {
                fontSize: 11,
                color: "var(--color-text-tertiary, #6f7480)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 4,
              },
            },
            "Couldn't find in database"
          ),
          unresolved.map((item, i) =>
            h(UnresolvedRow, {
              key: `u-${i}`,
              item,
              index: i,
            })
          )
        )
      : null,
    // Confirm button + error
    h(
      "div",
      { style: { marginTop: 12, display: "flex", flexDirection: "column", gap: 6 } },
      h(
        "button",
        {
          onClick: confirm,
          disabled: submitState === "saving" || submitState === "saved" || items.length === 0,
          style: {
            alignSelf: "flex-start",
            padding: "7px 16px",
            background:
              items.length === 0
                ? "rgba(255,255,255,0.04)"
                : "var(--accent-primary, #6d9fff)",
            color:
              items.length === 0
                ? "var(--color-text-tertiary, #6f7480)"
                : "var(--color-background-primary, #0c0e11)",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor:
              submitState === "saving" || items.length === 0 ? "default" : "pointer",
            opacity: submitState === "saving" ? 0.7 : 1,
          },
        },
        submitState === "saving"
          ? "Logging\u2026"
          : `Confirm log (${items.length})`
      ),
      error
        ? h(
            "div",
            {
              style: {
                fontSize: 12,
                color: "var(--color-text-danger, #ff8f9d)",
              },
            },
            error
          )
        : null
    )
  );
}

export { MEAL_SLOT_LABELS, ResolvedRow, UnresolvedRow };
