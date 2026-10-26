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
import { createNeo2D } from './neo-2d.mjs';

const PI = Math.PI;
const expressionTargets = {
  happy: [1, 1, 1, 0, 1, 1, 1, 0, 0.55, 1, 0, 0],
  excited: [1, 1.2, 1, 0, 1, 1.2, 1, 0, 0.9, 1, 0.9, 0],
  wink: [0, 1, 1, 0, 1, 1, 1, 0, 0.6, 1, 0.1, 0],
  laugh: [1, 1.1, 1, 0.08, 1, 1.1, 1, 0.08, 1, 1, 1, 0],
  confident: [0, 1, 0.42, 0, 0, 1, 0.42, 0, 0.65, 0.55, 0, 0.5],
  curious: [0, 1.3, 1, -0.03, 0, 0.8, 1, 0.05, 0.25, 0, 0.4, 0],
};
const expressionNames = Object.keys(expressionTargets);
const defaultPreviewBaseSize = undefined;

function drawLeaf(context, x, y, length, angle, color) {
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
}

function drawLimb(context, x, y, shoulderAngle, elbowAngle, side, waving, pointing) {
  context.save();
  context.translate(x, y);
  context.rotate(shoulderAngle);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#F3F6F4';
  context.lineWidth = 0.3;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(0, -0.48);
  context.stroke();
  context.fillStyle = '#171B1C';
  context.beginPath();
  context.arc(0, -0.5, 0.17, 0, PI * 2);
  context.fill();
  context.translate(0, -0.5);
  context.rotate(elbowAngle);
  context.strokeStyle = '#F3F6F4';
  context.lineWidth = 0.24;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(0, -0.58);
  context.stroke();
  context.fillStyle = '#171B1C';
  context.beginPath();
  context.arc(0, -0.68, 0.2, 0, PI * 2);
  context.fill();
  context.strokeStyle = '#171B1C';
  context.lineWidth = 0.07;
  context.beginPath();
  context.moveTo(0.02, -0.79);
  context.lineTo(pointing ? 0.05 : side * 0.08, waving ? -1.17 : -1.04);
  context.stroke();
  context.restore();
}

export function drawRobot(context, state) {
  const {
    elapsed, currentExpression, blink, gaze, mode, nearPointer, nearTime, jump,
    reducedMotion, velocityX, currentX, currentY, size, width, height,
  } = state;
  const scale = size / 6;
  const bob = reducedMotion ? Math.sin(elapsed * 1.7) * 0.05 : Math.sin(elapsed * 1.7) * 0.14;
  const celebration = mode === 'celebrate';
  const wave = !reducedMotion && elapsed % 11 > 6 && elapsed % 11 < 8.6;
  context.save();
  context.translate(currentX, currentY - jump * scale);
  context.scale(scale, -scale);
  context.translate(0, bob);
  context.rotate(Math.sin(elapsed * 1.3) * 0.03 -
    Math.max(-0.25, Math.min(0.25, velocityX * 0.3)));

  const flameStrength = celebration ? 1.5 : nearPointer ? 1.2 : 1 + Math.min(0.3, Math.abs(velocityX) * 0.35);
  const flameGradient = context.createLinearGradient(0, -2.1, 0, -4.1);
  flameGradient.addColorStop(0, 'rgba(255,89,0,0.35)');
  flameGradient.addColorStop(0.28, '#ff5a00');
  flameGradient.addColorStop(0.68, '#ffa000');
  flameGradient.addColorStop(1, 'rgba(184,255,90,0.15)');
  context.save();
  context.translate(0, -2.1);
  context.scale(1 + Math.sin(elapsed * 19) * 0.06, flameStrength * (1 + Math.sin(elapsed * 13) * 0.08));
  context.fillStyle = flameGradient;
  context.beginPath();
  context.moveTo(-0.42, 0);
  context.bezierCurveTo(-0.3, -0.8, -0.62, -1.1, 0, -2.05);
  context.bezierCurveTo(0.56, -1.12, 0.3, -0.74, 0.42, 0);
  context.closePath();
  context.fill();
  context.fillStyle = '#ffd36b';
  context.beginPath();
  context.moveTo(-0.19, 0);
  context.bezierCurveTo(-0.12, -0.52, -0.3, -0.85, 0, -1.38);
  context.bezierCurveTo(0.28, -0.82, 0.1, -0.52, 0.19, 0);
  context.closePath();
  context.fill();
  context.restore();

  for (let index = 0; index < 8; index += 1) {
    const phase = (elapsed * (0.42 + (index % 3) * 0.12) + index * 0.79) % 2.8;
    const x = Math.sin(index * 7.1 + elapsed * 0.8) * (0.3 + phase * 0.18);
    const y = -2.35 - phase;
    context.globalAlpha = Math.max(0, 1 - phase / 2.8);
    context.fillStyle = index % 3 === 0 ? '#7dff2a' : '#ffb13b';
    context.beginPath();
    context.arc(x, y, 0.025 + (index % 3) * 0.009, 0, PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  for (let index = 0; index < 7; index += 1) {
    const angle = elapsed * (0.18 + (index % 2) * 0.06) + index * PI * 2 / 7;
    const radius = 1.75 + (index % 3) * 0.25;
    const rise = ((elapsed * 0.22 + index * 0.17) % 1.3) - 0.35;
    drawLeaf(
      context,
      Math.cos(angle) * radius,
      rise + Math.sin(angle * 1.4) * 0.28,
      0.27,
      angle + Math.sin(elapsed + index) * 0.4,
      index % 4 === 0 ? '#f68b1e' : '#58b51f',
    );
  }

  let leftShoulder = celebration ? -2.55 : wave ? -2.15 : -1.78 + Math.sin(elapsed * 1.7) * 0.08;
  let leftElbow = celebration ? 0.12 + Math.sin(elapsed * 12) * 0.24 : wave ? Math.sin(elapsed * 9) * 0.45 : -1.1;
  if (mode === 'point' && state.pointRect) {
    const dx = state.pointRect.left + state.pointRect.width / 2 - currentX;
    const dy = -(state.pointRect.top + state.pointRect.height / 2 - currentY);
    leftShoulder = Math.atan2(dx, -dy);
    leftElbow = 0;
  } else if (nearPointer && nearTime % 4 < 2) {
    leftShoulder = -2.15;
    leftElbow = Math.sin(elapsed * 9) * 0.45;
  }
  drawLimb(context, -0.83, -0.46, leftShoulder, leftElbow,
    -1, wave || celebration, mode === 'point');
  drawLimb(context, 0.83, -0.46, celebration ? 2.55 : 0.55 + Math.sin(elapsed * 1.4) * 0.06,
    celebration ? -0.16 : -0.45, 1, false, false);

  context.fillStyle = '#F3F6F4';
  context.strokeStyle = '#C6D0CA';
  context.lineWidth = 0.035;
  context.beginPath();
  context.ellipse(0, -0.96, 0.8, 0.92, 0, 0, PI * 2);
  context.fill();
  context.stroke();
  context.strokeStyle = '#7DFF2A';
  context.lineWidth = 0.075;
  context.beginPath();
  context.ellipse(0, -0.2, 0.43, 0.13, 0, 0, PI * 2);
  context.ellipse(0, -1.72, 0.48, 0.13, 0, 0, PI * 2);
  context.stroke();
  context.fillStyle = '#171B1C';
  context.beginPath();
  context.moveTo(-0.32, -1.86);
  context.lineTo(0.32, -1.86);
  context.lineTo(0.26, -2.1);
  context.lineTo(-0.26, -2.1);
  context.closePath();
  context.fill();

  context.save();
  context.translate(0, -0.78);
  drawLeaf(context, -0.14, 0.04, 0.24, -2.25, '#3d9a1c');
  drawLeaf(context, 0.02, 0.06, 0.3, -PI / 2, '#58b51f');
  drawLeaf(context, 0.16, 0.02, 0.24, -0.72, '#f68b1e');
  context.restore();

  context.save();
  context.translate(0, 0.98);
  context.rotate(gaze.x * 0.3);
  context.fillStyle = '#F3F6F4';
  context.strokeStyle = '#C6D0CA';
  context.lineWidth = 0.035;
  context.beginPath();
  context.ellipse(0, 0, 1.08, 0.87, 0, 0, PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = '#171B1C';
  context.beginPath();
  context.roundRect(-1.03, -0.51, 2.06, 1.08, 0.26);
  context.fill();
  const eyeY = 0.07 + gaze.y * 0.1;
  const drawEye = (x, height, eyeScale, tilt, offset) => {
    const y = eyeY + offset * 0.2;
    context.save();
    context.translate(x + gaze.x * 0.18, y);
    context.rotate((x < 0 ? -1 : 1) * (1 - tilt) * 0.4);
    context.strokeStyle = '#7DFF2A';
    context.fillStyle = '#7DFF2A';
    context.lineWidth = 0.09;
    context.lineCap = 'round';
    if (height > 0.01) {
      context.beginPath();
      context.ellipse(0, 0, 0.17 * eyeScale, 0.2 * height * blink, 0, 0, PI * 2);
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(-0.18, 0);
      context.quadraticCurveTo(0, 0.12, 0.18, 0);
      context.stroke();
    }
    context.restore();
  };
  drawEye(-0.43, currentExpression[0], currentExpression[1], currentExpression[2], currentExpression[3]);
  drawEye(0.43, currentExpression[4], currentExpression[5], currentExpression[6], currentExpression[7]);
  context.strokeStyle = '#7DFF2A';
  context.lineWidth = 0.085;
  context.lineCap = 'round';
  context.beginPath();
  const mouthWidth = currentExpression[8] * 0.25;
  const mouthDrop = currentExpression[9] * 0.08 + currentExpression[10] * 0.15;
  const mouthY = -0.23;
  context.moveTo(-mouthWidth, mouthY);
  context.quadraticCurveTo(currentExpression[11] * 0.1, mouthY - mouthDrop, mouthWidth, mouthY + currentExpression[11] * 0.05);
  context.stroke();
  if (currentExpression[10] > 0.05) {
    context.fillStyle = '#7DFF2A';
    context.beginPath();
    context.ellipse(0, mouthY - 0.015, Math.max(0.08, mouthWidth), 0.09, 0, 0, PI * 2);
    context.fill();
  }
  context.restore();

  const drawAntenna = (points, phase) => {
    context.strokeStyle = '#171B1C';
    context.lineWidth = 0.055;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    context.bezierCurveTo(points[1][0], points[1][1], points[2][0], points[2][1], points[3][0], points[3][1]);
    context.stroke();
    const pulse = 0.1 + Math.sin(elapsed * 3 + phase) * 0.012;
    context.fillStyle = '#7DFF2A';
    context.shadowColor = '#7DFF2A';
    context.shadowBlur = 0.18;
    context.beginPath();
    context.arc(points[3][0], points[3][1], pulse, 0, PI * 2);
    context.fill();
    context.shadowBlur = 0;
  };
  drawAntenna([[-0.65, 1.5], [-0.95, 2.1], [-0.96, 2.55], [-0.84, 2.82]], 0);
  drawAntenna([[0.65, 1.5], [0.95, 1.95], [1.04, 2.2], [1.1, 2.33]], 1.7);

  [-1, 1].forEach((side) => {
    context.fillStyle = '#171B1C';
    context.beginPath();
    context.ellipse(side * 1.07, 0.98, 0.2, 0.3, side * 0.12, 0, PI * 2);
    context.fill();
    context.strokeStyle = '#7DFF2A';
    context.lineWidth = 0.07;
    context.beginPath();
    context.arc(side * 1.2, 0.98, 0.18, 0, PI * 2);
    context.stroke();
  });

  context.save();
  context.translate(0.73, -0.9);
  context.rotate(0.12);
  context.fillStyle = '#171B1C';
  context.beginPath();
  context.roundRect(-0.33, -0.21, 0.66, 0.46, 0.05);
  context.fill();
  context.fillStyle = '#68BA42';
  drawLeaf(context, -0.11, 0.02, 0.12, -2.25, '#3d9a1c');
  drawLeaf(context, 0, 0.03, 0.15, -PI / 2, '#58b51f');
  drawLeaf(context, 0.1, 0, 0.12, -0.72, '#f68b1e');
  context.strokeStyle = '#67716C';
  context.lineWidth = 0.05;
  context.beginPath();
  context.moveTo(-0.4, 0.28);
  context.lineTo(0.4, 0.28);
  context.stroke();
  context.restore();

  context.restore();
}

export function mountNeoMascotCanvasFallback(canvas, hitTarget, pageRoot, onCelebrate, {
  floating = true,
  sizeSettings = { renderer: '3d', desktopScalePercent: 100, mobileScalePercent: 100 },
  rendererVariant = 'canvasFallback',
  svgHost,
  previewBaseSize = defaultPreviewBaseSize,
  previewDevice = 'desktop',
} = {}) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('The browser could not create a 2D canvas context for NEO.');
  if (rendererVariant === 'reference2d' && !svgHost) {
    throw new Error('The supplied NEO SVG renderer requires its host element.');
  }
  const svgRenderer = rendererVariant === 'reference2d'
    ? createNeo2D(svgHost, { autoplay: false, autoExpressions: false })
    : null;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 1;
  let height = 1;
  let size = 150;
  let normalSize = 150;
  let dockSize = 150;
  let dockX = 0;
  let dockY = 0;
  let chatOpen = false;
  let dockPanel = null;
  let dockResizeObserver;
  let currentX = 0;
  let currentY = 0;
  let targetX = 0;
  let targetY = 0;
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  let hitWidth = 75;
  let hitHeight = 115;
  let elapsed = 0;
  let lastFrame = performance.now();
  let frame = 0;
  let destroyed = false;
  let visible = !document.hidden;
  let mode = 'idle';
  let modeTime = 0;
  let jump = 0;
  let jumpVelocity = 0;
  let selectedPoint = null;
  let pointRect = null;
  let pointTargetRectDirty = true;
  let expressionTime = 0;
  let expressionHold = 0;
  let expressionIndex = 0;
  let blinkTimer = 3;
  let blink = 1;
  let nearPointer = false;
  let nearTime = 0;
  let gaze = { x: 0, y: 0 };
  let svgHeight = 0;
  let velocityX = 0;
  let movementTimer = 4;
  let targetCheckTimer = 0;
  let pointObserver;
  let sceneObserver;
  let mutationObserver;
  let resizeObserver;
  let mutationFrame = 0;
  let scrollTimer = 0;
  let isScrolling = false;
  let layoutFrame = 0;
  let textNodes = [];
  let obstacleCache = [];
  let obstaclesDirty = true;
  let lastObstacleRead = -Infinity;
  let lastObstacleScan = -Infinity;
  const targetExpression = expressionTargets.happy.slice();
  const currentExpression = expressionTargets.happy.slice();

  const positionHitTarget = () => {
    if (!floating && previewBaseSize === undefined) {
      hitTarget.style.width = '100%';
      hitTarget.style.height = '100%';
      hitTarget.style.transform = '';
      return;
    }
    hitWidth = svgRenderer ? size * 0.38 : size / 2;
    hitHeight = svgRenderer ? size * 0.46 : size * 4.6 / 6;
    hitTarget.style.width = `${hitWidth}px`;
    hitTarget.style.height = `${hitHeight}px`;
    const x = floating ? currentX : width / 2;
    const y = floating ? currentY : height / 2;
    hitTarget.style.transform = `translate(${x - hitWidth / 2}px, ${y - hitHeight / 2}px)`;
  };
  const positionSvgRenderer = () => {
    if (!svgRenderer) return;
    const nextHeight = normalSize * 1.15;
    if (Math.abs(svgHeight - nextHeight) > 0.5) {
      svgHeight = nextHeight;
      svgRenderer.setSize(svgHeight);
    }
    const scale = normalSize > 0 ? size / normalSize : 1;
    const x = floating ? currentX : width / 2;
    const y = floating ? currentY : height / 2;
    svgRenderer.element.style.position = 'absolute';
    svgRenderer.element.style.left = '0';
    svgRenderer.element.style.top = '0';
    svgRenderer.element.style.transformOrigin = 'top left';
    svgRenderer.element.style.transform =
      `translate3d(${x - svgHeight * 0.25 * scale}px, ${y - svgHeight * 0.4 * scale}px, 0) scale(${scale})`;
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
    const pixelWidth = Math.round(width * pixelRatio);
    const pixelHeight = Math.round(height * pixelRatio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    if (canvas.style.width !== `${width}px`) canvas.style.width = `${width}px`;
    if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;
    const deviceWidth = previewBaseSize === undefined ? window.innerWidth : previewDevice === 'mobile' ? 390 : 1280;
    const multiplier = resolveMascotMultiplier(sizeSettings, deviceWidth);
    const baseSize = floating
      ? Math.max(150, Math.min(height * 0.21, 215))
      : previewBaseSize ?? Math.min(width, height) * 0.94;
    const safeBaseSize = floating && width < MASCOT_MOBILE_BREAKPOINT ? Math.min(baseSize, 140) : baseSize;
    const geometry = calculateMascotGeometry(
      width, height, safeBaseSize, multiplier, floating,
      window.visualViewport?.offsetTop || 0, window.visualViewport?.height || height,
    );
    normalSize = geometry.size;
    if (!chatOpen) size = normalSize;
    else size = Math.min(size, normalSize);
    minX = geometry.minX;
    maxX = geometry.maxX;
    minY = geometry.minY;
    maxY = geometry.maxY;
    hitWidth = geometry.hitWidth;
    hitHeight = geometry.hitHeight;
    currentX = Math.min(Math.max(currentX || (floating ? maxX : width / 2), minX), maxX);
    currentY = Math.min(Math.max(currentY || (floating ? maxY : height / 2), minY), maxY);
    targetX = Math.min(Math.max(targetX || currentX, minX), maxX);
    targetY = Math.min(Math.max(targetY || currentY, minY), maxY);
    positionHitTarget();
    positionSvgRenderer();
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
  const setExpression = (name, hold = 0) => {
    if (!expressionTargets[name]) return false;
    targetExpression.splice(0, targetExpression.length, ...expressionTargets[name]);
    expressionTime = 0;
    expressionHold = hold;
    expressionIndex = expressionNames.indexOf(name);
    svgRenderer?.setExpression(name, hold > 0 ? hold : Infinity);
    return true;
  };
  const celebrate = () => {
    if (mode === 'celebrate') return;
    mode = 'celebrate';
    modeTime = 0;
    jump = 0;
    jumpVelocity = reducedMotion ? 0 : 7.5;
    setExpression('excited', 2.1);
    svgRenderer?.celebrate();
    onCelebrate?.();
  };
  const pointTo = (element) => {
    if (!(element instanceof Element) || !element.isConnected) return;
    selectedPoint = element;
    pointRect = element.getBoundingClientRect();
    pointTargetRectDirty = false;
    mode = 'point';
    modeTime = 0;
    setExpression('curious', 3);
  };
  let interactionTracker = null;
  if (floating) {
    interactionTracker = createMascotInteractionTracker({
      hitTarget,
      onTargetChange(target) {
        nearPointer = Boolean(target);
        obstaclesDirty = true;
        if (target) {
          setExpression('curious', 2.5);
          svgRenderer?.wave();
        }
        else expressionTime = 3;
      },
      onCelebrate: celebrate,
    });
  }
  const measureObstacles = () => {
    const now = performance.now();
    if (!obstaclesDirty || now - lastObstacleRead < 500) return obstacleCache;
    lastObstacleRead = now;
    obstaclesDirty = false;
    const mobile = isMobileMascotViewport(width);
    if (now - lastObstacleScan > 4000 && !mobile) {
      lastObstacleScan = now;
      textNodes = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!node.nodeValue?.trim() || !parent || /^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(parent.tagName) ||
            parent.closest('[hidden],[aria-hidden="true"],[data-mascot-ignore]')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (node.nodeValue?.trim() && parent && !parent.closest('[hidden],[aria-hidden="true"],[data-mascot-ignore]')) textNodes.push(node);
      }
    }
    const rectangles = [];
    const isVisible = (rect) => rect.width > 2 && rect.height > 2 && rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width;
    const range = document.createRange();
    if (!mobile) textNodes.forEach((node) => {
      if (!node.isConnected) return;
      range.selectNodeContents(node);
      Array.from(range.getClientRects()).filter(isVisible).forEach((rect) => rectangles.push(rect));
    });
    const protectedControls = mobile
      ? [document.activeElement, ...document.body.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],#ng-chat-panel')]
      : document.body.querySelectorAll('button,a[href],input,textarea,select,img,iframe,[role="dialog"],[role="alertdialog"]');
    Array.from(protectedControls).filter((element) => element instanceof Element).forEach((element) => {
      if (element.closest('[hidden],[aria-hidden="true"],[data-mascot-ignore]')) return;
      const rect = element.getBoundingClientRect();
      const blockingContainer = mobile && element.matches('[role="dialog"],[role="alertdialog"],[aria-modal="true"],#ng-chat-panel');
      if (isVisible(rect) && (blockingContainer || rect.width * rect.height < width * height * 0.5)) rectangles.push(rect);
    });
    obstacleCache = rectangles;
    return rectangles;
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
    let best = { x: currentX, y: currentY, score: Infinity };
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const x = minX + Math.random() * (maxX - minX);
      const y = minY + Math.random() * (maxY - minY);
      const overlap = overlapArea(x, y, obstacles);
      const distance = Math.hypot(x - currentX, y - currentY);
      const score = overlap * (isMobileMascotViewport(width) ? 4 : 1) +
        (distance < size * 1.2 ? 100000 : 0) + (distance < size * 2 ? 50 : 0);
      if (score < best.score) best = { x, y, score };
      if (!score) break;
    }
    targetX = best.x;
    targetY = best.y;
  };
  const setHitTarget = () => {
    positionHitTarget();
  };
  const animate = (now) => {
    frame = 0;
    if (destroyed || !visible) return;
    frame = requestAnimationFrame(animate);
    const delta = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    elapsed += delta;
    modeTime += delta;
    const desiredSize = chatOpen ? dockSize : normalSize;
    size += (desiredSize - size) * (1 - Math.exp(-delta * 5));
    const activeMode = mode === 'celebrate' || mode === 'point';
    const interactionTarget = interactionTracker?.target;
    const blocksInteractionRoaming = interactionTarget &&
      !interactionTarget.closest('#ng-chat-panel,.ng-chat-launcher');
    if (floating && chatOpen) {
      targetX = dockX;
      targetY = dockY;
    } else if (floating && (!blocksInteractionRoaming || isMobileMascotViewport(width)) && !activeMode) {
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
    const easing = 1 - Math.exp(-delta * 1.1);
    if (!reducedMotion) {
      currentX += (targetX - currentX) * easing;
      currentY += (targetY - currentY) * easing;
    } else if (chatOpen || movementTimer <= 0) {
      currentX = targetX;
      currentY = targetY;
    }
    velocityX = (currentX - previousX) / Math.max(delta, 0.001) / Math.max(size, 1);
    if (pointTargetRectDirty && selectedPoint?.isConnected) {
      pointRect = selectedPoint.getBoundingClientRect();
      pointTargetRectDirty = false;
    }
    const gazeEasing = 1 - Math.exp(-delta * 10);
    const gazeTarget = interactionTracker?.getGazeTarget(delta) ??
      (mode === 'point' ? pointRect : null);
    let targetGaze = null;
    if (gazeTarget && svgRenderer) {
      const point = 'x' in gazeTarget
        ? gazeTarget
        : { x: gazeTarget.left + gazeTarget.width / 2, y: gazeTarget.top + gazeTarget.height / 2 };
      svgRenderer.lookAt(point.x, point.y);
    } else if (svgRenderer) {
      svgRenderer.clearGaze();
    } else if (gazeTarget) {
      const scale = size / 6;
      const bob = reducedMotion ? Math.sin(elapsed * 1.7) * 0.05 : Math.sin(elapsed * 1.7) * 0.14;
      const rootRotation = Math.sin(elapsed * 1.3) * 0.03 -
        Math.max(-0.25, Math.min(0.25, velocityX * 0.3));
      const canvasBounds = canvas.getBoundingClientRect();
      const headX = canvasBounds.left + currentX - Math.sin(rootRotation) * 0.98 * scale;
      const headY = canvasBounds.top + currentY - jump * scale -
        (bob + Math.cos(rootRotation) * 0.98) * scale;
      targetGaze = getMascotTargetGaze(gazeTarget, headX, headY, size, rootRotation);
    }
    const desiredGaze = targetGaze ?? getMascotIdleGaze(elapsed);
    gaze.x += (desiredGaze.x - gaze.x) * gazeEasing;
    gaze.y += (desiredGaze.y - gaze.y) * gazeEasing;
    setHitTarget();
    positionSvgRenderer();
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
    currentExpression.forEach((value, index) => {
      currentExpression[index] += (targetExpression[index] - value) * expressionEasing;
    });
    if (jump > 0 || mode === 'celebrate') {
      jump += jumpVelocity * delta;
      jumpVelocity -= 22 * delta;
      if (jump < 0) {
        jump = 0;
        jumpVelocity = mode === 'celebrate' && !reducedMotion ? 4.5 : 0;
      }
    }
    context.setTransform(Math.min(window.devicePixelRatio || 1, 2), 0, 0, Math.min(window.devicePixelRatio || 1, 2), 0, 0);
    context.clearRect(0, 0, width, height);
    if (svgRenderer) {
      svgRenderer.update(delta);
    } else {
      drawRobot(context, { elapsed, currentExpression, blink, gaze, mode, nearPointer, jump, reducedMotion, velocityX, currentX, currentY, size, width, height, pointRect });
    }
  };
  const start = () => {
    if (!frame && !destroyed && visible) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(animate);
    }
  };
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
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
    const targets = new Set(pageRoot.querySelectorAll('section'));
    const oldTargets = pointObserver.__targets || new Set();
    oldTargets.forEach((target) => { if (!targets.has(target)) pointObserver.unobserve(target); });
    targets.forEach((target) => { if (!oldTargets.has(target)) pointObserver.observe(target); });
    pointObserver.__targets = targets;
    obstaclesDirty = true;
  };
  const schedulePointReconcile = () => {
    if (!mutationFrame) mutationFrame = requestAnimationFrame(reconcilePointTargets);
  };

  if (floating) {
    pointObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting && !chatOpen && mode !== 'celebrate' && !entry.target.__neoPointed) {
        entry.target.__neoPointed = true;
        pointTo(entry.target.querySelector('h2,h3') || entry.target);
      }
    }), { threshold: 0.6 });
  }
  sceneObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) start();
    else stop();
  }, { threshold: 0 });
  sceneObserver.observe(svgRenderer?.element ?? canvas);
  if (floating) {
    mutationObserver = new MutationObserver(schedulePointReconcile);
    mutationObserver.observe(pageRoot, { childList: true, subtree: true, characterData: true });
  } else if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
    resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(canvas.parentElement);
  }

  layout();
  currentX = targetX = floating ? maxX : width / 2;
  currentY = targetY = floating ? maxY : height / 2;
  setExpression('happy');
  positionHitTarget();
  if (floating || !resizeObserver) window.addEventListener('resize', scheduleLayout, { passive: true });
  window.addEventListener('orientationchange', scheduleLayout, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleLayout, { passive: true });
  window.visualViewport?.addEventListener('scroll', scheduleLayout, { passive: true });
  window.visualViewport?.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  if (floating) {
    reconcilePointTargets();
  }
  document.addEventListener('visibilitychange', updateVisibility);
  start();

  return {
    api: {
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
    },
    cleanup() {
      if (destroyed) return;
      destroyed = true;
      stop();
      svgRenderer?.destroy();
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
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      dockResizeObserver?.disconnect();
      hitTarget.style.width = '0';
      hitTarget.style.height = '0';
      hitTarget.style.transform = '';
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
