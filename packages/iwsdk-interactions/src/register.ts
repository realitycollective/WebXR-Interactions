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
  createSystem,
  Grabbed,
  PokeInteractable,
  Pressed,
  RayInteractable,
  Vector3,
  type Entity,
  type World,
} from "@iwsdk/core";
import type { InputHitHint, RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  InteractionRuntime,
  rayPointDistance,
  type DwellConfig,
  type HitTester,
  type InteractableDescriptor,
  type InteractableHit,
} from "@realitycollective/webxr-interactions";
import { IWSDKInputProvider, type IWSDKProviderOptions } from "./provider.js";
import { IWSDKTransformPort } from "./transform-port.js";

const TEMP_V = new Vector3();

/** Approximate hit-tester over registered entities (gaze/dwell targeting). */
class EntityHitTester implements HitTester {
  private readonly entries = new Map<string, { entity: Entity; radius: number }>();

  register(id: string, entity: Entity, radius: number): void {
    this.entries.set(id, { entity, radius });
  }

  unregister(id: string): void {
    this.entries.delete(id);
  }

  hitRay(ray: RayTuple): InteractableHit | null {
    let best: InteractableHit | null = null;
    for (const [id, { entity, radius }] of this.entries) {
      const object = entity.object3D;
      if (!object || !object.visible) continue;
      object.getWorldPosition(TEMP_V);
      const point: Vec3Tuple = [TEMP_V.x, TEMP_V.y, TEMP_V.z];
      const { distance, t } = rayPointDistance(ray, point);
      if (t > 0 && distance <= radius && (best === null || t < best.distance)) {
        best = { interactableId: id, distance: t, point };
      }
    }
    return best;
  }

  hitProximity(point: Vec3Tuple, radius: number): InteractableHit | null {
    let best: InteractableHit | null = null;
    for (const [id, { entity, radius: targetRadius }] of this.entries) {
      const object = entity.object3D;
      if (!object || !object.visible) continue;
      object.getWorldPosition(TEMP_V);
      const distance =
        Math.hypot(TEMP_V.x - point[0], TEMP_V.y - point[1], TEMP_V.z - point[2]) - targetRadius;
      if (distance <= radius && (best === null || distance < best.distance)) {
        best = {
          interactableId: id,
          distance: Math.max(0, distance),
          point: [TEMP_V.x, TEMP_V.y, TEMP_V.z],
        };
      }
    }
    return best;
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
