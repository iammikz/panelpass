import { useEffect } from 'react';
import { ArrowLeft, HardDrive, Cloud, Info } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLocalStorage } from 'usehooks-ts';

export const DRIVE_STORAGE_KEY = 'panelpass-drive-storage';

export default function Settings({ onBack }: { onBack: () => void }) {
  const [driveStorage, setDriveStorage] = useLocalStorage<boolean>(DRIVE_STORAGE_KEY, false);
  const isDriveStorageAvailable = false;

  useEffect(() => {
    if (driveStorage) {
      setDriveStorage(false);
    }
  }, [driveStorage, setDriveStorage]);

  return (
    <div className="flex flex-col min-h-screen bg-[#0D0D0D] text-[#F0F0F0] font-sans">
      <header className="h-16 border-b border-[#2A2A2A] flex items-center gap-4 px-6 bg-[#0F0F0F] shrink-0">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-white/5 transition-colors"
          aria-label="Back to library"
        >
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-xl font-black italic tracking-tighter uppercase">Settings</h1>
      </header>

      <main className="flex-1 p-6 sm:p-10 max-w-2xl mx-auto w-full space-y-10">

        {/* ── Storage Section ── */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-[#888] mb-4">Storage</h2>

          <div className="border rounded-lg overflow-hidden border-[#2A2A2A]">
            {/* Toggle row */}
            <div className="flex items-center justify-between gap-4 p-5 bg-[#111]">
              <div className="flex items-center gap-3">
                <Cloud size={22} className="text-[#666] shrink-0" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-sm">Google Drive Cloud Storage</p>
                    <span className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-300">
                      Under Maintenance
                    </span>
                  </div>
                  <p className="text-xs text-[#888] mt-0.5">Disabled — comics and progress are saved to this browser</p>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                disabled={!isDriveStorageAvailable}
                className="relative w-11 h-6 rounded-full bg-[#222] transition-colors shrink-0 focus:outline-none opacity-60 cursor-not-allowed"
                aria-label="Toggle Google Drive storage"
                role="switch"
                aria-checked={false}
                title="Google Drive cloud storage is under maintenance"
              >
                <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 translate-x-0" />
              </button>
            </div>

            {/* Info panel */}
            <div className="border-t border-[#2A2A2A] bg-[#0D0D0D] p-5">
              <div className="flex gap-3">
                <Info size={16} className="text-[#555] shrink-0 mt-0.5" />
                <div className="text-sm text-[#888] space-y-2 leading-relaxed">
                  <p>
                    <span className="text-white font-semibold">Currently using: Browser local storage (IndexedDB)</span>
                  </p>
                  <p>
                    PanelPass saves the entire{' '}
                    <code className="text-cyan-400 text-xs bg-[#1a1a1a] border border-[#2A2A2A] px-1.5 py-0.5 rounded">.cbr / .cbz</code>{' '}
                    file into your browser's built-in storage on this device. Files imported from
                    Google Drive are downloaded into the browser first, then read locally.
                  </p>
                  <p>
                    Reading progress and last viewed pages are also saved locally in the browser.
                    Cloud sync for extracted pages and progress is paused while this option is under maintenance.
                  </p>
                  <p className="text-[#666] text-xs">
                    Clearing browser data or site storage will permanently remove all saved comics and progress.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Comparison table ── */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-[#888] mb-4">Storage Comparison</h2>
          <div className="border border-[#2A2A2A] rounded-lg overflow-hidden text-sm">
            <div className="grid grid-cols-3 bg-[#111] border-b border-[#2A2A2A]">
              <div className="p-3" />
              <div className="p-3 text-xs font-bold uppercase text-center border-l border-[#2A2A2A] text-[#888]">
                <HardDrive size={13} className="inline mr-1 mb-0.5" />Local
              </div>
              <div className="p-3 text-xs font-bold uppercase text-center border-l border-[#2A2A2A] text-[#888]">
                <Cloud size={13} className="inline mr-1 mb-0.5 text-cyan-400" />Drive
              </div>
            </div>
            {([
              ['Works offline',          '✓',       '✗'],
              ['Cross-device access',    '✗',       'Paused'],
              ['Survives browser clear', '✗',       'Paused'],
              ['Import speed',           'Fast',    'Paused'],
              ['Needs Google account',   'No',      'Yes'],
            ] as [string, string, string][]).map(([label, local, drive]) => (
              <div key={label} className="grid grid-cols-3 border-b border-[#1a1a1a] last:border-0">
                <div className="p-3 text-[#777]">{label}</div>
                <div className={cn(
                  "p-3 text-center border-l border-[#1a1a1a] font-mono",
                  !driveStorage ? "text-cyan-400 font-bold" : "text-[#444]"
                )}>
                  {local}
                </div>
                <div className="p-3 text-center border-l border-[#1a1a1a] font-mono text-[#444]">
                  {drive}
                </div>
              </div>
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
