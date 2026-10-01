/**
 * Every trace replays through all five bindings' own hit testers and
 * transform ports, and must match the reference outcome within
 * `TRACE_TOLERANCES`. The synthetic traces are made here, one per playground
 * mechanic and input: they prove the pipeline and the ports' obedience to
 * the contract, not parity with a device. Traces recorded on a device prove
 * parity. They are run output, so they live outside the repository: set
 * `RC_TRACES_DIR` to their folder and every trace in it replays too.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { Mesh, Object3D, Sphere, SphereGeometry, Vector3 } from "three";
import type { Entity, World } from "@iwsdk/core";
import {
  isInteractionTrace,
  quatMultiply,
  rayPointDistance,
  surfacePointOnSphere,
  synthesizeTrace,
  traceParityCases,
  vAdd,
  vApplyQuat,
  type HitTester,
  type PhysicsFacility,
  type InteractionTrace,
  type PoseTuple,
  type QuatTuple,
  type RayTuple,
  type SyntheticMechanic,
  type TraceReplaySubject,
  type TransformPort,
  type Vec3Tuple,
} from "@realitycollective/webxr-interactions";
import { BabylonHitTester, BabylonTransformPort } from "@realitycollective/babylon-interactions";
import { ThreeHitTester, ThreeTransformPort } from "@realitycollective/threejs-interactions";
import { IWSDKTransformPort, registerInteractions } from "@realitycollective/iwsdk-interactions";
import { ThreeHitTester as XRBlocksHitTester, XRBlocksTransformPort } from "@realitycollective/xrblocks-interactions";
import { NativeHitTester, NativeTransformPort, type NativeHit } from "@realitycollective/native-interactions";
import { FakeNode } from "../../babylon-interactions/test/helpers.js";
import { FakeInteractionHost } from "../../native-interactions/test/helpers.js";
import { FakeSession, makeWorld } from "./helpers.js";

const mechanics: SyntheticMechanic[] = ["press", "grab-throw", "dial", "slide", "hinge"];
const inputs = ["hands", "controllers"] as const;
const synthetic = mechanics.flatMap((mechanic) => inputs.map((input) => synthesizeTrace({ mechanic, input })));

const recordedDir = process.env.RC_TRACES_DIR;
const recorded: InteractionTrace[] = recordedDir
  ? readdirSync(recordedDir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => JSON.parse(readFileSync(join(recordedDir, file), "utf8")) as unknown)
      .filter(isInteractionTrace)
  : [];

const traces: InteractionTrace[] = [...synthetic, ...recorded];

type Built = { ports: Record<string, TransformPort> };

/**
 * A body facility with no gravity and no stepping: it suspends and resumes,
 * and writes poses through to the object. A port only exposes
 * `beginHold` / `endHold` when it has a body, and the replay reads the throw
 * from `endHold`, so every platform needs one. The reference outcome is
 * recorded over memory ports that do not simulate flight either.
 */
function bodyFacility(read: () => PoseTuple, write: (pose: PoseTuple) => void): PhysicsFacility {
  let held = false;
  return {
    engine: "fake",
    getGravity: () => [0, 0, 0],
    setGravity: () => undefined,
    addBody: () => undefined,
    removeBody: () => undefined,
    hasBody: () => true,
    setBodyState: () => undefined,
    getBodyState: () => "dynamic",
    getBodyPose: () => read(),
    setBodyPose: (_id, pose) => write(pose),
    getVelocity: () => ({ linear: [0, 0, 0], angular: [0, 0, 0] }),
    setVelocity: () => undefined,
    suspend() {
      held = true;
    },
    resume() {
      held = false;
    },
    isSuspended: () => held,
    step: () => undefined,
    dispose: () => undefined,
  };
}

function objectFacility(object: Object3D): PhysicsFacility {
  return bodyFacility(
    () => ({ position: [object.position.x, object.position.y, object.position.z], quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w] }),
    (pose) => {
      object.position.set(...pose.position);
      object.quaternion.set(...pose.quaternion);
    },
  );
}

/**
 * A sphere mesh of the given radius. The geometry is a unit sphere scaled to the radius, with its
 * bounding sphere set exactly, as an asset that ships authored bounds does. Left to be computed,
 * 32-bit vertices make a 0.06 sphere read 0.0600000017, and a fingertip exactly on the touch
 * boundary (which the synthetic press script places there) crosses it one frame early. That is
 * the geometry's precision, not a port.
 */
function meshAt(pose: PoseTuple, radius: number): Mesh {
  const geometry = new SphereGeometry(1, 64, 32);
  geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), 1);
  const mesh = new Mesh(geometry);
  mesh.scale.setScalar(radius);
  mesh.position.set(...pose.position);
  mesh.quaternion.set(...pose.quaternion);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function threeSubject(): TraceReplaySubject {
  const hitTester = new ThreeHitTester();
  return {
    runtimeOptions: () => ({ hitTester }),
    build(trace, runtime): Built {
      const ports: Record<string, TransformPort> = {};
      for (const target of trace.targets) {
        const mesh = meshAt(target.restPose, target.radius);
        hitTester.register(target.descriptor.id, mesh, target.radius);
        const port = new ThreeTransformPort(mesh, { physics: { facility: objectFacility(mesh), bodyId: target.descriptor.id } });
        runtime.registerInteractable(target.descriptor, { transform: port });
        ports[target.descriptor.id] = port;
      }
      return { ports };
    },
  };
}

function xrBlocksSubject(): TraceReplaySubject {
  const hitTester = new XRBlocksHitTester();
  return {
    runtimeOptions: () => ({ hitTester }),
    build(trace, runtime): Built {
      const ports: Record<string, TransformPort> = {};
      for (const target of trace.targets) {
        const mesh = meshAt(target.restPose, target.radius);
        hitTester.register(target.descriptor.id, mesh, target.radius);
        const port = new XRBlocksTransformPort(mesh, { physics: { facility: objectFacility(mesh), bodyId: target.descriptor.id } });
        runtime.registerInteractable(target.descriptor, { transform: port });
        ports[target.descriptor.id] = port;
      }
      return { ports };
    },
  };
}

function babylonSubject(): TraceReplaySubject {
  const hitTester = new BabylonHitTester({ defaultRadius: 0.1 });
  return {
    runtimeOptions: () => ({ hitTester }),
    build(trace, runtime): Built {
      const ports: Record<string, TransformPort> = {};
      for (const target of trace.targets) {
        // No absolutePosition override: the node reports its live position, which the port moves.
        const node = new FakeNode({ position: [...target.restPose.position], rotationQuaternion: [...target.restPose.quaternion] });
        hitTester.register(target.descriptor.id, node, target.radius);
        const port: BabylonTransformPort = new BabylonTransformPort(node, {
          physics: {
            facility: bodyFacility(
              () => port.getWorldPose(),
              (pose) => {
                node.position.x = pose.position[0];
                node.position.y = pose.position[1];
                node.position.z = pose.position[2];
              },
            ),
            bodyId: target.descriptor.id,
          },
        });
        runtime.registerInteractable(target.descriptor, { transform: port });
        ports[target.descriptor.id] = port;
      }
      return { ports };
    },
  };
}

function iwsdkSubject(): TraceReplaySubject {
  const world = makeWorld({ session: new FakeSession() });
  const host = registerInteractions(world as unknown as World);
  // The same private tester the host queries every frame; it reads each entity's object3D live.
  const hitTester = (host as unknown as { hitTester: HitTester & { register(id: string, entity: Entity, radius: number): void } }).hitTester;
  return {
    runtimeOptions: () => ({ hitTester }),
    build(trace, runtime): Built {
      const ports: Record<string, TransformPort> = {};
      for (const target of trace.targets) {
        const object = new Object3D();
        object.position.set(...target.restPose.position);
        object.quaternion.set(...target.restPose.quaternion);
        const entity = { object3D: object, hasComponent: () => false, addComponent: () => undefined } as unknown as Entity;
        hitTester.register(target.descriptor.id, entity, target.radius);
        const port = new IWSDKTransformPort(object, { physics: { facility: objectFacility(object), bodyId: target.descriptor.id } });
        runtime.registerInteractable(target.descriptor, { transform: port });
        ports[target.descriptor.id] = port;
      }
      return { ports };
    },
  };
}

const IDENTITY: PoseTuple = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };

function clonePose(pose: PoseTuple): PoseTuple {
  return { position: [...pose.position], quaternion: [...pose.quaternion] };
}

/** A native host slice that answers queries against each target's LIVE pose, as a real host does. */
class LiveGeometryHost extends FakeInteractionHost {
  private readonly radii = new Map<string, number>();
  private readonly rests = new Map<string, PoseTuple>();
  private readonly lives = new Map<string, PoseTuple>();

  constructor() {
    super({ setWorldPose: true, setEffect: true, physics: true });
  }

  protected override writeLivePose(targetId: string, pose: PoseTuple): void {
    this.lives.set(targetId, clonePose(pose));
  }

  placeTarget(id: string, rest: PoseTuple, radius: number): void {
    this.rests.set(id, clonePose(rest));
    this.lives.set(id, clonePose(rest));
    this.radii.set(id, radius);
  }

  override getWorldPose(id: string): PoseTuple {
    return clonePose(this.lives.get(id) ?? IDENTITY);
  }

  override getRestWorldPose(id: string): PoseTuple {
    return clonePose(this.rests.get(id) ?? IDENTITY);
  }

  private readonly localOffsets = new Map<string, Vec3Tuple>();

  override getLocalOffset(id: string): Vec3Tuple {
    return [...(this.localOffsets.get(id) ?? [0, 0, 0])];
  }

  /** The host moves the drawn object: rest position plus the offset, turned by the rest rotation. */
  override setLocalOffset(id: string, offset: Vec3Tuple): void {
    this.localOffsets.set(id, [...offset]);
    const rest = this.getRestWorldPose(id);
    const live = this.getWorldPose(id);
    live.position = vAdd(rest.position, vApplyQuat(offset, rest.quaternion));
    this.lives.set(id, live);
  }

  /** The rotation is composed onto the rest rotation. */
  override setLocalRotation(id: string, quaternion: QuatTuple): void {
    const rest = this.getRestWorldPose(id);
    const live = this.getWorldPose(id);
    live.quaternion = quatMultiply(rest.quaternion, quaternion);
    this.lives.set(id, live);
  }

  override hitRay(ray: RayTuple): NativeHit | null {
    let best: NativeHit | null = null;
    for (const [id, radius] of this.radii) {
      const centre = this.getWorldPose(id).position;
      const { distance, t } = rayPointDistance(ray, centre);
      if (t <= 0 || distance > radius) continue;
      if (best === null || t < best.distance) best = { targetId: id, distance: t, point: centre };
    }
    return best;
  }

  override hitProximity(point: Vec3Tuple, radius: number): NativeHit | null {
    let best: NativeHit | null = null;
    for (const [id, targetRadius] of this.radii) {
      const centre = this.getWorldPose(id).position;
      const distance = Math.max(0, Math.hypot(centre[0] - point[0], centre[1] - point[1], centre[2] - point[2]) - targetRadius);
      if (distance > radius) continue;
      if (best === null || distance < best.distance) best = { targetId: id, distance, point: surfacePointOnSphere(centre, targetRadius, point) };
    }
    return best;
  }
}

function nativeSubject(): TraceReplaySubject {
  const host = new LiveGeometryHost();
  const hitTester = new NativeHitTester({ interactions: host });
  return {
    runtimeOptions: () => ({ hitTester }),
    build(trace, runtime): Built {
      const ports: Record<string, TransformPort> = {};
      for (const target of trace.targets) {
        host.placeTarget(target.descriptor.id, target.restPose, target.radius);
        const port = new NativeTransformPort(target.descriptor.id, { interactions: host });
        runtime.registerInteractable(target.descriptor, { transform: port });
        ports[target.descriptor.id] = port;
      }
      return { ports };
    },
  };
}

const platforms: Array<[string, () => TraceReplaySubject]> = [
  ["threejs", threeSubject],
  ["babylon", babylonSubject],
  ["iwsdk", iwsdkSubject],
  ["xrblocks", xrBlocksSubject],
  ["native", nativeSubject],
];

describe("traces", () => {
  it("synthesizes one trace per mechanic and input", () => {
    if (synthetic.length !== mechanics.length * inputs.length) throw new Error(`expected ${mechanics.length * inputs.length} synthetic traces, made ${synthetic.length}`);
  });

  it.runIf(recordedDir)("finds a recorded trace in RC_TRACES_DIR", () => {
    if (recorded.length === 0) throw new Error(`no rc-trace.v1 files found in ${recordedDir}`);
  });
});

describe.each(platforms)("%s trace parity", (_name, build) => {
  for (const traceCase of traceParityCases(traces)) {
    it(traceCase.name, () => traceCase.run(build()));
  }
});
