// PanelPass — MangaDex source client (Option A: CORS-friendly JSON API, flagship source).
//
// MangaDex (behind Cloudflare) does NOT send Access-Control-Allow-Origin for raw-IP
// browser origins (e.g. http://207.180.246.16:8787), so a direct browser fetch is
// CORS-blocked. Solution: the app calls its OWN backend same-origin (/md-api, proxied
// by nginx to the panelpass-api service), which fetches MangaDex server-side. No 3rd-party
// proxies, no malware risk. The backend uses curl (passes Cloudflare from this host).
//
// Override via env at build time:
//   VITE_MANGADEX_USE_PROXY=0   -> direct fetch to api.mangadex.org (only if your origin is CORS-allowed, e.g. localhost/domain)
//   (default)                   -> same-origin /md-api + /md-img (backend proxy)

// Default to the same-origin backend proxy (works from any origin, including raw IP).
const USE_NGINX_PROXY = (import.meta.env.VITE_MANGADEX_USE_PROXY || '1') === '1';
const DIRECT_BASE = (import.meta.env.VITE_MANGADEX_API_BASE || 'https://api.mangadex.org').replace(/\/+$/, '');

// 'nginx' (default) -> /md-api backend proxy; 'direct' -> MangaDex directly.
const MODE: 'nginx' | 'direct' = USE_NGINX_PROXY ? 'nginx' : 'direct';
const API_BASE = MODE === 'nginx' ? '/md-api' : DIRECT_BASE;
const COVER_BASE = MODE === 'nginx' ? '/md-img' : (import.meta.env.VITE_MANGADEX_COVER_BASE || 'https://uploads.mangadex.org').replace(/\/+$/, '');
const AT_HOME_BASE = `${API_BASE}/at-home/server`;

/** Route an absolute MangaDex image URL through the same-origin backend image proxy. */
function imgProxy(url: string): string {
  if (MODE === 'nginx') return `/md-img/?u=${encodeURIComponent(url)}`;
  return url;
}

export type ContentRating = 'safe' | 'suggestive' | 'erotica' | 'pornographic';

export interface MangaSearchResult {
  id: string;
  title: string;
  coverUrl: string | null;
  description: string | null;
  year: number | null;
  contentRating: ContentRating | null;
}

export interface MangaChapter {
  id: string;
  chapter: string | null;
  title: string | null;
  volume: string | null;
  language: string;
  pages: number | null;
  updatedAt: string;
}

export interface ChapterPage {
  /** Absolute URL of the image on the MangaDex @home CDN. */
  url: string;
  /** Page index (0-based). */
  index: number;
  /** The @home baseUrl this page belongs to (needed if you re-fetch). */
  baseUrl: string;
  /** The chapter data hash + file name, for offline caching. */
  hash: string;
  fileName: string;
}

// Build the absolute request URL. In 'nginx' mode API_BASE is a same-origin relative
// path (/md-api), so we resolve it against the page origin. In 'direct' mode it's
// the absolute MangaDex URL.
function buildUrl(path: string): string {
  const target = API_BASE + path;
  if (API_BASE.startsWith('http')) return target;
  return new URL(target, window.location.origin).toString();
}

async function apiGet<T>(path: string, params?: Record<string, string | string[]>): Promise<T> {
  const url = new URL(buildUrl(path));
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
      else url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let detail = '';
    try {
      const errBody = await res.json();
      detail = errBody?.errors?.[0]?.detail || errBody?.title || '';
    } catch { /* non-JSON */ }
    throw new Error(`MangaDex API error ${res.status}${detail ? `: ${detail}` : ''} for ${path}`);
  }
  return (await res.json()) as T;
}

function pickTitle(attrs: any): string {
  const titles = attrs?.title;
  if (!titles) return 'Untitled';
  return titles.en || Object.values(titles)[0] || 'Untitled';
}

function coverArtUrl(relationships: any[]): string | null {
  const cover = relationships?.find((r) => r.type === 'cover_art');
  const fileName = cover?.attributes?.fileName;
  const mangaId = cover?.related?.id ?? cover?.relationships?.[0]?.id;
  if (!fileName) return null;
  // We don't always have the manga id here; caller passes it via buildCoverUrl.
  return fileName;
}

export function buildCoverUrl(mangaId: string, fileName: string, size: '256' | '512' = '256'): string {
  const direct = `${COVER_BASE}/covers/${mangaId}/${fileName}.${size}.jpg`;
  return MODE !== 'direct' ? imgProxy(direct) : direct;
}

export interface SearchOptions {
  title: string;
  limit?: number;
  contentRatings?: ContentRating[];
  includedTags?: string[];
}

export async function searchManga(opts: SearchOptions): Promise<MangaSearchResult[]> {
  const ratings = opts.contentRatings ?? ['safe', 'suggestive'];
  const data = await apiGet<any>('/manga', {
    title: opts.title,
    limit: String(opts.limit ?? 20),
    'contentRating[]': ratings,
    'includes[]': ['cover_art'],
    'order[relevance]': 'desc',
  });

  return (data.data as any[]).map((m) => {
    const attrs = m.attributes;
    const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
    const fileName = coverRel?.attributes?.fileName;
    return {
      id: m.id,
      title: pickTitle(attrs),
      coverUrl: fileName ? buildCoverUrl(m.id, fileName) : null,
      description: attrs?.description?.en ?? null,
      year: attrs?.year ?? null,
      contentRating: (attrs?.contentRating as ContentRating) ?? null,
    };
  });
}

export async function getChapters(
  mangaId: string,
  opts: { language?: string; limit?: number; offset?: number } = {},
): Promise<MangaChapter[]> {
  const data = await apiGet<any>(`/manga/${mangaId}/feed`, {
    limit: String(opts.limit ?? 100),
    offset: String(opts.offset ?? 0),
    'translatedLanguage[]': [opts.language ?? 'en'],
    'order[chapter]': 'asc',
    includeFutureUpdates: '0',
  });

  return (data.data as any[]).map((c) => {
    const a = c.attributes;
    return {
      id: c.id,
      chapter: a.chapter ?? null,
      title: a.title ?? null,
      volume: a.volume ?? null,
      language: a.translatedLanguage,
      pages: a.pages ?? null,
      updatedAt: a.updatedAt,
    };
  });
}

// Cache the @home baseUrl per chapter so we don't call the API on every page turn.
const atHomeCache = new Map<string, { baseUrl: string; hash: string; data: string[]; expires: number }>();

export async function getChapterPages(chapterId: string): Promise<ChapterPage[]> {
  const cached = atHomeCache.get(chapterId);
  if (cached && cached.expires > Date.now()) {
    return buildPages(chapterId, cached.baseUrl, cached.hash, cached.data);
  }

  const data = await apiGet<any>(`${AT_HOME_BASE}/${chapterId}`);
  const baseUrl: string = data.baseUrl;
  const hash: string = data.chapter.hash;
  const files: string[] = data.chapter.data; // ['1-xxx.jpg', '2-yyy.jpg', ...]

  // MangaDex @home baseUrls rotate; cache for 10 minutes.
  atHomeCache.set(chapterId, { baseUrl, hash, data: files, expires: Date.now() + 10 * 60 * 1000 });

  return buildPages(chapterId, baseUrl, hash, files);
}

function buildPages(chapterId: string, baseUrl: string, hash: string, files: string[]): ChapterPage[] {
  return files.map((fileName, index) => {
    const direct = `${baseUrl}/data/${hash}/${fileName}`;
    return {
      url: imgProxy(direct),
      index,
      baseUrl,
      hash,
      fileName,
    };
  });
}

// Fetch a single page image as a Blob (used for offline caching).
export async function fetchPageBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download page image (${res.status})`);
  return await res.blob();
}
