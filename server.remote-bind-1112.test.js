'use strict';
/**
 * #1112 phase 2: the network bind, the auth that makes opening it safe, and
 * loopback-only remote token issuance.
 *
 * 🛑 THE ONE PROPERTY THAT MATTERS: owning the network does not own the Mac. A
 * remote (non-loopback) peer may reach ONLY the token-gated agent surface
 * (/api/report, /api/reply) with a valid token; every dangerous write, above
 * all POST /api/agents (which installs a launchd job), stays loopback-only
 * whether the bind is open or not.
 *
 * A real remote socket peer is not reachable from a same-machine test -- every
 * local connection IS loopback -- so `remoteWriteGuard` (which IS the security
 * decision) is exported and driven as a pure function with synthetic peers, and
 * every arm is asserted against a CONTROL that can return the dangerous answer.
 * The issuance ROUTE is driven end-to-end through the real server on loopback,
 * which also confirms a loopback POST reaches the route the guard is meant to
 * let through.
 *
 *   node --test server.remote-bind-1112.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rb-home-'));
process.env.HOME = FAKE_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rb-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rb-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rb-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rb-launch-'));
// This suite boots the real board, and fixture-discipline requires any suite
// touching the agent surface to sandbox Claude Code's own config file too, so a
// boot never writes trust entries into the operator's real ~/.claude.json.
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FAKE_HOME, 'claude.json');
// Opening the network bind is a TWO-part opt-in: KOSMOS_BIND_HOST (listen) AND
// AGENT_WORKFORCE_ALLOWED_HOSTS (the DNS-rebind allowlist pathOf checks BEFORE
// the guard runs). Declare a reachable host here, read at module load, so the
// HTTP-path tests below can show a remote Host being accepted vs 400'd.
process.env.AGENT_WORKFORCE_ALLOWED_HOSTS = 'kosmos-remote.example';
// The bind must default to loopback with no opt-in set: assert that here so the
// integration boot below is genuinely testing the default path.
delete process.env.KOSMOS_BIND_HOST;

const { start, server, remoteWriteGuard, isLoopbackPeer, bindHost, REMOTE_AGENT_ROUTES } = require('./server');
const sendertoken = require('./engine/sendertoken');
const store = require('./engine/store');

/** A synthetic request. `peer` is the socket's remoteAddress; default is a
 *  routable public address, i.e. NOT loopback. */
function req(method, { peer = '203.0.113.7', token } = {}) {
  const headers = {};
  if (token !== undefined) headers['x-kosmos-agent-token'] = token;
  return { method, socket: { remoteAddress: peer }, headers };
}
const REMOTE = '203.0.113.7';           // TEST-NET-3, never loopback
const LOOPBACKS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

/* ---------- the core containment property ---------- */

test('🛑 a remote peer CANNOT reach POST /api/agents; a loopback peer can (the control)', () => {
  const refused = remoteWriteGuard(req('POST', { peer: REMOTE }), '/api/agents');
  assert.ok(refused, 'a remote peer was NOT refused at POST /api/agents -- owning the network would own the Mac');
  // CONTROL: the identical call from loopback must PASS the guard, or the
  // refusal above proves only that the guard refuses everything.
  const local = remoteWriteGuard(req('POST', { peer: '127.0.0.1' }), '/api/agents');
  assert.equal(local, null, 'a loopback peer was refused at POST /api/agents; the control cannot reach the route it is meant to');
});

test('a remote agent reaches /api/report only with a VALID token, and refusals are one sentence (non-oracle)', () => {
  const good = sendertoken.mint('winbox');
  assert.equal(good.ok, true, 'mint failed: ' + good.because);

  const noTok  = remoteWriteGuard(req('POST', { peer: REMOTE }), '/api/report');
  const badTok = remoteWriteGuard(req('POST', { peer: REMOTE, token: 'ab'.repeat(32) }), '/api/report');
  const okTok  = remoteWriteGuard(req('POST', { peer: REMOTE, token: good.token }), '/api/report');
  // route-not-on-allowlist, with a VALID token, so the refusal cannot be about the token:
  const wrongRoute = remoteWriteGuard(req('POST', { peer: REMOTE, token: good.token }), '/api/agents');

  assert.ok(noTok, 'a remote report with NO token was allowed');
  assert.ok(badTok, 'a remote report with an UNKNOWN token was allowed');
  assert.equal(okTok, null, 'a remote report with a VALID token was refused');
  assert.equal(noTok, badTok, 'no-token and bad-token refusals differ: that is a token-validity oracle');
  assert.equal(noTok, wrongRoute, 'wrong-route and bad-token refusals differ: that is a route-existence oracle');
});

test('a remote agent reaches /api/reply only with a valid token', () => {
  const good = sendertoken.mint('winbox-reply');
  assert.ok(remoteWriteGuard(req('POST', { peer: '198.51.100.9' }), '/api/reply'), 'no-token remote reply was allowed');
  assert.equal(remoteWriteGuard(req('POST', { peer: '198.51.100.9', token: good.token }), '/api/reply'), null,
    'a valid-token remote reply was refused');
});

test('a loopback peer is unaffected on EVERY route (the guard changes nothing locally)', () => {
  const routes = [['POST', '/api/agents'], ['POST', '/api/report'], ['GET', '/api/status'],
    ['PUT', '/avatar'], ['POST', '/api/agent-token'], ['DELETE', '/api/connections/x'], ['POST', '/api/msg']];
  for (const [m, p] of routes) {
    for (const peer of LOOPBACKS) {
      assert.equal(remoteWriteGuard(req(m, { peer }), p), null, `loopback ${peer} was refused at ${m} ${p}`);
    }
  }
});

test('an undefined socket peer fails CLOSED (treated as remote)', () => {
  assert.equal(isLoopbackPeer({ socket: {} }), false, 'a socket with no remoteAddress read as loopback');
  assert.ok(remoteWriteGuard({ method: 'POST', socket: {}, headers: {} }, '/api/agents'),
    'an undefined-peer request to /api/agents was allowed');
});

test('the remote allowlist is exactly report + reply, nothing else (#1764)', () => {
  /* 🛑 PINNED ON PURPOSE, NOT A CHANGE-DETECTOR. A remote peer reaches ONLY the
     routes in this set, and the socket-peer guard is the ONLY thing standing
     there -- which a local reverse proxy DEFEATS (it terminates loopback and so
     presents a loopback peer; see the remoteWriteGuard docblock and #1762).
     report/reply are safe there because they are token-authed and cannot install,
     mint, or write machine state. ADDING A ROUTE HERE is a security decision, not
     a refactor: the moment a WRITE route joins this set, the proxy case stops
     being a read disclosure and becomes a NETWORK WRITE BYPASS. If you are here
     because this went red, do NOT just update the list -- read why the route must
     not be remotely reachable (#1764); if it genuinely must be, it needs its own
     guard, not a socket-peer a proxy defeats. */
  assert.deepEqual([...REMOTE_AGENT_ROUTES].sort(), ['POST /api/report', 'POST /api/reply'].sort(),
    'REMOTE_AGENT_ROUTES changed: adding a route moves it behind the socket-peer guard only, which a local reverse proxy defeats -- see the remoteWriteGuard docblock and kosmos#1762/#1764');
});

test('🛑 every STATIC-PATH write route is remotely unreachable except the agent surface, even with a valid token (#1764, bounds #1762)', () => {
  /* REACH, not presence. It reads the guard's BEHAVIOUR (not the
     REMOTE_AGENT_ROUTES literal) against every STATIC-PATH write route DERIVED
     FROM server.js's own dispatch -- so a write route added to
     REMOTE_AGENT_ROUTES is caught here EVEN IF someone reflexively updated the
     exact-set assertion above, because the probe set comes from the source, not a
     curated list a future edit could sit outside of.
     🔑 STATIC-PATH IS THE RIGHT AND COMPLETE SCOPE FOR THE THREAT, NOT A GAP.
     REMOTE_AGENT_ROUTES is an EXACT-MATCH set (`has(`${method} ${pathname}`)`), so
     only a fixed `METHOD /api/x` string can ever be added to it. Parameterized
     write routes (`POST /api/agent/<n>/skills`, `PUT /api/project/<id>`, ...) are
     dispatched from a matched variable and CANNOT be expressed as a fixed entry,
     so they are structurally outside what could create the #1764 bypass; the
     exact-set pin above is their backstop for any change. Every addable route is
     a static-path route, and every static-path write route uses the inline form
     this scan captures. Prior art: relay claims.rs:473 pins gate::admit to one
     call site so the mint cannot become token-only. */
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const routes = new Set();
  const re = /pathname === '(\/api\/[^']+)' && req\.method === '(POST|PUT|DELETE|PATCH)'/g;
  let m;
  while ((m = re.exec(src))) routes.add(`${m[2]} ${m[1]}`);
  /* A TIGHT floor near the real count (~59 static-path write routes), so a
     dispatch-style refactor that made the scan go narrow (method-first order, a
     route() helper, reflowed conditions) reds here instead of quietly checking
     far fewer than it claims. Removing a handful of routes legitimately is
     tolerated; a collapse to a fraction is not. */
  assert.ok(routes.size >= 55, `the write-route scan found only ${routes.size} (expected ~59); the scan or the dispatch changed shape -- do not trust this test until it is re-derived`);

  const good = sendertoken.mint('reach-probe-1764');
  assert.equal(good.ok, true, good.because);
  // The INTENDED remote surface, written as a literal (NOT read from
  // REMOTE_AGENT_ROUTES): a route wrongly added to that set must still be treated
  // as one that should be refused, which is the whole point.
  const AGENT_SURFACE = new Set(['POST /api/report', 'POST /api/reply']);
  let checkedRefused = 0;
  for (const route of routes) {
    const method = route.slice(0, route.indexOf(' '));
    const p = route.slice(route.indexOf(' ') + 1);
    const verdict = remoteWriteGuard(req(method, { peer: REMOTE, token: good.token }), p);
    if (AGENT_SURFACE.has(route)) {
      // CONTROL: the token-authed agent surface DOES reach, so the refusals below
      // are the allowlist working, not a guard that refuses everything.
      assert.equal(verdict, null, `CONTROL: the token-authed ${route} was refused; the reach checks would then be vacuous`);
    } else {
      assert.ok(verdict, `a remote peer with a valid token reached ${route}: a write route on REMOTE_AGENT_ROUTES turns a documented read disclosure into a network write bypass (#1764)`);
      checkedRefused++;
    }
  }
  assert.ok(checkedRefused >= 53, `only ${checkedRefused} static-path write routes were checked as refused (expected ~57); coverage regressed`);
});

test('🛑 issuance is loopback-only: a remote peer to POST /api/agent-token is refused', () => {
  // Explicit arm so the loopback-only claim is self-evident, not merely derived
  // from the allowlist. Even with a valid token, /api/agent-token is not on the
  // remote allowlist, so a remote peer never reaches the mint.
  const good = sendertoken.mint('probe-issue');
  assert.ok(remoteWriteGuard(req('POST', { peer: REMOTE }), '/api/agent-token'),
    'a remote peer reached the token-issuance endpoint');
  assert.ok(remoteWriteGuard(req('POST', { peer: REMOTE, token: good.token }), '/api/agent-token'),
    'a remote peer with a valid token reached the token-issuance endpoint');
  // control: from loopback the guard lets it through (issuance is a local action)
  assert.equal(remoteWriteGuard(req('POST', { peer: '127.0.0.1' }), '/api/agent-token'), null,
    'a loopback peer was refused at issuance (the control cannot reach the mint)');
});

/* ---------- the bind opt-in ---------- */

test('bindHost defaults to loopback and opens ONLY on an explicit opt-in', () => {
  const saved = process.env.KOSMOS_BIND_HOST;
  try {
    delete process.env.KOSMOS_BIND_HOST;
    assert.equal(bindHost(), '127.0.0.1', 'the default bind is not loopback');
    process.env.KOSMOS_BIND_HOST = '0.0.0.0';
    assert.equal(bindHost(), '0.0.0.0', 'the opt-in bind host was not honoured');
    process.env.KOSMOS_BIND_HOST = '   ';   // whitespace-only is not an opt-in
    assert.equal(bindHost(), '127.0.0.1', 'a blank KOSMOS_BIND_HOST opened the bind');
  } finally {
    if (saved === undefined) delete process.env.KOSMOS_BIND_HOST; else process.env.KOSMOS_BIND_HOST = saved;
  }
});

/* ---------- issuance, end to end on the real server (loopback) ---------- */

let base;
test('boot the board on the default loopback bind', async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test('POST /api/agent-token mints a resolvable token, from loopback', async () => {
  const name = 'remote-mara';
  // CONTROL: nothing resolves this name before the mint, so a pass below cannot
  // be a stale-store artefact.
  const before = sendertoken.keys().includes(store.safeKey(name));
  assert.equal(before, false, 'the store already knew this name before issuance');

  const res = await fetch(`${base}/api/agent-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  });
  const j = await res.json();
  assert.equal(res.status, 200);
  assert.equal(j.issued, true, 'issuance refused: ' + (j.because || j.error));
  assert.match(j.token, /^[0-9a-f]{64}$/, 'the issued token is not the 32-byte hex the surface validates');

  const back = sendertoken.resolveName(j.token);
  assert.equal(back.ok, true, 'the issued token does not resolve in the store');
  assert.equal(back.key, store.safeKey(name), 'the issued token resolves to the wrong agent');
});

test('POST /api/agent-token refuses an empty name', async () => {
  const res = await fetch(`${base}/api/agent-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '   ' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/agent-token: an unkeyable (all-punctuation) name is a 400, not a 500', async () => {
  // "!!!" survives trim but reduces to nothing under safeKey; that is a CLIENT
  // error and must be 400, not a server 500.
  const res = await fetch(`${base}/api/agent-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '!!!' }),
  });
  assert.equal(res.status, 400, 'an unkeyable name was reported as a server fault instead of a client error');
});

/* ---------- the second opt-in: the pathOf Host check the guard sits behind ----------
 *
 * A remote agent connects with a non-loopback Host, and pathOf's DNS-rebind
 * check 400s any Host that is neither loopback nor declared in
 * AGENT_WORKFORCE_ALLOWED_HOSTS -- BEFORE remoteWriteGuard runs. So the feature
 * needs BOTH env vars, and this is the layer the pure-function guard tests above
 * cannot see. Driven over the real HTTP path with a spoofed Host header (a
 * request's socket peer is always loopback in a same-machine test, so this
 * exercises pathOf, not the remote-peer arm of the guard). */
function getWithHost(hostHeader, urlPath) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const r = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', headers: { host: hostHeader } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.end();
  });
}

test('a DECLARED reachable Host reaches a route; an UNDECLARED non-loopback Host is 400 at the door', async () => {
  // declared in AGENT_WORKFORCE_ALLOWED_HOSTS (set at module load): pathOf accepts it
  assert.equal(await getWithHost('kosmos-remote.example', '/api/status'), 200,
    'a Host declared in AGENT_WORKFORCE_ALLOWED_HOSTS was refused; opening the bind would strand a remote agent');
  // an undeclared, non-loopback Host: pathOf returns null -> 400, BEFORE the guard.
  // This is exactly why KOSMOS_BIND_HOST alone is not enough.
  assert.equal(await getWithHost('198.51.100.9', '/api/status'), 400,
    'an undeclared non-loopback Host was NOT refused by the DNS-rebind check');
  // loopback Host still works, unchanged
  assert.equal(await getWithHost('127.0.0.1', '/api/status'), 200, 'a loopback Host was refused');
});

test.after(() => { try { server.close(); } catch { /* best effort */ } });
