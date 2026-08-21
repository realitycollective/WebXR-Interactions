import { describe, expect, it } from "vitest";
import {
  DialBehaviour,
  GrabBehaviour,
  HingeBehaviour,
  PressBehaviour,
  PulseBehaviour,
  SlideBehaviour,
  TossScoreBehaviour,
  quatFromAxisAngle,
  type BehaviourContext,
  type InteractionEvent,
  type InteractorInfo,
  type FeedbackIntent,
  type PoseTuple,
} from "@realitycollective/webxr-interactions";
import { FakeTransform } from "./helpers.js";

function ctx(
  transform: FakeTransform | undefined,
  dt = 1 / 60,
  poses: Record<string, PoseTuple> = {},
): { context: BehaviourContext; events: InteractionEvent[]; feedback: FeedbackIntent[] } {
  const events: InteractionEvent[] = [];
  const feedback: FeedbackIntent[] = [];
  const context: BehaviourContext = {
    dt,
    interactableId: "x",
    transform,
    emit: (e) => events.push({ ...e, interactableId: "x" }),
    feedback: (f) => feedback.push({ ...f, interactableId: "x" }),
    getWorldPose: (id) => poses[id],
  };
  return { context, events, feedback };
}

const interactor: InteractorInfo = { id: "hand", kind: "hand", select: 1, squeeze: 0 };

describe("PressBehaviour", () => {
  it("springs toward the pressed depth and emits value changes", () => {
    const press = new PressBehaviour({ axis: [0, 1, 0], travel: 0.04, depthFraction: 0.5 });
    const t = new FakeTransform();
    const { context, events } = ctx(t);
    press.onPressStart(context, interactor);
    for (let i = 0; i < 120; i++) press.update(context);
    expect(t.localOffset[1]).toBeCloseTo(-0.02, 3); // −axis · travel · depth
    expect(events.some((e) => e.type === "valueChanged")).toBe(true);
    press.onPressEnd(context, interactor);
    for (let i = 0; i < 240; i++) press.update(context);
    expect(t.localOffset[1]).toBeCloseTo(0, 3);
  });

  it("latches on alternate presses", () => {
    const press = new PressBehaviour({ latching: true });
    const { context, events } = ctx(new FakeTransform());
    press.onPressStart(context, interactor);
    press.onPressEnd(context, interactor); // no-op when latching
    expect(press.getValue()).toBe(1);
    press.onPressStart(context, interactor);
    expect(press.getValue()).toBe(0);
    expect(events.filter((e) => e.type === "actuated")).toHaveLength(1);
    expect(events.filter((e) => e.type === "released")).toHaveLength(1);
  });
});

describe("PulseBehaviour", () => {
  it("flashes on press and decays to rest", () => {
    const pulse = new PulseBehaviour({ scaleAmount: 0.25, emissiveAmount: 1.5, decayRate: 6 });
    const t = new FakeTransform();
    const { context } = ctx(t, 0.1);
    pulse.onPressStart(context, interactor);
    pulse.update(context);
    expect(t.effect?.scale).toBeGreaterThan(1);
    for (let i = 0; i < 50; i++) pulse.update(context);
    expect(pulse.getValue()).toBe(0);
  });
});

describe("HingeBehaviour", () => {
  it("swings toward the holder's hand and publishes a centred value", () => {
    const hinge = new HingeBehaviour({ axis: [1, 0, 0], restDir: [0, 1, 0], maxAngle: Math.PI / 2 });
    const t = new FakeTransform();
    const { context, events } = ctx(t);
    // swingDir = axis × restDir = [1,0,0]×[0,1,0] = [0,0,1].
    // Hand exactly along +swing → +90°, clamped to maxAngle.
    const holder: InteractorInfo = { ...interactor, indexTip: [0, 0, 1] };
    hinge.onGrabStart(context, holder);
    hinge.update(context, holder);
    expect(hinge.getValue()).toBeCloseTo(1, 5);
    // Hand along rest → 0° → centred 0.5.
    hinge.update(context, { ...holder, indexTip: [0, 1, 0] });
    expect(hinge.getValue()).toBeCloseTo(0.5, 5);
    hinge.onGrabEnd(context, holder);
    // Stays where left.
    hinge.update(context);
    expect(hinge.getValue()).toBeCloseTo(0.5, 5);
    expect(events.some((e) => e.type === "grabStart")).toBe(true);
    expect(events.some((e) => e.type === "grabEnd")).toBe(true);
  });
});

describe("DialBehaviour", () => {
  it("accumulates twist around the axis, clamped to [0, maxAngle]", () => {
    const dial = new DialBehaviour({ axis: [0, 1, 0], maxAngle: Math.PI });
    const t = new FakeTransform();
    const { context } = ctx(t);
    const start: InteractorInfo = { ...interactor, indexTip: [1, 0, 0] };
    dial.onGrabStart(context, start);
    // Rotate the hand 90° about +Y: [1,0,0] → [0,0,-1].
    dial.update(context, { ...start, indexTip: [0, 0, -1] });
    expect(dial.getValue()).toBeCloseTo(0.5, 3);
    // Beyond max clamps.
    dial.update(context, { ...start, indexTip: [-1, 0, 0.001] });
    expect(dial.getValue()).toBeLessThanOrEqual(1);
    dial.onGrabEnd(context, start);
  });
});

describe("SlideBehaviour", () => {
  it("follows the pull while held and springs home on release", () => {
    const slide = new SlideBehaviour({ axis: [0, 1, 0], travel: 0.3 });
    const t = new FakeTransform();
    const { context } = ctx(t);
    const start: InteractorInfo = { ...interactor, indexTip: [0, 0, 0] };
    slide.onGrabStart(context, start);
    // Pull down 0.15 m (−Y is the pull direction for axis +Y).
    slide.update(context, { ...start, indexTip: [0, -0.15, 0] });
    expect(slide.getValue()).toBeCloseTo(0.5, 3);
    expect(t.localOffset[1]).toBeCloseTo(-0.15, 3);
    // Over-pull clamps at travel.
    slide.update(context, { ...start, indexTip: [0, -1, 0] });
    expect(slide.getValue()).toBe(1);
    slide.onGrabEnd(context, start);
    for (let i = 0; i < 600; i++) slide.update(context);
    expect(slide.getValue()).toBeCloseTo(0, 2);
  });
});

describe("GrabBehaviour (poseOnly)", () => {
  it("carries the object with the grip, preserving the grab offset", () => {
    const grab = new GrabBehaviour({}, "poseOnly");
    const t = new FakeTransform();
    t.restPose = { position: [0, 1, -0.5], quaternion: [0, 0, 0, 1] };
    const { context } = ctx(t);
    const holder: InteractorInfo = {
      ...interactor,
      gripPose: { position: [0, 1, -0.4], quaternion: [0, 0, 0, 1] },
    };
    grab.onGrabStart(context, holder);
    const moved: InteractorInfo = {
      ...interactor,
      gripPose: { position: [0.2, 1.3, -0.4], quaternion: [0, 0, 0, 1] },
    };
    grab.update(context, moved);
    expect(t.worldPose?.position[0]).toBeCloseTo(0.2, 5);
    expect(t.worldPose?.position[1]).toBeCloseTo(1.3, 5);
    expect(t.worldPose?.position[2]).toBeCloseTo(-0.5, 5); // offset kept
    grab.onGrabEnd(context, moved);
    expect(grab.getValue()).toBe(0);
  });

  it("native fulfilment never writes the transform", () => {
    const grab = new GrabBehaviour({}, "native");
    const t = new FakeTransform();
    const { context } = ctx(t);
    const holder: InteractorInfo = {
      ...interactor,
      gripPose: { position: [1, 1, 1], quaternion: [0, 0, 0, 1] },
    };
    grab.onGrabStart(context, holder);
    grab.update(context, holder);
    expect(t.worldPose).toBeNull();
  });
});

describe("TossScoreBehaviour", () => {
  it("scores a downward pass inside the ring, ignores outside/upward", () => {
    const toss = new TossScoreBehaviour({ targetIds: ["ball"], radius: 0.2, axis: [0, 1, 0] });
    const hoop = new FakeTransform();
    hoop.restPose = { position: [0, 1.5, -1], quaternion: [0, 0, 0, 1] };

    const poses: Record<string, PoseTuple> = {
      ball: { position: [0, 1.6, -1], quaternion: [0, 0, 0, 1] },
    };
    const { context, events, feedback } = ctx(hoop, 1 / 60, poses);
    toss.update(context); // seed prevAlong (above the plane)
    poses["ball"] = { position: [0.05, 1.4, -1], quaternion: [0, 0, 0, 1] };
    toss.update(context);
    expect(events.some((e) => e.type === "scored")).toBe(true);
    expect(feedback.some((f) => f.cue === "score")).toBe(true);
    expect(toss.getValue()).toBe(1);

    // Upward pass back through: no score.
    poses["ball"] = { position: [0, 1.7, -1], quaternion: [0, 0, 0, 1] };
    toss.update(context);
    expect(toss.getValue()).toBe(1);
  });
});

describe("hinge with a rotated mount", () => {
  it("mount orientation comes from the rest pose, no faceYaw plumbing", () => {
    // Wall mount: rest quaternion turns the local frame 90° about Y.
    const hinge = new HingeBehaviour({ axis: [1, 0, 0], restDir: [0, 0, 1], maxAngle: Math.PI / 3 });
    const t = new FakeTransform();
    t.restPose = { position: [2, 1, 0], quaternion: quatFromAxisAngle([0, 1, 0], Math.PI / 2) };
    const { context } = ctx(t);
    // A world point that lands exactly on local restDir keeps the arm at rest.
    // local [0,0,1] → world = rest.position + rotate([0,0,1], q) = [2+1, 1, 0].
    const holder: InteractorInfo = { ...interactor, indexTip: [3, 1, 0] };
    hinge.onGrabStart(context, holder);
    hinge.update(context, holder);
    expect(hinge.getValue()).toBeCloseTo(0.5, 5);
  });
});
