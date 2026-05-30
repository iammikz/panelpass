import { useState, useEffect } from 'react';
import { Upload, Cloud, ChevronLeft, ChevronRight, X, BookOpen, ScrollText, Zap } from 'lucide-react';
import { cn } from '../lib/utils';

export const STORAGE_KEY = 'panelpass_howto_seen';

interface Step {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    icon: (
      <div className="w-16 h-16 bg-cyan-400 rounded-sm transform -rotate-12 flex items-center justify-center text-black font-black text-4xl font-display select-none">
        P
      </div>
    ),
    eyebrow: 'Welcome',
    title: 'Your Comics. Your Way.',
    body: (
      <>
        PanelPass is a <span className="text-white font-bold">local-first, offline</span> comic reader
        that runs entirely in your browser. Your files stay on your device — no accounts, no servers,
        no uploads to the cloud.
      </>
    ),
  },
  {
    icon: <Upload size={40} className="text-cyan-400" />,
    eyebrow: 'Step 1 — Local Files',
    title: 'Upload Your Comics',
    body: (
      <>
        Click <span className="text-cyan-400 font-bold uppercase tracking-wide">Upload Comics</span> in
        the header, or <span className="text-white font-bold">drag &amp; drop</span> a file directly
        onto the bookshelf.
        <br /><br />
        Supported formats:{' '}
        <span className="text-cyan-400 font-bold">.cbz</span>,{' '}
        <span className="text-cyan-400 font-bold">.zip</span>, and{' '}
        <span className="text-cyan-400 font-bold">.cbr</span>.
        Files are stored locally in your browser and never leave your device.
      </>
    ),
  },
  {
    icon: <Cloud size={40} className="text-cyan-400" />,
    eyebrow: 'Step 2 — Google Drive',
    title: 'Import from Drive',
    body: (
      <>
        Click <span className="text-cyan-400 font-bold uppercase tracking-wide">Connect Google Drive</span>{' '}
        to import comics straight from your Drive.
        <br /><br />
        Before connecting, create a folder named exactly{' '}
        <code className="bg-[#1a1a1a] border border-[#333] text-cyan-400 font-mono px-2 py-0.5 rounded text-sm">
          panelpass
        </code>{' '}
        in your Google Drive and add your{' '}
        <span className="text-white font-bold">.cbz</span> or{' '}
        <span className="text-white font-bold">.cbr</span> files inside it.
        PanelPass will scan that folder automatically.
      </>
    ),
  },
  {
    icon: <BookOpen size={40} className="text-cyan-400" />,
    eyebrow: 'Step 3 — Reader',
    title: 'Single-Page Mode',
    body: (
      <>
        <span className="text-white font-bold">Click or tap</span> the right half of the page to go
        forward, the left half to go back.
        <br /><br />
        Keyboard shortcuts:{' '}
        <span className="text-cyan-400 font-bold">→ / Space</span> to advance,{' '}
        <span className="text-cyan-400 font-bold">←</span> to go back,{' '}
        <span className="text-cyan-400 font-bold">Esc</span> to return to the bookshelf.
        <br /><br />
        <span className="text-white font-bold">Double-click</span> any panel to zoom in for a closer look.
      </>
    ),
  },
  {
    icon: <ScrollText size={40} className="text-cyan-400" />,
    eyebrow: 'Step 4 — Reader',
    title: 'Webtoon Mode',
    body: (
      <>
        Switch to{' '}
        <span className="text-cyan-400 font-bold uppercase tracking-wide">Webtoon</span> in the reader
        toolbar for vertical infinite scroll — perfect for long-strip manhwa and webtoons.
        <br /><br />
        Toggle between <span className="text-white font-bold">Single Page</span> and{' '}
        <span className="text-white font-bold">Webtoon</span> anytime while reading.
        Your mode preference is remembered across sessions.
      </>
    ),
  },
  {
    icon: <Zap size={40} className="text-cyan-400" />,
    eyebrow: "You're all set",
    title: 'Ready to Read',
    body: (
      <>
        PanelPass <span className="text-white font-bold">auto-saves your reading progress</span> per
        comic — reopen any book to continue right where you left off.
        <br /><br />
        Hit <span className="text-cyan-400 font-bold">Esc</span> or the{' '}
        <span className="text-cyan-400 font-bold">×</span> button in the reader to return to your
        bookshelf at any time. Happy reading! 📖
      </>
    ),
  },
];

interface HowToUseProps {
  open: boolean;
  onClose: () => void;
}

export default function HowToUse({ open, onClose }: HowToUseProps) {
  const [step, setStep] = useState(0);

  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setStep(0);
    onClose();
  };

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-lg bg-[#0F0F0F] border border-[#2A2A2A] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Accent bar */}
        <div className="h-1 w-full bg-gradient-to-r from-cyan-400/0 via-cyan-400 to-cyan-400/0" />

        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 text-[#555] hover:text-white transition-colors p-1"
          title="Close"
        >
          <X size={18} />
        </button>

        {/* Content */}
        <div className="px-10 pt-10 pb-8 flex flex-col items-center text-center min-h-[380px]">
          <div className="mb-6 flex items-center justify-center h-16">
            {current.icon}
          </div>

          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-400 mb-2">
            {current.eyebrow}
          </p>

          <h2 className="text-2xl font-black italic uppercase tracking-tight font-display mb-5 text-white">
            {current.title}
          </h2>

          <p className="text-sm text-[#999] leading-relaxed max-w-sm">
            {current.body}
          </p>
        </div>

        {/* Footer */}
        <div className="border-t border-[#1e1e1e] px-10 py-5 flex items-center justify-between bg-[#0a0a0a]">
          {/* Step dots */}
          <div className="flex items-center gap-2">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === step ? 'w-6 bg-cyan-400' : 'w-1.5 bg-[#333] hover:bg-[#555]',
                )}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-3">
            {isFirst ? (
              <button
                onClick={handleClose}
                className="text-xs font-bold uppercase tracking-widest text-[#555] hover:text-white transition-colors"
              >
                Skip
              </button>
            ) : (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-[#666] hover:text-white transition-colors"
              >
                <ChevronLeft size={14} />
                Back
              </button>
            )}

            <button
              onClick={isLast ? handleClose : () => setStep((s) => s + 1)}
              className="bg-cyan-400 text-black px-5 py-2 font-black text-xs uppercase tracking-tight transform skew-x-[-12deg] hover:scale-105 active:scale-95 transition-all"
            >
              <span className="transform skew-x-[12deg] flex items-center gap-2">
                {isLast ? (
                  'Start Reading'
                ) : (
                  <>
                    Next
                    <ChevronRight size={14} />
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
