'use strict';
/**
 * The outbound "something happened" call: off by default, never the words,
 * never sent under test without an injected sender, and the closed list of
 * kinds. Sandboxed data root before the require.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-notify-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const notify = require('./notify');

function capture() {
  const sent = [];
  notify.setSender(async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true }; });
  return sent;
}
// Captures the whole init, headers included, for the #462 auth-header tests.
function captureInit() {
  const sent = [];
  notify.setSender(async (url, init) => { sent.push({ url, init }); return { ok: true }; });
  return sent;
}
test.afterEach(() => {
  notify.setSender(null);
  fs.rmSync(notify.FILE, { force: true });
  delete process.env.AGENT_WORKFORCE_NOTIFY_TOKEN;
});

test('#462: the notify token rides as x-kosmos-notify-token when one is configured', async () => {
  process.env.AGENT_WORKFORCE_NOTIFY_TOKEN = 'notif-abc123';
  const sent = captureInit();
  notify.setOn(true);
  notify.happened({ kind: 'posted', agent: 'Leo', project: 'Lease' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].init.headers['x-kosmos-notify-token'], 'notif-abc123',
    'the notify token was not sent as its header');
  assert.equal(sent[0].init.headers['content-type'], 'application/json',
    'the content-type header was lost when the token was added');
});

test('#462: no token configured means no auth header, byte-for-byte as before', async () => {
  const sent = captureInit();
  notify.setOn(true);
  notify.happened({ kind: 'replied', agent: 'April' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 1);
  assert.ok(!('x-kosmos-notify-token' in sent[0].init.headers),
    'an auth header appeared with no token configured, which changes the request against our own endpoint');
  assert.deepEqual(Object.keys(sent[0].init.headers), ['content-type'],
    'a request with no token must carry exactly the header it carried before #462');
});

test('off by default: nothing is sent until somebody turns it on, and a bad value is refused in words', async () => {
  const sent = capture();
  assert.equal(notify.read().on, false);
  notify.happened({ kind: 'posted', agent: 'Leo', project: 'Lease' });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(sent, [], 'sent while off');
  assert.match(notify.setOn('yes').because, /on or off/);
  assert.equal(notify.setOn(true).ok, true);
  assert.equal(notify.read().on, true);
});

test('what leaves the Mac is who, what, which project and when; never the words, and never an unknown kind', async () => {
  const sent = capture();
  notify.setOn(true);
  notify.happened({ kind: 'posted', agent: 'Leo', project: 'Henderson lease', text: 'the secret words', words: 'more secrets' });
  notify.happened({ kind: 'replied', agent: 'April' });
  notify.happened({ kind: 'typed', agent: 'Mikey' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 2, 'an unknown kind was sent, or a known one was not');
  assert.deepEqual(Object.keys(sent[0].body).sort(), ['agent', 'at', 'id', 'installId', 'kind', 'project', 'session']);
  assert.equal(sent[0].body.id, null, 'an event with no key must say null, not omit it');
  assert.equal(sent[0].body.kind, 'posted');
  assert.equal(sent[0].body.agent, 'Leo');
  assert.equal(sent[0].body.project, 'Henderson lease');
  assert.ok(!JSON.stringify(sent[0].body).includes('secret'), 'the words left the Mac: ' + JSON.stringify(sent[0].body));
  assert.equal(sent[1].body.project, null, 'a reply has no project and must say so, not omit it');
  assert.match(sent[0].url, /^https:\/\/installkosmos\.com\/api\/happened$/);
  assert.match(sent[0].body.installId, /^[0-9a-f-]{36}$/);
});

test('CONTROL: with no injected sender under test, nothing is sent even when on, and the guard is what stops it', async () => {
  notify.setOn(true);
  notify.setSender(null);
  const had = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return { ok: true }; };
  const ctx = process.env.NODE_TEST_CONTEXT;
  try {
    /* The positive half first: with the under-test mark removed, the same
       call reaches the (overridden) fetch exactly once. Without this, a
       fetch captured at module load would pass the negative half green. */
    delete process.env.NODE_TEST_CONTEXT;
    notify.happened({ kind: 'posted', agent: 'Leo', project: 'x' });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1, 'with the guard lifted the send did not reach fetch, so the negative half below proves nothing');
    process.env.NODE_TEST_CONTEXT = ctx || 'child';
    notify.happened({ kind: 'posted', agent: 'Leo', project: 'x' });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1, 'the suite reached for the network');
  } finally {
    global.fetch = had;
    if (ctx === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = ctx;
  }
});

test('the Settings copy says what the payload carries and nothing it does not', () => {
  const page = fs.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const at = page.indexOf('id="notify-row"');
  const row = page.slice(at, page.indexOf('id="notify-msg"', at));
  assert.match(row, /Off by default/);
  /* Derived from the payload's keys, so a field added to the payload and not
     to the copy fails here rather than shipping unsaid. */
  const keys = Object.keys(notify.payload({ kind: 'posted', agent: 'x', project: 'y' }));
  const said = { agent: /which agent/, kind: /whether it posted or answered/, project: /which project/, at: /when/, installId: /random ID for this install/, id: /one small message each time/i, session: /which agent/ };
  for (const k of keys) { assert.ok(said[k], 'the payload carries `' + k + '` and the copy has no phrase for it'); assert.match(row, said[k], 'the copy does not say `' + k + '`'); }
  assert.match(row, /Never the words/);
  assert.match(page, /\/api\/notify-setting/, 'the switch is not wired to its route');
});
