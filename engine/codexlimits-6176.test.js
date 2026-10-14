'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#6176 slice 2: an OpenAI (Codex) account's limits, read from Codex's own session files. Fixtures use the row
 * shape measured on this computer (2026-10-14): a token_count event whose payload carries rate_limits.
 *
 *   node --test engine/codexlimits-6176.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'codexlimits-6176-')));
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });
const codexlimits = require('./codexlimits');

const NOW = Date.UTC(2026, 9, 14, 18);
const S = (ms) => Math.floor(ms / 1000);
let n = 0;
const home = () => fs.mkdtempSync(path.join(SB, 'codex-' + (n++) + '-'));
const tokenRow = (iso, rl) => ({ timestamp: iso, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10 } }, rate_limits: rl } });
const rl = (primary, secondary) => ({ limit_id: 'codex', limit_name: null, primary, secondary, credits: { has_credits: false, unlimited: false, balance: '0' }, plan_type: 'prolite', rate_limit_reached_type: null });
const win = (pct, mins, resetMs) => ({ used_percent: pct, window_minutes: mins, resets_at: S(resetMs) });
function writeRollout(h, day, stamp, rows, pad = '') {
  const dir = path.join(h, 'sessions', '2026', '10', day);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rollout-2026-10-' + day + 'T' + stamp + '-abc.jsonl');
  fs.writeFileSync(file, pad + rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

test('the newest report in the newest file wins', () => {
  const h = home();
  writeRollout(h, '13', '09-00-00', [tokenRow('2026-10-13T09:00:00Z', rl(win(90, 10080, NOW + 3 * 864e5), null))]);
  writeRollout(h, '14', '10-00-00', [
    tokenRow('2026-10-14T10:00:00Z', rl(win(20, 10080, NOW + 3 * 864e5), null)),
    tokenRow('2026-10-14T11:00:00Z', rl(win(25, 10080, NOW + 3 * 864e5), null)),
  ]);
  const r = codexlimits.read(h, NOW);
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].usedPct, 25);
  assert.equal(r.windows[0].windowMinutes, 10080);
  assert.equal(r.windows[0].resetsAt, S(NOW + 3 * 864e5) * 1000, 'resets_at is seconds; the reader gives ms');
  assert.equal(r.at, Date.parse('2026-10-14T11:00:00Z'));
  assert.equal(r.plan, 'prolite');
});

test('both windows are read when Codex reports both', () => {
  const h = home();
  writeRollout(h, '14', '10-00-00', [tokenRow('2026-10-14T10:00:00Z', rl(win(64, 300, NOW + 2 * 36e5), win(30, 10080, NOW + 4 * 864e5)))]);
  const r = codexlimits.read(h, NOW);
  assert.deepEqual(r.windows.map((w) => [w.usedPct, w.windowMinutes]), [[64, 300], [30, 10080]]);
});

test('a window whose reset has passed is dropped; when all have, there is no reading', () => {
  const h = home();
  writeRollout(h, '14', '10-00-00', [tokenRow('2026-10-14T10:00:00Z', rl(win(99, 300, NOW - 60e3), win(30, 10080, NOW + 864e5)))]);
  assert.deepEqual(codexlimits.read(h, NOW).windows.map((w) => w.windowMinutes), [10080]);
  const h2 = home();
  writeRollout(h2, '14', '10-00-00', [tokenRow('2026-10-14T10:00:00Z', rl(win(99, 300, NOW - 60e3), null))]);
  assert.equal(codexlimits.read(h2, NOW), null);
});

test('the newest report decides: an over window in it is not replaced by an older file', () => {
  const h = home();
  writeRollout(h, '13', '09-00-00', [tokenRow('2026-10-13T09:00:00Z', rl(win(50, 10080, NOW + 864e5), null))]);
  writeRollout(h, '14', '10-00-00', [tokenRow('2026-10-14T10:00:00Z', rl(win(99, 300, NOW - 60e3), null))]);
  assert.equal(codexlimits.read(h, NOW), null);
});

test('a file with no report falls back to the next most recent, and the latest report wins', () => {
  const h = home();
  writeRollout(h, '10', '09-00-00', [tokenRow('2026-10-10T09:00:00Z', rl(win(70, 10080, NOW + 864e5), null))]);
  for (const d of ['11', '12', '13']) writeRollout(h, d, '09-00-00', [{ timestamp: '2026-10-' + d + 'T09:00:00Z', type: 'event_msg', payload: { type: 'task_started' } }]);
  assert.equal(codexlimits.read(h, NOW).windows[0].usedPct, 70, 'three quiet files after it: the fourth file is still read');
  writeRollout(h, '12', '10-00-00', [tokenRow('2026-10-12T10:00:00Z', rl(win(40, 10080, NOW + 864e5), null))]);
  assert.equal(codexlimits.read(h, NOW).windows[0].usedPct, 40);
});

const touch = (f, ms) => fs.utimesSync(f, new Date(ms), new Date(ms));

test('a resumed session (older name, written later) is read: write time decides, not the name', () => {
  const h = home();
  const resumed = writeRollout(h, '13', '09-00-00', [tokenRow('2026-10-14T11:30:00Z', rl(win(55, 10080, NOW + 864e5), null))]);
  // Three sessions started later than it (by name), none written since 10:05: ranked by name, the resumed file would
  // not be among the three read at all; ranked by when it was written, it is first.
  for (const [d, t] of [['14', '10-00-00'], ['14', '10-01-00'], ['14', '10-02-00']]) {
    const f = writeRollout(h, d, t, [tokenRow('2026-10-14T10:05:00Z', rl(win(20, 10080, NOW + 864e5), null))]);
    touch(f, Date.parse('2026-10-14T10:05:00Z'));
  }
  touch(resumed, Date.parse('2026-10-14T11:30:00Z'));
  assert.equal(codexlimits.read(h, NOW).windows[0].usedPct, 55);
});

test('the latest report wins across files, so an over report in a newer-named file does not hide a live one', () => {
  const h = home();
  const live = writeRollout(h, '13', '09-00-00', [tokenRow('2026-10-14T11:00:00Z', rl(win(44, 10080, NOW + 864e5), null))]);
  const over = writeRollout(h, '14', '10-00-00', [tokenRow('2026-10-14T10:00:00Z', rl(win(99, 300, NOW - 60e3), null))]);
  touch(over, Date.parse('2026-10-14T10:00:00Z')); touch(live, Date.parse('2026-10-14T11:00:00Z'));
  assert.equal(codexlimits.read(h, NOW).windows[0].usedPct, 44);
});

test('only the newest seven day folders are listed: a report eight days back is not looked for', () => {
  const h = home();
  const old = writeRollout(h, '01', '09-00-00', [tokenRow('2026-10-14T11:00:00Z', rl(win(70, 10080, NOW + 864e5), null))]);
  touch(old, NOW - 60e3);   // written recently, but its folder is eight folders back
  for (const d of ['02', '03', '04', '05', '06', '07', '08']) writeRollout(h, d, '09-00-00', [{ timestamp: '2026-10-' + d + 'T09:00:00Z', type: 'event_msg', payload: { type: 'task_started' } }]);
  assert.equal(codexlimits.DAYS_LISTED, 7);
  assert.equal(codexlimits.read(h, NOW), null);
});

test('busy sessions with no report do not hide one that has it; six files is the most read', () => {
  const h = home();
  const rep = writeRollout(h, '14', '08-00-00', [tokenRow('2026-10-14T08:30:00Z', rl(win(61, 10080, NOW + 864e5), null))]);
  touch(rep, Date.parse('2026-10-14T08:30:00Z'));
  const quiet = (t, ms) => { const f = writeRollout(h, '14', t, [{ timestamp: '2026-10-14T09:00:00Z', type: 'event_msg', payload: { type: 'task_started' } }]); touch(f, ms); };
  for (const [i, t] of ['09-00-00', '09-01-00', '09-02-00'].entries()) quiet(t, Date.parse('2026-10-14T09:00:00Z') + i * 1000);
  assert.equal(codexlimits.read(h, NOW).windows[0].usedPct, 61, 'three quiet files are skipped, the fourth is read');
  for (const [i, t] of ['09-03-00', '09-04-00', '09-05-00'].entries()) quiet(t, Date.parse('2026-10-14T09:10:00Z') + i * 1000);
  assert.equal(codexlimits.FILES_MAX, 6);
  assert.equal(codexlimits.read(h, NOW), null, 'six quiet files newer than it: it is the seventh and is not read');
});

test('the latest report decides even when it names no current window (an older figure does not come back)', () => {
  const h = home();
  writeRollout(h, '14', '10-00-00', [
    tokenRow('2026-10-14T09:00:00Z', rl(win(33, 10080, NOW + 864e5), null)),
    tokenRow('2026-10-14T10:00:00Z', rl({ used_percent: 'x', window_minutes: 300, resets_at: S(NOW + 36e5) }, null)),
  ]);
  assert.equal(codexlimits.read(h, NOW), null);
});

test('only the account\'s own bucket counts (limit_id "codex" or none)', () => {
  const h = home();
  const other = rl(win(95, 300, NOW + 36e5), null); other.limit_id = 'some-model';
  const mine = rl(win(22, 10080, NOW + 864e5), null); delete mine.limit_id;
  writeRollout(h, '14', '10-00-00', [tokenRow('2026-10-14T09:00:00Z', mine), tokenRow('2026-10-14T10:00:00Z', other)]);
  assert.equal(codexlimits.read(h, NOW).windows[0].usedPct, 22, 'another bucket is not the plan limit');
});

test('several homes: the account folder and its agents\' private ones are read together, latest report wins', () => {
  const acct = home(), agentA = home(), agentB = home();
  const f1 = writeRollout(acct, '13', '09-00-00', [tokenRow('2026-10-13T09:00:00Z', rl(win(10, 10080, NOW + 864e5), null))]);
  const f2 = writeRollout(agentA, '14', '09-00-00', [tokenRow('2026-10-14T09:00:00Z', rl(win(48, 10080, NOW + 864e5), null))]);
  const f3 = writeRollout(agentB, '14', '08-00-00', [tokenRow('2026-10-14T08:00:00Z', rl(win(30, 10080, NOW + 864e5), null))]);
  touch(f1, Date.parse('2026-10-13T09:00:00Z')); touch(f2, Date.parse('2026-10-14T09:00:00Z')); touch(f3, Date.parse('2026-10-14T08:00:00Z'));
  assert.equal(codexlimits.read([acct, agentA, agentB], NOW).windows[0].usedPct, 48);
  assert.equal(codexlimits.read([acct], NOW).windows[0].usedPct, 10, 'the account folder alone sees only its own');
  assert.equal(codexlimits.read([], NOW), null);
});

test('a large file is read from its end', () => {
  const h = home();
  const filler = (JSON.stringify({ timestamp: '2026-10-14T09:00:00Z', type: 'response_item', payload: { text: 'x'.repeat(1000) } }) + '\n').repeat(600);   // about 600 KB
  writeRollout(h, '14', '10-00-00', [tokenRow('2026-10-14T10:00:00Z', rl(win(12, 10080, NOW + 864e5), null))], filler);
  assert.equal(codexlimits.read(h, NOW).windows[0].usedPct, 12);
});

test('malformed lines and wrong shapes are skipped, never thrown', () => {
  const h = home();
  const dir = path.join(h, 'sessions', '2026', '10', '14');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'rollout-2026-10-14T10-00-00-abc.jsonl'), [
    JSON.stringify(tokenRow('2026-10-14T09:00:00Z', rl(win(33, 10080, NOW + 864e5), null))),
    '{"rate_limits": broken',
    JSON.stringify(tokenRow('not a time', rl(win(80, 10080, NOW + 864e5), null))),
  ].join('\n') + '\n');
  assert.equal(codexlimits.read(h, NOW).windows[0].usedPct, 33, 'a broken line and an undated row after it are skipped');
  assert.equal(codexlimits.read(path.join(SB, 'no-such-home'), NOW), null);
  assert.equal(codexlimits.read('', NOW), null);
  assert.equal(codexlimits.read(null, NOW), null);
});
