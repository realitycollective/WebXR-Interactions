import { describe, expect, it } from "vitest";
import { NativeTransformPort } from "@realitycollective/native-interactions";
import { FakeInteractionHost } from "./helpers.js";

describe("NativeTransformPort", () => {
  it("reads and writes through the host, keyed by its target id", () => {
    const host = new FakeInteractionHost();
    host.setPose("button", { position: [1, 2, 3], quaternion: [0, 0, 0, 1] });
    host.setRestPose("button", { position: [1, 1, 3], quaternion: [0, 0, 0, 1] });
    host.setOffset("button", [0.1, 0, 0]);
    const port = new NativeTransformPort("button", { interactions: host });

    expect(port.getWorldPose()).toEqual({ position: [1, 2, 3], quaternion: [0, 0, 0, 1] });
    expect(port.getRestWorldPose()).toEqual({ position: [1, 1, 3], quaternion: [0, 0, 0, 1] });
    expect(port.getLocalOffset()).toEqual([0.1, 0, 0]);

    port.setLocalOffset([0.2, 0, 0]);
    expect(host.setLocalOffsetCalls).toEqual([["button", [0.2, 0, 0]]]);

    port.setLocalRotation([0, 1, 0, 0]);
    expect(host.setLocalRotationCalls).toEqual([["button", [0, 1, 0, 0]]]);
  });

  it("copies what it reads from the host, so a later host mutation cannot reach the caller", () => {
    const host = new FakeInteractionHost();
    const pose = { position: [1, 2, 3] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number] };
    host.setPose("lever", pose);

    const port = new NativeTransformPort("lever", { interactions: host });
    const read = port.getWorldPose();
    pose.position[0] = 99;
    expect(read.position).toEqual([1, 2, 3]);

    const rest = { position: [4, 5, 6] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number] };
    host.setRestPose("lever", rest);
    const readRest = port.getRestWorldPose();
    rest.position[0] = 99;
    expect(readRest.position).toEqual([4, 5, 6]);
  });

  it("copies the offset and pose it hands to the host", () => {
    const host = new FakeInteractionHost({ setWorldPose: true });
    const port = new NativeTransformPort("dial", { interactions: host });

    const offset: [number, number, number] = [1, 0, 0];
    port.setLocalOffset(offset);
    offset[0] = 5;
    expect(host.setLocalOffsetCalls[0]?.[1]).toEqual([1, 0, 0]);

    const pose = { position: [0, 0, 0] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number] };
    port.setWorldPose?.(pose);
    pose.position[0] = 9;
    expect(host.setWorldPoseCalls[0]).toEqual(["dial", { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }]);
  });

  it("omits setWorldPose and setEffect when the host does not carry them", () => {
    const host = new FakeInteractionHost();
    const port = new NativeTransformPort("plain", { interactions: host });
    expect(port.setWorldPose).toBeUndefined();
    expect(port.setEffect).toBeUndefined();
  });

  it("omits beginHold and endHold when the host does not carry them", () => {
    const host = new FakeInteractionHost();
    const port = new NativeTransformPort("plain", { interactions: host });
    expect(port.beginHold).toBeUndefined();
    expect(port.endHold).toBeUndefined();
  });

  it("forwards beginHold and endHold, keyed by target id, and copies the release velocity", () => {
    const host = new FakeInteractionHost({ physics: true });
    const port = new NativeTransformPort("prop", { interactions: host });

    port.beginHold?.();
    expect(host.beginHoldCalls).toEqual(["prop"]);

    const release = { linearVelocity: [1, 2, 3] as [number, number, number], angularVelocity: [0, 1, 0] as [number, number, number] };
    port.endHold?.(release);
    expect(host.endHoldCalls).toEqual([["prop", { linearVelocity: [1, 2, 3], angularVelocity: [0, 1, 0] }]]);

    // Copied, not kept: reusing the caller's tuple afterwards must not reach the host.
    release.linearVelocity[0] = 99;
    expect(host.endHoldCalls[0]?.[1].linearVelocity).toEqual([1, 2, 3]);
  });

  it("forwards setEffect when the host carries it", () => {
    const host = new FakeInteractionHost({ setEffect: true });
    const port = new NativeTransformPort("pulse-target", { interactions: host });
    port.setEffect?.({ scale: 1.2 });
    expect(host.setEffectCalls).toEqual([["pulse-target", { scale: 1.2 }]]);
  });

  it("throws one clear error naming the missing slice", () => {
    const original = (globalThis as { __rcHost?: unknown }).__rcHost;
    delete (globalThis as { __rcHost?: unknown }).__rcHost;
    try {
      expect(() => new NativeTransformPort("x")).toThrow(/"interactions"/);
    } finally {
      (globalThis as { __rcHost?: unknown }).__rcHost = original;
    }
  });
});
