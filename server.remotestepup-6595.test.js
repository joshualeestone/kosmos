'use strict';
/* kosmos#6595 (R01, the step-up half): from a remote session, a key or token, an update and a new agent need a
   fresh second-factor sign-in, read from the two headers the Kosmos+ gate writes (x-kosmos-session-iat and
   x-kosmos-session-second; kosmos-relay sessioniat-6595, not checked from this repo). Refusals are checked against
   the real server: the gate runs before any route reads its body, so a refused request reaches nothing. Requests
   that PASS the gate are sent only to key routes with an unreadable body (they answer 400 and change nothing);
   update and agent creation are never let through here, and their pass arm is tested on the function. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remotestepup-6595-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
// A connector that says it strips the session headers (kosmos-relay sessioniat-6595's `capabilities` verb), so the
// gate trusts them; the connector that does not is tested on the function below.
const CONNECTOR = path.join(SANDBOX, 'kosmos-tunnel');
fs.writeFileSync(CONNECTOR, '#!/bin/sh\n[ "$1" = capabilities ] && printf "session-headers\\n" && exit 0\nexit 1\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_TUNNEL_BIN = CONNECTOR;

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, remoteSessionFresh, needsRemoteStepUp, remoteStepUpRefusal, REMOTE_STEP_UP, REMOTE_STEP_UP_CLOCK, REMOTE_STEP_UP_CONNECTOR, REMOTE_STEP_UP_SECS } = require('./server');
const remote = require('./engine/remote');

let base;
/* kosmos#6616: since R01b part 6 a tunnel must be running here and list the capability in its own status file. These
   tests stand in one (TEST_PID) whose file lists it, so the binary's answer is what they exercise. */
const TEST_PID = 424240;
const STATUS = path.join(require('./engine/store').ROOT, 'remote-status.json');
const listRunning = (body = { state: 'up', pid: TEST_PID, capabilities: ['session-headers'] }) => {
  fs.mkdirSync(path.dirname(STATUS), { recursive: true }); fs.writeFileSync(STATUS, JSON.stringify(body));
};
// commandOf: no test reads real process tables unless it says so (kosmos#6669's tests do).
const reset = (opts = {}) => { listRunning(); remote.resetConnectorCapabilitiesForTests({ runningPid: TEST_PID, commandOf: () => null, ...opts }); };
const warm = () => new Promise((resolve) => remote.warmConnectorCapabilities(resolve));
// Polls, not a fixed sleep: a background ask on a loaded machine can take far longer than it does here.
const until = async (ok, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); return ok(); };
// This board "started" its tunnel (the tests start none), so what the connector says is listened to.
test.before(async () => { await start(0); reset(); await warm(); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const now = () => Math.floor(Date.now() / 1000);
const PAGE = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
const VIA_PLUS = { ...PAGE, 'x-forwarded-host': 'hers.kosmos.invalid', 'x-forwarded-for': '203.0.113.9' };
const fresh = () => ({ 'x-kosmos-session-iat': String(now() - 30), 'x-kosmos-session-second': '1' });
const post = async (route, headers, raw, method = 'POST') => {
  const res = await fetch(base + route, { method, headers, body: raw === undefined ? '{}' : raw });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const STEP_UP_ROUTES = [
  '/api/update', '/api/update/rollback', '/api/update/check', '/api/connect/start', '/api/antigravity/install', '/api/muse/install',
  '/api/accounts/openai', '/api/accounts/claude/apikey', '/api/accounts/gemini/apikey', '/api/accounts/grok/apikey',
  '/api/accounts/qwen', '/api/cloudflare/token', '/api/svc/brave-search/token', '/api/runners/openai/install',
  '/api/accounts/openai/subscription/start', '/api/accounts/grok/subscription/start', '/api/antigravity/signin',
  '/api/antigravity/win32signin', '/api/muse/signin', '/api/muse/signin/retry', '/api/github/start',
  '/api/github-device/start', '/api/vercel/start',
  '/api/register/hide',   // #6714: closing a restart notice silences a warning
  '/api/agents', '/api/team', '/api/connect-agent', '/api/worlds', '/api/worlds/import', '/api/agent/scout/restore',
  '/api/register', '/api/remote/second-reset', '/api/project/p1/webhooks', '/api/org/enroll',
  '/api/federation/join', '/api/federation/invite', '/api/federation/own-code', '/api/federation/own-allow', '/api/federation/own-confirm',
  '/api/remote/signin-start', '/api/remote/signin-register', '/api/remote/setup-start', '/api/remote/setup-complete',
  '/api/remote/company/start', '/api/remote/forget',
];

test('R01: PUT /api/autoupdate from a stale remote session is refused (on the function)', () => {
  assert.equal(remoteStepUpRefusal({ method: 'PUT', headers: VIA_PLUS }, '/api/autoupdate', now()), REMOTE_STEP_UP);
});

const STALE = [
  ['no session headers', {}],
  ['a fresh time but no second factor', { 'x-kosmos-session-iat': String(now() - 30), 'x-kosmos-session-second': '0' }],
  ['the second factor but a stale time', { 'x-kosmos-session-iat': String(now() - REMOTE_STEP_UP_SECS - 5), 'x-kosmos-session-second': '1' }],
  ['a malformed time', { 'x-kosmos-session-iat': '1e9', 'x-kosmos-session-second': '1' }],
];
/* 🛑 Only these routes are sent real requests, and with an unreadable body: each reads and parses its body before it
   acts, so even with the gate broken they answer 400 and change nothing. The rest (update, installs, sign-ins, new
   agents, webhooks) are never sent a request from here, because a broken gate would run them for real (13:10
   2026-10-19: one started a real GitHub sign-in). Their refusal is tested on the function below. */
const SAFE_OVER_HTTP = ['/api/accounts/gemini/apikey', '/api/accounts/grok/apikey', '/api/accounts/claude/apikey',
  '/api/cloudflare/token', '/api/svc/brave-search/token'];
for (const route of SAFE_OVER_HTTP) {
  test(`R01: ${route} from a remote session with no fresh sign-in is refused with remote_step_up (over HTTP)`, async () => {
    for (const [why, extra] of STALE) {
      const got = await post(route, { ...VIA_PLUS, ...extra }, 'not json');
      assert.equal(got.status, 403, `${route}, ${why}: ${JSON.stringify(got.body)}`);
      assert.deepEqual(got.body, { ...REMOTE_STEP_UP }, `${route}, ${why}`);
    }
  });
}
test('R01: every gated route is refused a remote session with no fresh sign-in (on the function)', () => {
  const t = now();
  for (const route of STEP_UP_ROUTES) {
    for (const method of ['POST', 'PUT', 'PATCH']) {
      for (const [why, extra] of STALE) {
        assert.equal(remoteStepUpRefusal({ method, headers: { ...VIA_PLUS, ...extra } }, route, t), REMOTE_STEP_UP,
          `${method} ${route}, ${why}`);
      }
    }
  }
});

test('R01 CONTROL: a fresh remote sign-in, and a local request, pass the gate (a key route then reads its body)', async () => {
  for (const route of ['/api/accounts/gemini/apikey', '/api/accounts/grok/apikey', '/api/svc/brave-search/token']) {
    const remoteFresh = await post(route, { ...VIA_PLUS, ...fresh() }, 'not json');
    assert.notEqual(remoteFresh.body && remoteFresh.body.code, 'remote_step_up', route + ' refused a fresh remote session');
    assert.equal(remoteFresh.status, 400, route + ' fresh remote: ' + JSON.stringify(remoteFresh.body));
    const local = await post(route, PAGE, 'not json');
    assert.notEqual(local.body && local.body.code, 'remote_step_up', route + ' refused a local request');
    assert.equal(local.status, 400, route + ' local: ' + JSON.stringify(local.body));
  }
});

test('R01: taking things away is not gated (forget a token, sign a provider out)', () => {
  assert.equal(needsRemoteStepUp('/api/svc/brave-search/forget', 'POST'), false);
  assert.equal(needsRemoteStepUp('/api/accounts/gemini', 'DELETE'), false);
  assert.equal(needsRemoteStepUp('/api/accounts/qwen', 'DELETE'), false);
  assert.equal(needsRemoteStepUp('/api/accounts', 'GET'), false);
  assert.equal(needsRemoteStepUp('/api/update/check', 'POST'), true, 'a check can start an install while automatic updates are on');
  for (const route of STEP_UP_ROUTES) assert.equal(needsRemoteStepUp(route, 'POST'), true, route);
  assert.equal(needsRemoteStepUp('/api/autoupdate', 'PUT'), true);
  assert.equal(needsRemoteStepUp('/api/autoupdate', 'GET'), false);
  assert.equal(needsRemoteStepUp('/api/svc/brave-search/token', 'GET'), false, 'reading is not gated');
  assert.equal(needsRemoteStepUp('/api/agents', 'PUT'), true, 'a gated path is gated for PUT and PATCH too');
  assert.equal(needsRemoteStepUp('/api/agents', 'DELETE'), false, 'DELETE takes away');
  assert.equal(needsRemoteStepUp('/api/org/preview', 'POST'), false, 'previewing a code reads');
  assert.equal(needsRemoteStepUp('/api/org/leave', 'POST'), false, 'leaving takes away');
});

test('R01: freshness needs the second factor and a time within the window, bounded both sides', () => {
  const t = 1_800_000_000;
  const h = (iat, second) => ({ 'x-kosmos-session-iat': iat, 'x-kosmos-session-second': second });
  assert.equal(remoteSessionFresh(h(String(t - 30), '1'), t), true);
  assert.equal(remoteSessionFresh(h(String(t - REMOTE_STEP_UP_SECS), '1'), t), true, 'the edge of the window');
  assert.equal(remoteSessionFresh(h(String(t - REMOTE_STEP_UP_SECS - 1), '1'), t), false, 'one second past it');
  assert.equal(remoteSessionFresh(h(String(t + 60), '1'), t), true, 'a minute of clock drift');
  assert.equal(remoteSessionFresh(h(String(t + 61), '1'), t), false, 'further ahead is not fresh');
  assert.equal(remoteSessionFresh(h(String(t - 30), '0'), t), false, 'no second factor');
  assert.equal(remoteSessionFresh(h(String(t - 30), 'true'), t), false, 'only "1" counts');
  assert.equal(remoteSessionFresh({ 'x-kosmos-session-second': '1' }, t), false, 'no time');
  assert.equal(remoteSessionFresh({ 'x-kosmos-session-iat': String(t - 30) }, t), false, 'no second header');
  for (const bad of ['', ' 1', '-5', '1.5', '0x10', String(t - 30) + ', ' + String(t - 30)]) {
    assert.equal(remoteSessionFresh(h(bad, '1'), t), false, 'malformed time ' + JSON.stringify(bad));
  }
  assert.equal(remoteSessionFresh(undefined, t), false);
});

test('R01: the gate passes update and agent creation for a fresh remote session and for a local one (function only)', () => {
  const t = now();
  const req = (headers) => ({ method: 'POST', headers });
  for (const route of ['/api/update', '/api/agents', '/api/team', '/api/connect-agent', '/api/connect/start']) {
    assert.equal(remoteStepUpRefusal(req({ ...VIA_PLUS, ...fresh() }), route, t), null, route + ' fresh remote');
    assert.equal(remoteStepUpRefusal(req(PAGE), route, t), null, route + ' local');
    assert.equal(remoteStepUpRefusal(req(VIA_PLUS), route, t), REMOTE_STEP_UP, route + ' stale remote');
  }
  assert.equal(remoteStepUpRefusal(req(VIA_PLUS), '/api/agents/x/messages', t), null, 'an ungated route is never asked');
  // A sign-in from more than a minute ahead of this clock is told apart: signing in again cannot help.
  const ahead = { ...VIA_PLUS, 'x-kosmos-session-iat': String(t + 600), 'x-kosmos-session-second': '1' };
  assert.equal(remoteStepUpRefusal(req(ahead), '/api/agents', t), REMOTE_STEP_UP_CLOCK);
  const aheadNoSecond = { ...ahead, 'x-kosmos-session-second': '0' };
  assert.equal(remoteStepUpRefusal(req(aheadNoSecond), '/api/agents', t), REMOTE_STEP_UP, 'no second factor is not a clock problem');
});

/* The guard that keeps the list honest (review iteration 1): every POST or PUT route in server.js, written in the
   board's usual `pathname === '...' && req.method === '...'` shape, that looks like it
   takes a key, a token or a sign-in, installs or updates, or makes an agent, is either gated or exempt here with its
   reason. A new such route that forgets the gate turns this red. And every gated route is a real route, so a rename
   cannot leave the gate guarding a path nothing serves. */
const EXEMPT = {
  'POST /api/register/show': 'brings a closed restart notice back; nothing is started or silenced (#6714)',
  'POST /api/agent-import': 'parses a file into instructions; the create it feeds is gated',
  'POST /api/agent-import-file': 'parses a file; the create it feeds is gated',
  'POST /api/agent-import-folder': 'parses a folder; the create it feeds is gated',
  'POST /api/agent-token': 'refused remotely outright (remote_not_allowed, remotemark-6595)',
  'POST /api/disconnect-agent': 'takes an agent away',
  'POST /api/federation/own-remove': 'takes a computer out of a sealed room (a new key it is not sent); lets nothing in (#7028)',
  'POST /api/remote/signin-cancel': "a step after signin-start, which is gated",
  'POST /api/remote/signin-confirm-enrol': "a step after signin-start, which is gated",
  'POST /api/remote/signin-enrol': "a step after signin-start, which is gated",
  'POST /api/remote/signin-second': "a step after signin-start, which is gated",
  'POST /api/remote/signin-verify': "a step after signin-start, which is gated",
  'POST /api/github-device/app': 'stores a GitHub app client id, which is public by design; the sign-in start is gated',
  'POST /api/remote/join/confirm': 'refused remotely outright (remote_not_allowed, remotemark-6595)',
  'POST /api/remote/join/recheck': "this computer's own join attempt, no allow (remotemark-6595's exclusions)",
  'POST /api/remote/join/retry': "this computer's own join attempt, no allow (remotemark-6595's exclusions)",
};
/* Decided without a scan to catch them (their paths name none of the guard's words), written down so the boundary is
   a record: POST /api/agent/<n>/codex-hooks trusting hooks lets them run outside Codex's sandbox, but every agent here
   already runs an unsandboxed shell, so it adds nothing a remote session lacks. POST /api/accounts/share points a
   Claude account's history at the shared tree: it moves where history lives, and no credential or software enters.
   POST /api/agents/account moves agents to another account's folder and restarts them, making none and storing no
   credential. POST /api/engine/restart restarts the board onto the code already on disk, and only when it is stale: it runs nothing
   new. POST /api/machine/start-at-sign-in writes the board's own login job, which restarts only code already on disk,
   for the same reason. POST /api/federation/verify checks an invite and lets nothing in. The gate is a list, so a future route like these is open until someone adds it; the two scans above narrow
   that to routes whose paths name none of their words. */
const LOOKS_GATED = /(install|apikey|token|subscription\/start|signin|\/start$|import|^\/api\/worlds$|^\/api\/agents$|^\/api\/team$|connect-agent|update|join|enroll|register|federation|webhook)/;
test('R01: every key, sign-in, install, update or create route is gated or exempt with a reason, and every gated route exists', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const routes = [...src.matchAll(/pathname === '(\/api\/[^']*)' && req\.method === '(POST|PUT|PATCH)'/g)].map((m) => m[2] + ' ' + m[1]);
  assert.ok(routes.length > 100, 'the route scan found ' + routes.length + ' routes, so it is not reading server.js');
  const looks = routes.filter((r) => LOOKS_GATED.test(r.split(' ')[1]));
  assert.ok(looks.includes('POST /api/agents') && looks.includes('POST /api/update'), 'CONTROL: the scan sees known routes');
  const missing = looks.filter((r) => { const [m, p] = r.split(' '); return !needsRemoteStepUp(p, m) && !EXEMPT[r]; });
  assert.deepEqual(missing, [], 'routes that look like keys, installs, updates or creates but are neither gated nor exempt');
  for (const route of STEP_UP_ROUTES) {
    const named = /^\/api\/(svc|runners|agent|project)\//.test(route);
    assert.ok(src.includes("pathname === '" + route + "'") || named, route + ' is gated but server.js serves no such path');
  }
  for (const r of Object.keys(EXEMPT)) assert.ok(routes.includes(r), 'exempt ' + r + ' is not a route any more');
});

/* Regex-defined routes are invisible to the literal scan above (review iteration 2), so each one whose pattern names a
   token, an install, a sign-in, an import, a restore, a skill or a webhook is listed here: gated (with a path it must match) or
   exempt with its reason. A new such regex route turns this red until someone decides. */
const REGEX_ROUTES = {
  '/^\\/api\\/svc\\/([a-z0-9-]+)(?:\\/(token|forget))?$/': { gated: '/api/svc/brave-search/token' },
  '/^\\/api\\/runners\\/([a-z]+)\\/install$/': { gated: '/api/runners/openai/install' },
  '/^\\/api\\/agent\\/([^/]+)\\/restore$/': { gated: '/api/agent/scout/restore' },
  '/^\\/api\\/project\\/([^/]+)\\/webhooks$/': { gated: '/api/project/p1/webhooks' },
  '/^\\/api\\/project\\/([^/]+)\\/webhooks\\/([0-9a-f]{16})(\\/name)?$/': { exempt: 'renames or deletes a webhook; neither mints a new secret' },
  '/^\\/api\\/skills\\/([^/]+)$/': { exempt: 'a skill is text agents read; a remote session can already tell any agent anything in chat' },
  '/^\\/api\\/agent\\/([^/]+)\\/skills$/': { exempt: 'as for skills: no more than messaging that agent' },
  '/^\\/api\\/agent\\/([^/]+)\\/skills\\/([^/]+)$/': { exempt: 'as for skills: no more than messaging that agent' },
  // The gate's own patterns.
  '/^\\/api\\/svc\\/[a-z0-9-]+\\/token$/': { gate: true },
  '/^\\/api\\/runners\\/[a-z]+\\/install$/': { gate: true },
  '/^\\/api\\/agent\\/[^/]+\\/restore$/': { gate: true },
  '/^\\/api\\/project\\/[^/]+\\/webhooks$/': { gate: true },
};
test('R01: every regex route naming a token, install, sign-in, import, restore or skill is decided, and gated ones match', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const found = [...new Set([...src.matchAll(/\/\^\\\/api\\\/[^\s]*?\$\//g)].map((m) => m[0]))];
  assert.ok(found.length > 30, 'the regex scan found ' + found.length + ', so it is not reading server.js');
  const named = found.filter((r) => /install|token|apikey|signin|subscription|import|restore|skill|webhook/.test(r));
  assert.ok(named.includes('/^\\/api\\/runners\\/([a-z]+)\\/install$/'), 'CONTROL: the scan sees a known regex route');
  const undecided = named.filter((r) => !REGEX_ROUTES[r]);
  assert.deepEqual(undecided, [], 'regex routes nobody has decided on');
  for (const [r, d] of Object.entries(REGEX_ROUTES)) {
    assert.ok(found.includes(r), r + ' is listed but is not in server.js any more');
    if (d.gated) {
      assert.equal(needsRemoteStepUp(d.gated, 'POST'), true, d.gated + ' should be gated');
      // And the SERVER's own pattern serves that path, so a renamed route cannot leave the gate's copy guarding nothing.
      assert.ok(new RegExp(r.slice(1, -1)).test(d.gated), r + ' does not serve ' + d.gated);
    }
  }
});

test('R01: a connector that does not list session-headers cannot vouch, so even a fresh remote session is refused', () => {
  const t = now();
  const fresh = { method: 'POST', headers: { ...VIA_PLUS, 'x-kosmos-session-iat': String(t - 30), 'x-kosmos-session-second': '1' } };
  assert.equal(remoteStepUpRefusal(fresh, '/api/agents', t, new Set(['session-headers'])), null, 'CONTROL: it lists it');
  assert.equal(remoteStepUpRefusal(fresh, '/api/agents', t, new Set()), REMOTE_STEP_UP_CONNECTOR);
  assert.equal(remoteStepUpRefusal(fresh, '/api/agents', t, new Set(['something-else'])), REMOTE_STEP_UP_CONNECTOR);
  // A local request is never asked, whatever the connector says.
  assert.equal(remoteStepUpRefusal({ method: 'POST', headers: PAGE }, '/api/agents', t, new Set()), null);
});

test('R01: the warm-up fills the answer without blocking, and a request then finds it kept', async () => {
  reset();
  const caps = await new Promise((resolve) => remote.warmConnectorCapabilities(resolve));
  assert.ok(caps.has('session-headers'));
  const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = '/usr/bin/false';
  try {
    assert.ok(remote.connectorCapabilities().has('session-headers'), 'the request used the warmed answer, not a new spawn');
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; reset(); }
});

test('R01: the connector is never asked while a request waits: with no answer kept, "nothing" now, and an ask in the background', async () => {
  const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  try {
    reset();
    assert.equal(remote.connectorCapabilities().size, 0, 'no answer yet: nothing, at once');
    assert.ok(await until(() => remote.connectorCapabilities().has('session-headers')), 'the background ask filled it');
    // Kept, never downgraded: a later failing connector does not undo it.
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = '/usr/bin/false';
    assert.ok(remote.connectorCapabilities(Date.now() + 10 * 60 * 60 * 1000).has('session-headers'));
    await warm();
    assert.ok(remote.connectorCapabilities().has('session-headers'), 'a failed later ask does not downgrade it');
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; reset(); await warm(); }
});

test('R01: an old connector is asked again after ten minutes, one that did not answer after thirty seconds', async () => {
  const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  const old = path.join(SANDBOX, 'old-tunnel');
  fs.writeFileSync(old, '#!/bin/sh\nexit 2\n', { mode: 0o755 });   // an older connector: the verb is unknown
  try {
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = old;
    reset();
    assert.equal((await warm()).size, 0, 'an old connector lists nothing');
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = CONNECTOR;   // updated
    const t0 = Date.now();
    assert.equal(remote.connectorCapabilities(t0 + 9 * 60 * 1000).size, 0, 'kept for ten minutes');
    remote.connectorCapabilities(t0 + 10 * 60 * 1000 + 1);   // due: asks in the background
    assert.ok(await until(() => remote.connectorCapabilities().has('session-headers')), 'asked again after ten');
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = path.join(SANDBOX, 'no-such-tunnel');   // cannot be started
    reset();
    assert.equal((await warm()).size, 0);
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = CONNECTOR;
    const t1 = Date.now();
    assert.equal(remote.connectorCapabilities(t1 + 20 * 1000).size, 0, 'unanswered: kept for thirty seconds');
    remote.connectorCapabilities(t1 + 31 * 1000);
    assert.ok(await until(() => remote.connectorCapabilities().has('session-headers')), 'unanswered: asked again after thirty seconds');
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; reset(); await warm(); }
});

test('R01: over HTTP, a connector that cannot vouch refuses a fresh remote session (key route, unreadable body)', async () => {
  const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  const old = path.join(SANDBOX, 'old-tunnel-http');
  fs.writeFileSync(old, '#!/bin/sh\nexit 2\n', { mode: 0o755 });
  try {
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = old;
    reset();
    await warm();
    const got = await post('/api/accounts/gemini/apikey', { ...VIA_PLUS, ...fresh() }, 'not json');
    assert.equal(got.status, 403, JSON.stringify(got.body));
    assert.equal(got.body.code, 'remote_step_up_unavailable');
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; reset(); await warm(); }
});

test('R01: a late answer from an earlier ask is dropped (generations), and starting a tunnel asks anew', async () => {
  const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  // The earlier connector would vouch, but slowly; the one now in place does not. Its late "yes" must not be trusted.
  const slowYes = path.join(SANDBOX, 'slow-yes-tunnel');
  fs.writeFileSync(slowYes, '#!/bin/sh\nsleep 0.3\nprintf "session-headers\\n"\n', { mode: 0o755 });
  const no = path.join(SANDBOX, 'no-tunnel');
  fs.writeFileSync(no, '#!/bin/sh\nexit 2\n', { mode: 0o755 });
  try {
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = slowYes;
    reset();
    const late = warm();                       // the earlier connector's ask, still running
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = no;
    remote.forgetConnectorCapabilities();      // a tunnel is started: a new generation
    assert.equal((await warm()).size, 0, 'the connector now in place does not vouch');
    await late;                                // the earlier ask lands now, saying yes
    assert.equal(remote.connectorCapabilities().has('session-headers'), false, 'a late yes from an earlier connector was trusted');
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; reset(); await warm(); }
});

test('R01: a tunnel restart on the same binary keeps a yes; a changed binary is asked again', async () => {
  const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  const yes = path.join(SANDBOX, 'yes-tunnel');
  fs.writeFileSync(yes, '#!/bin/sh\nprintf "session-headers\\n"\n', { mode: 0o755 });
  try {
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = yes;
    reset();
    await warm();
    remote.forgetConnectorCapabilities();   // a tunnel restarts on the same binary
    assert.ok(remote.connectorCapabilities().has('session-headers'), 'a restart on the same binary lost the answer');
    fs.writeFileSync(yes, '#!/bin/sh\nexit 2\n', { mode: 0o755 });   // the binary changes (an update)
    const later = new Date(Date.now() + 5000); fs.utimesSync(yes, later, later);
    remote.forgetConnectorCapabilities();
    assert.equal((await warm()).size, 0, 'a changed binary kept the old yes');
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; reset(); await warm(); }
});

test('R01: a forget right after the start-up ask still ends with an answer (the ask is restarted)', async () => {
  reset();
  remote.askConnectorCapabilities();          // the start-up ask
  remote.forgetConnectorCapabilities();       // a tunnel starts before it returns
  assert.ok(await until(() => remote.connectorCapabilities().has('session-headers')), 'nothing was asking after the forget');
});

test('R01: until this board has started its own tunnel, nothing is vouched for (a tunnel from an earlier board borrows nothing)', async () => {
  try {
    reset({ startedHere: false });
    await warm();                                   // the binary says yes ...
    assert.equal(remote.connectorCapabilities().size, 0, 'a tunnel this board did not start was vouched for');
  } finally { reset(); await warm(); }
});

/* kosmos#6616 (R01b part 6): the RUNNING tunnel must list the capability too. The binary's yes alone described the file
   on disk, which an update can replace while an older tunnel keeps forwarding. */
test('R01b: while a tunnel runs here, only what that process lists in its status file counts', async () => {
  const statusFile = STATUS;
  const pid = 424242;
  const write = (body) => { fs.mkdirSync(path.dirname(statusFile), { recursive: true }); fs.writeFileSync(statusFile, JSON.stringify(body)); };
  try {
    reset({ runningPid: pid });
    await warm();                                                    // the binary on disk says yes
    write({ state: 'up', pid, capabilities: ['session-headers'] });
    assert.ok(remote.connectorCapabilities().has('session-headers'), 'CONTROL: the running process lists it');
    // Each arm is its own running process (a fresh pid): a pid's list is kept once read (kosmos#6669).
    // And the binary is asked again each time (a reset forgets it), so a refusal is the running list's, not an empty binary's.
    const as = async (p) => { remote.resetConnectorCapabilitiesForTests({ runningPid: p, commandOf: () => null }); await warm(); };
    await as(pid + 10); write({ state: 'up', pid: pid + 10 });              // an older tunnel, still running
    assert.equal(remote.connectorCapabilities().size, 0, 'the binary vouched for an older running tunnel');
    await as(pid + 11); write({ state: 'up', pid: pid + 12, capabilities: ['session-headers'] });
    assert.equal(remote.connectorCapabilities().size, 0, 'another process\'s status file vouched');
    await as(pid + 13); write({ state: 'up', pid: pid + 13, capabilities: 'session-headers' });
    assert.equal(remote.connectorCapabilities().size, 0, 'a list that is not an array vouched');
    await as(pid + 16); write({ state: 'up', pid: pid + 16, capabilities: [1, { 'session-headers': true }, null] });
    assert.equal(remote.connectorCapabilities().size, 0, 'an array of non-strings vouched');
    await as(pid + 14); fs.rmSync(statusFile, { force: true });
    assert.equal(remote.connectorCapabilities().size, 0, 'no status file yet vouched');
    write({ state: 'up', pid: pid + 14, capabilities: ['session-headers'] });
    assert.ok(remote.connectorCapabilities().has('session-headers'), 'CONTROL: not kept as nothing before the process wrote');
    await as(pid + 15); fs.writeFileSync(statusFile, '{"state":"up","pid":' + (pid + 15) + ',"capabilities":["session-hea');
    assert.equal(remote.connectorCapabilities().size, 0, 'a truncated status file vouched');
    // Started here, but no tunnel running now (crash backoff, a stop): nothing legitimate arrives, so nothing counts.
    reset({ runningPid: null });   // (it writes a status file that lists the capability)
    await warm();
    assert.equal(remote.connectorCapabilities().size, 0, 'with no tunnel running, the binary alone vouched');
    // The running process cannot widen the binary's answer: it only narrows.
    const no = path.join(SANDBOX, 'no-tunnel-6616');
    fs.writeFileSync(no, '#!/bin/sh\nexit 2\n', { mode: 0o755 });
    const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = no;
    try {
      reset({ runningPid: pid });
      await warm();
      write({ state: 'up', pid, capabilities: ['session-headers'] });
      assert.equal(remote.connectorCapabilities().size, 0, 'the status file widened a binary that says no');
    } finally { process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; }
  } finally { fs.rmSync(statusFile, { force: true }); reset(); await warm(); }
});

test('R01b: over HTTP, an older running tunnel refuses a fresh remote session though the binary says yes', async () => {
  const statusFile = STATUS;
  const pid = 424243;
  try {
    reset({ runningPid: pid });
    await warm();
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    fs.writeFileSync(statusFile, JSON.stringify({ state: 'up', pid }));
    const got = await post('/api/accounts/gemini/apikey', { ...VIA_PLUS, ...fresh() }, 'not json');
    assert.equal(got.status, 403, JSON.stringify(got.body));
    assert.equal(got.body.code, 'remote_step_up_unavailable');
    remote.resetConnectorCapabilitiesForTests({ runningPid: pid + 1, commandOf: () => null });   // a current tunnel
    await warm();
    fs.writeFileSync(statusFile, JSON.stringify({ state: 'up', pid: pid + 1, capabilities: ['session-headers'] }));
    const ok = await post('/api/accounts/gemini/apikey', { ...VIA_PLUS, ...fresh() }, 'not json');
    assert.equal(ok.status, 400, 'CONTROL: listed, the request passes the gate to the route: ' + JSON.stringify(ok.body));
  } finally { fs.rmSync(statusFile, { force: true }); reset(); await warm(); }
});

/* kosmos#6669 (R01c): a tunnel an earlier board left running writes this board's status file under its own pid. */
test('R01c: once this board\'s tunnel has said what it lists, a foreign write to the status file does not take it away', async () => {
  try {
    reset();
    await warm();
    assert.ok(remote.connectorCapabilities().has('session-headers'), 'CONTROL: the child listed it');
    listRunning({ state: 'restarting', pid: TEST_PID + 7, because: 'replaced by a newer connection' });   // the orphan writes
    assert.ok(remote.connectorCapabilities().has('session-headers'), 'one foreign write refused every gated action');
  } finally { reset(); await warm(); }
});

const { spawn: spawnProc, execFileSync } = require('node:child_process');
const ended = (pid) => new Promise((resolve) => remote.endForeignTunnel(pid, resolve));
// Alive and not a zombie (review 9: a zombie answers signal 0 where nothing reaps it).
const alive = (pid) => { try { return !/^Z/.test(execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim()); } catch { return false; } };
const ppidOf = (pid) => { try { return Number(execFileSync('/bin/ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim()); } catch { return null; } };
// A process ps shows as `<CONNECTOR> run --status-file <file> 30` (bash's exec -a names it; CONNECTOR's basename is
// kosmos-tunnel). orphan: double-forked, so its parent is 1, as a tunnel whose board was killed hard.
function fakeTunnel(file, { orphan, program = CONNECTOR }) {
  const name = program + ' run --status-file ' + file;
  if (!orphan) return { pid: spawnProc('/bin/bash', ['-c', 'exec -a "$0" sleep 30', name], { stdio: 'ignore' }).pid };
  const out = execFileSync('/bin/bash', ['-c', '(exec -a "$0" sleep 30) >/dev/null 2>&1 & echo $!', name], { encoding: 'utf8' });
  return { pid: Number(out.trim()) };
}

test('R01c: an orphaned tunnel is ended, read from the real process table; a live board\'s, a lookalike path\'s, are not', { skip: process.platform === 'win32' }, async (t) => {
  const orphan = fakeTunnel(STATUS, { orphan: true });
  const elsewhere = fakeTunnel(STATUS + '.elsewhere', { orphan: true });
  const liveBoards = fakeTunnel(STATUS, { orphan: false });   // a second LIVE board on this account: its parent lives
  const notTunnel = fakeTunnel(STATUS, { orphan: true, program: path.join(SANDBOX, 'other-program') });
  try {
    // Where a subreaper (systemd --user, a container init) takes orphans, their parent is not 1: production does not
    // end them there (stated), and this test cannot set its control up, so it is skipped, not failed (review 6).
    if (!await until(() => [orphan, elsewhere, notTunnel].every((p) => ppidOf(p.pid) === 1))) { t.skip('orphans are not re-parented to 1 here (a subreaper)'); return; }
    assert.notEqual(ppidOf(liveBoards.pid), 1, 'CONTROL: the live one has its parent');
    remote.resetConnectorCapabilitiesForTests({ runningPid: TEST_PID });   // real ps, no stand-in
    assert.equal(await ended(liveBoards.pid), false, 'a live board\'s tunnel was ended (two boards would kill each other)');
    assert.equal(await ended(elsewhere.pid), false, 'an orphan for another status file was ended');
    assert.equal(await ended(notTunnel.pid), false, 'another program with our arguments was ended');
    assert.ok(alive(liveBoards.pid) && alive(elsewhere.pid) && alive(notTunnel.pid), 'CONTROL: all three still running');
    assert.equal(await ended(orphan.pid), true, 'our orphan was not ended');
    assert.ok(await until(() => !alive(orphan.pid)), 'the orphan did not end');
  } finally {
    // Only a pid that is still this test's own fake (review 8: never signal a pid that may have been reused).
    for (const p of [orphan, elsewhere, liveBoards, notTunnel]) {
      let cmd = '';
      try { cmd = execFileSync('/bin/ps', ['-ww', '-o', 'command=', '-p', String(p.pid)], { encoding: 'utf8' }); } catch { /* gone */ }
      if (cmd.includes(' run --status-file ' + STATUS)) { try { process.kill(p.pid, 'SIGKILL'); } catch {} }
    }
    reset(); await warm();
  }
});

test('R01c: a pid outside 2..2^22, our own pid, and a failed ps are never signalled; a failed ps is asked again after 15 s', async () => {
  const asked = [];
  const killed = [];
  const realNow = Date.now;
  let skew = 0;
  try {
    Date.now = () => realNow() + skew;
    // An orphan by every other rule for the out-of-range and own pids, so only the guards stand between them and a kill.
    const orphanLine = { ppid: 1, command: CONNECTOR + ' run --status-file ' + STATUS };
    reset({ commandOf: (pid) => { asked.push(pid); return pid === 424299 ? undefined : orphanLine; }, kill: (pid) => killed.push(pid) });   // 424299: ps fails
    for (const pid of [0, -1, 1, 4194305, 2 ** 23, 1.5, process.pid]) assert.equal(await ended(pid), false, String(pid));
    assert.deepEqual(asked, [], 'an out-of-range pid, or our own, was looked up');
    await ended(4194304);
    assert.deepEqual(asked, [4194304], 'CONTROL: the top of the range is looked up');
    assert.deepEqual(killed, [4194304], 'CONTROL: the stand-in would have ended an in-range orphan');
    killed.length = 0;
    await ended(424299); await ended(424299);
    assert.deepEqual(asked.filter((x) => x === 424299), [424299], 'a failed ps was asked again at once (a ps fork per status read)');
    skew = 16 * 1000;
    await ended(424299);
    assert.deepEqual(asked.filter((x) => x === 424299), [424299, 424299], 'a failed ps was not asked again after 15 s');
    assert.deepEqual(killed, [], 'something was signalled');
  } finally { Date.now = realNow; reset(); await warm(); }
});

test('R01c: reading the status file is what notices it: a foreign pid there is judged, and a non-tunnel is left alone', async () => {
  const asked = [];
  const killed = [];
  const notTunnel = 424310;
  const orphan = 424311;
  try {
    reset({
      commandOf: (pid) => { asked.push(pid); return pid === orphan ? { ppid: 1, command: CONNECTOR + ' run --status-file ' + STATUS } : { ppid: 1, command: '/bin/sh -c sleep 30; true' }; },
      kill: (pid) => killed.push(pid),
    });
    await warm();
    listRunning({ state: 'up', pid: notTunnel });
    remote.connectorCapabilities();
    assert.deepEqual(asked, [notTunnel], 'the foreign pid in the status file was not judged');
    assert.deepEqual(killed, [], 'a process that is not our tunnel was signalled');   // (isOurTunnel: no ` run --status-file`)
    // Review 7: after this board's child's list is kept, the gated read still notices a foreign writer.
    listRunning();                                   // the child writes: its list is now kept
    assert.ok(remote.connectorCapabilities().has('session-headers'));
    listRunning({ state: 'restarting', pid: orphan }); // then an orphan writes
    assert.equal(remote.connectorCapabilities().size, 0, 'trusted while an orphan, being ended, may be the one forwarding (review 10)');
    assert.deepEqual(killed, [orphan], 'an orphan writing after the child\'s list was kept was not judged');
    // A foreign writer that is NOT an orphaned tunnel (here, not ours) is left alone and the kept list holds again.
    listRunning({ state: 'up', pid: notTunnel });
    assert.ok(remote.connectorCapabilities().has('session-headers'), 'a foreign writer to leave alone refused every gated action (review 3)');
  } finally { reset(); await warm(); }
});

test('R01c: a live board\'s tunnel and a gone pid are asked again after a minute; not-our-tunnel after an hour', async () => {
  const asked = [];
  let answer = null;
  const realNow = Date.now;
  let skew = 0;
  try {
    Date.now = () => realNow() + skew;
    const killed = [];
    reset({ commandOf: (pid) => { asked.push(pid); return answer; }, kill: (pid) => killed.push(pid) });
    const ours = CONNECTOR + ' run --status-file ' + STATUS;
    answer = { ppid: 4242, command: ours };   // a live board's
    await ended(424301); await ended(424301);
    assert.deepEqual(asked, [424301], 'asked again inside the minute');
    skew = 61 * 1000;
    answer = { ppid: 1, command: ours };      // its board died
    await ended(424301);
    assert.deepEqual(asked, [424301, 424301], 'an orphan judged earlier with a live parent was never asked again');
    assert.deepEqual(killed, [424301], 'CONTROL: the orphan was signalled (through the stand-in, never a real kill)');
    await ended(424301);   // still writing, at once: not asked, not signalled again (review 9: no TERM loop)
    assert.deepEqual(killed, [424301], 'an ended pid was signalled again inside the minute');
    assert.deepEqual(asked.filter((p) => p === 424301), [424301, 424301], 'an ended pid was asked again inside the minute');
    skew += 61 * 1000;
    await ended(424301);   // it ignored TERM and still writes: judged again after the minute
    assert.deepEqual(killed, [424301, 424301], 'a tunnel that ignored TERM was never judged again');
    answer = { ppid: 1, command: '/usr/bin/other run --status-file ' + STATUS };   // not our tunnel
    await ended(424302);
    skew = 10 * 60 * 1000;
    await ended(424302);
    assert.deepEqual(asked.filter((p) => p === 424302), [424302], 'not-our-tunnel was asked again inside the hour');
    skew += 61 * 60 * 1000;   // past the hour since it was judged
    await ended(424302);
    assert.deepEqual(asked.filter((p) => p === 424302), [424302, 424302], 'not-our-tunnel was kept past the hour (macOS pids wrap)');
    // A pid that is gone (ps: no such process) is asked again after a minute, not after the hour (review 8).
    answer = null;
    await ended(424303);
    skew += 61 * 1000;
    await ended(424303);
    assert.deepEqual(asked.filter((p) => p === 424303), [424303, 424303], 'a gone pid was kept as not-ours for the hour');
  } finally { Date.now = realNow; reset(); await warm(); }
});

/* The matching rules alone, with no process table: these run on every platform (review 6). */
test('R01c: isOrphanedTunnel matches only a re-parented `run` of the tunnel with this board\'s whole status-file path', () => {
  const f = '/a b/remote-status.json';
  const bin = '/x/kosmos-tunnel';
  const is = (ppid, command) => remote.isOrphanedTunnel({ ppid, command }, f, bin);
  assert.equal(remote.isOrphanedTunnel({ ppid: 1, command: '/Apps With Space/kosmos-tunnel run --status-file ' + f + ' --relay r' }, f, '/Apps With Space/kosmos-tunnel'), true, 'CONTROL: BIN() itself, spaces and all');
  assert.equal(is(1, '/Apps With Space/kosmos-tunnel run --status-file ' + f), false, 'a spaced line that is not BIN()');
  assert.equal(is(1, 'vim /y/kosmos-tunnel run --status-file ' + f), false, 'a wrapper or editor line');
  assert.equal(is(1, '/y/kosmos-tunnel run --status-file ' + f), true, 'CONTROL: at the end of the line');
  assert.equal(is(4242, '/y/kosmos-tunnel run --status-file ' + f), false, 'a live parent');
  assert.equal(is(1, '/y/kosmos-tunnel run --status-file ' + f + '.elsewhere'), false, 'a lookalike path');
  assert.equal(is(1, '/y/other run --status-file ' + f), false, 'another program');
  assert.equal(is(1, '/y/kosmos-tunnel devices --status-file ' + f), false, 'not run');
  assert.equal(is(1, '/y/kosmos-tunnel run --status-file /a b/remote-statusXjson'), false, 'a regex-special path char matched loosely');
  assert.equal(is(1, '/y/kosmos-tunnel run --status-file ' + f + '\nother run --status-file ' + f), true, 'CONTROL: first line only');
  assert.equal(is(1, 'x\n/y/kosmos-tunnel run --status-file ' + f), false, 'a second line was read');
  assert.equal(remote.isOrphanedTunnel(null, f, bin), false);
});
