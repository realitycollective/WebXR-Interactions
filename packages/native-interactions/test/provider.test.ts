import { describe, expect, it } from "vitest";
import { inputProviderContractCases } from "@realitycollective/webxr-input";
import { NativeInputProvider } from "@realitycollective/native-interactions";
import { FakeInputHost } from "./helpers.js";

describe("NativeInputProvider contract", () => {
  const host = new FakeInputHost();
  const provider = new NativeInputProvider({ input: host });
  const driver = {
    enterSession: () => host.enterSession(),
    exitSession: () => host.exitSession(),
  };

  const cases = inputProviderContractCases();
  it("ships at least one contract case", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const contractCase of cases) {
    it(contractCase.name, () => {
      contractCase.run(provider, driver);
    });
  }
});

describe("NativeInputProvider construction", () => {
  it("throws one clear error naming the missing slice", () => {
    const original = (globalThis as { __rcHost?: unknown }).__rcHost;
    delete (globalThis as { __rcHost?: unknown }).__rcHost;
    try {
      expect(() => new NativeInputProvider()).toThrow(/"input"/);
    } finally {
      (globalThis as { __rcHost?: unknown }).__rcHost = original;
    }
  });

  it("falls back to globalThis.__rcHost.input when nothing is injected", () => {
    const host = new FakeInputHost();
    const original = (globalThis as { __rcHost?: unknown }).__rcHost;
    (globalThis as { __rcHost?: unknown }).__rcHost = { input: host };
    try {
      const provider = new NativeInputProvider();
      expect(provider.getCapabilities()).toEqual(host.getCapabilities());
    } finally {
      (globalThis as { __rcHost?: unknown }).__rcHost = original;
    }
  });
});

describe("NativeInputProvider copying", () => {
  it("hands back a snapshot the host cannot change afterwards, even reusing its own buffers", () => {
    const host = new FakeInputHost();
    const provider = new NativeInputProvider({ input: host });
    host.enterSession();

    const [first] = provider.sample();
    const before = JSON.stringify(first);

    // The host mutates its pooled snapshot and the tuple inside it in place.
    host.mutatePooled(0.9, [1, 0, 0]);

    expect(JSON.stringify(first)).toBe(before);
    expect(first?.select).toBe(0);
    expect(first?.ray?.direction).toEqual([0, 0, 1]);

    // A fresh sample() does see the mutation, and it is a different object.
    const [second] = provider.sample();
    expect(second?.select).toBe(0.9);
    expect(second?.ray?.direction).toEqual([1, 0, 0]);
    expect(second).not.toBe(first);
    expect(second?.ray).not.toBe(first?.ray);
  });

  it("copies the head pose", () => {
    const host = new FakeInputHost({ headPose: true });
    const provider = new NativeInputProvider({ input: host });
    const pose = provider.getHeadPose?.();
    expect(pose).toEqual(host.headPoseValue);
    expect(pose).not.toBe(host.headPoseValue);
    expect(pose?.position).not.toBe(host.headPoseValue.position);
  });
});

describe("NativeInputProvider optional members", () => {
  it("omits every optional member a host does not carry", () => {
    const provider = new NativeInputProvider({ input: new FakeInputHost() });
    expect(provider.getHeadPose).toBeUndefined();
    expect(provider.sampleHints).toBeUndefined();
    expect(provider.pulse).toBeUndefined();
    expect(provider.setPresenceVisible).toBeUndefined();
    expect(provider.setPresenceModality).toBeUndefined();
  });

  it("forwards every optional member a host does carry", () => {
    const host = new FakeInputHost({ headPose: true, hints: true, pulse: true, presence: true });
    host.hints.push({ sourceId: "a", targetId: "button", state: "hover" });
    const provider = new NativeInputProvider({ input: host });

    expect(provider.sampleHints?.()).toEqual(host.hints);
    expect(provider.pulse?.("a", 2, 20)).toBe(true);
    expect(host.pulses).toEqual([["a", 2, 20]]);
    expect(provider.setPresenceVisible?.("left", true)).toBe(true);
    expect(host.presenceVisible).toEqual([["left", true]]);
    expect(provider.setPresenceModality?.("hands")).toBe(true);
    expect(host.presenceModality).toEqual(["hands"]);
  });
});
