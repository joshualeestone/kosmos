'use strict';
/**
 * kosmos#4648 (weekend goal #4647): the computers on this board's Kosmos+ account,
 * for the top-left menu's "Your computers" section.
 *
 * 🔑 SIGNED THROUGH THE TUNNEL, like engine/mac-standing.js. The board holds no
 * key: remote.macRequest() runs the tunnel's `mac-request` verb, which signs
 * POST /v1/mac/account-computers with this computer's key. The coordinator takes
 * the account from that signature, so this can only ever list this account's
 * computers. (/v1/account/macs is not usable here: it takes a DEVICE session, a
 * phone or browser signed in, which a board does not have and should not.)
 *
 * 🔑 ONLINE IS MEASURED, NOT INFERRED. Each other computer's own address is asked
 * for its front page. ANY HTTP answer means its tunnel is up: the relay forwarded
 * the request to it (measured 2026-09-29: a live computer answers 200 with its
 * sign-in gate in 0.6 s). A TLS or connection failure means it is not connected
 * (measured: an unknown name fails the TLS handshake in 0.2 s), and so does no
 * answer within PROBE_TIMEOUT_MS. `last_seen` is not used for this: the
 * coordinator refreshes it only daily and on reconnect.
 *
 * Best-effort by contract: fetchComputers() never throws. It resolves to
 * { ok: true, computers: [...] } or { ok: false, because } (not signed in, an old
 * connector or coordinator, the tunnel failed). The page hides the section on
 * any { ok: false }.
 */

const ROUTE = '/v1/mac/account-computers';
const PROBE_TIMEOUT_MS = 4000;

/* The domain the account's computers live under: one label under the Kosmos+ sign-in
   host's parent (login.kosmosplus.com gives kosmosplus.com), derived exactly as the native
   app's isKosmosPlusURL does (native-app/main.swift), so moving the sign-in moves both. Null
   when the coordinator's host has fewer than three labels (then nothing is trusted). */
function computerDomain(coordinatorUrl) {
  let host;
  try { host = new URL(coordinatorUrl).hostname.toLowerCase(); } catch { return null; }
  const labels = host.split('.');
  if (labels.length < 3 || labels.some((l) => !l)) return null;
  // An IP address has dots and no domain: nothing can be a label under "0.0.1" (kosmos#4699).
  if (labels.every((l) => /^\d+$/.test(l))) return null;
  return labels.slice(1).join('.');
}

/* 🛑 An address is trusted ONLY as `<label>.<domain>`: exactly one label under the
   computers' domain, a-z 0-9 and hyphens, 1 to 63 long, no hyphen at either end, and no
   punycode (xn--) lookalike. The coordinator's ANSWER is not signed, so without this a
   compromised or impersonated answer could make every board probe any host (a LAN address
   included) and paint a row linking anywhere, in the menu where the person expects their
   own computer. The same rule is applied again in the page before any link is built. */
function validAddress(a, domain) {
  if (typeof a !== 'string' || typeof domain !== 'string' || !domain) return false;
  const suffix = '.' + domain;
  if (!a.endsWith(suffix)) return false;
  const label = a.slice(0, -suffix.length);
  return label.length >= 1 && label.length <= 63 && /^[a-z0-9-]+$/.test(label)
    && !label.startsWith('-') && !label.endsWith('-') && !label.startsWith('xn--');
}

/* The coordinator's rows, kept to what the page shows, with bad rows dropped
   rather than guessed at. Accepts the parsed object macRequest returns. */
function parseComputers(answer, domain) {
  if (!answer || typeof answer !== 'object' || !Array.isArray(answer.computers)) return null;
  const out = [];
  for (const r of answer.computers) {
    if (!r || typeof r !== 'object') continue;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name || !validAddress(r.address, domain)) continue;
    out.push({
      name,
      address: r.address,
      this: r.this === true,
      updating: typeof r.updating_until === 'number',
    });
  }
  return out;
}

/* Whether a computer's tunnel is up: any HTTP answer from https://<address>/ says
   yes; a failure or a timeout says no. Resolves true or false, never throws. The
   answer's body is never read, and the socket is closed at once. `opts.request`
   and `opts.port` are test seams (http.request against a local server has the
   same shape); production is https.request on 443. */
function probeOnline(address, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || PROBE_TIMEOUT_MS;
  const request = (opts && opts.request) || require('https').request;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let req;
    try {
      req = request(
        Object.assign(
          { method: 'HEAD', host: address, path: '/', timeout: timeoutMs, headers: { 'user-agent': 'kosmos-switcher' } },
          opts && opts.port ? { port: opts.port } : {},
        ),
        (res) => { finish(true); res.resume(); req.destroy(); },
      );
    } catch { finish(false); return; }
    req.on('timeout', () => { finish(false); req.destroy(); });
    req.on('error', () => finish(false));
    req.end();
  });
}

/* fetchComputers({ probe }) -- best effort, never throws. `probe` is a test seam
   (address -> Promise<boolean>); production uses probeOnline. */
async function fetchComputers(opts) {
  const probe = (opts && opts.probe) || probeOnline;
  /* 🛑 SUITE GUARD, as in mac-standing.js: under node's test runner never run the
     real bundled tunnel against the production coordinator. A test that supplies
     its own fake tunnel (AGENT_WORKFORCE_TUNNEL_BIN) still runs the real path. */
  if (process.env.NODE_TEST_CONTEXT && !process.env.AGENT_WORKFORCE_TUNNEL_BIN) {
    return { ok: false, because: 'not in a test without a fake tunnel' };
  }
  let remote;
  /* kosmos#4815: signedIn: false marks the one answer that means "there is no list to have" (no Kosmos+ here), so
     the page can tell it from Kosmos+ failing, which also answers ok: false and must not read as "one computer". */
  try { remote = require('./remote'); } catch { return { ok: false, signedIn: false, because: 'remote access is not available here' }; }
  try {
    if (!remote.read().on || !remote.enrolled()) return { ok: false, signedIn: false, because: 'this computer is not signed in to Kosmos+' };
    const r = await remote.macRequest('POST', ROUTE, {});
    if (!r || !r.ok) return { ok: false, because: (r && r.because) || 'Kosmos+ did not answer' };
    const domain = computerDomain(remote.COORDINATOR());
    if (!domain) return { ok: false, because: 'the Kosmos+ address is not one computers can live under' };
    const rows = parseComputers(r.data, domain);
    if (!rows) return { ok: false, because: 'the Kosmos+ answer carried no computers' };
    const online = await Promise.all(rows.map((c) => (c.this ? true : probe(c.address).catch(() => false))));
    const computers = rows.map((c, i) => Object.assign({}, c, { online: online[i] === true }));
    // This computer first, then the others by name, so the list reads the same every time.
    computers.sort((a, b) => (a.this === b.this ? a.name.localeCompare(b.name) : (a.this ? -1 : 1)));
    return { ok: true, domain, computers };
  } catch (err) {
    return { ok: false, because: (err && err.message) || 'unknown failure' };
  }
}

module.exports = { ROUTE, PROBE_TIMEOUT_MS, computerDomain, validAddress, parseComputers, probeOnline, fetchComputers };
