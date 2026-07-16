// MangaDex image proxy route. Streams cover/page images same-origin so the browser
// never hits MangaDex's CORS wall. Mounted at /api/img.
//
// SECURITY: only MangaDex image hosts are unconditionally allowed. Other hosts (the
// many CDNs consumet sources return) are allowed ONLY if the upstream response is a
// real image (content-type image/*) — this prevents the proxy being abused to fetch
// arbitrary HTML/JSON from third-party sites while still serving manga images.
// This router is mounted SEPARATELY from /api/mangadex so the allowlist cannot be bypassed.
import express from 'express';
import { proxyTarget, tryCache, setCache } from './proxy.js';

const router = express.Router();

const MD_IMG_HOSTS = /^https:\/\/(uploads\.mangadex\.org|[^/]+\.mangadex\.network)\//;

// GET /api/img?u=<encoded full image url>  -> streams the image
router.get('/', async (req, res) => {
  const u = req.query.u;
  if (typeof u !== 'string') return res.status(400).json({ error: 'missing u' });
  const isMd = MD_IMG_HOSTS.test(u);
  if (!u.startsWith('https://')) return res.status(403).json({ error: 'only https allowed' });
  if (!isMd && !/^https:\/\/[^/]+\.[^/]+/.test(u)) {
    return res.status(403).json({ error: 'image host not allowed' });
  }

  const hit = tryCache(u, false);
  if (hit) return hit(res);
  try {
    const ref = typeof req.query.ref === 'string' ? req.query.ref : null;
    const { body, contentType, status } = await proxyTarget(u, false, ref);
    // Reject non-image responses for non-MangaDex hosts (abuse guard).
    if (!isMd && !contentType.startsWith('image/')) {
      return res.status(403).json({ error: 'refusing non-image response from external host' });
    }
    // If we got an HTML error page instead of an image, fail cleanly.
    if (status >= 400 || (body.length > 0 && body[0] === 0x3c && contentType.includes('text/html'))) {
      res.set('Content-Type', contentType || 'application/octet-stream');
      return res.status(status >= 400 ? status : 502).send(body);
    }
    setCache(u, false, body, contentType, status);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=300');
    res.status(status).send(body);
  } catch (e) {
    console.error('[proxy] image failed:', u, e.message);
    res.status(502).json({ error: 'image fetch failed', detail: e.message });
  }
});

export { router as imgRouter };
