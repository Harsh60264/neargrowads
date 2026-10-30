export type SupabaseAuthRequester = (
  pathname: string,
  init?: RequestInit,
  accessToken?: string,
) => Promise<Response>;

export type SupabaseResponseReader = (response: Response) => Promise<unknown>;

export class SupabaseUserAccessTokenVerificationError extends Error {
  constructor() {
    super('The Supabase user access token could not be verified for this account.');
    this.name = 'SupabaseUserAccessTokenVerificationError';
  }
}

export async function revokeSupabaseRefreshTokensWithAccessToken(
  accessToken: string,
  expectedUserId: string,
  request: SupabaseAuthRequester,
  readResponse: SupabaseResponseReader,
): Promise<void> {
  if (accessToken.length > 10_000 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)) {
    throw new SupabaseUserAccessTokenVerificationError();
  }

  const verifiedUser = await readResponse(await request('user', { method: 'GET' }, accessToken));
  if (!verifiedUser || typeof verifiedUser !== 'object' || Array.isArray(verifiedUser) ||
    !('id' in verifiedUser) || verifiedUser.id !== expectedUserId) {
    throw new SupabaseUserAccessTokenVerificationError();
  }

  const response = await request('logout?scope=global', { method: 'POST' }, accessToken);
  await readResponse(response);
}
