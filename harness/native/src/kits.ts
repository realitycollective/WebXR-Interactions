/**
 * The Interactions family's host conformance kit and shared suites, run
 * against a native host's test slices on the device, or against this
 * repository's reference fakes under Node. One JSON line per suite and one
 * `done` line at the end, the shape the conversion pipeline's runner reads.
 *
 * On a device the shell installs `__rcShell.testHost`: a second host object
 * (never the live `__rcHost`, whose frames the suites must not disturb)
 * carrying `input`, `interactions` and `physics` slices, and `readbacks`
 * with the `NativeInteractionsTestHost` members the kit reads back through.
 * Under Node the fakes stand in, so the same bundle proves the bundle.
 */
import {
  hitTesterContractCases,
  inputProviderContractCases,
  nativeInteractionsHostConformanceCases,
  nearPointerContractCases,
  physicsFacilityContractCases,
  transformPortContractCases,
  NativeHitTester,
  NativeInputProvider,
  NativePhysicsFacility,
  NativeTransformPort,
  type NativeInputHost,
  type NativeInteractionHost,
  type NativeInteractionsTestHost,
  type NativePhysicsHost,
} from "@realitycollective/native-interactions";
import type { PoseTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import { emit, round, settle, shellGlobal } from "./prelude.js";

/** What the shell's test host carries for this family. */
export interface InteractionsTestSlices {
  input: NativeInputHost;
  interactions: NativeInteractionHost & {
    /** The shell's own drivers beside the contract: place a target for the shared suites. */
    place?(id: string, position: Vec3Tuple, radius: number): void;
    placeScenery?(id: string, position: Vec3Tuple, radius: number): void;
    placeRest?(id: string, pose: PoseTuple): void;
    reset?(): void;
  };
  physics?: NativePhysicsHost;
  readbacks?: { interactions?: NativeInteractionsTestHost };
}

export interface SuiteResult {
  name: string;
  pass: number;
  fail: number;
  total: number;
  failures: Array<{ name: string; error: string }>;
}

/** The shell's test host, if the shell installed one. */
export function shellTestSlices(): InteractionsTestSlices | null {
  const shell = shellGlobal();
  const test = shell.testHost;
  if (typeof test !== "object" || test === null) return null;
  const t = test as Partial<InteractionsTestSlices>;
  if (!t.input || !t.interactions) return null;
  return t as InteractionsTestSlices;
}

/**
 * The kit's test host over the shell's readbacks, with the drivers the shell
 * keeps on its `interactions` slice bridged onto the members the kit reads:
 * `placeScenery` (added to the kit on 29 September 2026) is the slice's, and
 * a missing `pointerDisplay` readback is simply absent (that case then checks
 * the drawing alone).
 */
export function kitTestHost(slices: InteractionsTestSlices): NativeInteractionsTestHost | null {
  const readbacks = slices.readbacks?.interactions;
  if (!readbacks) return null;
  const bridged: NativeInteractionsTestHost = {
    placeTarget: (id, position, radius) => readbacks.placeTarget(id, position, radius),
    placeScenery: (id, position, radius) => {
      const own = (readbacks as Partial<NativeInteractionsTestHost>).placeScenery;
      if (own) own.call(readbacks, id, position, radius);
      else if (slices.interactions.placeScenery) slices.interactions.placeScenery(id, position, radius);
      else throw new Error("the test host has no placeScenery (neither readbacks.interactions.placeScenery nor interactions.placeScenery)");
    },
    clearTargets: () => readbacks.clearTargets(),
    presenceShown: (side) => readbacks.presenceShown(side),
    lastRelease: (id) => readbacks.lastRelease(id),
    cursors: () => readbacks.cursors(),
    ...(readbacks.pointerVisuals ? { pointerVisuals: (id) => readbacks.pointerVisuals!(id) } : {}),
    ...(readbacks.pointerDisplay ? { pointerDisplay: () => readbacks.pointerDisplay!() } : {}),
    ...(readbacks.setTargetVisible ? { setTargetVisible: (id, visible) => readbacks.setTargetVisible!(id, visible) } : {}),
  };
  return bridged;
}

async function runCases<S>(
  name: string,
  cases: readonly { name: string; run(subject: S): void | Promise<void> }[],
  subject: () => S,
  after: (subject: S) => void = () => undefined,
): Promise<SuiteResult> {
  const result: SuiteResult = { name, pass: 0, fail: 0, total: 0, failures: [] };
  for (const c of cases) {
    result.total += 1;
    const s = subject();
    try {
      const out = c.run(s);
      if (out && typeof (out as Promise<void>).then === "function") await settle(out as Promise<void>);
      result.pass += 1;
    } catch (error) {
      result.fail += 1;
      result.failures.push({ name: c.name, error: String((error as Error)?.message ?? error) });
    } finally {
      after(s);
    }
  }
  emit("suite", { name, pass: result.pass, fail: result.fail, total: result.total, failures: result.failures });
  return result;
}

const REST: PoseTuple = { position: [1.2, 0.8, -1.5], quaternion: [0, Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)] };

/** Run every suite this family ships against the slices given. */
export async function runInteractionsKits(slices: InteractionsTestSlices): Promise<{ suites: SuiteResult[]; pass: boolean }> {
  const suites: SuiteResult[] = [];
  const ix = slices.interactions;
  const place = (id: string, position: Vec3Tuple, radius: number): void => {
    if (ix.place) ix.place(id, position, radius);
    else if (slices.readbacks?.interactions) slices.readbacks.interactions.placeTarget(id, position, radius);
    else throw new Error("the test host cannot place a target");
  };
  suites.push(await runCases("input provider (NativeInputProvider)", inputProviderContractCases(), () => new NativeInputProvider({ input: slices.input })));
  suites.push(
    await runCases("hit tester (NativeHitTester)", hitTesterContractCases(), () => {
      ix.reset?.();
      slices.readbacks?.interactions?.clearTargets();
      return { hitTester: new NativeHitTester({ interactions: ix }), driver: { place } };
    }),
  );
  suites.push(
    await runCases("near pointers (nearPointerContractCases)", nearPointerContractCases(), () => {
      ix.reset?.();
      slices.readbacks?.interactions?.clearTargets();
      return { hitTester: new NativeHitTester({ interactions: ix }), driver: { place } };
    }),
  );
  suites.push(
    await runCases("transform port (NativeTransformPort)", transformPortContractCases(), () => {
      ix.reset?.();
      ix.placeRest?.("contract-port", REST);
      return { port: new NativeTransformPort("contract-port", { interactions: ix }), rest: { position: [...REST.position] as Vec3Tuple, quaternion: [...REST.quaternion] as PoseTuple["quaternion"] } };
    }),
  );
  if (slices.physics) {
    const physics = slices.physics;
    // One facility per case over the same slice, released after each: the kit's own physics cases do the same.
    suites.push(await runCases("physics facility (NativePhysicsFacility)", physicsFacilityContractCases(), () => ({ facility: new NativePhysicsFacility({ physics }) }), (s) => s.facility.dispose()));
  }
  const testHost = kitTestHost(slices);
  if (testHost) {
    suites.push(
      await runCases("interactions host kit (nativeInteractionsHostConformanceCases)", nativeInteractionsHostConformanceCases(), () => ({
        input: slices.input,
        interactions: ix,
        testHost,
        ...(slices.physics ? { physics: slices.physics } : {}),
      })),
    );
  } else {
    emit("suite", { name: "interactions host kit (nativeInteractionsHostConformanceCases)", pass: 0, fail: nativeInteractionsHostConformanceCases().length, total: nativeInteractionsHostConformanceCases().length, failures: [{ name: "*", error: "the test host has no readbacks.interactions" }] });
  }
  const pass = suites.every((s) => s.fail === 0);
  emit("kits", { pass, suites: suites.map((s) => ({ name: s.name, pass: s.pass, fail: s.fail, total: s.total })), elapsedMs: round(0) });
  return { suites, pass };
}
