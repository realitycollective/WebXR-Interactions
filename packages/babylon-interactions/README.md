# @realitycollective/babylon-interactions

The Babylon.js adapter for the Reality Collective Interaction Extensions. It feeds a Babylon WebXR experience into the [`@realitycollective/webxr-interactions`](https://www.npmjs.com/package/@realitycollective/webxr-interactions) core.

```sh
npm install @realitycollective/babylon-interactions
```

It re-exports everything from the core, so this is the only interaction package your app needs.

> **Not yet exercised against a real Babylon runtime.** The adapter is written against the documented Babylon 7 API and covered by structural fakes. Treat it as a preview until it has run in a Babylon app.

## What it binds

| Layer | Detail |
| --- | --- |
| **Input** | `WebXRDefaultExperience`: controllers, motion controller components (trigger, squeeze), hand-tracking joints, and the session manager for what is live |
| **Hit-testing** | A sphere test over registered nodes, or your own `scene.pickWithRay` through the `pickWithRay` hook |
| **Movement** | Moves, rotates and scales Babylon nodes for grab, hinge, dial and slide |
| **Desktop** | `scene.onPointerObservable` as a pointer fallback, so the same scene is testable without a headset |
| **Haptics** | Through the motion controller's `pulse` |
| **No @babylonjs/core dependency** | It matches the shape of the Babylon API in TypeScript rather than importing Babylon, so an upstream release cannot break your install |

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

## Peer dependency

None. Babylon is matched structurally, not imported, so any Babylon version whose objects carry these members works.

## Live demo

The interaction playground - the three.js build of the same station set: **[webxr-interactions.pages.dev](https://webxr-interactions.pages.dev)**

## Documentation

See the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme).

## License

MIT - see [LICENSE](./LICENSE).
