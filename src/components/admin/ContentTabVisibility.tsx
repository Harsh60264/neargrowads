import type { ReactNode } from 'react';

export function ContentTabVisibility({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return visible ? <>{children}</> : null;
}
