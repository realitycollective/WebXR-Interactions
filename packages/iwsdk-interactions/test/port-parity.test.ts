/**
 * Every adapter implements the same `HitTester` and `TransformPort`
 * contracts, the same idea as `provider-parity.test.ts` for `InputProvider`.
 *
 * The checks are the shared suites shipped by `@realitycollective/webxr-interactions`
 * (`hitTesterContractCases()`, `transformPortContractCases()`), so this file
 * only builds the five instances of each port; the InputProvider parity
 * file's header explains why that split matters.
 *
 * XR Blocks is included for completeness, but it has no hit tester or
 * transform port of its own: `host.ts` reuses `ThreeHitTester` and
 * `ThreeTransformPort` wholesale (XR Blocks Scripts are ordinary three.js
 * `Object3D`s), so its row exercises the exact classes the three.js row does.
 */
import { describe, it } from "vitest";
import { Group, Mesh, Object3D, SphereGeometry } from "three";
import type { Entity, World } from "@iwsdk/core";
import {
  surfacePointOnSphere,
  hitTesterContractCases,
  nearPointerContractCases,
  transformPortContractCases,
  type HitTester,
  type HitTesterContractSubject,
  type PhysicsFacility,
  type PoseTuple,
  type QuatTuple,
  type RayTuple,
  type TransformPortContractSubject,
  type Vec3Tuple,
  quatMultiply,
  vAdd,
  vApplyQuat,
} from "@realitycollective/webxr-interactions";
import { BabylonHitTester, BabylonTransformPort } from "@realitycollective/babylon-interactions";
import { ThreeHitTester, ThreeTransformPort } from "@realitycollective/threejs-interactions";
import { IWSDKTransformPort, registerInteractions } from "@realitycollective/iwsdk-interactions";
import {
  ThreeHitTester as XRBlocksHitTester,
  XRBlocksTransformPort,
} from "@realitycollective/xrblocks-interactions";
import { NativeHitTester, NativeTransformPort, type NativeHit } from "@realitycollective/native-interactions";
import { FakeNode, PHYSICS_MOTION_TYPES } from "../../babylon-interactions/test/helpers.js";
import { FakeInteractionHost } from "../../native-interactions/test/helpers.js";
import { FakeRapierRigidBody, RAPIER_BODY_TYPES } from "../../xrblocks-interactions/test/helpers.js";
import { FakeSession, makeWorld } from "./helpers.js";

/** An entity with just what `IWSDKInteractions.register` and its hit tester read. */
function fakeEntity(object: Object3D): Entity {
  return {
    object3D: object,
    hasComponent: () => false,
    addComponent: () => undefined,
  } as unknown as Entity;
}

/**
 * A native `interactions` slice that answers ray/proximity queries against
 * real registered geometry, rather than the canned single answer
 * `FakeInteractionHost` gives its own suite. `NativeHitTester` and
 * `NativeTransformPort` do nothing but forward to this slice, so a
 * conformance run against them is only meaningful if the slice itself
 * behaves like a real host's would - `EntityHitTester` in `register.ts` is
 * the model for the ray/proximity maths, reusing the same
 * `rayPointDistance`/`vDistance` helpers every other platform's tester is
 * built on.
 */
class GeometricInteractionHost extends FakeInteractionHost {
  private readonly targets = new Map<string, { position: Vec3Tuple; radius: number }>();
  private readonly localOffsets = new Map<string, Vec3Tuple>();
  private readonly rests = new Map<string, PoseTuple>();
  private readonly lives = new Map<string, PoseTuple>();

  constructor(capable: { setWorldPose?: boolean; setEffect?: boolean; physics?: boolean } = {}) {
    super(capable);
    if (capable.setWorldPose) {
      this.setWorldPose = (targetId, pose) => {
        this.lives.set(targetId, clonePose(pose));
        this.clearVelocityIfNotHeld(targetId);
      };
    }
  }

  /** `step()`/the base's `setWorldPose` write live poses here instead of the base's own `poses` map. */
  protected override writeLivePose(targetId: string, pose: PoseTuple): void {
    this.lives.set(targetId, clonePose(pose));
  }

  /** Register an object at a rest pose, as the native scene would. */
  registerAt(targetId: string, rest: PoseTuple): void {
    this.rests.set(targetId, clonePose(rest));
    this.lives.set(targetId, clonePose(rest));
  }

  place(id: string, position: Vec3Tuple, radius: number): void {
    this.targets.set(id, { position, radius });
  }

  override hitRay(ray: RayTuple): NativeHit | null {
    let best: NativeHit | null = null;
    for (const [id, target] of this.targets) {
      const toPoint: Vec3Tuple = [
        target.position[0] - ray.origin[0],
        target.position[1] - ray.origin[1],
        target.position[2] - ray.origin[2],
      ];
      const t =
        toPoint[0] * ray.direction[0] + toPoint[1] * ray.direction[1] + toPoint[2] * ray.direction[2];
      if (t <= 0) continue;
      const closest: Vec3Tuple = [
        ray.origin[0] + ray.direction[0] * t,
        ray.origin[1] + ray.direction[1] * t,
        ray.origin[2] + ray.direction[2] * t,
      ];
      const distance = dist(closest, target.position);
      if (distance > target.radius) continue;
      if (best === null || t < best.distance) best = { targetId: id, distance: t, point: target.position };
    }
    return best;
  }

  override hitProximity(point: Vec3Tuple, radius: number): NativeHit | null {
    let best: NativeHit | null = null;
    for (const [id, target] of this.targets) {
      const distance = Math.max(0, dist(point, target.position) - target.radius);
      if (distance > radius) continue;
      if (best === null || distance < best.distance) best = { targetId: id, distance, point: surfacePointOnSphere(target.position, target.radius, point) };
    }
    return best;
  }

  override getWorldPose(targetId: string): PoseTuple {
    return clonePose(this.lives.get(targetId) ?? IDENTITY_POSE);
  }

  override getRestWorldPose(targetId: string): PoseTuple {
    return clonePose(this.rests.get(targetId) ?? IDENTITY_POSE);
  }

  override getLocalOffset(targetId: string): Vec3Tuple {
    return [...(this.localOffsets.get(targetId) ?? [0, 0, 0])];
  }

  override setLocalOffset(targetId: string, offset: Vec3Tuple): void {
    this.localOffsets.set(targetId, [...offset]);
    const rest = this.rests.get(targetId) ?? IDENTITY_POSE;
    const live = clonePose(this.lives.get(targetId) ?? rest);
    live.position = vAdd(rest.position, vApplyQuat(offset, rest.quaternion));
    this.lives.set(targetId, live);
  }

  override setLocalRotation(targetId: string, quaternion: QuatTuple): void {
    const rest = this.rests.get(targetId) ?? IDENTITY_POSE;
    const live = clonePose(this.lives.get(targetId) ?? rest);
    live.quaternion = quatMultiply(rest.quaternion, quaternion);
    this.lives.set(targetId, live);
  }
}

const IDENTITY_POSE: PoseTuple = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };

function clonePose(pose: PoseTuple): PoseTuple {
  return { position: [...pose.position], quaternion: [...pose.quaternion] };
}

function dist(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ---------------------------------------------------------------------------
// HitTester
// ---------------------------------------------------------------------------

function threeHitTesterSubject(): HitTesterContractSubject {
  const hitTester = new ThreeHitTester();
  return {
    hitTester,
    driver: {
      place(id, position, radius) {
        const mesh = new Mesh(new SphereGeometry(radius, 8, 8));
        mesh.position.set(position[0], position[1], position[2]);
        mesh.updateMatrixWorld(true);
        hitTester.register(id, mesh);
      },
      placeBare(id, position) {
        const group = new Group();
        group.position.set(position[0], position[1], position[2]);
        group.updateMatrixWorld(true);
        hitTester.register(id, group);
      },
      setVisible(id, visible) {
        const object = hitTester.getObject(id);
        if (object) object.visible = visible;
      },
    },
  };
}

function babylonHitTesterSubject(): HitTesterContractSubject {
  const hitTester = new BabylonHitTester({ defaultRadius: 0.1 });
  return {
    hitTester,
    driver: {
      place(id, position, radius) {
        hitTester.register(id, new FakeNode({ absolutePosition: [...position] }), radius);
      },
      placeBare(id, position) {
        hitTester.register(id, new FakeNode({ absolutePosition: [...position] }));
      },
      setVisible(id, visible) {
        hitTester.getNode(id)?.setEnabled?.(visible);
      },
    },
  };
}

function iwsdkHitTesterSubject(): HitTesterContractSubject {
  const world = makeWorld({ session: new FakeSession() });
  const host = registerInteractions(world as unknown as World);
  // `EntityHitTester` is private to register.ts - the same instance the host
  // queries every frame, reached the same way a private field is reached in
  // any of this repository's structural-fake tests.
  const hitTester = (host as unknown as { hitTester: HitTester }).hitTester;
  const objects = new Map<string, Object3D>();
  return {
    hitTester,
    driver: {
      place(id, position, radius) {
        const object = new Object3D();
        object.position.set(position[0], position[1], position[2]);
        objects.set(id, object);
        host.register({ id, behaviours: [] }, fakeEntity(object), {
          addInteractables: false,
          targetRadius: radius,
        });
      },
      placeBare(id, position) {
        const object = new Object3D();
        object.position.set(position[0], position[1], position[2]);
        objects.set(id, object);
        host.register({ id, behaviours: [] }, fakeEntity(object), { addInteractables: false });
      },
      setVisible(id, visible) {
        const object = objects.get(id);
        if (object) object.visible = visible;
      },
    },
  };
}

function xrBlocksHitTesterSubject(): HitTesterContractSubject {
  const hitTester = new XRBlocksHitTester();
  return {
    hitTester,
    driver: {
      place(id, position, radius) {
        const mesh = new Mesh(new SphereGeometry(radius, 8, 8));
        mesh.position.set(position[0], position[1], position[2]);
        mesh.updateMatrixWorld(true);
        hitTester.register(id, mesh);
      },
      placeBare(id, position) {
        const group = new Group();
        group.position.set(position[0], position[1], position[2]);
        group.updateMatrixWorld(true);
        hitTester.register(id, group);
      },
      setVisible(id, visible) {
        const object = hitTester.getObject(id);
        if (object) object.visible = visible;
      },
    },
  };
}

function nativeHitTesterSubject(): HitTesterContractSubject {
  const host = new GeometricInteractionHost();
  return {
    hitTester: new NativeHitTester({ interactions: host }),
    driver: { place: (id, position, radius) => host.place(id, position, radius) },
  };
}

const hitTesterPlatforms: Array<[string, () => HitTesterContractSubject]> = [
  ["threejs", threeHitTesterSubject],
  ["babylon", babylonHitTesterSubject],
  ["iwsdk", iwsdkHitTesterSubject],
  ["xrblocks", xrBlocksHitTesterSubject],
  ["native", nativeHitTesterSubject],
];

describe.each(hitTesterPlatforms)("%s HitTester", (_name, build) => {
  for (const contractCase of hitTesterContractCases()) {
    it(contractCase.name, () => contractCase.run(build()));
  }
});

// The near-pointer rule (touch press, grip grab, pointer priority, ray and
// cursor visuals) over every platform's own hit tester: the same subjects,
// driven by the core runtime inside the suite.
describe.each(hitTesterPlatforms)("%s near pointers", (_name, build) => {
  for (const contractCase of nearPointerContractCases()) {
    it(contractCase.name, () => contractCase.run(build()));
  }
});

// ---------------------------------------------------------------------------
// TransformPort
// ---------------------------------------------------------------------------

/**
 * Every port starts at the same rest pose: away from the origin and turned a
 * quarter about Y, so a port that ignores its rest frame cannot pass.
 */
const REST_POSE: PoseTuple = { position: [1, 0.5, -2], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };

function objectAtRest(): Object3D {
  const object = new Object3D();
  object.position.set(...REST_POSE.position);
  object.quaternion.set(...REST_POSE.quaternion);
  return object;
}

function nativeTransformPortSubject(): TransformPortContractSubject {
  const host = new GeometricInteractionHost({ setWorldPose: true, setEffect: true, physics: true });
  host.registerAt("target", REST_POSE);
  return {
    port: new NativeTransformPort("target", { interactions: host }),
    rest: REST_POSE,
    physics: { step: (dt) => host.step("target", dt) },
  };
}

/**
 * A fake `PhysicsFacility` for the held/released/reset contract cases -
 * gravity-integrated over the SAME object3D the port writes, the same idea
 * as `physics-binding.test.ts`'s fake `PhysicsSystem` but faithful to what
 * a real Havok body would do frame to frame, since these cases step it
 * repeatedly. Only `setBodyPose`/`suspend`/`resume` are ones the port itself
 * calls; the rest of the interface is filled in trivially. The real
 * facility (`IWSDKPhysicsFacility`, built from
 * `PhysicsBody`/`PhysicsShape`/`PhysicsManipulation`/`PhysicsSystem`) is
 * exercised for real - against fakes of THOSE, not against Havok, which
 * this package's tests cannot stand up - in `physics-binding.test.ts`.
 */
function fakeIWSDKPhysics(object: Object3D): { facility: PhysicsFacility; step(dtSeconds: number): void } {
  let held = false;
  let velocity: Vec3Tuple = [0, 0, 0];
  const facility: PhysicsFacility = {
    engine: "fake",
    getGravity: () => [0, -9.8, 0],
    setGravity: () => undefined,
    addBody: () => undefined,
    removeBody: () => undefined,
    hasBody: () => true,
    setBodyState: () => undefined,
    getBodyState: () => "dynamic",
    getBodyPose: () => ({
      position: [object.position.x, object.position.y, object.position.z],
      quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
    }),
    setBodyPose(_id, pose) {
      object.position.set(pose.position[0], pose.position[1], pose.position[2]);
      object.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
      velocity = [0, 0, 0];
    },
    getVelocity: () => ({ linear: [...velocity], angular: [0, 0, 0] }),
    setVelocity: () => undefined,
    suspend() {
      held = true;
    },
    resume(_id, release) {
      held = false;
      velocity = [...release.linearVelocity];
    },
    isSuspended: () => held,
    step: () => undefined,
    dispose: () => undefined,
  };
  return {
    facility,
    step(dtSeconds) {
      if (held) return;
      velocity = [velocity[0], velocity[1] - 9.8 * dtSeconds, velocity[2]];
      object.position.x += velocity[0] * dtSeconds;
      object.position.y += velocity[1] * dtSeconds;
      object.position.z += velocity[2] * dtSeconds;
    },
  };
}

function iwsdkTransformPortSubject(): TransformPortContractSubject {
  const object = objectAtRest();
  const { facility, step } = fakeIWSDKPhysics(object);
  return {
    port: new IWSDKTransformPort(object, { physics: { facility, bodyId: "obj" } }),
    rest: REST_POSE,
    physics: { step },
  };
}

function babylonTransformPortSubject(): TransformPortContractSubject {
  const node = new FakeNode({
    position: REST_POSE.position,
    rotationQuaternion: REST_POSE.quaternion,
    physics: true,
  });
  return {
    port: new BabylonTransformPort(node, { physicsMotionTypes: PHYSICS_MOTION_TYPES }),
    rest: REST_POSE,
    physics: { step: (dt) => node.physicsBody!.step(dt) },
  };
}

/**
 * XR Blocks bundles RAPIER, so `XRBlocksTransformPort` gets the
 * same held/released/reset proof every physics-backed platform does, over a
 * `FakeRapierRigidBody` - the same reason `babylonTransformPortSubject`
 * fakes a Havok body instead of depending on one.
 */
function xrBlocksTransformPortSubject(): TransformPortContractSubject {
  const object = objectAtRest();
  const body = new FakeRapierRigidBody(object);
  return {
    port: new XRBlocksTransformPort(object, { rigidBody: body, rigidBodyTypes: RAPIER_BODY_TYPES }),
    rest: REST_POSE,
    physics: { step: (dt) => body.step(dt) },
  };
}

const transformPortPlatforms: Array<[string, () => TransformPortContractSubject]> = [
  ["threejs", () => ({ port: new ThreeTransformPort(objectAtRest()), rest: REST_POSE })],
  ["babylon", babylonTransformPortSubject],
  ["iwsdk", iwsdkTransformPortSubject],
  ["xrblocks", xrBlocksTransformPortSubject],
  ["native", nativeTransformPortSubject],
];

describe.each(transformPortPlatforms)("%s TransformPort", (_name, build) => {
  for (const contractCase of transformPortContractCases()) {
    it(contractCase.name, () => contractCase.run(build()));
  }
});
