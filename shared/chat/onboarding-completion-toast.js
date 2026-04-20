// shared/chat/onboarding-completion-toast.js
// 3-second toast shown when onboarding transitions to completed.

import React from "react";
const { useEffect } = React;
const h = React.createElement;

export function OnboardingCompletionToast({ visible, reason, onDismiss }) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [visible, onDismiss]);

  if (!visible) return null;

  const skipped = reason === "user_skipped";
  const title = skipped ? "No problem." : "All set.";
  const body = skipped
    ? h("span", null,
        "You can add more details in ",
        h("a", { href: "/app/profile/", className: "onboarding-completion-toast-link" }, "Profile"),
        " anytime.",
      )
    : "Your answers are calibrated to you from here on.";

  return h("div", { className: "onboarding-completion-toast", role: "status" },
    h("div", { className: "onboarding-completion-toast-title" }, title),
    h("div", { className: "onboarding-completion-toast-body" }, body),
    h("div", { className: "onboarding-completion-toast-pro" },
      "Free tier: 10 messages/day. ",
      h("a", { href: "/pricing/", className: "onboarding-completion-toast-link" },
        "Upgrade to Pro",
      ),
      " for 100/day.",
    ),
  );
}
