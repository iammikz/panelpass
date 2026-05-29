import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Moon, Sun, Smartphone, LayoutPanelLeft } from 'lucide-react';
import { getComics, getComicFile, updateComicProgress } from '../lib/db';
import { ComicParser } from '../lib/parser';
import { Comic, Theme } from '../types';
import { cn } from '../lib/utils';
import { useLocalStorage } from 'usehooks-ts';

export default function Reader({ comicId, onBack }: { comicId: string; onBack: () => void }) {
  const [comic, setComic] = useState<Comic | null>(null);
  const [parser, setParser] = useState<ComicParser | null>(null);
  const [pageUrl, setPageUrl] = useState<string>('');
  const [nextPageUrl, setNextPageUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // UI State
  const [showUI, setShowUI] = useState(true);
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const comicRef = useRef<Comic | null>(null);
  const pageUrlRef = useRef<string>('');
  const nextPageUrlRef = useRef<string>('');
  const hideUITimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep comicRef in sync with the latest comic state on every render so that
  // event handlers always read the most current page without stale closures.
  comicRef.current = comic;

  // Settings
  const [theme, setTheme] = useLocalStorage<Theme>('panelpass-theme', 'dark');
  const [readerMode, setReaderMode] = useLocalStorage<'single' | 'webtoon'>('panelpass-mode', 'single');

  useEffect(() => {
    loadComicFiles();
    return () => {
      // Clean up object URLs on unmount using refs so the latest URLs are revoked
      if (hideUITimerRef.current) clearTimeout(hideUITimerRef.current);
      if (pageUrlRef.current) URL.revokeObjectURL(pageUrlRef.current);
      if (nextPageUrlRef.current) URL.revokeObjectURL(nextPageUrlRef.current);
    };
  }, [comicId]);

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
      setIsZoomed(false); // Reset zoom on turn
      
      // Preload next page
      if (index + 1 < p.getTotalPages()) {
        const nextUrl = await p.getPageBlobUrl(index + 1);
        setNextPageUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          nextPageUrlRef.current = nextUrl;
          return nextUrl;
        });
      }
    } catch(e) {
      console.error("Failed to load page image", e);
    }
  };

  const handleTurnPage = useCallback(async (direction: number) => {
    const current = comicRef.current;
    if (!current || !parser) return;
    
    const newIdx = current.currentPage + direction;
    if (newIdx < 0 || newIdx >= current.totalPages) return;

    // Optimistic UI update
    setComic(prev => prev ? { ...prev, currentPage: newIdx } : null);
    
    // Save progress asynchronously
    updateComicProgress(current.id, newIdx).catch(console.error);
    
    await displayPage(parser, newIdx);
  }, [parser]);

  const handleTap = (e: React.MouseEvent) => {
    if (isZoomed) {
      // If zoomed, tapping anywhere zooms out
      setIsZoomed(false);
      return;
    }

    const { clientX } = e;
    const { innerWidth } = window;
    
    // UI toggle zone (center 40%)
    const xRatio = clientX / innerWidth;
    if (xRatio > 0.3 && xRatio < 0.7) {
      setShowUI(prev => !prev);
      return;
    }

    // Page turning zones
    if (xRatio <= 0.3) { // Left 30%
      handleTurnPage(-1);
    } else { // Right 30%
      handleTurnPage(1);
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
        theme === 'dark' ? "bg-black text-gray-200" : theme === 'light' ? "bg-gray-100 text-gray-900" : "bg-[#f4ecd8] text-[#5c4a3d]"
      )}
    >
      {/* Hidden preload image */}
      {nextPageUrl && <img src={nextPageUrl} className="hidden" aria-hidden="true" alt="preload" />}

      {/* Top Header UI */}
      <div 
        className={cn(
          "absolute top-0 left-0 right-0 z-50 transform transition-transform duration-300 p-4 flex items-center justify-between",
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
              Page {comic ? comic.currentPage + 1 : 0} of {comic?.totalPages}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Layout Mode Toggles */}
          <button 
            onClick={() => setReaderMode('single')} 
            className={cn("p-2 rounded-full", readerMode === 'single' && (theme === 'dark' ? "bg-white/10" : "bg-black/5"))}
            title="Single Page Mode"
          >
            <LayoutPanelLeft size={20} />
          </button>
          <button 
            onClick={() => setReaderMode('webtoon')} 
            className={cn("p-2 rounded-full", readerMode === 'webtoon' && (theme === 'dark' ? "bg-white/10" : "bg-black/5"))}
            title="Vertical Scroll Mode"
          >
            <Smartphone size={20} />
          </button>
          
          <div className="w-px h-6 bg-gray-500/30 mx-1"></div>

          {/* Theme Toggles */}
          <button onClick={() => setTheme('light')} className={cn("p-2 rounded-full", theme === 'light' && "bg-black/5")}><Sun size={20}/></button>
          <button onClick={() => setTheme('dark')} className={cn("p-2 rounded-full", theme === 'dark' && "bg-white/10")}><Moon size={20}/></button>
          <button onClick={() => setTheme('sepia')} className={cn("p-2 rounded-full font-serif font-bold w-10 text-center", theme === 'sepia' && "bg-black/5")}>S</button>
        </div>
      </div>

      {/* Reading Canvas */}
      <div 
        onClick={handleTap}
        onDoubleClick={handleDoubleTap}
        className={cn(
          "h-full w-full flex justify-center cursor-pointer",
          readerMode === 'webtoon' ? "items-start overflow-y-auto" : "items-center overflow-hidden"
        )}
        style={{
          cursor: isZoomed ? 'zoom-out' : 'default'
        }}
      >
        {pageUrl && (
          <img 
            src={pageUrl} 
            alt="Comic Page" 
            className={cn(
              "transition-transform duration-300 ease-out",
              readerMode === 'webtoon' ? "w-full max-w-3xl h-auto" : "h-full max-w-full object-contain"
            )}
            style={{
              transform: isZoomed ? 'scale(2.5)' : 'scale(1)',
              transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`
            }}
            draggable={false}
          />
        )}
      </div>

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
        
        {/* Scrubber / Slider (Only visible when UI is shown) */}
        {showUI && (
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
