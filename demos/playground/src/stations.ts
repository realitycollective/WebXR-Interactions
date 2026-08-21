/**
 * The playground stations - the SAME control set proven in the Pale Signal
 * research, expressed as a portable InteractionDescriptor plus per-station
 * three.js mesh builders. Any adapter can rebuild this playground from the
 * same descriptor; only the mesh builders are engine-specific.
 */
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from "three";
import type { InteractionDescriptor } from "@realitycollective/threejs-interactions";
import type { SceneDescriptor } from "@realitycollective/xrblocks-uiextensions";

/** Ring layout: bearing 0° straight ahead (−Z), radius meters, height y. */
export function onRing(deg: number, r = 0.55, y = 1.0): [number, number, number] {
  const rad = (deg * Math.PI) / 180;
  return [r * Math.sin(rad), y, -r * Math.cos(rad)];
}

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

/**
 * Description panels, one per station group, as UI Extensions windows.
 *
 * They sit on a wider ring than the stations so they never sit between you and
 * the thing they describe, and the window host turns each one to face the head
 * pose, so no rotation is carried here.
 *
 * Every window loads the SAME compiled markup. The per-station wording is
 * injected in main.ts once the panel is ready, so this stays one template
 * rather than seven near-identical files.
 */
// Well outside the station ring. The furthest station geometry is the hoop at
// 1.2m and the gaze post at 0.9m, so a panel ring of 1.55 sits behind all of it
// and nothing occludes a panel from the middle of the playground.
const PANEL_RING = 1.55;
const PANEL_HEIGHT = 1.65;
const PANEL_WIDTH = 0.42;
const panelAt = (deg: number) => onRing(deg, PANEL_RING, PANEL_HEIGHT);

// Bearings track their station but are nudged apart. At 1.55m a 0.42m panel
// subtends about 16 degrees, so these ~22 degree gaps leave clear air between
// neighbours - at the old 0.95m ring they overlapped badly in the middle.
export const STATION_PANELS: SceneDescriptor = {
  name: "Interaction playground stations",
  windows: [
    { id: "info-lever-wall", title: "Wall Levers", config: "./ui/station.json", position: panelAt(-82) },
    { id: "info-lever-table", title: "Table Lever", config: "./ui/station.json", position: panelAt(-42) },
    { id: "info-gaze", title: "Gaze Dwell", config: "./ui/station.json", position: panelAt(-20) },
    { id: "info-toss", title: "Scoop & Toss", config: "./ui/station.json", position: panelAt(2) },
    { id: "info-button", title: "Push Button", config: "./ui/station.json", position: panelAt(30) },
    { id: "info-dial", title: "Dial", config: "./ui/station.json", position: panelAt(62) },
    { id: "info-pulley", title: "Pulley", config: "./ui/station.json", position: panelAt(96) },
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

export interface BuiltStations {
  /** id → the object to register as the interactable root. */
  objects: Map<string, Object3D>;
  /** Everything to add to the scene (stations + decorative parts). */
  root: Group;
  /** The gaze ring mesh (drive from dwellProgress). */
  dwellRing: Mesh;
  /** The toss tee position (ball respawn point). */
  ballHome: [number, number, number];
}

function standard(color: number, emissive = 0x000000, emissiveIntensity = 1): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(color),
    emissive: new Color(emissive),
    emissiveIntensity,
    roughness: 0.5,
    metalness: 0.2,
  });
}

/** Build all station meshes; returns the registerable roots. */
export function buildStations(): BuiltStations {
  const root = new Group();
  const objects = new Map<string, Object3D>();

  const place = (object: Object3D, pos: [number, number, number], yawToPlayer = false) => {
    object.position.set(...pos);
    if (yawToPlayer) object.rotation.y = Math.atan2(pos[0], pos[2]) + Math.PI;
    root.add(object);
  };

  // Push button (30°): pedestal (decor) + emissive cyan button.
  const pedestal = new Mesh(new CylinderGeometry(0.085, 0.1, 0.07, 24), standard(0x2a3140));
  place(pedestal, onRing(30, 0.55, 0.95));
  const button = new Mesh(
    new CylinderGeometry(0.07, 0.07, 0.045, 32),
    standard(0x111111, 0x66ccff, 1.2),
  );
  place(button, onRing(30));
  objects.set("pg-button", button);

  // Gaze-dwell button (0°, above the toss line at eye height on a post).
  const gazePanel = new Mesh(new BoxGeometry(0.16, 0.16, 0.04), standard(0x111111, 0xffaa44, 1.0));
  place(gazePanel, onRing(-8, 0.9, 1.5), true);
  objects.set("pg-gaze-button", gazePanel);
  const dwellRing = new Mesh(
    new TorusGeometry(0.11, 0.008, 8, 40),
    standard(0x111111, 0x44ff88, 1.4),
  );
  dwellRing.scale.setScalar(0.001); // grows with dwell progress
  gazePanel.add(dwellRing);
  dwellRing.position.z = 0.03;

  // Table lever (−30°): plate (decor) + arm pivoted at its base.
  const tableMount = new Group();
  place(tableMount, onRing(-30), true);
  const plate = new Mesh(new BoxGeometry(0.24, 0.02, 0.24), standard(0x2a3140));
  tableMount.add(plate);
  const tableArm = leverArm(0x66ffcc);
  tableMount.add(tableArm);
  objects.set("pg-lever-table", tableArm);

  // Wall levers (−65° up/down, −100° left/right): wall plate + outward arm.
  const wallV = wallLever(0xffcc66, onRing(-65, 0.55, 1.2));
  root.add(wallV.mount);
  objects.set("pg-lever-wall-v", wallV.arm);
  const wallH = wallLever(0xff8866, onRing(-100, 0.55, 1.2));
  root.add(wallH.mount);
  objects.set("pg-lever-wall-h", wallH.arm);

  // Dial (65°): panel (decor) + knob with a marker.
  const dialPanel = new Mesh(new BoxGeometry(0.34, 0.025, 0.26), standard(0x2a3140));
  place(dialPanel, onRing(65, 0.55, 0.97));
  const knob = new Mesh(new CylinderGeometry(0.06, 0.06, 0.05, 32), standard(0x223344, 0x8899ff, 0.6));
  const marker = new Mesh(new BoxGeometry(0.014, 0.012, 0.05), standard(0x111111, 0xffbb33, 1.4));
  marker.position.set(0, 0.03, -0.035);
  knob.add(marker);
  place(knob, onRing(65, 0.55, 1.01));
  objects.set("pg-dial", knob);

  // Pulley (100°): sphere handle on a rail.
  const handle = new Mesh(new SphereGeometry(0.05, 16, 16), standard(0x223344, 0xcc88ff, 0.8));
  place(handle, onRing(100, 0.55, 1.3));
  objects.set("pg-pulley", handle);

  // Scoop & toss (0°): tee (decor) + ball + flat hoop.
  const ballHome = onRing(0, 0.5, 1.1);
  const tee = new Mesh(new CylinderGeometry(0.03, 0.05, 1.04, 16), standard(0x2a3140));
  place(tee, [ballHome[0], 0.52, ballHome[2]]);
  const ball = new Mesh(new SphereGeometry(0.06, 20, 20), standard(0x332211, 0xff6644, 0.7));
  place(ball, ballHome);
  objects.set("pg-ball", ball);
  const hoop = new Mesh(new TorusGeometry(0.2, 0.02, 12, 32), standard(0x223344, 0x66ffee, 0.9));
  hoop.rotation.x = -Math.PI / 2;
  place(hoop, onRing(0, 1.2, 1.5));
  objects.set("pg-hoop", hoop);

  return { objects, root, dwellRing, ballHome };
}

function leverArm(emissive: number): Mesh {
  const geometry = new CylinderGeometry(0.02, 0.02, 0.2, 12);
  geometry.translate(0, 0.1, 0); // pivot at the base
  return new Mesh(geometry, standard(0x223344, emissive, 0.9));
}

function wallLever(
  emissive: number,
  pos: [number, number, number],
): { mount: Group; arm: Mesh } {
  const mount = new Group();
  mount.position.set(...pos);
  mount.rotation.y = Math.atan2(pos[0], pos[2]) + Math.PI; // face the player
  const plate = new Mesh(new BoxGeometry(0.3, 0.34, 0.02), standard(0x2a3140));
  plate.position.z = -0.05;
  mount.add(plate);
  const geometry = new CylinderGeometry(0.02, 0.02, 0.2, 12);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, 0.1); // pivot at the wall, arm points at the player
  const arm = new Mesh(geometry, standard(0x223344, emissive, 0.9));
  mount.add(arm);
  return { mount, arm };
}
