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
