import localforage from 'localforage';
import { Comic, ComicSource } from '../types';

const metadataStorage = localforage.createInstance({
  name: 'PanelPass',
  storeName: 'metadata',
});

const fileStorage = localforage.createInstance({
  name: 'PanelPass',
  storeName: 'files',
});

const mangaStorage = localforage.createInstance({
  name: 'PanelPass',
  storeName: 'manga',
});

export async function getComics(): Promise<Comic[]> {
  const comics = await metadataStorage.getItem<Comic[]>('comics');
  if (!comics) {
    return [];
  }

  let hasLegacyComics = false;
  const normalizedComics = comics.map((comic) => {
    const normalizedComic = {
      ...comic,
      lastViewedAt: comic.lastViewedAt ?? comic.addedAt,
      source: comic.source ?? ({ type: 'local' } satisfies ComicSource),
    };

    if (!comic.source || comic.lastViewedAt === undefined) {
      hasLegacyComics = true;
    }

    return normalizedComic;
  });

  if (hasLegacyComics) {
    await metadataStorage.setItem('comics', normalizedComics);
  }

  return normalizedComics;
}

export async function saveComicFile(id: string, file: Blob) {
  await fileStorage.setItem(`comic_file_${id}`, file);
}

export async function saveComicMetadata(comic: Comic) {
  const comics = await getComics();
  comics.push({
    ...comic,
    lastViewedAt: comic.lastViewedAt ?? comic.addedAt,
  });
  await metadataStorage.setItem('comics', comics);
}

export async function getComicFile(id: string): Promise<Blob | null> {
  return fileStorage.getItem<Blob>(`comic_file_${id}`);
}

export async function updateComicProgress(id: string, currentPage: number) {
  const comics = await getComics();
  const index = comics.findIndex((c) => c.id === id);
  if (index !== -1) {
    comics[index].currentPage = currentPage;
    comics[index].lastViewedAt = Date.now();
    if (currentPage >= comics[index].totalPages - 1) {
      comics[index].isCompleted = true;
    } else {
      comics[index].isCompleted = false;
    }
    await metadataStorage.setItem('comics', comics);
  }
}

export async function updateComicLastViewed(id: string) {
  const comics = await getComics();
  const index = comics.findIndex((c) => c.id === id);
  if (index !== -1) {
    comics[index].lastViewedAt = Date.now();
    await metadataStorage.setItem('comics', comics);
  }
}

export async function upsertComicsMetadata(nextComics: Comic[]) {
  const comics = await getComics();
  const byId = new Map(comics.map((comic) => [comic.id, comic]));

  nextComics.forEach((comic) => {
    const existing = byId.get(comic.id);
    byId.set(comic.id, {
      ...existing,
      ...comic,
      currentPage: existing?.currentPage ?? comic.currentPage,
      lastViewedAt: existing?.lastViewedAt ?? comic.lastViewedAt ?? comic.addedAt,
      isCompleted: existing?.isCompleted ?? comic.isCompleted,
    });
  });

  await metadataStorage.setItem('comics', [...byId.values()]);
}

export async function deleteComic(id: string) {
  const comics = await getComics();
  const updated = comics.filter((c) => c.id !== id);
  await metadataStorage.setItem('comics', updated);
  await fileStorage.removeItem(`comic_file_${id}`);
}

/* ------------------------------------------------------------------ *
 * Manga reading records (IndexedDB)
 *
 * Mirrors the CBZ `Comic` progress model but keyed by the stable
 * `provider:mangaId:chapterId` triple so it survives across sessions.
 * Stored in the dedicated `manga` localforage store (not localStorage)
 * to keep structured reading data alongside the rest of the app.
 * ------------------------------------------------------------------ */

export interface MangaRecord {
  key: string; // `${provider}:${mangaId}:${chapterId}`
  provider: string;
  mangaId: string;
  chapterId: string;
  mangaTitle?: string;
  chapterLabel?: string;
  currentPage: number;
  totalPages: number;
  isCompleted: boolean;
  downloaded: boolean;
  lastViewedAt: number;
  addedAt: number;
}

function mangaKey(provider: string, mangaId: string, chapterId: string): string {
  return `${provider}:${mangaId}:${chapterId}`;
}

export async function getMangaRecord(
  provider: string,
  mangaId: string,
  chapterId: string,
): Promise<MangaRecord | null> {
  return mangaStorage.getItem<MangaRecord>(
    mangaKey(provider, mangaId, chapterId),
  );
}

export async function openMangaChapter(rec: {
  provider: string;
  mangaId: string;
  chapterId: string;
  mangaTitle?: string;
  chapterLabel?: string;
  totalPages: number;
}): Promise<MangaRecord> {
  const key = mangaKey(rec.provider, rec.mangaId, rec.chapterId);
  const existing = await mangaStorage.getItem<MangaRecord>(key);
  const now = Date.now();
  const next: MangaRecord = {
    key,
    provider: rec.provider,
    mangaId: rec.mangaId,
    chapterId: rec.chapterId,
    mangaTitle: rec.mangaTitle ?? existing?.mangaTitle,
    chapterLabel: rec.chapterLabel ?? existing?.chapterLabel,
    currentPage: existing?.currentPage ?? 0,
    totalPages: rec.totalPages,
    isCompleted: existing?.isCompleted ?? false,
    downloaded: existing?.downloaded ?? false,
    lastViewedAt: now,
    addedAt: existing?.addedAt ?? now,
  };
  await mangaStorage.setItem(key, next);
  return next;
}

export async function updateMangaProgress(
  provider: string,
  mangaId: string,
  chapterId: string,
  currentPage: number,
): Promise<void> {
  const key = mangaKey(provider, mangaId, chapterId);
  const existing = await mangaStorage.getItem<MangaRecord>(key);
  if (!existing) return;
  existing.currentPage = currentPage;
  existing.lastViewedAt = Date.now();
  if (currentPage >= existing.totalPages - 1) {
    existing.isCompleted = true;
  }
  await mangaStorage.setItem(key, existing);
}

export async function setMangaDownloaded(
  provider: string,
  mangaId: string,
  chapterId: string,
  downloaded: boolean,
): Promise<void> {
  const key = mangaKey(provider, mangaId, chapterId);
  const existing = await mangaStorage.getItem<MangaRecord>(key);
  if (!existing) return;
  existing.downloaded = downloaded;
  await mangaStorage.setItem(key, existing);
}

/* ------------------------------------------------------------------ *
 * Offline page blobs (IndexedDB)
 *
 * When a chapter is downloaded, its decoded page images are stored here
 * keyed by `${provider}:${mangaId}:${chapterId}` so the reader can serve
 * them from disk (blob: URLs) without any network hit. Stored separately
 * from the MangaRecord metadata to keep large binary blobs out of the
 * small metadata object.
 * ------------------------------------------------------------------ */

const mangaPagesStorage = localforage.createInstance({
  name: 'PanelPass',
  storeName: 'mangaPages',
});

export interface MangaPagesBlob {
  key: string; // `${provider}:${mangaId}:${chapterId}`
  provider: string;
  mangaId: string;
  chapterId: string;
  /** Page images in 0-based order; null = failed to fetch (skip gracefully). */
  blobs: (Blob | null)[];
  pageCount: number;
  savedAt: number;
}

export async function saveMangaPages(
  provider: string,
  mangaId: string,
  chapterId: string,
  blobs: (Blob | null)[],
): Promise<void> {
  const key = mangaKey(provider, mangaId, chapterId);
  const payload: MangaPagesBlob = {
    key,
    provider,
    mangaId,
    chapterId,
    blobs,
    pageCount: blobs.length,
    savedAt: Date.now(),
  };
  await mangaPagesStorage.setItem(key, payload);
}

export async function getMangaPages(
  provider: string,
  mangaId: string,
  chapterId: string,
): Promise<MangaPagesBlob | null> {
  const key = mangaKey(provider, mangaId, chapterId);
  return mangaPagesStorage.getItem<MangaPagesBlob>(key);
}

export async function removeMangaPages(
  provider: string,
  mangaId: string,
  chapterId: string,
): Promise<void> {
  const key = mangaKey(provider, mangaId, chapterId);
  await mangaPagesStorage.removeItem(key);
}

/** Delete the stored blobs AND clear the `downloaded` flag on the record. */
export async function removeMangaDownload(
  provider: string,
  mangaId: string,
  chapterId: string,
): Promise<void> {
  await removeMangaPages(provider, mangaId, chapterId);
  const existing = await mangaStorage.getItem<MangaRecord>(mangaKey(provider, mangaId, chapterId));
  if (existing) {
    existing.downloaded = false;
    await mangaStorage.setItem(mangaKey(provider, mangaId, chapterId), existing);
  }
}

export async function getMangaDownloadProgress(
  provider: string,
  mangaId: string,
  chapterId: string,
): Promise<number> {
  const pages = await getMangaPages(provider, mangaId, chapterId);
  if (!pages || pages.pageCount === 0) return 0;
  const fetched = pages.blobs.filter((b) => b !== null).length;
  return fetched / pages.pageCount;
}

/** Sum of every stored offline chapter's page count (for the storage meter). */
export async function getOfflinePagesTotal(): Promise<number> {
  const keys = await mangaPagesStorage.keys();
  let total = 0;
  for (const key of keys) {
    const p = await mangaPagesStorage.getItem<MangaPagesBlob>(key);
    if (p) total += p.pageCount;
  }
  return total;
}
