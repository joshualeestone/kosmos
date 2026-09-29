'use strict';
/**
 * #4642: a room post addresses a member by its session name OR its display name, whatever the case and
 * punctuation, and only in the @ form. Before this, only the exact, case-sensitive session name counted, so
 * `@Kano` and `@Sub-Zero` reached kano and subzero marked "not addressed to you" (measured: 10 such posts in
 * one week on a real board).
 *
 * Every root is sandboxed (data, workers, launch, claude config): a display name is read from the agent's
 * creation record before its instruction file, and an unsandboxed launch root reads the real fleet's records.
 *
 *   node --test engine/messages.mention-4642.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-mention-4642-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const messages = require('./messages');
const fleet = require('../test-support/fleet');

const PROJECT = 'henderson-lease';
const MEMBERS = ['leo', 'kano', 'subzero', 'mara'];

function arm() {
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  // Every envelope and the pane it was typed at (the paste-buffer's -t, which the submit Enter follows).
  return () => {
    const out = []; let cur = ''; let target = null; let has = false;
    for (const a of calls) {
      if (a[0] === 'set-buffer') { cur += a[a.length - 1]; has = true; }
      else if (a[0] === 'paste-buffer') target = a[a.length - 1];
      else if (a[0] === 'send-keys' && a[a.length - 1] === 'Enter' && has) { out.push({ text: cur, target }); cur = ''; target = null; has = false; }
    }
    return out;
  };
}

/* Who each post reached as ADDRESSED ([message from ...]) and as BACKGROUND, by pane. `agents` is the
   fleet (display names included); `members` is the room. */
const FLEET = () => [
  fleet.agent('leo', { state: 'idle' }),
  fleet.agent('kano', { state: 'idle' }),
  fleet.agent('subzero', { state: 'idle', displayName: 'Sub-Zero' }),
  fleet.agent('mara', { state: 'idle' }),
];
function post(text, agents = FLEET(), members = MEMBERS) {
  const board = fleet.install(agents);
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    const typed = arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text }, board.agents, members);
    assert.equal(sent.state, chat.DELIVERY.PLACED, sent.because || '');
    const who = (s) => (/=([a-z0-9_-]+)-discord:/.exec(s.target || '') || [])[1];
    const envelopes = typed().filter((s) => s.text.startsWith('['));
    assert.equal(envelopes.length, members.length - 1, 'the room fans out to everyone but the sender');
    return {
      addressed: envelopes.filter((s) => s.text.startsWith('[message from your colleague')).map(who).sort(),
      background: envelopes.filter((s) => s.text.startsWith('[background from your colleague')).map(who).sort(),
      row: messages.readLog().filter((m) => m && m.kind === 'post').pop(),
      note: sent.ambiguousNote,
    };
  } finally { board.restore(); }
}

test.beforeEach(() => { chat.resetForTests(); messages.resetForTests(); try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ } });
test.after(() => { chat.setRunner(null); chat.setDryRun(true); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#4642: @Kano and @KANO address kano (the session name, any case)', () => {
  assert.deepEqual(post('can you check the lease, @Kano?').addressed, ['kano']);
  assert.deepEqual(post('@KANO the numbers, please').addressed, ['kano']);
});

test('#4642: @Sub-Zero addresses subzero through its display name', () => {
  const r = post('@Sub-Zero please review the lease');
  assert.deepEqual(r.addressed, ['subzero'], 'the display name did not address its agent');
  assert.deepEqual(r.background, ['kano', 'mara']);
});

test('#4642: punctuation in the mention is ignored (@sub_zero, @SUBZERO, a trailing full stop)', () => {
  assert.deepEqual(post('thanks @sub_zero').addressed, ['subzero']);
  assert.deepEqual(post('over to @SUBZERO.').addressed, ['subzero']);
});

test('#4642 control: a plain word never addresses (kano, Sub-Zero with no @)', () => {
  const r = post('kano and Sub-Zero are both on this, no need to reply');
  assert.deepEqual(r.addressed, [], 'a word without @ was promoted to a request');
});

test('#4642 control: a longer token does not address the shorter name (@kanobot, @subzerox)', () => {
  assert.deepEqual(post('@kanobot please').addressed, [], '@kanobot must not name kano');
  assert.deepEqual(post('@subzerox please').addressed, [], '@subzerox must not name subzero');
});

test('#4642 control: an email-shaped string and an unknown @name address nobody', () => {
  assert.deepEqual(post('mail admin@kano.example and ask @Somebody').addressed, []);
});

test('#4642 control: the exact session name still addresses, as before', () => {
  assert.deepEqual(post('@mara have a look').addressed, ['mara']);
});

test('#4642 control: two members sharing a normalised name are addressed by neither (ambiguity demotes)', () => {
  const agents = [
    fleet.agent('leo', { state: 'idle' }),
    fleet.agent('subzero', { state: 'idle', displayName: 'Sub-Zero' }),
    fleet.agent('frost', { state: 'idle', displayName: 'Sub Zero' }),
    fleet.agent('mara', { state: 'idle' }),
  ];
  const room = ['leo', 'subzero', 'frost', 'mara'];
  const r = post('@Sub-Zero please', agents, room);
  assert.deepEqual(r.addressed, [], 'an ambiguous mention was promoted to a request');
  assert.deepEqual(r.background, ['frost', 'mara', 'subzero']);
  assert.deepEqual(r.row.ambiguousMentions, ['Sub-Zero'], 'the dropped request is not findable on the post row');
  assert.equal(r.row.mentioned, undefined);
  // the exact session name still wins over the ambiguity
  const exact = post('@subzero please', agents, room);
  assert.deepEqual(exact.addressed, ['subzero']);
  assert.equal(exact.row.ambiguousMentions, undefined, 'an exact name is not ambiguous');
  assert.deepEqual(exact.row.mentioned, ['subzero']);
});

test('#4642 control: a display name of an agent NOT in the room adds no alias', () => {
  const agents = [...FLEET(), fleet.agent('kitana', { state: 'idle', displayName: 'Mara' })];
  // Mara the display name of kitana, who is not a member, must not make @Mara ambiguous or reach kitana
  assert.deepEqual(post('@Mara look', agents).addressed, ['mara']);
  assert.deepEqual(post('@Kitana look', agents).addressed, []);
});

test('#4642 control: a display name that normalises to under two characters addresses nobody', () => {
  const agents = [
    fleet.agent('leo', { state: 'idle' }),
    fleet.agent('kano', { state: 'idle', displayName: 'K' }),
    fleet.agent('subzero', { state: 'idle' }),
    fleet.agent('mara', { state: 'idle' }),
  ];
  assert.deepEqual(post('@k and @K. please', agents).addressed, []);
});

test('#4642: the sender is never addressed, so its own display name can only reach another member who holds it', () => {
  const agents = [
    fleet.agent('leo', { state: 'idle', displayName: 'Leo' }),
    fleet.agent('kano', { state: 'idle' }),
    fleet.agent('subzero', { state: 'idle' }),
    fleet.agent('mara', { state: 'idle' }),
  ];
  // leo is the sender: @Leo names nobody else, so it addresses nobody (and never leo itself)
  assert.deepEqual(post('note to self, @Leo', agents).addressed, []);
});

/* #4653: the sender is told when an @-word named two members and so reached neither. */
const CLASH = () => [
  fleet.agent('leo', { state: 'idle' }),
  fleet.agent('subzero', { state: 'idle', displayName: 'Sub-Zero' }),
  fleet.agent('frost', { state: 'idle', displayName: 'Sub Zero' }),
  fleet.agent('mara', { state: 'idle' }),
];
const CLASH_ROOM = ['leo', 'subzero', 'frost', 'mara'];

test('#4653: the post answer tells the sender who an ambiguous @-word could mean, by the names the page shows', () => {
  assert.equal(post('@Sub-Zero. please', CLASH(), CLASH_ROOM).note,
    '@Sub-Zero could mean Sub Zero (@frost) or Sub-Zero (@subzero), so it reached neither as a request. To ask one of them, use the exact name, like @frost.');
  assert.equal(post('@subzero please', CLASH(), CLASH_ROOM).note, undefined, 'a unique mention carried a note');
  assert.equal(post('no mention at all', CLASH(), CLASH_ROOM).note, undefined);
});

test('#4653: when the post also names one of them exactly, the note says only who was not asked', () => {
  const r = post('@Sub-Zero and @frost please', CLASH(), CLASH_ROOM);
  assert.deepEqual(r.addressed, ['frost']);
  assert.equal(r.note, '@Sub-Zero could mean Sub Zero (@frost) or Sub-Zero (@subzero), so it did not ask Sub-Zero (@subzero). To ask them, use the exact name, like @subzero.');
  assert.equal(post('@Sub-Zero, @frost and @subzero', CLASH(), CLASH_ROOM).note, undefined, 'everyone was named exactly, yet a note said someone was not asked');
});

test('#4653: one sentence per name, however it is spelled in the post', () => {
  const note = post('@Sub-Zero and @sub_zero and @SUBZERO.', CLASH(), CLASH_ROOM).note;
  assert.equal((note.match(/could mean/g) || []).length, 1, note);
});

test('#4653: ambiguousNote words three candidates, strips quotes and backslashes, and says nothing when nothing was lost', () => {
  const amb = new Map([['x1', { word: 'X-1', members: ['a1', 'b1', 'c1'] }]]);
  assert.equal(messages.ambiguousNote(amb, new Set(), new Map()),
    '@X-1 could mean @a1, @b1 or @c1, so it reached none of them as a request. To ask one of them, use the exact name, like @a1.');
  const shown = new Map([['a1', 'Al "the" \\Bot\u0007']]);
  const note = messages.ambiguousNote(amb, new Set(['b1']), shown);
  assert.equal(note, '@X-1 could mean Al the Bot (@a1), @b1 or @c1, so it did not ask Al the Bot (@a1) or @c1. To ask one of them, use the exact name, like @a1.');
  assert.doesNotMatch(note, /["\\\u0000-\u001f]/, 'the note carries a character the CLI would cut on');
  assert.equal(messages.ambiguousNote(amb, new Set(['a1', 'b1', 'c1']), shown), '');
});
