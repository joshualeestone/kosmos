'use strict';
/**
 * kosmos#8230: the Windows report hook's turn end (an agent's Stop, as the bash hook routes only Stop) follows the bash
 * hook's kosmos#7977 rules, so a turn end is never lost in silence:
 *   - it gets the full window (8 s), not the 3 s fire-report window;
 *   - no board at the address: tried once more, not noted;
 *   - a board too busy to prove itself in time: noted at once, not retried;
 *   - any other loss: tried once more, and noted when the second try is lost too;
 *   - the board's own keep (`skipped`), a report it cannot tie to an agent, another account's: no retry, no note;
 *   - only an agent's session (it carries an agent token) notes;
 *   - a caller that does not wait (noRetry): sent once in the short window, and a loss noted at once (kosmos#8233);
 *   - our own timeout while the answer's body is arriving (the board did answer): not resent, noted as unconfirmed (kosmos#8233);
 *   - the note is one line in turn-end-failures.log in the throttle folder, capped as the bash hook caps it.
 * And the board names its skip (`skipped`) and logs an automatic turn end it refuses before the record.
 *   node --test engine/kosmos-report-hook.turnend-8230.test.js
 */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-turnend-8230-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;   // never the real board.token
const test = require('node:test');
const assert = require('node:assert/strict');
const hook = require('./kosmos-report-hook');

const BOARD = 'BOARDTOKEN_8230_' + 'e'.repeat(32);
const AGENT = 'cd'.repeat(16);
const evt = (name) => JSON.stringify({ hook_event_name: name, session_id: 's' });
const reply = (body, status) => ({ ok: (status || 200) < 300, status: status || 200, text: async () => body });

/* One hook run: proofs answer from `proofs` in turn (true, or { ok, why }), fetches from `answers` in turn. */
async function run(event, { proofs = [true, true], answers = [], env = { KOSMOS_AGENT_TOKEN: AGENT }, timeoutMs, noRetry } = {}) {
  const throttleDir = fs.mkdtempSync(path.join(SANDBOX, 'thr-'));
  const asked = [];
  const sent = [];
  let pi = 0;
  let fi = 0;
  const slept = [];
  await hook.main({
    input: evt(event), env, uid: -1, url: 'http://127.0.0.1:1', boardToken: BOARD, platform: 'win32', ppid: 4242,
    throttleDir, now: () => 1000, stdout: () => {}, retryPauseMs: 5, timeoutMs, noRetry,
    sleep: async (ms) => { slept.push(ms); },
    proveBoard: async (url, token, timeoutMs) => { asked.push(timeoutMs); return proofs[pi++]; },
    fetchImpl: async (u, init) => { sent.push(JSON.parse(init.body).state); return answers[fi++] || reply('{"recorded":true}'); },
  });
  const file = path.join(throttleDir, 'turn-end-failures.log');   // the bash hook's own file name (kosmos#7977)
  const note = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  return { asked, sent, slept, note, throttleDir };
}

test('kosmos#8230: only Stop is a turn end, as the bash hook sends only Stop through report_turn_end', () => {
  assert.equal(hook.reportFor({ hook_event_name: 'Stop' }).turnEnd, true);
  for (const e of ['StopFailure', 'SessionEnd', 'UserPromptSubmit']) {
    assert.equal(hook.reportFor({ hook_event_name: e }).turnEnd, undefined, e + ' is marked as a turn end');
  }
  assert.equal(hook.buildBody(hook.reportFor({ hook_event_name: 'Stop' })).turnEnd, undefined, 'the mark went on the wire');
});

test('kosmos#8230: an agent\'s Stop gets the full window; the person\'s own Stop and an agent\'s SessionEnd keep the short one', async () => {
  const agent = await run('Stop');
  assert.ok(agent.asked[0] > hook.SHORT_TIMEOUT_MS / 2 && agent.asked[0] <= hook.DEFAULT_TIMEOUT_MS / 2, 'agent Stop proof window: ' + agent.asked[0]);
  const person = await run('Stop', { env: {} });
  assert.ok(person.asked[0] <= hook.SHORT_TIMEOUT_MS / 2, 'the person\'s Stop got the long window: ' + person.asked[0]);
  const end = await run('SessionEnd');
  assert.ok(end.asked[0] <= hook.SHORT_TIMEOUT_MS / 2, 'SessionEnd got the long window: ' + end.asked[0]);
});

test('kosmos#8230: CONTROL, a turn end that lands is sent once, asked once, and leaves no note', async () => {
  const r = await run('Stop');
  assert.deepEqual(r.sent, ['idle']);
  assert.equal(r.asked.length, 1);
  assert.ok(r.asked[0] > hook.SHORT_TIMEOUT_MS / 2 && r.asked[0] <= hook.DEFAULT_TIMEOUT_MS / 2, 'the proof did not get half the full window: ' + r.asked[0]);
  assert.equal(r.note, null);
});

test('kosmos#8230: a proof lost once is tried again after a pause, and the idle lands with no note', async () => {
  const r = await run('Stop', { proofs: [{ ok: false, why: 'answer is not a proof' }, true] });
  assert.equal(r.asked.length, 2);
  assert.deepEqual(r.slept, [5], 'no pause before the retry');
  assert.deepEqual(r.sent, ['idle']);
  assert.equal(r.note, null);
});

test('kosmos#8230: lost twice, one note names the event state and the reason, with no token in it', async () => {
  const r = await run('Stop', { proofs: [{ ok: false, why: 'answer is not a proof' }, { ok: false, why: 'answer is not a proof' }] });
  assert.deepEqual(r.sent, [], 'a report went to a listener that did not prove itself');
  assert.equal(r.asked.length, 2);
  const lines = (r.note || '').trim().split('\n');
  assert.equal(lines.length, 1, 'expected one note line: ' + r.note);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z agent \S+: idle not delivered after a retry: what answers at the board's address could not show it is your Kosmos/);
  assert.ok(!lines[0].includes(AGENT) && !lines[0].includes(BOARD), 'a token reached the note');
});

test('kosmos#8230: a board too busy to prove itself is noted at once and not retried', async () => {
  const r = await run('Stop', { proofs: [{ ok: false, why: 'timed out' }, true] });
  assert.equal(r.asked.length, 1, 'a busy board was asked again');
  assert.deepEqual(r.sent, []);
  assert.match(r.note || '', /idle not delivered, the board was too busy \(not retried\): the board did not answer in time/);
});

test('kosmos#8230: no board at the address is retried but not noted (closed, or mid-restart)', async () => {
  const gone = { ok: false, why: 'request failed: ECONNREFUSED' };   // boardproof's own shape (the error code)
  const r = await run('Stop', { proofs: [gone, gone] });
  assert.equal(r.asked.length, 2, 'not retried');
  assert.equal(r.note, null, 'a closed Kosmos was noted');
});

test('kosmos#8230: a not-recorded answer is retried and noted; the board\'s own keep and a stranger are neither', async () => {
  const lost = await run('Stop', { answers: [reply('{"recorded":false,"because":"we could not save that report"}'), reply('{"recorded":false,"because":"we could not save that report"}')] });
  assert.deepEqual(lost.sent, ['idle', 'idle']);
  assert.match(lost.note || '', /idle not delivered after a retry: the board did not record it \(we could not save that report\)/);

  const kept = await run('Stop', { answers: [reply('{"recorded":false,"skipped":"waiting","because":"it is waiting on a person, so an automatic idle did not overwrite it"}')] });
  assert.deepEqual(kept.sent, ['idle'], 'the board\'s keep was retried');
  assert.equal(kept.note, null, 'the board\'s keep was noted');

  // The board's skip alone decides, even when its words match no keep phrase (a future rewording).
  const skippedOnly = await run('Stop', { answers: [reply('{"recorded":false,"skipped":"waiting","because":"held for a person"}')] });
  assert.deepEqual(skippedOnly.sent, ['idle'], 'a skip in new words was retried');
  assert.equal(skippedOnly.note, null, 'a skip in new words was noted');

  const stranger = await run('Stop', { answers: [reply('{"recorded":false,"because":"this board only records a report from the account that started it; run `kosmos report` from that account, or present an agent token"}')] });
  assert.deepEqual(stranger.sent, ['idle']);
  assert.equal(stranger.note, null);
});

test('kosmos#8230: a session with no agent token (the person\'s own Claude) neither retries nor notes, as on the Mac', async () => {
  const bad = { ok: false, why: 'answer is not a proof' };
  const r = await run('Stop', { proofs: [bad, bad], env: {} });
  assert.equal(r.asked.length, 1, 'the person\'s own Stop was retried');
  assert.equal(r.note, null);
  const control = await run('Stop', { proofs: [bad, bad] });
  assert.notEqual(control.note, null, 'CONTROL: the same loss in an agent session is noted');
});

test('kosmos#8230: a report that does not end a turn is neither retried nor noted (the next report repeats it)', async () => {
  const bad = { ok: false, why: 'answer is not a proof' };
  const r = await run('PermissionRequest', { proofs: [bad, bad] });
  assert.equal(r.asked.length, 1);
  assert.equal(r.note, null);
});

test('kosmos#8230: the note is capped as the bash hook caps it: past 400 lines, the last 200 are kept', () => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'cap-'));
  const file = path.join(dir, 'turn-end-failures.log');
  fs.writeFileSync(file, Array.from({ length: 400 }, (_, i) => 'old ' + i).join('\n') + '\n');
  hook.noteTurnEnd({ throttleDir: dir }, 'k', { state: 'idle' }, { notProven: 'x' }, '');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 200);
  assert.equal(lines[0], 'old 201');
  assert.match(lines[199], /agent k: idle not delivered: x$/);
});

test('kosmos#8230: every phrase the hook treats as a keep is still said by the board', () => {
  const root = path.join(__dirname, '..');
  const src = ['server.js', 'engine/messages.js', 'engine/selfreport.js']
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  for (const phrase of hook.TURN_END_KEEP.source.split('|')) {
    assert.ok(src.includes(phrase), 'no board source says "' + phrase + '" any more, so that keep would be retried and noted');
  }
});

// The route's behaviour is measured in server.report-turnend-8230.test.js; this pins where the two refusals call it.
test('kosmos#8230: the board names its skip and logs an automatic turn end it refuses before the record', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = src.slice(src.indexOf("if (pathname === '/api/report' && req.method === 'POST') {"));
  assert.match(route.slice(0, 20000), /skipped: String\(kept\.skipped\)/, 'the record\'s skip is not named in the answer');
  const refusals = route.slice(0, 20000).match(/noteTurnEndRefusal\(body, /g) || [];
  assert.equal(refusals.length, 2, 'the roster and sender refusals should both log a refused turn end');
});

test('kosmos#8230/#8233: a caller that does not wait for the hook (noRetry) sends once, in the short window, and a loss is noted at once', async () => {
  const bad = { ok: false, why: 'answer is not a proof' };
  const r = await run('Stop', { proofs: [bad, bad], noRetry: true });
  assert.equal(r.asked.length, 1, 'a noRetry Stop was retried');
  assert.ok(r.asked[0] <= hook.SHORT_TIMEOUT_MS / 2, 'a noRetry Stop got the long window: ' + r.asked[0]);
  assert.match(r.note || '', /idle not delivered \(not retried: its caller does not wait\): /, 'a lost noRetry Stop left no note');
  const busy = await run('Stop', { proofs: [{ ok: false, why: 'timed out' }], noRetry: true });
  assert.match(busy.note || '', /\(not retried: its caller does not wait\): the board did not answer in time/);
  // CONTROLS: no board at the address, a Stop that lands, and the person's own session (no agent token) note nothing.
  const gone = await run('Stop', { proofs: [{ ok: false, why: 'request failed: ECONNREFUSED' }], noRetry: true });
  assert.equal(gone.note, null, 'a closed board was noted for a noRetry Stop');
  const landed = await run('Stop', { noRetry: true });
  assert.equal(landed.note, null);
  const person = await run('Stop', { proofs: [bad], noRetry: true, env: {} });
  assert.equal(person.note, null, 'the person\'s own noRetry Stop was noted');
  const kept = await run('Stop', { noRetry: true, answers: [reply('{"recorded":false,"skipped":"a standing wait"}')] });
  assert.equal(kept.note, null, 'the board\'s own keep was noted for a noRetry Stop');
  const src = fs.readFileSync(path.join(__dirname, 'win32codexsup.js'), 'utf8');
  assert.match(src, /hook_event_name: 'Stop' \}\), env, stdout: \(\) => \{\}, noRetry: true \}/, 'the supervisor\'s in-process idle does not pass noRetry');
});

test('kosmos#8230: lost with no time left to retry is noted as such', async () => {
  const r = await run('Stop', { proofs: [{ ok: false, why: 'answer is not a proof' }, true], timeoutMs: 900 });
  assert.equal(r.asked.length, 1, 'retried with under a second left');
  assert.match(r.note || '', /idle not delivered \(no time left to retry\): /);
});

test('kosmos#8230: a retry that meets a busy board is noted after a retry', async () => {
  const r = await run('Stop', { proofs: [{ ok: false, why: 'answer is not a proof' }, { ok: false, why: 'timed out' }] });
  assert.equal(r.asked.length, 2);
  assert.match(r.note || '', /idle not delivered after a retry: the board did not answer in time/);
});

test('kosmos#8230: the Windows keep list is the bash hook\'s _TE_KEEP, phrase for phrase', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'install', 'kosmos-report-hook.sh'), 'utf8');
  const m = sh.match(/^\s*_TE_KEEP='([^']+)'/m);
  assert.ok(m, 'CONTROL: _TE_KEEP not found in install/kosmos-report-hook.sh');
  assert.deepEqual(hook.TURN_END_KEEP.source.split('|').sort(), m[1].split('|').sort(),
    'the two hooks would classify the same board answer differently');
});

test('kosmos#8230: a board serving another Kosmos (421) is neither retried nor noted', async () => {
  const other = reply('{"error":"this board serves another Kosmos","wrongWorld":true}', 421);
  const r = await run('Stop', { answers: [other, other] });
  assert.deepEqual(r.sent, ['idle'], 'a 421 was retried');
  assert.equal(r.note, null, 'a 421 was noted');
  const control = await run('Stop', { answers: [reply('{"error":"something broke"}', 500), reply('{"error":"something broke"}', 500)] });
  assert.deepEqual(control.sent, ['idle', 'idle'], 'CONTROL: another failed answer is retried');
});

test('kosmos#8230: a send that runs out of time is a busy board: noted at once, not retried, as on the Mac', async () => {
  const abort = () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; };
  const throttleDir = fs.mkdtempSync(path.join(SANDBOX, 'thr-'));
  let sent = 0;
  await hook.main({
    input: evt('Stop'), env: { KOSMOS_AGENT_TOKEN: AGENT }, uid: -1, url: 'http://127.0.0.1:1', boardToken: BOARD,
    platform: 'win32', ppid: 4242, throttleDir, now: () => 1000, stdout: () => {}, retryPauseMs: 5, sleep: async () => {},
    proveBoard: async () => true, fetchImpl: async () => { sent += 1; abort(); },
  });
  assert.equal(sent, 1, 'a timed-out send was sent again');
  const note = fs.readFileSync(path.join(throttleDir, 'turn-end-failures.log'), 'utf8');
  assert.match(note, /idle not delivered, the board was too busy \(not retried\): the board did not answer the report in time/);

  // CONTROL: a send whose connection failed (not our timeout) is retried.
  let tries = 0;
  await hook.main({
    input: evt('Stop'), env: { KOSMOS_AGENT_TOKEN: AGENT }, uid: -1, url: 'http://127.0.0.1:1', boardToken: BOARD,
    platform: 'win32', ppid: 4242, throttleDir: fs.mkdtempSync(path.join(SANDBOX, 'thr-')), now: () => 1000,
    stdout: () => {}, retryPauseMs: 5, sleep: async () => {},
    proveBoard: async () => true, fetchImpl: async () => { tries += 1; throw new Error('fetch failed'); },
  });
  assert.equal(tries, 2, 'a failed connection was not retried');
});

/* kosmos#8233: Windows refuses a connect to a closed local port at once (Homer measured median 0 ms, max 2 ms), so a
   retry whose proof times out after a refused first try met a board that came up busy, and it is noted, as on the Mac. */
test('kosmos#8233: a busy board on the retry, after a refused first try, is noted after a retry', async () => {
  const gone = { ok: false, why: 'request failed: ECONNREFUSED' };
  const r = await run('Stop', { proofs: [gone, { ok: false, why: 'timed out' }] });
  assert.equal(r.asked.length, 2);
  assert.match(r.note || '', /after a retry: the board did not answer in time/, 'a busy board after a refused first try was not noted');
  // CONTROL: refused twice is no board at all, retried and not noted.
  const twice = await run('Stop', { proofs: [gone, gone] });
  assert.equal(twice.asked.length, 2);
  assert.equal(twice.note, null, 'a closed board was noted');
});

test('kosmos#8233: our own timeout while the answer\'s body is still arriving: not resent, noted as unconfirmed', async () => {
  const abortErr = () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; return e; };
  const slowBody = { ok: true, status: 200, text: async () => { throw abortErr(); } };
  const r = await run('Stop', { answers: [slowBody, slowBody] });
  assert.equal(r.sent.length, 1, 'a send cut off mid-body was sent again');
  assert.match(r.note || '', /idle unconfirmed \(not retried\): the board answered 200 but its answer was cut off/);
  assert.doesNotMatch(r.note || '', /not delivered|too busy/, 'a board that answered was noted as busy or not delivered');
  // CONTROL: a body that fails for any other reason is an ordinary loss, retried once.
  const broken = { ok: true, status: 200, text: async () => { throw new Error('terminated'); } };
  const c = await run('Stop', { answers: [broken, broken] });
  assert.equal(c.sent.length, 2, 'a body that failed (not our timeout) was not retried');
  assert.match(c.note || '', /after a retry/);
});

test('kosmos#8233: a cut-off answer is noted as unconfirmed on the retry and on the noRetry path too', async () => {
  const abortErr = () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; return e; };
  const cut = { ok: true, status: 200, text: async () => { throw abortErr(); } };
  const retried = await run('Stop', { proofs: [{ ok: false, why: 'answer is not a proof' }, true], answers: [cut] });
  assert.equal(retried.sent.length, 1, 'the retry did not send');
  assert.match(retried.note || '', /idle unconfirmed after a retry: the board answered 200 but its answer was cut off/);
  const once = await run('Stop', { noRetry: true, answers: [cut] });
  assert.equal(once.sent.length, 1);
  assert.match(once.note || '', /idle unconfirmed \(not retried: its caller does not wait\): the board answered 200 but its answer was cut off/);
});

test('kosmos#8233: a SessionStart whose answer is cut off says reporting is unconfirmed, not OFF', async () => {
  const abortErr = () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; return e; };
  const said = [];
  const go = (fetchImpl) => hook.main({
    input: evt('SessionStart'), env: { KOSMOS_AGENT_TOKEN: AGENT }, uid: -1, url: 'http://127.0.0.1:1', boardToken: BOARD,
    platform: 'win32', ppid: 4242, throttleDir: fs.mkdtempSync(path.join(SANDBOX, 'thr-')), now: () => 1000,
    stdout: (s) => said.push(s), sleep: async () => {}, proveBoard: async () => true, fetchImpl,
  });
  await go(async () => ({ ok: true, status: 200, text: async () => { throw abortErr(); } }));
  const msg = said.join('');
  assert.match(msg, /could not confirm that reporting works for this session: the board answered 200 but its answer was cut off/);
  assert.doesNotMatch(msg, /reporting is OFF/, 'a board that answered was reported OFF');
  // CONTROL: a board that cannot be reached still says OFF.
  said.length = 0;
  await go(async () => { throw new Error('fetch failed'); });
  assert.match(said.join(''), /Kosmos reporting is OFF for this session: the board could not be reached \(fetch failed\)/);
});
