import { MASCOT_MOBILE_BREAKPOINT } from '../../data/mascotSizing.js';

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  '[data-mascot-interactive]',
  '[tabindex]:not([tabindex="-1"])',
  '[onclick]',
  'label[for]',
  '[data-mascot="cta"]',
].join(',');

export function resolveMascotInteractionTarget(node) {
  if (!(node instanceof Element)) return null;
  let target = node.closest(INTERACTIVE_SELECTOR);
  if (!target) {
    for (let ancestor = node; ancestor instanceof Element; ancestor = ancestor.parentElement) {
      if (window.getComputedStyle(ancestor).cursor === 'pointer') {
        target = ancestor;
        break;
      }
    }
  }
  if (!target || !target.isConnected || target.matches(':disabled,[aria-disabled="true"],[hidden],[inert]') ||
    target.closest('[aria-disabled="true"],[hidden],[inert],[aria-hidden="true"],[data-mascot-ignore]')) return null;
  for (let ancestor = target; ancestor instanceof Element; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
      Number(style.opacity) === 0) return null;
  }
  const rect = target.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? target : null;
}

export function isMascotCelebrationTarget(target) {
  return Boolean(target && (
    target.dataset.mascot === 'cta' ||
    (!target.dataset.x && /free consultation|get started|contact|book|consult|request (a )?quote/i.test(target.textContent || ''))
  ));
}

export function createMascotInteractionTracker({ hitTarget, onTargetChange, onCelebrate }) {
  let pointerTarget = null;
  let pointerPoint = null;
  let focusTarget = null;
  let target = null;
  let targetRect = null;
  let lastCelebratedAt = -Infinity;
  let destroyed = false;
  let targetObserver = null;
  let scrollFrame = 0;
  const cursorGlance = createMascotCursorGlanceController({
    touchOnly: window.matchMedia('(hover: none) and (pointer: coarse)').matches,
  });

  const getActiveTarget = () => {
    if (pointerTarget?.isConnected) return pointerTarget;
    if (focusTarget?.isConnected) return focusTarget;
    return null;
  };
  const observeTarget = () => {
    targetObserver?.disconnect();
    if (!target || typeof MutationObserver === 'undefined') return;
    targetObserver = new MutationObserver(() => {
      if (resolveMascotInteractionTarget(target) !== target) {
        if (pointerTarget === target) pointerTarget = null;
        if (focusTarget === target) focusTarget = null;
        updateTarget();
      }
    });
    for (let node = target; node instanceof Element; node = node.parentElement) {
      targetObserver.observe(node, {
        attributes: true,
        attributeFilter: ['aria-hidden', 'aria-disabled', 'class', 'disabled', 'hidden', 'inert', 'style'],
      });
    }
  };
  const updateTarget = () => {
    const next = getActiveTarget();
    if (next === target) return;
    target = next;
    cursorGlance.setInteractive(Boolean(next));
    targetRect = null;
    observeTarget();
    onTargetChange(next);
    if (next && isMascotCelebrationTarget(next)) {
      const now = performance.now();
      if (now - lastCelebratedAt > 1200) {
        lastCelebratedAt = now;
        onCelebrate();
      }
    }
  };
  const onPointerOver = (event) => {
    if (event.pointerType === 'touch' || event.pointerType === 'unknown') return;
    if (hitTarget.contains(event.target)) {
      if (pointerTarget) {
        pointerTarget = null;
        pointerPoint = null;
        updateTarget();
      }
      return;
    }
    const next = resolveMascotInteractionTarget(event.target);
    pointerTarget = next;
    pointerPoint = next ? { x: event.clientX, y: event.clientY } : null;
    updateTarget();
  };
  const onPointerOut = (event) => {
    if (!event.relatedTarget) {
      cursorGlance.clearPointer();
      pointerTarget = null;
      pointerPoint = null;
      updateTarget();
    }
    if (hitTarget.contains(event.target)) return;
    const leaving = resolveMascotInteractionTarget(event.target);
    const resolvedNext = resolveMascotInteractionTarget(event.relatedTarget);
    const next = resolvedNext && hitTarget.contains(resolvedNext) ? null : resolvedNext;
    if (leaving && leaving === pointerTarget && next !== leaving) {
      pointerTarget = next;
      pointerPoint = next ? { x: event.clientX, y: event.clientY } : null;
      updateTarget();
    }
  };
  const onFocusIn = (event) => {
    focusTarget = resolveMascotInteractionTarget(event.target);
    updateTarget();
  };
  const onFocusOut = (event) => {
    const leaving = resolveMascotInteractionTarget(event.target);
    if (leaving && leaving === focusTarget) {
      focusTarget = resolveMascotInteractionTarget(event.relatedTarget);
      updateTarget();
    }
  };
  const onScroll = () => {
    if (!pointerTarget || !pointerPoint || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!pointerTarget || !pointerPoint) return;
      const elementUnderPointer = document.elementFromPoint(pointerPoint.x, pointerPoint.y);
      const next = hitTarget.contains(elementUnderPointer)
        ? null
        : resolveMascotInteractionTarget(elementUnderPointer);
      if (next === pointerTarget) return;
      pointerTarget = next;
      pointerPoint = next ? { ...pointerPoint } : null;
      updateTarget();
    });
  };
  const onPointerMove = (event) => {
    if (event.pointerType === 'touch' || event.pointerType === 'unknown') return;
    if (hitTarget.contains(event.target)) {
      cursorGlance.clearPointer();
      return;
    }
    cursorGlance.setPointer({ x: event.clientX, y: event.clientY });
    const next = resolveMascotInteractionTarget(event.target);
    if (next !== pointerTarget) {
      pointerTarget = next;
      pointerPoint = next ? { x: event.clientX, y: event.clientY } : null;
      updateTarget();
    } else if (next) {
      pointerPoint = { x: event.clientX, y: event.clientY };
    }
  };
  const readTarget = () => {
    if (target && !target.isConnected) {
      if (pointerTarget === target) pointerTarget = null;
      if (!pointerTarget) pointerPoint = null;
      if (focusTarget === target) focusTarget = null;
      updateTarget();
    }
    return target;
  };

  document.addEventListener('pointerover', onPointerOver, { passive: true });
  document.addEventListener('pointerout', onPointerOut, { passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.visualViewport?.addEventListener('scroll', onScroll, { passive: true });

  return {
    get target() {
      return readTarget();
    },
    get rect() {
      const currentTarget = readTarget();
      if (!currentTarget) return null;
      const viewport = window.visualViewport;
      targetRect = getMascotVisibleTargetRect(
        currentTarget.getBoundingClientRect(),
        {
          left: viewport?.offsetLeft ?? 0,
          top: viewport?.offsetTop ?? 0,
          width: viewport?.width ?? window.innerWidth,
          height: viewport?.height ?? window.innerHeight,
        },
      );
      if (!targetRect) {
        if (pointerTarget === currentTarget) pointerTarget = null;
        if (focusTarget === currentTarget) focusTarget = null;
        updateTarget();
      }
      return targetRect;
    },
    getGazeTarget(delta) {
      const currentTarget = readTarget();
      if (pointerTarget?.isConnected && pointerPoint) {
        return getMascotAttentionPoint(pointerPoint, null);
      }
      if (currentTarget) {
        const rect = this.rect;
        return getMascotAttentionPoint(null, rect);
      }
      return cursorGlance.update(delta);
    },
    cleanup() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('scroll', onScroll, true);
      window.visualViewport?.removeEventListener('scroll', onScroll);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      targetObserver?.disconnect();
      cursorGlance.clearPointer();
      pointerTarget = null;
      pointerPoint = null;
      focusTarget = null;
      target = null;
      targetRect = null;
    },
  };
}

export function getMascotVisibleTargetRect(rect, viewport) {
  const left = Math.max(rect.left, viewport.left);
  const right = Math.min(rect.right, viewport.left + viewport.width);
  const top = Math.max(rect.top, viewport.top);
  const bottom = Math.min(rect.bottom, viewport.top + viewport.height);
  if (right <= left || bottom <= top) return null;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

export function getMascotAttentionPoint(pointerPoint, focusRect) {
  if (pointerPoint) return { x: pointerPoint.x, y: pointerPoint.y };
  if (focusRect) {
    return {
      x: focusRect.left + focusRect.width / 2,
      y: focusRect.top + focusRect.height / 2,
    };
  }
  return null;
}

export function createMascotCursorGlanceController({
  touchOnly = false,
  random = Math.random,
} = {}) {
  let pointer = null;
  let pointerInside = false;
  let interactive = false;
  let cooldown = null;
  let activePoint = null;
  let activeDuration = 0;
  const randomBetween = (min, max) => min + random() * (max - min);

  return {
    setPointer(point) {
      if (touchOnly) return;
      pointer = point;
      pointerInside = true;
      if (cooldown === null && !interactive && !activePoint) cooldown = randomBetween(5, 10);
    },
    setInteractive(value) {
      interactive = value;
      activePoint = null;
      activeDuration = 0;
      cooldown = null;
    },
    clearPointer() {
      pointer = null;
      pointerInside = false;
      activePoint = null;
      activeDuration = 0;
      cooldown = null;
    },
    update(delta) {
      if (touchOnly || interactive || !pointerInside || !pointer) return null;
      if (activePoint) {
        activeDuration -= delta;
        if (activeDuration > 0) return activePoint;
        activePoint = null;
        cooldown = randomBetween(5, 10);
      }
      if (cooldown === null) cooldown = randomBetween(5, 10);
      cooldown -= delta;
      if (cooldown > 0) return null;
      activePoint = { ...pointer };
      activeDuration = randomBetween(0.8, 1.5);
      return activePoint;
    },
  };
}

export function getMascotIdleGaze(elapsed) {
  void elapsed;
  return { x: 0, y: 0 };
}

export function getMascotTargetGaze(target, x, y, size, rotationZ = 0) {
  if (!target) return null;
  const targetX = 'left' in target ? target.left + target.width / 2 : target.x;
  const targetY = 'top' in target ? target.top + target.height / 2 : target.y;
  const screenX = targetX - x;
  const screenY = y - targetY;
  const localX = Math.cos(rotationZ) * screenX + Math.sin(rotationZ) * screenY;
  const localY = -Math.sin(rotationZ) * screenX + Math.cos(rotationZ) * screenY;
  return {
    x: Math.max(-0.48, Math.min(0.48, localX / Math.max(1, size * 1.25))),
    y: Math.max(-0.28, Math.min(0.28, localY / Math.max(1, size * 1.8))),
  };
}

export function isMobileMascotViewport(width) {
  return width < MASCOT_MOBILE_BREAKPOINT;
}
