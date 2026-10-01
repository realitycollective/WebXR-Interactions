/**
 * The trace pipeline: a recorded session replays through a subject and
 * compares with the reference within tolerances; each tolerance has a case
 * that fails a replay outside it; synthetic traces name themselves.
 */
import { describe, expect, it } from "vitest";
import {
  NO_CAPABILITIES,
  InteractionRuntime,
  MemoryHitTester,
  MemoryTransformPort,
  TraceRecorder,
  TRACE_TOLERANCES,
  TRACE_VERSION,
  TraceInputProvider,
  compareOutcomes,
  hitTesterContractCases,
  isInteractionTrace,
  referenceOutcome,
  replayTrace,
  synthesizeTrace,
  traceParityCases,
  transformPortContractCases,
  type InteractionTrace,
  type TraceOutcome,
  type TraceReplaySubject,
} from "../src/index.js";

/** The core's own memory ports as a replay subject. */
function memorySubject(tweak: (port: MemoryTransformPort, id: string) => MemoryTransformPort = (port) => port): TraceReplaySubject {
  const hitTester = new MemoryHitTester();
  return {
    runtimeOptions: () => ({ hitTester }),
    build: (trace, runtime) => {
      const ports: Record<string, MemoryTransformPort> = {};
      for (const target of trace.targets) {
        const port = tweak(new MemoryTransformPort(target.restPose), target.descriptor.id);
        hitTester.place(target.descriptor.id, target.restPose.position, target.radius, port);
        runtime.registerInteractable(target.descriptor, { transform: port });
        ports[target.descriptor.id] = port;
      }
      return { ports, dispose: () => hitTester.clear() };
    },
  };
}

describe("memory ports", () => {
  for (const contractCase of hitTesterContractCases()) {
    it(`MemoryHitTester: ${contractCase.name}`, () => {
      const hitTester = new MemoryHitTester();
      contractCase.run({
        hitTester,
        driver: {
          place: (id, position, radius) => hitTester.place(id, position, radius),
          placeBare: (id, position) => hitTester.place(id, position),
          setVisible: (id, visible) => hitTester.setVisible(id, visible),
        },
      });
    });
  }
  for (const contractCase of transformPortContractCases()) {
    it(`MemoryTransformPort: ${contractCase.name}`, () => {
      const rest = { position: [1, 2, -3] as [number, number, number], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number] };
      contractCase.run({ port: new MemoryTransformPort(rest), rest });
    });
  }
  it("keeps the nearest of two targets on a ray and to a probe", () => {
    const hitTester = new MemoryHitTester();
    hitTester.place("far", [0, 0, -3], 0.1);
    hitTester.place("near", [0, 0, -1], 0.1);
    hitTester.place("farther", [0, 0, -5], 0.1);
    expect(hitTester.hitRay({ origin: [0, 0, 0], direction: [0, 0, -1] })?.interactableId).toBe("near");
    expect(hitTester.hitProximity([0, 0, -1.2], 5)?.interactableId).toBe("near");
  });

  it("records a frame with no head and with hints", () => {
    const hitTester = new MemoryHitTester();
    const port = new MemoryTransformPort({ position: [0, 1, -1], quaternion: [0, 0, 0, 1] });
    hitTester.place("t", [0, 1, -1], 0.1, port);
    const hints = [{ sourceId: "s", targetId: "t", state: "hover" as const }];
    const provider = {
      getCapabilities: () => ({ ...NO_CAPABILITIES, rays: true, pokes: true, grabs: "poseOnly" as const }),
      onCapabilitiesChanged: () => () => undefined,
      onSourcesChanged: () => () => undefined,
      sample: () => [{ id: "s", kind: "hand" as const, handedness: "right" as const, select: 0, squeeze: 0, ray: { origin: [0, 1, 0] as [number, number, number], direction: [0, 0, -1] as [number, number, number] } }],
      sampleHints: () => hints,
    };
    const runtime = new InteractionRuntime({ provider, hitTester });
    runtime.registerInteractable({ id: "t", behaviours: [{ kind: "press" }] }, { transform: port });
    const recorder = new TraceRecorder(runtime, { meta: { platform: "core", device: "synthetic", mechanic: "press", input: "hands", synthetic: true }, targets: [{ descriptor: { id: "t", behaviours: [{ kind: "press" }] }, port }] });
    runtime.update(1 / 60);
    recorder.endFrame(1 / 60);
    recorder.endFrame(1 / 60);
    expect(recorder.length).toBe(1);
    const trace = recorder.stop();
    expect(trace.frames[0]!.head).toBeUndefined();
    expect(trace.frames[0]!.hints).toEqual(hints);
    expect(trace.meta.recordedAt).toMatch(/T/);
    runtime.update(1 / 60);
    recorder.endFrame(1 / 60);
    expect(recorder.length).toBe(1);
    runtime.dispose();
  });

  it("removes and recaptures", () => {
    const hitTester = new MemoryHitTester();
    hitTester.place("a", [0, 0, -1], 0.1);
    hitTester.remove("a");
    expect(hitTester.hitRay({ origin: [0, 0, 0], direction: [0, 0, -1] })).toBeNull();
    hitTester.setVisible("missing", false);
    const port = new MemoryTransformPort({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
    port.setWorldPose({ position: [1, 1, 1], quaternion: [0, 0, 0, 1] });
    port.recaptureRest();
    expect(port.getRestWorldPose().position).toEqual([1, 1, 1]);
    port.setEffect({ scale: 1.2 });
    port.setEffect({ emissive: 0.5 });
    expect(port.effect).toEqual({ scale: 1.2, emissive: 0.5 });
    port.beginHold();
    expect(port.isHeld).toBe(true);
    port.endHold({ linearVelocity: [1, 0, 0], angularVelocity: [0, 0, 0] });
    expect(port.isHeld).toBe(false);
    expect(port.releases).toHaveLength(1);
  });
});

describe("synthetic traces", () => {
  const mechanics = ["press", "grab-throw", "dial", "slide", "hinge"] as const;

  it("record every mechanic with the reference outcome, and replay equal to themselves through the memory ports", () => {
    for (const mechanic of mechanics) {
      const trace = synthesizeTrace({ mechanic });
      expect(isInteractionTrace(trace)).toBe(true);
      expect(trace.meta.synthetic).toBe(true);
      expect(trace.frames.length).toBeGreaterThan(50);
      const reference = referenceOutcome(trace);
      const types = reference.events.map((e) => e.type);
      if (mechanic === "press") expect(types).toEqual(expect.arrayContaining(["pressStart", "pressEnd"]));
      else expect(types).toEqual(expect.arrayContaining(["grabStart", "grabEnd"]));
      if (mechanic === "grab-throw") {
        expect(Object.keys(reference.releases)).toEqual(["pg-ball"]);
        expect(Math.hypot(...reference.releases["pg-ball"]!.linearVelocity)).toBeGreaterThan(2);
      }
      if (mechanic === "dial" || mechanic === "slide" || mechanic === "hinge") {
        const values = reference.values[trace.targets[0]!.descriptor.id]!;
        expect(Math.max(...values)).toBeGreaterThan(0.2);
      }
      expect(compareOutcomes(reference, replayTrace(trace, memorySubject()))).toEqual([]);
    }
  });

  it("scripts controllers too, at another frame rate, with a recorded time line", () => {
    const trace = synthesizeTrace({ mechanic: "grab-throw", input: "controllers", frameRate: 90 });
    expect(trace.frames[0]!.sources[0]!.kind).toBe("controller");
    expect(trace.frames[1]!.t).toBeCloseTo(1 / 90);
    expect(trace.frames[trace.frames.length - 1]!.t).toBeGreaterThan(1);
    expect(compareOutcomes(referenceOutcome(trace), replayTrace(trace, memorySubject()))).toEqual([]);
  });
});

describe("traceParityCases", () => {
  const trace = synthesizeTrace({ mechanic: "grab-throw" });

  it("names a synthetic trace as such and passes a faithful subject", () => {
    const cases = traceParityCases([trace]);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toContain("synthetic: proves the pipeline, not parity");
    expect(() => cases[0]!.run(memorySubject())).not.toThrow();
  });

  it("fails a subject whose grab starts late", () => {
    // A hit tester that reports the surface farther away delays the grab.
    const hitTester = new MemoryHitTester();
    const subject: TraceReplaySubject = {
      runtimeOptions: () => ({ hitTester, nearPointer: { grabRadius: 0.02 } }),
      build: memorySubject().build,
    };
    expect(() => traceParityCases([trace])[0]!.run(subject)).toThrow(/grabStart|grabEnd/);
  });

  it("fails a subject whose port ignores the carry (the object never moves), and one that drops the release altogether", () => {
    const stuck = memorySubject((port) => {
      port.setWorldPose = () => undefined;
      return port;
    });
    expect(() => traceParityCases([trace])[0]!.run(stuck)).toThrow(/position differs/);
    const none = memorySubject((port) => {
      (port as { endHold?: unknown }).endHold = undefined;
      return port;
    });
    expect(() => traceParityCases([trace])[0]!.run(none)).toThrow(/handed its physics no release/);
    // A release the replay hands over at another speed is the throw rule failing.
    const reference = referenceOutcome(trace);
    const slow: TraceOutcome = { ...reference, releases: { "pg-ball": { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] } } };
    expect(compareOutcomes(reference, slow).map((d) => d.kind)).toEqual(["release"]);
    const nearly = { ...reference.releases["pg-ball"]! };
    nearly.linearVelocity = [nearly.linearVelocity[0] + 0.05, nearly.linearVelocity[1], nearly.linearVelocity[2]];
    expect(compareOutcomes(reference, { ...reference, releases: { "pg-ball": nearly } })).toEqual([]);
  });

  it("fails a subject whose rest frame is wrong (the dial reads another angle), and one whose object sits elsewhere", () => {
    const dial = synthesizeTrace({ mechanic: "dial" });
    const tilted = memorySubject((port) => new MemoryTransformPort({ position: port.getRestWorldPose().position, quaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }));
    expect(() => traceParityCases([dial])[0]!.run(tilted)).toThrow(/value differs|position differs/);
    const grab = synthesizeTrace({ mechanic: "grab-throw" });
    const elsewhere = memorySubject((port) => {
      const original = port.setWorldPose.bind(port);
      port.setWorldPose = (pose) => original({ position: [pose.position[0] + 0.05, pose.position[1], pose.position[2]], quaternion: pose.quaternion });
      return port;
    });
    expect(() => traceParityCases([grab])[0]!.run(elsewhere)).toThrow(/position differs/);
  });

  it("rejects another format version, and reports events the replay adds", () => {
    const wrong = { ...trace, version: "rc-trace.v0" } as unknown as InteractionTrace;
    expect(() => traceParityCases([wrong])[0]!.run(memorySubject())).toThrow(/rc-trace.v0/);
    const reference = referenceOutcome(trace);
    const extra: TraceOutcome = { ...reference, events: [...reference.events, { type: "pressStart", interactableId: "pg-ball", frame: 3, t: 0.04 }] };
    expect(compareOutcomes(reference, extra).map((d) => d.kind)).toEqual(["event-extra"]);
    const missing: TraceOutcome = { ...reference, events: [] };
    expect(compareOutcomes(reference, missing).map((d) => d.kind)).toEqual(["event-missing", "event-missing"]);
    const late: TraceOutcome = { ...reference, events: reference.events.map((e) => ({ ...e, frame: e.frame + 3 })) };
    expect(compareOutcomes(reference, late, { eventFrames: 1 }).map((d) => d.kind)).toEqual(["event-late", "event-late"]);
    expect(compareOutcomes(reference, late, { eventFrames: 3 })).toEqual([]);
    expect(TRACE_TOLERANCES.eventFrames).toBe(1);
    expect(TRACE_VERSION).toBe("rc-trace.v1");
    expect(isInteractionTrace(null)).toBe(false);
    expect(isInteractionTrace({ version: "x" })).toBe(false);
  });

  it("compares a replay that lost a target or ran short, and labels a recorded trace without the synthetic note", () => {
    const reference = referenceOutcome(trace);
    const lost: TraceOutcome = { events: reference.events, values: {}, poses: {}, releases: reference.releases };
    const kinds = compareOutcomes(reference, lost).map((d) => d.kind);
    expect(kinds).toContain("value");
    expect(kinds).not.toContain("position");
    const short: TraceOutcome = { ...reference, poses: { "pg-ball": reference.poses["pg-ball"]!.slice(0, 3) } };
    expect(compareOutcomes(reference, short).map((d) => d.kind)).toEqual([]);
    const recorded: InteractionTrace = { ...trace, meta: { ...trace.meta, synthetic: false, device: "Quest 3" } };
    expect(traceParityCases([recorded])[0]!.name).toBe("trace parity: grab-throw with hands on Quest 3");
  });

  it("TraceInputProvider plays frames back and answers the contract shape", () => {
    const provider = new TraceInputProvider(trace);
    expect(provider.sample()).toEqual([]);
    expect(provider.sampleHints()).toEqual([]);
    expect(provider.getHeadPose().position).toEqual([0, 1.6, 0]);
    expect(provider.next()).toBe(trace.frames[0]);
    expect(provider.sample()[0]!.id).toBe("right-hand");
    expect(provider.getCapabilities().grabs).toBe("poseOnly");
    const off = provider.onCapabilitiesChanged(() => undefined);
    off();
    provider.onSourcesChanged()();
    let last = provider.next();
    while (last) last = provider.next();
    expect(provider.frame).toBeNull();
  });
});
