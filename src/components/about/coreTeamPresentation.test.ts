import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const section = readFileSync(new URL('./LeadershipTeamSection.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

test('public Core Team cards omit visible serial numbers', () => {
  assert.doesNotMatch(section, /ng-core-(?:compact-index|detail-index)/);
  assert.doesNotMatch(styles, /ng-core-(?:compact-index|detail-index)/);
});

test('public Core Team cards retain names, roles, profile links, and accessible slide position', () => {
  assert.match(section, /ng-core-compact-name/);
  assert.match(section, /ng-core-compact-role/);
  assert.match(section, /ng-core-copy">[\s\S]*?<h4>\{member\.name\}<\/h4>[\s\S]*?<p className="ng-core-role">\{member\.role\}<\/p>/);
  assert.match(section, /aria-label=\{`\$\{index \+ 1\} of \$\{core\.length\}: \$\{member\.name\}, \$\{member\.role\}`\}/);
  assert.match(section, /<SocialLink member=\{member\} variant="icon"/);
});

test('expanded Core Team photos preserve their natural framing without image zoom', () => {
  const photoStyles = styles.match(/\.ng-core-photo\s*\{([^}]*)\}/)?.[1] ?? '';
  const backdropStyles = styles.match(/\.ng-core-photo-backdrop\s*\{([^}]*)\}/)?.[1] ?? '';
  const frameStyles = styles.match(/\.ng-core-photo-frame\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(section, /className="ng-core-photo"/);
  assert.match(section, /className="ng-core-carousel-photo"[\s\S]*?decorativeBackdrop/);
  assert.match(section, /className="ng-core-photo"[\s\S]*?decorativeBackdrop/);
  assert.equal((section.match(/src=\{member\.imageUrl\}/g) ?? []).length, 2);
  assert.match(section, /decorativeBackdrop \? '' : 'object-cover'/);
  assert.match(photoStyles, /object-fit:\s*contain/);
  assert.match(photoStyles, /object-position:\s*center/);
  assert.doesNotMatch(photoStyles, /transform:\s*scale/);
  assert.match(backdropStyles, /object-fit:\s*cover/);
  assert.match(backdropStyles, /filter:\s*blur\([^)]*\)\s*brightness\(/);
  assert.match(frameStyles, /overflow:\s*hidden/);
  assert.match(section, /src=\{member\.imageUrl\}[\s\S]*?alt=""/);
  assert.match(section, /alt=""[\s\S]*?onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(styles, /html\[data-theme='light'\][\s\S]*?\.ng-core-photo-frame\s*\{\s*background-color:\s*#123D2B/s);
  assert.match(styles, /@media\s*\(max-width:\s*1023px\)[\s\S]*?\.ng-core-accordion-item\.is-active \.ng-core-photo-frame\s*\{[^}]*width:\s*86px;[^}]*height:\s*108px/s);
  assert.match(styles, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.ng-core-accordion-item\.is-active \.ng-core-photo-frame\s*\{[^}]*width:\s*72px;[^}]*height:\s*94px/s);
});

test('mobile Core Team carousel contains square and portrait photos without cropping', () => {
  const carouselPhotoStyles = styles.match(/\.ng-core-carousel-photo\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(section, /className="ng-core-carousel-photo"/);
  assert.match(carouselPhotoStyles, /object-fit:\s*contain/);
  assert.match(carouselPhotoStyles, /object-position:\s*center/);
  assert.match(styles, /@media\s*\(max-width:\s*767px\)[\s\S]*?\.ng-core-carousel-card\s*\{[^}]*height:\s*360px/s);
  assert.match(styles, /@media\s*\(max-width:\s*1023px\)[\s\S]*?\.ng-core-photo\s*\{[^}]*width:\s*86px;[^}]*height:\s*108px/s);
  assert.match(styles, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.ng-core-photo\s*\{[^}]*width:\s*72px;[^}]*height:\s*94px/s);
});

test('Core Team photos keep the branded fallback when an upload is missing or fails', () => {
  const fallbackStart = section.indexOf('if (member.imageUrl && !failed)');
  const fallbackEnd = section.indexOf('\n}\n\nfunction SocialLink', fallbackStart);
  const avatarImplementation = section.slice(fallbackStart, fallbackEnd);

  assert.ok(fallbackStart >= 0);
  assert.match(avatarImplementation, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(avatarImplementation, /role="img"/);
  assert.match(avatarImplementation, /initials\(member\.name\)/);
});
