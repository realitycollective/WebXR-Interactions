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
import { Mesh, Object3D, SphereGeometry } from "three";
import type { Entity, World } from "@iwsdk/core";
import {
  hitTesterContractCases,
  transformPortContractCases,
  type HitTester,
  type HitTesterContractSubject,
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
  ThreeTransformPort as XRBlocksTransformPort,
} from "@realitycollective/xrblocks-interactions";
import { NativeHitTester, NativeTransformPort, type NativeHit } from "@realitycollective/native-interactions";
import { FakeNode } from "../../babylon-interactions/test/helpers.js";
import { FakeInteractionHost } from "../../native-interactions/test/helpers.js";
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

  constructor(capable: { setWorldPose?: boolean; setEffect?: boolean } = {}) {
    super(capable);
    if (capable.setWorldPose) {
      this.setWorldPose = (targetId, pose) => this.lives.set(targetId, clonePose(pose));
    }
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
      if (best === null || distance < best.distance) best = { targetId: id, distance, point: target.position };
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
  return {
    hitTester,
    driver: {
      place(id, position, radius) {
        const object = new Object3D();
        object.position.set(position[0], position[1], position[2]);
        host.register({ id, behaviours: [] }, fakeEntity(object), {
          addInteractables: false,
          targetRadius: radius,
        });
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

function nativePortAtRest(): NativeTransformPort {
  const host = new GeometricInteractionHost({ setWorldPose: true, setEffect: true });
  host.registerAt("target", REST_POSE);
  return new NativeTransformPort("target", { interactions: host });
}

const transformPortPlatforms: Array<[string, () => TransformPortContractSubject]> = [
  ["threejs", () => ({ port: new ThreeTransformPort(objectAtRest()), rest: REST_POSE })],
  [
    "babylon",
    () => ({
      port: new BabylonTransformPort(
        new FakeNode({ position: REST_POSE.position, rotationQuaternion: REST_POSE.quaternion }),
      ),
      rest: REST_POSE,
    }),
  ],
  ["iwsdk", () => ({ port: new IWSDKTransformPort(objectAtRest()), rest: REST_POSE })],
  ["xrblocks", () => ({ port: new XRBlocksTransformPort(objectAtRest()), rest: REST_POSE })],
  ["native", () => ({ port: nativePortAtRest(), rest: REST_POSE })],
];

describe.each(transformPortPlatforms)("%s TransformPort", (_name, build) => {
  for (const contractCase of transformPortContractCases()) {
    it(contractCase.name, () => contractCase.run(build()));
  }
});
