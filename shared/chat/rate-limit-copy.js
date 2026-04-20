// shared/chat/rate-limit-copy.js
//
// Centralized user-facing copy for the rate-limit surface. Two variants —
// free and pro — for the banner, the inline system message in the chat
// thread, and the UsageRing popover. Kept in one file so product tweaks
// don't require editing React components.

export function formatResetCountdown(resetAtIso) {
  const reset = new Date(resetAtIso).getTime();
  const now = Date.now();
  const ms = Math.max(reset - now, 0);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export const COPY = {
  free: {
    bannerTitle: "You've hit today's message limit.",
    bannerBody: (resetAtIso) =>
      `Resets in ${formatResetCountdown(resetAtIso)} (00:00 UTC). Upgrade to Pro for 100 messages per day and preprint access.`,
    bannerCta: { label: "Upgrade to Pro →", href: "/pricing" },
    inlineMessage:
      "Daily message limit reached (10/day on Free). The composer unlocks at midnight UTC, or upgrade to Pro for 10× the room.",
    placeholder: "Daily limit reached — resets at midnight UTC.",
    ringPopoverTitle: (used, limit) =>
      `${used} of ${limit} free messages used today`,
    ringPopoverBody: (resetAtIso) =>
      `Resets in ${formatResetCountdown(resetAtIso)}.`,
    ringPopoverCta: { label: "Upgrade →", href: "/pricing" },
  },
  pro: {
    bannerTitle: "You've hit today's Pro limit.",
    bannerBody: (resetAtIso) =>
      `You've sent 100 messages today. Resets in ${formatResetCountdown(resetAtIso)} (00:00 UTC).`,
    bannerCta: { label: "See usage", href: "/app/profile#usage" },
    inlineMessage:
      "Daily message limit reached (100/day on Pro). The composer unlocks at midnight UTC.",
    placeholder: "Daily limit reached — resets at midnight UTC.",
    ringPopoverTitle: (used, limit) =>
      `${used} of ${limit} Pro messages used today`,
    ringPopoverBody: (resetAtIso) =>
      `Resets in ${formatResetCountdown(resetAtIso)}.`,
    ringPopoverCta: { label: "Manage billing", href: "/app/profile#usage" },
  },
};
