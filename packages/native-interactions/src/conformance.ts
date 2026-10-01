/**
 * The Interactions host conformance kit: host cases (the third kind in the
 * Masters' "Validation" section), shipped as data so a native app runs them
 * against its REAL `input` and `interactions` slices on the device.
 *
 * The contract cases a native package ran before this checked shapes against
 * fakes, and passed while the real host measured proximity to a target's
 * centre, which removed every near interaction on the headset. These run the
 * same checks against the host itself, through the test readbacks of
 * `NativeInteractionsTestHost`: the core's whole `hitTesterContractCases()`
 * (surface distance included) over targets the host places, the default
 * target radius, the release velocity reaching `endHold`, and what the host
 * draws for presence. Run them inside a live, focused session.
 *
 * Runner-free, like the core suites: a case resolves on success and rejects
 * with a plain `Error` naming its row otherwise.
 */
import { POINTER_DISPLAY_DEFAULTS } from "@realitycollective/webxr-input";
import {
  hitTesterContractCases,
  nearPointerContractCases,
  physicsFacilityContractCases,
  type HoldRelease,
} from "@realitycollective/webxr-interactions";
import { NativeHitTester } from "./hit-tester.js";
import { NativeInteractions } from "./host.js";
import { NativePhysicsFacility } from "./physics-facility.js";
import { NativeInputProvider } from "./provider.js";
import { NativeTransformPort } from "./transform-port.js";
import type { Vec3Tuple } from "@realitycollective/webxr-input";
import type {
  NativeInputHost,
  NativeInteractionHost,
  NativeInteractionsTestHost,
  NativePhysicsHost,
  NativePointerVisuals,
  NativePresenceShown,
} from "./native-types.js";

/** A drawing as the binding hands it: IWSDK's defaults resolved for one decision. */
function told(sourceId: string, decision: Partial<NativePointerVisuals>): NativePointerVisuals {
  const d = POINTER_DISPLAY_DEFAULTS;
  return {
    sourceId,
    ray: false,
    rayFrom: d.rayHandFade,
    raySolidTo: d.rayReach - d.rayFade,
    rayTo: d.rayReach,
    rayRadius: d.rayRadius,
    rayColor: [d.rayColor[0], d.rayColor[1], d.rayColor[2]],
    cursor: false,
    cursorPoint: null,
    cursorRadius: d.cursorRadius,
    cursorOpacity: d.cursorOpacity,
    cursorOffset: d.cursorOffset,
    activePointer: null,
    targetKind: null,
    targetId: null,
    hitDistance: null,
    ...decision,
  };
}

function samePoint(a: readonly number[] | null | undefined, b: readonly number[] | null | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The real slices under test, and their readbacks. */
export interface NativeInteractionsHostConformanceSetup {
  input: NativeInputHost;
  interactions: NativeInteractionHost;
  testHost: NativeInteractionsTestHost;
  /** The `physics` slice. A host that installs none fails the physics cases. */
  physics?: NativePhysicsHost;
}

/** One check a native host must pass. `name` is `interactions/<row>`, `input/<row>` or `physics/<row>`. */
export interface NativeInteractionsHostConformanceCase {
  name: string;
  run(setup: NativeInteractionsHostConformanceSetup): Promise<void>;
}

function fail(name: string, message: string): never {
  throw new Error(`[${name}] ${message}`);
}

function hostCase(
  name: string,
  run: (setup: NativeInteractionsHostConformanceSetup, name: string) => void | Promise<void>,
): NativeInteractionsHostConformanceCase {
  return { name, run: async (setup) => run(setup, name) };
}

function exactlyOneFamily(shown: NativePresenceShown | undefined): boolean {
  return shown !== undefined && shown.hand !== shown.controller;
}

/** The Interactions and Input host conformance cases. See the file comment. */
export function nativeInteractionsHostConformanceCases(): NativeInteractionsHostConformanceCase[] {
  const hitCases = hitTesterContractCases().map((contractCase) =>
    hostCase(`interactions/${contractCase.name}`, ({ interactions, testHost }, name) => {
      testHost.clearTargets();
      try {
        contractCase.run({
          hitTester: new NativeHitTester({ interactions }),
          driver: { place: (id, position, radius) => testHost.placeTarget(id, position, radius) },
        });
      } catch (error) {
        fail(name, (error as Error).message);
      } finally {
        testHost.clearTargets();
      }
    }),
  );

  // The near-pointer rule over the host's real queries: touch press, grip
  // grab, pointer priority and what the ray and cursor should show.
  const nearCases = nearPointerContractCases().map((contractCase) =>
    hostCase(`interactions/${contractCase.name}`, ({ interactions, testHost }, name) => {
      testHost.clearTargets();
      try {
        contractCase.run({
          hitTester: new NativeHitTester({ interactions }),
          driver: { place: (id, position, radius) => testHost.placeTarget(id, position, radius) },
        });
      } catch (error) {
        fail(name, (error as Error).message);
      } finally {
        testHost.clearTargets();
      }
    }),
  );

  // The platform's physics behind the core contract: the whole shared suite
  // over the host's engine, on the device.
  const physicsCases = physicsFacilityContractCases().map((contractCase) =>
    hostCase(`physics/${contractCase.name}`, ({ physics }, name) => {
      if (!physics) fail(name, "the host installs no physics slice; every native platform names a default engine (Jolt on Quest and Android, RealityKit on visionOS)");
      const facility = new NativePhysicsFacility({ physics });
      try {
        contractCase.run({ facility });
      } catch (error) {
        fail(name, (error as Error).message);
      } finally {
        facility.dispose();
      }
    }),
  );

  return [
    ...hitCases,
    ...nearCases,
    ...physicsCases,
    hostCase("physics/a registered target with a body is held and released through the physics slice", ({ input, interactions, physics, testHost }, name) => {
      if (!physics) fail(name, "the host installs no physics slice");
      testHost.clearTargets();
      const setup = new NativeInteractions({ input, interactions, physics });
      try {
        testHost.placeTarget("rc-kit-body", [0, 1, -1], 0.1);
        const port = setup.register({ id: "rc-kit-body", behaviours: [{ kind: "grab" }] }, { shape: { kind: "sphere", dimensions: [0.1, 0, 0] } });
        if (!physics.hasBody("rc-kit-body")) fail(name, "register with a shape must add a body to the physics slice");
        port.beginHold();
        if (!physics.isSuspended("rc-kit-body")) fail(name, "beginHold on a target with a body must suspend it in the physics slice");
        port.endHold({ linearVelocity: [1, 0, 0], angularVelocity: [0, 0, 0] });
        if (physics.isSuspended("rc-kit-body")) fail(name, "endHold must resume the body");
        const velocity = physics.getVelocity("rc-kit-body").linear;
        if (Math.abs(velocity[0] - 1) > 0.01) fail(name, `endHold must hand the body the release velocity, it has ${JSON.stringify(velocity)}`);
        setup.unregister("rc-kit-body");
        if (physics.hasBody("rc-kit-body")) fail(name, "unregister must remove the body the binding added");
      } finally {
        setup.dispose();
        testHost.clearTargets();
      }
    }),
    hostCase("input/the ray and cursor are drawn exactly as told", ({ input, testHost }, name) => {
      // The binding decides the ray and cursor per source (the arbiter under
      // the app's pointer display) and hands the host the resolved drawing; a
      // host that draws its own ray, a cursor at every ray hit, or applies a
      // display mode of its own fails here, as the Quest host did when it kept
      // the cursor on a touched object and later drew the ray by a shell hook.
      if (typeof input.applyPointerVisuals !== "function") {
        fail(name, "the host has no applyPointerVisuals, so it cannot hide the ray while a hand touches something");
      }
      if (typeof testHost.pointerVisuals !== "function") {
        fail(name, "the test host has no pointerVisuals readback");
      }
      const touched = told("rc-kit-source", { activePointer: "touch", ray: false, cursor: true, cursorPoint: [0, 1, -0.9], targetKind: "object", targetId: "rc-kit-target", hitDistance: 0.01 });
      input.applyPointerVisuals("rc-kit-source", { ...touched });
      const drawn = testHost.pointerVisuals("rc-kit-source");
      if (!drawn || drawn.ray || !drawn.cursor || !samePoint(drawn.cursorPoint, touched.cursorPoint)) {
        fail(name, `told ${JSON.stringify(touched)}, the host draws ${JSON.stringify(drawn)}`);
      }
      if (!testHost.cursors().some((point) => samePoint(point, touched.cursorPoint))) {
        fail(name, "the host draws no cursor disc at the point it was told");
      }
      const idle = told("rc-kit-source", { ray: true });
      input.applyPointerVisuals("rc-kit-source", { ...idle });
      const after = testHost.pointerVisuals("rc-kit-source");
      if (!after || !after.ray || after.cursor) {
        fail(name, `told ${JSON.stringify(idle)}, the host draws ${JSON.stringify(after)}`);
      }
      if (testHost.cursors().some((point) => samePoint(point, touched.cursorPoint))) {
        fail(name, "the host still draws the cursor disc after being told to stop");
      }
      // A cursor on a PANEL arrives through the same member: the host draws
      // it where told, and never needs a stopgap of its own for panels.
      const onPanel = told("rc-kit-source", { activePointer: "ray", ray: true, rayTo: 0.3, cursor: true, cursorPoint: [0.2, 1.2, -0.8], targetKind: "panel", targetId: "rc-kit-panel", hitDistance: 0.8 });
      input.applyPointerVisuals("rc-kit-source", { ...onPanel });
      const panel = testHost.pointerVisuals("rc-kit-source");
      if (!panel || !panel.cursor || !samePoint(panel.cursorPoint, onPanel.cursorPoint)) {
        fail(name, `told a cursor on a panel ${JSON.stringify(onPanel)}, the host draws ${JSON.stringify(panel)}`);
      }
      if (!testHost.cursors().some((point) => samePoint(point, onPanel.cursorPoint))) {
        fail(name, "the host draws no cursor disc on the panel it was told about");
      }
      // The ray told off stays off whatever the host might prefer to show.
      const rayOff = told("rc-kit-source", { activePointer: "ray", ray: false, cursor: true, cursorPoint: [0, 1, -1.5], targetKind: "object", targetId: "rc-kit-target", hitDistance: 1.5 });
      input.applyPointerVisuals("rc-kit-source", { ...rayOff });
      const off = testHost.pointerVisuals("rc-kit-source");
      if (!off || off.ray) fail(name, "told to draw no ray while the ray hits an object (the app's display says never), the host still draws one");
      input.applyPointerVisuals("rc-kit-source", { ...told("rc-kit-source", {}) });
    }),
    hostCase("input/the pointer display is the app's: the binding resolves it and the host draws what it is handed", ({ input, interactions, testHost }, name) => {
      // Two setups with opposite ray settings over the same live sources:
      // what the host draws for every source must be exactly the binding's
      // drawing each time. A host with a display mode of its own (a shell
      // hook, a default of "always") disagrees on one of the two.
      if (typeof input.applyPointerVisuals !== "function" || typeof testHost.pointerVisuals !== "function") {
        fail(name, "the host has no applyPointerVisuals or no pointerVisuals readback");
      }
      for (const ray of ["never", "always"] as const) {
        const setup = new NativeInteractions({ input, interactions, pointerDisplay: { ray } });
        try {
          if (typeof testHost.pointerDisplay === "function") {
            const received = testHost.pointerDisplay();
            if (received?.ray !== ray) fail(name, `the host received pointer display ${JSON.stringify(received)} after the binding was configured with ray "${ray}"`);
          }
          setup.update(1 / 72);
          for (const source of input.sample()) {
            const decided = setup.runtime.getPointerDrawing(source.id);
            const drawn = testHost.pointerVisuals(source.id);
            if (!decided || !drawn) fail(name, `the binding decided ${String(JSON.stringify(decided))} for source "${source.id}" and the host draws ${String(JSON.stringify(drawn))}: a sampled source gets a drawing, and the host keeps it`);
            // With ray "never" the binding decides no ray, so a host that still draws one differs here.
            if (drawn.ray !== decided.ray || drawn.cursor !== decided.cursor || !samePoint(drawn.cursorPoint, decided.cursorPoint) || Math.abs(drawn.rayTo - decided.rayTo) > 1e-9) {
              fail(name, `with ray "${ray}", the binding decided ${JSON.stringify(decided)} for "${source.id}" and the host draws ${JSON.stringify(drawn)}`);
            }
          }
        } finally {
          setup.dispose();
        }
      }
    }),
    hostCase("input/a hand's select is 0 or 1 (the runtime's pinch gesture) and its squeeze is 0", ({ input }, name) => {
      // The web gives IWSDK a binary pinch (the browser's selectstart and
      // selectend); a host that reports the analog pinch strength, or the
      // grasp as squeeze, holds a grab open on a relaxed hand. Run with hands
      // tracked; a session with controllers only has nothing to check here.
      for (const source of input.sample()) {
        if (source.kind !== "hand") continue;
        if (source.select !== 0 && source.select !== 1) {
          fail(name, `hand "${source.id}" reports select ${source.select}; a hand's select is 1 while the runtime reports its pinch gesture and 0 otherwise, never a strength`);
        }
        if (source.squeeze !== 0) {
          fail(name, `hand "${source.id}" reports squeeze ${source.squeeze}; a hand has no squeeze (its grab is its pinch through select), and a grasp value here never releases a grab`);
        }
      }
    }),
    hostCase("interactions/queries consider registered interactables only: scenery enclosing the hand is never answered", ({ interactions, testHost }, name) => {
      // A host that answered proximity with any shown mesh found the floor's
      // bounds around every hand and no fingertip ever reached a target.
      if (typeof testHost.placeScenery !== "function") fail(name, "the test host has no placeScenery, so the query scope cannot be proved");
      testHost.clearTargets();
      try {
        testHost.placeScenery("rc-kit-floor", [0, 0, -1], 3);
        testHost.placeScenery("rc-kit-wall", [0, 1, -1.05], 0.02);
        if (interactions.hitProximity([0, 1, -1], 0.5) !== null) fail(name, "with only scenery placed, hitProximity answered; queries consider registered interactables only");
        if (interactions.hitRay({ origin: [0, 1, 0], direction: [0, 0, -1] }) !== null) fail(name, "with only scenery placed, hitRay answered");
        if (interactions.hitCone && interactions.hitCone({ origin: [0, 1, 0], direction: [0, 0, -1] }, (5 * Math.PI) / 180, 30) !== null) fail(name, "with only scenery placed, hitCone answered");
        testHost.placeTarget("rc-kit-target", [0, 1, -1], 0.1);
        const near = interactions.hitProximity([0, 1, -0.87], 0.5);
        if (!near || near.targetId !== "rc-kit-target") fail(name, `a fingertip 3 cm from a target, inside the floor's bounds, must reach the target; got ${JSON.stringify(near)}`);
        if (Math.abs(near.distance - 0.03) > 0.001) fail(name, `the distance is to the target's surface, 0.03 within 1 mm, got ${near.distance}`);
        const along = interactions.hitRay({ origin: [0, 1, 0], direction: [0, 0, -1] });
        if (!along || along.targetId !== "rc-kit-target") fail(name, `a ray through scenery to a target must answer the target; got ${JSON.stringify(along)}`);
      } finally {
        testHost.clearTargets();
      }
    }),
    hostCase("interactions/a registered target with no radius is a 10 cm sphere", ({ input, interactions, testHost }, name) => {
      testHost.clearTargets();
      const setup = new NativeInteractions({ input, interactions });
      try {
        // Placed small, then registered with no radius: the registration
        // must make it a 0.1 m sphere, so a point 9 cm from its centre is
        // inside it.
        testHost.placeTarget("rc-kit-bare", [0, 1, -1], 0.02);
        setup.register({ id: "rc-kit-bare", behaviours: [] });
        const hit = interactions.hitProximity([0.09, 1, -1], 0.001);
        if (!hit || hit.targetId !== "rc-kit-bare") {
          fail(name, "a point 9 cm from a bare target's centre did not reach it; the host is not using the 0.1 m radius");
        }
      } finally {
        setup.dispose();
        testHost.clearTargets();
      }
    }),
    hostCase("interactions/endHold hands the host the release velocity", ({ interactions, testHost }, name) => {
      testHost.clearTargets();
      try {
        testHost.placeTarget("rc-kit-throw", [0, 1, -1], 0.1);
        const port = new NativeTransformPort("rc-kit-throw", { interactions });
        const release: HoldRelease = { linearVelocity: [1, 2, 3], angularVelocity: [0, 0.5, 0] };
        port.beginHold();
        port.endHold(release);
        const received = testHost.lastRelease("rc-kit-throw");
        if (JSON.stringify(received) !== JSON.stringify(release)) {
          fail(name, `the host received ${JSON.stringify(received)}, expected ${JSON.stringify(release)}`);
        }
      } finally {
        testHost.clearTargets();
      }
    }),
    hostCase("input/capabilities in a live session: rays, pokes and pose-only grabs", ({ input }, name) => {
      const provider = new NativeInputProvider({ input });
      try {
        const caps = provider.getCapabilities();
        // Pose-only grabs follow from the same fact, so rays and pokes carry it.
        if (!caps.rays || !caps.pokes || caps.grabs !== "poseOnly") {
          fail(name, `a live session must report rays, pokes and pose-only grabs, got ${JSON.stringify(caps)}; run the kit inside a live session`);
        }
      } finally {
        provider.dispose();
      }
    }),
    hostCase("input/presence hides the models only, per side", ({ input, testHost }, name) => {
      const provider = new NativeInputProvider({ input });
      try {
        if (!provider.getCapabilities().presence || !provider.setPresenceVisible) {
          fail(name, "the host has no applyPresence, so presence cannot be shown or hidden");
        }
        provider.setPresenceVisible("left", false);
        const left = testHost.presenceShown("left");
        if (!left || left.hand || left.controller) fail(name, `a hidden left side still draws ${JSON.stringify(left)}`);
        if (!exactlyOneFamily(testHost.presenceShown("right"))) {
          fail(name, `the right side must still draw exactly one family, drew ${JSON.stringify(testHost.presenceShown("right"))}`);
        }
      } finally {
        provider.setPresenceVisible?.("all", true);
        provider.dispose();
      }
    }),
    hostCase('input/"auto" shows the family the live session uses', ({ input, testHost }, name) => {
      const provider = new NativeInputProvider({ input });
      try {
        provider.setPresenceModality?.("auto");
        const handJoints = provider.getCapabilities().handJoints;
        for (const side of ["left", "right"] as const) {
          const shown = testHost.presenceShown(side);
          if (!shown || shown.hand !== handJoints || shown.controller !== !handJoints) {
            fail(name, `${side} draws ${JSON.stringify(shown)} with hand joints ${handJoints ? "live" : "off"}`);
          }
        }
      } finally {
        provider.dispose();
      }
    }),
    hostCase("input/eye gaze: a host that reports eye tracking poses the gaze, and the binding takes far targeting", ({ input }, name) => {
      // Runs when the host reports eye tracking; a host without it (visionOS,
      // a Quest without eye tracking) passes without running. With it, the
      // host must hand the binding a valid pose in a live, focused session,
      // and the binding then samples one gaze snapshot with a ray. That the
      // hand and controller far rays drop is the shared contract case.
      if (!input.getFacts().eyeTracking) return;
      if (typeof input.getEyeGazePose !== "function") {
        fail(name, "the host reports eyeTracking but has no getEyeGazePose(); the binding cannot use a fact it cannot pose");
      }
      const provider = new NativeInputProvider({ input });
      try {
        if (!provider.getCapabilities().eyeGaze) {
          fail(name, "the host reports eyeTracking in a live session, so capabilities.eyeGaze must be true; is the session focused?");
        }
        const pose = input.getEyeGazePose();
        if (!pose || [...pose.position, ...pose.quaternion].some((n) => !Number.isFinite(n))) {
          fail(name, `getEyeGazePose() returned ${JSON.stringify(pose)}; run the kit while the user's eyes are tracked`);
        }
        const gaze = provider.sample().find((source) => source.kind === "gaze");
        if (!gaze?.ray) fail(name, "with a valid gaze pose the binding must sample one gaze snapshot with a ray");
      } finally {
        provider.dispose();
      }
    }),
    hostCase("input/eye gaze: a cone query never answers with a hidden target", ({ interactions, testHost }, name) => {
      if (!interactions.hitCone) return;
      testHost.clearTargets();
      try {
        testHost.placeTarget("rc-kit-cone", [0.2, 1, -2], 0.1);
        const ray = { origin: [0, 1, 0] as Vec3Tuple, direction: [0, 0, -1] as Vec3Tuple };
        const shown = interactions.hitCone(ray, (5 * Math.PI) / 180, 30);
        if (!shown || shown.targetId !== "rc-kit-cone") {
          fail(name, "a target 0.2 m beside a ray 2 m out, inside a 5 degree cone, was not found");
        }
        testHost.setTargetVisible?.("rc-kit-cone", false);
        if (testHost.setTargetVisible && interactions.hitCone(ray, (5 * Math.PI) / 180, 30) !== null) {
          fail(name, "the cone query answered with a hidden target");
        }
      } finally {
        testHost.clearTargets();
      }
    }),
    hostCase("input/presence never hides the cursors", ({ input, testHost }, name) => {
      const provider = new NativeInputProvider({ input });
      try {
        const before = testHost.cursors().length;
        provider.setPresenceVisible?.("all", false);
        const after = testHost.cursors().length;
        if (after !== before) fail(name, `hiding presence changed the cursors drawn from ${before} to ${after}`);
      } finally {
        provider.setPresenceVisible?.("all", true);
        provider.dispose();
      }
    }),
  ];
}
