// Pure math for the direct-manipulation transform handles on the result preview.
// Kept free of React/DOM so the sign and clamp logic is unit-testable on its own.

export const SCALE_MIN = 0.25;
export const SCALE_MAX = 4;

export function clampScale(s: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
}

export function dist(dx: number, dy: number): number {
  return Math.hypot(dx, dy);
}

// Angle of a vector in screen space, in degrees. Screen y points down, so
// "straight up" is -90deg and clockwise is the positive direction.
export function screenAngleDeg(dx: number, dy: number): number {
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

// Resize: the new scale tracks how much farther/closer the pointer is from the
// monke's center than where the drag started.
export function scaleFromDrag(startScale: number, startDist: number, curDist: number): number {
  if (startDist <= 0) return clampScale(startScale);
  return clampScale(startScale * (curDist / startDist));
}

// Smallest signed difference cur - start, normalized to (-180, 180].
export function angleDelta(startDeg: number, curDeg: number): number {
  let d = curDeg - startDeg;
  while (d <= -180) d += 360;
  while (d > 180) d -= 360;
  return d;
}

// Rotate: the preview renders each monke with `rotate(-(roll + rot))` (clockwise
// positive), so a clockwise pointer sweep (increasing screen angle) must DECREASE
// rot to keep the grabbed handle locked under the pointer.
export function rotFromDrag(startRot: number, startAngleDeg: number, curAngleDeg: number): number {
  return startRot - angleDelta(startAngleDeg, curAngleDeg);
}
