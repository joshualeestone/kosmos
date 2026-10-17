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
    { ...good, ts: new Date(NOW - DAY).toISOString(), ctx: { config: { creditUsagePercent: -1, currentPeriod: good.ctx.config.currentPeriod } } },
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
  // The real shape: the key's suffix is the app's sign-in client (the same for every login); user_id names the person.
  const signIn = (uuid, at) => { fs.writeFileSync(auth, JSON.stringify({ 'https://auth.x.ai::client-1': { user_id: uuid, refresh_token: 'r' } })); fs.utimesSync(auth, new Date(at), new Date(at)); };
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

test('#6176 review 2: an unchanged log is not read again; a changed one is', () => {
  const h = home([billing(NOW - DAY, 33, NOW - 3 * DAY, NOW + 4 * DAY)]);
  const file = path.join(h, 'logs', 'unified.jsonl');
  assert.equal(groklimits.read(h, NOW).windows[0].usedPct, 33);
  const realOpen = fs.openSync; let opens = 0;
  fs.openSync = (...a) => { if (a[0] === file) opens++; return realOpen(...a); };
  try {
    assert.equal(groklimits.read(h, NOW).windows[0].usedPct, 33);
    assert.equal(opens, 0, 'an unchanged log was read again');
    fs.appendFileSync(file, JSON.stringify(billing(NOW - 60e3, 44, NOW - 3 * DAY, NOW + 4 * DAY)) + '\n');
    assert.equal(groklimits.read(h, NOW).windows[0].usedPct, 44, 'a new reading was not seen');
    assert.ok(opens >= 1, 'CONTROL: the changed log was read');
  } finally { fs.openSync = realOpen; }
});

test('#6176 review 5: a newest billing line with no percent shows no figure, and no older line answers for it', () => {
  const blank = billing(NOW - 60e3, 0, NOW - 3 * DAY, NOW + 4 * DAY);
  delete blank.ctx.config.creditUsagePercent;
  const h = home([billing(NOW - DAY, 40, NOW - 3 * DAY, NOW + 4 * DAY), blank]);
  assert.equal(groklimits.read(h, NOW), null, 'a line with no percent showed a figure (0%, or the older 40%)');
  assert.equal(groklimits.read(home([billing(NOW - DAY, 40, NOW - 3 * DAY, NOW + 4 * DAY)]), NOW).windows[0].usedPct, 40, 'CONTROL: the older line alone is read');
  assert.equal(groklimits.readingOfRow({ ...blank, ctx: { config: { creditUsagePercent: '5', currentPeriod: blank.ctx.config.currentPeriod } } }), null, 'a percent that is not a number was read');
});

test('#6176 review 3: a growing log has only its new bytes read; a replaced log is read again', () => {
  const filler = [];
  for (let i = 0; i < 3000; i++) filler.push(other(NOW - DAY + i));
  const h = home([billing(NOW - 2 * DAY, 20, NOW - 3 * DAY, NOW + 4 * DAY), ...filler]);
  const file = path.join(h, 'logs', 'unified.jsonl');
  assert.equal(groklimits.read(h, NOW).windows[0].usedPct, 20);
  const realRead = fs.readSync; let bytes = 0;
  fs.readSync = (fd, buf, off, len, pos) => { bytes += len; return realRead(fd, buf, off, len, pos); };
  try {
    fs.appendFileSync(file, JSON.stringify(other(NOW - 30e3)) + '\n');
    assert.equal(groklimits.read(h, NOW).windows[0].usedPct, 20, 'the earlier reading was lost when the log grew');
    assert.ok(bytes < 64 * 1024, 'a log that grew by one line was read from its tail again: ' + bytes + ' bytes');
    fs.appendFileSync(file, '{"ts":"' + new Date(NOW - 20e3).toISOString() + '","msg":"billing: fetched credits config","ctx":{"config":{"creditUsagePercent":2');
    fs.appendFileSync(file, '5,"currentPeriod":{"start":"' + new Date(NOW - 3 * DAY).toISOString() + '","end":"' + new Date(NOW + 4 * DAY).toISOString() + '"}}}}\n');
    assert.equal(groklimits.read(h, NOW).windows[0].usedPct, 25, 'CONTROL: a new reading in the new bytes is seen');
  } finally { fs.readSync = realRead; }
  // Replaced by another file (a new inode) of a different history: read again, not served from the cache.
  const tmp = file + '.new';
  fs.writeFileSync(tmp, JSON.stringify(billing(NOW - 60e3, 77, NOW - DAY, NOW + 6 * DAY)) + '\n');
  fs.renameSync(tmp, file);
  assert.equal(groklimits.read(h, NOW).windows[0].usedPct, 77, 'a replaced log was served from the cache');
});

test('#6176 review 4: a line half written at one read is found whole at the next (the overlap)', () => {
  const h = home([billing(NOW - 2 * DAY, 20, NOW - 3 * DAY, NOW + 4 * DAY)]);
  const file = path.join(h, 'logs', 'unified.jsonl');
  assert.equal(groklimits.read(h, NOW).windows[0].usedPct, 20);
  const line = JSON.stringify(billing(NOW - 20e3, 25, NOW - 3 * DAY, NOW + 4 * DAY));
  fs.appendFileSync(file, line.slice(0, 60));
  assert.equal(groklimits.read(h, NOW).windows[0].usedPct, 20, 'CONTROL: the half line is not a reading yet');
  fs.appendFileSync(file, line.slice(60) + '\n');
  assert.equal(groklimits.read(h, NOW).windows[0].usedPct, 25, 'a line split across two reads was never seen');
});

test('#6176 review 4: a log cut shorter is read again; a log with no reading that gains one is seen', () => {
  const h = home([billing(NOW - 2 * DAY, 20, NOW - 3 * DAY, NOW + 4 * DAY), other(NOW - DAY), other(NOW - DAY + 1)]);
  const file = path.join(h, 'logs', 'unified.jsonl');
  assert.equal(groklimits.read(h, NOW).windows[0].usedPct, 20);
  fs.truncateSync(file, 0);
  fs.appendFileSync(file, JSON.stringify(other(NOW)) + '\n');
  assert.equal(groklimits.read(h, NOW), null, 'a cut log still answered from the cache');
  fs.appendFileSync(file, JSON.stringify(billing(NOW - 10e3, 3, NOW - DAY, NOW + 6 * DAY)) + '\n');
  assert.equal(groklimits.read(h, NOW) && groklimits.read(h, NOW).windows[0].usedPct, 3, 'a cached no-reading hid a new one');
});
