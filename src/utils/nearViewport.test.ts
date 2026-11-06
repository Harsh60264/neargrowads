import assert from 'node:assert/strict';
import test from 'node:test';
import { observeNearViewport, type NearViewportObserverFactory } from './nearViewport';

test('activates once when the observed section approaches the viewport', () => {
  let reportIntersection: ((isIntersecting: boolean) => void) | undefined;
  let observedTarget: Element | undefined;
  let disconnected = false;
  let activations = 0;
  const target = {} as Element;
  const createObserver: NearViewportObserverFactory = (callback, rootMargin) => {
    assert.equal(rootMargin, '1000px 0px');
    reportIntersection = callback;
    return {
      observe: (element) => { observedTarget = element; },
      disconnect: () => { disconnected = true; },
    };
  };

  observeNearViewport(target, () => { activations += 1; }, '1000px 0px', createObserver);

  assert.equal(observedTarget, target);
  reportIntersection?.(false);
  assert.equal(activations, 0);
  reportIntersection?.(true);
  reportIntersection?.(true);
  assert.equal(activations, 1);
  assert.equal(disconnected, true);
});

test('activates immediately when IntersectionObserver is unavailable', () => {
  let activations = 0;
  const dispose = observeNearViewport({} as Element, () => { activations += 1; }, '800px', () => undefined);

  assert.equal(activations, 1);
  assert.equal(typeof dispose, 'function');
});
