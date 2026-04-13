const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let smoothScrollController = null;
let landingBackgroundPromise = null;
let gsapBundlePromise = null;
let lenisModulePromise = null;

function loadGsapBundle() {
  if (!gsapBundlePromise) {
    gsapBundlePromise = Promise.all([
      import("gsap"),
      import("gsap/ScrollTrigger"),
    ]).then(([gsapModule, scrollTriggerModule]) => {
      const gsap = gsapModule.default;
      const { ScrollTrigger } = scrollTriggerModule;
      gsap.registerPlugin(ScrollTrigger);
      return { gsap, ScrollTrigger };
    });
  }
  return gsapBundlePromise;
}

function loadLenisModule() {
  if (!lenisModulePromise) {
    lenisModulePromise = import("lenis").then((module) => module.default);
  }
  return lenisModulePromise;
}

async function initSmoothScroll(onScrollActivity) {
  if (reducedMotionQuery.matches) {
    return null;
  }

  if (smoothScrollController) {
    if (onScrollActivity) {
      smoothScrollController.listeners.add(onScrollActivity);
    }
    return smoothScrollController.lenis;
  }

  const [{ gsap, ScrollTrigger }, Lenis] = await Promise.all([
    loadGsapBundle(),
    loadLenisModule(),
  ]);

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
  if (reducedMotionQuery.matches) {
    return Promise.resolve();
  }
  if (landingBackgroundPromise) {
    return landingBackgroundPromise;
  }

  landingBackgroundPromise = import("./landing-background.js")
    .then(({ initScaleBackground }) => initScaleBackground())
    .catch((err) => {
      console.error("[landingBackground] init failed", err);
    });

  return landingBackgroundPromise;
}

async function initStepCards() {
  if (reducedMotionQuery.matches || !document.querySelector(".step-card")) {
    return;
  }

  const { gsap } = await loadGsapBundle();
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
}

function initWaitlistForm() {
  const form = document.querySelector(".waitlist-form");
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const emailField = form.elements.email;
  const submitButton = form.querySelector('button[type="submit"]');
  const statusEl = form.querySelector(".waitlist-feedback");
  const captchaWrap = form.querySelector(".waitlist-captcha");
  const captchaMount = form.querySelector("[data-turnstile]");

  let submitting = false;
  let turnstileSiteKey = "";
  let turnstileToken = "";
  let widgetId = null;

  function setStatus(tone, message) {
    if (!(statusEl instanceof HTMLElement)) {
      return;
    }
    statusEl.className = `waitlist-feedback${tone ? ` is-${tone}` : ""}`;
    statusEl.textContent = message || "";
  }

  function syncSubmitState() {
    if (!(submitButton instanceof HTMLButtonElement)) {
      return;
    }
    submitButton.disabled = submitting || Boolean(turnstileSiteKey && !turnstileToken);
    submitButton.textContent = submitting ? "Joining" : "Get access";
  }

  function handleCaptchaScriptLoad() {
    if (!window.turnstile || widgetId !== null || !(captchaMount instanceof HTMLElement)) {
      return;
    }

    widgetId = window.turnstile.render(captchaMount, {
      sitekey: turnstileSiteKey,
      callback: (token) => {
        turnstileToken = String(token || "");
        setStatus("", "");
        syncSubmitState();
      },
      "expired-callback": () => {
        turnstileToken = "";
        setStatus("error", "CAPTCHA expired. Please retry.");
        syncSubmitState();
      },
      "error-callback": () => {
        turnstileToken = "";
        setStatus("error", "CAPTCHA failed to load. Refresh and try again.");
        syncSubmitState();
      },
    });

    if (captchaWrap instanceof HTMLElement) {
      captchaWrap.hidden = false;
    }
    syncSubmitState();
  }

  function ensureTurnstileScript() {
    if (!turnstileSiteKey || !(captchaMount instanceof HTMLElement)) {
      return;
    }
    if (window.turnstile) {
      handleCaptchaScriptLoad();
      return;
    }

    const existingScript = document.querySelector('script[data-turnstile-script="true"]');
    if (existingScript instanceof HTMLScriptElement) {
      existingScript.addEventListener("load", handleCaptchaScriptLoad, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstileScript = "true";
    script.addEventListener("load", handleCaptchaScriptLoad, { once: true });
    document.head.appendChild(script);
  }

  fetch("/api/config", {
    headers: { Accept: "application/json" },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((config) => {
      if (config?.turnstileSiteKey) {
        turnstileSiteKey = String(config.turnstileSiteKey);
        ensureTurnstileScript();
        syncSubmitState();
      }
    })
    .catch(() => {});

  syncSubmitState();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("", "");

    if (!(emailField instanceof HTMLInputElement) || !emailField.value.trim()) {
      setStatus("error", "Enter your email to join the waitlist.");
      emailField?.focus();
      return;
    }

    if (!emailField.checkValidity()) {
      setStatus("error", "Enter a valid email address.");
      emailField.focus();
      return;
    }

    submitting = true;
    syncSubmitState();

    try {
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      payload.page_url = window.location.href;
      payload.referrer = document.referrer || "";
      payload.turnstileToken = turnstileToken;

      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || "Submission failed");
      }

      form.reset();
      turnstileToken = "";
      if (window.turnstile && widgetId !== null) {
        window.turnstile.reset(widgetId);
      }
      setStatus("success", result.message || "You're on the list. We'll send access details soon.");
    } catch (error) {
      setStatus("error", error.message || "Something went wrong. Try again.");
    } finally {
      submitting = false;
      syncSubmitState();
    }
  });
}

function scheduleEnhancements() {
  initWaitlistForm();

  const startEnhancements = () => {
    void initSmoothScroll();
    void initStepCards();
    window.setTimeout(() => {
      void loadLandingBackground();
    }, 1200);
  };

  if (document.readyState === "complete") {
    startEnhancements();
    return;
  }

  window.addEventListener("load", startEnhancements, { once: true });
}

scheduleEnhancements();
