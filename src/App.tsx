import { useState } from 'react';
import Library from './components/Library';
import Reader from './components/Reader';
import Settings from './components/Settings';
import Manga from './components/Manga';
import { BookOpen, Library as LibraryIcon } from 'lucide-react';

type View = 'library' | 'manga' | 'reader' | 'settings';

export default function App() {
  const [currentView, setCurrentView] = useState<View>('library');
  const [activeComicId, setActiveComicId] = useState<string | null>(null);

  const handleOpenComic = (id: string) => {
    setActiveComicId(id);
    setCurrentView('reader');
  };

  const handleBackToLibrary = () => {
    setActiveComicId(null);
    setCurrentView('library');
  };

  const TabButton = ({
    active,
    onClick,
    icon: Icon,
    label,
  }: {
    active: boolean;
    onClick: () => void;
    icon: typeof BookOpen;
    label: string;
  }) => (
    <button
      onClick={onClick}
      className={
        'flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ' +
        (active ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-[#666] hover:text-[#DDD]')
      }
    >
      <Icon size={16} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div className="h-screen bg-[#0A0A0A] text-[#F0F0F0] font-sans selection:bg-cyan-500/30 flex flex-col overflow-hidden">
      <nav className="h-12 border-b border-[#2A2A2A] bg-[#0F0F0F] flex items-center px-4 gap-2 shrink-0">
        <TabButton active={currentView === 'library'} onClick={() => setCurrentView('library')} icon={LibraryIcon} label="Library" />
        <TabButton active={currentView === 'manga'} onClick={() => setCurrentView('manga')} icon={BookOpen} label="Manga" />
      </nav>

      {/* Library and Manga are kept MOUNTED (hidden via CSS) so switching tabs
          never loses in-progress search results or the open chapter list.
          Each active view gets a height-constrained flex box so it scrolls
          internally (keeping its header fixed) instead of the whole page. */}
      <div className={currentView === 'library' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
        <Library onOpenComic={handleOpenComic} onOpenSettings={() => setCurrentView('settings')} />
      </div>
      <div className={currentView === 'manga' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
        <Manga onOpenSettings={() => setCurrentView('settings')} />
      </div>

      {currentView === 'settings' ? (
        <Settings onBack={handleBackToLibrary} />
      ) : currentView === 'reader' && activeComicId ? (
        <Reader target={{ kind: 'comic', comicId: activeComicId }} onBack={handleBackToLibrary} />
      ) : null}
    </div>
  );
}
