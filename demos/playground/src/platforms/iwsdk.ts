/**
 * IWSDK platform: a Meta Immersive Web SDK world. The reference behaviour.
 *
 * This file only creates the world, builds the stations, and registers the
 * binding with the options every platform shares. The client pieces live in
 * `../client.ts`. IWSDK is three.js underneath, so the three.js station
 * builder is used as it is, and each part gets an entity that keeps its place
 * in the hierarchy.
 *
 * IWSDK owns its loop and its session, so the Service Framework relays frames
 * here: `startServiceRuntime` builds the `IWSDKAdapter` and the manager, and the
 * bridge system emits `renderTick` to the app service (`../app-service.ts`)
 * while a session is visible. The Interactions and UI Extensions systems keep
 * ticking from the World, as IWSDK apps ship them.
 */
import {
  createSystem,
  OneHandGrabbable,
  PokeInteractable,
  RayInteractable,
  SessionMode,
  VisibilityState,
  World,
  type Entity,
} from "@iwsdk/core";
import { makeServiceBridgeSystem, startServiceRuntime } from "@realitycollective/service-framework-iwsdk";
import { registerInteractions } from "@realitycollective/iwsdk-interactions";
import {
  applyScene,
  createSceneHost,
  registerUIExtensions,
  uixComponentSet,
} from "@realitycollective/iwsdk-uiextensions";
import { createPlaygroundProfile, reportToConsole } from "../app-service.js";
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

  // After the interaction bridge system has ticked the runtime. The client
  // ticks from the World, not from the app service: the service bridge idles
  // outside an immersive session, and the 2D mouse mode needs the ball's flight
  // and the trace recorder too.
  class ClientFrameSystem extends createSystem() {
    override update(delta: number): void {
      client.frame(delta);
    }
  }
  world.registerSystem(ClientFrameSystem, { priority: 100 });

  // The Service Framework relays IWSDK's frames. Every binding here ticks from
  // the World, so the frame closure has nothing to do; the app service still
  // reports the capabilities and the session. The bridge's IWSDK types are
  // structural and @iwsdk/core's own do not meet them under this repo's strict
  // options (`World.session` may be undefined, `createSystem` takes queries
  // first, `registerSystem` wants the System statics), though they match at
  // runtime, so the World, `createSystem` and the bridge pass through `never`.
  const { manager, adapter } = startServiceRuntime(world as never, (adapter) =>
    createPlaygroundProfile({ adapter, report: reportToConsole, frame: () => {} }),
  );
  const ServiceBridgeSystem = makeServiceBridgeSystem({
    adapter,
    manager,
    world: world as never,
    createSystem: createSystem as never,
    visibleState: VisibilityState.Visible,
  });
  world.registerSystem(ServiceBridgeSystem as never);

  addEnterVrButton(async () => {
    await world.launchXR();
  });
}
