/**
 * Diagnostics for framework testers, switched on by a hidden URL option.
 *
 * Kept byte-identical in WebXR-UIExtensions (demos/showcase/src) and
 * WebXR-Interactions (demos/playground/src). The service that receives a sent
 * report is `functions/api/report.ts` beside each lab, also byte-identical.
 *
 * Without the option (`?<param>=` absent, `0` or `off`) nothing is installed:
 * no recording, no storage, no button. With it:
 *
 * - Records console output, uncaught errors, failed resource loads, WebGL
 *   context loss and every WebXR session (mode, blend mode, granted features,
 *   the first frame, frame and pose counts) into a bounded log.
 * - Keeps the logs of the last {@link LIMITS.reportsKept} page loads on the
 *   device (localStorage), so a reload or a crash does not lose them.
 * - Shows a Diagnostics button. Its panel downloads, copies or sends the log.
 * - `?<param>=local` keeps the log on the device; Send is a button press. Any
 *   other value also sends it, unasked: {@link LIMITS.firstSendMs} after the
 *   page opens, when each XR session ends and when the page is left, whenever
 *   something new was recorded. Each send carries the whole log so far, so a
 *   tester who did nothing but open the link still shows whether it worked.
 *   A send that fails offline is retried when the browser is back online, or
 *   on the next visit with the option.
 *
 * The log keeps no query value except the parameters it is told to keep, and
 * redacts token-like values from every message, so an edit token never lands
 * in it.
 */

export type DiagnosticsKind = 'console' | 'error' | 'rejection' | 'resource' | 'webgl' | 'xr' | 'note';
export type DiagnosticsLevel = 'log' | 'info' | 'warn' | 'error';

export interface DiagnosticsEvent {
  /** Milliseconds since the page started. */
  t: number;
  k: DiagnosticsKind;
  l: DiagnosticsLevel;
  m: string;
  /** How many times in a row this event repeated, when more than once. */
  n?: number;
  d?: Record<string, unknown>;
}

export interface DiagnosticsReport {
  /** One id per page load. */
  id: string;
  lab: string;
  /** ISO time the page started. */
  startedAt: string;
  env: Record<string, unknown>;
  events: DiagnosticsEvent[];
  /** Messages seen more than {@link LIMITS.repeatLimit} times, with their total count. */
  repeated: Record<string, number>;
  /** Events dropped to stay within {@link LIMITS.eventsPerReport}. */
  dropped: number;
}

export const LIMITS = {
  /** Events one page load keeps; the first {@link LIMITS.keepFirst} are never dropped. */
  eventsPerReport: 400,
  keepFirst: 60,
  messageChars: 1000,
  /** Times one message is recorded before it is only counted. */
  repeatLimit: 5,
  /** Page loads kept on the device, this one included. */
  reportsKept: 3,
  /** Largest body a send posts, in bytes (the service accepts 64 KiB). */
  sendBytes: 60 * 1024,
  /** How often an XR session's frame and pose counts are recorded, in ms. */
  frameStatsMs: 10_000,
  /** When the first automatic send goes, after the page opens, in ms. */
  firstSendMs: 20_000,
} as const;

const SENSITIVE_PARAM = /([?&](?:[\w-]*(?:token|secret|key|edit|auth|password)[\w-]*)=)[^&#\s"']+/gi;

/** Replaces the value of every token-like query parameter in `text`. */
export function redact(text: string): string {
  return text.replace(SENSITIVE_PARAM, '$1<redacted>');
}

/** `origin + pathname`, plus only the query parameters named in `keep`. */
export function pageUrl(location: { origin: string; pathname: string; search: string }, keep: readonly string[]): string {
  const params = new URLSearchParams(location.search);
  const kept = new URLSearchParams();
  for (const name of keep) {
    const value = params.get(name);
    if (value !== null) kept.set(name, value);
  }
  const query = kept.toString();
  return `${location.origin}${location.pathname}${query ? `?${query}` : ''}`;
}

/** A readable one-line description of anything a page might log or throw. */
export function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error || (typeof value === 'object' && value !== null && 'name' in value && 'message' in value)) {
    const error = value as { name: unknown; message: unknown; stack?: unknown };
    const stack = typeof error.stack === 'string' ? error.stack.split('\n').filter((line) => line.trim().startsWith('at ')).slice(0, 5).join('\n') : '';
    return `${String(error.name)}: ${String(error.message)}${stack ? `\n${stack}` : ''}`;
  }
  if (value === undefined) return 'undefined';
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json.length > 300 ? `${json.slice(0, 300)}...` : json;
  } catch {
    return String(value);
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}... (${text.length - max} more chars)` : text;
}

/** The bounded log of one page load. */
export class DiagnosticsLog {
  readonly report: DiagnosticsReport;
  private readonly seen = new Map<string, number>();
  private readonly listeners = new Set<(event: DiagnosticsEvent) => void>();

  constructor(lab: string, id: string, startedAt: string, private readonly now: () => number) {
    this.report = { id, lab, startedAt, env: {}, events: [], repeated: {}, dropped: 0 };
  }

  add(kind: DiagnosticsKind, level: DiagnosticsLevel, message: string, data?: Record<string, unknown>): void {
    const text = clip(redact(message), LIMITS.messageChars);
    const { events } = this.report;
    const last = events[events.length - 1];
    if (!data && last && !last.d && last.k === kind && last.l === level && last.m === text) {
      last.n = (last.n ?? 1) + 1;
      return;
    }
    const key = `${kind}|${level}|${text}`;
    const count = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, count);
    if (count > LIMITS.repeatLimit) {
      this.report.repeated[text] = count;
      return;
    }
    if (events.length >= LIMITS.eventsPerReport) {
      events.splice(LIMITS.keepFirst, 1);
      this.report.dropped += 1;
    }
    const event: DiagnosticsEvent = { t: Math.round(this.now()), k: kind, l: level, m: text };
    if (data) event.d = data;
    events.push(event);
    for (const listener of this.listeners) listener(event);
  }

  /** Errors and warnings recorded so far, repeats included. */
  counts(): { errors: number; warnings: number } {
    let errors = 0;
    let warnings = 0;
    for (const event of this.report.events) {
      if (event.l === 'error') errors += event.n ?? 1;
      else if (event.l === 'warn') warnings += event.n ?? 1;
    }
    return { errors, warnings };
  }

  onEvent(listener: (event: DiagnosticsEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** The report as text a person can read: the environment, then one line per event. */
export function formatText(reports: readonly DiagnosticsReport[]): string {
  const lines: string[] = [];
  for (const report of reports) {
    lines.push(`=== ${report.lab} - page load ${report.id} - started ${report.startedAt}`);
    for (const [key, value] of Object.entries(report.env)) lines.push(`${key}: ${describe(value)}`);
    lines.push('');
    for (const event of report.events) {
      const repeat = event.n ? ` (x${event.n})` : '';
      const data = event.d ? ` ${describe(event.d)}` : '';
      lines.push(`+${(event.t / 1000).toFixed(3)}s [${event.k}/${event.l}] ${event.m}${repeat}${data}`);
    }
    for (const [message, count] of Object.entries(report.repeated)) lines.push(`(seen ${count} times, recorded ${LIMITS.repeatLimit}) ${message}`);
    if (report.dropped) lines.push(`(${report.dropped} events dropped to stay within ${LIMITS.eventsPerReport})`);
    lines.push('');
  }
  return lines.join('\n');
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The JSON body of a send: the reports newest first, cut to `maxBytes`. Older
 * page loads go first, then events from the middle of the newest, keeping its
 * first {@link LIMITS.keepFirst} events and its most recent ones.
 */
export function fitPayload(sendId: string, reports: readonly DiagnosticsReport[], extra: Record<string, unknown>, maxBytes: number = LIMITS.sendBytes): string {
  const ordered = [...reports].reverse().map((report) => ({ ...report, events: [...report.events] }));
  const body = () => JSON.stringify({ format: 1, id: sendId, lab: ordered[0]?.lab ?? 'unknown', ...extra, reports: ordered });
  let text = body();
  while (byteLength(text) > maxBytes) {
    const newest = ordered[0];
    if (ordered.length > 1) ordered.pop();
    else if (newest && newest.events.length > LIMITS.keepFirst + 10) {
      const cut = Math.max(10, Math.floor((newest.events.length - LIMITS.keepFirst) / 4));
      newest.events.splice(LIMITS.keepFirst, cut);
      newest.dropped += cut;
    } else if (newest && newest.events.length > 0) {
      const keep = Math.floor(newest.events.length / 2);
      newest.dropped += newest.events.length - keep;
      newest.events = keep > 0 ? newest.events.slice(-keep) : [];
    } else if (newest && Object.keys(newest.repeated).length > 0) {
      newest.repeated = {};
    } else {
      break;
    }
    text = body();
  }
  return text;
}

/** What is kept in localStorage for one lab. */
export interface StoredDiagnostics {
  v: 1;
  reports: DiagnosticsReport[];
  /** A send failed offline and should be retried once. */
  pending: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadStored(storage: StorageLike | null, key: string): StoredDiagnostics {
  try {
    const parsed = JSON.parse(storage?.getItem(key) ?? 'null') as StoredDiagnostics | null;
    if (parsed && parsed.v === 1 && Array.isArray(parsed.reports)) return parsed;
  } catch {
    // A corrupt entry is replaced on the next save.
  }
  return { v: 1, reports: [], pending: false };
}

/** Saves, dropping the oldest page loads while the browser refuses the size. */
export function saveStored(storage: StorageLike | null, key: string, stored: StoredDiagnostics): boolean {
  if (!storage) return false;
  const copy: StoredDiagnostics = { ...stored, reports: stored.reports.slice(-LIMITS.reportsKept) };
  for (;;) {
    try {
      storage.setItem(key, JSON.stringify(copy));
      return true;
    } catch {
      if (copy.reports.length <= 1) return false;
      copy.reports.shift();
    }
  }
}

interface ConsoleLike {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** One console call as text: `%c` markers and the style strings they consume are dropped. */
export function formatConsoleArgs(args: readonly unknown[]): string {
  const [first, ...rest] = args;
  if (typeof first === 'string' && first.includes('%c')) {
    const styles = first.split('%c').length - 1;
    return [first.replace(/%c/g, ''), ...rest.slice(styles).map(describe)].join(' ').trim();
  }
  return args.map(describe).join(' ');
}

/** Records every console call into `log`, then lets the original run. Returns an undo. */
export function wrapConsole(target: ConsoleLike, log: DiagnosticsLog): () => void {
  const levels: DiagnosticsLevel[] = ['log', 'info', 'warn', 'error'];
  const originals = levels.map((level) => [level, target[level]] as const);
  for (const [level, original] of originals) {
    target[level] = (...args: unknown[]) => {
      try {
        log.add('console', level, formatConsoleArgs(args));
      } catch {
        // Recording must never break the page's own logging.
      }
      original.apply(target, args);
    };
  }
  return () => {
    for (const [level, original] of originals) target[level] = original;
  };
}

/** The slices of the WebXR API the session watch reads. */
export interface XRSessionLike extends EventTarget {
  readonly environmentBlendMode?: string;
  readonly interactionMode?: string;
  readonly enabledFeatures?: readonly string[];
  readonly visibilityState?: string;
  readonly frameRate?: number;
  readonly renderState?: { baseLayer?: { framebufferWidth: number; framebufferHeight: number } | null; layers?: readonly unknown[] };
  requestAnimationFrame(callback: (time: number, frame: XRFrameLike) => void): number;
  requestReferenceSpace(type: string): Promise<unknown>;
}

export interface XRFrameLike {
  getViewerPose(space: unknown): { views: readonly unknown[] } | null | undefined;
}

export interface XRSystemLike {
  requestSession?: (mode: string, init?: unknown) => Promise<XRSessionLike>;
  offerSession?: (mode: string, init?: unknown) => Promise<XRSessionLike>;
  isSessionSupported?: (mode: string) => Promise<boolean>;
}

function summariseInit(init: unknown): Record<string, unknown> {
  if (!init || typeof init !== 'object') return {};
  const value = init as { requiredFeatures?: unknown; optionalFeatures?: unknown; depthSensing?: unknown; domOverlay?: unknown };
  return {
    requiredFeatures: Array.isArray(value.requiredFeatures) ? value.requiredFeatures : [],
    optionalFeatures: Array.isArray(value.optionalFeatures) ? value.optionalFeatures : [],
    depthSensing: value.depthSensing !== undefined,
    domOverlay: value.domOverlay !== undefined,
  };
}

/**
 * Records one session: what it was granted, its first frame, its frame and
 * pose counts, input sources, visibility and its end. `onEnd` runs once.
 */
export function watchSession(session: XRSessionLike, mode: string, via: string, log: DiagnosticsLog, now: () => number, onEnd: () => void): void {
  log.add('xr', 'info', `session started: ${mode} via ${via}`, {
    environmentBlendMode: session.environmentBlendMode ?? null,
    interactionMode: session.interactionMode ?? null,
    enabledFeatures: session.enabledFeatures ? [...session.enabledFeatures] : null,
    visibilityState: session.visibilityState ?? null,
    frameRate: session.frameRate ?? null,
  });
  const started = now();
  let ended = false;
  let viewer: unknown = null;
  let frames = 0;
  let posed = 0;
  let totalFrames = 0;
  let totalPosed = 0;
  let windowStart = started;
  session.requestReferenceSpace('viewer').then(
    (space) => {
      viewer = space;
    },
    (error: unknown) => log.add('xr', 'warn', `viewer reference space refused: ${describe(error)}`),
  );
  const onFrame = (_time: number, frame: XRFrameLike): void => {
    if (ended) return;
    const pose = viewer ? frame.getViewerPose(viewer) : null;
    if (totalFrames === 0) {
      const layer = session.renderState?.baseLayer;
      log.add('xr', 'info', 'first XR frame', {
        framebuffer: layer ? [layer.framebufferWidth, layer.framebufferHeight] : null,
        layers: session.renderState?.layers?.length ?? 0,
        views: pose ? pose.views.length : null,
      });
    }
    frames += 1;
    totalFrames += 1;
    if (pose) {
      posed += 1;
      totalPosed += 1;
    }
    const at = now();
    if (at - windowStart >= LIMITS.frameStatsMs) {
      log.add('xr', 'info', `xr frames: ${frames} (${posed} with a viewer pose) in ${((at - windowStart) / 1000).toFixed(1)} s`);
      frames = 0;
      posed = 0;
      windowStart = at;
    }
    session.requestAnimationFrame(onFrame);
  };
  session.requestAnimationFrame(onFrame);
  session.addEventListener('visibilitychange', () => log.add('xr', 'info', `session visibility: ${session.visibilityState ?? 'unknown'}`));
  session.addEventListener('inputsourceschange', (event) => {
    const change = event as Event & { added?: readonly unknown[]; removed?: readonly unknown[] };
    const summary = (sources: readonly unknown[] | undefined) =>
      (sources ?? []).map((source) => {
        const value = source as { handedness?: string; targetRayMode?: string; profiles?: readonly string[]; hand?: unknown };
        return `${value.handedness ?? '?'}/${value.targetRayMode ?? '?'}${value.hand ? '/hand' : ''}/${value.profiles?.[0] ?? '?'}`;
      });
    log.add('xr', 'info', 'input sources changed', { added: summary(change.added), removed: summary(change.removed) });
  });
  session.addEventListener('end', () => {
    if (ended) return;
    ended = true;
    log.add('xr', 'info', `session ended after ${((now() - started) / 1000).toFixed(1)} s: ${totalFrames} frames, ${totalPosed} with a viewer pose`);
    onEnd();
  });
}

/**
 * Wraps `requestSession` and `offerSession` on the page's XR system so every
 * session any engine starts is watched. Returns an undo.
 */
export function hookXRSystem(xr: XRSystemLike, log: DiagnosticsLog, now: () => number, onSessionEnd: () => void): () => void {
  const undo: Array<() => void> = [];
  for (const method of ['requestSession', 'offerSession'] as const) {
    const original = xr[method];
    if (typeof original !== 'function') continue;
    const wrapped = (mode: string, init?: unknown): Promise<XRSessionLike> => {
      log.add('xr', 'info', `${method}(${mode})`, summariseInit(init));
      const result = original.call(xr, mode, init);
      result.then(
        (session) => {
          try {
            watchSession(session, mode, method, log, now, onSessionEnd);
          } catch (error) {
            log.add('xr', 'warn', `could not watch the session: ${describe(error)}`);
          }
        },
        (error: unknown) => log.add('xr', 'error', `${method}(${mode}) failed: ${describe(error)}`),
      );
      return result;
    };
    xr[method] = wrapped;
    undo.push(() => {
      xr[method] = original;
    });
  }
  return () => undo.forEach((step) => step());
}

export type SendResult = { ok: true; id: string } | { ok: false; reason: string; retry: boolean };

/** Posts one body to the report service and says what happened, in words a tester can act on. */
export async function postReport(endpoint: string, body: string, fetchImpl: typeof fetch, keepalive = false): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive });
  } catch (error) {
    return { ok: false, reason: `could not reach the report service (${describe(error)}); the log is kept on this device and will be sent once when you are back online`, retry: true };
  }
  if (response.ok) {
    const answer = (await response.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: answer.id ?? 'unknown' };
  }
  const reasons: Record<number, string> = {
    404: 'this site has no report service (local builds have none); use Download or Copy',
    405: 'this site has no report service (local builds have none); use Download or Copy',
    413: 'the report was too large for the service',
    429: 'the report service is taking no more reports from here right now; try again shortly, or use Download',
    503: 'report storage is not set up on this site yet; use Download or Copy',
  };
  return { ok: false, reason: reasons[response.status] ?? `the report service answered HTTP ${response.status}`, retry: false };
}

/** What the hidden URL option asks for. */
export type DiagnosticsMode = 'off' | 'local' | 'send';

/** Reads the option's value: absent, empty, `0`, `off` or `false` is off; `local` keeps the log on the device; anything else sends it. */
export function diagnosticsMode(value: string | null): DiagnosticsMode {
  if (value === null) return 'off';
  const normalised = value.trim().toLowerCase();
  if (normalised === '' || normalised === '0' || normalised === 'off' || normalised === 'false') return 'off';
  return normalised === 'local' ? 'local' : 'send';
}

export interface DiagnosticsOptions {
  /** Which example this is, stored with every report. */
  lab: string;
  /** The hidden URL option that switches diagnostics on; see {@link diagnosticsMode}. */
  param: string;
  /** Where Send posts, on this origin. */
  endpoint?: string;
  /** Query parameters whose values the recorded URL may keep. */
  keepParams?: readonly string[];
  /** The corner the Diagnostics button sits in, clear of the page's own controls. Default `top-right`. */
  corner?: 'top-right' | 'bottom-right';
}

export interface Diagnostics {
  /** What the URL option asked for; every other member does nothing when `off`. */
  readonly mode: DiagnosticsMode;
  /** Records something the page wants in the log. */
  note(message: string, data?: Record<string, unknown>): void;
  /** The logs on this device as readable text, newest page load last. */
  text(): string;
  /** Sends the logs on this device once to the report service. */
  send(): Promise<SendResult>;
  /** Forgets every log on this device, this page load's included. */
  clear(): void;
  /** Opens the panel. */
  show(): void;
}

const INSTALLED = Symbol.for('rc.diagnostics');

function randomId(): string {
  const cryptoLike = globalThis.crypto as Crypto | undefined;
  if (cryptoLike?.randomUUID) return cryptoLike.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function safeStorage(): StorageLike | null {
  try {
    const storage = globalThis.localStorage;
    storage.getItem('rc-diagnostics-probe');
    return storage;
  } catch {
    return null;
  }
}

function webglInfo(): { info: Record<string, unknown>; canvas: HTMLCanvasElement | null } {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return { info: { available: false }, canvas };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const info = {
      available: true,
      version: gl.getParameter(gl.VERSION) as unknown,
      renderer: (debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) as unknown,
      vendor: (debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)) as unknown,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as unknown,
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { info, canvas };
  } catch (error) {
    return { info: { available: false, error: describe(error) }, canvas: null };
  }
}

const OFF: Diagnostics = {
  mode: 'off',
  note: () => {},
  text: () => '',
  send: async () => ({ ok: false, reason: 'diagnostics are off for this visit', retry: false }),
  clear: () => {},
  show: () => {},
};

/**
 * When the page was opened with the hidden option, starts recording for this
 * page load and adds the Diagnostics button; otherwise does nothing. Call it
 * before anything else the page runs. A second call returns the first.
 */
export function installDiagnostics(options: DiagnosticsOptions): Diagnostics {
  const mode = diagnosticsMode(new URLSearchParams(location.search).get(options.param));
  if (mode === 'off') return OFF;
  const holder = globalThis as unknown as Record<symbol, Diagnostics | undefined>;
  const existing = holder[INSTALLED];
  if (existing) return existing;

  const endpoint = options.endpoint ?? '/api/report';
  const keepParams = options.keepParams ?? [options.param];
  const storageKey = `rc-diagnostics:${options.lab}`;
  const storage = safeStorage();
  const now = () => performance.now();
  const log = new DiagnosticsLog(options.lab, randomId(), new Date().toISOString(), now);
  const stored = loadStored(storage, storageKey);
  const previous = stored.reports.filter((report) => report.id !== log.report.id).slice(-(LIMITS.reportsKept - 1));
  let pending = stored.pending;
  let sends = 0;
  let unsent = true;
  let recordingResult = false;
  let panel: DiagnosticsPanel | undefined;

  const xrSystem = (navigator as unknown as { xr?: XRSystemLike }).xr;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { brands?: Array<{ brand: string; version: string }>; mobile?: boolean; platform?: string };
  };
  const probe = webglInfo();
  log.report.env = {
    url: pageUrl(location, keepParams),
    userAgent: nav.userAgent,
    userAgentData: nav.userAgentData
      ? { brands: nav.userAgentData.brands?.map((brand) => `${brand.brand} ${brand.version}`) ?? [], mobile: nav.userAgentData.mobile ?? null, platform: nav.userAgentData.platform ?? null }
      : null,
    language: nav.language,
    viewport: [innerWidth, innerHeight],
    screen: [screen.width, screen.height],
    devicePixelRatio,
    secureContext: isSecureContext,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    webxr: xrSystem ? 'navigator.xr present' : 'navigator.xr missing',
    webgl: probe.info,
  };

  const all = (): DiagnosticsReport[] => [...previous, log.report];
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    saveStored(storage, storageKey, { v: 1, reports: all(), pending });
  };
  const scheduleSave = () => {
    saveTimer ??= setTimeout(saveNow, 1000);
  };

  const send = async (keepalive = false): Promise<SendResult> => {
    sends += 1;
    unsent = false;
    const three = (globalThis as { __THREE__?: unknown }).__THREE__ ?? null;
    const body = fitPayload(`${log.report.id}-${sends}`, all(), { mode, three, sentAt: new Date().toISOString() });
    const result = await postReport(endpoint, body, fetch.bind(globalThis), keepalive);
    pending = !result.ok && result.retry;
    // A refused send leaves the log unsent, so the next automatic moment tries again.
    if (!result.ok) unsent = true;
    recordingResult = true;
    log.add('note', result.ok ? 'info' : 'warn', result.ok ? `report sent as ${result.id}` : `report not sent: ${result.reason}`);
    recordingResult = false;
    saveNow();
    panel?.status(result.ok ? `Sent. Quote this id to the maintainers: ${result.id}` : `Not sent: ${result.reason}.`);
    return result;
  };
  /** Sends, unasked, when the option says so and something new was recorded since the last send. */
  const autoSend = (keepalive: boolean) => {
    if (mode === 'send' && unsent) void send(keepalive);
  };

  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  log.onEvent(() => {
    if (!recordingResult) unsent = true;
    scheduleSave();
    refreshTimer ??= setTimeout(() => {
      refreshTimer = undefined;
      panel?.refresh();
    }, 500);
  });

  wrapConsole(console, log);
  addEventListener(
    'error',
    (event) => {
      const target = event.target;
      if (target && target !== globalThis && typeof Element !== 'undefined' && target instanceof Element) {
        const source = (target as Partial<HTMLScriptElement & HTMLLinkElement>).src || (target as Partial<HTMLLinkElement>).href || '';
        log.add('resource', 'error', `failed to load <${target.tagName.toLowerCase()}> ${source}`);
        return;
      }
      const error = event as ErrorEvent;
      log.add('error', 'error', `${error.message} at ${error.filename}:${error.lineno}:${error.colno}${error.error instanceof Error ? `\n${describe(error.error)}` : ''}`);
    },
    true,
  );
  addEventListener('unhandledrejection', (event) => log.add('rejection', 'error', `unhandled rejection: ${describe((event as PromiseRejectionEvent).reason)}`));
  for (const type of ['webglcontextlost', 'webglcontextrestored']) {
    addEventListener(
      type,
      (event) => {
        if (event.target !== probe.canvas) log.add('webgl', type === 'webglcontextlost' ? 'error' : 'info', type);
      },
      true,
    );
  }
  if (xrSystem) {
    const offerSession = typeof xrSystem.offerSession === 'function';
    hookXRSystem(xrSystem, log, now, () => {
      saveNow();
      autoSend(false);
    });
    const support = xrSystem.isSessionSupported?.bind(xrSystem);
    if (support) {
      const ask = (sessionMode: string) => support(sessionMode).then((supported) => supported === true, () => false);
      void Promise.all([ask('immersive-vr'), ask('immersive-ar')]).then(([vr, ar]) => {
        log.report.env.webxr = { immersiveVr: vr, immersiveAr: ar, offerSession };
        scheduleSave();
      });
    }
  }
  addEventListener('pagehide', () => {
    saveNow();
    autoSend(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  addEventListener('online', () => {
    if (pending) void send();
  });
  if (pending && navigator.onLine) setTimeout(() => void send(), 3000);
  setTimeout(() => autoSend(false), LIMITS.firstSendMs);

  const api: Diagnostics = {
    mode,
    note: (message, data) => log.add('note', 'info', message, data),
    text: () => formatText(all()),
    send: () => send(),
    clear: () => {
      previous.length = 0;
      log.report.events.length = 0;
      log.report.repeated = {};
      log.report.dropped = 0;
      pending = false;
      saveNow();
      panel?.refresh();
    },
    show: () => {
      panel ??= new DiagnosticsPanel(options.lab, api, log, options.corner ?? 'top-right', mode);
      panel.open();
    },
  };
  holder[INSTALLED] = api;
  (globalThis as unknown as { rcDiagnostics: Diagnostics }).rcDiagnostics = api;

  const mount = () => {
    panel ??= new DiagnosticsPanel(options.lab, api, log, options.corner ?? 'top-right', mode);
  };
  if (document.body) mount();
  else addEventListener('DOMContentLoaded', mount, { once: true });
  return api;
}

const PANEL_HELP: Record<Exclude<DiagnosticsMode, 'off'>, string> = {
  send:
    'Logging is on for this visit. The log goes to the maintainers by itself: shortly after the page opens, when each XR session ends and when you leave. ' +
    'It also stays on this device: Download saves it as a text file (on Android XR, in the Files app under Downloads), Copy puts it on the clipboard. ' +
    'With USB debugging, run rcDiagnostics.text() in chrome://inspect.',
  local:
    'Logging is on for this visit, on this device only. Download saves it as a text file (on Android XR, in the Files app under Downloads). ' +
    'Copy puts it on the clipboard. Send uploads it to the maintainers. With USB debugging, run rcDiagnostics.text() in chrome://inspect.',
};

/** The Diagnostics button and its panel. Plain DOM, drawn above everything the page draws. */
class DiagnosticsPanel {
  private readonly button = document.createElement('button');
  private readonly root = document.createElement('div');
  private readonly pre = document.createElement('pre');
  private readonly statusLine = document.createElement('p');

  constructor(
    private readonly lab: string,
    private readonly api: Diagnostics,
    private readonly log: DiagnosticsLog,
    corner: 'top-right' | 'bottom-right',
    mode: Exclude<DiagnosticsMode, 'off'>,
  ) {
    const [buttonEdge, panelEdge] = corner === 'top-right' ? ['top:10px', 'top:46px'] : ['bottom:10px', 'bottom:46px'];
    this.button.type = 'button';
    this.button.setAttribute('style', `position:fixed;right:10px;${buttonEdge};z-index:60;padding:6px 12px;border-radius:999px;border:1px solid #2e4a66;background:rgba(16,26,38,0.9);color:#dce9f7;font:13px system-ui,sans-serif;cursor:pointer;`);
    this.button.addEventListener('click', () => (this.root.style.display === 'none' ? this.open() : this.close()));
    this.root.setAttribute('style', `display:none;position:fixed;right:10px;${panelEdge};z-index:60;width:min(560px,calc(100vw - 24px));max-height:75vh;overflow:auto;padding:14px;border-radius:12px;border:1px solid #2e4a66;background:rgba(11,16,22,0.97);color:#dce9f7;font:13px system-ui,sans-serif;box-sizing:border-box;`);
    const heading = document.createElement('h2');
    heading.textContent = 'Diagnostics';
    heading.setAttribute('style', 'margin:0 0 8px;font-size:16px;');
    const help = document.createElement('p');
    help.textContent = PANEL_HELP[mode];
    help.setAttribute('style', 'margin:0 0 10px;color:#9fb8d4;line-height:1.4;');
    const actions = document.createElement('div');
    actions.setAttribute('style', 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;');
    actions.append(
      this.action('Send to maintainers', () => {
        this.status('Sending...');
        void this.api.send();
      }),
      this.action('Download', () => this.download()),
      this.action('Copy', () => this.copy()),
      this.action('Clear', () => {
        this.api.clear();
        this.status('Cleared.');
      }),
      this.action('Close', () => this.close()),
    );
    this.statusLine.setAttribute('style', 'margin:0 0 8px;color:#7db8ff;min-height:1em;');
    this.pre.setAttribute('style', 'margin:0;max-height:45vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font:11px/1.4 ui-monospace,Consolas,monospace;background:#05080c;padding:8px;border-radius:8px;');
    this.root.append(heading, help, actions, this.statusLine, this.pre);
    document.body.append(this.button, this.root);
    this.refresh();
  }

  open(): void {
    this.root.style.display = 'block';
    this.refresh();
  }

  close(): void {
    this.root.style.display = 'none';
  }

  status(text: string): void {
    this.statusLine.textContent = text;
  }

  refresh(): void {
    const { errors, warnings } = this.log.counts();
    this.button.textContent = errors || warnings ? `Diagnostics (${errors} errors, ${warnings} warnings)` : 'Diagnostics';
    this.button.style.borderColor = errors ? '#ff9d7a' : '#2e4a66';
    if (this.root.style.display !== 'none') this.pre.textContent = this.api.text();
  }

  private action(label: string, run: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('style', 'padding:6px 12px;border-radius:8px;border:1px solid #2e4a66;background:#16283c;color:#dce9f7;font:inherit;cursor:pointer;');
    button.addEventListener('click', run);
    return button;
  }

  private download(): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const url = URL.createObjectURL(new Blob([this.api.text()], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.lab}-diagnostics-${stamp}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.status(`Saved ${link.download} to this device's downloads.`);
  }

  private copy(): void {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      this.status('This browser gives no clipboard here; use Download.');
      return;
    }
    clipboard.writeText(this.api.text()).then(
      () => this.status('Copied to the clipboard.'),
      () => this.status('The browser refused the clipboard; use Download.'),
    );
  }
}
