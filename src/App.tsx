import { useState } from 'react';
import Library from './components/Library';
import Reader from './components/Reader';
import Settings from './components/Settings';

export default function App() {
  const [currentView, setCurrentView] = useState<'library' | 'reader' | 'settings'>('library');
  const [activeComicId, setActiveComicId] = useState<string | null>(null);

  const handleOpenComic = (id: string) => {
    setActiveComicId(id);
    setCurrentView('reader');
  };

  const handleBackToLibrary = () => {
    setActiveComicId(null);
    setCurrentView('library');
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F0F0F0] font-sans selection:bg-cyan-500/30 flex flex-col">
      {currentView === 'library' ? (
        <Library
          onOpenComic={handleOpenComic}
          onOpenSettings={() => setCurrentView('settings')}
        />
      ) : currentView === 'settings' ? (
        <Settings onBack={handleBackToLibrary} />
      ) : activeComicId ? (
        <Reader
          comicId={activeComicId}
          onBack={handleBackToLibrary}
        />
      ) : null}
    </div>
  );
}
