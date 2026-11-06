import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_CMS_THEME_REGISTRY,
  DEFAULT_ADMIN_CMS_THEME_ASSIGNMENTS,
  DEFAULT_PUBLIC_WEBSITE_THEME_ASSIGNMENTS,
  DEFAULT_PUBLIC_WEBSITE_THEMES,
  getAdminCmsThemeDefinition,
  getPublicWebsiteThemeDefinition,
  getPublicWebsiteThemePalette,
  parseAdminCmsThemeAssignments,
  parsePublicWebsiteThemeAssignments,
  parsePublicWebsiteThemes,
  PUBLIC_WEBSITE_THEME_REGISTRY,
  publicWebsiteThemeCssVariables,
} from './publicWebsiteTheme';

test('public defaults reproduce the original website Light and Dark palettes', () => {
  assert.equal(DEFAULT_PUBLIC_WEBSITE_THEMES.light.background, '#F8F7F2');
  assert.equal(DEFAULT_PUBLIC_WEBSITE_THEMES.light.primary, '#23734B');
  assert.equal(DEFAULT_PUBLIC_WEBSITE_THEMES.dark.background, '#070B13');
  assert.equal(DEFAULT_PUBLIC_WEBSITE_THEMES.dark.primary, '#70BE55');
  assert.deepEqual(DEFAULT_PUBLIC_WEBSITE_THEME_ASSIGNMENTS, {
    light: 'original-website-light',
    dark: 'original-website-dark',
  });
});

test('active catalogues contain only original presets and support separate appearance groups', () => {
  assert.deepEqual(
    PUBLIC_WEBSITE_THEME_REGISTRY.map(({ id }) => id),
    ['original-website-light', 'original-website-dark'],
  );
  assert.deepEqual(
    ADMIN_CMS_THEME_REGISTRY.map(({ id }) => id),
    ['original-cms-light', 'original-cms-dark'],
  );
  assert.deepEqual(DEFAULT_ADMIN_CMS_THEME_ASSIGNMENTS, {
    light: 'original-cms-light',
    dark: 'original-cms-dark',
  });
  assert.equal(getPublicWebsiteThemeDefinition('royal-light')?.id, 'original-website-light');
  assert.equal(getAdminCmsThemeDefinition('original-cms-dark')?.palette.background, '#0D1814');
});

test('theme assignments are independent and migrate rejected legacy preset ids to original themes', () => {
  assert.deepEqual(
    parsePublicWebsiteThemeAssignments({ light: 'cloud-light', dark: 'ocean-dark' }),
    DEFAULT_PUBLIC_WEBSITE_THEME_ASSIGNMENTS,
  );
  assert.deepEqual(
    parsePublicWebsiteThemeAssignments({
      light: 'original-website-light',
      dark: 'original-website-dark',
    }),
    DEFAULT_PUBLIC_WEBSITE_THEME_ASSIGNMENTS,
  );
  assert.deepEqual(
    parseAdminCmsThemeAssignments({
      light: 'original-cms-light',
      dark: 'original-cms-dark',
    }),
    DEFAULT_ADMIN_CMS_THEME_ASSIGNMENTS,
  );
  assert.deepEqual(parsePublicWebsiteThemeAssignments({
    light: 'original-website-dark',
    dark: 'original-website-light',
  }), {
    light: 'original-website-dark',
    dark: 'original-website-light',
  });
  assert.deepEqual(parseAdminCmsThemeAssignments({
    light: 'original-cms-dark',
    dark: 'original-cms-light',
  }), {
    light: 'original-cms-dark',
    dark: 'original-cms-light',
  });
  assert.deepEqual(parseAdminCmsThemeAssignments({
    light: 'premium-cms-light',
    dark: 'premium-cms-dark',
  }), DEFAULT_ADMIN_CMS_THEME_ASSIGNMENTS);
  assert.equal(getAdminCmsThemeDefinition('premium-cms-light')?.id, 'original-cms-light');
  assert.equal(parseAdminCmsThemeAssignments({ light: 'unknown', dark: 'original-cms-dark' }), undefined);
});

test('legacy saved palette documents remain valid without overriding the restored original presets', () => {
  const parsed = parsePublicWebsiteThemes({ light: { primary: '#4269BE' } });
  assert.equal(parsed?.light.primary, '#4269BE');
  assert.equal(parsed?.dark.background, DEFAULT_PUBLIC_WEBSITE_THEMES.dark.background);
  assert.equal(parsePublicWebsiteThemes({ dark: { primary: 'url(javascript:alert(1))' } }), undefined);
  assert.deepEqual(
    getPublicWebsiteThemePalette('royal-light', 'light'),
    DEFAULT_PUBLIC_WEBSITE_THEMES.light,
  );
});

test('public theme palettes map to the original site token names', () => {
  const variables = publicWebsiteThemeCssVariables(DEFAULT_PUBLIC_WEBSITE_THEMES.dark);
  assert.equal(variables['--brand-bg'], '#070B13');
  assert.equal(variables['--brand-green'], '#70BE55');
  assert.equal(variables['--brand-text-muted'], '#A6AEC0');
});
