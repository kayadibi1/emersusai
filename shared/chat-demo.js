const transcript = document.querySelector("[data-demo-transcript]");
const input = document.querySelector("[data-demo-input]");
const sendButton = document.querySelector("[data-demo-send]");
const clearButton = document.querySelector("[data-demo-clear]");
const emptyState = document.querySelector("[data-demo-empty]");
const modeButtons = document.querySelectorAll("[data-demo-mode]");
const promptButtons = document.querySelectorAll("[data-demo-prompt]");
const goalNode = document.querySelector("[data-demo-goal]");
const contextNode = document.querySelector("[data-demo-context]");
const headingNode = document.querySelector("[data-demo-heading]");
const subheadingNode = document.querySelector("[data-demo-subheading]");

const demoModes = {
  hypertrophy: {
    heading: "Hypertrophy Strategy",
    subheading:
      "Evidence-aware planning for muscle gain, work capacity, and cognitive steadiness.",
    goal: "Lean mass with minimal cognitive drag.",
    context: "High workload, lifting four days, inconsistent sleep window.",
    userPrompt:
      "Build me a 4-day hypertrophy split that protects focus for a long workday.",
    assistantIntro:
      "For your constraints, I would bias toward a moderate-volume split with repeatable exercise selection, fixed training windows, and a hard cap on session length.",
    bullets: [
      "Use four lifting days built around upper-lower sequencing and leave at least one full low-stimulation evening before your heaviest day.",
      "Anchor hard sets in the 5-10 rep range for compounds, then finish with lower-friction accessories so you can progress without dragging recovery into the next work block.",
      "Keep pre-lift nutrition simple: a reliable meal, hydration, and caffeine only when the session timing does not disrupt sleep."
    ],
    metrics: [
      { value: "55 min", label: "Session cap" },
      { value: "14-18", label: "Sets / muscle" },
      { value: "2", label: "Deload triggers" }
    ]
  },
  focus: {
    heading: "Mental Performance Routine",
    subheading:
      "Daily structure for deep work, stable stimulation, and more predictable sleep pressure.",
    goal: "Sharper focus and cleaner energy through the workday.",
    context: "Knowledge work, afternoon fatigue, late-night screen spillover.",
    userPrompt:
      "What routine should I use if my deep work quality collapses by the afternoon?",
    assistantIntro:
      "I would treat this as a scheduling and recovery problem first, not purely a motivation problem. The goal is to preserve high-quality output earlier and reduce volatility later.",
    bullets: [
      "Front-load your hardest cognitive block within the first 2-4 hours after waking, before decision fatigue accumulates.",
      "Use a consistent caffeine cutoff and sunlight exposure early in the day so alertness rises when you need it and sleep pressure still builds at night.",
      "Reduce afternoon friction with one pre-planned lower-cognitive block instead of attempting a second maximal-focus window."
    ],
    metrics: [
      { value: "90 min", label: "Deep work block" },
      { value: "8 hrs", label: "Caffeine cutoff gap" },
      { value: "30 min", label: "Wind-down" }
    ]
  },
  recovery: {
    heading: "Recovery Protocol",
    subheading:
      "A lower-friction system for preserving performance through travel, soreness, and poor sleep.",
    goal: "Preserve output while minimizing cumulative fatigue.",
    context: "Frequent travel, sore lower body, limited training windows.",
    userPrompt:
      "I travel twice a month. Help me keep performance stable while recovery is limited.",
    assistantIntro:
      "The priority here is not perfect optimization. It is keeping the floor high so travel weeks do not erase momentum.",
    bullets: [
      "Shift to maintenance-level training volume when travel compresses your schedule and avoid chasing missed sessions aggressively.",
      "Treat hydration, meal timing, and walking exposure as non-negotiable levers because they preserve recovery with low cognitive cost.",
      "Use a simple re-entry plan when you return: one lighter lift, one sleep recovery night, then ramp normal intensity back in."
    ],
    metrics: [
      { value: "70%", label: "Travel volume" },
      { value: "8k+", label: "Daily steps" },
      { value: "1", label: "Re-entry day" }
    ]
  }
};

let activeMode = "hypertrophy";

function formatTime() {
  return new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function setMode(modeKey) {
  const mode = demoModes[modeKey];

  if (!mode) {
    return;
  }

  activeMode = modeKey;
  headingNode.textContent = mode.heading;
  subheadingNode.textContent = mode.subheading;
  goalNode.textContent = mode.goal;
  contextNode.textContent = mode.context;

  modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.demoMode === modeKey);
  });
}

function renderMessage({ role, body }) {
  const article = document.createElement("article");
  article.className = "demo-message";
  article.dataset.role = role;

  const head = document.createElement("div");
  head.className = "demo-message-head";
  head.innerHTML = `<span>${role === "assistant" ? "EMERSUS" : "YOU"}</span><span>${formatTime()}</span>`;
  article.appendChild(head);

  if (typeof body === "string") {
    const paragraph = document.createElement("p");
    paragraph.textContent = body;
    article.appendChild(paragraph);
  } else {
    if (body.intro) {
      const paragraph = document.createElement("p");
      paragraph.textContent = body.intro;
      article.appendChild(paragraph);
    }

    if (Array.isArray(body.bullets) && body.bullets.length > 0) {
      const list = document.createElement("ul");
      body.bullets.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      });
      article.appendChild(list);
    }

    if (Array.isArray(body.metrics) && body.metrics.length > 0) {
      const row = document.createElement("div");
      row.className = "demo-metric-row";
      body.metrics.forEach((metric) => {
        const card = document.createElement("div");
        card.className = "demo-metric";
        card.innerHTML = `<strong>${metric.value}</strong><span>${metric.label}</span>`;
        row.appendChild(card);
      });
      article.appendChild(row);
    }
  }

  transcript.appendChild(article);
  transcript.scrollTop = transcript.scrollHeight;
}

function clearTranscript() {
  transcript.innerHTML = "";
  emptyState.classList.add("is-visible");
}

function buildResponse(promptText) {
  const mode = demoModes[activeMode];

  return {
    intro: `${mode.assistantIntro} Your prompt was: "${promptText}"`,
    bullets: mode.bullets,
    metrics: mode.metrics,
  };
}

function simulateConversation(promptText) {
  const trimmed = promptText.trim();

  if (!trimmed) {
    emptyState.classList.add("is-visible");
    input.focus();
    return;
  }

  emptyState.classList.remove("is-visible");
  renderMessage({ role: "user", body: trimmed });
  input.value = "";
  sendButton.disabled = true;
  sendButton.textContent = "Thinking...";

  window.setTimeout(() => {
    renderMessage({
      role: "assistant",
      body: buildResponse(trimmed),
    });
    sendButton.disabled = false;
    sendButton.textContent = "Send Prompt";
  }, 480);
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.dataset.demoMode);
    clearTranscript();
    const mode = demoModes[button.dataset.demoMode];
    renderMessage({
      role: "assistant",
      body: {
        intro: mode.assistantIntro,
        bullets: mode.bullets,
        metrics: mode.metrics,
      },
    });
  });
});

promptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.demoPrompt || "";
    input.value = prompt;
    simulateConversation(prompt);
  });
});

sendButton.addEventListener("click", () => {
  simulateConversation(input.value);
});

clearButton.addEventListener("click", () => {
  input.value = "";
  clearTranscript();
  renderMessage({
    role: "assistant",
    body: "Fresh canvas ready. Choose a demo mode or type a new question to preview the conversation flow.",
  });
});

input.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    simulateConversation(input.value);
  }
});

setMode(activeMode);
