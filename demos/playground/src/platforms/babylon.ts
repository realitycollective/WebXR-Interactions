/**
 * Babylon.js platform: `@babylonjs/core` and the Babylon binding.
 *
 * This file only creates the engine scene, builds the stations, and creates
 * the binding with the options every platform shares. The client pieces live
 * in `../client.ts`.
 *
 * There is no panel host here. UI Extensions has no Babylon binding, so the
 * station description panels are not shown on this platform and there is no
 * shared pointer arbiter to hand over: the runtime keeps its own. Babylon's
 * default XR experience draws its own Enter VR button.
 */
import {
  Color3,
  Engine,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  UniversalCamera,
  Vector3,
  WebXRFeatureName,
} from "@babylonjs/core";
import { createBabylonInteractions } from "@realitycollective/babylon-interactions";
import { createClient, registerAll } from "../client.js";
import { PLAYGROUND_POINTER_DISPLAY } from "../scene.js";
import { buildBabylonStage, buildBabylonStations } from "../stations-babylon.js";

export async function boot(container: HTMLElement): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:none";
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  container.appendChild(canvas);

  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  // Right-handed, so the layout's -Z-ahead positions match the other platforms.
  scene.useRightHandedSystem = true;
  buildBabylonStage(scene);

  // Right-drag looks and WASD walks; the left button is left for interaction.
  const camera = new UniversalCamera("camera", new Vector3(0, 1.4, 0.4), scene);
  camera.setTarget(new Vector3(0, 1.0, -0.55));
  camera.minZ = 0.05;
  camera.fov = (70 * Math.PI) / 180;
  camera.keysUp = [87, 38];
  camera.keysDown = [83, 40];
  camera.keysLeft = [65, 37];
  camera.keysRight = [68, 39];
  camera.speed = 0.08;
  camera.inertia = 0.6;
  camera.attachControl(canvas, true);
  const mouse = camera.inputs.attached["mouse"] as { buttons: number[] } | undefined;
  if (mouse) mouse.buttons = [2];

  const stations = buildBabylonStations(scene);

  // WebXR, when the browser has it; desktop-only otherwise.
  let xr: Awaited<ReturnType<Scene["createDefaultXRExperienceAsync"]>> | null = null;
  try {
    xr = await scene.createDefaultXRExperienceAsync({ floorMeshes: [] });
    xr.baseExperience.featuresManager.enableFeature(WebXRFeatureName.HAND_TRACKING, "latest", { xrInput: xr.input });
  } catch (error) {
    console.info("[playground] Babylon WebXR is unavailable, running desktop only:", error);
  }

  const interactions = createBabylonInteractions({
    scene: scene as never,
    xr: xr as never,
    desktopGripDistance: 0.95,
    pointerDisplay: PLAYGROUND_POINTER_DISPLAY,
    pointerVisuals: { kit: { MeshBuilder, StandardMaterial, Color3, Quaternion } as never },
  });
  registerAll(stations.objects, (descriptor, node) => interactions.register(descriptor, node as never));

  const ball = stations.objects.get("pg-ball")!;
  const client = createClient({
    platform: "babylon",
    binding: interactions,
    setDwellProgress: (progress) => stations.dwellRing.scaling.setAll(progress),
    ball: {
      read: (out) => {
        out[0] = ball.position.x;
        out[1] = ball.position.y;
        out[2] = ball.position.z;
      },
      write: (position) => ball.position.set(...position),
      resetOrientation: () => {
        ball.rotationQuaternion = null;
        ball.rotation.set(0, 0, 0);
      },
    },
  });

  addEventListener("resize", () => engine.resize());
  engine.runRenderLoop(() => {
    const dt = Math.min(0.1, engine.getDeltaTime() / 1000);
    interactions.update(dt);
    client.frame(dt);
    scene.render();
  });
}
