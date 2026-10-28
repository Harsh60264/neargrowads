export interface AdminAuthCallback {
  accessToken?: string;
  authorizationCode?: string;
  codeVerifier?: string;
  tokenHash?: string;
  tokenType?: string;
  error?: string;
}

const invalidLinkMessage = 'This verification link is missing, invalid, or expired. Ask the Primary Owner to resend setup.';

export function readAdminAuthCallback(
  search: string,
  hash: string,
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>,
): AdminAuthCallback {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  if (query.has('error') || query.has('error_code') || fragment.has('error') || fragment.has('error_code')) {
    return { error: invalidLinkMessage };
  }

  const accessToken = query.get('access_token') || fragment.get('access_token');
  if (accessToken) return { accessToken };

  const tokenHash = query.get('token_hash') || query.get('token') || fragment.get('token_hash') || fragment.get('token');
  if (tokenHash) {
    const tokenType = query.get('type') || fragment.get('type') || '';
    if (['signup', 'invite', 'recovery'].includes(tokenType)) return { tokenHash, tokenType };
    return { error: invalidLinkMessage };
  }

  const authorizationCode = query.get('code');
  if (!authorizationCode) return {};

  const verifierEntries: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith('sb-') || !key.endsWith('-auth-token-code-verifier')) continue;
    const verifier = storage.getItem(key);
    if (verifier && /^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) verifierEntries.push(verifier);
  }
  const distinctVerifiers = [...new Set(verifierEntries)];
  return distinctVerifiers.length === 1
    ? { authorizationCode, codeVerifier: distinctVerifiers[0] }
    : { error: invalidLinkMessage };
}
