import React, { useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import Lenis from "https://esm.sh/lenis@1.1.20";
import gsap from "https://esm.sh/gsap@3.12.5";
import { ScrollTrigger } from "https://esm.sh/gsap@3.12.5/ScrollTrigger";
import * as THREE from "https://esm.sh/three@0.161.0";
import { EffectComposer } from "https://esm.sh/three@0.161.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://esm.sh/three@0.161.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://esm.sh/three@0.161.0/examples/jsm/postprocessing/UnrealBloomPass.js";

const h = React.createElement;
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

gsap.registerPlugin(ScrollTrigger);

function createSeededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

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

function createPixelBoxInstance(points, opacity = 0.9) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, points.length);
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const color = new THREE.Color();

  points.forEach((point, index) => {
    matrix.compose(
      new THREE.Vector3(point.x, point.y, point.z),
      rotation,
      new THREE.Vector3(point.size, point.size, point.size),
    );
    mesh.setMatrixAt(index, matrix);
    color.set(point.color);
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

function createSquareSpriteTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(7, 7, 18, 18);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createNeuron({ center, scale, seed, hidden = false }) {
  const random = createSeededRandom(seed);
  const group = new THREE.Group();
  const points = [];
  const anchors = [];
  const palette = ["#ffffff", "#ff88f7", "#ff44cc", "#cc44ff", "#9933cc", "#401066"];

  for (let ring = 0; ring < 16; ring += 1) {
    const t = ring / 15;
    const ringRadius = scale * (0.12 + t * 0.96);
    const cells = 22 + ring * 12;
    const color = palette[Math.min(palette.length - 1, Math.floor(t * palette.length))];
    for (let i = 0; i < cells; i += 1) {
      const angle = (i / cells) * Math.PI * 2 + seed * 0.01;
      const crossPull = Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
      const wobble = 0.72 + crossPull * 0.28 + Math.sin(i * 1.7 + seed) * 0.08;
      points.push({
        x: Math.cos(angle) * ringRadius * wobble,
        y: Math.sin(angle) * ringRadius * (0.64 + crossPull * 0.18),
        z: Math.sin(angle * 2 + seed) * scale * 0.12,
        size: scale * (0.08 + (1 - t) * 0.08),
        color,
        boost: 1.35 + (1 - t) * 2.3,
      });
    }
  }

  const branchCount = 10;
  for (let branch = 0; branch < branchCount; branch += 1) {
    const baseAngle = (branch / branchCount) * Math.PI * 2 + random() * 0.35;
    const branchLength = scale * (2.4 + random() * 1.8);
    const bendFactor = (random() - 0.5) * 0.9;
    let finalPoint = new THREE.Vector3();

    for (let i = 0; i < 84; i += 1) {
      const t = i / 83;
      const bend = Math.sin(t * Math.PI * 1.45 + seed + branch) * bendFactor * scale;
      const radius = scale * 0.72 + branchLength * t;
      finalPoint = new THREE.Vector3(
        Math.cos(baseAngle) * radius + Math.cos(baseAngle + Math.PI / 2) * bend,
        Math.sin(baseAngle) * radius * 0.84 + Math.sin(baseAngle + Math.PI / 2) * bend,
        Math.sin(t * Math.PI * 2 + branch) * scale * 0.18,
      );
      points.push({
        x: finalPoint.x,
        y: finalPoint.y,
        z: finalPoint.z,
        size: scale * (0.11 - t * 0.045),
        color: t > 0.72 ? "#7722cc" : t > 0.36 ? "#cc44ff" : "#ff44cc",
        boost: 1.05 + (1 - t) * 0.45,
      });
    }

    anchors.push(finalPoint.clone().add(center));

    for (let fork = 0; fork < 2; fork += 1) {
      const forkSign = fork === 0 ? -1 : 1;
      const forkStart = 0.44 + random() * 0.28;
      const forkAngle = baseAngle + forkSign * (0.42 + random() * 0.35);
      const forkLength = scale * (0.85 + random() * 0.95);
      const parentRadius = scale * 0.72 + branchLength * forkStart;
      const baseX = Math.cos(baseAngle) * parentRadius;
      const baseY = Math.sin(baseAngle) * parentRadius * 0.84;

      for (let i = 0; i < 34; i += 1) {
        const t = i / 33;
        points.push({
          x: baseX + Math.cos(forkAngle) * forkLength * t,
          y: baseY + Math.sin(forkAngle) * forkLength * t,
          z: Math.sin(t * Math.PI + forkSign) * scale * 0.08,
          size: scale * 0.056,
          color: t > 0.55 ? "#7d2bff" : "#d83dff",
          boost: 1.05,
        });
      }
    }
  }

  const pixelMesh = createPixelBoxInstance(points, hidden ? 0 : 0.95);
  group.add(pixelMesh);

  const core = new THREE.PointLight("#ff44cc", hidden ? 0 : 24, scale * 13, 1.6);
  group.add(core);

  const coreCube = new THREE.Mesh(
    new THREE.BoxGeometry(scale * 0.9, scale * 0.9, scale * 0.9),
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: hidden ? 0 : 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  group.add(coreCube);

  group.position.copy(center);
  group.userData = {
    anchors,
    base: center.clone(),
    core,
    coreMaterial: coreCube.material,
    hidden,
    phase: seed,
    pixelMaterial: pixelMesh.material,
  };
  return group;
}

function createSynapse(start, end, phase) {
  const midpoint = start.clone().lerp(end, 0.5);
  const control = midpoint.add(
    new THREE.Vector3(
      Math.sin(phase) * 5.5,
      Math.cos(phase * 0.7) * 4.2,
      Math.sin(phase * 1.4) * 2.1,
    ),
  );
  const curve = new THREE.CatmullRomCurve3([start, control, end]);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 90, 0.045, 6, false),
    new THREE.MeshBasicMaterial({
      color: "#7722cc",
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  const beads = [];
  for (let i = 0; i < 150; i += 1) {
    const t = i / 149;
    const point = curve.getPointAt(t);
    const endpointProximity = Math.abs(t - 0.5) * 2;
    beads.push({
      x: point.x,
      y: point.y,
      z: point.z,
      size: 0.1 + Math.pow(endpointProximity, 1.9) * 0.36,
      color: endpointProximity > 0.7 ? "#cc44ff" : "#7722cc",
      boost: 1.15 + endpointProximity * 1.25,
    });
  }
  const beadMesh = createPixelBoxInstance(beads, 0.74);

  const pulseGeometry = new THREE.BufferGeometry();
  const pulsePositions = new Float32Array(150 * 3);
  const pulseT = new Float32Array(150);
  for (let i = 0; i < 150; i += 1) {
    const t = i / 149;
    const point = curve.getPointAt(t);
    pulsePositions[i * 3] = point.x;
    pulsePositions[i * 3 + 1] = point.y;
    pulsePositions[i * 3 + 2] = point.z;
    pulseT[i] = t;
  }
  pulseGeometry.setAttribute("position", new THREE.BufferAttribute(pulsePositions, 3));
  pulseGeometry.setAttribute("aT", new THREE.BufferAttribute(pulseT, 1));
  const pulseMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uPulse: { value: 0 },
      uSize: { value: 12 },
    },
    vertexShader: `
      attribute float aT;
      uniform float uPulse;
      uniform float uSize;
      varying float vAlpha;
      void main() {
        float d = abs(aT - uPulse);
        d = min(d, 1.0 - d);
        vAlpha = smoothstep(0.045, 0.0, d);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (300.0 / -mvPosition.z) * (0.35 + vAlpha);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float shape = step(max(abs(p.x), abs(p.y)), 0.42);
        vec3 color = mix(vec3(0.0, 1.0, 0.8), vec3(1.0), vAlpha);
        gl_FragColor = vec4(color, shape * vAlpha);
      }
    `,
  });
  const pulse = new THREE.Points(pulseGeometry, pulseMaterial);

  return { curve, tube, beads: beadMesh, pulse, phase, pulseMaterial };
}

function initNeuronParallax() {
  const canvas = document.getElementById("neuron-parallax-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return () => {};
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setClearColor(0x0d0a1a, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0d0a1a");
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 140);
  camera.position.set(0, 0, 38);

  const field = new THREE.Group();
  scene.add(field);

  const neurons = [
    createNeuron({ center: new THREE.Vector3(-15, 6, -7), scale: 3.4, seed: 17 }),
    createNeuron({ center: new THREE.Vector3(1, -1, 1), scale: 4.7, seed: 31 }),
    createNeuron({ center: new THREE.Vector3(17, 7, -14), scale: 3.6, seed: 47 }),
    createNeuron({ center: new THREE.Vector3(-8, -12, -4), scale: 3.9, seed: 63 }),
    createNeuron({ center: new THREE.Vector3(10, 13, -18), scale: 3.1, seed: 79, hidden: true }),
  ];
  neurons.forEach((neuron) => field.add(neuron));

  const synapses = [
    createSynapse(neurons[0].userData.anchors[2], neurons[1].userData.anchors[6], 0.2),
    createSynapse(neurons[1].userData.anchors[3], neurons[2].userData.anchors[7], 1.3),
    createSynapse(neurons[1].userData.anchors[1], neurons[3].userData.anchors[5], 2.1),
    createSynapse(neurons[2].userData.anchors[8], neurons[4].userData.anchors[4], 3.0),
    createSynapse(neurons[3].userData.anchors[0], neurons[0].userData.anchors[4], 4.4),
  ];
  synapses.forEach((synapse) => {
    field.add(synapse.tube, synapse.beads, synapse.pulse);
  });

  const particleTexture = createSquareSpriteTexture();
  const particleCount = 460;
  const particleGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const basePositions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const phases = new Float32Array(particleCount);
  const random = createSeededRandom(204);
  const particlePalette = ["#ffdd00", "#00ffcc", "#ff6644", "#cc44ff"];

  for (let i = 0; i < particleCount; i += 1) {
    const offset = i * 3;
    const x = (random() - 0.5) * 74;
    const y = (random() - 0.5) * 46;
    const z = -30 + random() * 38;
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    basePositions[offset] = x;
    basePositions[offset + 1] = y;
    basePositions[offset + 2] = z;
    phases[i] = random() * Math.PI * 2;
    const color = new THREE.Color(particlePalette[i % particlePalette.length]);
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      map: particleTexture,
      size: 0.16,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.78,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  field.add(particles);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.8, 0.8, 0.2);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

  const scrollState = {
    cameraX: 0,
    cameraY: 0,
    cameraZ: 38,
    fieldX: 0.05,
    fieldY: -0.08,
    fieldScale: 1,
    hiddenNeuronOpacity: 0,
    particleOpacity: 0.78,
    pulseSpeed: 0.22,
    bloom: 1.8,
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
      .to(scrollState, { cameraZ: 22, fieldScale: 1.16, bloom: 2.15, duration: 0.25, ease: "none" }, 0)
      .to(scrollState, { cameraX: 8.5, cameraY: 1.4, pulseSpeed: 0.46, particleOpacity: 0.9, duration: 0.25, ease: "none" }, 0.25)
      .to(scrollState, { fieldY: 0.26, fieldX: 0.08, warmth: 1, hiddenNeuronOpacity: 1, duration: 0.25, ease: "none" }, 0.5)
      .to(scrollState, { cameraZ: 40, cameraX: 0, cameraY: -1.5, fieldY: 0.02, fieldX: -0.02, fieldScale: 0.98, pulseSpeed: 0.68, particleOpacity: 1, allPulse: 1, bloom: 2.25, duration: 0.25, ease: "none" }, 0.75);
  }

  function resize() {
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  let lastRenderAt = 0;
  let rafId = 0;
  function animate(time = 0) {
    rafId = window.requestAnimationFrame(animate);
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
    bloomPass.strength = scrollState.bloom;

    neurons.forEach((neuron, index) => {
      const pulse = 1 + Math.sin(t * (0.55 + scrollState.allPulse * 1.6) + neuron.userData.phase) * 0.018;
      neuron.scale.setScalar(pulse);
      neuron.position.x = neuron.userData.base.x + Math.sin(t * 0.12 + index) * 0.22;
      neuron.position.y = neuron.userData.base.y + Math.cos(t * 0.1 + index) * 0.18;

      if (neuron.userData.hidden) {
        neuron.userData.pixelMaterial.opacity = scrollState.hiddenNeuronOpacity * 0.88;
        neuron.userData.coreMaterial.opacity = scrollState.hiddenNeuronOpacity * 0.96;
        neuron.userData.core.intensity = scrollState.hiddenNeuronOpacity * 22;
      } else {
        neuron.userData.core.intensity = 16 + Math.sin(t * 1.4 + index) * 2 + scrollState.allPulse * 6;
      }
    });

    synapses.forEach((synapse, index) => {
      synapse.pulseMaterial.uniforms.uPulse.value = (t * (0.05 + scrollState.pulseSpeed * 0.1) + index * 0.19) % 1;
    });

    const particlePositionAttr = particles.geometry.attributes.position;
    for (let i = 0; i < particlePositionAttr.count; i += 1) {
      const offset = i * 3;
      const phase = phases[i];
      particlePositionAttr.setXYZ(
        i,
        basePositions[offset] + Math.sin(t * 0.18 + phase) * (0.5 + scrollState.particleOpacity * 0.8),
        basePositions[offset + 1] + Math.cos(t * 0.14 + phase) * 0.55,
        basePositions[offset + 2] + Math.sin(t * 0.12 + phase) * 0.38,
      );
    }
    particlePositionAttr.needsUpdate = true;
    particles.material.opacity = scrollState.particleOpacity;

    composer.render();
    lastRenderAt = now;

    if (now > scrollActiveUntil && renderMode === "always") {
      renderMode = "demand";
    }
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  animate();

  window.__EMERSUS_NEURON_DEBUG = {
    loadedAt: new Date().toISOString(),
    renderer: "three-react-neural-scene",
    neuronCount: neurons.length,
    synapseCount: synapses.length,
    scriptVersion: "three-react-neuron-restore-20260407",
  };

  return () => {
    window.cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
    ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    renderer.dispose();
    composer.dispose();
    particleGeometry.dispose();
    particleTexture.dispose();
    scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
  };
}

function createNeuronCurveHelper(curve, color = "#00ffcc", scale = 0.58) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];

  for (let i = 6; i < 72; i += 9) {
    const t = i / 80;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    positions.push(point.x, point.y, point.z);
    positions.push(point.x + tangent.x * scale, point.y + tangent.y * scale, point.z + tangent.z * scale);
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      depthTest: false,
    }),
  );
}

function createSomaNormalHelper(mesh, size = 0.72, color = "#9bff00") {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const positions = [];
  const step = Math.max(1, Math.floor(position.count / 220));
  const vertex = new THREE.Vector3();
  const direction = new THREE.Vector3();

  for (let i = 0; i < position.count; i += step) {
    vertex.fromBufferAttribute(position, i);
    direction.fromBufferAttribute(normal, i).normalize();
    positions.push(vertex.x, vertex.y, vertex.z);
    positions.push(vertex.x + direction.x * size, vertex.y + direction.y * size, vertex.z + direction.z * size);
  }

  const helperGeometry = new THREE.BufferGeometry();
  helperGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    helperGeometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.76,
      depthTest: false,
    }),
  );
}

function createHelperStyleNeuron(seed = 31) {
  const random = createSeededRandom(seed);
  const group = new THREE.Group();
  group.name = "Procedural 3D helper neuron";

  const neuronMaterial = new THREE.MeshStandardMaterial({
    color: "#cc44ff",
    emissive: "#7a168f",
    emissiveIntensity: 1.8,
    roughness: 0.42,
    metalness: 0.12,
  });

  const soma = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 4), neuronMaterial);
  soma.name = "Soma";
  soma.scale.set(1.18, 0.92, 1);
  soma.geometry.computeVertexNormals();
  group.add(soma);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.08, 2),
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  group.add(core);

  const wireframe = new THREE.LineSegments(
    new THREE.WireframeGeometry(soma.geometry),
    new THREE.LineBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.22,
      depthTest: false,
    }),
  );
  wireframe.position.x = 0.34;
  soma.add(wireframe);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(soma.geometry, 18),
    new THREE.LineBasicMaterial({
      color: "#00ffcc",
      transparent: true,
      opacity: 0.42,
      depthTest: false,
    }),
  );
  edges.position.x = -0.34;
  soma.add(edges);
  soma.add(createSomaNormalHelper(soma, 0.52));

  const tubeMaterial = neuronMaterial.clone();
  const axonMaterial = neuronMaterial.clone();
  axonMaterial.color.set("#ff44cc");
  axonMaterial.emissive.set("#a01472");

  function addTube(curve, radius, material, radialSegments = 9) {
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, radius, radialSegments, false), material);
    group.add(tube);

    const tubeWire = new THREE.LineSegments(
      new THREE.WireframeGeometry(tube.geometry),
      new THREE.LineBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.12,
        depthTest: false,
      }),
    );
    tube.add(tubeWire);
    group.add(createNeuronCurveHelper(curve));
    return tube;
  }

  for (let branch = 0; branch < 12; branch += 1) {
    const angle = (branch / 12) * Math.PI * 2 + random() * 0.28;
    const zLift = (random() - 0.5) * 5.4;
    const length = 8.6 + random() * 5.8;
    const start = new THREE.Vector3(Math.cos(angle) * 2.4, Math.sin(angle) * 2.0, zLift * 0.18);
    const mid = new THREE.Vector3(
      Math.cos(angle + (random() - 0.5) * 0.55) * (length * 0.58),
      Math.sin(angle + (random() - 0.5) * 0.55) * (length * 0.48),
      zLift + Math.sin(branch) * 1.4,
    );
    const end = new THREE.Vector3(
      Math.cos(angle + (random() - 0.5) * 0.75) * length,
      Math.sin(angle + (random() - 0.5) * 0.75) * (length * 0.82),
      zLift + (random() - 0.5) * 5,
    );
    const curve = new THREE.CatmullRomCurve3([start, mid, end]);
    addTube(curve, 0.16 + random() * 0.08, tubeMaterial);

    for (let fork = 0; fork < 2; fork += 1) {
      const forkSign = fork === 0 ? -1 : 1;
      const forkStart = curve.getPointAt(0.48 + random() * 0.22);
      const forkAngle = angle + forkSign * (0.38 + random() * 0.54);
      const forkLength = 3.1 + random() * 3.6;
      const forkEnd = forkStart.clone().add(new THREE.Vector3(
        Math.cos(forkAngle) * forkLength,
        Math.sin(forkAngle) * forkLength * 0.78,
        (random() - 0.5) * 3.4,
      ));
      const forkControl = forkStart.clone().lerp(forkEnd, 0.55).add(new THREE.Vector3(0, 0, forkSign * 1.1));
      addTube(new THREE.CatmullRomCurve3([forkStart, forkControl, forkEnd]), 0.07, tubeMaterial, 7);
    }
  }

  const axonCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.2, -0.3, -0.4),
    new THREE.Vector3(-7.4, -2.5, 1.4),
    new THREE.Vector3(-13.5, -5.4, -1.8),
    new THREE.Vector3(-20.2, -8.4, 2.2),
  ]);
  addTube(axonCurve, 0.28, axonMaterial, 12);

  for (let terminal = 0; terminal < 5; terminal += 1) {
    const angle = (terminal / 5) * Math.PI * 2;
    const end = axonCurve.getPointAt(1).clone();
    const terminalCurve = new THREE.CatmullRomCurve3([
      end,
      end.clone().add(new THREE.Vector3(Math.cos(angle) * 1.8, Math.sin(angle) * 1.2, Math.sin(angle) * 1.6)),
      end.clone().add(new THREE.Vector3(Math.cos(angle) * 3.2, Math.sin(angle) * 2.0, Math.sin(angle) * 2.2)),
    ]);
    addTube(terminalCurve, 0.09, axonMaterial, 7);
  }

  const glow = new THREE.PointLight("#ff44cc", 180, 54, 1.6);
  group.add(glow);
  group.userData = { core, glow, soma };
  return group;
}

function initHelperStyleNeuronParallax() {
  const canvas = document.getElementById("neuron-parallax-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return () => {};
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setClearColor(0x0d0a1a, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0d0a1a");
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1000);
  camera.position.set(0, 18, 46);

  const neuron = createHelperStyleNeuron();
  neuron.scale.setScalar(1.35);
  scene.add(neuron);

  const light = new THREE.PointLight("#ffffff", 650, 180);
  light.position.set(24, 18, 22);
  scene.add(light);
  scene.add(new THREE.PointLightHelper(light, 1.6, "#ffffff"));
  scene.add(new THREE.AmbientLight("#442255", 2.2));

  const gridHelper = new THREE.GridHelper(70, 28, 0x0000ff, 0x5b5566);
  gridHelper.position.y = -16;
  gridHelper.position.x = -15;
  scene.add(gridHelper);

  const polarGridHelper = new THREE.PolarGridHelper(24, 16, 8, 64, 0x0000ff, 0x5b5566);
  polarGridHelper.position.y = -16;
  polarGridHelper.position.x = 28;
  scene.add(polarGridHelper);

  const somaBoxHelper = new THREE.BoxHelper(neuron.userData.soma, "#ffdd00");
  const neuronBoxHelper = new THREE.BoxHelper(neuron, "#00ffcc");
  const sceneBoxHelper = new THREE.BoxHelper(scene, "#7755ff");
  scene.add(somaBoxHelper, neuronBoxHelper, sceneBoxHelper);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.25, 0.42, 0.2);
  composer.addPass(bloomPass);

  const scrollState = {
    cameraX: 0,
    cameraY: 0,
    cameraZ: 46,
    fieldX: 0.05,
    fieldY: -0.08,
    fieldScale: 1,
    bloom: 1.25,
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
      .to(scrollState, { cameraZ: 30, fieldScale: 1.12, bloom: 1.7, duration: 0.25, ease: "none" }, 0)
      .to(scrollState, { cameraX: 8.5, cameraY: 4.4, fieldY: 0.16, duration: 0.25, ease: "none" }, 0.25)
      .to(scrollState, { fieldY: 0.42, fieldX: 0.18, duration: 0.25, ease: "none" }, 0.5)
      .to(scrollState, { cameraZ: 44, cameraX: 0, cameraY: -1.5, fieldY: 0.02, fieldX: -0.02, fieldScale: 0.98, allPulse: 1, bloom: 1.85, duration: 0.25, ease: "none" }, 0.75);
  }

  function resize() {
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  let lastRenderAt = 0;
  let rafId = 0;
  function animate(time = 0) {
    rafId = window.requestAnimationFrame(animate);
    const now = performance.now();
    if (renderMode === "demand" && now - lastRenderAt < 180) {
      return;
    }

    const t = time * 0.001;
    camera.position.set(scrollState.cameraX, scrollState.cameraY, scrollState.cameraZ);
    camera.lookAt(0, 0, 0);
    neuron.rotation.y = scrollState.fieldY + t * 0.12;
    neuron.rotation.x = scrollState.fieldX + Math.cos(t * 0.28) * 0.035;
    neuron.rotation.z = Math.sin(t * 0.2) * 0.025;
    neuron.scale.setScalar(1.35 * scrollState.fieldScale * (1 + Math.sin(t * 1.15) * 0.012));
    bloomPass.strength = scrollState.bloom;
    light.position.x = Math.sin(t * 0.72) * 34;
    light.position.y = Math.cos(t * 0.64) * 26;
    light.position.z = 26 + Math.cos(t * 0.55) * 18;
    neuron.userData.core.scale.setScalar(1 + Math.sin(t * 2.4) * 0.12 + scrollState.allPulse * 0.08);
    neuron.userData.glow.intensity = 140 + Math.sin(t * 1.7) * 36 + scrollState.allPulse * 80;
    somaBoxHelper.update();
    neuronBoxHelper.update();

    composer.render();
    lastRenderAt = now;

    if (now > scrollActiveUntil && renderMode === "always") {
      renderMode = "demand";
    }
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  animate();

  window.__EMERSUS_NEURON_DEBUG = {
    loadedAt: new Date().toISOString(),
    renderer: "three-helper-style-3d-neuron",
    neuronCount: 1,
    helperStyle: "grid-polar-box-wire-normal-tangent",
    scriptVersion: "three-helper-neuron-20260407",
  };

  return () => {
    window.cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
    ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    renderer.dispose();
    composer.dispose();
    scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
  };
}

function WaitlistForm({ variant = "full", endpoint = "/api/waitlist" }) {
  const [status, setStatus] = useState({ tone: "", message: "" });
  const [submitting, setSubmitting] = useState(false);

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

    setSubmitting(true);
    try {
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      payload.page_url = window.location.href;
      payload.referrer = document.referrer || "";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || "Submission failed");
      }
      form.reset();
      setStatus({ tone: "success", message: result.message || "You're on the list. We'll send access details soon." });
    } catch (error) {
      setStatus({ tone: "error", message: error.message || "Something went wrong. Try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return h(
    "form",
    { className: `waitlist-form waitlist-form-${variant}`, onSubmit: submit },
    h("input", {
      name: "email",
      type: "email",
      inputMode: "email",
      autoComplete: "email",
      placeholder: "you@example.com",
      "aria-label": "Email address",
      required: true,
    }),
    h("button", { type: "submit", disabled: submitting }, submitting ? "Joining" : "Get access"),
    h("p", { className: `waitlist-feedback ${status.tone ? `is-${status.tone}` : ""}`, "aria-live": "polite" }, status.message),
  );
}

function Nav() {
  return h(
    "nav",
    { className: "nav" },
    h("a", { className: "brand", href: "#hero" }, "Emersus AI"),
    h(
      "div",
      { className: "nav-links" },
      h("a", { href: "#features" }, "Features"),
      h("a", { href: "#how" }, "How it works"),
      h("a", { href: "#proof" }, "Proof"),
      h("a", { href: "#access" }, "Access"),
    ),
    h("a", { className: "nav-cta", href: "#access" }, "Get access"),
  );
}

function Hero() {
  return h(
    "section",
    { className: "section hero", id: "hero" },
    h(
      "div",
      { className: "section-inner" },
      h("p", { className: "eyebrow" }, "Bioluminescent evidence engine"),
      h("h1", { className: "headline" }, "Optimize ", h("span", { className: "gradient" }, "your biology")),
      h("p", { className: "subtitle" }, "Emersus turns research into protocols for performance, recovery, nutrition, and focus, wrapped in a neural interface that feels alive."),
      h(
        "div",
        { className: "hero-actions" },
        h("a", { className: "button-primary", href: "#access" }, "Join waitlist"),
        h("a", { className: "button-secondary", href: "/chat/" }, "Open app"),
      ),
    ),
  );
}

function Features() {
  const features = [
    ["✦", "Evidence substrate", "Retrieve relevant studies and convert them into practical, citation-aware guidance without burying the signal."],
    ["◈", "Adaptive protocols", "Turn a question into a plan that can respond to context, constraints, and new research over time."],
    ["✺", "Human-first interface", "Chat with a system that keeps the answer readable while preserving sources, confidence, and guardrails."],
  ];

  return h(
    "section",
    { className: "section", id: "features" },
    h(
      "div",
      { className: "section-inner" },
      h("p", { className: "eyebrow" }, "Features"),
      h("h2", { className: "section-title" }, "A living interface for evidence-backed self-optimization."),
      h(
        "div",
        { className: "grid-3" },
        ...features.map(([icon, title, copy]) => h(
          "article",
          { className: "glass-card", key: title },
          h("div", { className: "icon" }, icon),
          h("h3", { className: "card-title" }, title),
          h("p", { className: "card-copy" }, copy),
        )),
      ),
    ),
  );
}

function HowItWorks() {
  const steps = [
    ["01", "Ask", "Start with a goal, symptom, supplement, training question, or recovery constraint."],
    ["02", "Retrieve", "Emersus searches the evidence layer and filters noisy matches before synthesis."],
    ["03", "Synthesize", "The model explains what the literature supports, what is uncertain, and what to do next."],
    ["04", "Iterate", "Follow up naturally while the thread keeps relevant context without over-assuming stale goals."],
  ];

  return h(
    "section",
    { className: "section", id: "how" },
    h(
      "div",
      { className: "section-inner" },
      h("p", { className: "eyebrow" }, "How it works"),
      h("h2", { className: "section-title" }, "From question to protocol in four signal passes."),
      h(
        "div",
        { className: "steps" },
        ...steps.map(([number, title, copy]) => h(
          "article",
          { className: "step-card", key: number },
          h("span", { className: "step-number" }, number),
          h("h3", { className: "step-title" }, title),
          h("p", { className: "step-copy" }, copy),
        )),
      ),
    ),
  );
}

function Testimonials() {
  return h(
    "section",
    { className: "section", id: "proof" },
    h(
      "div",
      { className: "section-inner quote-grid" },
      h(
        "article",
        { className: "quote-card large" },
        h("p", { className: "eyebrow" }, "Field note"),
        h("p", { className: "quote-copy" }, "The best health interface is not a dashboard. It is a nervous system for decisions: alive, responsive, and grounded in evidence."),
        h("p", { className: "quote-author" }, "Emersus research principle"),
      ),
      h(
        "article",
        { className: "quote-card" },
        h("p", { className: "eyebrow" }, "Why it matters"),
        h("p", { className: "section-copy" }, "Most optimization tools flatten the body into generic checklists. Emersus is built to preserve context, uncertainty, and the difference between what is promising and what is proven."),
      ),
    ),
  );
}

function FinalCta() {
  return h(
    "section",
    { className: "section cta", id: "access" },
    h(
      "div",
      { className: "section-inner" },
      h("p", { className: "eyebrow" }, "Private access"),
      h("h2", { className: "section-title" }, "Plug into the next evidence layer."),
      h("p", { className: "subtitle" }, "Join the waitlist for early access to Emersus AI."),
      h(WaitlistForm, { variant: "full" }),
    ),
  );
}

function Footer() {
  return h(
    "footer",
    { className: "footer" },
    h("span", null, "Emersus AI"),
    h("span", null, "Evidence layer active"),
  );
}

function OldCopyNav() {
  return h(
    "nav",
    { className: "nav" },
    h("a", { className: "brand", href: "#hero" }, "Emersus AI"),
    h(
      "div",
      { className: "nav-links" },
      h("a", { href: "/auth/login/" }, "App / Login"),
      h("a", { href: "/privacy/" }, "Privacy"),
      h("a", { href: "/terms/" }, "Terms"),
      h("a", { href: "/contact/" }, "Contact"),
    ),
    h("a", { className: "nav-cta", href: "#access" }, "Get access"),
  );
}

function OldCopyHero() {
  return h(
    "section",
    { className: "section hero", id: "hero" },
    h(
      "div",
      { className: "section-inner" },
      h("p", { className: "eyebrow" }, "EMERSUS"),
      h("h1", { className: "headline" }, h("span", { className: "gradient" }, "Optimize"), " or ", h("span", { className: "danger-word" }, "obsolete")),
      h("p", { className: "subtitle" }, "Scientifically grounded optimization AI for peak mental and physical performance. For those who take life seriously."),
      h(
        "div",
        { className: "hero-actions" },
        h("a", { className: "button-primary", href: "#access" }, "Get access"),
        h("a", { className: "button-secondary", href: "/chat/" }, "App / Login"),
      ),
      h(
        "div",
        { className: "hero-system-strip" },
        h("span", null, "Science-backed system"),
        h("span", null, "mental performance"),
        h("span", null, "physical training"),
        h("span", null, "nutrition"),
        h("span", null, "recovery"),
      ),
    ),
  );
}

function OldCopyFeatures() {
  const features = [
    ["01", "Cognitive Focus", "Modern science produces novel ways to improve mental performance every single day. EMERSUS tracks new publications, judges relevance and confidence, and tailors routines to your specific circumstances."],
    ["02", "Physical aptitude", "Weight-lifting, doing cardio, or simply looking for a way to get more restful sleep? EMERSUS cuts through the folklore and myths to deliver replicable and verifiable protocols using the collective output of all human sciences."],
    ["03", "Data integration", "EMERSUS supports data integration from smartphones and wearable technology to identify what you need to accomplish your goals. Track relevant performance markers and ignore the noise."],
  ];

  return h(
    "section",
    { className: "section", id: "features" },
    h(
      "div",
      { className: "section-inner" },
      h("p", { className: "eyebrow" }, "AI & science synthesis for peak performance"),
      h("h2", { className: "section-title" }, "Life is too short to not be your best"),
      h("p", { className: "section-copy" }, "EMERSUS offers optimization routines based on peer-reviewed research ranging from muscle hypertrophy to mental focus, without the jargon. Completely tailored to you."),
      h(
        "div",
        { className: "grid-3" },
        ...features.map(([icon, title, copy]) => h(
          "article",
          { className: "glass-card", key: title },
          h("div", { className: "icon" }, icon),
          h("h3", { className: "card-title" }, title),
          h("p", { className: "card-copy" }, copy),
        )),
      ),
    ),
  );
}

function OldCopyOptimization() {
  const topics = [
    ["01", "Mental performance", "Focus, stress regulation, learning, and cognitive routines grounded in current research."],
    ["02", "Physical training", "Replicable and verifiable protocols for lifting, cardio, performance, and recovery."],
    ["03", "Nutrition", "Practical nutrition guidance that cuts through folklore and tracks what evidence supports."],
    ["04", "Recovery", "Sleep, rest, and regeneration strategies tailored to the circumstances that matter."],
  ];

  return h(
    "section",
    { className: "section", id: "how" },
    h(
      "div",
      { className: "section-inner" },
      h("p", { className: "eyebrow" }, "EMERSUS can help you with"),
      h("h2", { className: "section-title" }, "Mental performance, physical training, nutrition, and recovery."),
      h(
        "div",
        { className: "steps" },
        ...topics.map(([number, title, copy]) => h(
          "article",
          { className: "step-card", key: number },
          h("span", { className: "step-number" }, number),
          h("h3", { className: "step-title" }, title),
          h("p", { className: "step-copy" }, copy),
        )),
      ),
    ),
  );
}

function OldCopyProtocol() {
  return h(
    "section",
    { className: "section", id: "proof" },
    h(
      "div",
      { className: "section-inner quote-grid" },
      h(
        "article",
        { className: "quote-card large" },
        h("p", { className: "eyebrow" }, "Bio-hacking life"),
        h("p", { className: "quote-copy" }, "AI Protocol Bot"),
        h("p", { className: "section-copy" }, "Competition in the modern world is more intense than ever in every aspect of life. You need the best information, in a digestible format, delivered when and where you need it to stay on top. EMERSUS delivers."),
        h("p", { className: "quote-author" }, "View methodology"),
      ),
      h(
        "article",
        { className: "quote-card" },
        h("p", { className: "eyebrow" }, "User Query"),
        h("p", { className: "section-copy" }, "\"How can I control my nerves for my upcoming sales pitch next week?\""),
        h("p", { className: "eyebrow quote-gap" }, "Protocol Response"),
        h("p", { className: "section-copy" }, "PUBLIC SPEAKING: Evidence on exposure, rehearsal structure, and cognitive reframing suggests a combined routine works best. Given your timeframe, I can build a short protocol to reduce anticipatory stress and sharpen delivery before your sales pitch."),
      ),
    ),
  );
}

function OldCopyFinalCta() {
  return h(
    "section",
    { className: "section cta", id: "access" },
    h(
      "div",
      { className: "section-inner" },
      h("p", { className: "eyebrow" }, "Private beta"),
      h("h2", { className: "section-title" }, "Ready to transcend limitations?"),
      h("p", { className: "subtitle" }, "Join the private beta. Validated human optimization for the modern elite. Experience revolutionary breakthroughs."),
      h(WaitlistForm, { variant: "full" }),
      h("div", { className: "hero-actions" }, h("a", { className: "button-secondary", href: "#features" }, "Explore science")),
    ),
  );
}

function OldCopyFooter() {
  return h(
    "footer",
    { className: "footer" },
    h("span", null, "Emersus AI"),
    h("span", null, "2026 EMERSUS AI. Laboratory grade performance. All rights reserved. Neural link secured."),
  );
}

function LandingPage() {
  return h(
    "div",
    { className: "landing-shell" },
    h(OldCopyNav),
    h(OldCopyHero),
    h(OldCopyFeatures),
    h(OldCopyOptimization),
    h(OldCopyProtocol),
    h(OldCopyFinalCta),
    h(OldCopyFooter),
  );
}

function mountLanding() {
  const root = document.getElementById("landing-root");
  if (!root) {
    return;
  }

  createRoot(root).render(h(LandingPage));

  requestAnimationFrame(() => {
    gsap.to(".step-card", {
      scrollTrigger: {
        trigger: "#how",
        start: "top 68%",
      },
      opacity: 1,
      y: 0,
      stagger: 0.12,
      duration: 0.85,
      ease: "power3.out",
    });
  });
}

initHelperStyleNeuronParallax();
mountLanding();
