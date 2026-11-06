export const MASCOT_FRAME_INTERVAL_MS = 1000 / 30;
export const REDUCED_MOTION_FRAME_INTERVAL_MS = 1000 / 12;

export function mascotFrameInterval(reducedMotion) {
  return reducedMotion ? REDUCED_MOTION_FRAME_INTERVAL_MS : MASCOT_FRAME_INTERVAL_MS;
}

export function shouldRenderMascotFrame(now, lastFrame, reducedMotion) {
  return now - lastFrame >= mascotFrameInterval(reducedMotion);
}
