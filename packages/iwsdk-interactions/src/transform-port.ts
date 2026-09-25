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
import type { HoldRelease, TransformPort } from "@realitycollective/webxr-interactions";

/**
 * What drives `beginHold`/`endHold`/the held-vs-reset split of `setWorldPose`
 * on an entity with physics - built by `IWSDKInteractions.register` (which
 * has the `Entity`/`World` this port itself never touches) from
 * `@iwsdk/core`'s `PhysicsBody`/`PhysicsShape`/`PhysicsManipulation`
 * components and `PhysicsSystem.setBodyTransform`, documented next to that
 * code. Kept as a small seam here rather than importing `@iwsdk/core` into
 * this file, the same reason `NativeTransformPort` forwards to a host slice
 * instead of holding ECS details itself.
 */
export interface IWSDKPhysicsBinding {
  /** Suspend physics: `setWorldPose` writes the object3D directly until `endHold`. */
  beginHold(): void;
  /** Resume physics with `release` as the body's new velocity. */
  endHold(release: HoldRelease): void;
  /** Place the object while NOT held: teleport it, with velocities cleared. */
  teleport(pose: PoseTuple): void;
}

export interface IWSDKTransformPortOptions {
  /** Present only when the entity has a physics body - see {@link IWSDKPhysicsBinding}. */
  physics?: IWSDKPhysicsBinding;
}

export class IWSDKTransformPort implements TransformPort {
  private readonly object: Object3D;
  private readonly restPosition = new Vector3();
  private readonly restQuaternion = new Quaternion();
  private readonly restScale = new Vector3();
  private baseEmissive: number | null = null;
  private readonly physics: IWSDKPhysicsBinding | undefined;
  private held = false;

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
      const physics = this.physics;
      this.beginHold = () => {
        this.held = true;
        physics.beginHold();
      };
      this.endHold = (release) => {
        this.held = false;
        physics.endHold(release);
      };
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
  }

  setLocalRotation(quaternion: QuatTuple): void {
    this.q.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    this.object.quaternion.copy(this.restQuaternion).multiply(this.q);
  }

  /**
   * Follow a world pose while grabbed, or place the object directly the
   * rest of the time (reset / teleport) - see `TransformPort.setWorldPose`.
   * On an entity with physics, NOT held delegates entirely to
   * {@link IWSDKPhysicsBinding.teleport}, which also mirrors the pose onto
   * this object3D (see that binding's own doc) - writing it again here
   * would just be the same write twice.
   */
  setWorldPose(pose: PoseTuple): void {
    if (this.physics && !this.held) {
      this.physics.teleport(pose);
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
