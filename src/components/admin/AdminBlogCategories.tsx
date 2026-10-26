import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  FolderOpen,
  Globe,
  Headset,
  Inbox,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Plus,
  Save,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { NearGrowLogo } from '../brand/NearGrowLogo';
import type { BlogCategory } from '../../data/blogCategories';

interface CategoryRecord extends BlogCategory {
  articleCount: number;
}

interface Props {
  onNavigate: (path: string) => void;
  embedded?: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canCreateBlog?: boolean;
}

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function readJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new Error(`The categories API returned a non-JSON response (${response.status}). Start the NearGrow Express server with "npm run dev".`);
  }
}

export function AdminBlogCategories({ onNavigate, embedded = false, canCreate = true, canEdit = true, canDelete = true, canCreateBlog = true }: Props) {
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [manualSlug, setManualSlug] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadCategories = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/blog-categories', { credentials: 'same-origin' });
      const data = await readJson<{ categories: CategoryRecord[]; message?: string }>(response);
      if (!response.ok) throw new Error(data.message || `Could not load categories (${response.status}).`);
      if (!Array.isArray(data.categories)) throw new Error('The categories API returned an invalid category list.');
      setCategories(data.categories);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load categories.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadCategories(); }, []);

  const filteredCategories = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return categories.filter((category) =>
      !normalized || `${category.name} ${category.slug} ${category.description}`.toLowerCase().includes(normalized),
    );
  }, [categories, query]);

  const resetForm = () => {
    setName('');
    setSlug('');
    setDescription('');
    setEditingSlug(null);
    setManualSlug(false);
  };

  const editCategory = (category: CategoryRecord) => {
    setName(category.name);
    setSlug(category.slug);
    setDescription(category.description);
    setEditingSlug(category.slug);
    setManualSlug(true);
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    const category = { name: name.trim(), slug: slugify(slug), description: description.trim() };
    try {
      const response = await fetch(
        editingSlug ? `/api/admin/blog-categories/${encodeURIComponent(editingSlug)}` : '/api/admin/blog-categories',
        {
          method: editingSlug ? 'PUT' : 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(category),
        },
      );
      const data = await readJson<{ categories?: CategoryRecord[]; message?: string }>(response);
      if (!response.ok) throw new Error(data.message || `Could not save category (${response.status}).`);
      if (!data.categories) throw new Error('The categories API did not return the updated category list.');
      setCategories(data.categories);
      setNotice(editingSlug ? 'Category updated successfully.' : 'Category added successfully.');
      resetForm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save category.');
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (category: CategoryRecord) => {
    if (!window.confirm(`Delete "${category.name}"? Categories assigned to articles cannot be deleted.`)) return;
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/blog-categories/${encodeURIComponent(category.slug)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await readJson<{ categories?: CategoryRecord[]; message?: string }>(response);
      if (!response.ok) throw new Error(data.message || `Could not delete category (${response.status}).`);
      if (!data.categories) throw new Error('The categories API did not return the updated category list.');
      setCategories(data.categories);
      if (editingSlug === category.slug) resetForm();
      setNotice('Category deleted.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete category.');
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    setError('');
    try {
      const response = await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
      const data = await readJson<{ message?: string }>(response);
      if (!response.ok) throw new Error(data.message || `Could not sign out (${response.status}).`);
      onNavigate('/admin/login');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign out.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <main className={`admin-portal admin-blog-categories ${embedded ? '' : 'min-h-screen'}`} data-admin-theme="dark">
      <div className={embedded ? '' : 'min-h-screen lg:flex'}>
        {!embedded && <aside className="flex shrink-0 flex-col border-b border-[#304135] bg-[#14251A] px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-[212px] lg:border-b-0 lg:border-r">
          <button type="button" onClick={() => onNavigate('/admin')} aria-label="NearGrow Ads dashboard" className="px-2 py-2 text-left">
            <NearGrowLogo variant="dark" size="sm" />
          </button>
          <p className="mt-8 px-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[#91A899]">CMS Management</p>
          <nav aria-label="Admin navigation" className="mt-3 flex gap-1.5 overflow-x-auto lg:flex-col">
            <SideNav icon={LayoutDashboard} label="Dashboard" onClick={() => onNavigate('/admin')} />
            <SideNav icon={Inbox} label="Leads Database" onClick={() => onNavigate('/admin/leads')} />
            <SideNav icon={ShoppingBag} label="Service Store" onClick={() => onNavigate('/admin')} />
            <SideNav icon={Settings} label="Page Content" onClick={() => onNavigate('/admin/content')} />
            <SideNav icon={BookOpen} label="Blog Management" onClick={() => onNavigate('/admin/blog')} />
            <SideNav icon={UsersRound} label="Team & Mentors" onClick={() => onNavigate('/admin/team')} />
            <SideNav icon={Tag} label="Categories" active onClick={() => onNavigate('/admin/categories')} />
            <SideNav icon={Settings} label="Settings" onClick={() => onNavigate('/admin/settings')} />
          </nav>
          <div className="mt-auto hidden rounded-2xl border border-[#1D3A2A] bg-[#0A1919] p-3 lg:block">
            <p className="flex items-center gap-2 text-[11px] font-bold text-white"><Headset className="h-4 w-4 text-[#6CC558]" /> Support</p>
            <p className="mt-2 text-[10px] text-[#8B9AAF]">Need technical assistance?</p>
            <a href="mailto:support@neargrowads.com" className="mt-3 block rounded-xl bg-[#286D3B] px-3 py-2 text-center text-[10px] font-bold text-white">Contact Team</a>
          </div>
          <button type="button" onClick={() => onNavigate('/admin')} className="mt-4 flex items-center gap-2 px-2 text-[10px] font-medium text-[#7B8BA1] hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard</button>
        </aside>}

        <div className="min-w-0 flex-1">
          {!embedded && <header className="flex min-h-12 items-center justify-between border-b border-[#304135] px-5 py-3 text-[10px] text-[#A9B8AD] sm:px-7">
            <p>NearGrow Ads CMS <span className="mx-2 text-[#718077]">/</span> <strong className="text-[#ECF3EE]">Blog Categories</strong></p>
            <div className="flex items-center gap-3">
              <span className="hidden rounded-full border border-[#304135] bg-[#19241D] px-3 py-1 text-[10px] font-semibold text-[#84D095] sm:inline">Admin workspace</span>
              <button type="button" onClick={() => void signOut()} disabled={signingOut} className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/[0.06] px-3 py-1.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/15 disabled:opacity-50">
                {signingOut ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />} Sign Out
              </button>
            </div>
          </header>}
          <div className={`mx-auto max-w-[1500px] ${embedded ? '' : 'px-4 py-6 sm:px-6 lg:px-7'}`}>
            <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#304135] bg-[#19241D] px-5 py-5 sm:px-6">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">Blog Categories <span className="ml-2 inline-flex rounded-full border border-[#244333] bg-[#14281F] px-2.5 py-1 align-middle text-[9px] font-bold uppercase tracking-wide text-[#74C65C]">{categories.length} taxonomies active</span></h1>
                <p className="mt-1 text-xs text-[#8DA0B9]">Manage article classifications, SEO topic clusters, and content taxonomies.</p>
              </div>
              {canCreateBlog && <button type="button" onClick={() => onNavigate('/admin/blog/new')} className="admin-category-primary inline-flex h-10 items-center gap-2 rounded-xl bg-[#286D3B] px-4 text-xs font-bold text-white transition hover:bg-[#205C31]"><Plus className="h-4 w-4" /> Write New Post</button>}
            </header>

            {error && <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{error}</p>}
            {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200"><Check className="mr-2 inline h-4 w-4" />{notice}</p>}

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <Stat icon={Tag} label="Total categories" value={categories.length.toString()} detail="Active content groupings" color="green" />
              <Stat icon={Globe} label="SEO URL slugs" value={categories.length ? `${Math.round(categories.filter((category) => Boolean(category.slug)).length / categories.length * 100)}%` : '0%'} detail="Clean canonical paths" color="amber" />
              <Stat icon={ShieldCheck} label="System sync" value={loading ? 'Syncing' : error ? 'Needs attention' : 'Healthy'} detail={loading ? 'Loading category list' : error ? 'API connection needs review' : 'Relational integrity active'} color="blue" />
            </div>

            <div className={`mt-5 grid items-start gap-4 ${canCreate || canEdit ? 'xl:grid-cols-[305px_minmax(0,1fr)]' : 'xl:grid-cols-1'}`}>
              {(canCreate || canEdit) && <form onSubmit={(event) => void saveCategory(event)} className="admin-category-form rounded-2xl border border-[#304135] bg-[#19241D] p-5">
                <div className="mb-4 flex items-center justify-between border-b border-[#304135] pb-4">
                  <h2 className="flex items-center gap-2 text-sm font-bold">{editingSlug ? <Tag className="h-4 w-4 text-[#69C655]" /> : <Plus className="h-4 w-4 text-[#69C655]" />}{editingSlug ? 'Edit Category' : 'Add New Category'}</h2>
                  {editingSlug && <button type="button" onClick={resetForm} aria-label="Cancel edit" className="rounded-lg p-1 text-[#899AB0] hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>}
                </div>
                <label className="mb-4 block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wide text-[#8294AD]">Name *</span>
                  <input required disabled={editingSlug ? !canEdit : !canCreate} maxLength={80} value={name} onChange={(event) => {
                    const value = event.target.value;
                    setName(value);
                    if (!manualSlug) setSlug(slugify(value));
                  }} placeholder="e.g. Local SEO" className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3 py-3 text-xs text-white outline-none placeholder:text-[#718077] focus:border-[#55A66A] focus:ring-2 focus:ring-[#3EA259]/20" />
                </label>
                <label className="mb-4 block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wide text-[#8294AD]">Slug *</span>
                  <input required disabled={editingSlug ? !canEdit : !canCreate} maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={(event) => { setManualSlug(true); setSlug(slugify(event.target.value)); }} placeholder="e.g. local-seo" className="w-full rounded-xl border border-[#304135] bg-[#131D16] px-3 py-3 text-xs text-white outline-none placeholder:text-[#718077] focus:border-[#55A66A] focus:ring-2 focus:ring-[#3EA259]/20" />
                </label>
                <label className="mb-4 block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wide text-[#8294AD]">Description (optional)</span>
                  <textarea disabled={editingSlug ? !canEdit : !canCreate} maxLength={500} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Brief summary of topics covered under this taxonomy..." className="w-full resize-y rounded-xl border border-[#304135] bg-[#131D16] px-3 py-3 text-xs leading-5 text-white outline-none placeholder:text-[#718077] focus:border-[#55A66A] focus:ring-2 focus:ring-[#3EA259]/20" />
                </label>
                <button type="submit" disabled={saving || loading || (editingSlug ? !canEdit : !canCreate)} className="admin-category-primary inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#286D3B] text-xs font-bold text-white transition hover:bg-[#205C31] disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : editingSlug ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  {editingSlug ? 'Save Category' : 'Add Category'}
                </button>
              </form>}

              <section className="admin-category-table overflow-hidden rounded-2xl border border-[#304135] bg-[#131D16]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#304135] bg-[#19241D] px-4 py-4 sm:px-5">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#20382A] text-[#84D095]"><FolderOpen className="h-4 w-4" /></span>
                    <div><h2 className="text-xs font-bold">Existing Categories</h2><p className="mt-0.5 text-[10px] text-[#A9B8AD]">{categories.length} category entries found</p></div>
                  </div>
                  <label className="flex h-9 min-w-[190px] items-center gap-2 rounded-lg border border-[#304135] bg-[#131D16] px-3">
                    <Search className="h-3.5 w-3.5 shrink-0 text-[#A9B8AD]" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search categories..." aria-label="Search categories" className="min-w-0 flex-1 bg-transparent text-[10px] text-white outline-none placeholder:text-[#718077]" />
                  </label>
                </div>
                {loading ? (
                  <div className="grid min-h-44 place-items-center text-xs text-[#A9B8AD]"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading categories...</div>
                ) : filteredCategories.length === 0 ? (
                  <div className="grid min-h-44 place-items-center px-5 text-center text-xs text-[#A9B8AD]">{query ? 'No categories match your search.' : 'No categories yet. Add one to get started.'}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left">
                      <thead className="border-b border-[#304135] bg-[#111C16] text-[9px] font-bold uppercase tracking-[0.12em] text-[#A9B8AD]">
                        <tr><th className="px-4 py-3.5 sm:px-5">Category name</th><th className="px-3 py-3.5">Slug</th><th className="px-3 py-3.5 text-right">Actions</th></tr>
                      </thead>
                      <tbody className="divide-y divide-[#304135]">
                        {filteredCategories.map((category) => (
                          <tr key={category.slug} className="admin-category-row transition hover:bg-[#1C2B22]">
                            <td className="max-w-[430px] px-4 py-3.5 sm:px-5">
                              <p className="text-xs font-bold text-[#ECF3EE]">{category.name}</p>
                              <p className="mt-1 line-clamp-1 text-[9px] leading-4 text-[#A9B8AD]">{category.description || 'No category description.'}</p>
                            </td>
                            <td className="px-3 py-3.5"><span className="admin-category-slug rounded-md border border-[#304135] bg-[#202D24] px-2 py-1 text-[9px] text-[#B8C7BC]">{category.slug}</span>{category.articleCount > 0 && <span className="ml-2 whitespace-nowrap text-[9px] text-[#A9B8AD]">{category.articleCount} posts</span>}</td>
                            <td className="px-3 py-3.5">
                              <div className="flex justify-end gap-1.5">
                                {canEdit && <button type="button" onClick={() => editCategory(category)} title={`Edit ${category.name}`} className="grid h-8 w-8 place-items-center rounded-lg border border-[#304135] bg-[#131D16] text-[#B8C7BC] transition hover:border-[#55A66A]/50 hover:text-[#84D095]"><Settings className="h-3.5 w-3.5" /></button>}
                                {canDelete && <button type="button" onClick={() => void deleteCategory(category)} title={`Delete ${category.name}`} className="grid h-8 w-8 place-items-center rounded-lg border border-rose-500/20 bg-rose-500/[0.07] text-rose-300 transition hover:border-rose-400/50 hover:bg-rose-500/15"><Trash2 className="h-3.5 w-3.5" /></button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
            <footer className="py-5 text-center text-[9px] text-[#829084]">Blog categories are stored on the NearGrow Ads server and shared with the blog editor.</footer>
          </div>
        </div>
      </div>
    </main>
  );
}

function SideNav({ icon: Icon, label, active = false, onClick }: {
  icon: typeof Tag;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[10px] font-semibold transition lg:w-full ${active ? 'bg-[#3EA259] text-white shadow-[0_7px_20px_rgba(62,162,89,0.24)]' : 'text-[#B7C8BA] hover:bg-white/5 hover:text-white'}`}>
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${active ? 'bg-white/15' : 'bg-[#20362A]'}`}><Icon className="h-3.5 w-3.5" /></span>{label}
    </button>
  );
}

function Stat({ icon: Icon, label, value, detail, color }: {
  icon: typeof Tag;
  label: string;
  value: string;
  detail: string;
  color: 'green' | 'amber' | 'blue';
}) {
  const accent = color === 'green' ? 'text-[#70CA5C] bg-[#10241E]' : color === 'amber' ? 'text-[#E4AE43] bg-[#262319]' : 'text-[#84D095] bg-[#20382A]';
  return (
    <article className="rounded-2xl border border-[#304135] bg-[#19241D] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#A9B8AD]">{label}</p><span className={`grid h-8 w-8 place-items-center rounded-full ${accent}`}><Icon className="h-3.5 w-3.5" /></span></div>
      <p className="mt-2 text-2xl font-extrabold tracking-tight text-white">{value}</p>
      <p className={`mt-1 flex items-center gap-1 text-[9px] font-semibold ${accent.split(' ')[0]}`}><Check className="h-3 w-3" />{detail}</p>
    </article>
  );
}
