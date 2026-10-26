export interface BlogSeoPermission {
  section: 'blogs';
  action: 'view' | 'edit';
}

export function blogSeoAdminPermission(pathName: string, method: string): BlogSeoPermission | undefined {
  if (pathName === '/blogs/seo-health' && method === 'GET') {
    return { section: 'blogs', action: 'view' };
  }
  if (pathName === '/blogs/seo-health/scan' && method === 'POST') {
    return { section: 'blogs', action: 'edit' };
  }
  return undefined;
}
