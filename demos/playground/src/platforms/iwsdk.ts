/**
 * IWSDK platform: a Meta Immersive Web SDK world. The reference behaviour.
 *
 * This file only creates the world, builds the stations, and registers the
 * binding with the options every platform shares. The client pieces live in
 * `../client.ts`. IWSDK is three.js underneath, so the three.js station
 * builder is used as it is, and each part gets an entity that keeps its place
 * in the hierarchy.
 */
import {
  createSystem,
  OneHandGrabbable,
  PokeInteractable,
  RayInteractable,
  SessionMode,
  World,
  type Entity,
} from "@iwsdk/core";
import { registerInteractions } from "@realitycollective/iwsdk-interactions";
import {
  applyScene,
  createSceneHost,
  registerUIExtensions,
  uixComponentSet,
} from "@realitycollective/iwsdk-uiextensions";
import { addEnterVrButton, createClient, createPointers, registerAll, sharedPointers, wirePanelCopy } from "../client.js";
import { PLAYGROUND_POINTER_DISPLAY, STATION_PANELS, STATION_PARTS } from "../scene.js";
import { buildStage, buildStations } from "../stations-three.js";

export async function boot(container: HTMLElement): Promise<void> {
  const world = await World.create(container as HTMLDivElement, {
    xr: {
      sessionMode: SessionMode.ImmersiveVR,
      offer: "always",
      features: { handTracking: true },
    },
    features: {
      locomotion: false,
      // IWSDK's own grab pipeline fulfils the ball's grab behaviour.
      grabbing: true,
      physics: false,
      spatialUI: { kit: "horizon", componentSets: [uixComponentSet] },
    },
  });

  world.scene.add(buildStage());

  const stations = buildStations();
  // IWSDK's typings widen three's Object3D with pointer-capture members, which
  // the plain three.js types lack, so the objects are passed through `never`.
  // An entity for every part, parents first, so the hierarchy survives.
  const rootEntity = world.createTransformEntity(stations.root as never);
  const entities = new Map<string, Entity>();
  for (const part of STATION_PARTS) {
    const object = stations.parts.get(part.name)!;
    const parent = part.parent ? (entities.get(part.parent) ?? rootEntity) : rootEntity;
    entities.set(part.name, world.createTransformEntity(object as never, { parent }));
  }
  // The ball is picked up by IWSDK's grab system, which needs a target it can hit.
  const ballEntity = entities.get("pg-ball")!;
  ballEntity.addComponent(RayInteractable);
  ballEntity.addComponent(PokeInteractable);
  ballEntity.addComponent(OneHandGrabbable);

  // One arbiter for the panels and the interactables.
  const pointers = createPointers();
  registerUIExtensions(world, sharedPointers({}, pointers));
  const panels = createSceneHost(world);
  wirePanelCopy(panels);
  applyScene(panels, STATION_PANELS);

  const interactions = registerInteractions(world, {
    nativeGrab: true,
    pointers,
    pointerDisplay: PLAYGROUND_POINTER_DISPLAY,
    pointerVisuals: true,
  });
  registerAll(entities, (descriptor, entity) => interactions.register(descriptor, entity));

  const ball = stations.objects.get("pg-ball")!;
  const client = createClient({
    platform: "iwsdk",
    binding: interactions,
    setDwellProgress: (progress) => stations.dwellRing.scale.setScalar(progress),
    ball: {
      read: (out) => {
        out[0] = ball.position.x;
        out[1] = ball.position.y;
        out[2] = ball.position.z;
      },
      write: (position) => ball.position.set(...position),
      resetOrientation: () => ball.quaternion.identity(),
    },
  });

  // After the interaction bridge system has ticked the runtime.
  class ClientFrameSystem extends createSystem() {
    override update(delta: number): void {
      client.frame(delta);
    }
  }
  world.registerSystem(ClientFrameSystem, { priority: 100 });

  addEnterVrButton(async () => {
    await world.launchXR();
  });
}
