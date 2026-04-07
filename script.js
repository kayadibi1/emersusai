import React, { useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";

const typedTopic = document.getElementById("typed-topic");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const h = React.createElement;

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

  const nodeCount = reducedMotionQuery.matches ? 10 : 18;
  const starCount = reducedMotionQuery.matches ? 90 : 180;
  const nodes = [];
  const stars = [];

  const rand = (min, max) => Math.random() * (max - min) + min;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function makeNode(index) {
    const layer = index % 4;
    return {
      x: rand(0.08, 0.92),
      y: rand(0.04, 0.96),
      driftX: rand(-0.000055, 0.000055) * (layer + 1),
      driftY: rand(-0.000045, 0.000045) * (layer + 1),
      radius: rand(7.5, 15.5),
      pulse: rand(0.18, 0.7),
      phase: rand(0, Math.PI * 2),
      dendrites: Math.floor(rand(9, 16)),
      layer,
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
      ctx.fillStyle = `rgba(${star.layer === 2 ? "255,63,228" : star.layer === 1 ? "184,92,255" : "255,180,244"}, ${clamp(alpha, 0.05, 0.95)})`;
      const size = Math.max(1, Math.round(star.size + star.layer * 0.7));
      ctx.fillRect(Math.round(star.x * width), Math.round(y - 6), size, size);
    }
  }

  function drawConnections(projectedNodes, parallax) {
    const maxDistance = Math.min(width, height) * 0.62;
    for (let i = 0; i < projectedNodes.length; i += 1) {
      for (let j = i + 1; j < projectedNodes.length; j += 1) {
        const a = projectedNodes[i];
        const b = projectedNodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.hypot(dx, dy);
        if (distance > maxDistance) continue;

        const intensity = 1 - distance / maxDistance;
        const depth = (a.depth + b.depth) / 2;
        const alpha = clamp(intensity * (0.16 + depth * 0.48), 0.035, 0.62);
        const hue = 287 + Math.sin((a.seed + b.seed + time) * 0.7) * 17 + parallax * 0.03;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${62 + depth * 18}%, ${alpha})`;
        ctx.lineWidth = 0.6 + intensity * (0.8 + depth * 1.6);
        const growth = clamp(
          0.18 + 0.82 * ((Math.sin(time * (0.32 + depth * 0.18) + a.seed * 0.9 + b.seed) + 1) / 2),
          0.18,
          1
        );
        const endX = a.x + (b.x - a.x) * growth;
        const endY = a.y + (b.y - a.y) * growth;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        if (!reducedMotionQuery.matches && intensity > 0.16 && growth > 0.42) {
          const signalPhase = Math.min(growth, (time * (0.08 + depth * 0.18) + (a.seed + b.seed) * 0.077) % 1);
          const sx = a.x + (b.x - a.x) * signalPhase;
          const sy = a.y + (b.y - a.y) * signalPhase;
          const packetSize = Math.max(3, Math.round(3 + depth * 6));
          ctx.shadowColor = "rgba(244, 64, 255, 0.95)";
          ctx.shadowBlur = 8 + depth * 18;
          ctx.fillStyle = `rgba(255, ${Math.round(92 + depth * 120)}, 247, ${0.65 + depth * 0.28})`;
          ctx.fillRect(Math.round(sx - packetSize / 2), Math.round(sy - packetSize / 2), packetSize, packetSize);
          ctx.shadowBlur = 0;
        }
      }
    }
  }

  function drawNodes(projectedNodes, parallax) {
    for (let i = 0; i < projectedNodes.length; i += 1) {
      const node = projectedNodes[i];
      const pixel = node.pixel;
      const glow = 12 + node.radius * (2.8 + node.depth * 2.7) + Math.sin(time * node.pulse + node.phase) * 3.5;
      const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glow * 4.1);
      gradient.addColorStop(0, `rgba(255, 130, 246, ${0.78 + node.depth * 0.16})`);
      gradient.addColorStop(0.28, "rgba(191, 60, 255, 0.42)");
      gradient.addColorStop(1, "rgba(81, 0, 130, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(node.x, node.y, glow * 4.1, 0, Math.PI * 2);
      ctx.fill();

      for (let ring = 6; ring >= 0; ring -= 1) {
        const cells = 12 + ring * 10;
        const ringRadius = pixel * (1.7 + ring * 1.15);
        for (let k = 0; k < cells; k += 1) {
          const angle = (Math.PI * 2 * k) / cells + node.phase * 0.4;
          const jitter = Math.sin(time * 0.34 + k + node.phase) * pixel * 0.28;
          const x = Math.round(node.x + Math.cos(angle) * (ringRadius + jitter));
          const y = Math.round(node.y + Math.sin(angle) * (ringRadius + jitter));
          ctx.fillStyle =
            ring <= 1
              ? "rgba(255, 221, 255, 0.96)"
              : ring <= 3
                ? "rgba(255, 78, 230, 0.82)"
                : "rgba(165, 56, 255, 0.62)";
          ctx.fillRect(x, y, pixel, pixel);
        }
      }

      ctx.fillStyle = "rgba(255, 234, 255, 0.98)";
      ctx.fillRect(Math.round(node.x - pixel), Math.round(node.y - pixel), pixel * 2, pixel * 2);

      for (let k = 0; k < node.dendrites; k += 1) {
        const angle = (Math.PI * 2 * k) / node.dendrites + node.phase + parallax * 0.0009;
        const armLength = glow * (1.55 + (k % 5) * 0.32);
        const segments = 12 + (k % 7);
        const armGrowth = clamp(
          0.35 + 0.65 * ((Math.sin(time * 0.26 + node.phase + k * 0.9) + 1) / 2),
          0.35,
          1
        );
        for (let segment = 1; segment <= segments; segment += 1) {
          const progress = segment / segments;
          if (progress > armGrowth) continue;
          const wiggle = Math.sin(time * 0.9 + segment + node.phase) * pixel * 0.8;
          const sx = node.x + Math.cos(angle) * armLength * progress + wiggle;
          const sy = node.y + Math.sin(angle) * armLength * progress - wiggle;
          ctx.fillStyle = `rgba(${k % 2 ? "255,96,238" : "190,82,255"}, ${0.42 - progress * 0.22 + node.depth * 0.22})`;
          ctx.fillRect(Math.round(sx), Math.round(sy), Math.max(1, pixel - 1), Math.max(1, pixel - 1));
        }
      }
    }
  }

  function tick() {
    rafId = window.requestAnimationFrame(tick);
    time += 0.0046;
    scrollCurrent += (scrollTarget - scrollCurrent) * 0.038;
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

      const depth = 0.42 + node.layer * 0.2;
      const layerShift = (node.layer + 1) * 0.06;
      const px = node.x * width + Math.sin(time * (0.18 + depth * 0.1) + node.phase) * (5 + depth * 16);
      const py = node.y * height + parallax * layerShift + Math.cos(time * (0.16 + depth * 0.1) + node.phase) * (4 + depth * 12);
      projectedNodes.push({
        ...node,
        depth,
        pixel: Math.max(3, Math.round((4 + node.layer * 1.6) * Math.min(width, height) / 760)),
        radius: node.radius * depth,
        x: px,
        y: ((py % (height + 60)) + (height + 60)) % (height + 60) - 30,
        seed: i * 1.37,
      });
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

function WaitlistForm({ variant = "full", endpoint = "/api/waitlist" }) {
  const [status, setStatus] = useState({ tone: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const isHero = variant === "hero";
  const emailId = isHero ? "hero-waitlist-email" : "waitlist-email";

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

    if (!endpoint) {
      setStatus({ tone: "error", message: "Add a real waitlist endpoint before launch." });
      return;
    }

    setSubmitting(true);

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
      setStatus({
        tone: "success",
        message: result.message || "You're on the list. We'll keep you posted.",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error.message || "Something went wrong while sending your signup. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (isHero) {
    return h(
      React.Fragment,
      null,
      h(
        "form",
        {
          className: "flex flex-col sm:flex-row gap-0 w-full max-w-2xl border-l border-secondary/30 pl-8 py-4",
          id: "hero-waitlist-form",
          method: "post",
          noValidate: true,
          onSubmit: submit,
        },
        h(
          "div",
          { className: "flex-1" },
          h("label", { className: "block text-[10px] uppercase tracking-ultra text-secondary mb-2", htmlFor: emailId }, "BE THE FIRST IN LINE"),
          h("input", {
            autoComplete: "email",
            className: "w-full bg-transparent border-none text-on-surface text-xl p-0 focus:ring-0 placeholder:text-white/20",
            id: emailId,
            inputMode: "email",
            name: "email",
            placeholder: "YOUR EMAIL",
            required: true,
            type: "email",
          })
        ),
        h(
          "button",
          {
            className: "waitlist-submit bg-secondary text-black font-headline font-extrabold uppercase px-12 py-5 mt-4 sm:mt-0 hover:bg-white transition-all tracking-widest text-sm",
            disabled: submitting,
            type: "submit",
          },
          submitting ? "Joining..." : "Join Waitlist"
        )
      ),
      h("p", {
        "aria-live": "polite",
        className: `waitlist-feedback mt-4 text-[10px] uppercase tracking-[0.3em] text-on-surface-variant${status.tone ? ` is-${status.tone}` : ""}`,
        role: "status",
      }, status.message)
    );
  }

  return h(
    React.Fragment,
    null,
    h(
      "form",
      {
        className: "mx-auto w-full max-w-3xl",
        method: "post",
        noValidate: true,
        onSubmit: submit,
      },
      h(
        "div",
        { className: "grid gap-4 sm:grid-cols-2" },
        h("input", { autoComplete: "given-name", className: "w-full border border-white/10 bg-black/30 px-6 py-5 text-on-surface placeholder:text-white/25 focus:border-secondary focus:ring-secondary", name: "name", placeholder: "NAME (OPTIONAL)", type: "text" }),
        h("input", { autoComplete: "family-name", className: "w-full border border-white/10 bg-black/30 px-6 py-5 text-on-surface placeholder:text-white/25 focus:border-secondary focus:ring-secondary", name: "surname", placeholder: "SURNAME (OPTIONAL)", type: "text" })
      ),
      h("div", { className: "mt-4" },
        h("input", { autoComplete: "organization", className: "w-full border border-white/10 bg-black/30 px-6 py-5 text-on-surface placeholder:text-white/25 focus:border-secondary focus:ring-secondary", name: "company", placeholder: "COMPANY (OPTIONAL)", type: "text" })
      ),
      h(
        "div",
        { className: "mt-4" },
        h("label", { className: "mb-2 block text-[10px] uppercase tracking-[0.3em] text-secondary", htmlFor: emailId }, "EMAIL *"),
        h("input", { autoComplete: "email", className: "w-full border border-white/10 bg-black/30 px-6 py-5 text-on-surface placeholder:text-white/25 focus:border-secondary focus:ring-secondary", id: emailId, inputMode: "email", name: "email", placeholder: "YOUR EMAIL", required: true, type: "email" })
      ),
      h("p", { className: "mt-3 text-left text-[10px] uppercase tracking-[0.2em] text-on-surface-variant" }, "* Required"),
      h(
        "div",
        { className: "mt-5 flex flex-col gap-4 sm:flex-row" },
        h("button", {
          className: "waitlist-submit bg-gradient-to-r from-primary-dim to-primary text-black font-headline font-black uppercase px-16 py-6 text-sm tracking-[0.3em] hover:scale-105 transition-transform",
          disabled: submitting,
          type: "submit",
        }, submitting ? "Requesting..." : "Request Credentials")
      )
    ),
    h("p", {
      "aria-live": "polite",
      className: `waitlist-feedback mt-5 text-[10px] uppercase tracking-[0.3em] text-on-surface-variant${status.tone ? ` is-${status.tone}` : ""}`,
      role: "status",
    }, status.message)
  );
}

document.querySelectorAll("[data-waitlist-root]").forEach((root) => {
  createRoot(root).render(
    h(WaitlistForm, {
      endpoint: root.dataset.formEndpoint || "/api/waitlist",
      variant: root.dataset.waitlistVariant || "full",
    })
  );
});

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
