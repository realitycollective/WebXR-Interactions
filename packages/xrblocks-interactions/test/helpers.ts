/**
 * Structural fakes for the XR Blocks adapter's suites - a RAPIER rigid body
 * standing in for the real `@dimforge/rapier3d-compat`/`rapier3d` one,
 * since this package has no RAPIER dependency to test against for real (see
 * `transform-port.ts`'s own comment on that).
 */
import type { Object3D } from "three";
import type { RapierQuaternionLike, RapierRigidBodyLike, RapierVectorLike } from "@realitycollective/xrblocks-interactions";

/** The two body-type tokens the fake understands - any two distinct values would do. */
export const RAPIER_BODY_TYPES = { kinematicPositionBased: "KINEMATIC", dynamic: "DYNAMIC" } as const;
export type FakeRapierBodyType = (typeof RAPIER_BODY_TYPES)[keyof typeof RAPIER_BODY_TYPES];

/**
 * A fake RAPIER body over the SAME `Object3D` its port writes - the same
 * idea as `babylon-interactions`' `FakePhysicsBody`, which moves the node
 * it was built with rather than keeping its own separate reading. A real
 * body has no such reference (`RapierRigidBodyLike` never reads one back;
 * see its own comment), but the app's per-frame sync would move this exact
 * object from the body's simulated pose, and this fake plays that part too
 * so `step()` is a faithful stand-in for it.
 *
 * `step()` is a faithful-enough gravity simulation for the held/released/
 * reset contract cases: gravity moves the object while the body is
 * DYNAMIC, not while KINEMATIC (held), the same rule the real RAPIER body
 * types name.
 */
export class FakeRapierRigidBody implements RapierRigidBodyLike {
  bodyType: FakeRapierBodyType = RAPIER_BODY_TYPES.dynamic;
  private linvel: RapierVectorLike = { x: 0, y: 0, z: 0 };
  readonly bodyTypeWrites: FakeRapierBodyType[] = [];

  constructor(private readonly object: Object3D) {}

  setTranslation(translation: RapierVectorLike): void {
    this.object.position.set(translation.x, translation.y, translation.z);
  }

  setRotation(rotation: RapierQuaternionLike): void {
    this.object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  setLinvel(velocity: RapierVectorLike): void {
    this.linvel = { ...velocity };
  }

  setAngvel(): void {
    // Unread by the held/released/reset contract cases - nothing to fake.
  }

  setBodyType(bodyType: unknown): void {
    this.bodyType = bodyType as FakeRapierBodyType;
    this.bodyTypeWrites.push(this.bodyType);
  }

  /** Gravity, for one step, skipped unless the body is DYNAMIC. */
  step(dtSeconds: number): void {
    if (this.bodyType !== RAPIER_BODY_TYPES.dynamic) return;
    this.linvel = { ...this.linvel, y: this.linvel.y - 9.8 * dtSeconds };
    this.object.position.x += this.linvel.x * dtSeconds;
    this.object.position.y += this.linvel.y * dtSeconds;
    this.object.position.z += this.linvel.z * dtSeconds;
  }
}
