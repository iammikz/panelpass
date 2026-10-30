import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Moon, Sun, Smartphone, LayoutPanelLeft, BookOpen, AlignJustify, GalleryVertical, GalleryHorizontal, Bookmark as BookmarkIcon, X, ChevronRight, Loader2 } from 'lucide-react';
import { getComics, getComicFile, updateComicProgress, getMangaRecord, getMangaPages, openMangaChapter, updateMangaProgress, getBookmarks, toggleBookmark, updateBookmarkNote, removeBookmark, getMangaPrefs, saveMangaPrefs, type Bookmark, type BookmarkScope } from '../lib/db';
import { ComicParser } from '../lib/parser';
import { type PageSource, RemotePageSource, OfflinePageSource } from '../lib/manga/pageSource';
import { Comic, Theme } from '../types';
import { type MangaChapter, type ChapterPage } from '../lib/manga/sources';
import { cn, parseChapterNumber } from '../lib/utils';
import { useLocalStorage } from 'usehooks-ts';

export interface ReaderTarget {
  kind: 'comic';
  comicId: string;
}
export interface MangaReaderTarget {
  kind: 'manga';
  provider: string;
  mangaId: string;
  chapterId: string;
  chapterLabel?: string;
  mangaTitle?: string;
  /** Cover image URL (from the source) — persisted so the Continue Reading
   *  shelf can render real art without re-fetching. */
  coverUrl?: string | null;
  /** Pre-fetched, proxied page image URLs (from the backend /api/source dispatch). */
  pageUrls: string[];
  /** Sibling chapter list (ascending), used for Next/Prev chapter navigation. */
  chapters?: MangaChapter[];
  /** Fetches the page list for a given sibling chapter id. */
  loadChapterPages?: (chapterId: string) => Promise<{ pages: ChapterPage[]; label: string; chapterId: string }>;
}

export default function Reader({
  target,
  onBack,
}: {
  target: ReaderTarget | MangaReaderTarget;
  onBack: () => void;
}) {
  type PageSubMode = 'single' | 'dual';
  type WebtoonSubMode = 'single' | 'all-v' | 'all-h';

  const [comic, setComic] = useState<Comic | null>(null);
  const [parser, setParser] = useState<PageSource | null>(null);
  const [pageUrl, setPageUrl] = useState<string>('');
  const [pageUrl2, setPageUrl2] = useState<string>('');
  const [nextPageUrl, setNextPageUrl] = useState<string>('');
  const [allPageUrls, setAllPageUrls] = useState<string[]>([]);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [allPagesImagesLoaded, setAllPagesImagesLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI State
  const [showUI, setShowUI] = useState(true);
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const comicRef = useRef<Comic | null>(null);
  const parserRef = useRef<PageSource | null>(null);
  const offlineParserRef = useRef<OfflinePageSource | null>(null);
  const pageUrlRef = useRef<string>('');
  const pageUrl2Ref = useRef<string>('');
  const nextPageUrlRef = useRef<string>('');
  const allPageUrlsRef = useRef<string[]>([]);
  const hideUITimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isZoomedRef = useRef(false);
  // All-pages scroll tracking
  const [visiblePage, setVisiblePage] = useState(0);
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [editPageInput, setEditPageInput] = useState('');
  const editPageInputRef = useRef('');
  editPageInputRef.current = editPageInput;
  const allPagesScrollRef = useRef<HTMLDivElement>(null);
  const pageImgRefs = useRef<(HTMLElement | null)[]>([]);
  const pageCounterInputRef = useRef<HTMLInputElement>(null);
  const saveProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSavePageRef = useRef<number | null>(null);
  const allPagesRestoreFrameRef = useRef<number | null>(null);
  const initialAllPagesRestoreRef = useRef(false);
  const allPagesLoadedCountRef = useRef(0);
  const visiblePageRef = useRef(0);
  visiblePageRef.current = visiblePage;
  // Touch gesture tracking
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const touchStartTimeRef = useRef(0);
  const lastTapTimeRef = useRef(0);
  const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bookmarks & notes
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [bookmarkNoteInput, setBookmarkNoteInput] = useState('');

  // Build the bookmark scope for the current reading context (comic or manga chapter).
  const getBookmarkScope = useCallback((): BookmarkScope | null => {
    if (target.kind === 'manga') {
      return { kind: 'manga', provider: target.provider, mangaId: target.mangaId, chapterId: target.chapterId };
    }
    const comic = comicRef.current;
    if (!comic) return null;
    return { kind: 'comic', comicId: comic.id };
  }, [target]);

  const refreshBookmarks = useCallback(async () => {
    const scope = getBookmarkScope();
    if (!scope) return;
    setBookmarks(await getBookmarks(scope));
  }, [getBookmarkScope]);

  useEffect(() => {
    void refreshBookmarks();
  }, [refreshBookmarks]);

  // Keep refs in sync so stale closures always read fresh values
  comicRef.current = comic;
  parserRef.current = parser;
  isZoomedRef.current = isZoomed;

  // Settings
  const [theme, setTheme] = useLocalStorage<Theme>('panelpass-theme', 'dark');
  // Global defaults (used for CBZ + as fallback for manga without stored prefs).
  const [readerMode, setReaderMode] = useLocalStorage<'single' | 'webtoon'>('panelpass-mode', 'single');
  const [pageSubMode, setPageSubMode] = useLocalStorage<PageSubMode>('panelpass-page-submode', 'single');
  const [webtoonSubMode, setWebtoonSubMode] = useLocalStorage<WebtoonSubMode>('panelpass-webtoon-submode', 'single');
  // Per-manga zoom (percentage). Defaults to 100; persisted per title.
  const [mangaZoom, setMangaZoom] = useState<number>(100);

  const isManga = target.kind === 'manga';
  const mangaKey = isManga ? `${target.provider}:${target.mangaId}` : null;

  // Load + apply this title's saved reader preferences (manga only).
  useEffect(() => {
    if (target.kind !== 'manga') return;
    const mt: MangaReaderTarget = target;
    let cancelled = false;
    getMangaPrefs(mt.provider, mt.mangaId).then((prefs) => {
      if (cancelled) return;
      if (prefs.readerMode) setReaderMode(prefs.readerMode);
      if (prefs.pageSubMode) setPageSubMode(prefs.pageSubMode);
      if (prefs.webtoonSubMode) setWebtoonSubMode(prefs.webtoonSubMode);
      if (prefs.zoom) setMangaZoom(prefs.zoom);
    });
    return () => { cancelled = true; };
  }, [target, setReaderMode, setPageSubMode, setWebtoonSubMode]);

  // Persist reader prefs whenever they change (manga only).
  useEffect(() => {
    if (target.kind !== 'manga') return;
    const mt: MangaReaderTarget = target;
    saveMangaPrefs(mt.provider, mt.mangaId, {
      readerMode,
      pageSubMode,
      webtoonSubMode,
      zoom: mangaZoom,
    });
  }, [target, readerMode, pageSubMode, webtoonSubMode, mangaZoom]);

  // Refs for fresh reads from stale closures (displayPage, handleTurnPage)
  const pageSubModeRef = useRef<PageSubMode>(pageSubMode);
  pageSubModeRef.current = pageSubMode;
  const readerModeRef = useRef<'single' | 'webtoon'>(readerMode);
  readerModeRef.current = readerMode;

  const isAllPages = readerMode === 'webtoon' && webtoonSubMode !== 'single';

  // Manga record (when reading an online chapter). null for local CBZ comics.
  const recordRef = useRef<{
    provider: string;
    mangaId: string;
    chapterId: string;
  } | null>(null);

  // Active manga target — swapable for Next/Prev chapter navigation without
  // unmounting the Reader. Starts as the incoming target.
  const [activeTarget, setActiveTarget] = useState<MangaReaderTarget | null>(
    target.kind === 'manga' ? target : null,
  );
  const [isSwitchingChapter, setIsSwitchingChapter] = useState(false);
  // True while a Next/Prev switch is in flight — lets loadComicFiles show the
  // in-reader overlay instead of blanking the whole screen to "Loading…".
  const isSwitchingRef = useRef(false);

  // Next/Prev chapter navigation.
  //
  // We navigate by READING ORDER: the chapter list sorted by the number parsed
  // from each label. Skipped numbers are fine (Next just goes to whatever chapter
  // exists next). To stay robust against DUPLICATE labels (two "Ch. 5"), we sort
  // stably by [parsedNumber, originalListIndex] so ties keep their source order
  // instead of collapsing into an unstable bucket. We do NOT use the raw list
  // position, because sources often return chapters in a non-reading order
  // (e.g. by updatedAt), which would jump around on Next/Prev.
  const rawChapters = activeTarget?.chapters ?? [];
  // Stable sort by [number, original index].
  const ordered = rawChapters
    .map((c, i) => ({ c, i, n: parseChapterNumber(c.chapter, c.title) }))
    .sort((a, b) => (a.n - b.n) || (a.i - b.i))
    .map((x) => x.c);

  const currentIndex = ordered.findIndex((c) => c.id === activeTarget?.chapterId);
  const hasNextChapter = currentIndex >= 0 && currentIndex < ordered.length - 1;
  const hasPrevChapter = currentIndex > 0;

  const goToChapter = useCallback(async (dir: 1 | -1) => {
    if (!activeTarget?.chapters || !activeTarget.loadChapterPages) return;
    const list = activeTarget.chapters
      .map((c, i) => ({ c, i, n: parseChapterNumber(c.chapter, c.title) }))
      .sort((a, b) => (a.n - b.n) || (a.i - b.i))
      .map((x) => x.c);
    const idx = list.findIndex((c) => c.id === activeTarget.chapterId);
    const target = list[idx + dir];
    if (!target) return;
    setIsSwitchingChapter(true);
    isSwitchingRef.current = true;
    try {
      const { pages, label, chapterId } = await activeTarget.loadChapterPages(target.id);
      setActiveTarget((prev) => prev && prev.kind === 'manga'
        ? { ...prev, chapterId, chapterLabel: label, pageUrls: pages.map((p) => p.url) }
        : prev);
    } catch (e) {
      console.error('Failed to load adjacent chapter', e);
      // Clear overlay immediately on error so it doesn't stick.
      setIsSwitchingChapter(false);
      isSwitchingRef.current = false;
    }
    // Note: isSwitchingChapter/isSwitchingRef are cleared by loadComicFiles
    // once the new page actually renders, so the overlay covers the full wait.
  }, [activeTarget]);

  // Persist progress to the correct store (CBZ → Comic, manga → MangaRecord).
  const saveProgress = useCallback((currentPage: number) => {
    const comic = comicRef.current;
    const rec = recordRef.current;
    if (rec) {
      updateMangaProgress(rec.provider, rec.mangaId, rec.chapterId, currentPage).catch(console.error);
    } else if (comic) {
      updateComicProgress(comic.id, currentPage).catch(console.error);
    }
  }, []);

  // Flush any pending progress write (webtoon scroll path uses a debounced timer).
  const flushPendingSave = useCallback(() => {
    if (saveProgressTimerRef.current) {
      clearTimeout(saveProgressTimerRef.current);
      saveProgressTimerRef.current = null;
      const page = pendingSavePageRef.current;
      if (page !== null) saveProgress(page);
    }
  }, [saveProgress]);

  useEffect(() => {
    // Persist the last read position if the tab/app is hidden or closed mid-scroll.
    const onHide = () => flushPendingSave();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flushPendingSave]);

  useEffect(() => {
    loadComicFiles();
    return () => {
      // Clean up object URLs on unmount using refs so the latest URLs are revoked
      if (hideUITimerRef.current) clearTimeout(hideUITimerRef.current);
      if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
      // IMPORTANT: flush the debounced progress write instead of just dropping it,
      // otherwise the last webtoon-scroll position is lost when leaving the reader.
      flushPendingSave();
      if (allPagesRestoreFrameRef.current) cancelAnimationFrame(allPagesRestoreFrameRef.current);
      if (pageUrlRef.current) URL.revokeObjectURL(pageUrlRef.current);
      if (pageUrl2Ref.current) URL.revokeObjectURL(pageUrl2Ref.current);
      if (nextPageUrlRef.current) URL.revokeObjectURL(nextPageUrlRef.current);
      allPageUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      allPageUrlsRef.current = [];
      // Offline chapters pre-create a blob: URL per page; revoke any still held
      // by the parser (single-mode scratch URLs are covered above).
      if (offlineParserRef.current) {
        offlineParserRef.current.revokeAll();
        offlineParserRef.current = null;
      }
    };
  }, [activeTarget, flushPendingSave]);

  // Load/unload all page blobs when switching in/out of webtoon-all mode
  useEffect(() => {
    if (isAllPages && parser) {
      initialAllPagesRestoreRef.current = true;
      allPagesLoadedCountRef.current = 0;
      setAllPagesImagesLoaded(false);
      void loadAllPages();
    } else {
      initialAllPagesRestoreRef.current = false;
      allPageUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      allPageUrlsRef.current = [];
      setAllPageUrls([]);
    }
  }, [isAllPages, parser]);

  // Track visible page in all-pages mode via IntersectionObserver
  useEffect(() => {
    if (!isAllPages || allPageUrls.length === 0) return;
    const root = allPagesScrollRef.current;
    if (!root) return;
    const ratios = new Map<number, number>();
    const elemToIdx = new Map<Element, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = elemToIdx.get(entry.target);
          if (idx !== undefined) ratios.set(idx, entry.intersectionRatio);
        });
        let maxIdx = 0, maxRatio = -1;
        ratios.forEach((ratio, idx) => { if (ratio > maxRatio) { maxRatio = ratio; maxIdx = idx; } });
        setVisiblePage(maxIdx);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    pageImgRefs.current.forEach((el, i) => {
      if (el) { elemToIdx.set(el, i); obs.observe(el); }
    });
    return () => obs.disconnect();
  }, [isAllPages, allPageUrls]);

  // Save progress when visible page changes in all-pages scroll mode
  useEffect(() => {
    if (!isAllPages) return;
    if (initialAllPagesRestoreRef.current) return;
    const c = comicRef.current;
    if (!c) return;
    // Keep comic state in sync so header/scrubber reflects scroll position
    setComic(prev => prev ? { ...prev, currentPage: visiblePage } : null);
    // Debounce the IndexedDB write to avoid hammering on every scroll tick
    pendingSavePageRef.current = visiblePage;
    if (saveProgressTimerRef.current) clearTimeout(saveProgressTimerRef.current);
    saveProgressTimerRef.current = setTimeout(() => {
      saveProgress(visiblePage);
    }, 600);
  }, [visiblePage, isAllPages]);

  // Restore the saved page once ALL page images have finished loading in webtoon all-pages mode.
  // Gating on load completion (not just element existence) ensures every image has its final
  // height before we scrollIntoView, so the resume lands exactly on the saved page.
  useEffect(() => {
    if (!isAllPages || isLoadingAll || allPageUrls.length === 0 || !allPagesImagesLoaded) return;
    const c = comicRef.current;
    if (!c) return;
    const targetPage = Math.max(0, Math.min(c.currentPage, c.totalPages - 1));

    if (allPagesRestoreFrameRef.current) cancelAnimationFrame(allPagesRestoreFrameRef.current);
    allPagesRestoreFrameRef.current = requestAnimationFrame(() => {
      allPagesRestoreFrameRef.current = requestAnimationFrame(() => {
        const el = pageImgRefs.current[targetPage];
        if (el) {
          el.scrollIntoView({
            behavior: 'auto',
            block: webtoonSubMode === 'all-h' ? 'nearest' : 'start',
            inline: webtoonSubMode === 'all-h' ? 'start' : 'nearest',
          });
        }

        setVisiblePage(targetPage);
        setComic((prev) => prev ? { ...prev, currentPage: targetPage } : null);
        allPagesRestoreFrameRef.current = requestAnimationFrame(() => {
          initialAllPagesRestoreRef.current = false;
        });
      });
    });
  }, [isAllPages, isLoadingAll, allPageUrls, webtoonSubMode, allPagesImagesLoaded]);

  // Re-display current page when sub-mode changes (e.g. single↔dual, webtoon-all→single)
  useEffect(() => {
    const p = parserRef.current;
    const c = comicRef.current;
    const inAllPages = readerModeRef.current === 'webtoon' && webtoonSubMode !== 'single';
    if (c && p && !inAllPages) void displayPage(p, c.currentPage);
  }, [pageSubMode, readerMode, webtoonSubMode]);

  const getPageBlobUrlForIndex = async (index: number) => {
    const p = parserRef.current;
    if (!p) {
      throw new Error('Comic file is not available in browser storage.');
    }
    return p.getPageBlobUrl(index);
  };

  const loadAllPages = async () => {
    setIsLoadingAll(true);
    try {
      const urls: string[] = [];
      const totalPages = comicRef.current?.totalPages ?? parserRef.current?.getTotalPages() ?? 0;
      for (let i = 0; i < totalPages; i++) {
        urls.push(await getPageBlobUrlForIndex(i));
      }
      allPageUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      allPageUrlsRef.current = urls;
      setAllPageUrls(urls);
    } catch (e) {
      console.error('Failed to load all pages', e);
    } finally {
      setIsLoadingAll(false);
    }
  };

  const loadComicFiles = async () => {
    // Use the active (possibly chapter-switched) target; fall back to the
    // original prop for the comic branch and first render.
    const t = activeTarget ?? target;
    // During a Next/Prev switch we keep the current page visible behind the
    // loading overlay (set by goToChapter) instead of blanking the screen.
    const switching = isSwitchingRef.current;
    try {
      if (!switching) setIsLoading(true);

      let _parser: PageSource;
      let meta: Comic;

      if (t.kind === 'comic') {
        const comics = await getComics();
        const found = comics.find((c) => c.id === t.comicId);
        if (!found) throw new Error('Comic metadata not found');
        meta = found;
        const fileBlob = await getComicFile(t.comicId);
        if (!fileBlob) throw new Error('Comic file not found on device');
        const cp = new ComicParser();
        await cp.load(fileBlob);
        _parser = cp;
        recordRef.current = null;
      } else {
        // Online manga chapter: pages come pre-fetched + proxied; restore from IndexedDB record.
        const mt = activeTarget!; // non-null in manga mode; reflects any chapter switch
        const rec = await getMangaRecord(mt.provider, mt.mangaId, mt.chapterId);
        const totalPages = mt.pageUrls.length;
        const startPage = rec?.currentPage ?? 0;
        meta = {
          id: rec?.key ?? `${mt.provider}:${mt.mangaId}:${mt.chapterId}`,
          title: mt.mangaTitle ?? mt.chapterLabel ?? 'Manga',
          addedAt: rec?.addedAt ?? Date.now(),
          lastViewedAt: rec?.lastViewedAt ?? Date.now(),
          currentPage: startPage,
          totalPages,
          isCompleted: rec?.isCompleted ?? false,
          source: { type: 'local' },
        };
        // Prefer offline blobs if this chapter was downloaded; otherwise stream
        // from the (proxied) network URLs.
        if (rec?.downloaded) {
          const stored = await getMangaPages(mt.provider, mt.mangaId, mt.chapterId);
          if (stored && stored.blobs.length > 0) {
            const offline = new OfflinePageSource(stored.blobs);
            _parser = offline;
            offlineParserRef.current = offline;
          } else {
            _parser = new RemotePageSource(mt.pageUrls);
          }
        } else {
          _parser = new RemotePageSource(mt.pageUrls);
        }
        recordRef.current = {
          provider: mt.provider,
          mangaId: mt.mangaId,
          chapterId: mt.chapterId,
        };
        // Record the open (lastViewedAt + ensure persisted) even on first view.
        await openMangaChapter({
          provider: mt.provider,
          mangaId: mt.mangaId,
          chapterId: mt.chapterId,
          mangaTitle: mt.mangaTitle,
          chapterLabel: mt.chapterLabel,
          coverUrl: mt.coverUrl ?? null,
          totalPages,
        });
      }

      setComic(meta);
      setParser(_parser);

      await displayPage(_parser, meta.currentPage);
      setIsLoading(false);
      if (switching) setIsSwitchingChapter(false);

      // Auto-hide UI after small delay
      hideUITimerRef.current = setTimeout(() => setShowUI(false), 2000);
    } catch (err) {
      console.error(err);
      setError('Failed to load. The file may be corrupted, deleted, or the network is unavailable.');
      setIsLoading(false);
      if (switching) setIsSwitchingChapter(false);
    }
  };

  const displayPage = async (p: PageSource, index: number) => {
    try {
      parserRef.current = p;
      const url = await getPageBlobUrlForIndex(index);
      setPageUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        pageUrlRef.current = url;
        return url;
      });
      setIsZoomed(false);

      // Second page for dual mode (reads refs so always fresh even in stale closures)
      const showDual = readerModeRef.current === 'single' && pageSubModeRef.current === 'dual';
      const totalPages = comicRef.current?.totalPages ?? p.getTotalPages();
      if (showDual && index + 1 < totalPages) {
        const url2 = await getPageBlobUrlForIndex(index + 1);
        setPageUrl2(prev => {
          if (prev) URL.revokeObjectURL(prev);
          pageUrl2Ref.current = url2;
          return url2;
        });
      } else {
        if (pageUrl2Ref.current) URL.revokeObjectURL(pageUrl2Ref.current);
        pageUrl2Ref.current = '';
        setPageUrl2('');
      }

      // Preload (skip ahead by 2 in dual mode)
      const preloadIdx = index + (showDual ? 2 : 1);
      if (preloadIdx < totalPages) {
        const nextUrl = await getPageBlobUrlForIndex(preloadIdx);
        setNextPageUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          nextPageUrlRef.current = nextUrl;
          return nextUrl;
        });
      } else {
        if (nextPageUrlRef.current) URL.revokeObjectURL(nextPageUrlRef.current);
        nextPageUrlRef.current = '';
        setNextPageUrl('');
      }
    } catch (e) {
      console.error('Failed to load page image', e);
    }
  };

  const handleTurnPage = useCallback(async (direction: number) => {
    const current = comicRef.current;
    if (!current) return;
    if (!parser) return;

    // In dual mode each turn advances by 2 pages
    const step = readerModeRef.current === 'single' && pageSubModeRef.current === 'dual' ? 2 : 1;
    const newIdx = current.currentPage + direction * step;
    if (newIdx < 0 || newIdx >= current.totalPages) return;

    // Optimistic UI update
    setComic(prev => prev ? { ...prev, currentPage: newIdx } : null);
    
    // Save progress asynchronously
    saveProgress(newIdx);
    
    await displayPage(parser, newIdx);
  }, [parser, saveProgress]);

  // Jump directly to an absolute 0-based page index (used by bookmarks + page counter).
  const gotoPage = useCallback((rawIdx: number) => {
    const c = comicRef.current;
    const p = parserRef.current;
    if (!c) return;
    let idx = Math.max(0, Math.min(rawIdx, c.totalPages - 1));
    // In dual-page mode snap to the left page of the spread (even 0-based index)
    const isDual = readerModeRef.current === 'single' && pageSubModeRef.current === 'dual';
    if (isDual && idx % 2 !== 0) idx -= 1;
    if (isAllPages) {
      const el = pageImgRefs.current[idx];
      if (el) {
        el.scrollIntoView({
          behavior: 'smooth',
          block: webtoonSubMode === 'all-h' ? 'nearest' : 'start',
          inline: webtoonSubMode === 'all-h' ? 'start' : 'nearest',
        });
      }
      setVisiblePage(idx);
    } else if (p) {
      setComic(prev => prev ? { ...prev, currentPage: idx } : null);
      saveProgress(idx);
      void displayPage(p, idx);
    }
  }, [isAllPages, webtoonSubMode, saveProgress]);

  // Bookmarks: toggle on the current page, edit notes, remove, and jump.
  const currentBookmarkPage = () => {
    const c = comicRef.current;
    if (!c) return 0;
    return isAllPages ? visiblePageRef.current : c.currentPage;
  };

  const handleToggleBookmark = useCallback(async () => {
    const scope = getBookmarkScope();
    if (!scope) return;
    const page = currentBookmarkPage();
    setBookmarks(await toggleBookmark(scope, page));
  }, [getBookmarkScope]);

  const handleSaveNote = useCallback(async (id: string) => {
    const scope = getBookmarkScope();
    if (!scope) return;
    setBookmarks(await updateBookmarkNote(scope, id, bookmarkNoteInput));
    setEditingBookmarkId(null);
    setBookmarkNoteInput('');
  }, [getBookmarkScope, bookmarkNoteInput]);

  const handleRemoveBookmark = useCallback(async (id: string) => {
    const scope = getBookmarkScope();
    if (!scope) return;
    setBookmarks(await removeBookmark(scope, id));
  }, [getBookmarkScope]);

  // Desktop click — just toggles the header UI (page turning = keyboard/swipe)
  const handleTap = () => {
    setShowUI(prev => !prev);
  };

  // Record touch start position and time
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
    touchStartTimeRef.current = Date.now();
  };

  // Swipe → turn page; double-tap → zoom in/out; single tap → toggle UI
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    const dy = e.changedTouches[0].clientY - touchStartYRef.current;
    const dt = Date.now() - touchStartTimeRef.current;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    // Horizontal swipe → turn page (disabled while zoomed so pan can work)
    if (!isZoomedRef.current && absX > 50 && absX > absY * 1.5 && dt < 400) {
      e.preventDefault();
      if (dx > 0) handleTurnPage(-1);
      else handleTurnPage(1);
      return;
    }

    // Tap (minimal movement) — disambiguate single vs. double tap
    if (absX < 15 && absY < 15) {
      e.preventDefault(); // suppress the subsequent click event on mobile
      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) {
        // Double tap — toggle zoom (CBZ only; manga uses the zoom dropdown)
        if (doubleTapTimerRef.current) {
          clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = null;
        }
        if (!isManga) {
          if (isZoomedRef.current) {
            setIsZoomed(false);
          } else {
            const touch = e.changedTouches[0];
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setZoomOrigin({
              x: ((touch.clientX - rect.left) / rect.width) * 100,
              y: ((touch.clientY - rect.top) / rect.height) * 100,
            });
            setIsZoomed(true);
          }
        }
        lastTapTimeRef.current = 0;
      } else {
        // Single tap — wait 300 ms to confirm it is not the first of a double tap
        lastTapTimeRef.current = now;
        doubleTapTimerRef.current = setTimeout(() => {
          setShowUI(prev => !prev);
          doubleTapTimerRef.current = null;
        }, 300);
      }
    }
  };

  // Touch end for the all-pages scrollable canvas — single tap toggles UI, double-tap zooms
  const handleTouchEndAllPages = (e: React.TouchEvent) => {
    if (e.changedTouches.length !== 1) return;
    const absX = Math.abs(e.changedTouches[0].clientX - touchStartXRef.current);
    const absY = Math.abs(e.changedTouches[0].clientY - touchStartYRef.current);
    if (absX < 15 && absY < 15) {
      e.preventDefault();
      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) {
        // Double tap — toggle zoom
        if (doubleTapTimerRef.current) {
          clearTimeout(doubleTapTimerRef.current);
          doubleTapTimerRef.current = null;
        }
        if (isZoomedRef.current) {
          setIsZoomed(false);
        } else {
          const touch = e.changedTouches[0];
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setZoomOrigin({
            x: ((touch.clientX - rect.left) / rect.width) * 100,
            y: ((touch.clientY - rect.top) / rect.height) * 100,
          });
          setIsZoomed(true);
        }
        lastTapTimeRef.current = 0;
      } else {
        lastTapTimeRef.current = now;
        doubleTapTimerRef.current = setTimeout(() => {
          setShowUI(prev => !prev);
          doubleTapTimerRef.current = null;
        }, 300);
      }
    }
  };

  const handleDoubleTap = (e: React.MouseEvent) => {
    if (!isZoomed) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setZoomOrigin({ x, y });
      setIsZoomed(true);
    } else {
      setIsZoomed(false);
    }
  };

  const handlePageCounterSubmit = useCallback(() => {
    setIsEditingPage(false);
    const c = comicRef.current;
    if (!c) return;
    const num = parseInt(editPageInputRef.current, 10);
    if (isNaN(num)) return;
    let idx = Math.max(0, Math.min(num - 1, c.totalPages - 1));
    // In dual-page mode snap to the left page of the spread (even 0-based index)
    const isDual = readerModeRef.current === 'single' && pageSubModeRef.current === 'dual';
    if (isDual && idx % 2 !== 0) idx -= 1;
    if (isAllPages) {
      const el = pageImgRefs.current[idx];
      if (el) {
        el.scrollIntoView({
          behavior: 'smooth',
          block: webtoonSubMode === 'all-h' ? 'nearest' : 'start',
          inline: webtoonSubMode === 'all-h' ? 'start' : 'nearest',
        });
      }
      setVisiblePage(idx);
    } else {
      // Direct jump — bypass handleTurnPage which treats its arg as a turn count
      // (turn count × step would give the wrong result in dual-page mode)
      setComic(prev => prev ? { ...prev, currentPage: idx } : null);
      saveProgress(idx);
      const p = parserRef.current;
      if (p) void displayPage(p, idx);
    }
  }, [isAllPages, webtoonSubMode]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        handleTurnPage(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault();
        handleTurnPage(-1);
      } else if (e.key === 'Escape') {
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTurnPage, onBack]);

  if (isLoading) return <div className="flex h-screen items-center justify-center">Loading comic engine...</div>;
  if (error) return <div className="flex h-screen flex-col items-center justify-center text-red-500"><p>{error}</p><button onClick={onBack} className="mt-4 underline">Go Back</button></div>;

  return (
    <div 
      className={cn(
        "fixed inset-0 select-none overflow-hidden transition-colors duration-300",
        theme === 'dark' ? "bg-black text-gray-200" : "bg-gray-100 text-gray-900"
      )}
    >
      {/* Hidden preload image */}
      {nextPageUrl && <img src={nextPageUrl} className="hidden" aria-hidden="true" alt="preload" />}

      {/* Chapter-switch loading overlay (Next/Prev) — mirrors the chapter-list spinner */}
      {isSwitchingChapter && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
          <Loader2 size={36} className="animate-spin text-cyan-400" />
          <p className="text-xs font-bold uppercase tracking-widest text-[#888]">Loading chapter…</p>
        </div>
      )}

      {/* Top Header UI */}
      <div 
        className={cn(
          "absolute top-0 left-0 right-0 z-50 transform transition-transform duration-300 p-3 flex flex-row items-start justify-between sm:items-center gap-2",
          theme === 'dark' ? "bg-gradient-to-b from-black/80 to-transparent" : "bg-gradient-to-b from-white/90 to-transparent shadow-sm",
          showUI ? "translate-y-0" : "-translate-y-full"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-black/10 transition-colors">
            <ArrowLeft size={24} />
          </button>
          <div className="overflow-hidden">
            <h2 className="font-bold italic uppercase tracking-tighter truncate sm:max-w-md max-w-[200px] text-lg">{comic?.title}</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#888]">
              {isAllPages
                ? `All ${comic?.totalPages} pages`
                : pageSubMode === 'dual' && readerMode === 'single'
                  ? `Pages ${(comic?.currentPage ?? 0) + 1}–${Math.min((comic?.currentPage ?? 0) + 2, comic?.totalPages ?? 1)} of ${comic?.totalPages}`
                  : `Page ${(comic?.currentPage ?? 0) + 1} of ${comic?.totalPages}`}
            </p>
          </div>
        </div>

        {/* Prev / Next chapter navigation (manga only, when siblings are known) */}
        {activeTarget?.chapters && activeTarget.chapters.length > 1 && (
          <div className="hidden md:flex items-center gap-1.5">
            <button
              onClick={() => goToChapter(-1)}
              disabled={!hasPrevChapter || isSwitchingChapter}
              className={cn(
                'p-2 rounded border transition-colors',
                hasPrevChapter && !isSwitchingChapter
                  ? 'border-white/10 hover:bg-white/5 text-[#CCC]'
                  : 'border-white/5 text-[#555] opacity-40 cursor-not-allowed',
              )}
              title="Previous chapter"
            >
              <ArrowLeft size={16} />
            </button>
            <button
              onClick={() => goToChapter(1)}
              disabled={!hasNextChapter || isSwitchingChapter}
              className={cn(
                'p-2 rounded border transition-colors flex items-center gap-1.5',
                hasNextChapter && !isSwitchingChapter
                  ? 'border-cyan-400/40 hover:bg-cyan-400/10 text-cyan-400'
                  : 'border-white/5 text-[#555] opacity-40 cursor-not-allowed',
              )}
              title="Next chapter"
            >
              {isSwitchingChapter ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
              <span className="text-[10px] font-bold uppercase tracking-widest">Next</span>
            </button>
          </div>
        )}

        <div className="flex flex-col items-end sm:flex-row sm:items-center gap-1.5">
          {/* Main mode: Single / Webtoon */}
          <div className={cn("flex flex-col sm:flex-row rounded border", theme === 'dark' ? 'border-white/10' : 'border-black/10')}>
            <button
              onClick={() => setReaderMode('single')}
              className={cn('p-2 transition-colors rounded-t sm:rounded-t-none sm:rounded-l', readerMode === 'single' ? 'bg-cyan-400/20 text-cyan-400' : 'hover:bg-white/5')}
              title="Page mode"
            >
              <LayoutPanelLeft size={18} />
            </button>
            <button
              onClick={() => setReaderMode('webtoon')}
              className={cn('p-2 transition-colors rounded-b sm:rounded-b-none sm:rounded-r', readerMode === 'webtoon' ? 'bg-cyan-400/20 text-cyan-400' : 'hover:bg-white/5')}
              title="Webtoon / scroll mode"
            >
              <Smartphone size={18} />
            </button>
          </div>

          {/* Sub-mode buttons */}
          <div className={cn("flex flex-col sm:flex-row rounded border", theme === 'dark' ? 'border-white/10' : 'border-black/10')}>
            {readerMode === 'single' ? (
              <>
                <button
                  onClick={() => setPageSubMode('single')}
                  className={cn('p-2 transition-colors rounded-t sm:rounded-t-none sm:rounded-l', pageSubMode === 'single' ? 'bg-cyan-400/20 text-cyan-400' : 'hover:bg-white/5')}
                  title="Single page"
                >
                  <LayoutPanelLeft size={16} />
                </button>
                <button
                  onClick={() => setPageSubMode('dual')}
                  className={cn('p-2 transition-colors rounded-b sm:rounded-b-none sm:rounded-r', pageSubMode === 'dual' ? 'bg-cyan-400/20 text-cyan-400' : 'hover:bg-white/5')}
                  title="Dual page spread"
                >
                  <BookOpen size={16} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setWebtoonSubMode('single')}
                  className={cn('p-2 transition-colors rounded-t sm:rounded-t-none sm:rounded-l', webtoonSubMode === 'single' ? 'bg-cyan-400/20 text-cyan-400' : 'hover:bg-white/5')}
                  title="One page at a time"
                >
                  <AlignJustify size={16} />
                </button>
                <button
                  onClick={() => setWebtoonSubMode('all-v')}
                  className={cn('p-2 transition-colors', webtoonSubMode === 'all-v' ? 'bg-cyan-400/20 text-cyan-400' : 'hover:bg-white/5')}
                  title="All pages — vertical scroll"
                >
                  <GalleryVertical size={16} />
                </button>
                <button
                  onClick={() => setWebtoonSubMode('all-h')}
                  className={cn('p-2 transition-colors rounded-b sm:rounded-b-none sm:rounded-r', webtoonSubMode === 'all-h' ? 'bg-cyan-400/20 text-cyan-400' : 'hover:bg-white/5')}
                  title="All pages — horizontal scroll"
                >
                  <GalleryHorizontal size={16} />
                </button>
              </>
            )}
          </div>

          {/* Zoom dropdown (manga only — replaces double-tap zoom) */}
          {isManga && (
            <div className="flex items-center rounded border border-white/10 overflow-hidden">
              <select
                value={mangaZoom}
                onChange={(e) => setMangaZoom(Number(e.target.value))}
                className="bg-[#161616] text-[#CCC] text-xs font-bold uppercase tracking-widest px-2 py-2 outline-none cursor-pointer"
                title="Zoom"
              >
                <option value={100}>100%</option>
                <option value={125}>125%</option>
                <option value={150}>150%</option>
                <option value={200}>200%</option>
                <option value={250}>250%</option>
                <option value={300}>300%</option>
              </select>
            </div>
          )}

          <div className="hidden sm:block w-px h-6 bg-gray-500/30 mx-0.5" />

          {/* Theme */}
          <div className={cn("flex flex-col sm:flex-row rounded border", theme === 'dark' ? 'border-white/10' : 'border-black/10')}>
            <button onClick={() => setTheme('light')} className={cn('p-2 transition-colors rounded-t sm:rounded-t-none sm:rounded-l', theme === 'light' ? 'bg-cyan-400/20 text-cyan-400' : 'hover:bg-white/5')} title="Light theme"><Sun size={18} /></button>
            <button onClick={() => setTheme('dark')} className={cn('p-2 transition-colors rounded-b sm:rounded-b-none sm:rounded-r', theme === 'dark' ? 'bg-cyan-400/20 text-cyan-400' : 'hover:bg-white/5')} title="Dark theme"><Moon size={18} /></button>
          </div>

          {/* Bookmarks */}
          <button
            onClick={() => setShowBookmarks(true)}
            className={cn(
              'relative p-2 rounded border transition-colors',
              bookmarks.some((b) => b.page === currentBookmarkPage())
                ? 'bg-cyan-400/20 text-cyan-400 border-cyan-400/40'
                : theme === 'dark' ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-white/5',
            )}
            title="Bookmarks & notes"
          >
            <BookmarkIcon size={18} />
            {bookmarks.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-cyan-400 text-black text-[10px] font-black flex items-center justify-center">
                {bookmarks.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Reading Canvas */}
      {isAllPages ? (
        // Webtoon all-pages mode — scroll freely through all images
        <div
          ref={allPagesScrollRef}
          className={cn(
            'h-full w-full',
            webtoonSubMode === 'all-h'
              ? 'flex flex-row items-center overflow-x-auto'
              : 'flex flex-col items-center overflow-y-auto',
          )}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEndAllPages}
          onClick={handleTap}
          onDoubleClick={handleDoubleTap}
        >
          {isLoadingAll ? (
            <div className="flex items-center justify-center w-full h-full text-sm font-bold uppercase tracking-widest text-[#888]">
              Loading all pages…
            </div>
          ) : (
            <div
              className={cn(
                'transition-transform duration-300 ease-out',
                webtoonSubMode === 'all-h' ? 'flex flex-row items-center h-full' : 'flex flex-col items-center w-full',
              )}
              style={{
                transform: `scale(${isManga ? mangaZoom / 100 : isZoomed ? 1.5 : 1})`,
                transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
              }}
            >
              {allPageUrls.map((url, i) => (
                <img
                  key={i}
                  ref={(el) => { pageImgRefs.current[i] = el; }}
                  src={url}
                  alt={`Page ${i + 1}`}
                  className={cn(
                    'object-contain flex-shrink-0',
                    webtoonSubMode === 'all-h' ? 'h-full w-auto' : 'w-full max-w-3xl',
                  )}
                  draggable={false}
                  onLoad={() => {
                    // Count completed image decodes so the resume scroll waits until
                    // every page has its final height before we scrollIntoView.
                    allPagesLoadedCountRef.current += 1;
                    if (allPagesLoadedCountRef.current >= allPageUrls.length) {
                      setAllPagesImagesLoaded(true);
                    }
                  }}
                  onError={() => {
                    // Don't let a single failed image block the resume scroll forever.
                    allPagesLoadedCountRef.current += 1;
                    if (allPagesLoadedCountRef.current >= allPageUrls.length) {
                      setAllPagesImagesLoaded(true);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        // Single / Dual / Webtoon-single — tap-to-turn canvas
        <div
          onClick={handleTap}
          onDoubleClick={handleDoubleTap}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className={cn(
            'h-full w-full flex justify-center',
            readerMode === 'webtoon' ? 'items-start overflow-y-auto' : 'items-center overflow-hidden',
          )}
          style={{ cursor: isZoomed ? 'zoom-out' : 'default' }}
        >
          {pageSubMode === 'dual' && readerMode === 'single' ? (
            // Dual-page spread
            <div className="flex h-full w-full items-center justify-center overflow-hidden">
              {pageUrl && (
                <img
                  src={pageUrl}
                  alt="Left page"
                  className="h-full w-1/2 object-contain transition-transform duration-300 ease-out"
                  style={{
                    transform: `scale(${isManga ? mangaZoom / 100 : isZoomed ? 2.5 : 1})`,
                    transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
                  }}
                  draggable={false}
                />
              )}
              {pageUrl2 && (
                <img
                  src={pageUrl2}
                  alt="Right page"
                  className="h-full w-1/2 object-contain"
                  draggable={false}
                />
              )}
            </div>
          ) : (
            // Single page or webtoon-single
            pageUrl && (
              <img
                src={pageUrl}
                alt="Comic Page"
                className={cn(
                  'transition-transform duration-300 ease-out',
                  readerMode === 'webtoon' ? 'w-full max-w-3xl h-auto' : 'h-full max-w-full object-contain',
                )}
                style={{
                  transform: `scale(${isManga ? mangaZoom / 100 : isZoomed ? 2.5 : 1})`,
                  transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
                }}
                draggable={false}
              />
            )
          )}
        </div>
      )}

      {/* Interactive page counter — always visible, tap to jump to page */}
      {comic && (
        <div
          className="absolute bottom-4 right-4 z-50"
          onClick={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {isEditingPage ? (
            <div className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-sm',
              theme === 'dark' ? 'bg-black/85 text-gray-200' : 'bg-white/95 text-gray-800 shadow',
            )}>
              <input
                ref={pageCounterInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                min={1}
                max={comic.totalPages}
                value={editPageInput}
                onChange={(e) => setEditPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handlePageCounterSubmit();
                  if (e.key === 'Escape') setIsEditingPage(false);
                  e.stopPropagation();
                }}
                onBlur={handlePageCounterSubmit}
                className="w-10 bg-transparent text-xs font-mono text-right outline-none border-b border-cyan-400"
              />
              <span className="text-xs font-mono text-[#888]">/ {comic.totalPages}</span>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={handlePageCounterSubmit}
                className="ml-1 text-cyan-400 text-xs font-bold px-1.5 py-0.5 rounded hover:bg-cyan-400/20 active:bg-cyan-400/30"
                aria-label="Go to page"
              >
                ✓
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                const current = isAllPages ? visiblePage : comic.currentPage;
                setEditPageInput(String(current + 1));
                setIsEditingPage(true);
                setTimeout(() => pageCounterInputRef.current?.select(), 0);
              }}
              className={cn(
                'text-xs font-mono px-2 py-1 rounded-sm opacity-70 hover:opacity-100 transition-opacity',
                theme === 'dark' ? 'bg-black/70 text-gray-300' : 'bg-white/80 text-gray-700 shadow-sm',
              )}
            >
              {isAllPages
                ? `${visiblePage + 1} / ${comic.totalPages}`
                : pageSubMode === 'dual' && readerMode === 'single'
                  ? `${comic.currentPage + 1}–${Math.min(comic.currentPage + 2, comic.totalPages)} / ${comic.totalPages}`
                  : `${comic.currentPage + 1} / ${comic.totalPages}`}
            </button>
          )}
        </div>
      )}

      {/* Bottom Progress Bar UI */}
      <div 
        className={cn(
          "absolute bottom-0 left-0 right-0 z-50 transform transition-transform duration-300 h-1 cursor-default",
          showUI ? "translate-y-0" : "translate-y-full",
          theme === 'dark' ? "bg-gray-800" : "bg-gray-200"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div 
          className="h-full bg-cyan-400 transition-all duration-200" 
          style={{ width: comic ? `${((comic.currentPage + 1) / comic.totalPages) * 100}%` : '0%' }}
        />
        
        {/* Scrubber — hidden in all-pages mode since all pages are visible */}
        {showUI && !isAllPages && (
          <div className={cn("absolute bottom-1 w-full px-4 py-8 flex items-center gap-4", theme === 'dark' ? "bg-gradient-to-t from-black/90 to-transparent" : "bg-gradient-to-t from-white/90 to-transparent")}>
            <span className="text-xs font-mono">{comic?.currentPage !== undefined ? comic.currentPage + 1 : 1}</span>
            <input 
              type="range"
              min={0}
              max={comic ? comic.totalPages - 1 : 100}
              value={comic?.currentPage || 0}
              onChange={(e) => handleTurnPage(parseInt(e.target.value) - (comic?.currentPage || 0))}
              className="w-full accent-cyan-400"
              onClick={e => e.stopPropagation()} // Prevent closing UI
            />
            <span className="text-xs font-mono">{comic?.totalPages}</span>
          </div>
        )}
      </div>

      {/* Bookmarks & Notes panel (slide-in from the right) */}
      {showBookmarks && (
        <>
          <div
            className="absolute inset-0 z-[60] bg-black/50"
            onClick={() => { setShowBookmarks(false); setEditingBookmarkId(null); }}
          />
          <div
            className={cn(
              'absolute top-0 right-0 z-[61] h-full w-80 max-w-[85vw] flex flex-col',
              theme === 'dark' ? 'bg-[#161616] border-l border-[#2A2A2A] text-gray-200' : 'bg-white border-l border-gray-200 text-gray-900',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-[#2A2A2A]">
              <h3 className="text-sm font-bold uppercase tracking-widest">Bookmarks & Notes</h3>
              <button onClick={() => { setShowBookmarks(false); setEditingBookmarkId(null); }} className="p-1 rounded hover:bg-white/5" title="Close">
                <X size={18} />
              </button>
            </div>

            <div className="p-3 border-b border-[#2A2A2A]">
              <button
                onClick={handleToggleBookmark}
                className="w-full bg-cyan-400 text-black text-xs font-black uppercase tracking-widest py-2 rounded hover:scale-[1.02] active:scale-95 transition-transform"
              >
                {bookmarks.some((b) => b.page === currentBookmarkPage())
                  ? `Remove bookmark on page ${currentBookmarkPage() + 1}`
                  : `Bookmark page ${currentBookmarkPage() + 1}`}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {bookmarks.length === 0 ? (
                <p className="text-xs text-[#666] text-center mt-8">
                  No bookmarks yet. Bookmark the current page to save your spot with an optional note.
                </p>
              ) : (
                bookmarks.map((bm) => (
                  <div
                    key={bm.id}
                    className={cn(
                      'rounded border p-3 transition-colors',
                      theme === 'dark' ? 'border-[#2A2A2A] hover:border-cyan-400/40' : 'border-gray-200 hover:border-cyan-400',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => { gotoPage(bm.page); setShowBookmarks(false); setEditingBookmarkId(null); }}
                        className="text-xs font-black text-cyan-400 uppercase tracking-widest hover:underline"
                      >
                        Page {bm.page + 1}
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setEditingBookmarkId(bm.id); setBookmarkNoteInput(bm.note); }}
                          className="text-[#888] hover:text-cyan-400 text-[11px] font-bold uppercase px-1.5 py-0.5 rounded"
                          title="Edit note"
                        >
                          Note
                        </button>
                        <button
                          onClick={() => handleRemoveBookmark(bm.id)}
                          className="text-[#888] hover:text-red-400 text-[11px] font-bold uppercase px-1.5 py-0.5 rounded"
                          title="Remove bookmark"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    {editingBookmarkId === bm.id ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <textarea
                          value={bookmarkNoteInput}
                          onChange={(e) => setBookmarkNoteInput(e.target.value)}
                          placeholder="Add a private note…"
                          rows={3}
                          className="w-full bg-[#0F0F0F] border border-[#333] rounded p-2 text-xs text-gray-200 outline-none focus:border-cyan-400 resize-none"
                        />
                        <button
                          onClick={() => handleSaveNote(bm.id)}
                          className="self-end bg-cyan-400 text-black text-[11px] font-bold uppercase px-3 py-1 rounded"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      bm.note && <p className="mt-1.5 text-xs text-[#AAA] whitespace-pre-wrap break-words">{bm.note}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
