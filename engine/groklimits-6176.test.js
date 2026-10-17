'use strict';
/**
 * #6176 slice 3: engine/groklimits.js reads a Grok subscription's usage from Grok's own log. The lines are written in
 * the shape measured on a real Grok log (2026-09-29): msg "billing: fetched credits config" with ctx.config's
 * creditUsagePercent and currentPeriod { type, start, end }.
 *
 *   node --test engine/groklimits-6176.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const groklimits = require('./groklimits');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'groklimits-6176-'));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
const DAY = 864e5;
const NOW = Date.parse('2026-10-16T12:00:00Z');
let n = 0;
function home(lines) {
  const h = path.join(ROOT, 'h' + (n++));
  fs.mkdirSync(path.join(h, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(h, 'logs', 'unified.jsonl'), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return h;
}
const billing = (ts, pct, start, end, tier = 'SuperGrok') => ({ ts: new Date(ts).toISOString(), lvl: 'info', src: 'shell', pid: 1, sid: 's',
  ver: '1', msg: 'billing: fetched credits config', ctx: { config: { creditUsagePercent: pct, currentPeriod: {
    type: 'USAGE_PERIOD_TYPE_WEEKLY', start: new Date(start).toISOString(), end: new Date(end).toISOString() } }, subscriptionTier: tier } });
const other = (ts) => ({ ts: new Date(ts).toISOString(), lvl: 'info', src: 'shell', msg: 'session.setup.phase', ctx: { phase: 'x' } });

test('#6176: the newest billing line in a current period is the reading, with its plan and its own time', () => {
  const h = home([billing(NOW - 2 * DAY, 40, NOW - 3 * DAY, NOW + 4 * DAY), other(NOW - DAY), billing(NOW - DAY, 62.5, NOW - 3 * DAY, NOW + 4 * DAY), other(NOW)]);
  const r = groklimits.read(h, NOW);
  assert.deepEqual(r, { windows: [{ usedPct: 62.5, windowMinutes: 7 * 1440, resetsAt: NOW + 4 * DAY }], plan: 'SuperGrok', at: NOW - DAY });
});

test('#6176: a reading whose period is over is dropped, even when an older line was in a later period', () => {
  const h = home([billing(NOW - 9 * DAY, 30, NOW - 10 * DAY, NOW + DAY), billing(NOW - 5 * DAY, 67, NOW - 10 * DAY, NOW - 3 * DAY)]);
  assert.equal(groklimits.read(h, NOW), null, 'an over period showed a figure, or an older line answered for the newest');
  assert.notEqual(groklimits.read(h, NOW - 4 * DAY), null, 'CONTROL: the same line inside its period is read');
});

test('#6176: no log, no billing line, or an empty home gives nothing', () => {
  assert.equal(groklimits.read(path.join(ROOT, 'missing'), NOW), null);
  assert.equal(groklimits.read(home([other(NOW)]), NOW), null);
  assert.equal(groklimits.read('', NOW), null);
});

test('#6176: a line whose shape is not the measured one is skipped; the newest good line answers', () => {
  const good = billing(NOW - 2 * DAY, 50, NOW - 3 * DAY, NOW + 4 * DAY);
  const bad = [
    { ...good, ts: new Date(NOW - DAY).toISOString(), ctx: { config: { creditUsagePercent: 'x', currentPeriod: good.ctx.config.currentPeriod } } },
    { ...good, ts: new Date(NOW - DAY).toISOString(), ctx: { config: { creditUsagePercent: 10 } } },
    { ...good, ts: new Date(NOW - DAY).toISOString(), ctx: { config: { creditUsagePercent: 10, currentPeriod: { start: 'x', end: 'y' } } } },
    '{"msg": "billing: fetched credits config", not json',
  ];
  const r = groklimits.read(home([good, ...bad]), NOW);
  assert.equal(r && r.windows[0].usedPct, 50, 'a malformed newer line answered, or blocked the good one');
  assert.equal(groklimits.readingOfRow({ ...good, msg: 'billing: something else' }), null);
});

test('#6176: a reading under more than 256 KB of later logging is still found (a busy day, measured)', () => {
  const filler = [];
  for (let i = 0; i < 4000; i++) filler.push(other(NOW - DAY + i));   // well over 256 KB of newer lines
  const h = home([billing(NOW - 2 * DAY, 71, NOW - 3 * DAY, NOW + 4 * DAY), ...filler]);
  assert.ok(fs.statSync(path.join(h, 'logs', 'unified.jsonl')).size > 300 * 1024, 'CONTROL: the filler pushes the line past 256 KB');
  assert.equal(groklimits.read(h, NOW) && groklimits.read(h, NOW).windows[0].usedPct, 71);
});

test('#6176 review 1: a reading from an earlier sign-in in the same folder is not this account usage', () => {
  const h = home([billing(NOW - 2 * DAY, 80, NOW - 3 * DAY, NOW + 4 * DAY)]);
  const rec = path.join(ROOT, 'signins-' + (n++) + '.json');
  const auth = path.join(h, 'auth.json');
  const signIn = (uuid, at) => { fs.writeFileSync(auth, JSON.stringify({ ['https://auth.x.ai::' + uuid]: { user_id: uuid, refresh_token: 'r' } })); fs.utimesSync(auth, new Date(at), new Date(at)); };
  signIn('first', NOW - 5 * DAY);
  const s1 = groklimits.signedInSince(h, rec);
  assert.equal(s1, NOW - 5 * DAY);
  assert.equal(groklimits.read(h, NOW, s1).windows[0].usedPct, 80, 'CONTROL: the reading after the sign-in counts');
  // A token refresh rewrites auth.json under the same login: its start does not move.
  signIn('first', NOW - DAY);
  assert.equal(groklimits.signedInSince(h, rec), NOW - 5 * DAY, 'a token refresh moved the sign-in start');
  // Another login in the same folder, after the reading: the reading is the earlier login's.
  signIn('second', NOW - DAY);
  const s2 = groklimits.signedInSince(h, rec);
  assert.equal(s2, NOW - DAY);
  assert.equal(groklimits.read(h, NOW, s2), null, 'an earlier login reading showed as this account usage');
});

test('#6176 review 1: the real line spelling (microseconds, +00:00) is read', () => {
  const real = '{"ts":"2026-10-15T12:00:00.123Z","lvl":"info","src":"shell","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":67.0,"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","start":"2026-10-12T21:28:35.312657+00:00","end":"2026-10-19T21:28:35.312657+00:00"}},"subscriptionTier":"X Premium"}}';
  const r = groklimits.read(home([real]), NOW);
  assert.equal(r && r.windows[0].windowMinutes, 10080);
  assert.equal(r.windows[0].resetsAt, Date.parse('2026-10-19T21:28:35.312Z'));
});
