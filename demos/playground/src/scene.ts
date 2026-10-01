/**
 * The playground as portable data. Nothing here touches an engine: the
 * interaction descriptor, the pointer display, the station layout as plain
 * numbers, the panel descriptors and the copy. Every platform builds the SAME
 * playground from this file. `stations-three.ts` and `stations-babylon.ts`
 * only turn the layout into meshes.
 *
 * The stations are the control set proven in the Pale Signal research.
 */
import type { InteractionDescriptor, PointerDisplayConfig } from "@realitycollective/webxr-interactions";
import type { SceneDescriptor } from "@realitycollective/xrblocks-uiextensions";

export type Vec3 = [number, number, number];

/** Ring layout: bearing 0 degrees straight ahead (-Z), radius in metres, height y. */
export function onRing(deg: number, r = 0.55, y = 1.0): Vec3 {
  const rad = (deg * Math.PI) / 180;
  return [r * Math.sin(rad), y, -r * Math.cos(rad)];
}

/** The yaw that turns an object placed at `pos` to face the origin. */
export function facePlayerYaw(pos: Vec3): number {
  return Math.atan2(pos[0], pos[2]) + Math.PI;
}

/**
 * What every platform shows for a pointer. Handed to each binding as
 * `pointerDisplay`. IWSDK 1.0.0's defaults with a slightly longer, thicker ray
 * stub and a larger cursor disc so both read on a desktop screen.
 */
export const PLAYGROUND_POINTER_DISPLAY: Partial<PointerDisplayConfig> = {
  ray: "whileHitting",
  cursorOnObjects: true,
  cursorOnPanels: true,
  rayReach: 0.5,
  rayRadius: 0.0015,
  cursorRadius: 0.012,
};

export const PLAYGROUND_DESCRIPTOR: InteractionDescriptor = {
  interactables: [
    {
      id: "pg-button",
      behaviours: [
        { kind: "press", axis: [0, 1, 0], travel: 0.045, depthFraction: 0.6 },
        { kind: "pulse", scaleAmount: 0.25, emissiveAmount: 1.5, decayRate: 6 },
      ],
    },
    {
      id: "pg-gaze-button",
      behaviours: [
        { kind: "press", axis: [0, 0, 1], travel: 0.03, depthFraction: 0.6 },
        { kind: "pulse", scaleAmount: 0.2, emissiveAmount: 1.2, decayRate: 5 },
      ],
      gaze: { dwell: { holdSeconds: 1.8, decayFactor: 2.5 } },
    },
    {
      id: "pg-lever-table",
      behaviours: [{ kind: "hinge", axis: [1, 0, 0], restDir: [0, 1, 0], maxAngle: (50 * Math.PI) / 180 }],
    },
    {
      id: "pg-lever-wall-v",
      behaviours: [{ kind: "hinge", axis: [1, 0, 0], restDir: [0, 0, 1], maxAngle: (40 * Math.PI) / 180 }],
    },
    {
      id: "pg-lever-wall-h",
      behaviours: [{ kind: "hinge", axis: [0, 1, 0], restDir: [0, 0, 1], maxAngle: (40 * Math.PI) / 180 }],
    },
    {
      id: "pg-dial",
      behaviours: [{ kind: "dial", axis: [0, 1, 0], maxAngle: (3 * Math.PI) / 2 }],
    },
    {
      id: "pg-pulley",
      behaviours: [{ kind: "slide", axis: [0, 1, 0], travel: 0.3 }],
    },
    {
      id: "pg-ball",
      behaviours: [{ kind: "grab" }],
      pokeRadius: 0.09,
    },
    {
      id: "pg-hoop",
      behaviours: [{ kind: "tossScore", targetIds: ["pg-ball"], radius: 0.2, axis: [0, 1, 0] }],
    },
  ],
};

// --- Stage -------------------------------------------------------------------

export const STAGE = {
  background: 0x10141b,
  floorColor: 0x181e28,
  floorSize: 20,
  /** Sky and ground colours of the hemisphere light, and its intensity. */
  hemisphere: { sky: 0xdfeaff, ground: 0x202830, intensity: 1.0 },
  /** The key light: where it sits, and its intensity. */
  key: { position: [2, 4, 1] as Vec3, intensity: 1.2 },
} as const;

// --- Station layout ------------------------------------------------------------

/** One primitive. Sizes are metres; a torus lies in the XY plane (hole along Z) before `pitch`. */
export type ShapeSpec =
  | { kind: "group" }
  | { kind: "box"; size: Vec3 }
  | { kind: "cylinder"; radiusTop: number; radiusBottom: number; height: number; segments: number }
  | { kind: "sphere"; radius: number; segments: number }
  | { kind: "torus"; radius: number; tube: number; radialSegments: number; tubularSegments: number };

export interface PartSpec {
  /** Unique name. An interactable part uses its interactable id. */
  name: string;
  /** The name of the part this one hangs from; omitted for a scene root. */
  parent?: string;
  shape: ShapeSpec;
  /** Position, metres: world for a root part, local to the parent otherwise. */
  position: Vec3;
  /** Rotation about Y, radians. */
  yaw?: number;
  /** Rotation about X, radians. */
  pitch?: number;
  /** Uniform scale. */
  scale?: number;
  /** Turn the geometry about X before offsetting it, radians (a lever arm along Z). */
  geometryPitch?: number;
  /** Move the geometry off the part's origin, metres (a lever pivoted at its base). */
  geometryOffset?: Vec3;
  color: number;
  emissive?: number;
  emissiveIntensity?: number;
}

const BODY = 0x2a3140;
const DARK = 0x111111;
const DARK_BLUE = 0x223344;

const buttonPos = onRing(30);
const gazePos = onRing(-8, 0.9, 1.5);
const tablePos = onRing(-30);
const wallVPos = onRing(-65, 0.55, 1.2);
const wallHPos = onRing(-100, 0.55, 1.2);
const dialPos = onRing(65, 0.55, 1.01);
const pulleyPos = onRing(100, 0.55, 1.3);

/** The toss tee position: where the ball starts and returns to. */
export const BALL_HOME: Vec3 = onRing(0, 0.5, 1.1);

/** Parents come before children, so a builder can create them in order. */
export const STATION_PARTS: readonly PartSpec[] = [
  // Push button (30 degrees): pedestal + emissive cyan button.
  { name: "button-pedestal", shape: { kind: "cylinder", radiusTop: 0.085, radiusBottom: 0.1, height: 0.07, segments: 24 }, position: onRing(30, 0.55, 0.95), color: BODY },
  { name: "pg-button", shape: { kind: "cylinder", radiusTop: 0.07, radiusBottom: 0.07, height: 0.045, segments: 32 }, position: buttonPos, color: DARK, emissive: 0x66ccff, emissiveIntensity: 1.2 },

  // Gaze-dwell button (above the toss line at eye height) with its progress ring.
  { name: "pg-gaze-button", shape: { kind: "box", size: [0.16, 0.16, 0.04] }, position: gazePos, yaw: facePlayerYaw(gazePos), color: DARK, emissive: 0xffaa44, emissiveIntensity: 1.0 },
  { name: "gaze-ring", parent: "pg-gaze-button", shape: { kind: "torus", radius: 0.11, tube: 0.008, radialSegments: 8, tubularSegments: 40 }, position: [0, 0, 0.03], scale: 0.001, color: DARK, emissive: 0x44ff88, emissiveIntensity: 1.4 },

  // Table lever (-30 degrees): plate + arm pivoted at its base.
  { name: "table-mount", shape: { kind: "group" }, position: tablePos, yaw: facePlayerYaw(tablePos), color: BODY },
  { name: "table-plate", parent: "table-mount", shape: { kind: "box", size: [0.24, 0.02, 0.24] }, position: [0, 0, 0], color: BODY },
  { name: "pg-lever-table", parent: "table-mount", shape: { kind: "cylinder", radiusTop: 0.02, radiusBottom: 0.02, height: 0.2, segments: 12 }, position: [0, 0, 0], geometryOffset: [0, 0.1, 0], color: DARK_BLUE, emissive: 0x66ffcc, emissiveIntensity: 0.9 },

  // Wall levers (-65 up and down, -100 left and right): wall plate + arm pointing at the player.
  { name: "wall-v-mount", shape: { kind: "group" }, position: wallVPos, yaw: facePlayerYaw(wallVPos), color: BODY },
  { name: "wall-v-plate", parent: "wall-v-mount", shape: { kind: "box", size: [0.3, 0.34, 0.02] }, position: [0, 0, -0.05], color: BODY },
  { name: "pg-lever-wall-v", parent: "wall-v-mount", shape: { kind: "cylinder", radiusTop: 0.02, radiusBottom: 0.02, height: 0.2, segments: 12 }, position: [0, 0, 0], geometryPitch: Math.PI / 2, geometryOffset: [0, 0, 0.1], color: DARK_BLUE, emissive: 0xffcc66, emissiveIntensity: 0.9 },
  { name: "wall-h-mount", shape: { kind: "group" }, position: wallHPos, yaw: facePlayerYaw(wallHPos), color: BODY },
  { name: "wall-h-plate", parent: "wall-h-mount", shape: { kind: "box", size: [0.3, 0.34, 0.02] }, position: [0, 0, -0.05], color: BODY },
  { name: "pg-lever-wall-h", parent: "wall-h-mount", shape: { kind: "cylinder", radiusTop: 0.02, radiusBottom: 0.02, height: 0.2, segments: 12 }, position: [0, 0, 0], geometryPitch: Math.PI / 2, geometryOffset: [0, 0, 0.1], color: DARK_BLUE, emissive: 0xff8866, emissiveIntensity: 0.9 },

  // Dial (65 degrees): panel + knob with a marker.
  { name: "dial-panel", shape: { kind: "box", size: [0.34, 0.025, 0.26] }, position: onRing(65, 0.55, 0.97), color: BODY },
  { name: "pg-dial", shape: { kind: "cylinder", radiusTop: 0.06, radiusBottom: 0.06, height: 0.05, segments: 32 }, position: dialPos, color: DARK_BLUE, emissive: 0x8899ff, emissiveIntensity: 0.6 },
  { name: "dial-marker", parent: "pg-dial", shape: { kind: "box", size: [0.014, 0.012, 0.05] }, position: [0, 0.03, -0.035], color: DARK, emissive: 0xffbb33, emissiveIntensity: 1.4 },

  // Pulley (100 degrees): sphere handle.
  { name: "pg-pulley", shape: { kind: "sphere", radius: 0.05, segments: 16 }, position: pulleyPos, color: DARK_BLUE, emissive: 0xcc88ff, emissiveIntensity: 0.8 },

  // Scoop and toss: tee + ball + flat hoop above it.
  { name: "toss-tee", shape: { kind: "cylinder", radiusTop: 0.03, radiusBottom: 0.05, height: 1.04, segments: 16 }, position: [BALL_HOME[0], 0.52, BALL_HOME[2]], color: BODY },
  { name: "pg-ball", shape: { kind: "sphere", radius: 0.06, segments: 20 }, position: BALL_HOME, color: 0x332211, emissive: 0xff6644, emissiveIntensity: 0.7 },
  { name: "pg-hoop", shape: { kind: "torus", radius: 0.2, tube: 0.02, radialSegments: 12, tubularSegments: 32 }, position: onRing(0, 1.2, 1.5), pitch: -Math.PI / 2, color: DARK_BLUE, emissive: 0x66ffee, emissiveIntensity: 0.9 },
];

/** The part whose scale shows gaze-dwell progress. */
export const DWELL_RING_PART = "gaze-ring";
/** The interactable the dwell ring belongs to. */
export const DWELL_INTERACTABLE = "pg-gaze-button";
/** The interactable thrown with client ballistics. */
export const BALL_INTERACTABLE = "pg-ball";
/** Below this height, metres, a thrown ball has landed. */
export const BALL_FLOOR = 0.06;
/** A thrown ball further than this from the origin, metres, is lost and respawns. */
export const BALL_MAX_RANGE = 15;

// --- Panels ------------------------------------------------------------------

/**
 * Description panels, one per station group, as UI Extensions windows.
 *
 * They sit on a wider ring than the stations so they never sit between you and
 * the thing they describe, and the window host turns each one to face the head
 * pose, so no rotation is carried here.
 *
 * Every window loads the SAME compiled markup. The per-station wording is
 * injected by `client.ts` once the panel is ready, so this stays one template
 * rather than seven near-identical files.
 */
// Well outside the station ring. The furthest station geometry is the hoop at
// 1.2m and the gaze post at 0.9m, so a panel ring of 1.55 sits behind all of it.
const PANEL_RING = 1.55;
const PANEL_HEIGHT = 1.65;
const PANEL_WIDTH = 0.42;
const panelAt = (deg: number): Vec3 => onRing(deg, PANEL_RING, PANEL_HEIGHT);

// Bearings track their station but are nudged apart. At 1.55m a 0.42m panel
// subtends about 16 degrees, so these ~22 degree gaps leave clear air.
export const STATION_PANELS: SceneDescriptor = {
  name: "Interaction playground stations",
  windows: [
    { id: "info-lever-wall", title: "Wall Levers", config: "./ui/station.uikitml", position: panelAt(-82) },
    { id: "info-lever-table", title: "Table Lever", config: "./ui/station.uikitml", position: panelAt(-42) },
    { id: "info-gaze", title: "Gaze Dwell", config: "./ui/station.uikitml", position: panelAt(-20) },
    { id: "info-toss", title: "Scoop & Toss", config: "./ui/station.uikitml", position: panelAt(2) },
    { id: "info-button", title: "Push Button", config: "./ui/station.uikitml", position: panelAt(30) },
    { id: "info-dial", title: "Dial", config: "./ui/station.uikitml", position: panelAt(62) },
    { id: "info-pulley", title: "Pulley", config: "./ui/station.uikitml", position: panelAt(96) },
  ].map((window) => ({ ...window, maxWidth: PANEL_WIDTH, maxHeight: 0.34 })),
};

/** Body and hint copy for each panel in {@link STATION_PANELS}. */
export const STATION_INFO: Record<string, { body: string; hint: string }> = {
  "info-toss": {
    body: "A ball you can pick up and throw at the hoop above it. The flight after you let go is the demo's own physics - the interaction layer reports the grab and the release, nothing more.",
    hint: "Hold left mouse on the ball and throw",
  },
  "info-gaze": {
    body: "Looks back at you. Keep it centred in view and the ring fills; hold long enough and it presses itself, with no click at all.",
    hint: "Right-drag to aim, then hold still",
  },
  "info-lever-table": {
    body: "A lever pivoted at its base that swings toward your hand. Position drives it, not a button, so it follows wherever you pull.",
    hint: "Hold left mouse and pull",
  },
  "info-lever-wall": {
    body: "The same lever behaviour on a wall plate, once swinging up and down and once side to side. Only the hinge axis differs between them.",
    hint: "Hold left mouse and pull",
  },
  "info-button": {
    body: "A push button that travels as you press it and pulses when it fires. The simplest station here, and the only kind that works from a plain click.",
    hint: "Left click",
  },
  "info-dial": {
    body: "A knob that turns to follow your hand through one and a half turns. The marker shows where it is pointing.",
    hint: "Hold left mouse and turn",
  },
  "info-pulley": {
    body: "A handle that slides along a fixed rail and springs back when released. It only ever moves along its one axis, however you pull it.",
    hint: "Hold left mouse and slide",
  },
};
