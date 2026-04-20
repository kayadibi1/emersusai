// shared/chat/welcome-screen.js
// Click-through welcome screen shown to brand-new users before onboarding chat.

import React from "react";

const { useState } = React;
const h = React.createElement;

export function WelcomeScreen({ firstName, onStart }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      await onStart();
    } catch (err) {
      setError("Something went wrong — try again.");
      setStarting(false);
    }
  }

  return h(
    "div",
    { className: "welcome-screen", role: "dialog", "aria-label": "Welcome to Emersus" },
    h("div", { className: "welcome-screen-inner" },
      h("div", { className: "welcome-screen-label" }, firstName ? `Welcome, ${firstName}` : "Welcome"),
      h("h1", { className: "welcome-screen-title" },
        "Let's tune Emersus", h("br"), "to your training.",
      ),
      h("p", { className: "welcome-screen-subtitle" },
        "Four quick questions — about 90 seconds — and every answer after will be calibrated to you.",
      ),
      h("button", {
        className: "welcome-screen-cta",
        onClick: handleStart,
        disabled: starting,
      }, starting ? "Starting\u2026" : "Start \u2192"),
      error ? h("p", { className: "welcome-screen-error" }, error) : null,
    ),
  );
}

export default WelcomeScreen;
