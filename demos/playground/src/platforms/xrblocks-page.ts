/**
 * Makes the XR Blocks 2D page usable on a browser that can enter XR.
 *
 * Kept byte-identical in WebXR-UIExtensions (demos/webxr-multiplatform) and
 * WebXR-Interactions (demos/playground).
 *
 * On a browser with no immersive WebXR, XR Blocks starts its desktop
 * simulator, which places its own camera and needs no Enter XR button. On one
 * that has it (Android XR, the XREAL Aura), XR Blocks skips the simulator and
 * draws the page from its own camera with an Enter XR button. Two things then
 * go wrong unless the page helps:
 *
 * - XR Blocks ships no stylesheet (its samples load one), so its button is an
 *   unstyled 21 px element in normal flow, below the full-height canvas and off
 *   screen.
 * - XR Blocks' camera starts at the origin, at floor level, so the page frames
 *   little of a scene laid out for standing height and looks empty.
 *
 * Inside a session three.js drives the camera from the headset pose, so the
 * height set here only affects the 2D page.
 */

/**
 * Eye height of the 2D view before a session, in metres above the floor. The
 * same height IWSDK, the reference, gives its own camera (`setupRendering` in
 * `@iwsdk/core`'s world initializer).
 */
export const XRBLOCKS_PAGE_EYE_HEIGHT = 1.7;

/** Ids XR Blocks gives its Enter XR button (`XRButton` in xrblocks). */
const BUTTON_WRAPPER_ID = 'XRButtonWrapper';
const BUTTON_CLASS = 'XRButton';
const STYLE_ID = 'xrblocks-page-style';

const STYLE = `
#${BUTTON_WRAPPER_ID} {
  position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: 45;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
#${BUTTON_WRAPPER_ID} .${BUTTON_CLASS} {
  min-width: 220px; padding: 16px 40px; border: 0; border-radius: 999px;
  background: #2c6fb0; color: #fff; font: 600 20px system-ui, sans-serif; cursor: pointer;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
}
#${BUTTON_WRAPPER_ID} .${BUTTON_CLASS}:disabled { background: #2e4a66; color: #9fb8d4; cursor: default; }
`;

/** The slice of XR Blocks' `core` this reads. */
export interface XRBlocksPageCore {
  simulatorRunning: boolean;
  renderer: { domElement: HTMLCanvasElement; xr: { isPresenting: boolean } };
  camera: { position: { set(x: number, y: number, z: number): unknown } };
}

/**
 * Call once, after `xb.init()` resolves. Moves XR Blocks' root and its Enter XR
 * button into `container`, where every other pipeline draws, pins the button
 * on screen and raises the 2D camera to standing height when the simulator is
 * not running.
 */
export function fitXRBlocksPage(container: HTMLElement, core: XRBlocksPageCore, doc: Document = document): void {
  // XR Blocks appends its own root to <body>. Move it into the mount point.
  const canvas = core.renderer.domElement;
  const root = canvas.parentElement && canvas.parentElement !== doc.body ? canvas.parentElement : canvas;
  container.appendChild(root);
  // An inline canvas leaves a few pixels of scroll under it.
  canvas.style.display = 'block';

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    doc.head.appendChild(style);
  }
  const button = doc.getElementById(BUTTON_WRAPPER_ID);
  if (button) container.appendChild(button);

  if (!core.simulatorRunning && !core.renderer.xr.isPresenting) {
    core.camera.position.set(0, XRBLOCKS_PAGE_EYE_HEIGHT, 0);
  }
}
