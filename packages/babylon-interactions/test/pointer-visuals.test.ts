/**
 * The Babylon pointer renderer draws exactly the core's drawing: IWSDK's
 * stub along the source's ray, blue while selecting, and the disc at the
 * hit, and nothing when told nothing. The kit is a set of recording fakes.
 */
import { describe, expect, it } from "vitest";
import {
  BabylonHitTester,
  BabylonPointerVisuals,
  InteractionRuntime,
  MemoryInputProvider,
  createBabylonInteractions,
  type BabylonColor3Like,
  type BabylonPointerMaterialLike,
  type BabylonPointerMeshLike,
  type BabylonPointerVisualsKit,
  type BabylonQuaternionLike,
  type InputSourceSnapshot,
  type PointerDrawing,
} from "@realitycollective/babylon-interactions";
import { FakeNode, FakeScene } from "./helpers.js";

class FakeMaterial implements BabylonPointerMaterialLike {
  emissiveColor: BabylonColor3Like = { r: 0, g: 0, b: 0 };
  diffuseColor: BabylonColor3Like = { r: 0, g: 0, b: 0 };
  alpha = 0;
  disableLighting = false;
  disposed = 0;
  constructor(readonly name: string, readonly scene: unknown) {}
  dispose(): void {
    this.disposed++;
  }
}

class FakeMesh implements BabylonPointerMeshLike {
  position = { x: 0, y: 0, z: 0 };
  rotationQuaternion: BabylonQuaternionLike | null = null;
  scaling = { x: 1, y: 1, z: 1 };
  isVisible = true;
  material: BabylonPointerMaterialLike | null = null;
  renderingGroupId?: number;
  disposed = 0;
  constructor(readonly kind: "cylinder" | "disc", readonly name: string, readonly options: object, readonly scene: unknown) {}
  dispose(): void {
    this.disposed++;
  }
}

function fakeKit() {
  const meshes: FakeMesh[] = [];
  const kit: BabylonPointerVisualsKit = {
    MeshBuilder: {
      CreateCylinder: (name, options, scene) => {
        const mesh = new FakeMesh("cylinder", name, options, scene);
        meshes.push(mesh);
        return mesh;
      },
      CreateDisc: (name, options, scene) => {
        const mesh = new FakeMesh("disc", name, options, scene);
        meshes.push(mesh);
        return mesh;
      },
    },
    StandardMaterial: FakeMaterial,
    Color3: class {
      constructor(public r: number, public g: number, public b: number) {}
    },
    Quaternion: class {
      constructor(public x: number, public y: number, public z: number, public w: number) {}
    },
  };
  return { kit, meshes };
}

class Scripted extends MemoryInputProvider {
  sources: InputSourceSnapshot[] = [];
  override sample(): readonly InputSourceSnapshot[] {
    return this.sources;
  }
}

/** Babylon looks down +Z: the ball centre is 0.9 m ahead of a hand at the origin, at height 1. */
function rig(display?: { ray?: "never" | "always" | "whileHitting" }) {
  const scene = new FakeScene();
  const hitTester = new BabylonHitTester();
  hitTester.register("ball", new FakeNode({ absolutePosition: [0, 1, 0.9] }), 0.1);
  const provider = new Scripted();
  const runtime = new InteractionRuntime({ provider, hitTester, ...(display ? { pointerDisplay: display } : {}) });
  runtime.registerInteractable({ id: "ball", behaviours: [{ kind: "press" }] });
  const { kit, meshes } = fakeKit();
  const visuals = new BabylonPointerVisuals({ runtime, kit, scene });
  const source = (select: number, direction: [number, number, number] = [0, 0, 1]): InputSourceSnapshot => ({
    id: "right",
    kind: "controller",
    handedness: "right",
    select,
    squeeze: 0,
    ray: { origin: [0, 1, 0], direction },
    gripPose: { position: [0, 1, 0], quaternion: [0, 0, 0, 1] },
  });
  return { scene, runtime, provider, visuals, source, meshes };
}

function drawing(over: Partial<PointerDrawing> = {}): PointerDrawing {
  return {
    sourceId: "right",
    ray: true,
    rayFrom: 0.03,
    raySolidTo: 0.25,
    rayTo: 0.3,
    rayRadius: 0.001,
    rayColor: [1, 1, 1],
    cursor: true,
    cursorPoint: [0, 1, 0.9],
    cursorRadius: 0.008,
    cursorOpacity: 0.7,
    cursorOffset: 0.004,
    ...over,
  };
}

/** A runtime double with a scripted source and provider, for the branches a real runtime never reaches. */
function fakeRuntime(source: Partial<InputSourceSnapshot> | undefined, getHeadPose?: () => { position: [number, number, number] }) {
  return {
    onPointerDrawing: () => () => {},
    getSource: () => source,
    getProvider: () => (getHeadPose ? { getHeadPose } : {}),
  } as unknown as InteractionRuntime;
}

function rotate(q: BabylonQuaternionLike, v: [number, number, number]): [number, number, number] {
  const [x, y, z] = v;
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return [
    x + q.w * tx + (q.y * tz - q.z * ty),
    y + q.w * ty + (q.z * tx - q.x * tz),
    z + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

describe("BabylonPointerVisuals", () => {
  it("draws the stub 0.03 to 0.3 m along the ray and the disc at the hit, then hides both when the ray misses", () => {
    const { runtime, provider, visuals, source, meshes: made, scene } = rig();
    provider.sources = [source(0)];
    runtime.update(1 / 60);
    expect(made.map((m) => m.kind)).toEqual(["cylinder", "disc"]);
    expect(made[0]!.options).toMatchObject({ height: 1, diameter: 1 });
    expect(made[0]!.scene).toBe(scene);
    const { ray, cursor } = visuals.meshesFor("right")!;
    const rayMaterial = ray.material as FakeMaterial;
    expect(ray.isVisible).toBe(true);
    expect(ray.position.x).toBeCloseTo(0);
    expect(ray.position.y).toBeCloseTo(1);
    expect(ray.position.z).toBeCloseTo(0.165);
    expect(ray.scaling.y).toBeCloseTo(0.27);
    expect(ray.scaling.x).toBeCloseTo(0.002);
    expect(ray.scaling.z).toBeCloseTo(0.002);
    const axis = rotate(ray.rotationQuaternion!, [0, 1, 0]);
    expect(axis[0]).toBeCloseTo(0);
    expect(axis[1]).toBeCloseTo(0);
    expect(axis[2]).toBeCloseTo(1);
    expect(rayMaterial.emissiveColor).toEqual({ r: 1, g: 1, b: 1 });
    expect(rayMaterial.disableLighting).toBe(true);
    expect(rayMaterial.alpha).toBe(1);

    const discMaterial = cursor.material as FakeMaterial;
    expect(cursor.isVisible).toBe(true);
    expect(cursor.renderingGroupId).toBe(1);
    // The sphere hit tester reports the target centre (z 0.9) as the hit point.
    expect(cursor.position.z).toBeCloseTo(0.9 - 0.004);
    expect(cursor.position.y).toBeCloseTo(1);
    expect(cursor.scaling.x).toBeCloseTo(0.008);
    expect(discMaterial.alpha).toBeCloseTo(0.7);
    expect(discMaterial.emissiveColor).toEqual({ r: 1, g: 1, b: 1 });
    // The disc's front face (-Z) looks back at the hand.
    const normal = rotate(cursor.rotationQuaternion!, [0, 0, -1]);
    expect(normal[2]).toBeCloseTo(-1);

    provider.sources = [source(0, [0, 0, -1])];
    runtime.update(1 / 60);
    expect(ray.isVisible).toBe(false);
    expect(cursor.isVisible).toBe(false);
  });

  it("turns the ray blue and focuses the disc while selecting, and never draws the ray with ray: never", () => {
    const { runtime, provider, visuals, source } = rig();
    provider.sources = [source(1)];
    runtime.update(1 / 60);
    const { ray, cursor } = visuals.meshesFor("right")!;
    expect(Math.round((ray.material as FakeMaterial).emissiveColor.r * 255)).toBe(0x33);
    expect((cursor.material as FakeMaterial).alpha).toBe(1);
    expect(cursor.scaling.x).toBeCloseTo(0.0064);

    const never = rig({ ray: "never" });
    never.provider.sources = [never.source(0)];
    never.runtime.update(1 / 60);
    expect(never.visuals.meshesFor("right")!.ray.isVisible).toBe(false);
    expect(never.visuals.meshesFor("right")!.cursor.isVisible).toBe(true);
    never.runtime.getPointerDisplay().set({ cursorOnObjects: false });
    never.runtime.update(1 / 60);
    expect(never.visuals.meshesFor("right")!.cursor.isVisible).toBe(false);
  });

  it("hides a vanished source's meshes, ignores drawings after dispose, and disposes meshes and materials once", () => {
    const { runtime, provider, visuals, source, meshes: made } = rig();
    provider.sources = [source(0)];
    runtime.update(1 / 60);
    const { ray, cursor } = visuals.meshesFor("right")!;
    provider.sources = [];
    runtime.update(1 / 60);
    visuals.apply([drawing({ sourceId: "left", ray: false, cursor: false })]);
    expect(ray.isVisible).toBe(false);
    expect(cursor.isVisible).toBe(false);
    expect(made).toHaveLength(4);

    visuals.dispose();
    for (const mesh of made) {
      expect(mesh.disposed).toBe(1);
      expect((mesh.material as FakeMaterial).disposed).toBe(1);
    }
    expect(visuals.meshesFor("right")).toBeUndefined();
    visuals.apply([drawing()]);
    visuals.dispose();
    expect(made).toHaveLength(4);
    // Unsubscribed: a later frame creates nothing.
    provider.sources = [source(0)];
    runtime.update(1 / 60);
    expect(made).toHaveLength(4);
  });

  it("orients the stub and the disc for a ray pointing straight down or straight back, and hides a stub with no length", () => {
    const { kit } = fakeKit();
    const at = (source: Partial<InputSourceSnapshot> | undefined, head?: () => { position: [number, number, number] }) =>
      new BabylonPointerVisuals({ runtime: fakeRuntime(source, head), kit, scene: null });

    const down = at({ ray: { origin: [0, 2, 0], direction: [0, -1, 0] } });
    down.apply([drawing({ cursorPoint: [0, 1, 0] })]);
    const d = down.meshesFor("right")!;
    expect(rotate(d.ray.rotationQuaternion!, [0, 1, 0])[1]).toBeCloseTo(-1);
    expect(d.ray.position.y).toBeCloseTo(2 - 0.165);
    expect(d.cursor.position.y).toBeCloseTo(1 + 0.004);

    const back = at({ ray: { origin: [0, 1, 0], direction: [0, 0, -1] } });
    back.apply([drawing({ cursorPoint: [0, 1, -1] })]);
    expect(rotate(back.meshesFor("right")!.cursor.rotationQuaternion!, [0, 0, 1])[2]).toBeCloseTo(-1);

    const empty = at({ ray: { origin: [0, 1, 0], direction: [0, 0, 1] } });
    empty.apply([drawing({ rayFrom: 0.3, rayTo: 0.3 })]);
    expect(empty.meshesFor("right")!.ray.isVisible).toBe(false);

    const noSource = at(undefined);
    noSource.apply([drawing()]);
    expect(noSource.meshesFor("right")!.ray.isVisible).toBe(false);
    expect(noSource.meshesFor("right")!.cursor.isVisible).toBe(true);
  });

  it("faces a near-hit disc from the head, and falls back to +Z with no head pose, no cursor point, or a zero direction", () => {
    const { kit } = fakeKit();
    const near = drawing({ ray: false, cursorPoint: [0, 1, 1] });

    const fromHead = new BabylonPointerVisuals({ runtime: fakeRuntime(undefined, () => ({ position: [0, 1, 0] })), kit, scene: null });
    fromHead.apply([near]);
    const cursor = fromHead.meshesFor("right")!.cursor;
    expect(cursor.position.z).toBeCloseTo(1 - 0.004);

    const noHead = new BabylonPointerVisuals({ runtime: fakeRuntime(undefined), kit, scene: null });
    noHead.apply([near]);
    expect(noHead.meshesFor("right")!.cursor.position.z).toBeCloseTo(1 - 0.004);

    const atHead = new BabylonPointerVisuals({ runtime: fakeRuntime(undefined, () => ({ position: [0, 1, 1] })), kit, scene: null });
    atHead.apply([near]);
    expect(atHead.meshesFor("right")!.cursor.position.z).toBeCloseTo(1 - 0.004);

    fromHead.apply([drawing({ cursorPoint: null })]);
    expect(cursor.isVisible).toBe(false);
  });

  it("draws through createBabylonInteractions when asked, passes the pointer settings, and is null otherwise", () => {
    const { kit, meshes } = fakeKit();
    const scene = new FakeScene();
    const interactions = createBabylonInteractions({
      scene,
      pointerVisuals: { kit },
      pointerDisplay: { ray: "always" },
    });
    expect(interactions.pointerVisuals).toBeInstanceOf(BabylonPointerVisuals);
    expect(interactions.runtime.getPointerDisplay().get().ray).toBe("always");
    interactions.register({ id: "ball", behaviours: [{ kind: "press" }] }, new FakeNode({ absolutePosition: [0, 0, 1] }));
    interactions.dispose();
    expect(meshes.every((m) => m.disposed === 1)).toBe(true);

    const arbiter = new InteractionRuntime({ provider: new Scripted(), hitTester: new BabylonHitTester() }).getPointerArbiter();
    const shared = createBabylonInteractions({ scene, pointers: arbiter });
    expect(shared.runtime.getPointerArbiter()).toBe(arbiter);
    expect(shared.pointerVisuals).toBeNull();
    shared.dispose();
  });
});
