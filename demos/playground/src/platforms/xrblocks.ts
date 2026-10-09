/**
 * XR Blocks platform: a Script inside Google's XR Blocks, which is a three.js
 * scene. Android XR Chrome, or the XR Blocks desktop simulator.
 *
 * This file only creates the Script, builds the stations, and creates the
 * binding with the options every platform shares. The client pieces live in
 * `../client.ts`. XR Blocks draws its own Enter XR button; `fitXRBlocksPage`
 * keeps it on screen.
 *
 * XR Blocks owns its animation loop, so the Service Framework's
 * `WebXRRuntimeAdapter` is given no host and never started. The Script's
 * `update()` drives the adapter's step by hand, which reaches the app service
 * (`../app-service.ts`) as `renderTick`, and its `render()` runs the frame
 * closure that ticks the panels, the binding and the client.
 */
import type { Object3D } from "three";
import * as horizonKit from "@pmndrs/uikit-horizon";
import * as xb from "xrblocks";
import { ManualScheduler, ServiceManager } from "@realitycollective/service-framework";
import { WebXRRuntimeAdapter } from "@realitycollective/service-framework-three";
import { connectXRBlocksInteractions, type XRBlocksInteractions } from "@realitycollective/xrblocks-interactions";
import { applyScene, connectUIExtensions, type UixWindowHost } from "@realitycollective/xrblocks-uiextensions";
import { createPlaygroundProfile, followPageVisibility, reportToConsole } from "../app-service.js";
import { createClient, createPointers, registerAll, sharedPointers, wirePanelCopy } from "../client.js";
import { PLAYGROUND_POINTER_DISPLAY, STATION_PANELS } from "../scene.js";
import { buildStage, buildStations } from "../stations-three.js";
import { fitXRBlocksPage, type XRBlocksPageCore } from "./xrblocks-page.js";

class PlaygroundScript extends xb.Script {
  private adapter?: WebXRRuntimeAdapter;

  override async init(): Promise<void> {
    // xrblocks bundles its own three type declarations; at runtime one `three`
    // is resolved, so the casts are type noise only.
    const root = this as unknown as Object3D;
    const camera = xb.camera as never;
    const xr = xb.core.renderer.xr as never;
    const input = xb.input as never;

    root.add(buildStage());
    const stations = buildStations();
    root.add(stations.root);

    // One arbiter for the panels and the interactables.
    const pointers = createPointers();
    const panels: UixWindowHost = connectUIExtensions(sharedPointers({ scene: root, camera, xr, input, kit: horizonKit as never }, pointers));
    wirePanelCopy(panels);
    applyScene(panels, STATION_PANELS);

    const interactions: XRBlocksInteractions = connectXRBlocksInteractions({
      input,
      camera,
      xr,
      pointers,
      pointerDisplay: PLAYGROUND_POINTER_DISPLAY,
      pointerVisuals: { scene: root },
    });
    registerAll(stations.objects, (descriptor, object) => interactions.register(descriptor, object));

    const ball = stations.objects.get("pg-ball")!;
    const client = createClient({
      platform: "xrblocks",
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

    // The Service Framework relays XR Blocks' frames: no host, no start(), the
    // adapter only follows the session XR Blocks presents. The DOM's optional
    // `enabledFeatures` does not meet the adapter's structural session type under
    // this repo's strict options, though it matches at runtime, hence `never`.
    const scheduler = new ManualScheduler();
    const manager = new ServiceManager({ scheduler });
    const adapter = new WebXRRuntimeAdapter({ xr, xrSystem: (navigator.xr ?? null) as never, scheduler, manager });
    manager.initializeProfile(
      createPlaygroundProfile({
        adapter,
        report: reportToConsole,
        frame: (deltaSeconds) => {
          const dt = Math.min(0.1, deltaSeconds);
          panels.update(dt);
          interactions.update(dt);
          client.frame(dt);
        },
      }),
    );
    manager.start();
    followPageVisibility(manager);
    this.adapter = adapter;
  }

  override update(): void {
    this.adapter?.tick(performance.now());
  }
}

export async function boot(container: HTMLElement): Promise<void> {
  const options = new xb.Options();
  // The binding draws the ray and cursor; XR Blocks' own reticle would be a second cursor.
  options.reticles.enabled = false;
  xb.add(new PlaygroundScript());
  await xb.init(options);
  // XR Blocks appends its root and its Enter XR button to <body>, after the full-height container,
  // which puts both below the visible page. Move them into the container, where every other
  // platform draws, pin the button on screen and raise the 2D view to standing height.
  fitXRBlocksPage(container, xb.core as unknown as XRBlocksPageCore);
}
