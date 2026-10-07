/**
 * Which platform the launch screen pre-selects.
 *
 * The browser's own WebXR runtime is asked first which immersive modes it can
 * start: the question the Service Framework's `SessionFacet.isSupported` and
 * XR Blocks' session manager ask (`navigator.xr.isSessionSupported`). The user
 * agent is read for one thing only: telling a Meta browser from any other,
 * which no runtime question can do, since a Quest supports both modes. These
 * are the rules of the UI Extensions lab (`demos/showcase/src/platform-detect.ts`
 * there), with this playground's platform names:
 *
 *  - `?engine=` names a platform               → that platform
 *  - no immersive WebXR at all                 → three.js, with the mouse
 *  - a Meta Horizon OS browser                 → IWSDK
 *  - immersive-ar (Android XR, the XREAL Aura) → XR Blocks
 *  - immersive-vr only, not Meta               → three.js, which has its own
 *    Enter VR button
 */
export type Engine = 'iwsdk' | 'threejs' | 'xrblocks' | 'babylon';

export const ENGINES: readonly Engine[] = ['iwsdk', 'threejs', 'xrblocks', 'babylon'];

export const ENGINE_PARAM = 'engine';

/** What the WebXR runtime answered; `null` when the page has no `navigator.xr` (no https, or no WebXR). */
export interface XRSupport {
  immersiveVr: boolean;
  immersiveAr: boolean;
}

export interface EngineChoice {
  engine: Engine;
  reason: string;
  overridden: boolean;
}

/** How long the probe waits for one answer before taking it as "no". */
export const XR_PROBE_TIMEOUT_MS = 2000;

const META_BROWSER = /OculusBrowser|Meta Quest|Horizon OS/i;
const ANDROID_XR = /Android\s?XR/i;

export function isEngine(value: string | null): value is Engine {
  return value !== null && (ENGINES as readonly string[]).includes(value);
}

/** Ask the runtime which immersive modes it can start. Never rejects; a throw or a timeout counts as "no". */
export async function probeXRSupport(
  xr: { isSessionSupported(mode: string): Promise<boolean> } | undefined = (globalThis.navigator as { xr?: { isSessionSupported(mode: string): Promise<boolean> } } | undefined)?.xr,
  timeoutMs: number = XR_PROBE_TIMEOUT_MS,
): Promise<XRSupport | null> {
  if (!xr) return null;
  const ask = (mode: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      xr.isSessionSupported(mode).then(
        (supported) => {
          clearTimeout(timer);
          resolve(supported === true);
        },
        () => {
          clearTimeout(timer);
          resolve(false);
        },
      );
    });
  const [immersiveVr, immersiveAr] = await Promise.all([ask('immersive-vr'), ask('immersive-ar')]);
  return { immersiveVr, immersiveAr };
}

/** Pure chooser: pass `navigator.userAgent`, `location.search` and what {@link probeXRSupport} answered. */
export function chooseEngine(userAgent: string, search: string, xr: XRSupport | null): EngineChoice {
  const override = new URLSearchParams(search).get(ENGINE_PARAM);
  if (isEngine(override)) return { engine: override, reason: `forced by ?${ENGINE_PARAM}=${override}`, overridden: true };

  if (!xr) {
    return { engine: 'threejs', reason: 'this page has no WebXR (navigator.xr is missing - is it served over https?), so three.js with the mouse', overridden: false };
  }
  if (!xr.immersiveVr && !xr.immersiveAr) {
    return { engine: 'threejs', reason: 'WebXR reports no immersive session mode here, so three.js with the mouse', overridden: false };
  }
  const modes = [xr.immersiveVr ? 'immersive-vr' : '', xr.immersiveAr ? 'immersive-ar' : ''].filter(Boolean).join(' and ');
  if (META_BROWSER.test(userAgent)) {
    return { engine: 'iwsdk', reason: `WebXR supports ${modes} in a Meta Horizon OS browser`, overridden: false };
  }
  if (xr.immersiveAr) {
    const where = ANDROID_XR.test(userAgent) ? 'an Android XR browser' : 'an AR-capable browser (Android XR, XREAL Aura, AR phone)';
    return { engine: 'xrblocks', reason: `WebXR supports ${modes} in ${where}`, overridden: false };
  }
  return { engine: 'threejs', reason: `WebXR supports ${modes} only, outside a Meta browser, so three.js with its Enter VR button`, overridden: false };
}
