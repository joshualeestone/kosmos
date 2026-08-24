'use strict';

/**
 * #149/#150: an agent with no launch file says "Made before Kosmos recorded
 * this" instead of "Unknown Model", and the model picker refuses in the
 * state's own words with the way in.
 *
 * The server decides `neverRecorded` (tied pane, no plist: engine/status.js);
 * these pins hold the SCREEN's half: every surface splits on the flag rather
 * than re-deriving it, and the fault wording survives for the state that IS
 * a fault. Delete the flag from modelLine and the first pair goes red.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOf, liftAll } = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);

/* modelLine reads cardStOf(a).pres only to pick WHICH name wins; both states
   under test carry no name at all, so a stub answering 'off' for everything
   cannot decide the assertion. Stubbed rather than lifted because cardStOf
   drags the CARD_ST table with it, and the table is not what this test pins. */
function runModelLine(agent) {
  const src = liftAll(SCRIPT, ['modelLine']);
  const run = new Function('a', `
    const cardStOf = () => ({ pres: 'off' });
    ${src}
    return modelLine(a);
  `);
  return run(agent);
}

test('no model and no launch file reads as history; no model WITH one stays the admission', () => {
  assert.equal(runModelLine({ neverRecorded: true }), 'Made before Kosmos recorded this',
    'the never-recorded state still reads as a lookup fault');
  assert.equal(runModelLine({ neverRecorded: false }), 'Unknown Model',
    'the fault state was relabelled as history, which hides a breakage');
  /* An absent flag (an old server, a stranger row) must fail toward the
     admission: claiming history needs the server to have said so. */
  assert.equal(runModelLine({}), 'Unknown Model',
    'a row that never carried the flag was given the history sentence');
  /* And a model name beats the flag: the sentence is only for the state with
     nothing to show. */
  assert.equal(runModelLine({ neverRecorded: true, plannedModelName: 'Claude Sonnet 5' }), 'Claude Sonnet 5',
    'a readable model was displaced by the history sentence');
});

test('the memory panel says never recorded, for a running context and for a stopped row alike', () => {
  /* The engine flag rides context for a running agent; a stopped row carries
     NO context, so memoryBox synthesizes one from the row flag. Two pins:
     the wording branch itself (lifted and run), and the synthesis (checked
     structurally, because lifting memoryBox drags six dependencies whose
     table values are not what this test is about). */
  const src = liftAll(SCRIPT, ['memUnknown', 'memWhy']);
  const run = new Function('ctx', src + '\nreturn memUnknown(ctx);');
  assert.equal(run({ neverRecorded: true }).lead, 'session was never recorded.',
    'the never-recorded memory state still greets the person with a fault sentence');
  assert.match(run({ neverRecorded: true }).aria, /The session was never recorded/,
    'the screen-reader sentence keeps the fault framing');
  assert.equal(run({}).lead, 'session could not be read.',
    'the fault state lost its own sentence, which hides a breakage');
  const mbAt = SCRIPT.indexOf('function memoryBox(');
  const mbEnd = SCRIPT.indexOf('const band = memBand(', mbAt);
  assert.ok(mbAt > 0 && mbEnd > mbAt, 'memoryBox or its band successor moved; re-anchor this pin');
  const mb = SCRIPT.slice(mbAt, mbEnd);
  assert.ok(/a\.context \|\| \(a\.neverRecorded/.test(mb),
    'memoryBox no longer reaches the treatment for a stopped row, whose context is absent');
  /* The stopped row's synthesized because is a PAGE-OWNED copy of the
     engine's running-row sentence, and one-sided pins let the two drift:
     changing the engine fails only the engine test. Compare the strings to
     each other, both read from source, so either side moving alone is loud. */
  const engineSrc = fs.readFileSync(path.join(__dirname, 'engine', 'status.js'), 'utf8');
  /* File-wide count-of-one, NOT a scope: a left-bounded slice would
     silently re-aim to a later occurrence; refusing on any count but one
     forces the re-anchor to be deliberate. Zero and many get their own
     messages, because they mean opposite repairs. */
  const engineHits = engineSrc.match(/because: 'made before Kosmos recorded this[^']*'/g) || [];
  assert.ok(engineHits.length > 0,
    'status.js lost the sentence entirely; the engine half of this drift pin has nothing to compare');
  assert.equal(engineHits.length, 1,
    'status.js now carries the sentence more than once; re-anchor this pin deliberately');
  const engineSentence = engineHits[0].match(/because: '(made before Kosmos recorded this[^']*)'/);
  const pageSentence = mb.match(/because: '(made before Kosmos recorded this[^']*)'/);
  assert.ok(engineSentence && pageSentence, 'one side lost the sentence entirely; re-anchor this pin');
  assert.equal(pageSentence[1], engineSentence[1],
    'the stopped note (page words) and the running note (engine words) have drifted apart');
});

test('the picker and the explainer both name the way in, and only for the never-recorded state', () => {
  /* Text-level pins on the page: the wording ruled on card #150, the
     migration path, and the #362 reason the path is gated. Each pin anchors
     on text UNIQUE to its surface: the first version of the explainer pin
     matched the picker's sentence too, so deleting the explainer's path
     left it green while its failure message named the wrong survivor. */
  assert.match(PAGE, /Made before Kosmos recorded how it starts, so there is no launch file to change\. /,
    'the picker refusal no longer names the state');
  assert.match(PAGE, /add it from Found agents in Settings to bring it in/,
    'the picker refusal no longer names the way in');
  assert.match(PAGE, /waiting will not add one\. /,
    'the runs-on explainer no longer says the state is permanent');
  assert.match(PAGE, /To bring it in: stop it, then add it from Found agents in Settings/,
    'the runs-on explainer no longer names the migration path for a running agent');
  assert.match(PAGE, /To bring it in: add it from Found agents in Settings/,
    'the runs-on explainer no longer has the stopped wording, so a stopped agent is told to stop');
  assert.match(PAGE, /will not write a launch file while it runs some other way/,
    'the running-state reason (the #362 gate) is gone');
  /* The explainer element exists and starts hidden, so every OTHER agent
     shows nothing rather than a stale sentence. */
  assert.match(PAGE, /id="d-runson-why" hidden/,
    'the explainer does not start hidden, so it can linger across an agent switch');
  /* The recorded-folder sub-state: the newest wording on the branch, and
     the only branch that had zero pins until this block. The Found path is
     not claimed (that list excludes a recorded folder), the reason no path
     is offered is stated, and no tracker number leaks into user copy. */
  assert.match(PAGE, /Kosmos records where this agent lives but has no launch file for it/,
    'the recorded-folder state lost its sentence');
  assert.match(PAGE, /, so it will not start on its own\./,
    'the stopped recorded-folder arm lost its consequence clause');
  /* BOTH surfaces carry this sentence, so the count is pinned at two:
     deleting it from either one alone must fail, not hide behind the
     other (the same both-surfaces trap the preamble above records). */
  assert.equal((PAGE.match(/There is no control here that re-records one yet\./g) || []).length, 2,
    'a surface lost the stated reason no path is offered, which reopens the 149 done-when');
  /* Scoped to the two assignment regions: a page-wide quoted-string sweep
     cannot tell copy from comments (apostrophes in prose make the quotes
     span arbitrary code, measured: 168 false spans). The region END is a
     structural successor, never the first semicolon: the exact wording
     this pin exists to keep out CARRIED a semicolon inside its string, so
     a first-; cut would truncate before the leak and fail open on the
     canonical regression (proven by mutation before this anchor change). */
  for (const [label, anchor, until, inclusive] of [
    ['explainer', 'drunWhy.textContent = a.neverRecorded', 'drunWhy.hidden', false],
    /* Inclusive end ON the statement's own terminator: an exclusive anchor
       chosen from inside the stranger string cut the region mid-sentence,
       and a tracker number appended to that string's tail escaped the
       sweep (proven by mutation). */
    ['picker refusal', 'msg.textContent = ours', "cannot change what it runs on.';", true],
  ]) {
    const at = PAGE.indexOf(anchor);
    assert.ok(at > 0, 'the ' + label + ' assignment moved; re-anchor this pin');
    const stop = PAGE.indexOf(until, at);
    assert.ok(stop > at, 'the ' + label + ' successor anchor moved; re-anchor this pin');
    const region = PAGE.slice(at, stop + (inclusive ? until.length : 0));
    assert.ok(region.length > 200, 'the ' + label + ' region collapsed; the sweep below checks almost nothing');
    assert.doesNotMatch(region, /#\d{2,}/,
      'a tracker number leaked into the ' + label + ' user copy');
    /* Surface-aware: the count-of-two above cannot tell WHICH surfaces
       hold the copies; each region must hold its own. */
    assert.match(region, /There is no control here that re-records one yet\./,
      'the ' + label + ' lost its stated reason while the global count stayed at two');
  }

  /* And the model-message slot is cleared at the switch moment, so one
     agent's refusal cannot stand on another's panel. Structural pin on the
     clear living in openDetail, before the paints. */
  const od = PAGE.slice(PAGE.indexOf('function openDetail('), PAGE.indexOf('function openDetail(') + 4000);
  assert.ok(/getElementById\('d-model-msg'\)[\s\S]{0,120}?\.textContent = ''/.test(od),
    'openDetail no longer clears the model message, so a refusal lingers across an agent switch');
});
