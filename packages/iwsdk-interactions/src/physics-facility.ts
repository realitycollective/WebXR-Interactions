/**
 * IWSDKPhysicsFacility - the IWSDK platform's physics, over Havok through
 * `@iwsdk/core`'s own components and system: `PhysicsBody`, `PhysicsShape`,
 * `PhysicsManipulation`, `PhysicsState`, `PhysicsShapeType`, `PhysicsSystem`.
 * These are IWSDK 1.0.0's own physics primitives - the reference this whole
 * family's `PHYSICS_DEFAULTS` (`@realitycollective/webxr-interactions`'s
 * `physics.ts`) is written from - so this facility implements the core
 * `PhysicsFacility` contract by driving them directly, with no rule or
 * default of its own.
 *
 * Havok runs off the main thread (a worker, by default) and cannot be stood
 * up inside this package's tests; `test/physics-facility.test.ts` proves
 * this class instead against a fake `PhysicsSystem`/entity that mirrors the
 * family's own engine-free reference, `MemoryPhysicsFacility` - see that
 * test file's own header.
 */
import { hasRegistered } from "./has-registered.js";
import {
  Matrix4,
  Quaternion,
  Vector3,
  type Object3D,
} from "three";
import {
  PhysicsBody,
  PhysicsManipulation,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
  PhysicsSystem,
  type Entity,
  type World,
} from "@iwsdk/core";
import type { PoseTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  PHYSICS_DEFAULTS,
  missingBody,
  resolvePhysicsBody,
  resolvePhysicsShape,
  type HoldRelease,
  type PhysicsBodySpec,
  type PhysicsBodyState,
  type PhysicsFacility,
  type PhysicsShapeKind,
  type PhysicsShapeSpec,
  type PhysicsVelocity,
} from "@realitycollective/webxr-interactions";

/** `PhysicsBodyState` -> `PhysicsBody.state`. */
const STATE_TO_IWSDK: Record<PhysicsBodyState, (typeof PhysicsState)[keyof typeof PhysicsState]> = {
  dynamic: PhysicsState.Dynamic,
  static: PhysicsState.Static,
  kinematic: PhysicsState.Kinematic,
};

/** `PhysicsBody.state` -> `PhysicsBodyState`, the reverse of {@link STATE_TO_IWSDK}. */
const STATE_FROM_IWSDK: Record<string, PhysicsBodyState> = {
  [PhysicsState.Dynamic]: "dynamic",
  [PhysicsState.Static]: "static",
  [PhysicsState.Kinematic]: "kinematic",
};

/** `PhysicsShapeKind` -> `PhysicsShape.shape`. */
const SHAPE_TO_IWSDK: Record<PhysicsShapeKind, (typeof PhysicsShapeType)[keyof typeof PhysicsShapeType]> = {
  auto: PhysicsShapeType.Auto,
  sphere: PhysicsShapeType.Sphere,
  box: PhysicsShapeType.Box,
  capsule: PhysicsShapeType.Capsules,
};

/** The state a suspended body had before `suspend`, so `resume` can restore it. */
interface SuspendedBody {
  state: PhysicsBodyState;
}

export interface IWSDKPhysicsFacilityOptions {
  /** Resolves a body's id to its entity, the way `IWSDKInteractions` resolves a registered interactable's. */
  entityFor(id: string): Entity | undefined;
}

const V = new Vector3();
const Q = new Quaternion();
const Q2 = new Quaternion();
const M = new Matrix4();

export class IWSDKPhysicsFacility implements PhysicsFacility {
  readonly engine = "havok";
  private readonly world: World;
  private readonly entityFor: (id: string) => Entity | undefined;
  /** Ids this facility added a body for itself, so `dispose` removes only its own. */
  private readonly owned = new Set<string>();
  /** Ids currently suspended, with the state to restore on resume. */
  private readonly suspended = new Map<string, SuspendedBody>();
  /** Gravity when the world carries no `PhysicsSystem` yet. */
  private fallbackGravity: Vec3Tuple = [...PHYSICS_DEFAULTS.gravity] as Vec3Tuple;

  constructor(world: World, options: IWSDKPhysicsFacilityOptions) {
    this.world = world;
    this.entityFor = options.entityFor;
  }

  getGravity(): Vec3Tuple {
    const system = this.world.getSystem(PhysicsSystem);
    if (system) {
      const g = system.config.gravity.value;
      return [g[0], g[1], g[2]];
    }
    return [...this.fallbackGravity];
  }

  setGravity(gravity: Vec3Tuple): void {
    const system = this.world.getSystem(PhysicsSystem);
    if (system) {
      system.config.gravity.value = [gravity[0], gravity[1], gravity[2]];
      return;
    }
    this.fallbackGravity = [gravity[0], gravity[1], gravity[2]];
  }

  addBody(id: string, pose: PoseTuple, body: PhysicsBodySpec = {}, shape: PhysicsShapeSpec = {}): void {
    const entity = this.entityFor(id);
    if (!entity) throw missingBody(id);
    const spec = resolvePhysicsBody(body);
    const shapeSpec = resolvePhysicsShape(shape);
    // A replace: `addComponent` overwrites a component already present
    // (elics `attachComponentToEntity`), and any prior hold on this id no
    // longer applies to the fresh body.
    this.suspended.delete(id);
    entity.addComponent(PhysicsBody, {
      state: STATE_TO_IWSDK[spec.state],
      linearDamping: spec.linearDamping,
      angularDamping: spec.angularDamping,
      gravityFactor: spec.gravityFactor,
    });
    entity.addComponent(PhysicsShape, {
      shape: SHAPE_TO_IWSDK[shapeSpec.kind],
      dimensions: shapeSpec.dimensions,
      density: shapeSpec.density,
      restitution: shapeSpec.restitution,
      friction: shapeSpec.friction,
    });
    this.writeObjectPose(id, entity, pose);
    this.owned.add(id);
  }

  removeBody(id: string): void {
    const entity = this.entityFor(id);
    this.suspended.delete(id);
    this.owned.delete(id);
    if (!entity) return;
    entity.removeComponent(PhysicsBody);
    entity.removeComponent(PhysicsShape);
  }

  hasBody(id: string): boolean {
    if (this.suspended.has(id)) return true;
    const entity = this.entityFor(id);
    return entity ? hasRegistered(entity, PhysicsBody) : false;
  }

  setBodyState(id: string, state: PhysicsBodyState): void {
    const held = this.suspended.get(id);
    if (held) {
      held.state = state;
      return;
    }
    const entity = this.requireBodyEntity(id);
    entity.setValue(PhysicsBody, "state", STATE_TO_IWSDK[state]);
  }

  getBodyState(id: string): PhysicsBodyState {
    const held = this.suspended.get(id);
    if (held) return held.state;
    const entity = this.requireBodyEntity(id);
    const raw = entity.getValue(PhysicsBody, "state") as string | null;
    return raw ? STATE_FROM_IWSDK[raw] ?? "dynamic" : "dynamic";
  }

  getBodyPose(id: string): PoseTuple {
    const entity = this.requireEntityWithBody(id);
    return this.readObjectPose(id, entity);
  }

  setBodyPose(id: string, pose: PoseTuple): void {
    const held = this.suspended.get(id);
    const entity = this.requireEntityWithBody(id);
    const system = this.world.getSystem(PhysicsSystem);
    if (system && !held) {
      system.setBodyTransform(entity, { position: pose.position, quaternion: pose.quaternion });
      return;
    }
    this.writeObjectPose(id, entity, pose);
  }

  getVelocity(id: string): PhysicsVelocity {
    if (this.suspended.has(id)) return { linear: [0, 0, 0], angular: [0, 0, 0] };
    const entity = this.requireBodyEntity(id);
    const linear = entity.getVectorView(PhysicsBody, "_linearVelocity");
    const angular = entity.getVectorView(PhysicsBody, "_angularVelocity");
    return {
      linear: [linear[0] ?? 0, linear[1] ?? 0, linear[2] ?? 0],
      angular: [angular[0] ?? 0, angular[1] ?? 0, angular[2] ?? 0],
    };
  }

  setVelocity(id: string, velocity: PhysicsVelocity): void {
    const entity = this.requireEntityWithBody(id);
    entity.addComponent(PhysicsManipulation, {
      linearVelocity: [...velocity.linear],
      angularVelocity: [...velocity.angular],
    });
  }

  suspend(id: string): void {
    if (this.suspended.has(id)) return;
    const entity = this.requireBodyEntity(id);
    const raw = entity.getValue(PhysicsBody, "state") as string | null;
    const state = raw ? STATE_FROM_IWSDK[raw] ?? "dynamic" : "dynamic";
    this.suspended.set(id, { state });
    // Keep PhysicsShape: only the body, the part PhysicsSystem simulates, goes.
    entity.removeComponent(PhysicsBody);
  }

  resume(id: string, release: HoldRelease): void {
    const held = this.suspended.get(id);
    if (!held) return;
    const entity = this.entityFor(id);
    if (!entity) throw missingBody(id);
    this.suspended.delete(id);
    entity.addComponent(PhysicsBody, { state: STATE_TO_IWSDK[held.state] });
    const hasVelocity = release.linearVelocity.some((v) => v !== 0) || release.angularVelocity.some((v) => v !== 0);
    if (hasVelocity) {
      entity.addComponent(PhysicsManipulation, {
        linearVelocity: [...release.linearVelocity],
        angularVelocity: [...release.angularVelocity],
      });
    }
  }

  isSuspended(id: string): boolean {
    return this.suspended.has(id);
  }

  /** IWSDK's `PhysicsSystem` steps Havok itself every frame; there is nothing for the facility to do here. */
  step(_dtSeconds: number): void {
    // Intentionally a no-op - see the doc above.
  }

  dispose(): void {
    for (const id of [...this.owned]) this.removeBody(id);
  }

  /** An entity for `id` that either carries `PhysicsBody` or is currently suspended; throws `missingBody` otherwise. */
  private requireEntityWithBody(id: string): Entity {
    const entity = this.entityFor(id);
    if (!entity) throw missingBody(id);
    if (!this.suspended.has(id) && !hasRegistered(entity, PhysicsBody)) throw missingBody(id);
    return entity;
  }

  /** Same as {@link requireEntityWithBody}, for a call that needs the entity to carry a LIVE `PhysicsBody` (not merely suspended). */
  private requireBodyEntity(id: string): Entity {
    const entity = this.entityFor(id);
    if (!entity || !hasRegistered(entity, PhysicsBody)) throw missingBody(id);
    return entity;
  }

  /** The entity's `object3D` world pose - IWSDK's `PhysicsSystem` writes simulated poses into it. */
  private readObjectPose(id: string, entity: Entity): PoseTuple {
    const object = this.objectOf(id, entity);
    object.getWorldPosition(V);
    object.getWorldQuaternion(Q);
    return { position: [V.x, V.y, V.z], quaternion: [Q.x, Q.y, Q.z, Q.w] };
  }

  /** Place `pose` (world space) onto the entity's `object3D`, in its parent's frame - the same math as `IWSDKTransformPort.setWorldPose`. */
  private writeObjectPose(id: string, entity: Entity, pose: PoseTuple): void {
    const object = this.objectOf(id, entity);
    const parent = object.parent;
    V.set(pose.position[0], pose.position[1], pose.position[2]);
    Q.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
    if (parent) {
      parent.updateWorldMatrix(true, false);
      M.copy(parent.matrixWorld).invert();
      V.applyMatrix4(M);
      parent.getWorldQuaternion(Q2).invert();
      Q.premultiply(Q2);
    }
    object.position.copy(V);
    object.quaternion.copy(Q);
  }

  private objectOf(id: string, entity: Entity): Object3D {
    const object = entity.object3D;
    if (!object) throw new Error(`[iwsdk-interactions] physics body "${id}" has no object3D to place`);
    return object;
  }
}
