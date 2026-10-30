import { useState, useEffect, useCallback, Fragment, type MouseEvent, useRef } from 'react';
import { Search, ArrowLeft, BookOpen, AlertCircle, Loader2, Download, Trash2, Star, X } from 'lucide-react';
import {
  listProviders,
  searchManga,
  getChapters,
  getChapterPages,
  type MangaSearchResult,
  type MangaChapter,
  type ChapterPage,
  type ProviderInfo,
} from '../lib/manga/sources';
import Reader, { type MangaReaderTarget } from './Reader';
import {
  getMangaRecord,
  openMangaChapter,
  removeMangaDownload,
  removeManga,
  getMangaHistory,
  isMangaFavorite,
  setMangaFavorite,
  type MangaHistoryEntry,
  type MangaRecord,
} from '../lib/db';
import { downloadChapterPages } from '../lib/manga/download';
import { cn, parseChapterNumber } from '../lib/utils';
import { useLocalStorage } from 'usehooks-ts';

const MANGA_PROVIDER_KEY = 'panelpass-manga-provider';

// Status → left-border color + label for the chapter list indicators.
// Derived from the IndexedDB MangaRecord (isCompleted = done, currentPage>0 = reading).
function statusOf(rec: MangaRecord | null): 'unread' | 'reading' | 'done' {
  if (!rec) return 'unread';
  if (rec.isCompleted) return 'done';
  if (rec.currentPage > 0) return 'reading';
  return 'unread';
}

const STATUS_STYLES: Record<'unread' | 'reading' | 'done', { border: string; dot: string; label: string }> = {
  unread: { border: 'border-l-[#333]', dot: 'bg-[#555]', label: 'Unread' },
  reading: { border: 'border-l-amber-400', dot: 'bg-amber-400', label: 'Reading' },
  done: { border: 'border-l-emerald-500', dot: 'bg-emerald-500', label: 'Done' },
};

export default function Manga({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MangaSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MangaSearchResult | null>(null);
  const [chapters, setChapters] = useState<MangaChapter[]>([]);
  // Always-current snapshot of the chapter list, so async handlers (openChapter)
  // read the latest chapters even if their closure captured an empty list.
  const chaptersRef = useRef<MangaChapter[]>([]);
  chaptersRef.current = chapters;
  const [isLoadingChapters, setIsLoadingChapters] = useState(false);
  const [chapterError, setChapterError] = useState<string | null>(null);

  // Internal reader state — kept INSIDE Manga so opening a chapter never unmounts
  // the search results or chapter list (fixes back-nav losing state). The chapter
  // pages are pre-fetched here so the unified Reader receives plain image URLs.
  const [reading, setReading] = useState<{ target: MangaReaderTarget; pages: ChapterPage[] } | null>(null);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useLocalStorage<string>(MANGA_PROVIDER_KEY, 'mangadex');

  // Multi-select batch download.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Reusable confirm dialog state (no window.confirm — blocked in headless browser).
  const [confirmState, setConfirmState] = useState<{ title: string; body: string; tone?: 'danger' | 'warn' | 'info'; onConfirm: () => void | Promise<void>; } | null>(null);
  const [history, setHistory] = useState<MangaHistoryEntry[]>([]);
  // Favorited (starred) manga titles — keyed by `${provider}:${mangaId}`.
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const mangaKeyOf = (entry: MangaHistoryEntry) => `${entry.provider}:${entry.mangaId}`;

  const toggleFavorite = useCallback(async (entry: MangaHistoryEntry) => {
    const key = mangaKeyOf(entry);
    const next = new Set(favorites);
    const willFavorite = !next.has(key);
    if (willFavorite) next.add(key); else next.delete(key);
    setFavorites(next);
    await setMangaFavorite(entry.provider, entry.mangaId, willFavorite);
  }, [favorites]);

  // Sort: favorites first (stable), then by most-recently viewed.
  const sortedHistory = [...history].sort((a, b) => {
    const fa = favorites.has(mangaKeyOf(a)) ? 1 : 0;
    const fb = favorites.has(mangaKeyOf(b)) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return (b.record.lastViewedAt ?? 0) - (a.record.lastViewedAt ?? 0);
  });

  // Parse a chapter's numeric position for ascending sort (e.g. "Ch. 0" → 0).
  // Parse a chapter's numeric position for ascending sort (e.g. "Ch. 0" → 0).
  const chapterNumber = (ch: MangaChapter): number => parseChapterNumber(ch.chapter, ch.title);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Download selected chapters in ascending chapter order, one at a time.
  // Each chapter is isolated so a single failure (e.g. rate-limit) doesn't
  // abort the rest; a short delay between chapters avoids hammering the proxy.
  const downloadSelected = useCallback(async () => {
    if (selectedIds.size === 0 || batchDownloading) return;
    const ordered = chapters
      .filter((ch) => selectedIds.has(ch.id))
      .sort((a, b) => chapterNumber(a) - chapterNumber(b));
    const count = ordered.length;

    await new Promise<void>((resolve) => {
      setConfirmState({
        title: 'Download chapters',
        body: `Download ${count} chapter${count > 1 ? 's' : ''} for offline reading?`,
        tone: 'info',
        onConfirm: async () => { await resolve(); },
      });
    });

    setBatchDownloading(true);
    setBatchProgress({ done: 0, total: ordered.length });
    let completed = 0;
    try {
      for (const ch of ordered) {
      try {
        const pid = selected?.providerId || providerId;
        const mid = selected?.providerMangaId ?? '';
        let rec = await getMangaRecord(pid, mid, ch.id);
        if (!rec) {
          const label = ch.chapter ? `Ch. ${ch.chapter}${ch.title ? ` — ${ch.title}` : ''}` : ch.title || 'Chapter';
          rec = await openMangaChapter({
            provider: pid,
            mangaId: mid,
            chapterId: ch.id,
            mangaTitle: undefined,
            chapterLabel: label,
            coverUrl: selected?.coverUrl ?? null,
            totalPages: ch.pages ?? 0,
          });
        }
        // Retry the page-list fetch — the proxy can 502 on this IP under
        // heavy probing, and a single transient failure shouldn't drop the chapter.
        let pages: ChapterPage[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            pages = await getChapterPages(pid, ch.id);
            if (pages.length > 0) break;
          } catch {
            /* retry */
          }
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        }
        if (pages.length === 0) throw new Error('no pages after retries');
        await downloadChapterPages(rec, pages.map((p) => p.url));
        completed += 1;
      } catch (err) {
        console.error('Batch chapter download failed', ch.chapter, err);
      }
      setBatchProgress((p) => ({ ...p, done: p.done + 1 }));
      // Pause between chapters so we don't trip the source's rate limiter.
      await new Promise((r) => setTimeout(r, 1500));
    }
      if (completed > 0) setRefreshNonce((n) => n + 1);
    } finally {
      setBatchDownloading(false);
      setSelectedIds(new Set());
      setSelectMode(false);
    }
  }, [selectedIds, batchDownloading, chapters, selected, providerId]);

  // Load the "Continue Reading" history whenever we return to the home view.
  useEffect(() => {
    if (!selected) {
      getMangaHistory()
        .then(async (hist) => {
          setHistory(hist);
          const favKeys = await Promise.all(
            hist.map(async (e) => ((await isMangaFavorite(e.provider, e.mangaId)) ? `${e.provider}:${e.mangaId}` : null)),
          );
          setFavorites(new Set(favKeys.filter(Boolean) as string[]));
        })
        .catch(() => setHistory([]));
    }
  }, [selected, refreshNonce]);

  // Load the provider list once.
  useEffect(() => {
    listProviders()
      .then(setProviders)
      .catch(() => setProviders([{ id: 'mangadex', label: 'MangaDex', reliable: true }]));
  }, []);

  const runSearch = useCallback(
    async (q: string) => {
      const term = q.trim();
      if (!term) {
        setResults([]);
        return;
      }
      setIsSearching(true);
      setError(null);
      try {
        const found = await searchManga(providerId, term);
        setResults(found);
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : String(e);
        setError(`${providerId} error: ${msg}`);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [providerId],
  );

  // Debounced search as the user types (1.5s — user requested 1–2s window).
  useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim()) void runSearch(query);
    }, 1500);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const openManga = useCallback(async (m: MangaSearchResult) => {
    setSelected(m);
    setChapters([]);
    setChapterError(null);
    setIsLoadingChapters(true);
    const pid = m.providerId || providerId;
    try {
      const ch = await getChapters(pid, m.providerMangaId);
      setChapters(ch);
    } catch (e) {
      console.error(e);
      setChapterError('Could not load chapters for this title.');
    } finally {
      setIsLoadingChapters(false);
    }
  }, [providerId]);

  const activeProvider = selected?.providerId || providerId;

  // Open a chapter: pre-fetch its pages (proxied URLs), then show the unified Reader.
  const openChapter = useCallback(async (ch: MangaChapter) => {
    if (!selected) return;
    const pid = selected.providerId || providerId;
    const label = ch.chapter ? `Ch. ${ch.chapter}${ch.title ? ` — ${ch.title}` : ''}` : ch.title || 'Chapter';
    setIsLoadingChapters(true); // reuse spinner as "loading chapter"
    try {
      const pages = await getChapterPages(pid, ch.id);
      // Use the latest chapter list (ref) so Prev/Next nav is always available,
      // even though openChapter's closure may predate the chapter fetch.
      const chapterList = chaptersRef.current;
      setReading({
        pages,
        target: {
          kind: 'manga',
          provider: pid,
          mangaId: selected.providerMangaId,
          chapterId: ch.id,
          chapterLabel: label,
          mangaTitle: selected.title,
          coverUrl: selected.coverUrl,
          pageUrls: pages.map((p) => p.url),
          chapters: chapterList,
          loadChapterPages: async (nextId: string) => {
            const nextPages = await getChapterPages(pid, nextId);
            const nextCh = chapterList.find((c) => c.id === nextId);
            const nextLabel = nextCh ? (nextCh.chapter ? `Ch. ${nextCh.chapter}${nextCh.title ? ` — ${nextCh.title}` : ''}` : nextCh.title || 'Chapter') : 'Chapter';
            return { pages: nextPages, label: nextLabel, chapterId: nextId };
          },
        },
      });
    } catch (e) {
      console.error(e);
      setChapterError('Could not load this chapter.');
    } finally {
      setIsLoadingChapters(false);
    }
  }, [selected, providerId]);

  // Resume a title from the Continue Reading shelf: re-fetch its chapter list,
  // select the title, then open the most-recently read chapter directly.
  const resumeManga = useCallback(async (entry: MangaHistoryEntry) => {
    const pid = entry.provider;
    const mid = entry.mangaId;
    setIsLoadingChapters(true);
    setChapterError(null);
    try {
      const ch = await getChapters(pid, mid);
      setChapters(ch);
      const resume = entry.record;
      const label = resume.chapterLabel || `Ch. ${resume.chapterId}`;
      const pages = await getChapterPages(pid, resume.chapterId);
      setSelected({
        id: mid,
        providerId: pid,
        providerMangaId: mid,
        title: entry.title,
        coverUrl: entry.record.coverUrl ?? undefined,
        description: undefined,
        year: undefined,
      });
      setReading({
        pages,
        target: {
          kind: 'manga',
          provider: pid,
          mangaId: mid,
          chapterId: resume.chapterId,
          chapterLabel: label,
          mangaTitle: entry.title,
          coverUrl: entry.record.coverUrl ?? null,
          pageUrls: pages.map((p) => p.url),
          chapters: ch,
          loadChapterPages: async (nextId: string) => {
            const nextPages = await getChapterPages(pid, nextId);
            const nextCh = ch.find((c) => c.id === nextId);
            const nextLabel = nextCh ? (nextCh.chapter ? `Ch. ${nextCh.chapter}${nextCh.title ? ` — ${nextCh.title}` : ''}` : nextCh.title || 'Chapter') : 'Chapter';
            return { pages: nextPages, label: nextLabel, chapterId: nextId };
          },
        },
      });
    } catch (e) {
      console.error(e);
      setChapterError('Could not resume this title.');
    } finally {
      setIsLoadingChapters(false);
    }
  }, []);

  // ---- Unified reader (rendered in place; Back returns to the chapter list) ----
  if (reading && selected) {
    return (
      <Reader
        target={reading.target}
        onBack={() => setReading(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full flex-1 relative">
      {/* Confirm modal (no window.confirm — blocked in headless browser). */}
      {confirmState && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmState(null)} />
          <div className="relative bg-[#111] border border-[#2A2A2A] rounded-xl shadow-2xl max-w-sm w-full p-5">
            <button
              onClick={() => setConfirmState(null)}
              className="absolute top-3 right-3 text-[#666] hover:text-[#DDD] transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
            <h3 className="text-sm font-black uppercase tracking-tight mb-1">{confirmState.title}</h3>
            <p className="text-xs text-[#888] leading-relaxed mb-4">{confirmState.body}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmState(null)}
                className="text-[10px] uppercase tracking-widest px-3 py-2 rounded border border-[#333] text-[#888] hover:text-[#DDD] hover:border-[#555] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const fn = confirmState.onConfirm;
                  setConfirmState(null);
                  await fn?.();
                }}
                className={`text-[10px] uppercase tracking-widest px-3 py-2 rounded border transition-colors ${
                  confirmState.tone === 'danger'
                    ? 'border-red-500 text-red-400 hover:bg-red-500 hover:text-black'
                    : confirmState.tone === 'warn'
                      ? 'border-amber-500 text-amber-400 hover:bg-amber-500 hover:text-black'
                      : 'border-cyan-400 text-cyan-400 hover:bg-cyan-400 hover:text-black'
                }`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="h-16 border-b border-[#2A2A2A] flex items-center justify-between px-8 bg-[#0F0F0F]">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-cyan-400 rounded-sm transform -rotate-12 flex items-center justify-center text-black font-black text-xl font-display">P</div>
          <h1 className="text-2xl font-black italic tracking-tighter uppercase font-display hidden sm:block">PanelPass</h1>
          <span className="ml-2 text-xs uppercase tracking-widest text-[#666] hidden sm:inline">Manga</span>
        </div>
        <button
          onClick={onOpenSettings}
          className="border border-[#333] p-2 text-[#666] hover:border-cyan-400 hover:text-cyan-400 transition-colors"
          title="Settings"
        >
          <AlertCircle size={18} />
        </button>
      </header>

      <main className="flex-1 p-8 bg-[#0D0D0D] flex flex-col overflow-auto">
        {!selected ? (
          <>
            {/* Search bar */}
            <div className="flex items-center gap-3 mb-6">
              <div className="relative flex-1 max-w-xl">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666]" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${providerId} titles…`}
                  className="w-full bg-[#111] border border-[#2A2A2A] rounded-lg pl-10 pr-4 py-3 text-sm text-[#F0F0F0] outline-none focus:border-cyan-400 transition-colors"
                />
              </div>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="bg-[#111] border border-[#2A2A2A] rounded-lg px-3 py-3 text-sm text-[#F0F0F0] outline-none focus:border-cyan-400 transition-colors"
                title="Manga source"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {isSearching && <Loader2 size={18} className="animate-spin text-cyan-400" />}
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-lg mb-6">{error}</div>
            )}

            {results.length === 0 && !isSearching && !error && (
              <div className="text-[#555] text-sm mt-8">
                {query.trim() ? 'No results.' : 'Type a title above to search (online).'}
              </div>
            )}

            {results.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 content-start">
                {results.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => openManga(m)}
                    className="group text-left bg-[#111] border border-[#222] rounded-lg overflow-hidden hover:border-cyan-400 transition-all hover:scale-[1.02]"
                  >
                    <div className="aspect-[3/4] bg-[#1A1A1A] flex items-center justify-center overflow-hidden">
                      {m.coverUrl ? (
                        <img
                          src={m.coverUrl}
                          alt={m.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <BookOpen size={32} className="text-[#444]" />
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-bold text-[#DDD] line-clamp-2 leading-tight">{m.title}</p>
                      {m.year && <p className="text-[10px] text-[#666] mt-1">{m.year}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Continue Reading shelf — titles you've opened before (below search results) */}
            {history.length > 0 && (
              <div className="mt-10">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#888] mb-3">Continue Reading</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {sortedHistory.map((entry) => {
                    const rec = entry.record;
                    const cover = rec.coverUrl || null;
                    const isFav = favorites.has(mangaKeyOf(entry));
                    const readChapters = entry.chapters.filter((c) => c.currentPage > 0 || c.isCompleted).length;
                    const progressPct = rec.totalPages > 1 ? Math.min(100, (rec.currentPage / (rec.totalPages - 1)) * 100) : (rec.isCompleted ? 100 : 0);
                    const status = rec.isCompleted ? 'Done' : rec.currentPage > 0 ? 'Reading' : 'Unread';
                    const statusColor = rec.isCompleted ? 'text-emerald-500' : rec.currentPage > 0 ? 'text-amber-400' : 'text-[#666]';
                    return (
                      <div
                        key={`${entry.provider}:${entry.mangaId}`}
                        className="group relative text-left bg-[#111] border border-[#222] rounded-lg overflow-hidden hover:border-cyan-400 transition-all hover:scale-[1.02]"
                      >
                        <button
                          onClick={() => resumeManga(entry)}
                          className="block w-full text-left"
                          title={`Resume ${entry.title}`}
                        >
                          <div className="aspect-[3/4] bg-[#1A1A1A] flex items-center justify-center overflow-hidden relative">
                            {cover ? (
                              <img src={cover} alt={entry.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                            ) : (
                              <BookOpen size={32} className="text-[#444]" />
                            )}
                            <div className={`absolute top-2 right-2 z-20 w-2.5 h-2.5 rounded-full ${rec.isCompleted ? 'bg-emerald-500' : rec.currentPage > 0 ? 'bg-amber-400' : 'bg-[#555]'}`}></div>
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#111]">
                              <div className="h-full bg-cyan-400" style={{ width: `${progressPct}%` }} />
                            </div>
                          </div>
                          <div className="p-2">
                            <p className="text-xs font-bold text-[#DDD] line-clamp-2 leading-tight">{entry.title}</p>
                            <p className={`text-[10px] mt-1 ${statusColor}`}>
                              {status} · {rec.chapterLabel || 'Chapter'} · pg {rec.currentPage + 1}/{rec.totalPages}
                            </p>
                            {entry.chapters.length > 1 && (
                              <p className="text-[10px] text-[#666] mt-0.5">{readChapters}/{entry.chapters.length} chapters opened</p>
                            )}
                          </div>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); void toggleFavorite(entry); }}
                          className={`absolute top-2 left-2 z-30 p-1.5 rounded-full backdrop-blur-sm transition-colors ${isFav ? 'bg-amber-400/90 text-black' : 'bg-black/50 text-[#CCC] hover:text-amber-400'}`}
                          title={isFav ? 'Unfavorite' : 'Add to favorites'}
                        >
                          <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmState({
                              title: 'Remove manga',
                              body: `Remove "${entry.title}" from Continue Reading and delete all downloaded chapters? This cannot be undone.`,
                              tone: 'danger',
                              onConfirm: async () => {
                                await removeManga(entry.provider, entry.mangaId);
                                setHistory((prev) => prev.filter((x) => x.mangaId !== entry.mangaId || x.provider !== entry.provider));
                              },
                            });
                          }}
                          className="absolute top-2 right-2 z-30 p-1.5 rounded-full bg-black/50 text-[#CCC] hover:text-red-400 backdrop-blur-sm transition-colors"
                          title="Remove manga"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Manga reading stats */}
            {history.length > 0 && (() => {
              const titles = history.length;
              const allChapters = history.flatMap((e) => e.chapters);
              const chaptersRead = allChapters.filter((c) => c.currentPage > 0 || c.isCompleted).length;
              const chaptersDownloaded = allChapters.filter((c) => c.downloaded).length;
              const pagesRead = allChapters.reduce((s, c) => s + (c.isCompleted ? c.totalPages : Math.min(c.currentPage + 1, c.totalPages)), 0);
              const completed = history.filter((e) => e.record.isCompleted).length;
              const completionPct = titles > 0 ? Math.round((completed / titles) * 100) : 0;
              // Per-provider breakdown.
              const byProvider = new Map<string, number>();
              for (const e of history) byProvider.set(e.provider, (byProvider.get(e.provider) ?? 0) + 1);
              const providerRows = [...byProvider.entries()].sort((a, b) => b[1] - a[1]);
              return (
                <div className="mt-10 border-t border-[#2A2A2A] pt-6">
                  <h4 className="text-xs font-bold text-[#555] uppercase tracking-widest mb-4">Manga Stats</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div className="bg-[#161616] p-4 rounded border border-[#222] relative overflow-hidden">
                      <p className="text-[10px] text-[#888] font-bold uppercase mb-1">Titles Opened</p>
                      <p className="text-2xl font-black italic font-display">{titles}</p>
                    </div>
                    <div className="bg-[#161616] p-4 rounded border border-[#222] relative overflow-hidden">
                      <p className="text-[10px] text-[#888] font-bold uppercase mb-1">Chapters Read</p>
                      <p className="text-2xl font-black italic font-display text-cyan-400">{chaptersRead}</p>
                    </div>
                    <div className="bg-[#161616] p-4 rounded border border-[#222] relative overflow-hidden">
                      <p className="text-[10px] text-[#888] font-bold uppercase mb-1">Pages Read</p>
                      <p className="text-2xl font-black italic font-display">{pagesRead}</p>
                    </div>
                    <div className="bg-[#161616] p-4 rounded border border-[#222] relative overflow-hidden">
                      <p className="text-[10px] text-[#888] font-bold uppercase mb-1">Downloaded</p>
                      <p className="text-2xl font-black italic font-display text-amber-400">{chaptersDownloaded}</p>
                    </div>
                    <div className="bg-[#161616] p-4 rounded border border-[#222] relative overflow-hidden">
                      <p className="text-[10px] text-[#888] font-bold uppercase mb-1">Completed</p>
                      <p className="text-2xl font-black italic font-display text-emerald-500">{completed}</p>
                    </div>
                    <div className="bg-[#161616] p-4 rounded border border-[#222] relative overflow-hidden">
                      <p className="text-[10px] text-[#888] font-bold uppercase mb-1">Completion</p>
                      <p className="text-2xl font-black italic font-display">{completionPct}%</p>
                    </div>
                  </div>
                  {providerRows.length > 1 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {providerRows.map(([prov, count]) => (
                        <span
                          key={prov}
                          className="text-[10px] uppercase tracking-widest text-[#888] bg-[#161616] border border-[#222] rounded px-2 py-1"
                        >
                          {prov} · {count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        ) : (
          /* Detail / chapter list */
          <>
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-2 text-[#888] hover:text-cyan-400 transition-colors mb-4"
            >
              <ArrowLeft size={18} /> Back to search
            </button>

            <div className="flex gap-4 mb-6">
              <div className="w-24 h-32 sm:w-32 sm:h-44 bg-[#1A1A1A] rounded overflow-hidden shrink-0">
                {selected.coverUrl ? (
                  <img src={selected.coverUrl} alt={selected.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><BookOpen size={28} className="text-[#444]" /></div>
                )}
              </div>
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight italic">{selected.title}</h2>
                {selected.description && (
                  <p className="text-xs text-[#888] mt-2 max-w-prose line-clamp-4">{selected.description}</p>
                )}
              </div>
            </div>

            {/* Chapter loading state — mirrors the chapter-list spinner in the same area */}
            {isLoadingChapters && (
              <div className="flex items-center gap-3 text-[#888] py-8">
                <Loader2 size={22} className="animate-spin text-cyan-400" />
                <span className="text-sm font-bold uppercase tracking-widest">Loading chapters…</span>
              </div>
            )}

            <div className="flex items-center justify-between mb-3 max-w-3xl">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#888]">
                Chapters ({chapters.length})
              </h3>
              <div className="flex items-center gap-3">
                {/* Status legend */}
                <div className="hidden sm:flex items-center gap-3 text-[10px] uppercase tracking-widest text-[#666]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#555]" /> Unread</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Reading</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Done</span>
                  <span className="flex items-center gap-1"><Download size={11} className="text-cyan-400" /> Saved</span>
                </div>
                <button
                  onClick={() => {
                    if (selectMode) {
                      setSelectMode(false);
                      setSelectedIds(new Set());
                    } else {
                      setSelectMode(true);
                    }
                  }}
                  className={`text-[10px] uppercase tracking-widest px-2 py-1 rounded border transition-colors ${
                    selectMode
                      ? 'border-cyan-400 text-cyan-400'
                      : 'border-[#333] text-[#666] hover:border-cyan-400 hover:text-cyan-400'
                  }`}
                >
                  {selectMode ? 'Cancel' : 'Select'}
                </button>
              </div>
            </div>

            {/* Batch download toolbar (only in select mode) */}
            {selectMode && (
              <div className="flex items-center justify-between gap-3 mb-3 max-w-3xl bg-[#111] border border-[#222] rounded-lg px-4 py-2.5">
                <span className="text-xs text-[#888] uppercase tracking-widest">
                  {selectedIds.size} selected
                  {batchDownloading && batchProgress.total > 0 && (
                    <span className="ml-2 text-cyan-400 tabular-nums">
                      {batchProgress.done}/{batchProgress.total}
                      {` (${Math.round((batchProgress.done / batchProgress.total) * 100)}%)`}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={clearSelection}
                    disabled={batchDownloading || selectedIds.size === 0}
                    className="text-[10px] uppercase tracking-widest px-3 py-1.5 rounded border border-[#333] text-[#666] hover:border-red-400 hover:text-red-400 transition-colors disabled:opacity-40"
                  >
                    Clear
                  </button>
                  <button
                    onClick={downloadSelected}
                    disabled={batchDownloading || selectedIds.size === 0}
                    className="text-[10px] uppercase tracking-widest px-3 py-1.5 rounded border border-cyan-400 text-cyan-400 hover:bg-cyan-400 hover:text-black transition-colors disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {batchDownloading ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Download size={12} />
                    )}
                    {batchDownloading ? 'Downloading…' : 'Download selected'}
                  </button>
                </div>
              </div>
            )}
            {chapterError && <div className="text-red-500 text-sm">{chapterError}</div>}

            {!isLoadingChapters && chapters.length === 0 && !chapterError && (
              <div className="text-[#555] text-sm">No English chapters available.</div>
            )}

            <div className="space-y-1 max-w-3xl">
              {chapters.map((ch) => (
                <Fragment key={ch.id}>
                  <ChapterRow
                    ch={ch}
                    provider={activeProvider}
                    mangaId={selected.providerMangaId}
                    onOpen={() => openChapter(ch)}
                    selectable={selectMode}
                    selected={selectedIds.has(ch.id)}
                    onToggleSelect={() => toggleSelect(ch.id)}
                    coverUrl={selected.coverUrl}
                    refreshNonce={refreshNonce}
                    onRequestConfirm={(cfg) =>
                      new Promise<void>((resolve) => {
                        setConfirmState({
                          ...cfg,
                          onConfirm: async () => {
                            await cfg.onConfirm?.();
                            resolve();
                          },
                        });
                      })
                    }
                  />
                </Fragment>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// Chapter list row: reads its status live from IndexedDB (per-render) so indicators
// update as you read. Keeps Manga.tsx readable and the status source single.
function ChapterRow({
  ch,
  provider,
  mangaId,
  onOpen,
  selectable = false,
  selected = false,
  onToggleSelect,
  coverUrl,
  refreshNonce = 0,
  onRequestConfirm,
}: {
  ch: MangaChapter;
  provider: string;
  mangaId: string;
  onOpen: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  coverUrl?: string | null;
  refreshNonce?: number;
  onRequestConfirm?: (cfg: { title: string; body: string; tone?: 'danger' | 'warn' | 'info'; onConfirm: () => void | Promise<void> }) => Promise<void>;
}) {
  const [rec, setRec] = useState<MangaRecord | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  useEffect(() => {
    let alive = true;
    getMangaRecord(provider, mangaId, ch.id).then((r) => {
      if (alive) setRec(r);
    });
    return () => {
      alive = false;
    };
  }, [provider, mangaId, ch.id, refreshNonce]);

  const handleDownload = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    if (downloading) return;
    await new Promise<void>((resolve) => {
      onRequestConfirm?.({
        title: 'Download chapter',
        body: `Download Ch. ${ch.chapter ?? ch.title ?? '?'} for offline reading?`,
        tone: 'info',
        onConfirm: async () => { await resolve(); },
      });
    });
    setDownloading(true);
    setProgress(0);
    try {
      // A never-opened chapter has no MangaRecord yet, so ensure one exists
      // (mirrors what the Reader does on first open) before we can download.
      let recToUse = rec;
      if (!recToUse) {
        const label = ch.chapter ? `Ch. ${ch.chapter}${ch.title ? ` — ${ch.title}` : ''}` : ch.title || 'Chapter';
        recToUse = await openMangaChapter({
          provider,
          mangaId,
          chapterId: ch.id,
          mangaTitle: undefined,
          chapterLabel: label,
          coverUrl: coverUrl ?? null,
          totalPages: ch.pages ?? 0,
        });
        setRec(recToUse);
      }
      // Re-fetch the chapter's page URLs (proxied) so we download the same set
      // the reader would show.
      const pages = await getChapterPages(provider, ch.id);
      await downloadChapterPages(recToUse, pages.map((p) => p.url), {
        onProgress: (done, total) => setProgress(done / total),
      });
      const refreshed = await getMangaRecord(provider, mangaId, ch.id);
      setRec(refreshed);
    } catch (err) {
      console.error('Download failed', err);
    } finally {
      setDownloading(false);
    }
  }, [rec, downloading, provider, mangaId, ch.id, ch.chapter, ch.title, ch.pages]);

  const handleRemove = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    await new Promise<void>((resolve) => {
      onRequestConfirm?.({
        title: 'Remove offline copy',
        body: `Remove Ch. ${ch.chapter ?? ch.title ?? '?'} from local storage? You can re-download it later.`,
        tone: 'warn',
        onConfirm: async () => { await resolve(); },
      });
    });
    await removeMangaDownload(provider, mangaId, ch.id);
    const refreshed = await getMangaRecord(provider, mangaId, ch.id);
    setRec(refreshed);
  }, [provider, mangaId, ch.id, ch.chapter, ch.title]);

  const status = statusOf(rec);
  const style = STATUS_STYLES[status];
  const finished = rec?.isCompleted && rec.lastViewedAt ? new Date(rec.lastViewedAt).toLocaleDateString() : null;

  return (
    <div
      className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-[#111] border border-[#222] border-l-4 ${style.border} rounded hover:border-cyan-400 transition-colors text-left ${
        selectable ? (selected ? 'ring-1 ring-cyan-400/60' : '') : ''
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 accent-cyan-400 w-4 h-4 cursor-pointer"
            aria-label={`Select Ch. ${ch.chapter ?? 'oneshot'}`}
          />
        )}
        <button
          onClick={onOpen}
          disabled={selectable}
          className="flex items-center gap-2 min-w-0 text-left disabled:cursor-default"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} title={style.label} />
          <span className="text-sm text-[#DDD] truncate">
            {ch.chapter ? `Ch. ${ch.chapter}` : 'Oneshot'}
            {ch.title ? ` — ${ch.title}` : ''}
          </span>
        </button>
      </span>
      <span className="flex items-center gap-3 shrink-0">
        {rec?.downloaded && (
          <Download size={13} className="text-cyan-400" aria-label="Downloaded" />
        )}
        {downloading && (
          <span className="text-[10px] text-cyan-400 uppercase tracking-widest tabular-nums">
            {Math.round(progress * 100)}%
          </span>
        )}
        {status === 'done' && finished && (
          <span className="text-[10px] text-emerald-500/80 uppercase tracking-widest hidden sm:inline">
            {finished}
          </span>
        )}
        <span className="text-[10px] text-[#666] uppercase tracking-widest">
          {rec?.totalPages
            ? (rec.currentPage > 0 || rec.isCompleted
                ? `${rec.currentPage + 1} / ${rec.totalPages}`
                : `${rec.totalPages} pg`)
            : `${ch.pages ?? '?'} pg`}
        </span>
        {rec?.downloaded ? (
          <button
            onClick={handleRemove}
            disabled={selectable}
            title="Remove offline copy"
            className="p-1 text-[#666] hover:text-red-400 transition-colors disabled:opacity-40"
          >
            <Trash2 size={13} />
          </button>
        ) : (
          <button
            onClick={handleDownload}
            disabled={downloading || selectable}
            title="Download for offline reading"
            className="p-1 text-[#666] hover:text-cyan-400 transition-colors disabled:opacity-40"
          >
            <Download size={13} />
          </button>
        )}
      </span>
    </div>
  );
}
