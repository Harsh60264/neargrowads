export function calculateMascotDockTarget(panelRect, width, height, mascotSize, visualViewportOffsetTop = 0, visualViewportHeight = height) {
  const sideSpace = Math.max(0, panelRect.left - 16);
  const verticalSpace = Math.max(0, visualViewportHeight - 16);
  const size = Math.min(
    mascotSize,
    Math.max(48, sideSpace / 0.68),
    Math.max(48, (width - 20) / 0.68),
    Math.max(48, verticalSpace / 0.98),
  );
  const horizontalInset = size * 0.34 + 8;
  const minX = Math.min(horizontalInset, width / 2);
  const maxX = Math.max(minX, width - horizontalInset);
  const minY = visualViewportOffsetTop + size * 0.32 + 8;
  const maxY = Math.max(minY, visualViewportOffsetTop + visualViewportHeight - size * 0.68 - 8);
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

  return {
    x: clamp(panelRect.left - size * 0.34 - 8, minX, maxX),
    y: clamp(panelRect.bottom - size * 0.08, minY, maxY),
    size,
  };
}
