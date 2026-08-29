'use strict';

// Sandbox the store BEFORE requiring anything: store.js resolves its root at
// module load, the same rule server.test.js states at its own top.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-selfreport-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const selfreport = require('./selfreport');

test('a report is kept and read back whole: state, sentence, at', () => {
  const got = selfreport.record('leo-discord', { state: 'needs_you', because: 'Which domain should the relay use?' });
  assert.equal(got.recorded, true);
  const back = selfreport.read('leo-discord');
  assert.equal(back.found, true);
  assert.equal(back.state, 'needs_you');
  assert.equal(back.because, 'Which domain should the relay use?');
  assert.ok(back.at, 'a report without a timestamp cannot decay, so it must never be written without one');
});

test('the six words are a closed list and an unknown word is refused with the list in the sentence', () => {
  const got = selfreport.record('leo-discord', { state: 'vibing' });
  assert.equal(got.recorded, false);
  assert.match(got.because, /started, working, idle, needs_you, blocked, stopped/);
});

test('an agent that never reported answers found:false, so callers fall back to today\'s behaviour', () => {
  const got = selfreport.read('never-spoke');
  assert.equal(got.found, false);
  assert.equal(got.because, 'it has never reported');
});

test('the latest report wins, and a new started means yesterday\'s stopped does not shadow today', () => {
  selfreport.record('mara-discord', { state: 'working', because: 'reading the brief' });
  selfreport.record('mara-discord', { state: 'stopped' });
  selfreport.record('mara-discord', { state: 'started' });
  const back = selfreport.read('mara-discord');
  assert.equal(back.state, 'started');
});

test('blocked carries on, owner and until, so the board can say what and who', () => {
  selfreport.record('april-discord', {
    state: 'blocked', because: 'rate limited',
    on: 'provider api', owner: 'provider', until: '2026-08-24T18:00:00Z',
  });
  const back = selfreport.read('april-discord');
  assert.equal(back.state, 'blocked');
  assert.equal(back.on, 'provider api');
  assert.equal(back.owner, 'provider');
  assert.equal(back.until, '2026-08-24T18:00:00Z');
});

test('one corrupt line does not eat the record, and an unknown-state line is skipped, not fatal', () => {
  selfreport.record('donnie-discord', { state: 'working' });
  fs.appendFileSync(selfreport.fileFor('donnie-discord'), 'not json {{{\n' + JSON.stringify({ v: 1, state: 'vibing', at: 'x' }) + '\n');
  selfreport.record('donnie-discord', { state: 'idle', because: 'finished' });
  const back = selfreport.read('donnie-discord');
  assert.equal(back.state, 'idle');
  assert.equal(back.because, 'finished');
});

test('fields are capped and flattened: a report is a sentence, not a transcript dump', () => {
  selfreport.record('krang-discord', { state: 'working', because: 'a\nb\tc\r' + 'x'.repeat(5000) });
  const back = selfreport.read('krang-discord');
  assert.ok(back.because.length <= 1000);
  assert.ok(!/[\n\t\r]/.test(back.because), 'newlines survived into a single-line record');
});

test('a name that cannot key a file refuses in a sentence rather than throwing', () => {
  const got = selfreport.record('///', { state: 'idle' });
  assert.equal(got.recorded, false);
  assert.match(got.because, /agent name/);
});

test('the reader reads the TAIL: a record longer than the window still answers from its end', () => {
  for (let i = 0; i < 2000; i++) selfreport.record('leo-discord', { state: 'working', because: 'heartbeat ' + i });
  selfreport.record('leo-discord', { state: 'idle', because: 'finished, nothing needed' });
  const size = fs.statSync(selfreport.fileFor('leo-discord')).size;
  assert.ok(size > selfreport.TAIL_BYTES, 'the fixture no longer exceeds the window, so this test asserts nothing');
  const back = selfreport.read('leo-discord');
  assert.equal(back.state, 'idle');
  assert.equal(back.because, 'finished, nothing needed');
});

/* #763: the project a report is about rides on the record, and is carried
   forward so the permission hook's project-less needs_you inherits it. */
test('#763: a report names its project; a later report without one inherits it; stopped clears it', () => {
  const who = 'nora-discord';
  assert.equal(selfreport.record(who, { state: 'working', project: 'p-christmas' }).recorded, true);
  assert.equal(selfreport.read(who).project, 'p-christmas');
  assert.equal(selfreport.record(who, { state: 'needs_you', because: 'asking permission to use Bash' }).recorded, true);
  const q = selfreport.read(who);
  assert.equal(q.state, 'needs_you');
  assert.equal(q.project, 'p-christmas', 'a question that names no project is about the project the agent last said it was on');
  assert.equal(q.projectInferred, true, 'and the reading admits the project was carried forward, not stated');
  assert.equal(selfreport.read(who).projectInferred, true);
  assert.equal(selfreport.record(who, { state: 'needs_you', project: 'p-other' }).recorded, true);
  assert.equal(selfreport.read(who).project, 'p-other', 'a report that names a project moves the agent to it');
  assert.equal(selfreport.read(who).projectInferred, false, 'stated by this report');
  assert.equal(selfreport.record(who, { state: 'stopped' }).recorded, true);
  assert.equal(selfreport.read(who).project, null, 'nothing from a previous run may leak into the next');
  assert.equal(selfreport.record(who, { state: 'needs_you' }).recorded, true);
  assert.equal(selfreport.read(who).project, null, 'after a stop, a question with no project is unattributed');
  assert.equal(selfreport.read(who).projectInferred, false, 'nothing to infer from');
});

test('#763: a project id longer than the cap is cut, not refused', () => {
  const who = 'olga-discord';
  assert.equal(selfreport.record(who, { state: 'working', project: 'x'.repeat(500) }).recorded, true);
  assert.equal(selfreport.read(who).project.length <= 120, true);
});

test('#763: a new run (started) does not inherit the old run\'s project; the light is missed, never wrong', () => {
  const who = 'pia-discord';
  assert.equal(selfreport.record(who, { state: 'working', project: 'p-old' }).recorded, true);
  assert.equal(selfreport.record(who, { state: 'started' }).recorded, true);
  assert.equal(selfreport.record(who, { state: 'needs_you', because: 'asking permission' }).recorded, true);
  assert.equal(selfreport.read(who).project, null, 'a crash leaves no stopped row; the next run must not light the old project');
});

test('#763: a naming row that fell off the tail read fails safe: no project, not a wrong one', () => {
  const who = 'quin-discord';
  assert.equal(selfreport.record(who, { state: 'working', project: 'p-far' }).recorded, true);
  const rows = Math.ceil(selfreport.TAIL_BYTES / 60) + 5;
  for (let i = 0; i < rows; i++) selfreport.record(who, { state: 'working' });
  assert.equal(selfreport.record(who, { state: 'needs_you' }).recorded, true);
  const back = selfreport.read(who);
  assert.equal(back.state, 'needs_you');
  assert.equal(back.project, null, 'the naming row is outside the tail; the reading must not guess');
  assert.equal(back.projectInferred, false);
});

test('#763: started --project X begins the run on X (the clear runs first, then the row\'s own project)', () => {
  const who = 'rae-discord';
  assert.equal(selfreport.record(who, { state: 'working', project: 'p-old' }).recorded, true);
  assert.equal(selfreport.record(who, { state: 'started', project: 'p-new' }).recorded, true);
  assert.equal(selfreport.record(who, { state: 'needs_you' }).recorded, true);
  const back = selfreport.read(who);
  assert.equal(back.project, 'p-new', 'a start that names its project is not discarded');
  assert.equal(back.projectInferred, true);
});

/* ---------------------------------------------------------------------------
 * #900: an agent's own Stop hook must not erase its deliberate waiting state.
 * ------------------------------------------------------------------------- */

test('#900: an AUTOMATIC idle does not erase a deliberate blocked', () => {
  selfreport.record('waiter', { state: 'blocked', because: 'needs Josh to sign in', owner: 'Josh' });
  const stop = selfreport.record('waiter', { state: 'idle', because: 'finished responding', auto: true });
  assert.equal(stop.recorded, false, 'the end-of-turn idle overwrote the block');
  assert.equal(stop.skipped, 'waiting');
  assert.match(stop.because, /waiting on a person/);
  const back = selfreport.read('waiter');
  assert.equal(back.state, 'blocked', 'the board would read this agent as at rest');
  assert.equal(back.because, 'needs Josh to sign in');
});

test('#900: an AUTOMATIC idle does not erase a deliberate needs_you either', () => {
  selfreport.record('asker', { state: 'needs_you', because: 'Which venue?' });
  selfreport.record('asker', { state: 'idle', because: 'finished responding', auto: true });
  assert.equal(selfreport.read('asker').state, 'needs_you');
});

test('#900: a DELIBERATE idle still clears a block, or nothing ever could', () => {
  /* The escape hatch, and it is why the discriminator is `auto` rather than
     the word: an agent that is genuinely done must be able to say so. */
  selfreport.record('freed', { state: 'blocked', because: 'waiting on a key' });
  const said = selfreport.record('freed', { state: 'idle', because: 'got the key, nothing to do' });
  assert.equal(said.recorded, true, 'a deliberate idle was refused, so a block can never clear');
  assert.equal(selfreport.read('freed').state, 'idle');
});

test('#900: automatic working, stopped and started all still land over a block', () => {
  /* A rule that refused every automatic write would strand an agent blocked
     forever. Only `idle` is refused, so the next real activity clears it. */
  selfreport.record('moving', { state: 'blocked', because: 'waiting' });
  assert.equal(selfreport.record('moving', { state: 'working', because: 'answering a prompt', auto: true }).recorded, true);
  assert.equal(selfreport.read('moving').state, 'working');

  selfreport.record('ending', { state: 'needs_you', because: 'a question' });
  assert.equal(selfreport.record('ending', { state: 'stopped', auto: true }).recorded, true);
  assert.equal(selfreport.read('ending').state, 'stopped');
});

test('#900: an automatic idle lands normally when nothing is waiting', () => {
  /* The common case must be untouched: this fires at the end of every turn. */
  selfreport.record('ordinary', { state: 'working', because: 'reading the brief' });
  assert.equal(selfreport.record('ordinary', { state: 'idle', because: 'finished responding', auto: true }).recorded, true);
  assert.equal(selfreport.read('ordinary').state, 'idle');
});

test('#900: an agent that never reported is not special-cased into a refusal', () => {
  assert.equal(selfreport.record('fresh-one', { state: 'idle', because: 'finished responding', auto: true }).recorded, true);
  assert.equal(selfreport.read('fresh-one').state, 'idle');
});

/* -------------------------------------------------------------------------
 * #1453: the record says WHO WROTE THE LINE.
 *
 * The write-time discriminator #900 branches on used to be dropped before the
 * write, so afterwards nothing could tell a hook-written state from an
 * agent-typed one -- and the two produce an identical line, which the rule's
 * own comment says is exactly why the mark is necessary.
 * ------------------------------------------------------------------------- */

test('a machine-written report is stored as such, and an agent-typed one is not', () => {
  selfreport.record('bywho', { state: 'working', because: 'running a tool', auto: true });
  assert.equal(selfreport.read('bywho').by, 'auto');

  selfreport.record('bywho', { state: 'working', because: 'reading the brief' });
  assert.equal(selfreport.read('bywho').by, 'agent',
    'a report with no auto flag is the agent choosing to say it');
});

test('the stored mark is the same predicate the #900 rule branched on, not a second copy of it', () => {
  /* Anything other than a strict `true` is not the machine, and the rule
     above reads `entry.auto === true`. If these two ever disagree, the record
     starts claiming a rule ran that did not. */
  for (const notTheMachine of [1, 'true', 'auto', {}, [], 'yes']) {
    selfreport.record('strictly', { state: 'working', auto: notTheMachine });
    assert.equal(selfreport.read('strictly').by, 'agent',
      JSON.stringify(notTheMachine) + ' is not `true`, so #900 would not have '
      + 'refused it and the record must not say the machine wrote it');
  }
  selfreport.record('strictly', { state: 'working', auto: true });
  assert.equal(selfreport.read('strictly').by, 'auto', 'the control: a real true still reads auto');
});

test('a line written before the field existed reads as unknown, never as agent-typed', () => {
  /* A v1 line exactly as one written before #1453: every field the writer
     emitted then, and no `by`. Treating its absence as "an agent typed it"
     would manufacture the very count this field removes.

     ⚠️ The module writes the line and we then STRIP the field, rather than
     hand-rolling a path and a shape. A fixture I compose myself encodes my
     belief about where the record lives; the first attempt at this test put
     it in the wrong directory and read found:false, which is indistinguishable
     from the legacy line being rejected. */
  const fs2 = require('node:fs');
  selfreport.record('oldline', { state: 'needs_you', because: 'asking permission to use Bash' });

  const file = selfreport.fileFor('oldline');
  const written = JSON.parse(fs2.readFileSync(file, 'utf8').trim());
  assert.ok('by' in written, 'the control: today\'s writer DOES emit the field, so removing it means something');
  delete written.by;
  fs2.writeFileSync(file, JSON.stringify(written) + '\n');

  const back = selfreport.read('oldline');
  assert.equal(back.found, true, 'the legacy line must still read');
  assert.equal(back.state, 'needs_you', 'and read the same as it always did');
  assert.equal(back.because, 'asking permission to use Bash');
  assert.equal(back.by, null,
    'no by field means we do not know who wrote it, which is the honest '
    + 'answer. Defaulting it to agent would be a manufactured one.');
});

test('an agent that never reported has no writer either', () => {
  assert.equal(selfreport.read('nobody-at-all').by, undefined,
    'found:false carries no reading at all, so a caller cannot read a writer off it');
});

test('#900 refuses ONLY an automatic idle, so marking the hook\'s other reports auto is inert', () => {
  /* 🛑 THIS GUARDS THE RISK #1453 CREATED, NOT THE FIX.
     install/kosmos-report-hook.sh now passes --auto on all SEVEN of its report
     calls, so the record can say who wrote a line.

     ⚠️ It said SIX until #1466, and the missing one was `started` -- the
     synchronous delivery check, written as a command substitution, which the
     #1453 sweep did not reach. So this loop was exercising `started` with
     `auto: true` while the hook was actually producing it WITHOUT the flag:
     a test asserting a shape the code did not emit. The loop was right about
     what SHOULD happen and wrong about what did, which is the quietest way for
     a test to be green and uninformative. That is safe only while
     #900's rule stays scoped to `idle`. If anyone ever widens it to refuse
     other automatic writes, the hook's `blocked`, `needs_you`, `working`,
     `started` and `stopped` become refusable -- and a rule that refused every
     automatic write would strand the agent blocked forever, which is the
     failure #900 exists to prevent, arriving from the other direction.

     The control below is what makes the five passes mean anything: without it,
     five recorded:true is equally consistent with the guard being dead. */
  for (const state of ['started', 'working', 'needs_you', 'blocked', 'stopped']) {
    selfreport.record('inert', { state: 'needs_you', because: 'standing waiting state' });
    const got = selfreport.record('inert', { state, because: 'the machine wrote this', auto: true });
    assert.equal(got.recorded, true,
      'an automatic `' + state + '` was refused over a standing needs_you. #900\'s '
      + 'rule has been widened beyond idle, and the report hook marks all seven of '
      + 'its calls --auto, so it can no longer report ' + state + '.');
    assert.equal(selfreport.read('inert').by, 'auto');
  }

  selfreport.record('inert-control', { state: 'needs_you', because: 'standing waiting state' });
  const refused = selfreport.record('inert-control', { state: 'idle', because: 'finished responding', auto: true });
  assert.equal(refused.recorded, false, 'THE CONTROL: the guard must still refuse an automatic idle');
  assert.equal(refused.skipped, 'waiting');
  assert.equal(selfreport.read('inert-control').state, 'needs_you');
});
