/**
 * IWSDKTransformPort - the core's TransformPort over an IWSDK entity's
 * `object3D`, honouring FROM-REST semantics: the rest pose is captured at
 * construction, `getWorldPose()` reports the live pose and
 * `getRestWorldPose()` the rest pose, both in world space.
 * Same math as the three.js adapter's port. The three.js classes come from
 * `three` itself, a declared peer, rather than through `@iwsdk/core`'s
 * `export * from 'three'`: a consumer that excludes `three` from Vite's
 * dependency optimizer cannot resolve names that only exist behind that star.
 * One three instance is what the peer dependency gives every flat install.
 *
 * With a physics body (`options.physics`, the platform's `PhysicsFacility`
 * and the body's id) the port applies the core held-pose rule through the
 * facility, the same pattern `ThreeTransformPort` uses over `RapierPhysicsFacility`:
 * `beginHold` suspends the body, `endHold` resumes it with the release
 * velocity, and `setWorldPose` teleports it with velocity cleared while not
 * held (the facility also writes the object3D). Without one the object is
 * simply placed, as before.
 */
import {
  Matrix4,
  Quaternion,
  Vector3,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from "three";
import type { PoseTuple, QuatTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import type { HoldRelease, PhysicsFacility, TransformPort } from "@realitycollective/webxr-interactions";

/** The body a port drives through the platform's physics facility. */
export interface IWSDKTransformPortPhysics {
  facility: PhysicsFacility;
  /** The body's id in the facility, the interactable's own id. */
  bodyId: string;
}

export interface IWSDKTransformPortOptions {
  /**
   * Present when the entity has a physics body: the port then gains
   * `beginHold`/`endHold` and its `setWorldPose` goes through the facility
   * (a teleport with velocity cleared while not held, an exact write while
   * held). Absent, the port has no hold members and only places the object.
   */
  physics?: IWSDKTransformPortPhysics;
}

export class IWSDKTransformPort implements TransformPort {
  private readonly object: Object3D;
  private readonly restPosition = new Vector3();
  private readonly restQuaternion = new Quaternion();
  private readonly restScale = new Vector3();
  private baseEmissive: number | null = null;
  private readonly physics: IWSDKTransformPortPhysics | undefined;

  private readonly v = new Vector3();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly m = new Matrix4();

  readonly beginHold?: () => void;
  readonly endHold?: (release: HoldRelease) => void;

  constructor(object: Object3D, options: IWSDKTransformPortOptions = {}) {
    this.object = object;
    this.physics = options.physics;
    this.recaptureRest();
    if (this.physics) {
      const { facility, bodyId } = this.physics;
      this.beginHold = () => facility.suspend(bodyId);
      this.endHold = (release) => facility.resume(bodyId, release);
    }
  }

  recaptureRest(): void {
    this.restPosition.copy(this.object.position);
    this.restQuaternion.copy(this.object.quaternion);
    this.restScale.copy(this.object.scale);
  }

  getWorldPose(): PoseTuple {
    this.object.getWorldPosition(this.v);
    this.object.getWorldQuaternion(this.q);
    return {
      position: [this.v.x, this.v.y, this.v.z],
      quaternion: [this.q.x, this.q.y, this.q.z, this.q.w],
    };
  }

  getRestWorldPose(): PoseTuple {
    const parent = this.object.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      this.v.copy(this.restPosition).applyMatrix4(parent.matrixWorld);
      parent.getWorldQuaternion(this.q2);
      this.q.copy(this.q2).multiply(this.restQuaternion);
    } else {
      this.v.copy(this.restPosition);
      this.q.copy(this.restQuaternion);
    }
    return {
      position: [this.v.x, this.v.y, this.v.z],
      quaternion: [this.q.x, this.q.y, this.q.z, this.q.w],
    };
  }

  getLocalOffset(): Vec3Tuple {
    this.v.copy(this.object.position).sub(this.restPosition);
    this.q.copy(this.restQuaternion).invert();
    this.v.applyQuaternion(this.q);
    return [this.v.x, this.v.y, this.v.z];
  }

  setLocalOffset(offset: Vec3Tuple): void {
    this.v.set(offset[0], offset[1], offset[2]).applyQuaternion(this.restQuaternion);
    this.object.position.copy(this.restPosition).add(this.v);
    this.syncBody();
  }

  setLocalRotation(quaternion: QuatTuple): void {
    this.q.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    this.object.quaternion.copy(this.restQuaternion).multiply(this.q);
    this.syncBody();
  }

  /** A behaviour's write to the object reaches its body too, as a placement (velocity cleared). */
  private syncBody(): void {
    if (!this.physics) return;
    this.physics.facility.setBodyPose(this.physics.bodyId, this.getWorldPose());
  }

  /**
   * Follow a world pose while grabbed, or place the object directly the
   * rest of the time (reset / teleport) - see `TransformPort.setWorldPose`.
   * With a body, the facility owns its pose and velocity - held, the write
   * is exact; not held, it is a teleport that rests the body - and mirrors
   * it onto this object3D itself (`IWSDKPhysicsFacility.setBodyPose`), so
   * there is nothing further for the port to write.
   */
  setWorldPose(pose: PoseTuple): void {
    if (this.physics) {
      this.physics.facility.setBodyPose(this.physics.bodyId, pose);
      return;
    }
    const parent = this.object.parent;
    this.v.set(pose.position[0], pose.position[1], pose.position[2]);
    this.q.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
    if (parent) {
      parent.updateWorldMatrix(true, false);
      this.m.copy(parent.matrixWorld).invert();
      this.v.applyMatrix4(this.m);
      parent.getWorldQuaternion(this.q2).invert();
      this.q.premultiply(this.q2);
    }
    this.object.position.copy(this.v);
    this.object.quaternion.copy(this.q);
  }

  setEffect(effect: { scale?: number; emissive?: number }): void {
    if (effect.scale !== undefined) {
      this.object.scale.copy(this.restScale).multiplyScalar(effect.scale);
    }
    if (effect.emissive !== undefined) {
      const material = this.firstEmissiveMaterial();
      if (material) {
        if (this.baseEmissive === null) this.baseEmissive = material.emissiveIntensity;
        material.emissiveIntensity = this.baseEmissive + effect.emissive;
      }
    }
  }

  private firstEmissiveMaterial(): MeshStandardMaterial | null {
    let found: MeshStandardMaterial | null = null;
    this.object.traverse((child) => {
      if (found) return;
      const material = (child as Mesh).material as Material | Material[] | undefined;
      const single = Array.isArray(material) ? material[0] : material;
      if (single && "emissiveIntensity" in single) {
        found = single as MeshStandardMaterial;
      }
    });
    return found;
  }
}
