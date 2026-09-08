/**
 * The optional three-mesh-bvh integration against the real library. The
 * prototype hooks are installed here exactly as an app (or IWSDK) installs
 * them; vitest isolates this file's module graph, so the patched prototypes
 * do not reach the other suites.
 */
import { describe, expect, it } from "vitest";
import { BufferGeometry, Mesh, SphereGeometry } from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { ThreeHitTester } from "@realitycollective/threejs-interactions";

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

describe("ThreeHitTester with three-mesh-bvh installed", () => {
  it("builds a bounds tree on register and resolves hits through it", () => {
    const tester = new ThreeHitTester();
    const mesh = new Mesh(new SphereGeometry(0.5, 64, 64));
    mesh.position.set(0, 0, -2);
    mesh.updateMatrixWorld(true);
    expect(mesh.geometry.boundsTree).toBeUndefined();

    tester.register("sphere", mesh);
    expect(mesh.geometry.boundsTree).toBeDefined();

    const hit = tester.hitRay({ origin: [0, 0, 0], direction: [0, 0, -1] });
    expect(hit?.interactableId).toBe("sphere");
    expect(hit?.distance).toBeCloseTo(1.5, 2);
    expect(tester.hitRay({ origin: [0, 0, 0], direction: [0, 1, 0] })).toBeNull();

    // The library leaves null behind on dispose; a re-registered geometry
    // gets a fresh tree.
    mesh.geometry.disposeBoundsTree();
    expect(mesh.geometry.boundsTree).toBeNull();
    tester.register("sphere", mesh);
    expect(mesh.geometry.boundsTree).toBeDefined();
    expect(mesh.geometry.boundsTree).not.toBeNull();
    mesh.geometry.disposeBoundsTree();
  });

  it("does not rebuild a tree the app already built", () => {
    const tester = new ThreeHitTester();
    const mesh = new Mesh(new SphereGeometry(0.5, 16, 16));
    mesh.geometry.computeBoundsTree();
    const before = mesh.geometry.boundsTree;

    tester.register("prebuilt", mesh);
    expect(mesh.geometry.boundsTree).toBe(before);
    mesh.geometry.disposeBoundsTree();
  });
});
