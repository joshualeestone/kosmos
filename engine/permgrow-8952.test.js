'use strict';

/* kosmos#8952 slice (d): engine/permgrow.js grows a window whose permission box is cut, and puts it back. The screens are
   real captures (Claude Code 2.1.331, tmux 3.6a, 2026-11-24) of the same 60-line mkdir prompt: at 80x24 (cut, "↑ 50 more
   lines") and at 76 rows (24 + 50 + 2: whole), kept untrimmed. No real tmux is touched: every call goes to a fake. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pg = require('./permgrow');
const status = require('./status');
const chat = require('./chat');

const SCREENS = path.join(__dirname, '..', 'test-support', 'claude-screens');
const CUT = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-60-cut-80x24-2.1.331.txt'), 'utf8');
const WHOLE = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-60-grown-76rows-2.1.331.txt'), 'utf8');
const IDLE = '❯ \n';
const WORLD = 'w1';

const fleet = require('../test-support/fleet');
/* Real cards from the real producers (fixture-discipline). A variation is the real card with one field changed. */
const REAL = fleet.install([fleet.agent('ada', { state: 'needs_you' }), fleet.agent('bo', { state: 'idle' })]).agents;
const ADA = REAL.find((c) => c.sessionName === 'ada');
const S = pg.windowOf(ADA).session;
const card = (over = {}) => ({ ...ADA, ...over });
const win = (over = {}) => ({ session: S, window: '0', panes: 1, attached: 0, size: { w: 80, h: 24 }, mark: null, markRaw: '', ...over });
const grownWin = (over = {}) => win({ size: { w: 80, h: 78 }, mark: { world: WORLD, size: { w: 80, h: 24 } }, markRaw: `80x24@${WORLD}`, ...over });
const WAITING = new Map([['ada', 'ada']]);
const planOf = (o) => pg.plan({ cards: [card()], windows: [win()], waiting: WAITING, skip: new Set(), screenOf: () => CUT, busy: () => false, world: WORLD, ...o });

test('premises, on the real captures', () => {
  const P = { command: '2.1.331', title: '✳ mkdir', session: 'x', name: 'x' };
  assert.equal(chat.permissionAnswerable(CUT), false);
  assert.equal(chat.permissionAnswerable(WHOLE), true);
  assert.equal(chat.permissionCard(WHOLE).detail.split('\n').length, 61, 'all 60 directories and the mkdir line');
  assert.equal(pg.hiddenRows(CUT), 50);
  assert.equal(pg.hiddenRows(WHOLE), null);
  // The reason the window is fitted, not made 200 rows: classify reads the last 25 rows, and blank rows under the box
  // (a screen shorter than the pane) turn needs_you into unknown. The fitted screen has none.
  assert.equal(status.classify(P, CUT).state, status.STATE.NEEDS_YOU);
  assert.equal(status.classify(P, WHOLE).state, status.STATE.NEEDS_YOU, 'the grown pane still reads as needing the person');
  assert.equal(status.classify(P, WHOLE.replace(/\s+$/, '') + '\n'.repeat(26)).state, status.STATE.UNKNOWN, 'control: padding does break it');
});

test('a cut prompt on an unwatched one-pane window grows it by the hidden rows, recording its size', () => {
  assert.deepEqual(planOf({}), { acts: [{ act: 'grow', session: S, window: '0', size: { w: 80, h: 24 }, rows: 24 + 50 + pg.FIT_MARGIN }], judged: [] });
});

test('no grow: whole box, no prompt, unreadable, watched, several panes, busy, not waiting, judged, not Claude, not ours', () => {
  const none = (o) => assert.deepEqual(planOf(o).acts, []);
  none({ screenOf: () => WHOLE });
  none({ screenOf: () => IDLE });
  none({ screenOf: () => null });
  none({ screenOf: () => { throw new Error('x'); } });
  none({ windows: [win({ attached: 1 })] });
  none({ windows: [win({ panes: 2 })] });
  none({ busy: () => true });
  none({ busy: () => { throw new Error('x'); } });
  none({ waiting: new Map() });
  none({ skip: new Set(['ada']) });
  none({ cards: [card({ runner: 'codex' })] });
  none({ cards: [card({ isNamedOurs: false })] });
  none({ cards: [card({ reachedByChannel: true })] });
  none({ windows: [win({ session: 'other' })] });
  none({ windows: [win({ markRaw: 'x', mark: null })] });
});

test('judged: a whole box, a cut box with no hint, or one taller than MAX_ROWS is read once per report', () => {
  assert.deepEqual(planOf({ screenOf: () => WHOLE }).judged, ['ada']);
  assert.deepEqual(planOf({ screenOf: () => CUT.replace(/↑ 50 more lines/, '') }).judged, ['ada'], 'no hint: never guess a height');
  assert.deepEqual(planOf({ screenOf: () => CUT.replace(/↑ 50 more/, '↑ 500 more') }).judged, ['ada']);
  assert.deepEqual(planOf({ screenOf: () => CUT.replace(/↑ 50 more/, '↑ 500 more') }).acts, []);
});

test('a grown window: kept while the prompt is up, restored when gone, watched, agentless or unreadable mark', () => {
  const restore = (size = { w: 80, h: 24 }) => [{ act: 'restore', session: S, window: '0', size }];
  const p = (o) => planOf({ windows: [grownWin()], ...o }).acts;
  assert.deepEqual(p({ screenOf: () => WHOLE }), [], 'prompt still up: keep (and never regrow)');
  assert.deepEqual(p({ screenOf: () => null }), [], 'could not read: keep, ask next tick');
  assert.deepEqual(p({ screenOf: () => IDLE }), restore());
  assert.deepEqual(p({ waiting: new Map(), screenOf: () => IDLE }), restore(), 'restored whether or not a report stands');
  assert.deepEqual(p({ windows: [grownWin({ attached: 1 })], screenOf: () => WHOLE }), restore());
  assert.deepEqual(p({ cards: [], screenOf: () => WHOLE }), restore(), 'no agent there any more');
  assert.deepEqual(p({ windows: [grownWin({ mark: { world: WORLD, size: null }, markRaw: `junk@${WORLD}` })] }), restore(pg.DEFAULT_SIZE),
    'a mark whose size does not read goes back to the size agents start at, never left tall');
  assert.deepEqual(p({ busy: () => true, screenOf: () => IDLE }), [], 'a press is reading the screen: leave it this tick');
});

test('another board on the same tmux server: its marks are never touched, and its windows are not ours to grow', () => {
  const theirs = grownWin({ mark: { world: 'w2', size: { w: 80, h: 24 } }, markRaw: '80x24@w2' });
  assert.deepEqual(planOf({ windows: [theirs], cards: [], screenOf: () => IDLE }).acts, [], 'no card here: still not ours');
  assert.deepEqual(planOf({ windows: [theirs], screenOf: () => IDLE }).acts, []);
});

test('parseWindows and markOf: a grouped session\'s clients count as watching', () => {
  const out = `ada\t0\t1\t0\t0\t80\t78\t80x24@${WORLD}\nbob\t1\t1\t0\t2\t120\t40\t\nbroken line\n`;
  assert.deepEqual(pg.parseWindows(out), [
    { session: 'ada', window: '0', panes: 1, attached: 0, size: { w: 80, h: 78 }, mark: { world: WORLD, size: { w: 80, h: 24 } }, markRaw: `80x24@${WORLD}` },
    { session: 'bob', window: '1', panes: 1, attached: 2, size: { w: 120, h: 40 }, mark: null, markRaw: '' },
  ]);
  assert.equal(pg.markOf('80x24'), null, 'no world: not a mark this code writes');
  assert.deepEqual(pg.windowOf(card({ target: 'a:b:3.0' })), { session: 'a:b', window: '3' });
});

const fakeTmux = (fail = () => false) => {
  const calls = [];
  const fn = (args) => { calls.push(args.join(' ')); return fail(args) ? { ran: true, status: 1, out: '' } : { ran: true, status: 0, out: '' }; };
  return { fn, calls };
};
const GROW = { act: 'grow', session: S, window: '0', size: { w: 80, h: 24 }, rows: 78 };
const RESTORE = { act: 'restore', session: S, window: '0', size: { w: 80, h: 24 } };

test('grow writes the mark BEFORE the resize; restore resizes BEFORE unsetting window-size (measured order)', () => {
  const g = fakeTmux();
  assert.equal(pg.run(GROW, g.fn, WORLD), true);
  assert.deepEqual(g.calls, [`set-option -w -t =${S}:0 @kosmos_permgrow 80x24@${WORLD}`, `resize-window -t =${S}:0 -y 78`]);
  const r = fakeTmux();
  assert.equal(pg.run(RESTORE, r.fn, WORLD), true);
  assert.deepEqual(r.calls, [`resize-window -t =${S}:0 -x 80 -y 24`, `set-option -w -t =${S}:0 -u window-size`, `set-option -w -t =${S}:0 -u @kosmos_permgrow`]);
});

test('a failed grow puts the window back and clears its mark; a failed restore keeps the mark to try again', () => {
  const g = fakeTmux((a) => a[0] === 'resize-window' && a[a.length - 1] === '78');
  assert.equal(pg.run(GROW, g.fn, WORLD), false);
  assert.deepEqual(g.calls.slice(2), [`resize-window -t =${S}:0 -x 80 -y 24`, `set-option -w -t =${S}:0 -u window-size`, `set-option -w -t =${S}:0 -u @kosmos_permgrow`]);
  const r = fakeTmux((a) => a[0] === 'resize-window');
  assert.equal(pg.run(RESTORE, r.fn, WORLD), false);
  assert.ok(!r.calls.includes(`set-option -w -t =${S}:0 -u @kosmos_permgrow`), 'the mark stays, so the next tick restores');
});

const listing = (out, fail = () => false) => {
  const calls = [];
  const fn = (args) => {
    calls.push(args[0]);
    if (args[0] === 'list-windows') return { ran: true, status: 0, out };
    return fail(args) ? { ran: true, status: 1, out: '' } : { ran: true, status: 0, out: '' };
  };
  return { fn, calls };
};
const ROW = `${S}\t0\t1\t0\t\t80\t24\t\n`;
const GROWN_ROW = `${S}\t0\t1\t0\t\t80\t78\t80x24@${WORLD}\n`;
const sweep = (o) => pg.sweepOnce({ world: WORLD, busy: () => false, waits: () => new Map([['ada', 't1']]), screenOf: () => CUT, ...o });

test('sweepOnce: lists, plans and acts; a failed list does nothing; no roster does nothing', () => {
  const t = listing(ROW);
  const done = sweep({ roster: () => [card()], tmux: t.fn });
  assert.deepEqual(done.map((a) => [a.act, a.took]), [['grow', true]]);
  assert.deepEqual(t.calls, ['list-windows', 'set-option', 'resize-window']);
  const dead = [];
  const noRoster = () => { throw new Error('the roster must not be built'); };
  assert.deepEqual(sweep({ roster: noRoster, tmux: (a) => { dead.push(a[0]); return { ran: false, status: null, out: '' }; } }), []);
  assert.deepEqual(dead, ['list-windows']);
  assert.deepEqual(sweep({ roster: () => null, tmux: listing(ROW).fn }), []);
});

test('sweepOnce reads the roster only when it could act, and a judged report is not read again', () => {
  const noRoster = () => { throw new Error('the roster must not be built'); };
  assert.deepEqual(sweep({ roster: noRoster, tmux: listing(ROW).fn, waits: () => new Map() }), [], 'nobody waiting, nothing grown');
  assert.deepEqual(sweep({ roster: noRoster, tmux: listing(`${S}\t0\t1\t0\t\t80\t78\t80x24@w2\n`).fn, waits: () => new Map() }), [], 'only another board\'s mark');
  const memory = pg.newMemory();
  let built = 0;
  const roster = () => { built += 1; return [card()]; };
  assert.deepEqual(sweep({ roster, memory, tmux: listing(ROW).fn, screenOf: () => WHOLE }), []);
  assert.equal(built, 1);
  sweep({ roster, memory, tmux: listing(ROW).fn, screenOf: () => WHOLE });
  assert.equal(built, 1, 'the same report, already judged: no roster, no screen read');
  sweep({ roster, memory, tmux: listing(ROW).fn, screenOf: () => WHOLE, waits: () => new Map([['ada', 't2']]) });
  assert.equal(built, 2, 'a new report is read again');
  const back = sweep({ roster, memory, tmux: listing(GROWN_ROW).fn, screenOf: () => IDLE, waits: () => new Map() });
  assert.equal(built, 3, 'a grown window of ours is always looked at, so it is put back after the report ends');
  assert.deepEqual(back.map((a) => a.act), ['restore']);
});

test('the brake grows nothing and still puts grown windows back', () => {
  const t = listing(ROW);
  assert.deepEqual(sweep({ roster: () => [card()], tmux: t.fn, restoreOnly: true }), []);
  assert.deepEqual(t.calls, ['list-windows']);
  const kept = sweep({ roster: () => [card()], tmux: listing(GROWN_ROW).fn, restoreOnly: true, screenOf: () => WHOLE });
  assert.deepEqual(kept, [], 'prompt still up: even braked, a grown window is put back only when it ends');
  assert.deepEqual(sweep({ roster: () => [card()], tmux: listing(GROWN_ROW).fn, restoreOnly: true, screenOf: () => IDLE }).map((a) => a.act), ['restore']);
});

test('a failing window is left alone for RETRY_AFTER_MS and logged once', () => {
  const memory = pg.newMemory();
  const lines = [];
  const t = listing(GROWN_ROW, (a) => a[0] === 'resize-window');
  const tick = (now) => sweep({ roster: () => [card()], memory, now, tmux: t.fn, screenOf: () => IDLE, log: (l) => lines.push(l) });
  assert.deepEqual(tick(0).map((a) => a.took), [false]);
  assert.deepEqual(tick(1000), [], 'inside the back-off: not tried');
  assert.deepEqual(tick(pg.RETRY_AFTER_MS + 1).map((a) => a.took), [false]);
  assert.equal(lines.length, 1, 'one log line for a window that keeps failing');
});

test('the default screen reader is the thread route\'s (chat.viewport), through chat\'s runner', () => {
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args[0]);
    if (args[0] === 'list-windows') return { ran: true, status: 0, out: ROW };
    if (args[0] === 'capture-pane') return { ran: true, status: 0, out: CUT };
    return { ran: true, status: 0, out: '' };
  });
  try {
    const done = pg.sweepOnce({ roster: () => [card()], world: WORLD, busy: () => false, waits: () => new Map([['ada', 't1']]) });
    assert.deepEqual(done.map((a) => [a.act, a.rows]), [['grow', 24 + 50 + pg.FIT_MARGIN]]);
    assert.deepEqual(calls, ['list-windows', 'capture-pane', 'set-option', 'resize-window']);
  } finally { chat.setRunner(null); }
});
