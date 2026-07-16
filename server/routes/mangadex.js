// MangaDex API proxy route. Fetches server-side via `curl` and streams the JSON
// back to the browser same-origin. Mounted at /api/mangadex.
//
// Cloudflare note: from this host, MangaDex only responds 200 to curl when it uses its
// DEFAULT User-Agent over HTTP/1.1. A Chrome/spoofed UA + HTTP/2 is detected as a bot
// and served a "400: Unsupported Browser" challenge page. So we send NO custom UA and
// force HTTP/1.1 (curl's default) — that combination reliably returns data.
import express from 'express';
import { proxyTarget, tryCache, setCache } from './proxy.js';

const router = express.Router();
const MD_API = 'https://api.mangadex.org';

// GET /api/mangadex/<path>?<query>  -> https://api.mangadex.org/<path>?<query>
// (router is mounted at /api/mangadex, so the matched path here is everything after that)
router.get('/*', async (req, res) => {
  const path = req.params[0] || '';
  const target = `${MD_API}/${path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
  const hit = tryCache(target, true);
  if (hit) return hit(res);
  try {
    const { body, contentType, status } = await proxyTarget(target, true);
    if (status >= 400 && body[0] === 0x3c) {
      // Cloudflare challenge page instead of JSON -> don't cache, 502.
      res.set('Content-Type', 'application/json; charset=utf-8');
      return res.status(502).json({ error: 'mangadex blocked (cloudflare challenge)' });
    }
    setCache(target, true, body, contentType, status);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=300');
    res.status(status).send(body);
  } catch (e) {
    console.error('[proxy] mangadex failed:', target, e.message);
    res.status(502).json({ error: 'upstream fetch failed', detail: e.message });
  }
});

export { router as mangadexRouter };
