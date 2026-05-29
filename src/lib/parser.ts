import JSZip from 'jszip';

const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

function isImage(filename: string): boolean {
  const lower = filename.toLowerCase();
  // ignore Mac OS metadata files
  if (lower.includes('__macosx') || lower.includes('.ds_store')) return false;
  return imageExtensions.some((ext) => lower.endsWith(ext));
}

export class ComicParser {
  private zip: JSZip | null = null;
  private imagePaths: string[] = [];

  async load(fileBlob: Blob) {
    this.zip = await JSZip.loadAsync(fileBlob);
    
    // Extract all file paths, filter to images, and sort them naturally to ensure page order is correct
    this.imagePaths = Object.keys(this.zip.files)
      .filter((filename) => !this.zip!.files[filename].dir && isImage(filename))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      
    if (this.imagePaths.length === 0) {
      throw new Error('No images found in the archive.');
    }
  }

  getTotalPages(): number {
    return this.imagePaths.length;
  }

  async getPageBlobUrl(pageIndex: number): Promise<string> {
    if (!this.zip || !this.imagePaths[pageIndex]) {
      throw new Error('Invalid page index or zip not loaded');
    }
    const path = this.imagePaths[pageIndex];
    const file = this.zip.file(path);
    if (!file) throw new Error('File not found inside archive');
    
    const blob = await file.async('blob');
    return URL.createObjectURL(blob);
  }

  async getCoverBase64(): Promise<string> {
    if (!this.zip || this.imagePaths.length === 0) {
      throw new Error('Zip not loaded or empty');
    }
    const path = this.imagePaths[0];
    const file = this.zip.file(path);
    if (!file) throw new Error('Cover file not found');
    
    // We get the cover as base64 so we can easily store it in localForage metadata (which limits blob usage in arrays sometimes, and base64 string is easily serialized)
    const base64 = await file.async('base64');
    
    // Simple mime type detection based on extension
    const ext = path.split('.').pop()?.toLowerCase();
    let mime = 'image/jpeg';
    if (ext === 'png') mime = 'image/png';
    else if (ext === 'webp') mime = 'image/webp';
    else if (ext === 'gif') mime = 'image/gif';
    else if (ext === 'bmp') mime = 'image/bmp';
    
    return `data:${mime};base64,${base64}`;
  }
}
