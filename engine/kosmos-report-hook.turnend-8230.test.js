'use strict';
/**
 * kosmos#8230: the Windows report hook's turn end (Stop, StopFailure, SessionEnd) follows the bash hook's kosmos#7977
 * rules, so a turn end is never lost in silence:
 *   - it gets the full window (8 s), not the 3 s fire-report window;
 *   - no board at the address: tried once more, not noted;
 *   - a board too busy to prove itself in time: noted at once, not retried;
 *   - any other loss: tried once more, and noted when the second try is lost too;
 *   - the board's own keep (`skipped`), a report it cannot tie to an agent, another account's: no retry, no note;
 *   - only an agent's session (it carries an agent token) notes;
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
async function run(event, { proofs = [true, true], answers = [], env = { KOSMOS_AGENT_TOKEN: AGENT } } = {}) {
  const throttleDir = fs.mkdtempSync(path.join(SANDBOX, 'thr-'));
  const asked = [];
  const sent = [];
  let pi = 0;
  let fi = 0;
  const slept = [];
  await hook.main({
    input: evt(event), env, uid: -1, url: 'http://127.0.0.1:1', boardToken: BOARD, platform: 'win32', ppid: 4242,
    throttleDir, now: () => 1000, stdout: () => {}, retryPauseMs: 5,
    sleep: async (ms) => { slept.push(ms); },
    proveBoard: async (url, token, timeoutMs) => { asked.push(timeoutMs); return proofs[pi++]; },
    fetchImpl: async (u, init) => { sent.push(JSON.parse(init.body).state); return answers[fi++] || reply('{"recorded":true}'); },
  });
  const file = path.join(throttleDir, 'turn-end-failures.log')   // the bash hook's own file name (kosmos#7977);
  const note = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  return { asked, sent, slept, note, throttleDir };
}

test('kosmos#8230: Stop, StopFailure and SessionEnd end a turn and get the full window; other reports do not', () => {
  for (const e of ['Stop', 'StopFailure', 'SessionEnd']) {
    const r = hook.reportFor({ hook_event_name: e });
    assert.equal(r.turnEnd, true, e + ' is not marked as a turn end');
    assert.equal(hook.timeoutFor(r), hook.DEFAULT_TIMEOUT_MS, e + ' does not get the full window');
  }
  const prompt = hook.reportFor({ hook_event_name: 'UserPromptSubmit' });
  assert.equal(prompt.turnEnd, undefined);
  assert.equal(hook.timeoutFor(prompt), hook.SHORT_TIMEOUT_MS, 'CONTROL: a prompt keeps the short window');
  assert.equal(hook.buildBody(hook.reportFor({ hook_event_name: 'Stop' })).turnEnd, undefined, 'the mark went on the wire');
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
  const lost = await run('SessionEnd', { answers: [reply('{"recorded":false,"because":"we could not save that report"}'), reply('{"recorded":false,"because":"we could not save that report"}')] });
  assert.deepEqual(lost.sent, ['stopped', 'stopped']);
  assert.match(lost.note || '', /stopped not delivered after a retry: the board did not record it \(we could not save that report\)/);

  const kept = await run('Stop', { answers: [reply('{"recorded":false,"skipped":"waiting","because":"it is waiting on a person, so an automatic idle did not overwrite it"}')] });
  assert.deepEqual(kept.sent, ['idle'], 'the board\'s keep was retried');
  assert.equal(kept.note, null, 'the board\'s keep was noted');

  const stranger = await run('Stop', { answers: [reply('{"recorded":false,"because":"this board only records a report from the account that started it; run `kosmos report` from that account, or present an agent token"}')] });
  assert.deepEqual(stranger.sent, ['idle']);
  assert.equal(stranger.note, null);
});

test('kosmos#8230: a session with no agent token (the person\'s own Claude) retries but never notes', async () => {
  const bad = { ok: false, why: 'answer is not a proof' };
  const r = await run('Stop', { proofs: [bad, bad], env: {} });
  assert.equal(r.asked.length, 2);
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

test('kosmos#8230: the board names its skip and logs an automatic turn end it refuses before the record', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = src.slice(src.indexOf("if (pathname === '/api/report' && req.method === 'POST') {"));
  assert.match(route.slice(0, 20000), /skipped: String\(kept\.skipped\)/, 'the record\'s skip is not named in the answer');
  const refusals = route.slice(0, 20000).match(/noteTurnEndRefusal\(body, /g) || [];
  assert.equal(refusals.length, 2, 'the roster and sender refusals should both log a refused turn end');
});
