import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowDown, ArrowUp, Copy, Eye, LoaderCircle, Plus, Save, Search, Trash2, Upload, X,
} from 'lucide-react';
import type { CaseStudy } from '../../data/caseStudiesData';
import type { PublicImageTheme } from '../../data/themeImages';
import { CaseStudyImage } from '../work/CaseStudyImage';
import { uploadAdminMedia } from './uploadAdminMedia';

type StudyStatus = 'draft' | 'published' | 'archived';
type Metric = { label: string; value: string; period: string; evidence: string };

type CaseStudyDraft = Omit<CaseStudy, 'id' | 'metrics' | 'status'> & {
  id?: string;
  metrics: Metric[];
  status: StudyStatus;
};

interface AdminCaseStudiesProps {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPublish: boolean;
  theme: PublicImageTheme;
}

const fieldClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-[#33453A] bg-[#101913] px-3.5 py-2.5 text-sm text-[#EAF1EB] outline-none placeholder:text-[#76867B] focus:border-[#67D8B7] focus:ring-2 focus:ring-[#67D8B7]/15';
const labelClass = 'block text-xs font-medium text-[#B8C7BC]';
const buttonClass = 'admin-case-study-primary inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#286D3B] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#347E49] disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass = 'admin-case-study-secondary inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#47594C] px-3 py-2 text-xs font-semibold text-[#DCE8DD] transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50';

const emptyDraft = (): CaseStudyDraft => ({
  slug: '',
  title: '',
  category: '',
  clientDescriptor: '',
  approvedClientName: '',
  timeframe: '',
  location: '',
  summary: '',
  challenge: '',
  strategy: '',
  deliverablesExecuted: [],
  resultsContext: '',
  metrics: [],
  toolsUsed: [],
  serviceSlug: '',
  testimonialQuote: { quote: '', author: '', role: '' },
  testimonialApproved: false,
  ctaLabel: 'View Service Model',
  ctaLink: '',
  featured: false,
  displayOrder: 0,
  status: 'draft',
  imageUrl: '',
  imageAlt: '',
  imagePositionX: 50,
  imagePositionY: 50,
  imageSize: 'cover',
  imagePlacement: 'top',
  imageOpacity: 18,
});

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({})) as { message?: string } & T;
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status}).`);
  return body;
}

function readDraft(study: CaseStudy): CaseStudyDraft {
  return {
    ...emptyDraft(),
    ...study,
    deliverablesExecuted: [...study.deliverablesExecuted],
    toolsUsed: [...study.toolsUsed],
    metrics: study.metrics.map((metric) => ({ ...metric, evidence: metric.evidence || study.resultsContext })),
    testimonialQuote: study.testimonialQuote || { quote: '', author: '', role: '' },
    imagePositionX: study.imagePositionX ?? 50,
    imagePositionY: study.imagePositionY ?? 50,
    imageSize: study.imageSize || 'cover',
    imagePlacement: study.imagePlacement || 'top',
    imageOpacity: study.imageOpacity ?? (study.imagePlacement === 'background-watermark' ? 18 : 100),
    status: study.status || 'published',
  };
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function notifyCaseStudyChange() {
  window.dispatchEvent(new Event('case-studies-updated'));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('neargrow-case-studies');
    channel.postMessage('updated');
    channel.close();
  }
}

export function AdminCaseStudies({ canCreate, canEdit, canDelete, canPublish, theme }: AdminCaseStudiesProps) {
  const backgroundOpacityInitialized = useRef(false);
  const [studies, setStudies] = useState<CaseStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StudyStatus>('all');
  const [editing, setEditing] = useState<CaseStudyDraft | null>(null);
  const [preview, setPreview] = useState<CaseStudy | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryNameDraft, setCategoryNameDraft] = useState('');

  const loadStudies = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ caseStudies: CaseStudy[] }>('/api/admin/case-studies');
      setStudies(result.caseStudies);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Case studies could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadStudies(); }, []);
  useEffect(() => {
    void api<{ categories: string[]; customCategories?: string[] }>('/api/admin/case-study-categories')
      .then((result) => {
        setCategories(result.categories);
        setCustomCategories(result.customCategories || []);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Case study categories could not be loaded.'));
  }, []);

  const saveCategory = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ category: string; categories: string[]; customCategories?: string[] }>('/api/admin/case-study-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: newCategory }),
      });
      setCategories(result.categories);
      setCustomCategories(result.customCategories || []);
      updateDraft('category', result.category);
      notifyCaseStudyChange();
      setNewCategory('');
      setAddingCategory(false);
      setNotice('Category saved and available for reuse.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The category could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const renameCategory = async (category: string) => {
    const newCategory = categoryNameDraft.trim().replace(/\s+/g, ' ');
    if (!newCategory) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ category: string; categories: string[]; customCategories?: string[] }>('/api/admin/case-study-categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, newCategory }),
      });
      setCategories(result.categories);
      setCustomCategories(result.customCategories || []);
      setEditing((current) => current &&
        normalizeCategoryName(current.category) === normalizeCategoryName(category)
        ? { ...current, category: result.category }
        : current);
      setEditingCategory(null);
      setCategoryNameDraft('');
      notifyCaseStudyChange();
      setNotice('Category renamed and assigned case studies updated.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The category could not be renamed.');
    } finally {
      setBusy(false);
    }
  };

  const removeCategory = async (category: string) => {
    if (!window.confirm(`Remove the unused category “${category}”? Categories assigned to a case study cannot be removed.`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ categories: string[]; customCategories?: string[] }>('/api/admin/case-study-categories', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      });
      setCategories(result.categories);
      setCustomCategories(result.customCategories || []);
      setEditing((current) => current &&
        normalizeCategoryName(current.category) === normalizeCategoryName(category)
        ? { ...current, category: '' }
        : current);
      notifyCaseStudyChange();
      setNotice('Unused category removed.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The category could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  const orderedStudies = useMemo(() => [...studies]
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.title.localeCompare(b.title)), [studies]);
  const filteredStudies = useMemo(() => orderedStudies
    .filter((study) => statusFilter === 'all' || study.status === statusFilter)
    .filter((study) => `${study.title} ${study.category} ${study.clientDescriptor} ${study.slug}`
      .toLowerCase().includes(search.trim().toLowerCase())), [orderedStudies, statusFilter, search]);

  const updateDraft = <K extends keyof CaseStudyDraft>(key: K, value: CaseStudyDraft[K]) => {
    setEditing((current) => current ? { ...current, [key]: value } : current);
  };

  const save = async (status: StudyStatus) => {
    if (!editing) return;
    const category = categories.find((savedCategory) =>
      normalizeCategoryName(savedCategory) === normalizeCategoryName(editing.category));
    if (!category) {
      setError('Choose a saved category or add this custom category before saving the case study.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = { ...editing, category, status };
      const result = await api<{ caseStudy: CaseStudy }>(
        editing.id ? `/api/admin/case-studies/${encodeURIComponent(editing.id)}` : '/api/admin/case-studies',
        {
          method: editing.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      setStudies((current) => editing.id
        ? current.map((study) => study.id === result.caseStudy.id ? result.caseStudy : study)
        : [...current, result.caseStudy]);
      if (status === 'published') notifyCaseStudyChange();
      setEditing(null);
      setNotice(status === 'published'
        ? 'Case study published.'
        : result.caseStudy.status === 'published'
          ? 'Draft saved. The current published version remains live until you publish these changes.'
          : 'Draft saved.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The case study could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (study: CaseStudy, status: StudyStatus) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ caseStudy: CaseStudy }>(`/api/admin/case-studies/${encodeURIComponent(study.id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setStudies((current) => current.map((item) => item.id === study.id ? result.caseStudy : item));
      notifyCaseStudyChange();
      setNotice(status === 'published' ? 'Case study published.' : status === 'archived' ? 'Case study archived.' : 'Case study unpublished.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The case study status could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  const duplicate = (study: CaseStudy) => {
    const copy = readDraft(study);
    const title = `${study.title} (Copy)`;
    copy.id = undefined;
    copy.title = title;
    copy.slug = `${study.slug}-copy`;
    copy.status = 'draft';
    copy.featured = false;
    copy.displayOrder = Math.max(-1, ...studies.map((item) => item.displayOrder ?? 0)) + 1;
    backgroundOpacityInitialized.current = copy.imagePlacement === 'background-cover' || copy.imagePlacement === 'background-watermark';
    setEditing(copy);
  };

  const remove = async (study: CaseStudy, archive: boolean) => {
    const action = archive ? 'archive' : 'permanently delete';
    if (!window.confirm(`Are you sure you want to ${action} “${study.title}”?`)) return;
    if (archive) {
      await changeStatus(study, 'archived');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/case-studies/${encodeURIComponent(study.id)}`, { method: 'DELETE' });
      setStudies((current) => current.filter((item) => item.id !== study.id));
      notifyCaseStudyChange();
      setNotice('Case study deleted.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The case study could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (study: CaseStudy, direction: -1 | 1) => {
    const reordered = [...orderedStudies];
    const index = reordered.findIndex((item) => item.id === study.id);
    const target = index + direction;
    if (target < 0 || target >= reordered.length) return;
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const ids = reordered.map((study) => study.id);
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/case-studies/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      setStudies(reordered.map((item, order) => ({ ...item, displayOrder: order })));
      setNotice('Case study order updated.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The case studies could not be reordered.');
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !editing) return;
    setBusy(true);
    setError('');
    try {
      const result = await uploadAdminMedia({ purpose: 'case-study', file, fileName: file.name });
      updateDraft('imageUrl', result.url);
      setNotice('Transparent image uploaded.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The image upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const changeTitle = (title: string) => {
    setEditing((current) => current ? {
      ...current,
      title,
      slug: current.id || current.slug ? current.slug : slugify(title),
    } : current);
  };

  return (
    <div className="admin-case-studies mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#304135] pb-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#74C65C]">Public Work page</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#ECF3EE]">Case Studies</h1>
          <p className="mt-2 text-sm text-[#A9B8AD]">Manage published client outcomes, evidence and transparent imagery.</p>
        </div>
        {canCreate && !editing && <button type="button" className={buttonClass} onClick={() => {
          backgroundOpacityInitialized.current = false;
          setEditing({
            ...emptyDraft(),
            displayOrder: Math.max(-1, ...studies.map((study) => study.displayOrder ?? 0)) + 1,
          });
        }}><Plus className="h-4 w-4" /> Add Case Study</button>}
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-950/25 p-3 text-sm text-rose-200">{error}</div>}
      {notice && <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-950/20 p-3 text-sm text-emerald-200">{notice}</p>}

      {editing ? (
        <section className="rounded-2xl border border-[#304135] bg-[#131D16] p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold text-[#ECF3EE]">{editing.id ? 'Edit Case Study' : 'Add Case Study'}</h2><p className="mt-1 text-xs text-[#91A195]">Drafts stay private until published.</p></div>
            <button type="button" aria-label="Close editor" className={secondaryButtonClass} onClick={() => setEditing(null)}><X className="h-4 w-4" /> Close</button>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className={labelClass}>Title<input className={fieldClass} maxLength={180} value={editing.title} onChange={(event) => changeTitle(event.target.value)} /></label>
            <label className={labelClass}>Slug<input className={fieldClass} maxLength={120} value={editing.slug} onChange={(event) => updateDraft('slug', slugify(event.target.value))} /></label>
            <div className={labelClass}>
              Category
              <input className={fieldClass} list="case-study-category-options" maxLength={100} value={editing.category} onChange={(event) => updateDraft('category', event.target.value)} placeholder="Search categories" />
              <datalist id="case-study-category-options">
                {categories.map((category) => <option key={category} value={category} />)}
              </datalist>
              {(canEdit || canDelete) && categories.length > 0 && <details className="mt-2 rounded-xl border border-[#33453A] bg-[#101913] p-3">
                <summary className="cursor-pointer text-xs font-semibold text-[#DCE8DD]">Manage saved categories</summary>
                <ul className="mt-3 space-y-2">
                  {categories.map((category) => <li key={category} className="flex flex-wrap items-center gap-2">
                    {editingCategory === category ? <>
                      <input
                        className={`${fieldClass} mt-0 min-w-0 flex-1`}
                        maxLength={100}
                        value={categoryNameDraft}
                        onChange={(event) => setCategoryNameDraft(event.target.value)}
                        aria-label={`Rename ${category}`}
                      />
                      <button type="button" className={secondaryButtonClass} disabled={busy || !categoryNameDraft.trim()} onClick={() => void renameCategory(category)}>Save</button>
                      <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setEditingCategory(null)}>Cancel</button>
                    </> : <>
                      <span className="min-w-0 flex-1 break-words">{category}</span>
                      {canEdit && <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => {
                        setEditingCategory(category);
                        setCategoryNameDraft(category);
                      }}>Rename</button>}
                      {canDelete && customCategories.includes(category) && <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void removeCategory(category)}>
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>}
                    </>}
                  </li>)}
                </ul>
              </details>}
              {canCreate && <button type="button" className={`${secondaryButtonClass} mt-2`} onClick={() => setAddingCategory((value) => !value)}>
                <Plus className="h-3.5 w-3.5" /> Add Custom Category
              </button>}
              {addingCategory && <div className="mt-2 flex gap-2">
                <input className={`${fieldClass} min-w-0 flex-1`} maxLength={100} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New category name" />
                <button type="button" className={buttonClass} disabled={busy || !newCategory.trim()} onClick={() => void saveCategory()}>Save</button>
              </div>}
            </div>
            <label className={labelClass}>Client / business type<input className={fieldClass} maxLength={160} value={editing.clientDescriptor} onChange={(event) => updateDraft('clientDescriptor', event.target.value)} /></label>
            <label className={labelClass}>Approved client name (optional)<input className={fieldClass} maxLength={120} value={editing.approvedClientName || ''} onChange={(event) => updateDraft('approvedClientName', event.target.value)} /></label>
            <label className={labelClass}>Location<input className={fieldClass} maxLength={120} value={editing.location} onChange={(event) => updateDraft('location', event.target.value)} /></label>
            <label className={labelClass}>Duration<input className={fieldClass} maxLength={100} value={editing.timeframe} onChange={(event) => updateDraft('timeframe', event.target.value)} /></label>
            <label className={labelClass}>Related service slug<input className={fieldClass} maxLength={100} value={editing.serviceSlug} onChange={(event) => updateDraft('serviceSlug', event.target.value)} /></label>
            <label className={`${labelClass} md:col-span-2`}>Summary<textarea className={`${fieldClass} min-h-20`} maxLength={1000} value={editing.summary || ''} onChange={(event) => updateDraft('summary', event.target.value)} /></label>
            <label className={`${labelClass} md:col-span-2`}>Initial challenge<textarea className={`${fieldClass} min-h-24`} maxLength={5000} value={editing.challenge} onChange={(event) => updateDraft('challenge', event.target.value)} /></label>
            <label className={`${labelClass} md:col-span-2`}>NearGrowAds strategy<textarea className={`${fieldClass} min-h-24`} maxLength={5000} value={editing.strategy} onChange={(event) => updateDraft('strategy', event.target.value)} /></label>
            <label className={`${labelClass} md:col-span-2`}>Deliverables (one per line)<textarea className={`${fieldClass} min-h-24`} value={editing.deliverablesExecuted.join('\n')} onChange={(event) => updateDraft('deliverablesExecuted', event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} /></label>

            <fieldset className="rounded-xl border border-[#304135] p-4 md:col-span-2">
              <legend className="px-2 text-xs font-semibold text-[#DCE8DD]">Performance metrics and evidence</legend>
              <div className="space-y-3">
                {editing.metrics.map((metric, index) => <div key={index} className="grid gap-2 rounded-lg bg-[#101913] p-3 sm:grid-cols-2">
                  <label className={labelClass}>Metric label<input className={fieldClass} value={metric.label} onChange={(event) => updateDraft('metrics', editing.metrics.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /></label>
                  <label className={labelClass}>Value<input className={fieldClass} value={metric.value} onChange={(event) => updateDraft('metrics', editing.metrics.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} /></label>
                  <label className={labelClass}>Period<input className={fieldClass} value={metric.period} onChange={(event) => updateDraft('metrics', editing.metrics.map((item, i) => i === index ? { ...item, period: event.target.value } : item))} /></label>
                  <label className={labelClass}>Evidence<input className={fieldClass} value={metric.evidence} onChange={(event) => updateDraft('metrics', editing.metrics.map((item, i) => i === index ? { ...item, evidence: event.target.value } : item))} /></label>
                  <button type="button" className={`${secondaryButtonClass} sm:col-span-2 sm:justify-self-end`} onClick={() => updateDraft('metrics', editing.metrics.filter((_, i) => i !== index))}><Trash2 className="h-3.5 w-3.5" /> Remove metric</button>
                </div>)}
                <button type="button" className={secondaryButtonClass} onClick={() => updateDraft('metrics', [...editing.metrics, { label: '', value: '', period: '', evidence: '' }])}><Plus className="h-4 w-4" /> Add metric</button>
              </div>
              <label className={`${labelClass} mt-4`}>Results context<textarea className={`${fieldClass} min-h-20`} maxLength={1500} value={editing.resultsContext} onChange={(event) => updateDraft('resultsContext', event.target.value)} /></label>
            </fieldset>

            <fieldset className="grid gap-3 rounded-xl border border-[#304135] p-4 md:col-span-2 sm:grid-cols-2">
              <legend className="px-2 text-xs font-semibold text-[#DCE8DD]">Approved testimonial</legend>
              <label className={`${labelClass} sm:col-span-2`}>Quote<textarea className={`${fieldClass} min-h-20`} maxLength={2000} value={editing.testimonialQuote?.quote || ''} onChange={(event) => updateDraft('testimonialQuote', { ...editing.testimonialQuote, quote: event.target.value, author: editing.testimonialQuote?.author || '', role: editing.testimonialQuote?.role || '' })} /></label>
              <label className={labelClass}>Client name<input className={fieldClass} maxLength={120} value={editing.testimonialQuote?.author || ''} onChange={(event) => updateDraft('testimonialQuote', { ...editing.testimonialQuote, quote: editing.testimonialQuote?.quote || '', author: event.target.value, role: editing.testimonialQuote?.role || '' })} /></label>
              <label className={labelClass}>Role / business<input className={fieldClass} maxLength={120} value={editing.testimonialQuote?.role || ''} onChange={(event) => updateDraft('testimonialQuote', { ...editing.testimonialQuote, quote: editing.testimonialQuote?.quote || '', author: editing.testimonialQuote?.author || '', role: event.target.value })} /></label>
              <label className="flex items-center gap-2 text-xs text-[#B8C7BC] sm:col-span-2"><input type="checkbox" checked={editing.testimonialApproved === true} onChange={(event) => updateDraft('testimonialApproved', event.target.checked)} /> Client approved this testimonial for publication</label>
            </fieldset>

            <label className={labelClass}>CTA label<input className={fieldClass} maxLength={80} value={editing.ctaLabel || ''} onChange={(event) => updateDraft('ctaLabel', event.target.value)} /></label>
            <label className={labelClass}>CTA link<input className={fieldClass} maxLength={500} value={editing.ctaLink || ''} onChange={(event) => updateDraft('ctaLink', event.target.value)} placeholder="/services/google-ads" /></label>
            <fieldset className="rounded-xl border border-[#304135] p-4 md:col-span-2">
              <legend className="px-2 text-xs font-semibold text-[#DCE8DD]">Transparent case study image</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>Alt text<input className={fieldClass} maxLength={200} value={editing.imageAlt || ''} onChange={(event) => updateDraft('imageAlt', event.target.value)} /></label>
                <label className={labelClass}>Image size<select className={fieldClass} value={editing.imageSize || 'cover'} onChange={(event) => updateDraft('imageSize', event.target.value as 'cover' | 'contain')}><option value="cover">Fill Area (cover)</option><option value="contain">Show Full Image (contain)</option></select></label>
                <label className={labelClass}>Image placement<select className={fieldClass} value={editing.imagePlacement || 'top'} onChange={(event) => {
                  const nextPlacement = event.target.value as NonNullable<CaseStudy['imagePlacement']>;
                  updateDraft('imagePlacement', nextPlacement);
                  if (nextPlacement !== 'top') {
                    if (!backgroundOpacityInitialized.current) {
                      updateDraft('imageOpacity', nextPlacement === 'background-cover' ? 100 : 18);
                    }
                    backgroundOpacityInitialized.current = true;
                  }
                }}><option value="top">Top Image</option><option value="background-cover">Background Cover</option><option value="background-watermark">Background Watermark</option></select></label>
                <label className={labelClass}>Horizontal position<input className={fieldClass} type="range" min={0} max={100} value={editing.imagePositionX ?? 50} onChange={(event) => updateDraft('imagePositionX', Number(event.target.value))} /></label>
                <label className={labelClass}>Vertical position<input className={fieldClass} type="range" min={0} max={100} value={editing.imagePositionY ?? 50} onChange={(event) => updateDraft('imagePositionY', Number(event.target.value))} /></label>
                {(editing.imagePlacement === 'background-cover' || editing.imagePlacement === 'background-watermark') && <label className={labelClass}>Background image opacity ({editing.imageOpacity ?? (editing.imagePlacement === 'background-cover' ? 100 : 18)}%)<input className={fieldClass} type="range" min={0} max={100} value={editing.imageOpacity ?? (editing.imagePlacement === 'background-cover' ? 100 : 18)} onChange={(event) => updateDraft('imageOpacity', Number(event.target.value))} /></label>}
              </div>
              {editing.imageUrl && <div className="mt-4 flex flex-wrap items-center gap-3">
                <div data-case-study-theme={theme} data-image-placement={editing.imagePlacement || 'top'} className="admin-case-study-preview relative isolate w-full max-w-xl overflow-hidden rounded-xl border border-[#47594C] bg-[#F7F9F6] p-4">
                  <CaseStudyImage study={editing} theme={theme} />
                  <div className="relative z-10 space-y-3">
                    <h3 className="case-study-heading text-lg font-bold text-[#171A17]">{editing.title || 'Case study title preview'}</h3>
                    <p className="case-study-body text-xs text-[#626A63]">Preview text remains above the background image layer.</p>
                  </div>
                </div>
                <button type="button" className={secondaryButtonClass} onClick={() => { updateDraft('imageUrl', ''); updateDraft('imageAlt', ''); }}><Trash2 className="h-4 w-4" /> Remove image</button>
              </div>}
              <label className={`${secondaryButtonClass} mt-4 cursor-pointer`}>
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {editing.imageUrl ? 'Replace PNG / WebP' : 'Upload transparent PNG / WebP'}
                <input type="file" accept="image/png,image/webp,.png,.webp" className="sr-only" disabled={busy} onChange={(event) => void uploadImage(event)} />
              </label>
            </fieldset>
            <label className="flex items-center gap-2 text-xs text-[#B8C7BC]"><input type="checkbox" checked={editing.featured === true} onChange={(event) => updateDraft('featured', event.target.checked)} /> Featured case study</label>
            <label className={labelClass}>Display order<input className={fieldClass} type="number" min={0} max={10000} value={editing.displayOrder ?? 0} onChange={(event) => updateDraft('displayOrder', Number(event.target.value))} /></label>
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-[#304135] pt-4">
            <button type="button" className={secondaryButtonClass} onClick={() => setEditing(null)}>Cancel</button>
            {(editing.id ? canEdit : canCreate) && <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void save('draft')}><Save className="h-4 w-4" /> Save Draft</button>}
            {canPublish && (editing.id ? canEdit : canCreate) && <button type="button" className={buttonClass} disabled={busy} onClick={() => void save('published')}><Eye className="h-4 w-4" /> Publish</button>}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-[#304135] bg-[#131D16] p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <label className="relative"><span className="sr-only">Search case studies</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#91A195]" /><input className={`${fieldClass} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, category, client or slug" /></label>
            <label><span className="sr-only">Filter case studies by status</span><select className={fieldClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Drafts</option><option value="archived">Archived</option></select></label>
          </div>
          <p className="mt-3 text-xs text-[#91A195]">{filteredStudies.length} case {filteredStudies.length === 1 ? 'study' : 'studies'} · public Work page shows published studies, 3 per page.</p>
          {loading ? <p className="py-12 text-center text-sm text-[#A9B8AD]">Loading case studies…</p> : !filteredStudies.length ? <p className="py-12 text-center text-sm text-[#A9B8AD]">No case studies match this filter.</p> : (
            <div className="mt-4 space-y-3">
              {filteredStudies.map((study) => {
                const orderIndex = orderedStudies.findIndex((item) => item.id === study.id);
                return <article key={study.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#304135] bg-[#101913] p-3 sm:p-4">
                {study.imageUrl && <img src={study.imageUrl} alt="" className="h-14 w-20 rounded-lg object-contain" style={{ objectPosition: `${study.imagePositionX ?? 50}% ${study.imagePositionY ?? 50}%` }} />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-[#ECF3EE]">{study.title}</h2><span className={`admin-case-study-status admin-case-study-status-${study.status || 'published'} rounded-full px-2 py-0.5 text-[10px] capitalize ${study.status === 'published' ? 'bg-emerald-400/10 text-emerald-200' : study.status === 'archived' ? 'bg-white/5 text-[#91A195]' : 'bg-amber-300/10 text-amber-100'}`}>{study.status || 'published'}</span>{study.hasUnpublishedChanges && <span className="admin-case-study-draft-badge rounded-full bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-100">Draft edits</span>}{study.featured && <span className="admin-case-study-featured text-[10px] text-[#C7F36B]">Featured</span>}</div>
                  <p className="mt-1 truncate text-xs text-[#91A195]">{study.category} · {study.clientDescriptor} · /{study.slug}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <button type="button" title="Move up" aria-label={`Move ${study.title} up`} className={secondaryButtonClass} disabled={busy || orderIndex === 0 || !canEdit} onClick={() => void reorder(study, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" title="Move down" aria-label={`Move ${study.title} down`} className={secondaryButtonClass} disabled={busy || orderIndex === orderedStudies.length - 1 || !canEdit} onClick={() => void reorder(study, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button type="button" className={secondaryButtonClass} onClick={() => setPreview(study)}><Eye className="h-3.5 w-3.5" /> Preview</button>
                  {canEdit && <button type="button" className={secondaryButtonClass} onClick={() => {
                    const draft = readDraft(study);
                    backgroundOpacityInitialized.current = draft.imagePlacement === 'background-cover' || draft.imagePlacement === 'background-watermark';
                    setEditing(draft);
                  }}><Save className="h-3.5 w-3.5" /> Edit</button>}
                  {canCreate && <button type="button" className={secondaryButtonClass} onClick={() => void duplicate(study)}><Copy className="h-3.5 w-3.5" /> Duplicate as Draft</button>}
                  {study.status === 'published' && canPublish && <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void changeStatus(study, 'draft')}>Unpublish</button>}
                  {study.status !== 'published' && study.status !== 'archived' && canEdit && canPublish && <button type="button" className={buttonClass} disabled={busy} onClick={() => void changeStatus(study, 'published')}>Publish</button>}
                  {study.status !== 'archived' && canDelete && <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void remove(study, true)}>Archive</button>}
                  {canDelete && <button type="button" aria-label={`Delete ${study.title}`} className={`${secondaryButtonClass} admin-case-study-delete text-rose-200`} disabled={busy} onClick={() => void remove(study, false)}><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              </article>})}
            </div>
          )}
        </section>
      )}

      {preview && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="case-study-preview-title" data-case-study-theme={theme} data-image-placement={preview.imagePlacement || 'top'} className="admin-case-study-preview relative isolate max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#304135] bg-[#F7F9F6] p-5 text-[#171A17] shadow-2xl">
          {(preview.imagePlacement === 'background-cover' || preview.imagePlacement === 'background-watermark') &&
            <CaseStudyImage study={preview} theme={theme} />}
          <div className="relative z-10">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-[#74C65C]">{preview.category}</p><h2 id="case-study-preview-title" className="case-study-heading mt-1 text-xl font-bold">{preview.title}</h2></div><button type="button" className={secondaryButtonClass} aria-label="Close preview" onClick={() => setPreview(null)}><X className="h-4 w-4" /></button></div>
          {preview.imageUrl && preview.imagePlacement !== 'background-cover' && preview.imagePlacement !== 'background-watermark' &&
            <CaseStudyImage study={preview} theme={theme} />}
          <p className="case-study-body mt-4 text-sm text-[#A9B8AD]">{preview.summary}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><h3 className="case-study-heading text-xs font-bold uppercase tracking-wider">Initial challenge</h3><p className="case-study-body mt-1 text-sm text-[#A9B8AD]">{preview.challenge}</p></div><div><h3 className="case-study-heading text-xs font-bold uppercase tracking-wider">Strategy</h3><p className="case-study-body mt-1 text-sm text-[#A9B8AD]">{preview.strategy}</p></div></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">{preview.metrics.map((metric) => <div key={`${metric.label}-${metric.value}`} className="rounded-xl border border-[#304135] bg-[#101913] p-3"><p className="text-xs font-semibold">{metric.label}</p><p className="mt-1 text-lg font-black text-[#74C65C]">{metric.value}</p><p className="text-[10px] text-[#91A195]">{metric.period}</p><p className="mt-1 text-[10px] text-[#A9B8AD]">{metric.evidence}</p></div>)}</div>
          <p className="mt-4 text-xs text-[#91A195]">Status: {preview.status || 'published'} · /{preview.slug}</p>
          </div>
        </section>
      </div>}
    </div>
  );
}
