/**
 * Core cases for the targeting half of the eye-gaze rule: the sphere cone
 * query and the dwell consensus, against IWSDK 1.0.0's `GazeConecaster`.
 */
import { describe, expect, it } from "vitest";
import {
  GAZE_CONE_ANGLE_EPSILON,
  GazeConsensus,
  compareConeHits,
  coneHitForSpheres,
  type RayTuple,
  type SphereTarget,
} from "@realitycollective/webxr-interactions";

const DOWN: RayTuple = { origin: [0, 0, 0], direction: [0, 0, -1] };
const DEG = Math.PI / 180;

function sphere(id: string, center: [number, number, number], radius = 0.1): SphereTarget {
  return { id, center, radius };
}

describe("coneHitForSpheres", () => {
  it("answers null for no targets and for a target outside the cone", () => {
    expect(coneHitForSpheres(DOWN, [], 5 * DEG, 30)).toBeNull();
    expect(coneHitForSpheres(DOWN, [sphere("wide", [1, 0, -2])], 5 * DEG, 30)).toBeNull();
  });

  it("hits a sphere the ray enters at its entry point, angular distance zero", () => {
    const hit = coneHitForSpheres(DOWN, [sphere("on", [0, 0, -2])], 5 * DEG, 30)!;
    expect(hit.interactableId).toBe("on");
    expect(hit.angularDistance).toBe(0);
    expect(hit.distance).toBeCloseTo(1.9, 9);
    expect(hit.point[2]).toBeCloseTo(-1.9, 9);
  });

  it("measures an offset sphere to its silhouette and aims at its nearest point", () => {
    // Centre 2.9 degrees off axis at (0.1, 0, -2) with radius 0.05 subtending
    // about 1.4 degrees: silhouette about 1.5 degrees off, inside a 5 degree cone.
    const hit = coneHitForSpheres(DOWN, [sphere("off", [0.1, 0, -2], 0.05)], 5 * DEG, 30)!;
    expect(hit.interactableId).toBe("off");
    expect(hit.angularDistance).toBeCloseTo(Math.atan2(0.1, 2) - Math.asin(0.05 / Math.hypot(0.1, 2)), 9);
    expect(hit.point[0]).toBeCloseTo(0.05, 9);
    expect(hit.point[2]).toBeCloseTo(-2, 9);
    expect(hit.distance).toBeCloseTo(Math.hypot(0.05, 2), 9);
  });

  it("treats a sphere the origin is inside as on axis, aimed at its centre", () => {
    const hit = coneHitForSpheres(DOWN, [sphere("around", [0.02, 0, 0], 0.5)], 5 * DEG, 30)!;
    expect(hit.angularDistance).toBe(0);
    expect(hit.point).toEqual([0.02, 0, 0]);
  });

  it("skips a target behind the origin, and one beyond the length, entry or silhouette", () => {
    expect(coneHitForSpheres(DOWN, [sphere("behind", [0, 0, 2])], 5 * DEG, 30)).toBeNull();
    expect(coneHitForSpheres(DOWN, [sphere("far", [0, 0, -40])], 5 * DEG, 30)).toBeNull();
    expect(coneHitForSpheres(DOWN, [sphere("far-entry", [0, 0, -30.2])], 5 * DEG, 30)).toBeNull();
    expect(coneHitForSpheres(DOWN, [sphere("far-side", [0.5, 0, -30.05], 0.1)], 5 * DEG, 30)).toBeNull();
  });

  it("prefers the target nearer the axis, and within half a degree the nearer one", () => {
    const targets = [sphere("off", [0.15, 0, -2], 0.05), sphere("on", [0.05, 0, -3], 0.05)];
    expect(coneHitForSpheres(DOWN, targets, 8 * DEG, 30)!.interactableId).toBe("on");
    const tie = [sphere("far", [0, 0, -3]), sphere("near", [0, 0, -1])];
    expect(coneHitForSpheres(DOWN, tie, 5 * DEG, 30)!.interactableId).toBe("near");
    expect(compareConeHits(
      { interactableId: "a", distance: 1, point: [0, 0, 0], angularDistance: 0 },
      { interactableId: "b", distance: 2, point: [0, 0, 0], angularDistance: GAZE_CONE_ANGLE_EPSILON / 2 },
    )).toBeLessThan(0);
  });

  it("aims at the sphere's nearest point when the closest ray point sits on its centre line", () => {
    // Directly behind-then-ahead degenerate: the closest ray point equals the centre.
    const hit = coneHitForSpheres({ origin: [0, 0, 0], direction: [0, 0, -1] }, [sphere("edge", [0, 0, -2], 0)], 5 * DEG, 30);
    expect(hit?.interactableId).toBe("edge");
  });
});

describe("GazeConsensus", () => {
  const always = () => true;

  it("with a zero window, this frame's best wins outright", () => {
    const consensus = new GazeConsensus(0);
    expect(consensus.update("a", 1 / 60, always)).toBe("a");
    expect(consensus.update("b", 1 / 60, always)).toBe("b");
    expect(consensus.update(null, 1 / 60, always)).toBeNull();
  });

  it("holds the target with the most time inside the window against a brief flick", () => {
    const consensus = new GazeConsensus(0.15);
    for (let i = 0; i < 6; i++) consensus.update("a", 1 / 60, always);
    // Two frames on b do not outweigh the four frames of a still in the window.
    expect(consensus.update("b", 1 / 60, always)).toBe("a");
    expect(consensus.update("b", 1 / 60, always)).toBe("a");
    // Until b has the majority of the window.
    for (let i = 0; i < 6; i++) consensus.update("b", 1 / 60, always);
    expect(consensus.update("b", 1 / 60, always)).toBe("b");
  });

  it("forgets after the window with nothing recorded, and skip advances the window too", () => {
    const consensus = new GazeConsensus(0.15);
    consensus.update("a", 1 / 60, always);
    expect(consensus.update(null, 0.1, always)).toBe("a");
    expect(consensus.update(null, 0.1, always)).toBeNull();
    consensus.update("a", 1 / 60, always);
    consensus.skip(0.2);
    expect(consensus.update(null, 1 / 60, always)).toBeNull();
  });

  it("strikes a winner that is no longer available and elects the next", () => {
    const consensus = new GazeConsensus(1);
    consensus.update("a", 0.5, always);
    consensus.update("b", 0.2, always);
    expect(consensus.update("b", 0.1, (id) => id !== "a")).toBe("b");
    expect(consensus.update(null, 0.1, () => false)).toBeNull();
  });

  it("gives a tie to the first recorded, as IWSDK's scan from the ring head does", () => {
    const consensus = new GazeConsensus(1);
    consensus.update("a", 0.1, always);
    expect(consensus.update("b", 0.1, always)).toBe("a");
  });

  it("reset forgets the record", () => {
    const consensus = new GazeConsensus(1);
    consensus.update("a", 0.5, always);
    consensus.reset();
    expect(consensus.update(null, 0.01, always)).toBeNull();
  });
});
