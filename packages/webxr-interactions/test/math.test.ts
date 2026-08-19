import { describe, expect, it } from "vitest";
import {
  centeredUnit,
  clamp01,
  clampSym,
  decay,
  easeOutBounce,
  hingeAngleToHand,
  normalize01,
  passedThroughHoop,
  quatFromAxisAngle,
  rayPointDistance,
  springStep,
  vApplyQuat,
  worldToLocal,
} from "@realitycollective/webxr-interactions";

describe("clamp01 / normalize01 / clampSym / centeredUnit", () => {
  it("clamps and normalizes, sign-agnostic", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(normalize01(0.15, 0.3)).toBeCloseTo(0.5);
    expect(normalize01(-Math.PI / 2, -Math.PI / 2)).toBe(1);
    expect(normalize01(1, 0)).toBe(0);
    expect(clampSym(2, -1)).toBe(1);
    expect(clampSym(-2, 1)).toBe(-1);
    expect(centeredUnit(0, Math.PI / 4)).toBe(0.5);
    expect(centeredUnit(Math.PI / 4, Math.PI / 4)).toBe(1);
    expect(centeredUnit(-Math.PI / 4, Math.PI / 4)).toBe(0);
    expect(centeredUnit(1, 0)).toBe(0.5);
  });
});

describe("springStep", () => {
  it("underdamped spring overshoots then settles at the target", () => {
    let value = 0;
    let velocity = 0;
    const out = new Float32Array(2);
    let overshot = false;
    for (let i = 0; i < 600; i++) {
      springStep(value, velocity, 1, 220, 12, 1 / 60, out);
      value = out[0]!;
      velocity = out[1]!;
      if (value > 1.001) overshot = true;
    }
    expect(overshot).toBe(true);
    expect(value).toBeCloseTo(1, 2);
  });

  it("clamps dt so a huge frame cannot explode", () => {
    const out = springStep(0, 0, 1, 600, 2, 10);
    expect(Number.isFinite(out[0]!)).toBe(true);
    expect(Math.abs(out[0]!)).toBeLessThan(10);
  });
});

describe("decay / easeOutBounce", () => {
  it("decays framerate-independently and snaps to 0", () => {
    expect(decay(1, 6, 0.1)).toBeCloseTo(Math.exp(-0.6), 5);
    expect(decay(1e-5, 6, 0.1)).toBe(0);
  });

  it("bounce hits its endpoints", () => {
    expect(easeOutBounce(0)).toBeCloseTo(0, 5);
    expect(easeOutBounce(1)).toBeCloseTo(1, 5);
  });
});

describe("passedThroughHoop", () => {
  it("scores only a downward crossing inside the ring", () => {
    expect(passedThroughHoop(0.05, -0.05, 0, 0.1, 0.2)).toBe(true);
    expect(passedThroughHoop(-0.05, 0.05, 0, 0.1, 0.2)).toBe(false); // upward
    expect(passedThroughHoop(0.05, -0.05, 0, 0.3, 0.2)).toBe(false); // outside
    expect(passedThroughHoop(-0.01, -0.05, 0, 0.1, 0.2)).toBe(false); // already below
  });
});

describe("hingeAngleToHand", () => {
  it("points at the hand, clamped", () => {
    expect(hingeAngleToHand(1, 0, Math.PI / 2)).toBe(0);
    expect(hingeAngleToHand(0, 1, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(hingeAngleToHand(0, -1, Math.PI / 4)).toBeCloseTo(-Math.PI / 4);
  });
});

describe("quaternion / frame helpers", () => {
  it("rotates a vector by an axis-angle quaternion", () => {
    const q = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
    const v = vApplyQuat([0, 0, -1], q);
    expect(v[0]).toBeCloseTo(-1, 5);
    expect(v[1]).toBeCloseTo(0, 5);
    expect(v[2]).toBeCloseTo(0, 5);
  });

  it("worldToLocal inverts a pose transform", () => {
    const q = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
    // Local point [0,0,-1] rotated by q is [-1,0,0]; translate by [5,0,0].
    const world: [number, number, number] = [5 - 1, 0, 0];
    const local = worldToLocal(world, [5, 0, 0], q);
    expect(local[0]).toBeCloseTo(0, 5);
    expect(local[1]).toBeCloseTo(0, 5);
    expect(local[2]).toBeCloseTo(-1, 5);
  });

  it("ray-point distance handles behind-origin points", () => {
    const ahead = rayPointDistance({ origin: [0, 0, 0], direction: [0, 0, -1] }, [0, 0.1, -2]);
    expect(ahead.distance).toBeCloseTo(0.1, 5);
    expect(ahead.t).toBeCloseTo(2, 5);
    const behind = rayPointDistance({ origin: [0, 0, 0], direction: [0, 0, -1] }, [0, 0, 3]);
    expect(behind.t).toBe(0);
    expect(behind.distance).toBeCloseTo(3, 5);
  });
});
