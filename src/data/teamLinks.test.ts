import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchTeam } from './teamData';
import { normalizeTeamUrl, teamUrlKind } from './teamLinks';

test('trims URLs and adds HTTPS to recognizable domain-only URLs', () => {
  assert.equal(normalizeTeamUrl('  linkedin.com/in/example?trk=public  '), 'https://linkedin.com/in/example?trk=public');
  assert.equal(normalizeTeamUrl('portfolio.example:8080/work'), 'https://portfolio.example:8080/work');
  assert.equal(normalizeTeamUrl('  https://portfolio.example/work?ref=team  '), 'https://portfolio.example/work?ref=team');
  assert.equal(normalizeTeamUrl(''), '');
  assert.equal(normalizeTeamUrl('   '), '');
});

test('preserves valid HTTP and HTTPS destinations', () => {
  assert.equal(normalizeTeamUrl('http://portfolio.example/profile?view=full'), 'http://portfolio.example/profile?view=full');
  assert.equal(normalizeTeamUrl('https://www.linkedin.com/in/example/'), 'https://www.linkedin.com/in/example/');
});

test('rejects unsafe schemes, credentials, malformed URLs, and non-domain bare values', () => {
  assert.equal(normalizeTeamUrl('javascript:alert(1)'), null);
  assert.equal(normalizeTeamUrl('data:text/html,example'), null);
  assert.equal(normalizeTeamUrl('https://user:pass@example.com'), null);
  assert.equal(normalizeTeamUrl('https://exa mple.com'), null);
  assert.equal(normalizeTeamUrl('http:example.com'), null);
  assert.equal(normalizeTeamUrl('linkedin'), null);
  assert.equal(normalizeTeamUrl(`https://${'a'.repeat(296)}.com`), null);
});

test('classifies only LinkedIn domains as LinkedIn', () => {
  assert.equal(teamUrlKind('https://www.linkedin.com/in/example'), 'linkedin');
  assert.equal(teamUrlKind('https://linkedin.com/in/example'), 'linkedin');
  assert.equal(teamUrlKind('https://notlinkedin.com/in/example'), 'web');
  assert.equal(teamUrlKind('https://portfolio.example/work'), 'web');
  assert.equal(teamUrlKind('javascript:alert(1)'), 'none');
});

test('respects an empty live team response instead of showing the bundled seed', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ members: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.deepEqual(await fetchTeam(), []);
});
