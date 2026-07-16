import { useState, useEffect, useCallback, Fragment, type MouseEvent } from 'react';
import { Search, ArrowLeft, BookOpen, AlertCircle, Loader2, Download, Trash2 } from 'lucide-react';
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
  type MangaRecord,
} from '../lib/db';
import { downloadChapterPages } from '../lib/manga/download';
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
  const [isLoadingChapters, setIsLoadingChapters] = useState(false);
  const [chapterError, setChapterError] = useState<string | null>(null);

  // Internal reader state — kept INSIDE Manga so opening a chapter never unmounts
  // the search results or chapter list (fixes back-nav losing state). The chapter
  // pages are pre-fetched here so the unified Reader receives plain image URLs.
  const [reading, setReading] = useState<{ target: MangaReaderTarget; pages: ChapterPage[] } | null>(null);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useLocalStorage<string>(MANGA_PROVIDER_KEY, 'mangadex');

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
      setReading({
        pages,
        target: {
          kind: 'manga',
          provider: pid,
          mangaId: selected.providerMangaId,
          chapterId: ch.id,
          chapterLabel: label,
          mangaTitle: selected.title,
          pageUrls: pages.map((p) => p.url),
        },
      });
    } catch (e) {
      console.error(e);
      setChapterError('Could not load this chapter.');
    } finally {
      setIsLoadingChapters(false);
    }
  }, [selected, providerId]);

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
    <div className="flex flex-col h-full flex-1">
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

            <div className="flex items-center justify-between mb-3 max-w-3xl">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#888]">
                Chapters ({chapters.length})
              </h3>
              {/* Status legend */}
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-[#666]">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#555]" /> Unread</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Reading</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Done</span>
                <span className="flex items-center gap-1"><Download size={11} className="text-cyan-400" /> Saved</span>
              </div>
            </div>

            {isLoadingChapters && <Loader2 size={18} className="animate-spin text-cyan-400" />}
            {chapterError && <div className="text-red-500 text-sm">{chapterError}</div>}

            {!isLoadingChapters && chapters.length === 0 && !chapterError && (
              <div className="text-[#555] text-sm">No English chapters available.</div>
            )}

            <div className="space-y-1 max-w-3xl">
              {chapters.map((ch) => (
                <Fragment key={ch.id}>
                  <ChapterRow ch={ch} provider={activeProvider} mangaId={selected.providerMangaId} onOpen={() => openChapter(ch)} />
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
}: {
  ch: MangaChapter;
  provider: string;
  mangaId: string;
  onOpen: () => void;
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
  }, [provider, mangaId, ch.id]);

  const handleDownload = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    if (downloading) return;
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
    await removeMangaDownload(provider, mangaId, ch.id);
    const refreshed = await getMangaRecord(provider, mangaId, ch.id);
    setRec(refreshed);
  }, [provider, mangaId, ch.id]);

  const status = statusOf(rec);
  const style = STATUS_STYLES[status];
  const finished = rec?.isCompleted && rec.lastViewedAt ? new Date(rec.lastViewedAt).toLocaleDateString() : null;

  return (
    <button
      onClick={onOpen}
      className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-[#111] border border-[#222] border-l-4 ${style.border} rounded hover:border-cyan-400 transition-colors text-left`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} title={style.label} />
        <span className="text-sm text-[#DDD] truncate">
          {ch.chapter ? `Ch. ${ch.chapter}` : 'Oneshot'}
          {ch.title ? ` — ${ch.title}` : ''}
        </span>
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
            title="Remove offline copy"
            className="p-1 text-[#666] hover:text-red-400 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        ) : (
          <button
            onClick={handleDownload}
            disabled={downloading}
            title="Download for offline reading"
            className="p-1 text-[#666] hover:text-cyan-400 transition-colors disabled:opacity-40"
          >
            <Download size={13} />
          </button>
        )}
      </span>
    </button>
  );
}
