import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stylesheet = await readFile(new URL('./partnerPortalPreview.css', import.meta.url), 'utf8');

test('light partner navigation uses accessible surfaces and states', () => {
  assert.match(stylesheet, /html\[data-theme='light'\] \.partner-workspace \.partner-preview-sidebar\s*\{[^}]*border-right-color:\s*var\(--brand-border\);[^}]*background:\s*#FFFFFF;[^}]*color:\s*#071426;/);
  assert.match(stylesheet, /html\[data-theme='light'\] \.partner-workspace \.partner-preview-sidebar nav button svg\s*\{\s*color:\s*var\(--brand-green\);/);
  assert.match(stylesheet, /html\[data-theme='light'\] \.partner-workspace \.partner-preview-sidebar nav button\[aria-current='page'\]\s*\{\s*background:\s*var\(--brand-green-light\);\s*color:\s*var\(--brand-green-deep\);/);
  assert.match(stylesheet, /html\[data-theme='light'\] \.partner-workspace \.partner-preview-sidebar nav button:hover:not\(\[aria-current='page'\]\),\s*html\[data-theme='light'\] \.partner-workspace \.partner-preview-sidebar nav button:focus-visible:not\(\[aria-current='page'\]\)/);
  assert.match(stylesheet, /html\[data-theme='light'\] \.partner-workspace \.partner-preview-sidebar nav button\[aria-current='page'\]:active/);
  assert.match(stylesheet, /html\[data-theme='light'\] \.partner-workspace \.partner-preview-mobile-tabs button\[aria-current='page'\]/);
});

test('campaign details keep readable light text on the existing green card', () => {
  assert.match(stylesheet, /html\[data-theme='light'\] \.partner-workspace \.nwg-active-campaign h2,[\s\S]*?color:\s*#FFFFFF;/);
  assert.match(stylesheet, /html\[data-theme='light'\] \.partner-workspace \.nwg-active-campaign > p,[\s\S]*?color:\s*#DDFBE3;/);
  assert.match(stylesheet, /html\[data-theme='light'\] \.partner-workspace \.nwg-active-campaign \.nwg-empty-inverse > p/);
  assert.match(stylesheet, /\.nwg-active-campaign \{[^}]*background:\s*linear-gradient\(118deg,\s*#15583a,\s*#103d2a\)/);
});

test('dark partner navigation keeps its existing navy palette', () => {
  assert.match(stylesheet, /\.partner-workspace \.partner-preview-sidebar \{\s*border-color:\s*#1b2b3d;\s*background:\s*#071426;\s*color:\s*#f7fafc;/);
  assert.match(stylesheet, /\.partner-workspace \.partner-preview-sidebar nav button:hover:not\(\[aria-current='page'\]\) \{\s*background:\s*#12243a;\s*color:\s*#fff;/);
  assert.match(stylesheet, /\.partner-workspace \.partner-preview-sidebar nav button\[aria-current='page'\] \{\s*background:\s*#008a55;\s*color:\s*#fff;/);
});
