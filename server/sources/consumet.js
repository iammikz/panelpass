// consumet provider wrapper. consumet (consumet/extensions) already implements the
// scanned-source parsers (MangaKakalot, MangaPill, MangaHere, WeebCentral, ...) in TS.
// We instantiate them, route their image URLs through our same-origin /api/img proxy,
// normalize to the shared shapes, and detect Cloudflare blocks so the dispatcher can
// fall back to MangaDex.
//
// NOTE: some consumet sources (e.g. MangaKakalot) sit behind a hard Cloudflare/Turnstile
// challenge that plain curl/Node-fetch cannot pass from this host. Those report
// `blocked: true` and the dispatcher falls back to MangaDex automatically.
import { MANGA } from '@consumet/extensions';
import { normalizeSearch, normalizeChapter, normalizePage } from './normalize.js';

function imgUrl(u, referer) {
  if (!u) return null;
  const base = `/md-img/?u=${encodeURIComponent(u)}`;
  return referer ? `${base}&ref=${encodeURIComponent(referer)}` : base;
}

function isCloudflareError(e) {
  const m = e?.message || '';
  return /cloudflare/i.test(m) || /challenge/i.test(m) || /403/i.test(m);
}

// Factory: build a consumet-backed provider from a consumet class name.
// `referer` is the site origin some CDNs require on image requests (anti-hotlink).
export function makeConsumetProvider(id, label, consumetName, referer) {
  return {
    id,
    label,
    reliable: false, // scanned sources can be CF-blocked; MangaDex is the fallback
    referer: referer || null,
    _consumetName: consumetName,

    _instance() {
      return new MANGA[consumetName]();
    },

    async search(q) {
      try {
        const p = this._instance();
        const r = await p.search(q);
        return (r.results || []).map((x) =>
          normalizeSearch(x.id, x.title, imgUrl(x.image, this.referer), {
            description: x.description ?? null,
            providerId: id,
            providerMangaId: x.id,
          })
        );
      } catch (e) {
        if (isCloudflareError(e)) {
          const err = new Error(`provider ${id} blocked by Cloudflare`);
          err.blocked = true;
          throw err;
        }
        throw e;
      }
    },

    async chapters(mangaId) {
      const p = this._instance();
      const info = await p.fetchMangaInfo(mangaId);
      return (info.chapters || []).map((c) =>
        normalizeChapter(c.id, c.chapter, c.title, {
          volume: c.volume ?? null,
          language: 'en',
          updatedAt: c.releaseDate || '',
          providerId: id,
          providerChapterId: c.id,
        })
      );
    },

    async pages(chapterId) {
      const p = this._instance();
      const r = await p.fetchChapterPages(chapterId);
      // consumet returns pages either as an array or as an array-like object
      // ({0:{img,page}, 1:..., ...}). Normalize to a real array.
      const raw = Array.isArray(r) ? r : r?.pages ?? Object.values(r || {});
      const pages = Array.isArray(raw) ? raw : Object.values(raw);
      return pages.map((pg, index) => {
        const url = typeof pg === 'string' ? pg : pg?.img || pg?.url || pg?.image;
        const ref = pg?.headerForImage?.Referer || this.referer;
        return normalizePage(imgUrl(url, ref), index, {});
      });
    },
  };
}

// Configured consumet providers. Add more from MANGA.* as needed.
// Referers are the site origins their image CDNs require.
export const consumetProviders = {
  mangapill: makeConsumetProvider('mangapill', 'MangaPill', 'MangaPill', 'https://mangapill.com/'),
  mangahere: makeConsumetProvider('mangahere', 'MangaHere', 'MangaHere', 'https://mangahere.cc/'),
  weebcentral: makeConsumetProvider('weebcentral', 'WeebCentral', 'WeebCentral', 'https://weebcentral.com/'),
  mangakakalot: makeConsumetProvider('mangakakalot', 'MangaKakalot', 'MangaKakalot', 'https://www.mangakakalot.gg/'),
};
