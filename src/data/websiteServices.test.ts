import assert from 'node:assert/strict';
import test from 'node:test';
import {
  removeWebsiteServiceImageVariant,
  resolveWebsiteServiceImage,
  type WebsiteService,
} from './websiteServices';

const service: WebsiteService = {
  id: 'service-1',
  slug: 'local-seo',
  title: 'Local SEO',
  badge: 'Search',
  shortDescription: 'Improve local visibility.',
  icon: '',
  deliverables: [],
  primaryCtaLabel: 'Learn more',
  primaryCtaLink: '/get-started',
  secondaryCtaLabel: '',
  secondaryCtaLink: '',
  backgroundImageUrl: 'https://cdn.example.test/default.jpg',
  backgroundImageVariants: {
    dark: { url: 'https://cdn.example.test/dark.jpg', backgroundEnabled: true },
    light: { url: 'https://cdn.example.test/light.jpg', backgroundEnabled: true },
  },
  backgroundEnabled: true,
  backgroundFit: 'cover',
  backgroundOpacity: 100,
  backgroundPositionX: 50,
  backgroundPositionY: 50,
  displayOrder: 0,
  status: 'published',
};

test('removing a service image creates a theme-specific empty state without deleting shared images', () => {
  const variants = removeWebsiteServiceImageVariant(service.backgroundImageVariants, 'dark');
  const edited = { ...service, backgroundImageVariants: variants };
  const darkImage = resolveWebsiteServiceImage(edited, 'dark');
  const lightImage = resolveWebsiteServiceImage(edited, 'light');

  assert.equal(darkImage.url, '');
  assert.equal(darkImage.backgroundEnabled, false);
  assert.equal(darkImage.source, 'empty');
  assert.equal(lightImage.url, 'https://cdn.example.test/light.jpg');
  assert.equal(lightImage.backgroundEnabled, true);
  assert.equal(service.backgroundImageVariants?.dark?.url, 'https://cdn.example.test/dark.jpg');
});

test('removed service image state survives draft/published JSON round-trips', () => {
  const variants = removeWebsiteServiceImageVariant(service.backgroundImageVariants, 'light');
  const draft = { ...service, backgroundImageVariants: variants };
  const reloaded = JSON.parse(JSON.stringify(draft)) as WebsiteService;
  const publishedSnapshot = JSON.parse(JSON.stringify(reloaded)) as WebsiteService;

  assert.equal(publishedSnapshot.backgroundImageVariants?.light?.backgroundImageRemoved, true);
  assert.equal(resolveWebsiteServiceImage(publishedSnapshot, 'light').url, '');
  assert.equal(resolveWebsiteServiceImage(publishedSnapshot, 'dark').url, 'https://cdn.example.test/dark.jpg');
});

test('legacy services continue resolving inherited images when no removal marker exists', () => {
  const legacyService = {
    ...service,
    backgroundImageVariants: {
      light: { url: '' },
    },
  };
  assert.equal(resolveWebsiteServiceImage(legacyService, 'light').url, service.backgroundImageUrl);
});
