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

// Per-manga reader preferences (mode / sub-mode / zoom), keyed by provider:mangaId.
const mangaPrefsStorage = localforage.createInstance({
  name: 'PanelPass',
  storeName: 'mangaPrefs',
});

// Favorited (starred) manga titles, keyed by provider:mangaId.
const mangaFavStorage = localforage.createInstance({
  name: 'PanelPass',
  storeName: 'mangaFavorites',
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
  /** Cover image URL (from the source) — persisted on first open so the
   *  Continue Reading shelf can render real art without re-fetching. */
  coverUrl?: string | null;
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

/**
 * Return every stored MangaRecord (one per opened chapter), newest first.
 * Used to build the "Continue Reading" shelf and the opened-manga history.
 */
export async function listMangaRecords(): Promise<MangaRecord[]> {
  const list: MangaRecord[] = [];
  await mangaStorage.iterate<MangaRecord, void>((rec) => {
    if (rec) list.push(rec);
  });
  return list.sort((a, b) => b.lastViewedAt - a.lastViewedAt);
}

export interface MangaHistoryEntry {
  provider: string;
  mangaId: string;
  /** Most-recently opened chapter record for this title. */
  record: MangaRecord;
  /** Every chapter record for this title (newest first). */
  chapters: MangaRecord[];
  /** Display title — falls back to the chapter label if no title was stored. */
  title: string;
}

/**
 * Group all MangaRecords by `provider:mangaId` into one history entry per
 * opened title. The entry's `record` is the most-recently viewed chapter,
 * making it trivial to render a "Continue Reading" shelf.
 */
export async function getMangaHistory(): Promise<MangaHistoryEntry[]> {
  const records = await listMangaRecords();
  const byTitle = new Map<string, MangaRecord[]>();
  for (const rec of records) {
    const k = `${rec.provider}:${rec.mangaId}`;
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k)!.push(rec);
  }
  const entries: MangaHistoryEntry[] = [];
  for (const chapters of byTitle.values()) {
    const record = chapters[0]; // already newest-first from listMangaRecords
    const title = record.mangaTitle || record.chapterLabel || 'Unknown title';
    entries.push({ provider: record.provider, mangaId: record.mangaId, record, chapters, title });
  }
  return entries.sort((a, b) => b.record.lastViewedAt - a.record.lastViewedAt);
}

export async function openMangaChapter(rec: {
  provider: string;
  mangaId: string;
  chapterId: string;
  mangaTitle?: string;
  chapterLabel?: string;
  coverUrl?: string | null;
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
    coverUrl: rec.coverUrl ?? existing?.coverUrl,
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

/**
 * Full removal of a manga from the library:
 *  - deletes every downloaded page blob under this manga
 *  - deletes every MangaRecord for every chapter
 *  - removes the Continue Reading history entry
 *  - clears per-manga reader prefs
 *  - clears favorite/star if present
 */
export async function removeManga(provider: string, mangaId: string): Promise<void> {
  const prefix = `${provider}:${mangaId}:`;
  const keys: string[] = [];
  await mangaStorage.iterate<string, void>((value, key) => {
    if (typeof key === 'string' && key.startsWith(prefix)) keys.push(key);
  });
  await mangaPagesStorage.iterate<string, void>((_value, key) => {
    if (typeof key === 'string' && key.startsWith(prefix)) keys.push(key);
  });
  for (const key of keys) {
    try { await mangaStorage.removeItem(key); } catch {}
    try { await mangaPagesStorage.removeItem(key); } catch {}
  }
  await mangaPrefsStorage.removeItem(`${provider}:${mangaId}`);
  await mangaFavStorage.removeItem(`${provider}:${mangaId}`);
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

/* ------------------------------------------------------------------ *
 * Bookmarks & notes (IndexedDB)
 *
 * Per-page bookmarks + private notes for both comics and manga chapters.
 * Each bookmark is keyed by a `scope` string that uniquely identifies the
 * reading context:
 *   - comic:  `comic:<comicId>`
 *   - manga:  `manga:<provider>:<mangaId>:<chapterId>`
 * Bookmarks are stored in their own localforage store so they never bloat
 * the comic metadata array.
 * ------------------------------------------------------------------ */

export type BookmarkScope =
  | { kind: 'comic'; comicId: string }
  | { kind: 'manga'; provider: string; mangaId: string; chapterId: string };

export interface Bookmark {
  id: string;
  /** Stable scope key — see BookmarkScope. Computed via bookmarkScopeKey(). */
  scope: string;
  /** 0-based page index the bookmark points at. */
  page: number;
  /** Optional free-text note. */
  note: string;
  createdAt: number;
  updatedAt: number;
}

export function bookmarkScopeKey(scope: BookmarkScope): string {
  if (scope.kind === 'comic') return `comic:${scope.comicId}`;
  return `manga:${scope.provider}:${scope.mangaId}:${scope.chapterId}`;
}

const bookmarksStorage = localforage.createInstance({
  name: 'PanelPass',
  storeName: 'bookmarks',
});

async function readScopeBookmarks(scope: string): Promise<Bookmark[]> {
  const all = await bookmarksStorage.getItem<Bookmark[]>(scope);
  return all ?? [];
}

export async function getBookmarks(scope: BookmarkScope): Promise<Bookmark[]> {
  const list = await readScopeBookmarks(bookmarkScopeKey(scope));
  return [...list].sort((a, b) => a.page - b.page);
}

export async function getBookmarkCount(scope: BookmarkScope): Promise<number> {
  return (await readScopeBookmarks(bookmarkScopeKey(scope))).length;
}

/** Toggle a bookmark at `page`. If one already exists on that page it is removed. */
export async function toggleBookmark(
  scope: BookmarkScope,
  page: number,
  note = '',
): Promise<Bookmark[]> {
  const key = bookmarkScopeKey(scope);
  const list = await readScopeBookmarks(key);
  const existingIdx = list.findIndex((b) => b.page === page);
  if (existingIdx >= 0) {
    list.splice(existingIdx, 1);
  } else {
    const now = Date.now();
    list.push({
      id: `bm_${now}_${Math.random().toString(36).slice(2, 8)}`,
      scope: key,
      page,
      note,
      createdAt: now,
      updatedAt: now,
    });
  }
  await bookmarksStorage.setItem(key, list);
  return [...list].sort((a, b) => a.page - b.page);
}

export async function updateBookmarkNote(
  scope: BookmarkScope,
  id: string,
  note: string,
): Promise<Bookmark[]> {
  const key = bookmarkScopeKey(scope);
  const list = await readScopeBookmarks(key);
  const bm = list.find((b) => b.id === id);
  if (bm) {
    bm.note = note;
    bm.updatedAt = Date.now();
    await bookmarksStorage.setItem(key, list);
  }
  return [...list].sort((a, b) => a.page - b.page);
}

export async function removeBookmark(
  scope: BookmarkScope,
  id: string,
): Promise<Bookmark[]> {
  const key = bookmarkScopeKey(scope);
  const list = await readScopeBookmarks(key);
  const next = list.filter((b) => b.id !== id);
  await bookmarksStorage.setItem(key, next);
  return [...next].sort((a, b) => a.page - b.page);
}

/* ------------------------------------------------------------------ *
 * Per-manga reader preferences
 *
 * Reader display settings (page mode, sub-mode, zoom) remembered per
 * title (provider:mangaId) so each manga opens the way you left it.
 * Falls back to the global defaults when nothing is stored.
 * ------------------------------------------------------------------ */

export type ReaderMode = 'single' | 'webtoon';
export type PageSubMode = 'single' | 'dual';
export type WebtoonSubMode = 'single' | 'all-v' | 'all-h';

export interface MangaReaderPrefs {
  readerMode?: ReaderMode;
  pageSubMode?: PageSubMode;
  webtoonSubMode?: WebtoonSubMode;
  /** Zoom factor as a percentage (100, 125, 150, 200...). */
  zoom?: number;
}

function mangaPrefsKey(provider: string, mangaId: string): string {
  return `${provider}:${mangaId}`;
}

export async function getMangaPrefs(
  provider: string,
  mangaId: string,
): Promise<MangaReaderPrefs> {
  return (
    (await mangaPrefsStorage.getItem<MangaReaderPrefs>(
      mangaPrefsKey(provider, mangaId),
    )) ?? {}
  );
}

export async function saveMangaPrefs(
  provider: string,
  mangaId: string,
  prefs: MangaReaderPrefs,
): Promise<void> {
  await mangaPrefsStorage.setItem(mangaPrefsKey(provider, mangaId), prefs);
}

/* ------------------------------------------------------------------ *
 * Manga favorites (starred titles)
 * ------------------------------------------------------------------ */

export async function isMangaFavorite(
  provider: string,
  mangaId: string,
): Promise<boolean> {
  return (await mangaFavStorage.getItem(mangaPrefsKey(provider, mangaId))) === true;
}

export async function setMangaFavorite(
  provider: string,
  mangaId: string,
  favorite: boolean,
): Promise<void> {
  if (favorite) {
    await mangaFavStorage.setItem(mangaPrefsKey(provider, mangaId), true);
  } else {
    await mangaFavStorage.removeItem(mangaPrefsKey(provider, mangaId));
  }
}
