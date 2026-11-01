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
