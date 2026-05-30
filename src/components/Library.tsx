import { useState, useEffect, useRef } from 'react';
import { Upload, Trash2, CheckCircle2, HelpCircle } from 'lucide-react';
import GoogleDrivePicker from './GoogleDrivePicker';
import HowToUse, { STORAGE_KEY as HOWTO_STORAGE_KEY } from './HowToUse';
import { getComics, saveComicFile, saveComicMetadata, deleteComic } from '../lib/db';
import { ComicParser } from '../lib/parser';
import { Comic } from '../types';
import { generateId, cn } from '../lib/utils';

type ImportableFile = File & {
  driveMetadata?: {
    id: string;
    name: string;
  };
};

export default function Library({ onOpenComic }: { onOpenComic: (id: string) => void }) {
  const [comics, setComics] = useState<Comic[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showHowToUse, setShowHowToUse] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadComics();
    if (!localStorage.getItem(HOWTO_STORAGE_KEY)) {
      setShowHowToUse(true);
    }
  }, []);

  const loadComics = async () => {
    const loaded = await getComics();
    setComics(loaded.sort((a, b) => b.addedAt - a.addedAt));
  };

  const importedDriveIds = new Set(
    comics
      .filter((comic) => comic.source.type === 'google-drive')
      .map((comic) => comic.source.driveFileId),
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const processFile = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    try {
      if (!file.name.toLowerCase().match(/\.(cbz|zip|cbr)$/i)) {
        throw new Error('Only .cbz, .zip, and .cbr files are supported for import.');
      }

      const parser = new ComicParser();
      await parser.load(file);
      const totalPages = parser.getTotalPages();
      const coverImage = await parser.getCoverBase64();
      const driveMetadata = (file as ImportableFile).driveMetadata;

      const newComic: Comic = {
        id: generateId(),
        title: file.name.replace(/\.(cbz|zip|cbr)$/i, ''),
        addedAt: Date.now(),
        currentPage: 0,
        totalPages,
        coverImage,
        isCompleted: false,
        source: driveMetadata
          ? {
              type: 'google-drive',
              driveFileId: driveMetadata.id,
              driveName: driveMetadata.name,
            }
          : { type: 'local' },
      };

      await saveComicFile(newComic.id, file);
      await saveComicMetadata(newComic);
      await loadComics();
    } catch (err) {
      console.error(err);
      setUploadError(err instanceof Error ? err.message : 'Error processing comic file');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this comic?')) {
      await deleteComic(id);
      await loadComics();
    }
  };

  return (
    <div className="flex flex-col h-full flex-1">
      <header className="h-16 border-b border-[#2A2A2A] flex items-center justify-between px-8 bg-[#0F0F0F]">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-cyan-400 rounded-sm transform -rotate-12 flex items-center justify-center text-black font-black text-xl font-display">P</div>
          <h1 className="text-2xl font-black italic tracking-tighter uppercase font-display hidden sm:block">PanelPass</h1>
        </div>
        
        <div className="flex items-center gap-6">
          <input 
            type="file" 
            accept=".cbz,.zip,.cbr" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileChange}
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="bg-cyan-400 text-black px-6 py-2 font-black text-sm uppercase tracking-tight transform skew-x-[-12deg] hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100"
          >
            <div className="transform skew-x-[12deg] flex items-center gap-2">
              <Upload size={16} />
              {isUploading ? 'Uploading...' : 'Upload Comics'}
            </div>
          </button>

          <GoogleDrivePicker onImport={processFile} importedDriveIds={importedDriveIds} />

          <button
            onClick={() => setShowHowToUse(true)}
            className="border border-[#333] p-2 text-[#666] hover:border-cyan-400 hover:text-cyan-400 transition-colors"
            title="How to use"
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </header>

      <main className="flex-1 p-8 bg-[#0D0D0D] flex flex-col">
        {uploadError && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-lg mb-8">
            {uploadError}
          </div>
        )}

        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold uppercase tracking-tight italic font-display">Your Bookshelf</h3>
          <span className="text-xs border border-[#333] px-3 py-1 rounded text-[#888] font-bold uppercase tracking-widest">{comics.length} {comics.length === 1 ? 'Book' : 'Books'}</span>
        </div>

        {comics.length === 0 && !isUploading ? (
          <div 
            className="border-2 border-dashed border-[#333] flex flex-col items-center justify-center p-16 hover:border-cyan-400 hover:bg-[#111] transition-all group rounded-xl max-w-2xl mx-auto w-full my-auto"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <div className="text-5xl mb-4 group-hover:scale-125 transition-transform text-[#444] group-hover:text-cyan-400">+</div>
            <h3 className="text-[14px] font-bold uppercase tracking-widest mb-2 text-[#888] group-hover:text-white transition-colors">Add Comic Files</h3>
            <p className="text-[#555] text-xs text-center max-w-sm mt-2">
              Drag and drop a `.cbz`, `.zip`, or `.cbr` comic file here, or use the upload and Google Drive buttons in the header.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 flex-1 content-start">
            {comics.map(comic => {
              const progress = comic.totalPages > 1 ? (comic.currentPage / (comic.totalPages - 1)) * 100 : 100;
              return (
                <div 
                  key={comic.id} 
                  onClick={() => onOpenComic(comic.id)}
                  className="flex flex-col gap-2 group cursor-pointer"
                >
                  <div className="aspect-[2/3] bg-[#222] border-2 border-[#333] group-hover:border-cyan-400 overflow-hidden relative shadow-lg">
                    <div className="absolute inset-0 bg-gradient-to-tr from-cyan-400/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none"></div>
                    
                    {comic.coverImage ? (
                      <img src={comic.coverImage} alt={comic.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-2">
                        <div className="bg-black/80 p-2 text-[10px] font-bold uppercase mt-auto text-cyan-400">Page 1</div>
                      </div>
                    )}
                    
                    {comic.isCompleted ? (
                      <div className="absolute top-2 right-2 z-20 w-4 h-4 rounded-full bg-cyan-400 flex items-center justify-center text-black">
                        <CheckCircle2 size={12} strokeWidth={3} />
                      </div>
                    ) : (
                      <div className="absolute top-2 right-2 z-20 w-4 h-4 rounded-full bg-cyan-400/50 group-hover:bg-cyan-400 transition-colors"></div>
                    )}

                    <button 
                      onClick={(e) => handleDelete(e, comic.id)}
                      className="absolute top-2 left-2 z-20 bg-black/80 text-[#888] rounded p-1.5 opacity-0 group-hover:opacity-100 hover:bg-black hover:text-red-500 hover:border-red-500 border border-[#333] transition-all"
                      title="Delete comic"
                    >
                      <Trash2 size={14} />
                    </button>

                    <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col h-full justify-between pointer-events-none">
                       <div className="mt-auto">
                          <div className="bg-black/90 p-2 text-[10px] font-bold uppercase tracking-tighter w-full border-t border-[#333] flex justify-between">
                            <span>Pg {comic.currentPage + 1}</span>
                            <span className="text-[#666]">{comic.totalPages} total</span>
                          </div>
                          <div className="h-1 bg-[#111] overflow-hidden">
                            <div 
                              className="h-full bg-cyan-400 transition-all duration-300" 
                              style={{ width: `${Math.max(progress, 0)}%` }}
                            />
                          </div>
                       </div>
                    </div>
                  </div>
                  
                  <p className="text-xs font-bold uppercase truncate tracking-wide text-[#CCC] group-hover:text-white transition-colors" title={comic.title}>
                    {comic.title}
                  </p>
                </div>
              );
            })}
            
            <div 
              className="aspect-[2/3] border-2 border-dashed border-[#333] flex items-center justify-center flex-col gap-2 hover:border-cyan-400 hover:bg-[#111] transition-all group cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="text-3xl text-[#555] group-hover:text-cyan-400 group-hover:scale-125 transition-all">+</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#555] group-hover:text-cyan-400">Add Comic</span>
            </div>
          </div>
        )}

        {comics.length > 0 && (
          <div className="mt-auto border-t border-[#2A2A2A] pt-6 mt-12 flex flex-col gap-4">
            <h4 className="text-xs font-bold text-[#555] uppercase tracking-widest">Reading Stats</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[#161616] p-4 rounded border border-[#222] relative overflow-hidden">
                <div className="absolute -right-2 -bottom-2 text-4xl opacity-[0.03]">📚</div>
                <p className="text-[10px] text-[#888] font-bold uppercase mb-1">Total Books</p>
                <p className="text-2xl font-black italic font-display">{comics.length}</p>
              </div>
              <div className="bg-[#161616] p-4 rounded border border-[#222] relative overflow-hidden">
                <div className="absolute -right-2 -bottom-2 text-4xl opacity-[0.03]">⚡</div>
                <p className="text-[10px] text-[#888] font-bold uppercase mb-1">Completed</p>
                <p className="text-2xl font-black italic font-display text-cyan-400">{comics.filter(c => c.isCompleted).length}</p>
              </div>
              <div className="bg-[#161616] p-4 rounded border border-[#222] relative overflow-hidden">
                <div className="absolute -right-2 -bottom-2 text-4xl opacity-[0.03]">📖</div>
                <p className="text-[10px] text-[#888] font-bold uppercase mb-1">Total Pages</p>
                <p className="text-2xl font-black italic font-display">{comics.reduce((acc, c) => acc + c.totalPages, 0)}</p>
              </div>
            </div>
          </div>
        )}
      </main>
      
      <HowToUse open={showHowToUse} onClose={() => setShowHowToUse(false)} />

      <footer className="h-12 bg-black border-t border-[#222] hidden sm:flex items-center justify-between px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-[#555] mt-auto">
        <div className="flex gap-4">
          <span>Local Storage: Active</span>
          <span className="text-cyan-400">PanelPass v1.0</span>
        </div>
        <div className="flex gap-8">
          <span className="hover:text-white cursor-pointer transition-colors">Privacy: Offline Only</span>
          <span className="hover:text-white cursor-pointer transition-colors">Theme: Deep Dark</span>
        </div>
      </footer>
    </div>
  );
}
