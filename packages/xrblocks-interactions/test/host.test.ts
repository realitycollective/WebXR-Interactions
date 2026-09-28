import { describe, expect, it } from "vitest";
import { Group } from "three";
import { XRBlocksTransformPort, connectXRBlocksInteractions } from "@realitycollective/xrblocks-interactions";
import { FakeRapierRigidBody, RAPIER_BODY_TYPES } from "./helpers.js";

function ix(
  options: { rigidBodyTypes?: typeof RAPIER_BODY_TYPES; nativeGrab?: boolean; withController?: boolean } = {},
) {
  return connectXRBlocksInteractions({
    input: {
      getFrame: () => ({
        raySources: options.withController
          ? [
              {
                controller: { inputSource: { handedness: "left" as const } },
                sourceType: "controller-ray",
                ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
                selected: false,
              },
            ]
          : [],
        directTouches: [],
      }),
    },
    camera: {
      getWorldPosition: (t) => Object.assign(t, { x: 0, y: 1.6, z: 0 }),
      getWorldQuaternion: (t) => Object.assign(t, { x: 0, y: 0, z: 0, w: 1 }),
    },
    ...options,
  });
}

describe("connectXRBlocksInteractions register()", () => {
  it("registers through XRBlocksTransformPort and the shared hit-tester, with a default 0.1 m radius", () => {
    const interactions = ix();
    const object = new Group();
    object.position.set(0, 0, -1);
    const port = interactions.register({ id: "beacon", behaviours: [] }, object);
    expect(port).toBeInstanceOf(XRBlocksTransformPort);
    expect(port.beginHold).toBeUndefined();

    const hit = interactions.hitTester.hitProximity([0.08, 0, -1], 0.05);
    expect(hit?.interactableId).toBe("beacon");
    interactions.unregister("beacon");
    expect(interactions.hitTester.hitProximity([0, 0, -1], 0.05)).toBeNull();
  });

  it("passes an explicit targetRadius to the hit-tester, for a target with no geometry of its own", () => {
    const interactions = ix();
    const object = new Group();
    object.position.set(0, 0, -2);
    interactions.register({ id: "wide", behaviours: [] }, object, { targetRadius: 0.5 });
    expect(interactions.hitTester.hitProximity([0.4, 0, -2], 0.05)?.interactableId).toBe("wide");
  });

  it("gives the port a rigid body only when both rigidBody and rigidBodyTypes are supplied", () => {
    const objectA = new Group();
    objectA.position.set(0, 0, -1);
    const bodyA = new FakeRapierRigidBody(objectA);
    const withoutTypes = ix();
    const portA = withoutTypes.register({ id: "a", behaviours: [] }, objectA, { rigidBody: bodyA });
    expect(portA.beginHold).toBeUndefined();

    const objectB = new Group();
    objectB.position.set(0, 0, -1);
    const bodyB = new FakeRapierRigidBody(objectB);
    const withTypes = ix({ rigidBodyTypes: RAPIER_BODY_TYPES });
    const portB = withTypes.register({ id: "b", behaviours: [] }, objectB, { rigidBody: bodyB });
    expect(portB.beginHold).toBeDefined();
    portB.beginHold?.();
    expect(bodyB.bodyType).toBe(RAPIER_BODY_TYPES.kinematicPositionBased);
  });
});

describe("connectXRBlocksInteractions native grab forwarding", () => {
  it("forwards onObjectGrabStart/onObjectGrabEnd into the provider's native-grabbing hint", () => {
    const interactions = ix({ nativeGrab: true, withController: true });
    interactions.provider.sample();
    expect(interactions.provider.getCapabilities().grabs).toBe("native");

    interactions.onObjectGrabStart({ source: { handedness: "left" } });
    const [grabbing] = interactions.provider.sample();
    expect(grabbing?.nativeGrabbing).toBe(true);

    interactions.onObjectGrabEnd({ source: { handedness: "left" } });
    const [released] = interactions.provider.sample();
    expect(released?.nativeGrabbing).toBeUndefined();
  });

  it("ignores a grab event with no side", () => {
    const interactions = ix();
    expect(() => interactions.onObjectGrabStart({ source: { handedness: "none" } })).not.toThrow();
    expect(() => interactions.onObjectGrabEnd({ source: { handedness: "none" } })).not.toThrow();
  });
});
