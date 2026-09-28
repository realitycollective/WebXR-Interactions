/**
 * The shared near-pointer conformance suite: the touch press, the grip grab,
 * pointer priority with its selection lock, and the ray and cursor visuals
 * (`near-pointer.ts`), run through a binding's own `HitTester` so every
 * platform proves the same rule over its own scene queries.
 *
 * Runner-free, like `hitTesterContractCases()`: an adapter's test file is a
 * loop over these cases with the same subject factory it already uses for
 * the hit-tester suite. The suite drives an `InteractionRuntime` itself, with
 * a scripted provider, so the only platform code under test is the hit
 * tester and the targets the driver places.
 *
 * Every distance below is metres to the target's SURFACE, the quantity the
 * touch and grab pointers compare (IWSDK's sphere intersector reports the
 * distance from the fingertip to the point on the mesh).
 */
import {
  NO_CAPABILITIES,
  type InputCapabilities,
  type InputProvider,
  type InputSourceSnapshot,
  type Vec3Tuple,
} from "@realitycollective/webxr-input";
import type { HitTesterContractSubject } from "./contract-cases.js";
import type { InteractionEvent } from "./events.js";
import { NEAR_POINTER_DEFAULTS, type PointerVisuals } from "./near-pointer.js";
import { InteractionRuntime } from "./runtime.js";

/** One check a binding's hit tester must pass under the near-pointer rule. */
export interface NearPointerContractCase {
  name: string;
  run(subject: HitTesterContractSubject): void;
}

/**
 * The shared near-pointer conformance suite. An adapter's test file:
 *
 * ```ts
 * for (const contractCase of nearPointerContractCases()) {
 *   it(contractCase.name, () => contractCase.run(makeSubject()));
 * }
 * ```
 */
export function nearPointerContractCases(): readonly NearPointerContractCase[] {
  return NEAR_POINTER_CASES;
}

/** A provider whose sources a case sets frame by frame. */
class ScriptedProvider implements InputProvider {
  sources: InputSourceSnapshot[] = [];
  private readonly capabilities: InputCapabilities = {
    ...NO_CAPABILITIES,
    rays: true,
    pokes: true,
    grabs: "poseOnly",
    handJoints: true,
    pinch: true,
    headPose: false,
    gaze: false,
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
}

const CENTRE: Vec3Tuple = [0, 1, -1];
const RADIUS = 0.1;
/** A ray from the viewer straight through the target. */
const RAY_AT = { origin: [0, 1, 0] as Vec3Tuple, direction: [0, 0, -1] as Vec3Tuple };
/** A ray pointing away from everything. */
const RAY_AWAY = { origin: [0, 1, 0] as Vec3Tuple, direction: [0, 0, 1] as Vec3Tuple };
const FAR: Vec3Tuple = [0, 1, 1];

/** A point `distance` metres outside the target's surface, on its near side. */
function outside(distance: number): Vec3Tuple {
  return [CENTRE[0], CENTRE[1], CENTRE[2] + RADIUS + distance];
}

interface HandFrame {
  tip?: Vec3Tuple;
  grip?: Vec3Tuple;
  ray?: "at" | "away" | "none";
  select?: number;
  squeeze?: number;
  kind?: "hand" | "controller";
}

function hand(frame: HandFrame): InputSourceSnapshot {
  const snapshot: InputSourceSnapshot = {
    id: "right",
    kind: frame.kind ?? "hand",
    handedness: "right",
    select: frame.select ?? 0,
    squeeze: frame.squeeze ?? 0,
  };
  const ray = frame.ray ?? "away";
  if (ray !== "none") snapshot.ray = ray === "at" ? { ...RAY_AT } : { ...RAY_AWAY };
  snapshot.indexTip = frame.tip ?? FAR;
  snapshot.gripPose = { position: frame.grip ?? FAR, quaternion: [0, 0, 0, 1] };
  return snapshot;
}

interface Rig {
  runtime: InteractionRuntime;
  provider: ScriptedProvider;
  events: InteractionEvent[];
  visuals: PointerVisuals[];
  /** Feed one frame and return the event types it produced. */
  frame(frame: HandFrame): string[];
}

function rig(subject: HitTesterContractSubject, behaviours: Array<{ kind: "press" } | { kind: "grab" }> = [{ kind: "press" }]): Rig {
  subject.driver.place("target", CENTRE, RADIUS);
  const provider = new ScriptedProvider();
  const runtime = new InteractionRuntime({ provider, hitTester: subject.hitTester, velocity: false });
  const events: InteractionEvent[] = [];
  const visuals: PointerVisuals[] = [];
  runtime.onEvent((event) => events.push(event));
  runtime.onPointerVisuals((list) => {
    visuals.length = 0;
    visuals.push(...list);
  });
  runtime.registerInteractable({ id: "target", behaviours });
  return {
    runtime,
    provider,
    events,
    visuals,
    frame(frame) {
      const before = events.length;
      provider.sources = [hand(frame)];
      runtime.update(1 / 60);
      return events.slice(before).map((event) => event.type);
    },
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectActive(r: Rig, kind: string | null, when: string): void {
  const active = r.runtime.getActivePointer("right");
  assert(active === kind, `${when}: the active pointer must be ${String(kind)}, got ${String(active)}`);
}

const D = NEAR_POINTER_DEFAULTS;

const NEAR_POINTER_CASES: readonly NearPointerContractCase[] = [
  {
    name: "a fingertip approaching from outside hovers at 0.15 m, presses at 0.02 m, releases on the way out and stops hovering beyond 0.2 m",
    run(subject) {
      const r = rig(subject);
      r.frame({ tip: outside(0.3) });
      expectActive(r, null, "at 0.3 m");
      let types = r.frame({ tip: outside(D.touchHoverEnter - 0.01) });
      expectActive(r, "touch", "inside the hover enter distance");
      assert(types.includes("hoverEnter"), "entering the hover band must raise hoverEnter");
      types = r.frame({ tip: outside(0.05) });
      assert(!types.includes("pressStart"), "5 cm out must not press");
      types = r.frame({ tip: outside(D.touchDown) });
      assert(types.includes("pressStart"), "reaching the press distance must raise pressStart");
      assert(r.runtime.getState("target")?.pressed === true, "the target must be pressed");
      types = r.frame({ tip: outside(0.005) });
      assert(!types.includes("pressEnd") && !types.includes("pressStart"), "going deeper must change nothing");
      types = r.frame({ tip: outside(D.touchDown + 0.01) });
      assert(types.includes("pressEnd"), "coming back out past the press distance must release");
      r.frame({ tip: outside(D.touchHoverEnter + 0.02) });
      expectActive(r, "touch", "between enter and exit while hovering (hysteresis)");
      types = r.frame({ tip: outside(D.touchHoverExit + 0.01) });
      expectActive(r, null, "beyond the exit distance");
      assert(types.includes("hoverExit"), "leaving the exit distance must raise hoverExit");
    },
  },
  {
    name: "a fingertip first seen inside the press band never presses until it has been outside it",
    run(subject) {
      const r = rig(subject);
      let types = r.frame({ tip: outside(0.01) });
      assert(types.includes("hoverEnter") && !types.includes("pressStart"), "a fingertip that appears inside the band hovers but must not press");
      types = r.frame({ tip: outside(0.0) });
      assert(!types.includes("pressStart"), "staying inside must not press");
      r.frame({ tip: outside(0.05) });
      types = r.frame({ tip: outside(0.015) });
      assert(types.includes("pressStart"), "coming back in from outside must press");
    },
  },
  {
    name: "a grip within 0.07 m of the surface makes grab the active pointer and a squeeze grabs that target",
    run(subject) {
      const r = rig(subject, [{ kind: "grab" }]);
      r.frame({ grip: outside(D.grabRadius - 0.02), ray: "at" });
      expectActive(r, "grab", "grip inside the grab radius, ray also hitting");
      let types = r.frame({ grip: outside(D.grabRadius - 0.02), ray: "at", squeeze: 1 });
      assert(types.includes("grabStart"), "a squeeze while grab owns the hand must grab");
      types = r.frame({ grip: outside(D.grabRadius - 0.02), ray: "at", squeeze: 0 });
      assert(types.includes("grabEnd"), "releasing the squeeze must end the grab");
      r.frame({ grip: outside(D.grabRadius + 0.01), ray: "away" });
      expectActive(r, null, "grip outside the grab radius with no ray hit");
    },
  },
  {
    name: "touch beats grab beats ray",
    run(subject) {
      const r = rig(subject);
      r.frame({ tip: outside(0.1), grip: outside(0.05), ray: "at" });
      expectActive(r, "touch", "fingertip, grip and ray all on the target");
      r.frame({ grip: outside(0.05), ray: "at" });
      expectActive(r, "grab", "grip and ray on the target");
      r.frame({ ray: "at" });
      expectActive(r, "ray", "only the ray on the target");
      r.frame({ ray: "away" });
      expectActive(r, null, "nothing on the target");
    },
  },
  {
    name: "the ray and its cursor show only while the ray owns the source, and the cursor sits at the active pointer's hit",
    run(subject) {
      const r = rig(subject);
      r.frame({ ray: "at" });
      let v = r.visuals[0]!;
      assert(v.ray && v.cursor && v.cursorPoint !== null, "with the ray active, the ray and its cursor show");
      assert(Math.abs(v.cursorPoint![2] - (CENTRE[2] + RADIUS)) <= RADIUS + 0.05, "the cursor sits near the ray's hit on the target");
      r.frame({ tip: outside(0.05), ray: "at" });
      v = r.visuals[0]!;
      assert(!v.ray, "with touch active, the ray is hidden");
      assert(v.cursor && v.cursorPoint !== null, "with touch active, the cursor shows at the touch point");
      assert(Math.abs(v.cursorPoint![2] - (CENTRE[2] + RADIUS)) <= RADIUS + 0.05, "the cursor sits on the surface under the fingertip");
      r.frame({ grip: outside(0.05), ray: "at" });
      v = r.visuals[0]!;
      assert(!v.ray && v.cursor, "with grab active, the ray is hidden and the cursor shows");
      r.frame({ ray: "away" });
      v = r.visuals[0]!;
      assert(v.ray && !v.cursor && v.cursorPoint === null, "with nothing active, the ray shows and the cursor does not");
      r.frame({ ray: "none" });
      v = r.visuals[0]!;
      assert(!v.ray && !v.cursor, "a source with no ray draws no ray");
    },
  },
  {
    name: "a pointer that is pressing keeps the source until it releases",
    run(subject) {
      const r = rig(subject);
      r.frame({ ray: "at" });
      let types = r.frame({ ray: "at", select: 1 });
      assert(types.includes("pressStart"), "a select on the ray target presses it");
      r.frame({ tip: outside(0.05), ray: "at", select: 1 });
      expectActive(r, "ray", "a fingertip entering the band while the ray presses");
      types = r.frame({ tip: outside(0.05), ray: "at", select: 0 });
      assert(types.includes("pressEnd"), "releasing select ends the ray press");
      r.frame({ tip: outside(0.05), ray: "at" });
      expectActive(r, "touch", "once released, touch takes the source");
    },
  },
  {
    name: "a controller's ray origin presses by touch exactly as a fingertip does",
    run(subject) {
      const r = rig(subject);
      r.frame({ kind: "controller", tip: outside(0.1) });
      expectActive(r, "touch", "a controller nose inside the hover band");
      const types = r.frame({ kind: "controller", tip: outside(0.01) });
      assert(types.includes("pressStart"), "a controller nose reaching the press distance presses");
    },
  },
];
