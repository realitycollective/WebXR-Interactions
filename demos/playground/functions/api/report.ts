/**
 * POST /api/report - stores one diagnostics report sent by `diagnostics.ts`
 * from a lab opened with its hidden log option.
 *
 * Kept byte-identical in WebXR-UIExtensions (demos/webxr-multiplatform) and
 * WebXR-Interactions (demos/playground). Cloudflare Pages deploys it with the
 * site: `wrangler pages deploy` compiles `functions/` beside `dist/`, and only
 * this path invokes it, so static pages cost no Function requests.
 *
 * It does nothing until the Pages project binds a D1 database as `REPORTS_DB`:
 * until then it answers 503 and the page keeps the log on the device. It
 * creates its table on first use. See the lab README, "Diagnostics".
 *
 * Budget, on the Workers Free plan: one request and one D1 row (plus its index
 * entries) per report. Each report is at most {@link MAX_BODY_BYTES}. The whole
 * database stores at most {@link MAX_REPORTS_PER_DAY} reports per UTC day, and
 * one client at most one per {@link CLIENT_INTERVAL_MS}. A client is a hash of
 * its address salted with the day, so no address is stored and no client can
 * be followed across days.
 *
 * Retention: a report is kept at least {@link RETENTION_HOURS} hours, enough
 * to arrange a test with a tester and collect the results. Each new report
 * deletes those older than that, so the table stays small.
 */

/** The slice of Cloudflare's D1 binding this uses. */
export interface ReportsDatabase {
  prepare(query: string): ReportsStatement;
  batch(statements: ReportsStatement[]): Promise<unknown>;
}

export interface ReportsStatement {
  bind(...values: unknown[]): ReportsStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface ReportEnv {
  REPORTS_DB?: ReportsDatabase;
}

export interface ReportContext {
  request: Request;
  env: ReportEnv;
}

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_REPORTS_PER_DAY = 200;
export const CLIENT_INTERVAL_MS = 15_000;
export const RETENTION_HOURS = 48;

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    client TEXT NOT NULL,
    lab TEXT NOT NULL,
    user_agent TEXT,
    body TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS reports_day ON reports (day)',
];

const ID = /^[A-Za-z0-9-]{8,80}$/;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

async function clientOf(request: Request, day: string): Promise<string> {
  const address = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}|${address}`));
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function store(db: ReportsDatabase, request: Request, report: { id: string; lab: string }, text: string, now: number): Promise<Response> {
  const day = new Date(now).toISOString().slice(0, 10);
  const client = await clientOf(request, day);
  const usage = await db
    .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN client = ? AND received_at > ? THEN 1 ELSE 0 END), 0) AS recent FROM reports WHERE day = ?')
    .bind(client, now - CLIENT_INTERVAL_MS, day)
    .first<{ total: number; recent: number }>();
  const total = usage?.total ?? 0;
  if (total >= MAX_REPORTS_PER_DAY) return json(429, { stored: false, reason: 'daily report limit reached' });
  if ((usage?.recent ?? 0) > 0) return json(429, { stored: false, reason: `one report per ${CLIENT_INTERVAL_MS / 1000} s from one client` });
  await db.prepare('DELETE FROM reports WHERE received_at < ?').bind(now - RETENTION_HOURS * 3_600_000).run();
  await db
    .prepare('INSERT OR IGNORE INTO reports (id, day, received_at, client, lab, user_agent, body) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(report.id, day, now, client, report.lab.slice(0, 64), (request.headers.get('user-agent') ?? '').slice(0, 400), text)
    .run();
  return json(201, { stored: true, id: report.id });
}

/** Every method lands here, so a GET never falls through to the site's pages. */
export async function onRequest({ request, env }: ReportContext, now: number = Date.now()): Promise<Response> {
  if (request.method !== 'POST') return json(405, { stored: false, reason: 'POST a report' });
  const db = env.REPORTS_DB;
  if (!db) return json(503, { stored: false, reason: 'report storage is not set up on this site' });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return json(413, { stored: false, reason: `reports are limited to ${MAX_BODY_BYTES} bytes` });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json(413, { stored: false, reason: `reports are limited to ${MAX_BODY_BYTES} bytes` });

  let report: { id?: unknown; lab?: unknown };
  try {
    report = JSON.parse(text) as { id?: unknown; lab?: unknown };
  } catch {
    return json(400, { stored: false, reason: 'the body is not JSON' });
  }
  if (typeof report.id !== 'string' || !ID.test(report.id) || typeof report.lab !== 'string') {
    return json(400, { stored: false, reason: 'a report needs an id and a lab' });
  }
  const valid = { id: report.id, lab: report.lab };

  try {
    return await store(db, request, valid, text, now);
  } catch (error) {
    if (!/no such table/i.test(String(error))) throw error;
    await db.batch(SCHEMA.map((statement) => db.prepare(statement)));
    return store(db, request, valid, text, now);
  }
}
