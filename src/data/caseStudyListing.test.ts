import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCaseStudies, paginateCaseStudies } from './caseStudyListing';

const studies = [
  { title: 'One', category: 'Local SEO' },
  { title: 'Two', category: 'Paid Advertising' },
  { title: 'Three', category: ' local   seo ' },
  { title: 'Four', category: 'Paid Advertising' },
];

test('filters case studies by normalized category and keeps the all filter', () => {
  assert.deepEqual(filterCaseStudies(studies, 'all'), studies);
  assert.deepEqual(
    filterCaseStudies(studies, 'category:local seo').map((study) => study.title),
    ['One', 'Three'],
  );
  assert.deepEqual(filterCaseStudies(studies, 'category:unknown'), []);
  assert.deepEqual(filterCaseStudies(studies, 'unsupported-filter'), []);
});

test('paginates case studies in groups of three and reports the page count', () => {
  assert.deepEqual(paginateCaseStudies(studies, 1), {
    pageCount: 2,
    pageStudies: studies.slice(0, 3),
  });
  assert.deepEqual(paginateCaseStudies(studies, 2), {
    pageCount: 2,
    pageStudies: studies.slice(3),
  });
  assert.deepEqual(paginateCaseStudies([], 1), { pageCount: 0, pageStudies: [] });
});
