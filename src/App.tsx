import { useState } from 'react';
import { useLocalStorage } from 'usehooks-ts';
import Library from './components/Library';
import Reader from './components/Reader';
import Settings, { DRIVE_STORAGE_KEY } from './components/Settings';

export default function App() {
  const [currentView, setCurrentView] = useState<'library' | 'reader' | 'settings'>('library');
  const [activeComicId, setActiveComicId] = useState<string | null>(null);
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [driveStorage] = useLocalStorage<boolean>(DRIVE_STORAGE_KEY, false);

  const handleOpenComic = (id: string) => {
    setActiveComicId(id);
    setCurrentView('reader');
  };

  const handleBackToLibrary = () => {
    setActiveComicId(null);
    setCurrentView('library');
  };

  const handleDriveTokenChange = (token: string | null, _expiry: number | null) => {
    setDriveToken(token);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F0F0F0] font-sans selection:bg-cyan-500/30 flex flex-col">
      {currentView === 'library' ? (
        <Library
          onOpenComic={handleOpenComic}
          onOpenSettings={() => setCurrentView('settings')}
          driveToken={driveToken}
          driveEnabled={driveStorage}
          onDriveTokenChange={handleDriveTokenChange}
        />
      ) : currentView === 'settings' ? (
        <Settings onBack={handleBackToLibrary} />
      ) : activeComicId ? (
        <Reader
          comicId={activeComicId}
          onBack={handleBackToLibrary}
          driveToken={driveToken}
          driveEnabled={driveStorage}
        />
      ) : null}
    </div>
  );
}
