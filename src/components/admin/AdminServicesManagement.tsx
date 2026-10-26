import { useEffect, useMemo, useState } from 'react';
import { ImageThemeTabs } from './ImageThemeTabs';
import { resolveThemeImage, type PublicImageTheme, type ThemeImageFields } from '../../data/themeImages';
import { ArrowDown, ArrowUp, Check, Eye, LoaderCircle, Plus, Save, Send, Trash2, Upload, X } from 'lucide-react';
import type { WebsiteService } from '../../data/websiteServices';

type ServiceDraft = Omit<WebsiteService, 'id' | 'status' | 'hasUnpublishedChanges'> & {
  id?: string;
  status?: WebsiteService['status'];
  hasUnpublishedChanges?: boolean;
};

interface AdminServicesManagementProps {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPublish: boolean;
}

const inputClass = 'min-h-11 w-full rounded-xl border border-[#33453A] bg-[#101913] px-3.5 py-2.5 text-sm text-[#EAF1EB] outline-none placeholder:text-[#76867B] focus:border-[#67D8B7] focus:ring-2 focus:ring-[#67D8B7]/15';
const labelClass = 'block text-xs font-medium text-[#B8C7BC]';
const buttonClass = 'admin-services-primary inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#286D3B] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#347E49] disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass = 'admin-services-secondary inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#47594C] px-3 py-2 text-xs font-semibold text-[#DCE8DD] transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50';
const approvedIcons = ['MapPin', 'Compass', 'TrendingUp', 'Share2', 'Laptop', 'FileText', 'Cpu'] as const;

const emptyService = (): ServiceDraft => ({
  slug: '',
  title: '',
  badge: '',
  shortDescription: '',
  icon: '',
  deliverables: [''],
  primaryCtaLabel: 'Request a custom audit',
  primaryCtaLink: '/get-started',
  secondaryCtaLabel: '',
  secondaryCtaLink: '',
  backgroundImageUrl: '',
  backgroundEnabled: false,
  backgroundFit: 'cover',
  backgroundOpacity: 100,
  backgroundPositionX: 50,
  backgroundPositionY: 50,
  displayOrder: 0,
});

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
  const body = await response.json().catch(() => ({})) as { message?: string } & T;
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status}).`);
  return body;
}

function PreviewCard({ service, theme }: { service: ServiceDraft; theme: PublicImageTheme }) {
  const resolvedImage = resolveThemeImage(
    {
      url: service.backgroundImageUrl,
      altText: '',
      backgroundEnabled: service.backgroundEnabled,
      backgroundFit: service.backgroundFit,
      backgroundOpacity: service.backgroundOpacity,
      backgroundPositionX: service.backgroundPositionX,
      backgroundPositionY: service.backgroundPositionY,
    },
    service.backgroundImageVariants,
    theme,
  ).image;
  const image = resolvedImage.backgroundEnabled && resolvedImage.url;
  return (
    <article
      className="admin-services-preview group relative isolate flex min-h-[430px] flex-col overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.16] via-white/[0.055] to-[#70BE55]/[0.14] p-px"
      data-preview-theme={theme}
    >
      <div
        className="admin-services-preview-surface relative isolate flex h-full min-h-[428px] flex-col overflow-hidden rounded-[15px] bg-[#0D1320]/95 p-5 sm:p-6"
        data-preview-theme={theme}
        data-has-image={Boolean(image)}
      >
        {image && (
          <div
            aria-hidden="true"
            className="service-index-card-background pointer-events-none absolute inset-0 z-0"
            style={{ opacity: theme === 'dark' ? (resolvedImage.backgroundOpacity ?? 100) / 100 : 1 }}
          >
            <img
              src={resolvedImage.url}
              alt=""
              className="absolute inset-0 h-full w-full"
              style={{
                objectFit: resolvedImage.backgroundFit,
                objectPosition: `${resolvedImage.backgroundPositionX}% ${resolvedImage.backgroundPositionY}%`,
                opacity: theme === 'light' ? (resolvedImage.backgroundOpacity ?? 100) / 100 : undefined,
              }}
            />
            <div className={`service-index-card-scrim absolute inset-0 ${theme === 'light' ? 'service-index-card-scrim--light' : 'bg-[#0D1320]/75'}`} />
          </div>
        )}
        <div className="relative z-10 flex h-full min-h-[380px] flex-col">
          <div className="mb-6 flex items-start justify-between gap-3">
            {approvedIcons.includes(service.icon as typeof approvedIcons[number]) && (
              <span className="grid h-11 w-11 place-items-center rounded-xl border border-[#70BE55]/20 bg-[#70BE55]/[0.09] text-[#8BD477]" aria-hidden="true">
                {service.icon}
              </span>
            )}
            <span className="pt-1 text-[10px] font-bold tracking-[0.16em] text-[#626D80]">{String(service.displayOrder + 1).padStart(2, '0')}</span>
          </div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8BD477]">{service.badge || 'Category / eyebrow'}</div>
          <h3 className="text-lg font-bold leading-snug tracking-[-0.025em] text-white sm:text-xl">{service.title || 'Service name'}</h3>
          <p className="mt-3 text-xs leading-6 text-[#A6AEC0]">{service.shortDescription || 'Short description preview.'}</p>
          <div className="mt-6 border-t border-white/[0.08] pt-5">
            <h4 className="mb-4 text-[10px] font-bold uppercase tracking-[0.14em] text-[#D9DFEA]">Key deliverables</h4>
            <ul className="space-y-3">
              {service.deliverables.filter(Boolean).map((deliverable, index) => (
                <li key={`${index}-${deliverable}`} className="flex items-start gap-2.5 text-xs leading-5 text-[#B9C1D0]">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8BD477]" aria-hidden="true" />{deliverable}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-auto pt-7">
            <div className="admin-services-preview-primary-cta rounded-xl border border-[#70BE55]/35 bg-[#70BE55]/[0.1] px-4 py-3 text-center text-xs font-bold text-[#A1E48D]">{service.primaryCtaLabel || 'Primary CTA'}</div>
            {service.secondaryCtaLabel && <div className="admin-services-preview-secondary-cta mt-4 text-center text-[11px] font-semibold text-[#8993A6]">{service.secondaryCtaLabel}</div>}
          </div>
        </div>
      </div>
    </article>
  );
}

export function AdminServicesManagement({ canCreate, canEdit, canDelete, canPublish }: AdminServicesManagementProps) {
  const [services, setServices] = useState<WebsiteService[]>([]);
  const [editing, setEditing] = useState<ServiceDraft | null>(null);
  const [imageTheme, setImageTheme] = useState<PublicImageTheme>('dark');
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const orderedServices = useMemo(
    () => [...services].sort((a, b) => a.displayOrder - b.displayOrder || a.title.localeCompare(b.title)),
    [services],
  );
  const canChangeDraft = Boolean(editing && (editing.id ? canEdit : canCreate));

  const loadServices = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ services: WebsiteService[] }>('/api/admin/services');
      setServices(result.services);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Website services could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadServices(); }, []);

  const update = (patch: Partial<ServiceDraft>) => {
    setEditing((current) => current ? { ...current, ...patch } : current);
    setError('');
    setNotice('');
  };
  const resolvedBackground = editing ? resolveThemeImage(
    {
      url: editing.backgroundImageUrl,
      altText: '',
      backgroundEnabled: editing.backgroundEnabled,
      backgroundFit: editing.backgroundFit,
      backgroundOpacity: editing.backgroundOpacity,
      backgroundPositionX: editing.backgroundPositionX,
      backgroundPositionY: editing.backgroundPositionY,
    },
    editing.backgroundImageVariants,
    imageTheme,
  ) : null;
  const updateBackgroundVariant = (patch: Partial<ThemeImageFields>) => {
    if (!editing) return;
    update({
      backgroundImageVariants: {
        ...editing.backgroundImageVariants,
        [imageTheme]: { ...editing.backgroundImageVariants?.[imageTheme], ...patch },
      },
    });
  };

  const normalizedDraft = (draft: ServiceDraft): ServiceDraft => {
    const slug = slugify(draft.slug || draft.title);
    return {
      ...draft,
      slug,
      secondaryCtaLink: draft.secondaryCtaLabel ? draft.secondaryCtaLink || `/services/${slug}` : '',
      deliverables: draft.deliverables.map((entry) => entry.trim()).filter(Boolean),
    };
  };

  const saveDraft = async (): Promise<WebsiteService | undefined> => {
    if (!editing) return undefined;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const draft = normalizedDraft(editing);
      const result = editing.id
        ? await api<{ service: WebsiteService }>(`/api/admin/services/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        })
        : await api<{ service: WebsiteService }>('/api/admin/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        });
      setEditing(result.service);
      setNotice('Draft saved. Public service cards remain unchanged until you publish.');
      await loadServices();
      return result.service;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The service draft could not be saved.');
      return undefined;
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    setSaving(true);
    setError('');
    try {
      const result = await api<{ service: WebsiteService }>(`/api/admin/services/${saved.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published' }),
      });
      setEditing(result.service);
      setNotice('Service published to the public Services page.');
      await loadServices();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The service could not be published.');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (service: WebsiteService, status: 'draft' | 'archived') => {
    const action = status === 'archived' ? 'archive' : 'unpublish';
    if (!window.confirm(`Are you sure you want to ${action} “${service.title}”?`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/admin/services/${service.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setNotice(`Service ${status === 'archived' ? 'archived' : 'unpublished'}.`);
      setEditing(null);
      await loadServices();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `The service could not be ${action}d.`);
    } finally {
      setSaving(false);
    }
  };

  const removeService = async (service: WebsiteService) => {
    if (!window.confirm(`Permanently remove “${service.title}”? This cannot be undone.`)) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/admin/services/${service.id}`, { method: 'DELETE' });
      setEditing(null);
      setNotice('Service removed.');
      await loadServices();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The service could not be removed.');
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file?: File, theme = imageTheme) => {
    if (!file || !editing?.id) return;
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.set('serviceId', editing.id);
      form.set('image', file);
      const result = await api<{ url: string }>('/api/admin/services/upload', { method: 'POST', body: form });
      update({
        backgroundImageVariants: {
          ...editing.backgroundImageVariants,
          [theme]: { ...editing.backgroundImageVariants?.[theme], url: result.url },
        },
      });
      setNotice('Background image uploaded. Save the draft and publish to display it publicly.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The background image could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };

  const moveService = async (service: WebsiteService, direction: -1 | 1) => {
    const index = orderedServices.findIndex((entry) => entry.id === service.id);
    const target = orderedServices[index + direction];
    if (!target) return;
    setSaving(true);
    setError('');
    try {
      const first = await api<{ service: WebsiteService }>(`/api/admin/services/${service.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...service, displayOrder: target.displayOrder }),
      });
      await api<{ service: WebsiteService }>(`/api/admin/services/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...target, displayOrder: service.displayOrder }),
      });
      setServices((current) => current.map((entry) => entry.id === service.id
        ? first.service
        : entry.id === target.id ? { ...entry, displayOrder: service.displayOrder } : entry));
      setNotice('Service display order saved as draft changes; publish changed services to apply publicly.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The service order could not be saved.');
      await loadServices();
    } finally {
      setSaving(false);
    }
  };

  const editService = (service: WebsiteService) => {
    setEditing({
      ...service,
      icon: approvedIcons.find((icon) => icon === service.icon) ?? '',
      deliverables: [...service.deliverables],
    });
    setShowPreview(false);
    setError('');
    setNotice('');
  };

  const addNew = () => {
    if (!canCreate) return;
    const draft = emptyService();
    draft.displayOrder = services.length ? Math.max(...services.map((service) => service.displayOrder)) + 1 : 0;
    setEditing(draft);
    setShowPreview(false);
    setError('');
    setNotice('');
  };

  if (loading) {
    return <div className="admin-services-management flex items-center gap-3 rounded-2xl border border-[#304135] bg-[#19241D] p-6 text-sm text-[#A9B8AD]"><LoaderCircle className="h-4 w-4 animate-spin" />Loading website services…</div>;
  }

  return (
    <div className="admin-services-management space-y-5 text-[#ECF3EE]">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#304135] bg-[#19241D] p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold">Public website service cards</h2>
          <p className="mt-1 text-xs text-[#A9B8AD]">This module manages the marketing Services page, not Service Store packages or checkout.</p>
        </div>
        {canCreate && <button type="button" onClick={addNew} disabled={saving} className={buttonClass}><Plus className="h-4 w-4" />Add New Service</button>}
      </div>
      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${error ? 'border-rose-400/30 bg-rose-950/20 text-rose-200' : 'border-emerald-400/20 bg-emerald-950/20 text-emerald-200'}`}>{error || notice}</p>}

      {editing && (
        <section className="rounded-2xl border border-[#304135] bg-[#19241D] p-4 sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[#304135] pb-4">
            <div><h2 className="text-lg font-bold">{editing.id ? 'Edit website service' : 'New website service'}</h2><p className="mt-1 text-xs text-[#A9B8AD]">Save a draft first; only Publish changes public content.</p></div>
            <button type="button" onClick={() => { setEditing(null); setShowPreview(false); }} className={secondaryButtonClass}><X className="h-4 w-4" />Close editor</button>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-4">
              <label className={labelClass}>Service Name<input className={inputClass} maxLength={160} disabled={!canChangeDraft || saving} value={editing.title} onChange={(event) => update({ title: event.target.value })} /></label>
              <label className={labelClass}>Category / Eyebrow<input className={inputClass} maxLength={100} disabled={!canChangeDraft || saving} value={editing.badge} onChange={(event) => update({ badge: event.target.value })} /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>Optional service slug<input className={inputClass} maxLength={100} placeholder={slugify(editing.title) || 'service-slug'} disabled={!canChangeDraft || saving} value={editing.slug} onChange={(event) => update({ slug: event.target.value })} /></label>
                <label className={labelClass}>Service number / display order<input className={inputClass} type="number" min="1" max="10001" disabled={!canChangeDraft || saving} value={editing.displayOrder + 1} onChange={(event) => update({ displayOrder: Math.max(0, Number(event.target.value) - 1) })} /></label>
              </div>
              <label className={labelClass}>Short Description<textarea className={`${inputClass} min-h-24 resize-y`} maxLength={600} disabled={!canChangeDraft || saving} value={editing.shortDescription} onChange={(event) => update({ shortDescription: event.target.value })} /></label>
              <label className={labelClass}>Approved Icon<select className={inputClass} disabled={!canChangeDraft || saving} value={editing.icon} onChange={(event) => update({ icon: event.target.value })}><option value="">No icon</option>{approvedIcons.map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select></label>
              <div>
                <div className="mb-2 flex items-center justify-between"><span className={labelClass}>Key Deliverables</span><button type="button" disabled={!canChangeDraft || saving || editing.deliverables.length >= 20} onClick={() => update({ deliverables: [...editing.deliverables, ''] })} className={secondaryButtonClass}><Plus className="h-3.5 w-3.5" />Add row</button></div>
                <div className="space-y-2">{editing.deliverables.map((item, index) => <div key={index} className="flex gap-2"><input className={inputClass} maxLength={300} disabled={!canChangeDraft || saving} value={item} aria-label={`Key deliverable ${index + 1}`} onChange={(event) => update({ deliverables: editing.deliverables.map((row, rowIndex) => rowIndex === index ? event.target.value : row) })} /><button type="button" disabled={!canChangeDraft || saving || editing.deliverables.length <= 1} aria-label={`Remove deliverable ${index + 1}`} onClick={() => update({ deliverables: editing.deliverables.filter((_, rowIndex) => rowIndex !== index) })} className={secondaryButtonClass}><Trash2 className="h-4 w-4" /></button></div>)}</div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>Primary CTA label<input className={inputClass} maxLength={100} disabled={!canChangeDraft || saving} value={editing.primaryCtaLabel} onChange={(event) => update({ primaryCtaLabel: event.target.value })} /></label>
                <label className={labelClass}>Primary CTA link<input className={inputClass} maxLength={2048} disabled={!canChangeDraft || saving} value={editing.primaryCtaLink} onChange={(event) => update({ primaryCtaLink: event.target.value })} /></label>
                <label className={labelClass}>Secondary CTA label<input className={inputClass} maxLength={100} disabled={!canChangeDraft || saving} value={editing.secondaryCtaLabel} onChange={(event) => update({ secondaryCtaLabel: event.target.value })} /></label>
                <label className={labelClass}>Secondary CTA link<input className={inputClass} maxLength={2048} disabled={!canChangeDraft || saving} value={editing.secondaryCtaLink} onChange={(event) => update({ secondaryCtaLink: event.target.value })} /></label>
              </div>
            </div>
            <div className="space-y-4">
              <section className="admin-services-image-controls space-y-4 rounded-xl border border-[#304135] bg-[#131D16] p-4">
                <h3 className="text-sm font-semibold">Individual background image</h3>
                <p className="text-xs text-[#819087]">JPG, PNG or WebP up to 15 MB. Transparent PNG/WebP remains transparent. Image changes are private until saved and published.</p>
                <ImageThemeTabs theme={imageTheme} source={resolvedBackground?.source ?? 'empty'} onChange={setImageTheme} />
                {resolvedBackground?.image.url && <img src={resolvedBackground.image.url} alt={resolvedBackground.image.altText ?? ''} className="aspect-video w-full rounded-xl object-cover" style={{ objectFit: resolvedBackground.image.backgroundFit, objectPosition: `${resolvedBackground.image.backgroundPositionX}% ${resolvedBackground.image.backgroundPositionY}%`, opacity: (resolvedBackground.image.backgroundOpacity ?? 100) / 100 }} />}
                <div className="flex flex-wrap gap-2">
                  <label className={`${buttonClass} cursor-pointer`}>
                    {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{editing.backgroundImageVariants?.[imageTheme]?.url ? 'Replace image' : `Upload ${imageTheme === 'light' ? 'Light' : 'Dark'} Mode image`}
                    <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={!canChangeDraft || !editing.id || saving || uploading} onChange={(event) => { void uploadImage(event.currentTarget.files?.[0], imageTheme); event.currentTarget.value = ''; }} />
                  </label>
                  {editing.backgroundImageVariants?.[imageTheme]?.url && <button type="button" disabled={!canChangeDraft || saving || uploading} onClick={() => updateBackgroundVariant({ url: '' })} className={`${secondaryButtonClass} admin-services-remove-image`}><Trash2 className="h-4 w-4" />Remove {imageTheme === 'light' ? 'Light' : 'Dark'} Mode image</button>}
                </div>
                {!editing.id && <p className="text-[11px] text-amber-200">Save this service as a draft before uploading its image.</p>}
                <label className="flex items-center justify-between gap-3 text-xs font-medium text-[#B8C7BC]">Enable background image<input type="checkbox" checked={resolvedBackground?.image.backgroundEnabled ?? false} disabled={!canChangeDraft || saving || !resolvedBackground?.image.url} onChange={(event) => updateBackgroundVariant({ backgroundEnabled: event.target.checked })} className="h-5 w-5 accent-[#72D28B]" /></label>
                {resolvedBackground?.image.backgroundEnabled && <>
                  <label className={labelClass}>Image Fit<select className={inputClass} disabled={!canChangeDraft || saving} value={resolvedBackground.image.backgroundFit ?? 'cover'} onChange={(event) => updateBackgroundVariant({ backgroundFit: event.target.value as 'cover' | 'contain' })}><option value="cover">Cover</option><option value="contain">Contain</option></select></label>
                  <label className={`${labelClass} flex justify-between`}>Background opacity <span>{resolvedBackground.image.backgroundOpacity ?? 100}%</span><input className="mt-2 w-full accent-[#72D28B]" type="range" min="0" max="100" value={resolvedBackground.image.backgroundOpacity ?? 100} disabled={!canChangeDraft || saving} onChange={(event) => updateBackgroundVariant({ backgroundOpacity: Number(event.target.value) })} /></label>
                  <div className="grid gap-3 sm:grid-cols-2">{([['backgroundPositionX', 'Horizontal position'], ['backgroundPositionY', 'Vertical position']] as const).map(([key, label]) => <label key={key} className={`${labelClass} flex justify-between`}>{label}<span>{resolvedBackground.image[key] ?? 50}%</span><input className="mt-2 w-full accent-[#72D28B]" type="range" min="0" max="100" value={resolvedBackground.image[key] ?? 50} disabled={!canChangeDraft || saving} onChange={(event) => updateBackgroundVariant({ [key]: Number(event.target.value) })} /></label>)}</div>
                </>}
              </section>
              <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Live card preview</h3><button type="button" onClick={() => setShowPreview((value) => !value)} className={secondaryButtonClass}><Eye className="h-4 w-4" />{showPreview ? 'Hide preview' : 'Preview changes'}</button></div>
              {showPreview && <PreviewCard service={editing} theme={imageTheme} />}
              {editing.id && <p className="text-xs text-[#A9B8AD]">Current status: <span className="font-semibold capitalize">{editing.status}</span>{editing.hasUnpublishedChanges ? ' · Saved draft differs from public snapshot' : ''}</p>}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[#304135] pt-5">
            {canChangeDraft && <button type="button" disabled={saving || uploading} onClick={() => void saveDraft()} className={secondaryButtonClass}>{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save Draft</button>}
            {canPublish && canChangeDraft && <button type="button" disabled={saving || uploading} onClick={() => void publish()} className={buttonClass}>{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Publish</button>}
            {editing.id && editing.status === 'published' && canPublish && <button type="button" disabled={saving} onClick={() => { const service = services.find((item) => item.id === editing.id); if (service) void setStatus(service, 'draft'); }} className={secondaryButtonClass}>Unpublish</button>}
            {editing.id && canDelete && <>
              <button type="button" disabled={saving} onClick={() => { const service = services.find((item) => item.id === editing.id); if (service) void setStatus(service, 'archived'); }} className={secondaryButtonClass}>Archive</button>
              <button type="button" disabled={saving} onClick={() => { const service = services.find((item) => item.id === editing.id); if (service) void removeService(service); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-400/30 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"><Trash2 className="h-4 w-4" />Remove</button>
            </>}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-[#304135] bg-[#19241D]">
        <div className="border-b border-[#304135] px-4 py-4 sm:px-5"><h2 className="text-sm font-semibold">Managed services</h2><p className="mt-1 text-xs text-[#A9B8AD]">Published cards are ordered by service number. Drafts do not appear on the public page.</p></div>
        {orderedServices.length === 0 ? <p className="p-5 text-sm text-[#A9B8AD]">No services found. Apply the Services Management migration to load the existing public services.</p> : <ul className="divide-y divide-[#304135]">{orderedServices.map((service, index) => <li key={service.id} className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
          <span className="w-8 text-xs font-bold text-[#819087]">{String(service.displayOrder + 1).padStart(2, '0')}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{service.title}</p><p className="mt-1 text-xs text-[#819087]">{service.badge} · <span className="capitalize">{service.status}</span>{service.hasUnpublishedChanges ? ' · Draft changes' : ''}</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" title="Move up" aria-label={`Move ${service.title} up`} disabled={saving || index === 0 || !canEdit} onClick={() => void moveService(service, -1)} className={secondaryButtonClass}><ArrowUp className="h-4 w-4" /></button>
            <button type="button" title="Move down" aria-label={`Move ${service.title} down`} disabled={saving || index === orderedServices.length - 1 || !canEdit} onClick={() => void moveService(service, 1)} className={secondaryButtonClass}><ArrowDown className="h-4 w-4" /></button>
            {canEdit && <button type="button" onClick={() => editService(service)} className={secondaryButtonClass}>Edit</button>}
          </div>
        </li>)}</ul>}
      </section>
    </div>
  );
}
