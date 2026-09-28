/**
 * NativePhysicsFacility - the core `PhysicsFacility` over the native host's
 * `physics` slice. The host runs the platform's default engine (Jolt on
 * Quest and Android, RealityKit on visionOS) behind exactly the contract's
 * members; this class is a thin binding that copies every tuple across the
 * boundary in both directions, so a host that reuses its own buffers still
 * meets the ownership rule the shared suite checks, and a tuple the core
 * hands over is never kept by the host.
 *
 * An app that replaces the default engine passes its own `PhysicsFacility`
 * as the slice: the shapes are identical, so the override is the same path.
 */
import type { PoseTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import type {
  HoldRelease,
  PhysicsBodySpec,
  PhysicsBodyState,
  PhysicsFacility,
  PhysicsShapeSpec,
  PhysicsVelocity,
} from "@realitycollective/webxr-interactions";
import { copyPose, copyVec3, resolveHostSlice, type NativePhysicsHost } from "./native-types.js";

export interface NativePhysicsFacilityOptions {
  /** The `physics` slice, or an app's own facility. Omit to read `globalThis.__rcHost.physics`. */
  physics?: NativePhysicsHost;
}

function copyVelocity(velocity: PhysicsVelocity): PhysicsVelocity {
  return { linear: copyVec3(velocity.linear), angular: copyVec3(velocity.angular) };
}

export class NativePhysicsFacility implements PhysicsFacility {
  private readonly host: NativePhysicsHost;

  constructor(options: NativePhysicsFacilityOptions = {}) {
    this.host = resolveHostSlice("physics", options.physics);
  }

  /** The engine the host runs, as it names it: `"jolt"`, `"realitykit"`, or an app's own. */
  get engine(): string {
    return this.host.engine;
  }

  getGravity(): Vec3Tuple {
    return copyVec3(this.host.getGravity());
  }

  setGravity(gravity: Vec3Tuple): void {
    this.host.setGravity(copyVec3(gravity));
  }

  addBody(id: string, pose: PoseTuple, body?: PhysicsBodySpec, shape?: PhysicsShapeSpec): void {
    this.host.addBody(
      id,
      copyPose(pose),
      body ? { ...body } : undefined,
      shape ? { ...shape, ...(shape.dimensions ? { dimensions: copyVec3(shape.dimensions) } : {}) } : undefined,
    );
  }

  removeBody(id: string): void {
    this.host.removeBody(id);
  }

  hasBody(id: string): boolean {
    return this.host.hasBody(id);
  }

  setBodyState(id: string, state: PhysicsBodyState): void {
    this.host.setBodyState(id, state);
  }

  getBodyState(id: string): PhysicsBodyState {
    return this.host.getBodyState(id);
  }

  getBodyPose(id: string): PoseTuple {
    return copyPose(this.host.getBodyPose(id));
  }

  setBodyPose(id: string, pose: PoseTuple): void {
    this.host.setBodyPose(id, copyPose(pose));
  }

  getVelocity(id: string): PhysicsVelocity {
    return copyVelocity(this.host.getVelocity(id));
  }

  setVelocity(id: string, velocity: PhysicsVelocity): void {
    this.host.setVelocity(id, copyVelocity(velocity));
  }

  suspend(id: string): void {
    this.host.suspend(id);
  }

  resume(id: string, release: HoldRelease): void {
    this.host.resume(id, { linearVelocity: copyVec3(release.linearVelocity), angularVelocity: copyVec3(release.angularVelocity) });
  }

  isSuspended(id: string): boolean {
    return this.host.isSuspended(id);
  }

  step(dtSeconds: number): void {
    this.host.step(dtSeconds);
  }

  dispose(): void {
    this.host.dispose();
  }
}
