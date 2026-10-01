/**
 * Binding cases for eye gaze on standalone three.js: the provider finds the
 * `targetRayMode === "gaze"` source, poses it against the reference space
 * and feeds the core's `EyeGazeInput`; the hit tester answers the cone.
 */
import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, PerspectiveCamera } from "three";
import { EYE_GAZE_SOURCE_ID, type InputSourceSnapshot } from "@realitycollective/webxr-input";
import { ThreeHitTester, WebXRInputProvider } from "@realitycollective/threejs-interactions";

function point(p: readonly [number, number, number]) {
  return { x: p[0], y: p[1], z: p[2] };
}

function pose(position: readonly [number, number, number], orientation: readonly [number, number, number, number] = [0, 0, 0, 1]) {
  return { transform: { position: point(position), orientation: { x: orientation[0], y: orientation[1], z: orientation[2], w: orientation[3] } } };
}

function build(options: { gaze?: boolean; gazePosed?: boolean; throwOnGaze?: boolean; selecting?: boolean } = {}) {
  const rightRay = {};
  const rightGrip = {};
  const gazeSpace = {};
  const right: Record<string, unknown> = { handedness: "right", targetRayMode: "tracked-pointer", targetRaySpace: rightRay, gripSpace: rightGrip };
  const gazeSource = { handedness: "none", targetRayMode: "gaze", targetRaySpace: gazeSpace };
  const listeners = new Map<string, EventListener[]>();
  const session = {
    visibilityState: "visible",
    inputSources: options.gaze === false ? [right] : [right, gazeSource],
    addEventListener: (type: string, l: EventListener) => listeners.set(type, [...(listeners.get(type) ?? []), l]),
    removeEventListener: () => undefined,
  };
  const poses = new Map<object, unknown>([
    [rightRay, pose([0.2, 1.2, -0.2], [0, Math.SQRT1_2, 0, Math.SQRT1_2])],
    [rightGrip, pose([0.2, 1.1, -0.2])],
  ]);
  if (options.gazePosed !== false) poses.set(gazeSpace, pose([0, 1.6, 0]));
  const frame = {
    getPose: (space: object) => {
      if (space === gazeSpace && options.throwOnGaze) throw new Error("unposed");
      return poses.get(space);
    },
    getJointPose: () => undefined,
  };
  const provider = new WebXRInputProvider({
    xr: { getSession: () => session, getReferenceSpace: () => ({}), getFrame: () => frame },
    camera: new PerspectiveCamera(70, 4 / 3, 0.05, 100),
  } as never);
  const fire = (type: string, inputSource: unknown) => {
    for (const l of listeners.get(type) ?? []) l({ inputSource } as never);
  };
  if (options.selecting) fire("selectstart", right);
  return { provider, session, poses, gazeSpace, fire, right };
}

function gazeOf(sources: readonly InputSourceSnapshot[]): InputSourceSnapshot | undefined {
  return sources.find((s) => s.kind === "gaze");
}

describe("WebXRInputProvider eye gaze", () => {
  it("reports eyeGaze from a gaze input source, and not otherwise", () => {
    expect(build().provider.getCapabilities().eyeGaze).toBe(true);
    expect(build({ gaze: false }).provider.getCapabilities().eyeGaze).toBe(false);
  });

  it("does not count the gaze source as a ray or a controller", () => {
    const { provider } = build({ gaze: false });
    const caps = provider.getCapabilities();
    const { provider: withGaze } = build();
    const gazeCaps = withGaze.getCapabilities();
    expect(gazeCaps.rays).toBe(caps.rays);
    expect(gazeCaps.buttonsAxes).toBe(caps.buttonsAxes);
  });

  it("finds a gaze source listed only in trackedSources, once the session binds", () => {
    const { provider, session } = build({ gaze: false });
    expect(provider.getCapabilities().eyeGaze).toBe(false);
    (session as unknown as { trackedSources: unknown[] }).trackedSources = [{ targetRayMode: "gaze", targetRaySpace: {} }];
    // The first sample binds the session and re-derives the capabilities.
    provider.sample();
    expect(provider.getCapabilities().eyeGaze).toBe(true);
  });

  it("poses the gaze source and hands far targeting to it: the controller loses its ray, keeps its grip", () => {
    const sources = build().provider.sample();
    const gaze = gazeOf(sources)!;
    expect(gaze).toMatchObject({ id: EYE_GAZE_SOURCE_ID, handedness: "none", select: 0 });
    expect(gaze.ray).toEqual({ origin: [0, 1.6, 0], direction: [0, 0, -1] });
    const controller = sources.find((s) => s.kind === "controller")!;
    expect(controller.ray).toBeUndefined();
    expect(controller.gripPose).toBeDefined();
    expect(sources.some((s) => s.kind === "gaze" && s.id !== EYE_GAZE_SOURCE_ID)).toBe(false);
  });

  it("keeps far targeting with the controller while the gaze space has no pose, or throws", () => {
    for (const options of [{ gazePosed: false }, { throwOnGaze: true }]) {
      const sources = build(options).provider.sample();
      expect(gazeOf(sources)).toBeUndefined();
      expect(sources.find((s) => s.kind === "controller")!.ray).toBeDefined();
    }
  });

  it("carries the ray-space pose of the selecting hand, orientation included", () => {
    const { provider, fire, right } = build();
    provider.sample();
    fire("selectstart", right);
    const gaze = gazeOf(provider.sample())!;
    expect(gaze.handedness).toBe("right");
    expect(gaze.selectorPose?.position).toEqual([0.2, 1.2, -0.2]);
    expect(gaze.selectorPose?.quaternion[1]).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it("integrates over the delta the host sets", () => {
    const { provider, poses, gazeSpace } = build();
    provider.sample();
    poses.delete(gazeSpace);
    provider.setFrameDelta(6);
    expect(gazeOf(provider.sample())).toBeUndefined();
  });

  it("forgets the gaze state while the session is hidden", () => {
    const { provider, session } = build();
    provider.sample();
    (session as { visibilityState: string }).visibilityState = "hidden";
    expect(provider.sample()).toEqual([]);
    provider.dispose();
  });
});

describe("ThreeHitTester.hitCone", () => {
  const DOWN = { origin: [0, 0, 0] as [number, number, number], direction: [0, 0, -1] as [number, number, number] };
  const DEG = Math.PI / 180;

  function box(x: number, y: number, z: number, size = 0.2): Mesh {
    const mesh = new Mesh(new BoxGeometry(size, size, size));
    mesh.position.set(x, y, z);
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  it("lets a mesh the ray reaches win, at the raycast distance", () => {
    const tester = new ThreeHitTester();
    tester.register("on", box(0, 0, -2));
    tester.register("side", box(0.3, 0, -1, 0.1));
    const hit = tester.hitCone(DOWN, 5 * DEG, 30)!;
    expect(hit.interactableId).toBe("on");
    expect(hit.distance).toBeCloseTo(1.9, 6);
  });

  it("finds a mesh the ray misses inside the cone, by its scaled bounding sphere", () => {
    const tester = new ThreeHitTester();
    const mesh = box(0.35, 0, -3, 0.1);
    mesh.scale.set(2, 2, 2);
    mesh.updateMatrixWorld(true);
    tester.register("near", mesh);
    expect(tester.hitRay(DOWN)).toBeNull();
    expect(tester.hitCone(DOWN, 5 * DEG, 30)?.interactableId).toBe("near");
    expect(tester.hitCone(DOWN, 0.5 * DEG, 30)).toBeNull();
  });

  it("gives a bare group its registered radius, and skips a hidden root", () => {
    const tester = new ThreeHitTester();
    const group = new Group();
    group.position.set(0.15, 0, -2);
    group.updateMatrixWorld(true);
    tester.register("bare", group);
    expect(tester.hitCone(DOWN, 5 * DEG, 30)?.interactableId).toBe("bare");
    group.visible = false;
    expect(tester.hitCone(DOWN, 5 * DEG, 30)).toBeNull();
  });

  it("ignores a raycast hit beyond the length", () => {
    const tester = new ThreeHitTester();
    tester.register("far", box(0, 0, -40));
    expect(tester.hitCone(DOWN, 5 * DEG, 30)).toBeNull();
  });
});
