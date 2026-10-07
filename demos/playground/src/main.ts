/**
 * Playground entry.
 *
 * One scene on IWSDK, three.js, XR Blocks and Babylon, with the same
 * registrations and the same client on each. This page asks the browser's
 * WebXR runtime what it can do (`platform-choice.ts`), pre-selects a platform
 * on a launch screen, and boots nothing until START is pressed. Each platform
 * is a dynamic import, so a session only downloads the engine it launches.
 *
 * `?log=1`, a hidden option for framework testers, records diagnostics from
 * the first line, before any platform loads, and sends them to the
 * playground's report service (`diagnostics.ts`); `?log=local` keeps them on
 * the device. Without it nothing is recorded.
 *
 * `?engine=iwsdk|threejs|xrblocks|babylon` pre-selects one. Adding
 * `&autostart=1` skips the launch screen and boots it at once.
 */
import { installDiagnostics } from "./diagnostics.js";
import { ENGINE_PARAM, chooseEngine, probeXRSupport, type Engine } from "./platform-choice.js";

const AUTOSTART_PARAM = "autostart";
const LOG_PARAM = "log";

const diagnostics = installDiagnostics({
  lab: "interactions-playground",
  param: LOG_PARAM,
  keepParams: [ENGINE_PARAM, AUTOSTART_PARAM, LOG_PARAM],
  // The engine badge and the score line hold the top of this page.
  corner: "bottom-right",
});

interface ModeInfo {
  title: string;
  blurb: string;
}

const MODES: Record<Engine, ModeInfo> = {
  iwsdk: {
    title: "Meta - IWSDK",
    blurb: "The reference. IWSDK's own pointers and grab, with panels (mouse works; VR on a Quest).",
  },
  threejs: {
    title: "three.js",
    blurb: "Raw WebXR and three.js with the standalone binding, mouse on desktop, panels included.",
  },
  xrblocks: {
    title: "Google - XR Blocks",
    blurb: "A Script inside XR Blocks (Android XR, or its desktop simulator), panels included.",
  },
  babylon: {
    title: "Babylon.js",
    blurb: "Babylon.js with the Babylon binding. No panels: UI Extensions has no Babylon binding yet.",
  },
};

const xrSupport = await probeXRSupport();
const choice = chooseEngine(navigator.userAgent, location.search, xrSupport);
diagnostics.note(`engine pre-selected: ${choice.engine}`, { reason: choice.reason, overridden: choice.overridden, xrSupport });
const container = document.getElementById("scene-container") as HTMLDivElement;

async function boot(engine: Engine): Promise<void> {
  const badge = document.getElementById("engine-badge");
  if (badge) {
    badge.textContent = `engine: ${engine} - ${MODES[engine].title}`;
    badge.style.display = "block";
  }
  diagnostics.note(`booting the ${engine} platform`);
  switch (engine) {
    case "iwsdk":
      return (await import("./platforms/iwsdk.js")).boot(container);
    case "xrblocks":
      return (await import("./platforms/xrblocks.js")).boot(container);
    case "babylon":
      return (await import("./platforms/babylon.js")).boot(container);
    default:
      return (await import("./platforms/threejs.js")).boot(container);
  }
}

function showLaunchScreen(): void {
  const overlay = document.createElement("div");
  overlay.id = "launch-overlay";
  overlay.setAttribute(
    "style",
    "position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;" +
      "align-items:center;justify-content:center;gap:18px;padding:24px;" +
      "background:#0b1016;color:#dce9f7;font-family:system-ui,sans-serif;text-align:center;",
  );

  let selected: Engine = choice.engine;
  const cardById = new Map<Engine, HTMLButtonElement>();

  const heading = document.createElement("h1");
  heading.textContent = "WebXR Interactions - Playground";
  heading.setAttribute("style", "margin:0;font-size:22px;");

  const detected = document.createElement("p");
  detected.textContent = `Detected: ${MODES[choice.engine].title} (${choice.reason})`;
  detected.setAttribute("style", "margin:0;max-width:640px;font-size:13px;color:#9fb8d4;");

  const cards = document.createElement("div");
  cards.setAttribute("style", "display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:820px;");

  const paint = () => {
    for (const [engine, card] of cardById) {
      card.style.borderColor = engine === selected ? "#7db8ff" : "#2e4a66";
      card.style.background = engine === selected ? "#16283c" : "#101a26";
    }
  };

  for (const engine of Object.keys(MODES) as Engine[]) {
    const mode = MODES[engine];
    const card = document.createElement("button");
    card.setAttribute(
      "style",
      "width:240px;padding:14px;border-radius:10px;border:2px solid #2e4a66;" +
        "background:#101a26;color:inherit;cursor:pointer;text-align:left;font:inherit;",
    );
    const title = document.createElement("b");
    title.textContent = mode.title;
    const blurb = document.createElement("span");
    blurb.textContent = mode.blurb;
    blurb.setAttribute("style", "font-size:12px;color:#9fb8d4");
    card.append(title, document.createElement("br"), blurb);
    card.addEventListener("click", () => {
      selected = engine;
      paint();
    });
    cardById.set(engine, card);
    cards.appendChild(card);
  }
  paint();

  const start = document.createElement("button");
  start.textContent = "START";
  start.setAttribute(
    "style",
    "padding:12px 48px;font-size:16px;font-weight:bold;border-radius:10px;" +
      "border:0;background:#2c6fb0;color:#fff;cursor:pointer;font-family:inherit;",
  );
  start.addEventListener("click", () => {
    start.disabled = true;
    start.textContent = "STARTING...";
    // Keep the URL shareable and reload-safe for the chosen platform.
    const url = new URL(location.href);
    url.searchParams.set(ENGINE_PARAM, selected);
    history.replaceState(null, "", url);
    boot(selected)
      .then(() => overlay.remove())
      .catch((error: unknown) => {
        console.error("[playground] platform failed to start:", error);
        start.disabled = false;
        start.textContent = "START";
        detected.textContent = `Failed to start ${MODES[selected].title} - see the console. Pick a platform and try again.`;
        detected.style.color = "#ff9d7a";
      });
  });

  overlay.append(heading, detected, cards, start);
  container.appendChild(overlay);
}

if (choice.overridden && new URLSearchParams(location.search).get(AUTOSTART_PARAM) === "1") {
  boot(choice.engine).catch((error: unknown) => {
    console.error("[playground] platform failed to start:", error);
    showLaunchScreen();
  });
} else {
  showLaunchScreen();
}
