/**
 * The Interactions host conformance kit against the reference host. The
 * reference behaves as a correct host would, so every case passes here; the
 * negative checks show the kit fails a host with the defects it exists for.
 */
import { describe, expect, it } from "vitest";
import { nativeInteractionsHostConformanceCases } from "@realitycollective/native-interactions";
import type { NativeHit } from "@realitycollective/native-interactions";
import { POINTER_DISPLAY_DEFAULTS, type RayTuple, type Vec3Tuple } from "@realitycollective/webxr-input";
import { MemoryPhysicsFacility, type HoldRelease, type PhysicsBodySpec, type PhysicsShapeSpec, type PoseTuple } from "@realitycollective/webxr-interactions";
import { FakeInputHost, ReferenceInteractionHost } from "./helpers.js";

function reference() {
  const input = new FakeInputHost({ presence: true, headPose: true, pointerVisuals: true });
  input.sources = [
    { id: "left-controller", kind: "controller", handedness: "left", select: 0, squeeze: 0 },
    { id: "right-controller", kind: "controller", handedness: "right", select: 0, squeeze: 0 },
  ];
  input.cursorPoints = [[0, 1, -1]];
  input.enterSession();
  const interactions = new ReferenceInteractionHost(input);
  return { input, interactions, testHost: interactions, physics: new MemoryPhysicsFacility() };
}

/** A physics slice that is wrong in one chosen way. */
class DefectivePhysics extends MemoryPhysicsFacility {
  constructor(private readonly defect: "addIgnored" | "suspendIgnored" | "resumeIgnored" | "dropsVelocity" | "removeIgnored" | "noGravity") {
    super();
    if (defect === "noGravity") super.setGravity([0, 0, 0]);
  }

  override addBody(id: string, pose: PoseTuple, body?: PhysicsBodySpec, shape?: PhysicsShapeSpec): void {
    if (this.defect === "addIgnored") return;
    super.addBody(id, pose, body, shape);
  }

  override suspend(id: string): void {
    if (this.defect === "suspendIgnored") return;
    super.suspend(id);
  }

  override resume(id: string, release: HoldRelease): void {
    if (this.defect === "resumeIgnored") return;
    super.resume(id, this.defect === "dropsVelocity" ? { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] } : release);
  }

  override removeBody(id: string): void {
    if (this.defect === "removeIgnored") return;
    super.removeBody(id);
  }
}

/** A host that measures proximity to the centre: the September 2026 defect. */
class CentreDistanceHost extends ReferenceInteractionHost {
  override hitProximity(point: Vec3Tuple, radius: number): NativeHit | null {
    const hit = super.hitProximity(point, radius);
    if (!hit) return null;
    const centre = this.centreOf(hit.targetId) ?? hit.point;
    return { ...hit, distance: Math.hypot(centre[0] - point[0], centre[1] - point[1], centre[2] - point[2]) };
  }
}

/** A host that keeps its own default radius rather than the one it is handed. */
class FixedRadiusHost extends ReferenceInteractionHost {
  override setTargetRadius(): void {}
}

describe("native Interactions host conformance kit, against the reference host", () => {
  const cases = nativeInteractionsHostConformanceCases();

  it("names every case after its family and row, and carries the whole core hit-tester suite", () => {
    for (const hostCase of cases) expect(hostCase.name).toMatch(/^(interactions|input|physics)\//);
    expect(cases.some((c) => c.name.includes("SURFACE"))).toBe(true);
  });

  for (const hostCase of cases) {
    it(hostCase.name, () => hostCase.run(reference()));
  }

  it("fails a host that answers queries with scenery (the floor's bounds around the hand)", async () => {
    // The Pale Signal host answered proximity with any shown mesh: the
    // floor's bounds contain the hand, so no fingertip ever reached a target.
    class AnyMeshHost extends ReferenceInteractionHost {
      override hitProximity(point: Vec3Tuple, radius: number): NativeHit | null {
        for (const [id, mesh] of this.scenery) {
          const surface = Math.max(0, Math.hypot(mesh.position[0] - point[0], mesh.position[1] - point[1], mesh.position[2] - point[2]) - mesh.radius);
          if (surface <= radius) return { targetId: id, distance: surface, point: [...mesh.position] };
        }
        return super.hitProximity(point, radius);
      }
    }
    const setup = reference();
    const anyMesh = new AnyMeshHost(setup.input);
    const scope = cases.find((c) => c.name.includes("scenery enclosing the hand"))!;
    await expect(scope.run({ ...setup, interactions: anyMesh, testHost: anyMesh })).rejects.toThrow(/with only scenery placed, hitProximity answered/);
    const noScenery = { ...setup, testHost: { ...setup.testHost, placeScenery: undefined } as unknown as typeof setup.testHost };
    await expect(scope.run(noScenery)).rejects.toThrow(/no placeScenery/);
  });

  it("fails a host whose ray or cone answers scenery, whose proximity measures the floor, or whose ray stops at scenery", async () => {
    const scope = cases.find((c) => c.name.includes("scenery enclosing the hand"))!;
    class Defective extends ReferenceInteractionHost {
      constructor(input: FakeInputHost, private readonly defect: "ray" | "cone" | "distance" | "blocked" | "proximityBlocked") {
        super(input);
      }
      private sceneryHit(): NativeHit | null {
        const [id, mesh] = [...this.scenery][0] ?? [undefined, undefined];
        return id && mesh ? { targetId: id, distance: 1, point: [...mesh.position] as Vec3Tuple } : null;
      }
      override hitRay(ray: RayTuple): NativeHit | null {
        if (this.defect === "ray" && this.scenery.size > 0 && super.hitRay(ray) === null) return this.sceneryHit();
        // Blocked: scenery in the way stops the ray, so a target behind it is never answered.
        if (this.defect === "blocked" && this.scenery.size > 0) return null;
        return super.hitRay(ray);
      }
      override hitCone(ray: RayTuple, halfAngle: number, maxLength: number): NativeHit | null {
        if (this.defect === "cone" && this.scenery.size > 0 && super.hitCone(ray, halfAngle, maxLength) === null) return this.sceneryHit();
        return super.hitCone(ray, halfAngle, maxLength);
      }
      override hitProximity(point: Vec3Tuple, radius: number): NativeHit | null {
        if (this.defect === "proximityBlocked" && this.scenery.size > 0) return null;
        const hit = super.hitProximity(point, radius);
        if (this.defect === "distance" && hit) return { ...hit, distance: hit.distance + 0.01 };
        return hit;
      }
    }
    const expectations: Array<["ray" | "cone" | "distance" | "blocked" | "proximityBlocked", RegExp]> = [
      ["proximityBlocked", /must reach the target/],
      ["ray", /hitRay answered/],
      ["cone", /hitCone answered/],
      ["distance", /0\.03 within 1 mm/],
      ["blocked", /must answer the target/],
    ];
    for (const [defect, pattern] of expectations) {
      const input = new FakeInputHost({ presence: true, headPose: true, pointerVisuals: true });
      input.enterSession();
      const host = new Defective(input, defect);
      await expect(scope.run({ input, interactions: host, testHost: host })).rejects.toThrow(pattern);
    }
  });

  it("fails a host that reports a hand's analog pinch strength, or a grasp as its squeeze", async () => {
    const strength = reference();
    strength.input.sources = [{ id: "right-hand", kind: "hand", handedness: "right", select: 0.4, squeeze: 0 }];
    const hand = cases.find((c) => c.name.includes("a hand's select is 0 or 1"))!;
    await expect(hand.run(strength)).rejects.toThrow(/reports select 0\.4/);
    const grasp = reference();
    grasp.input.sources = [{ id: "right-hand", kind: "hand", handedness: "right", select: 1, squeeze: 0.6 }];
    await expect(hand.run(grasp)).rejects.toThrow(/reports squeeze 0\.6/);
    const ok = reference();
    ok.input.sources = [{ id: "right-hand", kind: "hand", handedness: "right", select: 1, squeeze: 0 }];
    await expect(hand.run(ok)).resolves.toBeUndefined();
  });

  it("fails a host that applies a pointer display of its own instead of the binding's drawing", async () => {
    const setup = reference();
    setup.input.sources = [
      { id: "right-controller", kind: "controller", handedness: "right", select: 0, squeeze: 0, ray: { origin: [0, 1, 0], direction: [0, 0, -1] }, gripPose: { position: [0, 1, 0], quaternion: [0, 0, 0, 1] } },
    ];
    setup.interactions.placeTarget("far", [0, 1, -2], 0.1);
    const display = cases.find((c) => c.name.includes("the pointer display is the app's"))!;
    await expect(display.run(setup)).resolves.toBeUndefined();
    // A host with "always" of its own: draws the ray whatever it was told.
    const always = new FakeInputHost({ presence: true, pointerVisuals: true });
    always.sources = setup.input.sources;
    always.enterSession();
    const original = always.applyPointerVisuals!;
    always.applyPointerVisuals = (sourceId, visuals) => original(sourceId, { ...visuals, ray: true });
    const stubborn = new ReferenceInteractionHost(always);
    stubborn.placeTarget("far", [0, 1, -2], 0.1);
    await expect(display.run({ input: always, interactions: stubborn, testHost: stubborn })).rejects.toThrow(/still draws a ray|the host draws/);
    const noReadback = { ...setup, testHost: { ...setup.testHost, pointerVisuals: undefined } as unknown as typeof setup.testHost };
    await expect(display.run(noReadback)).rejects.toThrow(/no applyPointerVisuals or no pointerVisuals readback/);
  });

  it("fails a host that draws no cursor on a panel, and one whose discs leave panels out", async () => {
    const visualsCase = cases.find((c) => c.name.includes("exactly as told"))!;
    // A host that keeps a panel cursor off (the old stopgap gone, nothing drawn in its place).
    const noPanel = new FakeInputHost({ presence: true, pointerVisuals: true });
    noPanel.enterSession();
    const original = noPanel.applyPointerVisuals!;
    noPanel.applyPointerVisuals = (sourceId, visuals) => original(sourceId, visuals.targetKind === "panel" ? { ...visuals, cursor: false, cursorPoint: null } : visuals);
    const noPanelHost = new ReferenceInteractionHost(noPanel);
    await expect(visualsCase.run({ input: noPanel, interactions: noPanelHost, testHost: noPanelHost })).rejects.toThrow(/told a cursor on a panel/);
    // A host that records the panel cursor but draws no disc for it.
    const setup = reference();
    class NoPanelDisc extends ReferenceInteractionHost {
      override cursors(): Vec3Tuple[] {
        return super.cursors().filter((point) => point[0] !== 0.2);
      }
    }
    const noDisc = new NoPanelDisc(setup.input);
    await expect(visualsCase.run({ ...setup, interactions: noDisc, testHost: noDisc })).rejects.toThrow(/no cursor disc on the panel/);
  });

  it("fails a host with a ray display of its own (drawn whenever the ray owns the source), a stale display readback, and one that drops a source", async () => {
    const visualsCase = cases.find((c) => c.name.includes("exactly as told"))!;
    const ownMode = new FakeInputHost({ presence: true, pointerVisuals: true });
    ownMode.enterSession();
    const original = ownMode.applyPointerVisuals!;
    ownMode.applyPointerVisuals = (sourceId, visuals) => original(sourceId, visuals.activePointer === "ray" ? { ...visuals, ray: true } : visuals);
    const ownModeHost = new ReferenceInteractionHost(ownMode);
    await expect(visualsCase.run({ input: ownMode, interactions: ownModeHost, testHost: ownModeHost })).rejects.toThrow(/display says never/);

    const display = cases.find((c) => c.name.includes("the pointer display is the app's"))!;
    const stale = reference();
    stale.input.sources = [{ id: "right-controller", kind: "controller", handedness: "right", select: 0, squeeze: 0, ray: { origin: [0, 1, 0], direction: [0, 0, -1] }, gripPose: { position: [0, 1, 0], quaternion: [0, 0, 0, 1] } }];
    stale.input.applyPointerDisplay = () => undefined;
    stale.input.displayReceived = { ...POINTER_DISPLAY_DEFAULTS, ray: "always" };
    await expect(display.run(stale)).rejects.toThrow(/received pointer display/);
    stale.input.displayReceived = undefined;
    await expect(display.run(stale)).rejects.toThrow(/received pointer display undefined/);
    // A host with no display readback is judged on its drawings alone.
    (stale.interactions as { pointerDisplay?: unknown }).pointerDisplay = undefined;
    await expect(display.run(stale)).resolves.toBeUndefined();

    const dropping = new FakeInputHost({ presence: true, pointerVisuals: true });
    dropping.sources = stale.input.sources;
    dropping.enterSession();
    const keep = dropping.applyPointerVisuals!;
    dropping.applyPointerVisuals = (sourceId, visuals) => {
      if (sourceId !== "right-controller") keep(sourceId, visuals);
    };
    const droppingHost = new ReferenceInteractionHost(dropping);
    await expect(display.run({ input: dropping, interactions: droppingHost, testHost: droppingHost })).rejects.toThrow(/the host draws undefined/);
  });

  it("fails a host that measures proximity to the centre", async () => {
    const setup = reference();
    const broken = new CentreDistanceHost(setup.input);
    const surface = cases.find((c) => c.name.includes("SURFACE"))!;
    await expect(surface.run({ ...setup, interactions: broken, testHost: broken })).rejects.toThrow(/got 0\.13/);
  });

  it("fails the near-pointer cases too on a host that measures proximity to the centre", async () => {
    const setup = reference();
    const broken = new CentreDistanceHost(setup.input);
    const touch = cases.find((c) => c.name.includes("presses at 0.02 m"))!;
    await expect(touch.run({ ...setup, interactions: broken, testHost: broken })).rejects.toThrow(/\[interactions\//);
  });

  it("fails a host that ignores the radius it is handed", async () => {
    const setup = reference();
    const broken = new FixedRadiusHost(setup.input);
    const bare = cases.find((c) => c.name.includes("10 cm sphere"))!;
    await expect(bare.run({ ...setup, interactions: broken, testHost: broken })).rejects.toThrow(/0\.1 m radius/);
  });

  it("fails a host with no presence", async () => {
    const setup = reference();
    const input = new FakeInputHost();
    input.enterSession();
    const presence = cases.find((c) => c.name.includes("models only"))!;
    await expect(presence.run({ ...setup, input })).rejects.toThrow(/no applyPresence/);
  });

  it("fails a host that cannot be told what to draw for a pointer", async () => {
    const setup = reference();
    const input = new FakeInputHost({ presence: true });
    input.enterSession();
    const interactions = new ReferenceInteractionHost(input);
    const visuals = cases.find((c) => c.name.includes("exactly as told"))!;
    await expect(visuals.run({ input, interactions, testHost: interactions })).rejects.toThrow(/no applyPointerVisuals/);
    const noReadback = { ...setup, testHost: { ...setup.testHost, pointerVisuals: undefined } as unknown as typeof setup.testHost };
    await expect(visuals.run(noReadback)).rejects.toThrow(/no pointerVisuals readback/);
  });

  it("fails a host that draws a cursor at every ray hit, whatever it is told", async () => {
    const setup = reference();
    const stubborn = new FakeInputHost({ presence: true, pointerVisuals: true });
    stubborn.enterSession();
    const original = stubborn.applyPointerVisuals!;
    stubborn.applyPointerVisuals = (sourceId, visuals) => original(sourceId, { ...visuals, ray: true, cursor: true });
    const interactions = new ReferenceInteractionHost(stubborn);
    const visualsCase = cases.find((c) => c.name.includes("exactly as told"))!;
    await expect(visualsCase.run({ input: stubborn, interactions, testHost: interactions })).rejects.toThrow(/the host draws/);
  });

  it("fails a host that draws no disc where it was told, or keeps the disc after being told to stop", async () => {
    const setup = reference();
    const visualsCase = cases.find((c) => c.name.includes("exactly as told"))!;
    class NoDisc extends ReferenceInteractionHost {
      override cursors(): Vec3Tuple[] {
        return [];
      }
    }
    const noDisc = new NoDisc(setup.input);
    await expect(visualsCase.run({ ...setup, interactions: noDisc, testHost: noDisc })).rejects.toThrow(/no cursor disc/);
    class Sticky extends ReferenceInteractionHost {
      override cursors(): Vec3Tuple[] {
        return [[0, 1, -0.9]];
      }
    }
    const sticky = new Sticky(setup.input);
    await expect(visualsCase.run({ ...setup, interactions: sticky, testHost: sticky })).rejects.toThrow(/still draws/);
    const lateStubborn = new FakeInputHost({ presence: true, pointerVisuals: true });
    lateStubborn.enterSession();
    const original = lateStubborn.applyPointerVisuals!;
    lateStubborn.applyPointerVisuals = (sourceId, visuals) => original(sourceId, visuals.cursor ? visuals : { ...visuals, ray: false });
    const lateHost = new ReferenceInteractionHost(lateStubborn);
    await expect(visualsCase.run({ input: lateStubborn, interactions: lateHost, testHost: lateHost })).rejects.toThrow(/the host draws/);
  });

  it("fails a host with no physics slice, on the suite and on the held-target case", async () => {
    const setup = reference();
    const { physics: _unused, ...withoutPhysics } = setup;
    void _unused;
    const gravity = cases.find((c) => c.name.startsWith("physics/starts with IWSDK"))!;
    await expect(gravity.run(withoutPhysics)).rejects.toThrow(/installs no physics slice/);
    const held = cases.find((c) => c.name.includes("held and released through the physics slice"))!;
    await expect(held.run(withoutPhysics)).rejects.toThrow(/installs no physics slice/);
  });

  it("fails a physics slice that breaks the shared suite, naming the case", async () => {
    const setup = reference();
    const gravity = cases.find((c) => c.name.startsWith("physics/starts with IWSDK"))!;
    await expect(gravity.run({ ...setup, physics: new DefectivePhysics("noGravity") })).rejects.toThrow(/gravity must start at/);
  });

  it("fails a physics slice the binding cannot hold a target through", async () => {
    const setup = reference();
    const held = cases.find((c) => c.name.includes("held and released through the physics slice"))!;
    await expect(held.run({ ...setup, physics: new DefectivePhysics("addIgnored") })).rejects.toThrow(/must add a body/);
    await expect(held.run({ ...setup, physics: new DefectivePhysics("suspendIgnored") })).rejects.toThrow(/must suspend it/);
    await expect(held.run({ ...setup, physics: new DefectivePhysics("resumeIgnored") })).rejects.toThrow(/must resume the body/);
    await expect(held.run({ ...setup, physics: new DefectivePhysics("dropsVelocity") })).rejects.toThrow(/release velocity/);
    await expect(held.run({ ...setup, physics: new DefectivePhysics("removeIgnored") })).rejects.toThrow(/must remove the body/);
  });

  it("fails a host whose cursors vanish with presence", async () => {
    const setup = reference();
    const vanishing = new FakeInputHost({ presence: true });
    vanishing.sources = setup.input.sources;
    vanishing.cursorPoints = [[0, 1, -1]];
    const original = vanishing.applyPresence!;
    vanishing.applyPresence = (side, shown) => {
      original(side, shown);
      if (!shown.hand && !shown.controller) vanishing.cursorPoints = [];
    };
    vanishing.enterSession();
    const interactions = new ReferenceInteractionHost(vanishing);
    const cursorCase = cases.find((c) => c.name.includes("cursors"))!;
    await expect(cursorCase.run({ input: vanishing, interactions, testHost: interactions })).rejects.toThrow(/changed the cursors/);
  });
});

describe("native Interactions host conformance kit, every failure path", () => {
  const cases = nativeInteractionsHostConformanceCases();
  const find = (part: string) => cases.find((c) => c.name.includes(part))!;

  /** An input host whose presence drawing is wrong in a chosen way. */
  function presenceHost(draw: (shown: { hand: boolean; controller: boolean }) => { hand: boolean; controller: boolean }) {
    const input = new FakeInputHost({ presence: true });
    input.sources = [
      { id: "left-controller", kind: "controller", handedness: "left", select: 0, squeeze: 0 },
      { id: "right-controller", kind: "controller", handedness: "right", select: 0, squeeze: 0 },
    ];
    input.applyPresence = (side, shown) => {
      input.shown[side] = draw(shown);
    };
    input.enterSession();
    const interactions = new ReferenceInteractionHost(input);
    return { input, interactions, testHost: interactions };
  }

  it("fails a host that loses the release velocity", async () => {
    const setup = reference();
    class Forgetful extends ReferenceInteractionHost {
      override lastRelease() {
        return undefined;
      }
    }
    const broken = new Forgetful(setup.input);
    await expect(find("hands the host the release velocity").run({ ...setup, interactions: broken, testHost: broken })).rejects.toThrow(/received undefined/);
  });

  it("fails outside a live session", async () => {
    const setup = reference();
    const idle = new FakeInputHost();
    await expect(find("live session").run({ ...setup, input: idle })).rejects.toThrow(/inside a live session/);
  });

  it("fails a host that keeps drawing a hidden side", async () => {
    const setup = presenceHost(() => ({ hand: false, controller: true }));
    await expect(find("models only").run(setup)).rejects.toThrow(/hidden left side still draws/);
  });

  it("fails a host that draws both families on one side", async () => {
    const setup = presenceHost((shown) => (shown.controller ? { hand: true, controller: true } : shown));
    await expect(find("models only").run(setup)).rejects.toThrow(/exactly one family/);
  });

  it('fails a host that shows controllers for "auto" while hands are tracked', async () => {
    const setup = presenceHost((shown) => ({ hand: shown.controller, controller: shown.hand }));
    setup.input.setSources([
      { id: "left-hand", kind: "hand", handedness: "left", select: 0, squeeze: 0 },
      { id: "right-hand", kind: "hand", handedness: "right", select: 0, squeeze: 0 },
    ]);
    await expect(find('"auto"').run(setup)).rejects.toThrow(/hand joints live/);
  });

  it('fails a host that shows the wrong family for "auto"', async () => {
    const setup = presenceHost((shown) => ({ hand: shown.controller, controller: shown.hand }));
    await expect(find('"auto"').run(setup)).rejects.toThrow(/hand joints off/);
  });
});
