// Our own MangaDex provider — the reliable fallback. Reuses the proven curl-based
// proxyTarget (which passes Cloudflare from this host). Normalizes MangaDex's JSON
// API into the shared shapes so the frontend can't tell it apart from consumet sources.
import { proxyTarget } from '../routes/proxy.js';
import { normalizeSearch, normalizeChapter, normalizePage } from './normalize.js';

const MD_API = 'https://api.mangadex.org';

function imgUrl(u) {
  // Route every MangaDex image (covers + @home pages) through our same-origin proxy.
  return `/md-img/?u=${encodeURIComponent(u)}`;
}

function pickTitle(titles) {
  if (!titles) return 'Untitled';
  return titles.en || Object.values(titles)[0] || 'Untitled';
}

export const mangaDexProvider = {
  id: 'mangadex',
  label: 'MangaDex',
  // MangaDex is the reliable one; never auto-fallback away from it.
  reliable: true,

  async search(q) {
    const target = `${MD_API}/manga?title=${encodeURIComponent(q)}&limit=20&contentRating[]=safe&contentRating[]=suggestive&includes[]=cover_art&order[relevance]=desc`;
    const { body } = await proxyTarget(target, true);
    const json = JSON.parse(body.toString('utf8'));
    return json.data.map((m) => {
      const cover = (m.relationships || []).find((r) => r.type === 'cover_art');
      const fileName = cover?.attributes?.fileName;
      const coverUrl = fileName ? imgUrl(`https://uploads.mangadex.org/covers/${m.id}/${fileName}.256.jpg`) : null;
      return normalizeSearch(m.id, pickTitle(m.attributes.title), coverUrl, {
        description: m.attributes.description?.en || null,
        year: m.attributes.year ?? null,
        contentRating: m.attributes.contentRating ?? null,
        providerId: 'mangadex',
        providerMangaId: m.id,
      });
    });
  },

  async chapters(mangaId) {
    // paginate all chapters (MangaDex caps at 100/req)
    let offset = 0, all = [];
    for (;;) {
      const target = `${MD_API}/manga/${mangaId}/feed?limit=100&offset=${offset}&translatedLanguage[]=en&order[chapter]=asc&includeFutureUpdates=0`;
      const { body } = await proxyTarget(target, true);
      const json = JSON.parse(body.toString('utf8'));
      all = all.concat(json.data || []);
      if (!json.data || json.data.length < 100) break;
      offset += 100;
    }
    return all.map((c) => normalizeChapter(c.id, c.attributes.chapter, c.attributes.title, {
      volume: c.attributes.volume ?? null,
      language: c.attributes.translatedLanguage || 'en',
      pages: c.attributes.pages ?? null,
      updatedAt: c.attributes.updatedAt || '',
      providerId: 'mangadex',
      providerChapterId: c.id,
    }));
  },

  async pages(chapterId) {
    const { body } = await proxyTarget(`${MD_API}/at-home/server/${chapterId}`, true);
    const json = JSON.parse(body.toString('utf8'));
    const { baseUrl, hash, data } = json.chapter;
    return data.map((fileName, index) =>
      normalizePage(imgUrl(`${baseUrl}/data/${hash}/${fileName}`), index, { baseUrl, hash, fileName })
    );
  },
};
