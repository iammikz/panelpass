import JSZip from 'jszip';
import { createExtractorFromData } from 'node-unrar-js';
import wasmUrl from 'node-unrar-js/esm/js/unrar.wasm?url';

const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

function isImage(filename: string): boolean {
  const lower = filename.toLowerCase();
  // ignore Mac OS metadata files
  if (lower.includes('__macosx') || lower.includes('.ds_store')) return false;
  return imageExtensions.some((ext) => lower.endsWith(ext));
}

function mimeForFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/jpeg';
}

let wasmBinaryCache: ArrayBuffer | null = null;

async function getWasmBinary(): Promise<ArrayBuffer> {
  if (!wasmBinaryCache) {
    wasmBinaryCache = await fetch(wasmUrl).then((r) => r.arrayBuffer());
  }
  return wasmBinaryCache;
}

export class ComicParser {
  private zip: JSZip | null = null;
  private imagePaths: string[] = [];
  private rarBlobs: Blob[] | null = null;

  async load(fileBlob: Blob) {
    // Detect RAR by magic bytes: "Rar!" = 52 61 72 21
    const headerBuf = await fileBlob.slice(0, 4).arrayBuffer();
    const bytes = new Uint8Array(headerBuf);
    const isRar = bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21;

    if (isRar) {
      await this.loadRar(fileBlob);
    } else {
      await this.loadZip(fileBlob);
    }
  }

  private async loadZip(fileBlob: Blob) {
    this.zip = await JSZip.loadAsync(fileBlob);
    this.imagePaths = Object.keys(this.zip.files)
      .filter((filename) => !this.zip!.files[filename].dir && isImage(filename))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    if (this.imagePaths.length === 0) {
      throw new Error('No images found in the archive.');
    }
  }

  private async loadRar(fileBlob: Blob) {
    const data = await fileBlob.arrayBuffer();
    const wasmBinary = await getWasmBinary();
    const extractor = await createExtractorFromData({ data, wasmBinary });

    // Collect and sort all image file headers
    const fileList = extractor.getFileList();
    const imageHeaders = [...fileList.fileHeaders]
      .filter((h) => !h.flags.directory && isImage(h.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    if (imageHeaders.length === 0) {
      throw new Error('No images found in the archive.');
    }

    // Extract matching images
    const imageNames = new Set(imageHeaders.map((h) => h.name));
    const extracted = extractor.extract({ files: (h) => imageNames.has(h.name) });

    const blobMap = new Map<string, Blob>();
    for (const file of extracted.files) {
      if (file.extraction) {
        blobMap.set(
          file.fileHeader.name,
          new Blob([file.extraction], { type: mimeForFilename(file.fileHeader.name) }),
        );
      }
    }

    this.rarBlobs = imageHeaders.map((h) => {
      const blob = blobMap.get(h.name);
      if (!blob) throw new Error(`Failed to extract page: ${h.name}`);
      return blob;
    });
  }

  getTotalPages(): number {
    return this.rarBlobs ? this.rarBlobs.length : this.imagePaths.length;
  }

  async getPageBlob(pageIndex: number): Promise<Blob> {
    if (this.rarBlobs) {
      const blob = this.rarBlobs[pageIndex];
      if (!blob) throw new Error('Invalid page index');
      return blob;
    }

    if (!this.zip || !this.imagePaths[pageIndex]) {
      throw new Error('Invalid page index or zip not loaded');
    }
    const path = this.imagePaths[pageIndex];
    const file = this.zip.file(path);
    if (!file) throw new Error('File not found inside archive');
    const blob = await file.async('blob');
    return new Blob([blob], { type: mimeForFilename(path) });
  }

  async getPageBlobUrl(pageIndex: number): Promise<string> {
    return URL.createObjectURL(await this.getPageBlob(pageIndex));
  }

  async getCoverBase64(): Promise<string> {
    if (this.rarBlobs) {
      const blob = this.rarBlobs[0];
      if (!blob) throw new Error('No pages found');
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    if (!this.zip || this.imagePaths.length === 0) {
      throw new Error('Zip not loaded or empty');
    }
    const path = this.imagePaths[0];
    const file = this.zip.file(path);
    if (!file) throw new Error('Cover file not found');
    const base64 = await file.async('base64');
    const ext = path.split('.').pop()?.toLowerCase();
    let mime = 'image/jpeg';
    if (ext === 'png') mime = 'image/png';
    else if (ext === 'webp') mime = 'image/webp';
    else if (ext === 'gif') mime = 'image/gif';
    else if (ext === 'bmp') mime = 'image/bmp';
    return `data:${mime};base64,${base64}`;
  }
}
