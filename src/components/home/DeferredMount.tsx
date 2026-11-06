import { useEffect, useRef, useState, type ReactNode } from 'react';
import { observeNearViewport } from '../../utils/nearViewport';

interface DeferredMountProps {
  children: ReactNode;
  className?: string;
  fallback?: ReactNode;
  rootMargin?: string;
}

export function DeferredMount({
  children,
  className,
  fallback = null,
  rootMargin = '800px 0px',
}: DeferredMountProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    return observeNearViewport(target, () => setVisible(true), rootMargin);
  }, [rootMargin]);

  return (
    <div ref={targetRef} className={className}>
      {visible ? children : fallback}
    </div>
  );
}
