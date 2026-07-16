// Unified manga source client. Talks to the PanelPass backend's /api/source dispatch,
// which fans out to consumet-backed scanned sources (MangaPill, MangaHere, WeebCentral,
// MangaKakalot, ...) and our own MangaDex (the reliable fallback). The backend
// normalizes every provider into these shapes, so the UI stays source-agnostic.
//
// Override base at build time: VITE_API_BASE (defaults to same-origin /api).

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '');

export type ContentRating = 'safe' | 'suggestive' | 'erotica' | 'pornographic';

export interface MangaSearchResult {
  id: string;
  title: string;
  coverUrl: string | null;
  description: string | null;
  year: number | null;
  contentRating: ContentRating | null;
  providerId: string | null;
  providerMangaId: string;
}

export interface MangaChapter {
  id: string;
  chapter: string | null;
  title: string | null;
  volume: string | null;
  language: string;
  pages: number | null;
  updatedAt: string;
  providerId: string | null;
  providerChapterId: string;
}

export interface ChapterPage {
  url: string;
  index: number;
  baseUrl: string;
  hash: string;
  fileName: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  reliable: boolean;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let detail = '';
    try {
      const b = await res.json();
      detail = b?.error || '';
    } catch { /* non-JSON */ }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function listProviders(): Promise<ProviderInfo[]> {
  return apiGet<{ providers: ProviderInfo[] }>('/source/list').then((r) => r.providers);
}

export async function searchManga(provider: string, title: string): Promise<MangaSearchResult[]> {
  return apiGet<MangaSearchResult[]>(`/source/${provider}/search?q=${encodeURIComponent(title)}`);
}

export async function getChapters(provider: string, mangaId: string): Promise<MangaChapter[]> {
  return apiGet<MangaChapter[]>(`/source/${provider}/manga/${encodeURIComponent(mangaId)}/chapters`);
}

export async function getChapterPages(provider: string, chapterId: string): Promise<ChapterPage[]> {
  return apiGet<ChapterPage[]>(`/source/${provider}/chapter/${encodeURIComponent(chapterId)}/pages`);
}
