import { BLOG_POSTS, type BlogPost } from './blogData';

export interface ManagedBlogPost extends BlogPost {
  status: 'draft' | 'published';
  featuredImage?: string;
  updatedAt: string;
}

const STORE_KEY = 'neargrow-managed-blogs-v1';
const storageAvailable = () => typeof window !== 'undefined' && Boolean(window.localStorage);

const normalize = (posts: BlogPost[]): ManagedBlogPost[] => posts.map((post) => ({
  ...post,
  status: post.status || 'published',
  featuredImage: post.featuredImage || '',
  author: {
    name: typeof post.author?.name === 'string' ? post.author.name : '',
    role: typeof post.author?.role === 'string' ? post.author.role : '',
    imageUrl: post.author?.imageUrl || '',
    ...(post.author?.imageVariants ? { imageVariants: post.author.imageVariants } : {}),
  },
  updatedAt: post.updatedAt || post.publishedDate || new Date().toISOString(),
}));

export async function fetchBlogPosts(): Promise<ManagedBlogPost[]> {
  try {
    const response = await fetch('/api/blogs');
    if (response.ok) {
      const data = await response.json() as { posts: ManagedBlogPost[] };
      return normalize(data.posts);
    }
  } catch {
    // Allow the public blog to keep rendering from its bundled seed articles if offline.
  }
  return normalize(BLOG_POSTS);
}

export async function fetchAdminBlogPosts(): Promise<ManagedBlogPost[]> {
  try {
    const response = await fetch('/api/admin/blogs', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not load stored articles.');
    const data = await response.json() as { posts: ManagedBlogPost[] };
    return normalize(data.posts);
  } catch (error) {
    if (storageAvailable()) {
      try {
        const local = JSON.parse(window.localStorage.getItem(STORE_KEY) || '[]') as ManagedBlogPost[];
        return local;
      } catch {
        // Ignore corrupted local drafts and report the API error below.
      }
    }
    throw error;
  }
}

export function rememberAdminBlogPosts(posts: ManagedBlogPost[]) {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(posts));
  } catch {
    // This is only a same-browser fallback; server persistence remains the source of truth.
  }
}
