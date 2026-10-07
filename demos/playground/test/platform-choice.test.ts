import { describe, expect, it } from "vitest";
import { chooseEngine, isEngine, probeXRSupport, type XRSupport } from "../src/platform-choice.js";

const QUEST_UA =
  "Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0 Chrome/126.0 Mobile VR Safari/537.36";
const ANDROID_XR_UA = "Mozilla/5.0 (Linux; Android 14; AndroidXR) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36";
// An Android XR device whose browser does not name itself: the case the XREAL Aura raised.
const UNNAMED_XR_UA = "Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36";

const NONE: XRSupport = { immersiveVr: false, immersiveAr: false };
const BOTH: XRSupport = { immersiveVr: true, immersiveAr: true };
const VR_ONLY: XRSupport = { immersiveVr: true, immersiveAr: false };

describe("chooseEngine", () => {
  it("picks IWSDK on a Meta Horizon OS browser with immersive WebXR", () => {
    expect(chooseEngine(QUEST_UA, "", BOTH).engine).toBe("iwsdk");
  });

  it("picks XR Blocks wherever immersive-ar is supported outside Meta, named or not", () => {
    expect(chooseEngine(ANDROID_XR_UA, "", BOTH).engine).toBe("xrblocks");
    expect(chooseEngine(UNNAMED_XR_UA, "", BOTH).engine).toBe("xrblocks");
  });

  it("picks three.js, with its Enter VR button, for a VR-only browser outside Meta", () => {
    expect(chooseEngine(DESKTOP_UA, "", VR_ONLY).engine).toBe("threejs");
  });

  it("never lets a user agent claim XR the runtime does not have", () => {
    expect(chooseEngine(ANDROID_XR_UA, "", NONE).engine).toBe("threejs");
    expect(chooseEngine(QUEST_UA, "", null).engine).toBe("threejs");
    expect(chooseEngine(QUEST_UA, "", null).reason).toContain("navigator.xr");
  });

  it("honours ?engine= above any runtime answer, and ignores unknown names", () => {
    expect(chooseEngine(QUEST_UA, "?engine=babylon", BOTH)).toMatchObject({ engine: "babylon", overridden: true });
    expect(chooseEngine(DESKTOP_UA, "?engine=unreal", NONE)).toMatchObject({ engine: "threejs", overridden: false });
  });

  it("accepts exactly the four platforms", () => {
    expect(["iwsdk", "threejs", "xrblocks", "babylon"].every((name) => isEngine(name))).toBe(true);
    expect(isEngine("desktop")).toBe(false);
    expect(isEngine(null)).toBe(false);
  });
});

describe("probeXRSupport", () => {
  it("answers null without navigator.xr, and counts a throw or a silence as unsupported", async () => {
    expect(await probeXRSupport(undefined)).toBeNull();
    const xr = {
      isSessionSupported: (mode: string) =>
        mode === "immersive-ar" ? Promise.resolve(true) : mode === "immersive-vr" ? new Promise<boolean>(() => {}) : Promise.reject(new Error("x")),
    };
    expect(await probeXRSupport(xr, 20)).toEqual({ immersiveVr: false, immersiveAr: true });
  });
});
