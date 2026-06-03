import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampScale,
  scaleFromDrag,
  angleDelta,
  rotFromDrag,
  screenAngleDeg,
  dist,
  SCALE_MIN,
  SCALE_MAX,
} from "./transform-gestures.ts";

test("clampScale keeps scale within bounds", () => {
  assert.equal(clampScale(0.1), SCALE_MIN);
  assert.equal(clampScale(10), SCALE_MAX);
  assert.equal(clampScale(1.5), 1.5);
});

test("scaleFromDrag scales by the distance ratio from center", () => {
  assert.equal(scaleFromDrag(1, 100, 200), 2); // pointer twice as far -> 2x
  assert.equal(scaleFromDrag(1, 100, 50), 0.5); // half the distance -> 0.5x
  assert.equal(scaleFromDrag(2, 100, 100), 2); // no movement -> unchanged
  assert.equal(scaleFromDrag(1, 0, 50), 1); // guard: zero start distance
  assert.equal(scaleFromDrag(1, 100, 1000), SCALE_MAX); // clamps at the top
});

test("angleDelta normalizes the difference to (-180, 180]", () => {
  assert.equal(angleDelta(-90, 0), 90);
  assert.equal(angleDelta(170, -170), 20); // wraps across the 180 seam
  assert.equal(angleDelta(-170, 170), -20);
  assert.equal(angleDelta(0, 180), 180);
});

test("rotFromDrag keeps the grabbed handle under the pointer", () => {
  // Top handle sits at -90deg; dragging it to 0deg is a 90deg clockwise sweep,
  // which must rotate the monke clockwise -> rot decreases to -90.
  assert.equal(rotFromDrag(0, -90, 0), -90);
  assert.equal(rotFromDrag(0, -90, -180), 90); // counter-clockwise sweep
  assert.equal(rotFromDrag(10, 0, 0), 10); // no movement -> unchanged
});

// atan2-based results carry floating-point error (e.g. -90.0000000000001), so compare
// angles within a tolerance rather than with strict equality.
const closeTo = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ~${expected}, got ${actual}`);

test("screenAngleDeg and dist helpers", () => {
  closeTo(screenAngleDeg(0, -1), -90); // straight up (screen y points down)
  closeTo(screenAngleDeg(1, 0), 0);
  assert.equal(dist(3, 4), 5); // exact: integer Pythagorean triple
});
