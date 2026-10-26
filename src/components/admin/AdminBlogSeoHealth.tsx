import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, Clock3, Eye, LoaderCircle, RefreshCw, Search, ShieldAlert, Sparkles } from 'lucide-react';
import type { ManagedBlogPost } from '../../data/blogApi';
import { BLOG_SEO_ANALYZER_VERSION, blogSeoGrade, blogSeoNeedsAttention, type BlogSeoAnalysis, type BlogSeoCheckStatus } from '../../data/blogSeoHealth';
import { resolveBlogImage } from '../../data/blogData';

type SeoAnalysisRecord = BlogSeoAnalysis & {
  stale: boolean;
  currentStatus: 'draft' | 'published';
};

type SummaryFilter = 'all' | 'attention' | 'critical' | 'healthy' | 'unscanned';

interface Props {
  posts: ManagedBlogPost[];
  canEdit: boolean;
  onEdit: (slug: string, editorAnchor?: string) => void;
}

const checkStatusLabels: Record<BlogSeoCheckStatus, string> = {
  passed: 'Passed',
  warning: 'Warning',
  critical: 'Critical',
  not_applicable: 'Not applicable',
  not_checked: 'Not checked',
};

const checkStatusClass: Record<BlogSeoCheckStatus, string> = {
  passed: 'text-emerald-300',
  warning: 'text-amber-300',
  critical: 'text-rose-300',
  not_applicable: 'text-[#94A399]',
  not_checked: 'text-sky-300',
};

function apiError(response: Response, body: { message?: string }): Error {
  const message = response.status === 401
    ? 'Your admin session has expired. Sign in again to load SEO Health.'
    : response.status === 403
      ? body.message || 'Your role does not have permission to perform this SEO Health action.'
      : body.message || `SEO Health request failed (${response.status}).`;
  return new Error(message);
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body as { message?: string });
  return body as T;
}

function findingCounts(analysis: SeoAnalysisRecord | undefined) {
  if (!isCurrentAnalysis(analysis)) return { critical: 0, warning: 0 };
  return {
    critical: analysis?.findings.filter((finding) => finding.severity === 'critical').length || 0,
    warning: analysis?.findings.filter((finding) => finding.severity === 'warning').length || 0,
  };
}

function isCurrentAnalysis(analysis: SeoAnalysisRecord | undefined): analysis is SeoAnalysisRecord {
  return Boolean(analysis && !analysis.stale && analysis.analyzerVersion === BLOG_SEO_ANALYZER_VERSION);
}

function needsAttention(analysis: SeoAnalysisRecord | undefined): boolean {
  return blogSeoNeedsAttention(analysis, !isCurrentAnalysis(analysis));
}

function scanTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function AdminBlogSeoHealth({ posts, canEdit, onEdit }: Props) {
  const [analyses, setAnalyses] = useState<SeoAnalysisRecord[]>([]);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>('all');
  const [showAttentionView, setShowAttentionView] = useState(false);
  const [query, setQuery] = useState('');
  const [issueFilter, setIssueFilter] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedFinding, setSelectedFinding] = useState<{ post: ManagedBlogPost; analysis: SeoAnalysisRecord } | null>(null);
  const [busy, setBusy] = useState(true);
  const [resultsLoaded, setResultsLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, failed: 0, total: 0 });
  const [failedSlugs, setFailedSlugs] = useState<string[]>([]);
  const [error, setError] = useState('');

  const fetchAnalyses = async () => {
    const result = await readJson<{ analyses: SeoAnalysisRecord[] }>(
      await fetch('/api/admin/blogs/seo-health', { credentials: 'same-origin', cache: 'no-store' }),
    );
    setAnalyses(result.analyses);
    setResultsLoaded(true);
  };

  useEffect(() => {
    let active = true;
    void fetch('/api/admin/blogs/seo-health', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => readJson<{ analyses: SeoAnalysisRecord[] }>(response))
      .then(({ analyses: result }) => {
        if (!active) return;
        setAnalyses(result);
        setResultsLoaded(true);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'SEO Health results could not be loaded.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  const eligiblePosts = useMemo(
    () => posts.filter((post) => includeDrafts || post.status === 'published'),
    [includeDrafts, posts],
  );
  const analysisById = useMemo(() => new Map(analyses.map((analysis) => [analysis.articleId, analysis])), [analyses]);
  const analysisBySlug = useMemo(() => new Map(analyses.map((analysis) => [analysis.slug, analysis])), [analyses]);
  const currentAnalysis = (post: ManagedBlogPost) => {
    const analysis = post.id ? analysisById.get(post.id) : analysisBySlug.get(post.slug);
    return analysis?.slug === post.slug ? analysis : undefined;
  };
  const counts = useMemo(() => {
    const values = eligiblePosts.map(currentAnalysis);
    const failedSlugSet = new Set(failedSlugs);
    return {
      attention: values.filter((analysis) => needsAttention(analysis)).length,
      critical: values.filter((analysis) => findingCounts(analysis).critical > 0).length,
      healthy: values.filter((analysis) => Boolean(isCurrentAnalysis(analysis) && !needsAttention(analysis))).length,
      unscanned: eligiblePosts.filter((post, index) => !isCurrentAnalysis(values[index]) && !failedSlugSet.has(post.slug)).length,
    };
  }, [eligiblePosts, analysisById, analysisBySlug, failedSlugs]);

  const displayedPosts = useMemo(() => eligiblePosts
    .map((post) => ({ post, analysis: currentAnalysis(post) }))
    .filter(({ post, analysis }) => {
      if (!resultsLoaded) return false;
      if (showAttentionView && !needsAttention(analysis)) return false;
      if (summaryFilter === 'attention' && !needsAttention(analysis)) return false;
      if (summaryFilter === 'critical' && findingCounts(analysis).critical === 0) return false;
      if (summaryFilter === 'healthy' && (!isCurrentAnalysis(analysis) || needsAttention(analysis))) return false;
      if (summaryFilter === 'unscanned' && (isCurrentAnalysis(analysis) || failedSlugs.includes(post.slug))) return false;
      if (query.trim() && !`${post.title} ${post.category} ${post.excerpt}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
      if (issueFilter !== 'all') {
        if (!isCurrentAnalysis(analysis)) return false;
        if (issueFilter === 'critical' || issueFilter === 'warning') {
          if (!analysis.findings.some((finding) => finding.severity === issueFilter)) return false;
        } else if (!analysis.findings.some((finding) => finding.checkId === issueFilter)) return false;
      }
      return true;
    })
    .sort((left, right) => {
      const leftCritical = findingCounts(left.analysis).critical;
      const rightCritical = findingCounts(right.analysis).critical;
      return rightCritical - leftCritical ||
        (left.analysis?.score ?? -1) - (right.analysis?.score ?? -1) ||
        left.post.title.localeCompare(right.post.title);
    }), [eligiblePosts, failedSlugs, issueFilter, query, resultsLoaded, showAttentionView, summaryFilter, analysisById, analysisBySlug]);

  const runScan = async (slugs: string[]) => {
    if (!canEdit || !slugs.length || scanning) return;
    const batches: string[][] = [];
    for (let index = 0; index < slugs.length; index += 10) batches.push(slugs.slice(index, index + 10));
    setScanning(true);
    setError('');
    setFailedSlugs((current) => current.filter((slug) => !slugs.includes(slug)));
    setProgress({ completed: 0, failed: 0, total: slugs.length });
    let completed = 0;
    let failed = 0;
    for (const batch of batches) {
      try {
        const result = await readJson<{ analyses: SeoAnalysisRecord[]; completed: number; failed: number }>(
          await fetch('/api/admin/blogs/seo-health/scan', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slugs: batch, includeDrafts }),
          }),
        );
        setAnalyses((current) => {
          const next = new Map(current.map((analysis) => [analysis.articleId, analysis]));
          result.analyses.forEach((analysis) => next.set(analysis.articleId, analysis));
          return [...next.values()];
        });
        setResultsLoaded(true);
        completed += result.completed;
        failed += result.failed;
      } catch (reason) {
        failed += batch.length;
        setFailedSlugs((current) => [...current, ...batch]);
        setError(reason instanceof Error ? reason.message : 'A scan batch failed.');
      }
      setProgress({ completed, failed, total: slugs.length });
    }
    setScanning(false);
    setSelected([]);
  };

  const summaryCard = (key: SummaryFilter, title: string, value: number | string, icon: typeof AlertTriangle, style: string) => {
    const Icon = icon;
    return (
      <button type="button" aria-pressed={summaryFilter === key} onClick={() => { setSummaryFilter(summaryFilter === key ? 'all' : key); setShowAttentionView(false); }} className={`min-w-0 rounded-2xl border p-3 text-left transition hover:border-[#67D8B7] ${summaryFilter === key ? 'border-[#67D8B7] bg-[#67D8B7]/10' : 'border-[#304135] bg-[#131D16]'}`}>
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${style}`}><Icon className="h-3.5 w-3.5" />{title}</span>
        <span className="mt-1 block text-xl font-bold text-[#ECF3EE]">{value}</span>
      </button>
    );
  };

  const issueOptions = useMemo(() => {
    const unique = new Map<string, string>();
    analyses.forEach((analysis) => analysis.findings.forEach((finding) => unique.set(finding.checkId, finding.field)));
    return [...unique.entries()];
  }, [analyses]);

  return (
    <section className="mb-5 rounded-3xl border border-[#304135] bg-[#19241D] p-4 shadow-sm sm:p-5" aria-labelledby="blog-seo-health-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="blog-seo-health-title" className="font-bold text-[#ECF3EE]">SEO Health</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[#A9B8AD]">Internal SEO checklist score, not a Google ranking score. Each check has a fixed weight totaling 100; warnings earn half credit, critical issues earn none, and unchecked or inapplicable checks are excluded. Partial scans are provisional. Google indexing status is not checked.</p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-[#B8C7BC]">
          <input type="checkbox" checked={includeDrafts} onChange={(event) => { setIncludeDrafts(event.target.checked); setSelected([]); }} />
          Include drafts
        </label>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summaryCard('attention', 'Needs attention', resultsLoaded ? counts.attention : '—', AlertTriangle, 'text-amber-300')}
        {summaryCard('critical', 'Critical issues', resultsLoaded ? counts.critical : '—', ShieldAlert, 'text-rose-300')}
        {summaryCard('healthy', 'Healthy', resultsLoaded ? counts.healthy : '—', CheckCircle2, 'text-emerald-300')}
        {summaryCard('unscanned', 'Not scanned / rescan', resultsLoaded ? counts.unscanned : '—', CircleHelp, 'text-sky-300')}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setShowAttentionView((current) => !current); setSummaryFilter('all'); }} aria-pressed={showAttentionView} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${showAttentionView ? 'border-[#67D8B7] bg-[#67D8B7]/10 text-[#8FE1A0]' : 'border-[#33453A] text-[#B8C7BC]'}`}>Needs Attention view</button>
        {canEdit && <>
          <button type="button" disabled={scanning || !eligiblePosts.length} onClick={() => void runScan(eligiblePosts.map((post) => post.slug))} className="inline-flex items-center gap-2 rounded-xl bg-[#286D3B] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {scanning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Scan all blogs
          </button>
          <button type="button" disabled={scanning || !selected.length} onClick={() => void runScan(selected)} className="rounded-xl border border-[#33453A] px-3 py-2 text-xs font-semibold text-[#B8C7BC] disabled:opacity-50">Rescan selected ({selected.length})</button>
          {failedSlugs.length > 0 && <button type="button" disabled={scanning} onClick={() => void runScan(failedSlugs)} className="rounded-xl border border-rose-400/30 px-3 py-2 text-xs font-semibold text-rose-200 disabled:opacity-50">Retry failed checks ({failedSlugs.length})</button>}
        </>}
        {showAttentionView && (
          <>
            <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-xl border border-[#304135] bg-[#131D16] px-3">
              <Search className="h-3.5 w-3.5 text-[#A9B8AD]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-[#ECF3EE] outline-none" placeholder="Search affected articles" aria-label="Search SEO Health articles" />
            </label>
            <select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)} aria-label="Filter by SEO issue" className="h-9 rounded-xl border border-[#304135] bg-[#131D16] px-2 text-xs text-[#ECF3EE]">
              <option value="all">All issue types</option>
              <option value="critical">Critical issues</option>
              <option value="warning">Warnings</option>
              {issueOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </>
        )}
      </div>

      {scanning && (
        <div className="mt-3 rounded-xl border border-[#304135] bg-[#131D16] p-3" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-xs text-[#B8C7BC]">
            <span>Scanning saved article content and configured public route rules…</span>
            <span>{progress.completed + progress.failed}/{progress.total} · {progress.failed} failed</span>
          </div>
          <progress className="mt-2 h-1.5 w-full accent-[#67D8B7]" value={progress.completed + progress.failed} max={Math.max(1, progress.total)} />
          <p className="mt-2 text-[10px] text-[#8F9E92]">External links and remote HTTPS images are not fetched. Those checks remain Not checked to avoid unsafe requests and false broken-link claims.</p>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-400/30 bg-rose-950/25 px-3 py-2 text-xs text-rose-200">{error} <button type="button" disabled={busy} onClick={() => {
        setBusy(true);
        setError('');
        void fetchAnalyses()
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Retry failed.'))
          .finally(() => setBusy(false));
      }} className="ml-2 underline disabled:opacity-50">Retry loading results</button></p>}

      {(showAttentionView || summaryFilter !== 'all') && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-[#304135]">
          <table className="w-full min-w-[850px] text-left">
            <thead className="bg-[#131D16] text-[10px] uppercase tracking-wide text-[#A9B8AD]">
              <tr>
                {canEdit && <th className="px-3 py-3"><input type="checkbox" aria-label="Select all listed articles" checked={displayedPosts.length > 0 && selected.length === displayedPosts.length} onChange={(event) => setSelected(event.target.checked ? displayedPosts.map(({ post }) => post.slug) : [])} /></th>}
                <th className="px-3 py-3">Article</th><th className="px-3 py-3">Checklist</th><th className="px-3 py-3">Issues</th><th className="px-3 py-3">Main issue</th><th className="px-3 py-3">Last scanned</th><th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#304135]">
              {displayedPosts.map(({ post, analysis }) => {
                const issueCount = findingCounts(analysis);
                const currentAnalysisRecord = isCurrentAnalysis(analysis) ? analysis : undefined;
                const scanFailed = failedSlugs.includes(post.slug);
                const mainFinding = currentAnalysisRecord?.findings.find((finding) => finding.severity === 'critical') || currentAnalysisRecord?.findings[0];
                const thumbnail = resolveBlogImage(post.featuredImage, post.featuredImageAltText || '', post.featuredImageVariants, 'dark').image.url;
                return (
                  <tr key={post.id || post.slug} className="align-top text-xs text-[#ECF3EE]">
                    {canEdit && <td className="px-3 py-3"><input type="checkbox" aria-label={`Select ${post.title}`} checked={selected.includes(post.slug)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, post.slug])] : current.filter((slug) => slug !== post.slug))} /></td>}
                    <td className="max-w-[280px] px-3 py-3">
                      <div className="flex gap-2.5">
                        {thumbnail ? <img src={thumbnail} alt="" className="h-11 w-14 shrink-0 rounded-lg object-cover" /> : <span className="grid h-11 w-14 shrink-0 place-items-center rounded-lg bg-[#26372B]"><Sparkles className="h-4 w-4 text-[#83A889]" /></span>}
                        <div className="min-w-0"><p className="truncate font-semibold">{post.title}</p><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[9px] ${post.status === 'published' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{post.status === 'published' ? 'Published' : 'Draft'}</span></div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {!currentAnalysisRecord ? <span className={scanFailed ? 'text-rose-300' : 'text-sky-300'}>{scanFailed ? 'Scan failed' : analysis ? 'Needs rescan' : 'Not scanned'}</span> : <><strong>{currentAnalysisRecord.score}/100</strong><span className="ml-1 text-[10px] text-[#A9B8AD]">{blogSeoGrade(currentAnalysisRecord.score)}{currentAnalysisRecord.provisional ? ' · provisional' : ''}</span><span className="block pt-1 text-[10px] text-[#8F9E92]">Coverage {currentAnalysisRecord.coverage}%</span>{scanFailed && <span className="block pt-1 text-[10px] text-rose-300">Latest rescan failed; showing saved result</span>}</>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3"><span className="text-rose-300">{issueCount.critical} critical</span><br /><span className="text-amber-300">{issueCount.warning} warnings</span></td>
                    <td className="max-w-[220px] px-3 py-3"><span className="line-clamp-2 text-[#C6D0C8]">{scanFailed && !currentAnalysisRecord ? 'The latest scan failed. Retry it to check this article.' : analysis && !currentAnalysisRecord ? 'Saved article changed or analyzer updated since its last scan.' : mainFinding?.title || (currentAnalysisRecord ? 'No findings' : 'Not scanned')}</span></td>
                    <td className="whitespace-nowrap px-3 py-3 text-[10px] text-[#A9B8AD]">{analysis?.scannedAt ? <><Clock3 className="mr-1 inline h-3 w-3" />{scanTimestamp(analysis.scannedAt)}</> : '—'}</td>
                    <td className="px-3 py-3"><div className="flex justify-end gap-1">
                      <button type="button" disabled={!currentAnalysisRecord} onClick={() => currentAnalysisRecord && setSelectedFinding({ post, analysis: currentAnalysisRecord })} title={!currentAnalysisRecord ? 'Scan to view current issues' : 'View issues'} className="rounded-lg p-2 text-[#B8C7BC] hover:bg-[#26372B] disabled:opacity-40"><Eye className="h-4 w-4" /></button>
                      {canEdit && <button type="button" onClick={() => onEdit(post.slug)} title="Edit blog" className="rounded-lg border border-[#33453A] px-2 py-1.5 text-[10px] font-semibold text-[#8FE1A0]">Edit blog</button>}
                      {canEdit && <button type="button" disabled={scanning} onClick={() => void runScan([post.slug])} title="Rescan article" className="rounded-lg p-2 text-[#B8C7BC] hover:bg-[#26372B] disabled:opacity-40"><RefreshCw className="h-4 w-4" /></button>}
                    </div></td>
                  </tr>
                );
              })}
              {!displayedPosts.length && <tr><td colSpan={canEdit ? 7 : 6} className="px-4 py-8 text-center text-xs text-[#A9B8AD]">{busy ? 'Loading saved SEO results…' : error ? 'SEO results are unavailable. Retry loading results before relying on this filter.' : 'No articles match this SEO Health filter.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {selectedFinding && (
        <div className="fixed inset-0 z-[130] grid place-items-center overflow-y-auto bg-black/75 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedFinding(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="seo-issues-title" className="my-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#304135] bg-[#19241D] p-5 text-[#ECF3EE] shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[10px] font-bold uppercase tracking-wide text-[#67D8B7]">SEO checklist · {selectedFinding.analysis.score}/100 · {selectedFinding.analysis.coverage}% coverage</p><h2 id="seo-issues-title" className="mt-1 text-lg font-bold">{selectedFinding.post.title}</h2><p className="mt-1 text-[11px] text-[#A9B8AD]">{selectedFinding.analysis.provisional ? 'Provisional scan; some checks were not run.' : 'Completed saved-content and configured route checks.'} Last scanned {scanTimestamp(selectedFinding.analysis.scannedAt)}.</p></div>
              <button type="button" onClick={() => setSelectedFinding(null)} className="rounded-lg px-2 py-1 text-sm text-[#A9B8AD] hover:bg-[#26372B]">Close</button>
            </div>
            <div className="mt-4 space-y-3">
              {selectedFinding.analysis.findings.length ? selectedFinding.analysis.findings.map((finding) => (
                <article key={finding.id} className="rounded-xl border border-[#304135] bg-[#131D16] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{finding.title}</h3><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${finding.severity === 'critical' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>{finding.severity}</span></div>
                  <p className="mt-2 text-[10px] font-semibold uppercase text-[#A9B8AD]">Affected: {finding.field}</p>
                  <p className="mt-1 break-words text-xs text-[#C6D0C8]">Observed: {finding.evidence}</p>
                  <p className="mt-2 text-xs text-[#A9B8AD]">Suggested fix: {finding.suggestion}</p>
                  {canEdit && <button type="button" onClick={() => { setSelectedFinding(null); onEdit(selectedFinding.post.slug, finding.editorAnchor); }} className="mt-3 rounded-lg border border-[#33453A] px-3 py-1.5 text-[10px] font-semibold text-[#8FE1A0]">Open in editor</button>}
                </article>
              )) : <p className="rounded-xl border border-[#304135] bg-[#131D16] p-4 text-xs text-[#A9B8AD]">No warnings or critical findings. This does not establish Google indexing or ranking.</p>}
            </div>
            <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-[#A9B8AD]">Check details</h3>
            <ul className="mt-2 space-y-1.5">
              {selectedFinding.analysis.checks.map((check) => <li key={check.id} className="grid grid-cols-[130px_1fr] gap-3 rounded-lg bg-[#131D16] px-3 py-2 text-[10px]"><span className={checkStatusClass[check.status]}>{checkStatusLabels[check.status]} · {check.label} ({check.weight} pts)</span><span className="break-words text-[#B8C7BC]">{check.evidence}</span></li>)}
            </ul>
            {canEdit && <button type="button" onClick={() => { setSelectedFinding(null); onEdit(selectedFinding.post.slug); }} className="mt-4 rounded-xl bg-[#286D3B] px-4 py-2.5 text-xs font-semibold text-white">Edit blog</button>}
          </section>
        </div>
      )}
    </section>
  );
}
