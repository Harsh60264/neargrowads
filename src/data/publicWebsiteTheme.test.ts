import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PUBLIC_WEBSITE_THEMES,
  parsePublicWebsiteThemes,
  publicWebsiteThemeCssVariables,
} from './publicWebsiteTheme';

test('public website themes keep independent premium Light and Dark defaults', () => {
  assert.notDeepEqual(DEFAULT_PUBLIC_WEBSITE_THEMES.light, DEFAULT_PUBLIC_WEBSITE_THEMES.dark);
  assert.equal(DEFAULT_PUBLIC_WEBSITE_THEMES.light.primary, '#2457D6');
  assert.equal(DEFAULT_PUBLIC_WEBSITE_THEMES.dark.background, '#070F24');
  assert.equal(DEFAULT_PUBLIC_WEBSITE_THEMES.dark.text, '#F3F6FF');
});

test('public website theme parsing fills omitted tokens and rejects invalid colors', () => {
  const parsed = parsePublicWebsiteThemes({ light: { primary: '#315AC8' } });
  assert.equal(parsed?.light.primary, '#315AC8');
  assert.equal(parsed?.light.background, DEFAULT_PUBLIC_WEBSITE_THEMES.light.background);
  assert.deepEqual(parsed?.dark, DEFAULT_PUBLIC_WEBSITE_THEMES.dark);
  assert.equal(parsePublicWebsiteThemes({ dark: { primary: 'url(javascript:alert(1))' } }), undefined);
  assert.equal(parsePublicWebsiteThemes(null), undefined);
});

test('public website theme tokens map to the CSS custom properties used by the site', () => {
  const variables = publicWebsiteThemeCssVariables(DEFAULT_PUBLIC_WEBSITE_THEMES.dark);
  assert.equal(variables['--website-background'], '#070F24');
  assert.equal(variables['--website-primary'], '#315ECD');
  assert.equal(variables['--website-text-muted'], '#B4C0DB');
});
