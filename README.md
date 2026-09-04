# WebXR Interactions

WebXR Interactions adds interactive objects to a WebXR scene: buttons, levers, dials, grabbable items. The interaction logic has no 3D engine code in it. You add one adapter for the engine you already use, and that adapter feeds the shared logic.

Two words appear throughout:

- **Interactable** - an object in your scene that can be interacted with, such as a button.
- **Interactor** - the thing doing the interacting: a hand, a controller, a pointing ray or a mouse.

The WebXR solution is based wholly of our original Unity implementation for an Interaction Framework, currently being revised.

## Packages

Install exactly one adapter. Each one re-exports the core, so you never install the core yourself.

| Package | What it is |
| --- | --- |
| [`@realitycollective/webxr-input`](https://github.com/realitycollective/WebXR-Input) | Shared TypeScript types describing input devices. Published from its own repository. Everything below depends on it. |
| `@realitycollective/webxr-interactions` | The core. All the interaction logic, with no 3D engine code. |
| `@realitycollective/threejs-interactions` | Adapter for plain three.js and raw WebXR. No other framework needed. |
| `@realitycollective/babylon-interactions` | Adapter for Babylon.js. Not yet run against a real Babylon app. |
| `@realitycollective/iwsdk-interactions` | Adapter for Meta's Immersive Web SDK. |
| `@realitycollective/xrblocks-interactions` | Adapter for Google's XR Blocks. Experimental, and the API may change. |

### What the core gives you

- **Behaviours** - ready-made interaction types you attach to an object: press (with an optional latching mode that stays down until pressed again), pulse, hinge, dial, slide, grab, and toss-scoring for throw-and-catch games.
- **Gaze** - optional look-to-activate. Either require the user to be looking at an object before it responds, or let a sustained look trigger the press on its own.
- **Targeting** - for each hand or controller the core picks one target, trying the platform's own answer first, then a close-range touch, then a pointing ray. A short delay stops the target flickering between two objects on the boundary.
- **Capability checks** - if the current headset cannot do what a behaviour needs, the behaviour switches itself off and says so, rather than silently doing nothing.
- **Velocity** - how fast each hand or controller is moving, measured from the poses the core already samples, so a throw or a flick has a speed to work with. A source on its first frame, or one that has just reappeared, reports nothing rather than a jump from wherever it was last seen. A platform that reports its own velocity keeps it.
- **Events only** - the core never calls into your code. It emits events and you subscribe.
- **Feedback as a request** - the core asks for a haptic pulse or a sound. Playing it is your app's job. `routeHapticsToProvider` is an opt-in helper that sends those requests straight to the controller, and `routeAudioToSink` hands the cues you name to whatever plays sound in your app.

### What each adapter adds

- **three.js** - reads raw WebXR directly: controllers, hand joints, trigger and grip pressure, and haptic pulses. Where the browser reports velocity with a pose, that velocity is passed through as the platform gave it; where it does not, the core derives one from the poses. Adds three.js hit-testing and object movement, plus a desktop mouse fallback so you can test without a headset. The mouse source reports `handedness: "none"` and puts its grip on the camera ray, so its velocity is camera motion rather than hand motion - gate hand mechanics such as throwing on `handedness !== "none"`. Your app builds its own hand and controller models here, so presence is opt-in: register a model per hand with `registerVisual` and the adapter can then show and hide it.
- **Babylon.js** - matches the shape of the Babylon API in TypeScript without depending on `@babylonjs/core`, the same way the XR Blocks adapter does, so an upstream release cannot break the install. It reads a `WebXRDefaultExperience`: controllers, motion controller trigger and grip, and hand-tracking joints, with the scene's own pointer as a desktop fallback. Haptics go through the motion controller's pulse. Presence shows and hides the visuals Babylon built - motion controller root meshes and hand meshes - but Babylon picks which of those to show per input source, so there is no hands-or-controllers switch. Hit-testing is a sphere test over the registered nodes; hand the adapter your own `scene.pickWithRay` for mesh-accurate targeting. Written against the documented API and covered by structural fakes: it has not yet been exercised against a real Babylon runtime.
- **Meta IWSDK** - uses IWSDK's own player rig and controller state. IWSDK already knows what is being pressed or grabbed, so the adapter passes that answer straight through instead of working it out again. Where the app has IWSDK grabbing or physics turned on, IWSDK performs the grab. IWSDK builds the hand and controller models, so presence is full: hide or show either hand, and force hands or controllers when the automatic choice is wrong. Setup is one call: `registerInteractions(world)`.
- **XR Blocks** - matches the shape of the XR Blocks API in TypeScript without depending on the `xrblocks` package, so an upstream release cannot break the install. XR Blocks reuses the same input objects every frame, so the adapter copies the values out immediately. XR Blocks has no haptics, so haptic requests go unfulfilled, and it exposes no way to hide its own hand and controller visuals, so there is no presence control either.

## Demo

`demos/playground` - the independent interaction playground (standalone three.js/WebXR, desktop mouse mode included): the full station set from one portable `InteractionDescriptor` (button, gaze-dwell button with progress ring, three lever mounts, dial, pulley, grab-ball + scoring hoop), with client-side audio cues, opt-in controller haptics and client-side toss ballistics (physics is a property of the object, not the interaction layer).

```bash
cd WebXR-Interactions
npm ci
npm run dev:playground     # http://localhost:8082 - mouse works, VR button for headsets
```

### Live

Deployed from `main` by the **Deploy** workflow; pull requests deploy to the isolated `-test` project instead, so a PR can never touch production.

| | URL |
| --- | --- |
| **Production** | [`webxr-interactions.pages.dev`](https://webxr-interactions.pages.dev) |
| **Staging (per PR)** | `webxr-interactions-test.pages.dev` |

Open it on a headset - each production deploy prints the URL and a QR code to the workflow's step summary.

## Automation (`.github/workflows/`)

Two workflows ship in every Reality Collective TypeScript repository, with the same names everywhere. `ci.yml` both gates and deploys: the build job runs once and the deploy jobs consume its artifacts, so nothing is built or tested twice.

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | every PR + push to `main` / `development` | Build, typecheck, test with coverage gates, `verify:pack`, playground build. On a PR it then deploys to `webxr-interactions-test`; on a push to `main`, to production. The deploy steps skip when the Cloudflare secrets are absent, leaving a pure build gate |
| `publish-npm.yml` | manual dispatch | packs all five packages and publishes to **npmjs.com** with provenance - `preview` dist-tag from `development`, `latest` from `main`. **Defaults to a dry run** |

## Commands

| Command | What |
| --- | --- |
| `npm ci` | set up the workspace |
| `npm test` | vitest - engine-free architecture gates + behaviour/runtime/adapter suites, with coverage gates |
| `npm run typecheck` | strict typecheck, all packages + the playground |
| `npm run build` | `tsc` → `dist/` per package |
| `npm run verify:pack` | pack, install into a clean project and import - the consumer path |
| `npm run build:demos` | static Vite build of the playground |
| `npm run dev:playground` | run the playground demo |

## Repository layout

The repository root **is** the npm workspace root - `packages/*` are the publishable libraries, `demos/*` the clients. This matches [WebXR-Input](https://github.com/realitycollective/WebXR-Input), [WebXR-UIExtensions](https://github.com/realitycollective/WebXR-UIExtensions) and the [service-framework](https://github.com/realitycollective/com.realitycollective.service-framework.ts).

## Releasing

Work branches off `main`; PRs target `main`. Releases are cut by dispatching the **Publish to npm** workflow, which defaults to a dry run:

| Dispatched from | dist-tag | Then |
| --- | --- | --- |
| `development` | `preview` | bumps the preview counter and pushes it back |
| `main` | `latest` | tags, cuts the GitHub release, re-seeds `development` at the next patch preview |

### Publish order

Every package here depends on `@realitycollective/webxr-input`. That package must be published from the [WebXR-Input](https://github.com/realitycollective/WebXR-Input) repository **first** - until it is on npmjs.com, `npm ci` cannot resolve it and CI will fail at install. Once it is published, run `npm install` once to regenerate `package-lock.json` against the registry version and commit the result.

To develop against an unreleased `webxr-input`, use `npm link` rather than editing `package.json` - a `file:` link committed to this repository breaks CI, which has no sibling checkout.

## Layering rule

```
app → ONE adapter (threejs | babylon | iwsdk | xrblocks) → core (webxr-interactions) → contracts (@realitycollective/webxr-input, separate repo)
```

Arrows only point down; the core's architecture test fails the moment an engine import lands in it. Physics deliberately stays with the client/app - adapters surface it only as the `grabs: "native"` capability.

## What this stack is and is not

The Reality Collective WebXR packages aim at one outcome: an app's logic, input handling, interactions and UI should not care which engine hosts them. Each family ships an engine-free core and thin adapters for Meta IWSDK, plain three.js and WebXR, Babylon.js and Google XR Blocks. When an app still has to reach into the host, either a contract is missing, which is a bug to report, or the app is overreaching.

Portable world-building is not a current promise. Scene content (meshes, prefabs, placement) is built by the app, ideally behind a factory interface the app owns, so that a second host can implement the same factories. A shared content descriptor, following the shape of the UI family's `SceneDescriptor`, will be considered only when a second host is actually targeted. Meta's `iwsdk.scene.v1` format is an acceptable authoring interchange in the meantime.

Position recorded on 2026-09-03 from the Pale Signal client's gaps report.
