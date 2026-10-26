import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  formatLeadExportDate,
  leadExportDateRange,
  leadSourceLabel,
  protectLeadCsvCell,
} from './leadExport';

test('lead export date scopes use Asia/Kolkata calendar days with inclusive end dates', () => {
  const now = new Date('2026-10-25T20:00:00.000Z');
  const today = leadExportDateRange({ scope: 'today' }, now);
  assert.equal(today?.from, '2026-10-26');
  assert.equal(today?.to, '2026-10-26');

  const lastSevenDays = leadExportDateRange({ scope: 'last7' }, now);
  assert.equal(lastSevenDays?.from, '2026-10-20');
  assert.equal(lastSevenDays?.to, '2026-10-26');

  const custom = leadExportDateRange({ scope: 'custom', from: '2026-10-01', to: '2026-10-25' }, now);
  assert.equal(custom?.from, '2026-10-01');
  assert.equal(custom?.to, '2026-10-25');
  assert.equal(custom?.timeZone, 'Asia/Kolkata');
  assert.ok(custom && custom.endUtcExclusive > custom.startUtc);
});

test('lead export CSV protects formulas and quotes commas, line breaks, quotes, and Unicode', () => {
  assert.equal(protectLeadCsvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(protectLeadCsvCell('Acme, "South"\nઅમદાવાદ'), `"Acme, ""South""\nઅમદાવાદ"`);
});

test('lead export dates and source labels are normalized without inventing missing values', () => {
  assert.equal(formatLeadExportDate('not a date'), '');
  assert.match(formatLeadExportDate('2026-10-25T18:30:00.000Z'), /26 Oct 2026/);
  assert.equal(leadSourceLabel('NEO Chatbot'), 'NEO Chatbot');
  assert.equal(leadSourceLabel('/contact'), 'Contact Form');
  assert.equal(leadSourceLabel('/custom'), '/custom');
});

test('ExcelJS writes a readable XLSX workbook with Unicode values as plain text', async () => {
  const output = new PassThrough();
  const chunks: Uint8Array[] = [];
  output.on('data', (chunk: Uint8Array) => chunks.push(chunk));
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: false });
  const worksheet = workbook.addWorksheet('Leads');
  worksheet.addRow(['Business Name', 'Message']).commit();
  worksheet.addRow(['Aarav Foods', '=not a formula, नमस्ते']).commit();
  await workbook.commit();

  const parsed = new ExcelJS.Workbook();
  await parsed.xlsx.read(Readable.from(chunks));
  assert.equal(parsed.getWorksheet('Leads')?.getCell('A2').value, 'Aarav Foods');
  assert.equal(parsed.getWorksheet('Leads')?.getCell('B2').value, '=not a formula, नमस्ते');
});
