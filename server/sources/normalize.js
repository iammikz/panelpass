// Normalized manga shapes returned by EVERY provider (mangaDex + consumet sources).
// The frontend consumes exactly these, so a provider is just something that yields
// these shapes. Keeps the UI source-agnostic.

export function normalizeSearch(id, title, image, extra = {}) {
  return {
    id: String(id),
    title: title || 'Untitled',
    coverUrl: image || null,
    description: extra.description ?? null,
    year: extra.year ?? null,
    contentRating: extra.contentRating ?? null,
    providerId: extra.providerId ?? null, // which provider this came from (for later drill-down)
    providerMangaId: extra.providerMangaId ?? String(id), // id understood by that provider
  };
}

export function normalizeChapter(id, chapter, title, extra = {}) {
  return {
    id: String(id),
    chapter: chapter ?? null,
    title: title ?? null,
    volume: extra.volume ?? null,
    language: extra.language ?? 'en',
    pages: extra.pages ?? null,
    updatedAt: extra.updatedAt ?? '',
    providerId: extra.providerId ?? null,
    providerChapterId: extra.providerChapterId ?? String(id),
  };
}

export function normalizePage(url, index, extra = {}) {
  return {
    url, // already routed through our /api/img proxy by the provider
    index,
    baseUrl: extra.baseUrl ?? '',
    hash: extra.hash ?? '',
    fileName: extra.fileName ?? '',
  };
}
