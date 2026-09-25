/**
 * The `poseOnly` grab's held-pose binding for an entity with physics,
 * exercised through `IWSDKInteractions.register()`/the port it returns,
 * since `physicsBindingFor` is private to `register.ts` - the same
 * reach-through style `port-parity.test.ts` uses for `EntityHitTester`.
 *
 * The entity and world are faked; `PhysicsBody`, `PhysicsShape`,
 * `PhysicsManipulation`, `PhysicsState` and `PhysicsSystem` are the real
 * `@iwsdk/core` exports, used as component/system identities the way the
 * rest of this package's tests use real `InputComponent`/`VisibilityState`
 * values - see `helpers.ts`'s file header. `PhysicsSystem` itself is never
 * instantiated (that needs a live Havok/WASM world this package's tests do
 * not stand up); only `world.getSystem(PhysicsSystem)` and
 * `setBodyTransform` are faked, which is all `physicsBindingFor` reads.
 */
import { describe, expect, it } from "vitest";
import { Object3D } from "three";
import {
  PhysicsBody,
  PhysicsManipulation,
  PhysicsShape,
  PhysicsState,
  PhysicsSystem,
  type Entity,
  type World,
} from "@iwsdk/core";
import { registerInteractions } from "@realitycollective/iwsdk-interactions";
import { FakeSession, makeWorld } from "./helpers.js";

/** A component bag keyed by the real component identities - see the file header. */
class FakePhysicsEntity {
  readonly object3D = new Object3D();
  private readonly components = new Map<unknown, Record<string, unknown>>();

  addComponent(component: unknown, initialData: Record<string, unknown> = {}): this {
    this.components.set(component, { ...initialData });
    return this;
  }

  removeComponent(component: unknown): this {
    this.components.delete(component);
    return this;
  }

  hasComponent(component: unknown): boolean {
    return this.components.has(component);
  }

  getValue(component: unknown, key: string): unknown {
    return this.components.get(component)?.[key] ?? null;
  }
}

interface FakeBodyTransformCall {
  entity: unknown;
  position: unknown;
  quaternion: unknown;
}

/** `makeWorld` plus a fake `PhysicsSystem` reachable through `getSystem`. */
function fakeWorld() {
  const base = makeWorld({ session: new FakeSession() });
  const setBodyTransformCalls: FakeBodyTransformCall[] = [];
  const physicsSystem = {
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

  it("gives the port no beginHold/endHold when the world carries no PhysicsSystem", () => {
    // A real World always has `getSystem` (it is elics' own World method);
    // an app that never called `world.registerSystem(PhysicsSystem)` gets
    // `undefined` back from it, not a missing method - this is that case.
    const world = { ...makeWorld({ session: new FakeSession() }), getSystem: () => undefined };
    const host = registerInteractions(world as unknown as World);
    const port = host.register(
      { id: "prop", behaviours: [] },
      physicsEntity(PhysicsState.Dynamic) as unknown as Entity,
      { addInteractables: false },
    );
    expect(port?.beginHold).toBeUndefined();
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

    port!.endHold!({ linearVelocity: [1, 2, 3], angularVelocity: [0, 0.5, 0] });
    expect(entity.hasComponent(PhysicsBody)).toBe(true);
    expect(entity.getValue(PhysicsBody, "state")).toBe(PhysicsState.Kinematic); // restored, not defaulted to Dynamic
    expect(entity.hasComponent(PhysicsManipulation)).toBe(true);
    expect(entity.getValue(PhysicsManipulation, "linearVelocity")).toEqual([1, 2, 3]);
    expect(entity.getValue(PhysicsManipulation, "angularVelocity")).toEqual([0, 0.5, 0]);
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

  it("setWorldPose while not held teleports through PhysicsSystem.setBodyTransform", () => {
    const world = fakeWorld();
    const host = registerInteractions(world as unknown as World);
    const entity = physicsEntity(PhysicsState.Dynamic);
    const port = host.register({ id: "prop", behaviours: [] }, entity as unknown as Entity, {
      addInteractables: false,
    });
    port!.setWorldPose({ position: [1, 2, 3], quaternion: [0, 0, 0, 1] });
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
    port!.setWorldPose({ position: [1, 2, 3], quaternion: [0, 0, 0, 1] });
    expect(world.setBodyTransformCalls).toHaveLength(0);
    expect(entity.object3D.position.toArray()).toEqual([1, 2, 3]);
    host.dispose();
  });
});
