const typedTopic = document.getElementById("typed-topic");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function initNeuronParallax() {
  const canvas = document.getElementById("neuron-parallax-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  let width = 0;
  let height = 0;
  let dpr = 1;
  let scrollTarget = 0;
  let scrollCurrent = 0;
  let rafId = 0;
  let time = 0;

  const nodeCount = reducedMotionQuery.matches ? 18 : 34;
  const starCount = reducedMotionQuery.matches ? 100 : 240;
  const nodes = [];
  const stars = [];

  const rand = (min, max) => Math.random() * (max - min) + min;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function makeNode(index) {
    return {
      x: rand(0.08, 0.92),
      y: rand(0.04, 0.96),
      driftX: rand(-0.00035, 0.00035),
      driftY: rand(-0.00028, 0.00028),
      radius: rand(1.8, 3.9),
      pulse: rand(0.4, 1.8),
      phase: rand(0, Math.PI * 2),
      layer: index % 3,
    };
  }

  function makeStar() {
    return {
      x: rand(0, 1),
      y: rand(0, 1),
      size: rand(0.7, 1.8),
      alpha: rand(0.25, 0.9),
      layer: Math.floor(rand(0, 3)),
      twinkle: rand(0.3, 1.5),
      phase: rand(0, Math.PI * 2),
    };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(window.innerWidth, 1);
    height = Math.max(window.innerHeight, 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawStars(parallax) {
    for (let i = 0; i < stars.length; i += 1) {
      const star = stars[i];
      const y = (star.y * height + parallax * (3 + star.layer * 3.4)) % (height + 12);
      const alpha = star.alpha * (0.6 + 0.4 * Math.sin(time * star.twinkle + star.phase));
      ctx.fillStyle = `rgba(${star.layer === 2 ? "159,251,0" : star.layer === 1 ? "117,217,255" : "246,121,255"}, ${clamp(alpha, 0.05, 0.95)})`;
      ctx.fillRect(star.x * width, y - 6, star.size, star.size);
    }
  }

  function drawConnections(projectedNodes, parallax) {
    const maxDistance = Math.min(width, height) * 0.28;
    for (let i = 0; i < projectedNodes.length; i += 1) {
      for (let j = i + 1; j < projectedNodes.length; j += 1) {
        const a = projectedNodes[i];
        const b = projectedNodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.hypot(dx, dy);
        if (distance > maxDistance) continue;

        const intensity = 1 - distance / maxDistance;
        const alpha = clamp(intensity * 0.5, 0.04, 0.45);
        const hue = 280 + Math.sin((a.seed + b.seed + time) * 0.6) * 40 + parallax * 0.06;
        ctx.strokeStyle = `hsla(${hue}, 100%, 72%, ${alpha})`;
        ctx.lineWidth = 0.7 + intensity * 1.25;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  function drawNodes(projectedNodes, parallax) {
    for (let i = 0; i < projectedNodes.length; i += 1) {
      const node = projectedNodes[i];
      const glow = 6 + node.radius * 2.2 + Math.sin(time * node.pulse + node.phase) * 2.2;
      const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glow * 3.4);
      gradient.addColorStop(0, "rgba(255, 137, 235, 0.85)");
      gradient.addColorStop(0.35, "rgba(194, 113, 255, 0.42)");
      gradient.addColorStop(1, "rgba(90, 26, 168, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(node.x, node.y, glow * 3.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255, 207, 255, 0.95)";
      ctx.fillRect(node.x - node.radius, node.y - node.radius, node.radius * 2, node.radius * 2);

      const synapseCount = 6;
      for (let k = 0; k < synapseCount; k += 1) {
        const angle = (Math.PI * 2 * k) / synapseCount + node.phase + parallax * 0.0015;
        const distance = glow * (1.8 + k * 0.32);
        const sx = node.x + Math.cos(angle) * distance;
        const sy = node.y + Math.sin(angle) * distance;
        ctx.fillStyle = `rgba(${k % 2 ? "141,221,255" : "159,251,0"}, ${0.24 + k * 0.08})`;
        ctx.fillRect(sx, sy, 1.4, 1.4);
      }
    }
  }

  function tick() {
    rafId = window.requestAnimationFrame(tick);
    time += 0.012;
    scrollCurrent += (scrollTarget - scrollCurrent) * 0.075;
    const parallax = scrollCurrent;

    ctx.clearRect(0, 0, width, height);

    drawStars(parallax);

    const projectedNodes = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      node.x += node.driftX;
      node.y += node.driftY;
      if (node.x < 0.04 || node.x > 0.96) node.driftX *= -1;
      if (node.y < 0.03 || node.y > 0.97) node.driftY *= -1;

      const layerShift = (node.layer + 1) * 0.06;
      const px = node.x * width + Math.sin(time * 0.6 + node.phase) * 11;
      const py = node.y * height + parallax * layerShift + Math.cos(time * 0.5 + node.phase) * 8;
      projectedNodes.push({ ...node, x: px, y: ((py % (height + 40)) + (height + 40)) % (height + 40) - 20, seed: i * 1.37 });
    }

    drawConnections(projectedNodes, parallax);
    drawNodes(projectedNodes, parallax);
  }

  for (let i = 0; i < nodeCount; i += 1) {
    nodes.push(makeNode(i));
  }
  for (let i = 0; i < starCount; i += 1) {
    stars.push(makeStar());
  }

  const onScroll = () => {
    scrollTarget = window.scrollY || window.pageYOffset || 0;
  };

  resize();
  onScroll();

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  tick();

  window.addEventListener("beforeunload", () => {
    if (rafId) window.cancelAnimationFrame(rafId);
  });
}

initNeuronParallax();

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
