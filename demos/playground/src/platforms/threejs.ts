/**
 * three.js platform: raw WebXR and three.js, the standalone binding.
 *
 * This file only creates the engine scene, builds the stations, and creates
 * the binding with the options every platform shares. The client pieces live
 * in `../client.ts`.
 *
 * The Service Framework's `WebXRRuntimeAdapter` owns the animation loop and
 * the session. Each frame reaches the app service (`../app-service.ts`) as
 * `renderTick`, and its `render()` runs the frame closure below.
 */
import { PerspectiveCamera, Scene, Color, WebGLRenderer } from "three";
import * as horizonKit from "@pmndrs/uikit-horizon";
import { ManualScheduler, ServiceManager } from "@realitycollective/service-framework";
import { WebXRRuntimeAdapter } from "@realitycollective/service-framework-three";
import { createThreeInteractions } from "@realitycollective/threejs-interactions";
import { applyScene, configureRendererForUikit, connectUIExtensions } from "@realitycollective/threejs-uiextensions";
import { DesktopControls } from "@realitycollective/xrblocks-uiextensions";
import { createPlaygroundProfile, followPageVisibility, reportToConsole } from "../app-service.js";
import { addEnterVrButton, createClient, createPointers, registerAll, sharedPointers, wirePanelCopy } from "../client.js";
import { PLAYGROUND_POINTER_DISPLAY, STAGE, STATION_PANELS } from "../scene.js";
import { buildStage, buildStations } from "../stations-three.js";

export async function boot(container: HTMLElement): Promise<void> {
  const scene = new Scene();
  scene.background = new Color(STAGE.background);
  scene.add(buildStage());

  // DesktopControls owns the camera pose off-headset.
  const camera = new PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100);
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(devicePixelRatio);
  renderer.xr.enabled = true;
  // Required by uikit: renderOrder-based transparent sorting and local clipping.
  configureRendererForUikit(renderer);
  container.appendChild(renderer.domElement);
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  const controls = new DesktopControls(camera, { domElement: renderer.domElement, start: [0, 0.9] });
  controls.pitch = -0.2;

  const stations = buildStations();
  scene.add(stations.root);

  // One arbiter for the panels and the interactables.
  const pointers = createPointers();
  const panels = connectUIExtensions(sharedPointers({ scene, camera, renderer, kit: horizonKit as never }, pointers));
  wirePanelCopy(panels);
  applyScene(panels, STATION_PANELS);

  const interactions = createThreeInteractions({
    xr: renderer.xr,
    camera,
    domElement: renderer.domElement,
    desktopGripDistance: 0.95,
    pointers,
    pointerDisplay: PLAYGROUND_POINTER_DISPLAY,
    pointerVisuals: { scene },
  });
  registerAll(stations.objects, (descriptor, object) => interactions.register(descriptor, object));

  const ball = stations.objects.get("pg-ball")!;
  const client = createClient({
    platform: "threejs",
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

  // The Service Framework owns the loop and the session. The page asks for the
  // same session features it always has.
  const scheduler = new ManualScheduler();
  const manager = new ServiceManager({ scheduler });
  // The adapter's host types are structural. Under this repo's strict options
  // three's `setSession` property and the DOM's optional `enabledFeatures` do
  // not meet them, though the shapes match at runtime, so both pass through `never`.
  const adapter = new WebXRRuntimeAdapter({
    xr: renderer.xr as never,
    xrSystem: (navigator.xr ?? null) as never,
    host: renderer,
    scheduler,
    manager,
    sessionInit: () => ({ optionalFeatures: ["local-floor", "hand-tracking"] }),
  });
  manager.initializeProfile(
    createPlaygroundProfile({
      adapter,
      report: reportToConsole,
      frame: (deltaSeconds) => {
        const dt = Math.min(0.1, deltaSeconds);
        // In a session the headset owns the camera pose.
        if (!renderer.xr.isPresenting) controls.update(dt);
        panels.update(dt);
        interactions.update(dt);
        client.frame(dt);
        renderer.render(scene, camera);
      },
    }),
  );
  manager.start();
  followPageVisibility(manager);
  adapter.start();

  addEnterVrButton(async () => {
    const result = await adapter.session.request("immersive-vr");
    if (!result.ok) reportToConsole(`could not enter VR: ${result.reason}`);
  });
}
