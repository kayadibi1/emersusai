import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const h = React.createElement;
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let smoothScrollController = null;
let landingBackgroundPromise = null;

gsap.registerPlugin(ScrollTrigger);

function initSmoothScroll(onScrollActivity) {
  if (reducedMotionQuery.matches) {
    return null;
  }

  if (smoothScrollController) {
    if (onScrollActivity) {
      smoothScrollController.listeners.add(onScrollActivity);
    }
    return smoothScrollController.lenis;
  }

  const lenis = new Lenis({
    lerp: 0.075,
    smoothWheel: true,
    wheelMultiplier: 0.86,
    syncTouch: true,
    anchors: true,
  });

  const listeners = new Set();
  if (onScrollActivity) {
    listeners.add(onScrollActivity);
  }

  const handleScroll = () => {
    listeners.forEach((listener) => listener?.());
    ScrollTrigger.update();
  };
  const tick = (time) => lenis.raf(time * 1000);

  lenis.on("scroll", handleScroll);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);

  smoothScrollController = { lenis, listeners, tick };
  return lenis;
}

function loadLandingBackground() {
  if (!landingBackgroundPromise) {
    landingBackgroundPromise = Promise.resolve();
  }
  return landingBackgroundPromise;
}

function WaitlistForm({ variant = "full", endpoint = "/api/waitlist" }) {
  const [status, setStatus] = useState({ tone: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileStatus, setTurnstileStatus] = useState("idle");
  const widgetRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config", {
      headers: {
        Accept: "application/json",
      },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        if (!cancelled && config?.turnstileSiteKey) {
          setTurnstileSiteKey(String(config.turnstileSiteKey));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!turnstileSiteKey || !widgetRef.current) {
      return;
    }

    let cancelled = false;

    function renderWidget() {
      if (cancelled || !window.turnstile || widgetIdRef.current || !widgetRef.current) {
        return;
      }
      setTurnstileStatus("ready");
      widgetIdRef.current = window.turnstile.render(widgetRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token) => {
          setTurnstileToken(String(token || ""));
          setTurnstileStatus("solved");
        },
        "expired-callback": () => {
          setTurnstileToken("");
          setTurnstileStatus("expired");
        },
        "error-callback": () => {
          setTurnstileToken("");
          setTurnstileStatus("error");
        },
      });
    }

    if (window.turnstile) {
      renderWidget();
      return () => {
        cancelled = true;
      };
    }

    const existingScript = document.querySelector('script[data-turnstile-script="true"]');
    if (existingScript) {
      existingScript.addEventListener("load", renderWidget, { once: true });
      return () => {
        cancelled = true;
      };
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstileScript = "true";
    script.addEventListener("load", renderWidget, { once: true });
    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [turnstileSiteKey]);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const emailField = form.elements.email;
    setStatus({ tone: "", message: "" });

    if (!(emailField instanceof HTMLInputElement) || !emailField.value.trim()) {
      setStatus({ tone: "error", message: "Enter your email to join the waitlist." });
      emailField?.focus();
      return;
    }

    if (!emailField.checkValidity()) {
      setStatus({ tone: "error", message: "Enter a valid email address." });
      emailField.focus();
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      payload.page_url = window.location.href;
      payload.referrer = document.referrer || "";
      payload.turnstileToken = turnstileToken;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || "Submission failed");
      }
      form.reset();
      setStatus({ tone: "success", message: result.message || "You're on the list. We'll send access details soon." });
    } catch (error) {
      setStatus({ tone: "error", message: error.message || "Something went wrong. Try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return h(
    "form",
    { className: `waitlist-form waitlist-form-${variant}`, onSubmit: submit },
    h("input", {
      name: "email",
      type: "email",
      inputMode: "email",
      autoComplete: "email",
      placeholder: "you@example.com",
      "aria-label": "Email address",
      required: true,
    }),
    turnstileSiteKey
      ? h(
          "div",
          { className: "waitlist-captcha" },
          h("div", { ref: widgetRef }),
          turnstileStatus === "expired"
            ? h("p", { className: "waitlist-feedback is-error", "aria-live": "polite" }, "CAPTCHA expired. Please retry.")
            : null,
          turnstileStatus === "error"
            ? h("p", { className: "waitlist-feedback is-error", "aria-live": "polite" }, "CAPTCHA failed to load. Refresh and try again.")
            : null,
        )
      : null,
    h("input", {
      name: "website",
      type: "text",
      tabIndex: -1,
      autoComplete: "off",
      "aria-hidden": "true",
      style: {
        position: "absolute",
        left: "-9999px",
        width: "1px",
        height: "1px",
        opacity: 0,
        pointerEvents: "none",
      },
    }),
    h(
      "button",
      {
        type: "submit",
        disabled: submitting || Boolean(turnstileSiteKey && !turnstileToken),
      },
      submitting ? "Joining" : "Get access"
    ),
    h("p", { className: `waitlist-feedback ${status.tone ? `is-${status.tone}` : ""}`, "aria-live": "polite" }, status.message),
  );
}

function OldCopyNav() {
  return h(
    "nav",
    { className: "nav" },
    h("a", { className: "brand text-blur", href: "#hero" },
      h("img", { src: "/emersus-logo.png", alt: "Emersus", className: "brand-logo" })
    ),
    h(
      "div",
      { className: "nav-links" },
      h("a", { className: "text-blur", href: "#features" }, "Science"),
      h("a", { className: "text-blur", href: "#how" }, "Platform"),
      h("a", { className: "text-blur", href: "/auth/login/" }, "App / Login"),
    ),
    h("a", { className: "nav-cta", href: "#access" }, "Get started"),
  );
}

function OldCopyHero() {
  return h(
    "section",
    { className: "section hero", id: "hero" },
    h(
      "div",
      { className: "section-inner" },
      h("p", { className: "eyebrow text-blur" }, "Evidence-Based Fitness Intelligence"),
      h("h1", { className: "headline text-blur-strong" }, "Your body deserves better than guesswork."),
      h("p", { className: "subtitle text-blur" }, "Training and nutrition decisions backed by peer-reviewed research. Not influencer opinions, not bro science \u2014 the actual evidence."),
      h(
        "div",
        { className: "hero-actions" },
        h("a", { className: "button-primary", href: "#access" }, "Get started"),
        h("a", { className: "button-secondary text-blur", href: "#features" }, "See the science \u2192"),
      ),
    ),
  );
}

function OldCopyFeatures() {
  const features = [
    ["01", "Research-backed answers", "Every recommendation cites peer-reviewed sources. See the evidence strength, read the abstracts, verify the claims yourself."],
    ["02", "Personalized protocols", "Workout plans and nutrition guidance adapted to your goals, equipment, schedule, and injury history. Not cookie-cutter templates."],
    ["03", "Honest uncertainty", "When the evidence is mixed or insufficient, we say so. No false confidence. The model knows what it doesn't know."],
  ];

  return h(
    "section",
    { className: "section", id: "features" },
    h(
      "div",
      { className: "section-inner" },
      h("p", { className: "eyebrow text-blur" }, "What you get"),
      h(
        "div",
        { className: "grid-3" },
        ...features.map(([icon, title, copy]) => h(
          "article",
          { className: "glass-card", key: title },
          h("div", { className: "icon" }, icon),
          h("h3", { className: "card-title text-blur" }, title),
          h("p", { className: "card-copy text-blur" }, copy),
        )),
      ),
    ),
  );
}

function OldCopyOptimization() {
  const topics = [
    ["STEP 01", "Ask anything", "Exercise science, nutrition, recovery \u2014 in natural language."],
    ["STEP 02", "We search the literature", "Semantic search across 200k+ papers finds relevant evidence."],
    ["STEP 03", "Synthesize and cite", "AI distills findings into actionable guidance with sources."],
    ["STEP 04", "Track and adapt", "Log workouts and meals. Your plans evolve as you progress."],
  ];

  return h(
    "section",
    { className: "section", id: "how" },
    h(
      "div",
      { className: "section-inner" },
      h("p", { className: "eyebrow text-blur" }, "How it works"),
      h(
        "div",
        { className: "steps" },
        ...topics.map(([number, title, copy]) => h(
          "article",
          { className: "step-card", key: number },
          h("span", { className: "step-number" }, number),
          h("h3", { className: "step-title text-blur" }, title),
          h("p", { className: "step-copy text-blur" }, copy),
        )),
      ),
    ),
  );
}

function OldCopyProtocol() {
  return h(
    "section",
    { className: "section", id: "proof" },
    h(
      "div",
      { className: "section-inner quote-grid" },
      h(
        "article",
        { className: "quote-card large" },
        h("p", { className: "quote-copy text-blur-strong" }, "\u201CI stopped guessing and started training with actual evidence. The difference in my results has been night and day.\u201D"),
        h("p", { className: "quote-author" }, "Early beta user \u00b7 6 months"),
      ),
      h(
        "article",
        { className: "quote-card" },
        h("p", { className: "section-copy text-blur" }, "Built for people who take their training seriously enough to want the truth \u2014 even when the truth is \u201Cwe don't know yet.\u201D"),
      ),
    ),
  );
}

function OldCopyFinalCta() {
  return h(
    "section",
    { className: "section cta", id: "access" },
    h(
      "div",
      { className: "section-inner" },
      h("h2", { className: "section-title text-blur-strong" }, "Ready to train smarter?"),
      h("p", { className: "subtitle text-blur" }, "Join the waitlist for early access."),
      h(WaitlistForm, { variant: "full" }),
    ),
  );
}

function OldCopyFooter() {
  return h(
    "footer",
    { className: "footer" },
    h("span", { className: "text-blur" }, "Emersus \u00a9 2025"),
    h(
      "div",
      { style: { display: "flex", gap: "2rem" } },
      h("a", { className: "text-blur", href: "/privacy/" }, "Privacy"),
      h("a", { className: "text-blur", href: "/terms/" }, "Terms"),
      h("a", { className: "text-blur", href: "/contact/" }, "Contact"),
    ),
  );
}

function LandingPage() {
  return h(
    "div",
    { className: "landing-shell" },
    h(OldCopyNav),
    h(OldCopyHero),
    h(OldCopyFeatures),
    h(OldCopyOptimization),
    h(OldCopyProtocol),
    h(OldCopyFinalCta),
    h(OldCopyFooter),
  );
}

function mountLanding() {
  const root = document.getElementById("landing-root");
  if (!root) {
    return;
  }

  createRoot(root).render(h(LandingPage));

  requestAnimationFrame(() => {
    gsap.to(".step-card", {
      scrollTrigger: {
        trigger: "#how",
        start: "top 68%",
      },
      opacity: 1,
      y: 0,
      stagger: 0.12,
      duration: 0.85,
      ease: "power3.out",
    });
  });
}


mountLanding();
initSmoothScroll();
loadLandingBackground();
