/**
 * The `poseOnly` grab's IWSDK physics binding - `IWSDKPhysicsFacility`'s
 * `suspend`/`resume`/`setBodyPose`, exercised through
 * `IWSDKInteractions.register()`/the port it returns, the same reach-through
 * style `port-parity.test.ts` uses for `EntityHitTester`.
 *
 * The entity and world are faked; `PhysicsBody`, `PhysicsShape`,
 * `PhysicsManipulation`, `PhysicsState` and `PhysicsSystem` are the real
 * `@iwsdk/core` exports, used as component/system identities the way the
 * rest of this package's tests use real `InputComponent`/`VisibilityState`
 * values - see `helpers.ts`'s file header. `PhysicsSystem` itself is never
 * instantiated (that needs a live Havok/WASM world this package's tests do
 * not stand up); only `world.getSystem(PhysicsSystem)` and
 * `setBodyTransform` are faked, which is all `IWSDKPhysicsFacility` reads
 * from it. `FakePhysicsEntity` here carries no `MemoryPhysicsFacility`
 * (`physics-facility.test.ts`'s job): these cases check component-level
 * behaviour only - what gets added, removed and set, not simulated motion.
 */
import { describe, expect, it } from "vitest";
import {
  PhysicsBody,
  PhysicsManipulation,
  PhysicsShape,
  PhysicsState,
  PhysicsSystem,
  type Entity,
  type World,
} from "@iwsdk/core";
import { PHYSICS_DEFAULTS } from "@realitycollective/webxr-interactions";
import { registerInteractions } from "@realitycollective/iwsdk-interactions";
import { FakePhysicsEntity, FakeSession, makeWorld } from "./helpers.js";

interface FakeBodyTransformCall {
  entity: unknown;
  position: unknown;
  quaternion: unknown;
}

/** `makeWorld` plus a fake `PhysicsSystem` reachable through `getSystem`. */
function fakeWorld() {
  const base = makeWorld({ session: new FakeSession() });
  const setBodyTransformCalls: FakeBodyTransformCall[] = [];
  let gravity: [number, number, number] = [...PHYSICS_DEFAULTS.gravity];
  const physicsSystem = {
    config: {
      gravity: {
        get value() {
          return gravity;
        },
        set value(g: [number, number, number]) {
          gravity = g;
        },
      },
    },
    setBodyTransform(entity: unknown, pose: { position: unknown; quaternion: unknown }) {
      setBodyTransformCalls.push({ entity, position: pose.position, quaternion: pose.quaternion });
    },
  };
  return {
    ...base,
    setBodyTransformCalls,
    getSystem: (systemClass: unknown) => (systemClass === PhysicsSystem ? physicsSystem : undefined),
  };
}

function physicsEntity(state: (typeof PhysicsState)[keyof typeof PhysicsState]): FakePhysicsEntity {
  const entity = new FakePhysicsEntity();
  entity.addComponent(PhysicsBody, { state });
  entity.addComponent(PhysicsShape, {});
  return entity;
}

describe("the poseOnly grab's IWSDK physics binding", () => {
  it("gives the port no beginHold/endHold when the entity has no PhysicsBody/PhysicsShape", () => {
    const world = fakeWorld();
    const host = registerInteractions(world as unknown as World);
    const port = host.register({ id: "prop", behaviours: [] }, new FakePhysicsEntity() as unknown as Entity, {
      addInteractables: false,
    });
    expect(port?.beginHold).toBeUndefined();
    expect(port?.endHold).toBeUndefined();
    host.dispose();
  });

  it("still gives the port beginHold/endHold when the world carries no PhysicsSystem, falling back to writing the object3D directly", () => {
    // A real World always has `getSystem` (it is elics' own World method);
    // an app that never called `world.registerSystem(PhysicsSystem)` gets
    // `undefined` back from it, not a missing method - this is that case.
    // Unlike the old per-binding lookup, the facility itself absorbs this:
    // the port still gets the held-pose rule, through the fallback path.
    const world = { ...makeWorld({ session: new FakeSession() }), getSystem: () => undefined };
    const host = registerInteractions(world as unknown as World);
    const entity = physicsEntity(PhysicsState.Dynamic);
    const port = host.register({ id: "prop", behaviours: [] }, entity as unknown as Entity, {
      addInteractables: false,
    });
    expect(port?.beginHold).toBeDefined();
    expect(port?.endHold).toBeDefined();

    port!.setWorldPose!({ position: [1, 2, 3], quaternion: [0, 0, 0, 1] });
    expect(entity.object3D.position.toArray()).toEqual([1, 2, 3]);

    expect(host.physics.getGravity()).toEqual(PHYSICS_DEFAULTS.gravity);
    host.physics.setGravity([0, 0, 0]);
    expect(host.physics.getGravity()).toEqual([0, 0, 0]);
    host.dispose();
  });

  it("beginHold removes PhysicsBody (keeping PhysicsShape); endHold re-adds it at the same state plus a PhysicsManipulation for a nonzero release", () => {
    const world = fakeWorld();
    const host = registerInteractions(world as unknown as World);
    const entity = physicsEntity(PhysicsState.Kinematic);
    const port = host.register({ id: "prop", behaviours: [] }, entity as unknown as Entity, {
      addInteractables: false,
    });
    expect(port?.beginHold).toBeDefined();

    port!.beginHold!();
    expect(entity.hasComponent(PhysicsBody)).toBe(false);
    expect(entity.hasComponent(PhysicsShape)).toBe(true); // untouched
    expect(host.physics.isSuspended("prop")).toBe(true);

    port!.endHold!({ linearVelocity: [1, 2, 3], angularVelocity: [0, 0.5, 0] });
    expect(entity.hasComponent(PhysicsBody)).toBe(true);
    expect(entity.getValue(PhysicsBody, "state")).toBe(PhysicsState.Kinematic); // restored, not defaulted to Dynamic
    expect(entity.hasComponent(PhysicsManipulation)).toBe(true);
    expect(entity.getValue(PhysicsManipulation, "linearVelocity")).toEqual([1, 2, 3]);
    expect(entity.getValue(PhysicsManipulation, "angularVelocity")).toEqual([0, 0.5, 0]);
    expect(host.physics.isSuspended("prop")).toBe(false);
    host.dispose();
  });

  it("endHold with a zero release adds no PhysicsManipulation", () => {
    const world = fakeWorld();
    const host = registerInteractions(world as unknown as World);
    const entity = physicsEntity(PhysicsState.Dynamic);
    const port = host.register({ id: "prop", behaviours: [] }, entity as unknown as Entity, {
      addInteractables: false,
    });
    port!.beginHold!();
    port!.endHold!({ linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] });
    expect(entity.hasComponent(PhysicsManipulation)).toBe(false);
    host.dispose();
  });

  it("a second beginHold while already held changes nothing", () => {
    const world = fakeWorld();
    const host = registerInteractions(world as unknown as World);
    const entity = physicsEntity(PhysicsState.Dynamic);
    const port = host.register({ id: "prop", behaviours: [] }, entity as unknown as Entity, {
      addInteractables: false,
    });
    port!.beginHold!();
    port!.beginHold!();
    expect(host.physics.isSuspended("prop")).toBe(true);
    expect(entity.hasComponent(PhysicsBody)).toBe(false);
    host.dispose();
  });

  it("setWorldPose while not held teleports through PhysicsSystem.setBodyTransform", () => {
    const world = fakeWorld();
    const host = registerInteractions(world as unknown as World);
    const entity = physicsEntity(PhysicsState.Dynamic);
    const port = host.register({ id: "prop", behaviours: [] }, entity as unknown as Entity, {
      addInteractables: false,
    });
    port!.setWorldPose!({ position: [1, 2, 3], quaternion: [0, 0, 0, 1] });
    expect(world.setBodyTransformCalls).toHaveLength(1);
    expect(world.setBodyTransformCalls[0]?.position).toEqual([1, 2, 3]);
    host.dispose();
  });

  it("setWorldPose while held writes the object3D directly, not through PhysicsSystem", () => {
    const world = fakeWorld();
    const host = registerInteractions(world as unknown as World);
    const entity = physicsEntity(PhysicsState.Dynamic);
    const port = host.register({ id: "prop", behaviours: [] }, entity as unknown as Entity, {
      addInteractables: false,
    });
    port!.beginHold!();
    port!.setWorldPose!({ position: [1, 2, 3], quaternion: [0, 0, 0, 1] });
    expect(world.setBodyTransformCalls).toHaveLength(0);
    expect(entity.object3D.position.toArray()).toEqual([1, 2, 3]);
    host.dispose();
  });

  it("setLocalOffset/setLocalRotation sync the body through setBodyPose when there is one", () => {
    const world = fakeWorld();
    const host = registerInteractions(world as unknown as World);
    const entity = physicsEntity(PhysicsState.Dynamic);
    const port = host.register({ id: "prop", behaviours: [] }, entity as unknown as Entity, {
      addInteractables: false,
    });
    port!.setLocalOffset([0.2, 0, 0]);
    expect(world.setBodyTransformCalls).toHaveLength(1);
    port!.setLocalRotation([0, 0, 0, 1]);
    expect(world.setBodyTransformCalls).toHaveLength(2);
    host.dispose();
  });
});
