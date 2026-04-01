const askAboutWord = document.querySelector("#ask-about-word");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

if (askAboutWord) {
  const topics = [
    "hypertrophy",
    "mental performance",
    "micronutrient intake",
    "optimal work hours",
    "supplements",
    "nutrition",
  ];

  if (reducedMotionQuery.matches) {
    askAboutWord.textContent = topics[0];
  } else {
    let topicIndex = 0;
    let charIndex = 0;
    let isDeleting = false;

    const tick = () => {
      const currentTopic = topics[topicIndex];
      charIndex += isDeleting ? -1 : 1;
      askAboutWord.textContent = currentTopic.slice(0, charIndex);

      let delay = isDeleting ? 45 : 85;

      if (!isDeleting && charIndex === currentTopic.length) {
        delay = 1200;
        isDeleting = true;
      } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        topicIndex = (topicIndex + 1) % topics.length;
        delay = 280;
      }

      window.setTimeout(tick, delay);
    };

    askAboutWord.textContent = "";
    window.setTimeout(tick, 500);
  }
}

document.querySelectorAll("[data-waitlist-form]").forEach((form) => {
  const emailField = form.elements.email;
  const message = form.nextElementSibling;
  const submitButton = form.querySelector('button[type="submit"]');
  const endpoint = form.dataset.formEndpoint?.trim();

  if (!(emailField instanceof HTMLInputElement) || !(message instanceof HTMLElement)) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.classList.remove("is-success", "is-error");
    message.textContent = "";

    if (!emailField.value.trim()) {
      message.textContent = "Enter your email to request access.";
      message.classList.add("is-error");
      emailField.focus();
      return;
    }

    if (!emailField.checkValidity()) {
      message.textContent = "Enter a valid email address.";
      message.classList.add("is-error");
      emailField.focus();
      return;
    }

    if (!endpoint) {
      message.textContent =
        "Add a real waitlist endpoint in data-form-endpoint before launch.";
      message.classList.add("is-error");
      return;
    }

    submitButton?.setAttribute("disabled", "disabled");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: new FormData(form),
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Submission failed");
      }

      form.reset();
      message.textContent = "You're on the list. We'll keep you posted.";
      message.classList.add("is-success");
    } catch (error) {
      message.textContent =
        "Something went wrong while sending your signup. Please verify the endpoint and try again.";
      message.classList.add("is-error");
    } finally {
      submitButton?.removeAttribute("disabled");
    }
  });
});
