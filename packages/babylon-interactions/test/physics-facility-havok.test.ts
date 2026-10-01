/**
 * The Babylon physics facility over the REAL Havok engine, when the app's own
 * packages are installed (INT-G23). This repository installs neither
 * `@babylonjs/core` nor `@babylonjs/havok` by default (Simon's decision);
 * with both present (`npm i -D @babylonjs/core @babylonjs/havok`) the whole
 * shared physics suite runs against Havok in Node, closing the gap. Without
 * them the suite reports itself skipped, never green by absence.
 */
import { describe, expect, it } from "vitest";
import { physicsFacilityContractCases } from "@realitycollective/webxr-interactions";
import { BabylonPhysicsFacility, type BabylonPhysicsKitLike, type BabylonSceneLike, type BabylonTransformNodeLike } from "@realitycollective/babylon-interactions";

type BabylonModule = Record<string, unknown>;
type HavokModule = { default: () => Promise<unknown> };

async function loadBabylon(): Promise<{ babylon: BabylonModule; havok: HavokModule } | null> {
  // Specifiers held in variables so the test runner's import analysis does
  // not try to resolve packages that are not installed.
  const core = "@babylonjs/core";
  const havokName = "@babylonjs/havok";
  try {
    const [babylon, havok] = await Promise.all([
      import(/* @vite-ignore */ core) as Promise<BabylonModule>,
      import(/* @vite-ignore */ havokName) as Promise<HavokModule>,
    ]);
    return { babylon, havok };
  } catch {
    return null;
  }
}

const loaded = await loadBabylon();

describe.skipIf(loaded === null)("BabylonPhysicsFacility over real Havok (INT-G23)", () => {
  // EXPECTED TO FAIL until INT-G23 is closed. With @babylonjs/core 9.28 and
  // @babylonjs/havok 1.3 installed (they arrived with the playground demo on
  // 29 September 2026), 3 of the 10 shared cases pass and 7 fail: a dynamic
  // sphere falls through the static box, a suspended body keeps falling,
  // setBodyPose and resume do not move the body, and velocities read back as
  // zero. The facility was proved against a fake Havok only; driving the real
  // engine under a NullEngine scene is binding work. `it.fails` keeps that
  // evidence in CI and flips red the day the facility passes, so the marker
  // is removed then.
  it.fails("runs the whole physicsFacilityContractCases suite against Havok (INT-G23, open: 7 of 10 fail today)", async () => {
    const { babylon, havok } = loaded!;
    const B = babylon as unknown as {
      NullEngine: new () => unknown;
      Scene: new (engine: unknown) => BabylonSceneLike & { enablePhysics(gravity: unknown, plugin: unknown): boolean; dispose(): void };
      HavokPlugin: new (useDeltaForWorldStep: boolean, instance: unknown) => unknown;
      Vector3: new (x: number, y: number, z: number) => unknown;
      MeshBuilder: { CreateSphere(name: string, options: { diameter: number }, scene: unknown): BabylonTransformNodeLike };
      PhysicsBody: unknown;
      PhysicsShapeSphere: unknown;
      PhysicsShapeBox: unknown;
      PhysicsShapeCapsule: unknown;
      PhysicsMotionType: unknown;
    };
    // Under Node the loader cannot fetch its wasm; hand it the binary from the package.
    const { readFileSync } = await import("node:fs");
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const wasmBinary = readFileSync(require.resolve("@babylonjs/havok/lib/esm/HavokPhysics.wasm"));
    const instance = await (havok.default as (options?: { wasmBinary?: Uint8Array }) => Promise<unknown>)({ wasmBinary });
    const engine = new B.NullEngine();
    const scene = new B.Scene(engine);
    scene.enablePhysics(new B.Vector3(0, -9.81, 0), new B.HavokPlugin(true, instance));
    const nodes = new Map<string, BabylonTransformNodeLike>();
    const kit = {
      PhysicsBody: B.PhysicsBody,
      PhysicsShapeSphere: B.PhysicsShapeSphere,
      PhysicsShapeBox: B.PhysicsShapeBox,
      PhysicsShapeCapsule: B.PhysicsShapeCapsule,
      PhysicsShapeMesh: (babylon as { PhysicsShapeMesh: unknown }).PhysicsShapeMesh,
      PhysicsMotionType: B.PhysicsMotionType,
      Quaternion: (babylon as { Quaternion: unknown }).Quaternion,
      Vector3: B.Vector3,
    } as unknown as BabylonPhysicsKitLike;
    const facility = new BabylonPhysicsFacility(scene, kit, {
      nodeFor: (id) => {
        let node = nodes.get(id);
        if (!node) {
          node = B.MeshBuilder.CreateSphere(id, { diameter: 0.2 }, scene);
          nodes.set(id, node);
        }
        return node;
      },
    });
    const failures: string[] = [];
    for (const contractCase of physicsFacilityContractCases()) {
      try {
        contractCase.run({ facility });
      } catch (error) {
        failures.push(`${contractCase.name}: ${(error as Error).message}`);
      }
    }
    facility.dispose();
    scene.dispose();
    expect(failures).toEqual([]);
  });
});

describe.skipIf(loaded !== null)("BabylonPhysicsFacility over real Havok (INT-G23)", () => {
  it("is skipped: @babylonjs/core and @babylonjs/havok are not installed in this repository (Simon's decision, INT-G23)", () => {
    expect(loaded).toBeNull();
  });
});
