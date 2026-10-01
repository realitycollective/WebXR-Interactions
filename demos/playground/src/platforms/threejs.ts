/**
 * three.js platform: raw WebXR and three.js, the standalone binding.
 *
 * This file only creates the engine scene, builds the stations, and creates
 * the binding with the options every platform shares. The client pieces live
 * in `../client.ts`.
 */
import { PerspectiveCamera, Scene, Color, WebGLRenderer } from "three";
import * as horizonKit from "@pmndrs/uikit-horizon";
import { createThreeInteractions } from "@realitycollective/threejs-interactions";
import { applyScene, configureRendererForUikit, connectUIExtensions } from "@realitycollective/threejs-uiextensions";
import { DesktopControls } from "@realitycollective/xrblocks-uiextensions";
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

  addEnterVrButton(async () => {
    const session = await navigator.xr!.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "hand-tracking"],
    });
    await renderer.xr.setSession(session);
  });

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // In a session the headset owns the camera pose.
    if (!renderer.xr.isPresenting) controls.update(dt);
    panels.update(dt);
    interactions.update(dt);
    client.frame(dt);
    renderer.render(scene, camera);
  });
}
