'use strict';
/**
 * The TRANSMIT half of the daily product-feedback loop (kosmos#2037): the
 * separate, gated send layer over engine/feedback.js. Sending is ON by default
 * (Josh: "baked in day one"), with the Settings switch as the opt-out; the local
 * write is always on (feedback.js, tested there). What leaves the machine is
 * scrubbed of home paths and matches the #2246 collect contract exactly.
 * Sandboxed data root before the require.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-feedbacksend-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
// #2037 revision: scrub() now enumerates worker folders, so the workers root
// must be sandboxed too or the tests would read the real ~/work/workers.
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
const feedback = require('./feedback');
const feedbacksend = require('./feedbacksend');
const store = require('./store');
const projects = require('./projects');

function fresh() {
  try { fs.rmSync(feedbacksend.FILE, { force: true }); } catch { /* absent is fine */ }
  try { fs.rmSync(feedback.dir(), { recursive: true, force: true }); } catch { /* absent is fine */ }
  // #2037 revision: reset the identifying-name sources so a name written by one
  // scrub test cannot leak into another's exact-equality assertions.
  try { fs.rmSync(store.PROFILES, { recursive: true, force: true }); } catch { /* absent is fine */ }
  try { fs.rmSync(projects.file(), { force: true }); } catch { /* absent is fine */ }
  try { fs.rmSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true, force: true }); } catch { /* absent is fine */ }
  feedbacksend.setSender(null);
}
test.beforeEach(fresh);
test.afterEach(() => feedbacksend.setSender(null));

test('the setting file lands under the sandboxed data root, so the tests are isolated', () => {
  assert.ok(feedbacksend.FILE.startsWith(SANDBOX), `${feedbacksend.FILE} not under ${SANDBOX}`);
});

test('ON by default: a never-asked machine has the daily report opt-in on', () => {
  // No setting file at all -> ON. Josh's ruling (#2037/#2013, 2026-09-05): the
  // daily report is "baked in day one", a default-checked opt-in, with the
  // Settings switch as the opt-out (and its disclosure copy). The control ships
  // WITH the default (default+control land together), which is why this flip is
  // in the same PR as the Settings switch and the board trigger.
  assert.equal(feedbacksend.read().on, true);
});

test('an unreadable setting still fails to OFF, not on (unlike the never-asked default)', () => {
  // A present-but-unparseable settings file (invalid JSON) must read off, even
  // though a never-asked machine defaults ON: a corrupt file could be hiding an
  // off we cannot see, and the only thing gated here is a report body leaving
  // the machine. The never-asked default (on) and the unreadable case (off) are
  // deliberately different, same split as ping.js.
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

test('scrub covers OTHER accounts (/home/<name>) with a boundary, no prefix corruption', () => {
  // Every account, not just this machine's -- a report can quote another
  // agent's path. And a bounded match: /home/jo must not eat into /home/joanna
  // (the unbounded-substring bug that would leave a leaked "anna" fragment).
  assert.equal(feedbacksend.scrub('/home/joanna/notes.md'), '~/notes.md');
  assert.equal(feedbacksend.scrub('a /home/jo b /home/joanna/x'), 'a ~ b ~/x');
  assert.equal(feedbacksend.scrub('/Users/alice and /Users/alicia/x'), '~ and ~/x');
});

test('scrub covers Windows account homes (C:\\Users\\name), backslash-bound', () => {
  // store.js has a real win32 branch, so Windows is a supported target; a
  // backslash home path must be redacted too or an account name leaks.
  assert.equal(feedbacksend.scrub('C:\\Users\\joe\\proj\\a.md'), '~\\proj\\a.md');
  assert.equal(feedbacksend.scrub('quote C:\\Users\\jane\\secret here'), 'quote ~\\secret here');
  assert.ok(!/:\\Users\\/.test(feedbacksend.scrub('D:\\Users\\bob\\x')), 'a Windows account name leaked');
});

test('scrub is case-insensitive (macOS + Windows filesystems are)', () => {
  // A body can quote a real path in any case on a case-insensitive FS; a
  // case-sensitive guard would leak the account name.
  assert.equal(feedbacksend.scrub('/users/joe/x'), '~/x');
  assert.equal(feedbacksend.scrub('c:\\users\\joe\\x'), '~\\x');
  assert.equal(feedbacksend.scrub('C:\\USERS\\JOE\\x'), '~\\x');
  assert.ok(!/users\\/i.test(feedbacksend.scrub('c:\\Users\\joe\\proj')), 'a lower-case Windows account name leaked');
});

test('scrub covers an exotic own-home (custom $HOME) with a boundary - the fallback branch', () => {
  // On a standard mac/Linux box os.homedir() matches the generic /Users|/home
  // arm, so the own-home fallback (the sole de-identifier for an exotic home
  // like /var/root or a custom $HOME) is otherwise never executed. Force it:
  // node's os.homedir() honors $HOME on POSIX.
  const orig = process.env.HOME;
  process.env.HOME = '/opt/exotic-home';
  try {
    assert.equal(feedbacksend.scrub('/opt/exotic-home/work/x'), '~/work/x');
    // A home that PREFIXES another dir must NOT be half-rewritten (the bounded
    // lookahead is the whole point of this branch).
    assert.equal(feedbacksend.scrub('/opt/exotic-home-extra/y'), '/opt/exotic-home-extra/y');
    assert.equal(feedbacksend.scrub('at /opt/exotic-home end'), 'at ~ end');
  } finally {
    if (orig === undefined) delete process.env.HOME; else process.env.HOME = orig;
  }
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
  feedbacksend.setOn(false); // default is ON now, so turn it off explicitly to test the off-gate
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
  // #4253: run-tests.sh points AGENT_WORKFORCE_FEEDBACK_URL at a dead local port, so
  // pinning the DEFAULT needs the override cleared for this one send.
  const prevUrl = process.env.AGENT_WORKFORCE_FEEDBACK_URL;
  delete process.env.AGENT_WORKFORCE_FEEDBACK_URL;
  try { feedbacksend.maybeSend('2026-09-04'); }
  finally { if (prevUrl !== undefined) process.env.AGENT_WORKFORCE_FEEDBACK_URL = prevUrl; }
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

/* sendDailyOnce: the board-sweep entry point with once-per-day dedup (#2037 PR-C1). */

test('sendDailyOnce sends a day\'s report exactly once, even called repeatedly', () => {
  feedback.write('a finding', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve(); });
  feedbacksend.sendDailyOnce('2026-09-04');
  feedbacksend.sendDailyOnce('2026-09-04');
  feedbacksend.sendDailyOnce('2026-09-04');
  assert.equal(calls, 1, 'the daily report was sent more than once');
  assert.equal(feedbacksend.read().sent, '2026-09-04', 'the sent marker was not recorded');
});

test('sendDailyOnce sends nothing when the opt-in is turned off', () => {
  feedback.write('body', { date: '2026-09-04' });
  feedbacksend.setOn(false); // the default is ON now, so turn it OFF explicitly to test the off-gate
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve(); });
  feedbacksend.sendDailyOnce('2026-09-04');
  assert.equal(calls, 0, 'an off setting still sent');
  assert.equal(feedbacksend.read().sent, null, 'an off setting recorded a sent marker');
});

test('sendDailyOnce sends again on a NEW day (the dedup is per-day, not forever)', () => {
  feedback.write('day one', { date: '2026-09-04' });
  feedback.write('day two', { date: '2026-09-05' });
  feedbacksend.setOn(true);
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve(); });
  feedbacksend.sendDailyOnce('2026-09-04');
  feedbacksend.sendDailyOnce('2026-09-04'); // same day, deduped
  feedbacksend.sendDailyOnce('2026-09-05'); // new day, sends
  assert.equal(calls, 2, 'the per-day dedup either blocked the new day or failed to block the repeat');
  assert.equal(feedbacksend.read().sent, '2026-09-05', 'the sent marker did not advance to the new day');
});

test('sendDailyOnce with no report for the day marks nothing and sends nothing', () => {
  feedbacksend.setOn(true);
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve(); });
  feedbacksend.sendDailyOnce('2026-01-01'); // no report on that date
  assert.equal(calls, 0, 'a day with no report still sent');
  assert.equal(feedbacksend.read().sent, null, 'a day with no report recorded a sent marker (would block a real report later)');
});

test('setOn does not wipe the sent marker, and markSent does not flip on', () => {
  feedback.write('body', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  feedbacksend.markSent('2026-09-04');
  feedbacksend.setOn(false);
  assert.equal(feedbacksend.read().sent, '2026-09-04', 'toggling the switch wiped the dedup marker');
  feedbacksend.markSent('2026-09-05');
  assert.equal(feedbacksend.read().on, false, 'markSent flipped the opt-in');
});

test('sendDailyOnce does NOT send if the sent-marker write fails (no all-day re-POST)', () => {
  // The re-send hole: if markSent's disk write fails but the POST succeeds, `sent`
  // never persists and every sweep re-POSTs the same day forever. The fix sends
  // only when the mark persisted. Force write to fail (read still succeeds) by
  // blocking the atomic-rename temp path with a directory of the same name.
  feedback.write('a finding', { date: '2026-09-04' });
  feedbacksend.setOn(true); // FILE now readable as {on:true}
  const tmpBlock = feedbacksend.FILE + '.tmp';
  fs.mkdirSync(tmpBlock, { recursive: true }); // writeFileSync(tmp) will now EISDIR
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve(); });
  try {
    // Precondition: the read still works (so the opt-in gate passes), but the write fails.
    assert.equal(feedbacksend.read().on, true, 'setup: the setting is not readable, so this proves nothing');
    assert.equal(feedbacksend.markSent('2026-09-04').ok, false, 'setup: the write did not fail, so this proves nothing');
    feedbacksend.sendDailyOnce('2026-09-04');
    assert.equal(calls, 0, 'a send happened even though the sent-marker could not be recorded (re-POST-forever risk)');
  } finally {
    fs.rmSync(tmpBlock, { recursive: true, force: true });
  }
});

/* kosmos#4766: a report that CHANGED after it was sent is sent again, at most
   once per RESEND_MIN_MS (3 hours). Before this, the day was marked sent on the
   first send and anything added later that day never left the machine. The
   clock is the second argument, so no test sleeps. */
const H = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-30T13:49:00Z');
// The hash is recorded only after the POST resolves (review round 1), so each
// sweep waits a macrotask for the sender's promise chain to settle.
const tick = () => new Promise((r) => setImmediate(r));
async function sweep(t) { feedbacksend.sendDailyOnce('2026-09-30', t); await tick(); await tick(); }
function capture() {
  const bodies = [];
  feedbacksend.setSender((url, init) => { bodies.push(JSON.parse(init.body).body); return Promise.resolve(); });
  return bodies;
}

test('#4766: a report changed after it was sent is sent again once the interval has passed, with the new line', async () => {
  feedback.write('first finding', { date: '2026-09-30' });
  const bodies = capture();
  await sweep(T0);
  assert.equal(bodies.length, 1, 'setup: the first send did not happen');
  feedback.write('first finding\nthe board is slow after lunch', { date: '2026-09-30' });
  await sweep(T0 + 3 * H + 1);
  assert.equal(bodies.length, 2, 'the changed report was not sent again (the #4766 loss)');
  assert.match(bodies[1], /the board is slow after lunch/, 'the re-send did not carry the new line');
  assert.equal(feedbacksend.read().sentAt, T0 + 3 * H + 1, 'the re-send did not record when it was sent');
});

test('#4766 CONTROL: an unchanged report is never sent twice in a day, however long the gap', async () => {
  feedback.write('first finding', { date: '2026-09-30' });
  const bodies = capture();
  await sweep(T0);
  // A rewrite with the SAME words: the header's generated_at changes, the report does not.
  feedback.write('first finding', { date: '2026-09-30' });
  await sweep(T0 + 3 * H + 1);
  await sweep(T0 + 9 * H);
  assert.equal(bodies.length, 1, 'an unchanged report was POSTed again');
});

test('#4766 CONTROL: a change inside the interval is not sent yet, and is sent once it passes', async () => {
  feedback.write('first finding', { date: '2026-09-30' });
  const bodies = capture();
  await sweep(T0);
  feedback.write('first finding\nmore', { date: '2026-09-30' });
  await sweep(T0 + 1 * H);
  await sweep(T0 + 3 * H - 1);
  assert.equal(bodies.length, 1, 'a change was re-sent inside the interval (POST storm risk)');
  await sweep(T0 + 3 * H);
  assert.equal(bodies.length, 2, 'the change was not sent once the interval passed');
  await sweep(T0 + 4 * H);
  assert.equal(bodies.length, 2, 'the same changed report was sent a third time');
});

test('#4766: a re-send whose marker cannot be written does not POST (the no-re-POST-forever safety)', async () => {
  feedback.write('first finding', { date: '2026-09-30' });
  const bodies = capture();
  await sweep(T0);
  feedback.write('first finding\nmore', { date: '2026-09-30' });
  const tmpBlock = feedbacksend.FILE + '.tmp';
  fs.mkdirSync(tmpBlock, { recursive: true }); // the atomic write's temp path is now a directory
  try {
    assert.equal(feedbacksend.markSent('2026-09-30', 'x', T0).ok, false, 'setup: the write did not fail, so this proves nothing');
    await sweep(T0 + 3 * H + 1);
    assert.equal(bodies.length, 1, 'a re-send went out although its marker could not be recorded');
  } finally {
    fs.rmSync(tmpBlock, { recursive: true, force: true });
  }
});

test('#4766: an old settings file whose `sent` is a bare date is migrated with at most one extra send', async () => {
  feedback.write('first finding', { date: '2026-09-30' });
  fs.mkdirSync(nodePath.dirname(feedbacksend.FILE), { recursive: true });
  fs.writeFileSync(feedbacksend.FILE, JSON.stringify({ on: true, sent: '2026-09-30' }) + '\n');
  const r = feedbacksend.read();
  assert.deepEqual([r.on, r.sent, r.sentHash, r.sentAt, r.ok], [true, '2026-09-30', null, null, true], 'the old file did not read as sent-today-content-unknown');
  const bodies = capture();
  await sweep(T0);
  await sweep(T0 + 1 * H);
  await sweep(T0 + 5 * H);
  assert.equal(bodies.length, 1, 'an old-format marker produced more than one extra send (or none)');
  const after = JSON.parse(fs.readFileSync(feedbacksend.FILE, 'utf8'));
  assert.equal(after.sent, '2026-09-30');
  assert.equal(typeof after.sentHash, 'string', 'the migration did not record what was sent');
  assert.equal(after.on, true, 'the migration flipped the opt-in');
});

test('#4766: setOn keeps the hash and time of the last send', async () => {
  feedback.write('first finding', { date: '2026-09-30' });
  capture();
  await sweep(T0);
  const before = feedbacksend.read();
  feedbacksend.setOn(false);
  feedbacksend.setOn(true);
  const after = feedbacksend.read();
  assert.deepEqual([after.sent, after.sentHash, after.sentAt], [before.sent, before.sentHash, before.sentAt], 'toggling the switch lost what was sent');
  assert.ok(before.sentHash, 'setup: no hash was recorded, so this proves nothing');
});

test('#4766 review: a FAILED re-send is retried after the interval, at most once per interval while failing', async () => {
  feedback.write('first finding', { date: '2026-09-30' });
  const bodies = capture();
  await sweep(T0);
  feedback.write('first finding\nthe slowness write-up', { date: '2026-09-30' });
  let fail = true;
  const tries = [];
  feedbacksend.setSender((url, init) => {
    tries.push(JSON.parse(init.body).body);
    return fail ? Promise.reject(new Error('collector down')) : Promise.resolve({ ok: true });
  });
  await sweep(T0 + 3 * H + 1);          // re-send attempt 1: fails
  assert.equal(tries.length, 1, 'setup: the re-send was not attempted');
  await sweep(T0 + 4 * H);              // inside the interval of the failed attempt
  await sweep(T0 + 6 * H);
  assert.equal(tries.length, 1, 'a failing collector was POSTed more than once per interval');
  await sweep(T0 + 6 * H + 2);          // interval since the failed attempt: retried
  assert.equal(tries.length, 2, 'a failed re-send was never retried (the revision would be lost for good)');
  fail = false;
  await sweep(T0 + 9 * H + 3);          // retried again, and this time it lands
  assert.equal(tries.length, 3, 'setup: the third attempt did not happen');
  assert.match(tries[2], /the slowness write-up/);
  await sweep(T0 + 13 * H);             // delivered: no re-POST of the same content
  assert.equal(tries.length, 3, 'a delivered report was POSTed again');
  assert.equal(bodies.length, 1);
});

test('#4766 review: an HTTP error response (ok:false) counts as failed, and a success records the hash', async () => {
  feedback.write('first finding', { date: '2026-09-30' });
  const tries = [];
  feedbacksend.setSender(() => { tries.push(1); return Promise.resolve({ ok: false, status: 500 }); });
  await sweep(T0);
  assert.equal(feedbacksend.read().sentHash, null, 'a 500 was recorded as delivered');
  assert.equal(feedbacksend.read().sentAt, T0, 'the attempt time was not recorded before the POST');
  await sweep(T0 + 1 * H);
  assert.equal(tries.length, 1, 'a failing first send was retried inside the interval');
  feedbacksend.setSender(() => { tries.push(1); return Promise.resolve({ ok: true }); });
  await sweep(T0 + 3 * H);
  assert.equal(tries.length, 2, 'the failed first send was not retried after the interval');
  assert.equal(typeof feedbacksend.read().sentHash, 'string', 'a successful send did not record the hash');
  await sweep(T0 + 7 * H);
  assert.equal(tries.length, 2, 'a delivered report was POSTed again');
});

test('#4766 review: a clock set back still needs a changed report to send', async () => {
  feedback.write('first finding', { date: '2026-09-30' });
  const bodies = capture();
  await sweep(T0);
  await sweep(T0 - 1 * H);              // clock set back, same report: nothing
  assert.equal(bodies.length, 1, 'a clock set back re-sent an unchanged report');
  feedback.write('first finding\nmore', { date: '2026-09-30' });
  await sweep(T0 - 1 * H);              // changed, and a future sentAt counts as elapsed: once
  assert.equal(bodies.length, 2, 'a changed report was held forever by a clock set back');
  feedback.write('first finding\nmore\nand more', { date: '2026-09-30' });
  await sweep(T0 - 1 * H + 60 * 1000);  // changed again, but the new mark is a real time: the interval holds
  assert.equal(bodies.length, 2, 'a clock set back allowed a POST storm');
});

/* ─────────────────────────────────────────────────────────────────────────
   #2037 (revision): scrub redacts this install's identifying names as a
   BACKSTOP to the author prompt's own rule. Agent names, project names and the
   OS account name are word-bounded, case-insensitive, longest-first, and
   guarded by a minimum length + a stoplist for the product's own name.
   ───────────────────────────────────────────────────────────────────────── */

test('#2037 scrub redacts agent, project and account names, keeping the product name', () => {
  // agent: both the display name and its on-disk key are identifying
  store.writeProfile('quibblebot', { displayName: 'Zorptastic', dir: '/tmp/x' });
  // projects: a real project name is redacted; the product name is NOT (subject)
  projects.writeAll([{ id: 'k', name: 'Kosmos' }, { id: 'flim', name: 'Flimwaddle' }]);
  const user = os.userInfo().username;

  const body = [
    'Zorptastic could not reach quibblebot.',
    'The Flimwaddle export failed, but Kosmos itself stayed up.',
    'account ' + user + ' hit it.',
  ].join('\n');
  const out = feedbacksend.scrub(body);
  assert.ok(!out.includes('Zorptastic'), 'agent display name must be redacted');
  assert.ok(!/\bquibblebot\b/.test(out), 'agent on-disk key must be redacted');
  assert.ok(!out.includes('Flimwaddle'), 'a project name must be redacted');
  assert.ok(out.includes('[redacted]'), 'the redaction placeholder is present');
  assert.ok(out.includes('Kosmos'), 'the product name is the subject, never redacted');
  assert.ok(user.length < 4 || !new RegExp('\\b' + user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(out),
    'the OS account name must be redacted (it is a "user name" a path arm never catches)');
});

test('#2037 scrub does not redact a name below the minimum length (guards common words)', () => {
  store.writeProfile('zzz', { displayName: 'Zap' }); // 3-char key, 3-char display name
  // Neither 'zzz' nor 'Zap' is long enough to redact without gutting common words.
  assert.equal(feedbacksend.scrub('Zap zzz stay'), 'Zap zzz stay');
});

test('#2037 scrub is word-bounded: a longer word that merely contains a name is untouched', () => {
  projects.writeAll([{ id: 'flim', name: 'Flimwaddle' }]);
  // 'Flimwaddler' contains 'Flimwaddle' but has no word boundary after it.
  assert.equal(feedbacksend.scrub('the Flimwaddler tool broke'), 'the Flimwaddler tool broke');
});

test('#2037 scrub is fail-soft: an unreadable projects file never throws and still scrubs paths', () => {
  fs.writeFileSync(projects.file(), 'not valid json', 'utf8'); // projects.readAll throws UNREADABLE
  const out = feedbacksend.scrub('/Users/joe/x and Snorfblat');
  assert.equal(out, '~/x and Snorfblat',
    'the path arm still runs, an unenumerable project name is left alone, and nothing throws');
  fs.writeFileSync(projects.file(), '[]', 'utf8'); // reset the shared sandbox
});

test('#2037 scrub redacts a non-ASCII / punctuation-bordered name (\\b would miss it)', () => {
  store.writeProfile('cyr', { displayName: 'Монализа' }); // Cyrillic: both edges non-ASCII
  projects.writeAll([{ id: 'jose', name: 'José' }]);       // trailing accent defeats a closing \b
  const out = feedbacksend.scrub('the Монализа agent and José both hit a bug');
  assert.ok(!out.includes('Монализа'), 'a Cyrillic name must be redacted (\\b fires only at ASCII)');
  assert.ok(!out.includes('José'), 'an accent-bordered name must be redacted');
});

test('#2037 scrub escapes regex metacharacters: a literal dot is not a wildcard', () => {
  projects.writeAll([{ id: 'dot', name: 'a.b.c' }]);
  assert.ok(feedbacksend.scrub('the a.b.c module broke').includes('[redacted]'), 'the literal name is redacted');
  assert.equal(feedbacksend.scrub('the axbxc module broke'), 'the axbxc module broke',
    'the dot is a literal, not a wildcard, so a lookalike is left alone');
});

test('#2037 scrub survives a malformed profile and still redacts the readable ones', () => {
  store.writeProfile('goodagent', { displayName: 'Zorptastic' });
  fs.mkdirSync(store.PROFILES, { recursive: true });
  fs.writeFileSync(nodePath.join(store.PROFILES, 'broken.json'), '{ not valid json', 'utf8');
  const out = feedbacksend.scrub('Zorptastic reported it'); // must not throw
  assert.ok(!out.includes('Zorptastic'), 'a readable profile is still redacted despite a garbled sibling');
});

test('#2037 scrub redacts an agent known only by its worker folder (no profile)', () => {
  fs.mkdirSync(nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, 'Folderonly'), { recursive: true });
  assert.ok(!feedbacksend.scrub('the Folderonly agent crashed').includes('Folderonly'),
    'an agent with a worker folder but no profile is still redacted');
});

// #1760 (audit slice 15): scrub must redact SECRETS, not just names/paths. The
// body is agent-authored free text answering "what bugs did you hit / what's
// broken", which invites quoting an error/log/config -- exactly where a live
// credential rides along. Each arm below is a positive control: the planted
// secret shape does NOT survive scrub (RED before the secret arm existed).
test('#1760 scrub redacts provider key/token shapes (sk-, github_pat_, ghp_, AKIA, Slack, JWT)', () => {
  const cases = [
    'sk-proj-abcd1234EFGH5678ijkl90mn',
    'sk-ant-api03-ABCdef1234567890xyzuvw',
    'sk_live_abcdef1234567890ABCDEF',
    'rk_test_abcdef1234567890ABCDEF',
    'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwx',
    'ghp_ABCdefGHIjklMNOpqrSTUvwx0123',
    'AKIAIOSFODNN7EXAMPLE',
    'ASIAIOSFODNN7EXAMPLE',
    'AIzaSyA1bcd2EFgh3IJkl4MNop5QRst6UVwx7Y',
    'ya29.a0Ae4lvC1bcd2EFgh3IJkl4MNop5QRst6',
    'npm_abcdef1234567890ABCDEFghijklmnopqrst',
    // NOTE: deliberately NOT real-Slack-token-shaped (no numeric id segments) so
    // GitHub secret-scanning push protection does not flag these fake fixtures,
    // while still exercising the scrub arms' xox*/xapp- prefixes.
    'xoxb-not-a-real-slack-token-example',
    'xapp-not-a-real-app-token-example',
    'eyJhbGciOi.eyJzdWIiOiJ.SflKxwRJSM',
  ];
  for (const c of cases) {
    const out = feedbacksend.scrub('failing with ' + c + ' today');
    assert.ok(!out.includes(c), 'a secret shape survived scrub: ' + c);
    assert.ok(out.includes('[redacted-secret]'), 'secret not replaced with marker: ' + c);
  }
});

test('#1760 scrub redacts a Bearer credential but keeps the scheme word', () => {
  const out = feedbacksend.scrub('sent header Authorization: Bearer abc123DEF456ghi789JKL end');
  assert.ok(!out.includes('abc123DEF456ghi789JKL'), 'a Bearer token leaked');
  assert.ok(/Bearer \[redacted-secret\]/.test(out), 'the scheme word should survive, only the token redacted');
});

test('#1760 scrub redacts a labelled password/token assignment value, keeping the label', () => {
  assert.equal(feedbacksend.scrub('password: hunter2pass'), 'password: [redacted-secret]');
  assert.equal(feedbacksend.scrub('token=abcd1234efgh'), 'token=[redacted-secret]');
  assert.equal(feedbacksend.scrub('api_key = abcd1234efgh'), 'api_key = [redacted-secret]');
  assert.equal(feedbacksend.scrub('apikey:abcd1234efgh'), 'apikey:[redacted-secret]');
  // Quoted value: the quotes are consumed, the value redacted.
  assert.ok(!feedbacksend.scrub('password: "hunter2pass"').includes('hunter2pass'),
    'a quoted assignment value leaked');
});

// The `\b`-vs-lookbehind gap the first blind review caught: snake_case labels
// (client_secret, access_token, refresh_token, api_secret) are exactly the
// config/.env shape the plan targets, and a leading `\b` would silently miss
// them because \b does not fire between `_` and a letter.
test('#1760 scrub redacts snake_case config labels (client_secret, access_token, refresh_token, api_secret)', () => {
  for (const line of [
    'client_secret=abcdef1234567',
    'access_token=abcdef1234567',
    'refresh_token: abcdef1234567',
    'api_secret=abcdef1234567',
  ]) {
    const out = feedbacksend.scrub(line);
    assert.ok(!out.includes('abcdef1234567'), 'a snake_case secret value leaked: ' + line);
    assert.ok(out.includes('[redacted-secret]'), 'value not redacted: ' + line);
  }
});

// The safe direction is over-redaction, but it must not gut ordinary report
// prose. These are the false-positive guards the design leans on.
test('#1760 scrub does NOT corrupt a common word that merely contains "sk-"', () => {
  assert.equal(feedbacksend.scrub('this is a risk-management-strategy problem'),
    'this is a risk-management-strategy problem');
});

test('#1760 scrub leaves label prose with no value untouched (no separator+value)', () => {
  assert.equal(feedbacksend.scrub('the token is invalid'), 'the token is invalid');
  assert.equal(feedbacksend.scrub('secret: it works better now'), 'secret: it works better now');
});

// The value-discriminator guard (a redacted value must contain a digit or token
// symbol): a bug report's diagnostic word after a label - which is often the bug
// signal itself - must survive, even though it follows `label:` and is >=8 chars.
test('#1760 scrub keeps diagnostic prose after a label (word value, no digit/symbol)', () => {
  assert.equal(feedbacksend.scrub('token: undefined'), 'token: undefined');
  assert.equal(feedbacksend.scrub('password: incorrect'), 'password: incorrect');
  assert.equal(feedbacksend.scrub('secret: unavailable'), 'secret: unavailable');
  assert.equal(feedbacksend.scrub('token: disconnected'), 'token: disconnected');
  // A trailing sentence period and a hyphenated word are prose, not credential
  // signals: `.` and `-` are excluded from the value discriminator so real
  // sentences survive intact.
  assert.equal(feedbacksend.scrub('token: undefined.'), 'token: undefined.');
  assert.equal(feedbacksend.scrub('password: incorrect.'), 'password: incorrect.');
  assert.equal(feedbacksend.scrub('the token: not-found here'), 'the token: not-found here');
  assert.equal(feedbacksend.scrub('the token: read-only mode'), 'the token: read-only mode');
});

// The bare `key` label (private_key/ssh_key/signing_key), reachable via the
// underscore lookbehind, is backstopped - but only for a credential-shaped value.
test('#1760 scrub redacts a snake_case key= value, and spares a bare key: word', () => {
  assert.equal(feedbacksend.scrub('private_key=abcd1234efgh'), 'private_key=[redacted-secret]');
  assert.equal(feedbacksend.scrub('signing_key: abcd1234efgh'), 'signing_key: [redacted-secret]');
  assert.equal(feedbacksend.scrub('key: important'), 'key: important');
  // "monkey=" must NOT match: 'key' there is preceded by 'n' (alnum), lookbehind fails.
  assert.equal(feedbacksend.scrub('monkey=business'), 'monkey=business');
});

// JSON-quoted label form - the most common way a config/error body is pasted into
// a report. The value is redacted; the label, colon and quotes stay balanced.
test('#1760 scrub redacts a JSON-quoted secret assignment, quotes balanced', () => {
  assert.equal(feedbacksend.scrub('{"api_key": "a1b2c3d4e5f6g7h8"}'),
    '{"api_key": "[redacted-secret]"}');
  assert.equal(feedbacksend.scrub('{"token":"a1b2c3d4e5f6g7h8"}'),
    '{"token":"[redacted-secret]"}');
  assert.ok(!feedbacksend.scrub('{"db_password": "SuperSecret123", "user": "admin"}').includes('SuperSecret123'),
    'a JSON-quoted password leaked');
});

// A prefix arm must not match mid-word and corrupt an unrelated word (the
// lookbehind is now uniform across every arm).
test('#1760 scrub does NOT corrupt a word that merely contains a prefix mid-word', () => {
  assert.equal(feedbacksend.scrub('the flagho_customflag123456789012345678 word'),
    'the flagho_customflag123456789012345678 word');
});

// Trailing SENTENCE punctuation adjacent to a value is given back, not swallowed.
test('#1760 scrub does not eat trailing sentence punctuation around a value', () => {
  assert.equal(feedbacksend.scrub('token=abcd1234efgh, thanks'), 'token=[redacted-secret], thanks');
  assert.equal(feedbacksend.scrub('the config was (token=abcd1234efgh) and broke'),
    'the config was (token=[redacted-secret]) and broke');
  assert.equal(feedbacksend.scrub('token=abcd1234efgh.'), 'token=[redacted-secret].');
});

// The value discriminator fires on a base64 SYMBOL alone (= + /), not only on a
// digit. (`.` and `-` are NOT discriminators - they are prose punctuation.)
test('#1760 scrub redacts a base64-symbol value with no digit', () => {
  assert.equal(feedbacksend.scrub('token=abcd+efgh/ijkl'), 'token=[redacted-secret]');
  assert.equal(feedbacksend.scrub('secret: abcdef=ghijkl'), 'secret: [redacted-secret]');
});

// #1760 iter-6: secrets run BEFORE the name arm, so a project/agent literally
// named "Token"/"Secret"/"Password" cannot have its label redacted first and
// leave the credential value in the clear.
test('#1760 a project named like a secret label does not leak the value (secrets before names)', () => {
  fs.mkdirSync(nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, 'Token'), { recursive: true });
  const out = feedbacksend.scrub('the request failed: Token=abcd1234EFGH5678ijkl and retried');
  assert.ok(!out.includes('abcd1234EFGH5678ijkl'), 'the credential value leaked past a secret-named project');
  assert.ok(out.includes('[redacted-secret]'), 'the value was not redacted');
});

// #1760 iter-6: a credential embedded in a URL's userinfo (a pasted connection
// string / curl URL). Password redacted; scheme, user and host preserved.
test('#1760 scrub redacts a URL-embedded basic-auth password', () => {
  const out = feedbacksend.scrub('psql postgres://admin:hunter2pass99@localhost/db failed');
  assert.ok(!out.includes('hunter2pass99'), 'a URL-embedded password leaked');
  assert.equal(out, 'psql postgres://admin:[redacted-secret]@localhost/db failed');
});

// #1760 iter-6: `Authorization: Basic <base64>` header.
test('#1760 scrub redacts a Basic auth credential, keeping the scheme', () => {
  const out = feedbacksend.scrub('sent Authorization: Basic dXNlcjpwYXNzd29yZDEyMw== and got 401');
  assert.ok(!out.includes('dXNlcjpwYXNzd29yZDEyMw'), 'a Basic credential leaked');
  assert.ok(/Basic \[redacted-secret\]/.test(out), 'the Basic scheme word should survive');
});

// #1760 iter-6: a Bearer token followed by a sentence period keeps the period.
test('#1760 scrub does not eat a period after a Bearer token', () => {
  assert.equal(feedbacksend.scrub('it failed using Bearer abcd1234EFGH5678ijkl. then retried'),
    'it failed using Bearer [redacted-secret]. then retried');
});

// #1760 iter-6: a query string redacts only the secret param, leaving the rest.
test('#1760 scrub stops a value at & so a following query param survives', () => {
  assert.equal(feedbacksend.scrub('the reset link /reset?token=abcd1234efgh&email=foo@bar.com failed'),
    'the reset link /reset?token=[redacted-secret]&email=foo@bar.com failed');
});

// #3710: the two scrub timing tests below bound CPU time, not wall time.
// Backtracking is CPU work, so a real regression still burns past the bound. A
// busy Mac inflates wall time far more than CPU time: the degenerate run below
// failed at 3.4 to 4.4s of wall time under load 16 to 31, and measured about
// 270ms of CPU alone and about 480ms under load 22, well inside 3000.
/** CPU budget for one scrub() call. Unchanged from the old wall-time bound. */
const SCRUB_CPU_BOUND_MS = 3000;
// The shared helper (#3715). Its own controls, in test-support.cpu-time.test.js, check
// that it reads milliseconds and CPU rather than wall time; this file kept a private copy
// and a units control of its own until the helper existed.
const { cpuMillisecondsOf } = require('../test-support/cpu-time');

// #1760 iter-7: scrub() runs synchronously on the board event loop, so no arm may
// be O(N^2). A long dotted/hex run (a stack trace / digest chain) with no `://`
// used to make the URL-userinfo arm backtrack quadratically (~53s at 200k chars);
// bounded quantifiers keep it linear. Generous budget so the test isn't flaky but
// still fails hard on a return of the quadratic blowup.
test('#1760 scrub stays fast on a long non-URL run (no ReDoS in the URL arm)', () => {
  const big = 'a' + '.b1c'.repeat(40000); // ~160k chars of [a-z0-9.], no ://
  let out;
  const ms = cpuMillisecondsOf(() => { out = feedbacksend.scrub(big); });
  assert.equal(out, big, 'a non-credential run should pass through unchanged');
  assert.ok(ms < SCRUB_CPU_BOUND_MS, `scrub used ${Math.round(ms)}ms of CPU on a ${big.length}-char run - possible ReDoS regression`);
});

// #1760 iter-8: the Basic arm must be case-insensitive on the scheme word, like
// Bearer -- a lowercase `basic` header still carries a real credential.
test('#1760 scrub redacts a lowercase basic auth credential', () => {
  const out = feedbacksend.scrub('sent Authorization: basic dXNlcjpwYXNzd29yZDEyMw== and got 401');
  assert.ok(!out.includes('dXNlcjpwYXNzd29yZDEyMw'), 'a lowercase basic credential leaked');
  assert.ok(/basic \[redacted-secret\]/i.test(out), 'the basic scheme word should survive');
});

// #1760 iter-8: the value stops at `,` and `;`, so a comma list / cookie chain
// redacts only the secret param and does not swallow across the separator.
test('#1760 scrub stops the value at , and ; (no cross-separator over-redaction)', () => {
  // "undefined" has no digit/symbol, so token=undefined is diagnostic prose, left whole,
  // and the trailing ,count=5 is not swallowed.
  assert.equal(feedbacksend.scrub('failed after 3 retries: token=undefined,count=5'),
    'failed after 3 retries: token=undefined,count=5');
  // A real credential value redacts, and the following param survives.
  assert.equal(feedbacksend.scrub('token=abcd1234efgh,count=5'), 'token=[redacted-secret],count=5');
  // Cookie/semicolon chain: only the token value goes; session (not a label) and secure survive.
  const cookie = feedbacksend.scrub('Cookie: session=abc123XYZ;token=def456UVWx;secure=1');
  assert.ok(!cookie.includes('def456UVWx'), 'a semicolon-chained token value leaked');
  assert.ok(cookie.includes('session=abc123XYZ'), 'the semicolon fix over-redacted a neighbour');
});

// #1760 iter-8: bounded quantifiers -> a multi-MB degenerate run cannot stack-overflow
// (scrub runs synchronously on the board event loop). It must return, not throw.
test('#1760 scrub survives a multi-MB degenerate assignment run without throwing', () => {
  const big = 'token:' + 'a'.repeat(3_000_000); // no digit/symbol, no separator
  let out, threw = null;
  const ms = cpuMillisecondsOf(() => { try { out = feedbacksend.scrub(big); } catch (e) { threw = e.message; } });
  assert.equal(threw, null, 'scrub threw on a large run: ' + threw);
  assert.ok(ms < SCRUB_CPU_BOUND_MS, `scrub used ${Math.round(ms)}ms of CPU on a large run - possible unbounded backtracking`);
});

/* kosmos#5294: sendNow, for `kosmos feedback write`: send NOW and say what happened. Same gates as sendDailyOnce. */

test('#5294 sendNow sends the scrubbed contract payload once and reports sent; the delivered hash is recorded', async () => {
  feedback.write('the task verbs were missing', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  const seen = [];
  feedbacksend.setSender((url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true }); });
  const r = await feedbacksend.sendNow('2026-09-04', 1000);
  assert.equal(r.state, 'sent');
  assert.equal(seen.length, 1, 'expected exactly one POST');
  assert.deepEqual(Object.keys(seen[0].body).sort(), ['body', 'consent', 'date', 'generated_at', 'install'], 'not the #2246 contract');
  assert.equal(seen[0].body.date, '2026-09-04');
  const st = feedbacksend.read();
  assert.equal(st.sent, '2026-09-04'); assert.equal(st.sentAt, 1000);
  assert.ok(st.sentHash, 'the delivered hash was not recorded, so the next sweep would send it again');
});

test('#5294 sendNow again with the same body is "already": no second POST', async () => {
  feedback.write('same words', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve({ ok: true }); });
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'sent');
  assert.equal((await feedbacksend.sendNow('2026-09-04', 2000)).state, 'already');
  assert.equal(calls, 1);
});

test('#5294 a CHANGED report within 3 h is "later" (the #4766 floor), and goes after it', async () => {
  feedback.write('first version', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve({ ok: true }); });
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'sent');
  feedback.write('second, longer version', { date: '2026-09-04' });
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000 + 60 * 1000)).state, 'later');
  assert.equal(calls, 1, 'a changed report went out inside the 3 h floor');
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000 + 3 * 60 * 60 * 1000)).state, 'sent');   // CONTROL
  assert.equal(calls, 2);
});

test('#5294 sending switched off: "off", and nothing is POSTed or marked', async () => {
  feedback.write('body', { date: '2026-09-04' });
  feedbacksend.setOn(false);
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve({ ok: true }); });
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'off');
  assert.equal(calls, 0);
  assert.equal(feedbacksend.read().sent, null);
});

test('#5294 no report for the day: "none", nothing POSTed', async () => {
  feedbacksend.setOn(true);
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve({ ok: true }); });
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'none');
  assert.equal(calls, 0);
});

test('#5294 the collector refuses (4xx) or the network throws: "failed", the attempt marked, no hash recorded', async () => {
  for (const sender of [() => Promise.resolve({ ok: false }), () => Promise.reject(new Error('down'))]) {
    fresh();
    feedback.write('body', { date: '2026-09-04' });
    feedbacksend.setOn(true);
    feedbacksend.setSender(sender);
    assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'failed');
    const st = feedbacksend.read();
    assert.equal(st.sent, '2026-09-04', 'the attempt was not marked, so the sweep could re-POST every hour');
    assert.equal(st.sentHash, null, 'a failed send was recorded as delivered');
  }
});

test('#5294 review 1: after a FAILED send, writing again retries at once (no 3 h wait when nothing was delivered)', async () => {
  feedback.write('first try', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  let ok = false; let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve({ ok }); });
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'failed');
  ok = true;
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000 + 60 * 1000)).state, 'sent', 'a failed send could not be retried for 3 h');
  assert.equal(calls, 2);
});

test('#5294 review 1: "later" only after a version was DELIVERED today, never after a failed attempt', async () => {
  feedback.write('v1', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  feedbacksend.setSender(() => Promise.resolve({ ok: false }));
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'failed');
  feedback.write('v2', { date: '2026-09-04' });
  const r = await feedbacksend.sendNow('2026-09-04', 1000 + feedbacksend.RETRY_MIN_MS);
  assert.equal(r.state, 'failed', '"later" (or anything but a retry) after a send that never reached the team');
});

test('#5294 review 2: a retry under a minute after a FAILED send is "soon", and nothing is POSTed (no flood)', async () => {
  feedback.write('v1', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve({ ok: false }); });
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'failed');
  feedback.write('v2', { date: '2026-09-04' });
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000 + 10 * 1000)).state, 'soon');
  assert.equal(calls, 1, 'a retry 10 s after a failure hit the collector again');
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000 + feedbacksend.RETRY_MIN_MS)).state, 'failed');   // CONTROL
  assert.equal(calls, 2);
});

test('#5294 review 2: a data root under the temp directory counts as a test, even without the runner', () => {
  // This file's data root is a mkdtemp sandbox, like every fixture's. With the runner signal removed, the temp-folder
  // rule alone must still say sandboxed, so a CLI test file run directly cannot reach installkosmos.com.
  const prev = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    assert.equal(feedbacksend.underTest(), false, 'setup: the runner signal is still set');
    assert.equal(feedbacksend.sandboxed(), true, 'a temp-folder data root was not treated as a test');
  } finally { if (prev !== undefined) process.env.NODE_TEST_CONTEXT = prev; }
});

test('#5294 review 1: an unreadable setting file is "unreadable", not "off", and nothing is sent', async () => {
  feedback.write('body', { date: '2026-09-04' });
  fs.mkdirSync(nodePath.dirname(feedbacksend.FILE), { recursive: true });
  fs.writeFileSync(feedbacksend.FILE, 'not json{');
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve({ ok: true }); });
  assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'unreadable');
  assert.equal(calls, 0);
});

test('#5294 the marker cannot be saved: "unsent", and nothing is POSTed (the sweep\'s rule)', async () => {
  feedback.write('body', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  // A directory where the settings file's temp file must go makes the write fail; reading still says on.
  fs.mkdirSync(feedbacksend.FILE + '.tmp', { recursive: true });
  let calls = 0;
  feedbacksend.setSender(() => { calls += 1; return Promise.resolve({ ok: true }); });
  try {
    assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'unsent');
    assert.equal(calls, 0, 'a send went out with no marker, so every sweep would repeat it');
  } finally { fs.rmSync(feedbacksend.FILE + '.tmp', { recursive: true, force: true }); }
});

test('#5294 a test run never phones home: a real endpoint is "blocked"; only loopback may be reached', async () => {
  feedback.write('body', { date: '2026-09-04' });
  feedbacksend.setOn(true);
  feedbacksend.setSender(null);
  assert.equal(feedbacksend.underTest(), true, 'the runner signal is gone, so this test proves nothing');
  let reached = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { reached += 1; return Promise.resolve({ ok: true }); };
  const prev = process.env.AGENT_WORKFORCE_FEEDBACK_URL;
  try {
    delete process.env.AGENT_WORKFORCE_FEEDBACK_URL;   // the default, installkosmos.com
    assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'blocked');
    assert.equal(reached, 0, 'a test run reached the real collector');
    process.env.AGENT_WORKFORCE_FEEDBACK_URL = 'http://127.0.0.1:9/api/feedback';   // CONTROL: loopback is allowed
    assert.equal((await feedbacksend.sendNow('2026-09-04', 1000)).state, 'sent');
    assert.equal(reached, 1);
  } finally {
    globalThis.fetch = realFetch;
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_FEEDBACK_URL; else process.env.AGENT_WORKFORCE_FEEDBACK_URL = prev;
  }
});

test('#5294 every state has its own sentence; only sent, already and later say a version reached the team', () => {
  const states = ['sent', 'already', 'later', 'off', 'unreadable', 'none', 'failed', 'soon', 'unsent', 'blocked'];
  for (const s of states) assert.ok(feedbacksend.writeMessage(s) && feedbacksend.writeMessage(s).startsWith('Saved'), s);
  assert.equal(new Set(states.map((s) => feedbacksend.writeMessage(s))).size, states.length, 'two states share a sentence');
  assert.match(feedbacksend.writeMessage('sent'), /sent it to the Kosmos team \(installkosmos\.com\)/);
  for (const s of states.filter((x) => x !== 'sent' && x !== 'already' && x !== 'later')) {
    assert.doesNotMatch(feedbacksend.writeMessage(s), /sent it to/, s + ' claims a send that did not happen');
  }
  assert.doesNotMatch(Object.values(feedbacksend.WRITE_MESSAGES).join(' '), /\u2014/, 'an em dash in user-facing copy');
});

test('#5294 review 3: a REAL data root (not a temp folder, no test runner) is NOT sandboxed, so real installs send', () => {
  // A child with its data root outside every fixed temp root, and no NODE_TEST_CONTEXT, must read sandboxed() false.
  // Pins the other direction of the rule above: a sandboxed() that degraded to always-true would block every real send.
  const cp = require('node:child_process');
  const env = { ...process.env, AGENT_WORKFORCE_DATA: '/nonexistent-kosmos-5294-root', TMPDIR: '/' };
  delete env.NODE_TEST_CONTEXT;
  const out = cp.execFileSync(process.execPath, ['-e', 'process.stdout.write(String(require(process.argv[1]).sandboxed()))',
    nodePath.join(__dirname, 'feedbacksend.js')], { env, encoding: 'utf8' });
  assert.equal(out, 'false', 'a real data root (with TMPDIR=/, the review-3 case) was treated as a test run');
});

/* kosmos#5317 review 1: the wiring where it ships. */
test('#5317 the PAYLOAD of a two-agent day carries both reports and no agent name', () => {
  feedback.write('the first report', { date: '2026-10-05', from: 'leo' });
  feedback.write('the second report', { date: '2026-10-05', from: 'mara' });
  const body = feedbacksend.payload('2026-10-05').body;
  assert.match(body, /## Report 1\n\nthe first report/);
  assert.match(body, /## Report 2\n\nthe second report/);
  assert.doesNotMatch(body, /leo|mara|kosmos-feedback-from/i);
});

test('#5317 the PAYLOAD of a one-writer day is exactly the report, as before', () => {
  feedback.write('  just one\nreport', { date: '2026-10-06', from: 'leo' });
  assert.equal(feedbacksend.payload('2026-10-06').body, '  just one\nreport\n');
});

test('#5317 the sweep sends a changed YESTERDAY once (a second agent wrote late), then never again', async () => {
  feedbacksend.setOn(true);
  const sent = [];
  feedbacksend.setSender((url, init) => { sent.push(JSON.parse(init.body).date); return Promise.resolve(); });
  const at = (s) => new Date(s).getTime();
  const settle = () => new Promise((r) => setImmediate(r));   // the delivered hash is recorded when the send resolves
  feedback.write('the first report', { date: '2026-10-07', from: 'leo' });
  feedbacksend.sweepTick(at('2026-10-07T22:00:00')); await settle();
  feedback.write('the second report', { date: '2026-10-07', from: 'mara' });
  feedbacksend.sweepTick(at('2026-10-07T23:00:00')); await settle();      // inside the 3 h floor: nothing
  assert.deepEqual(sent, ['2026-10-07']);
  feedbacksend.sweepTick(at('2026-10-08T01:30:00')); await settle();      // the next day, past the floor: yesterday goes
  assert.deepEqual(sent, ['2026-10-07', '2026-10-07'], 'the late second report never reached the team');
  feedbacksend.sweepTick(at('2026-10-08T02:30:00')); await settle();
  feedbacksend.sweepTick(at('2026-10-08T05:30:00')); await settle();
  assert.deepEqual(sent, ['2026-10-07', '2026-10-07'], 'yesterday was sent again although nothing changed');
});

test('#5317 CONTROL: an UNCHANGED yesterday is not sent again by the sweep', async () => {
  feedbacksend.setOn(true);
  const sent = [];
  feedbacksend.setSender((url, init) => { sent.push(JSON.parse(init.body).date); return Promise.resolve(); });
  const at = (s) => new Date(s).getTime();
  const settle = () => new Promise((r) => setImmediate(r));   // the delivered hash is recorded when the send resolves
  feedback.write('one report', { date: '2026-10-09', from: 'leo' });
  feedbacksend.sweepTick(at('2026-10-09T22:00:00')); await settle();
  feedbacksend.sweepTick(at('2026-10-10T03:00:00')); await settle();
  assert.deepEqual(sent, ['2026-10-09']);
});
