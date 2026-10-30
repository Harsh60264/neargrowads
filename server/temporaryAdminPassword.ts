import { randomInt } from 'node:crypto';

export const TEMPORARY_ADMIN_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;

const passwordGroups = [
  'abcdefghjkmnpqrstuvwxyz',
  'ABCDEFGHJKMNPQRSTUVWXYZ',
  '23456789',
  '!@#$%^&*-_=+',
];
const passwordCharacters = passwordGroups.join('');

export function generateTemporaryAdminPassword(length = 32): string {
  if (!Number.isSafeInteger(length) || length < 16 || length > 128) {
    throw new RangeError('Temporary administrator passwords must be 16 to 128 characters long.');
  }
  const characters = passwordGroups.map((group) => group[randomInt(group.length)]);
  while (characters.length < length) characters.push(passwordCharacters[randomInt(passwordCharacters.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join('');
}

export function temporaryPasswordExpiresAt(now = Date.now()): string {
  return new Date(now + TEMPORARY_ADMIN_PASSWORD_TTL_MS).toISOString();
}

export function isTemporaryPasswordExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry <= now;
}

export function adminCmsAccessAllowed(identity: {
  status: string;
  archivedAt?: string | null;
  mustChangePassword?: boolean;
}): boolean {
  return identity.status === 'active' && !identity.archivedAt && identity.mustChangePassword !== true;
}

export interface TemporaryAdminEmail {
  email: string;
  username: string;
  role: 'owner' | 'super_admin' | 'custom_admin';
  password: string;
  signInUrl: string;
  expiresAt: string;
}

export function buildTemporaryAdminEmail(input: TemporaryAdminEmail): { subject: string; html: string; text: string } {
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
  const roleLabel = input.role === 'owner' ? 'Co-Owner' : input.role === 'super_admin' ? 'Super Admin' : 'Custom Admin';
  const expiryLabel = new Date(input.expiresAt).toUTCString();
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f3f6f2;font-family:Arial,Helvetica,sans-serif;color:#17231b">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #dce5dc;border-radius:16px">
      <tr><td style="padding:24px 32px;background:#173c26;color:#fff;font-size:20px;font-weight:bold">NearGrow Ads</td></tr>
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 16px;color:#173c26;font-size:24px">Your CMS administrator account</h1>
        <p>You have been invited to NearGrow Ads CMS. Verify your email using the separate verification message before signing in.</p>
        <p><strong>Username:</strong> ${escapeHtml(input.username)}<br>
        <strong>Email:</strong> ${escapeHtml(input.email)}<br>
        <strong>Role:</strong> ${escapeHtml(roleLabel)}</p>
        <p><strong>Temporary password:</strong><br>
        <code style="display:inline-block;padding:12px;background:#eef3ed;border-radius:6px;font-size:16px;word-break:break-all">${escapeHtml(input.password)}</code></p>
        <p style="color:#8b2f16"><strong>Security warning:</strong> This password is sent by email and must be treated as exposed. It expires at ${escapeHtml(expiryLabel)} and can only be used to sign in and replace itself. Change it immediately; never forward or reuse it.</p>
        <p style="text-align:center;margin:28px 0"><a href="${escapeHtml(input.signInUrl)}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#286d3b;color:#fff;text-decoration:none;font-weight:bold">Sign in to NearGrow Ads CMS</a></p>
        <p>Changing this password is mandatory at first login. CMS sections remain unavailable until you set your own password.</p>
        <p style="margin-top:28px;font-size:14px">Regards,<br><strong>NearGrow Ads Team</strong><br><a href="https://www.neargrowads.com" style="color:#286d3b">www.neargrowads.com</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const text = [
    'NearGrow Ads CMS administrator onboarding',
    `Username: ${input.username}`,
    `Email: ${input.email}`,
    `Role: ${roleLabel}`,
    `Temporary password: ${input.password}`,
    `Secure sign-in: ${input.signInUrl}`,
    `Expires: ${expiryLabel}`,
    'This email-delivered password is exposed. It is valid for 24 hours and must be changed immediately at first sign-in.',
    'CMS access is blocked until you replace it with your own password.',
    'Verify your email using the separate Supabase verification message before signing in.',
  ].join('\n');
  return { subject: 'Your NearGrow Ads CMS temporary password', html, text };
}

export async function sendTemporaryAdminPasswordEmail(
  input: TemporaryAdminEmail,
  apiKey: string,
  from: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!apiKey || !from || /[\r\n]/.test(from)) throw new Error('Temporary administrator email delivery is not configured.');
  const message = buildTemporaryAdminEmail(input);
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [input.email], ...message }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Temporary administrator email provider returned ${response.status}.`);
}
