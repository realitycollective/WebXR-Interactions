/**
 * IWSDKTransformPort — the core's TransformPort over an IWSDK entity's
 * `object3D`, honouring FROM-REST semantics (rest captured at
 * construction; `getWorldPose()` reports the rest pose in world space).
 * Same math as the three.js adapter's port, expressed against IWSDK's
 * re-exported three types so there is exactly one three instance.
 */
import {
  Matrix4,
  Quaternion,
  Vector3,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from "@iwsdk/core";
import type { PoseTuple, QuatTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import type { TransformPort } from "@realitycollective/webxr-interactions";

export class IWSDKTransformPort implements TransformPort {
  private readonly object: Object3D;
  private readonly restPosition = new Vector3();
  private readonly restQuaternion = new Quaternion();
  private readonly restScale = new Vector3();
  private baseEmissive: number | null = null;

  private readonly v = new Vector3();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly m = new Matrix4();

  constructor(object: Object3D) {
    this.object = object;
    this.recaptureRest();
  }

  recaptureRest(): void {
    this.restPosition.copy(this.object.position);
    this.restQuaternion.copy(this.object.quaternion);
    this.restScale.copy(this.object.scale);
  }

  getWorldPose(): PoseTuple {
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

  setWorldPose(pose: PoseTuple): void {
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
