// PanelPass backend — MangaDex proxy (and future home for auth / online history).
//
// WHY A BACKEND: MangaDex (behind Cloudflare) does not send Access-Control-Allow-Origin
// for raw-IP browser origins (e.g. http://207.180.246.16:8787), so a browser fetch is
// CORS-blocked. The browser instead calls THIS server same-origin (via nginx /md-api),
// and the server fetches MangaDex server-side. We shell out to `curl` because curl's
// TLS fingerprint passes Cloudflare from this host where nginx/Node-fetch get challenged.
//
// Routes (kept SEPARATE so the image allowlist can't be bypassed):
//   GET /api/mangadex/<path>?<query>   -> proxies to https://api.mangadex.org/<path>
//   GET /api/img?u=<encoded-url>        -> proxies an image; host must be a MangaDex image host
//   GET /api/health                     -> { ok: true }

import express from 'express';
import { mangadexRouter } from './routes/mangadex.js';
import { imgRouter } from './routes/img.js';
import { sourceRouter } from './routes/source.js';

const app = express();
const PORT = process.env.PORT || 8788;

// --- future: body parsing for auth/history would go here ---
// app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/mangadex', mangadexRouter); // MangaDex API proxy (legacy /md-api path)
app.use('/api/source', sourceRouter);     // unified provider dispatch (consumet + mangadex)
app.use('/api/img', imgRouter);           // image proxy (allowlist-enforced)

app.listen(PORT, () => {
  console.log(`[panelpass-api] listening on :${PORT}`);
});
