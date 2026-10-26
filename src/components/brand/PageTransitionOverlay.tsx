import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NearGrowLeafMark } from './NearGrowLeafMark';

interface PageTransitionOverlayProps {
  transitionId: number;
  transitionDuration: number;
  contentReady: boolean;
  onActiveChange: (active: boolean) => void;
  onComplete: () => void;
}

type TransitionPhase = 'hidden' | 'entering' | 'holding' | 'exiting';

type TransitionStyle = React.CSSProperties & {
  '--ng-transition-duration': string;
  '--ng-transition-fade-duration': string;
};

export const PageTransitionOverlay: React.FC<PageTransitionOverlayProps> = ({
  transitionId,
  transitionDuration,
  contentReady,
  onActiveChange,
  onComplete,
}) => {
  const [phase, setPhase] = useState<TransitionPhase>('hidden');
  const phaseRef = useRef<TransitionPhase>('hidden');
  const activeTransitionRef = useRef(0);
  const timelineEndRef = useRef(0);
  const completedGrowthRef = useRef(false);
  const contentReadyRef = useRef(contentReady);
  const durationRef = useRef(transitionDuration);
  const fadeDurationRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const callbacksRef = useRef({ onActiveChange, onComplete });
  const statusRef = useRef<HTMLSpanElement>(null);

  callbacksRef.current = { onActiveChange, onComplete };
  contentReadyRef.current = contentReady;

  useLayoutEffect(() => {
    if (transitionId === 0 || transitionId === activeTransitionRef.current) return;
    activeTransitionRef.current = transitionId;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (phaseRef.current === 'hidden') {
      durationRef.current = reducedMotion ? 200 : transitionDuration;
      fadeDurationRef.current = reducedMotion ? 120 : transitionDuration * 0.21;
      timelineEndRef.current = performance.now() + (reducedMotion ? 80 : transitionDuration * 0.79);
      completedGrowthRef.current = false;
      phaseRef.current = 'entering';
      setPhase('entering');
      callbacksRef.current.onActiveChange(true);
    } else {
      if (phaseRef.current === 'exiting') {
        durationRef.current = reducedMotion ? 200 : transitionDuration;
        fadeDurationRef.current = reducedMotion ? 120 : transitionDuration * 0.21;
        phaseRef.current = 'holding';
        setPhase('holding');
      } else if (phaseRef.current === 'holding') {
        durationRef.current = reducedMotion ? 200 : transitionDuration;
        fadeDurationRef.current = reducedMotion ? 120 : transitionDuration * 0.21;
      }
    }

    const finishGrowth = () => {
      completedGrowthRef.current = true;
      if (phaseRef.current === 'entering') {
        phaseRef.current = 'holding';
        setPhase('holding');
      }
      if (contentReadyRef.current) beginExit();
    };

    const remainingGrowth = Math.max(0, timelineEndRef.current - performance.now());
    if (completedGrowthRef.current || phaseRef.current === 'holding') {
      if (contentReadyRef.current) beginExit();
    } else {
      timersRef.current.push(setTimeout(finishGrowth, remainingGrowth));
    }
  }, [transitionId, transitionDuration]);

  const beginExit = () => {
    if (phaseRef.current === 'exiting' || phaseRef.current === 'hidden') return;
    phaseRef.current = 'exiting';
    setPhase('exiting');
    timersRef.current.push(setTimeout(() => {
      phaseRef.current = 'hidden';
      setPhase('hidden');
      callbacksRef.current.onActiveChange(false);
      callbacksRef.current.onComplete();
    }, fadeDurationRef.current));
  };

  useEffect(() => {
    if (phase === 'hidden') return;
    const completeWhenBackgrounded = () => {
      if (!document.hidden) return;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      completedGrowthRef.current = true;
      phaseRef.current = 'hidden';
      setPhase('hidden');
      callbacksRef.current.onActiveChange(false);
      callbacksRef.current.onComplete();
    };
    document.addEventListener('visibilitychange', completeWhenBackgrounded);
    return () => document.removeEventListener('visibilitychange', completeWhenBackgrounded);
  }, [phase]);

  useEffect(() => {
    if (contentReady && completedGrowthRef.current) beginExit();
  }, [contentReady]);

  useLayoutEffect(() => {
    if (phase === 'entering') statusRef.current?.focus({ preventScroll: true });
  }, [phase]);

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    callbacksRef.current.onActiveChange(false);
  }, []);

  const style: TransitionStyle = {
    '--ng-transition-duration': `${durationRef.current}ms`,
    '--ng-transition-fade-duration': `${fadeDurationRef.current}ms`,
  };

  return (
    <div
      className="ng-transition-overlay"
      data-phase={phase}
      style={style}
      aria-hidden={phase === 'hidden'}
    >
      <span ref={statusRef} className="ng-transition-status" role="status" aria-live="polite" aria-atomic="true" tabIndex={-1}>
        {phase === 'hidden' ? '' : 'Loading page'}
      </span>
      <div className="ng-transition-mark" aria-hidden="true">
        <NearGrowLeafMark animated />
      </div>
    </div>
  );
};
