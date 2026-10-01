/**
 * The playground's client pieces, shared by every platform so each platform
 * file only creates its engine, builds its stations and creates its binding.
 *
 * Everything here talks to the core contracts (`InteractionRuntime`,
 * `TransformPort`) and never branches on the platform, except to label a
 * recorded trace with the platform it came from.
 *
 * Client responsibilities demonstrated on purpose:
 *  - AUDIO: WebAudio blips realised from feedback intents (the framework only
 *    emits intents - the client owns sound).
 *  - HAPTICS: routed to controller actuators through the explicit
 *    `routeHapticsToProvider` opt-in (no-ops on hands).
 *  - PHYSICS: the toss ball's flight after release is CLIENT ballistics on
 *    every platform here, none of which is given a physics engine.
 *  - RECORDING: a `TraceRecorder` over the binding's runtime, downloading an
 *    `rc-trace.v1` file a person can commit.
 */
import {
  PointerArbiter,
  routeHapticsToProvider,
  TraceRecorder,
  type InteractableDescriptor,
  type InteractionRuntime,
  type TransformPort,
} from "@realitycollective/webxr-interactions";
import {
  BALL_FLOOR,
  BALL_HOME,
  BALL_INTERACTABLE,
  BALL_MAX_RANGE,
  DWELL_INTERACTABLE,
  PLAYGROUND_DESCRIPTOR,
  STATION_INFO,
  type Vec3,
} from "./scene.js";

export type PlatformId = "iwsdk" | "threejs" | "xrblocks" | "babylon";

/** What the client needs of any platform binding. Every binding class has both. */
export interface ClientBinding {
  readonly runtime: InteractionRuntime;
  getPort(id: string): (TransformPort & { recaptureRest(): void }) | undefined;
}

/** Read and write the ball's world position, in whatever the engine calls a node. */
export interface BallAccess {
  read(out: Vec3): void;
  write(position: Vec3): void;
  resetOrientation(): void;
}

/** One arbiter, shared by the UI Extensions host and the Interactions binding, so one decision per source covers panels and interactables. */
export function createPointers(): PointerArbiter {
  return new PointerArbiter();
}

/**
 * Add the shared arbiter to a UI Extensions host's options.
 *
 * The `pointers` option is read by UI Extensions once a preview newer than the
 * published 0.1.1-preview.2 ships; the published typings do not have it yet, so
 * it is added here instead of in an object literal. Until then the host ignores
 * it and arbitrates its panels on its own. The Interactions side takes the
 * arbiter as it stands.
 */
export function sharedPointers<T extends object>(options: T, pointers: PointerArbiter): T {
  return { ...options, pointers };
}

/** Register every interactable in the descriptor whose object the platform built. */
export function registerAll<T>(
  objects: ReadonlyMap<string, T>,
  register: (descriptor: InteractableDescriptor, object: T) => void,
): void {
  for (const descriptor of PLAYGROUND_DESCRIPTOR.interactables) {
    const object = objects.get(descriptor.id);
    if (object) register(descriptor, object);
  }
}

/** The slice of a UI Extensions panel the copy needs. Both window hosts have it. */
interface PanelLike {
  getElementById(id: string): { setProperties(properties: { text: string }): void } | null | undefined;
}

/** Put each station's wording into its panel as it becomes ready. */
export function wirePanelCopy(host: { onPanelReady(listener: (event: { id: string; panel: PanelLike }) => void): unknown }): void {
  host.onPanelReady(({ id, panel }) => {
    const info = STATION_INFO[id];
    if (!info) return;
    panel.getElementById("body")?.setProperties({ text: info.body });
    panel.getElementById("hint")?.setProperties({ text: info.hint });
  });
}

// --- Audio -------------------------------------------------------------------------

const CUE_TONES: Record<string, number> = {
  actuate: 660,
  release: 440,
  grab: 520,
  drop: 380,
  score: 880,
  dwellComplete: 990,
};

function createBlipper(): (frequency: number, duration?: number, gainValue?: number) => void {
  let audio: AudioContext | undefined;
  return (frequency, duration = 0.08, gainValue = 0.12) => {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(gainValue, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(1e-4, audio.currentTime + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + duration);
  };
}

// --- DOM helpers -------------------------------------------------------------------

const BUTTON_STYLE =
  "padding:8px 16px;font:14px system-ui;background:#1e2836;color:#cfe;border:1px solid #345;border-radius:8px;cursor:pointer";

function overlay(css: string): HTMLDivElement {
  const div = document.createElement("div");
  div.style.cssText = `position:fixed;z-index:10;font:14px system-ui;${css}`;
  document.body.appendChild(div);
  return div;
}

/** An Enter VR button for platforms whose engine does not draw one. */
export function addEnterVrButton(start: () => Promise<void>): void {
  const button = document.createElement("button");
  button.textContent = navigator.xr ? "Enter VR" : "WebXR unavailable - desktop mouse mode";
  button.style.cssText = `${BUTTON_STYLE};position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:10;font-size:16px;padding:10px 24px`;
  document.body.appendChild(button);
  button.addEventListener("click", () => {
    if (!navigator.xr) return;
    void start().catch((error: unknown) => console.error("[playground] could not enter VR:", error));
  });
}

// --- Trace recorder ------------------------------------------------------------------

const MECHANICS = ["press", "grab-throw", "dial", "slide", "hinge"] as const;
const INPUTS = ["hands", "controllers"] as const;

/** A short device name for a trace: the headset when the user agent names one, else the browser. */
export function shortDevice(userAgent: string = navigator.userAgent): string {
  const headset = /(Quest\s?\d\w*|Quest|Pico\s?\w*|Android\s?XR|VisionOS|Vision Pro|OculusBrowser\/[\d.]+)/i.exec(userAgent);
  if (headset) return headset[1]!.trim();
  const browser = /(Firefox|Edg|Chrome|Safari)\/([\d]+)/.exec(userAgent);
  return browser ? `${browser[1]} ${browser[2]}` : userAgent.slice(0, 40);
}

function download(name: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function createRecorderControls(platform: PlatformId, binding: ClientBinding, host: HTMLElement): { endFrame(dt: number): void } {
  let recorder: TraceRecorder | null = null;
  let mechanic: string = MECHANICS[0];
  let input: string = INPUTS[0];

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap";
  const select = (values: readonly string[], onChange: (value: string) => void, label: string): HTMLSelectElement => {
    const element = document.createElement("select");
    element.title = label;
    element.style.cssText = "padding:6px;font:13px system-ui;background:#1e2836;color:#cfe;border:1px solid #345;border-radius:6px";
    for (const value of values) element.add(new Option(value, value));
    element.addEventListener("change", () => onChange(element.value));
    return element;
  };
  const mechanicSelect = select(MECHANICS, (value) => (mechanic = value), "Mechanic");
  const inputSelect = select(INPUTS, (value) => (input = value), "Input");
  const button = document.createElement("button");
  button.style.cssText = BUTTON_STYLE;
  const status = document.createElement("span");
  status.style.cssText = "color:#9fb8d4;font-size:12px";
  row.append(mechanicSelect, inputSelect, button, status);
  host.appendChild(row);

  const idle = () => {
    button.textContent = "Record trace (R)";
    mechanicSelect.disabled = false;
    inputSelect.disabled = false;
  };
  idle();

  function start(): void {
    const targets = PLAYGROUND_DESCRIPTOR.interactables.flatMap((descriptor) => {
      const port = binding.getPort(descriptor.id);
      return port ? [{ descriptor, port, radius: descriptor.pokeRadius ?? 0.1 }] : [];
    });
    recorder = new TraceRecorder(binding.runtime, {
      meta: { platform, device: shortDevice(), mechanic, input: input as "hands" | "controllers" },
      targets,
      head: () => binding.runtime.getProvider().getHeadPose?.(),
    });
    button.textContent = "Stop and save (R)";
    mechanicSelect.disabled = true;
    inputSelect.disabled = true;
  }

  function stop(): void {
    if (!recorder) return;
    const trace = recorder.stop();
    recorder = null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    download(`trace-${platform}-${trace.meta.mechanic}-${trace.meta.input}-${stamp}.json`, JSON.stringify(trace));
    status.textContent = `saved ${trace.frames.length} frames`;
    idle();
  }

  const toggle = () => (recorder ? stop() : start());
  button.addEventListener("click", toggle);
  addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "r" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
    toggle();
  });

  return {
    endFrame(dt) {
      if (!recorder) return;
      recorder.endFrame(dt);
      status.textContent = `recording ${recorder.length} frames`;
    },
  };
}

// --- The client --------------------------------------------------------------------------

export interface ClientOptions {
  platform: PlatformId;
  binding: ClientBinding;
  ball: BallAccess;
  /** Scale the gaze-dwell ring to `progress` (0 to 1). */
  setDwellProgress(progress: number): void;
}

export interface PlaygroundClient {
  /** Call once per frame, AFTER the binding's update, with the same dt. */
  frame(dt: number): void;
}

/** Wire feedback, dwell ring, toss ballistics, score HUD and the trace recorder. */
export function createClient(options: ClientOptions): PlaygroundClient {
  const { platform, binding, ball } = options;
  const runtime = binding.runtime;

  // Audio and haptics.
  const blip = createBlipper();
  runtime.onFeedback((intent) => {
    const tone = CUE_TONES[intent.cue];
    if (tone) blip(tone);
  });
  routeHapticsToProvider((listener) => runtime.onFeedback(listener), runtime.getProvider());

  // Gaze-dwell ring.
  runtime.onEvent((event) => {
    if (event.type === "dwellProgress" && event.interactableId === DWELL_INTERACTABLE) {
      options.setDwellProgress(Math.max(0.001, event.value ?? 0));
    }
  });

  // Toss ballistics: the ball's flight after release is the client's own.
  const ballPort = binding.getPort(BALL_INTERACTABLE);
  const home: Vec3 = [...BALL_HOME];
  const previous: Vec3 = [...home];
  const current: Vec3 = [...home];
  const velocity: Vec3 = [0, 0, 0];
  const position: Vec3 = [...home];
  let held = false;
  let flying = false;

  runtime.onEvent((event) => {
    if (event.interactableId !== BALL_INTERACTABLE) return;
    if (event.type === "grabStart") {
      held = true;
      flying = false;
      ball.read(previous);
    } else if (event.type === "grabEnd") {
      held = false;
      flying = true; // velocity carries over from the last held frames
    }
  });

  function updateBall(dt: number): void {
    if (held) {
      ball.read(current);
      if (dt > 0) {
        velocity[0] = (current[0] - previous[0]) / dt;
        velocity[1] = (current[1] - previous[1]) / dt;
        velocity[2] = (current[2] - previous[2]) / dt;
      }
      previous[0] = current[0];
      previous[1] = current[1];
      previous[2] = current[2];
      return;
    }
    if (!flying) return;
    velocity[1] -= 9.81 * dt;
    ball.read(position);
    position[0] += velocity[0] * dt;
    position[1] += velocity[1] * dt;
    position[2] += velocity[2] * dt;
    if (position[1] < BALL_FLOOR || Math.hypot(...position) > BALL_MAX_RANGE) {
      flying = false;
      velocity[0] = velocity[1] = velocity[2] = 0;
      ball.write(home);
      ball.resetOrientation();
      ballPort?.recaptureRest();
    } else {
      ball.write(position);
    }
  }

  // Score HUD and recorder controls.
  const hud = overlay("top:12px;left:12px;color:#9fd;user-select:none;display:flex;flex-direction:column;gap:8px;max-width:min(560px,90vw)");
  const scoreLine = document.createElement("div");
  const baseText = `${platform} - WASD walk, Shift run, Space jump, C crouch, right-drag look, left-click/drag to work a station`;
  scoreLine.textContent = `score 0 - ${baseText}`;
  hud.appendChild(scoreLine);
  runtime.onEvent((event) => {
    if (event.type === "scored") scoreLine.textContent = `score ${event.value} - ${platform}`;
  });
  const recorder = createRecorderControls(platform, binding, hud);

  return {
    frame(dt) {
      updateBall(dt);
      recorder.endFrame(dt);
    },
  };
}
