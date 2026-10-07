import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_INTERVAL_MS,
  MAX_BODY_BYTES,
  MAX_REPORTS_PER_DAY,
  RETENTION_HOURS,
  onRequest,
  type ReportsDatabase,
  type ReportsStatement,
} from '../functions/api/report.js';

// The Function runs against real SQL: Node's built-in SQLite stands in for D1,
// which is SQLite. Node 22.13 and later ship it unflagged; CI runs Node 22.
interface SqliteStatement {
  get(...values: unknown[]): unknown;
  run(...values: unknown[]): unknown;
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
}
const sqliteModule = 'node:sqlite';
const sqlite = (await import(/* @vite-ignore */ sqliteModule).catch(() => null)) as { DatabaseSync: new (path: string) => SqliteDatabase } | null;

/** D1's prepare/bind/first/run/batch over a synchronous SQLite database. */
function d1(db: SqliteDatabase): ReportsDatabase & { statements: string[] } {
  const statements: string[] = [];
  const statement = (sql: string, values: unknown[] = []): ReportsStatement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T,>() => {
      statements.push(sql);
      return (db.prepare(sql).get(...values) ?? null) as T | null;
    },
    run: async () => {
      statements.push(sql);
      return db.prepare(sql).run(...values);
    },
  });
  return {
    statements,
    prepare: (sql) => statement(sql),
    batch: async (list) => {
      for (const item of list) await item.run();
    },
  };
}

const NOW = Date.parse('2026-10-07T12:00:00Z');

const post = (body: string, address = '203.0.113.7', headers: Record<string, string> = {}) =>
  new Request('https://lab.example/api/report', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': address, 'user-agent': 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0', ...headers },
  });

const report = (id: string) => JSON.stringify({ format: 1, id, lab: 'test-lab', reports: [] });

describe.skipIf(!sqlite)('POST /api/report', () => {
  let raw: SqliteDatabase;
  let db: ReturnType<typeof d1>;

  beforeEach(() => {
    raw = new sqlite!.DatabaseSync(':memory:');
    db = d1(raw);
  });

  const rows = () => raw.prepare('SELECT id, day, lab, client, user_agent, length(body) AS size FROM reports ORDER BY received_at').get() as Record<string, unknown> | undefined;
  const count = () => (raw.prepare('SELECT COUNT(*) AS n FROM reports').get() as { n: number }).n;

  it('creates its table on first use and stores one row per report, with no address', async () => {
    const response = await onRequest({ request: post(report('page-1-1')), env: { REPORTS_DB: db } }, NOW);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ stored: true, id: 'page-1-1' });
    const row = rows()!;
    expect(row).toMatchObject({ id: 'page-1-1', day: '2026-10-07', lab: 'test-lab' });
    expect(String(row.user_agent)).toContain('Android 15');
    expect(String(row.client)).toMatch(/^[0-9a-f]{16}$/);
    expect(String(row.client)).not.toContain('203.0.113.7');
  });

  it('answers 503 and stores nothing when no database is bound', async () => {
    const response = await onRequest({ request: post(report('page-1-1')), env: {} }, NOW);
    expect(response.status).toBe(503);
  });

  it('answers 405 to anything but POST, so a GET never reaches the site pages', async () => {
    const response = await onRequest({ request: new Request('https://lab.example/api/report'), env: { REPORTS_DB: db } }, NOW);
    expect(response.status).toBe(405);
  });

  it('refuses a body over the limit, whether declared or actual', async () => {
    const big = JSON.stringify({ id: 'page-1-1', lab: 'test-lab', pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect((await onRequest({ request: post(big), env: { REPORTS_DB: db } }, NOW)).status).toBe(413);
    expect(db.statements).toHaveLength(0);
  });

  it('refuses a body that is not a report', async () => {
    for (const body of ['not json', JSON.stringify({ lab: 'test-lab' }), JSON.stringify({ id: 'x', lab: 'test-lab' }), JSON.stringify({ id: 'page-1-1' })]) {
      expect((await onRequest({ request: post(body), env: { REPORTS_DB: db } }, NOW)).status).toBe(400);
    }
  });

  it('takes one report per client per interval, and another client at once', async () => {
    expect((await onRequest({ request: post(report('page-1-1')), env: { REPORTS_DB: db } }, NOW)).status).toBe(201);
    expect((await onRequest({ request: post(report('page-1-2')), env: { REPORTS_DB: db } }, NOW + 1_000)).status).toBe(429);
    expect((await onRequest({ request: post(report('page-2-1'), '198.51.100.9'), env: { REPORTS_DB: db } }, NOW + 1_000)).status).toBe(201);
    expect((await onRequest({ request: post(report('page-1-3')), env: { REPORTS_DB: db } }, NOW + CLIENT_INTERVAL_MS + 1)).status).toBe(201);
    expect(count()).toBe(3);
  });

  it('stops at the daily limit for the whole site', async () => {
    for (let i = 0; i < MAX_REPORTS_PER_DAY; i += 1) {
      const response = await onRequest({ request: post(report(`page-${i}-1`), `192.0.2.${i % 250}.${i}`), env: { REPORTS_DB: db } }, NOW + i * (CLIENT_INTERVAL_MS + 1));
      expect(response.status).toBe(201);
    }
    const over = await onRequest({ request: post(report('page-over-1'), '198.51.100.200'), env: { REPORTS_DB: db } }, NOW + 1);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ reason: 'daily report limit reached' });
    expect(count()).toBe(MAX_REPORTS_PER_DAY);
  });

  it('keeps every report at least 24 hours, and deletes it once past the retention', async () => {
    const hour = 3_600_000;
    expect(RETENTION_HOURS).toBeGreaterThanOrEqual(24);
    const old = NOW - (RETENTION_HOURS + 1) * hour;
    await onRequest({ request: post(report('page-old-1')), env: { REPORTS_DB: db } }, old);
    const dayOld = NOW - 24 * hour;
    await onRequest({ request: post(report('page-day-old-1'), '198.51.100.9'), env: { REPORTS_DB: db } }, dayOld);
    expect(count()).toBe(2);
    await onRequest({ request: post(report('page-new-1')), env: { REPORTS_DB: db } }, NOW);
    const ids = (raw.prepare('SELECT group_concat(id) AS ids FROM reports').get() as { ids: string }).ids.split(',').sort();
    expect(ids).toEqual(['page-day-old-1', 'page-new-1']);
  });

  it('stores a repeated report id once', async () => {
    await onRequest({ request: post(report('page-1-1')), env: { REPORTS_DB: db } }, NOW);
    await onRequest({ request: post(report('page-1-1'), '198.51.100.9'), env: { REPORTS_DB: db } }, NOW + 1);
    expect(count()).toBe(1);
  });
});
