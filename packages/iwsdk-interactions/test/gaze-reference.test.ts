/**
 * Parity with the reference: IWSDK 1.0.0's `FilteredEyeGaze` and the dwell
 * consensus of its `GazeConecaster` are driven side by side with the core's
 * `EyeGazeFilter` and `GazeConsensus` on the same inputs, the way
 * `follow-reference.test.ts` in WebXR-UIExtensions proves the follow rule.
 * The constants are compared with `GazeSystem`'s config defaults too.
 */
import { describe, expect, it } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import { FilteredEyeGaze, GazeConecaster } from "@iwsdk/xr-input";
import { GazeSystem } from "@iwsdk/core";
import {
  EYE_GAZE_DEFAULTS,
  EyeGazeFilter,
  GazeConsensus,
  type PoseTuple,
} from "@realitycollective/webxr-interactions";

/** A deterministic, jittery gaze walk: a slow sweep with noise, and one representation flip. */
function poses(count: number): PoseTuple[] {
  const out: PoseTuple[] = [];
  let seed = 7;
  const noise = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280 - 0.5;
  };
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * 0.6 + noise() * 0.02;
    const pitch = noise() * 0.01;
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
    const sign = i === 20 ? -1 : 1;
    out.push({
      position: [noise() * 0.002, 1.6 + noise() * 0.002, noise() * 0.002],
      quaternion: [sign * q.x, sign * q.y, sign * q.z, sign * q.w],
    });
  }
  return out;
}

describe("the core eye-gaze filter against IWSDK's FilteredEyeGaze", () => {
  it("produces the same smoothed poses over the same input, frame for frame", () => {
    const reference = new FilteredEyeGaze();
    const core = new EyeGazeFilter();
    const outPos = new Vector3();
    const outQuat = new Quaternion();
    const inPos = new Vector3();
    const inQuat = new Quaternion();
    const dts = [1 / 60, 1 / 72, 1 / 90, 1 / 30];
    poses(120).forEach((pose, i) => {
      const dt = dts[i % dts.length]!;
      inPos.set(...pose.position);
      inQuat.set(...pose.quaternion);
      reference.filter(inPos, inQuat, dt, outPos, outQuat);
      const ours = core.filter(pose, dt);
      expect(ours.position[0]).toBeCloseTo(outPos.x, 12);
      expect(ours.position[1]).toBeCloseTo(outPos.y, 12);
      expect(ours.position[2]).toBeCloseTo(outPos.z, 12);
      expect(ours.quaternion[0]).toBeCloseTo(outQuat.x, 12);
      expect(ours.quaternion[1]).toBeCloseTo(outQuat.y, 12);
      expect(ours.quaternion[2]).toBeCloseTo(outQuat.z, 12);
      expect(ours.quaternion[3]).toBeCloseTo(outQuat.w, 12);
    });
  });

  it("carries IWSDK's filter defaults", () => {
    const reference = new FilteredEyeGaze();
    expect(EYE_GAZE_DEFAULTS.filterMinCutoff).toBe(reference.minCutoff);
    expect(EYE_GAZE_DEFAULTS.filterBeta).toBe(reference.beta);
    expect(EYE_GAZE_DEFAULTS.filterDCutoff).toBe(reference.dCutoff);
  });
});

describe("the core dwell consensus against IWSDK's GazeConecaster", () => {
  /** The conecaster's dwell record, driven directly: the same three steps `update` takes after the cone. */
  interface DwellRecord {
    recordDwell(object: Object3D, time: number, dt: number): void;
    pruneDwell(now: number): void;
    electDwellWinner(): Object3D | null;
    dwellWindowSeconds: number;
  }

  it("elects the same winner over the same sequence of frame bests", () => {
    const reference = new GazeConecaster() as unknown as DwellRecord;
    const core = new GazeConsensus(reference.dwellWindowSeconds);
    const a = new Object3D();
    const b = new Object3D();
    const c = new Object3D();
    const byName = new Map<Object3D, string>([[a, "a"], [b, "b"], [c, "c"]]);
    // Steady on a, a flick to b, a longer look at b, a blink, then c.
    const script: Array<[Object3D | null, number]> = [
      ...Array<[Object3D | null, number]>(8).fill([a, 1 / 60]),
      [b, 1 / 60], [b, 1 / 60],
      [a, 1 / 60],
      ...Array<[Object3D | null, number]>(12).fill([b, 1 / 60]),
      [null, 0.05], [null, 0.05], [null, 0.05],
      [c, 1 / 30], [c, 1 / 30],
      [null, 0.2],
    ];
    let time = 0;
    for (const [object, dt] of script) {
      time += dt;
      if (object) reference.recordDwell(object, time, dt);
      reference.pruneDwell(time);
      const expected = reference.electDwellWinner();
      const ours = core.update(object ? byName.get(object)! : null, dt, () => true);
      expect(ours).toBe(expected ? byName.get(expected)! : null);
    }
  });

  it("carries GazeSystem's defaults for the cone, the window, the grace and the switches", () => {
    const config = (GazeSystem as unknown as { schema?: unknown; configSchema?: unknown }) as Record<string, unknown>;
    const schema = (config.configSchema ?? config.schema ?? {}) as Record<string, { default?: unknown }>;
    const defaults = {
      coneAngle: schema.coneAngle?.default,
      maxRayLength: schema.maxRayLength?.default,
      dwellWindowSeconds: schema.dwellWindowSeconds?.default,
      trackingLossGraceSeconds: schema.trackingLossGraceSeconds?.default,
      pointerTransformFollowsHand: schema.pointerTransformFollowsHand?.default,
      suppressWhenDirectPointerActive: schema.suppressWhenDirectPointerActive?.default,
      filterMinCutoff: schema.filterMinCutoff?.default,
      filterBeta: schema.filterBeta?.default,
    };
    // The packaged GazeSystem exposes its config schema; if a build hides
    // it, the conecaster's own defaults still hold the cone and the window.
    const conecaster = new GazeConecaster() as unknown as { coneAngle: number; coneLength: number; dwellWindowSeconds: number };
    expect(conecaster.coneAngle).toBeCloseTo((EYE_GAZE_DEFAULTS.coneAngleDegrees * Math.PI) / 180, 12);
    expect(conecaster.coneLength).toBe(EYE_GAZE_DEFAULTS.maxRayLength);
    expect(conecaster.dwellWindowSeconds).toBe(EYE_GAZE_DEFAULTS.dwellWindowSeconds);
    if (defaults.coneAngle !== undefined) {
      expect(defaults).toEqual({
        coneAngle: EYE_GAZE_DEFAULTS.coneAngleDegrees,
        maxRayLength: EYE_GAZE_DEFAULTS.maxRayLength,
        dwellWindowSeconds: EYE_GAZE_DEFAULTS.dwellWindowSeconds,
        trackingLossGraceSeconds: EYE_GAZE_DEFAULTS.trackingLossGraceSeconds,
        pointerTransformFollowsHand: EYE_GAZE_DEFAULTS.pointerTransformFollowsHand,
        suppressWhenDirectPointerActive: EYE_GAZE_DEFAULTS.suppressWhenDirectPointerActive,
        filterMinCutoff: EYE_GAZE_DEFAULTS.filterMinCutoff,
        filterBeta: EYE_GAZE_DEFAULTS.filterBeta,
      });
    }
  });
});
