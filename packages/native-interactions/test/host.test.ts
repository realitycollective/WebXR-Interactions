import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeInteractions, createNativeInteractions } from "@realitycollective/native-interactions";
import { FakeInputHost, FakeInteractionHost } from "./helpers.js";

type FrameCallback = (timestampMs: number, deltaS: number) => void;

function fakeFrames() {
  const listeners = new Set<FrameCallback>();
  return {
    onFrame(callback: FrameCallback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    push(deltaS: number) {
      for (const listener of listeners) listener(0, deltaS);
    },
    count: () => listeners.size,
  };
}

afterEach(() => {
  delete (globalThis as { __rcHost?: unknown }).__rcHost;
});

describe("createNativeInteractions", () => {
  it("registers an interactable by id, with a transform port keyed by that id", () => {
    const interactions = new FakeInteractionHost();
    interactions.setOffset("button", [0.1, 0, 0]);
    const native = createNativeInteractions({
      input: new FakeInputHost(),
      interactions,
      dwellDefaults: { holdSeconds: 0.5 },
    });

    const port = native.register({ id: "button", behaviours: [{ kind: "press" }] });

    expect(native).toBeInstanceOf(NativeInteractions);
    expect(native.getPort("button")).toBe(port);
    expect(port.getLocalOffset()).toEqual([0.1, 0, 0]);

    native.unregister("button");
    expect(native.getPort("button")).toBeUndefined();
    // Registering again after unregister is allowed.
    native.register({ id: "button", behaviours: [{ kind: "press" }] });
    native.dispose();
  });

  it("reads both slices from globalThis.__rcHost when none are passed", () => {
    const interactions = new FakeInteractionHost();
    (globalThis as { __rcHost?: unknown }).__rcHost = { input: new FakeInputHost(), interactions };
    const native = createNativeInteractions();

    native.register({ id: "lever", behaviours: [] }).setLocalOffset([0, 1, 0]);

    expect(interactions.setLocalOffsetCalls).toEqual([["lever", [0, 1, 0]]]);
  });

  it("drives update from the host's frames when attached, clamps long frames, and detaches on dispose", () => {
    const frames = fakeFrames();
    const native = createNativeInteractions({
      input: new FakeInputHost(),
      interactions: new FakeInteractionHost(),
      attachToHost: true,
      frames,
    });
    const update = vi.spyOn(native.runtime, "update");

    frames.push(1 / 72);
    frames.push(2);
    frames.push(-1);

    expect(update.mock.calls.map(([dt]) => dt)).toEqual([1 / 72, 0.1, 0]);

    native.dispose();
    expect(frames.count()).toBe(0);
    native.dispose();
  });

  it("attaches to globalThis.__rcHost.onFrame when no frame source is passed", () => {
    const frames = fakeFrames();
    (globalThis as { __rcHost?: unknown }).__rcHost = { onFrame: frames.onFrame };

    createNativeInteractions({ input: new FakeInputHost(), interactions: new FakeInteractionHost(), attachToHost: true });

    expect(frames.count()).toBe(1);
  });

  it("names the missing frame source when asked to attach without one", () => {
    expect(() =>
      createNativeInteractions({ input: new FakeInputHost(), interactions: new FakeInteractionHost(), attachToHost: true }),
    ).toThrow(/attachToHost needs a frame source/);
  });
});
