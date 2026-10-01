/**
 * One-call setup: bind the interaction runtime onto an IWSDK world.
 *
 * ```ts
 * const interactions = registerInteractions(world, { nativeGrab: false });
 * interactions.register(
 *   { id: "beacon", behaviours: [{ kind: "press" }, { kind: "pulse" }] },
 *   beaconEntity,
 * );
 * ```
 *
 * The bridge system runs once per frame: it turns IWSDK's own targeting
 * (`Pressed`/`Grabbed` tags on registered entities) into provider hints -
 * provider power wins over the core's approximate hit-testing - then
 * ticks the runtime. A light proximity/ray hit-tester still serves gaze
 * (dwell) and anything IWSDK's pipeline does not cover.
 */
import {
  Grabbed,
  PhysicsBody,
  PhysicsShape,
  PokeInteractable,
  Pressed,
  RayInteractable,
  type Entity,
  type World,
} from "@iwsdk/core";
import { createSystem } from "./create-system.js";
import { hasRegistered } from "./has-registered.js";
import { Quaternion, Vector3 } from "three";
import type { InputHitHint, RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  surfacePointOnSphere,
  InteractionRuntime,
  coneHitForSpheres,
  type DwellConfig,
  type EyeGazeOptions,
  type HitTester,
  type InteractableDescriptor,
  type InteractableHit,
  type PhysicsBodySpec,
  type PhysicsFacility,
  type PhysicsShapeSpec,
  type PointerArbiter,
  type PointerDisplay,
  type PointerDisplayConfig,
  type SphereTarget,
} from "@realitycollective/webxr-interactions";
import { IWSDKInputProvider, type IWSDKProviderOptions } from "./provider.js";
import { IWSDKPhysicsFacility } from "./physics-facility.js";
import { IWSDKPointerVisuals, type PointerVisualsWorld } from "./pointer-visuals.js";
import { IWSDKTransformPort } from "./transform-port.js";

const TEMP_V = new Vector3();
const TEMP_Q = new Quaternion();

interface HitEntry {
  id: string;
  entity: Entity;
  radius: number;
  /** World position of the entity, valid for `frame`. */
  x: number;
  y: number;
  z: number;
  frame: number;
}

/**
 * Approximate hit-tester over registered entities (gaze/dwell targeting).
 *
 * The core asks it five questions a frame - a poke and a ray test per side,
 * plus the gaze ray - and each one used to resolve every entity's world
 * position again through `getWorldPosition`, which walks the parent chain.
 * With 200 entities that was a thousand matrix updates a frame. The bridge
 * calls `beginFrame` before the runtime ticks, so each entity is resolved
 * once and the five answers come from that. Without a `beginFrame` the
 * tester still answers correctly, resolving on every query as it did before.
 */
class EntityHitTester implements HitTester {
  private readonly entries = new Map<string, HitEntry>();
  /** The current frame stamp; 0 until `beginFrame` is first called. */
  private frame = 0;

  register(id: string, entity: Entity, radius: number): void {
    this.entries.set(id, { id, entity, radius, x: 0, y: 0, z: 0, frame: -1 });
  }

  unregister(id: string): void {
    this.entries.delete(id);
  }

  /** Start a frame: positions resolved from here on are reused until the next call. */
  beginFrame(): void {
    this.frame += 1;
  }

  hitRay(ray: RayTuple): InteractableHit | null {
    let best: InteractableHit | null = null;
    const [ox, oy, oz] = ray.origin;
    const [dx, dy, dz] = ray.direction;
    for (const entry of this.entries.values()) {
      if (!this.resolve(entry)) continue;
      // The ray-to-point distance `rayPointDistance` computes, inlined so a
      // query allocates nothing per entity.
      const t = (entry.x - ox) * dx + (entry.y - oy) * dy + (entry.z - oz) * dz;
      if (t <= 0) continue;
      const distance = Math.hypot(
        ox + dx * t - entry.x,
        oy + dy * t - entry.y,
        oz + dz * t - entry.z,
      );
      if (distance <= entry.radius && (best === null || t < best.distance)) {
        best = { interactableId: entry.id, distance: t, point: [entry.x, entry.y, entry.z] };
      }
    }
    return best;
  }

  hitProximity(point: Vec3Tuple, radius: number): InteractableHit | null {
    let best: InteractableHit | null = null;
    for (const entry of this.entries.values()) {
      if (!this.resolve(entry)) continue;
      const distance =
        Math.hypot(entry.x - point[0], entry.y - point[1], entry.z - point[2]) - entry.radius;
      if (distance <= radius && (best === null || distance < best.distance)) {
        best = {
          interactableId: entry.id,
          distance: Math.max(0, distance),
          // The surface point nearest the fingertip, where the touch cursor sits.
          point: surfacePointOnSphere([entry.x, entry.y, entry.z], entry.radius, point),
        };
      }
    }
    return best;
  }

  /** The eye-gaze cone over the same spheres (`ports.ts`, `hitCone`): the core's `coneHitForSpheres`. */
  hitCone(ray: RayTuple, halfAngle: number, maxLength: number): InteractableHit | null {
    const spheres: SphereTarget[] = [];
    for (const entry of this.entries.values()) {
      if (!this.resolve(entry)) continue;
      spheres.push({ id: entry.id, center: [entry.x, entry.y, entry.z], radius: entry.radius });
    }
    const hit = coneHitForSpheres(ray, spheres, halfAngle, maxLength);
    return hit ? { interactableId: hit.interactableId, distance: hit.distance, point: hit.point } : null;
  }

  /**
   * Bring the entry's cached world position up to this frame. False when
   * the entity has no object or a hidden one, which no query targets.
   */
  private resolve(entry: HitEntry): boolean {
    const object = entry.entity.object3D;
    if (!object || !object.visible) return false;
    if (this.frame === 0 || entry.frame !== this.frame) {
      object.getWorldPosition(TEMP_V);
      entry.x = TEMP_V.x;
      entry.y = TEMP_V.y;
      entry.z = TEMP_V.z;
      entry.frame = this.frame;
    }
    return true;
  }
}

export interface IWSDKRegisterOptions extends IWSDKProviderOptions {
  dwellDefaults?: DwellConfig;
  /** Eye-gaze tuning for the runtime's targeting (cone, dwell window, suppression, follow). Defaults are IWSDK 1.0.0's. */
  eyeGaze?: EyeGazeOptions;
  /**
   * The platform's physics. The default engine for IWSDK is Havok, through
   * `@iwsdk/core`'s own `PhysicsBody`/`PhysicsShape`/`PhysicsSystem`: omit
   * this and `IWSDKInteractions.physics` is an `IWSDKPhysicsFacility` over
   * the world. Pass any `PhysicsFacility` instead to replace it with your
   * own, the same option every other platform's setup takes.
   */
  physics?: PhysicsFacility;
  /**
   * The arbiter deciding which pointer (ray, near touch, gaze) owns each
   * source. Share one with the UI Extensions host so both make one decision.
   * Default: the runtime's own.
   */
  pointers?: PointerArbiter;
  /**
   * What the app shows for a pointer: when the ray is drawn, its length, and
   * whether the cursor shows on objects and panels. A `PointerDisplay` or a
   * partial config over IWSDK 1.0.0's defaults. Applied to IWSDK's own visuals
   * unless `pointerVisuals` is false.
   */
  pointerDisplay?: PointerDisplay | Partial<PointerDisplayConfig>;
  /**
   * Apply the pointer display settings to IWSDK's ray and cursor (default
   * true). False leaves IWSDK's visuals entirely alone.
   */
  pointerVisuals?: boolean;
}

export interface IWSDKRegisterEntityOptions {
  /** Add `PokeInteractable`/`RayInteractable` for pressable targets (default true). */
  addInteractables?: boolean;
  /** Targeting radius for the approximate gaze/poke hit-tester (default 0.1 m). */
  targetRadius?: number;
  /**
   * Give the entity a physics body with these settings (defaults are the
   * core's: dynamic, no damping, gravity factor 1), added through
   * `IWSDKInteractions.physics` at the entity's current world pose. With a
   * body, the port applies the held-pose rule through the facility.
   */
  body?: PhysicsBodySpec;
  /** The body's collider (default `"auto"`: the entity's own bounds). Implies `body`. */
  shape?: PhysicsShapeSpec;
}

export class IWSDKInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: IWSDKInputProvider;
  /** The platform's physics: an `IWSDKPhysicsFacility` by default, or the app's own from `options.physics`. */
  readonly physics: PhysicsFacility;
  /** Applies the pointer display settings to IWSDK's ray and cursor; null when `pointerVisuals` is false. */
  readonly pointerVisuals: IWSDKPointerVisuals | null;
  private readonly hitTester = new EntityHitTester();
  private readonly world: World;
  private readonly entities = new Map<string, Entity>();
  private readonly ports = new Map<string, IWSDKTransformPort>();
  /** Ids `register` gave a body to through `physics`, so `unregister` removes only its own, never one the app added itself. */
  private readonly addedBodies = new Set<string>();

  constructor(world: World, options: IWSDKRegisterOptions = {}) {
    this.world = world;
    this.provider = new IWSDKInputProvider(world, options);
    this.runtime = new InteractionRuntime({
      provider: this.provider,
      hitTester: this.hitTester,
      ...(options.dwellDefaults ? { dwellDefaults: options.dwellDefaults } : {}),
      ...(options.eyeGaze ? { eyeGaze: options.eyeGaze } : {}),
      ...(options.pointers ? { pointers: options.pointers } : {}),
      ...(options.pointerDisplay ? { pointerDisplay: options.pointerDisplay } : {}),
    });
    this.pointerVisuals =
      (options.pointerVisuals ?? true)
        ? new IWSDKPointerVisuals({ world: world as unknown as PointerVisualsWorld, runtime: this.runtime })
        : null;
    this.physics = options.physics ?? new IWSDKPhysicsFacility(world, { entityFor: (id) => this.entities.get(id) });
  }

  register(
    descriptor: InteractableDescriptor,
    entity: Entity,
    options: IWSDKRegisterEntityOptions = {},
  ): IWSDKTransformPort | undefined {
    const pressable = descriptor.behaviours.some((b) => b.kind === "press");
    if ((options.addInteractables ?? true) && pressable) {
      if (!entity.hasComponent(PokeInteractable)) entity.addComponent(PokeInteractable);
      if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable);
    }
    this.entities.set(descriptor.id, entity);
    this.hitTester.register(descriptor.id, entity, options.targetRadius ?? 0.1);
    const object = entity.object3D;
    // The common IWSDK case: the app added PhysicsBody/PhysicsShape itself,
    // with no `body`/`shape` option here - the port still gets the held-pose
    // rule through the facility, exactly as when this registers the body.
    const hasOwnPhysicsBody = hasRegistered(entity, PhysicsBody) && hasRegistered(entity, PhysicsShape);
    let addsBody = false;
    if (options.body || options.shape) {
      if (!object) {
        throw new Error(
          `[iwsdk-interactions] "${descriptor.id}" asks for a physics body but its entity has no object3D to place it at`,
        );
      }
      object.updateWorldMatrix(true, false);
      object.getWorldPosition(TEMP_V);
      object.getWorldQuaternion(TEMP_Q);
      this.physics.addBody(
        descriptor.id,
        { position: [TEMP_V.x, TEMP_V.y, TEMP_V.z], quaternion: [TEMP_Q.x, TEMP_Q.y, TEMP_Q.z, TEMP_Q.w] },
        options.body,
        options.shape,
      );
      this.addedBodies.add(descriptor.id);
      addsBody = true;
    }
    let port: IWSDKTransformPort | undefined;
    if (object) {
      const withPhysics = addsBody || hasOwnPhysicsBody;
      port = new IWSDKTransformPort(
        object,
        withPhysics ? { physics: { facility: this.physics, bodyId: descriptor.id } } : {},
      );
      this.ports.set(descriptor.id, port);
    }
    this.runtime.registerInteractable(descriptor, port ? { transform: port } : {});
    return port;
  }

  unregister(id: string): void {
    this.runtime.unregisterInteractable(id);
    this.hitTester.unregister(id);
    // Before `entities.delete`: the default facility's `entityFor` reads
    // that same map, and would resolve nothing once this id is gone from it.
    if (this.addedBodies.delete(id)) this.physics.removeBody(id);
    this.entities.delete(id);
    this.ports.delete(id);
  }

  getPort(id: string): IWSDKTransformPort | undefined {
    return this.ports.get(id);
  }

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /** Called by the bridge system once per frame. */
  tick(delta: number, pressedEntities: Iterable<Entity>, grabbedEntities: Iterable<Entity>): void {
    const hints: InputHitHint[] = [];
    const pressed = new Set(pressedEntities);
    const grabbed = new Set(grabbedEntities);
    let leftGrabbing = false;
    let rightGrabbing = false;

    for (const [id, entity] of this.entities) {
      if (pressed.has(entity)) {
        hints.push({ sourceId: this.attributeSide(entity), targetId: id, state: "press" });
      }
      if (grabbed.has(entity)) {
        const sourceId = this.attributeSide(entity, "grip");
        hints.push({ sourceId, targetId: id, state: "grab" });
        if (sourceId === "left-input") leftGrabbing = true;
        else rightGrabbing = true;
      }
    }
    this.provider.setNativeGrabbing("left", leftGrabbing);
    this.provider.setNativeGrabbing("right", rightGrabbing);
    this.provider.setHints(hints);
    // The provider's eye-gaze filter and grace integrate over the same step.
    this.provider.setFrameDelta(delta);
    // One world-position resolution per entity for the five queries the
    // runtime is about to make.
    this.hitTester.beginFrame();
    this.runtime.update(delta);
  }

  /** Attribute an engine tag to the nearest input side. */
  private attributeSide(entity: Entity, space: "tip" | "grip" = "tip"): string {
    const object = entity.object3D;
    const spaces = this.world.playerSpaceEntities;
    if (!object) return "right-input";
    object.getWorldPosition(TEMP_V);
    const target: Vec3Tuple = [TEMP_V.x, TEMP_V.y, TEMP_V.z];
    let bestSide = "right";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const side of ["left", "right"] as const) {
      const spaceEntity =
        space === "tip" ? spaces.indexTipSpaces[side] : spaces.gripSpaces[side];
      const spaceObject = spaceEntity.object3D;
      if (!spaceObject) continue;
      spaceObject.getWorldPosition(TEMP_V);
      const distance = Math.hypot(
        TEMP_V.x - target[0],
        TEMP_V.y - target[1],
        TEMP_V.z - target[2],
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSide = side;
      }
    }
    return `${bestSide}-input`;
  }

  dispose(): void {
    this.pointerVisuals?.dispose();
    this.runtime.dispose();
    this.provider.dispose();
    this.physics.dispose();
  }
}

const hosts = new WeakMap<World, IWSDKInteractions>();

export function interactionsFor(world: World): IWSDKInteractions | undefined {
  return hosts.get(world);
}

/** The per-frame bridge: IWSDK tags → provider hints → runtime tick. */
export class InteractionBridgeSystem extends createSystem({
  pressed: { required: [Pressed] },
  grabbed: { required: [Grabbed] },
}) {
  override update(delta: number): void {
    const host = hosts.get(this.world as unknown as World);
    if (!host) return;
    host.tick(delta, this.queries.pressed.entities, this.queries.grabbed.entities);
  }
}

/** Register the Interaction Extensions on an IWSDK world (one call). */
export function registerInteractions(
  world: World,
  options: IWSDKRegisterOptions = {},
): IWSDKInteractions {
  const existing = hosts.get(world);
  if (existing) return existing;
  const host = new IWSDKInteractions(world, options);
  hosts.set(world, host);
  world.registerSystem(InteractionBridgeSystem);
  return host;
}
