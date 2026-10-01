/**
 * Recorded input traces - parity as a number, checkable without a device
 * per platform (Pale Signal handover of 29 September 2026, G6).
 *
 * The host conformance kits feed ideal scripted values: exact thresholds,
 * perfect poses, an empty world. They pass on native while a person still
 * finds the mechanics broken, because real hands are not ideal. A TRACE is
 * a real session, recorded frame by frame on the reference platform (IWSDK
 * on a Quest 3 in the Quest Browser): each frame's input source snapshots,
 * the head pose, and the reference's own outcome, the events it raised
 * (press and grab start and end), the values its behaviours published (the
 * dial's angle, the slide's pull), the poses its objects took, and the
 * velocity a thrown object left the hand with.
 *
 * Replaying the trace's INPUT through a binding's core (the same runtime,
 * over that binding's own hit tester and transform port) and comparing the
 * outcome with the reference's, frame for frame, within stated tolerances,
 * is what proves the binding's rules match the web on the input a person
 * actually produced. `traceParityCases()` is that comparison as a
 * runner-free suite every binding runs in CI over the synthetic traces
 * (`synthesizeTrace()`), and locally over recorded ones.
 *
 * The format is plain JSON (`rc-trace.v1`), so a trace recorded in a browser
 * can be downloaded and replayed as it is.
 */
import {
  NO_CAPABILITIES,
  type HeadPose,
  type InputCapabilities,
  type InputHitHint,
  type InputProvider,
  type InputSourceSnapshot,
  type PoseTuple,
  type Unsubscribe,
  type Vec3Tuple,
} from "@realitycollective/webxr-input";
import type { InteractableDescriptor } from "./descriptor.js";
import type { InteractionEvent } from "./events.js";
import type { HoldRelease, TransformPort } from "./ports.js";
import { InteractionRuntime, type InteractionRuntimeOptions } from "./runtime.js";

/** The trace format version this module writes and reads. */
export const TRACE_VERSION = "rc-trace.v1";

/** An interactable as the reference registered it, so a replay can rebuild the scene. */
export interface TraceTarget {
  descriptor: InteractableDescriptor;
  /** The target's rest pose, world space, at the start of the trace. */
  restPose: PoseTuple;
  /** The radius the reference hit-tests it with, metres (IWSDK: `targetRadius`, default 0.1). */
  radius: number;
}

/** The reference's outcome on one frame. */
export interface TraceReference {
  /** The events the reference raised this frame (type, interactable, interactor). */
  events: Array<Pick<InteractionEvent, "type" | "interactableId" | "interactorId" | "behaviourKind">>;
  /** Each registered target's primary value after the frame (a dial's 0..1, a slide's 0..1). */
  values: Record<string, number>;
  /** Each target's world pose after the frame. */
  poses: Record<string, PoseTuple>;
  /** A release velocity the reference handed a target's physics this frame. */
  releases?: Record<string, HoldRelease>;
}

export interface TraceFrame {
  /** Seconds since the trace began. */
  t: number;
  /** Seconds since the previous frame. */
  dt: number;
  head?: HeadPose;
  sources: InputSourceSnapshot[];
  hints?: InputHitHint[];
  reference: TraceReference;
}

export interface TraceMeta {
  /** The platform the trace was recorded on: `"iwsdk"` is the reference. */
  platform: string;
  /** ISO date and time of the recording. */
  recordedAt: string;
  /** The device, as the recorder knew it (`"Quest 3"`, `"synthetic"`). */
  device: string;
  /** The mechanic the person performed: `"press"`, `"grab"`, `"dial"`, `"slide"`, `"hinge"`, `"throw"`. */
  mechanic: string;
  /** What the person used. */
  input: "hands" | "controllers";
  /** Package versions in the recording app, for the record. */
  packages?: Record<string, string>;
  /** True for a trace a program made up rather than a person recorded; such a trace proves the pipeline, never parity. */
  synthetic?: boolean;
  notes?: string;
}

export interface InteractionTrace {
  version: typeof TRACE_VERSION;
  meta: TraceMeta;
  /** The capabilities the reference reported, so the replay negotiates the same behaviours. */
  capabilities: InputCapabilities;
  targets: TraceTarget[];
  frames: TraceFrame[];
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface TraceRecorderOptions {
  meta: Omit<TraceMeta, "recordedAt"> & { recordedAt?: string };
  /** The targets to record, with a port to read each one's pose and a way to read its primary value. */
  targets: Array<{ descriptor: InteractableDescriptor; port: TransformPort; radius?: number }>;
  /** The head pose each frame, when the recorder has one. */
  head?: () => HeadPose | undefined;
  /** A release the reference's physics received this frame, per target, when the recorder can read one. */
  releases?: () => Record<string, HoldRelease> | undefined;
}

/**
 * Records a trace from a live runtime: attach it, play the mechanic, then
 * `stop()` and keep the JSON. It listens to the runtime's sampled sources
 * (the input) and its events (the outcome), and reads each target's value
 * and pose after every frame. On IWSDK the runtime's grab events mirror
 * IWSDK's own `Grabbed` tag (through hints and `nativeGrabbing`), so the
 * events recorded there ARE the engine's outcome.
 */
export class TraceRecorder {
  private readonly frames: TraceFrame[] = [];
  private pending: Omit<TraceFrame, "reference"> | null = null;
  private pendingEvents: TraceReference["events"] = [];
  private elapsed = 0;
  private readonly unsubscribe: Unsubscribe[] = [];
  private readonly options: TraceRecorderOptions;
  private readonly runtime: InteractionRuntime;
  private stopped = false;

  constructor(runtime: InteractionRuntime, options: TraceRecorderOptions) {
    this.runtime = runtime;
    this.options = options;
    this.unsubscribe.push(
      runtime.onSample((sources) => this.onSample(sources)),
      runtime.onEvent((event) => {
        this.pendingEvents.push({
          type: event.type,
          interactableId: event.interactableId,
          ...(event.interactorId !== undefined ? { interactorId: event.interactorId } : {}),
          ...(event.behaviourKind !== undefined ? { behaviourKind: event.behaviourKind } : {}),
        });
      }),
    );
  }

  /** Call once per frame AFTER `runtime.update(dt)`, with the same dt. */
  endFrame(dt: number): void {
    if (this.stopped || !this.pending) return;
    const values: Record<string, number> = {};
    const poses: Record<string, PoseTuple> = {};
    for (const target of this.options.targets) {
      const id = target.descriptor.id;
      values[id] = this.runtime.getState(id)?.value ?? 0;
      const pose = target.port.getWorldPose();
      poses[id] = { position: [...pose.position] as Vec3Tuple, quaternion: [...pose.quaternion] as PoseTuple["quaternion"] };
    }
    const releases = this.options.releases?.();
    const frame: TraceFrame = {
      ...this.pending,
      dt,
      reference: { events: this.pendingEvents, values, poses, ...(releases && Object.keys(releases).length > 0 ? { releases } : {}) },
    };
    this.frames.push(frame);
    this.pending = null;
    this.pendingEvents = [];
  }

  private onSample(sources: readonly InputSourceSnapshot[]): void {
    if (this.stopped) return;
    const head = this.options.head?.();
    const hints = this.runtime.getProvider().sampleHints?.();
    this.pending = {
      t: this.elapsed,
      dt: 0,
      ...(head ? { head: { position: [...head.position] as Vec3Tuple, quaternion: [...head.quaternion] as HeadPose["quaternion"] } } : {}),
      sources: sources.map(cloneSnapshot),
      ...(hints && hints.length > 0 ? { hints: hints.map((hint) => ({ ...hint })) } : {}),
    };
    this.pendingEvents = [];
    // The frame's dt is known at endFrame; the elapsed time advances there.
  }

  /** How many frames are recorded so far. */
  get length(): number {
    return this.frames.length;
  }

  /** Stop listening and return the trace. Further frames are ignored. */
  stop(): InteractionTrace {
    this.stopped = true;
    for (const off of this.unsubscribe) off();
    let elapsed = 0;
    for (const frame of this.frames) {
      frame.t = elapsed;
      elapsed += frame.dt;
    }
    return {
      version: TRACE_VERSION,
      meta: { recordedAt: this.options.meta.recordedAt ?? new Date().toISOString(), ...this.options.meta },
      capabilities: { ...this.runtime.getCapabilities() },
      targets: this.options.targets.map((target) => ({
        descriptor: target.descriptor,
        restPose: target.port.getRestWorldPose(),
        radius: target.radius ?? 0.1,
      })),
      frames: this.frames,
    };
  }
}

function cloneSnapshot(source: InputSourceSnapshot): InputSourceSnapshot {
  return JSON.parse(JSON.stringify(source)) as InputSourceSnapshot;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/** A provider that plays a trace's frames back, one per `sample()`. */
export class TraceInputProvider implements InputProvider {
  private index = -1;
  private readonly trace: InteractionTrace;
  private readonly capsListeners = new Set<(c: InputCapabilities) => void>();

  constructor(trace: InteractionTrace) {
    this.trace = trace;
  }

  /** Advance to the next frame; returns it, or null past the end. */
  next(): TraceFrame | null {
    this.index += 1;
    return this.trace.frames[this.index] ?? null;
  }

  /** The frame `sample()` currently reports. */
  get frame(): TraceFrame | null {
    return this.trace.frames[this.index] ?? null;
  }

  getCapabilities(): InputCapabilities {
    return { ...NO_CAPABILITIES, ...this.trace.capabilities };
  }

  onCapabilitiesChanged(listener: (c: InputCapabilities) => void): Unsubscribe {
    this.capsListeners.add(listener);
    return () => {
      this.capsListeners.delete(listener);
    };
  }

  onSourcesChanged(): Unsubscribe {
    return () => undefined;
  }

  sample(): readonly InputSourceSnapshot[] {
    return this.frame?.sources.map(cloneSnapshot) ?? [];
  }

  sampleHints(): readonly InputHitHint[] {
    return this.frame?.hints ?? [];
  }

  getHeadPose(): HeadPose {
    return this.frame?.head ?? { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] };
  }
}

/** What a binding provides so a trace can be replayed through its own ports. */
export interface TraceReplaySubject {
  /**
   * Build the trace's targets in the binding's scene and register them with
   * the runtime the replay hands over. The subject owns the hit tester the
   * runtime was built with (`hitTester` on the options it returned).
   */
  build(trace: InteractionTrace, runtime: InteractionRuntime): { ports: Record<string, TransformPort>; dispose?: () => void };
  /** Runtime options beyond the provider (the binding's hit tester, near-pointer options). */
  runtimeOptions(trace: InteractionTrace): Omit<InteractionRuntimeOptions, "provider">;
}

/** A frame index on which a given event happened, for a target. */
export interface TraceEventTiming {
  type: string;
  interactableId: string;
  frame: number;
  t: number;
}

/** The outcome of one replay, in the same terms as the reference. */
export interface TraceOutcome {
  events: TraceEventTiming[];
  /** Per target, the value after each frame. */
  values: Record<string, number[]>;
  /** Per target, the world pose after each frame. */
  poses: Record<string, PoseTuple[]>;
  /** Per target, the last release velocity `endHold` received. */
  releases: Record<string, HoldRelease>;
}

/** Replay a trace's input through a runtime built over the subject's ports and collect the outcome. */
export function replayTrace(trace: InteractionTrace, subject: TraceReplaySubject): TraceOutcome {
  const provider = new TraceInputProvider(trace);
  const runtime = new InteractionRuntime({ provider, ...subject.runtimeOptions(trace) });
  const built = subject.build(trace, runtime);
  const outcome: TraceOutcome = { events: [], values: {}, poses: {}, releases: {} };
  for (const target of trace.targets) {
    outcome.values[target.descriptor.id] = [];
    outcome.poses[target.descriptor.id] = [];
    const port = built.ports[target.descriptor.id];
    if (port && port.endHold) {
      const original = port.endHold.bind(port);
      port.endHold = (release: HoldRelease) => {
        outcome.releases[target.descriptor.id] = { linearVelocity: [...release.linearVelocity] as Vec3Tuple, angularVelocity: [...release.angularVelocity] as Vec3Tuple };
        original(release);
      };
    }
  }
  let frameIndex = -1;
  const off = runtime.onEvent((event) => {
    outcome.events.push({ type: event.type, interactableId: event.interactableId, frame: frameIndex, t: trace.frames[frameIndex]?.t ?? 0 });
  });
  try {
    let frame = provider.next();
    while (frame) {
      frameIndex += 1;
      runtime.update(frame.dt);
      for (const target of trace.targets) {
        const id = target.descriptor.id;
        outcome.values[id]!.push(runtime.getState(id)?.value ?? 0);
        const pose = built.ports[id]?.getWorldPose() ?? { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
        outcome.poses[id]!.push({ position: [...pose.position] as Vec3Tuple, quaternion: [...pose.quaternion] as PoseTuple["quaternion"] });
      }
      frame = provider.next();
    }
  } finally {
    off();
    runtime.dispose();
    built.dispose?.();
  }
  return outcome;
}

/** The reference outcome of a trace in the same terms as a replay's. */
export function referenceOutcome(trace: InteractionTrace): TraceOutcome {
  const outcome: TraceOutcome = { events: [], values: {}, poses: {}, releases: {} };
  for (const target of trace.targets) {
    outcome.values[target.descriptor.id] = [];
    outcome.poses[target.descriptor.id] = [];
  }
  trace.frames.forEach((frame, index) => {
    for (const event of frame.reference.events) {
      outcome.events.push({ type: event.type, interactableId: event.interactableId, frame: index, t: frame.t });
    }
    for (const target of trace.targets) {
      const id = target.descriptor.id;
      outcome.values[id]!.push(frame.reference.values[id] ?? 0);
      outcome.poses[id]!.push(frame.reference.poses[id] ?? { position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
    }
    for (const [id, release] of Object.entries(frame.reference.releases ?? {})) outcome.releases[id] = release;
  });
  return outcome;
}

export interface TraceTolerances {
  /** Frames a press or grab start or end may differ by. Default 1 (one frame at 72 Hz, 14 ms). */
  eventFrames: number;
  /** Absolute difference allowed in a target's 0..1 value on any frame. Default 0.02. */
  value: number;
  /** Metres a target's position may differ by on any frame. Default 0.01. */
  position: number;
  /** Fraction of the reference release speed the replay may differ by, or `releaseFloor` m/s, whichever is larger. Default 0.1. */
  releaseFraction: number;
  /** Metres per second below which two release speeds count as equal. Default 0.1. */
  releaseFloor: number;
}

export const TRACE_TOLERANCES: Readonly<TraceTolerances> = Object.freeze({
  eventFrames: 1,
  value: 0.02,
  position: 0.01,
  releaseFraction: 0.1,
  releaseFloor: 0.1,
});

/** The events whose timing parity compares. */
const TIMED_EVENTS = new Set(["pressStart", "pressEnd", "grabStart", "grabEnd"]);

/** One difference between a replay and the reference. */
export interface TraceDifference {
  kind: "event-missing" | "event-extra" | "event-late" | "value" | "position" | "release";
  interactableId: string;
  detail: string;
}

/** Compare a replay's outcome with the reference's within the tolerances. */
export function compareOutcomes(reference: TraceOutcome, replay: TraceOutcome, tolerances: Partial<TraceTolerances> = {}): TraceDifference[] {
  const tol = { ...TRACE_TOLERANCES, ...tolerances };
  const differences: TraceDifference[] = [];
  const refEvents = reference.events.filter((e) => TIMED_EVENTS.has(e.type));
  const repEvents = replay.events.filter((e) => TIMED_EVENTS.has(e.type));
  const used = new Set<number>();
  for (const ref of refEvents) {
    let best = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    repEvents.forEach((rep, index) => {
      if (used.has(index) || rep.type !== ref.type || rep.interactableId !== ref.interactableId) return;
      const delta = Math.abs(rep.frame - ref.frame);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    });
    if (best < 0) {
      differences.push({ kind: "event-missing", interactableId: ref.interactableId, detail: `${ref.type} on frame ${ref.frame} (t=${ref.t.toFixed(3)} s) never happened in the replay` });
      continue;
    }
    used.add(best);
    if (bestDelta > tol.eventFrames) {
      differences.push({ kind: "event-late", interactableId: ref.interactableId, detail: `${ref.type}: reference frame ${ref.frame}, replay frame ${repEvents[best]!.frame} (${bestDelta} frames apart, ${tol.eventFrames} allowed)` });
    }
  }
  repEvents.forEach((rep, index) => {
    if (!used.has(index)) differences.push({ kind: "event-extra", interactableId: rep.interactableId, detail: `${rep.type} on frame ${rep.frame} happened in the replay but not in the reference` });
  });
  for (const [id, values] of Object.entries(reference.values)) {
    const replayed = replay.values[id] ?? [];
    let worst = 0;
    let worstFrame = -1;
    values.forEach((value, frame) => {
      const delta = Math.abs((replayed[frame] ?? 0) - value);
      if (delta > worst) {
        worst = delta;
        worstFrame = frame;
      }
    });
    if (worst > tol.value) differences.push({ kind: "value", interactableId: id, detail: `value differs by ${worst.toFixed(4)} on frame ${worstFrame} (${tol.value} allowed)` });
  }
  for (const [id, poses] of Object.entries(reference.poses)) {
    const replayed = replay.poses[id] ?? [];
    let worst = 0;
    let worstFrame = -1;
    poses.forEach((pose, frame) => {
      const other = replayed[frame];
      if (!other) return;
      const delta = Math.hypot(other.position[0] - pose.position[0], other.position[1] - pose.position[1], other.position[2] - pose.position[2]);
      if (delta > worst) {
        worst = delta;
        worstFrame = frame;
      }
    });
    if (worst > tol.position) differences.push({ kind: "position", interactableId: id, detail: `position differs by ${worst.toFixed(4)} m on frame ${worstFrame} (${tol.position} allowed)` });
  }
  for (const [id, release] of Object.entries(reference.releases)) {
    const other = replay.releases[id];
    const refSpeed = Math.hypot(...release.linearVelocity);
    if (!other) {
      differences.push({ kind: "release", interactableId: id, detail: `the reference released at ${refSpeed.toFixed(2)} m/s; the replay handed its physics no release` });
      continue;
    }
    const speed = Math.hypot(...other.linearVelocity);
    const allowed = Math.max(tol.releaseFloor, refSpeed * tol.releaseFraction);
    const delta = Math.hypot(other.linearVelocity[0] - release.linearVelocity[0], other.linearVelocity[1] - release.linearVelocity[1], other.linearVelocity[2] - release.linearVelocity[2]);
    if (delta > allowed) {
      differences.push({ kind: "release", interactableId: id, detail: `release velocity differs by ${delta.toFixed(3)} m/s (reference ${refSpeed.toFixed(2)} m/s, replay ${speed.toFixed(2)} m/s, ${allowed.toFixed(3)} allowed)` });
    }
  }
  return differences;
}

/** One check a binding must pass over one trace. */
export interface TraceParityCase {
  name: string;
  trace: InteractionTrace;
  run(subject: TraceReplaySubject): void;
}

/**
 * The trace parity suite over a set of traces: for each, replay through the
 * subject and compare with the reference. A case fails with every difference
 * listed. A synthetic trace's case names itself as such: it proves the
 * pipeline runs on that platform, not parity with the web.
 */
export function traceParityCases(traces: readonly InteractionTrace[], tolerances: Partial<TraceTolerances> = {}): TraceParityCase[] {
  return traces.map((trace) => {
    const label = `${trace.meta.mechanic} with ${trace.meta.input} on ${trace.meta.device}${trace.meta.synthetic ? " (synthetic: proves the pipeline, not parity)" : ""}`;
    return {
      name: `trace parity: ${label}`,
      trace,
      run(subject) {
        if (trace.version !== TRACE_VERSION) throw new Error(`[trace parity] "${label}" is ${String((trace as { version: string }).version)}, this suite reads ${TRACE_VERSION}`);
        const differences = compareOutcomes(referenceOutcome(trace), replayTrace(trace, subject), tolerances);
        if (differences.length > 0) {
          throw new Error(`[trace parity] "${label}" differs from the reference:\n` + differences.map((d) => `  - ${d.interactableId}: ${d.detail}`).join("\n"));
        }
      },
    };
  });
}

/** Check a parsed JSON value is a trace this module can replay. */
export function isInteractionTrace(value: unknown): value is InteractionTrace {
  if (typeof value !== "object" || value === null) return false;
  const trace = value as Partial<InteractionTrace>;
  return trace.version === TRACE_VERSION && Array.isArray(trace.frames) && Array.isArray(trace.targets) && typeof trace.meta === "object" && trace.meta !== null;
}
