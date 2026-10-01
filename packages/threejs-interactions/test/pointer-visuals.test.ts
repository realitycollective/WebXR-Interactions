/**
 * The three.js pointer renderer draws exactly the core's drawing: IWSDK's
 * stub along the source's ray, blue while selecting, and the disc at the
 * hit, and nothing when told nothing.
 */
import { describe, expect, it } from "vitest";
import { Mesh, Scene, ShaderMaterial, SphereGeometry, type MeshBasicMaterial } from "three";
import { InteractionRuntime, MemoryInputProvider, type InputSourceSnapshot, type PointerDrawing } from "@realitycollective/webxr-interactions";
import { ThreeHitTester, ThreePointerVisuals, createThreeInteractions } from "@realitycollective/threejs-interactions";

class Scripted extends MemoryInputProvider {
  sources: InputSourceSnapshot[] = [];
  override sample(): readonly InputSourceSnapshot[] {
    return this.sources;
  }
}

function rig(display?: { ray?: "never" | "always" | "whileHitting" }) {
  const scene = new Scene();
  const ball = new Mesh(new SphereGeometry(0.1, 8, 8));
  ball.position.set(0, 1, -1);
  ball.updateMatrixWorld(true);
  scene.add(ball);
  const hitTester = new ThreeHitTester();
  hitTester.register("ball", ball);
  const provider = new Scripted();
  const runtime = new InteractionRuntime({ provider, hitTester, ...(display ? { pointerDisplay: display } : {}) });
  runtime.registerInteractable({ id: "ball", behaviours: [{ kind: "press" }] });
  const visuals = new ThreePointerVisuals({ scene, runtime, cursorTexture: null });
  const source = (select: number, direction: [number, number, number] = [0, 0, -1]): InputSourceSnapshot => ({
    id: "right",
    kind: "controller",
    handedness: "right",
    select,
    squeeze: 0,
    ray: { origin: [0, 1, 0], direction },
    gripPose: { position: [0, 1, 0], quaternion: [0, 0, 0, 1] },
  });
  return { scene, runtime, provider, visuals, source };
}

describe("ThreePointerVisuals", () => {
  it("draws the stub along the ray to min(0.3 m, the hit) and the disc at the hit, then hides both when the ray misses", () => {
    const { runtime, provider, visuals, source } = rig();
    provider.sources = [source(0)];
    runtime.update(1 / 60);
    const meshes = visuals.meshesFor("right")!;
    expect(meshes.ray.visible).toBe(true);
    expect(meshes.ray.scale.z).toBeCloseTo(0.3);
    expect(meshes.ray.scale.x).toBeCloseTo(0.001);
    expect(meshes.ray.position.toArray()).toEqual([0, 1, 0]);
    const uniforms = (meshes.ray.material as ShaderMaterial).uniforms;
    expect(uniforms.endValue!.value).toBeCloseTo(1 - 0.25 / 0.3);
    expect(meshes.cursor.visible).toBe(true);
    expect(meshes.cursor.position.z).toBeCloseTo(-0.9 + 0.004);
    expect(meshes.cursor.scale.x).toBeCloseTo(0.008);
    expect((meshes.cursor.material as MeshBasicMaterial).opacity).toBeCloseTo(0.7);

    provider.sources = [source(0, [0, 0, 1])];
    runtime.update(1 / 60);
    expect(meshes.ray.visible).toBe(false);
    expect(meshes.cursor.visible).toBe(false);
  });

  it("turns the ray blue and focuses the disc while selecting, and never draws with ray: never", () => {
    const { runtime, provider, visuals, source } = rig();
    provider.sources = [source(1)];
    runtime.update(1 / 60);
    const meshes = visuals.meshesFor("right")!;
    const colour = (meshes.ray.material as ShaderMaterial).uniforms.color!.value as { r: number; g: number; b: number };
    expect(Math.round(colour.r * 255)).toBe(0x33);
    expect((meshes.cursor.material as MeshBasicMaterial).opacity).toBe(1);
    expect(meshes.cursor.scale.x).toBeCloseTo(0.008 * 0.8);

    const never = rig({ ray: "never" });
    never.provider.sources = [never.source(0)];
    never.runtime.update(1 / 60);
    expect(never.visuals.meshesFor("right")!.ray.visible).toBe(false);
    expect(never.visuals.meshesFor("right")!.cursor.visible).toBe(true);
    never.runtime.getPointerDisplay().set({ cursorOnObjects: false });
    never.runtime.update(1 / 60);
    expect(never.visuals.meshesFor("right")!.cursor.visible).toBe(false);
  });

  it("hides a vanished source's meshes, ignores drawings after dispose, and removes its meshes from the scene", () => {
    const { scene, runtime, provider, visuals, source } = rig();
    provider.sources = [source(0)];
    runtime.update(1 / 60);
    const meshes = visuals.meshesFor("right")!;
    provider.sources = [];
    runtime.update(1 / 60);
    expect(visuals.meshesFor("right")).toBe(meshes);
    // The arbiter forgot the source; the renderer keeps the meshes hidden until it sees the source again.
    visuals.apply([{ sourceId: "left", ray: false, rayFrom: 0, raySolidTo: 0, rayTo: 0, rayRadius: 0.001, rayColor: [1, 1, 1], cursor: false, cursorPoint: null, cursorRadius: 0.008, cursorOpacity: 0.7, cursorOffset: 0.004 } satisfies PointerDrawing]);
    expect(meshes.ray.visible).toBe(false);
    const before = scene.children.length;
    visuals.dispose();
    expect(scene.children.length).toBeLessThan(before);
    visuals.apply([]);
    visuals.dispose();
  });

  it("faces a near-hit disc from the head, and draws through createThreeInteractions when asked", () => {
    const scene = new Scene();
    const ball = new Mesh(new SphereGeometry(0.1, 8, 8));
    ball.position.set(0, 1, -1);
    ball.updateMatrixWorld(true);
    scene.add(ball);
    const interactions = createThreeInteractions({
      xr: { isPresenting: false, getSession: () => null, getReferenceSpace: () => null } as never,
      camera: { getWorldPosition: (v: { set(x: number, y: number, z: number): unknown }) => v.set(0, 1.6, 0), getWorldQuaternion: (q: { set(x: number, y: number, z: number, w: number): unknown }) => q.set(0, 0, 0, 1) } as never,
      pointerVisuals: { scene },
      pointerDisplay: { ray: "always" },
    });
    expect(interactions.pointerVisuals).not.toBeNull();
    interactions.register({ id: "ball", behaviours: [{ kind: "press" }] }, ball);
    interactions.dispose();
    const without = createThreeInteractions({
      xr: { isPresenting: false, getSession: () => null, getReferenceSpace: () => null } as never,
      camera: { getWorldPosition: (v: { set(x: number, y: number, z: number): unknown }) => v.set(0, 1.6, 0), getWorldQuaternion: (q: { set(x: number, y: number, z: number, w: number): unknown }) => q.set(0, 0, 0, 1) } as never,
    });
    expect(without.pointerVisuals).toBeNull();
    without.dispose();
  });
});
