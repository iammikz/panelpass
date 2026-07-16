// Tiny mock of the MangaDex JSON API for LOCAL UI verification only.
// Returns the exact response shapes PanelPass's client expects, plus serves
// a real cover image and a real page image so the rendering pipeline is fully exercised.
// Run: node scripts/mock-mangadex.mjs   (listens on :8901)
import http from 'node:http';
import { readFileSync } from 'node:fs';

const MangaId = '00000000-0000-0000-0000-000000000001';
const ChapterId = '11111111-1111-1111-1111-111111111111';
const COVER_FILE = 'mockcover';
const HASH = 'mockhash';
const PAGES = ['1-aaaaa.jpg', '2-bbbbb.jpg', '3-ccccc.jpg'];

// A 1x1 png so <img> actually renders something.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

function json(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // Cover/image bytes
  if (p.endsWith('.jpg') || p.endsWith('.png')) {
    res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' });
    return res.end(PNG);
  }

  // /manga?title=...
  if (p === '/manga') {
    return json(res, {
      data: [
        {
          id: MangaId,
          type: 'manga',
          attributes: {
            title: { en: 'Berserk (Mock)' },
            description: { en: 'Mocked manga for local UI verification.' },
            year: 2026,
            contentRating: 'safe',
          },
          relationships: [
            { id: 'cover-1', type: 'cover_art', attributes: { fileName: COVER_FILE } },
          ],
        },
      ],
    });
  }

  // /manga/{id}/feed
  if (p === `/manga/${MangaId}/feed`) {
    return json(res, {
      data: [
        { id: ChapterId, type: 'chapter', attributes: { chapter: '1', title: 'The Brand', volume: '1', translatedLanguage: 'en', pages: 3, updatedAt: '2026-01-01T00:00:00Z' } },
        { id: '22222222-2222-2222-2222-222222222222', type: 'chapter', attributes: { chapter: '2', title: 'The Sword', volume: '1', translatedLanguage: 'en', pages: 3, updatedAt: '2026-01-02T00:00:00Z' } },
      ],
    });
  }

  // /at-home/server/{chapterId}
  if (p.startsWith('/at-home/server/')) {
    return json(res, {
      baseUrl: `http://localhost:${PORT}`,
      chapter: { hash: HASH, data: PAGES },
    });
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

const PORT = 8901;
server.listen(PORT, () => console.log(`mock-mangadex listening on :${PORT}`));
