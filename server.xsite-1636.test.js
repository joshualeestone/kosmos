'use strict';
/**
 * #1636: `GET /api/connections` refuses a cross-site read BEFORE it sweeps any door.
 *
 * 🛑 THE STATUS CODE IS A PROXY; THE DOOR IS THE HARM. A page the person merely
 * visits can `fetch()` this in a loop. It learns nothing - CORS makes the response
 * opaque and the Host guard closes DNS rebinding - but the side effects still run,
 * and this route sweeps every metered token door, several of which (Brave Search,
 * Exa, Tavily, Serper) meter against the person's own paid quota.
 * ⇒ So every assertion below counts DOOR VERIFIES, not response codes. A 403 that
 * still swept is not a refusal, and a test that only read the code could not tell
 * those apart.
 *
 * 📌 `engine/inflight.js` (#1618) is not a defence and was never meant to be: it
 * collapses CONCURRENT callers, and a loop of sequential fetches is not concurrent.
 * The sequential arm below is what says so out loud.
 *
 *   node --test server.xsite-1636.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-xsite-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const tokendoors = require('./engine/tokendoors');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const TOKEN = 'hetzner-token-long-enough-to-be-real-0123456789';

/* A door whose verifier counts entries. A HELD token is what makes the door reach
   its verifier at all: with none, `state()` returns early on "not connected" and
   every count below would be zero for the wrong reason. */
function countingDoor() {
  const door = tokendoors.byName('Hetzner');
  let verifies = 0;
  door.setFetcher(async () => { verifies += 1; return { ok: true, status: 200, body: { server: { id: 1 } } }; });
  return { door, verifies: () => verifies, restore: () => door.setFetcher(null) };
}

const get = (headers) => fetch(base + '/api/connections', { headers: headers || {} });

test('#1636: a cross-site read is refused AND sweeps no door', async () => {
  const d = countingDoor();
  try {
    await d.door.connect(TOKEN);
    const armed = d.verifies();
    assert.ok(armed >= 1, 'the fixture never reached the verifier, so a count of zero below would prove nothing');

    const res = await get({ 'sec-fetch-site': 'cross-site' });
    assert.equal(res.status, 403, 'a cross-site read was answered rather than refused');

    /* 🛑 THE ASSERTION THAT MATTERS. The status code above is a proxy; this is the
       cost. If the guard were placed after the sweep, the code would still be 403
       and this number would have moved. */
    assert.equal(d.verifies(), armed,
      'the refused request still swept the doors, so the money was still spent and the 403 refused only the answer');
  } finally { d.restore(); await d.door.forget().catch(() => {}); }
});

test('#1636: a foreign referer is refused and sweeps no door either', async () => {
  const d = countingDoor();
  try {
    await d.door.connect(TOKEN);
    const armed = d.verifies();
    const res = await get({ referer: 'https://evil.example/page' });
    assert.equal(res.status, 403);
    assert.equal(d.verifies(), armed, 'a foreign-referer request still swept the doors');
  } finally { d.restore(); await d.door.forget().catch(() => {}); }
});

/* 🛑 A LOOP IS THE ACTUAL ATTACK, AND #1618's COLLAPSE DOES NOT TOUCH IT. Sequential
   fetches are not concurrent, so the in-flight share holds nothing between them.
   Without the guard this is N sweeps for N requests. */
test('#1636: a LOOP of cross-site reads sweeps nothing, which is the shape of the attack', async () => {
  const d = countingDoor();
  try {
    await d.door.connect(TOKEN);
    const armed = d.verifies();
    for (let i = 0; i < 5; i += 1) {
      const res = await get({ 'sec-fetch-site': 'cross-site' });
      assert.equal(res.status, 403);
    }
    assert.equal(d.verifies(), armed, 'a loop of refused reads still cost five sweeps');
  } finally { d.restore(); await d.door.forget().catch(() => {}); }
});

/* 🛑 THE COVERAGE HALF, WHICH THE CARD EXPLICITLY REFUSED TO ASSUME. The three
   sibling routes already carrying this guard do NOT establish that THIS one's real
   caller still passes, because none of them is what the Connections screen reads.
   These are the headers a same-origin `fetch()` from the board actually sends. */
test('#1636: the board\'s own same-origin read still passes, and DOES sweep', async () => {
  const d = countingDoor();
  try {
    await d.door.connect(TOKEN);
    const armed = d.verifies();
    const res = await get({ 'sec-fetch-site': 'same-origin', referer: base + '/' });
    assert.equal(res.status, 200, 'the guard refuses the board itself, which would break the Connections screen');
    const body = await res.json();
    assert.ok(body.doors && body.doors['/api/svc/hetzner'], 'the shelf came back without its doors');
    assert.ok(d.verifies() > armed,
      'the same-origin read did not reach the doors, so this arm is not exercising the path the screen uses');
  } finally { d.restore(); await d.door.forget().catch(() => {}); }
});

test('#1636: a header-less client (curl, an old browser) still passes', async () => {
  const res = await get({});
  assert.equal(res.status, 200,
    'the guard now refuses a request with no browser signal, which is the person rather than the drive-by');
});

/* The caller is same-origin BY CONSTRUCTION, not by luck: a plain relative-URL
   fetch with no `mode`/`credentials` gymnastics. If this ever grows a cross-origin
   form, the arm above stops describing the real caller. */
test('#1636: the page reads this route with a plain same-origin fetch', () => {
  const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const m = PAGE.match(/fetch\('\/api\/connections'[^)]*\)/);
  assert.ok(m, 'the Connections screen no longer fetches this route, or does so in a shape this pin cannot read');
  assert.doesNotMatch(m[0], /mode:\s*'no-cors'/, 'the screen reads its own route as no-cors, which would strip the same-origin signal');
  assert.doesNotMatch(m[0], /https?:\/\//, 'the screen reads this route by absolute URL, which can make it cross-origin');
});
