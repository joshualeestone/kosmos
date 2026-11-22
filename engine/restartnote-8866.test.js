'use strict';
/**
 * kosmos#8866: several restarts within a few days read as separate notes, so the person saw events and not the pattern
 * (a memory blue screen, more than once). Each note keeps its boot time; a note made when 3 or more fall within 7 days
 * carries the count and their dates, and the page says it once. Sandboxed data root before the require.
 *
 *   node --test engine/restartnote-8866.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-restartnote-8866-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const rn = require('./restartnote');
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-20T12:00:00Z');
function clean() { for (const f of Object.values(rn._files)) fs.rmSync(f(), { force: true }); rn.resetForTests(); }
/* One restart at `bootAt`: the board was alive a minute before the boot and comes back two minutes after it, started
   by its supervisor, which is the shape every note is made from. */
function restartAt(bootAt) {
  fs.mkdirSync(path.dirname(rn._files.aliveFile()), { recursive: true });
  fs.writeFileSync(rn._files.aliveFile(), JSON.stringify({ at: new Date(bootAt - 60 * 1000).toISOString() }));
  const now = bootAt + 2 * 60 * 1000;
  return rn.atStart({ now: () => now, uptime: () => (now - bootAt) / 1000, startedBy: 'supervisor' });
}

test('#8866: one restart makes today\'s note and no pattern (the control)', () => {
  clean();
  const note = restartAt(T0);
  assert.ok(note, 'fixture: the restart made no note');
  assert.equal(note.pattern, undefined);
  assert.equal(rn.current(T0 + 3 * 60 * 1000).pattern, undefined);
});

test('#8866: the third restart within 7 days carries the count and the three dates, and the page is sent them', () => {
  clean();
  assert.equal(restartAt(T0).pattern, undefined);
  assert.equal(restartAt(T0 + 2 * DAY).pattern, undefined, 'two restarts are not a pattern');
  const third = restartAt(T0 + 4 * DAY);
  assert.ok(third && third.pattern, 'the third restart within 7 days had no pattern');
  assert.equal(third.pattern.count, 3);
  assert.deepEqual(third.pattern.dates.map(Date.parse), [T0, T0 + 2 * DAY, T0 + 4 * DAY]);
  const shown = rn.current(T0 + 4 * DAY + 3 * 60 * 1000);
  assert.equal(shown.pattern.count, 3);
  assert.deepEqual(rn.publicNote(shown, {}).pattern, shown.pattern, 'the route sends the pattern');
});

test('#8866: restarts spread wider than 7 days are no pattern; the same boot read twice is counted once', () => {
  clean();
  restartAt(T0); restartAt(T0 + 4 * DAY);
  assert.equal(restartAt(T0 + 9 * DAY).pattern, undefined, 'the first one is 9 days back, outside the window');
  clean();
  restartAt(T0); restartAt(T0 + DAY);
  assert.equal(restartAt(T0 + DAY).pattern, undefined, 'the same boot twice is one restart');
});

test('#8866: patternOf is the rule on its own; a damaged history is no pattern, never a guessed one', () => {
  const now = T0 + 6 * DAY;
  assert.equal(rn.patternOf([T0, T0 + DAY], now), null);
  assert.equal(rn.patternOf([T0, T0 + DAY, T0 + 2 * DAY], now).count, 3);
  assert.equal(rn.patternOf([T0 - 2 * DAY, T0 + DAY, T0 + 2 * DAY], now), null, 'one of the three is older than 7 days');
  clean();
  fs.mkdirSync(path.dirname(rn._files.historyFile()), { recursive: true });
  fs.writeFileSync(rn._files.historyFile(), '{"at": ["not a date", 42, null]}');
  assert.equal(restartAt(T0).pattern, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(rn._files.historyFile(), 'utf8')).at.map(Date.parse), [T0], 'the damaged entries were dropped');
});
