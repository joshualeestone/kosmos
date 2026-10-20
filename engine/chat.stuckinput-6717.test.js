'use strict';

/**
 * kosmos#6717: text stuck unsent in an idle agent's input box is cleared by Kosmos itself, not by a person opening the
 * agent and pressing Enter. The board's own line is pressed; anything else is saved as a draft for the person first and
 * only then cleared, and never sent. Ghost (dim) text is not text.
 *
 * Pins: an idle agent with a person's text stuck in its box hears the next message after the sweep, and does NOT
 * without it (the deaf mutant); the draft is written before the first clearing key; a draft that cannot be written
 * leaves the box alone; the board's own line is pressed even after a restart; dim text, a folded paste, a busy card
 * and a box someone types into meanwhile are not cleared; the draft is drawn in the conversation and dismissable.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-stuck-6717-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('./chat');
const drafts = require('./unsentdrafts');
const stuck = require('./stuckinput');
const fleet = require('../test-support/fleet');

const RULE = '\x1b[38;5;244m' + '─'.repeat(80);
const WIDTH = 76;
/* Rows as Claude Code wraps them (measured): at a space, the space not drawn; a word longer than a row is cut. */
function wrap(text) {
  const rows = [];
  let row = '';
  for (const word of String(text).split(' ')) {
    let w = word;
    while (w.length > WIDTH) { if (row) { rows.push(row); row = ''; } rows.push(w.slice(0, WIDTH)); w = w.slice(WIDTH); }
    if (!row) row = w;
    else if (row.length + 1 + w.length <= WIDTH) row += ' ' + w;
    else { rows.push(row); row = w; }
  }
  if (row) rows.push(row);
  return rows;
}
/* `keep`: the rows a scrolled box shows (measured: its last 7, ❯ on the first of them). */
function draw(text, keep) {
  if (!text) return [RULE, '\x1b[39m❯ \x1b[2mTry "write a test"\x1b[0m', RULE, '  scratch · Haiku 5.5'].join('\n') + '\n';
  let rows = wrap(text);
  if (keep && rows.length > keep) rows = rows.slice(-keep);
  return [RULE, ...rows.map((r, i) => (i === 0 ? '\x1b[39m❯ ' : '  ') + r), RULE, '  scratch · Haiku 5.5'].join('\n') + '\n';
}
/* A pane whose box behaves as Claude Code's did when measured: Enter sends it (the box empties), one round of the
   clearing keys removes its last row, a paste lands at its end. `onClear(i)` runs after the i-th round (a person typing). */
function pane(initial, opts = {}) {
  const calls = [];
  const state = { text: initial, rounds: 0, sent: [] };
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message' && args.includes('#{session_attached}')) return ok(opts.attached ? '1\n' : '0\n');
    if (args[0] === 'display-message') return ok('2.1.303\t\t0\n');
    if (args[0] === 'capture-pane' && args.includes('-e')) return ok(opts.raw ? opts.raw : draw(state.text, opts.keep));
    if (args[0] === 'capture-pane') return ok('');
    if (args[0] === 'send-keys' && args[args.length - 1] === 'Enter') { if (state.text) state.sent.push(state.text); state.text = ''; return ok(); }
    if (args[0] === 'send-keys' && args.includes('C-u')) {
      state.text = wrap(state.text).slice(0, -1).join(' ');
      state.rounds += 1;
      if (opts.onClear) opts.onClear(state.rounds, state);
      return ok();
    }
    if (args[0] === 'set-buffer' || args[0] === 'load-buffer') { state.buffer = args[args.length - 1]; return ok(); }
    if (args[0] === 'paste-buffer') { state.text += state.buffer || ''; return ok(); }
    return ok();
  };
  fn.calls = calls;
  fn.state = state;
  fn.enters = () => calls.filter((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Enter').length;
  fn.clears = () => calls.filter((a) => a[0] === 'send-keys' && a.includes('C-u')).length;
  chat.setRunner(fn);
  chat.setDryRun(false);
  chat.setPauser(() => {});
  return fn;
}
function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }

const SINCE = new Date(Date.now() - 11 * 60 * 1000).toISOString();
function withAgent(fn, card = {}) {
  const board = fleet.install([fleet.agent('al', { state: 'idle', ...card })]);
  const roster = board.agents.map((c) => ({ ...c, unsentInput: { since: SINCE } }));
  chat.setRosterSource(() => roster);
  let out;
  try { out = fn(roster, roster[0]); } catch (e) { board.restore(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(() => board.restore());
  board.restore();
  return out;
}
let saved = [];
function saveInto(calls) {
  chat.setDraftSaver((session, text, opts) => {
    saved.push({ session, text, opts, atCall: calls ? calls.calls.length : -1 });
    return drafts.add(session, text, opts);
  });
}
const PERSON = 'can you also look at the second invoice from the supplier before lunch';

test.beforeEach(() => {
  chat.resetForTests();
  chat.setDraftSaver(null);
  saved = [];
  try { fs.rmSync(path.dirname(drafts.fileFor('al')), { recursive: true, force: true }); } catch { /* fresh */ }
});
test.after(() => { chat.setRunner(null); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('kosmos#6717: a person\'s text stuck in an idle box is saved as a draft, then cleared, never sent; the next message then lands', () => withAgent(async (roster, card) => {
  const p = pane(PERSON);
  saveInto(p);
  // PRECONDITION: while it sits there, a message to this agent is refused, typed nowhere (the agent is deaf).
  const before = chat.deliver('al', 'hello from the person', roster);
  assert.equal(before.inputHeld, true, 'PRECONDITION: the stuck text holds the agent');
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'drafted', JSON.stringify(r));
  assert.equal(p.enters(), 0, 'never Enter on text Kosmos did not type');
  assert.equal(p.state.sent.length, 0);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].text, PERSON, 'the whole text is kept');
  assert.equal(saved[0].opts.since, SINCE);
  const firstClear = p.calls.findIndex((a) => a[0] === 'send-keys' && a.includes('C-u'));
  assert.ok(firstClear >= 0 && saved[0].atCall <= firstClear, 'the draft is written before the first clearing key');
  assert.deepEqual(p.calls[firstClear].slice(3), ['C-e', 'C-u', 'C-k'], 'the measured keys, never C-c or Escape');
  assert.ok(!p.calls.some((a) => a[0] === 'send-keys' && (a.includes('C-c') || a.includes('Escape'))));
  assert.equal(p.state.text, '', 'the box is empty');
  const kept = drafts.list('al');
  assert.equal(kept.length, 1);
  assert.equal(kept[0].text, PERSON);
  // The agent hears again: the next message is typed and sent.
  const after = chat.deliver('al', 'hello from the person', roster);
  assert.equal(after.state, chat.DELIVERY.PLACED, after.because);
  assert.equal(p.state.sent.length, 1, 'only the new message was sent');
  assert.equal(p.state.sent[0].includes(PERSON), false, 'the draft rode on nothing');
}));

test('kosmos#6717 MUTANT: with no recovery the agent stays deaf (the sweep is what makes it hear)', () => withAgent(async (roster) => {
  const p = pane(PERSON);
  const tick = stuck.makeTick({ allowed: () => true, roster: () => roster, recover: async () => ({ outcome: 'waiting', because: 'mutant' }), stuckMs: chat.STUCK_INPUT_MS, log: () => {} });
  await tick();
  assert.equal(chat.deliver('al', 'are you there', roster).inputHeld, true, 'deaf without the recovery');
  assert.equal(p.state.text, PERSON);
  // The real recovery through the same tick: the agent hears.
  saveInto(p);
  const lines = [];
  const real = stuck.makeTick({ allowed: () => true, roster: () => roster, recover: (c, s) => chat.recoverStuckInput(c, s), stuckMs: chat.STUCK_INPUT_MS, log: (l) => lines.push(l) });
  await real();
  assert.equal(chat.deliver('al', 'are you there', roster).state, chat.DELIVERY.PLACED);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^stuck-input: .*\(al\) text unsent in its input box ~11 min: saved the text as a draft/);
}));

test('kosmos#6717: a draft that cannot be written leaves the box exactly as it is', () => withAgent(async (roster, card) => {
  const p = pane(PERSON);
  chat.setDraftSaver(() => ({ ok: false, because: 'disk full' }));
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'waiting');
  assert.equal(p.clears(), 0, 'nothing cleared without a saved copy');
  assert.equal(p.enters(), 0);
  assert.equal(p.state.text, PERSON);
  // CONTROL: no saver at all is the same.
  chat.setDraftSaver(null);
  assert.equal((await chat.recoverStuckInput(card, SINCE)).outcome, 'waiting');
  assert.equal(p.clears(), 0);
}));

test('kosmos#6717: the board\'s own line is pressed, even after a restart that left it no retries; nothing is drafted', () => withAgent(async (roster, card) => {
  const MSG = 'Kosmos here: please read the ruling on the card and carry on with the fix you described this morning.';
  const first = pane('');
  first.calls.length = 0;
  // A delivery whose Enter does not take: the box keeps the line (the pane ignores this one Enter).
  const fn = (args) => {
    if (args[0] === 'send-keys' && args[args.length - 1] === 'Enter') return ok();
    return first(args);
  };
  chat.setRunner(fn);
  assert.equal(chat.deliver('al', MSG, roster).unsubmitted, true, 'PRECONDITION: left in the box');
  chat.restartUnsentForTests();
  const p = pane(MSG);
  saveInto(p);
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'pressed', JSON.stringify(r));
  assert.equal(p.enters(), 1);
  assert.deepEqual(p.state.sent, [MSG]);
  assert.equal(saved.length, 0, 'the board\'s own line is not a draft');
  assert.equal(p.clears(), 0);
}));

test('kosmos#6717: the board\'s own line on an agent that is no longer idle is not pressed', () => withAgent(async (roster, card) => {
  const MSG = 'Kosmos here: please read the ruling on the card and carry on with the fix you described this morning.';
  const first = pane('');
  chat.setRunner((args) => (args[0] === 'send-keys' && args[args.length - 1] === 'Enter' ? ok() : first(args)));
  assert.equal(chat.deliver('al', MSG, roster).unsubmitted, true, 'PRECONDITION');
  const p = pane(MSG);
  roster[0].state = 'working';
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'waiting');
  assert.equal(r.because, 'not idle');
  assert.equal(p.enters(), 0);
  // CONTROL: idle again, it is pressed.
  roster[0].state = 'idle';
  assert.equal((await chat.recoverStuckInput(card, SINCE)).outcome, 'pressed');
}));

test('kosmos#6717: the board\'s line with the person\'s words added is not the board\'s: drafted whole, not sent', () => withAgent(async (roster, card) => {
  const MSG = 'Kosmos here: please read the ruling on the card and carry on with the fix you described this morning.';
  const first = pane('');
  chat.setRunner((args) => (args[0] === 'send-keys' && args[args.length - 1] === 'Enter' ? ok() : first(args)));
  assert.equal(chat.deliver('al', MSG, roster).unsubmitted, true, 'PRECONDITION');
  const p = pane(MSG + ' and also the invoice');
  saveInto(p);
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'drafted');
  assert.equal(p.enters(), 0);
  assert.equal(saved[0].text, MSG + ' and also the invoice');
}));

test('kosmos#6717: ghost (dim) text is not text: nothing is pressed, saved or cleared', () => withAgent(async (roster, card) => {
  const ghost = [RULE, '\x1b[39m❯ \x1b[2m@src/engine/chat.js\x1b[0m', RULE, '  scratch · Haiku 5.5'].join('\n') + '\n';
  const p = pane('', { raw: ghost });
  saveInto(p);
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'waiting');
  assert.equal(r.because, 'empty');
  assert.equal(p.clears() + p.enters(), 0);
  assert.equal(saved.length, 0);
}));

test('kosmos#6717: a folded paste or image is left in the box (its words are not on screen to save)', () => withAgent(async (roster, card) => {
  for (const folded of ['[Pasted text #1]', 'see this [Pasted text #2 +40 lines] please', '[Image #1] what is this']) {
    chat.resetForTests();
    chat.setRosterSource(() => roster);
    const p = pane(folded);
    saveInto(p);
    const r = await chat.recoverStuckInput(card, SINCE);
    assert.equal(r.outcome, 'left', folded);
    assert.equal(p.clears() + p.enters(), 0, folded);
  }
  assert.equal(saved.length, 0);
}));

test('kosmos#6717: a card that is not idle, or a held one, is not touched', () => withAgent(async (roster, card) => {
  const p = pane(PERSON);
  saveInto(p);
  roster[0].state = 'working';
  assert.equal((await chat.recoverStuckInput(card, SINCE)).outcome, 'waiting');
  assert.equal(p.clears(), 0);
  chat.setRosterSource(() => null);
  roster[0].state = 'idle';
  assert.equal((await chat.recoverStuckInput(card, SINCE)).outcome, 'waiting', 'no roster: nothing done');
  assert.equal(p.clears(), 0);
  assert.equal(saved.length, 0);
}));

test('kosmos#6717: someone typing while the box is cleared stops the clearing, and their words stay', () => withAgent(async (roster, card) => {
  const LONG = PERSON + ' ' + 'and the third one, and a note on the fourth. '.repeat(6);
  const p = pane(LONG, { onClear: (n, s) => { if (n === 1) s.text += ' WAIT'; } });
  saveInto(p);
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'drafted-not-cleared', JSON.stringify(r));
  assert.equal(p.clears(), 1, 'stopped after the round that showed new words');
  assert.ok(p.state.text.endsWith('WAIT'));
  assert.equal(saved[0].text.replace(/\s+/g, ''), LONG.replace(/\s+/g, ''), 'the draft still holds all of the stuck text');
}));

test('kosmos#6717: a stuck text of several rows is cleared row by row and kept word for word', () => withAgent(async (roster, card) => {
  const LONG = Array.from({ length: 9 }, (_, i) => `line ${i} of what the person wrote out at length`).join(' ');
  assert.equal(wrap(LONG).length, 6, 'PRECONDITION: six rows, the most a box can draw and still show all it holds');
  const p = pane(LONG);
  saveInto(p);
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'drafted');
  assert.equal(p.clears(), wrap(LONG).length, 'one round a row');
  assert.equal(saved[0].text, LONG, 'word for word');
}));

test('kosmos#6717: a box drawing seven rows may be hiding its start (a pasted line scrolls), so it is left whole', () => withAgent(async (roster, card) => {
  const PASTED = Array.from({ length: 40 }, (_, i) => `point ${i} about the release plan`).join(', ');
  for (const keep of [7, 0]) {   // scrolled to its last 7 rows; and typed slowly, all of it drawn
    chat.resetForTests();
    chat.setRosterSource(() => roster);
    const p = pane(PASTED, { keep });
    saveInto(p);
    const r = await chat.recoverStuckInput(card, SINCE);
    assert.equal(r.outcome, 'left', 'rows kept: ' + keep);
    assert.equal(r.because, 'it is too long to read whole');
    assert.equal(p.clears() + p.enters(), 0);
  }
  assert.equal(saved.length, 0, 'no fragment saved as if it were the whole text');
}));

test('kosmos#6717: an agent whose terminal window someone has open is left alone (the text is in front of them)', () => withAgent(async (roster, card) => {
  const p = pane(PERSON, { attached: true });
  saveInto(p);
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'left');
  assert.match(r.because, /terminal window is open/);
  assert.equal(p.clears() + p.enters(), 0);
  assert.equal(saved.length, 0);
}));

test('kosmos#6717: a clearing that tmux refused is tried again next minute, and the text is kept once', () => withAgent(async (roster) => {
  const p = pane(PERSON);
  let refuse = true;
  chat.setRunner((args) => (refuse && args[0] === 'send-keys' && args.includes('C-u') ? { ran: true, spawnFailed: false, status: 1, out: '', err: 'no' } : p(args)));
  saveInto(p);
  const lines = [];
  const tick = stuck.makeTick({ allowed: () => true, roster: () => roster, recover: (c, s) => chat.recoverStuckInput(c, s), stuckMs: chat.STUCK_INPUT_MS, log: (l) => lines.push(l) });
  await tick(); await tick();
  assert.equal(lines.length, 1, 'said once');
  assert.match(lines[0], /tmux refused the keys/);
  refuse = false;
  await tick();
  assert.equal(p.state.text, '', 'cleared once tmux took the keys');
  assert.equal(drafts.list('al').length, 1, 'one draft for the three tries');
}));

test('kosmos#6717: the sweep picks idle Claude Code cards whose box has held text ten minutes, and says a left text once', async () => {
  const now = Date.now();
  const at = (min) => ({ since: new Date(now - min * 60000).toISOString() });
  const board = fleet.install([
    fleet.agent('a', { state: 'idle' }), fleet.agent('b', { state: 'idle' }), fleet.agent('c', { state: 'working' }),
    fleet.agent('d', { state: 'idle', runner: 'codex', command: 'node', screen: '› Ask Codex to do anything\n  gpt-5.6-sol default · ~/Kosmos/agents/d' }), fleet.agent('e', { state: 'idle' }), fleet.agent('f', { state: 'idle' }),
  ]);
  let cards;
  try {
    const box = { a: at(11), b: at(9), c: at(30), d: at(30), f: at(10) };
    cards = board.agents.map((c) => (box[c.sessionName] ? { ...c, unsentInput: box[c.sessionName] } : c));
  } finally { board.restore(); }
  assert.deepEqual(cards.map((c) => c.sessionName).sort(), ['a', 'b', 'c', 'd', 'e', 'f'], 'PRECONDITION: the fleet cards');
  assert.deepEqual(stuck.stuckCards(cards, now, chat.STUCK_INPUT_MS).map((c) => c.sessionName).sort(), ['a', 'f']);
  const lines = [];
  const tick = stuck.makeTick({ allowed: () => true, roster: () => cards, now: () => now, stuckMs: chat.STUCK_INPUT_MS,
    recover: async () => ({ outcome: 'left', because: 'it holds a pasted block' }), log: (l) => lines.push(l) });
  await tick(); await tick();
  assert.equal(lines.length, 2, 'once per card, not every minute');
  const off = stuck.makeTick({ allowed: () => false, roster: () => cards, stuckMs: chat.STUCK_INPUT_MS, recover: async () => { throw new Error('ran'); }, log: () => {} });
  await off();
});

test('kosmos#6717: a draft is drawn in the conversation at its time as Kosmos\'s line, never as a message, and dismissed by id', () => {
  const a = drafts.add('al', PERSON, { since: SINCE });
  assert.equal(a.ok, true);
  const t0 = Date.parse(drafts.list('al')[0].at);
  const rows = [
    { at: new Date(t0 - 1000).toISOString(), text: 'earlier', from: null },
    { at: new Date(t0 + 1000).toISOString(), text: 'later', from: 'al' },
  ];
  const out = chat.withDraftRows(rows, drafts.list('al'));
  assert.equal(out.length, 3);
  assert.equal(out[1].kind, 'kosmos');
  assert.equal(out[1].draft, true);
  assert.equal(out[1].draftId, a.id);
  assert.equal(out[1].text, PERSON);
  assert.equal(out[1].from, null);
  assert.equal(rows.length, 2, 'the stored rows are untouched');
  assert.equal(drafts.dismiss('al', 'nope00000000'), false);
  assert.equal(drafts.dismiss('al', a.id), true);
  assert.deepEqual(drafts.list('al'), []);
  assert.equal(chat.withDraftRows(rows, drafts.list('al')), rows);
  // Kept privately, and one agent's drafts are not another's.
  drafts.add('al', 'x');
  assert.equal(fs.statSync(drafts.fileFor('al')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(drafts.fileFor('al'))).mode & 0o777, 0o700, 'the folder too');
  assert.deepEqual(drafts.list('Al'), []);
});

test('kosmos#6717: a box the keys do not empty is saved once and not cleared at again for the same text', () => withAgent(async (roster) => {
  const p = pane(PERSON, { onClear: (n, s) => { s.text = PERSON; } });   // keys rebound (vim mode, a newer Claude Code)
  saveInto(p);
  const lines = [];
  const tick = stuck.makeTick({ allowed: () => true, roster: () => roster, recover: (c, s) => chat.recoverStuckInput(c, s), stuckMs: chat.STUCK_INPUT_MS, log: (l) => lines.push(l) });
  await tick();
  const rounds = p.clears();
  assert.ok(rounds > 0 && rounds <= 2 * 1 + 6, 'bounded: ' + rounds);
  await tick();
  await tick();
  assert.equal(p.clears(), rounds, 'not cleared at again every minute');
  assert.equal(drafts.list('al').length, 1, 'one draft, not one a minute');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /the box was not cleared \(the box did not empty\)/);
  assert.equal(p.enters(), 0);
  // The same text saved again (a later attempt) is the same draft, never a second copy.
  assert.equal(drafts.add('al', PERSON).id, drafts.list('al')[0].id);
  assert.equal(drafts.list('al').length, 1);
}));

test('kosmos#6717: with the most drafts already kept, none is dropped: the box is left and the log says why', () => withAgent(async (roster, card) => {
  for (let i = 0; i < drafts.MAX_KEPT; i += 1) assert.equal(drafts.add('al', 'kept ' + i).ok, true);
  const p = pane(PERSON);
  saveInto(p);
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'left', JSON.stringify(r));
  assert.match(r.because, /20 drafts are already kept/);
  assert.equal(p.clears() + p.enters(), 0, 'the box is untouched');
  const kept = drafts.list('al');
  assert.equal(kept.length, drafts.MAX_KEPT);
  assert.equal(kept[0].text, 'kept 0', 'the oldest unseen draft is still there');
}));

test('kosmos#6717: a box read empty once mid-redraw is not taken as cleared: the next read decides', () => withAgent(async (roster, card) => {
  const LONG = PERSON + ' and the remainder that is still in the box after the first round of keys';
  let reads = 0;
  const p = pane(LONG, {});
  const real = p;
  chat.setRunner((args) => {
    if (args[0] === 'capture-pane' && args.includes('-e') && real.state.rounds === 1 && reads++ === 0) return ok(draw(''));   // one redraw
    return real(args);
  });
  saveInto(p);
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'drafted');
  assert.equal(p.state.text, '', 'it carried on until the box really was empty');
  assert.ok(p.clears() >= 2);
}));

test('kosmos#6717: what a round leaves must be the old text with a row taken out; a letter typed is not, even one it holds', () => {
  assert.equal(chat.stuckShrunk('a1b2c3', 'a1b2'), true, 'the last row');
  assert.equal(chat.stuckShrunk('a1b2c3', 'b2c3'), true, 'the first row');
  assert.equal(chat.stuckShrunk('a1b2c3', 'a1c3'), true, 'a middle row (cursor on it)');
  assert.equal(chat.stuckShrunk('a1b2c3', 'a1b2e'), false, 'a letter typed after what was left');
  assert.equal(chat.stuckShrunk('abcabc', 'abca'), true);
  assert.equal(chat.stuckShrunk('a1b2c3', 'a1b2c3'), false, 'nothing taken out');
  assert.equal(chat.stuckShrunk('a1b2c3', 'a1b2c3x'), false, 'longer');
});

test('kosmos#6717: a letter typed during the clearing, one the old text already holds, stops it', () => withAgent(async (roster, card) => {
  const LONG = PERSON + ' ' + 'and the third one, and a note on the fourth. '.repeat(6);
  const p = pane(LONG, { onClear: (n, s) => { if (n === 1) s.text += 'e'; } });
  saveInto(p);
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'drafted-not-cleared', JSON.stringify(r));
  assert.equal(p.clears(), 1);
  assert.ok(p.state.text.endsWith('e'), 'their letter is still there');
}));

test('kosmos#6717: words typed between two rounds are seen before the next keys, which are then not sent', () => withAgent(async (roster, card) => {
  const LONG = PERSON + ' ' + 'and the third one, and a note on the fourth. '.repeat(6);
  const p = pane(LONG);
  let looks = 0;
  chat.setRunner((args) => {
    if (args[0] === 'capture-pane' && args.includes('-e') && p.state.rounds === 1 && ++looks === 2) p.state.text += ' hold on';   // typed after the round was read
    return p(args);
  });
  saveInto(p);
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'drafted-not-cleared', JSON.stringify(r));
  assert.equal(p.clears(), 1, 'no keys after the words appeared');
  assert.ok(p.state.text.endsWith('hold on'));
}));

test('kosmos#6717: the board\'s own line whose Enter does not take is said once in the log, and nothing is drafted', () => withAgent(async (roster) => {
  const MSG = 'Kosmos here: please read the ruling on the card and carry on with the fix you described this morning.';
  const first = pane('');
  chat.setRunner((args) => (args[0] === 'send-keys' && args[args.length - 1] === 'Enter' ? ok() : first(args)));
  assert.equal(chat.deliver('al', MSG, roster).unsubmitted, true, 'PRECONDITION');
  const p = pane(MSG);
  let enters = 0;
  chat.setRunner((args) => { if (args[0] === 'send-keys' && args[args.length - 1] === 'Enter') { enters += 1; return ok(); } return p(args); });   // Enter rebound
  saveInto(p);
  const lines = [];
  const tick = stuck.makeTick({ allowed: () => true, roster: () => roster, recover: (c, s) => chat.recoverStuckInput(c, s), stuckMs: chat.STUCK_INPUT_MS, log: (l) => lines.push(l) });
  await tick(); await tick(); await tick();
  assert.equal(lines.length, 1, lines.join(''));
  assert.match(lines[0], /left the text in the box \(Enter on the line Kosmos had left there did not send it\)/);
  assert.equal(enters, 1,
    'pressed once by this sweep, not every minute (the #6436 retries keep their own day bound)');
  assert.equal(saved.length, 0);
  assert.equal(p.clears(), 0);
}));

test('kosmos#6717: a text given up on stays given up through a minute busy, and a new text is tried', async () => {
  const now = Date.now();
  const board = fleet.install([fleet.agent('a', { state: 'idle' })]);
  const card = { ...board.agents[0], unsentInput: { since: new Date(now - 11 * 60000).toISOString() } };
  board.restore();
  const roster = [card];
  let tries = 0;
  const tick = stuck.makeTick({ allowed: () => true, roster: () => roster, now: () => now, stuckMs: chat.STUCK_INPUT_MS,
    recover: async () => { tries += 1; return { outcome: 'drafted-not-cleared', because: 'the box did not empty' }; }, log: () => {} });
  await tick();
  card.state = 'working'; await tick();
  card.state = 'idle'; await tick();
  assert.equal(tries, 1, 'not tried again for the same text');
  card.unsentInput = { since: new Date(now - 12 * 60000).toISOString() };
  await tick();
  assert.equal(tries, 2, 'a new text is a new try');
});

test('kosmos#6717: a round that only takes out a line break (the text reads the same) is not given up on; the next round goes on', () => withAgent(async (roster, card) => {
  const p = pane(PERSON + ' and the rest of it, which runs onto a second row of the box');
  let before = null;
  chat.setRunner((args) => {
    if (args[0] === 'send-keys' && args.includes('C-u') && p.state.rounds === 0 && before === null) { before = p.state.text; p.state.rounds += 1; return ok(); }   // a line break only
    return p(args);
  });
  saveInto(p);
  const r = await chat.recoverStuckInput(card, SINCE);
  assert.equal(r.outcome, 'drafted', JSON.stringify(r));
  assert.equal(p.state.text, '');
  assert.ok(before !== null, 'PRECONDITION: the first round changed nothing on screen');
}));

test('kosmos#6717: a piece of a text already kept (a clearing that stopped partway) is not kept again', () => {
  const whole = drafts.add('al', 'first row of it and second row of it');
  assert.equal(whole.ok, true);
  const piece = drafts.add('al', 'first row of it');
  assert.equal(piece.id, whole.id);
  assert.equal(piece.already, true);
  assert.equal(drafts.list('al').length, 1);
  // CONTROL: different words are a new draft.
  assert.notEqual(drafts.add('al', 'something else entirely').id, whole.id);
  assert.equal(drafts.list('al').length, 2);
});
