// Source dispatch: GET /api/source/:provider/<search|manga/:id|manga/:id/chapters|chapter/:id/pages>
// Routes to the chosen provider, normalizing output to shared shapes. Scanned (consumet)
// sources fall back to MangaDex when Cloudflare-blocked or errored.
import express from 'express';
import { mangaDexProvider } from '../sources/mangadex.js';
import { consumetProviders } from '../sources/consumet.js';

const router = express.Router();

const providers = {
  mangadex: mangaDexProvider,
  ...consumetProviders,
};

function getProvider(id) {
  return providers[id] || null;
}

// Run a provider method; if it's a non-reliable (consumet) source and it fails with a
// Cloudflare block, transparently fall back to MangaDex.
async function withFallback(providerId, fn) {
  const provider = getProvider(providerId);
  if (!provider) {
    const e = new Error(`unknown provider: ${providerId}`);
    e.status = 404;
    throw e;
  }
  try {
    return await fn(provider);
  } catch (e) {
    if (!provider.reliable && (e.blocked || e.status === 502)) {
      console.warn(`[source] ${providerId} failed (${e.message}); falling back to mangadex`);
      return { ...(await fn(mangaDexProvider)), _fallback: true, _from: 'mangadex' };
    }
    throw e;
  }
}

router.get('/list', (_req, res) => {
  const list = Object.values(providers).map((p) => ({ id: p.id, label: p.label, reliable: !!p.reliable }));
  res.json({ providers: list });
});

router.get('/:provider/search', async (req, res) => {
  const q = req.query.q || req.query.title;
  if (!q) return res.status(400).json({ error: 'missing q' });
  try {
    const out = await withFallback(req.params.provider, (p) => p.search(String(q)));
    res.json(out);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

router.get('/:provider/manga/:id/chapters', async (req, res) => {
  try {
    const out = await withFallback(req.params.provider, (p) => p.chapters(req.params.id));
    res.json(out);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

router.get('/:provider/chapter/:id/pages', async (req, res) => {
  try {
    const out = await withFallback(req.params.provider, (p) => p.pages(req.params.id));
    res.json(out);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

export { router as sourceRouter };
