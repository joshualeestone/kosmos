'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7212 (#7615 item 1, Josh's 0.7.75 report: an agent unreachable for ten days, and nobody told): a stall the
 * board says is also pushed to the person's phone as needs-you, as a crash loop or a stuck terminal is.
 *
 *   node --test engine/stallpush-7212.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ds = require('./deliverystreak');

const MIN = 60 * 1000;
const T0 = Date.parse('2026-10-30T12:00:00Z');
const refused = { state: 'could_not', because: 'x' };

test.beforeEach(() => ds.resetForTests());

test('a stall said once is one needs-you event, named by its session and since; again only after a day', () => {
  for (let i = 0; i < 3; i += 1) ds.note('s-ada', refused, T0 + i * MIN);
  ds.note('s-ada', refused, T0 + 31 * MIN);
  const said = new Map();
  const card = { sessionName: 's-ada', name: 'Ada' };
  const first = ds.stallsToSay(['s-ada'], said, { now: T0 + 32 * MIN });
  assert.equal(first.length, 1, 'CONTROL: the stall is said');
  assert.deepEqual(ds.stallEvent(card, first[0], T0 + 32 * MIN),
    { kind: 'needs_you', id: 'stall:s-ada:' + new Date(T0).toISOString() + ':0', agent: 'Ada', session: 's-ada', project: null, stall: true });
  assert.equal(ds.stallsToSay(['s-ada'], said, { now: T0 + 40 * MIN }).length, 0, 'said (and so pushed) again the next minute');
  ds.note('s-ada', refused, T0 + 24 * 60 * MIN);
  assert.equal(ds.stallsToSay(['s-ada'], said, { now: T0 + 24 * 60 * MIN + 33 * MIN }).length, 1, 'a day later it was not said again');
  assert.match(ds.stallEvent(card, first[0], T0 + 24 * 60 * MIN + 33 * MIN).id, /:1$/, 'a day later, the same id: the second day is not its own event');
});

test('a run of usage-limit holds the card already shows is not a stall, so nothing is pushed', () => {
  const limit = { state: 'could_not', held: true, heldBy: 'limit' };
  for (let i = 0; i < 4; i += 1) ds.note('s-bo', limit, T0 + i * 10 * MIN);
  assert.deepEqual(ds.stallsToSay(['s-bo'], new Map(), { now: T0 + 35 * MIN, limitShownOf: () => true }), []);
  assert.equal(ds.stallsToSay(['s-bo'], new Map(), { now: T0 + 35 * MIN, limitShownOf: () => false }).length, 1, 'CONTROL: unshown, it is one');
});

test('a stuck Windows turn is told once per step, with a turn: id; without tell, turnsToSay is unchanged', () => {
  const st = { since: '2026-10-30T10:00:00.000Z', count: 2, lastWhy: 'turn', step: 'running "x"' };
  const card = { sessionName: 's-cy', name: 'Cy', deliveryStall: st };
  const told = [];
  const said = new Map();
  const lines = ds.turnsToSay([card], said, (c, s) => told.push(ds.stallEvent(c, s, Date.parse('2026-10-30T11:30:00Z'))));
  assert.equal(lines.length, 1);
  assert.deepEqual(told, [{ kind: 'needs_you', id: 'turn:s-cy:2026-10-30T10:00:00.000Z:0', agent: 'Cy', session: 's-cy', project: null, stall: true }]);
  ds.turnsToSay([card], said, (c, s) => told.push(ds.stallEvent(c, s)));
  assert.equal(told.length, 1, 'the same stuck step was told twice');
  assert.equal(ds.turnsToSay([{ ...card, sessionName: 's-dee' }], new Map()).length, 1, 'CONTROL: no tell, still says the line');
  assert.equal(ds.turnsToSay([{ ...card, sessionName: 's-eve' }], new Map(), () => { throw new Error('x'); }).length, 1, 'a tell that throws lost the line');
});

test('stallEvent names nothing it cannot name', () => {
  assert.equal(ds.stallEvent(null, { since: 'x' }), null);
  assert.equal(ds.stallEvent({ sessionName: '' }, { since: 'x' }), null);
  assert.equal(ds.stallEvent({ sessionName: 's' }, {}), null);
  assert.equal(ds.stallEvent({ sessionName: 's' }, { since: 'x' }).agent, 's', 'no name: the session');
});

test('the board pushes each stall it says (server.js sayStalls)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const sayStalls = () => {');
  assert.ok(at > 0, 'CONTROL: sayStalls is found');
  const body = src.slice(at, src.indexOf('} catch { /* said next minute */ }', at));
  assert.match(body, /const ev = ds\.stallEvent\(card, st, now\); if \(ev && ds\.pushDue\(ev\.session, now, STALL_PUSH_FILE\)\) phonenotify\.happened\(ev\);/, 'a stall push does not go through the once-a-day gate');
  assert.match(body, /ds\.turnsToSay\(r, turnSaid, tellStall\)/, 'a stuck turn is not pushed');
  assert.match(body, /process\.stdout\.write\(ds\.stallLine\(st\)\);\n\s+try \{ tellStall\(byName\.get\(st\.name\), st\); \}/, 'a stall is not pushed where it is said');
});

test('review 1 W1/W3: one agent is told at most once a day, across a restart and a stall that ends and starts again', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aw-stallpush-'));
  const file = path.join(dir, 'stall-pushes.json');
  assert.equal(ds.pushDue('s-ada', T0, file), true, 'the first stall was not told');
  assert.equal(ds.pushDue('s-ada', T0 + 40 * MIN, file), false, 'a stall that ended and started again was told again within the day');
  assert.equal(ds.pushDue('s-bo', T0 + 40 * MIN, file), true, 'CONTROL: another agent is told');
  /* A restart: nothing in memory, only the file. */
  delete require.cache[require.resolve('./deliverystreak')];
  const fresh = require('./deliverystreak');
  assert.equal(fresh.pushDue('s-ada', T0 + 60 * MIN, file), false, 'a board restart told the person again');
  assert.equal(fresh.pushDue('s-ada', T0 + ds.PUSH_GAP_MS, file), true, 'a day later it was not told again');
  assert.equal(fresh.pushDue('', T0, file), false);
  /* A record that cannot be written still tells (the in-memory said marks hold it to once a day while the board runs). */
  const blocked = path.join(dir, 'blocked');
  fs.writeFileSync(blocked, 'not a folder');
  assert.equal(fresh.pushDue('s-cy', T0, path.join(blocked, 'stall-pushes.json')), true, 'an unwritable record silenced the push');
});
