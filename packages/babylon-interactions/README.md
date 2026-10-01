# @realitycollective/babylon-interactions

The Babylon.js adapter for the Reality Collective Interaction Extensions. It feeds a Babylon WebXR experience into the [`@realitycollective/webxr-interactions`](https://www.npmjs.com/package/@realitycollective/webxr-interactions) core.

```sh
npm install @realitycollective/babylon-interactions
```

It re-exports everything from the core, so this is the only interaction package your app needs.

> **Maturity.** Written against the documented Babylon API and covered by structural fakes; the interaction playground runs it in a real Babylon scene on desktop. No headset pass yet. The physics facility fails 7 of the 10 shared physics cases against a real Havok plugin (`test/physics-facility-havok.test.ts`), so treat physics on Babylon as experimental.

## What it binds

| Layer | Detail |
| --- | --- |
| **Input** | `WebXRDefaultExperience`: controllers, motion controller components (trigger, squeeze), hand-tracking joints, and the session manager for what is live |
| **Hit-testing** | A sphere test over registered nodes, or your own `scene.pickWithRay` through the `pickWithRay` hook |
| **Movement** | Moves, rotates and scales Babylon nodes for grab, hinge, dial and slide |
| **Desktop** | `scene.onPointerObservable` as a pointer fallback, so the same scene is testable without a headset |
| **Haptics** | Through the motion controller's `pulse` |
| **No @babylonjs/core dependency** | It matches the shape of the Babylon API in TypeScript rather than importing Babylon, so an upstream release cannot break your install |
| **Pointer visuals** | `BabylonPointerVisuals` draws the app's `pointerDisplay` through a structural kit of your own `MeshBuilder`, `StandardMaterial`, `Color3` and `Quaternion`: `createBabylonInteractions({ pointerVisuals: { kit }, pointers, pointerDisplay })` |
| **Physics** | `BabylonPhysicsFacility` over Physics V2 (`physics: { kit }`), and `BabylonTransformPort`'s held pose over a node's `physicsBody` (`physicsMotionTypes`) |
| **Eye gaze** | `BabylonInputProvider` reads the `xr-eye-tracking` feature when the app enabled it and applies the shared gaze-and-pinch rule |

## Usage

```ts
import { createBabylonInteractions } from "@realitycollective/babylon-interactions";

const xr = await scene.createDefaultXRExperienceAsync();
const interactions = createBabylonInteractions({ scene, xr, attachToScene: true });

interactions.register({ id: "button", behaviours: [{ kind: "press" }] }, buttonMesh);
interactions.runtime.onEvent((event) => console.log(event.type));
```

`attachToScene` drives the update loop from `scene.onBeforeRenderObservable` and the engine's frame delta. Leave it off and call `interactions.update(dtSeconds)` from your own loop.

For mesh-accurate targeting, hand the adapter your own pick:

```ts
interactions.setPickWithRay((origin, direction, maxDistance) => {
  const info = scene.pickWithRay(new Ray(Vector3.FromArray(origin), Vector3.FromArray(direction), maxDistance));
  return info?.hit && info.pickedPoint
    ? { mesh: info.pickedMesh, distance: info.distance, point: info.pickedPoint.asArray() as [number, number, number] }
    : null;
});
```

## Things to know

- **Forward is +Z.** Babylon is left-handed, so a controller ray points down +Z where three.js and raw WebXR point down -Z. A scene that sets `useRightHandedSystem` faces -Z instead; the adapter reads that flag at construction and flips. The adapter handles this; it matters if you compare rays with another adapter's.
- **Rotations need a quaternion.** A node whose `rotationQuaternion` is null is still driven by Euler angles. Set `node.rotationQuaternion = Quaternion.Identity()` before registering it, or pass `createQuaternion` to `register`, otherwise the first rotation write stores a plain object that Babylon cannot use.
- **Presence** shows and hides what Babylon built: motion controller root meshes and hand meshes. Babylon picks the visual per input source, so there is no hands/controllers switch - `setPresenceModality` always returns false.
- **Desktop grip.** The pointer fallback puts its grip one metre along the pointer ray, matching the three.js adapter, so grab, hinge, dial and slide follow the cursor on desktop. Set `desktopGripDistance` near the distance of the things being manipulated; at 0 the grip sits on the camera and a drag reports camera motion only.
- **Held pose.** A node with a Physics V2 `physicsBody`, registered with `physicsMotionTypes` (Babylon's own `PhysicsMotionType.ANIMATED`/`.DYNAMIC` - this package holds no Babylon values, only shapes), grows `beginHold`/`endHold`: while held it switches to `ANIMATED` and follows `setWorldPose` exactly, ignoring gravity and collisions; on release it goes back to `DYNAMIC` with the grabbing hand's velocity, so a throw carries through; a `setWorldPose` while not held teleports and clears velocity. A node with no `physicsBody`, or a construction with no `physicsMotionTypes`, gets neither member and behaves exactly as before. The physics half is written from the Babylon Physics V2 documentation. This repository installs neither `@babylonjs/core` nor `@babylonjs/havok`, so CI checks it against structural fakes only. With both installed, `test/physics-facility-havok.test.ts` runs the shared physics suite against real Havok; the maturity note above says where that stands. Confirm it in your own scene before relying on it.

## Peer dependency

None. Babylon is matched structurally, not imported, so any Babylon version whose objects carry these members works.

## Live demo

The interaction playground - the same station set on every platform; add `?engine=babylon` for this adapter: **[webxr-interactions.pages.dev](https://webxr-interactions.pages.dev)**

## Documentation

See the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme).

## License

MIT - see [LICENSE](./LICENSE).
