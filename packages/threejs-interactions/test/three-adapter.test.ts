import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  SphereGeometry,
} from "three";
import {
  ThreeHitTester,
  ThreeTransformPort,
  WebXRInputProvider,
  type InputSourceSnapshotWithVelocity,
} from "@realitycollective/threejs-interactions";

describe("ThreeHitTester", () => {
  it("resolves ray hits to the registered root, nearest first", () => {
    const tester = new ThreeHitTester();
    const near = new Mesh(new BoxGeometry(0.2, 0.2, 0.2));
    near.position.set(0, 0, -1);
    const far = new Mesh(new BoxGeometry(0.2, 0.2, 0.2));
    far.position.set(0, 0, -3);
    near.updateMatrixWorld(true);
    far.updateMatrixWorld(true);
    tester.register("near", near);
    tester.register("far", far);

    const hit = tester.hitRay({ origin: [0, 0, 0], direction: [0, 0, -1] });
    expect(hit?.interactableId).toBe("near");

    tester.unregister("near");
    const second = tester.hitRay({ origin: [0, 0, 0], direction: [0, 0, -1] });
    expect(second?.interactableId).toBe("far");
  });

  it("walks up from child meshes to the registered group", () => {
    const tester = new ThreeHitTester();
    const group = new Group();
    const child = new Mesh(new BoxGeometry(0.2, 0.2, 0.2));
    group.add(child);
    group.position.set(0, 0, -2);
    group.updateMatrixWorld(true);
    tester.register("station", group);
    const hit = tester.hitRay({ origin: [0, 0, 0], direction: [0, 0, -1] });
    expect(hit?.interactableId).toBe("station");
  });

  it("proximity accounts for the bounding radius", () => {
    const tester = new ThreeHitTester();
    const ball = new Mesh(new SphereGeometry(0.1));
    ball.position.set(0, 1, 0);
    ball.updateMatrixWorld(true);
    tester.register("ball", ball);
    // 0.12 m from the centre, sphere radius 0.1 → 0.02 from the surface.
    expect(tester.hitProximity([0, 1.12, 0], 0.05)?.interactableId).toBe("ball");
    expect(tester.hitProximity([0, 1.5, 0], 0.05)).toBeNull();
  });
});

describe("ThreeTransformPort", () => {
  it("applies offsets/rotations from rest and reports the rest world pose", () => {
    const parent = new Object3D();
    parent.position.set(1, 0, 0);
    const object = new Mesh(new BoxGeometry(0.1, 0.1, 0.1));
    object.position.set(0, 1, 0);
    parent.add(object);
    parent.updateMatrixWorld(true);

    const port = new ThreeTransformPort(object);
    const rest = port.getWorldPose();
    expect(rest.position).toEqual([1, 1, 0]);

    port.setLocalOffset([0, -0.02, 0]);
    expect(object.position.y).toBeCloseTo(0.98, 5);
    expect(port.getLocalOffset()[1]).toBeCloseTo(-0.02, 5);
    // The rest world pose is unaffected by behaviour-applied offsets.
    expect(port.getWorldPose().position).toEqual([1, 1, 0]);

    port.setLocalRotation([0, 0.7071067811865476, 0, 0.7071067811865476]);
    expect(object.quaternion.y).toBeCloseTo(0.7071, 3);
  });

  it("setWorldPose lands the object at the world target under a parent", () => {
    const parent = new Object3D();
    parent.position.set(0, 2, 0);
    const object = new Object3D();
    parent.add(object);
    parent.updateMatrixWorld(true);

    const port = new ThreeTransformPort(object);
    port.setWorldPose({ position: [0.5, 2.5, -1], quaternion: [0, 0, 0, 1] });
    expect(object.position.x).toBeCloseTo(0.5, 5);
    expect(object.position.y).toBeCloseTo(0.5, 5); // parent at y=2
    expect(object.position.z).toBeCloseTo(-1, 5);
  });

  it("scale/emissive effects apply from the captured base", () => {
    const object = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ emissiveIntensity: 1.2 }),
    );
    object.scale.setScalar(2);
    const port = new ThreeTransformPort(object);
    port.setEffect({ scale: 1.25, emissive: 1.5 });
    expect(object.scale.x).toBeCloseTo(2.5, 5);
    expect((object.material as MeshStandardMaterial).emissiveIntensity).toBeCloseTo(2.7, 5);
    port.setEffect({ scale: 1, emissive: 0 });
    expect(object.scale.x).toBeCloseTo(2, 5);
    expect((object.material as MeshStandardMaterial).emissiveIntensity).toBeCloseTo(1.2, 5);
  });
});

describe("WebXRInputProvider presence", () => {
  /** No DOM element, so the provider attaches no listeners and needs no globals. */
  function provider(): WebXRInputProvider {
    const camera = new PerspectiveCamera(70, 4 / 3, 0.05, 100);
    return new WebXRInputProvider({
      xr: { getSession: () => null, getReferenceSpace: () => null, getFrame: () => null },
      camera,
    } as never);
  }

  it("reports no presence until a visual is registered", () => {
    const p = provider();
    expect(p.supportsPresence).toBe(false);
    expect(p.setPresenceVisible("all", false)).toBe(false);
  });

  it("shows and hides registered roots per side", () => {
    const p = provider();
    const left = new Object3D();
    const right = new Object3D();
    p.registerVisual("left", left);
    p.registerVisual("right", right);
    expect(p.supportsPresence).toBe(true);

    expect(p.setPresenceVisible("left", false)).toBe(true);
    expect(left.visible).toBe(false);
    expect(right.visible).toBe(true);

    expect(p.setPresenceVisible("all", false)).toBe(true);
    expect(right.visible).toBe(false);

    expect(p.setPresenceVisible("all", true)).toBe(true);
    expect(left.visible).toBe(true);
    expect(right.visible).toBe(true);
  });

  it("reports failure for a side with no registered visual", () => {
    const p = provider();
    p.registerVisual("left", new Object3D());
    expect(p.setPresenceVisible("right", false)).toBe(false);
    // "none" targets no side; it only answers whether presence is usable.
    expect(p.setPresenceVisible("none", false)).toBe(true);
  });

  it("replaces the root when a side is registered twice", () => {
    const p = provider();
    const first = new Object3D();
    const second = new Object3D();
    p.registerVisual("left", first);
    p.registerVisual("left", second);
    p.setPresenceVisible("left", false);
    expect(first.visible).toBe(true);
    expect(second.visible).toBe(false);
  });

  it("cannot switch modality - it owns neither model family", () => {
    const p = provider();
    p.registerVisual("left", new Object3D());
    expect(p.setPresenceModality("hands")).toBe(false);
  });
});

describe("WebXRInputProvider native velocity", () => {
  /**
   * The browser may report velocity alongside a pose. When it does the provider
   * passes it straight through, and the core's tracker leaves it alone. When it
   * does not, the snapshot carries no velocity and the tracker derives one.
   */
  const point = (v: readonly [number, number, number]) => ({ x: v[0], y: v[1], z: v[2] });

  interface Velocities {
    linear?: readonly [number, number, number];
    angular?: readonly [number, number, number];
  }

  /** The slice of XRPose / XRJointPose the provider reads. */
  function pose(position: readonly [number, number, number], velocity: Velocities = {}) {
    return {
      transform: { position: point(position), orientation: { x: 0, y: 0, z: 0, w: 1 } },
      ...(velocity.linear ? { linearVelocity: point(velocity.linear) } : {}),
      ...(velocity.angular ? { angularVelocity: point(velocity.angular) } : {}),
    };
  }

  /** A provider over a live fake session holding one input source. */
  function sample(
    source: Record<string, unknown>,
    poses: Map<object, unknown>,
  ): InputSourceSnapshotWithVelocity {
    const session = {
      inputSources: [source],
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const frame = {
      getPose: (space: object) => poses.get(space),
      getJointPose: (joint: object) => poses.get(joint),
    };
    const provider = new WebXRInputProvider({
      xr: {
        getSession: () => session,
        getReferenceSpace: () => ({}),
        getFrame: () => frame,
      },
      camera: new PerspectiveCamera(70, 4 / 3, 0.05, 100),
    } as never);
    const [snapshot] = provider.sample();
    expect(snapshot).toBeDefined();
    return snapshot as InputSourceSnapshotWithVelocity;
  }

  /** A controller whose grip pose optionally carries velocity. */
  function controllerSample(velocity: Velocities = {}): InputSourceSnapshotWithVelocity {
    const targetRaySpace = {};
    const gripSpace = {};
    const poses = new Map<object, unknown>([
      [targetRaySpace, pose([0, 1.5, -0.1])],
      [gripSpace, pose([0.1, 1.2, -0.3], velocity)],
    ]);
    return sample({ handedness: "right", targetRaySpace, gripSpace }, poses);
  }

  /** A hand with no gripSpace, so the wrist joint supplies the carry pose. */
  function wristSample(velocity: Velocities = {}): InputSourceSnapshotWithVelocity {
    const targetRaySpace = {};
    const wrist = {};
    const poses = new Map<object, unknown>([
      [targetRaySpace, pose([0, 1.5, -0.1])],
      [wrist, pose([-0.1, 1.1, -0.2], velocity)],
    ]);
    const hand = new Map<string, object>([["wrist", wrist]]);
    return sample({ handedness: "left", targetRaySpace, hand }, poses);
  }

  it("passes a controller grip pose's velocity through as tuples", () => {
    const snapshot = controllerSample({ linear: [1, 2, 3], angular: [0.4, 0.5, 0.6] });
    expect(snapshot.linearVelocity).toEqual([1, 2, 3]);
    expect(snapshot.angularVelocity).toEqual([0.4, 0.5, 0.6]);
  });

  it("reports no velocity when the browser supplies none", () => {
    const snapshot = controllerSample();
    expect(snapshot.gripPose).toBeDefined();
    // Undefined is the signal the core's VelocityTracker fills in.
    expect(snapshot.linearVelocity).toBeUndefined();
    expect(snapshot.angularVelocity).toBeUndefined();
  });

  it("passes either velocity on its own", () => {
    const linearOnly = controllerSample({ linear: [1, 0, 0] });
    expect(linearOnly.linearVelocity).toEqual([1, 0, 0]);
    expect(linearOnly.angularVelocity).toBeUndefined();

    const angularOnly = controllerSample({ angular: [0, 2, 0] });
    expect(angularOnly.linearVelocity).toBeUndefined();
    expect(angularOnly.angularVelocity).toEqual([0, 2, 0]);
  });

  it("passes the wrist-fallback pose's velocity through the same way", () => {
    const snapshot = wristSample({ linear: [0, -1, 0], angular: [0, 0, 3] });
    expect(snapshot.kind).toBe("hand");
    expect(snapshot.gripPose?.position).toEqual([-0.1, 1.1, -0.2]);
    expect(snapshot.linearVelocity).toEqual([0, -1, 0]);
    expect(snapshot.angularVelocity).toEqual([0, 0, 3]);
  });

  it("reports no velocity from a wrist pose without one", () => {
    const snapshot = wristSample();
    expect(snapshot.gripPose).toBeDefined();
    expect(snapshot.linearVelocity).toBeUndefined();
    expect(snapshot.angularVelocity).toBeUndefined();
  });
});
