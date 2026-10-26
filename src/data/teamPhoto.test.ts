import assert from 'node:assert/strict';
import test from 'node:test';
import { isSupportedTeamPhotoReference } from './teamPhoto';

test('allows an empty photo reference for profiles without a photo', () => {
  assert.equal(isSupportedTeamPhotoReference(''), true);
});

test('allows generated first-party team upload references and JPEG aliases', () => {
  assert.equal(isSupportedTeamPhotoReference('/uploads/team/2d90a904-5da2-4d9a-a615-c4f22cac2a0b.png'), true);
  assert.equal(isSupportedTeamPhotoReference('/uploads/team/2d90a904-5da2-4d9a-a615-c4f22cac2a0b.jpg'), true);
  assert.equal(isSupportedTeamPhotoReference('/uploads/team/2d90a904-5da2-4d9a-a615-c4f22cac2a0b.jpeg'), true);
  assert.equal(isSupportedTeamPhotoReference('/uploads/team/2d90a904-5da2-4d9a-a615-c4f22cac2a0b.webp'), true);
});

test('allows safe HTTPS photo URLs but rejects temporary and unsupported references', () => {
  assert.equal(isSupportedTeamPhotoReference('https://cdn.example.com/team/photo.webp'), true);
  assert.equal(isSupportedTeamPhotoReference('https://user:pass@cdn.example.com/photo.jpg'), false);
  assert.equal(isSupportedTeamPhotoReference('blob:https://example.com/photo'), false);
  assert.equal(isSupportedTeamPhotoReference('data:image/png;base64,AAAA'), false);
  assert.equal(isSupportedTeamPhotoReference('file:///C:/photo.jpg'), false);
  assert.equal(isSupportedTeamPhotoReference('uploads/team/photo.jpg'), false);
  assert.equal(isSupportedTeamPhotoReference('/uploads/team/not-a-uuid.jpg'), false);
  assert.equal(isSupportedTeamPhotoReference('https://example.com/' + 'a'.repeat(300)), false);
});
