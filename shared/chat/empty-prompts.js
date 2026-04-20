// shared/chat/empty-prompts.js — anchored prompt chips for empty chat threads.
//
// Renders 6 chips at the bottom of an empty thread's message area (not
// centered — anchored to the composer side per the design spec). Click fills
// the composer; no auto-send. Loads suggestions from
// /api/emersus/suggest-prompts when mounted.

import React from "react";

const { useEffect, useState } = React;
const h = React.createElement;

async function fetchPrompts(profileId, accessToken, personalize = false) {
  const params = new URLSearchParams();
  if (profileId) params.set("profile_id", profileId);
  if (personalize) params.set("personalize", "true");
  const qs = params.toString();
  const url = qs ? `/api/emersus/suggest-prompts?${qs}` : "/api/emersus/suggest-prompts";
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return Array.isArray(body) ? body : [];
}

export function EmptyPrompts({ profileId, accessToken, onPick, personalize = false }) {
  const [prompts, setPrompts] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetchPrompts(profileId || "", accessToken || "", personalize)
      .then((next) => {
        if (cancelled) return;
        setPrompts(next);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, [profileId, accessToken, personalize]);

  if (status === "loading" || !prompts.length) {
    return h(
      "div",
      { className: "empty-prompts empty-prompts-loading", "aria-busy": status === "loading" },
      h("span", { className: "empty-prompts-label" }, "Suggested"),
    );
  }

  return h(
    "div",
    { className: "empty-prompts", "aria-label": "Suggested prompts" },
    h("span", { className: "empty-prompts-label" }, "Suggested"),
    h(
      "div",
      { className: "empty-prompts-row" },
      prompts.map((prompt) =>
        h(
          "button",
          {
            key: prompt.id,
            type: "button",
            className: "empty-prompt-chip",
            "data-prompt": prompt.prompt,
            onClick: () => onPick?.(prompt.prompt),
          },
          prompt.label || prompt.prompt,
        ),
      ),
    ),
  );
}

export default EmptyPrompts;
