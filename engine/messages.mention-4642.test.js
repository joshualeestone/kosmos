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

/* Who each post reached as ADDRESSED ([message from ...]) and as BACKGROUND, by pane. */
function post(text) {
  const board = fleet.install([
    fleet.agent('leo', { state: 'idle' }),
    fleet.agent('kano', { state: 'idle' }),
    fleet.agent('subzero', { state: 'idle', displayName: 'Sub-Zero' }),
    fleet.agent('mara', { state: 'idle' }),
  ]);
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    const typed = arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text }, board.agents, MEMBERS);
    assert.equal(sent.state, chat.DELIVERY.PLACED, sent.because || '');
    const who = (s) => (/=([a-z]+)-discord:/.exec(s.target || '') || [])[1];
    const envelopes = typed().filter((s) => s.text.startsWith('['));
    assert.equal(envelopes.length, 3, 'a room of four fans out to the three others');
    return {
      addressed: envelopes.filter((s) => s.text.startsWith('[message from your colleague')).map(who).sort(),
      background: envelopes.filter((s) => s.text.startsWith('[background from your colleague')).map(who).sort(),
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
