import { describe, expect, it } from "vitest";
import {
  copyPose,
  copyQuat,
  copyRay,
  copySnapshot,
  copyVec3,
  resolveHostSlice,
} from "../src/native-types.js";
import type { InputSourceSnapshot } from "@realitycollective/webxr-input";
import { FakeInputHost } from "./helpers.js";

describe("resolveHostSlice", () => {
  it("prefers the injected slice over globalThis.__rcHost", () => {
    const injected = new FakeInputHost();
    const global = new FakeInputHost();
    const original = (globalThis as { __rcHost?: unknown }).__rcHost;
    (globalThis as { __rcHost?: unknown }).__rcHost = { input: global };
    try {
      expect(resolveHostSlice("input", injected)).toBe(injected);
    } finally {
      (globalThis as { __rcHost?: unknown }).__rcHost = original;
    }
  });

  it("falls back to globalThis.__rcHost when nothing is injected", () => {
    const global = new FakeInputHost();
    const original = (globalThis as { __rcHost?: unknown }).__rcHost;
    (globalThis as { __rcHost?: unknown }).__rcHost = { input: global };
    try {
      expect(resolveHostSlice("input", undefined)).toBe(global);
    } finally {
      (globalThis as { __rcHost?: unknown }).__rcHost = original;
    }
  });

  it("throws naming the slice when neither is present", () => {
    const original = (globalThis as { __rcHost?: unknown }).__rcHost;
    delete (globalThis as { __rcHost?: unknown }).__rcHost;
    try {
      expect(() => resolveHostSlice("interactions", undefined)).toThrow(/"interactions"/);
    } finally {
      (globalThis as { __rcHost?: unknown }).__rcHost = original;
    }
  });

  it("throws when globalThis.__rcHost exists but lacks the named slice", () => {
    const original = (globalThis as { __rcHost?: unknown }).__rcHost;
    (globalThis as { __rcHost?: unknown }).__rcHost = { input: new FakeInputHost() };
    try {
      expect(() => resolveHostSlice("interactions", undefined)).toThrow(/"interactions"/);
    } finally {
      (globalThis as { __rcHost?: unknown }).__rcHost = original;
    }
  });
});

describe("copy helpers", () => {
  it("copy every tuple into a fresh array/object", () => {
    const v = [1, 2, 3] as [number, number, number];
    const copiedV = copyVec3(v);
    expect(copiedV).toEqual(v);
    expect(copiedV).not.toBe(v);

    const q = [0, 0, 0, 1] as [number, number, number, number];
    const copiedQ = copyQuat(q);
    expect(copiedQ).toEqual(q);
    expect(copiedQ).not.toBe(q);

    const pose = { position: v, quaternion: q };
    const copiedPose = copyPose(pose);
    expect(copiedPose).toEqual(pose);
    expect(copiedPose.position).not.toBe(pose.position);
    expect(copiedPose.quaternion).not.toBe(pose.quaternion);

    const ray = { origin: v, direction: [0, 0, 1] as [number, number, number] };
    const copiedRay = copyRay(ray);
    expect(copiedRay).toEqual(ray);
    expect(copiedRay.origin).not.toBe(ray.origin);
    expect(copiedRay.direction).not.toBe(ray.direction);
  });

  it("copies a minimal snapshot without inventing optional fields", () => {
    const minimal: InputSourceSnapshot = {
      id: "a",
      kind: "gaze",
      handedness: "none",
      select: 0,
      squeeze: 0,
    };
    const copy = copySnapshot(minimal);
    expect(copy).toEqual(minimal);
    expect(copy).not.toBe(minimal);
    expect("ray" in copy).toBe(false);
    expect("gripPose" in copy).toBe(false);
    expect("indexTip" in copy).toBe(false);
    expect("linearVelocity" in copy).toBe(false);
    expect("angularVelocity" in copy).toBe(false);
    expect("nativeGrabbing" in copy).toBe(false);
    expect("hapticsAvailable" in copy).toBe(false);
  });

  it("deep-copies every optional field a full snapshot carries", () => {
    const full: InputSourceSnapshot = {
      id: "b",
      kind: "controller",
      handedness: "right",
      select: 1,
      squeeze: 0.5,
      ray: { origin: [0, 0, 0], direction: [0, 0, 1] },
      gripPose: { position: [1, 2, 3], quaternion: [0, 0, 0, 1] },
      indexTip: [0.1, 0.2, 0.3],
      linearVelocity: [1, 0, 0],
      angularVelocity: [0, 1, 0],
      nativeGrabbing: true,
      hapticsAvailable: true,
    };
    const copy = copySnapshot(full);
    expect(copy).toEqual(full);
    expect(copy.ray).not.toBe(full.ray);
    expect(copy.gripPose).not.toBe(full.gripPose);
    expect(copy.indexTip).not.toBe(full.indexTip);
    expect(copy.linearVelocity).not.toBe(full.linearVelocity);
    expect(copy.angularVelocity).not.toBe(full.angularVelocity);
  });
});
