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
test.afterEach(() => { notify.setSender(null); fs.rmSync(notify.FILE, { force: true }); });

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
  assert.deepEqual(Object.keys(sent[0].body).sort(), ['agent', 'at', 'installId', 'kind', 'project']);
  assert.equal(sent[0].body.kind, 'posted');
  assert.equal(sent[0].body.agent, 'Leo');
  assert.equal(sent[0].body.project, 'Henderson lease');
  assert.ok(!JSON.stringify(sent[0].body).includes('secret'), 'the words left the Mac: ' + JSON.stringify(sent[0].body));
  assert.equal(sent[1].body.project, null, 'a reply has no project and must say so, not omit it');
  assert.match(sent[0].url, /^https:\/\/installkosmos\.com\/api\/happened$/);
  assert.match(sent[0].body.installId, /^[0-9a-f-]{36}$/);
});

test('CONTROL: with no injected sender under test, nothing is sent even when on (the send path cannot reach the internet from the suite)', async () => {
  notify.setOn(true);
  notify.setSender(null);
  /* No fetch is reachable here; if the guard were missing this would try the
     real endpoint. Prove the guard by overriding fetch and counting. */
  const had = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return { ok: true }; };
  try {
    notify.happened({ kind: 'posted', agent: 'Leo', project: 'x' });
    await new Promise((r) => setTimeout(r, 10));
  } finally { global.fetch = had; }
  assert.equal(calls, 0, 'the suite reached for the network');
});

test('the Settings copy says what the payload carries and nothing it does not', () => {
  const page = fs.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const at = page.indexOf('id="notify-row"');
  const row = page.slice(at, page.indexOf('id="notify-msg"', at));
  assert.match(row, /Off by default/);
  assert.match(row, /which agent, whether it posted or answered, which project, and when/);
  assert.match(row, /Never the words/);
  assert.match(page, /\/api\/notify-setting/, 'the switch is not wired to its route');
});
