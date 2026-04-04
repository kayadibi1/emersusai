const typedTopic = document.getElementById("typed-topic");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

if (typedTopic) {
  const topics = [
    "hypertrophy",
    "mental performance",
    "micronutrient intake",
    "supplements",
    "optimal work hours",
    "morning routines",
    "sleep habits",
  ];

  if (reducedMotionQuery.matches) {
    typedTopic.textContent = topics[0];
  } else {
    let topicIndex = 0;
    let charIndex = 0;
    let deleting = false;

    const tick = () => {
      const currentTopic = topics[topicIndex];
      charIndex += deleting ? -1 : 1;
      typedTopic.textContent = currentTopic.slice(0, charIndex);

      let delay = deleting ? 45 : 85;

      if (!deleting && charIndex === currentTopic.length) {
        deleting = true;
        delay = 1300;
      } else if (deleting && charIndex === 0) {
        deleting = false;
        topicIndex = (topicIndex + 1) % topics.length;
        delay = 250;
      }

      window.setTimeout(tick, delay);
    };

    typedTopic.textContent = "";
    window.setTimeout(tick, 500);
  }
}

document.querySelectorAll("[data-waitlist-form]").forEach((form) => {
  const emailField = form.elements.email;
  const feedback = form.nextElementSibling;
  const endpoint = form.dataset.formEndpoint?.trim();
  const submitButton = form.querySelector('button[type="submit"]');

  if (!(emailField instanceof HTMLInputElement) || !(feedback instanceof HTMLElement)) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.classList.remove("is-success", "is-error");
    feedback.textContent = "";

    if (!emailField.value.trim()) {
      feedback.textContent = "Enter your email to join the waitlist.";
      feedback.classList.add("is-error");
      emailField.focus();
      return;
    }

    if (!emailField.checkValidity()) {
      feedback.textContent = "Enter a valid email address.";
      feedback.classList.add("is-error");
      emailField.focus();
      return;
    }

    if (!endpoint) {
      feedback.textContent =
        "Add a real waitlist endpoint in data-form-endpoint before launch.";
      feedback.classList.add("is-error");
      return;
    }

    submitButton?.setAttribute("disabled", "disabled");

    try {
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());

      payload.page_url = window.location.href;
      payload.referrer = document.referrer || "";

      const response = await fetch(endpoint, {
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
      feedback.textContent = result.message || "You're on the list. We'll keep you posted.";
      feedback.classList.add("is-success");
    } catch (error) {
      feedback.textContent =
        error.message || "Something went wrong while sending your signup. Please try again.";
      feedback.classList.add("is-error");
    } finally {
      submitButton?.removeAttribute("disabled");
    }
  });
});
