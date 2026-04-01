const form = document.querySelector("#waitlist-form");
const message = document.querySelector("#form-message");

if (form && message) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const emailField = form.elements.email;
    const endpoint = form.dataset.formEndpoint?.trim();

    message.className = "form-message";

    if (!emailField.value.trim()) {
      message.textContent = "Please enter your email address.";
      message.classList.add("is-error");
      emailField.focus();
      return;
    }

    if (!endpoint) {
      message.textContent =
        "Set a real form endpoint in data-form-endpoint before going live. The layout is ready for GitHub Pages.";
      message.classList.add("is-error");
      return;
    }

    const formData = new FormData(form);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Submission failed");
      }

      form.reset();
      message.textContent = "You’re on the list. We’ll keep you posted.";
      message.classList.add("is-success");
    } catch (error) {
      message.textContent =
        "Something went wrong while sending your signup. Please try again after checking the form endpoint.";
      message.classList.add("is-error");
    }
  });
}
