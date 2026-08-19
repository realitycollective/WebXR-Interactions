import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry } from "three";
import { ThreeHitTester, ThreeTransformPort } from "@realitycollective/threejs-interactions";

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
