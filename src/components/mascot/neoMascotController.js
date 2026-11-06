import * as THREE from 'three';
import {
  calculateMascotGeometry,
  MASCOT_MOBILE_BREAKPOINT,
  resolveMascotMultiplier,
} from '../../data/mascotSizing.js';
import {
  createMascotInteractionTracker,
  getMascotIdleGaze,
  getMascotTargetGaze,
  isMobileMascotViewport,
} from './neoMascotInteractions.js';
import { calculateMascotDockTarget } from './neoMascotDocking.js';
import { mountNeoMascotCanvasFallback } from './neoMascotCanvasFallback.js';
import { resolveMascotRendererVariant } from './neoMascotRendererSelection.js';

const expressions = {
  happy: [1, 1, 1, 0, 1, 1, 1, 0, 0.55, 1, 0, 0],
  excited: [1, 1.2, 1, 0, 1, 1.2, 1, 0, 0.9, 1, 0.9, 0],
  wink: [0, 1, 1, 0, 1, 1, 1, 0, 0.6, 1, 0.1, 0],
  laugh: [1, 1.1, 1, 0.08, 1, 1.1, 1, 0.08, 1, 1, 1, 0],
  confident: [0, 1, 0.42, 0, 0, 1, 0.42, 0, 0.65, 0.55, 0, 0.5],
  curious: [0, 1.3, 1, -0.03, 0, 0.8, 1, 0.05, 0.25, 0, 0.4, 0],
};
const expressionNames = Object.keys(expressions);
const PI = Math.PI;
const defaultPreviewBaseSize = /** @type {number | undefined} */ (undefined);

const drawLeaf = (context, x, y, length, angle, color) => {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(0, 0);
  context.bezierCurveTo(length * 0.5, -length * 0.45, length * 0.95, -length * 0.2, length, 0);
  context.bezierCurveTo(length * 0.95, length * 0.2, length * 0.5, length * 0.45, 0, 0);
  context.fill();
  context.restore();
};

function mountNeoMascot3d(canvas, hitTarget, pageRoot, onCelebrate, {
  floating = true,
  sizeSettings = { desktopScalePercent: 100, mobileScalePercent: 100 },
  previewBaseSize = defaultPreviewBaseSize,
  previewDevice = 'desktop',
} = {}) {
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = reducedMotionQuery.matches;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 60);
  const projectedHead = new THREE.Vector3();
  camera.position.z = 14;
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
  keyLight.position.set(2, 4, 6);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x3ddc84, 1);
  rimLight.position.set(-4, 2, -3);
  scene.add(rimLight);

  const material = (color, options = {}) => new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.35,
    ...options,
  });
  const white = new THREE.MeshPhysicalMaterial({
    color: 0xf3f6f4,
    roughness: 0.28,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
  });
  const black = material(0x15191a);
  const green = new THREE.MeshBasicMaterial({ color: 0x7dff2a });
  const mesh = (geometry, meshMaterial, position, scale) => {
    const result = new THREE.Mesh(geometry, meshMaterial);
    if (position) result.position.set(...position);
    if (scale) result.scale.set(...scale);
    return result;
  };
  const sphere = (radius) => new THREE.SphereGeometry(radius, 32, 24);
  const cylinder = (top, bottom, height) => new THREE.CylinderGeometry(top, bottom, height, 24);
  const canvasTexture = (width, height, draw) => {
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = width;
    textureCanvas.height = height;
    draw(textureCanvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const logoTexture = (width, height) => canvasTexture(width, height, (context) => {
    drawLeaf(context, width / 2, height * 0.85, height * 0.62, -2.4, '#3d9a1c');
    drawLeaf(context, width / 2, height * 0.85, height * 0.8, -PI / 2, '#58b51f');
    drawLeaf(context, width / 2, height * 0.85, height * 0.62, -0.75, '#f68b1e');
  });
  const glowTexture = canvasTexture(64, 64, (context) => {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  });
  const leafTexture = canvasTexture(64, 48, (context) => drawLeaf(context, 4, 24, 56, 0, '#fff'));

  const root = new THREE.Group();
  const bob = new THREE.Group();
  const body = new THREE.Group();
  const head = new THREE.Group();
  root.add(bob);
  bob.add(body, head);
  scene.add(root);
  head.position.y = 0.95;
  body.add(mesh(sphere(0.8), white, [0, -0.95, 0], [1, 1.15, 0.85]));
  body.add(mesh(
    new THREE.PlaneGeometry(0.78, 0.62),
    new THREE.MeshBasicMaterial({ map: logoTexture(256, 200), transparent: true }),
    [0, -0.78, 0.72],
  ));
  body.add(mesh(cylinder(0.22, 0.3, 0.3), black, [0, -0.05, 0]));
  const addRing = (radius, y, depth = 1) => {
    const ring = mesh(new THREE.TorusGeometry(radius, 0.03, 12, 48), green, [0, y, 0], [1, 1, depth]);
    ring.rotation.x = PI / 2;
    body.add(ring);
  };
  addRing(0.4, -0.17);
  addRing(0.45, -1.72, 0.85);
  body.add(mesh(cylinder(0.38, 0.25, 0.35), black, [0, -2, 0]));
  head.add(mesh(sphere(0.9), white, [0, 0, 0], [1.2, 0.95, 0.95]));

  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = 480;
  faceCanvas.height = 320;
  const faceContext = faceCanvas.getContext('2d');
  const faceTexture = new THREE.CanvasTexture(faceCanvas);
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  head.add(mesh(
    new THREE.SphereGeometry(0.9, 48, 32, PI / 2 - 0.66, 1.32, PI / 2 - 0.55, 1.1),
    new THREE.MeshBasicMaterial({ map: faceTexture, transparent: true }),
    undefined,
    [1.215, 0.962, 0.962],
  ));
  [-1, 1].forEach((side) => {
    const ear = mesh(cylinder(0.34, 0.34, 0.3), black, [side * 1.17, 0, 0]);
    ear.rotation.z = PI / 2;
    const earRing = mesh(new THREE.TorusGeometry(0.2, 0.04, 12, 40), green, [side * 1.33, 0, 0]);
    earRing.rotation.y = PI / 2;
    head.add(ear, earRing);
  });

  const halos = [];
  const addAntenna = (points) => {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    head.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.035, 8), black));
    const tip = points[points.length - 1];
    head.add(mesh(sphere(0.1), green, tip));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0x7dff2a,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }));
    halo.position.set(...tip);
    head.add(halo);
    halos.push(halo);
  };
  addAntenna([[-0.95, 0.5, 0], [-0.98, 1, 0], [-0.9, 1.45, 0], [-0.85, 1.8, 0]]);
  addAntenna([[1.05, 0.45, 0], [1.08, 0.8, 0], [1.15, 1.05, 0], [1.2, 1.3, 0]]);

  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.88, -0.55, 0);
    shoulder.add(mesh(sphere(0.3), white, [0, 0, 0], [1, 0.95, 0.95]));
    shoulder.add(mesh(cylinder(0.13, 0.13, 0.42), black, [0, -0.3, 0]));
    const elbow = new THREE.Group();
    elbow.position.y = -0.5;
    shoulder.add(elbow);
    elbow.add(mesh(sphere(0.17), black));
    elbow.add(mesh(cylinder(0.18, 0.2, 0.4), white, [0, -0.3, 0]));
    elbow.add(mesh(sphere(0.2), white, [0, -0.5, 0]));
    const hand = new THREE.Group();
    hand.position.y = -0.68;
    elbow.add(hand);
    hand.add(mesh(sphere(0.22), black, [0, 0, 0], [1, 1.1, 1]));
    const thumb = mesh(cylinder(0.07, 0.07, 0.32), black, [0, -0.3, 0.04]);
    const finger = mesh(cylinder(0.05, 0.05, 0.55), black, [0, -0.45, 0]);
    finger.scale.y = 0.01;
    hand.add(thumb, finger);
    body.add(shoulder);
    return { shoulder, elbow, thumb, finger, hand };
  };
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);
  const laptop = new THREE.Group();
  laptop.add(mesh(new THREE.BoxGeometry(0.95, 0.64, 0.06), black, [0, 0.38, 0]));
  laptop.add(mesh(
    new THREE.PlaneGeometry(0.36, 0.28),
    new THREE.MeshBasicMaterial({ map: logoTexture(128, 100), transparent: true }),
    [0, 0.38, 0.035],
  ));
  laptop.position.set(0, 0.05, 0.12);
  laptop.rotation.set(-0.15, -0.3, 0.25);
  rightArm.hand.add(laptop);

  const flameGroup = new THREE.Group();
  flameGroup.position.y = -2.18;
  bob.add(flameGroup);
  const makeFlame = (radius, height, color, opacity) => {
    const geometry = new THREE.ConeGeometry(radius, height, 24, 1, true);
    geometry.rotateX(PI);
    geometry.translate(0, -height / 2, 0);
    const flame = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    flameGroup.add(flame);
    return flame;
  };
  const flames = [
    makeFlame(0.36, 1.7, 0xff5a00, 0.55),
    makeFlame(0.27, 1.35, 0xffa000, 0.75),
    makeFlame(0.16, 0.98, 0xb8ff5a, 0.9),
  ];
  const fireLight = new THREE.PointLight(0xff8a1f, 1.2, 7);
  fireLight.position.y = -2.6;
  bob.add(fireLight);

  const particleCount = 90;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);
  const particleVelocities = new Float32Array(particleCount * 3);
  const particleLifetimes = new Float32Array(particleCount);
  const particleMaxLifetimes = new Float32Array(particleCount);
  const particleBaseColors = new Float32Array(particleCount * 3);
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
  const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({
    map: glowTexture,
    size: 0.24,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  particles.frustumCulled = false;
  root.add(particles);
  const spawnParticle = (index) => {
    const offset = index * 3;
    particlePositions[offset] = (Math.random() - 0.5) * 0.4;
    particlePositions[offset + 1] = -2.3 + bob.position.y;
    particlePositions[offset + 2] = (Math.random() - 0.5) * 0.3;
    particleVelocities[offset] = (Math.random() - 0.5) * 0.5;
    particleVelocities[offset + 1] = -(1.6 + Math.random() * 2.2);
    particleVelocities[offset + 2] = (Math.random() - 0.5) * 0.4;
    particleMaxLifetimes[index] = particleLifetimes[index] = 0.5 + Math.random() * 0.7;
    if (Math.random() < 0.35) {
      particleBaseColors[offset] = 0.24;
      particleBaseColors[offset + 1] = 0.86;
      particleBaseColors[offset + 2] = 0.5;
    } else {
      particleBaseColors[offset] = 1;
      particleBaseColors[offset + 1] = 0.55;
      particleBaseColors[offset + 2] = 0.1;
    }
  };
  for (let index = 0; index < particleCount; index += 1) {
    spawnParticle(index);
    particleLifetimes[index] = Math.random() * particleMaxLifetimes[index];
  }

  const leaves = Array.from({ length: 16 }, () => {
    const leaf = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.24),
      new THREE.MeshBasicMaterial({
        map: leafTexture,
        color: Math.random() < 0.3 ? 0xf68b1e : 0x58b51f,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    leaf.geometry.translate(0.12, 0, 0);
    root.add(leaf);
    return {
      mesh: leaf,
      angle: Math.random() * PI * 2,
      radius: 1.8 + Math.random() * 1.2,
      start: Math.random() * 5.2,
      speed: 0.15 + Math.random() * 0.25,
      rise: 0.25 + Math.random() * 0.3,
      phase: Math.random() * 6,
      extraRadius: 0,
    };
  });

  const roundedRect = (context, x, y, width, height, radius) => {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
  };
  const targetExpression = expressions.happy.slice();
  const currentExpression = expressions.happy.slice();
  let blink = 1;
  const drawEye = (context, x, y, height, scale, tilt, offsetY) => {
    const centerY = y + offsetY * 320;
    if (height < 0.99) {
      context.globalAlpha = 1 - height;
      context.beginPath();
      context.ellipse(x, centerY, 24 * scale, 32 * scale * tilt * blink, 0, 0, 7);
      context.fill();
    }
    if (height > 0.01) {
      context.globalAlpha = height;
      context.lineWidth = 15;
      context.beginPath();
      context.arc(x, centerY + 14 * scale, 38 * scale, PI * 1.08, PI * 1.92);
      context.stroke();
    }
    context.globalAlpha = 1;
  };
  const drawFace = (parameters, gazeX, gazeY) => {
    faceContext.clearRect(0, 0, 480, 320);
    faceContext.fillStyle = '#07090a';
    roundedRect(faceContext, 0, 0, 480, 320, 70);
    faceContext.fill();
    const gloss = faceContext.createLinearGradient(0, 0, 480, 320);
    gloss.addColorStop(0, 'rgba(255,255,255,.16)');
    gloss.addColorStop(0.4, 'rgba(255,255,255,0)');
    faceContext.fillStyle = gloss;
    roundedRect(faceContext, 0, 0, 480, 320, 70);
    faceContext.fill();
    faceContext.save();
    faceContext.translate(gazeX * 34, -gazeY * 22);
    faceContext.shadowColor = '#7dff2a';
    faceContext.shadowBlur = 22;
    faceContext.strokeStyle = faceContext.fillStyle = '#7dff2a';
    faceContext.lineCap = 'round';
    drawEye(faceContext, 150, 125, parameters[0], parameters[1], parameters[2], parameters[3]);
    drawEye(faceContext, 330, 125, parameters[4], parameters[5], parameters[6], parameters[7]);
    const mouthWidth = parameters[8] * 80;
    const mouthDrop = parameters[9] * 26 + parameters[10] * 50;
    const mouthCurve = parameters[11];
    const mouthY = 225;
    faceContext.lineWidth = 13;
    faceContext.beginPath();
    faceContext.moveTo(240 - mouthWidth, mouthY);
    faceContext.quadraticCurveTo(240 + mouthCurve * 30, mouthY + mouthDrop * 2, 240 + mouthWidth, mouthY - mouthCurve * 16);
    faceContext.stroke();
    if (parameters[10] > 0.05) {
      faceContext.globalAlpha = Math.min(1, parameters[10] * 1.4);
      faceContext.beginPath();
      faceContext.moveTo(240 - mouthWidth, mouthY);
      faceContext.lineTo(240 + mouthWidth, mouthY - mouthCurve * 16);
      faceContext.quadraticCurveTo(240 + mouthCurve * 30, mouthY + mouthDrop * 2, 240 - mouthWidth, mouthY);
      faceContext.fill();
      faceContext.globalAlpha = 1;
    }
    faceContext.restore();
    faceTexture.needsUpdate = true;
  };

  let obstacleCache = [];
  let obstaclesDirty = true;
  let lastObstacleRead = -Infinity;
  let lastObstacleScan = -Infinity;
  let textNodes = [];
  let width = 1;
  let height = 1;
  let rendererWidth = 0;
  let rendererHeight = 0;
  let rendererPixelRatio = 0;
  let canvasScreenBounds = { left: 0, top: 0, width: 1, height: 1 };
  let size = 300;
  let normalSize = 300;
  let dockSize = 300;
  let dockX = 0;
  let dockY = 0;
  let chatOpen = false;
  let dockPanel = null;
  let dockResizeObserver = null;
  let baseSize = 300;
  let hitWidth = 150;
  let hitHeight = 230;
  let worldPerPixel = 1;
  let minX = 0;
  let maxX = 1;
  let minY = 0;
  let maxY = 1;
  let currentX = 0;
  let currentY = 0;
  let targetX = 0;
  let targetY = 0;
  let velocityX = 0;
  let elapsed = 0;
  let lastFrame = performance.now();
  let mode = 'idle';
  let modeTime = 0;
  let nearPointer = false;
  let nearTime = 0;
  let interactionTracker = null;
  let movementTimer = 0;
  let targetCheckTimer = 0;
  let blinkTimer = 3;
  let expressionTime = 0;
  let expressionHold = 0;
  let expressionIndex = 0;
  let jump = 0;
  let jumpVelocity = 0;
  let selectedPoint = null;
  let pointTargetRect = null;
  let pointTargetRectDirty = true;
  let frame = 0;
  let destroyed = false;
  let visible = !document.hidden;
  let scrollTimer = 0;
  let isScrolling = false;
  let layoutFrame = 0;
  let mutationFrame = 0;
  let pointObserver = null;
  let sceneObserver = null;
  let mainMutationObserver = null;
  let resizeObserver = null;
  const gaze = { x: 0, y: 0 };
  let easing = 0.2;
  const ownedMaterials = new Set();
  const ownedGeometries = new Set();
  const ownedTextures = new Set([glowTexture, leafTexture, faceTexture]);
  const registerSceneResources = () => {
    scene.traverse((object) => {
      if (object.geometry) ownedGeometries.add(object.geometry);
      if (!object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((item) => {
        ownedMaterials.add(item);
        if (item.map) ownedTextures.add(item.map);
      });
    });
  };
  const setExpression = (name, hold = 0) => {
    if (!Object.hasOwn(expressions, name)) return false;
    targetExpression.splice(0, 12, ...expressions[name]);
    expressionIndex = expressionNames.indexOf(name);
    expressionHold = hold || 0;
    expressionTime = 0;
    return true;
  };
  const celebrate = () => {
    if (mode === 'celebrate') return;
    mode = 'celebrate';
    modeTime = 0;
    jumpVelocity = reducedMotion ? 0 : 7;
    setExpression('excited', 2);
    leaves.forEach((leaf) => { leaf.extraRadius = 2.6; });
    onCelebrate?.();
  };
  const pointTo = (element) => {
    if (!(element instanceof Element) || !element.isConnected) return;
    selectedPoint = element;
    pointTargetRectDirty = true;
    mode = 'point';
    modeTime = 0;
    setExpression('curious', 3);
  };
  if (floating) {
    interactionTracker = createMascotInteractionTracker({
      hitTarget,
      onTargetChange(target) {
        nearPointer = Boolean(target);
        if (target) {
          nearTime = 0;
          setExpression('curious', 2.5);
        } else {
          expressionTime = 3;
        }
      },
      onCelebrate: celebrate,
    });
  }
  const positionModel = () => root.position.set(
    (currentX - width / 2) * worldPerPixel,
    -(currentY - height / 2) * worldPerPixel,
    0,
  );
  const getHeadScreenPosition = () => {
    head.getWorldPosition(projectedHead).project(camera);
    return {
      x: canvasScreenBounds.left + (projectedHead.x + 1) * canvasScreenBounds.width / 2,
      y: canvasScreenBounds.top + (1 - projectedHead.y) * canvasScreenBounds.height / 2,
    };
  };
  const updateDockTarget = () => {
    if (!chatOpen) return;
    const panel = document.getElementById('ng-chat-panel');
    if (panel !== dockPanel) {
      dockResizeObserver?.disconnect();
      dockPanel = panel;
      if (dockPanel && typeof ResizeObserver !== 'undefined') {
        dockResizeObserver = new ResizeObserver(updateDockTarget);
        dockResizeObserver.observe(dockPanel);
      }
    }
    if (!dockPanel) return;
    const viewportTop = window.visualViewport?.offsetTop || 0;
    const viewportHeight = window.visualViewport?.height || height;
    const dock = calculateMascotDockTarget(
      dockPanel.getBoundingClientRect(),
      width,
      height,
      normalSize,
      viewportTop,
      viewportHeight,
    );
    dockX = dock.x;
    dockY = dock.y;
    dockSize = Math.min(normalSize, dock.size);
  };
  const layout = () => {
    const previousWidth = width;
    const previousHeight = height;
    const previousNormalSize = normalSize;
    const previousBounds = { minX, maxX, minY, maxY };
    const bounds = floating ? null : canvas.parentElement?.getBoundingClientRect();
    width = floating ? window.innerWidth : Math.max(1, bounds?.width ?? 1);
    height = floating ? window.innerHeight : Math.max(1, bounds?.height ?? 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (pixelRatio !== rendererPixelRatio) {
      renderer.setPixelRatio(pixelRatio);
      rendererPixelRatio = pixelRatio;
    }
    if (width !== rendererWidth || height !== rendererHeight) {
      renderer.setSize(width, height, false);
      rendererWidth = width;
      rendererHeight = height;
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const screenBounds = canvas.getBoundingClientRect();
    canvasScreenBounds = {
      left: screenBounds.left,
      top: screenBounds.top,
      width: screenBounds.width,
      height: screenBounds.height,
    };
    baseSize = floating
      ? Math.max(150, Math.min(height * 0.21, 215))
      : previewBaseSize ?? Math.min(width, height) * 0.94;
    if (floating && width < MASCOT_MOBILE_BREAKPOINT) baseSize = Math.min(baseSize, 140);
    const deviceWidth = previewBaseSize === undefined ? window.innerWidth : previewDevice === 'mobile' ? 390 : 1280;
    const multiplier = resolveMascotMultiplier(sizeSettings, deviceWidth);
    const geometry = calculateMascotGeometry(
      width,
      height,
      baseSize,
      multiplier,
      floating,
      window.visualViewport?.offsetTop || 0,
      window.visualViewport?.height || height,
    );
    normalSize = geometry.size;
    if (!chatOpen) size = normalSize;
    else size = Math.min(size, normalSize);
    hitWidth = geometry.hitWidth;
    hitHeight = geometry.hitHeight;
    worldPerPixel = 2 * Math.tan(PI / 12) * 14 / height;
    const unit = geometry.unit;
    minX = geometry.minX;
    maxX = geometry.maxX;
    minY = geometry.minY;
    maxY = geometry.maxY;
    currentX = Math.min(Math.max(currentX, minX), maxX);
    currentY = Math.min(Math.max(currentY, minY), maxY);
    const horizontalInset = chatOpen ? size * 0.34 + 8 : 0;
    const positionMinX = chatOpen ? horizontalInset : minX;
    const positionMaxX = chatOpen ? Math.max(positionMinX, width - horizontalInset) : maxX;
    const positionMinY = chatOpen
      ? (window.visualViewport?.offsetTop || 0) + size * 0.32 + 8
      : minY;
    const positionMaxY = chatOpen
      ? Math.max(positionMinY, (window.visualViewport?.offsetTop || 0) +
        (window.visualViewport?.height || height) - size * 0.68 - 8)
      : maxY;
    targetX = Math.min(Math.max(targetX, positionMinX), positionMaxX);
    targetY = Math.min(Math.max(targetY, positionMinY), positionMaxY);
    root.scale.setScalar(worldPerPixel * size / 6);
    positionModel();
    setHitTarget();
    if (
      width !== previousWidth ||
      height !== previousHeight ||
      normalSize !== previousNormalSize ||
      minX !== previousBounds.minX ||
      maxX !== previousBounds.maxX ||
      minY !== previousBounds.minY ||
      maxY !== previousBounds.maxY
    ) {
      pointTargetRectDirty = true;
      obstaclesDirty = true;
    }
    updateDockTarget();
  };
  const scheduleLayout = () => {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      layout();
    });
  };
  const measureObstacles = () => {
    const now = performance.now();
    if (!obstaclesDirty || now - lastObstacleRead < 500) return obstacleCache;
    lastObstacleRead = now;
    obstaclesDirty = false;
    if (now - lastObstacleScan > 4000 && !isMobileMascotViewport(width)) {
      lastObstacleScan = now;
      textNodes = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!node.nodeValue?.trim() || !parent || /^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(parent.tagName) ||
              parent.closest('[hidden],[aria-hidden="true"],[data-mascot-ignore]')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        },
      );
      let node;
      while ((node = walker.nextNode())) textNodes.push(node);
    }
    const rectangles = [];
    const range = document.createRange();
    const isVisibleRect = (rect) => rect.width > 2 && rect.height > 2 &&
      rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width;
    const mobile = isMobileMascotViewport(width);
    if (!mobile) {
      for (const node of textNodes) {
        if (!node.isConnected) continue;
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (isVisibleRect(rect)) rectangles.push(rect);
        }
      }
    }
    const protectedControls = mobile
      ? [document.activeElement, ...document.body.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],#ng-chat-panel')]
      : document.body.querySelectorAll('button,a[href],input,textarea,select,img,iframe,[role="dialog"],[role="alertdialog"]');
    Array.from(protectedControls)
      .filter((element) => element instanceof Element)
      .forEach((element) => {
        if (element.closest('[hidden],[aria-hidden="true"],[data-mascot-ignore]')) return;
        const rect = element.getBoundingClientRect();
        const blockingContainer = mobile && element.matches('[role="dialog"],[role="alertdialog"],[aria-modal="true"],#ng-chat-panel');
        if (isVisibleRect(rect) && (blockingContainer || rect.width * rect.height < width * height * 0.5)) rectangles.push(rect);
      });
    obstacleCache = rectangles;
    return obstacleCache;
  };
  const overlapArea = (x, y, obstacles) => {
    const unit = size / 6;
    const left = x - 1.6 * unit - 8;
    const right = x + 1.6 * unit + 8;
    const top = y - 2.3 * unit - 8;
    const bottom = y + 2.4 * unit + 8;
    let area = 0;
    obstacles.forEach((rect) => {
      const overlapWidth = Math.min(right, rect.right) - Math.max(left, rect.left);
      const overlapHeight = Math.min(bottom, rect.bottom) - Math.max(top, rect.top);
      if (overlapWidth > 0 && overlapHeight > 0) area += overlapWidth * overlapHeight;
    });
    return area;
  };
  const pickPosition = () => {
    const obstacles = measureObstacles();
    const mobile = isMobileMascotViewport(width);
    let bestX = currentX;
    let bestY = currentY;
    let bestScore = Infinity;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const x = minX + Math.random() * (maxX - minX);
      const y = minY + Math.random() * (maxY - minY);
      const distance = Math.hypot(x - currentX, y - currentY);
      const overlap = overlapArea(x, y, obstacles);
      const score = overlap * (mobile ? 4 : 1) + (distance < size * 1.2 ? 100000 : 0) +
        (distance < size * 2 ? 50 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
      if (score <= 0) break;
    }
    targetX = bestX;
    targetY = bestY;
  };
  const lerpRotation = (object, axis, value) => {
    object.rotation[axis] += (value - object.rotation[axis]) * easing;
  };
  const setHitTarget = () => {
    if (!floating && previewBaseSize === undefined) {
      hitTarget.style.width = '100%';
      hitTarget.style.height = '100%';
      hitTarget.style.transform = '';
      return;
    }
    hitWidth = size / 2;
    hitHeight = size * 4.6 / 6;
    hitTarget.style.width = `${hitWidth}px`;
    hitTarget.style.height = `${hitHeight}px`;
    const x = floating ? currentX : width / 2;
    const y = floating ? currentY : height / 2;
    hitTarget.style.transform = `translate(${x - hitWidth / 2}px, ${y - hitHeight / 2}px)`;
  };

  const animate = (now) => {
    frame = 0;
    if (destroyed || !visible) return;
    frame = requestAnimationFrame(animate);
    const delta = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    elapsed += delta;
    modeTime += delta;
    easing = 1 - Math.exp(-delta * 9);
    const desiredSize = chatOpen ? dockSize : normalSize;
    size += (desiredSize - size) * (1 - Math.exp(-delta * 5));
    root.scale.setScalar(worldPerPixel * size / 6);
    if (chatOpen) {
      targetX = dockX;
      targetY = dockY;
    }
    if (pointTargetRectDirty && selectedPoint?.isConnected) {
      pointTargetRect = selectedPoint.getBoundingClientRect();
      pointTargetRectDirty = false;
    }
    const activeMode = mode === 'celebrate' || mode === 'point';
    const interactionTarget = interactionTracker?.target;
    const blocksInteractionRoaming = interactionTarget &&
      !interactionTarget.closest('#ng-chat-panel,.ng-chat-launcher');
    const blocksRoaming = chatOpen || (blocksInteractionRoaming && !isMobileMascotViewport(width)) || activeMode;
    if (floating && chatOpen) {
      targetX = dockX;
      targetY = dockY;
    } else if (floating && !blocksRoaming) {
      movementTimer -= delta;
      targetCheckTimer -= delta;
      if (!isScrolling && movementTimer <= 0) {
        movementTimer = 4 + Math.random() * 3;
        pickPosition();
      } else if (!isScrolling && targetCheckTimer <= 0) {
        targetCheckTimer = 0.5;
        const obstacles = measureObstacles();
        if (overlapArea(targetX, targetY, obstacles) > 800 ||
          (overlapArea(currentX, currentY, obstacles) > 2500 &&
            Math.hypot(targetX - currentX, targetY - currentY) < size * 0.5)) {
          movementTimer = 4 + Math.random() * 3;
          pickPosition();
        }
      }
    } else if (floating && !chatOpen) {
      targetX = currentX;
      targetY = currentY;
    }
    const horizontalInset = chatOpen ? size * 0.34 + 8 : 0;
    const positionMinX = chatOpen ? horizontalInset : minX;
    const positionMaxX = chatOpen ? Math.max(positionMinX, width - horizontalInset) : maxX;
    const positionMinY = chatOpen
      ? (window.visualViewport?.offsetTop || 0) + size * 0.32 + 8
      : minY;
    const positionMaxY = chatOpen
      ? Math.max(positionMinY, (window.visualViewport?.offsetTop || 0) +
        (window.visualViewport?.height || height) - size * 0.68 - 8)
      : maxY;
    targetX = Math.min(Math.max(targetX, positionMinX), positionMaxX);
    targetY = Math.min(Math.max(targetY, positionMinY), positionMaxY);
    const previousX = currentX;
    const following = 1 - Math.exp(-delta * 1.1);
    if (!reducedMotion) {
      currentX += (targetX - currentX) * following;
      currentY += (targetY - currentY) * following;
    } else if (chatOpen || movementTimer <= 0) {
      currentX = targetX;
      currentY = targetY;
    }
    velocityX = (currentX - previousX) / Math.max(delta, 0.001) / size;
    positionModel();

    root.rotation.z = Math.sin(elapsed * 1.3) * 0.03 -
      Math.max(-0.25, Math.min(0.25, velocityX * 0.3));
    bob.position.x = 0;
    if (mode === 'celebrate' || jump > 0) {
      jump += jumpVelocity * delta;
      jumpVelocity -= 22 * delta;
      if (jump < 0) {
        jump = 0;
        jumpVelocity = mode === 'celebrate' && !reducedMotion ? 4.5 : 0;
      }
    }
    bob.position.y = Math.sin(elapsed * 1.7) * (reducedMotion ? 0.05 : 0.14) + jump;
    const gazeEasing = 1 - Math.exp(-delta * 10);
    const gazeTarget = interactionTracker?.getGazeTarget(delta) ??
      (mode === 'point' ? pointTargetRect : null);
    const headTiltZ = (currentExpression[3] - currentExpression[7]) * 2.2;
    let targetGaze = null;
    if (gazeTarget) {
      const headPosition = getHeadScreenPosition();
      targetGaze = getMascotTargetGaze(
        gazeTarget,
        headPosition.x,
        headPosition.y,
        size,
        root.rotation.z + headTiltZ,
      );
    }
    const desiredGaze = targetGaze ?? getMascotIdleGaze(elapsed);
    gaze.x += (desiredGaze.x - gaze.x) * gazeEasing;
    gaze.y += (desiredGaze.y - gaze.y) * gazeEasing;
    setHitTarget();
    if (mode === 'celebrate' && modeTime > 2) mode = 'idle';
    if (mode === 'point' && (modeTime > 3.4 || !selectedPoint?.isConnected)) {
      mode = 'idle';
      selectedPoint = null;
    }
    if (nearPointer) nearTime += delta;
    expressionTime += delta;
    if (expressionHold > 0) expressionHold -= delta;
    else if (!nearPointer && expressionTime > 3.2) {
      expressionIndex = (expressionIndex + 1) % expressionNames.length;
      setExpression(expressionNames[expressionIndex]);
    }
    blinkTimer -= delta;
    if (blinkTimer < 0) blinkTimer = 2 + Math.random() * 3;
    blink = blinkTimer < 0.12 ? 0.1 : 1;
    const expressionEasing = 1 - Math.exp(-delta * 7);
    for (let index = 0; index < 12; index += 1) {
      currentExpression[index] += (targetExpression[index] - currentExpression[index]) * expressionEasing;
    }

    let leftPose = { shoulderZ: -1.8, elbowZ: -1.3, shoulderX: 0, thumb: 1, finger: 0.01 };
    let rightPose = { shoulderZ: 0.55, elbowZ: -0.5 };
    if (!reducedMotion) {
      const cycle = elapsed % 11;
      leftPose.shoulderZ += Math.sin(elapsed * 1.9) * 0.1;
      leftPose.elbowZ += Math.sin(elapsed * 2.6) * 0.12;
      leftPose.shoulderX = Math.sin(elapsed * 1.4) * 0.1;
      if (cycle > 6 && cycle < 8.6) {
        leftPose.shoulderZ = -2.2;
        leftPose.elbowZ = -1 + Math.sin(elapsed * 10) * 0.5;
        leftPose.thumb = 0.4;
      } else if (cycle >= 8.6 && cycle < 10) {
        leftPose.elbowZ = -1.3 + Math.sin(elapsed * 5) * 0.18;
        leftPose.shoulderX = -0.15;
      }
      rightPose.shoulderZ += Math.sin(elapsed * 1.6 + 1) * 0.08;
      rightPose.elbowZ += Math.sin(elapsed * 2.1) * 0.1;
    }
    if (nearPointer) {
      if (nearTime % 4 < 2) {
        leftPose = { shoulderZ: -2.2, elbowZ: -1 + Math.sin(elapsed * 11) * 0.5, shoulderX: 0, thumb: 0.4, finger: 0.01 };
      } else {
        leftPose.shoulderZ = -1.8 + Math.sin(elapsed * 6) * 0.05;
      }
      rightPose.shoulderZ = 0.85;
    }
    if (mode === 'celebrate') {
      leftPose = { shoulderZ: -2.7, elbowZ: -0.4 + Math.sin(elapsed * 14) * 0.3, shoulderX: 0, thumb: 0.4, finger: 0.01 };
      rightPose = { shoulderZ: 2.6, elbowZ: 0.3 };
    }
    if (mode === 'point' && selectedPoint?.isConnected) {
      if (pointTargetRect) {
        const dx = pointTargetRect.left + pointTargetRect.width / 2 - currentX;
        const dy = -(pointTargetRect.top + pointTargetRect.height / 2 - currentY);
        const length = Math.hypot(dx, dy) || 1;
        leftPose = { shoulderZ: Math.atan2(dx / length, -dy / length), elbowZ: 0, shoulderX: -0.2, thumb: 0.3, finger: 1 };
      }
    }
    lerpRotation(leftArm.shoulder, 'z', leftPose.shoulderZ);
    lerpRotation(leftArm.elbow, 'z', leftPose.elbowZ);
    lerpRotation(leftArm.shoulder, 'x', leftPose.shoulderX);
    lerpRotation(rightArm.shoulder, 'z', rightPose.shoulderZ);
    lerpRotation(rightArm.elbow, 'z', rightPose.elbowZ);
    leftArm.thumb.scale.y += (leftPose.thumb - leftArm.thumb.scale.y) * easing;
    leftArm.finger.scale.y += (leftPose.finger - leftArm.finger.scale.y) * easing;

    const laughShake = currentExpression[10] ? Math.sin(elapsed * 28) * 0.03 * currentExpression[10] : 0;
    head.rotation.y = gaze.x * 0.75 + laughShake;
    head.rotation.x = -gaze.y * 0.45;
    head.rotation.z = headTiltZ;
    halos.forEach((halo, index) => {
      const scale = 0.55 + 0.18 * Math.sin(elapsed * 3 + index * 1.7);
      halo.scale.set(scale, scale, 1);
      halo.material.opacity = 0.7 + 0.3 * Math.sin(elapsed * 3 + index * 1.7);
    });
    const flameStrength = mode === 'celebrate' ? 1.5 : nearPointer ? 1.2 : 1 + Math.min(0.3, Math.abs(velocityX) * 0.35);
    flames.forEach((flame, index) => {
      flame.scale.set(
        1 + 0.1 * Math.sin(elapsed * 53 + index * 3),
        flameStrength * (1 + 0.12 * Math.sin(elapsed * 37 + index * 2) +
          0.08 * Math.sin(elapsed * 61 + index) + 0.05 * Math.random()),
        1 + 0.1 * Math.cos(elapsed * 47 + index),
      );
    });
    fireLight.intensity = 1.2 * flameStrength + 0.4 * Math.sin(elapsed * 40);
    for (let index = 0; index < particleCount; index += 1) {
      particleLifetimes[index] -= delta;
      if (particleLifetimes[index] <= 0) spawnParticle(index);
      const fade = Math.max(0, particleLifetimes[index] / particleMaxLifetimes[index]);
      const offset = index * 3;
      particlePositions[offset] += particleVelocities[offset] * delta;
      particlePositions[offset + 1] += particleVelocities[offset + 1] * delta;
      particlePositions[offset + 2] += particleVelocities[offset + 2] * delta;
      particleColors[offset] = particleBaseColors[offset] * fade;
      particleColors[offset + 1] = particleBaseColors[offset + 1] * fade;
      particleColors[offset + 2] = particleBaseColors[offset + 2] * fade;
      particleVelocities[offset] *= 0.98;
    }
    particleGeometry.attributes.position.needsUpdate = true;
    particleGeometry.attributes.color.needsUpdate = true;
    leaves.forEach((leaf) => {
      const fraction = ((leaf.start + elapsed * leaf.rise) % 5.2) / 5.2;
      leaf.extraRadius *= Math.exp(-delta * 1.5);
      const angle = leaf.angle + elapsed * leaf.speed;
      const radius = leaf.radius + leaf.extraRadius;
      leaf.mesh.position.set(
        Math.cos(angle) * radius,
        fraction * 5.2 - 3 + Math.sin(elapsed + leaf.phase) * 0.15,
        Math.sin(angle) * radius * 0.7,
      );
      leaf.mesh.rotation.set(
        elapsed * leaf.speed * 2 + leaf.phase,
        elapsed * 1.3 + leaf.phase,
        elapsed * 0.9,
      );
      leaf.mesh.scale.setScalar(Math.sin(PI * fraction));
    });
    drawFace(currentExpression, gaze.x, gaze.y);
    renderer.render(scene, camera);
  };

  const start = () => {
    if (frame || destroyed || !visible) return;
    lastFrame = performance.now();
    frame = requestAnimationFrame(animate);
  };
  const stop = () => {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const updateVisibility = () => {
    visible = !document.hidden;
    if (visible) start();
    else stop();
  };
  const onScroll = () => {
    isScrolling = true;
    if (selectedPoint) pointTargetRectDirty = true;
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      isScrolling = false;
      obstaclesDirty = true;
    }, 160);
  };
  const reconcilePointTargets = () => {
    mutationFrame = 0;
    if (!pointObserver || destroyed) return;
    const currentTargets = new Set(pageRoot.querySelectorAll('section'));
    const previouslyObserved = pointObserver.__targets || new Set();
    previouslyObserved.forEach((target) => {
      if (!currentTargets.has(target)) pointObserver.unobserve(target);
    });
    currentTargets.forEach((target) => {
      if (!previouslyObserved.has(target)) pointObserver.observe(target);
    });
    pointObserver.__targets = currentTargets;
    obstaclesDirty = true;
  };
  const schedulePointReconcile = () => {
    if (mutationFrame) return;
    mutationFrame = requestAnimationFrame(reconcilePointTargets);
  };

  if (floating) {
    pointObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || chatOpen || mode === 'celebrate' || entry.target.__neoPointed) return;
        entry.target.__neoPointed = true;
        pointTo(entry.target.querySelector('h2,h3') || entry.target);
      });
    }, { threshold: 0.6 });
  }
  sceneObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) start();
    else stop();
  }, { threshold: 0 });
  sceneObserver.observe(canvas);
  if (floating) {
    mainMutationObserver = new MutationObserver(schedulePointReconcile);
    mainMutationObserver.observe(pageRoot, { childList: true, subtree: true, characterData: true });
  } else if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
    resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(canvas.parentElement);
  }

  layout();
  currentX = targetX = floating ? maxX : width / 2;
  currentY = targetY = floating ? maxY : height / 2;
  setExpression('happy');
  setHitTarget();
  registerSceneResources();
  if (floating) {
    window.addEventListener('resize', scheduleLayout, { passive: true });
  } else if (!resizeObserver) {
    window.addEventListener('resize', scheduleLayout, { passive: true });
  }
  window.addEventListener('orientationchange', scheduleLayout, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleLayout, { passive: true });
  window.visualViewport?.addEventListener('scroll', scheduleLayout, { passive: true });
  window.visualViewport?.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  document.addEventListener('visibilitychange', updateVisibility);
  if (floating) reconcilePointTargets();
  start();

  const api = {
    celebrate,
    point: pointTo,
    setExpression,
    setSizeSettings(nextSettings) {
      sizeSettings = nextSettings;
      layout();
    },
    setChatOpen(open) {
      if (chatOpen === open) {
        if (open) updateDockTarget();
        return;
      }
      chatOpen = open;
      if (open) {
        mode = 'idle';
        selectedPoint = null;
        updateDockTarget();
        if (dockPanel) {
          targetX = dockX;
          targetY = dockY;
        }
      } else {
        dockResizeObserver?.disconnect();
        dockResizeObserver = null;
        dockPanel = null;
        targetX = currentX;
        targetY = currentY;
        movementTimer = 0;
      }
    },
    expressions: expressionNames,
  };
  return {
    api,
    cleanup() {
      if (destroyed) return;
      destroyed = true;
      stop();
      window.clearTimeout(scrollTimer);
      if (layoutFrame) cancelAnimationFrame(layoutFrame);
      if (mutationFrame) cancelAnimationFrame(mutationFrame);
      window.removeEventListener('resize', scheduleLayout);
      window.removeEventListener('orientationchange', scheduleLayout);
      window.visualViewport?.removeEventListener('resize', scheduleLayout);
      window.visualViewport?.removeEventListener('scroll', scheduleLayout);
      window.visualViewport?.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll, true);
      interactionTracker?.cleanup();
      document.removeEventListener('visibilitychange', updateVisibility);
      pointObserver?.disconnect();
      sceneObserver.disconnect();
      mainMutationObserver?.disconnect();
      resizeObserver?.disconnect();
      dockResizeObserver?.disconnect();
      ownedGeometries.forEach((geometry) => geometry.dispose());
      ownedMaterials.forEach((item) => item.dispose());
      ownedTextures.forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      hitTarget.style.width = '0';
      hitTarget.style.height = '0';
      hitTarget.style.transform = '';
    },
  };
}

export function mountNeoMascot(canvas, hitTarget, pageRoot, onCelebrate, options = {}) {
  const variant = options.rendererVariant ??
    resolveMascotRendererVariant(options.sizeSettings?.renderer);
  const instance = variant === 'current3d'
    ? mountNeoMascot3d(canvas, hitTarget, pageRoot, onCelebrate, options)
    : mountNeoMascotCanvasFallback(canvas, hitTarget, pageRoot, onCelebrate, {
      ...options,
      rendererVariant: variant,
    });
  canvas.dataset.mascotRendererVariant = variant;
  return {
    ...instance,
    cleanup() {
      instance.cleanup();
      if (canvas.dataset.mascotRendererVariant === variant) {
        delete canvas.dataset.mascotRendererVariant;
      }
    },
  };
}
