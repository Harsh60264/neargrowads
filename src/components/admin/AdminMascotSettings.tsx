import { useEffect, useMemo, useState } from 'react';
import { Check, Eye, History, LoaderCircle, Monitor, RotateCcw, Save, Send, Smartphone } from 'lucide-react';
import { NearGrowMascot } from '../mascot/NearGrowMascot';
import {
  DEFAULT_MASCOT_SETTINGS,
  MASCOT_SCALE_MAX,
  MASCOT_SCALE_MIN,
  normalizeMascotSettings,
} from '../../data/mascotSizing';
import type { MascotSettings } from '../../data/siteContent';

interface MascotRevision {
  id: number;
  action: string;
  actorLabel: string;
  createdAt: string;
  settings: MascotSettings;
}

interface MascotStateResponse {
  settings: MascotSettings;
  publishedSettings: MascotSettings;
  publishedAt: string | null;
  draftUpdatedAt: string | null;
  draftUpdatedBy: string | null;
  canPublish: boolean;
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown>;
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    throw new Error(`The mascot settings API returned a non-JSON response (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(typeof body.message === 'string' ? body.message : `Request failed (${response.status}).`);
  }
  return body;
}

function dateLabel(value: string | null): string {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function sameSettings(left: MascotSettings, right: MascotSettings): boolean {
  return left.renderer === right.renderer &&
    left.desktopScalePercent === right.desktopScalePercent &&
    left.mobileScalePercent === right.mobileScalePercent;
}

export function AdminMascotSettings({
  canEdit,
  canPublish,
}: {
  canEdit: boolean;
  canPublish: boolean;
}) {
  const [settings, setSettings] = useState<MascotSettings>(DEFAULT_MASCOT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<MascotSettings>(DEFAULT_MASCOT_SETTINGS);
  const [publishedSettings, setPublishedSettings] = useState<MascotSettings>(DEFAULT_MASCOT_SETTINGS);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [draftUpdatedBy, setDraftUpdatedBy] = useState<string | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [canPublishDraft, setCanPublishDraft] = useState(false);
  const [history, setHistory] = useState<MascotRevision[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [previewFallback, setPreviewFallback] = useState(false);
  const [numberInput, setNumberInput] = useState({ desktop: '100', mobile: '100' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inputError, setInputError] = useState('');

  const dirty = !sameSettings(settings, savedSettings);
  const unpublished = !sameSettings(savedSettings, publishedSettings);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/mascot-settings', { credentials: 'same-origin' })
      .then(readResponse)
      .then((data) => {
        if (!active) return;
        const loaded = data as unknown as MascotStateResponse;
        const draft = normalizeMascotSettings(loaded.settings);
        setSettings(draft);
        setSavedSettings(draft);
        setPublishedSettings(normalizeMascotSettings(loaded.publishedSettings));
        setDraftUpdatedAt(loaded.draftUpdatedAt);
        setDraftUpdatedBy(loaded.draftUpdatedBy);
        setPublishedAt(loaded.publishedAt);
        setCanPublishDraft(loaded.canPublish);
        setNumberInput({
          desktop: String(draft.desktopScalePercent),
          mobile: String(draft.mobileScalePercent),
        });
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load mascot settings.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const previewBaseSize = useMemo(() => previewDevice === 'mobile'
    ? 140
    : Math.max(150, Math.min(window.innerHeight * 0.21, 215)), [previewDevice]);

  const updateSetting = (device: 'desktop' | 'mobile', rawValue: number) => {
    const value = Math.round(Math.min(MASCOT_SCALE_MAX, Math.max(MASCOT_SCALE_MIN, rawValue)));
    setSettings((current) => ({
      ...current,
      [device === 'desktop' ? 'desktopScalePercent' : 'mobileScalePercent']: value,
    }));
    setNumberInput((current) => ({ ...current, [device]: String(value) }));
    setInputError('');
    setNotice('');
  };

  const updateRenderer = (renderer: MascotSettings['renderer']) => {
    setSettings((current) => ({ ...current, renderer }));
    setPreviewFallback(false);
    setNotice('');
  };

  const handleNumberInput = (device: 'desktop' | 'mobile', value: string) => {
    setNumberInput((current) => ({ ...current, [device]: value }));
    setNotice('');
    const parsed = Number(value);
    if (value !== '' && Number.isInteger(parsed) && parsed >= MASCOT_SCALE_MIN && parsed <= MASCOT_SCALE_MAX) {
      setSettings((current) => ({
        ...current,
        [device === 'desktop' ? 'desktopScalePercent' : 'mobileScalePercent']: parsed,
      }));
      setInputError('');
    }
  };

  const commitNumberInput = (device: 'desktop' | 'mobile') => {
    const text = numberInput[device];
    const parsed = Number(text);
    if (text !== '' && Number.isInteger(parsed) && parsed >= MASCOT_SCALE_MIN && parsed <= MASCOT_SCALE_MAX) {
      updateSetting(device, parsed);
      return;
    }
    setNumberInput((current) => ({
      ...current,
      [device]: String(device === 'desktop' ? settings.desktopScalePercent : settings.mobileScalePercent),
    }));
    setInputError(`Enter a whole-number percentage from ${MASCOT_SCALE_MIN}% to ${MASCOT_SCALE_MAX}%.`);
  };

  const applyState = (data: Record<string, unknown>) => {
    const next = normalizeMascotSettings(data.settings);
    setSettings(next);
    setSavedSettings(next);
    if (data.publishedSettings) setPublishedSettings(normalizeMascotSettings(data.publishedSettings));
    setDraftUpdatedAt(typeof data.draftUpdatedAt === 'string' ? data.draftUpdatedAt : null);
    setDraftUpdatedBy(typeof data.draftUpdatedBy === 'string' ? data.draftUpdatedBy : null);
    setPublishedAt(typeof data.publishedAt === 'string' ? data.publishedAt : null);
    setCanPublishDraft(data.canPublish === true);
    setNumberInput({
      desktop: String(next.desktopScalePercent),
      mobile: String(next.mobileScalePercent),
    });
  };

  const saveDraft = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/mascot-settings/draft', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Draft-Updated-At': draftUpdatedAt ?? 'none',
        },
        body: JSON.stringify({ settings }),
      });
      const data = await readResponse(response);
      applyState(data);
      setNotice('Mascot display and size draft saved. Visitors still see the published values.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save mascot settings.');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const data = await readResponse(await fetch('/api/admin/mascot-settings/publish', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }));
      applyState(data);
      setNotice('Mascot display and size settings published to the public website.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not publish mascot settings.');
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    if (!window.confirm('Discard the saved mascot draft and restore the currently published display mode and sizes? Other Page Content drafts will be preserved.')) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const data = await readResponse(await fetch('/api/admin/mascot-settings/discard', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }));
      applyState(data);
      setNotice('Mascot draft discarded. Other saved website drafts were preserved.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not discard mascot settings.');
    } finally {
      setSaving(false);
    }
  };

  const toggleHistory = async () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setError('');
    try {
      const data = await readResponse(await fetch('/api/admin/mascot-settings/revisions', { credentials: 'same-origin' }));
      setHistory(Array.isArray(data.revisions) ? data.revisions as MascotRevision[] : []);
      setHistoryOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load mascot version history.');
    }
  };

  const restore = async (revision: MascotRevision) => {
    if (!window.confirm(`Restore the mascot display mode and sizes from ${dateLabel(revision.createdAt)} as a draft? The public site will not change until you publish.`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/mascot-settings/restore', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Draft-Updated-At': draftUpdatedAt ?? 'none',
        },
        body: JSON.stringify({ revisionId: revision.id }),
      });
      const data = await readResponse(response);
      applyState(data);
      setHistoryOpen(false);
      setNotice('Previous mascot display mode and sizes restored as a draft. Other site settings were not changed.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not restore the selected mascot version.');
    } finally {
      setSaving(false);
    }
  };

  const settingControl = (device: 'desktop' | 'mobile', label: string, value: number) => (
    <section className="rounded-2xl border border-[#304135] bg-[#131D16] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[#ECF3EE]">{label}</h2>
          <p className="mt-1 text-xs text-[#A9B8AD]">100% matches NEO’s current responsive size.</p>
        </div>
        <button
          type="button"
          disabled={!canEdit || saving || value === DEFAULT_MASCOT_SETTINGS[device === 'desktop' ? 'desktopScalePercent' : 'mobileScalePercent']}
          onClick={() => updateSetting(device, 100)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#47594C] px-3 text-xs font-semibold text-[#D7E3D9] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset to 100%
        </button>
      </div>
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_112px] items-center gap-4">
        <label className="block">
          <span className="sr-only">{label} percentage slider</span>
          <input
            type="range"
            min={MASCOT_SCALE_MIN}
            max={MASCOT_SCALE_MAX}
            step={1}
            value={value}
            disabled={!canEdit || saving}
            onChange={(event) => updateSetting(device, Number(event.target.value))}
            className="w-full accent-[#67D882]"
            aria-label={`${label} slider`}
          />
          <span className="mt-1 flex justify-between text-[10px] text-[#819087]"><span>{MASCOT_SCALE_MIN}%</span><span>{MASCOT_SCALE_MAX}%</span></span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold text-[#A9B8AD]">Size (%)</span>
          <input
            type="number"
            min={MASCOT_SCALE_MIN}
            max={MASCOT_SCALE_MAX}
            step={1}
            value={numberInput[device]}
            disabled={!canEdit || saving}
            onChange={(event) => handleNumberInput(device, event.target.value)}
            onBlur={() => commitNumberInput(device)}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            className="min-h-10 w-full rounded-lg border border-[#33453A] bg-[#101913] px-3 text-sm text-[#ECF3EE] outline-none focus:border-[#67D8B7] focus:ring-2 focus:ring-[#67D8B7]/15 disabled:opacity-50"
            aria-label={`${label} percentage`}
            aria-invalid={Boolean(inputError)}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-[#A9B8AD]">Current size: <strong className="text-[#ECF3EE]">{value}%</strong></p>
    </section>
  );

  return (
    <div className="admin-content-manager admin-mascot-settings space-y-6">
      <header className="flex flex-wrap justify-end gap-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPreviewOpen((open) => !open)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#47594C] px-3 text-xs font-bold text-[#D7E3D9] hover:bg-white/5">
            <Eye className="h-4 w-4" /> {previewOpen ? 'Hide preview' : 'Preview'}
          </button>
          <button type="button" onClick={() => void toggleHistory()} disabled={loading || saving} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#47594C] px-3 text-xs font-bold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50">
            <History className="h-4 w-4" /> {historyOpen ? 'Close history' : 'Previous versions'}
          </button>
          {canEdit && <button type="button" onClick={() => void discard()} disabled={loading || saving || (!unpublished && !dirty)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-400/30 px-3 text-xs font-bold text-rose-200 hover:bg-rose-500/10 disabled:opacity-40">
            <RotateCcw className="h-4 w-4" /> Discard
          </button>}
          {canEdit && <button type="button" onClick={() => void saveDraft()} disabled={loading || saving || !dirty || Boolean(inputError)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#47594C] px-3 text-xs font-bold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50">
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
          </button>}
          {canPublish && <button type="button" onClick={() => void publish()} disabled={loading || saving || dirty || !unpublished || !canPublishDraft} title={!canPublishDraft ? 'A published site-content version is required before publishing mascot settings.' : undefined} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#286D3B] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#205C31] disabled:opacity-50">
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish
          </button>}
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}
      {inputError && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{inputError}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"><Check className="mr-2 inline h-4 w-4" />{notice}</p>}

      {loading ? (
        <div role="status" className="grid min-h-48 place-items-center text-sm text-[#A9B8AD]"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" /> Loading mascot settings…</div>
      ) : (
        <>
          <div role="status" className={`rounded-xl border px-4 py-3 text-xs ${dirty ? 'border-amber-300/25 bg-amber-400/10 text-amber-100' : 'border-[#304135] bg-[#131D16] text-[#A9B8AD]'}`}>
            <strong>{dirty ? 'Unsaved edits' : unpublished ? 'Draft saved · unpublished' : 'No unsaved changes'}</strong>
            <span> · Last saved {dateLabel(draftUpdatedAt)}{draftUpdatedBy ? ` by ${draftUpdatedBy}` : ''} · Published {dateLabel(publishedAt)}</span>
            {!canEdit && <span> · View-only access</span>}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-[#304135] bg-[#131D16] p-4 sm:p-5 xl:col-span-2">
              <div>
                <h2 className="text-sm font-bold text-[#ECF3EE]">Display mode</h2>
                <p className="mt-1 text-xs text-[#A9B8AD]">Choose the supplied animated SVG model or the current 3D NEO. The selected mode is saved with the existing draft and publish workflow.</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-3" role="radiogroup" aria-label="NEO display mode">
                {(['3d', '2d'] as const).map((renderer) => (
                  <button
                    key={renderer}
                    type="button"
                    role="radio"
                    aria-checked={settings.renderer === renderer}
                    disabled={!canEdit || saving}
                    onClick={() => updateRenderer(renderer)}
                    className={`min-h-10 rounded-xl border px-5 text-sm font-semibold transition ${
                      settings.renderer === renderer
                        ? 'border-[#67D882] bg-[#67D882]/10 text-[#C7F36B]'
                        : 'border-[#47594C] text-[#D7E3D9] hover:bg-white/5'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {renderer.toUpperCase()}
                  </button>
                ))}
              </div>
            </section>
            {settingControl('desktop', 'Desktop & tablet size', settings.desktopScalePercent)}
            {settingControl('mobile', 'Mobile size', settings.mobileScalePercent)}
          </div>

          {previewOpen && (
            <section className="overflow-hidden rounded-2xl border border-[#304135] bg-[#19241D]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#304135] p-4 sm:p-5">
                <div>
                  <h2 className="text-sm font-bold text-[#ECF3EE]">NEO {settings.renderer.toUpperCase()} preview</h2>
                  <p className="mt-1 text-xs text-[#A9B8AD]">Preview uses the current draft. The public website continues to use published settings.</p>
                </div>
                <div className="flex items-center gap-2" role="group" aria-label="Preview device">
                  <button type="button" aria-pressed={previewDevice === 'desktop'} onClick={() => setPreviewDevice('desktop')} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${previewDevice === 'desktop' ? 'border-[#67D882] bg-[#67D882]/10 text-[#C7F36B]' : 'border-[#47594C] text-[#D7E3D9]'}`}>
                    <Monitor className="h-4 w-4" /> Desktop / tablet
                  </button>
                  <button type="button" aria-pressed={previewDevice === 'mobile'} onClick={() => setPreviewDevice('mobile')} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${previewDevice === 'mobile' ? 'border-[#67D882] bg-[#67D882]/10 text-[#C7F36B]' : 'border-[#47594C] text-[#D7E3D9]'}`}>
                    <Smartphone className="h-4 w-4" /> Mobile
                  </button>
                </div>
              </div>
              <div className="grid place-items-center p-4 sm:p-6">
                <div className={`relative grid place-items-center overflow-hidden rounded-2xl border border-dashed border-[#47594C] bg-[#101713] ${previewDevice === 'desktop' ? 'h-[390px] w-full max-w-[460px]' : 'h-[280px] w-full max-w-[330px]'}`}>
                  <NearGrowMascot
                    key={previewDevice}
                    size="xl"
                    interactive={false}
                    sizeSettings={settings}
                    onRendererFallback={() => setPreviewFallback(true)}
                    previewBaseSize={previewBaseSize}
                    previewDevice={previewDevice}
                    className="!h-full !w-full"
                  />
                </div>
                <p className="mt-3 text-xs text-[#A9B8AD]">
                  {previewDevice === 'mobile' ? settings.mobileScalePercent : settings.desktopScalePercent}% of current {previewDevice} size · {previewFallback
                    ? 'Animated Canvas fallback (WebGL unavailable)'
                    : settings.renderer === '2d' ? 'Supplied animated SVG renderer' : '3D renderer'}
                </p>
              </div>
            </section>
          )}

          {historyOpen && (
            <section className="rounded-2xl border border-[#304135] bg-[#19241D] p-4 sm:p-5">
              <h2 className="text-sm font-bold text-[#ECF3EE]">Mascot size history</h2>
              <p className="mt-1 text-xs text-[#A9B8AD]">Restoring a previous size creates a draft and changes no other site settings.</p>
              {history.length ? (
                <ul className="mt-4 space-y-3">
                  {history.map((revision) => (
                    <li key={revision.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#304135] bg-[#131D16] p-3">
                      <div className="text-xs text-[#D7E3D9]">
                        <p className="font-semibold">{dateLabel(revision.createdAt)} · {revision.actorLabel}</p>
                        <p className="mt-1 text-[#A9B8AD]">{revision.settings.renderer.toUpperCase()} · Desktop {revision.settings.desktopScalePercent}% · Mobile {revision.settings.mobileScalePercent}% · {revision.action.replaceAll('_', ' ')}</p>
                      </div>
                      {canEdit && <button type="button" disabled={saving} onClick={() => void restore(revision)} className="rounded-lg border border-[#47594C] px-3 py-2 text-xs font-semibold text-[#D7E3D9] hover:bg-white/5 disabled:opacity-50">Restore as draft</button>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-4 text-sm text-[#A9B8AD]">No previous mascot versions are available.</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
