import * as THREE from "three";

export function initScaleBackground() {
  const canvas = document.getElementById("bg-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const COLORS = {
    blue: 0x4fa8ff,
    cyan: 0x6fe9ff,
    grey: 0x808890,
    dim: 0x3a4250,
  };

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setClearColor(0x000000, 1);

  const initialRect = canvas.getBoundingClientRect();
  const initialW = Math.max(initialRect.width || window.innerWidth || 1, 1);
  const initialH = Math.max(initialRect.height || window.innerHeight || 1, 1);
  renderer.setSize(initialW, initialH, false);

  const camera = new THREE.PerspectiveCamera(60, initialW / initialH, 0.05, 800000);
  camera.position.set(0, 0, 4);

  const scene = new THREE.Scene();

  function wireMat(color = COLORS.blue, opacity = 0.7) {
    return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
  }

  function makeBoxHelper(min, max, color = COLORS.dim, opacity = 0.3) {
    const box = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
    const helper = new THREE.Box3Helper(box, color);
    helper.material.transparent = true;
    helper.material.opacity = opacity;
    helper.material.depthTest = false;
    return helper;
  }

  function buildAtom() {
    const group = new THREE.Group();
    group.userData.electrons = [];

    const nucleus = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.5, 1)),
      wireMat(COLORS.cyan, 0.95),
    );
    group.add(nucleus);

    for (let i = 0; i < 6; i += 1) {
      const particle = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 6),
        new THREE.MeshBasicMaterial({ color: i % 2 ? COLORS.cyan : COLORS.blue }),
      );
      const angle = (i / 6) * Math.PI * 2;
      particle.position.set(Math.cos(angle) * 0.22, Math.sin(angle) * 0.22, Math.sin(angle * 1.7) * 0.18);
      group.add(particle);
    }

    for (let i = 0; i < 4; i += 1) {
      const radius = 1.5 + i * 0.15;
      const points = [];
      for (let k = 0; k <= 96; k += 1) {
        const angle = (k / 96) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
      }
      const orbit = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        wireMat(COLORS.blue, 0.55),
      );
      orbit.rotation.x = (i * Math.PI) / 4 + 0.4;
      orbit.rotation.y = (i * Math.PI) / 3;
      orbit.rotation.z = i * 0.3;
      group.add(orbit);

      const electron = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 10, 8),
        new THREE.MeshBasicMaterial({ color: COLORS.cyan }),
      );
      group.add(electron);
      group.userData.electrons.push({
        mesh: electron,
        orbit,
        radius,
        speed: 0.7 + i * 0.6,
        offset: i * 1.7,
      });
    }

    group.add(makeBoxHelper([-2, -2, -2], [2, 2, 2], COLORS.dim, 0.35));
    return group;
  }

  function buildDNA() {
    const group = new THREE.Group();
    const rungCount = 140;
    const step = 0.45;
    const radius = 4;
    const twist = 0.32;
    const strandA = [];
    const strandB = [];

    for (let i = 0; i < rungCount; i += 1) {
      const angle = i * twist;
      const y = (i - rungCount / 2) * step;
      strandA.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
      strandB.push(new THREE.Vector3(Math.cos(angle + Math.PI) * radius, y, Math.sin(angle + Math.PI) * radius));
    }

    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(strandA), wireMat(COLORS.blue, 0.85)));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(strandB), wireMat(COLORS.cyan, 0.85)));

    const rungs = [];
    for (let i = 0; i < rungCount; i += 2) {
      rungs.push(strandA[i], strandB[i]);
    }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rungs), wireMat(COLORS.grey, 0.45)));

    for (let i = 0; i < rungCount; i += 4) {
      for (const point of [strandA[i], strandB[i]]) {
        const node = new THREE.LineSegments(
          new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.32, 0)),
          wireMat(COLORS.blue, 0.7),
        );
        node.position.copy(point);
        group.add(node);
      }
    }

    group.add(makeBoxHelper([-radius * 1.3, (-rungCount / 2) * step, -radius * 1.3], [radius * 1.3, (rungCount / 2) * step, radius * 1.3], COLORS.dim, 0.3));
    return group;
  }

  function mulberry32(seed) {
    return function random() {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildCell() {
    const group = new THREE.Group();
    group.add(new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(220, 3)),
      wireMat(COLORS.blue, 0.55),
    ));
    group.add(new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(60, 2)),
      wireMat(COLORS.cyan, 0.85),
    ));
    group.add(new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(20, 1)),
      wireMat(COLORS.cyan, 0.95),
    ));

    const random = mulberry32(42);
    for (let i = 0; i < 22; i += 1) {
      const radius = 6 + random() * 14;
      const node = new THREE.LineSegments(
        new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(radius, 1)),
        wireMat(random() > 0.5 ? COLORS.grey : COLORS.blue, 0.6),
      );
      const phi = random() * Math.PI * 2;
      const theta = Math.acos(random() * 2 - 1);
      const distance = 90 + random() * 100;
      node.position.set(
        Math.sin(theta) * Math.cos(phi) * distance,
        Math.cos(theta) * distance,
        Math.sin(theta) * Math.sin(phi) * distance,
      );
      group.add(node);
    }

    group.add(makeBoxHelper([-240, -240, -240], [240, 240, 240], COLORS.dim, 0.3));
    return group;
  }

  function buildBrain() {
    const group = new THREE.Group();
    const geometry = new THREE.IcosahedronGeometry(3000, 4);
    const position = geometry.attributes.position;

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const length = Math.sqrt(x * x + y * y + z * z);
      const nx = x / length;
      const ny = y / length;
      const nz = z / length;
      const noise =
        Math.sin(nx * 9 + ny * 4) * Math.cos(ny * 7) * 0.1 +
        Math.sin(nz * 11) * Math.cos(nx * 8) * 0.06 +
        Math.sin(nx * 22 + nz * 18) * 0.03;
      const nextLength = length * (1 + noise);
      position.setXYZ(i, nx * nextLength, ny * nextLength, nz * nextLength);
    }

    geometry.computeVertexNormals();
    geometry.scale(1.15, 0.95, 1);
    group.add(new THREE.LineSegments(new THREE.WireframeGeometry(geometry), wireMat(COLORS.blue, 0.45)));

    const splitPoints = [];
    for (let i = 0; i <= 64; i += 1) {
      const angle = (i / 64) * Math.PI * 2;
      splitPoints.push(new THREE.Vector3(0, Math.cos(angle) * 2900, Math.sin(angle) * 3500));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(splitPoints), wireMat(COLORS.cyan, 0.7)));

    const cerebellum = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(900, 2)),
      wireMat(COLORS.cyan, 0.55),
    );
    cerebellum.position.set(0, -1900, -2200);
    group.add(cerebellum);

    const stem = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.CylinderGeometry(280, 380, 1500, 14, 1, true)),
      wireMat(COLORS.grey, 0.5),
    );
    stem.position.set(0, -2900, -1800);
    group.add(stem);

    group.add(makeBoxHelper([-3800, -3800, -3500], [3800, 3500, 3500], COLORS.dim, 0.3));
    return group;
  }

  function buildHumanoid(scaleUnit) {
    const figure = new THREE.Group();
    const point = (x, y, z) => new THREE.Vector3(x * scaleUnit, y * scaleUnit, z * scaleUnit);

    const addBlob = (rx, ry, rz, position, color = COLORS.cyan, opacity = 0.85, detail = 1) => {
      const geometry = new THREE.IcosahedronGeometry(1, detail);
      geometry.scale(rx * scaleUnit, ry * scaleUnit, rz * scaleUnit);
      const mesh = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), wireMat(color, opacity));
      mesh.position.copy(position);
      figure.add(mesh);
      return mesh;
    };

    const addLimb = (a, b, radius = 0.08, color = COLORS.blue, opacity = 0.85) => {
      const direction = new THREE.Vector3().subVectors(b, a);
      const length = direction.length();
      if (length < 1e-6) return null;
      const capsuleLength = Math.max(length - radius * scaleUnit * 2, 0.001);
      const geometry = new THREE.CapsuleGeometry(radius * scaleUnit, capsuleLength, 4, 10);
      const mesh = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), wireMat(color, opacity));
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
      figure.add(mesh);
      return mesh;
    };

    const addJoint = (position, radius = 0.07, color = COLORS.cyan, opacity = 0.9) => {
      const mesh = new THREE.LineSegments(
        new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(radius * scaleUnit, 1)),
        wireMat(color, opacity),
      );
      mesh.position.copy(position);
      figure.add(mesh);
      return mesh;
    };

    const hipLeft = point(0.16, -1.85, 0);
    const hipRight = point(-0.16, -1.85, 0);
    const kneeLeft = point(0.18, -1.85, 1.05);
    const kneeRight = point(-0.18, -1.85, 1.05);
    const ankleLeft = point(0.2, -3.05, 1.05);
    const ankleRight = point(-0.2, -3.05, 1.05);
    const toeLeft = point(0.2, -3.1, 1.32);
    const toeRight = point(-0.2, -3.1, 1.32);
    const pelvis = point(0, -1.82, 0.02);
    const chest = point(0, -1.05, 0.02);
    const neckBase = point(0, -0.55, 0.02);
    const neckTop = point(0, -0.34, 0.04);
    const head = point(0, -0.05, 0.05);
    const shoulderLeft = point(0.32, -0.6, 0.02);
    const shoulderRight = point(-0.32, -0.6, 0.02);
    const elbowLeft = point(0.4, -1.18, 0.32);
    const wristLeft = point(0.1, -1.58, 0.95);
    const handLeftTip = point(-0.02, -1.58, 1.12);
    const elbowRight = point(-0.62, -1.1, 0.3);
    const wristRight = point(-1.05, -1.58, 0.85);
    const handRightTip = point(-1.2, -1.58, 0.98);

    const addLathe = (profile, center, depthScale = 0.78, color = COLORS.cyan, opacity = 0.85, segments = 18) => {
      const points = profile.map(([px, py]) => new THREE.Vector2(px * scaleUnit, py * scaleUnit));
      const geometry = new THREE.LatheGeometry(points, segments);
      geometry.scale(1, 1, depthScale);
      const mesh = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), wireMat(color, opacity));
      mesh.position.copy(center);
      figure.add(mesh);
      return mesh;
    };

    addLathe([
      [0.001, -1.98],
      [0.20, -1.95],
      [0.27, -1.85],
      [0.26, -1.72],
      [0.21, -1.55],
      [0.19, -1.40],
      [0.22, -1.22],
      [0.28, -1.05],
      [0.31, -0.88],
      [0.30, -0.72],
      [0.26, -0.62],
      [0.14, -0.56],
      [0.09, -0.50],
      [0.001, -0.48],
    ], point(0, 0, 0.02), 0.62, COLORS.cyan, 0.85, 18);

    addLathe([
      [0.001, -0.50],
      [0.085, -0.48],
      [0.085, -0.36],
      [0.001, -0.34],
    ], point(0, 0, 0.03), 0.85, COLORS.blue, 0.8, 14);

    addLathe([
      [0.001, -0.34],
      [0.10, -0.30],
      [0.16, -0.22],
      [0.20, -0.10],
      [0.22, 0.02],
      [0.21, 0.12],
      [0.16, 0.20],
      [0.08, 0.24],
      [0.001, 0.25],
    ], point(0, 0, 0.05), 0.92, COLORS.cyan, 0.95, 18);

    figure.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([pelvis, chest, neckBase, neckTop, head]),
      wireMat(COLORS.cyan, 0.32),
    ));

    addLimb(shoulderLeft, elbowLeft, 0.085, COLORS.blue, 0.85);
    addLimb(elbowLeft, wristLeft, 0.07, COLORS.blue, 0.85);
    addLimb(shoulderRight, elbowRight, 0.085, COLORS.blue, 0.85);
    addLimb(elbowRight, wristRight, 0.07, COLORS.blue, 0.85);
    addBlob(0.07, 0.05, 0.07, wristLeft.clone().lerp(handLeftTip, 0.5), COLORS.cyan, 0.9, 1);
    addBlob(0.07, 0.05, 0.07, wristRight.clone().lerp(handRightTip, 0.5), COLORS.cyan, 0.9, 1);

    addLimb(hipLeft, kneeLeft, 0.11, COLORS.blue, 0.85);
    addLimb(kneeLeft, ankleLeft, 0.09, COLORS.blue, 0.85);
    addLimb(hipRight, kneeRight, 0.11, COLORS.blue, 0.85);
    addLimb(kneeRight, ankleRight, 0.09, COLORS.blue, 0.85);
    addBlob(0.08, 0.05, 0.16, ankleLeft.clone().lerp(toeLeft, 0.5), COLORS.cyan, 0.9, 1);
    addBlob(0.08, 0.05, 0.16, ankleRight.clone().lerp(toeRight, 0.5), COLORS.cyan, 0.9, 1);

    [hipLeft, hipRight, kneeLeft, kneeRight, ankleLeft, ankleRight, shoulderLeft, shoulderRight, elbowLeft, elbowRight, wristLeft, wristRight].forEach((joint) => {
      addJoint(joint, 0.07, COLORS.cyan, 0.9);
    });

    return figure;
  }

  function buildHumanStage() {
    const group = new THREE.Group();
    const scaleUnit = 8000;
    const floorY = -scaleUnit * 3.15;
    const box = (w, h, d, color = COLORS.blue, opacity = 0.65) => new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.BoxGeometry(w, h, d)),
      wireMat(color, opacity),
    );

    const grid = new THREE.GridHelper(scaleUnit * 28, 56, COLORS.blue, COLORS.dim);
    grid.position.y = floorY;
    grid.material.transparent = true;
    grid.material.opacity = 0.4;
    grid.material.depthTest = false;
    group.add(grid);

    const polar = new THREE.PolarGridHelper(scaleUnit * 9, 16, 8, 64, COLORS.blue, COLORS.dim);
    polar.position.set(0, floorY + 1, -scaleUnit * 7);
    polar.rotation.x = Math.PI / 2;
    polar.material.transparent = true;
    polar.material.opacity = 0.3;
    polar.material.depthTest = false;
    group.add(polar);

    const desk = box(scaleUnit * 6.2, scaleUnit * 0.22, scaleUnit * 3, COLORS.blue, 0.75);
    desk.position.set(0, -scaleUnit * 1.85, scaleUnit * 1.4);
    group.add(desk);

    {
      const deskBottomY = -scaleUnit * 1.85 - scaleUnit * 0.11;
      const legHeight = deskBottomY - floorY;
      const legCenterY = (deskBottomY + floorY) * 0.5;
      for (const [dx, dz] of [[-2.8, 0.05], [2.8, 0.05], [-2.8, 2.75], [2.8, 2.75]]) {
        const leg = box(scaleUnit * 0.18, legHeight, scaleUnit * 0.18, COLORS.grey, 0.55);
        leg.position.set(dx * scaleUnit, legCenterY, dz * scaleUnit);
        group.add(leg);
      }
    }

    const monitor = box(scaleUnit * 3.4, scaleUnit * 2, scaleUnit * 0.18, COLORS.cyan, 0.95);
    monitor.position.set(0, -scaleUnit * 0.25, scaleUnit * 2.4);
    group.add(monitor);

    for (let i = 0; i < 8; i += 1) {
      const widthScale = 0.6 + Math.sin(i * 1.7) * 0.35;
      const line = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-scaleUnit * 1.5 * widthScale, -scaleUnit + i * scaleUnit * 0.22, scaleUnit * 2.31),
          new THREE.Vector3(scaleUnit * 1.5 * widthScale, -scaleUnit + i * scaleUnit * 0.22, scaleUnit * 2.31),
        ]),
        wireMat(COLORS.cyan, 0.55),
      );
      group.add(line);
    }

    const stand = box(scaleUnit * 0.18, scaleUnit * 0.9, scaleUnit * 0.18, COLORS.grey, 0.6);
    stand.position.set(0, -scaleUnit * 1.35, scaleUnit * 2.4);
    group.add(stand);

    const base = box(scaleUnit, scaleUnit * 0.08, scaleUnit * 0.5, COLORS.grey, 0.6);
    base.position.set(0, -scaleUnit * 1.75, scaleUnit * 2.4);
    group.add(base);

    const keyboard = box(scaleUnit * 1.8, scaleUnit * 0.08, scaleUnit * 0.6, COLORS.blue, 0.75);
    keyboard.position.set(0, -scaleUnit * 1.65, scaleUnit * 0.85);
    group.add(keyboard);

    const mouse = box(scaleUnit * 0.22, scaleUnit * 0.1, scaleUnit * 0.34, COLORS.cyan, 0.85);
    mouse.position.set(-scaleUnit * 1.05, -scaleUnit * 1.64, scaleUnit * 0.85);
    group.add(mouse);

    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-scaleUnit * 1.05, -scaleUnit * 1.64, scaleUnit * 1.02),
        new THREE.Vector3(-scaleUnit * 1.05, -scaleUnit * 1.64, scaleUnit * 1.5),
      ]),
      wireMat(COLORS.grey, 0.5),
    ));

    const mousePad = box(scaleUnit * 0.7, scaleUnit * 0.02, scaleUnit * 0.55, COLORS.dim, 0.55);
    mousePad.position.set(-scaleUnit * 1.05, -scaleUnit * 1.73, scaleUnit * 0.85);
    group.add(mousePad);

    const seat = box(scaleUnit * 1.4, scaleUnit * 0.2, scaleUnit * 1.4, COLORS.grey, 0.65);
    seat.position.set(0, -scaleUnit * 1.95, -scaleUnit * 0.5);
    group.add(seat);

    const back = box(scaleUnit * 1.4, scaleUnit * 2.6, scaleUnit * 0.18, COLORS.grey, 0.65);
    back.position.set(0, -scaleUnit * 0.65, -scaleUnit * 1.15);
    group.add(back);

    {
      const seatBottomY = -scaleUnit * 1.95 - scaleUnit * 0.1;
      const poleHeight = seatBottomY - floorY;
      const poleCenterY = (seatBottomY + floorY) * 0.5;
      const pole = box(scaleUnit * 0.18, poleHeight, scaleUnit * 0.18, COLORS.grey, 0.5);
      pole.position.set(0, poleCenterY, -scaleUnit * 0.5);
      group.add(pole);
    }

    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2;
      const foot = box(scaleUnit, scaleUnit * 0.08, scaleUnit * 0.18, COLORS.grey, 0.55);
      foot.position.set(Math.cos(angle) * scaleUnit * 0.7, floorY + scaleUnit * 0.04, -scaleUnit * 0.5 + Math.sin(angle) * scaleUnit * 0.7);
      foot.rotation.y = angle;
      group.add(foot);
    }

    group.add(buildHumanoid(scaleUnit));
    group.add(makeBoxHelper([-scaleUnit * 5, floorY - scaleUnit * 0.05, -scaleUnit * 4], [scaleUnit * 5, scaleUnit * 1.5, scaleUnit * 4], COLORS.dim, 0.3));
    group.add(makeBoxHelper([-scaleUnit * 14, floorY - scaleUnit * 0.5, -scaleUnit * 14], [scaleUnit * 14, scaleUnit * 9, scaleUnit * 14], COLORS.dim, 0.18));
    return group;
  }

  const atomGroup = buildAtom();
  const dnaGroup = buildDNA();
  const cellGroup = buildCell();
  const brainGroup = buildBrain();
  const humanGroup = buildHumanStage();
  brainGroup.scale.setScalar(0.45);
  scene.add(atomGroup, dnaGroup, cellGroup, brainGroup, humanGroup);

  const stages = [
    { group: atomGroup, near: 0, far: 25 },
    { group: dnaGroup, near: 8, far: 500 },
    { group: cellGroup, near: 200, far: 7000 },
    { group: brainGroup, near: 3500, far: 55000 },
    { group: humanGroup, near: 28000, far: 800000 },
  ];

  for (const stage of stages) {
    stage.materials = [];
    stage.group.traverse((object) => {
      if (!object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.transparent = true;
        stage.materials.push({ mat: material, base: material.opacity ?? 1 });
      }
    });
  }

  function updateStageVisibility(z) {
    for (const stage of stages) {
      const { near, far, materials } = stage;
      let opacity = 1;
      if (near > 0 && z < near * 0.5) opacity = 0;
      else if (z > far * 2) opacity = 0;
      else if (near > 0 && z < near) opacity = (z - near * 0.5) / (near * 0.5);
      else if (z > far) opacity = 1 - (z - far) / far;
      opacity = Math.max(0, Math.min(1, opacity));
      stage.group.visible = opacity > 0.005;
      for (const material of materials) {
        material.mat.opacity = material.base * opacity;
      }
    }
  }

  const zMin = 3.5;
  const zMax = 180000;
  const logMin = Math.log(zMin);
  const logMax = Math.log(zMax);
  let maxScroll = 1;
  let targetProgress = 0;
  let currentProgress = 0;

  function syncCamera(progress) {
    const z = Math.exp(logMin + (logMax - logMin) * progress);
    camera.position.z = z;
    camera.position.x = Math.sin(progress * Math.PI * 2.4) * z * 0.06;
    camera.position.y = -Math.cos(progress * Math.PI * 1.6) * z * 0.04;
    camera.lookAt(0, 0, 0);
    updateStageVisibility(z);
  }

  function refreshScrollBounds() {
    maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    targetProgress = Math.min(Math.max(window.scrollY / maxScroll, 0), 1);
    if (Math.abs(targetProgress - currentProgress) < 0.001) {
      currentProgress = targetProgress;
      syncCamera(currentProgress);
    }
  }

  const handleScroll = () => {
    targetProgress = Math.min(Math.max(window.scrollY / maxScroll, 0), 1);
  };

  refreshScrollBounds();
  syncCamera(currentProgress);

  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const width = Math.max(Math.round(entry.contentRect.width), 1);
    const height = Math.max(Math.round(entry.contentRect.height), 1);
    if (width < 1 || height < 1) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    refreshScrollBounds();
  });
  resizeObserver.observe(canvas);

  if (document.readyState === "complete") {
    refreshScrollBounds();
  } else {
    window.addEventListener("load", refreshScrollBounds, { once: true });
  }
  window.addEventListener("resize", refreshScrollBounds, { passive: true });
  window.addEventListener("scroll", handleScroll, { passive: true });

  let lastFrameAt = 0;
  const targetFrameMs = 1000 / 30;

  const renderFrame = (now) => {
    if (now - lastFrameAt < targetFrameMs) {
      return;
    }
    lastFrameAt = now;
    const t = now * 0.001;
    currentProgress += (targetProgress - currentProgress) * 0.12;
    if (Math.abs(targetProgress - currentProgress) < 0.0005) {
      currentProgress = targetProgress;
    }
    syncCamera(currentProgress);

    if (atomGroup.userData.electrons) {
      for (const electron of atomGroup.userData.electrons) {
        const angle = t * electron.speed + electron.offset;
        const local = new THREE.Vector3(Math.cos(angle) * electron.radius, 0, Math.sin(angle) * electron.radius);
        local.applyEuler(electron.orbit.rotation);
        electron.mesh.position.copy(local);
      }
    }

    dnaGroup.rotation.y = t * 0.18;
    cellGroup.rotation.y = t * 0.05;
    cellGroup.rotation.x = Math.sin(t * 0.2) * 0.08;
    brainGroup.rotation.y = Math.sin(t * 0.1) * 0.25;
    humanGroup.rotation.y = Math.sin(t * 0.06) * 0.04;
    renderer.render(scene, camera);
  };

  const syncVisibility = () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
      return;
    }
    lastFrameAt = 0;
    renderer.setAnimationLoop(renderFrame);
  };

  document.addEventListener("visibilitychange", syncVisibility, { passive: true });
  syncVisibility();
}
