'use strict';

/**
 * #3224: the cross-project misroute DETECTOR's own suite.
 *
 * An agent on several projects sometimes answers into the WRONG project's room.
 * The router cannot prevent it (the id is explicit + validated, the envelope
 * already carries name+id+command #3035, and stateProject #2837 is circular), so
 * this ships a DETECTION-ONLY signal: when an agent posts to project A while it
 * OWES an unanswered addressed operator question in project B, that post is a
 * suspect and one line is logged. It never blocks or refuses a post.
 *
 * Same harness idiom as messages.test.js: sandbox BEFORE any engine require,
 * real roster rows through the real producers, the tmux runner scripted, and
 * every claim read from the record rather than trusted from a verdict.
 */

const os = require('node:os');

// Sandboxed before the engine require, like every sibling suite: this module
// writes a message log AND the misroute log under store.ROOT.
const SANDBOX = require('node:path').join(os.tmpdir(), 'kosmos-misroute-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const fleet = require('../test-support/fleet');

function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }

/** A tmux fake: the version probe answers VERIFY_FORMAT, every send-keys lands. */
function arm(answers) {
  const list = Array.isArray(answers) ? answers.slice() : [];
  const fn = (args) => {
    if (args[0] === 'display-message') return ok('2.1.212\t\t0\n');
    return list.length ? list.shift() : ok();
  };
  chat.setRunner(fn);
  chat.setDryRun(false);
  return fn;
}

/** The sender seam: whichever pane asks, it belongs to this session. */
function armSender(session) {
  messages.setRunner(() => ({ ok: true, session }));
}

function withFleet(specs, fn) {
  const board = fleet.install(specs);
  try { return fn(board); } finally { board.restore(); }
}

// mara is a member of BOTH projects below; that is the multi-project agent the
// card is about. leo/april round out the rooms so a mention is unambiguous.
const MEMBERS = ['leo', 'mara', 'april'];
function room() {
  return [fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' }),
    fleet.agent('april', { state: 'idle' })];
}

/** The operator asks @mara in `project`; returns the seeded post's id. Delivery
 *  is armed so the outcome is TYPED (an undelivered ask never owes, by design). */
function askMaraIn(board, project, projectName) {
  armSender('operator');
  arm([ok(), ok(), ok()]);
  const sent = messages.sendPost(
    { operator: true, project, projectName, text: '@mara where is the draft?' },
    board.agents, MEMBERS);
  assert.equal(sent.state, chat.DELIVERY.PLACED, sent.because || '');
  const row = messages.record().rows.find((m) => m.kind === 'post' && m.operator === true && m.project === project);
  assert.ok(row && row.id, 'the operator ask was not recorded');
  assert.deepEqual(row.mentioned, ['mara'], 'the tokenizer did not mark mara addressed');
  return row.id;
}

test.beforeEach(() => {
  chat.resetForTests();
  messages.resetForTests();
  try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ }
  try { fs.rmSync(messages.MISROUTE_LOG, { force: true }); } catch { /* fresh */ }
});
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('a post to project A while owing an addressed answer in project B is a suspect, at ANY age', () => {
  withFleet(room(), (board) => {
    const bId = askMaraIn(board, 'proj-b', 'Project B');
    // The ask is fresh (age ~0). The 10-minute nudge floor would hide it; the
    // detector asks at afterMs 0, so it sees it now -- the fast-misroute case.
    const now = Date.now();
    assert.deepEqual(messages.unanswered('proj-b', now), {},
      'the default 10-minute floor should NOT flag a fresh ask (regression guard for existing callers)');
    assert.deepEqual(messages.unanswered('proj-b', now, 0), { [bId]: ['mara'] },
      'afterMs 0 should surface the fresh owed ask');
    // mara posts to a DIFFERENT project -> suspect.
    assert.deepEqual(messages.misrouteSuspects('mara', 'proj-a', now),
      [{ project: 'proj-b', posts: [bId] }],
      'posting to proj-a while owing proj-b was not flagged');
  });
});

test('noteMisrouteSuspect logs ONE line for a suspect and NOTHING when clean; never touches the message log', () => {
  withFleet(room(), (board) => {
    const bId = askMaraIn(board, 'proj-b', 'Project B');
    const now = Date.now();

    // Clean: mara posts to the SAME room it owes -> not a suspect, no line.
    assert.deepEqual(messages.noteMisrouteSuspect('mara', 'proj-b', now), [],
      'posting into the room you owe is not a misroute');
    assert.equal(fs.existsSync(messages.MISROUTE_LOG), false, 'a clean post wrote a misroute line');

    // Suspect: mara posts to proj-a while owing proj-b -> one line.
    const owed = messages.noteMisrouteSuspect('mara', 'proj-a', now);
    assert.deepEqual(owed, [{ project: 'proj-b', posts: [bId] }]);
    const lines = fs.readFileSync(messages.MISROUTE_LOG, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'expected exactly one suspect line');
    const rec = JSON.parse(lines[0]);
    assert.equal(rec.kind, 'misroute-suspect');
    assert.equal(rec.from, 'mara');
    assert.equal(rec.target, 'proj-a');
    assert.deepEqual(rec.owed, [{ project: 'proj-b', posts: [bId] }]);
    assert.ok(typeof rec.at === 'string' && rec.at.length, 'the suspect line carries no timestamp');

    // Detection is observability only: the suspect lives in the misroute log,
    // NOT the append-only message record (where a stray kind could perturb a
    // count or a render). The seeded ask is the only thing in the record.
    assert.equal(messages.record().rows.some((m) => m && m.kind === 'misroute-suspect'), false,
      'the detector leaked a row into the message record');
  });
});

test('an answered ask clears the debt, so a later post elsewhere is NOT a suspect', () => {
  withFleet(room(), (board) => {
    askMaraIn(board, 'proj-b', 'Project B');
    // mara answers in proj-b -> the debt clears from the store alone.
    armSender('mara-discord');
    arm([ok(), ok()]);
    const reply = messages.sendPost({ fromPane: '%7', project: 'proj-b', text: 'in the folder, one pass left' }, board.agents, MEMBERS);
    assert.equal(reply.state, chat.DELIVERY.PLACED, reply.because || '');
    const now = Date.now() + 1;
    assert.deepEqual(messages.misrouteSuspects('mara', 'proj-a', now), [],
      'a cleared debt should not read as a misroute');
    assert.deepEqual(messages.noteMisrouteSuspect('mara', 'proj-a', now), []);
    assert.equal(fs.existsSync(messages.MISROUTE_LOG), false);
  });
});

test('owing nothing, and empty inputs, yield no suspect', () => {
  withFleet(room(), (board) => {
    const now = Date.now();
    assert.deepEqual(messages.misrouteSuspects('mara', 'proj-a', now), [], 'a debt was invented from nothing');
    assert.deepEqual(messages.misrouteSuspects('', 'proj-a', now), []);
    assert.deepEqual(messages.misrouteSuspects('mara', '', now), []);
    // A colleague's mention (not the operator) never owes, so it is never a suspect.
    armSender('leo-discord');
    arm([ok(), ok()]);
    messages.sendPost({ fromPane: '%7', project: 'proj-b', text: '@mara ping' }, board.agents, MEMBERS);
    assert.deepEqual(messages.misrouteSuspects('mara', 'proj-a', Date.now() + 1), [],
      'a colleague mention manufactured an operator-grade debt');
  });
});
