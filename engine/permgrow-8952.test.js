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
// Another box: the same prompt with other names (a different request), and a longer one still cut at 78 rows.
const other = (t) => t.replace(/\bg(\d\d)\b/g, 'k$1');
const LONGER_CUT_AT_78 = CUT.replace('↑ 50 more lines', '↑ 90 more lines');

const fleet = require('../test-support/fleet');
/* Real cards from the real producers (fixture-discipline). A variation is the real card with one field changed. */
const REAL = fleet.install([fleet.agent('ada', { state: 'needs_you' }), fleet.agent('bo', { state: 'idle' })]).agents;
const ADA = REAL.find((c) => c.sessionName === 'ada');
const S = pg.windowOf(ADA).session;
const card = (over = {}) => ({ ...ADA, ...over });
const win = (over = {}) => ({ id: '@1', session: S, window: '0', panes: 1, attached: 0, size: { w: 80, h: 24 }, mark: null, markRaw: '', ...over });
const grownWin = (over = {}) => win({ size: { w: 80, h: 78 }, mark: { world: WORLD, size: { w: 80, h: 24 } }, markRaw: `80x24@${WORLD}`, ...over });
const REQ = chat.permissionRequestId(chat.permissionCard(WHOLE));
const planOf = (o) => pg.plan({ cards: [card()], windows: [win()], waiting: new Map([['ada', 'ada']]), skip: new Set(), screenOf: () => CUT,
  busy: () => false, world: WORLD, reportOf: (n) => (n === 'ada' ? 't1' : null), grown: new Map([['@1', { at: 't1', req: REQ }]]), ...o });
const acts = (r) => r.acts.map((a) => a.act);
const RESTORE = { act: 'restore', id: '@1', session: S, window: '0', size: { w: 80, h: 24 } };

test('premises, on the real captures', () => {
  const P = { command: '2.1.331', title: '✳ mkdir', session: 'x', name: 'x' };
  assert.equal(chat.permissionAnswerable(CUT), false);
  assert.equal(chat.permissionAnswerable(WHOLE), true);
  assert.equal(chat.permissionCard(WHOLE).detail.split('\n').length, 61, 'all 60 directories and the mkdir line');
  assert.equal(pg.hiddenRows(CUT), 50);
  assert.equal(pg.hiddenRows(WHOLE), null);
  assert.equal(pg.hiddenRows(LONGER_CUT_AT_78), 90);
  assert.notEqual(chat.permissionRequestId(chat.permissionCard(other(WHOLE))), REQ, 'premise: the other box is another request');
  // Shrinking under the prompt leaves it cut again: no card stitched from scrollback.
  assert.equal(chat.permissionAnswerable(SHRUNK), false);
  assert.equal(chat.permissionCard(SHRUNK), null);
  // Why the window is fitted, not 200 rows: classify reads the last 25 rows, and blank rows under the box turn needs_you
  // into unknown. The fitted screen has none.
  assert.equal(status.classify(P, CUT).state, status.STATE.NEEDS_YOU);
  assert.equal(status.classify(P, WHOLE).state, status.STATE.NEEDS_YOU, 'the grown pane still reads as needing the person');
  assert.equal(status.classify(P, WHOLE.replace(/\s+$/, '') + '\n'.repeat(26)).state, status.STATE.UNKNOWN, 'control: padding does break it');
});

test('round 8: a line shaped like the hint inside the command (above the question) leaves a whole box answerable', () => {
  const lines = WHOLE.split('\n');
  const at = lines.findIndex((l) => /│ \S+30/.test(l));
  const inCommand = [...lines.slice(0, at + 1), ' ↑ 3 more lines', ...lines.slice(at + 1)].join('\n');
  assert.equal(chat.permissionAnswerable(inCommand), true, 'the scan starts at the question');
});

test('a stale top in scrollback above a cut box never reads as whole (the box shows its own hint)', () => {
  const head = WHOLE.split('\n');
  const at = head.findIndex((l) => /│ \S+45/.test(l));
  assert.ok(at > 0, 'premise: the grown capture has the 45th line');
  const stitched = head.slice(0, at + 1).join('\n') + '\n' + SHRUNK;
  assert.equal(chat.permissionAnswerable(stitched), false);
  assert.equal(chat.permissionCard(stitched), null);
});

/* ── section 2: an unmarked window ─────────────────────────────────────── */

test('a cut prompt on an unviewed one-pane window grows it by the hidden rows', () => {
  const r = planOf({});
  assert.deepEqual(r.acts, [{ act: 'grow', id: '@1', session: S, window: '0', size: { w: 80, h: 24 }, rows: 24 + 50 + pg.FIT_MARGIN, hidden: 50, name: 'ada' }]);
  assert.deepEqual([r.settle, r.unsure, r.watching], [[], [], []]);
});

test('not grown, and why: settled (nothing to do for this report), unsure (look again), watching, or left for next tick', () => {
  const v = (o) => { const r = planOf(o); return { acts: acts(r), settle: r.settle, unsure: r.unsure, watching: r.watching }; };
  const settled = { acts: [], settle: ['ada'], unsure: [], watching: [] };
  const unsure = { acts: [], settle: [], unsure: ['ada'], watching: [] };
  const nothing = { acts: [], settle: [], unsure: [], watching: [] };
  assert.deepEqual(v({ screenOf: () => WHOLE }), settled, 'already whole');
  assert.deepEqual(v({ screenOf: () => CUT.replace('↑ 50 more', '↑ 500 more') }), settled, 'taller than MAX_ROWS');
  assert.deepEqual(v({ cards: [card({ runner: 'codex' })] }), settled);
  assert.deepEqual(v({ cards: [card({ isNamedOurs: false })] }), settled);
  assert.deepEqual(v({ cards: [card({ reachedByChannel: true })] }), settled);
  assert.deepEqual(v({ windows: [win({ panes: 2 })] }), settled);
  assert.deepEqual(v({ windows: [grownWin({ mark: { world: 'w2', size: { w: 80, h: 24 } }, markRaw: '80x24@w2' })] }), settled, 'another board\'s window');
  assert.deepEqual(v({ screenOf: () => IDLE }), unsure, 'the hook can report before the box is drawn');
  assert.deepEqual(v({ screenOf: () => CUT.replace('↑ 50 more lines', '') }), unsure, 'no hint: never guess a height');
  assert.deepEqual(v({ screenOf: () => null }), unsure);
  assert.deepEqual(v({ screenOf: () => { throw new Error('x'); } }), unsure);
  assert.deepEqual(v({ windows: [] }), unsure, 'no window found yet');
  assert.deepEqual(v({ windows: [win({ attached: 1 })] }), { acts: [], settle: [], unsure: [], watching: [['ada', '@1']] });
  assert.deepEqual(v({ busy: () => true }), nothing, 'a press under way: next tick');
  assert.deepEqual(v({ busy: () => { throw new Error('x'); } }), nothing);
  assert.deepEqual(v({ waiting: new Map() }), nothing);
  assert.deepEqual(v({ skip: new Set(['ada']) }), nothing);
  assert.deepEqual(v({ windows: [win({ session: 'other' })] }), unsure);
});

/* ── section 1: a window carrying our mark ─────────────────────────────── */

test('a grown window: kept while its box is up (whole), whatever the report says', () => {
  const p = (o) => planOf({ windows: [grownWin()], screenOf: () => WHOLE, ...o });
  assert.deepEqual(acts(p({})), []);
  assert.deepEqual(acts(p({ reportOf: () => null })), [], 'the report ends under the SAME box: kept');
  assert.deepEqual(acts(p({ reportOf: () => 't2' })), [], 'a new report under the SAME box: kept');
  const first = p({ grown: new Map() });
  assert.deepEqual([acts(first), first.grownNext], [[], [['@1', { at: null, req: REQ, hidden: null, misses: 0, stuck: 0, unread: 0 }]]],
    'just grown, or a board restart: the box is learned, the size kept');
});

test('a grown window goes back: another box, a viewer, no agent, not ours to grow, a bad mark, or the brake', () => {
  const p = (o) => planOf({ windows: [grownWin()], screenOf: () => WHOLE, ...o }).acts;
  assert.deepEqual(p({ screenOf: () => other(WHOLE) }), [RESTORE], 'another box: put back, grown again only if it needs it');
  assert.deepEqual(p({ windows: [grownWin({ attached: 1 })] }), [{ ...RESTORE, viewed: true }], 'a viewer: put back, with no back-off');
  assert.deepEqual(p({ cards: [] }), [RESTORE]);
  assert.deepEqual(p({ cards: [card({ isNamedOurs: false })] }), [RESTORE]);
  assert.deepEqual(p({ windows: [grownWin({ mark: { world: WORLD, size: null }, markRaw: `junk@${WORLD}` })] }), [{ ...RESTORE, size: pg.DEFAULT_SIZE }],
    'a mark whose size does not read goes back to the size agents start at');
  assert.deepEqual(p({ restoreOnly: true }), [RESTORE], 'braked: put back at once, prompt or not (measured safe: SHRUNK)');
  assert.deepEqual(p({ busy: () => true, restoreOnly: true }), [], 'a press is reading the screen: next tick');
});

test('a grown window whose prompt is gone goes back after MISSES reads; settled only under the report it was grown for', () => {
  const once = planOf({ windows: [grownWin()], screenOf: () => IDLE });
  assert.deepEqual([acts(once), once.grownNext[0][1].misses], [[], 1], 'one read with no prompt (a redraw mid-way): kept');
  const twice = planOf({ windows: [grownWin()], screenOf: () => IDLE, grown: new Map([['@1', { at: 't1', req: REQ, misses: pg.MISSES - 1 }]]) });
  assert.deepEqual([acts(twice), twice.settle, twice.unsure], [['restore'], ['ada'], []], 'the same report: settled, no grow and shrink loop');
  const next = planOf({ windows: [grownWin()], screenOf: () => IDLE, reportOf: () => 't2', grown: new Map([['@1', { at: 't1', req: REQ, misses: pg.MISSES - 1 }]]) });
  assert.deepEqual([acts(next), next.settle, next.unsure], [['restore'], [], ['ada']], 'a newer report (the next prompt, not drawn yet): looked at again');
});

test('a grown window that cannot be read is kept a few ticks, then put back', () => {
  const p = (unread) => planOf({ windows: [grownWin()], screenOf: () => null, grown: new Map([['@1', { at: 't1', req: REQ, unread }]]) });
  assert.deepEqual(acts(p(0)), []);
  assert.deepEqual(acts(p(pg.UNREADABLE_TICKS - 1)), ['restore']);
});

test('a grown window still cut: grown again by its hint; a longer NEXT box too; put back only when growing cannot help', () => {
  const grownFor = (g) => new Map([['@1', { at: 't1', req: null, hidden: 50, ...g }]]);
  const r = planOf({ windows: [grownWin()], screenOf: () => LONGER_CUT_AT_78, reportOf: () => 't2', grown: grownFor({ req: REQ }) });
  assert.deepEqual(r.acts, [{ act: 'grow', id: '@1', session: S, window: '0', size: { w: 80, h: 24 }, rows: 78 + 90 + pg.FIT_MARGIN, again: true, hidden: 90, name: 'ada' }],
    'review 7: a longer next box (a new report, hint 90 > 50) is grown, never settled as "growing did not help"');
  assert.deepEqual(r.settle, []);
  const stuck1 = planOf({ windows: [grownWin()], screenOf: () => CUT, grown: grownFor({}) });
  assert.deepEqual([acts(stuck1), stuck1.grownNext[0][1].stuck], [[], 1], 'the same box, hint not shrinking: one strike');
  const stuck2 = planOf({ windows: [grownWin()], screenOf: () => CUT, grown: grownFor({ stuck: pg.STUCK - 1 }) });
  assert.deepEqual([acts(stuck2), stuck2.settle], [['restore'], ['ada']], 'two: Claude Code keeps it cut, put back and settled');
  const tall = planOf({ windows: [grownWin({ size: { w: 80, h: 190 } })], screenOf: () => CUT, grown: grownFor({ hidden: null }) });
  assert.deepEqual([acts(tall), tall.settle], [['restore'], ['ada']], 'over MAX_ROWS: put back and settled');
  const g = { calls: [] };
  assert.equal(pg.run({ act: 'grow', id: '@1', size: { w: 80, h: 24 }, rows: 132, again: true }, (a) => { g.calls.push(a.join(' ')); return { ran: true, status: 0 }; }, WORLD), true);
  assert.deepEqual(g.calls, ['resize-window -t @1 -y 132'], 'grown again: the mark (the size to go back to) is not rewritten');
});

test('another board on the same tmux server: its marks are never touched', () => {
  const theirs = grownWin({ mark: { world: 'w2', size: { w: 80, h: 24 } }, markRaw: '80x24@w2' });
  assert.deepEqual(acts(planOf({ windows: [theirs], cards: [], screenOf: () => IDLE })), []);
  assert.deepEqual(acts(planOf({ windows: [theirs], screenOf: () => IDLE })), []);
});

/* ── parsing and tmux steps ────────────────────────────────────────────── */

test('parseWindows, oneRowPerWindow and markOf', () => {
  const out = `@1\tada\t0\t1\t0\t0\t0\t80\t78\t80x24@${WORLD}\n@2\tbob\t1\t1\t0\t2\t0\t120\t40\t\n@3\tcy\t0\t1\t0\t\t1\t80\t24\t\nbroken line\n`;
  assert.deepEqual(pg.parseWindows(out), [
    { id: '@1', session: 'ada', window: '0', panes: 1, attached: 0, size: { w: 80, h: 78 }, mark: { world: WORLD, size: { w: 80, h: 24 } }, markRaw: `80x24@${WORLD}` },
    { id: '@2', session: 'bob', window: '1', panes: 1, attached: 2, size: { w: 120, h: 40 }, mark: null, markRaw: '' },
    { id: '@3', session: 'cy', window: '0', panes: 1, attached: 1, size: { w: 80, h: 24 }, mark: null, markRaw: '' },
  ], 'a grouped session\'s clients, or a client viewing the window anywhere, count as viewing');
  const grouped = pg.parseWindows(`@1\tpeek\t0\t1\t0\t0\t1\t80\t24\t\n@1\t${S}\t0\t1\t0\t0\t0\t80\t24\t\n`);
  assert.deepEqual(pg.oneRowPerWindow(grouped, [card()]).map((r) => [r.id, r.session, r.attached]), [['@1', S, 1]], 'one window, the card\'s row, its viewers');
  assert.equal(pg.markOf('80x24'), null, 'no world: not a mark this code writes');
  assert.deepEqual(pg.windowOf(card({ target: 'a:b:3.0' })), { session: 'a:b', window: '3' });
});

const fakeTmux = (fail = () => false) => {
  const calls = [];
  const fn = (args) => { calls.push(args.join(' ')); return fail(args) ? { ran: true, status: 1, out: '' } : { ran: true, status: 0, out: '' }; };
  return { fn, calls };
};
const GROW = { act: 'grow', id: '@1', session: S, window: '0', size: { w: 80, h: 24 }, rows: 78 };

test('grow writes the mark BEFORE the resize; restore resizes BEFORE unsetting window-size (measured order)', () => {
  const g = fakeTmux();
  assert.equal(pg.run(GROW, g.fn, WORLD), true);
  assert.deepEqual(g.calls, [`set-option -w -t @1 @kosmos_permgrow 80x24@${WORLD}`, 'resize-window -t @1 -y 78']);
  const r = fakeTmux();
  assert.equal(pg.run(RESTORE, r.fn, WORLD), true);
  assert.deepEqual(r.calls, ['resize-window -t @1 -x 80 -y 24', 'set-option -w -t @1 -u window-size', 'set-option -w -t @1 -u @kosmos_permgrow']);
});

test('a failed grow puts the window back and clears its mark; a failed restore keeps the mark to try again', () => {
  const g = fakeTmux((a) => a[0] === 'resize-window' && a[a.length - 1] === '78');
  assert.equal(pg.run(GROW, g.fn, WORLD), false);
  assert.deepEqual(g.calls.slice(2), ['resize-window -t @1 -x 80 -y 24', 'set-option -w -t @1 -u window-size', 'set-option -w -t @1 -u @kosmos_permgrow']);
  const r = fakeTmux((a) => a[0] === 'resize-window');
  assert.equal(pg.run(RESTORE, r.fn, WORLD), false);
  assert.ok(!r.calls.includes('set-option -w -t @1 -u @kosmos_permgrow'), 'the mark stays, so the next tick restores');
});

/* ── sweepOnce: one tick, and the memory between ticks ─────────────────── */

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
  assert.deepEqual(sweep({ roster: () => [card()], tmux: t.fn }).map((a) => [a.act, a.took]), [['grow', true]]);
  assert.deepEqual(t.calls, ['list-windows', 'set-option', 'resize-window']);
  const noRoster = () => { throw new Error('the roster must not be built'); };
  assert.deepEqual(sweep({ roster: noRoster, tmux: () => ({ ran: false, status: null, out: '' }) }), []);
  assert.deepEqual(sweep({ roster: () => null, tmux: listing(ROW).fn }), []);
});

test('the roster is read only on a tick that could act', () => {
  const noRoster = () => { throw new Error('the roster must not be built'); };
  assert.deepEqual(sweep({ roster: noRoster, tmux: listing(ROW).fn, waits: () => new Map() }), [], 'nobody waiting, nothing grown');
  assert.deepEqual(sweep({ roster: noRoster, tmux: listing(`@1\t${S}\t0\t1\t0\t\t0\t80\t78\t80x24@w2\n`).fn, waits: () => new Map() }), [], 'only another board\'s mark');
  const memory = pg.newMemory();
  let built = 0;
  const roster = () => { built += 1; return [card()]; };
  sweep({ roster, memory, tmux: listing(ROW).fn, screenOf: () => WHOLE });
  sweep({ roster, memory, tmux: listing(ROW).fn, screenOf: () => WHOLE });
  assert.equal(built, 1, 'settled under the same report: no roster, no screen read');
  sweep({ roster, memory, tmux: listing(ROW).fn, screenOf: () => WHOLE, waits: () => new Map([['ada', 't2']]) });
  assert.equal(built, 2, 'a new report is read again');
  const m2 = pg.newMemory();
  let built2 = 0;
  const roster2 = () => { built2 += 1; return [card()]; };
  assert.deepEqual(sweep({ roster: roster2, memory: m2, tmux: listing(ROW).fn }).map((a) => a.act), ['grow']);
  const after = listing(GROWN_ROW);
  for (let i = 0; i < pg.MISSES; i += 1) sweep({ roster: roster2, memory: m2, tmux: after.fn, screenOf: () => IDLE, waits: () => new Map() });
  assert.equal(built2, 1 + pg.MISSES, 'round 8: a window grown this run is looked at after its report ends');
  assert.equal(m2.grown.size, 0, 'and put back');
});

test('round 8: an idle board asks tmux nothing after its first listing; a mark left by an earlier run is found on the first', () => {
  const memory = pg.newMemory();
  const t = listing(ROW);
  for (let i = 0; i < 4; i += 1) sweep({ roster: () => [card()], memory, tmux: t.fn, waits: () => new Map() });
  assert.deepEqual(t.calls, ['list-windows'], 'listed once, then nothing to ask');
  const left = listing(GROWN_ROW);
  const back = sweep({ roster: () => [card()], memory: pg.newMemory(), tmux: left.fn, waits: () => new Map(), screenOf: () => IDLE });
  assert.deepEqual(left.calls[0], 'list-windows', 'a fresh board lists on its first tick');
  assert.deepEqual(back, [], 'one read with no prompt: kept (MISSES)');
});

test('round 8: a viewer\'s restore that fails is tried again on the next tick, not after RETRY_AFTER_MS', () => {
  const memory = pg.newMemory();
  let fail = true;
  const t = listing(`@1\t${S}\t0\t1\t1\t\t0\t80\t78\t80x24@${WORLD}\n`, (a) => fail && a[0] === 'resize-window');
  assert.deepEqual(sweep({ roster: () => [card()], memory, now: 0, tmux: t.fn }).map((a) => a.took), [false]);
  fail = false;
  assert.deepEqual(sweep({ roster: () => [card()], memory, now: 3000, tmux: t.fn }).map((a) => [a.act, a.took]), [['restore', true]]);
});

test('a viewed agent costs no roster read while its window still has a viewer; a removed agent\'s report a few', () => {
  const memory = pg.newMemory();
  let built = 0;
  let screens = 0;
  const roster = () => { built += 1; return [card()]; };
  const viewed = listing(`@1\t${S}\t0\t1\t1\t\t0\t80\t24\t\n`).fn;
  for (let i = 0; i < 6; i += 1) sweep({ roster, memory, tmux: viewed, screenOf: () => { screens += 1; return CUT; } });
  assert.deepEqual([built, screens], [1, 0]);
  assert.deepEqual(sweep({ roster, memory, tmux: listing(ROW).fn }).map((a) => a.act), ['grow'], 'the viewer leaves, the prompt still up: grown');
  const m2 = pg.newMemory();
  let built2 = 0;
  for (let i = 0; i < 6; i += 1) sweep({ roster: () => { built2 += 1; return [card()]; }, memory: m2, tmux: listing(ROW).fn, waits: () => new Map([['removedagent', 't9']]) });
  assert.equal(built2, pg.UNSURE_READS, 'review 7: looked at a few times (it may be newer than the 20 s roster), then settled');
});

test('review 7: an agent newer than the roster is grown once it appears on it', () => {
  const memory = pg.newMemory();
  let cards = [];
  const tick = () => sweep({ roster: () => cards, memory, tmux: listing(ROW).fn, now: 1000, waits: () => new Map([['ada', new Date(0).toISOString()]]) });
  tick();
  cards = [card()];
  assert.deepEqual(tick().map((a) => a.act), ['grow']);
});

test('the no-box-yet allowance is reads AND time, so a slow hook still gets its box grown', () => {
  const at = new Date(0).toISOString();
  const memory = pg.newMemory();
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

test('the brake grows nothing and puts grown windows back', () => {
  const t = listing(ROW);
  assert.deepEqual(sweep({ roster: () => [card()], tmux: t.fn, restoreOnly: true }), []);
  assert.deepEqual(t.calls, ['list-windows']);
  assert.deepEqual(sweep({ roster: () => [card()], tmux: listing(GROWN_ROW).fn, restoreOnly: true, screenOf: () => WHOLE }).map((a) => a.act), ['restore']);
});

test('a failing window is left alone for RETRY_AFTER_MS and logged once', () => {
  const memory = pg.newMemory();
  const lines = [];
  const t = listing(GROWN_ROW, (a) => a[0] === 'resize-window');
  const tick = (now) => sweep({ roster: () => [], memory, now, tmux: t.fn, log: (l) => lines.push(l) });
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

/* ── over many ticks: a fake tmux that KEEPS height, mark and viewers ──── */

/* The screen depends on the height and on which prompt is up: A (the 60-line box, whole from 78 rows), B (another box
   the same size), C (a longer box, whole from 118 rows), or none. */
function world0({ grouped = false, neverWhole = false } = {}) {
  const st = { h: 24, mark: '', attached: 0, prompt: 'A', resizes: 0 };
  const rowOf = (session) => `@1\t${session}\t0\t1\t${session === S ? st.attached : 0}\t\t0\t80\t${st.h}\t${st.mark}`;
  const tmux = (args) => {
    if (args[0] === 'list-windows') return { ran: true, status: 0, out: [rowOf(S), ...(grouped ? [rowOf('ada-peek')] : [])].join('\n') + '\n' };
    if (args[0] === 'resize-window') { st.resizes += 1; st.h = Number(args[args.indexOf('-y') + 1]); return { ran: true, status: 0, out: '' }; }
    if (args[0] === 'set-option' && args.includes('-u') && args.includes(pg.GROWN_OPT)) { st.mark = ''; return { ran: true, status: 0, out: '' }; }
    if (args[0] === 'set-option' && args[4] === pg.GROWN_OPT) { st.mark = args[5]; return { ran: true, status: 0, out: '' }; }
    return { ran: true, status: 0, out: '' };
  };
  const screen = () => {
    if (!st.prompt) return IDLE;
    if (neverWhole) return CUT;
    const need = st.prompt === 'C' ? 118 : 78;
    if (st.h >= need) return st.prompt === 'A' ? WHOLE : other(WHOLE).replace(/k60/, st.prompt === 'C' ? 'k60 c' : 'k60');
    const hint = need - pg.FIT_MARGIN - st.h;
    return (st.prompt === 'A' ? CUT : other(CUT)).replace('↑ 50 more lines', `↑ ${hint} more lines`);
  };
  const memory = pg.newMemory();
  let at = 't1';
  const tick = () => pg.sweepOnce({ roster: () => [card()], tmux, screenOf: screen, busy: () => false, world: WORLD, memory,
    waits: () => (at ? new Map([['ada', at]]) : new Map()) });
  return { st, tick, setReport: (v) => { at = v; } };
}
const ticks = (w, n) => { for (let i = 0; i < n; i += 1) w.tick(); };

test('over many ticks: grows once and stays while the box is up, goes back once when it is answered', () => {
  const w = world0();
  ticks(w, 6);
  assert.deepEqual([w.st.h, w.st.resizes], [78, 1]);
  w.setReport(null);
  ticks(w, 3);
  assert.deepEqual([w.st.h, w.st.resizes], [78, 1], 'the report ends but the SAME box is still up: kept');
  w.st.prompt = null;
  ticks(w, 4);
  assert.deepEqual([w.st.h, w.st.mark, w.st.resizes], [24, '', 2]);
});

test('over many ticks: a person who views it for a moment does not leave the prompt ungrowable', () => {
  const w = world0();
  w.tick();
  w.st.attached = 1;
  ticks(w, 6);
  assert.equal(w.st.h, 24, 'viewed: put back and not grown');
  w.st.attached = 0;
  ticks(w, 3);
  assert.deepEqual([w.st.h, w.st.resizes], [78, 3]);
});

test('over many ticks: a window also listed under a grouped, unviewed session does not grow and shrink in turn', () => {
  const w = world0({ grouped: true });
  ticks(w, 8);
  assert.deepEqual([w.st.h, w.st.resizes], [78, 1]);
});

test('over many ticks: the next prompt, reported before its box is drawn, is still grown', () => {
  const w = world0();
  ticks(w, 3);
  w.st.prompt = null; w.setReport('t2');
  ticks(w, 2);
  assert.equal(w.st.h, 24, 'A answered: put back (B reported, not drawn yet)');
  w.st.prompt = 'B';
  ticks(w, 4);
  assert.equal(w.st.h, 78, 'B grown once drawn');
});

test('over many ticks, review 7: a LONGER next box on a grown window is grown further, not settled', () => {
  const w = world0();
  ticks(w, 3);
  assert.equal(w.st.h, 78);
  w.st.prompt = 'C'; w.setReport('t2');
  ticks(w, 6);
  assert.equal(w.st.h, 118, `C needs 118 rows; resizes ${w.st.resizes}`);
  assert.ok(w.st.resizes <= 3, `resizes ${w.st.resizes}`);
});

test('over many ticks: the same report and a screen with no prompt is not regrown (no loop)', () => {
  const w = world0();
  ticks(w, 3);
  w.st.prompt = null;
  ticks(w, 2);
  w.st.prompt = 'A';
  ticks(w, 5);
  assert.deepEqual([w.st.h, w.st.resizes], [24, 2], 'under the report it was grown for: settled');
});

test('over many ticks: a box Claude Code keeps cut whatever the height ends at the start size, settled', () => {
  const w = world0({ neverWhole: true });
  ticks(w, 8);
  assert.deepEqual([w.st.h, w.st.mark], [24, ''], `height ${w.st.h} after ${w.st.resizes} resizes`);
  assert.ok(w.st.resizes <= 2, `resizes ${w.st.resizes}`);
});
