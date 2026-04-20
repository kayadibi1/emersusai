// shared/chat/usage-ring.js
//
// SVG progress ring shown next to the send button. Polls /api/emersus/usage
// on mount, exposes an optimistic bump via ref (parent calls bump() right
// after a successful send so the UI doesn't lag the actual count). Click
// opens a popover anchored below.

import React from "react";
import { COPY } from "./rate-limit-copy.js";

const { useEffect, useImperativeHandle, useRef, useState, forwardRef } = React;
const h = React.createElement;

const RING_SIZE = 22;
const RING_RADIUS = 9;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

function ringColor(pct) {
  if (pct >= 1) return "var(--danger)";
  if (pct >= 0.8) return "var(--warning)";
  return "var(--accent)";
}

async function fetchUsage(getToken) {
  const token = await getToken();
  if (!token) return null;
  const res = await fetch("/api/emersus/usage", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export const UsageRing = forwardRef(function UsageRing({ getToken }, ref) {
  const [state, setState] = useState(null); // {tier, used, limit, reset_at}
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapRef = useRef(null);

  useImperativeHandle(
    ref,
    () => ({
      bump() {
        setState((s) =>
          s ? { ...s, used: Math.min(s.used + 1, s.limit) } : s
        );
      },
      refresh() {
        fetchUsage(getToken).then((d) => d && setState(d));
      },
    }),
    [getToken]
  );

  useEffect(() => {
    fetchUsage(getToken).then((d) => d && setState(d));
  }, [getToken]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [popoverOpen]);

  if (!state) return null;

  const pct = Math.min(state.used / state.limit, 1);
  const dashOffset = RING_CIRC * (1 - pct);
  const color = ringColor(pct);
  const copy = COPY[state.tier] || COPY.free;

  return h(
    "div",
    {
      ref: wrapRef,
      style: {
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
      },
    },
    h(
      "button",
      {
        type: "button",
        onClick: () => setPopoverOpen((v) => !v),
        "aria-label": copy.ringPopoverTitle(state.used, state.limit),
        style: {
          width: RING_SIZE,
          height: RING_SIZE,
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          position: "relative",
        },
      },
      h(
        "svg",
        {
          width: RING_SIZE,
          height: RING_SIZE,
          viewBox: `0 0 ${RING_SIZE} ${RING_SIZE}`,
        },
        h("circle", {
          cx: RING_SIZE / 2,
          cy: RING_SIZE / 2,
          r: RING_RADIUS,
          fill: "none",
          stroke: "var(--line)",
          strokeWidth: 2,
        }),
        h("circle", {
          cx: RING_SIZE / 2,
          cy: RING_SIZE / 2,
          r: RING_RADIUS,
          fill: "none",
          stroke: color,
          strokeWidth: 2,
          strokeDasharray: RING_CIRC,
          strokeDashoffset: dashOffset,
          strokeLinecap: "round",
          transform: `rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`,
        })
      ),
      h(
        "span",
        {
          className: "mono nums",
          style: {
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            color: "var(--muted)",
            pointerEvents: "none",
          },
        },
        state.used
      )
    ),
    popoverOpen &&
      h(
        "div",
        {
          style: {
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "12px 14px",
            minWidth: 220,
            boxShadow: "0 8px 32px -8px rgba(0,0,0,0.24)",
            zIndex: 20,
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
          },
        },
        h(
          "div",
          {
            style: {
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink)",
              marginBottom: 4,
            },
          },
          copy.ringPopoverTitle(state.used, state.limit)
        ),
        h(
          "div",
          {
            style: {
              fontSize: 12,
              color: "var(--muted)",
              marginBottom: 10,
            },
          },
          copy.ringPopoverBody(state.reset_at)
        ),
        h(
          "a",
          {
            href: copy.ringPopoverCta.href,
            style: {
              display: "inline-block",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--accent)",
              textDecoration: "none",
            },
          },
          copy.ringPopoverCta.label
        )
      )
  );
});
