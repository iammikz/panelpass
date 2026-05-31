import { ArrowLeft, HardDrive, Cloud, Info } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLocalStorage } from 'usehooks-ts';

export const DRIVE_STORAGE_KEY = 'panelpass-drive-storage';

export default function Settings({ onBack }: { onBack: () => void }) {
  const [driveStorage, setDriveStorage] = useLocalStorage<boolean>(DRIVE_STORAGE_KEY, false);

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

          <div className={cn(
            "border rounded-lg overflow-hidden",
            driveStorage ? "border-cyan-400/30" : "border-[#2A2A2A]"
          )}>
            {/* Toggle row */}
            <div className="flex items-center justify-between gap-4 p-5 bg-[#111]">
              <div className="flex items-center gap-3">
                {driveStorage
                  ? <Cloud size={22} className="text-cyan-400 shrink-0" />
                  : <HardDrive size={22} className="text-[#666] shrink-0" />
                }
                <div>
                  <p className="font-bold text-sm">Google Drive Cloud Storage</p>
                  <p className="text-xs text-[#888] mt-0.5">
                    {driveStorage
                      ? 'Active — pages saved to your Drive'
                      : 'Off — comics saved to this device'}
                  </p>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => setDriveStorage(!driveStorage)}
                className={cn(
                  "relative w-11 h-6 rounded-full transition-colors shrink-0 focus:outline-none",
                  driveStorage ? "bg-cyan-400" : "bg-[#333]"
                )}
                aria-label="Toggle Google Drive storage"
                role="switch"
                aria-checked={driveStorage}
              >
                <span className={cn(
                  "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200",
                  driveStorage ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>

            {/* Info panel */}
            {!driveStorage ? (
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
                      file into your browser's built-in storage on this device. Comics load instantly and
                      work fully offline, but they are only available on this browser.
                    </p>
                    <p className="text-[#666] text-xs">
                      Clearing browser data or site storage will permanently remove all saved comics.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border-t border-cyan-400/20 bg-[#0D0D0D] p-5">
                <div className="flex gap-3">
                  <Info size={16} className="text-cyan-400/60 shrink-0 mt-0.5" />
                  <div className="text-sm text-[#888] space-y-2 leading-relaxed">
                    <p>
                      <span className="text-white font-semibold">Currently using: Google Drive cloud storage</span>
                    </p>
                    <p>
                      When you import a comic, PanelPass will extract each page and upload it to your
                      Google Drive under the following path:
                    </p>
                    <code className="block bg-[#1a1a1a] border border-[#2A2A2A] text-cyan-400 font-mono text-xs px-3 py-2.5 rounded">
                      panelpass/extracted/comics/&lt;comic-title&gt;/
                    </code>
                    <p>
                      Each page is stored as an individual image file inside the comic's folder. Once
                      uploaded, you can open and read your library from{' '}
                      <span className="text-white font-semibold">any device</span> as long as you're
                      signed in to Google — no re-importing needed.
                    </p>
                    <p className="text-amber-400/80 text-xs">
                      ⚠ Requires an active Google Drive connection. Importing a comic will be slower
                      than local storage since pages are uploaded to the cloud during the process.
                    </p>
                  </div>
                </div>
              </div>
            )}
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
              ['Cross-device access',    '✗',       '✓'],
              ['Survives browser clear', '✗',       '✓'],
              ['Import speed',           'Fast',    'Slower'],
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
                <div className={cn(
                  "p-3 text-center border-l border-[#1a1a1a] font-mono",
                  driveStorage ? "text-cyan-400 font-bold" : "text-[#444]"
                )}>
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
