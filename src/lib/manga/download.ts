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
  for (let i = 0; i < total; i++) {
    const url = pageUrls[i];
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'unknown'})`);
      blobs[i] = await res.blob();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Keep null; report but continue so one bad image doesn't tank the chapter.
      cb.onError?.(i, msg);
    }
    done += 1;
    cb.onProgress?.(done, total);
  }

  await saveMangaPages(rec.provider, rec.mangaId, rec.chapterId, blobs);
  await setMangaDownloaded(rec.provider, rec.mangaId, rec.chapterId, true);
  return blobs;
}
