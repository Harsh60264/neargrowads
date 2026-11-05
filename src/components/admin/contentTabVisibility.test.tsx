import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContentTabVisibility } from './ContentTabVisibility';

test('Themes tab excludes FAQs and page content while rendering Theme Manager', () => {
  const markup = renderToStaticMarkup(
    <>
      <section data-testid="theme-manager">Theme Manager</section>
      <ContentTabVisibility visible={false}>
        <section data-testid="faq-fields">FAQs</section>
        <section data-testid="page-fields">Page content and SEO</section>
      </ContentTabVisibility>
    </>,
  );

  assert.match(markup, /data-testid="theme-manager"/);
  assert.doesNotMatch(markup, /faq-fields|page-fields|FAQs|Page content and SEO/);
});

test('non-Themes tabs preserve their existing page sections without Theme Manager', () => {
  const markup = renderToStaticMarkup(
    <>
      <ContentTabVisibility visible={false}>
        <section data-testid="theme-manager">Theme Manager</section>
      </ContentTabVisibility>
      <ContentTabVisibility visible>
        <section data-testid="faq-fields">FAQs</section>
        <section data-testid="page-fields">Page content and SEO</section>
      </ContentTabVisibility>
    </>,
  );

  assert.match(markup, /faq-fields/);
  assert.match(markup, /page-fields/);
  assert.doesNotMatch(markup, /theme-manager|Theme Manager/);
});
