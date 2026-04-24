// scripts/email-fixtures.js
// Sample inputs for every template. Used by preview-emails.mjs and the
// template unit tests. Keep the hostile strings — they verify escape
// coverage on every render call.

export const USER_FIXTURE = {
  id: "u-00000000-0000-0000-0000-000000000001",
  email: "sid@example.com",
  name: `Sid "<script>alert(1)</script>" Kayadibi`,
};

export const FIXTURES = {
  "auth-verify": {
    user: USER_FIXTURE,
    confirmUrl: "https://emersus.ai/auth/confirm?token=2f8e19c4a8b7d9e5f11234567890abcd",
  },
  "auth-reset": {
    user: USER_FIXTURE,
    resetUrl: "https://emersus.ai/auth/reset-password?token=abc123def456",
    expiresIn: "60 minutes",
  },
  "auth-welcome": {
    user: USER_FIXTURE,
    appUrl: "https://emersus.ai/app/",
    samplePrompts: [
      "How much protein do I actually need per day?",
      "Creatine: cycling or continuous?",
      "Zone-2 cardio for fat loss — dose-response?",
    ],
  },
  "auth-password-changed": {
    user: USER_FIXTURE,
    changedAt: "Apr 24, 2026 · 14:32 EST",
    device: "Chrome on macOS",
    location: "Brooklyn, NY",
    ip: "24.186.xxx.xxx",
    resetUrl: "https://emersus.ai/auth/reset-password",
  },
  "billing-receipt": {
    user: USER_FIXTURE,
    plan: "Pro · monthly",
    period: "Apr 24, 2026 → May 24, 2026",
    amount: "$9.00",
    cardLast4: "4242",
    invoiceUrl: "https://polar.sh/invoice/xyz",
  },
  "billing-renewal": {
    user: USER_FIXTURE,
    plan: "Pro · monthly",
    nextChargeAt: "May 1, 2026",
    amount: "$9.00",
    manageUrl: "https://emersus.ai/app/profile?tab=billing",
  },
  "billing-payment-failed": {
    user: USER_FIXTURE,
    cardLast4: "0341",
    reason: "Card declined by issuer (insufficient funds)",
    retryAt: "Apr 27, 2026",
    finalAttemptAt: "May 1, 2026",
    updateUrl: "https://emersus.ai/app/profile?tab=billing",
  },
  "billing-cancellation": {
    user: USER_FIXTURE,
    accessThrough: "May 24, 2026",
    refund: "No refund — access continues to end of period",
    reactivateUrl: "https://emersus.ai/pricing/",
  },
  "legal-tos-update": {
    user: USER_FIXTURE,
    summary: "We've clarified the acceptable-use policy and added a section on AI-generated content.",
    changes: [
      "New §4.2 — Acceptable use: no scraping the corpus via the chat UI.",
      "New §6.4 — You own your chat history. We don't train on it.",
      "§9 — Updated Delaware jurisdiction language.",
    ],
    effectiveAt: "May 15, 2026",
    termsUrl: "https://emersus.ai/terms/",
  },
  "legal-privacy-update": {
    user: USER_FIXTURE,
    summary: "We've reduced retention for anonymous visitors and clarified subprocessor list.",
    changes: [
      "Anonymous analytics retention reduced from 26 months to 12.",
      "Added Polar as a billing subprocessor (was already disclosed in-product).",
      "Clarified what's logged server-side vs. client-side.",
    ],
    effectiveAt: "May 15, 2026",
    privacyUrl: "https://emersus.ai/privacy/",
  },
  "data-export-ready": {
    user: USER_FIXTURE,
    downloadUrl: "https://emersus.ai/export/abc123.zip",
    size: "48 MB",
    rows: "12,421 chat messages, 318 saved sources, 6 workout sessions",
    format: "ZIP (JSON + Markdown)",
    expiresIn: "7 days",
    sha256: "3f8c1e4b9d0a7c2f6e5d4b3a8c9e2f1d0b7a6c5e4d3f2a1b0c9d8e7f6a5b4c3d",
  },
  "research-new-paper": {
    user: USER_FIXTURE,
    topic: "Creatine & cognition",
    paper: {
      title: "Daily creatine supplementation and working memory in older adults: a double-blind RCT.",
      journal: "J Int Soc Sports Nutr",
      year: 2026,
      grade: "high",
      abstract: "24 weeks of 5 g/d improved digit-span performance (d=0.42) with no effect on processing speed. Dose-response not tested at this study size.",
      doi: "10.1186/s12970-026-00567-x",
    },
    readUrl: "https://emersus.ai/chat?ref=new-paper&p=xyz",
    reason: "Matches your follow on 'creatine supplementation'",
  },
};
