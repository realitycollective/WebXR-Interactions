/**
 * The near-pointer rule (`src/near-pointer.ts`): the touch machine, the
 * priority pick, the visuals, and the shipped `nearPointerContractCases()`
 * suite run against a correct sphere tester and, one defect at a time,
 * against testers built to break each case.
 */
import { describe, expect, it } from "vitest";
import type { RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  InteractionRuntime,
  NEAR_POINTER_DEFAULTS,
  POINTER_PRIORITY,
  TouchPointerState,
  nearPointerContractCases,
  pickActivePointer,
  pointerVisualsFor,
  resolveNearPointerOptions,
  type HitTester,
  type HitTesterContractSubject,
  type InteractableHit,
  type PointerVisuals,
} from "../src/index.js";
import { FakeHitTester, FakeProvider, handSource, raySource } from "./helpers.js";

const D = NEAR_POINTER_DEFAULTS;

describe("TouchPointerState", () => {
  it("hovers within enter, keeps hovering until exit, presses at down from outside, releases on the way out", () => {
    const touch = new TouchPointerState();
    expect(touch.update(0.3, D.touchHoverEnter, D.touchHoverExit, D.touchDown).hovering).toBe(false);
    expect(touch.update(0.14, D.touchHoverEnter, D.touchHoverExit, D.touchDown)).toEqual({ hovering: true, pressed: false, pressStarted: false, pressEnded: false });
    expect(touch.update(0.17, D.touchHoverEnter, D.touchHoverExit, D.touchDown).hovering).toBe(true);
    expect(touch.update(0.02, D.touchHoverEnter, D.touchHoverExit, D.touchDown)).toEqual({ hovering: true, pressed: true, pressStarted: true, pressEnded: false });
    expect(touch.isPressed).toBe(true);
    expect(touch.update(0.0, D.touchHoverEnter, D.touchHoverExit, D.touchDown)).toEqual({ hovering: true, pressed: true, pressStarted: false, pressEnded: false });
    expect(touch.update(0.021, D.touchHoverEnter, D.touchHoverExit, D.touchDown)).toEqual({ hovering: true, pressed: false, pressStarted: false, pressEnded: true });
    expect(touch.update(0.21, D.touchHoverEnter, D.touchHoverExit, D.touchDown)).toEqual({ hovering: false, pressed: false, pressStarted: false, pressEnded: false });
    expect(touch.isHovering).toBe(false);
  });

  it("never presses from inside the band until the fingertip has been outside it", () => {
    const touch = new TouchPointerState();
    expect(touch.update(0.01, D.touchHoverEnter, D.touchHoverExit, D.touchDown).pressed).toBe(false);
    expect(touch.update(0.0, D.touchHoverEnter, D.touchHoverExit, D.touchDown).pressed).toBe(false);
    expect(touch.update(0.05, D.touchHoverEnter, D.touchHoverExit, D.touchDown).pressed).toBe(false);
    expect(touch.update(0.01, D.touchHoverEnter, D.touchHoverExit, D.touchDown).pressStarted).toBe(true);
  });

  it("losing contact while pressed ends the press and disarms", () => {
    const touch = new TouchPointerState();
    touch.update(0.1, D.touchHoverEnter, D.touchHoverExit, D.touchDown);
    touch.update(0.01, D.touchHoverEnter, D.touchHoverExit, D.touchDown);
    expect(touch.update(null, D.touchHoverEnter, D.touchHoverExit, D.touchDown)).toEqual({ hovering: false, pressed: false, pressStarted: false, pressEnded: true });
    expect(touch.update(0.01, D.touchHoverEnter, D.touchHoverExit, D.touchDown).pressed).toBe(false);
    touch.update(0.1, D.touchHoverEnter, D.touchHoverExit, D.touchDown);
    touch.update(0.01, D.touchHoverEnter, D.touchHoverExit, D.touchDown);
    expect(touch.isPressed).toBe(true);
    touch.reset();
    expect(touch.isPressed).toBe(false);
    expect(touch.isHovering).toBe(false);
  });
});

describe("pickActivePointer and pointerVisualsFor", () => {
  it("picks touch, then grab, then ray, and nothing without a candidate", () => {
    expect(POINTER_PRIORITY).toEqual(["touch", "grab", "ray"]);
    expect(pickActivePointer({ touch: true, grab: true, ray: true }, null, false)).toBe("touch");
    expect(pickActivePointer({ touch: false, grab: true, ray: true }, null, false)).toBe("grab");
    expect(pickActivePointer({ touch: false, grab: false, ray: true }, null, false)).toBe("ray");
    expect(pickActivePointer({ touch: false, grab: false, ray: false }, "ray", false)).toBeNull();
  });

  it("keeps the current pointer while it is selecting, and picks afresh when nothing is current", () => {
    expect(pickActivePointer({ touch: true, grab: false, ray: true }, "ray", true)).toBe("ray");
    expect(pickActivePointer({ touch: true, grab: false, ray: true }, null, true)).toBe("touch");
  });

  it("shows the ray only while the ray or nothing owns the source, and the cursor only with a candidate", () => {
    const point: Vec3Tuple = [0, 1, -1];
    expect(pointerVisualsFor("s", true, "ray", { targetId: "t", point, distance: 1 })).toEqual({ sourceId: "s", activePointer: "ray", ray: true, cursor: true, cursorPoint: point });
    expect(pointerVisualsFor("s", true, null, null)).toEqual({ sourceId: "s", activePointer: null, ray: true, cursor: false, cursorPoint: null });
    expect(pointerVisualsFor("s", true, "touch", { targetId: "t", point, distance: 0 }).ray).toBe(false);
    expect(pointerVisualsFor("s", false, null, null).ray).toBe(false);
    expect(pointerVisualsFor("s", true, "grab", null).cursor).toBe(false);
  });

  it("resolves the defaults and rejects a nonsense band", () => {
    expect(resolveNearPointerOptions()).toEqual(D);
    expect(resolveNearPointerOptions({ touchDown: 0.03 }).touchDown).toBe(0.03);
    expect(() => resolveNearPointerOptions({ touchHoverExit: 0.1 })).toThrow(/touchHoverExit/);
    expect(() => resolveNearPointerOptions({ grabRadius: -1 })).toThrow(/>= 0/);
  });
});

describe("runtime publication", () => {
  it("publishes the active pointer and visuals per source each frame, and forgets a vanished source", () => {
    const provider = new FakeProvider();
    const hitTester = new FakeHitTester();
    const runtime = new InteractionRuntime({ provider, hitTester });
    runtime.registerInteractable({ id: "button", behaviours: [{ kind: "press" }] });
    const published: PointerVisuals[][] = [];
    runtime.onPointerVisuals((visuals) => published.push([...visuals]));

    hitTester.rayTarget = "button";
    provider.sources = [raySource("right")];
    runtime.update(1 / 60);
    expect(runtime.getActivePointer("right")).toBe("ray");
    expect(runtime.getPointerVisuals("right")).toEqual({ sourceId: "right", activePointer: "ray", ray: true, cursor: true, cursorPoint: [0, 0, 0] });
    expect(published).toHaveLength(1);

    // A fingertip 1 cm from the surface: touch owns the hand, ray hidden, no press yet (never from inside).
    hitTester.proximityTarget = "button";
    hitTester.proximityDistance = 0.01;
    provider.sources = [handSource("right-hand")];
    runtime.update(1 / 60);
    expect(runtime.getActivePointer("right-hand")).toBe("touch");
    expect(runtime.getPointerVisuals("right-hand")?.ray).toBe(false);
    expect(runtime.getState("button")?.pressed).toBe(false);
    // Out of the band and back in: the press lands without any select.
    hitTester.proximityDistance = 0.05;
    runtime.update(1 / 60);
    hitTester.proximityDistance = 0.01;
    runtime.update(1 / 60);
    expect(runtime.getState("button")?.pressed).toBe(true);

    expect(runtime.getActivePointer("right")).toBeNull();
    expect(runtime.getPointerVisuals("right")).toBeUndefined();
    expect(runtime.getNearPointerOptions()).toEqual(D);
    runtime.dispose();
    expect(runtime.getPointerVisuals("right-hand")).toBeUndefined();
  });

  it("an eye-gaze source is owned by the gaze pointer with the cursor at the gaze hit", () => {
    const provider = new FakeProvider();
    provider.setCapabilities({ eyeGaze: true });
    const hitTester = new FakeHitTester(true);
    const runtime = new InteractionRuntime({ provider, hitTester });
    runtime.registerInteractable({ id: "button", behaviours: [{ kind: "press" }] });
    hitTester.coneTarget = "button";
    provider.sources = [{ id: "gaze", kind: "gaze", handedness: "none", ray: { origin: [0, 1.6, 0], direction: [0, 0, -1] }, select: 0, squeeze: 0 }];
    runtime.update(1 / 60);
    expect(runtime.getActivePointer("gaze")).toBe("gaze");
    const visuals = runtime.getPointerVisuals("gaze");
    expect(visuals?.ray).toBe(false);
    expect(visuals?.cursor).toBe(true);
    expect(visuals?.cursorPoint).toEqual([0, 1.5, -2]);
    // A hint on the gaze source names the target outright.
    provider.hints = [{ sourceId: "gaze", targetId: "button", state: "press" }];
    runtime.update(1 / 60);
    expect(runtime.getState("button")?.pressed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The shipped suite, against a correct sphere tester and against defects.
// ---------------------------------------------------------------------------

interface SphereDefects {
  /** hitProximity reports the distance to the centre, not the surface. */
  centreDistance?: boolean;
  /** hitProximity finds a target however far away the point is. */
  greedyProximity?: boolean;
  /** hitProximity never finds anything. */
  blindProximity?: boolean;
  /** hitRay answers whichever way the ray points. */
  ignoresDirection?: boolean;
}

class SphereTester implements HitTester {
  private readonly targets = new Map<string, { position: Vec3Tuple; radius: number }>();

  constructor(private readonly defects: SphereDefects = {}) {}

  place(id: string, position: Vec3Tuple, radius: number): void {
    this.targets.set(id, { position, radius });
  }

  hitRay(ray: RayTuple): InteractableHit | null {
    let best: InteractableHit | null = null;
    for (const [id, target] of this.targets) {
      const t =
        (target.position[0] - ray.origin[0]) * ray.direction[0] +
        (target.position[1] - ray.origin[1]) * ray.direction[1] +
        (target.position[2] - ray.origin[2]) * ray.direction[2];
      if (t <= 0 && !this.defects.ignoresDirection) continue;
      const closest: Vec3Tuple = [ray.origin[0] + ray.direction[0] * t, ray.origin[1] + ray.direction[1] * t, ray.origin[2] + ray.direction[2] * t];
      if (Math.hypot(closest[0] - target.position[0], closest[1] - target.position[1], closest[2] - target.position[2]) > target.radius) continue;
      if (!best || Math.abs(t) < best.distance) {
        best = { interactableId: id, distance: Math.abs(t), point: [target.position[0], target.position[1], target.position[2] + target.radius] };
      }
    }
    return best;
  }

  hitProximity(point: Vec3Tuple, radius: number): InteractableHit | null {
    if (this.defects.blindProximity) return null;
    let best: InteractableHit | null = null;
    for (const [id, target] of this.targets) {
      const centre = Math.hypot(point[0] - target.position[0], point[1] - target.position[1], point[2] - target.position[2]);
      const surface = Math.max(0, centre - target.radius);
      if (surface > radius && !this.defects.greedyProximity) continue;
      const distance = this.defects.centreDistance ? centre : surface;
      if (!best || distance < best.distance) {
        best = { interactableId: id, distance, point: [target.position[0], target.position[1], target.position[2] + target.radius] };
      }
    }
    return best;
  }
}

function subject(defects: SphereDefects = {}): HitTesterContractSubject {
  const tester = new SphereTester(defects);
  return { hitTester: tester, driver: { place: (id, position, radius) => tester.place(id, position, radius) } };
}

describe("nearPointerContractCases", () => {
  for (const contractCase of nearPointerContractCases()) {
    it(`passes on a correct sphere tester: ${contractCase.name}`, () => {
      expect(() => contractCase.run(subject())).not.toThrow();
    });
  }

  const defects: Array<[string, SphereDefects, string]> = [
    ["centre distance instead of surface distance", { centreDistance: true }, "the active pointer must be touch"],
    ["a greedy proximity query", { greedyProximity: true }, "at 0.3 m"],
    ["a blind proximity query", { blindProximity: true }, "inside the hover enter distance"],
    ["a ray that ignores its direction", { ignoresDirection: true }, "nothing on the target"],
  ];
  for (const [label, config, expectedMessage] of defects) {
    it(`fails a tester with ${label}`, () => {
      const failures = nearPointerContractCases()
        .map((contractCase) => {
          try {
            contractCase.run(subject(config));
            return null;
          } catch (error) {
            return (error as Error).message;
          }
        })
        .filter((message): message is string => message !== null);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.join("\n")).toContain(expectedMessage);
    });
  }
});
