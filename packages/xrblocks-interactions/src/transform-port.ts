/**
 * XRBlocksTransformPort - the read/write surface of one interactable's
 * Object3D, plus the held-pose rule for a target whose object
 * carries a RAPIER rigid body - XR Blocks 0.21.1 bundles RAPIER physics
 * (`PhysicsOptions.RAPIER`, `Physics.blendedWorld`; verified against
 * `interaction/manipulation/ManipulationManager.ts` and
 * `simulator/scene/SimulatorPhysics.ts`, which create and step bodies the
 * same way this port drives one).
 *
 * Everything but the held pose is delegated to `ThreeTransformPort`, since
 * an XR Blocks `Script` is an ordinary three.js `Object3D` - this class
 * "behaves as `ThreeTransformPort` when there is no body", per the
 * `TransformPort.beginHold`/`endHold` doc, by simply never gaining those
 * two members when no body is supplied at construction, the same rule
 * `BabylonTransformPort` follows for a node with no `physicsBody`.
 *
 * Two ways to give the port a body. `physics` (the platform facility and
 * the body's id, the same option `ThreeTransformPort` takes) is the rule
 * every binding now follows: the held pose goes through the core
 * `PhysicsFacility` contract, Rapier by default on XR Blocks. `rigidBody`
 * with `rigidBodyTypes`, a bare RAPIER body the app drives itself, is kept
 * for apps written against it and behaves as before.
 */
import type { Object3D } from "three";
import type { PoseTuple, QuatTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import type { HoldRelease, TransformPort } from "@realitycollective/webxr-interactions";
import { ThreeTransformPort, type TransformPortPhysics } from "@realitycollective/threejs-interactions";

/** Structural slice of a RAPIER `Vector` reading/argument (`rapier3d`/`@dimforge/rapier3d-compat`). */
export interface RapierVectorLike {
  x: number;
  y: number;
  z: number;
}

/** Structural slice of a RAPIER `Rotation` (quaternion) reading/argument. */
export interface RapierQuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Structural slice of a RAPIER `RigidBody` this port needs - written from
 * the real API `simulator/scene/SimulatorPhysics.ts` and
 * `simulator/scene/SimulatorObjects.ts` drive (`setTranslation`,
 * `RigidBodyDesc.dynamic()`/`.kinematicPositionBased()`), not from an
 * `@dimforge/rapier3d-compat`/`rapier3d` dependency - this package holds no
 * RAPIER dependency, the same `@babylonjs/core`-free approach
 * `BabylonTransformPort` takes with Havok.
 *
 * The port only ever WRITES to the body - `setTranslation`/`setRotation`
 * keep it at the object's pose across a hold or a reset, `setLinvel`/
 * `setAngvel` carry a release through, and `setBodyType` suspends and
 * resumes it. Reading the body's own SIMULATED pose back into the object
 * every render frame is the app's job, exactly as it is for a Havok body
 * under `BabylonTransformPort` - RAPIER has no engine-level hook into an
 * arbitrary `Object3D` the way Havok has into a Babylon `TransformNode`.
 */
export interface RapierRigidBodyLike {
  setTranslation(translation: RapierVectorLike, wakeUp: boolean): void;
  setRotation(rotation: RapierQuaternionLike, wakeUp: boolean): void;
  setLinvel(velocity: RapierVectorLike, wakeUp: boolean): void;
  setAngvel(velocity: RapierVectorLike, wakeUp: boolean): void;
  setBodyType(bodyType: unknown, wakeUp: boolean): void;
}

/**
 * The two RAPIER `RigidBodyType` values `beginHold`/`endHold` switch a held
 * body between - pass RAPIER's own
 * `{ kinematicPositionBased: RAPIER.RigidBodyType.KinematicPositionBased, dynamic: RAPIER.RigidBodyType.Dynamic }`.
 * This package holds no RAPIER value, only the shape, the same idea as
 * `BabylonTransformPortOptions.physicsMotionTypes`.
 */
export interface RapierRigidBodyTypes {
  kinematicPositionBased: unknown;
  dynamic: unknown;
}

export interface XRBlocksTransformPortOptions {
  /**
   * The platform physics facility and this object's body id in it: the
   * port then applies the core held-pose rule through the facility, as
   * `ThreeTransformPort` does. Takes precedence over `rigidBody`.
   */
  physics?: TransformPortPhysics;
  /**
   * The RAPIER rigid body backing `object`, when the app drives XR Blocks
   * physics itself. `beginHold`/`endHold` exist on the port only when BOTH
   * this and `rigidBodyTypes` are supplied - an object with no body, or a
   * construction with no `rigidBodyTypes`, gets neither member and behaves
   * exactly as `ThreeTransformPort`.
   */
  rigidBody?: RapierRigidBodyLike;
  rigidBodyTypes?: RapierRigidBodyTypes;
}

const ZERO: RapierVectorLike = { x: 0, y: 0, z: 0 };

export class XRBlocksTransformPort implements TransformPort {
  private readonly base: ThreeTransformPort;
  private readonly body: RapierRigidBodyLike | undefined;
  private held = false;

  readonly beginHold?: () => void;
  readonly endHold?: (release: HoldRelease) => void;

  constructor(object: Object3D, options: XRBlocksTransformPortOptions = {}) {
    this.base = new ThreeTransformPort(object, options.physics ? { physics: options.physics } : {});
    if (options.physics) {
      // The facility owns the body: the three.js port's own hold members
      // suspend and resume it there, and its pose writes reach it.
      this.body = undefined;
      this.beginHold = () => this.base.beginHold!();
      this.endHold = (release) => this.base.endHold!(release);
      return;
    }
    this.body = options.rigidBody;
    const types = options.rigidBodyTypes;
    if (this.body && types) {
      const body = this.body;
      this.beginHold = () => {
        this.held = true;
        // Node-drives-physics: our `setWorldPose` writes below now move the
        // body directly, and nothing simulates it until `endHold`.
        body.setBodyType(types.kinematicPositionBased, true);
      };
      this.endHold = (release) => {
        this.held = false;
        body.setBodyType(types.dynamic, true);
        body.setLinvel(vector(release.linearVelocity), true);
        body.setAngvel(vector(release.angularVelocity), true);
      };
    }
  }

  recaptureRest(): void {
    this.base.recaptureRest();
  }

  /**
   * The object's live world pose, read straight off the `Object3D` - see
   * `RapierRigidBodyLike`'s own comment on why this port never reads the
   * body itself.
   */
  getWorldPose(): PoseTuple {
    return this.base.getWorldPose();
  }

  getRestWorldPose(): PoseTuple {
    return this.base.getRestWorldPose();
  }

  getLocalOffset(): Vec3Tuple {
    return this.base.getLocalOffset();
  }

  setLocalOffset(offset: Vec3Tuple): void {
    this.base.setLocalOffset(offset);
  }

  setLocalRotation(quaternion: QuatTuple): void {
    this.base.setLocalRotation(quaternion);
  }

  /**
   * Write the object's pose, and - with a rigid body - keep the body at the
   * same pose: held, so a kinematic body carries the object exactly, and
   * reset, so a dynamic body resumes simulating from where it was placed
   * rather than the pose it had a moment before. Velocity is cleared on a
   * reset only, the same "back to the tee" rule `ThreeTransformPort` and
   * `BabylonTransformPort` apply - not held, this call teleports; held, it
   * follows every write exactly and {@link beginHold}/{@link endHold} alone
   * own the body's velocity.
   */
  setWorldPose(pose: PoseTuple): void {
    this.base.setWorldPose(pose);
    const body = this.body;
    if (!body) return;
    body.setTranslation(vector(pose.position), true);
    body.setRotation(quaternion(pose.quaternion), true);
    if (!this.held) {
      body.setLinvel(ZERO, true);
      body.setAngvel(ZERO, true);
    }
  }

  setEffect(effect: { scale?: number; emissive?: number }): void {
    this.base.setEffect(effect);
  }
}

function vector(v: Vec3Tuple): RapierVectorLike {
  return { x: v[0], y: v[1], z: v[2] };
}

function quaternion(q: QuatTuple): RapierQuaternionLike {
  return { x: q[0], y: q[1], z: q[2], w: q[3] };
}
