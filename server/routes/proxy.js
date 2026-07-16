// Shared curl-based upstream fetcher + tiny in-memory cache + retry/backoff.
// Used by both the MangaDex API route and the image route.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileP = promisify(execFile);

// Tiny in-memory cache so repeated cover/page requests don't re-hit MangaDex
// (helps a lot when the upstream IP is being rate-limited). 5 min TTL.
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
function cacheKey(url, json) { return (json ? 'J:' : 'I:') + url; }

function tryCache(url, json) {
  const hit = cache.get(cacheKey(url, json));
  if (hit && hit.expires > Date.now()) {
    return (res) => {
      res.set('Content-Type', hit.contentType);
      res.set('Cache-Control', 'public, max-age=300');
      res.status(hit.status).send(hit.body);
    };
  }
  return null;
}

function setCache(url, json, body, contentType, status) {
  if (status >= 400) return; // never cache errors
  cache.set(cacheKey(url, json), { body, contentType, status, expires: Date.now() + CACHE_TTL });
}

// Fetch `target` via curl, returning { body: Buffer, contentType, status }.
// Retries a few times with backoff (MangaDex intermittently 5xx / throttles this IP).
// No custom UA + HTTP/1.1 (curl default) is what passes Cloudflare from this host.
// `referer` (optional) is sent as a Referer header — some image CDNs require it (anti-hotlink).
async function proxyTarget(target, json, referer) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
    try {
      const { body, contentType, status } = await curlOnce(target, json, referer);
      if (status >= 500) { lastErr = 'upstream ' + status; continue; }
      return { body, contentType, status };
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error(lastErr || 'unknown');
}

function curlOnce(target, json, referer) {
  // Write the body to a temp file (robust for binary images) and emit
  // "<status> <content-type>" on stdout via -w. Avoids parsing binary buffers.
  const bodyFile = join(tmpdir(), `pp_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`);
  const args = ['-s', '-L', '--max-time', '30', '-o', bodyFile];
  args.push('-w', '%{http_code} %{content_type}');
  if (json) args.push('-H', 'Accept: application/json');
  else args.push('-H', 'Accept: image/jpeg,image/png,*/*');
  if (referer) args.push('-H', `Referer: ${referer}`);
  args.push(target);

  return execFileP('curl', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
    .then(({ stdout }) => {
      let body;
      try { body = readFileSync(bodyFile); } finally { try { unlinkSync(bodyFile); } catch { /* ignore */ } }
      const m = stdout.trim().match(/^(\d+)\s+(.*)$/);
      const status = m ? parseInt(m[1], 10) : 200;
      const contentType = m ? m[2].trim() : (json ? 'application/json; charset=utf-8' : 'application/octet-stream');
      return { body, contentType, status };
    })
    .catch((e) => {
      try { unlinkSync(bodyFile); } catch { /* ignore */ }
      throw e;
    });
}

export { proxyTarget, tryCache, setCache };
