import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_TEAM_PHOTO_SETTINGS,
  getTeamPhotoImageStyle,
  normalizeTeamPhotoSettings,
  validateTeamPhotoSettings,
} from './teamPhotoAdjustments';

const adminSource = readFileSync(new URL('../components/admin/AdminTeamManager.tsx', import.meta.url), 'utf8');
const controlsSource = readFileSync(new URL('../components/admin/TeamPhotoAdjustmentControls.tsx', import.meta.url), 'utf8');
const publicSource = readFileSync(new URL('../components/about/LeadershipTeamSection.tsx', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');

test('legacy Core Team members default to complete-photo contain framing and blurred backdrop', () => {
  assert.deepEqual(normalizeTeamPhotoSettings(), DEFAULT_TEAM_PHOTO_SETTINGS);
  assert.deepEqual(normalizeTeamPhotoSettings(undefined), DEFAULT_TEAM_PHOTO_SETTINGS);
  assert.deepEqual(getTeamPhotoImageStyle(undefined), {
    objectFit: 'contain',
    objectPosition: '50% 50%',
    transform: 'scale(1)',
    transformOrigin: '50% 50%',
  });
});

test('normalizes safe zoom and position bounds without allowing contain zoom to crop', () => {
  assert.deepEqual(normalizeTeamPhotoSettings({
    fit: 'contain',
    zoom: 180,
    positionX: -10,
    positionY: 120,
    background: 'solid',
  }), {
    fit: 'contain',
    zoom: 100,
    positionX: 0,
    positionY: 100,
    background: 'solid',
  });
  assert.equal(normalizeTeamPhotoSettings({ fit: 'cover', zoom: 180 }).zoom, 180);
});

test('validates optional saved image settings and rejects malformed or unsafe values', () => {
  assert.deepEqual(validateTeamPhotoSettings(undefined), { valid: true });
  assert.deepEqual(validateTeamPhotoSettings({
    fit: 'cover',
    zoom: 150,
    positionX: 20,
    positionY: 70,
    background: 'blurred',
  }), {
    valid: true,
    value: { fit: 'cover', zoom: 150, positionX: 20, positionY: 70, background: 'blurred' },
  });
  assert.deepEqual(validateTeamPhotoSettings(null), { valid: false });
  assert.deepEqual(validateTeamPhotoSettings({ fit: 'stretch' }), { valid: false });
  assert.deepEqual(validateTeamPhotoSettings({ zoom: Number.NaN }), { valid: false });
  assert.deepEqual(validateTeamPhotoSettings({ positionX: 101 }), { valid: false });
  assert.deepEqual(validateTeamPhotoSettings({ background: 'image-url' }), { valid: false });
  assert.deepEqual(validateTeamPhotoSettings({ unexpected: true }), { valid: false });
  assert.deepEqual(validateTeamPhotoSettings({ fit: 'contain', zoom: 101 }), { valid: false });
  assert.deepEqual(validateTeamPhotoSettings({ fit: 'cover', zoom: 99 }), { valid: false });
});

test('serializes independent member settings through repeated saves without shared mutation', () => {
  const alice = {
    id: 'alice',
    group: 'core' as const,
    photoSettings: { ...normalizeTeamPhotoSettings(), fit: 'cover' as const, zoom: 150, positionX: 25 },
  };
  const bob = {
    id: 'bob',
    group: 'core' as const,
    photoSettings: normalizeTeamPhotoSettings({ background: 'solid', positionY: 70 }),
  };
  const saveLoadSave = (members: typeof alice[] | (typeof alice | typeof bob)[]) =>
    JSON.parse(JSON.stringify(members)) as Array<typeof alice | typeof bob>;
  const firstSave = saveLoadSave([alice, bob]);
  const secondSave = saveLoadSave(firstSave);

  assert.deepEqual(secondSave, [alice, bob]);
  assert.notDeepEqual(secondSave[0].photoSettings, secondSave[1].photoSettings);
});

test('position and zoom updates map directly to non-distorting image styles', () => {
  assert.deepEqual(getTeamPhotoImageStyle({
    fit: 'cover',
    zoom: 125,
    positionX: 30,
    positionY: 65,
  }), {
    objectFit: 'cover',
    objectPosition: '30% 65%',
    transform: 'scale(1.25)',
    transformOrigin: '30% 65%',
  });
});

test('Admin controls are Core-only, live-update the selected member and use the revision-protected team save', () => {
  assert.match(adminSource, /selected\.group === 'core' && \([\s\S]*?<TeamPhotoAdjustmentControls/);
  assert.match(adminSource, /onChange=\{\(photoSettings\) => patch\(selected\.id, \{ photoSettings \}\)\}/);
  assert.match(adminSource, /'If-Match': revisionRef\.current/);
  assert.match(adminSource, /1200 × 1500 px \(minimum 800 × 1000 px\)/);
  assert.match(adminSource, /maximum 15 MB/);
  assert.match(controlsSource, /aria-label="Core Team image fit"/);
  assert.match(controlsSource, /aria-label="Core Team image zoom"/);
  assert.match(controlsSource, /aria-label="Core Team horizontal image position"/);
  assert.match(controlsSource, /aria-label="Core Team vertical image position"/);
  assert.match(controlsSource, /aria-label="Core Team image background"/);
  assert.match(controlsSource, /onChange\(\{ \.\.\.DEFAULT_TEAM_PHOTO_SETTINGS \}\)/);
  assert.match(controlsSource, /style=\{imageStyle\}/);
  assert.match(controlsSource, /aspect-\[5\/4\][\s\S]*max-sm:aspect-\[7\/9\]/);
  assert.match(controlsSource, /bg-gradient-to-t from-\[#071426\]/);
  assert.match(controlsSource, /Cover mode is the only setting that intentionally crops it/);
});

test('settings are validated, persisted in the existing Team document and rendered only on Core Team photos', () => {
  assert.match(serverSource, /validateTeamPhotoSettings\(m\.photoSettings\)/);
  assert.match(serverSource, /m\.group !== 'core'/);
  assert.match(serverSource, /\.\.\.\(m\.group === 'core' && photoSettings\.value \? \{ photoSettings: photoSettings\.value \} : \{\}\)/);
  assert.match(serverSource, /teamContentRevision\(members\)/);
  assert.match(publicSource, /photoStyle = photoSettings \? getTeamPhotoImageStyle\(photoSettings\) : undefined/);
  assert.match(publicSource, /decorativeBackdrop\s*\n\s*\/>/);
  assert.match(publicSource, /photoSettings\?\.background === 'blurred'/);
});
