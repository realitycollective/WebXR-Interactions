/**
 * Physics - the platform facility every binding provides, with one contract
 * and one set of defaults, so a body behaves the same under Havok on IWSDK
 * and Babylon, Rapier on three.js and XR Blocks, and the native host's
 * engine (Jolt on Quest and Android, RealityKit on visionOS).
 *
 * The template is IWSDK 1.0.0's physics (`@iwsdk/core` `dist/physics/`):
 * `PhysicsSystem` steps Havok at 60 Hz with interpolation on and gravity
 * `[0, -9.81, 0]`; a `PhysicsBody` is Dynamic with no damping and a gravity
 * factor of 1; a `PhysicsShape` is Auto (from the mesh geometry) with density
 * 1, restitution 0 and friction 0.5. `PHYSICS_DEFAULTS` restates those, and
 * `physicsFacilityContractCases()` proves each platform's facility applies
 * them: a body falls and rests, restitution bounces, a hold suspends, a
 * release throws, a teleport clears velocity.
 *
 * The facility is what the Interactions ports lean on for the held pose
 * (`TransformPort.beginHold`/`endHold`): a binding registers an object's
 * body with its facility, and the port suspends and resumes it there. An
 * app may replace the default engine by passing its own facility to the
 * binding's setup; "this platform has no physics engine" is not a state
 * the family recognises.
 *
 * Units: metres, seconds, radians, kilograms per cubic metre. Poses are
 * world space, quaternions `[x, y, z, w]`, +Y up. Every tuple returned is a
 * fresh value the caller owns; a tuple passed in is read and not kept.
 */
import type { PoseTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import type { HoldRelease } from "./ports.js";

/**
 * How a body moves. `"dynamic"` responds to forces, collisions and gravity;
 * `"static"` never moves and collides as scenery; `"kinematic"` moves only
 * by pose writes and pushes dynamic bodies. IWSDK: `PhysicsState.Dynamic`,
 * `.Static`, `.Kinematic`.
 */
export type PhysicsBodyState = "dynamic" | "static" | "kinematic";

/**
 * The collider's shape. `"auto"` is derived by the binding from the object's
 * own geometry (IWSDK `PhysicsShapeType.Auto`, a convex hull of the mesh);
 * the explicit kinds take `dimensions`: a box's full extents, a sphere's
 * `[radius, 0, 0]`, a capsule's `[radius, height, 0]`.
 */
export type PhysicsShapeKind = "auto" | "box" | "sphere" | "capsule";

export interface PhysicsBodySpec {
  /** Default `"dynamic"`. IWSDK `PhysicsBody.state`. */
  state?: PhysicsBodyState;
  /** Linear velocity damping per second, 0 for none. Default 0. IWSDK `linearDamping`. */
  linearDamping?: number;
  /** Angular velocity damping per second, 0 for none. Default 0. IWSDK `angularDamping`. */
  angularDamping?: number;
  /** Multiplier on the world's gravity for this body: 0 floats, 1 falls normally. Default 1. IWSDK `gravityFactor`. */
  gravityFactor?: number;
}

export interface PhysicsShapeSpec {
  /** Default `"auto"`. IWSDK `PhysicsShape.shape`. */
  kind?: PhysicsShapeKind;
  /** Metres; meaning per `kind`. Default `[0, 0, 0]`, which `"auto"` ignores. IWSDK `dimensions`. */
  dimensions?: Vec3Tuple;
  /** Kilograms per cubic metre; mass follows from it. Default 1. IWSDK `density`. */
  density?: number;
  /** Bounciness 0..1: 0 stops dead, 1 keeps all its speed. Default 0. IWSDK `restitution`. */
  restitution?: number;
  /** Coulomb friction, 0 slides freely. Default 0.5. IWSDK `friction`. */
  friction?: number;
}

/** IWSDK 1.0.0's physics defaults, from `physics-system.js`, `physicsBody.js` and `physicsShape.js`. */
export const PHYSICS_DEFAULTS = Object.freeze({
  /** Metres per second squared, world space. */
  gravity: Object.freeze([0, -9.81, 0] as Vec3Tuple),
  /** Simulation steps per second. */
  stepHz: 60,
  /** Render poses are interpolated between steps. */
  interpolation: true,
  body: Object.freeze({ state: "dynamic", linearDamping: 0, angularDamping: 0, gravityFactor: 1 } as Required<PhysicsBodySpec>),
  shape: Object.freeze({ kind: "auto", dimensions: [0, 0, 0] as Vec3Tuple, density: 1, restitution: 0, friction: 0.5 } as Required<PhysicsShapeSpec>),
});

/** A body spec with every default filled in. */
export function resolvePhysicsBody(spec: PhysicsBodySpec = {}): Required<PhysicsBodySpec> {
  const resolved = { ...PHYSICS_DEFAULTS.body, ...spec };
  if (resolved.linearDamping < 0 || resolved.angularDamping < 0) {
    throw new Error("[webxr-interactions] physics damping must be >= 0");
  }
  return resolved;
}

/** A shape spec with every default filled in. */
export function resolvePhysicsShape(spec: PhysicsShapeSpec = {}): Required<PhysicsShapeSpec> {
  const resolved = { ...PHYSICS_DEFAULTS.shape, ...spec, dimensions: [...(spec.dimensions ?? PHYSICS_DEFAULTS.shape.dimensions)] as Vec3Tuple };
  if (resolved.density <= 0) throw new Error("[webxr-interactions] physics density must be > 0");
  if (resolved.restitution < 0 || resolved.restitution > 1) throw new Error("[webxr-interactions] physics restitution must be 0..1");
  if (resolved.friction < 0) throw new Error("[webxr-interactions] physics friction must be >= 0");
  return resolved;
}

/** The velocity of a body: linear in metres per second, angular as an axis scaled by radians per second, world space. */
export interface PhysicsVelocity {
  linear: Vec3Tuple;
  angular: Vec3Tuple;
}

/**
 * One physics world on a platform. A binding names its default engine and
 * builds this over it; an app may pass its own.
 *
 * Bodies are keyed by the same string ids the Interactions runtime uses for
 * interactables, so a binding can look a registered object's body up when it
 * builds the object's `TransformPort`.
 */
export interface PhysicsFacility {
  /** The engine behind this facility, for reports: `"havok"`, `"rapier"`, `"jolt"`, `"realitykit"`, or an app's own name. */
  readonly engine: string;
  /** World gravity, metres per second squared. Starts at `PHYSICS_DEFAULTS.gravity`. */
  getGravity(): Vec3Tuple;
  setGravity(gravity: Vec3Tuple): void;
  /**
   * Add a body at `pose` with the given specs (defaults filled in as
   * `resolvePhysicsBody`/`resolvePhysicsShape`). Adding an id that exists
   * replaces it. IWSDK: `entity.addComponent(PhysicsBody, ...)` and
   * `addComponent(PhysicsShape, ...)`.
   */
  addBody(id: string, pose: PoseTuple, body?: PhysicsBodySpec, shape?: PhysicsShapeSpec): void;
  /** Remove a body; a missing id is ignored. IWSDK: `removeComponent(PhysicsBody)`. */
  removeBody(id: string): void;
  hasBody(id: string): boolean;
  /** Change how a body moves. IWSDK: `setValue(PhysicsBody, "state", ...)`. */
  setBodyState(id: string, state: PhysicsBodyState): void;
  getBodyState(id: string): PhysicsBodyState;
  /** Where the body is now, world space. */
  getBodyPose(id: string): PoseTuple;
  /**
   * Teleport: put the body at `pose` and clear its velocity, so it comes to
   * rest there rather than carrying what it was doing. IWSDK:
   * `PhysicsSystem.setBodyTransform`, which clears velocity by default.
   */
  setBodyPose(id: string, pose: PoseTuple): void;
  getVelocity(id: string): PhysicsVelocity;
  /** Set both velocities, world space. IWSDK: `PhysicsManipulation` with `linearVelocity`/`angularVelocity`. */
  setVelocity(id: string, velocity: PhysicsVelocity): void;
  /**
   * Suspend a body for a hold: from here until `resume`, it is not simulated
   * (no gravity, no collision response) and `setBodyPose` writes are exact
   * and carry no velocity. IWSDK: `beginHold` removes the `PhysicsBody`.
   * Suspending a suspended body changes nothing.
   */
  suspend(id: string): void;
  /**
   * Resume a suspended body in the state it had before the hold, with
   * `release` as its velocity so a throw carries through; zeros rest it.
   * IWSDK: `endHold` re-adds the `PhysicsBody` and a `PhysicsManipulation`.
   * Resuming a body that is not suspended changes nothing.
   */
  resume(id: string, release: HoldRelease): void;
  isSuspended(id: string): boolean;
  /**
   * Advance the world by `dtSeconds`. A facility whose engine steps itself
   * (IWSDK's `PhysicsSystem`, the native host's loop) may take this as a
   * hint and return; the contract cases then read poses the engine wrote.
   */
  step(dtSeconds: number): void;
  /** Release the world and every body. */
  dispose(): void;
}

/** Error for a body id the facility does not have: one message on every platform. */
export function missingBody(id: string): Error {
  return new Error(`[webxr-interactions] no physics body "${id}"`);
}
