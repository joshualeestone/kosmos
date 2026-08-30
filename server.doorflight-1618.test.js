'use strict';
/**
 * #1618, doors half: the Connections shelf is read once however many callers ask
 * at once, and a mutator still observes its OWN write.
 *
 * The accounts half landed in #1630. This is the other three costs the card
 * names - `gh auth status`, `vercel whoami`, and a live Cloudflare request -
 * which live on `GET /api/connections`, a different handler.
 *
 * 🛑 THE SECOND TEST IS THE ONE THAT MATTERS AND IT IS NOT ABOUT PERFORMANCE.
 * Both door shapes end `connect()` and `forget()` by calling their own `state()`
 * to answer with what they just did. Collapsing `state()` INSIDE the doors would
 * let a mutator share a read that started before its write, so a person who had
 * just connected would be told they were not connected by the very request that
 * connected them. The collapse is therefore on the shelf, not on `state()`, and
 * the test below is what holds that line.
 *
 *   node --test server.doorflight-1618.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-doorflight-'));
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

/* A door whose verifier counts entries and can be HELD OPEN ON DEMAND.
   ⚠️ The gate is armed explicitly rather than from the start. My first version
   gated every call, so the `connect()` that sets the fixture up blocked on a gate
   nothing had released yet and the file hung until the runner killed it. Setup
   must run ungated; only the concurrent phase is held. */
function heldDoor(name) {
  const door = tokendoors.byName(name);
  let entries = 0;
  let gate = null;
  let release = null;
  door.setFetcher(async () => {
    entries += 1;
    if (gate) await gate;
    return { ok: true, status: 200, body: { server: { id: 1 } } };
  });
  return {
    door,
    entries: () => entries,
    arm() { gate = new Promise((r) => { release = r; }); },
    /* Stop blocking NEW calls while leaving the already-blocked one blocked. The
       awaiting call captured the promise object, so clearing the slot cannot
       affect it. This is what lets a mutator run ungated while a shelf read is
       genuinely still in flight - without it the gate blocks the mutator too and
       the file hangs. */
    unarm() { gate = null; },
    release() { if (release) { release(); release = null; } gate = null; },
    restore: () => door.setFetcher(null),
  };
}

const TOKEN = 'hetzner-token-long-enough-to-be-real-0123456789';

test('#1618: two callers asking for the shelf at once verify each door ONCE', async () => {
  const h = heldDoor('Hetzner');
  try {
    /* A held token, so the door actually reaches its verifier rather than
       short-circuiting on "no token, not connected". Ungated, or this blocks. */
    const c = await h.door.connect(TOKEN);
    assert.equal(c.connected, true, 'the fixture failed to connect the door, so the shelf never reaches a verifier');
    const afterConnect = h.entries();
    assert.ok(afterConnect >= 1, 'connect() never reached the verifier, so the counter below measures nothing');

    h.arm();
    const a = fetch(base + '/api/connections').then((r) => r.json());
    const b = fetch(base + '/api/connections').then((r) => r.json());
    await new Promise((r) => setTimeout(r, 150));
    const during = h.entries() - afterConnect;
    assert.equal(during, 1,
      `the shelf verified this door ${during} times for two concurrent callers, so the reads were not shared`);

    h.release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.doors['/api/svc/hetzner'].connected, true);
    assert.deepEqual(Object.keys(ra.doors).sort(), Object.keys(rb.doors).sort(),
      'the two callers were handed different shelves');
  } finally { h.restore(); await h.door.forget().catch(() => {}); }
});

/* 🛑 THE BOUNDARY, AND IT IS BUILT AROUND `forget()` SO THAT IT CAN ACTUALLY FAIL.
   Both door shapes end their mutators by calling their own `state()`. If `state()`
   were collapsed rather than the shelf, a mutator running while a shelf read was in
   flight would share that read and answer with the world from before its write.
   ⚠️ `connect()` cannot demonstrate it: the pre-write and post-write answers are
   both `connected: true` when the door already holds a token, and it needs to hold
   one for the shelf read to reach a verifier at all. `forget()` inverts the answer,
   so a shared pre-write read says `true` where the truth is `false`. */
test('#1618: forget() observes its OWN write while a shelf read is in flight', async () => {
  const h = heldDoor('Hetzner');
  try {
    const c = await h.door.connect(TOKEN);
    assert.equal(c.connected, true, 'the fixture failed to connect the door');

    h.arm();
    const inFlight = fetch(base + '/api/connections').then((r) => r.json());
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(h.entries() >= 2, 'the shelf read never reached the verifier, so nothing is in flight and this test proves nothing');
    h.unarm();

    const gone = await h.door.forget();
    assert.equal(gone.connected, false,
      'forget() was answered from a read that began before its write, so the door reports connected after being forgotten');

    h.release();
    await inFlight;
  } finally { h.restore(); await h.door.forget().catch(() => {}); }
});

test('#1618: a shelf read after the previous one settles is fresh, not cached', async () => {
  const h = heldDoor('Hetzner');
  try {
    const c = await h.door.connect(TOKEN);
    assert.equal(c.connected, true, 'the fixture failed to connect the door');
    const base1 = h.entries();

    await fetch(base + '/api/connections').then((r) => r.json());
    const afterFirst = h.entries();
    assert.ok(afterFirst > base1, 'the first shelf read never reached the verifier, so this test cannot see a second');

    await fetch(base + '/api/connections').then((r) => r.json());
    assert.ok(h.entries() > afterFirst,
      'the second shelf read reused the first answer, so this is a cache and it will turn could-not-check into a confident not-connected');
  } finally { h.restore(); await h.door.forget().catch(() => {}); }
});

/* The three-state rule on the shelf: a door whose verifier throws is
   could-not-check (null), never a confident not-connected (false). Asserted with
   two concurrent callers, so the sharing cannot be what reintroduces it.
   ⚠️ The door must be CONNECTED first, through a working fetcher: with no token
   `state()` returns early and never reaches the verifier, so a throwing fetcher
   would never be called and this would assert `false === null` about a door that
   was simply empty. That is how the first draft of this test failed. */
test('#1618: a door whose check throws is null for BOTH sharers, never false', async () => {
  const door = tokendoors.byName('Hetzner');
  try {
    door.setFetcher(async () => ({ ok: true, status: 200, body: { server: { id: 1 } } }));
    const c = await door.connect(TOKEN);
    assert.equal(c.connected, true, 'the fixture failed to connect the door, so the throwing arm below is aimed at an empty door');

    door.setFetcher(async () => { throw new Error('the verifier died'); });
    const [ra, rb] = await Promise.all([
      fetch(base + '/api/connections').then((r) => r.json()),
      fetch(base + '/api/connections').then((r) => r.json()),
    ]);
    for (const [who, got] of [['first', ra], ['second', rb]]) {
      const st = got.doors['/api/svc/hetzner'];
      assert.equal(st.connected, null, `the ${who} caller was told a confident answer for a door we could not check`);
    }
  } finally { door.setFetcher(null); await door.forget().catch(() => {}); }
});
