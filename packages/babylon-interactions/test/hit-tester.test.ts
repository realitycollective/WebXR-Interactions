import { describe, expect, it } from "vitest";
import {
  BabylonHitTester,
  type BabylonPickResult,
  type BabylonPickWithRay,
} from "@realitycollective/babylon-interactions";
import { BARE_PARENT, FakeNode } from "./helpers.js";

const FORWARD = { origin: [0, 0, 0] as [number, number, number], direction: [0, 0, 1] as [number, number, number] };

describe("BabylonHitTester sphere test", () => {
  it("returns the nearest node the ray passes through", () => {
    const tester = new BabylonHitTester({ defaultRadius: 0.5 });
    tester.register("far", new FakeNode({ absolutePosition: [0, 0, 5] }));
    tester.register("near", new FakeNode({ absolutePosition: [0, 0, 2] }));

    const hit = tester.hitRay(FORWARD);
    expect(hit?.interactableId).toBe("near");
    expect(hit?.distance).toBeCloseTo(2);
    expect(hit?.point).toEqual([0, 0, 2]);
  });

  it("misses what is behind the ray or outside the radius", () => {
    const tester = new BabylonHitTester({ defaultRadius: 0.5 });
    tester.register("behind", new FakeNode({ absolutePosition: [0, 0, -2] }));
    tester.register("aside", new FakeNode({ absolutePosition: [3, 0, 2] }));
    expect(tester.hitRay(FORWARD)).toBeNull();
  });

  it("honours a per-node radius", () => {
    const tester = new BabylonHitTester({ defaultRadius: 0.1 });
    tester.register("wide", new FakeNode({ absolutePosition: [0.4, 0, 2] }), 0.5);
    expect(tester.hitRay(FORWARD)?.interactableId).toBe("wide");
  });

  it("skips a node the app hid or disabled", () => {
    const tester = new BabylonHitTester({ defaultRadius: 0.5 });
    tester.register("hidden", new FakeNode({ absolutePosition: [0, 0, 2], isVisible: false }));
    tester.register("off", new FakeNode({ absolutePosition: [0, 0, 3], enabled: false }));
    expect(tester.hitRay(FORWARD)).toBeNull();
    expect(tester.hitProximity([0, 0, 2], 1)).toBeNull();
  });

  it("finds the nearest node to a proximity probe, never reporting a negative distance", () => {
    const tester = new BabylonHitTester({ defaultRadius: 0.1 });
    tester.register("far", new FakeNode({ absolutePosition: [0, 0, 0.5] }));
    tester.register("touching", new FakeNode({ absolutePosition: [0, 0, 0.02] }));

    const hit = tester.hitProximity([0, 0, 0], 0.3);
    expect(hit?.interactableId).toBe("touching");
    expect(hit?.distance).toBe(0);
    expect(hit?.point).toEqual([0, 0, 0.02]);
    expect(tester.hitProximity([0, 0, 5], 0.1)).toBeNull();
  });

  it("registers, replaces and unregisters", () => {
    const tester = new BabylonHitTester();
    const first = new FakeNode({ absolutePosition: [0, 0, 1] });
    const second = new FakeNode({ absolutePosition: [0, 0, 2] });
    tester.register("panel", first);
    tester.register("panel", second);
    expect(tester.getNode("panel")).toBe(second);
    expect(tester.hitProximity([0, 0, 1], 0.5)).toBeNull();

    tester.unregister("panel");
    expect(tester.getNode("panel")).toBeUndefined();
    expect(tester.hitRay(FORWARD)).toBeNull();
    // Unregistering an id that was never registered is a no-op.
    expect(() => tester.unregister("nothing")).not.toThrow();
  });
});

describe("BabylonHitTester with an app-supplied pick", () => {
  function pickReturning(result: BabylonPickResult | null) {
    const calls: number[] = [];
    const pick: BabylonPickWithRay = (_origin, _direction, maxDistance) => {
      calls.push(maxDistance);
      return result;
    };
    return { calls, pick };
  }

  it("maps a picked child mesh back to the registered root", () => {
    const root = new FakeNode({ absolutePosition: [0, 0, 4] });
    const child = new FakeNode({ parent: root });
    const { calls, pick } = pickReturning({ mesh: child, distance: 4.2, point: [0, 0.1, 4] });
    const tester = new BabylonHitTester({ pickWithRay: pick, maxRayDistance: 30 });
    tester.register("lever", root);

    const hit = tester.hitRay(FORWARD);
    expect(hit).toEqual({ interactableId: "lever", distance: 4.2, point: [0, 0.1, 4] });
    expect(calls).toEqual([30]);
  });

  it("stops at a mesh the ray reached first even when it is not an interactable", () => {
    const { pick } = pickReturning({ mesh: new FakeNode(), distance: 1, point: [0, 0, 1] });
    const tester = new BabylonHitTester({ pickWithRay: pick });
    tester.register("behind-the-wall", new FakeNode({ absolutePosition: [0, 0, 2] }));
    expect(tester.hitRay(FORWARD)).toBeNull();
  });

  it("treats a pick with no mesh as a miss, and gives the sphere test back when removed", () => {
    const { pick } = pickReturning({ mesh: null, distance: 0, point: [0, 0, 0] });
    const tester = new BabylonHitTester({ pickWithRay: pick, defaultRadius: 0.5 });
    tester.register("button", new FakeNode({ absolutePosition: [0, 0, 2] }));
    expect(tester.hitRay(FORWARD)).toBeNull();

    tester.setPickWithRay(null);
    expect(tester.hitRay(FORWARD)?.interactableId).toBe("button");
  });

  it("stops walking at a parent with no transform", () => {
    const orphan = new FakeNode({ parent: BARE_PARENT });
    const { pick } = pickReturning({ mesh: orphan, distance: 1, point: [0, 0, 1] });
    const tester = new BabylonHitTester({ pickWithRay: pick });
    tester.register("elsewhere", new FakeNode({ absolutePosition: [0, 0, 2] }));
    expect(tester.hitRay(FORWARD)).toBeNull();
  });

  it("takes a null pick as the answer rather than testing spheres behind it", () => {
    const { pick } = pickReturning(null);
    const tester = new BabylonHitTester({ pickWithRay: pick, defaultRadius: 0.5 });
    tester.register("button", new FakeNode({ absolutePosition: [0, 0, 2] }));
    expect(tester.hitRay(FORWARD)).toBeNull();
    // Proximity is unaffected - the hook only replaces the ray test.
    expect(tester.hitProximity([0, 0, 2], 0.1)?.interactableId).toBe("button");
  });
});
