// Downloads a manga chapter's pages to IndexedDB so it can be read offline.
//
// Page URLs arrive already same-origin-proxied (e.g. /md-img/?u=... -> the
// backend's /api/img route), so `fetch()` returns raw bytes with no CORS
// wall. Each page is fetched, stored as a Blob, and the IndexedDB record is
// flipped to `downloaded`. A single failed page is stored as `null` (graceful
// skip) rather than aborting the whole chapter.
import {
  saveMangaPages,
  setMangaDownloaded,
  type MangaRecord,
} from '../db';

export interface DownloadHandle {
  cancel: () => void;
}

export interface DownloadCallbacks {
  onProgress?: (done: number, total: number) => void;
  onError?: (page: number, message: string) => void;
}

/**
 * Fetch every page image as a Blob and persist to IndexedDB, then mark the
 * chapter downloaded. Returns the blobs in order (null = failed page).
 */
export async function downloadChapterPages(
  rec: MangaRecord,
  pageUrls: string[],
  cb: DownloadCallbacks = {},
): Promise<(Blob | null)[]> {
  const total = pageUrls.length;
  const blobs: (Blob | null)[] = new Array(total).fill(null);
  let done = 0;

  // Download sequentially to avoid hammering the backend / getting rate-limited.
  // Each page retries a few times with backoff — the proxy 502s on this IP under
  // heavy probing, so transient failures must not drop pages. A hard fetch timeout
  // (AbortController) prevents a single hung CDN connection from stalling the
  // whole chapter (and thus a batch download of many chapters).
  const FETCH_TIMEOUT_MS = 15000;
  for (let i = 0; i < total; i++) {
    const url = pageUrls[i];
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 3 && !blob; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = res.headers.get('content-type') || '';
        if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'unknown'})`);
        blob = await res.blob();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        cb.onError?.(i, `attempt ${attempt + 1}: ${msg}`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    blobs[i] = blob;
    done += 1;
    cb.onProgress?.(done, total);
  }

  await saveMangaPages(rec.provider, rec.mangaId, rec.chapterId, blobs);
  await setMangaDownloaded(rec.provider, rec.mangaId, rec.chapterId, true);
  return blobs;
}
