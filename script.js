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

function initSmoothScroll(onScrollActivity) {
  if (reducedMotionQuery.matches) {
    return null;
  }

  const lenis = new Lenis({
    lerp: 0.075,
    smoothWheel: true,
    wheelMultiplier: 0.86,
  });

  lenis.on("scroll", () => {
    onScrollActivity?.();
    ScrollTrigger.update();
  });
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

function createSeededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

function createSquareTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 16;
  textureCanvas.height = 16;
  const textureCtx = textureCanvas.getContext("2d");
  textureCtx.fillStyle = "#fff";
  textureCtx.fillRect(2, 2, 12, 12);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function makePixelInstance(points, opacity = 0.8) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: "#cc44ff",
    transparent: true,
    opacity,
    vertexColors: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, points.length);
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  points.forEach((point, index) => {
    scale.setScalar(point.size || 0.18);
    matrix.compose(new THREE.Vector3(point.x, point.y, point.z), rotation, scale);
    mesh.setMatrixAt(index, matrix);
    color.set(point.color || "#cc44ff");
    if (point.boost) {
      color.multiplyScalar(point.boost);
    }
    mesh.setColorAt(index, color);
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
  return mesh;
}

function createNeuron({ center, scale, seed, hidden = false, texture }) {
  const random = createSeededRandom(seed);
  const group = new THREE.Group();
  const pixels = [];
  const anchors = [];
  const somaPalette = ["#fff3ff", "#ff66ff", "#cc44ff", "#8f2dff", "#451075"];
  const coreRadius = scale * 0.95;

  for (let ring = 0; ring < 15; ring += 1) {
    const ringRadius = scale * (0.1 + ring * 0.085);
    const cells = 24 + ring * 18;
    for (let i = 0; i < cells; i += 1) {
      const angle = (Math.PI * 2 * i) / cells + seed * 0.01;
      const crossPull = Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
      const wobble = Math.sin(i * 1.7 + seed) * scale * 0.04;
      const radialDepth = Math.min(1, ringRadius / coreRadius);
      pixels.push({
        x: Math.cos(angle) * (ringRadius + wobble) * (0.8 + crossPull * 0.24),
        y: Math.sin(angle) * (ringRadius + wobble) * (0.64 + crossPull * 0.18),
        z: Math.sin(angle * 2 + seed) * scale * 0.14,
        size: scale * (0.075 + (1 - radialDepth) * 0.07),
        color: somaPalette[Math.min(somaPalette.length - 1, Math.floor(radialDepth * somaPalette.length))],
        boost: 1.6 + (1 - radialDepth) * 3.4,
      });
    }
  }

  for (let arm = 0; arm < 8; arm += 1) {
    const angle = (Math.PI * 2 * arm) / 8 + seed * 0.01;
    for (let i = 0; i < 12; i += 1) {
      const t = i / 11;
      const radius = scale * (0.18 + t * 1.2);
      pixels.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.78,
        z: scale * 0.22,
        size: scale * (0.16 - t * 0.06),
        color: t < 0.2 ? "#ffffff" : t < 0.52 ? "#ff44ff" : "#cc44ff",
        boost: 3.2 - t,
      });
    }
  }

  function addDendriteBranch({ angle, length, bendSeed, startRadius = scale * 0.72, steps = 78, width = 1 }) {
    let tip = new THREE.Vector3();
    const perpX = Math.cos(angle + Math.PI / 2);
    const perpY = Math.sin(angle + Math.PI / 2);

    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      const bend = Math.sin(t * Math.PI * 1.35 + bendSeed) * scale * 0.52 * (1 - t * 0.35);
      const radius = startRadius + length * t;
      const centerX = Math.cos(angle) * radius + perpX * bend;
      const centerY = Math.sin(angle) * radius + perpY * bend;
      const centerZ = scale * (0.28 + Math.sin(t * Math.PI * 2 + bendSeed) * 0.08);
      const taper = scale * (0.34 * (1 - t) + 0.075) * width;
      const lanes = Math.max(1, Math.ceil(taper / (scale * 0.18)));
      tip = new THREE.Vector3(centerX, centerY, centerZ);

      for (let lane = -lanes; lane <= lanes; lane += 1) {
        const laneT = lanes === 0 ? 0 : lane / lanes;
        pixels.push({
          x: centerX + perpX * laneT * taper,
          y: centerY + perpY * laneT * taper,
          z: centerZ + Math.abs(laneT) * scale * 0.025,
          size: scale * (0.11 + (1 - t) * 0.07),
          color: t > 0.72 ? "#6d1fff" : t > 0.38 ? "#b936ff" : "#ff44cc",
          boost: 1.4 + (1 - t) * 1.5,
        });
      }
    }

    anchors.push(tip.clone().add(center));
    return tip;
  }

  const silhouetteCount = 10;
  for (let branch = 0; branch < silhouetteCount; branch += 1) {
    const angle = (Math.PI * 2 * branch) / silhouetteCount + seed * 0.015 + (branch % 2) * 0.1;
    const length = scale * (3.8 + (branch % 4) * 0.6);
    const tip = addDendriteBranch({ angle, length, bendSeed: seed + branch * 1.7, width: branch % 3 === 0 ? 1.18 : 1 });

    for (let fork = -1; fork <= 1; fork += 2) {
      const forkAngle = angle + fork * (0.36 + (branch % 3) * 0.1);
      const forkStart = scale * (2.7 + (branch % 2) * 0.45);
      const forkBase = new THREE.Vector3(
        Math.cos(angle) * forkStart,
        Math.sin(angle) * forkStart,
        scale * 0.22
      );
      const forkLength = scale * (1.4 + (branch % 3) * 0.35);
      for (let i = 0; i < 34; i += 1) {
        const t = i / 33;
        const sideBend = Math.sin(t * Math.PI + seed + branch + fork) * scale * 0.16;
        pixels.push({
          x: forkBase.x + Math.cos(forkAngle) * forkLength * t + Math.cos(forkAngle + Math.PI / 2) * sideBend,
          y: forkBase.y + Math.sin(forkAngle) * forkLength * t + Math.sin(forkAngle + Math.PI / 2) * sideBend,
          z: forkBase.z + Math.sin(t * Math.PI) * scale * 0.06,
          size: scale * (0.085 + (1 - t) * 0.035),
          color: t > 0.58 ? "#7d2bff" : "#d83dff",
          boost: 1.2,
        });
      }
    }

    if (branch % 2 === 0) {
      anchors.push(tip.clone().multiplyScalar(0.82).add(center));
    }
  }

  for (let spine = 0; spine < 6; spine += 1) {
    const angle = seed * 0.01 + (Math.PI * 2 * spine) / 6 + 0.18;
    const perpX = Math.cos(angle + Math.PI / 2);
    const perpY = Math.sin(angle + Math.PI / 2);
    for (let i = 0; i < 64; i += 1) {
      const t = i / 63;
      const radius = scale * (0.42 + t * 5.3);
      const width = Math.max(1, Math.ceil((1 - t) * 4));
      const wave = Math.sin(t * Math.PI * 1.2 + seed + spine) * scale * 0.34;
      const centerX = Math.cos(angle) * radius + perpX * wave;
      const centerY = Math.sin(angle) * radius * 0.82 + perpY * wave;
      for (let lane = -width; lane <= width; lane += 1) {
        const laneOffset = lane * scale * 0.16;
        pixels.push({
          x: centerX + perpX * laneOffset,
          y: centerY + perpY * laneOffset,
          z: scale * 0.42,
          size: scale * (0.14 - t * 0.045),
          color: t > 0.7 ? "#7121ff" : t > 0.32 ? "#bb33ff" : "#ff44cc",
          boost: 2.2 - t * 0.65,
        });
      }
    }
  }

  const branchCount = 10;
  for (let branch = 0; branch < branchCount; branch += 1) {
    const baseAngle = (Math.PI * 2 * branch) / branchCount + random() * 0.42;
    const branchLength = scale * (2.1 + random() * 1.55);
    const bendFactor = (random() - 0.5) * 0.86;
    let finalPoint = new THREE.Vector3();

    for (let i = 0; i < 68; i += 1) {
      const t = i / 67;
      const bend = Math.sin(t * Math.PI * 1.6 + seed + branch) * bendFactor * scale;
      const radius = scale * 0.62 + branchLength * t;
      finalPoint = new THREE.Vector3(
        Math.cos(baseAngle) * radius + Math.cos(baseAngle + Math.PI / 2) * bend,
        Math.sin(baseAngle) * radius + Math.sin(baseAngle + Math.PI / 2) * bend,
        Math.sin(t * Math.PI * 2 + branch) * scale * 0.18
      );
      pixels.push({
        x: finalPoint.x,
        y: finalPoint.y,
        z: finalPoint.z,
        size: scale * (0.06 + (1 - t) * 0.035),
        color: t > 0.72 ? "#6d1fff" : t > 0.36 ? "#cc44ff" : "#ff44cc",
        boost: 1.15,
      });
    }

    anchors.push(finalPoint.clone().add(center));

    for (let fork = 0; fork < 2; fork += 1) {
      const forkSign = fork === 0 ? -1 : 1;
      const forkStart = 0.48 + random() * 0.24;
      const forkAngle = baseAngle + forkSign * (0.42 + random() * 0.34);
      const forkLength = scale * (0.75 + random() * 0.85);
      const parentRadius = scale * 0.62 + branchLength * forkStart;
      const baseX = Math.cos(baseAngle) * parentRadius;
      const baseY = Math.sin(baseAngle) * parentRadius;
      for (let i = 0; i < 30; i += 1) {
        const t = i / 29;
        pixels.push({
          x: baseX + Math.cos(forkAngle) * forkLength * t,
          y: baseY + Math.sin(forkAngle) * forkLength * t,
          z: Math.sin(t * Math.PI + forkSign) * scale * 0.08,
          size: scale * 0.052,
          color: t > 0.55 ? "#7d2bff" : "#d83dff",
          boost: 1.05,
        });
      }
    }
  }

  const neuronPixels = makePixelInstance(pixels, hidden ? 0 : 1);
  group.add(neuronPixels);

  const halo = new THREE.Points(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([0, 0, scale * 0.18, scale * 0.35, 0, scale * 0.18, -scale * 0.35, 0, scale * 0.18, 0, scale * 0.35, scale * 0.18, 0, -scale * 0.35, scale * 0.18]), 3)
    ),
    new THREE.PointsMaterial({
      map: texture,
      size: scale * 1.35,
      sizeAttenuation: true,
      transparent: true,
      opacity: hidden ? 0 : 0.9,
      color: "#ff66ff",
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  group.add(halo);

  const core = new THREE.Mesh(
    new THREE.BoxGeometry(scale * 0.9, scale * 0.9, scale * 0.9),
    new THREE.MeshBasicMaterial({ color: "#fff3ff", transparent: true, opacity: hidden ? 0 : 0.65, depthTest: true, depthWrite: false })
  );
  group.add(core);
  const glow = new THREE.PointLight("#ff44cc", hidden ? 0 : 18, scale * 11, 1.6);
  group.add(glow);
  group.position.copy(center);
  group.userData = {
    anchors,
    base: center.clone(),
    coreMaterial: core.material,
    glow,
    haloMaterial: halo.material,
    hidden,
    phase: seed,
    pixelMaterial: neuronPixels.material,
    scale,
  };
  return group;
}

function createSynapse({ start, end, phase }) {
  const middle = start.clone().lerp(end, 0.5);
  const control = middle.add(
    new THREE.Vector3(
      Math.sin(phase) * 5.5,
      Math.cos(phase * 0.7) * 4.2,
      Math.sin(phase * 1.4) * 2.1
    )
  );
  const curve = new THREE.CatmullRomCurve3([start, control, end]);
  const beads = [];
  for (let i = 0; i < 150; i += 1) {
    const t = i / 149;
    const point = curve.getPointAt(t);
    const neuronProximity = Math.pow(Math.abs(t - 0.5) * 2, 1.8);
    const depthShift = (Math.sin(t * Math.PI + phase) + 1) / 2;
    beads.push({
      x: point.x,
      y: point.y,
      z: point.z,
      size: 0.1 + neuronProximity * 0.36,
      color: depthShift > 0.64 ? "#ff44cc" : t < 0.5 ? "#cc44ff" : "#7a24ff",
      boost: 1.25 + neuronProximity * 1.25,
    });
  }

  const points = makePixelInstance(beads, 0.68);
  points.count = 16;
  const signal = makePixelInstance(
    [
      { x: 0, y: 0, z: 0, size: 0.42, color: "#fff2ff", boost: 2.8 },
      { x: 0.18, y: 0, z: 0, size: 0.28, color: "#00ffcc", boost: 2.2 },
      { x: -0.18, y: 0, z: 0, size: 0.22, color: "#ff44cc", boost: 1.8 },
    ],
    1
  );

  return { curve, points, signal, phase, count: beads.length };
}

function initNeuronParallax() {
  const canvas = document.getElementById("neuron-parallax-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.autoClear = true;
  renderer.setClearColor(0x0d0a1a, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0d0a1a");
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
  camera.position.set(0, 0, 38);

  const texture = createSquareTexture();
  const field = new THREE.Group();
  scene.add(field);

  const neuronSpecs = [
    { center: new THREE.Vector3(-16, 6, -4), scale: 3.2, seed: 17 },
    { center: new THREE.Vector3(-1, 0, 2), scale: 5.1, seed: 31 },
    { center: new THREE.Vector3(16, 5, -8), scale: 3.4, seed: 47 },
    { center: new THREE.Vector3(-9, -12, -2), scale: 3.1, seed: 63 },
    { center: new THREE.Vector3(10, 13, -14), scale: 3.0, seed: 79, hidden: true },
  ];
  const neurons = neuronSpecs.map((spec) => createNeuron({ ...spec, texture }));
  neurons.forEach((neuron) => field.add(neuron));
  window.__EMERSUS_NEURON_DEBUG = {
    loadedAt: new Date().toISOString(),
    renderer: "three-opaque-instanced-neuron-shape",
    neuronCount: neurons.length,
    firstNeuronChildren: neurons[0]?.children.length || 0,
    scriptVersion: "neuron-opaque-shape-20260407b",
  };

  const particleGeometry = new THREE.BufferGeometry();
  const particleCount = 460;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);
  const particleBase = new Float32Array(particleCount * 3);
  const particlePhases = new Float32Array(particleCount);
  const particlePalette = ["#ffdd00", "#00ffcc", "#ff6644", "#cc44ff"];
  for (let i = 0; i < particleCount; i += 1) {
    const offset = i * 3;
    const x = (Math.random() - 0.5) * 70;
    const y = (Math.random() - 0.5) * 44;
    const z = -28 + Math.random() * 35;
    particlePositions[offset] = x;
    particlePositions[offset + 1] = y;
    particlePositions[offset + 2] = z;
    particleBase[offset] = x;
    particleBase[offset + 1] = y;
    particleBase[offset + 2] = z;
    particlePhases[i] = Math.random() * Math.PI * 2;
    const color = new THREE.Color(particlePalette[i % particlePalette.length]);
    particleColors[offset] = color.r;
    particleColors[offset + 1] = color.g;
    particleColors[offset + 2] = color.b;
  }
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      map: texture,
      size: 0.14,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.78,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  field.add(particles);

  const synapses = [
    createSynapse({ start: neurons[0].userData.anchors[2], end: neurons[1].userData.anchors[6], phase: 0.2 }),
    createSynapse({ start: neurons[1].userData.anchors[3], end: neurons[2].userData.anchors[7], phase: 1.3 }),
    createSynapse({ start: neurons[1].userData.anchors[1], end: neurons[3].userData.anchors[5], phase: 2.1 }),
    createSynapse({ start: neurons[2].userData.anchors[8], end: neurons[4].userData.anchors[4], phase: 3.0 }),
    createSynapse({ start: neurons[3].userData.anchors[0], end: neurons[0].userData.anchors[4], phase: 4.4 }),
  ];
  synapses.forEach((synapse) => {
    field.add(synapse.points);
    field.add(synapse.signal);
  });

  const scrollState = {
    cameraX: 0,
    cameraY: 0,
    cameraZ: 34,
    fieldX: 0.03,
    fieldY: -0.08,
    fieldScale: 1,
    hiddenNeuronOpacity: 0,
    particleOpacity: 0.78,
    pulseSpeed: 0.22,
    warmth: 0,
    allPulse: 0,
  };

  let renderMode = "always";
  let scrollActiveUntil = performance.now() + 2400;
  const markScrollActive = () => {
    scrollActiveUntil = performance.now() + 1200;
    renderMode = "always";
  };
  initSmoothScroll(markScrollActive);

  if (!reducedMotionQuery.matches) {
    gsap.timeline({
      scrollTrigger: {
        trigger: document.body,
        start: "top top",
        end: "bottom bottom",
        scrub: 1.15,
      },
    })
      .to(scrollState, { cameraZ: 22, fieldScale: 1.16, duration: 0.25, ease: "none" }, 0)
      .to(scrollState, { cameraX: 8.5, cameraY: 1.4, fieldY: -0.08, pulseSpeed: 0.46, particleOpacity: 0.9, duration: 0.25, ease: "none" }, 0.25)
      .to(scrollState, { fieldY: 0.26, fieldX: 0.08, warmth: 1, hiddenNeuronOpacity: 1, duration: 0.25, ease: "none" }, 0.5)
      .to(scrollState, { cameraZ: 40, cameraX: 0, cameraY: -1.5, fieldY: 0.02, fieldX: -0.02, fieldScale: 0.98, pulseSpeed: 0.68, particleOpacity: 1, allPulse: 1, duration: 0.25, ease: "none" }, 0.75);
  } else {
    initSmoothScroll();
  }

  function resize() {
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  let lastRenderAt = 0;
  function animate(time = 0) {
    window.requestAnimationFrame(animate);
    const now = performance.now();
    if (renderMode === "demand" && now - lastRenderAt < 180) {
      return;
    }

    const t = time * 0.001;
    camera.position.set(scrollState.cameraX, scrollState.cameraY, scrollState.cameraZ);
    camera.lookAt(0, 0, 0);
    field.rotation.y = scrollState.fieldY + Math.sin(t * 0.08) * 0.015;
    field.rotation.x = scrollState.fieldX + Math.cos(t * 0.07) * 0.012;
    field.scale.setScalar(scrollState.fieldScale);

    neurons.forEach((neuron, index) => {
      const pulse = 1 + Math.sin(t * (0.55 + scrollState.allPulse * 1.6) + neuron.userData.phase) * 0.018;
      neuron.scale.setScalar(pulse);
      neuron.position.x = neuron.userData.base.x + Math.sin(t * 0.12 + index) * 0.22;
      neuron.position.y = neuron.userData.base.y + Math.cos(t * 0.1 + index) * 0.18;
      if (neuron.userData.hidden) {
        neuron.userData.pixelMaterial.opacity = scrollState.hiddenNeuronOpacity * 0.88;
        neuron.userData.coreMaterial.opacity = scrollState.hiddenNeuronOpacity * 0.96;
        neuron.userData.haloMaterial.opacity = scrollState.hiddenNeuronOpacity * 0.9;
        neuron.userData.glow.intensity = scrollState.hiddenNeuronOpacity * 18;
      } else {
        neuron.userData.glow.intensity = 14 + Math.sin(t * 1.4 + index) * 2 + scrollState.allPulse * 5;
      }
    });

    synapses.forEach((synapse, index) => {
      const growth = 0.18 + 0.82 * ((Math.sin(t * (0.65 + index * 0.08) + synapse.phase) + 1) / 2);
      synapse.points.count = Math.max(12, Math.floor(synapse.count * growth));
      const signalT = (t * (0.05 + scrollState.pulseSpeed * 0.1) + index * 0.19) % 1;
      synapse.signal.position.copy(synapse.curve.getPointAt(signalT));
      synapse.signal.scale.setScalar(1 + Math.sin(t * 5 + index) * 0.22);
    });

    const particlePositionAttr = particles.geometry.attributes.position;
    for (let i = 0; i < particlePositionAttr.count; i += 1) {
      const offset = i * 3;
      const phase = particlePhases[i];
      particlePositionAttr.setXYZ(
        i,
        particleBase[offset] + Math.sin(t * 0.18 + phase) * (0.5 + scrollState.particleOpacity * 0.8),
        particleBase[offset + 1] + Math.cos(t * 0.14 + phase) * 0.55,
        particleBase[offset + 2] + Math.sin(t * 0.12 + phase) * 0.38
      );
    }
    particlePositionAttr.needsUpdate = true;
    particles.material.opacity = scrollState.particleOpacity;

    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    lastRenderAt = now;

    if (now > scrollActiveUntil && renderMode === "always") {
      renderMode = "demand";
    }
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  animate();
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
