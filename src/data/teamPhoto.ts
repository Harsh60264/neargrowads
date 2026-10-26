const TEAM_UPLOAD_PATH = /^\/uploads\/team\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp)$/i;

export function isSupportedTeamPhotoReference(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  if (value === '' || TEAM_UPLOAD_PATH.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
