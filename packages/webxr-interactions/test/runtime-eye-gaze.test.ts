/**
 * The runtime under eye gaze: the gaze source targets through the cone and
 * the dwell consensus, a near pointer suppresses it, the pinch selects and
 * the pinching hand takes the pointer over, all as IWSDK 1.0.0's
 * `GazePointer` does (see `@realitycollective/webxr-input`'s `eye-gaze.ts`).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  EYE_GAZE_SOURCE_ID,
  InteractionRuntime,
  rayFromPose,
  rayPoseFromRay,
  registerDescriptor,
  type InteractionEvent,
  type InputSourceSnapshot,
  type PoseTuple,
  type RayTuple,
} from "@realitycollective/webxr-interactions";
import { FakeHitTester, FakeProvider, FakeTransform, handSource } from "./helpers.js";

const DT = 1 / 60;
const EYE_RAY: RayTuple = { origin: [0, 1.6, 0], direction: [0, 0, -1] };
const HAND_POSE: PoseTuple = rayPoseFromRay({ origin: [0.2, 1.2, -0.2], direction: [0, 0, -1] });

let provider: FakeProvider;
let hitTester: FakeHitTester;
let runtime: InteractionRuntime;
let events: InteractionEvent[];

function gaze(overrides: Partial<InputSourceSnapshot> = {}): InputSourceSnapshot {
  return { id: EYE_GAZE_SOURCE_ID, kind: "gaze", handedness: "none", select: 0, squeeze: 0, ray: EYE_RAY, ...overrides };
}

/** The gaze snapshot on a frame with no valid pose: no ray at all. */
function blink(overrides: Partial<InputSourceSnapshot> = {}): InputSourceSnapshot {
  const { ray: _ray, ...rest } = gaze(overrides);
  return rest;
}

/** A hand while gaze owns far targeting: no ray, near data only. */
function nearHand(overrides: Partial<InputSourceSnapshot> = {}): InputSourceSnapshot {
  const { ray: _ray, ...hand } = handSource("right-hand", overrides);
  return hand;
}

function make(options: { cone?: boolean; eyeGaze?: ConstructorParameters<typeof InteractionRuntime>[0]["eyeGaze"] } = {}) {
  provider = new FakeProvider();
  provider.setCapabilities({ eyeGaze: true });
  hitTester = new FakeHitTester(options.cone ?? true);
  runtime = new InteractionRuntime({ provider, hitTester, ...(options.eyeGaze ? { eyeGaze: options.eyeGaze } : {}) });
  events = [];
  runtime.onEvent((e) => events.push(e));
  registerDescriptor(
    runtime,
    {
      interactables: [
        { id: "button", behaviours: [{ kind: "press" }] },
        { id: "other", behaviours: [{ kind: "press" }] },
        { id: "gated", behaviours: [{ kind: "press" }], gaze: { required: true } },
      ],
    },
    () => ({ transform: new FakeTransform() }),
  );
}

function types(): string[] {
  return events.map((e) => e.type);
}

describe("eye-gaze targeting", () => {
  beforeEach(() => make());

  it("targets through the cone with IWSDK's angle and length, and hovers as the gaze interactor", () => {
    hitTester.coneTarget = "button";
    provider.sources = [gaze()];
    runtime.update(DT);
    expect(hitTester.lastCone).toEqual({ ray: EYE_RAY, halfAngle: (5 * Math.PI) / 180, maxLength: 30 });
    expect(events).toContainEqual({ type: "hoverEnter", interactableId: "button", interactorId: EYE_GAZE_SOURCE_ID });
    expect(runtime.getState("button")?.gazeHovered).toBe(true);
  });

  it("falls back to hitRay when the tester has no cone", () => {
    make({ cone: false });
    hitTester.rayTarget = "button";
    provider.sources = [gaze()];
    runtime.update(DT);
    expect(runtime.getState("button")?.hovered).toBe(true);
  });

  it("holds the target through the dwell window against a flick to a neighbour", () => {
    hitTester.coneTarget = "button";
    provider.sources = [gaze()];
    for (let i = 0; i < 6; i++) runtime.update(DT);
    hitTester.coneTarget = "other";
    runtime.update(DT);
    expect(runtime.getState("button")?.hovered).toBe(true);
    expect(runtime.getState("other")?.hovered).toBe(false);
    for (let i = 0; i < 8; i++) runtime.update(DT);
    expect(runtime.getState("other")?.hovered).toBe(true);
    expect(runtime.getState("button")?.hovered).toBe(false);
  });

  it("with a zero dwell window the frame's target wins at once", () => {
    make({ eyeGaze: { dwellWindowSeconds: 0 } });
    hitTester.coneTarget = "button";
    provider.sources = [gaze()];
    for (let i = 0; i < 6; i++) runtime.update(DT);
    hitTester.coneTarget = "other";
    runtime.update(DT);
    expect(runtime.getState("other")?.hovered).toBe(true);
  });

  it("targets nothing while a hand's near pointer is on something, and again once it leaves", () => {
    hitTester.coneTarget = "button";
    hitTester.proximityTarget = "other";
    provider.sources = [nearHand(), gaze()];
    runtime.update(DT);
    expect(runtime.getState("button")?.hovered).toBe(false);
    expect(runtime.getState("other")?.hovered).toBe(true);
    hitTester.proximityTarget = null;
    runtime.update(DT);
    expect(runtime.getState("button")?.hovered).toBe(true);
  });

  it("keeps targeting while a near pointer is active when suppression is switched off", () => {
    make({ eyeGaze: { suppressWhenDirectPointerActive: false } });
    hitTester.coneTarget = "button";
    hitTester.proximityTarget = "other";
    provider.sources = [nearHand(), gaze()];
    runtime.update(DT);
    expect(runtime.getState("button")?.hovered).toBe(true);
  });

  it("a grab in progress suppresses gaze too", () => {
    hitTester.coneTarget = "button";
    provider.sources = [nearHand({ nativeGrabbing: true }), gaze()];
    runtime.update(DT);
    expect(runtime.getState("button")?.hovered).toBe(false);
  });

  it("drops the target while the gaze ray is invalid, and the record with it", () => {
    hitTester.coneTarget = "button";
    provider.sources = [gaze()];
    for (let i = 0; i < 6; i++) runtime.update(DT);
    provider.sources = [blink()];
    runtime.update(DT);
    expect(runtime.getState("button")?.hovered).toBe(false);
    hitTester.coneTarget = "other";
    provider.sources = [gaze()];
    runtime.update(DT);
    // No stale votes for "button": the fresh frame wins.
    expect(runtime.getState("other")?.hovered).toBe(true);
  });

  it("ignores a cone answer beyond the length or on a disabled target", () => {
    hitTester.coneTarget = "button";
    runtime.setInteractableEnabled("button", false);
    provider.sources = [gaze()];
    runtime.update(DT);
    expect(runtime.getState("button")?.hovered).toBe(false);
  });

  it("gaze.required is satisfied by the eye gaze", () => {
    hitTester.coneTarget = "gated";
    provider.sources = [gaze()];
    runtime.update(DT);
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: HAND_POSE })];
    runtime.update(DT);
    expect(runtime.getState("gated")?.pressed).toBe(true);
  });
});

describe("eye-gaze selection", () => {
  beforeEach(() => make());

  it("presses the gazed target when the owning hand pinches, and releases when it lets go", () => {
    hitTester.coneTarget = "button";
    provider.sources = [gaze()];
    runtime.update(DT);
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: HAND_POSE })];
    runtime.update(DT);
    expect(types()).toContain("pressStart");
    expect(events.find((e) => e.type === "pressStart")).toMatchObject({ interactableId: "button", interactorId: EYE_GAZE_SOURCE_ID });
    provider.sources = [gaze({ handedness: "none", select: 0 })];
    runtime.update(DT);
    expect(types()).toContain("pressEnd");
  });

  it("aims the pinching hand at the gaze hit and follows the hand from the next frame", () => {
    hitTester.coneTarget = "button";
    hitTester.conePoint = [0, 1.5, -2];
    hitTester.rayTarget = "button"; // the hand's aimed ray reaches the target
    provider.sources = [gaze()];
    runtime.update(DT);
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: HAND_POSE })];
    runtime.update(DT);
    // The press frame carries the eye ray; the hold then follows the hand.
    expect(runtime.getSource(EYE_GAZE_SOURCE_ID)?.ray).toEqual(EYE_RAY);
    runtime.update(DT);
    const followed = runtime.getSource(EYE_GAZE_SOURCE_ID)!.ray!;
    expect(followed.origin).toEqual(HAND_POSE.position);
    // Pointing from the hand at the hit point.
    const expected = [0 - 0.2, 1.5 - 1.2, -2 + 0.2];
    const length = Math.hypot(...expected);
    for (let i = 0; i < 3; i++) expect(followed.direction[i]).toBeCloseTo(expected[i]! / length, 6);
    // Turn the hand: the ray turns with it.
    const turned: PoseTuple = rayPoseFromRay({ origin: [0.3, 1.2, -0.2], direction: [Math.SQRT1_2, 0, -Math.SQRT1_2] });
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: turned })];
    runtime.update(DT);
    const after = runtime.getSource(EYE_GAZE_SOURCE_ID)!.ray!;
    expect(after.origin).toEqual([0.3, 1.2, -0.2]);
    expect(after.direction).not.toEqual(followed.direction);
    // Release: back to the eye ray.
    provider.sources = [gaze({ handedness: "none", select: 0 })];
    runtime.update(DT);
    expect(runtime.getSource(EYE_GAZE_SOURCE_ID)?.ray).toEqual(EYE_RAY);
  });

  it("keeps the selection-time ray when the hand cannot reach the hit, or following is off", () => {
    hitTester.coneTarget = "button";
    hitTester.rayTarget = null; // the aimed ray reaches nothing
    provider.sources = [gaze()];
    runtime.update(DT);
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: HAND_POSE })];
    runtime.update(DT);
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: HAND_POSE, ray: { origin: [1, 1, 1], direction: [0, -1, 0] } })];
    runtime.update(DT);
    expect(runtime.getSource(EYE_GAZE_SOURCE_ID)?.ray).toEqual(EYE_RAY);

    make({ eyeGaze: { pointerTransformFollowsHand: false } });
    hitTester.coneTarget = "button";
    hitTester.rayTarget = "button";
    provider.sources = [gaze()];
    runtime.update(DT);
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: HAND_POSE })];
    runtime.update(DT);
    runtime.update(DT);
    expect(runtime.getSource(EYE_GAZE_SOURCE_ID)?.ray).toEqual(EYE_RAY);
  });

  it("lets onSample listeners see the followed ray", () => {
    hitTester.coneTarget = "button";
    hitTester.rayTarget = "button";
    const seen: RayTuple[] = [];
    runtime.onSample((sources) => {
      const g = sources.find((s) => s.kind === "gaze");
      if (g?.ray) seen.push(g.ray);
    });
    provider.sources = [gaze()];
    runtime.update(DT);
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: HAND_POSE })];
    runtime.update(DT);
    runtime.update(DT);
    expect(seen[2]!.origin).toEqual(HAND_POSE.position);
  });

  it("a pinch with nothing gazed presses nothing, and a hold with no selector pose stays on the eye ray", () => {
    provider.sources = [gaze()];
    runtime.update(DT);
    provider.sources = [gaze({ handedness: "right", select: 1 })];
    runtime.update(DT);
    expect(types()).not.toContain("pressStart");
    hitTester.coneTarget = "button";
    provider.sources = [gaze({ handedness: "none", select: 0 })];
    runtime.update(DT);
    provider.sources = [gaze({ handedness: "right", select: 1 })];
    runtime.update(DT);
    runtime.update(DT);
    expect(runtime.getSource(EYE_GAZE_SOURCE_ID)?.ray).toEqual(EYE_RAY);
  });

  it("a hold whose gaze ray was invalid at selection keeps no ray to follow", () => {
    hitTester.coneTarget = "button";
    provider.sources = [gaze()];
    runtime.update(DT);
    // Pinch on a blink: the target from the record still presses, with no ray to hold.
    provider.sources = [blink({ handedness: "right", select: 1, selectorPose: HAND_POSE })];
    runtime.update(DT);
    runtime.update(DT);
    expect(runtime.getSource(EYE_GAZE_SOURCE_ID)?.ray).toBeUndefined();
  });

  it("ends the hold and forgets the record when the gaze source goes away", () => {
    hitTester.coneTarget = "button";
    hitTester.rayTarget = "button";
    provider.sources = [gaze()];
    runtime.update(DT);
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: HAND_POSE })];
    runtime.update(DT);
    provider.sources = [handSource("right-hand")];
    runtime.update(DT);
    expect(types()).toContain("pressEnd");
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: HAND_POSE })];
    runtime.update(DT);
    expect(runtime.getSource(EYE_GAZE_SOURCE_ID)?.ray).toEqual(EYE_RAY);
  });

  it("a pinch on a grab-only target grabs it through the gaze", () => {
    registerDescriptor(runtime, { interactables: [{ id: "ball", behaviours: [{ kind: "grab" }] }] }, () => ({ transform: new FakeTransform() }));
    hitTester.coneTarget = "ball";
    provider.sources = [gaze()];
    runtime.update(DT);
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: HAND_POSE })];
    runtime.update(DT);
    expect(runtime.getState("ball")?.grabbed).toBe(true);
  });

  it("a provider hint for the gaze source wins over the cone", () => {
    hitTester.coneTarget = "button";
    provider.hints = [{ sourceId: EYE_GAZE_SOURCE_ID, targetId: "other", state: "hover" }];
    provider.sources = [gaze()];
    runtime.update(DT);
    expect(runtime.getState("other")?.hovered).toBe(true);
  });

  it("without the eyeGaze capability a gaze-kind source targets by plain ray as head gaze does", () => {
    provider.setCapabilities({ eyeGaze: false });
    hitTester.rayTarget = "button";
    hitTester.coneTarget = "other";
    provider.sources = [gaze()];
    runtime.update(DT);
    expect(runtime.getState("button")?.gazeHovered).toBe(true);
    expect(runtime.getState("other")?.hovered).toBe(false);
  });

  it("rayFromPose and rayPoseFromRay are re-exported for adapters", () => {
    expect(rayFromPose(HAND_POSE).origin).toEqual(HAND_POSE.position);
  });
});
