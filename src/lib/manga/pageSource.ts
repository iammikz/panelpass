// Source-agnostic page provider so Reader.tsx works for BOTH local CBZ comics
// and online manga chapters without forking the reader.
//
// A PageSource produces one page image at a time, addressed by 0-based index:
//   - ComicParser (CBZ/CBR) implements this for locally-stored archives.
//   - RemotePageSource wraps a pre-fetched list of image URLs (manga chapter pages
//     proxied via the backend's /md-img route).
//
// Both return object URLs (blob:) which the caller is responsible for revoking.
import { ComicParser } from '../parser';

export interface PageSource {
  /** Total number of pages in this chapter/comic. */
  getTotalPages(): number;
  /** Returns an object URL (blob:) for the given 0-based page index. */
  getPageBlobUrl(index: number): Promise<string>;
  /** Optional: cover image as a base64 data URL (used for CBZ; remote has its own cover). */
  getCoverBase64?(): Promise<string>;
}

export class RemotePageSource implements PageSource {
  private urls: string[];
  constructor(urls: string[]) {
    this.urls = urls;
  }
  getTotalPages(): number {
    return this.urls.length;
  }
  async getPageBlobUrl(index: number): Promise<string> {
    const url = this.urls[index];
    if (!url) throw new Error(`Page ${index + 1} is not available.`);
    return url;
  }
}

// For convenience when constructing from a CBZ archive blob.
export async function comicParserFromBlob(blob: Blob): Promise<ComicParser> {
  const parser = new ComicParser();
  await parser.load(blob);
  return parser;
}

// Serves pages from locally-stored Blobs (IndexedDB) so a downloaded chapter
// can be read fully offline. Mirrors RemotePageSource's PageSource contract.
export class OfflinePageSource implements PageSource {
  private urls: (string | null)[];
  private revoke: string[] = [];
  constructor(blobs: (Blob | null)[]) {
    // Create blob: URLs up-front; callers are responsible for revoke() on unmount.
    this.urls = blobs.map((b) => (b ? URL.createObjectURL(b) : null));
  }
  getTotalPages(): number {
    return this.urls.length;
  }
  async getPageBlobUrl(index: number): Promise<string> {
    const url = this.urls[index];
    if (!url) throw new Error(`Offline page ${index + 1} is not available.`);
    return url;
  }
  revokeAll(): void {
    this.revoke.push(...this.urls.filter((u): u is string => !!u));
    this.revoke.forEach((u) => URL.revokeObjectURL(u));
    this.revoke = [];
    this.urls = [];
  }
}
