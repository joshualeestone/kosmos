'use strict';
/**
 * The TRANSMIT half of the daily product-feedback loop (kosmos#2037): the
 * separate, gated send layer over engine/feedback.js. Sending is off by default
 * (the switch); the local write is always on (feedback.js, tested there). What
 * leaves the machine is scrubbed of home paths and matches the #2246 collect
 * contract exactly. Sandboxed data root before the require.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-feedbacksend-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const feedback = require('./feedback');
const feedbacksend = require('./feedbacksend');

function fresh() {
  try { fs.rmSync(feedbacksend.FILE, { force: true }); } catch { /* absent is fine */ }
  try { fs.rmSync(feedback.dir(), { recursive: true, force: true }); } catch { /* absent is fine */ }
  feedbacksend.setSender(null);
}
test.beforeEach(fresh);
test.afterEach(() => feedbacksend.setSender(null));

test('the setting file lands under the sandboxed data root, so the tests are isolated', () => {
  assert.ok(feedbacksend.FILE.startsWith(SANDBOX), `${feedbacksend.FILE} not under ${SANDBOX}`);
});

test('OFF by default: an install nobody has asked sends nothing', () => {
  // No setting file at all -> fails to off. This is the #2020 half: a phone-home
  // must not default on until its control ships (default+control land together).
  assert.equal(feedbacksend.read().on, false);
});

test('an unreadable setting fails to OFF, not on', () => {
  // A directory where the file should be is unreadable-as-JSON: must read off,
  // because the only thing gated here is data leaving the machine.
  fs.mkdirSync(nodePath.dirname(feedbacksend.FILE), { recursive: true });
  fs.writeFileSync(feedbacksend.FILE, 'not json{');
  assert.equal(feedbacksend.read().on, false);
});

test('setOn round-trips, and rejects a non-boolean', () => {
  assert.deepEqual(feedbacksend.setOn(true), { ok: true });
  assert.equal(feedbacksend.read().on, true);
  assert.deepEqual(feedbacksend.setOn(false), { ok: true });
  assert.equal(feedbacksend.read().on, false);
  assert.equal(feedbacksend.setOn('yes').ok, false, 'a non-boolean was accepted');
});

test('scrub rewrites this machine\'s home and any /Users/<name> to ~', () => {
  const home = os.homedir();
  assert.equal(feedbacksend.scrub(home + '/work/x'), '~/work/x');
  assert.equal(feedbacksend.scrub('see /Users/someoneelse/notes/a.md here'),
    'see ~/notes/a.md here');
  assert.equal(feedbacksend.scrub(null), '');
});

test('payload matches the #2246 collect contract exactly, with a scrubbed body', () => {
  feedback.write('the + button did nothing at /Users/someagent/proj', { date: '2026-09-04' });
  const p = feedbacksend.payload('2026-09-04');
  assert.deepEqual(Object.keys(p).sort(),
    ['body', 'consent', 'date', 'generated_at', 'install']);
  assert.equal(p.date, '2026-09-04');
  assert.ok(typeof p.install === 'string' && p.install.length > 0);
  assert.match(p.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(p.consent).sort(), ['given', 'version']);
  assert.equal(p.consent.given, true);
  assert.equal(p.consent.version, feedbacksend.CONSENT_VERSION);
  // The body is scrubbed: no /Users/<name> survives.
  assert.ok(!/\/Users\//.test(p.body), 'an account path leaked into the sent body');
  assert.ok(p.body.includes('the + button did nothing'), 'the finding text was lost');
});

test('generated_at is taken from the report frontmatter, not recomputed', () => {
  // Write the report file directly with a DISTINCTIVE PAST timestamp, so a
  // fallback to new Date() would differ by years, not a 1ms race that can pass
  // by luck. This is what makes the test a real guard on generatedAt().
  const stamped = '2020-01-02T03:04:05.678Z';
  fs.mkdirSync(feedback.dir(), { recursive: true });
  fs.writeFileSync(feedback.pathFor('2026-09-04'),
    `---\ndate: 2026-09-04\ninstall: test\ngenerated_at: ${stamped}\n---\nbody\n`);
  assert.equal(feedbacksend.payload('2026-09-04').generated_at, stamped);
});

test('payload is null when there is no report for that day (nothing to send)', () => {
  assert.equal(feedbacksend.payload('2026-01-01'), null);
});

test('maybeSend does NOTHING while the opt-in is off', () => {
  feedback.write('body', { date: '2026-09-04' });
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve(); });
  feedbacksend.maybeSend('2026-09-04');
  assert.equal(calls, 0, 'a send happened with the opt-in off');
});

test('maybeSend POSTs the contract payload as JSON once opted in', () => {
  feedback.write('a finding', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  let seen = null;
  feedbacksend.setSender((url, init) => { seen = { url, init }; return Promise.resolve(); });
  feedbacksend.maybeSend('2026-09-04');
  assert.equal(seen.url, feedbacksend.DEFAULT_ENDPOINT);
  assert.equal(seen.init.method, 'POST');
  assert.match(seen.init.headers['content-type'], /application\/json/);
  assert.deepEqual(Object.keys(JSON.parse(seen.init.body)).sort(),
    ['body', 'consent', 'date', 'generated_at', 'install']);
  assert.ok(seen.init.signal, 'the request has no timeout');
});

test('maybeSend does nothing when there is no report, even opted in', () => {
  feedbacksend.setOn(true);
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve(); });
  feedbacksend.maybeSend('2026-01-01');
  assert.equal(calls, 0, 'a send happened with no report to send');
});

test('the endpoint is overridable by env, like the ping seam', () => {
  feedback.write('body', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  const prev = process.env.AGENT_WORKFORCE_FEEDBACK_URL;
  process.env.AGENT_WORKFORCE_FEEDBACK_URL = 'https://example.test/collect';
  try {
    let seen = null;
    feedbacksend.setSender((url) => { seen = url; return Promise.resolve(); });
    feedbacksend.maybeSend('2026-09-04');
    assert.equal(seen, 'https://example.test/collect');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_FEEDBACK_URL;
    else process.env.AGENT_WORKFORCE_FEEDBACK_URL = prev;
  }
});

test('a test run never reaches the real network', () => {
  // The ping.js guard, mirrored: with no injected sender, underTest() must
  // stop maybeSend before it touches global fetch -- or a `yarn test` run would
  // POST real reports to the collector.
  feedback.write('body', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  assert.equal(feedbacksend.underTest(), true, 'the runner signal is gone, so this test proves nothing');
  feedbacksend.setSender(null);
  let reached = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { reached += 1; return Promise.resolve(); };
  try {
    feedbacksend.maybeSend('2026-09-04');
    assert.equal(reached, 0, 'a test run reached the network');
  } finally {
    globalThis.fetch = realFetch;
  }
});
