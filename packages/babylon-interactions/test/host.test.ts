import { describe, expect, it } from "vitest";
import {
  BabylonInteractions,
  POINTER_EVENT_TYPES,
  createBabylonInteractions,
  type InteractionEvent,
} from "@realitycollective/babylon-interactions";
import { FakeNode, FakeScene, pointerInfo, ray } from "./helpers.js";

function host(options: { attachToScene?: boolean } = {}) {
  const scene = new FakeScene();
  const interactions = createBabylonInteractions({
    scene,
    defaultRadius: 0.5,
    ...(options.attachToScene !== undefined ? { attachToScene: options.attachToScene } : {}),
  });
  return { scene, interactions };
}

describe("BabylonInteractions wiring", () => {
  it("builds the runtime, provider and hit tester together", () => {
    const { interactions } = host();
    expect(interactions).toBeInstanceOf(BabylonInteractions);
    expect(interactions.runtime).toBeDefined();
    expect(interactions.provider.getCapabilities().pointer2d).toBe(true);
    interactions.dispose();
  });

  it("registers a node with the hit tester and the runtime, and unregisters it again", () => {
    const { interactions } = host();
    const node = new FakeNode({ absolutePosition: [0, 0, 2] });
    const port = interactions.register({ id: "button", behaviours: [{ kind: "press" }] }, node, {
      targetRadius: 1,
    });

    expect(interactions.getPort("button")).toBe(port);
    expect(interactions.hitTester.getNode("button")).toBe(node);

    interactions.unregister("button");
    expect(interactions.getPort("button")).toBeUndefined();
    expect(interactions.hitTester.getNode("button")).toBeUndefined();
    interactions.dispose();
  });

  it("drives a press from the scene pointer, through targeting, to an event", () => {
    const { scene, interactions } = host();
    const events: InteractionEvent[] = [];
    interactions.runtime.onEvent((event) => events.push(event));
    interactions.register(
      { id: "button", behaviours: [{ kind: "press" }] },
      new FakeNode({ absolutePosition: [0, 0, 2] }),
    );

    scene.onPointerObservable.notify(
      pointerInfo(POINTER_EVENT_TYPES.move, { ray: ray([0, 0, 0], [0, 0, 1]) }),
    );
    interactions.update(0.016);
    expect(events.map((e) => e.type)).toContain("hoverEnter");

    scene.onPointerObservable.notify(pointerInfo(POINTER_EVENT_TYPES.down, { button: 0 }));
    interactions.update(0.016);
    expect(events.map((e) => e.type)).toContain("pressStart");

    scene.onPointerObservable.notify(pointerInfo(POINTER_EVENT_TYPES.up, { button: 0 }));
    interactions.update(0.016);
    expect(events.map((e) => e.type)).toContain("pressEnd");
    interactions.dispose();
  });

  it("passes an app-supplied pick through to the hit tester", () => {
    const { interactions } = host();
    const node = new FakeNode({ absolutePosition: [0, 0, 9] });
    interactions.register({ id: "panel", behaviours: [{ kind: "press" }] }, node);
    interactions.setPickWithRay(() => ({ mesh: node, distance: 9, point: [0, 0, 9] }));

    const hit = interactions.hitTester.hitRay({ origin: [0, 0, 0], direction: [0, 0, 1] });
    expect(hit?.interactableId).toBe("panel");
    expect(hit?.distance).toBe(9);
    interactions.dispose();
  });
});

describe("BabylonInteractions scene loop", () => {
  it("updates from the engine delta, in seconds, and detaches on dispose", () => {
    const { scene, interactions } = host({ attachToScene: true });
    const seen: number[] = [];
    interactions.runtime.onSample(() => seen.push(1));
    expect(scene.onBeforeRenderObservable.count).toBe(1);

    scene.deltaMs = 32;
    scene.onBeforeRenderObservable.notify(null);
    expect(seen.length).toBe(1);

    interactions.dispose();
    expect(scene.onBeforeRenderObservable.count).toBe(0);
  });

  it("clamps a long frame rather than integrating over it", () => {
    const scene = new FakeScene();
    const interactions = createBabylonInteractions({ scene, attachToScene: true });
    const deltas: number[] = [];
    interactions.register({ id: "dial", behaviours: [{ kind: "press" }] }, new FakeNode());
    // A pulse behaviour would show the clamp directly; here it is enough that
    // a 10-second frame does not reach the runtime as 10 seconds.
    const original = interactions.update.bind(interactions);
    interactions.update = (dt: number) => {
      deltas.push(dt);
      original(dt);
    };
    scene.deltaMs = 10_000;
    scene.onBeforeRenderObservable.notify(null);
    expect(deltas).toEqual([0.1]);
    interactions.dispose();
  });

  it("stays quiet when the scene has no render observable", () => {
    const scene = new FakeScene() as unknown as { onBeforeRenderObservable?: undefined };
    delete scene.onBeforeRenderObservable;
    const interactions = createBabylonInteractions({
      scene: scene as never,
      attachToScene: true,
    });
    expect(() => interactions.dispose()).not.toThrow();
  });
});
