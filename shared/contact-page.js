async function bindContactForm() {
  const form = document.querySelector("[data-contact-form]");
  if (!form) {
    return;
  }

  const status = document.querySelector("[data-contact-status]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);

    status.textContent = "";
    delete status.dataset.tone;

    submitButton.disabled = true;
    submitButton.textContent = "Sending...";

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: String(formData.get("name") || "").trim(),
          email: String(formData.get("email") || "").trim().toLowerCase(),
          category: String(formData.get("category") || "").trim(),
          message: String(formData.get("message") || "").trim(),
          page_url: window.location.href,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to send your message.");
      }

      form.reset();
      status.dataset.tone = "success";
      status.textContent = payload.message;
    } catch (error) {
      status.dataset.tone = "error";
      status.textContent = error.message || "Unable to send your message.";
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Send Message";
    }
  });
}

bindContactForm();
