'use strict';

/* kosmos#8952 slice (d): engine/permgrow.js grows a window whose permission box is cut, and puts it back. The screens are
   real captures (Claude Code 2.1.331, tmux 3.6a, 2026-11-24) of ONE 60-line mkdir prompt, each read the way chat.viewport
   reads (capture-pane -J -S -60, untrimmed): at 80x24 (cut, "↑ 50 more lines"), grown to 78 rows (24 + 50 + 4: whole),
   and shrunk back to 80x24 while it was still up. No real tmux is touched: every call goes to a fake. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pg = require('./permgrow');
const status = require('./status');
const chat = require('./chat');

const SCREENS = path.join(__dirname, '..', 'test-support', 'claude-screens');
const CUT = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-60-cut-80x24-2.1.331.txt'), 'utf8');
const WHOLE = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-60-grown-78rows-2.1.331.txt'), 'utf8');
const SHRUNK = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-60-shrunk-under-prompt-80x24-2.1.331.txt'), 'utf8');
const IDLE = '❯ \n';
const WORLD = 'w1';

const fleet = require('../test-support/fleet');
/* Real cards from the real producers (fixture-discipline). A variation is the real card with one field changed. */
const REAL = fleet.install([fleet.agent('ada', { state: 'needs_you' }), fleet.agent('bo', { state: 'idle' })]).agents;
const ADA = REAL.find((c) => c.sessionName === 'ada');
const S = pg.windowOf(ADA).session;
const card = (over = {}) => ({ ...ADA, ...over });
const win = (over = {}) => ({ id: '@1', session: S, window: '0', panes: 1, attached: 0, size: { w: 80, h: 24 }, mark: null, markRaw: '', ...over });
const grownWin = (over = {}) => win({ size: { w: 80, h: 78 }, mark: { world: WORLD, size: { w: 80, h: 24 } }, markRaw: `80x24@${WORLD}`, ...over });
const WAITING = new Map([['ada', 'ada']]);
const REQ = chat.permissionRequestId(chat.permissionCard(WHOLE));
const planOf = (o) => pg.plan({ cards: [card()], windows: [win()], waiting: WAITING, skip: new Set(), screenOf: () => CUT, busy: () => false, world: WORLD,
  grownFor: new Map([['@1', { at: 't1', req: REQ }]]), reportOf: (n) => (n === 'ada' ? 't1' : null), ...o });

test('premises, on the real captures', () => {
  const P = { command: '2.1.331', title: '✳ mkdir', session: 'x', name: 'x' };
  assert.equal(chat.permissionAnswerable(CUT), false);
  assert.equal(chat.permissionAnswerable(WHOLE), true);
  assert.equal(chat.permissionCard(WHOLE).detail.split('\n').length, 61, 'all 60 directories and the mkdir line');
  assert.equal(pg.hiddenRows(CUT), 50);
  /* Review 3: putting a window back while its box is still up must not leave the drawn top in scrollback to be stitched
     to the redrawn tail into a box that looks whole. Measured: Claude Code redraws and the box reads cut again. */
  assert.equal(chat.permissionAnswerable(SHRUNK), false, 'shrunk under the prompt: cut again, no card stitched from scrollback');
  assert.equal(chat.permissionCard(SHRUNK), null);
  assert.equal(pg.hiddenRows(SHRUNK), 50);
  assert.equal(pg.hiddenRows(WHOLE), null);
  // The reason the window is fitted, not made 200 rows: classify reads the last 25 rows, and blank rows under the box
  // (a screen shorter than the pane) turn needs_you into unknown. The fitted screen has none.
  assert.equal(status.classify(P, CUT).state, status.STATE.NEEDS_YOU);
  assert.equal(status.classify(P, WHOLE).state, status.STATE.NEEDS_YOU, 'the grown pane still reads as needing the person');
  assert.equal(status.classify(P, WHOLE.replace(/\s+$/, '') + '\n'.repeat(26)).state, status.STATE.UNKNOWN, 'control: padding does break it');
});

test('a cut prompt on an unwatched one-pane window grows it by the hidden rows, recording its size', () => {
  assert.deepEqual(planOf({}), { acts: [{ act: 'grow', id: '@1', session: S, window: '0', size: { w: 80, h: 24 }, rows: 24 + 50 + pg.FIT_MARGIN, name: 'ada', hidden: 50 }], judged: [], unsure: [], watched: [], seen: [], unreadSeen: [] });
});

test('no grow: whole box, no prompt, unreadable, watched, several panes, busy, not waiting, judged, not Claude, not ours', () => {
  const none = (o) => assert.deepEqual(planOf(o).acts, []);
  none({ screenOf: () => WHOLE });
  none({ screenOf: () => IDLE });
  none({ screenOf: () => null });
  none({ screenOf: () => { throw new Error('x'); } });
  none({ windows: [win({ attached: 1 })] });
  none({ windows: [win({ panes: 2 })] });
  none({ windows: [] });
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

test('judged only on a final verdict (whole, or taller than MAX_ROWS); no prompt yet or no hint yet is unsure', () => {
  const v = (screen) => { const r = planOf({ screenOf: () => screen }); return [r.acts.length, r.judged, r.unsure]; };
  assert.deepEqual(v(WHOLE), [0, ['ada'], []]);
  assert.deepEqual(v(CUT.replace(/↑ 50 more/, '↑ 500 more')), [0, ['ada'], []]);
  assert.deepEqual(v(CUT.replace(/↑ 50 more lines/, '')), [0, [], ['ada']], 'no hint: never guess a height, look again');
  assert.deepEqual(v(IDLE), [0, [], ['ada']], 'the hook can report before the box is drawn: look again');
});

test('a waiting agent this sweep can never grow is settled (no roster every tick); watched or windowless is unsure', () => {
  const v = (o) => { const r = planOf(o); return [r.judged, r.unsure]; };
  assert.deepEqual(v({ cards: [card({ runner: 'codex' })] }), [['ada'], []]);
  assert.deepEqual(v({ cards: [card({ isNamedOurs: false })] }), [['ada'], []]);
  assert.deepEqual(v({ windows: [win({ panes: 2 })] }), [['ada'], []]);
  assert.deepEqual(v({ windows: [grownWin({ mark: { world: 'w2', size: { w: 80, h: 24 } }, markRaw: '80x24@w2' })] }), [['ada'], []]);
  assert.deepEqual(v({ windows: [win({ attached: 1 })] }), [[], []], 'watched: looked at every tick, no budget');
  assert.deepEqual(planOf({ windows: [win({ attached: 1 })] }).watched, [['ada', '@1']]);
  assert.deepEqual(v({ screenOf: () => null }), [[], ['ada']], 'unreadable counts toward the budget');
  assert.deepEqual(v({ windows: [] }), [[], ['ada']]);
  assert.deepEqual(v({ busy: () => true }), [[], []], 'busy is a moment: looked at next tick');
});

test('a grown window: kept while the prompt is up, restored when gone, watched, agentless or unreadable mark', () => {
  const restore = (size = { w: 80, h: 24 }) => [{ act: 'restore', id: '@1', session: S, window: '0', size }];
  const p = (o) => planOf({ windows: [grownWin()], ...o }).acts;
  assert.deepEqual(p({ screenOf: () => WHOLE }), [], 'prompt still up: keep (and never regrow)');
  assert.deepEqual(p({ screenOf: () => null }), [], 'could not read: keep, ask next tick');
  assert.deepEqual(p({ screenOf: () => IDLE }), restore());
  assert.deepEqual(planOf({ windows: [grownWin()], screenOf: () => IDLE }).judged, ['ada'], 'no regrow under the same report: no flapping');
  assert.deepEqual(p({ waiting: new Map(), screenOf: () => IDLE }), restore(), 'restored whether or not a report stands');
  assert.deepEqual(p({ windows: [grownWin({ attached: 1 })], screenOf: () => WHOLE }), restore());
  assert.deepEqual(p({ cards: [], screenOf: () => WHOLE }), restore(), 'no agent there any more');
  assert.deepEqual(p({ windows: [grownWin({ mark: { world: WORLD, size: null }, markRaw: `junk@${WORLD}` })] }), restore(pg.DEFAULT_SIZE),
    'a mark whose size does not read goes back to the size agents start at, never left tall');
  assert.deepEqual(p({ busy: () => true, screenOf: () => IDLE }), [], 'a press is reading the screen: leave it this tick');
  assert.deepEqual(p({ grownFor: new Map([['@1', { at: 't1', req: 'another-request' }]]), screenOf: () => WHOLE }), restore(), 'a DIFFERENT box: put back, grown again only if it needs it');
  assert.deepEqual(p({ waiting: new Map(), screenOf: () => WHOLE }), [], 'the report changed under the SAME box: kept');
  const first = planOf({ windows: [grownWin()], grownFor: new Map(), screenOf: () => WHOLE });
  assert.deepEqual([first.acts, first.seen], [[], [['@1', REQ]]], 'just grown, or a board restart: the box is learned, the size kept');
  assert.deepEqual(p({ restoreOnly: true, screenOf: () => WHOLE }), restore(), 'braked: put back at once');
});

test('a grown window whose box is still (or again) cut grows again by its hint, keeping the recorded size', () => {
  const p = (screen, h = 78) => planOf({ windows: [grownWin({ size: { w: 80, h } })], screenOf: () => screen }).acts;
  assert.deepEqual(p(CUT), [{ act: 'grow', id: '@1', session: S, window: '0', size: { w: 80, h: 24 }, rows: 78 + 50 + pg.FIT_MARGIN, again: true, hidden: 50 }]);
  assert.deepEqual(p(CUT, 190).map((a) => a.act), ['restore'], 'review 6: over MAX_ROWS, growing cannot help: put back');
  assert.deepEqual(planOf({ windows: [grownWin({ size: { w: 80, h: 190 } })], screenOf: () => CUT }).judged, ['ada'], 'and settled');
  const capped = planOf({ windows: [grownWin()], grownFor: new Map([['@1', { at: 't1', req: null, hidden: 50 }]]), screenOf: () => CUT });
  assert.deepEqual([capped.acts.map((a) => a.act), capped.judged], [['restore'], ['ada']], 'review 6: the last grow did not shrink the hint: put back, settled');
  assert.deepEqual(p(CUT.replace(/↑ 50 more lines/, '')), [], 'no hint: stays as it is');
  const g = fakeTmux();
  assert.equal(pg.run({ act: 'grow', id: '@1', session: S, window: '0', size: { w: 80, h: 24 }, rows: 132, again: true }, g.fn, WORLD), true);
  assert.deepEqual(g.calls, [`resize-window -t @1 -y 132`], 'the mark (the size to go back to) is not rewritten');
});

test('another board on the same tmux server: its marks are never touched, and its windows are not ours to grow', () => {
  const theirs = grownWin({ mark: { world: 'w2', size: { w: 80, h: 24 } }, markRaw: '80x24@w2' });
  assert.deepEqual(planOf({ windows: [theirs], cards: [], screenOf: () => IDLE }).acts, [], 'no card here: still not ours');
  assert.deepEqual(planOf({ windows: [theirs], screenOf: () => IDLE }).acts, []);
});

test('parseWindows and markOf: a grouped session\'s clients, or a client viewing the window anywhere, count as watching', () => {
  const out = `@1\tada\t0\t1\t0\t0\t0\t80\t78\t80x24@${WORLD}\n@2\tbob\t1\t1\t0\t2\t0\t120\t40\t\n@3\tcy\t0\t1\t0\t\t1\t80\t24\t\nbroken line\n`;
  assert.deepEqual(pg.parseWindows(out), [
    { id: '@1', session: 'ada', window: '0', panes: 1, attached: 0, size: { w: 80, h: 78 }, mark: { world: WORLD, size: { w: 80, h: 24 } }, markRaw: `80x24@${WORLD}` },
    { id: '@2', session: 'bob', window: '1', panes: 1, attached: 2, size: { w: 120, h: 40 }, mark: null, markRaw: '' },
    { id: '@3', session: 'cy', window: '0', panes: 1, attached: 1, size: { w: 80, h: 24 }, mark: null, markRaw: '' },
  ]);
  assert.equal(pg.markOf('80x24'), null, 'no world: not a mark this code writes');
  assert.deepEqual(pg.windowOf(card({ target: 'a:b:3.0' })), { session: 'a:b', window: '3' });
});

const fakeTmux = (fail = () => false) => {
  const calls = [];
  const fn = (args) => { calls.push(args.join(' ')); return fail(args) ? { ran: true, status: 1, out: '' } : { ran: true, status: 0, out: '' }; };
  return { fn, calls };
};
const GROW = { act: 'grow', id: '@1', session: S, window: '0', size: { w: 80, h: 24 }, rows: 78 };
const RESTORE = { act: 'restore', id: '@1', session: S, window: '0', size: { w: 80, h: 24 } };

test('grow writes the mark BEFORE the resize; restore resizes BEFORE unsetting window-size (measured order)', () => {
  const g = fakeTmux();
  assert.equal(pg.run(GROW, g.fn, WORLD), true);
  assert.deepEqual(g.calls, [`set-option -w -t @1 @kosmos_permgrow 80x24@${WORLD}`, `resize-window -t @1 -y 78`]);
  const r = fakeTmux();
  assert.equal(pg.run(RESTORE, r.fn, WORLD), true);
  assert.deepEqual(r.calls, [`resize-window -t @1 -x 80 -y 24`, `set-option -w -t @1 -u window-size`, `set-option -w -t @1 -u @kosmos_permgrow`]);
});

test('a failed grow puts the window back and clears its mark; a failed restore keeps the mark to try again', () => {
  const g = fakeTmux((a) => a[0] === 'resize-window' && a[a.length - 1] === '78');
  assert.equal(pg.run(GROW, g.fn, WORLD), false);
  assert.deepEqual(g.calls.slice(2), [`resize-window -t @1 -x 80 -y 24`, `set-option -w -t @1 -u window-size`, `set-option -w -t @1 -u @kosmos_permgrow`]);
  const r = fakeTmux((a) => a[0] === 'resize-window');
  assert.equal(pg.run(RESTORE, r.fn, WORLD), false);
  assert.ok(!r.calls.includes(`set-option -w -t @1 -u @kosmos_permgrow`), 'the mark stays, so the next tick restores');
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
const ROW = `@1\t${S}\t0\t1\t0\t\t0\t80\t24\t\n`;
const GROWN_ROW = `@1\t${S}\t0\t1\t0\t\t0\t80\t78\t80x24@${WORLD}\n`;
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
  assert.deepEqual(sweep({ roster: noRoster, tmux: listing(`@1\t${S}\t0\t1\t0\t\t0\t80\t78\t80x24@w2\n`).fn, waits: () => new Map() }), [], 'only another board\'s mark');
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

test('an unsure screen is read UNSURE_READS times per report, then left until a new report', () => {
  const memory = pg.newMemory();
  let reads = 0;
  const tick = (at = 't1') => sweep({ roster: () => [card()], memory, tmux: listing(ROW).fn, screenOf: () => { reads += 1; return IDLE; }, waits: () => new Map([['ada', at]]) });
  for (let i = 0; i < pg.UNSURE_READS + 2; i += 1) tick();
  assert.equal(reads, pg.UNSURE_READS);
  tick('t2');
  assert.equal(reads, pg.UNSURE_READS + 1, 'a new report is looked at again');
  let n = 0;
  const m2 = pg.newMemory();
  sweep({ roster: () => [card()], memory: m2, tmux: listing(ROW).fn, screenOf: () => (n++ === 0 ? IDLE : CUT) });
  assert.deepEqual(sweep({ roster: () => [card()], memory: m2, tmux: listing(ROW).fn, screenOf: () => (n++ === 0 ? IDLE : CUT) }).map((a) => a.act), ['grow'],
    'a box drawn a tick after the report is still grown');
});

test('the brake grows nothing and still puts grown windows back', () => {
  const t = listing(ROW);
  assert.deepEqual(sweep({ roster: () => [card()], tmux: t.fn, restoreOnly: true }), []);
  assert.deepEqual(t.calls, ['list-windows']);
  const back = sweep({ roster: () => [card()], tmux: listing(GROWN_ROW).fn, restoreOnly: true, screenOf: () => WHOLE });
  assert.deepEqual(back.map((a) => a.act), ['restore'], 'braked: put back at once, prompt or not (measured safe: SHRUNK)');
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

test('a watched agent, or a report with no agent on the roster, stops costing a roster read every tick', () => {
  const memory = pg.newMemory();
  let built = 0;
  const roster = () => { built += 1; return [card()]; };
  const watched = listing(`@1\t${S}\t0\t1\t1\t\t0\t80\t24\t\n`).fn;
  let screens = 0;
  for (let i = 0; i < pg.UNSURE_READS + 3; i += 1) sweep({ roster, memory, tmux: watched, screenOf: () => { screens += 1; return CUT; } });
  assert.equal(screens, 0, 'watched: no screen is read');
  assert.equal(built, 1, 'review 5: and the roster is read once, not every tick, while the window still has a viewer');
  assert.deepEqual(sweep({ roster, memory, tmux: listing(ROW).fn }).map((a) => a.act), ['grow'], 'review 4: the person leaves, the prompt still up: it grows');
  const m2 = pg.newMemory();
  let built2 = 0;
  const gone = () => { built2 += 1; return [card()]; };
  for (let i = 0; i < 4; i += 1) sweep({ roster: gone, memory: m2, tmux: listing(ROW).fn, waits: () => new Map([['removedagent', 't9']]) });
  assert.equal(built2, 1, 'a removed agent\'s last report is settled on the first read');
});

/* Review 4: a fake tmux that KEEPS the window's height, mark and clients between ticks, and a screen that depends on the
   height (cut below 78 rows, whole from 78), so loops and stuck states over many ticks can be seen. */
function world0({ grouped = false } = {}) {
  const st = { h: 24, mark: '', attached: 0, prompt: true, resizes: 0 };
  const rowOf = (session) => `@1\t${session}\t0\t1\t${session === S ? st.attached : 0}\t\t0\t80\t${st.h}\t${st.mark}`;
  const tmux = (args) => {
    if (args[0] === 'list-windows') return { ran: true, status: 0, out: [rowOf(S), ...(grouped ? [rowOf('ada-peek')] : [])].join('\n') + '\n' };
    if (args[0] === 'resize-window') { st.resizes += 1; st.h = Number(args[args.indexOf('-y') + 1]); return { ran: true, status: 0, out: '' }; }
    if (args[0] === 'set-option' && args.includes('-u') && args.includes(pg.GROWN_OPT)) { st.mark = ''; return { ran: true, status: 0, out: '' }; }
    if (args[0] === 'set-option' && args[4] === pg.GROWN_OPT) { st.mark = args[5]; return { ran: true, status: 0, out: '' }; }
    return { ran: true, status: 0, out: '' };
  };
  const variant = (t) => (st.prompt === 'B' ? t.replace(/\bg(\d\d)\b/g, 'k$1') : t);
  const screen = () => (!st.prompt ? IDLE : variant(st.h >= 78 ? WHOLE : CUT));
  const memory = pg.newMemory();
  let at = 't1';
  const tick = () => pg.sweepOnce({ roster: () => [card()], tmux, screenOf: screen, busy: () => false, world: WORLD, memory,
    waits: () => (at ? new Map([['ada', at]]) : new Map()) });
  return { st, tick, memory, tmux, setReport: (v) => { at = v; } };
}

test('over many ticks: grows once and stays while the prompt is up, goes back once when it is answered', () => {
  const w = world0();
  for (let i = 0; i < 6; i += 1) w.tick();
  assert.deepEqual([w.st.h, w.st.resizes], [78, 1]);
  w.setReport(null);
  for (let i = 0; i < 3; i += 1) w.tick();
  assert.deepEqual([w.st.h, w.st.resizes], [78, 1], 'the report ends but the SAME box is still up: kept');
  w.st.prompt = false;
  for (let i = 0; i < 4; i += 1) w.tick();
  assert.deepEqual([w.st.h, w.st.mark, w.st.resizes], [24, '', 2]);
});

test('over many ticks: a person who watches for a moment does not leave the prompt ungrowable', () => {
  const w = world0();
  w.tick();
  w.st.attached = 1;
  for (let i = 0; i < 6; i += 1) w.tick();
  assert.equal(w.st.h, 24, 'watched: put back and not grown');
  w.st.attached = 0;
  for (let i = 0; i < 3; i += 1) w.tick();
  assert.deepEqual([w.st.h, w.st.resizes], [78, 3], 'grown, back, grown: and then still');
});

test('over many ticks: a window also listed under a second (grouped, unwatched) session does not grow and shrink in turn', () => {
  const w = world0({ grouped: true });
  for (let i = 0; i < 8; i += 1) w.tick();
  assert.deepEqual([w.st.h, w.st.resizes], [78, 1]);
});


test('review 5: a stale top in scrollback above a cut box never reads as whole (the box shows its own hint)', () => {
  const head = WHOLE.split('\n');
  const at = head.findIndex((l) => /│ \S+45/.test(l));
  assert.ok(at > 0, 'premise: the grown capture has the 45th line');
  const stitched = head.slice(0, at + 1).join('\n') + '\n' + SHRUNK;
  assert.equal(chat.permissionAnswerable(stitched), false);
  assert.equal(chat.permissionCard(stitched), null);
  assert.equal(chat.permissionAnswerable(WHOLE), true, 'control: a whole box with no hint still is');
});

test('over many ticks, review 5: the next prompt, reported before its box is drawn, is still grown', () => {
  const w = world0();
  for (let i = 0; i < 3; i += 1) w.tick();
  assert.equal(w.st.h, 78, 'A grown');
  w.st.prompt = null; w.setReport('t2');
  w.tick();
  assert.equal(w.st.h, 24, 'A answered: put back (B reported, not drawn yet)');
  w.st.prompt = 'B';
  for (let i = 0; i < 4; i += 1) w.tick();
  assert.equal(w.st.h, 78, 'B grown once drawn');
});

test('over many ticks, review 5: the same report and a screen that stops reading as a prompt is not regrown (no loop)', () => {
  const w = world0();
  for (let i = 0; i < 3; i += 1) w.tick();
  w.st.prompt = null;
  w.tick();
  w.st.prompt = 'A';
  for (let i = 0; i < 5; i += 1) w.tick();
  assert.deepEqual([w.st.h, w.st.resizes], [24, 2], 'under the report it was grown for: settled');
});

test('over many ticks, review 5: a longer next box grown again is learned, not put back as another box', () => {
  const w = world0();
  for (let i = 0; i < 3; i += 1) w.tick();
  w.st.prompt = 'B'; w.setReport('t2');
  for (let i = 0; i < 6; i += 1) w.tick();
  assert.equal(w.st.h, 78);
  assert.ok(w.st.resizes <= 3, `resizes ${w.st.resizes}`);
});

test('review 5: a grown window whose screen cannot be read goes back after UNREADABLE_TICKS; one no longer ours at once', () => {
  const memory = pg.newMemory();
  const t = listing(GROWN_ROW);
  const acts = [];
  for (let i = 0; i < pg.UNREADABLE_TICKS; i += 1) acts.push(sweep({ roster: () => [card()], memory, tmux: t.fn, screenOf: () => null }).map((a) => a.act));
  assert.deepEqual(acts, [...Array(pg.UNREADABLE_TICKS - 1).fill([]), ['restore']]);
  assert.deepEqual(sweep({ roster: () => [card({ isNamedOurs: false })], tmux: listing(GROWN_ROW).fn, screenOf: () => WHOLE }).map((a) => a.act), ['restore']);
});

test('review 5: the no-box-yet allowance is also a time, so a slow hook still gets its box grown', () => {
  const memory = pg.newMemory();
  const at = new Date(0).toISOString();
  let shown = IDLE;
  const tick = (now) => sweep({ roster: () => [card()], memory, now, tmux: listing(ROW).fn, screenOf: () => shown, waits: () => new Map([['ada', at]]) });
  for (let i = 0; i < pg.UNSURE_READS + 2; i += 1) tick(1000 * i);
  shown = CUT;
  assert.deepEqual(tick(10000).map((a) => a.act), ['grow'], 'inside UNSURE_MS: still looked at');
  const m2 = pg.newMemory();
  const tick2 = (now, scr) => sweep({ roster: () => [card()], memory: m2, now, tmux: listing(ROW).fn, screenOf: () => scr, waits: () => new Map([['ada', at]]) });
  for (let i = 0; i < pg.UNSURE_READS; i += 1) tick2(pg.UNSURE_MS + i, IDLE);
  assert.deepEqual(tick2(pg.UNSURE_MS + 10, CUT), [], 'past both: settled until a new report');
});


test('over many ticks, review 6: a box Claude Code keeps cut whatever the height ends at the start size, settled', () => {
  const w = world0();
  const realScreen = () => (w.st.prompt ? CUT : IDLE);   // never drawn whole, the hint never shrinks
  const memory = pg.newMemory();
  for (let i = 0; i < 8; i += 1) pg.sweepOnce({ roster: () => [card()], tmux: (a) => w.tmux(a), screenOf: realScreen, busy: () => false, world: WORLD, memory, waits: () => new Map([['ada', 't1']]) });
  assert.deepEqual([w.st.h, w.st.mark], [24, ''], `height ${w.st.h} after ${w.st.resizes} resizes`);
  assert.ok(w.st.resizes <= 2, `resizes ${w.st.resizes}`);
});
