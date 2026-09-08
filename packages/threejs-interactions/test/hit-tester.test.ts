/**
 * ThreeHitTester on its own: the proximity maths, the registry, and the
 * three-mesh-bvh hook detection against a structural stand-in. The real
 * library is exercised in hit-tester-bvh.test.ts, in its own module graph.
 */
import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, Object3D } from "three";
import { ThreeHitTester } from "@realitycollective/threejs-interactions";

const DOWN_Z = {
  origin: [0, 0, 0] as [number, number, number],
  direction: [0, 0, -1] as [number, number, number],
};

function box(x: number, y: number, z: number, size = 0.2): Mesh {
  const mesh = new Mesh(new BoxGeometry(size, size, size));
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe("ThreeHitTester proximity", () => {
  it("reports the object's world position as the hit point, not its scale", () => {
    // Regression: the bounding-radius lookup used to overwrite the scratch
    // vector holding the world position with the world scale, so a hit at
    // (2, 1, -3) came back with point [1, 1, 1].
    const tester = new ThreeHitTester();
    const mesh = box(2, 1, -3, 0.1);
    mesh.scale.set(2, 2, 2);
    mesh.updateMatrixWorld(true);
    tester.register("box", mesh);

    const hit = tester.hitProximity([2.15, 1, -3], 0.05);
    expect(hit?.interactableId).toBe("box");
    expect(hit?.point).toEqual([2, 1, -3]);
  });

  it("scales the bounding radius by the world scale, parent included", () => {
    const tester = new ThreeHitTester();
    const parent = new Group();
    parent.scale.set(3, 3, 3);
    const mesh = new Mesh(new BoxGeometry(0.2, 0.2, 0.2));
    parent.add(mesh);
    parent.updateMatrixWorld(true);
    tester.register("big", mesh);

    // The local bounding sphere is about 0.173; at scale 3 it reaches 0.52.
    expect(tester.hitProximity([0, 0.55, 0], 0.05)?.interactableId).toBe("big");
    expect(tester.hitProximity([0, 0.8, 0], 0.05)).toBeNull();
  });

  it("treats a plain group as a point target", () => {
    const tester = new ThreeHitTester();
    const group = new Group();
    group.position.set(0, 1, 0);
    group.updateMatrixWorld(true);
    tester.register("group", group);

    expect(tester.hitProximity([0, 1.03, 0], 0.05)?.distance).toBeCloseTo(0.03);
    expect(tester.hitProximity([0, 1.1, 0], 0.05)).toBeNull();
  });

  it("picks the closest surface when several are in reach", () => {
    const tester = new ThreeHitTester();
    tester.register("near", box(0, 0, -0.15));
    tester.register("far", box(0, 0, -0.25));

    expect(tester.hitProximity([0, 0, 0], 0.2)?.interactableId).toBe("near");
  });
});

describe("ThreeHitTester registry", () => {
  it("rebuilds the raycast list after register and unregister, and replaces a re-registered id", () => {
    const tester = new ThreeHitTester();
    tester.register("near", box(0, 0, -1));
    tester.register("far", box(0, 0, -3));
    expect(tester.hitRay(DOWN_Z)?.interactableId).toBe("near");

    tester.unregister("near");
    expect(tester.hitRay(DOWN_Z)?.interactableId).toBe("far");
    expect(tester.getObject("near")).toBeUndefined();
    tester.unregister("near"); // an unknown id is nothing to do

    const nearer = box(0, 0, -0.5);
    tester.register("far", nearer); // re-registering an id swaps its object
    expect(tester.hitRay(DOWN_Z)?.interactableId).toBe("far");
    expect(tester.hitRay(DOWN_Z)?.distance).toBeCloseTo(0.4);
    expect(tester.getObject("far")).toBe(nearer);
    expect(tester.hitRay({ origin: [0, 0, 0], direction: [0, 1, 0] })).toBeNull();
  });

  it("answers null with nothing registered", () => {
    expect(new ThreeHitTester().hitRay(DOWN_Z)).toBeNull();
    expect(new ThreeHitTester().hitProximity([0, 0, 0], 1)).toBeNull();
  });

  it("ignores a ray hit on an object that belongs to no registered root", () => {
    // A registered mesh in front of an unregistered one: only the registered
    // one can own a hit, and the raycast list holds only registered roots.
    const tester = new ThreeHitTester();
    const stray = box(0, 0, -0.5);
    tester.register("owned", box(0, 0, -1));
    expect(stray.visible).toBe(true);
    expect(tester.hitRay(DOWN_Z)?.interactableId).toBe("owned");
  });
});

describe("ThreeHitTester bounds trees", () => {
  /** The two members the tester reads, viewed loosely so a stub hook can be planted. */
  type Hooks = { computeBoundsTree?: () => void; boundsTree?: unknown };
  const hooksOf = (geometry: BoxGeometry): Hooks => geometry as unknown as Hooks;

  it("builds a bounds tree for each registered geometry when the hook is installed, once per geometry", () => {
    const tester = new ThreeHitTester();
    const geometry = new BoxGeometry(0.2, 0.2, 0.2);
    const hooks = hooksOf(geometry);
    let builds = 0;
    hooks.computeBoundsTree = () => {
      builds += 1;
      hooks.boundsTree = { built: true };
    };
    const group = new Group();
    group.add(new Mesh(geometry), new Mesh(geometry)); // shared under one root
    tester.register("a", group);
    tester.register("b", new Mesh(geometry)); // and shared with another root

    expect(builds).toBe(1);
  });

  it("leaves geometry alone when no hook is installed", () => {
    const geometry = new BoxGeometry(0.2, 0.2, 0.2);
    new ThreeHitTester().register("plain", new Mesh(geometry));

    expect(hooksOf(geometry).boundsTree).toBeUndefined();
  });

  it("skips objects without geometry while walking a root", () => {
    const tester = new ThreeHitTester();
    const root = new Object3D();
    root.add(new Object3D());
    tester.register("empty", root);

    expect(tester.getObject("empty")).toBe(root);
  });
});
