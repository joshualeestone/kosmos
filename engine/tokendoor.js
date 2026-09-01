'use strict';
/**
 * A door that takes a pasted token (#529): the Cloudflare shape, made into
 * one engine with a spec per service, the way devicedoor.js is one engine
 * behind the GitHub and Vercel doors. A new service is a row in
 * tokendoors.js, never a branch here.
 *
 * What every token door says and does, the same for all of them: KOSMOS
 * HOLDS THIS TOKEN. It is checked with the service's own API before it is
 * kept (never assumed from a file's existence), kept in ONE file, mode 600,
 * under the store at secrets/env/<ENV_VAR>, and handed into each agent's
 * pane at launch by the supervisor, which exports every file in that
 * directory by name. It is never written into a plist, never answered by a
 * route, never logged. "Connected" is read from the service every time; a
 * revoked token shows as not accepted, with a field to replace it.
 *
 * A spec:
 *   name       the pill's text, exactly ('Discord')
 *   slug       the route segment (/api/svc/<slug>)
 *   envVar     what agents read (DISCORD_BOT_TOKEN); also the file's name
 *   where      the page a person makes a token on, and whereText for the link
 *   hint       one clause on what to choose there (scopes), or ''
 *   verify     { method, url, headers(token), body? } the service's own
 *              "who am I" call; verifyUrlEnv lets a test point it elsewhere
 *   accept     (status, body) => { ok, who } | { ok: false, because }
 *   proven     true only after a real token was checked through this door
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const dir = () => path.join(store.ROOT, 'secrets', 'env');

function makeTokenDoor(spec) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(spec.envVar)) throw new Error('envVar must be an environment variable name: ' + spec.envVar);
  const FILE = path.join(dir(), spec.envVar);
  let fetcher = null; // test seam: (req, token) => Promise<{ok, status, body}>
  const setFetcher = (fn) => { fetcher = typeof fn === 'function' ? fn : null; };
  const url = () => (spec.verifyUrlEnv && process.env[spec.verifyUrlEnv]) || spec.verify.url;

  function readToken() {
    try { return fs.readFileSync(FILE, 'utf8').trim() || null; } catch { return null; }
  }

  async function ask(token) {
    const req = { method: spec.verify.method || 'GET', url: url(), headers: spec.verify.headers(token), body: spec.verify.body || null };
    const f = fetcher || (async (r, _tok) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      try {
        const init = { method: r.method, headers: { ...r.headers }, signal: ctl.signal };
        if (r.body) { init.body = JSON.stringify(r.body); init.headers['content-type'] = 'application/json'; }
        const res = await fetch(r.url, init);
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        return { ok: res.ok, status: res.status, body };
      } finally { clearTimeout(t); }
    });
    try { return await f(req, token); }
    catch (err) { return { ok: false, status: 0, body: null, because: 'we could not reach ' + spec.name + ': ' + String((err && err.message) || err) , unreachable: true }; }
  }

  /** Checks a token WITHOUT storing it. Answers who it is, never the token. */
  async function verify(token) {
    const t = String(token == null ? '' : token).trim();
    if (!t) return { ok: false, because: 'paste the token first' };
    if (/\s/.test(t)) return { ok: false, because: 'that does not look like a token: a token has no spaces or line breaks in it' };
    if (t.length < (spec.minLength || 16)) return { ok: false, because: 'that is too short to be a token' };
    const r = await ask(t);
    if (r.because) return { ok: false, because: r.because, unreachable: r.unreachable === true };
    let a;
    try { a = spec.accept(r.status, r.body); } catch { a = null; }
    if (a && a.ok) return { ok: true, who: a.who ? String(a.who) : null };
    if (r.status === 401 || r.status === 403) return { ok: false, because: spec.name + ' did not accept that token' + (a && a.because ? ': ' + a.because : '') };
    return { ok: false, because: (a && a.because) || (spec.name + ' answered ' + r.status + ' to that token') };
  }

  const shape = (extra) => ({
    kind: 'token', service: spec.name, envVar: spec.envVar, where: spec.where, whereText: spec.whereText || (spec.name + '’s API tokens page'),
    hint: spec.hint || '', proven: spec.proven === true, connected: false, held: false, who: null, because: null, ...extra,
  });

  /** Read, never asserted: no file means not connected; a file is checked with the service. */
  async function state() {
    const tok = readToken();
    if (!tok) return shape({});
    const v = await verify(tok);
    if (v.ok) return shape({ connected: true, held: true, who: v.who });
    return shape({ held: true, because: v.because, unreachable: v.unreachable === true });
  }

  /** Verify first, store only what the service accepted. Answers the state, never the token. */
  async function connect(token) {
    const v = await verify(token);
    if (!v.ok) return { ...(await state()), refused: v.because };
    fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(FILE, String(token).trim() + '\n', { mode: 0o600 });
    try { fs.chmodSync(FILE, 0o600); } catch { /* mode set at write */ }
    return state();
  }

  async function forget() {
    try { fs.unlinkSync(FILE); } catch { /* nothing held */ }
    return state();
  }

  return { spec, state, connect, forget, verify, setFetcher, FILE };
}

module.exports = { makeTokenDoor, get DIR() { return dir(); } };
