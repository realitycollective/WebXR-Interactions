import { describe, expect, it } from 'vitest';
import {
  DiagnosticsLog,
  LIMITS,
  diagnosticsMode,
  fitPayload,
  formatConsoleArgs,
  formatText,
  hookXRSystem,
  loadStored,
  pageUrl,
  postReport,
  redact,
  saveStored,
  wrapConsole,
  type DiagnosticsReport,
  type StorageLike,
  type XRFrameLike,
  type XRSessionLike,
} from '../src/diagnostics.js';

const clock = () => {
  let time = 0;
  return { now: () => time, advance: (ms: number) => (time += ms) };
};

const newLog = (now: () => number = () => 0) => new DiagnosticsLog('test-lab', 'page-1', '2026-10-07T00:00:00.000Z', now);

describe('diagnosticsMode', () => {
  it('is off unless the hidden option is given a value that is not off', () => {
    for (const value of [null, '', '0', 'off', 'OFF', 'false', ' off ']) expect(diagnosticsMode(value)).toBe('off');
  });

  it('keeps the log on the device for local, and sends it for anything else', () => {
    expect(diagnosticsMode('local')).toBe('local');
    expect(diagnosticsMode('Local')).toBe('local');
    for (const value of ['1', 'on', 'send', 'aura-test']) expect(diagnosticsMode(value)).toBe('send');
  });
});

describe('DiagnosticsLog', () => {
  it('folds an event repeated in a row into one line with a count', () => {
    const log = newLog();
    log.add('console', 'warn', 'Missing glyph info for character "x"');
    log.add('console', 'warn', 'Missing glyph info for character "x"');
    log.add('console', 'warn', 'Missing glyph info for character "x"');
    expect(log.report.events).toHaveLength(1);
    expect(log.report.events[0]?.n).toBe(3);
    expect(log.counts()).toEqual({ errors: 0, warnings: 3 });
  });

  it('records a message that keeps coming back only up to the repeat limit, then counts it', () => {
    const log = newLog();
    for (let i = 0; i < LIMITS.repeatLimit + 4; i += 1) {
      log.add('console', 'warn', 'again');
      log.add('console', 'info', `between ${i}`);
    }
    expect(log.report.events.filter((event) => event.m === 'again')).toHaveLength(LIMITS.repeatLimit);
    expect(log.report.repeated.again).toBe(LIMITS.repeatLimit + 4);
  });

  it('keeps the first events and the latest ones when it is full', () => {
    const log = newLog();
    for (let i = 0; i < LIMITS.eventsPerReport + 25; i += 1) log.add('note', 'info', `event ${i}`);
    const { events } = log.report;
    expect(events).toHaveLength(LIMITS.eventsPerReport);
    expect(events[0]?.m).toBe('event 0');
    expect(events[LIMITS.keepFirst - 1]?.m).toBe(`event ${LIMITS.keepFirst - 1}`);
    expect(events[events.length - 1]?.m).toBe(`event ${LIMITS.eventsPerReport + 24}`);
    expect(log.report.dropped).toBe(25);
  });

  it('redacts token values and clips long messages', () => {
    const log = newLog();
    log.add('error', 'error', 'GET https://lab.example/?uix-edit=s3cret&uix-engine=iwsdk failed');
    log.add('note', 'info', 'x'.repeat(LIMITS.messageChars + 50));
    expect(log.report.events[0]?.m).toBe('GET https://lab.example/?uix-edit=<redacted>&uix-engine=iwsdk failed');
    expect(log.report.events[1]?.m).toContain('(50 more chars)');
  });
});

describe('pageUrl and redact', () => {
  it('keeps only the named query parameters', () => {
    const url = pageUrl({ origin: 'https://lab.example', pathname: '/', search: '?uix-engine=xrblocks&uix-edit=s3cret&uix-log=send' }, ['uix-engine', 'uix-log']);
    expect(url).toBe('https://lab.example/?uix-engine=xrblocks&uix-log=send');
  });

  it('redacts every token-like parameter', () => {
    expect(redact('a?token=1&api-key=2&secret_x=3&ok=4')).toBe('a?token=<redacted>&api-key=<redacted>&secret_x=<redacted>&ok=4');
  });
});

describe('formatConsoleArgs', () => {
  it('drops %c markers and the style strings they consume', () => {
    expect(formatConsoleArgs(['%c[lab]%c ready', 'color:red', 'color:blue', 42])).toBe('[lab] ready 42');
  });

  it('describes errors and objects', () => {
    expect(formatConsoleArgs(['failed:', new TypeError('boom')])).toContain('TypeError: boom');
    expect(formatConsoleArgs([{ a: 1 }])).toBe('{"a":1}');
  });
});

describe('wrapConsole', () => {
  it('records each call and still runs the original', () => {
    const log = newLog();
    const seen: unknown[][] = [];
    const target = {
      log: (...args: unknown[]) => seen.push(args),
      info: (...args: unknown[]) => seen.push(args),
      warn: (...args: unknown[]) => seen.push(args),
      error: (...args: unknown[]) => seen.push(args),
    };
    const undo = wrapConsole(target, log);
    target.error('[lab] pipeline failed to start:', new Error('nope'));
    expect(seen).toHaveLength(1);
    expect(log.report.events[0]).toMatchObject({ k: 'console', l: 'error' });
    expect(log.report.events[0]?.m).toContain('Error: nope');
    undo();
    target.warn('after');
    expect(log.report.events).toHaveLength(1);
  });
});

describe('fitPayload', () => {
  const report = (id: string, events: number): DiagnosticsReport => ({
    id,
    lab: 'test-lab',
    startedAt: '2026-10-07T00:00:00.000Z',
    env: { userAgent: 'test' },
    events: Array.from({ length: events }, (_, i) => ({ t: i, k: 'note' as const, l: 'info' as const, m: `${id} event ${i} ${'.'.repeat(80)}` })),
    repeated: {},
    dropped: 0,
  });

  it('sends every page load, newest first, when they fit', () => {
    const body = JSON.parse(fitPayload('send-1', [report('old', 2), report('new', 2)], { three: '185' }));
    expect(body).toMatchObject({ format: 1, id: 'send-1', lab: 'test-lab', three: '185' });
    expect(body.reports.map((r: DiagnosticsReport) => r.id)).toEqual(['new', 'old']);
  });

  it('drops older page loads, then the middle of the newest, to stay under the limit', () => {
    const text = fitPayload('send-1', [report('old', 300), report('new', 400)], {}, 20_000);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(20_000);
    const body = JSON.parse(text) as { reports: DiagnosticsReport[] };
    expect(body.reports.map((r) => r.id)).toEqual(['new']);
    const events = body.reports[0]!.events;
    expect(events[0]?.m).toContain('new event 0');
    expect(events[events.length - 1]?.m).toContain('new event 399');
    expect(body.reports[0]!.dropped).toBeGreaterThan(0);
  });
});

describe('loadStored and saveStored', () => {
  const memory = (quota = Infinity): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        if (value.length > quota) throw new DOMException('full', 'QuotaExceededError');
        data.set(key, value);
      },
    };
  };
  const report = (id: string, size: number): DiagnosticsReport => ({ id, lab: 'l', startedAt: '', env: {}, events: [{ t: 0, k: 'note', l: 'info', m: 'x'.repeat(size) }], repeated: {}, dropped: 0 });

  it('round-trips and keeps only the last page loads', () => {
    const storage = memory();
    saveStored(storage, 'k', { v: 1, reports: [report('a', 1), report('b', 1), report('c', 1), report('d', 1)], pending: true });
    const loaded = loadStored(storage, 'k');
    expect(loaded.reports.map((r) => r.id)).toEqual(['b', 'c', 'd']);
    expect(loaded.pending).toBe(true);
  });

  it('drops the oldest page loads while the browser refuses the size', () => {
    const storage = memory(2_500);
    expect(saveStored(storage, 'k', { v: 1, reports: [report('a', 1000), report('b', 1000), report('c', 1000)], pending: false })).toBe(true);
    expect(loadStored(storage, 'k').reports.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('answers an empty store for a missing or corrupt entry, and saves nothing without storage', () => {
    const storage = memory();
    storage.data.set('k', '{not json');
    expect(loadStored(storage, 'k')).toEqual({ v: 1, reports: [], pending: false });
    expect(loadStored(null, 'k').reports).toEqual([]);
    expect(saveStored(null, 'k', { v: 1, reports: [], pending: false })).toBe(false);
  });
});

class FakeSession extends EventTarget implements XRSessionLike {
  readonly environmentBlendMode = 'additive';
  readonly interactionMode = 'world-space';
  readonly enabledFeatures = ['local-floor', 'hand-tracking'];
  visibilityState = 'visible';
  readonly renderState = { baseLayer: { framebufferWidth: 3840, framebufferHeight: 1920 }, layers: [] };
  private callbacks: Array<(time: number, frame: XRFrameLike) => void> = [];
  requestAnimationFrame(callback: (time: number, frame: XRFrameLike) => void): number {
    this.callbacks.push(callback);
    return this.callbacks.length;
  }
  requestReferenceSpace(): Promise<unknown> {
    return Promise.resolve({ viewer: true });
  }
  frame(posed: boolean): void {
    const pending = this.callbacks;
    this.callbacks = [];
    const frame: XRFrameLike = { getViewerPose: () => (posed ? { views: [{}, {}] } : null) };
    for (const callback of pending) callback(0, frame);
  }
}

describe('hookXRSystem', () => {
  it('records the request, the granted session, its first frame, frame counts and its end', async () => {
    const time = clock();
    const log = newLog(time.now);
    const session = new FakeSession();
    let ended = 0;
    const xr = { requestSession: (_mode: string, _init?: unknown) => Promise.resolve<XRSessionLike>(session) };
    hookXRSystem(xr, log, time.now, () => (ended += 1));

    await xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] });
    await Promise.resolve();
    session.frame(true);
    time.advance(LIMITS.frameStatsMs);
    session.frame(true);
    session.dispatchEvent(new Event('end'));
    session.dispatchEvent(new Event('end'));

    const text = formatText([log.report]);
    expect(text).toContain('requestSession(immersive-ar)');
    expect(text).toContain('"requiredFeatures":["local-floor"]');
    expect(text).toContain('session started: immersive-ar via requestSession');
    expect(text).toContain('"environmentBlendMode":"additive"');
    expect(text).toContain('first XR frame {"framebuffer":[3840,1920],"layers":0,"views":2}');
    expect(text).toContain('xr frames: 2 (2 with a viewer pose)');
    expect(text).toContain('session ended after 10.0 s: 2 frames, 2 with a viewer pose');
    expect(ended).toBe(1);
  });

  it('records a refused session as an error and returns the refusal unchanged', async () => {
    const log = newLog();
    const refusal = new DOMException('no local-floor', 'NotSupportedError');
    const xr = { requestSession: (_mode: string) => Promise.reject<XRSessionLike>(refusal) };
    hookXRSystem(xr, log, () => 0, () => {});
    await expect(xr.requestSession('immersive-ar')).rejects.toBe(refusal);
    expect(log.report.events.at(-1)).toMatchObject({ k: 'xr', l: 'error' });
    expect(log.report.events.at(-1)?.m).toContain('no local-floor');
  });

  it('leaves a system without offerSession alone and restores what it wrapped', () => {
    const log = newLog();
    const original = () => Promise.resolve<XRSessionLike>(new FakeSession());
    const xr: { requestSession: typeof original; offerSession?: typeof original } = { requestSession: original };
    const undo = hookXRSystem(xr, log, () => 0, () => {});
    expect(xr.offerSession).toBeUndefined();
    expect(xr.requestSession).not.toBe(original);
    undo();
    expect(xr.requestSession).toBe(original);
  });
});

describe('postReport', () => {
  const answer = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('returns the stored id', async () => {
    expect(await postReport('/api/report', '{}', answer(201, { stored: true, id: 'abc-1' }))).toEqual({ ok: true, id: 'abc-1' });
  });

  it('explains each refusal in words a tester can act on', async () => {
    for (const [status, words] of [
      [404, 'no report service'],
      [503, 'not set up'],
      [429, 'try again shortly'],
      [413, 'too large'],
      [500, 'HTTP 500'],
    ] as const) {
      const result = await postReport('/api/report', '{}', answer(status));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain(words);
        expect(result.retry).toBe(false);
      }
    }
  });

  it('asks for a retry when the service cannot be reached', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const result = await postReport('/api/report', '{}', offline);
    expect(result).toMatchObject({ ok: false, retry: true });
  });
});
