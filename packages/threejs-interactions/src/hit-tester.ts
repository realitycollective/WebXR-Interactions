/**
 * ThreeHitTester - resolves core ray/proximity queries against registered
 * three.js objects. Ray hits use a Raycaster over the registered roots
 * (recursive); proximity uses world-position distance minus an
 * approximate bounding radius, good enough for poke targets.
 */
import { Raycaster, Sphere, Vector3, type Object3D, type Mesh } from "three";
import type { RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import type { HitTester, InteractableHit } from "@realitycollective/webxr-interactions";

export class ThreeHitTester implements HitTester {
  private readonly roots = new Map<string, Object3D>();
  private readonly byObject = new WeakMap<Object3D, string>();
  private readonly raycaster = new Raycaster();
  private readonly v = new Vector3();
  private readonly w = new Vector3();
  private readonly sphere = new Sphere();

  register(id: string, object: Object3D): void {
    this.roots.set(id, object);
    this.byObject.set(object, id);
  }

  unregister(id: string): void {
    const object = this.roots.get(id);
    if (object) this.byObject.delete(object);
    this.roots.delete(id);
  }

  getObject(id: string): Object3D | undefined {
    return this.roots.get(id);
  }

  hitRay(ray: RayTuple): InteractableHit | null {
    if (this.roots.size === 0) return null;
    this.raycaster.ray.origin.set(...ray.origin);
    this.raycaster.ray.direction.set(...ray.direction);
    const objects = [...this.roots.values()];
    const intersections = this.raycaster.intersectObjects(objects, true);
    for (const intersection of intersections) {
      const id = this.ownerOf(intersection.object);
      if (id !== null) {
        return {
          interactableId: id,
          distance: intersection.distance,
          point: [intersection.point.x, intersection.point.y, intersection.point.z],
        };
      }
    }
    return null;
  }

  hitProximity(point: Vec3Tuple, radius: number): InteractableHit | null {
    this.v.set(...point);
    let best: InteractableHit | null = null;
    for (const [id, object] of this.roots) {
      object.getWorldPosition(this.w);
      const surfaceDistance = Math.max(
        0,
        this.w.distanceTo(this.v) - this.boundingRadius(object),
      );
      if (surfaceDistance <= radius && (best === null || surfaceDistance < best.distance)) {
        best = {
          interactableId: id,
          distance: surfaceDistance,
          point: [this.w.x, this.w.y, this.w.z],
        };
      }
    }
    return best;
  }

  private ownerOf(object: Object3D): string | null {
    let current: Object3D | null = object;
    while (current) {
      const id = this.byObject.get(current);
      if (id !== undefined) return id;
      current = current.parent;
    }
    return null;
  }

  private boundingRadius(object: Object3D): number {
    const geometry = (object as Mesh).geometry;
    if (geometry) {
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      if (geometry.boundingSphere) {
        this.sphere.copy(geometry.boundingSphere);
        const scale = object.getWorldScale(this.w);
        return this.sphere.radius * Math.max(scale.x, scale.y, scale.z);
      }
    }
    return 0;
  }
}
