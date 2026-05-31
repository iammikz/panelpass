import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Moon, Sun, Smartphone, LayoutPanelLeft, BookOpen, AlignJustify, GalleryVertical, GalleryHorizontal } from 'lucide-react';
import { getComics, getComicFile, updateComicProgress } from '../lib/db';
import { ComicParser } from '../lib/parser';
import { Comic, Theme } from '../types';
import { cn } from '../lib/utils';
import { useLocalStorage } from 'usehooks-ts';

export default function Reader({ comicId, onBack }: { comicId: string; onBack: () => void }) {
  type PageSubMode = 'single' | 'dual';
  type WebtoonSubMode = 'single' | 'all-v' | 'all-h';

  const [comic, setComic] = useState<Comic | null>(null);
  const [parser, setParser] = useState<ComicParser | null>(null);
  const [pageUrl, setPageUrl] = useState<string>('');
  const [pageUrl2, setPageUrl2] = useState<string>('');
  const [nextPageUrl, setNextPageUrl] = useState<string>('');
  const [allPageUrls, setAllPageUrls] = useState<string[]>([]);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI State
  const [showUI, setShowUI] = useState(true);
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const comicRef = useRef<Comic | null>(null);
  const parserRef = useRef<ComicParser | null>(null);
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
  // Touch gesture tracking
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const touchStartTimeRef = useRef(0);
  const lastTapTimeRef = useRef(0);
  const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync so stale closures always read fresh values
  comicRef.current = comic;
  parserRef.current = parser;
  isZoomedRef.current = isZoomed;

  // Settings
  const [theme, setTheme] = useLocalStorage<Theme>('panelpass-theme', 'dark');
  const [readerMode, setReaderMode] = useLocalStorage<'single' | 'webtoon'>('panelpass-mode', 'single');
  const [pageSubMode, setPageSubMode] = useLocalStorage<PageSubMode>('panelpass-page-submode', 'single');
  const [webtoonSubMode, setWebtoonSubMode] = useLocalStorage<WebtoonSubMode>('panelpass-webtoon-submode', 'single');

  // Refs for fresh reads from stale closures (displayPage, handleTurnPage)
  const pageSubModeRef = useRef<PageSubMode>(pageSubMode);
  pageSubModeRef.current = pageSubMode;
  const readerModeRef = useRef<'single' | 'webtoon'>(readerMode);
  readerModeRef.current = readerMode;

  const isAllPages = readerMode === 'webtoon' && webtoonSubMode !== 'single';

  useEffect(() => {
    loadComicFiles();
    return () => {
      // Clean up object URLs on unmount using refs so the latest URLs are revoked
      if (hideUITimerRef.current) clearTimeout(hideUITimerRef.current);
      if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
      if (pageUrlRef.current) URL.revokeObjectURL(pageUrlRef.current);
      if (pageUrl2Ref.current) URL.revokeObjectURL(pageUrl2Ref.current);
      if (nextPageUrlRef.current) URL.revokeObjectURL(nextPageUrlRef.current);
      allPageUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [comicId]);

  // Load/unload all page blobs when switching in/out of webtoon-all mode
  useEffect(() => {
    if (isAllPages && parser) {
      void loadAllPages(parser);
    } else {
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

  // Re-display current page when sub-mode changes (e.g. single↔dual, webtoon-all→single)
  useEffect(() => {
    const p = parserRef.current;
    const c = comicRef.current;
    const inAllPages = readerModeRef.current === 'webtoon' && webtoonSubMode !== 'single';
    if (p && c && !inAllPages) void displayPage(p, c.currentPage);
  }, [pageSubMode, readerMode, webtoonSubMode]);

  const loadAllPages = async (p: ComicParser) => {
    setIsLoadingAll(true);
    try {
      const urls: string[] = [];
      for (let i = 0; i < p.getTotalPages(); i++) {
        urls.push(await p.getPageBlobUrl(i));
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
    try {
      setIsLoading(true);
      const comics = await getComics();
      const meta = comics.find(c => c.id === comicId);
      if (!meta) throw new Error("Comic metadata not found");
      
      setComic(meta);
      const fileBlob = await getComicFile(comicId);
      if (!fileBlob) throw new Error("Comic file not found on device");

      const _parser = new ComicParser();
      await _parser.load(fileBlob);
      setParser(_parser);
      
      await displayPage(_parser, meta.currentPage);
      setIsLoading(false);
      
      // Auto-hide UI after small delay
      hideUITimerRef.current = setTimeout(() => setShowUI(false), 2000);
    } catch (err) {
      console.error(err);
      setError("Failed to load comic. It may be corrupted or deleted.");
      setIsLoading(false);
    }
  };

  const displayPage = async (p: ComicParser, index: number) => {
    try {
      const url = await p.getPageBlobUrl(index);
      setPageUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        pageUrlRef.current = url;
        return url;
      });
      setIsZoomed(false);

      // Second page for dual mode (reads refs so always fresh even in stale closures)
      const showDual = readerModeRef.current === 'single' && pageSubModeRef.current === 'dual';
      if (showDual && index + 1 < p.getTotalPages()) {
        const url2 = await p.getPageBlobUrl(index + 1);
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
      if (preloadIdx < p.getTotalPages()) {
        const nextUrl = await p.getPageBlobUrl(preloadIdx);
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
    if (!current || !parser) return;

    // In dual mode each turn advances by 2 pages
    const step = readerModeRef.current === 'single' && pageSubModeRef.current === 'dual' ? 2 : 1;
    const newIdx = current.currentPage + direction * step;
    if (newIdx < 0 || newIdx >= current.totalPages) return;

    // Optimistic UI update
    setComic(prev => prev ? { ...prev, currentPage: newIdx } : null);
    
    // Save progress asynchronously
    updateComicProgress(current.id, newIdx).catch(console.error);
    
    await displayPage(parser, newIdx);
  }, [parser]);

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
      void handleTurnPage(idx - c.currentPage);
    }
  }, [isAllPages, webtoonSubMode, handleTurnPage]);

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

          <div className="hidden sm:block w-px h-6 bg-gray-500/30 mx-0.5" />

          {/* Theme */}
          <div className={cn("flex flex-col sm:flex-row rounded border", theme === 'dark' ? 'border-white/10' : 'border-black/10')}>
            <button onClick={() => setTheme('light')} className={cn('p-2 transition-colors rounded-t sm:rounded-t-none sm:rounded-l', theme === 'light' ? 'bg-cyan-400/20 text-cyan-400' : 'hover:bg-white/5')} title="Light theme"><Sun size={18} /></button>
            <button onClick={() => setTheme('dark')} className={cn('p-2 transition-colors rounded-b sm:rounded-b-none sm:rounded-r', theme === 'dark' ? 'bg-cyan-400/20 text-cyan-400' : 'hover:bg-white/5')} title="Dark theme"><Moon size={18} /></button>
          </div>
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
                transform: isZoomed ? 'scale(1.5)' : 'scale(1)',
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
                    transform: isZoomed ? 'scale(2.5)' : 'scale(1)',
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
                  transform: isZoomed ? 'scale(2.5)' : 'scale(1)',
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
    </div>
  );
}
