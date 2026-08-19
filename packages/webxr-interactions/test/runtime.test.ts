import { beforeEach, describe, expect, it } from "vitest";
import {
  InteractionRuntime,
  registerDescriptor,
  type InteractionEvent,
  type FeedbackIntent,
  type PressBehaviour,
} from "@realitycollective/webxr-interactions";
import { FakeHitTester, FakeProvider, FakeTransform, handSource, raySource } from "./helpers.js";

let provider: FakeProvider;
let hitTester: FakeHitTester;
let runtime: InteractionRuntime;
let events: InteractionEvent[];
let feedback: FeedbackIntent[];

function make(dwell?: boolean, gazeRequired?: boolean) {
  provider = new FakeProvider();
  hitTester = new FakeHitTester();
  runtime = new InteractionRuntime({ provider, hitTester });
  events = [];
  feedback = [];
  runtime.onEvent((e) => events.push(e));
  runtime.onFeedback((f) => feedback.push(f));
  const gaze = {
    ...(gazeRequired ? { required: true } : {}),
    ...(dwell ? { dwell: { holdSeconds: 1, decayFactor: 2, rearmBelow: 0.1 } } : {}),
  };
  registerDescriptor(
    runtime,
    {
      interactables: [
        {
          id: "button",
          behaviours: [{ kind: "press" }, { kind: "pulse" }],
          ...(dwell || gazeRequired ? { gaze } : {}),
        },
        { id: "handle", behaviours: [{ kind: "slide", travel: 0.3 }] },
      ],
    },
    () => ({ transform: new FakeTransform() }),
  );
}

function types(): string[] {
  return events.map((e) => e.type);
}

describe("hover + press via ray", () => {
  beforeEach(() => make());

  it("hovers, presses on select rise, releases on fall, with hysteresis", () => {
    hitTester.rayTarget = "button";
    provider.sources = [raySource("right", { select: 0 })];
    runtime.update(1 / 60);
    expect(types()).toContain("hoverEnter");

    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    expect(types()).toContain("pressStart");
    expect(types()).toContain("actuated");
    expect(runtime.getState("button")?.pressed).toBe(true);

    // Mid-band: still held (hysteresis).
    provider.sources = [raySource("right", { select: 0.5 })];
    runtime.update(1 / 60);
    expect(types()).not.toContain("pressEnd");

    provider.sources = [raySource("right", { select: 0 })];
    runtime.update(1 / 60);
    expect(types()).toContain("pressEnd");
    expect(types()).toContain("released");
    expect(runtime.getState("button")?.pressed).toBe(false);
  });

  it("press routed to the pressed target even if the pointer drifts off", () => {
    hitTester.rayTarget = "button";
    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    hitTester.rayTarget = null;
    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    provider.sources = [raySource("right", { select: 0 })];
    runtime.update(1 / 60);
    const pressEnd = events.find((e) => e.type === "pressEnd");
    expect(pressEnd?.interactableId).toBe("button");
  });

  it("a vanished source force-releases its holds", () => {
    hitTester.rayTarget = "button";
    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    provider.sources = [];
    runtime.update(1 / 60);
    expect(types()).toContain("pressEnd");
  });

  it("emits actuate feedback with the pressing source", () => {
    hitTester.rayTarget = "button";
    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    const actuate = feedback.find((f) => f.cue === "actuate");
    expect(actuate?.sourceId).toBe("right");
    expect(actuate?.interactableId).toBe("button");
  });
});

describe("poke priority and grab", () => {
  beforeEach(() => make());

  it("poke target beats ray target", () => {
    hitTester.rayTarget = "button";
    hitTester.proximityTarget = "handle";
    provider.sources = [handSource("right-hand")];
    runtime.update(1 / 60);
    const enter = events.filter((e) => e.type === "hoverEnter").map((e) => e.interactableId);
    expect(enter).toContain("handle");
  });

  it("hand pinch on a grab-only target grabs instead of pressing", () => {
    hitTester.proximityTarget = "handle";
    provider.sources = [handSource("right-hand", { select: 1 })];
    runtime.update(1 / 60);
    expect(types()).toContain("grabStart");
    expect(types()).not.toContain("pressStart");
    expect(runtime.getState("handle")?.grabbed).toBe(true);

    provider.sources = [handSource("right-hand", { select: 0 })];
    runtime.update(1 / 60);
    expect(types()).toContain("grabEnd");
    expect(runtime.getState("handle")?.grabbed).toBe(false);
  });

  it("controller squeeze grabs; trigger does not grab a grab-only target", () => {
    hitTester.rayTarget = "handle";
    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    expect(types()).not.toContain("grabStart");

    provider.sources = [raySource("right", { squeeze: 1 })];
    runtime.update(1 / 60);
    expect(types()).toContain("grabStart");
  });

  it("only one holder at a time", () => {
    hitTester.proximityTarget = "handle";
    provider.sources = [
      handSource("a", { select: 1 }),
      handSource("b", { select: 1 }),
    ];
    runtime.update(1 / 60);
    const grabs = events.filter((e) => e.type === "grabStart");
    expect(grabs).toHaveLength(1);
  });
});

describe("provider hints (native targeting)", () => {
  beforeEach(() => make());

  it("hints steer targeting and native grab without signals", () => {
    provider.sources = [raySource("right", { nativeGrabbing: true })];
    provider.hints = [{ sourceId: "right", targetId: "handle", state: "grab" }];
    runtime.update(1 / 60);
    expect(types()).toContain("grabStart");
    expect(runtime.getState("handle")?.grabbed).toBe(true);

    provider.hints = [];
    provider.sources = [raySource("right")];
    runtime.update(1 / 60);
    expect(types()).toContain("grabEnd");
  });

  it("press hints press without a select signal", () => {
    provider.sources = [raySource("right")];
    provider.hints = [{ sourceId: "right", targetId: "button", state: "press" }];
    runtime.update(1 / 60);
    expect(types()).toContain("pressStart");
  });
});

describe("gaze", () => {
  it("dwell fills, fires a synthesized click, then re-arms", () => {
    make(true);
    hitTester.rayTarget = "button"; // head-gaze ray resolves via hit tester
    provider.sources = [];
    runtime.update(0.5);
    expect(runtime.getState("button")?.dwell).toBeCloseTo(0.5, 5);
    expect(types()).toContain("dwellProgress");

    runtime.update(0.6); // crosses 1 → fires
    expect(types()).toContain("pressStart");
    expect(types()).toContain("pressEnd");
    expect(feedback.some((f) => f.cue === "dwellComplete")).toBe(true);
    expect(runtime.getState("button")?.dwell).toBe(0);

    // Still gazing: must not refire until re-armed (progress stays clamped
    // by the fired latch until it drops below rearmBelow - here it refills
    // from 0 while armed=false only after falling below 0.1, which it is).
    events = [];
    runtime.update(0.05);
    expect(types()).not.toContain("pressStart");
  });

  it("gaze.required gates non-gaze presses", () => {
    make(false, true);
    hitTester.rayTarget = "button";
    // Head gaze points elsewhere: disable via a null gaze hit is impossible
    // with one shared tester, so point the head away by removing headPose.
    provider.setCapabilities({ headPose: false });
    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    expect(types()).not.toContain("pressStart");

    // Restore gaze; now the press lands.
    provider.setCapabilities({ headPose: true });
    provider.sources = [raySource("right", { select: 0 })];
    runtime.update(1 / 60); // gaze hover registers
    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    expect(types()).toContain("pressStart");
  });
});

describe("capability negotiation", () => {
  beforeEach(() => make());

  it("disables grab-family behaviours when grabs drop to none, visibly", () => {
    provider.setCapabilities({ grabs: "none" });
    const disabled = events.find((e) => e.type === "behaviourDisabled");
    expect(disabled?.interactableId).toBe("handle");
    expect(disabled?.behaviourKind).toBe("slide");
    expect(disabled?.reason).toContain("grabs");

    provider.setCapabilities({ grabs: "poseOnly" });
    expect(types()).toContain("behaviourEnabled");
  });

  it("press survives with only pointer2d available", () => {
    provider.setCapabilities({
      rays: false,
      pokes: false,
      grabs: "none",
      handJoints: false,
      pinch: false,
      pointer2d: true,
    });
    const pressDisabled = events.find(
      (e) => e.type === "behaviourDisabled" && e.behaviourKind === "press",
    );
    expect(pressDisabled).toBeUndefined();
  });
});

describe("lifecycle", () => {
  beforeEach(() => make());

  it("disabling an interactable releases holds and stops targeting", () => {
    hitTester.rayTarget = "button";
    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    runtime.setInteractableEnabled("button", false);
    expect(types()).toContain("pressEnd");
    expect(types()).toContain("interactableDisabled");

    events = [];
    provider.sources = [raySource("right", { select: 0 })];
    runtime.update(1 / 60);
    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    expect(types()).not.toContain("pressStart");
  });

  it("unregister removes; re-register works; duplicate ids throw", () => {
    runtime.unregisterInteractable("button");
    expect(runtime.getState("button")).toBeUndefined();
    runtime.registerInteractable({ id: "button", behaviours: [{ kind: "press" }] });
    expect(runtime.getState("button")).toBeDefined();
    expect(() =>
      runtime.registerInteractable({ id: "button", behaviours: [] }),
    ).toThrow(/already registered/);
  });

  it("latching press is reachable from data", () => {
    runtime.registerInteractable({
      id: "toggle",
      behaviours: [{ kind: "press", latching: true }],
    });
    hitTester.rayTarget = "toggle";
    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    provider.sources = [raySource("right", { select: 0 })];
    runtime.update(1 / 60);
    // Latched: value stays 1 after release.
    expect(runtime.getState("toggle")?.value).toBe(1);
    const press = runtime.getBehaviour<PressBehaviour>("toggle", "press");
    expect(press?.isLatched).toBe(true);
  });
});
