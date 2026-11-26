import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Footer } from './Footer';

test('places Cookie Settings beside the privacy link in the footer legal row', () => {
  const markup = renderToStaticMarkup(
    <Footer onNavigate={() => undefined} onOpenCookieSettings={() => undefined} />,
  );
  const privacyIndex = markup.indexOf('Privacy Policy');
  const settingsIndex = markup.indexOf('Cookie Settings');
  const termsIndex = markup.indexOf('Terms &amp; Conditions');

  assert.ok(privacyIndex >= 0);
  assert.ok(settingsIndex > privacyIndex);
  assert.ok(termsIndex > settingsIndex);
});
