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
  PokeInteractable,
  Pressed,
  RayInteractable,
  type Entity,
  type World,
} from "@iwsdk/core";
import { createSystem } from "./create-system.js";
import { Vector3 } from "three";
import type { InputHitHint, RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  InteractionRuntime,
  type DwellConfig,
  type HitTester,
  type InteractableDescriptor,
  type InteractableHit,
} from "@realitycollective/webxr-interactions";
import { IWSDKInputProvider, type IWSDKProviderOptions } from "./provider.js";
import { IWSDKTransformPort } from "./transform-port.js";

const TEMP_V = new Vector3();

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
          point: [entry.x, entry.y, entry.z],
        };
      }
    }
    return best;
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
}

export interface IWSDKRegisterEntityOptions {
  /** Add `PokeInteractable`/`RayInteractable` for pressable targets (default true). */
  addInteractables?: boolean;
  /** Targeting radius for the approximate gaze/poke hit-tester (default 0.1 m). */
  targetRadius?: number;
}

export class IWSDKInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: IWSDKInputProvider;
  private readonly hitTester = new EntityHitTester();
  private readonly world: World;
  private readonly entities = new Map<string, Entity>();
  private readonly ports = new Map<string, IWSDKTransformPort>();

  constructor(world: World, options: IWSDKRegisterOptions = {}) {
    this.world = world;
    this.provider = new IWSDKInputProvider(world, options);
    this.runtime = new InteractionRuntime({
      provider: this.provider,
      hitTester: this.hitTester,
      ...(options.dwellDefaults ? { dwellDefaults: options.dwellDefaults } : {}),
    });
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
    let port: IWSDKTransformPort | undefined;
    if (object) {
      port = new IWSDKTransformPort(object);
      this.ports.set(descriptor.id, port);
    }
    this.runtime.registerInteractable(descriptor, port ? { transform: port } : {});
    return port;
  }

  unregister(id: string): void {
    this.runtime.unregisterInteractable(id);
    this.hitTester.unregister(id);
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
    this.runtime.dispose();
    this.provider.dispose();
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
