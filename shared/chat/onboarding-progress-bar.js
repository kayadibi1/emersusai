// shared/chat/onboarding-progress-bar.js
// Thin progress bar + skip link shown during onboarding.

import React from "react";
const { useEffect, useRef, useState } = React;
const h = React.createElement;

const SKIP_ELIGIBLE_THRESHOLD = 0.33;

export function OnboardingProgressBar({ progress, onSkip }) {
  const [displayProgress, setDisplayProgress] = useState(progress ?? 0);
  const maxSeenRef = useRef(0);

  useEffect(() => {
    if (progress === null || progress === undefined) return;
    if (progress > maxSeenRef.current) {
      maxSeenRef.current = progress;
      setDisplayProgress(progress);
    }
  }, [progress]);

  if (progress === null || progress === undefined) return null;

  const pct = Math.min(100, Math.max(0, displayProgress * 100));
  const skipEligible = displayProgress >= SKIP_ELIGIBLE_THRESHOLD;

  return h("div", { className: "onboarding-progress" },
    h("div", { className: "onboarding-progress-bar-track" },
      h("div", {
        className: "onboarding-progress-bar-fill",
        style: { width: `${pct}%` },
      }),
    ),
    skipEligible ? h("button", {
      className: "onboarding-skip-link",
      type: "button",
      onClick: onSkip,
      "aria-label": "Skip setup and start asking questions",
    }, "skip setup \u2192") : null,
  );
}
