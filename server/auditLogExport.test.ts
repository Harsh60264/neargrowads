import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAuditLogCursorFilter,
  iterateAuditLogRecords,
  normalizeAuditExportRecord,
  protectCsvCell,
  redactSensitiveFields,
  resolveAuditDateRange,
  sanitizeAuditRecord,
  serializeAuditRecordCsv,
} from './auditLogExport';

test('converts inclusive Asia/Kolkata dates to exclusive UTC bounds', () => {
  const range = resolveAuditDateRange('2026-10-24', '2026-10-24');
  assert.equal(range.startUtc, '2026-10-23T18:30:00.000Z');
  assert.equal(range.endUtcExclusive, '2026-10-24T18:30:00.000Z');
  assert.equal(range.timeZone, 'Asia/Kolkata');
});

test('rejects impossible and inverted calendar ranges', () => {
  assert.throws(() => resolveAuditDateRange('2026-02-30', '2026-03-01'));
  assert.throws(() => resolveAuditDateRange('2026-10-25', '2026-10-24'));
});

test('redacts nested secret keys without changing other JSON values', () => {
  const source = {
    slug: 'artisanal-retail-local-search',
    status: 'published',
    caseStudyId: 'c4ecceb8-7a1a-47aa-9a2e-200bc5a93b4d',
    previousStatus: null,
    changes: [{ enabled: true, count: 3, title: 'Résumé, "quoted"\nline' }],
    nested: [{
      access_token: 'do-not-export',
      service_role_key: 'service-secret',
      child: { apiKey: 'also-secret', jwt: 'signed-token' },
    }],
  };
  const result = redactSensitiveFields(source);
  assert.deepEqual(result.value, {
    ...source,
    nested: [{
      access_token: '[REDACTED]',
      service_role_key: '[REDACTED]',
      child: { apiKey: '[REDACTED]', jwt: '[REDACTED]' },
    }],
  });
  assert.equal(result.count, 4);
  assert.deepEqual(result.keys, ['access_token', 'apiKey', 'jwt', 'service_role_key']);
  assert.equal(source.nested[0].access_token, 'do-not-export');
});

test('CSV quotes multiline Unicode fields and protects formula-like values', () => {
  assert.equal(protectCsvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(protectCsvCell('  @SUM(A1:A2)'), `"\'  @SUM(A1:A2)"`);
  assert.equal(protectCsvCell('\uFEFF=1+1'), `"'﻿=1+1"`);
  const event = sanitizeAuditRecord(normalizeAuditExportRecord({
    id: 'event-1',
    created_at: '2026-10-24T01:00:00.000Z',
    action: '+cmd',
    actor_id: null,
    target_id: null,
    section: 'caseStudies',
    details: { caption: 'café, "launch"\nsecond line', items: [null, false, 4] },
    actor: { email: '=HYPERLINK("x")' },
  }));
  const csv = serializeAuditRecordCsv(event);
  const cells = csv.trimEnd().match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)?.map((cell) => {
    const unquoted = cell.replace(/,$/, '');
    return unquoted.startsWith('"') ? unquoted.slice(1, -1).replace(/""/g, '"') : unquoted;
  });
  assert.ok(cells);
  assert.equal(cells[0], 'event-1');
  assert.equal(cells[2], "'+cmd");
  assert.equal(cells[4], `'=HYPERLINK("x")`);
  assert.deepEqual(JSON.parse(cells[8]), { caption: 'café, "launch"\nsecond line', items: [null, false, 4] });
});

test('keyset cursor includes both timestamp and unique ID tie-breaker', () => {
  assert.equal(
    buildAuditLogCursorFilter('2026-10-24T01:00:00.000Z', 'b0000000-0000-4000-8000-000000000000'),
    '(created_at.lt.2026-10-24T01:00:00.000Z,and(created_at.eq.2026-10-24T01:00:00.000Z,id.lt.b0000000-0000-4000-8000-000000000000))',
  );
});

test('streams every synthetic record across keyset pages with equal timestamps', async () => {
  const records = Array.from({ length: 1207 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${(1206 - index).toString().padStart(12, '0')}`,
    created_at: '2026-10-24T01:00:00.000Z',
    action: `test.${index}`,
  }));
  const seen: string[] = [];
  const pages: number[] = [];
  for await (const record of iterateAuditLogRecords(async (cursor) => {
    const matching = cursor
      ? records.filter((item) => item.created_at < cursor.createdAt ||
        (item.created_at === cursor.createdAt && item.id < cursor.id))
      : records;
    const page = matching.slice(0, 500);
    pages.push(page.length);
    return page;
  }, records.length)) {
    seen.push(String(record.id));
  }
  assert.equal(seen.length, records.length);
  assert.equal(new Set(seen).size, records.length);
  assert.deepEqual(seen, records.map((record) => record.id));
  assert.deepEqual(pages, [500, 500, 207]);
});

test('a fixed cutoff excludes records arriving during multi-page export', async () => {
  const cutoff = '2026-10-24T01:00:00.000Z';
  const records: Array<{ id: string; created_at: string }> = Array.from({ length: 7 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${(7 - index).toString().padStart(12, '0')}`,
    created_at: '2026-10-24T00:59:00.000Z',
  }));
  const exported: string[] = [];
  for await (const record of iterateAuditLogRecords(async (cursor) => {
    if (cursor && records.length === 7) {
      records.unshift({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', created_at: '2026-10-24T01:00:00.500Z' });
    }
    return records
      .filter((item) => item.created_at < cutoff)
      .filter((item) => !cursor || item.created_at < cursor.createdAt ||
        (item.created_at === cursor.createdAt && item.id < cursor.id))
      .slice(0, 3);
  }, 7, 3)) {
    exported.push(String(record.id));
  }
  assert.equal(exported.length, 7);
  assert.equal(exported.includes('ffffffff-ffff-4fff-8fff-ffffffffffff'), false);
});

test('fails when a requested export page is missing instead of returning partial success', async () => {
  const iterator = iterateAuditLogRecords(async () => [{
    id: '00000000-0000-4000-8000-000000000001',
    created_at: '2026-10-24T00:59:00.000Z',
  }], 2, 5);
  await assert.rejects(async () => {
    for await (const _record of iterator) { /* consume the export stream */ }
  }, /count mismatch/);
});
