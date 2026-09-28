/**
 * IWSDKPhysicsFacility - the shared `physicsFacilityContractCases()` suite,
 * the transform port's held-pose rule through it
 * (`transformPortContractCases()` with the facility as the physics driver),
 * and `registerInteractions`'s physics wiring (the default facility, an app
 * override, `body`/`shape` on register, an entity with app-added
 * components, unregister and dispose).
 *
 * Havok runs in a worker no test can stand up, so the fake `PhysicsSystem`
 * this file builds must behave as the real one does: it is backed by the
 * core's own `MemoryPhysicsFacility`, an engine-free reference. Every
 * `PhysicsBody`/`PhysicsShape`/`PhysicsManipulation` write a `FakePhysicsEntity`
 * (`helpers.ts`) receives mirrors into it, and `FakePhysicsWorld.step` below
 * stands in for IWSDK's own worker-driven stepping: it pulls each tracked
 * entity's current `object3D` pose into the memory facility (undoing
 * nothing live - velocity is saved and restored around the pull, so an
 * in-flight body keeps falling), steps the memory facility, and writes the
 * result back onto `object3D`, skipping a suspended body both ways so a
 * held pose stays exactly where it was written. The pull exists because
 * `IWSDKPhysicsFacility.addBody`/`setBodyPose` (while suspended or with no
 * system) place `object3D` directly, outside any component write the fake
 * entity can see - the same gap a real Havok body closes by reading the
 * object it was just placed at on its first tick.
 *
 * `IWSDKPhysicsFacility.step()` is a documented no-op (IWSDK's `PhysicsSystem`
 * steps itself); the contract suite still calls `facility.step(dt)`, so the
 * `PhysicsFacility` handed to each case below wraps the real facility with a
 * `step` that also advances `FakePhysicsWorld` - everything else forwards to
 * the real, unwrapped implementation.
 */
import { describe, expect, it } from "vitest";
import { Group, Vector3, type Object3D } from "three";
import { PhysicsBody, PhysicsShape, PhysicsState, PhysicsSystem, type Entity, type World } from "@iwsdk/core";
import type { PoseTuple, QuatTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  MemoryPhysicsFacility,
  physicsFacilityContractCases,
  transformPortContractCases,
  type PhysicsFacility,
  type TransformPortContractSubject,
} from "@realitycollective/webxr-interactions";
import { IWSDKPhysicsFacility, IWSDKTransformPort, registerInteractions } from "@realitycollective/iwsdk-interactions";
import { FakePhysicsEntity, FakeSession, makeWorld } from "./helpers.js";

interface FakeSystemLike {
  config: { gravity: { value: Vec3Tuple } };
  setBodyTransform(entity: unknown, pose: { position: Vec3Tuple; quaternion: QuatTuple }): void;
}

/** A fake IWSDK world whose bodies are simulated by a shared `MemoryPhysicsFacility` - see this file's header. */
class FakePhysicsWorld {
  readonly memory = new MemoryPhysicsFacility();
  readonly system: FakeSystemLike;
  private readonly entities = new Map<string, FakePhysicsEntity>();
  private readonly idOf = new WeakMap<FakePhysicsEntity, string>();

  constructor() {
    const memory = this.memory;
    const idOf = this.idOf;
    this.system = {
      config: {
        gravity: {
          get value(): Vec3Tuple {
            return memory.getGravity();
          },
          set value(g: Vec3Tuple) {
            memory.setGravity(g);
          },
        },
      },
      setBodyTransform(entity: unknown, pose: { position: Vec3Tuple; quaternion: QuatTuple }) {
        const id = idOf.get(entity as FakePhysicsEntity);
        if (id === undefined) return;
        memory.setBodyPose(id, { position: pose.position, quaternion: pose.quaternion });
        const object = (entity as FakePhysicsEntity).object3D;
        object.position.set(pose.position[0], pose.position[1], pose.position[2]);
        object.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
      },
    };
  }

  /** Resolves (and lazily creates) the entity behind a body id - `IWSDKPhysicsFacilityOptions.entityFor`. */
  entityFor = (id: string): FakePhysicsEntity => {
    let entity = this.entities.get(id);
    if (!entity) {
      entity = new FakePhysicsEntity({ facility: this.memory, id });
      this.entities.set(id, entity);
      this.idOf.set(entity, id);
    }
    return entity;
  };

  getSystem = (systemClass: unknown): FakeSystemLike | undefined =>
    systemClass === PhysicsSystem ? this.system : undefined;

  step(dtSeconds: number): void {
    for (const [id, entity] of this.entities) {
      if (!this.memory.hasBody(id)) continue;
      const savedVelocity = this.memory.getVelocity(id);
      const object = entity.object3D;
      this.memory.setBodyPose(id, {
        position: [object.position.x, object.position.y, object.position.z],
        quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
      });
      this.memory.setVelocity(id, savedVelocity);
    }
    this.memory.step(dtSeconds);
    for (const [id, entity] of this.entities) {
      if (!this.memory.hasBody(id) || this.memory.isSuspended(id)) continue;
      const pose = this.memory.getBodyPose(id);
      entity.object3D.position.set(pose.position[0], pose.position[1], pose.position[2]);
      entity.object3D.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
    }
  }
}

/** A fresh `IWSDKPhysicsFacility` over a fresh `FakePhysicsWorld`, with `step` also advancing the fake world - see this file's header. */
function buildFacility(): { facility: PhysicsFacility; world: FakePhysicsWorld } {
  const world = new FakePhysicsWorld();
  const real = new IWSDKPhysicsFacility(world as unknown as World, {
    entityFor: (id) => world.entityFor(id) as unknown as Entity,
  });
  const facility: PhysicsFacility = {
    engine: real.engine,
    getGravity: () => real.getGravity(),
    setGravity: (g) => real.setGravity(g),
    addBody: (id, pose, body, shape) => real.addBody(id, pose, body, shape),
    removeBody: (id) => real.removeBody(id),
    hasBody: (id) => real.hasBody(id),
    setBodyState: (id, state) => real.setBodyState(id, state),
    getBodyState: (id) => real.getBodyState(id),
    getBodyPose: (id) => real.getBodyPose(id),
    setBodyPose: (id, pose) => real.setBodyPose(id, pose),
    getVelocity: (id) => real.getVelocity(id),
    setVelocity: (id, velocity) => real.setVelocity(id, velocity),
    suspend: (id) => real.suspend(id),
    resume: (id, release) => real.resume(id, release),
    isSuspended: (id) => real.isSuspended(id),
    step: (dt) => {
      real.step(dt); // the real, documented no-op
      world.step(dt); // stands in for IWSDK's own worker-driven stepping
    },
    dispose: () => real.dispose(),
  };
  return { facility, world };
}

describe("IWSDKPhysicsFacility", () => {
  for (const contractCase of physicsFacilityContractCases()) {
    it(contractCase.name, () => {
      const { facility } = buildFacility();
      contractCase.run({ facility });
    });
  }

  it("names its engine havok", () => {
    const { facility } = buildFacility();
    expect(facility.engine).toBe("havok");
  });

  it("places and reads a body's pose under a turned parent, in the parent's frame", () => {
    const { facility, world } = buildFacility();
    const parent = new Group();
    parent.position.set(0, 0, 5);
    parent.quaternion.set(0, Math.SQRT1_2, 0, Math.SQRT1_2);
    const child = world.entityFor("child").object3D;
    parent.add(child);
    facility.addBody(
      "child",
      { position: [1, 1, 5], quaternion: [0, 0, 0, 1] },
      { gravityFactor: 0 },
      { kind: "sphere", dimensions: [0.1, 0, 0] },
    );
    parent.updateMatrixWorld(true);
    const worldPosition = new Vector3();
    child.getWorldPosition(worldPosition);
    expect(worldPosition.x).toBeCloseTo(1, 5);
    expect(worldPosition.y).toBeCloseTo(1, 5);
    expect(worldPosition.z).toBeCloseTo(5, 5);
    const pose = facility.getBodyPose("child");
    expect(pose.position[0]).toBeCloseTo(1, 5);
    expect(pose.position[1]).toBeCloseTo(1, 5);
    expect(pose.position[2]).toBeCloseTo(5, 5);
  });
});

describe("IWSDKPhysicsFacility - ids with no entity, or an entity with no body", () => {
  function facilityWith(entityFor: (id: string) => Entity | undefined): IWSDKPhysicsFacility {
    return new IWSDKPhysicsFacility({ getSystem: () => undefined } as unknown as World, { entityFor });
  }

  it("addBody, getBodyPose and setBodyPose throw missingBody when entityFor resolves nothing", () => {
    const facility = facilityWith(() => undefined);
    expect(() => facility.addBody("ghost", { position: [0, 0, 0], quaternion: [0, 0, 0, 1] })).toThrow(/no physics body "ghost"/);
    expect(() => facility.getBodyPose("ghost")).toThrow(/no physics body "ghost"/);
    expect(() =>
      facility.setBodyPose("ghost", { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }),
    ).toThrow(/no physics body "ghost"/);
  });

  it("removeBody is a no-op and hasBody is false when entityFor resolves nothing", () => {
    const facility = facilityWith(() => undefined);
    expect(() => facility.removeBody("ghost")).not.toThrow();
    expect(facility.hasBody("ghost")).toBe(false);
  });

  it("getBodyState/setBodyState/getVelocity/setVelocity/suspend throw missingBody for an entity with no body", () => {
    const entity = new FakePhysicsEntity();
    const facility = facilityWith(() => entity as unknown as Entity);
    expect(() => facility.getBodyState("bare")).toThrow(/no physics body "bare"/);
    expect(() => facility.setBodyState("bare", "static")).toThrow(/no physics body "bare"/);
    expect(() => facility.getVelocity("bare")).toThrow(/no physics body "bare"/);
    expect(() => facility.setVelocity("bare", { linear: [0, 0, 0], angular: [0, 0, 0] })).toThrow(/no physics body "bare"/);
    expect(() => facility.suspend("bare")).toThrow(/no physics body "bare"/);
  });

  it("addBody throws a clear error, naming the id, for an entity with no object3D", () => {
    const bare = { hasComponent: () => false, addComponent: () => undefined } as unknown as Entity;
    const facility = facilityWith(() => bare);
    expect(() =>
      facility.addBody("noobject", { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }),
    ).toThrow(/physics body "noobject" has no object3D/);
  });

  it("getBodyState and suspend default to dynamic when the component carries no explicit state", () => {
    const entity = new FakePhysicsEntity();
    entity.addComponent(PhysicsBody, {});
    entity.addComponent(PhysicsShape, {});
    const facility = facilityWith(() => entity as unknown as Entity);
    expect(facility.getBodyState("x")).toBe("dynamic");
    facility.suspend("x");
    expect(facility.isSuspended("x")).toBe(true);
    facility.resume("x", { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] });
    expect(facility.getBodyState("x")).toBe("dynamic");
  });

  it("resume throws missingBody if the entity disappears while suspended", () => {
    const entity = new FakePhysicsEntity();
    entity.addComponent(PhysicsBody, { state: PhysicsState.Dynamic });
    entity.addComponent(PhysicsShape, {});
    let vanished = false;
    const facility = facilityWith(() => (vanished ? undefined : (entity as unknown as Entity)));
    facility.suspend("x");
    vanished = true;
    expect(() =>
      facility.resume("x", { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] }),
    ).toThrow(/no physics body "x"/);
  });

  it("suspend, then setBodyPose with no PhysicsSystem, still writes the object3D directly", () => {
    const entity = new FakePhysicsEntity();
    entity.addComponent(PhysicsBody, { state: PhysicsState.Dynamic });
    entity.addComponent(PhysicsShape, {});
    const facility = facilityWith(() => entity as unknown as Entity);
    facility.suspend("x");
    facility.setBodyPose("x", { position: [1, 2, 3], quaternion: [0, 0, 0, 1] });
    expect(entity.object3D.position.toArray()).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// TransformPort
// ---------------------------------------------------------------------------

const REST: PoseTuple = { position: [1, 2, -3], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };

describe("IWSDKTransformPort over the facility", () => {
  function subject(): TransformPortContractSubject {
    const { facility, world } = buildFacility();
    const object = world.entityFor("obj").object3D;
    object.position.set(...REST.position);
    object.quaternion.set(...REST.quaternion);
    facility.addBody("obj", REST, {}, { kind: "sphere", dimensions: [0.1, 0, 0] });
    const port = new IWSDKTransformPort(object as unknown as Object3D, { physics: { facility, bodyId: "obj" } });
    return { port, rest: REST, physics: { step: (dt) => facility.step(dt) } };
  }

  for (const contractCase of transformPortContractCases()) {
    it(contractCase.name, () => contractCase.run(subject()));
  }
});

// ---------------------------------------------------------------------------
// registerInteractions
// ---------------------------------------------------------------------------

function fakeInteractionsWorld() {
  return { ...makeWorld({ session: new FakeSession() }), getSystem: () => undefined };
}

describe("registerInteractions physics", () => {
  it("builds an IWSDKPhysicsFacility as the default engine, gives a registered entity a body through body/shape at its world pose, and unregister removes it", () => {
    const world = fakeInteractionsWorld();
    const host = registerInteractions(world as unknown as World);
    expect(host.physics).toBeInstanceOf(IWSDKPhysicsFacility);
    expect(host.physics.engine).toBe("havok");

    const entity = new FakePhysicsEntity();
    entity.object3D.position.set(0, 1, 0);
    const port = host.register({ id: "ball", behaviours: [{ kind: "grab" }] }, entity as unknown as Entity, {
      addInteractables: false,
      shape: { kind: "sphere", dimensions: [0.1, 0, 0] },
    });
    expect(port?.beginHold).toBeTypeOf("function");
    expect(host.physics.hasBody("ball")).toBe(true);
    expect(host.physics.getBodyState("ball")).toBe("dynamic");
    expect(host.physics.getBodyPose("ball").position).toEqual([0, 1, 0]);

    host.unregister("ball");
    expect(host.physics.hasBody("ball")).toBe(false);
    host.dispose();
  });

  it("takes an app's own facility in place of the default", () => {
    const own = new MemoryPhysicsFacility();
    const host = registerInteractions(makeWorld({ session: new FakeSession() }) as unknown as World, { physics: own });
    expect(host.physics).toBe(own);

    const entity = new FakePhysicsEntity();
    host.register({ id: "ball", behaviours: [] }, entity as unknown as Entity, {
      addInteractables: false,
      shape: { kind: "sphere", dimensions: [0.1, 0, 0] },
    });
    expect(own.hasBody("ball")).toBe(true);
    for (let i = 0; i < 30; i++) own.step(1 / 60);
    expect(own.getBodyPose("ball").position[1]).toBeLessThan(0);

    host.dispose();
    // dispose disposes the facility - the app's own included, the same rule
    // every other platform's setup follows.
    expect(own.hasBody("ball")).toBe(false);
  });

  it("an entity that already carries PhysicsBody/PhysicsShape gets the port's physics members with no body/shape option, and unregister leaves it alone", () => {
    const world = fakeInteractionsWorld();
    const host = registerInteractions(world as unknown as World);
    const entity = new FakePhysicsEntity();
    entity.addComponent(PhysicsBody, { state: PhysicsState.Dynamic });
    entity.addComponent(PhysicsShape, {});

    const port = host.register({ id: "prop", behaviours: [] }, entity as unknown as Entity, { addInteractables: false });
    expect(port?.beginHold).toBeTypeOf("function");
    expect(host.physics.hasBody("prop")).toBe(true);

    host.unregister("prop");
    // the app added this body itself - unregister must not have touched it.
    expect(entity.hasComponent(PhysicsBody)).toBe(true);
    expect(entity.hasComponent(PhysicsShape)).toBe(true);
    host.dispose();
  });

  it("register with only a body option (no shape) still gives the entity a body, with an auto shape", () => {
    const world = fakeInteractionsWorld();
    const host = registerInteractions(world as unknown as World);
    const entity = new FakePhysicsEntity();
    host.register({ id: "auto", behaviours: [] }, entity as unknown as Entity, {
      addInteractables: false,
      body: { state: "kinematic" },
    });
    expect(host.physics.hasBody("auto")).toBe(true);
    expect(host.physics.getBodyState("auto")).toBe("kinematic");
    host.dispose();
  });

  it("dispose removes every body the facility itself added, through unregister and directly", () => {
    const world = fakeInteractionsWorld();
    const host = registerInteractions(world as unknown as World);
    const entity = new FakePhysicsEntity();
    host.register({ id: "ball", behaviours: [] }, entity as unknown as Entity, {
      addInteractables: false,
      shape: { kind: "sphere", dimensions: [0.1, 0, 0] },
    });
    expect(host.physics.hasBody("ball")).toBe(true);
    host.dispose();
    expect(host.physics.hasBody("ball")).toBe(false);
  });

  it("register with a body but no object3D throws, naming the interactable", () => {
    const world = fakeInteractionsWorld();
    const host = registerInteractions(world as unknown as World);
    const bare = { hasComponent: () => false, addComponent: () => undefined } as unknown as Entity;
    expect(() => host.register({ id: "ghost", behaviours: [] }, bare, { addInteractables: false, body: {} })).toThrow(
      /"ghost".*no object3D/,
    );
    host.dispose();
  });

  it("a plain register with no body/shape and no app physics gets no physics members", () => {
    const world = fakeInteractionsWorld();
    const host = registerInteractions(world as unknown as World);
    const entity = new FakePhysicsEntity();
    const port = host.register({ id: "plain", behaviours: [] }, entity as unknown as Entity, { addInteractables: false });
    expect(port?.beginHold).toBeUndefined();
    expect(host.physics.hasBody("plain")).toBe(false);
    host.dispose();
  });
});
