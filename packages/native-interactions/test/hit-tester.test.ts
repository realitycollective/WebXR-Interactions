import { describe, expect, it } from "vitest";
import { NativeHitTester } from "@realitycollective/native-interactions";
import { FakeInteractionHost } from "./helpers.js";

describe("NativeHitTester", () => {
  it("maps a ray hit's targetId onto interactableId, and copies the point", () => {
    const host = new FakeInteractionHost();
    host.rayHit = { targetId: "button", distance: 1.5, point: [0, 1, 2] };
    const tester = new NativeHitTester({ interactions: host });

    const hit = tester.hitRay({ origin: [0, 0, 0], direction: [0, 0, 1] });
    expect(hit).toEqual({ interactableId: "button", distance: 1.5, point: [0, 1, 2] });

    // Mutating the host's hit afterwards must not reach the returned value.
    host.rayHit.point[0] = 99;
    expect(hit?.point).toEqual([0, 1, 2]);
  });

  it("reports a ray miss as null", () => {
    const host = new FakeInteractionHost();
    host.rayHit = null;
    const tester = new NativeHitTester({ interactions: host });
    expect(tester.hitRay({ origin: [0, 0, 0], direction: [0, 0, 1] })).toBeNull();
  });

  it("reports a proximity miss as null", () => {
    const host = new FakeInteractionHost();
    host.proximityHit = null;
    const tester = new NativeHitTester({ interactions: host });
    expect(tester.hitProximity([0, 0, 0], 0.5)).toBeNull();
  });

  it("copies the ray it hands to the host, and the point on a proximity hit", () => {
    const host = new FakeInteractionHost();
    host.proximityHit = { targetId: "lever", distance: 0.2, point: [1, 1, 1] };
    const tester = new NativeHitTester({ interactions: host });

    const origin: [number, number, number] = [0, 1, 0];
    tester.hitRay({ origin, direction: [0, 0, 1] });
    expect(host.lastRay?.origin).toEqual(origin);
    expect(host.lastRay?.origin).not.toBe(origin);

    const point: [number, number, number] = [0, 1, 0];
    const hit = tester.hitProximity(point, 0.5);
    expect(host.lastProximity).toEqual({ point: [0, 1, 0], radius: 0.5 });
    expect(host.lastProximity?.point).not.toBe(point);
    expect(hit).toEqual({ interactableId: "lever", distance: 0.2, point: [1, 1, 1] });
  });

  it("throws one clear error naming the missing slice", () => {
    const original = (globalThis as { __rcHost?: unknown }).__rcHost;
    delete (globalThis as { __rcHost?: unknown }).__rcHost;
    try {
      expect(() => new NativeHitTester()).toThrow(/"interactions"/);
    } finally {
      (globalThis as { __rcHost?: unknown }).__rcHost = original;
    }
  });
});
