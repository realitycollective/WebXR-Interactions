/**
 * The independent interaction playground — a client of the standalone
 * three.js adapter. No framework: raw WebXR + three.js.
 *
 * Client responsibilities demonstrated on purpose:
 *  - AUDIO: WebAudio blips realised from feedback intents (the framework
 *    only emits intents — the client owns sound).
 *  - HAPTICS: routed to controller actuators via the explicit
 *    `routeHapticsToProvider` opt-in (no-ops on hands).
 *  - PHYSICS: the toss ball's flight after release is CLIENT ballistics —
 *    physics is a property of the object in space, not of the interaction
 *    layer.
 */
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import {
  createThreeInteractions,
  routeHapticsToProvider,
} from "@realitycollective/threejs-interactions";
import { buildStations, PLAYGROUND_DESCRIPTOR } from "./stations.js";

const container = document.getElementById("scene-container") as HTMLDivElement;

const scene = new Scene();
scene.background = new Color(0x10141b);
scene.add(new HemisphereLight(0xdfeaff, 0x202830, 1.0));
const key = new DirectionalLight(0xffffff, 1.2);
key.position.set(2, 4, 1);
scene.add(key);

const floor = new Mesh(
  new PlaneGeometry(20, 20),
  new MeshStandardMaterial({ color: new Color(0x181e28), roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const camera = new PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 1.5, 0.4);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
renderer.xr.enabled = true;
container.appendChild(renderer.domElement);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Stations + interactions -------------------------------------------------
const stations = buildStations();
scene.add(stations.root);

const interactions = createThreeInteractions({
  xr: renderer.xr,
  camera,
  domElement: renderer.domElement,
});
for (const interactable of PLAYGROUND_DESCRIPTOR.interactables) {
  const object = stations.objects.get(interactable.id);
  if (object) interactions.register(interactable, object);
}

// --- Client feedback: audio blips + haptics ----------------------------------
const audio = new AudioContext();
function blip(frequency: number, duration = 0.08, gainValue = 0.12): void {
  if (audio.state === "suspended") void audio.resume();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(gainValue, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(1e-4, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
}

const CUE_TONES: Record<string, number> = {
  actuate: 660,
  release: 440,
  grab: 520,
  drop: 380,
  score: 880,
  dwellComplete: 990,
};

interactions.runtime.onFeedback((intent) => {
  const tone = CUE_TONES[intent.cue];
  if (tone) blip(tone);
});
// Haptics: explicit client opt-in; silently no-ops on hands.
routeHapticsToProvider(
  (listener) => interactions.runtime.onFeedback(listener),
  interactions.provider,
);

// --- Gaze-dwell ring visual ---------------------------------------------------
interactions.runtime.onEvent((event) => {
  if (event.type === "dwellProgress" && event.interactableId === "pg-gaze-button") {
    stations.dwellRing.scale.setScalar(Math.max(0.001, event.value ?? 0));
  }
});

// --- Client ballistics for the toss ball -------------------------------------
const ball = stations.objects.get("pg-ball") as Mesh;
const ballPort = interactions.getPort("pg-ball")!;
const ballVelocity = new Vector3();
const previous = new Vector3();
const current = new Vector3();
let ballHeld = false;
let ballFlying = false;

interactions.runtime.onEvent((event) => {
  if (event.interactableId !== "pg-ball") return;
  if (event.type === "grabStart") {
    ballHeld = true;
    ballFlying = false;
    ball.getWorldPosition(previous);
  } else if (event.type === "grabEnd") {
    ballHeld = false;
    ballFlying = true; // velocity carries over from the last held frames
  }
});

function updateBall(dt: number): void {
  if (ballHeld) {
    ball.getWorldPosition(current);
    if (dt > 0) ballVelocity.copy(current).sub(previous).divideScalar(dt);
    previous.copy(current);
    return;
  }
  if (!ballFlying) return;
  ballVelocity.y -= 9.81 * dt;
  ball.position.addScaledVector(ballVelocity, dt);
  if (ball.position.y < 0.06 || ball.position.length() > 15) {
    ballFlying = false;
    ballVelocity.set(0, 0, 0);
    ball.position.set(...stations.ballHome);
    ball.quaternion.identity();
    ballPort.recaptureRest();
  }
}

// --- Score counter (DOM overlay, also useful on desktop) ----------------------
const hud = document.createElement("div");
hud.style.cssText =
  "position:fixed;top:12px;left:12px;color:#9fd;font:14px system-ui;z-index:10;user-select:none";
hud.textContent = "score 0 — click/drag stations; VR button below";
document.body.appendChild(hud);
interactions.runtime.onEvent((event) => {
  if (event.type === "scored") hud.textContent = `score ${event.value}`;
});

// --- Enter VR ------------------------------------------------------------------
const enter = document.createElement("button");
enter.textContent = "Enter VR";
enter.style.cssText =
  "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);padding:10px 24px;" +
  "font:16px system-ui;background:#1e2836;color:#cfe;border:1px solid #345;border-radius:8px;z-index:10";
document.body.appendChild(enter);
enter.addEventListener("click", () => {
  void (async () => {
    if (!navigator.xr) return;
    const session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "hand-tracking"],
    });
    await renderer.xr.setSession(session);
  })();
});
if (!navigator.xr) enter.textContent = "WebXR unavailable — desktop mouse mode";

// --- Frame loop -----------------------------------------------------------------
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  interactions.update(dt);
  updateBall(dt);
  renderer.render(scene, camera);
});
