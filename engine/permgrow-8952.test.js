'use strict';

/* kosmos#8952 slice (d): engine/permgrow.js grows a window whose permission box is cut, and puts it back. The screens are
   real captures (Claude Code 2.1.331, tmux 3.6a, 2026-11-24): the same 60-line mkdir prompt at 80x24 (cut) and at 200
   rows (whole). No real tmux is touched: every call goes to a recording fake. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pg = require('./permgrow');
const status = require('./status');

const SCREENS = path.join(__dirname, '..', 'test-support', 'claude-screens');
const CUT = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-60-cut-80x24-2.1.331.txt'), 'utf8');
const WHOLE = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-60-grown-200rows-2.1.331.txt'), 'utf8');
const IDLE = '❯ \n';

const fleet = require('../test-support/fleet');
/* Real cards from the real producers (fixture-discipline): ada is waiting on a person, bo is idle. A variation is the
   real card with one field changed. */
const REAL = fleet.install([fleet.agent('ada', { state: 'needs_you' }), fleet.agent('bo', { state: 'idle' })]).agents;
const ADA = REAL.find((c) => c.sessionName === 'ada');
const BO = REAL.find((c) => c.sessionName === 'bo');
const S = pg.windowOf(ADA).session;
const card = (over = {}) => ({ ...ADA, ...over });
const win = (over = {}) => ({ session: S, window: '0', panes: 1, attached: 0, size: { w: 80, h: 24 }, grown: null, grownRaw: '', ...over });
const grownWin = (over = {}) => win({ size: { w: 80, h: 200 }, grown: { w: 80, h: 24 }, grownRaw: '80x24', ...over });

test('premise: the cut capture is not answerable and the grown one is', () => {
  const chat = require('./chat');
  assert.ok(status.claudePermissionPrompt(CUT), 'the cut screen still reads as a permission prompt');
  assert.equal(chat.permissionAnswerable(CUT), false);
  assert.equal(chat.permissionAnswerable(WHOLE), true);
  assert.equal(chat.permissionCard(WHOLE).detail.split('\n').length, 61, 'all 60 directories and the mkdir line');
});

test('a cut prompt on an unwatched one-pane window grows it, recording its size', () => {
  const acts = pg.plan({ cards: [card()], windows: [win()], screenOf: () => CUT });
  assert.deepEqual(acts, [{ act: 'grow', session: S, window: '0', size: { w: 80, h: 24 } }]);
});

test('no grow: whole box, no prompt, unreadable, watched, several panes, already tall, not needs-you, not Claude, not ours', () => {
  const none = (cards, windows, screen) => assert.deepEqual(pg.plan({ cards, windows, screenOf: () => screen }), []);
  none([card()], [win()], WHOLE);
  none([card()], [win()], IDLE);
  none([card()], [win()], null);
  none([card()], [win({ attached: 1 })], CUT);
  none([card()], [win({ panes: 2 })], CUT);
  none([card()], [win({ size: { w: 80, h: 200 } })], CUT);
  none([BO], [win({ session: pg.windowOf(BO).session })], CUT);
  none([card({ runner: 'codex' })], [win()], CUT);
  none([card({ isNamedOurs: false })], [win()], CUT);
  none([card({ reachedByChannel: true })], [win()], CUT);
  none([card()], [win({ session: 'other' })], CUT);
});

test('a grown window: kept while the prompt is up, restored when it is gone or a person attaches', () => {
  const p = (w, screen, cards = [card()]) => pg.plan({ cards, windows: [w], screenOf: () => screen });
  assert.deepEqual(p(grownWin(), WHOLE), [], 'prompt still up (now whole): keep');
  assert.deepEqual(p(grownWin(), CUT), [], 'prompt still up even if still cut (taller than 200): keep, never regrow');
  assert.deepEqual(p(grownWin(), null), [], 'could not read: keep, ask next tick');
  assert.deepEqual(p(grownWin(), IDLE), [{ act: 'restore', session: S, window: '0', size: { w: 80, h: 24 } }]);
  assert.deepEqual(p(grownWin({ attached: 1 }), WHOLE), [{ act: 'restore', session: S, window: '0', size: { w: 80, h: 24 } }]);
  assert.deepEqual(p(grownWin(), WHOLE, []), [{ act: 'restore', session: S, window: '0', size: { w: 80, h: 24 } }], 'no agent there any more');
  assert.deepEqual(p(grownWin({ grown: null, grownRaw: 'junk' }), WHOLE), [{ act: 'restore', session: S, window: '0', size: null }]);
});

test('parseWindows reads list-windows rows, mark included', () => {
  const out = 'ada\t0\t1\t0\t80\t200\t80x24\nbob\t1\t1\t2\t120\t40\t\nbroken line\n';
  assert.deepEqual(pg.parseWindows(out), [
    { session: 'ada', window: '0', panes: 1, attached: 0, size: { w: 80, h: 200 }, grown: { w: 80, h: 24 }, grownRaw: '80x24' },
    { session: 'bob', window: '1', panes: 1, attached: 2, size: { w: 120, h: 40 }, grown: null, grownRaw: '' },
  ]);
  assert.deepEqual(pg.windowOf(card({ target: 'a:b:3.0' })), { session: 'a:b', window: '3' });
});

const fakeTmux = (fail = () => false) => {
  const calls = [];
  const fn = (args) => { calls.push(args.join(' ')); return fail(args) ? { ran: true, status: 1, out: '' } : { ran: true, status: 0, out: '' }; };
  return { fn, calls };
};

test('grow writes the mark BEFORE the resize; restore resizes BEFORE unsetting window-size (measured order)', () => {
  const g = fakeTmux();
  assert.equal(pg.run({ act: 'grow', session: S, window: '0', size: { w: 80, h: 24 } }, g.fn), true);
  assert.deepEqual(g.calls, [`set-option -w -t =${S}:0 @kosmos_permgrow 80x24`, `resize-window -t =${S}:0 -y 200`]);
  const r = fakeTmux();
  assert.equal(pg.run({ act: 'restore', session: S, window: '0', size: { w: 80, h: 24 } }, r.fn), true);
  assert.deepEqual(r.calls, [`resize-window -t =${S}:0 -x 80 -y 24`, `set-option -w -t =${S}:0 -u window-size`, `set-option -w -t =${S}:0 -u @kosmos_permgrow`]);
});

test('a failed grow resize clears its mark; a failed restore keeps it to try again', () => {
  const g = fakeTmux((a) => a[0] === 'resize-window');
  assert.equal(pg.run({ act: 'grow', session: S, window: '0', size: { w: 80, h: 24 } }, g.fn), false);
  assert.ok(g.calls.includes(`set-option -w -t =${S}:0 -u @kosmos_permgrow`));
  const r = fakeTmux((a) => a[0] === 'resize-window');
  assert.equal(pg.run({ act: 'restore', session: S, window: '0', size: { w: 80, h: 24 } }, r.fn), false);
  assert.ok(!r.calls.includes(`set-option -w -t =${S}:0 -u @kosmos_permgrow`), 'the mark stays, so the next tick restores');
});

test('sweepOnce lists, plans and acts through the injected tmux; a failed list does nothing', () => {
  const calls = [];
  const tmux = (args) => {
    calls.push(args[0]);
    if (args[0] === 'list-windows') return { ran: true, status: 0, out: `${S}\t0\t1\t0\t80\t24\t\n` };
    return { ran: true, status: 0, out: '' };
  };
  const acts = pg.sweepOnce({ roster: () => [card()], tmux, screenOf: () => CUT, asking: () => true });
  assert.equal(acts.length, 1);
  assert.deepEqual(calls, ['list-windows', 'set-option', 'resize-window']);
  const dead = [];
  const noRoster = () => { throw new Error('the roster must not be built'); };
  assert.deepEqual(pg.sweepOnce({ roster: noRoster, tmux: (a) => { dead.push(a[0]); return { ran: false, status: null, out: '' }; }, asking: () => true }), []);
  assert.deepEqual(dead, ['list-windows']);
  assert.deepEqual(pg.sweepOnce({ roster: () => null, tmux, asking: () => true }), [], 'no roster: nothing');
});

test('the roster (a capture per agent) is built only when a window is grown or an agent reports a permission wait', () => {
  const listing = (out) => (args) => (args[0] === 'list-windows' ? { ran: true, status: 0, out } : { ran: true, status: 0, out: '' });
  const noRoster = () => { throw new Error('the roster must not be built'); };
  assert.deepEqual(pg.sweepOnce({ roster: noRoster, tmux: listing(`${S}\t0\t1\t0\t80\t24\t\n`), asking: () => false }), []);
  let built = 0;
  const roster = () => { built += 1; return [card()]; };
  pg.sweepOnce({ roster, tmux: listing(`${S}\t0\t1\t0\t80\t24\t\n`), screenOf: () => CUT, asking: () => true });
  assert.equal(built, 1, 'an agent reports a permission wait');
  const restored = pg.sweepOnce({ roster, tmux: listing(`${S}\t0\t1\t0\t80\t200\t80x24\n`), screenOf: () => IDLE, asking: () => false });
  assert.equal(built, 2, 'a grown window is always looked at, so it is put back even after the report ends');
  assert.deepEqual(restored.map((a) => a.act), ['restore']);
});
