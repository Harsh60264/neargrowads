export interface NearViewportObserver {
  observe(target: Element): void;
  disconnect(): void;
}

export type NearViewportObserverFactory = (
  onIntersection: (isIntersecting: boolean) => void,
  rootMargin: string,
) => NearViewportObserver | undefined;

const browserObserverFactory: NearViewportObserverFactory = (onIntersection, rootMargin) => {
  if (typeof IntersectionObserver === 'undefined') return undefined;
  const observer = new IntersectionObserver(
    (entries) => onIntersection(entries.some((entry) => entry.isIntersecting)),
    { rootMargin },
  );
  return observer;
};

export function observeNearViewport(
  target: Element,
  onVisible: () => void,
  rootMargin = '800px 0px',
  createObserver: NearViewportObserverFactory = browserObserverFactory,
): () => void {
  let observer: NearViewportObserver | undefined;
  let activated = false;
  const activate = () => {
    if (activated) return;
    activated = true;
    observer?.disconnect();
    onVisible();
  };
  observer = createObserver((isIntersecting) => {
    if (isIntersecting) activate();
  }, rootMargin);

  if (observer) observer.observe(target);
  else activate();

  return () => observer?.disconnect();
}
