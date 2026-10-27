import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Eye, EyeOff, ImagePlus, LoaderCircle, Plus, Trash2, Users } from 'lucide-react';
import { TEAM_SEED, initials, sortTeam, type TeamGroup, type TeamMember } from '../../data/teamData';
import { normalizeTeamUrl } from '../../data/teamLinks';
import { isSupportedTeamPhotoReference } from '../../data/teamPhoto';
import { uploadAdminMedia } from './uploadAdminMedia';

interface Props {
  onBack: () => void;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
type PhotoUploadState = { status: 'uploading' | 'uploaded' | 'failed'; error?: string };
const GROUPS: { key: TeamGroup; label: string; target: number }[] = [
  { key: 'mentor', label: 'Strategic Mentors', target: 4 },
  { key: 'core', label: 'Core Team', target: 7 },
];

async function apiMessage(response: Response) {
  let result: { message?: string } = {};
  try {
    result = await response.clone().json() as { message?: string };
  } catch {
    const contentType = response.headers.get('content-type') || 'no Content-Type header';
    return `Request failed (${response.status}) at ${response.url || '/api/admin/team'} (${contentType}). This response is not from the NearGrow Express API. Start the app with "npm run dev" and open the exact URL printed by the server; avoid a Vite-only or stale server.`;
  }
  return result.message || `Request failed (${response.status}).`;
}

async function apiData<T>(response: Response): Promise<T> {
  let data: unknown;
  try {
    data = await response.clone().json();
  } catch {
    const contentType = response.headers.get('content-type') || 'no Content-Type header';
    throw new Error(`The team API at ${response.url || '/api/admin/team'} returned ${response.status} ${response.statusText} (${contentType}), not JSON. Use the URL printed by the Express server started with "npm run dev"; a Vite-only or stale server does not provide the team API.`);
  }
  if (!data || typeof data !== 'object') throw new Error('The team API returned an unexpected response.');
  return data as T;
}

function requestError(error: unknown): string {
  if (error instanceof TypeError) return 'Could not connect to the NearGrow Ads server. Check that the server is running and try again.';
  return error instanceof Error ? error.message : 'The team request could not be completed.';
}

/** Downscale phone photos to ≤ 900px (long edge) WebP before upload; falls back to the original file. */
async function prepareImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

const reindex = (list: TeamMember[]): TeamMember[] =>
  GROUPS.flatMap(({ key }) => list.filter((m) => m.group === key).map((m, i) => ({ ...m, order: i + 1 })));

export function AdminTeamManager({ onBack, canCreate = true, canEdit = true, canDelete = true }: Props) {
  const [members, setMembers] = useState<TeamMember[]>(() => sortTeam(TEAM_SEED));
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string>(TEAM_SEED[0]?.id ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoUploads, setPhotoUploads] = useState<Record<string, PhotoUploadState>>({});
  const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [errorProfileId, setErrorProfileId] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef('');
  const uploadSequenceRef = useRef(new Map<string, number>());
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const retryFilesRef = useRef(new Map<string, File>());
  const previewUrlsRef = useRef(new Map<string, string>());
  const changeVersionRef = useRef(0);

  useEffect(() => () => {
    uploadControllersRef.current.forEach((controller, id) => {
      uploadSequenceRef.current.set(id, (uploadSequenceRef.current.get(id) || 0) + 1);
      controller.abort();
    });
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const dark = true;
  const text = dark ? 'text-[#ECF3EE]' : 'text-[#1B261D]';
  const muted = dark ? 'text-[#A9B8AD]' : 'text-[#778178]';
  const panel = `rounded-3xl border p-5 shadow-sm sm:p-6 ${dark ? 'border-[#304135] bg-[#19241D]' : 'border-[#E2E8E1] bg-white'}`;
  const field = `w-full rounded-xl border px-3.5 py-3 text-sm outline-none focus:border-[#55A66A] focus:ring-4 focus:ring-[#3EA259]/10 ${dark ? 'border-[#304135] bg-[#131D16] text-[#ECF3EE] placeholder:text-[#718077]' : 'border-[#DFE6DF] bg-[#FAFBF9] text-[#1B261D] placeholder:text-[#9AA59B]'}`;
  const label = `mb-2 block text-xs font-semibold ${dark ? 'text-[#B8C7BC]' : 'text-[#526056]'}`;

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/team', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiMessage(response));
        return apiData<{ members: TeamMember[]; revision: string }>(response);
      })
      .then(({ members: stored, revision }) => {
        if (!alive) return;
        if (!Array.isArray(stored)) throw new Error('The team API response did not include a member list.');
        if (!revision) throw new Error('The team API response did not include a revision token.');
        revisionRef.current = revision;
        // Empty store = first run: start from the bundled seed; nothing is persisted until "Save changes".
        const list = stored.length ? sortTeam(stored) : sortTeam(TEAM_SEED);
        setMembers(list);
        setSavedIds(new Set(stored.map((member) => member.id)));
        setSelectedId(list[0]?.id ?? '');
      })
      .catch((err: unknown) => alive && setError(requestError(err)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const selected = members.find((m) => m.id === selectedId);
  const selectedUpload = selected ? photoUploads[selected.id] : undefined;
  const pendingUploads = members.some((member) => photoUploads[member.id]?.status === 'uploading');
  const selectedIsNew = Boolean(selected && !savedIds.has(selected.id));
  const canChangeSelected = selectedIsNew ? canCreate : canEdit;

  const change = useCallback((next: TeamMember[]) => { changeVersionRef.current += 1; setMembers(next); setDirty(true); setNotice(''); }, []);
  const patch = (id: string, values: Partial<TeamMember>) => {
    changeVersionRef.current += 1;
    setMembers((current) => current.map((member) => (member.id === id ? { ...member, ...values } : member)));
    if ('imageUrl' in values) {
      setPhotoErrors((current) => {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
    setDirty(true);
    setNotice('');
  };

  const move = (id: string, dir: -1 | 1) => {
    if (!canEdit) return;
    const member = members.find((m) => m.id === id);
    if (!member) return;
    const group = members.filter((m) => m.group === member.group);
    const i = group.findIndex((m) => m.id === id);
    const j = i + dir;
    if (j < 0 || j >= group.length) return;
    [group[i], group[j]] = [group[j], group[i]];
    change(reindex([...members.filter((m) => m.group !== member.group), ...group]));
  };

  const add = (group: TeamGroup) => {
    if (!canCreate) return;
    const id = `${group}-${Date.now().toString(36)}`;
    const member: TeamMember = { id, group, name: '', role: '', tag: '', bio: '', imageUrl: '', socialUrl: '', order: 99, visible: false };
    change(reindex([...members, member]));
    setSelectedId(id);
  };

  const remove = (id: string) => {
    const member = members.find((m) => m.id === id);
    if (!member || (savedIds.has(member.id) ? !canDelete : !canCreate)) return;
    if (!window.confirm(`Remove ${member.name || 'this profile'}? This cannot be undone after you save.`)) return;
    cancelUpload(id);
    const next = reindex(members.filter((m) => m.id !== id));
    change(next);
    setSelectedId(next[0]?.id ?? '');
  };

  const releasePhotoPreview = (id: string) => {
    const url = previewUrlsRef.current.get(id);
    if (url) URL.revokeObjectURL(url);
    previewUrlsRef.current.delete(id);
  };

  const upload = async (id: string, file?: File) => {
    const member = members.find((candidate) => candidate.id === id);
    if (!file || !member || !(savedIds.has(id) ? canEdit : canCreate)) return;
    setError('');
    const imageExtension = file.name.match(/\.(png|jpe?g|webp)$/i)?.[1];
    if (!/^image\/(png|x-png|jpg|p?jpeg|webp)$/.test(file.type.toLowerCase()) && !(!file.type && imageExtension)) {
      const message = 'Use a PNG, JPG, JPEG or WebP image.';
      setPhotoUploads((current) => ({ ...current, [id]: { status: 'failed', error: message } }));
      setError(`${member.name || 'This profile'}: ${message}`);
      setErrorProfileId(id);
      return;
    }
    if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
      const message = 'Image must be larger than 0 bytes and no larger than 15 MB.';
      setPhotoUploads((current) => ({ ...current, [id]: { status: 'failed', error: message } }));
      setError(`${member.name || 'This profile'}: ${message}`);
      setErrorProfileId(id);
      return;
    }

    const sequence = (uploadSequenceRef.current.get(id) || 0) + 1;
    uploadSequenceRef.current.set(id, sequence);
    uploadControllersRef.current.get(id)?.abort();
    const controller = new AbortController();
    uploadControllersRef.current.set(id, controller);
    retryFilesRef.current.set(id, file);
    releasePhotoPreview(id);
    previewUrlsRef.current.set(id, URL.createObjectURL(file));
    setPhotoUploads((current) => ({ ...current, [id]: { status: 'uploading' } }));
    setErrorProfileId('');
    setPhotoErrors((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      const blob = await prepareImage(file);
      if (uploadSequenceRef.current.get(id) !== sequence) return;
      if (blob.size < 1 || blob.size > MAX_UPLOAD_BYTES) throw new Error('Image must be larger than 0 bytes and no larger than 15 MB after resizing.');
      const { url } = await uploadAdminMedia({
        purpose: 'team',
        file: blob,
        fileName: file.name,
        signal: controller.signal,
      });
      if (uploadSequenceRef.current.get(id) !== sequence) return;
      if (!isSupportedTeamPhotoReference(url) || !url) {
        throw new Error('The upload service returned an unsupported photo reference. The previous photo was kept.');
      }
      patch(id, { imageUrl: url });
      retryFilesRef.current.delete(id);
      releasePhotoPreview(id);
      setPhotoUploads((current) => ({ ...current, [id]: { status: 'uploaded' } }));
    } catch (err) {
      if (uploadSequenceRef.current.get(id) !== sequence) return;
      const message = requestError(err);
      releasePhotoPreview(id);
      retryFilesRef.current.set(id, file);
      setPhotoUploads((current) => ({ ...current, [id]: { status: 'failed', error: message } }));
      setError(`${member.name || 'This profile'} photo upload failed. The previous photo was kept. Select this profile to retry.`);
      setErrorProfileId(id);
    } finally {
      if (uploadSequenceRef.current.get(id) === sequence) {
        uploadControllersRef.current.delete(id);
      }
    }
  };

  const cancelUpload = (id: string) => {
    uploadSequenceRef.current.set(id, (uploadSequenceRef.current.get(id) || 0) + 1);
    uploadControllersRef.current.get(id)?.abort();
    uploadControllersRef.current.delete(id);
    releasePhotoPreview(id);
    retryFilesRef.current.delete(id);
    setPhotoUploads((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const save = async () => {
    if (saving || members.some((member) => photoUploads[member.id]?.status === 'uploading')) return;
    const submittedVersion = changeVersionRef.current;
    setSaving(true); setError(''); setErrorProfileId(''); setNotice('');
    try {
      const invalidPhotos = members.filter((member) => !isSupportedTeamPhotoReference(member.imageUrl));
      if (invalidPhotos.length) {
        const errors = Object.fromEntries(invalidPhotos.map((member) => [
          member.id,
          'Use an uploaded photo, an HTTPS image URL, or leave this optional photo empty.',
        ]));
        setPhotoErrors(errors);
        setSelectedId(invalidPhotos[0].id);
        setError(`Fix the photo reference for ${invalidPhotos.map((member) => member.name || 'Untitled profile').join(', ')} before saving. Select a profile in the roster to review its photo.`);
        setErrorProfileId(invalidPhotos[0].id);
        return;
      }
      setPhotoErrors({});
      const normalizedMembers = members.map((member) => {
        const socialUrl = normalizeTeamUrl(member.socialUrl);
        if (socialUrl === null) throw new Error(`${member.name || 'This profile'}: enter a valid HTTP or HTTPS LinkedIn or portfolio URL.`);
        return { ...member, socialUrl };
      });
      const response = await fetch('/api/admin/team', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'If-Match': revisionRef.current },
        body: JSON.stringify({ members: reindex(normalizedMembers) }),
      });
      if (!response.ok) throw new Error(await apiMessage(response));
      const data = await apiData<{ members: TeamMember[]; revision: string }>(response);
      revisionRef.current = data.revision;
      setSavedIds(new Set(data.members.map((member) => member.id)));
      if (changeVersionRef.current === submittedVersion) {
        setMembers(sortTeam(data.members));
        setDirty(false);
        setNotice('Saved. The About page now shows these changes.');
      } else {
        setDirty(true);
        setNotice('The submitted changes were saved. Newer edits remain unsaved.');
      }
    } catch (err) {
      setError(requestError(err));
    } finally {
      setSaving(false);
    }
  };

  const counts = useMemo(() => Object.fromEntries(GROUPS.map(({ key }) => [key, members.filter((m) => m.group === key && m.visible).length])), [members]);

  return (
    <main className="admin-portal admin-team-manager min-h-screen" data-admin-theme="dark">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <button type="button" onClick={onBack} className={`mb-4 inline-flex items-center gap-2 text-xs font-semibold ${muted} hover:text-[#328148]`}>
              <ArrowLeft className="h-4 w-4" /> Back to dashboard
            </button>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#328148]">About page</p>
            <h1 className={`mt-1 text-3xl font-bold tracking-tight ${text}`}>Leadership &amp; Team</h1>
            <p className={`mt-2 text-sm ${muted}`}>Add, reorder, hide or replace profiles. Changes go live when you save.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(canCreate || canEdit || canDelete) && <button type="button" onClick={save} disabled={saving || pendingUploads || !dirty} className="admin-team-save inline-flex h-11 items-center gap-2 rounded-xl bg-[#286D3B] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#205C31] disabled:opacity-50">
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {dirty ? 'Save changes' : 'Saved'}
            </button>}
          </div>
        </header>

        {error && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          {errorProfileId && members.some((member) => member.id === errorProfileId) && <button type="button" onClick={() => setSelectedId(errorProfileId)} className="shrink-0 font-semibold underline underline-offset-2">Open affected profile</button>}
        </div>}
        {notice && <p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}

        {loading ? (
          <p className={`${panel} ${muted} text-sm`}>Loading team…</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            {/* roster */}
            <div className="space-y-5">
              {GROUPS.map(({ key, label: groupLabel, target }) => (
                <section key={key} className={panel} aria-label={groupLabel}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className={`flex items-center gap-2 text-sm font-bold ${text}`}><Users className="h-4 w-4 text-[#3EA259]" />{groupLabel}</h2>
                    <span className={`text-xs font-semibold ${counts[key] === target ? 'text-[#3EA259]' : 'text-amber-600'}`}>{counts[key]} / {target} live</span>
                  </div>
                  <ul className="space-y-2">
                    {members.filter((m) => m.group === key).map((m, i, arr) => (
                      <li key={m.id} className={`admin-team-profile-row flex items-center gap-2 rounded-xl border p-2 ${m.id === selectedId ? 'admin-team-profile-selected border-[#3EA259] ring-2 ring-[#3EA259]/15' : dark ? 'border-[#304135]' : 'border-[#E2E8E1]'}`}>
                        <button type="button" onClick={() => setSelectedId(m.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          {m.imageUrl
                            ? <img src={m.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                            : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EAF5EB] text-[11px] font-bold text-[#31834A]">{initials(m.name)}</span>}
                          <span className="min-w-0">
                            <span className={`block truncate text-sm font-semibold ${text} ${m.visible ? '' : 'opacity-50'}`}>{m.name || 'Untitled profile'}</span>
                            <span className={`block truncate text-xs ${muted}`}>{m.role || 'No role yet'}</span>
                            {photoUploads[m.id] && <span className={`mt-0.5 block text-[10px] font-semibold ${photoUploads[m.id].status === 'failed' ? 'text-rose-400' : photoUploads[m.id].status === 'uploading' ? 'text-amber-400' : 'text-emerald-400'}`}>Photo {photoUploads[m.id].status}</span>}
                            {photoErrors[m.id] && <span className="mt-0.5 block truncate text-[10px] font-semibold text-rose-400">{photoErrors[m.id]}</span>}
                          </span>
                        </button>
                        <div className="flex shrink-0">
                          {canEdit && <IconBtn label="Move up" disabled={i === 0} onClick={() => move(m.id, -1)} dark={dark}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>}
                          {canEdit && <IconBtn label="Move down" disabled={i === arr.length - 1} onClick={() => move(m.id, 1)} dark={dark}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {canCreate && <button type="button" onClick={() => add(key)} className={`admin-team-add mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed text-xs font-semibold ${dark ? 'border-[#405344] text-[#B8C7BC]' : 'border-[#CBD8CC] text-[#526056]'} hover:border-[#3EA259] hover:text-[#3EA259]`}>
                    <Plus className="h-4 w-4" /> Add {key === 'mentor' ? 'mentor' : 'team member'}
                  </button>}
                </section>
              ))}
            </div>

            {/* editor */}
            <section className={panel} aria-label="Profile editor">
              {!selected ? (
                <p className={`text-sm ${muted}`}>Select a profile to edit.</p>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-4">
                    {(previewUrlsRef.current.get(selected.id) || selected.imageUrl)
                      ? <img src={previewUrlsRef.current.get(selected.id) || selected.imageUrl} alt={`Portrait of ${selected.name}`} className="h-24 w-20 rounded-xl object-cover" />
                      : <div className="flex h-24 w-20 items-center justify-center rounded-xl bg-[#EAF5EB] text-lg font-bold text-[#31834A]">{initials(selected.name)}</div>}
                    <div className="space-y-2">
                      <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/pjpeg,image/png,image/x-png,image/webp" className="sr-only" id="team-photo" disabled={!canChangeSelected} onChange={(e) => { void upload(selected.id, e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
                      <label htmlFor="team-photo" className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold ${canChangeSelected ? 'cursor-pointer hover:border-[#3EA259]' : 'cursor-not-allowed opacity-50'} ${dark ? 'border-[#405344] bg-[#202D24] text-[#ECF3EE]' : 'border-[#DFE6DF] bg-white text-[#526056]'}`}>
                        {selectedUpload?.status === 'uploading' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} {selected.imageUrl ? 'Replace photo' : 'Upload photo'}
                      </label>
                      {selectedUpload && <p role="status" className={`text-xs font-semibold ${selectedUpload.status === 'failed' ? 'text-rose-400' : selectedUpload.status === 'uploading' ? 'text-amber-400' : 'text-emerald-400'}`}>
                        Photo {selectedUpload.status[0].toUpperCase() + selectedUpload.status.slice(1)}{selectedUpload.error ? `: ${selectedUpload.error}` : ''}
                      </p>}
                      {selectedUpload?.status === 'failed' && retryFilesRef.current.has(selected.id) && canChangeSelected && <button type="button" onClick={() => { void upload(selected.id, retryFilesRef.current.get(selected.id)); }} className="block text-xs font-semibold text-emerald-400 underline underline-offset-2">Retry upload</button>}
                      {photoErrors[selected.id] && <p className="text-xs font-semibold text-rose-400">{photoErrors[selected.id]}</p>}
                      {(selected.imageUrl || selectedUpload?.status === 'uploading') && canChangeSelected && <button type="button" onClick={() => { cancelUpload(selected.id); patch(selected.id, { imageUrl: '' }); }} className={`block text-xs font-semibold ${muted} hover:text-rose-600`}>{selectedUpload?.status === 'uploading' ? 'Cancel upload and remove photo' : 'Remove photo'}</button>}
                      <p className={`text-[11px] ${muted}`}>Portrait 4:5, JPG/JPEG/PNG/WebP up to 15 MB. Resized automatically.</p>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className={label} htmlFor="t-name">Full name</label><input id="t-name" disabled={!canChangeSelected} className={field} maxLength={80} value={selected.name} onChange={(e) => patch(selected.id, { name: e.target.value })} /></div>
                    <div><label className={label} htmlFor="t-role">{selected.group === 'mentor' ? 'Designation' : 'Role'}</label><input id="t-role" disabled={!canChangeSelected} className={field} maxLength={100} value={selected.role} onChange={(e) => patch(selected.id, { role: e.target.value })} /></div>
                    {selected.group === 'mentor' && (
                      <div><label className={label} htmlFor="t-tag">Expertise tag</label><input id="t-tag" disabled={!canChangeSelected} className={field} maxLength={40} value={selected.tag ?? ''} onChange={(e) => patch(selected.id, { tag: e.target.value })} /></div>
                    )}
                    <div className={selected.group === 'mentor' ? '' : 'sm:col-span-2'}><label className={label} htmlFor="t-social">LinkedIn / portfolio URL</label><input id="t-social" disabled={!canChangeSelected} type="text" inputMode="url" placeholder="https://www.linkedin.com/in/…" className={field} maxLength={300} value={selected.socialUrl} onChange={(e) => patch(selected.id, { socialUrl: e.target.value })} /></div>
                  </div>

                  <div>
                    <label className={label} htmlFor="t-bio">Short bio <span className={`font-normal ${muted}`}>({selected.bio.length}/320)</span></label>
                    <textarea id="t-bio" disabled={!canChangeSelected} rows={4} className={field} maxLength={320} value={selected.bio} onChange={(e) => patch(selected.id, { bio: e.target.value })} />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {canChangeSelected && <button type="button" onClick={() => patch(selected.id, { visible: !selected.visible })} className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold ${dark ? 'border-[#405344] text-[#ECF3EE]' : 'border-[#DFE6DF] text-[#526056]'}`} aria-pressed={selected.visible}>
                      {selected.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} {selected.visible ? 'Visible on site' : 'Hidden (draft)'}
                    </button>}
                    {(savedIds.has(selected.id) ? canDelete : canCreate) && <button type="button" onClick={() => remove(selected.id)} className="admin-team-remove inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50">
                      <Trash2 className="h-4 w-4" /> Remove profile
                    </button>}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function IconBtn({ label, disabled, onClick, dark, children }: { label: string; disabled?: boolean; onClick: () => void; dark: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${dark ? 'text-[#B8C7BC] hover:bg-[#26372B]' : 'text-[#526056] hover:bg-[#F1F5F0]'} disabled:opacity-30`}>
      {children}
    </button>
  );
}
