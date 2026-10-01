# @realitycollective/xrblocks-interactions

> **EXPERIMENTAL.** The XR Blocks pipeline is young and its API still moves. Treat this adapter as experimental and pin your versions.

The Google XR Blocks adapter for the Reality Collective Interaction Extensions. It feeds XR Blocks' input into the [`@realitycollective/webxr-interactions`](https://www.npmjs.com/package/@realitycollective/webxr-interactions) core, reusing the three.js adapter's hit-testing and object movement.

```sh
npm install @realitycollective/xrblocks-interactions three
```

It re-exports everything from the core, so this is the only interaction package your app needs.

## What it binds

| Layer | Detail |
| --- | --- |
| **Input** | `Input.getFrame()` ray sources and direct touches; the real grip pose from `inputSource.gripSpace` when you pass `xr` (falls back to the ray pose otherwise); XR Blocks `Script` select events |
| **Hit-testing** | Shared with the three.js adapter (`ThreeHitTester`) |
| **Object movement** | `XRBlocksTransformPort` - the three.js port's behaviour, plus held/released/reset over a RAPIER rigid body when you register one |
| **No xrblocks dependency** | It matches the shape of the XR Blocks API in TypeScript rather than importing `xrblocks`, so an upstream release cannot break your install |
| **Haptics** | Through the controller's WebXR Gamepad `hapticActuators`, clamped 0..1 |
| **Native grab** | Opt in with the `nativeGrab` option, then forward `onObjectGrabStart`/`onObjectGrabEnd` from your `Script` when `ManipulationManager` owns a grab |
| **Session visibility** | Pass `xr` and sampling reports nothing while the session exists but is not visible, as IWSDK's provider does |
| **Pointer visuals** | The three.js `ThreePointerVisuals` draws the app's `pointerDisplay` inside the Script's scene: `connectXRBlocksInteractions({ pointerVisuals: { scene: this }, pointers, pointerDisplay })`. Turn XR Blocks' own reticle off so there is one cursor |
| **Physics** | `physics: { rapier }` gives the shared `RapierPhysicsFacility`; `XRBlocksTransformPort` holds and releases over a RAPIER rigid body |

Structurally typed against xrblocks **v0.21.1**.

## Setup

```ts
import * as xb from 'xrblocks';
import { connectXRBlocksInteractions } from '@realitycollective/xrblocks-interactions';

class MyScript extends xb.Script {
  init() {
    this.ix = connectXRBlocksInteractions({ input: xb.input, camera: xb.camera, xr: xb.core.renderer.xr });
  }
  update() { this.ix.update(xb.getDeltaTime()); }
}
```

Pass `xr`. Without it the adapter cannot see the session, so it keeps sampling while the session is hidden and gives every source the ray pose as its grip. IWSDK does neither. Leave it out only on a desktop page that never enters XR.

## Known constraint

xrblocks declares a peer of `three@^0.184` while Meta's IWSDK mandates the `super-three@0.181` fork. A bundler resolves a single `three` per bundle, so the pairing works in practice, but npm's peer check cannot express it - the Reality Collective workspaces set `legacy-peer-deps=true` for this reason.

## Peer dependency

`three >= 0.170.0`.

## Live demo

The interaction playground - the full station set on every platform, mouse-capable on desktop, VR button for headsets; add `?engine=xrblocks` for this adapter: **[webxr-interactions.pages.dev](https://webxr-interactions.pages.dev)**

## Documentation

See the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme).

## License

MIT - see [LICENSE](./LICENSE).
