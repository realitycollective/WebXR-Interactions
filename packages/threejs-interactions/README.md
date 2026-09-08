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
| **Hit-testing** | three.js raycasting against your scene graph, through three-mesh-bvh when your app installs it |
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

## Hit-testing detailed meshes

three.js tests every triangle of a mesh once a ray enters its bounding sphere, so a detailed model registered as an interactable costs the raycast close to a millisecond per ray on a desktop, and the runtime casts up to three rays a frame (one per controller, one for gaze). Two ways round it, and they combine.

**Install three-mesh-bvh.** The adapter declares it as an optional peer. Install it and add its prototype hooks once at startup; the hit tester then builds a bounds tree for every geometry it registers and asks the raycaster for the first hit only, so the same ray costs microseconds. IWSDK installs these hooks itself, so an IWSDK app has nothing to do.

```ts
import { BufferGeometry, Mesh } from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;
```

The tree lives on the geometry for as long as the geometry does. The adapter never removes it, so a geometry shared between interactables is built once, and a geometry you discard takes its tree with it.

**Register a collider proxy.** Register a low-poly stand-in (a box, a sphere, a simplified hull) as the interactable object, and parent the detailed model to it or move both from the same transform. The proxy is what the ray and the poke test see; the model is what the player sees.

Poke targeting (`hitProximity`) is a sphere test on each registered object's world position and bounding-sphere radius, so it costs the same whatever the mesh.

## Peer dependencies

`three >= 0.170.0`. The Reality Collective demos pin the `super-three@0.181` fork that Meta's IWSDK mandates; stock three.js works equally well for this adapter.

`three-mesh-bvh >= 0.9.14`, optional. See the section above.

## Live demo

The interaction playground - the full station set, mouse-capable on desktop, VR button for headsets: **[webxr-interactions.pages.dev](https://webxr-interactions.pages.dev)**

## Documentation

See the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme) and the `demos/playground` client for a complete working scene.

## License

MIT - see [LICENSE](./LICENSE).
