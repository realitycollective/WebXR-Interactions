/**
 * The Interactions family's native test harness: one bundle a native host
 * runs, built by the WebXR-to-native conversion pipeline (`rc check`, `rc
 * build`) from this repository's own source, and run under Node against the
 * repository's reference fakes when no native host is installed.
 *
 * Modes (`debug.rc.mode` on a device, `__rcShell.mode` under Node):
 *
 *   kits   run every suite this family ships (the shared contract suites and
 *          the host conformance kit) against the shell's test host, or the
 *          fakes under Node; one JSON line per suite and a `done` line with
 *          `pass`. The default under Node.
 *   play   the playground stations over the live `__rcHost`: the same
 *          registrations the web playground makes, with the pointer display
 *          the playground configures, so a person plays every station with
 *          hands and controllers; every interaction event, dial and slide
 *          value, grab start and end, and throw release velocity is logged as
 *          a JSON line, the record the playground table is filled from. The
 *          default on a device.
 *   trace  `play`, plus a trace recorder over the live runtime: the recorded
 *          trace is written as JSON lines (`step: "trace"`) at the end, so a
 *          native session can be compared with the web's the same way.
 *
 * The bundle contains no engine and no browser: three.js appears only in the
 * cook step that turns the playground's station meshes into glTF for the host
 * (`scene-assets.ts`), never in this entry.
 */
import { NativeHitTester, createNativeInteractions, type NativeInteractions } from "@realitycollective/native-interactions";
import { TraceRecorder, type InteractionEvent, type PointerDrawing } from "@realitycollective/webxr-interactions";
import type { InputSourceSnapshot } from "@realitycollective/webxr-input";
import { PLAYGROUND_DESCRIPTOR, PLAYGROUND_POINTER_DISPLAY, STATION_PARTS, type PartSpec } from "../../demos/playground/src/scene.js";
import { emit, hasShell, readMode, round, shellGlobal, virtualClock } from "./src/prelude.js";
import { runInteractionsKits, shellTestSlices, type InteractionsTestSlices } from "./src/kits.js";
import { referenceTestSlices } from "./src/fakes.js";
import { lightStage } from "./src/stage-light.js";

type Mode = "kits" | "play" | "trace";
const mode = readMode(hasShell() ? "play" : "kits") as Mode;
const g = globalThis as Record<string, unknown>;

emit("harness", { family: "interactions", mode, shell: hasShell() });

let done: { pass: boolean } | null = null;

/** The radius a station is hit-tested with on the native host: its geometry's bounding sphere (IWSDK's default 0.1 m for a group). */
function radiusOf(part: PartSpec | undefined): number {
  const shape = part?.shape;
  if (!shape) return 0.1;
  const scale = part?.scale ?? 1;
  switch (shape.kind) {
    case "box":
      return (Math.hypot(shape.size[0], shape.size[1], shape.size[2]) / 2) * scale;
    case "cylinder":
      return Math.hypot(Math.max(shape.radiusTop, shape.radiusBottom), shape.height / 2) * scale;
    case "sphere":
      return shape.radius * scale;
    case "torus":
      return (shape.radius + shape.tube) * scale;
    default:
      return 0.1;
  }
}
const PART_BY_NAME = new Map(STATION_PARTS.map((part) => [part.name, part]));
let displayNow = 0;
let lastDisplayMs: number | null = null;

/** The frame entry the shell calls once per frame with the predicted display time in milliseconds. */
function installTick(tick: (displayMs: number) => void): void {
  g.__rcTick = (displayMs: number): void => {
    const dt = lastDisplayMs === null ? 0 : Math.min(0.1, Math.max(0, (displayMs - lastDisplayMs) / 1000));
    lastDisplayMs = displayMs;
    displayNow = displayMs;
    virtualClock.advance(dt * 1000);
    tick(displayMs);
  };
  g.__rcRenderDone = (): boolean => done !== null;
  g.__rcStatus = (): string => JSON.stringify({ mode, displayMs: round(displayNow, 1), done: done?.pass ?? null });
}

// --- kits ------------------------------------------------------------------------------------
async function runKits(): Promise<void> {
  const slices: InteractionsTestSlices = shellTestSlices() ?? referenceTestSlices();
  emit("kits-host", { source: shellTestSlices() ? "shell test host (__rcShell.testHost)" : "reference fakes" });
  const result = await runInteractionsKits(slices);
  done = { pass: result.pass };
  emit("done", { pass: result.pass, suites: result.suites.length, failures: result.suites.flatMap((s) => s.failures.map((f) => `${s.name}: ${f.name}: ${f.error}`)) });
}

// --- play ------------------------------------------------------------------------------------
/** The `scenes` slice of the live host, read structurally: this family owns no scene contract, the harness only asks the host to build its one scene. */
interface ScenesSlice {
  build(def: { id: string; src: string }, visible: boolean): Promise<{ scene: string; nodes: { id: string; key: string }[] }>;
}
const PLAYGROUND_SCENE = { id: "playground", src: "/scenes/playground.iwsdk.scene.json" };

function play(record: boolean): NativeInteractions {
  const native = createNativeInteractions({ pointerDisplay: PLAYGROUND_POINTER_DISPLAY });
  const ports = new Map<string, ReturnType<NativeInteractions["register"]>>();
  // The host names each scene node with its own key, and that key is the node's target id in the
  // interactions slice, so a station is registered under its node's key. Events are logged with the
  // authored id beside it.
  const idOfKey = new Map<string, string>();
  const authored = (key: unknown): unknown => (typeof key === "string" ? (idOfKey.get(key) ?? key) : key);
  let recorder: TraceRecorder | null = null;

  const registerStations = (keyOf: (id: string) => string): void => {
    for (const interactable of PLAYGROUND_DESCRIPTOR.interactables) {
      const key = keyOf(interactable.id);
      idOfKey.set(key, interactable.id);
      ports.set(interactable.id, native.register({ ...interactable, id: key }, { targetRadius: radiusOf(PART_BY_NAME.get(interactable.id)) }));
    }
    if (record) {
      recorder = new TraceRecorder(native.runtime, {
        meta: { platform: "native", device: "native host", mechanic: "playground", input: "hands", notes: "Recorded on the native host through the Interactions harness (mode trace)." },
        targets: PLAYGROUND_DESCRIPTOR.interactables.map((descriptor) => ({ descriptor: { ...descriptor, id: keyOf(descriptor.id) }, port: ports.get(descriptor.id)!, radius: radiusOf(PART_BY_NAME.get(descriptor.id)) })),
        head: () => native.provider.getHeadPose?.(),
      });
    }
    emit("play", { stations: PLAYGROUND_DESCRIPTOR.interactables.map((i) => i.id), display: PLAYGROUND_POINTER_DISPLAY, sources: sampleIds(native) });
  };

  emit("stage", lightStage(g.__rcHost));
  // Nothing is drawn until the host builds the scene: the stations' meshes are the scene document's nodes.
  const scenes = (g.__rcHost as { scenes?: ScenesSlice }).scenes;
  if (scenes) {
    scenes.build(PLAYGROUND_SCENE, true).then(
      (built) => {
        const keys = new Map(built.nodes.map((node) => [node.id, node.key]));
        emit("scene", { scene: PLAYGROUND_SCENE.id, key: built.scene, nodes: built.nodes.length, missing: PLAYGROUND_DESCRIPTOR.interactables.map((i) => i.id).filter((id) => !keys.has(id)) });
        registerStations((id) => keys.get(id) ?? id);
      },
      (error: unknown) => {
        emit("scene", { scene: PLAYGROUND_SCENE.id, error: String((error as Error)?.message ?? error) });
        registerStations((id) => id);
      },
    );
  } else {
    emit("scene", { scene: PLAYGROUND_SCENE.id, error: "the host has no scenes slice: the stations are registered by id and nothing is drawn" });
    registerStations((id) => id);
  }

  native.runtime.onEvent((event: InteractionEvent) => {
    if (event.type === "dwellProgress") return;
    const e = event as unknown as Record<string, unknown>;
    emit("event", { at: round(displayNow, 1), ...e, ...(e.interactableId !== undefined ? { interactableId: authored(e.interactableId) } : {}) });
  });
  native.runtime.onPointerDrawing((drawings: readonly PointerDrawing[]) => {
    // Once a second, what is drawn for each source: the ray stub and the cursor.
    if (Math.floor(displayNow / 1000) !== Math.floor((displayNow - 14) / 1000)) {
      emit("drawing", { at: round(displayNow, 1), sources: drawings.map((d) => ({ id: d.sourceId, ray: d.ray, rayTo: round(d.rayTo), cursor: d.cursor, cursorPoint: d.cursorPoint?.map((n) => round(n)) ?? null })) });
    }
  });
  if (record) {
    shellGlobal().stopTrace = (): void => {
      if (!recorder) {
        emit("trace-meta", { error: "the scene has not been built yet: nothing was recorded" });
        return;
      }
      const trace = recorder.stop();
      const text = JSON.stringify(trace);
      emit("trace-meta", { frames: trace.frames.length, bytes: text.length });
      for (let i = 0; i < text.length; i += 800) emit("trace", { i: Math.floor(i / 800), of: Math.ceil(text.length / 800), chunk: text.slice(i, i + 800) });
    };
  }
  installTick((displayMs) => {
    const dt = Math.min(0.1, Math.max(0, frameDelta(displayMs)));
    native.update(dt);
    recorder?.endFrame(dt);
  });
  return native;
}

let lastFrameMs: number | null = null;
function frameDelta(displayMs: number): number {
  const dt = lastFrameMs === null ? 1 / 72 : (displayMs - lastFrameMs) / 1000;
  lastFrameMs = displayMs;
  return dt;
}

function sampleIds(native: NativeInteractions): string[] {
  return native.provider.sample().map((s: InputSourceSnapshot) => `${s.id}:${s.kind}`);
}

// --- boot ------------------------------------------------------------------------------------
if (mode === "kits") {
  installTick(() => undefined);
  void runKits().catch((error) => {
    done = { pass: false };
    emit("done", { pass: false, error: String((error as Error)?.stack ?? error) });
  });
} else {
  if (!hasShell()) {
    emit("done", { pass: false, error: `mode "${mode}" needs a native host (__rcHost); under Node use --mode kits` });
    installTick(() => undefined);
    done = { pass: false };
  } else {
    play(mode === "trace");
  }
}

// The hit tester is exported for a shell that wants to query through the binding's own class.
export { NativeHitTester };
