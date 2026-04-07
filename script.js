import React, { useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import Lenis from "https://esm.sh/lenis@1.1.20";
import gsap from "https://esm.sh/gsap@3.12.5";
import { ScrollTrigger } from "https://esm.sh/gsap@3.12.5/ScrollTrigger";
import * as THREE from "https://esm.sh/three@0.161.0";

const typedTopic = document.getElementById("typed-topic");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const h = React.createElement;

gsap.registerPlugin(ScrollTrigger);

function initSmoothScroll() {
  if (reducedMotionQuery.matches) {
    return null;
  }

  const lenis = new Lenis({
    lerp: 0.075,
    smoothWheel: true,
    wheelMultiplier: 0.86,
  });

  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

function createSquareTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 32;
  textureCanvas.height = 32;
  const textureCtx = textureCanvas.getContext("2d");
  textureCtx.fillStyle = "#fff";
  textureCtx.fillRect(4, 4, 24, 24);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createPixelPoints(points, texture, size = 0.22, opacity = 0.9) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(points.length * 3);
  const colors = new Float32Array(points.length * 3);

  points.forEach((point, index) => {
    const offset = index * 3;
    positions[offset] = point.x;
    positions[offset + 1] = point.y;
    positions[offset + 2] = point.z;
    const color = new THREE.Color(point.color || "#ff4fe7");
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  });

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    map: texture,
    size,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    alphaTest: 0.08,
  });

  return new THREE.Points(geometry, material);
}

function curvePoint(start, control, end, t) {
  const inv = 1 - t;
  return new THREE.Vector3(
    inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
    inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
    inv * inv * start.z + 2 * inv * t * control.z + t * t * end.z
  );
}

function createNeuron({ center, scale, phase, texture }) {
  const group = new THREE.Group();
  const pixels = [];
  const anchors = [];
  const somaPalette = ["#fff0ff", "#ff72ec", "#d641ff", "#8d35ff"];

  for (let ring = 0; ring < 11; ring += 1) {
    const ringRadius = scale * (0.14 + ring * 0.095);
    const cells = 16 + ring * 14;
    for (let i = 0; i < cells; i += 1) {
      const angle = (Math.PI * 2 * i) / cells + phase * 0.3;
      const wobble = Math.sin(i * 1.7 + phase) * scale * 0.035;
      const squash = 0.72 + Math.sin(phase) * 0.08;
      pixels.push({
        x: Math.cos(angle) * (ringRadius + wobble),
        y: Math.sin(angle) * (ringRadius + wobble) * squash,
        z: Math.sin(angle * 2 + phase) * scale * 0.08,
        color: somaPalette[Math.min(somaPalette.length - 1, Math.floor(ring / 3))],
      });
    }
  }

  const branchCount = 11;
  for (let branch = 0; branch < branchCount; branch += 1) {
    const baseAngle = (Math.PI * 2 * branch) / branchCount + phase;
    const branchLength = scale * (1.85 + (branch % 4) * 0.34);
    const forkAt = 0.5 + (branch % 3) * 0.09;

    for (let i = 0; i < 46; i += 1) {
      const t = i / 45;
      const bend = Math.sin(t * Math.PI + phase + branch) * scale * 0.34;
      const radius = scale * 0.56 + branchLength * t;
      const x = Math.cos(baseAngle) * radius + Math.cos(baseAngle + Math.PI / 2) * bend;
      const y = Math.sin(baseAngle) * radius + Math.sin(baseAngle + Math.PI / 2) * bend;
      const z = Math.sin(t * Math.PI * 1.4 + phase + branch) * scale * 0.16;
      pixels.push({
        x,
        y,
        z,
        color: t > 0.72 ? "#a847ff" : "#f044ff",
      });

      if (i === 45 || i === 34) {
        anchors.push(new THREE.Vector3(x, y, z).add(center));
      }
    }

    for (let fork = -1; fork <= 1; fork += 2) {
      const forkAngle = baseAngle + fork * (0.44 + (branch % 2) * 0.18);
      for (let i = 0; i < 23; i += 1) {
        const t = i / 22;
        const parentRadius = scale * 0.56 + branchLength * forkAt;
        const baseX = Math.cos(baseAngle) * parentRadius;
        const baseY = Math.sin(baseAngle) * parentRadius;
        const forkLength = scale * (0.7 + (branch % 3) * 0.18);
        const x = baseX + Math.cos(forkAngle) * forkLength * t;
        const y = baseY + Math.sin(forkAngle) * forkLength * t;
        const z = Math.sin(t * Math.PI + phase + fork) * scale * 0.08;
        pixels.push({
          x,
          y,
          z,
          color: t > 0.55 ? "#b544ff" : "#ff5aef",
        });
      }
    }
  }

  const neuronPixels = createPixelPoints(pixels, texture, 0.18 * scale, 0.92);
  group.add(neuronPixels);

  const core = createPixelPoints(
    [
      { x: 0, y: 0, z: scale * 0.08, color: "#fff7ff" },
      { x: scale * 0.08, y: 0, z: scale * 0.1, color: "#ffb9fb" },
      { x: -scale * 0.08, y: 0, z: scale * 0.1, color: "#ffb9fb" },
      { x: 0, y: scale * 0.08, z: scale * 0.1, color: "#ffffff" },
    ],
    texture,
    0.38 * scale,
    1
  );
  group.add(core);
  group.position.copy(center);
  group.userData = { phase, anchors, base: center.clone(), scale };
  return group;
}

function createSynapse({ start, end, texture, phase }) {
  const middle = start.clone().lerp(end, 0.5);
  const control = middle.add(
    new THREE.Vector3(
      Math.sin(phase) * 3.2,
      Math.cos(phase * 0.7) * 2.5,
      Math.sin(phase * 1.4) * 2.1
    )
  );
  const beads = [];
  for (let i = 0; i < 130; i += 1) {
    const t = i / 129;
    const point = curvePoint(start, control, end, t);
    beads.push({
      x: point.x,
      y: point.y,
      z: point.z,
      color: t < 0.5 ? "#b940ff" : "#ff46df",
    });
  }

  const points = createPixelPoints(beads, texture, 0.18, 0.5);
  points.geometry.setDrawRange(0, 16);
  const signal = createPixelPoints(
    [
      { x: start.x, y: start.y, z: start.z, color: "#fff2ff" },
      { x: start.x, y: start.y, z: start.z, color: "#ff8ff4" },
      { x: start.x, y: start.y, z: start.z, color: "#d45bff" },
    ],
    texture,
    0.42,
    1
  );

  return { points, signal, start, control, end, phase, count: beads.length };
}

function initNeuronParallax() {
  const canvas = document.getElementById("neuron-parallax-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
  camera.position.set(0, 0, 34);

  const texture = createSquareTexture();
  const field = new THREE.Group();
  scene.add(field);

  const neuronSpecs = [
    { center: new THREE.Vector3(-13, 6, -8), scale: 3.2, phase: 0.1 },
    { center: new THREE.Vector3(4, -1, 1), scale: 4.6, phase: 1.7 },
    { center: new THREE.Vector3(16, 7, -15), scale: 3.7, phase: 2.5 },
    { center: new THREE.Vector3(-7, -12, -4), scale: 3.9, phase: 3.2 },
    { center: new THREE.Vector3(19, -10, 4), scale: 3.0, phase: 4.1 },
    { center: new THREE.Vector3(-20, -2, -18), scale: 2.9, phase: 5.4 },
  ];
  const neurons = neuronSpecs.map((spec) => createNeuron({ ...spec, texture }));
  neurons.forEach((neuron) => field.add(neuron));

  const starPixels = [];
  for (let i = 0; i < 380; i += 1) {
    starPixels.push({
      x: (Math.random() - 0.5) * 58,
      y: (Math.random() - 0.5) * 44,
      z: -26 + Math.random() * 22,
      color: i % 3 === 0 ? "#ff78ef" : i % 3 === 1 ? "#a965ff" : "#ffe3ff",
    });
  }
  const stars = createPixelPoints(starPixels, texture, 0.12, 0.42);
  field.add(stars);

  const synapses = [
    createSynapse({ start: neurons[0].userData.anchors[1], end: neurons[1].userData.anchors[3], texture, phase: 0.2 }),
    createSynapse({ start: neurons[1].userData.anchors[4], end: neurons[2].userData.anchors[0], texture, phase: 1.3 }),
    createSynapse({ start: neurons[1].userData.anchors[7], end: neurons[3].userData.anchors[2], texture, phase: 2.1 }),
    createSynapse({ start: neurons[3].userData.anchors[5], end: neurons[4].userData.anchors[1], texture, phase: 3.0 }),
    createSynapse({ start: neurons[5].userData.anchors[4], end: neurons[0].userData.anchors[6], texture, phase: 4.4 }),
  ];
  synapses.forEach((synapse) => {
    field.add(synapse.points);
    field.add(synapse.signal);
  });

  ScrollTrigger.create({
    trigger: document.body,
    start: "top top",
    end: "bottom bottom",
    scrub: 1.35,
    onUpdate: ({ progress }) => {
      camera.position.y = THREE.MathUtils.lerp(0, -8.5, progress);
      camera.position.x = Math.sin(progress * Math.PI * 2) * 2.2;
      field.rotation.y = THREE.MathUtils.lerp(-0.08, 0.12, progress);
      field.rotation.x = THREE.MathUtils.lerp(0.05, -0.07, progress);
    },
  });

  function resize() {
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate(time = 0) {
    const t = time * 0.00012;

    neurons.forEach((neuron, index) => {
      const { base, phase, scale } = neuron.userData;
      neuron.position.x = base.x + Math.sin(t * (0.5 + index * 0.05) + phase) * 0.35;
      neuron.position.y = base.y + Math.cos(t * (0.42 + index * 0.04) + phase) * 0.28;
      neuron.rotation.z = Math.sin(t * 0.16 + phase) * 0.025;
      neuron.scale.setScalar(1 + Math.sin(t * 0.44 + phase) * 0.012 * scale);
    });

    synapses.forEach((synapse, index) => {
      const growth = 0.18 + 0.82 * ((Math.sin(t * (1.2 + index * 0.12) + synapse.phase) + 1) / 2);
      synapse.points.geometry.setDrawRange(0, Math.max(12, Math.floor(synapse.count * growth)));

      const signalPositions = synapse.signal.geometry.attributes.position;
      for (let i = 0; i < signalPositions.count; i += 1) {
        const progress = (t * (0.42 + index * 0.05) + i * 0.055 + synapse.phase * 0.1) % Math.max(growth, 0.2);
        const point = curvePoint(synapse.start, synapse.control, synapse.end, progress);
        signalPositions.setXYZ(i, point.x, point.y, point.z);
      }
      signalPositions.needsUpdate = true;
    });

    stars.rotation.z += 0.00006;
    renderer.render(scene, camera);
    window.requestAnimationFrame(animate);
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  animate();
}

initSmoothScroll();
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
