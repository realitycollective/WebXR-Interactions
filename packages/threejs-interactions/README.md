# @realitycollective/threejs-interactions

The three.js adapter for the Reality Collective Interaction Extensions. It reads raw WebXR directly, so no other framework is needed.

```sh
npm install @realitycollective/threejs-interactions three
```

It re-exports everything from [`@realitycollective/webxr-interactions`](https://www.npmjs.com/package/@realitycollective/webxr-interactions), so this is the only interaction package your app needs.

## What it binds

| Layer | Detail |
| --- | --- |
| **Input** | Raw WebXR, the browser's own XR API: controllers, hand joints, trigger and grip pressure, and haptic pulses |
| **Hit-testing** | three.js raycasting against your scene graph |
| **Movement** | Moves and rotates three.js objects for grab, hinge, dial and slide |
| **Desktop** | A mouse fallback, so the same scene is testable without a headset |
| **Presence** | Show and hide the user's own hand and controller models, once you have registered them |

## Presence

`registerVisual(handedness, root)` is on this adapter and on no other, because a standalone three.js app builds its own hand and controller models. The IWSDK and Babylon adapters find models the engine already built; here there is nothing to show or hide until you hand one over. So `capabilities.presence` is false until the first `registerVisual` call and true afterwards, and it changes back if you give the last one back with `unregisterVisual`. Registering notifies `onCapabilitiesChanged` like any other capability change.

```ts
provider.registerVisual("left", leftHandModel);
provider.registerVisual("right", rightHandModel);
provider.setPresenceVisible("left", false); // hide the left hand
```

## Usage

```ts
import { createThreeInteractions } from "@realitycollective/threejs-interactions";

const interactions = createThreeInteractions({
  xr: renderer.xr,
  camera,
  domElement: renderer.domElement,
});

interactions.register({ id: "button", behaviours: [{ kind: "press" }] }, buttonMesh);

interactions.runtime.onEvent((event) => console.log(event.type));

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  interactions.update(dt);
  renderer.render(scene, camera);
});
```

## Peer dependency

`three >= 0.170.0`. The Reality Collective demos pin the `super-three@0.181` fork that Meta's IWSDK mandates; stock three.js works equally well for this adapter.

## Live demo

The interaction playground - the full station set, mouse-capable on desktop, VR button for headsets: **[webxr-interactions.pages.dev](https://webxr-interactions.pages.dev)**

## Documentation

See the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme) and the `demos/playground` client for a complete working scene.

## License

MIT - see [LICENSE](./LICENSE).
