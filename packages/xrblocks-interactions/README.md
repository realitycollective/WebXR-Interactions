# @realitycollective/xrblocks-interactions

> **EXPERIMENTAL.** The XR Blocks pipeline is young and its API still moves. Treat this adapter as a preview and pin your versions.

The Google XR Blocks adapter for the Reality Collective Interaction Extensions. It feeds XR Blocks' input into the [`@realitycollective/webxr-interactions`](https://www.npmjs.com/package/@realitycollective/webxr-interactions) core, reusing the three.js adapter's hit-testing and object movement.

```sh
npm install @realitycollective/xrblocks-interactions three
```

It re-exports everything from the core, so this is the only interaction package your app needs.

## What it binds

| Layer | Detail |
| --- | --- |
| **Input** | `Input.getFrame()` ray sources and direct touches; XR Blocks `Script` select events |
| **Hit-testing** | Shared with the three.js adapter |
| **No xrblocks dependency** | It matches the shape of the XR Blocks API in TypeScript rather than importing `xrblocks`, so an upstream release cannot break your install |
| **Haptics** | XR Blocks has none, so haptic requests are reported but never played |

Structurally typed against xrblocks **v0.20.0**.

## Known constraint

xrblocks declares a peer of `three@^0.184` while Meta's IWSDK mandates the `super-three@0.181` fork. A bundler resolves a single `three` per bundle, so the pairing works in practice, but npm's peer check cannot express it - the Reality Collective workspaces set `legacy-peer-deps=true` for this reason.

## Peer dependency

`three >= 0.170.0`.

## Live demo

The interaction playground - the full station set, mouse-capable on desktop, VR button for headsets: **[webxr-interactions.pages.dev](https://webxr-interactions.pages.dev)**

## Documentation

See the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme).

## License

MIT - see [LICENSE](./LICENSE).
