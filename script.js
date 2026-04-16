const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointerQuery = window.matchMedia("(pointer: fine)");
const hoverQuery = window.matchMedia("(hover: hover)");
let landingBackgroundPromise = null;

function getConnectionSettings() {
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
}

function shouldUseRichLandingEffects() {
  if (reducedMotionQuery.matches) {
    return false;
  }

  const connection = getConnectionSettings();
  if (connection?.saveData) {
    return false;
  }

  const deviceMemory = navigator.deviceMemory ?? 8;
  const hardwareConcurrency = navigator.hardwareConcurrency ?? 8;

  return (
    finePointerQuery.matches &&
    hoverQuery.matches &&
    deviceMemory >= 4 &&
    hardwareConcurrency >= 6
  );
}

function loadLandingBackground() {
  if (!shouldUseRichLandingEffects()) {
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

function initStepCards() {
  const cards = Array.from(document.querySelectorAll(".step-card"));
  if (!cards.length || reducedMotionQuery.matches) {
    return;
  }

  if (!("IntersectionObserver" in window) || !shouldUseRichLandingEffects()) {
    return;
  }

  document.documentElement.classList.add("motion-ready");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.2,
      rootMargin: "0px 0px -10% 0px",
    },
  );

  cards.forEach((card, index) => {
    card.style.setProperty("--step-delay", `${index * 90}ms`);
    observer.observe(card);
  });
}

function scheduleEnhancements() {
  const startEnhancements = () => {
    initStepCards();
    window.setTimeout(() => {
      void loadLandingBackground();
    }, 900);
  };

  if (document.readyState === "complete") {
    startEnhancements();
    return;
  }

  window.addEventListener("load", startEnhancements, { once: true });
}

scheduleEnhancements();
