'use strict';
/**
 * Cloudflare, connected (#529). The first Connections door that takes a
 * pasted token rather than a CLI's sign-in, because Cloudflare issues scoped
 * API tokens from its own dashboard and there is no CLI on a clean Mac.
 *
 * What is different from the CLI doors, said plainly: KOSMOS HOLDS THIS
 * TOKEN. There is no keyring to delegate to, and agents need it in their
 * environment to do anything (wrangler and curl read CLOUDFLARE_API_TOKEN).
 * So it lives in ONE file, mode 600, under the store, and the supervisor
 * hands it into each agent's pane at launch. It is never written into a
 * plist, never answered by a route, never logged. "Connected" is READ from
 * Cloudflare (GET /user/tokens/verify) every time, never assumed from the
 * file's existence: a revoked token shows here as revoked.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const securewrite = require('./securewrite');

const DIR = path.join(store.ROOT, 'secrets');
const FILE = path.join(DIR, 'cloudflare.token');
const VERIFY_URL = () => process.env.AGENT_WORKFORCE_CLOUDFLARE_VERIFY_URL || 'https://api.cloudflare.com/client/v4/user/tokens/verify';
const WHERE = 'https://dash.cloudflare.com/profile/api-tokens';

let fetcher = null; // test seam: (url, token) => Promise<{ok, status, body}>
function setFetcher(fn) { fetcher = typeof fn === 'function' ? fn : null; }

function readToken() {
  try { return fs.readFileSync(FILE, 'utf8').trim() || null; } catch { return null; }
}

async function ask(token) {
  const f = fetcher || (async (url, tok) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok }, signal: ctl.signal });
      let body = null;
      try { body = await r.json(); } catch { body = null; }
      return { ok: r.ok, status: r.status, body };
    } finally { clearTimeout(t); }
  });
  try { return await f(VERIFY_URL(), token); }
  catch (err) { return { ok: false, status: 0, body: null, because: 'we could not reach Cloudflare: ' + String((err && err.message) || err), unreachable: true }; }
}

/** Checks a token WITHOUT storing it. Answers who/what it is, never the token. */
async function verify(token) {
  const t = String(token == null ? '' : token).trim();
  if (!t) return { ok: false, because: 'paste the token first' };
  if (/\s/.test(t)) return { ok: false, because: 'that does not look like a token: a token has no spaces or line breaks in it' };
  if (t.length < 20) return { ok: false, because: 'that is too short to be a token' };
  const r = await ask(t);
  if (r.because) return { ok: false, because: r.because, unreachable: r.unreachable === true };
  const res = r.body && r.body.result;
  if (r.ok && r.body && r.body.success === true && res && res.status === 'active') {
    return { ok: true, tokenId: String(res.id || ''), status: 'active' };
  }
  const msg = r.body && Array.isArray(r.body.errors) && r.body.errors[0] && r.body.errors[0].message;
  if (res && res.status && res.status !== 'active') return { ok: false, because: 'Cloudflare says that token is ' + res.status };
  return { ok: false, because: 'Cloudflare did not accept that token' + (msg ? ': ' + msg : '') };
}

/** Read, never asserted: no file means not connected; a file is checked with Cloudflare. */
async function state() {
  const tok = readToken();
  if (!tok) return { kind: 'token', connected: false, held: false, tokenId: null, status: null, because: null, where: WHERE };
  const v = await verify(tok);
  if (v.ok) return { kind: 'token', connected: true, held: true, tokenId: v.tokenId, status: 'active', because: null, where: WHERE };
  return { kind: 'token', connected: false, held: true, tokenId: null, status: null, because: v.because, unreachable: v.unreachable === true, where: WHERE };
}

/** Verify first, store only what Cloudflare accepted. Answers the state, never the token. */
async function connect(token) {
  const v = await verify(token);
  if (!v.ok) return { ...(await state()), refused: v.because };
  /* #1787: was writeFileSync-then-chmod, and the mode is IGNORED on a file that
     already exists. Mechanism, measurements and why a mode assertion cannot catch
     it live in `engine/securewrite.js`, once.
     🛑 AND A THROW HERE MUST BE REPORTED AS A REFUSAL, NOT LEFT TO PROPAGATE. The
     route's `.catch(() => …)` in `server.js` DISCARDS the error and answers
     `we could not read that request`, so a write failure would be shown to the
     operator as an unreadable paste, on a token the service just verified.
     ⚠️ Pre-existing for ENOSPC and EACCES, WIDENED here: `refuseSymlinkTarget`
     raises ELOOP, a throw source the old in-place write never had. Same reasoning
     and same shape as the completing path in `githubdevice.js`. */
  try {
    securewrite.secureDir(DIR, 0o700);
    securewrite.writeSecret(FILE, String(token).trim() + '\n', 0o600);
  } catch (err) {
    return { ...(await state()), refused: 'we could not save the token: ' + String((err && err.message) || err) };
  }
  return state();
}

async function forget() {
  try { fs.unlinkSync(FILE); } catch { /* nothing held */ }
  return state();
}

module.exports = { state, connect, forget, verify, setFetcher, FILE, DIR, WHERE };
