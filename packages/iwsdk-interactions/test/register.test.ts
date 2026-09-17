/**
 * One-call setup on a faked world.
 *
 * `registerInteractions` only needs `registerSystem` from the world, so the
 * structural fake covers it. The bridge SYSTEM itself is not exercised
 * here: `createSystem` builds an elics system class whose queries need a
 * real world to attach to, which is more than a fake can stand in for.
 */
import { describe, expect, it } from "vitest";
import type { Entity, World } from "@iwsdk/core";
import { Object3D } from "three";
import {
  IWSDKInteractions,
  InteractionBridgeSystem,
  IWSDKInputProvider,
  interactionsFor,
  registerInteractions,
} from "@realitycollective/iwsdk-interactions";
import { FakeSession, makeWorld, type FakeWorld } from "./helpers.js";

function register(world: FakeWorld) {
  return registerInteractions(world as unknown as World);
}

describe("registerInteractions", () => {
  it("builds the host, registers the bridge system and is idempotent", () => {
    const world = makeWorld({ session: new FakeSession() });
    const host = register(world);

    expect(host).toBeInstanceOf(IWSDKInteractions);
    expect(host.provider).toBeInstanceOf(IWSDKInputProvider);
    expect(world.registeredSystems).toEqual([InteractionBridgeSystem]);

    // A second call returns the same host without registering again.
    expect(register(world)).toBe(host);
    expect(world.registeredSystems).toHaveLength(1);
    host.dispose();
  });

  it("finds the host for a world it was registered on", () => {
    const world = makeWorld();
    expect(interactionsFor(world as unknown as World)).toBeUndefined();
    const host = register(world);
    expect(interactionsFor(world as unknown as World)).toBe(host);
    host.dispose();
  });

  it("wires the provider into the runtime", () => {
    const world = makeWorld({ session: new FakeSession() });
    const host = register(world);
    expect(host.runtime.getProvider()).toBe(host.provider);
    expect(host.runtime.getCapabilities().rays).toBe(true);
    host.dispose();
  });
});

/** An entity with just what `register` and the hit tester read. */
function fakeEntity(object: Object3D | null): Entity {
  return {
    object3D: object,
    hasComponent: () => false,
    addComponent: () => undefined,
  } as unknown as Entity;
}

describe("IWSDKInteractions targeting through the bridge tick", () => {
  const DT = 1 / 72;

  function hostWithBeacon(position: [number, number, number]) {
    // A live, visible session: the provider samples both sides, whose ray
    // and index-tip spaces sit at the rig origin looking down -Z, and the
    // head does the same, so gaze, ray and poke all start from the origin.
    const world = makeWorld({ session: new FakeSession() });
    const host = register(world);
    const scene = new Object3D();
    const object = new Object3D();
    object.position.set(...position);
    scene.add(object);
    host.register(
      { id: "beacon", behaviours: [{ kind: "press" }] },
      fakeEntity(object),
      { addInteractables: false },
    );
    const events: string[] = [];
    host.runtime.onEvent((event) => events.push(`${event.type}:${event.interactorId ?? ""}`));
    return { world, host, object, events };
  }

  it("targets an entity by ray and by gaze, and lets go when it moves away on a later frame", () => {
    const { host, object, events } = hostWithBeacon([0, 0, -1]);

    host.tick(DT, [], []);
    expect(events).toContain("hoverEnter:left-input");
    expect(events).toContain("hoverEnter:head-gaze");

    // The cached position is per frame, not per registration: a move is seen
    // on the next tick.
    events.length = 0;
    object.position.set(5, 0, -1);
    host.tick(DT, [], []);
    expect(events).toContain("hoverExit:right-input");
    expect(events).toContain("hoverExit:head-gaze");
    host.dispose();
  });

  it("targets an entity by poke through the index tip", () => {
    const { world, host, events } = hostWithBeacon([0.3, 1, -0.55]);
    world.playerSpaceEntities.indexTipSpaces.left.object3D?.position.set(0.3, 1, -0.5);

    host.tick(DT, [], []);
    expect(events).toContain("hoverEnter:left-input");
    expect(events).not.toContain("hoverEnter:head-gaze");
    host.dispose();
  });

  it("ignores an entity with no object and one whose object is hidden", () => {
    const world = makeWorld({ session: new FakeSession() });
    const host = register(world);
    const hidden = new Object3D();
    hidden.position.set(0, 0, -1);
    hidden.visible = false;
    host.register({ id: "hidden", behaviours: [{ kind: "press" }] }, fakeEntity(hidden), {
      addInteractables: false,
    });
    host.register({ id: "bodiless", behaviours: [{ kind: "press" }] }, fakeEntity(null), {
      addInteractables: false,
    });
    // Only targeting matters here; the press behaviours also announce their
    // first value on the first tick.
    const hovers: string[] = [];
    host.runtime.onEvent((event) => {
      if (event.type === "hoverEnter" || event.type === "hoverExit") hovers.push(event.type);
    });

    host.tick(DT, [], []);
    expect(hovers).toEqual([]);
    host.unregister("hidden");
    host.unregister("bodiless");
    host.dispose();
  });
});
