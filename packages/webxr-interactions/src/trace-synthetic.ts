/**
 * Synthetic traces: a scripted session run through the core itself over the
 * engine-free memory ports and recorded in the trace format. They exist to
 * prove the trace pipeline runs on every binding in CI (the recorder, the
 * replay, the comparison and each binding's subject) before a person has
 * recorded a real session on a Quest 3. Their `meta.synthetic` is true and
 * every case they produce says so: a synthetic trace proves nothing about
 * parity with the web, because its reference outcome is the core's own.
 */
import { NO_CAPABILITIES, type InputCapabilities, type InputProvider, type InputSourceSnapshot, type PoseTuple, type Vec3Tuple } from "@realitycollective/webxr-input";
import type { InteractableDescriptor } from "./descriptor.js";
import { quatFromAxisAngle } from "./math.js";
import { MemoryHitTester, MemoryTransformPort } from "./memory-ports.js";
import { InteractionRuntime } from "./runtime.js";
import { TraceRecorder, type InteractionTrace } from "./trace.js";

/** The mechanics a synthetic trace can script, the playground's stations. */
export type SyntheticMechanic = "press" | "grab-throw" | "dial" | "slide" | "hinge";

export interface SynthesizeTraceOptions {
  mechanic: SyntheticMechanic;
  /** Frames per second of the scripted session. Default 72 (a Quest 3). */
  frameRate?: number;
  /** `"hands"` scripts a binary pinch, `"controllers"` an analog trigger and squeeze. Default hands. */
  input?: "hands" | "controllers";
}

class ScriptedProvider implements InputProvider {
  sources: InputSourceSnapshot[] = [];
  private readonly capabilities: InputCapabilities = {
    ...NO_CAPABILITIES,
    rays: true,
    pokes: true,
    grabs: "poseOnly",
    handJoints: true,
    pinch: true,
    headPose: true,
    gaze: true,
  };

  getCapabilities(): InputCapabilities {
    return this.capabilities;
  }

  onCapabilitiesChanged(): () => void {
    return () => undefined;
  }

  onSourcesChanged(): () => void {
    return () => undefined;
  }

  sample(): readonly InputSourceSnapshot[] {
    return this.sources;
  }

  getHeadPose(): { position: Vec3Tuple; quaternion: [number, number, number, number] } {
    return { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] };
  }
}

/** The right hand at a point, pinching or not, its grip 6 cm behind the fingertip along +Z. */
function hand(tip: Vec3Tuple, pinch: boolean, input: "hands" | "controllers", gripAt?: Vec3Tuple): InputSourceSnapshot {
  const grip = gripAt ?? [tip[0], tip[1], tip[2] + 0.06];
  return {
    id: "right-hand",
    kind: input === "hands" ? "hand" : "controller",
    handedness: "right",
    select: input === "hands" ? (pinch ? 1 : 0) : pinch ? 0.9 : 0,
    squeeze: input === "hands" ? 0 : pinch ? 0.9 : 0,
    ray: { origin: [grip[0], grip[1], grip[2]], direction: [0, 0, -1] },
    gripPose: { position: grip, quaternion: [0, 0, 0, 1] },
    indexTip: input === "hands" ? tip : grip,
  };
}

const TARGET: Vec3Tuple = [0, 1.1, -0.5];
const RADIUS = 0.06;

/** The station a mechanic uses, at the playground's toss position. */
function target(mechanic: SyntheticMechanic): InteractableDescriptor {
  switch (mechanic) {
    case "press":
      return { id: "pg-button", behaviours: [{ kind: "press", axis: [0, 1, 0], travel: 0.045, depthFraction: 0.6 }] };
    case "grab-throw":
      return { id: "pg-ball", behaviours: [{ kind: "grab" }], pokeRadius: 0.09 };
    case "dial":
      return { id: "pg-dial", behaviours: [{ kind: "dial", axis: [0, 1, 0], maxAngle: (3 * Math.PI) / 2 }] };
    case "slide":
      return { id: "pg-pulley", behaviours: [{ kind: "slide", axis: [0, 1, 0], travel: 0.3 }] };
    case "hinge":
      return { id: "pg-lever-table", behaviours: [{ kind: "hinge", axis: [1, 0, 0], restDir: [0, 1, 0], maxAngle: (50 * Math.PI) / 180 }] };
  }
}

/** The scripted frames of a mechanic: the fingertip's path and whether the hand pinches. */
function* script(mechanic: SyntheticMechanic, frameRate: number): Generator<{ tip: Vec3Tuple; pinch: boolean; grip?: Vec3Tuple }> {
  const n = (seconds: number) => Math.round(seconds * frameRate);
  const lerp = (a: Vec3Tuple, b: Vec3Tuple, k: number): Vec3Tuple => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const far: Vec3Tuple = [0, 1.1, 0.2];
  const nearSurface: Vec3Tuple = [TARGET[0], TARGET[1], TARGET[2] + RADIUS + 0.01];
  switch (mechanic) {
    case "press": {
      const contact: Vec3Tuple = [TARGET[0], TARGET[1] + RADIUS - 0.01, TARGET[2]];
      const above: Vec3Tuple = [TARGET[0], TARGET[1] + RADIUS + 0.1, TARGET[2]];
      for (let i = 0; i < n(0.5); i += 1) yield { tip: lerp(far, above, i / n(0.5)), pinch: false };
      for (let i = 0; i <= n(0.3); i += 1) yield { tip: lerp(above, contact, i / n(0.3)), pinch: false };
      for (let i = 0; i < n(0.2); i += 1) yield { tip: contact, pinch: false };
      for (let i = 0; i <= n(0.3); i += 1) yield { tip: lerp(contact, above, i / n(0.3)), pinch: false };
      return;
    }
    case "grab-throw": {
      const gripAtBall: Vec3Tuple = [TARGET[0], TARGET[1], TARGET[2] + RADIUS + 0.02];
      const thrown: Vec3Tuple = [0, 1.4, -1.2];
      for (let i = 0; i < n(0.5); i += 1) yield { tip: lerp(far, gripAtBall, i / n(0.5)), pinch: false, grip: lerp(far, gripAtBall, i / n(0.5)) };
      for (let i = 0; i < n(0.2); i += 1) yield { tip: gripAtBall, pinch: true, grip: gripAtBall };
      // The throw: the grip accelerates forward over 0.25 s and lets go at speed.
      const throwFrames = n(0.25);
      for (let i = 0; i <= throwFrames; i += 1) {
        const k = i / throwFrames;
        const eased = k * k;
        yield { tip: lerp(gripAtBall, thrown, eased), pinch: i < throwFrames, grip: lerp(gripAtBall, thrown, eased) };
      }
      for (let i = 0; i < n(0.3); i += 1) yield { tip: thrown, pinch: false, grip: thrown };
      return;
    }
    case "dial": {
      // The grip circles the knob's axis a quarter turn, 5 cm out, while pinching.
      const r = RADIUS + 0.03;
      const at = (angle: number): Vec3Tuple => [TARGET[0] + r * Math.sin(angle), TARGET[1], TARGET[2] + r * Math.cos(angle)];
      for (let i = 0; i < n(0.4); i += 1) yield { tip: lerp(far, at(0), i / n(0.4)), pinch: false, grip: lerp(far, at(0), i / n(0.4)) };
      for (let i = 0; i < n(0.1); i += 1) yield { tip: at(0), pinch: true, grip: at(0) };
      for (let i = 0; i <= n(0.6); i += 1) yield { tip: at((Math.PI / 2) * (i / n(0.6))), pinch: true, grip: at((Math.PI / 2) * (i / n(0.6))) };
      for (let i = 0; i < n(0.2); i += 1) yield { tip: at(Math.PI / 2), pinch: false, grip: at(Math.PI / 2) };
      return;
    }
    case "slide": {
      const pulled: Vec3Tuple = [nearSurface[0], nearSurface[1] - 0.25, nearSurface[2]];
      for (let i = 0; i < n(0.4); i += 1) yield { tip: lerp(far, nearSurface, i / n(0.4)), pinch: false, grip: lerp(far, nearSurface, i / n(0.4)) };
      for (let i = 0; i < n(0.1); i += 1) yield { tip: nearSurface, pinch: true, grip: nearSurface };
      for (let i = 0; i <= n(0.5); i += 1) yield { tip: lerp(nearSurface, pulled, i / n(0.5)), pinch: true, grip: lerp(nearSurface, pulled, i / n(0.5)) };
      for (let i = 0; i < n(0.5); i += 1) yield { tip: pulled, pinch: false, grip: pulled };
      return;
    }
    case "hinge": {
      const swung: Vec3Tuple = [nearSurface[0], nearSurface[1] - 0.1, nearSurface[2] + 0.15];
      for (let i = 0; i < n(0.4); i += 1) yield { tip: lerp(far, nearSurface, i / n(0.4)), pinch: false, grip: lerp(far, nearSurface, i / n(0.4)) };
      for (let i = 0; i < n(0.1); i += 1) yield { tip: nearSurface, pinch: true, grip: nearSurface };
      for (let i = 0; i <= n(0.5); i += 1) yield { tip: lerp(nearSurface, swung, i / n(0.5)), pinch: true, grip: lerp(nearSurface, swung, i / n(0.5)) };
      for (let i = 0; i < n(0.2); i += 1) yield { tip: swung, pinch: false, grip: swung };
      return;
    }
  }
}

/** Run a scripted mechanic through the core over memory ports and record it. */
export function synthesizeTrace(options: SynthesizeTraceOptions): InteractionTrace {
  const frameRate = options.frameRate ?? 72;
  const input = options.input ?? "hands";
  const dt = 1 / frameRate;
  const descriptor = target(options.mechanic);
  const rest: PoseTuple = { position: [TARGET[0], TARGET[1], TARGET[2]], quaternion: options.mechanic === "hinge" ? quatFromAxisAngle([0, 1, 0], 0) : [0, 0, 0, 1] };
  const hitTester = new MemoryHitTester();
  const port = new MemoryTransformPort(rest);
  hitTester.place(descriptor.id, rest.position, RADIUS, port);
  const provider = new ScriptedProvider();
  const runtime = new InteractionRuntime({ provider, hitTester });
  runtime.registerInteractable(descriptor, { transform: port });
  const recorder = new TraceRecorder(runtime, {
    meta: {
      platform: "core",
      device: "synthetic",
      mechanic: options.mechanic,
      input,
      synthetic: true,
      notes: "A scripted session through the core over memory ports. Proves the trace pipeline, never parity with the web.",
    },
    targets: [{ descriptor, port, radius: RADIUS }],
    head: () => provider.getHeadPose(),
    releases: () => {
      const last = port.releases[port.releases.length - 1];
      if (!last || port.releases.length === releasesSeen) return undefined;
      releasesSeen = port.releases.length;
      return { [descriptor.id]: last };
    },
  });
  let releasesSeen = 0;
  for (const frame of script(options.mechanic, frameRate)) {
    provider.sources = [hand(frame.tip, frame.pinch, input, frame.grip)];
    runtime.update(dt);
    recorder.endFrame(dt);
  }
  const trace = recorder.stop();
  runtime.dispose();
  return trace;
}
