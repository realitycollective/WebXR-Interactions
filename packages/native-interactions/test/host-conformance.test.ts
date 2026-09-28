/**
 * The Interactions host conformance kit against the reference host. The
 * reference behaves as a correct host would, so every case passes here; the
 * negative checks show the kit fails a host with the defects it exists for.
 */
import { describe, expect, it } from "vitest";
import { nativeInteractionsHostConformanceCases } from "@realitycollective/native-interactions";
import type { NativeHit } from "@realitycollective/native-interactions";
import type { Vec3Tuple } from "@realitycollective/webxr-input";
import { FakeInputHost, ReferenceInteractionHost } from "./helpers.js";

function reference() {
  const input = new FakeInputHost({ presence: true, headPose: true });
  input.sources = [
    { id: "left-controller", kind: "controller", handedness: "left", select: 0, squeeze: 0 },
    { id: "right-controller", kind: "controller", handedness: "right", select: 0, squeeze: 0 },
  ];
  input.cursorPoints = [[0, 1, -1]];
  input.enterSession();
  const interactions = new ReferenceInteractionHost(input);
  return { input, interactions, testHost: interactions };
}

/** A host that measures proximity to the centre: the September 2026 defect. */
class CentreDistanceHost extends ReferenceInteractionHost {
  override hitProximity(point: Vec3Tuple, radius: number): NativeHit | null {
    const hit = super.hitProximity(point, radius);
    if (!hit) return null;
    return { ...hit, distance: Math.hypot(hit.point[0] - point[0], hit.point[1] - point[1], hit.point[2] - point[2]) };
  }
}

/** A host that keeps its own default radius rather than the one it is handed. */
class FixedRadiusHost extends ReferenceInteractionHost {
  override setTargetRadius(): void {}
}

describe("native Interactions host conformance kit, against the reference host", () => {
  const cases = nativeInteractionsHostConformanceCases();

  it("names every case after its family and row, and carries the whole core hit-tester suite", () => {
    for (const hostCase of cases) expect(hostCase.name).toMatch(/^(interactions|input)\//);
    expect(cases.some((c) => c.name.includes("SURFACE"))).toBe(true);
  });

  for (const hostCase of cases) {
    it(hostCase.name, () => hostCase.run(reference()));
  }

  it("fails a host that measures proximity to the centre", async () => {
    const setup = reference();
    const broken = new CentreDistanceHost(setup.input);
    const surface = cases.find((c) => c.name.includes("SURFACE"))!;
    await expect(surface.run({ ...setup, interactions: broken, testHost: broken })).rejects.toThrow(/got 0\.13/);
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
    await expect(find("release velocity").run({ ...setup, interactions: broken, testHost: broken })).rejects.toThrow(/received undefined/);
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
