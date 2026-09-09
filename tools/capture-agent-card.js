'use strict';
/**
 * Re-capture docs/browser-checks/fixtures/agent-card.json from the real producer.
 *
 *   node tools/capture-agent-card.js
 *
 * #2519: render-talk's reopen arm needs a REAL agent card. On a box with no agents it
 * falls back to a RECORDING, so the arm keeps its coverage instead of failing the cut.
 *
 * 🛑 THIS TOOL EXISTS BECAUSE THE ALTERNATIVE IS HAND-EDITING THE JSON, and that is the
 * exact defect render-talk.js's header describes: "a literal invented here is exactly
 * the fixture that made six rounds of review pass against a world that does not exist".
 * The drift guard tells an operator to re-capture; without a tool, the natural recovery
 * from a blocked cut is to edit the file until the guard goes quiet, which reintroduces
 * the class the whole design avoids.
 *
 * ⚠️ RUN IT ON A BOX WITH LIVE AGENTS. With no card of ours it refuses rather than
 * writing something empty.
 *
 * What it does, and what it deliberately does not:
 *   - RECORDS every key and type `status.snapshot()` emits. Nothing is invented.
 *   - NEUTRALISES identifying string CONTENT: session, name, target, role, task, the
 *     `because` line, any `stateConflict` sentence, the scraped evidence line, every
 *     string under `profile`, and every string anywhere else that is not re-pinned to a
 *     known-safe producer value below. "Known-safe" means ENUM-BOUNDED by status.js
 *     (state, stateConfidence, runner), not merely "a field I recognise": model and
 *     modelName are regex-extracted from a transcript and are pinned to constants.
 *   - PRESERVES each field's TYPE: where the producer emits null, the recording carries
 *     null. ⚠️ EVERY re-pin below is therefore conditional on the field already being a
 *     string. An unconditional pin was the defect here: `model` was assigned a string
 *     unconditionally while `readModel()` returns `{model: null}` on three paths
 *     (status.js:4628, 4630, 4658 -- no transcript, empty tail, no non-synthetic match),
 *     so a tied agent with an unreadable transcript produced a card this recording could
 *     not represent, while four separate copies of this sentence claimed otherwise.
 *   - PINS the volatile values so a re-run is byte-identical unless the shape moved:
 *     `hasAvatar`, `context.tokens`, `context.percent` and two profile timestamps.
 *     ⚠️ An earlier version of this paragraph said the tool "does not touch structure,
 *     numbers or booleans" while the code below set a boolean and two numbers. A false
 *     claim inside the tool built to prevent fixture drift is worth naming rather than
 *     quietly correcting.
 *   - ASSERTS the key set survived neutralisation, and refuses to write if it did not.
 */
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'docs', 'browser-checks', 'fixtures', 'agent-card.json');

/**
 * The pure half: choose a card and neutralise it. Exported so a test can DRIVE it.
 *
 * 🛑 SPLIT OUT BECAUSE NOTHING DROVE THIS TOOL. Both refusals below (no pane card, key
 * set changed) were guards nothing ran, and mutating the neutralisation redded no arm.
 * A capture tool whose own correctness is unchecked is a poor guardian of a fixture.
 */
function chooseCard(agents) {
  const ours = (agents || []).filter((a) => a && a.isNamedOurs === true);
  /* 🛑 A PANE CARD, NOT A PANELESS ONE. status.js emits both and both carry
     `isNamedOurs: true`, but their shapes differ: a paneless card's `context` has fewer
     keys and its session/target/runner/model are null. */
  const paneOurs = ours.filter((a) => a.paneless !== true);
  /* 🛑 PREFER A CARD WITH REAL EVIDENCE, not simply the first match. Measured by running
     this tool twice minutes apart: the first capture recorded a live scraped card and the
     second an idle one (state=unknown, stateConfidence=none). */
  return { chosen: paneOurs.find((a) => a.stateConfidence && a.stateConfidence !== 'none') || paneOurs[0] || null, ours };
}

/* Every STRING anywhere under an object is replaced; non-strings keep their type and
   value. No identifying STRING can survive by being unlisted.
   🛑 THE GUARANTEE IS STRING-ONLY, AND SAYING SO IS THE POINT. An earlier version of
   this sentence read "nothing identifying can survive", which is broader than the code:
   numbers and booleans reach the recording verbatim, and an array's LENGTH survives
   even though its elements are scrubbed. Nothing identifying is numeric in today's card
   (`context.ceiling` is the only unpinned producer number in the committed fixture), so
   this is the next field's exposure rather than a live leak -- but it is the same shape
   this file has corrected four times, sitting on the non-string axis, and a sentence
   that overstates the guarantee is how it stays unexamined.
   🛑 AND NO PROPERTY OF THE RAW VALUE MAY SURVIVE EITHER, LENGTH INCLUDED. `id` was
   scrubbed as `'0'.repeat(val.length)`, which re-emits the producer's value length.
   Today's profile ids are twelve characters, so the output looked like a constant and
   the guarantee held by coincidence of format rather than by construction: the day an
   `id` key carries something variable-length, the recording states how long the real
   one was. That is the same shape as the model re-pin -- a scrub whose output depends
   on what the producer supplied -- which is the defect this file has now corrected
   four times.
   ⇒ A CONSTANT. For the twelve-character ids the producer emits today it is the same
   twelve zeros already in the committed fixture, so the recording does not change. */
function scrubStrings(v) {
  if (v === null || typeof v !== 'object') return;
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (typeof val === 'string') {
      v[k] = k === 'idInstall' ? '00000000-0000-4000-8000-000000000000'
        : /^\d{4}-\d{2}-\d{2}T/.test(val) ? '2026-09-03T00:00:00.000Z'
        : k === 'id' ? '000000000000'
        : 'example-' + k.toLowerCase();
    } else if (val && typeof val === 'object') {
      scrubStrings(val);
    }
  }
}

function neutralise(live) {
  const card = JSON.parse(JSON.stringify(live));
  /* 🛑 SCRUB THE WHOLE CARD, THEN RE-PIN. The top level used to be an ALLOWLIST, so
     `runner`, `model`, `modelName`, a non-null `disruption` and ANY FIELD status.js ADDS
     LATER passed through verbatim into a committed file. The key-set refusal below cannot
     see that: a new identifying producer field changes no key count. Scrubbing everything
     first makes the guarantee structural rather than a list somebody has to remember to
     extend, and the known-safe values are put back immediately after. */
  scrubStrings(card);
  /* ⚠️ CONDITIONAL, LIKE EVERY OTHER RE-PIN. An unconditional assignment writes a string
     where the producer emitted null, which breaks the type guarantee stated above. */
  if (typeof card.session === 'string') card.session = 'april-discord';
  if (typeof card.sessionName === 'string') card.sessionName = 'april';
  if (typeof card.name === 'string') card.name = 'April';
  if (typeof card.target === 'string') card.target = 'april-discord:0.0';
  card.state = live.state;
  card.stateConfidence = live.stateConfidence;
  card.runner = live.runner;   // normalised to 'codex'|'claude' by status.js, enum-bounded
  /* 🛑 model AND modelName ARE **NOT** ENUM-BOUNDED, and re-pinning them from the raw
     producer was the third instance of this same hole (context was the second).
     status.js's readModel() extracts by REGEX over the last 64KB of the agent's
     TRANSCRIPT (`/"model":"([^"]+)"/g`) and falls back to the last match, and
     modelDisplayName() returns an unrecognised id RAW. So any `"model":"..."` occurrence
     in transcript text -- a quoted JSON blob inside a tool result, for instance -- becomes
     this value. MEASURED: a card carrying model '/Users/realoperator/secret' came out of
     neutralise() with that string verbatim, into a COMMITTED file.
     ⇒ Pinned to constants. The fixture does not need this box's real model, and no
     re-pin may take a field the producer does not bound. */
  card.model = typeof card.model === 'string' ? 'claude-opus-5' : card.model;
  card.modelName = typeof card.modelName === 'string' ? 'Claude Opus 5' : card.modelName;
  /* 🛑 DO NOT CLONE THE RAW context BACK IN. An earlier version did exactly that, one
     line after scrubbing the whole card, which restored every unscrubbed string in it.
     MEASURED: a card whose `context.because` read
     "SECRET:/Users/realoperator/private.txt" came out of neutralise() carrying that
     string verbatim, into a COMMITTED file. status.js draws context.because from a small
     set of templates today, but one of them interpolates a live model name, so the field
     is not guaranteed static and the guarantee must not depend on that.
     ⇒ Keep the SCRUBBED context and re-pin only the two numbers below. */
  if (typeof card.role === 'string') card.role = 'example worker';
  if (typeof card.task === 'string') card.task = 'an example task';
  if (typeof card.stateEvidence === 'string') card.stateEvidence = '✽ Working… (2m 36s · ↓ 11.4k tokens)';
  if (typeof card.stateProject === 'string') card.stateProject = 'example-project';
  if (typeof card.because === 'string') card.because = 'it is mid-task';
  if (typeof card.stateConflict === 'string') card.stateConflict = 'an example conflict';
  /* PIN the volatile values so a re-run is byte-identical unless the SHAPE moved. */
  card.hasAvatar = true;
  if (card.context && typeof card.context === 'object') {
    if (typeof card.context.tokens === 'number') card.context.tokens = 82646;
    if (typeof card.context.percent === 'number') card.context.percent = 8;
    /* 🛑 THE CEILING TOO, AND THE THREE BOOLEANS DERIVED FROM IT. Leaving `ceiling` as
       the captured value made the recording INTERNALLY INCONSISTENT: `model` is pinned
       to a constant, so a re-capture on a box running a different model would commit a
       card whose model says one thing and whose ceiling was computed for another. A
       fixture that contradicts itself is worse than a stale one, because nothing reading
       it can tell which half is the recording.
       ⚠️ `ceilingAssumed` stays TRUE and is now true by construction: the ceiling here
       is asserted by this tool, not read from the model. `overCeiling` and `notYet` are
       pinned to the values the pinned tokens/percent imply (82646 of 1000000 is neither
       over the ceiling nor unread), so the whole block agrees with itself.
       Conditional, like every other pin, so a producer null stays null. */
    if (typeof card.context.ceiling === 'number') card.context.ceiling = 1000000;
    if (typeof card.context.ceilingAssumed === 'boolean') card.context.ceilingAssumed = true;
    if (typeof card.context.overCeiling === 'boolean') card.context.overCeiling = false;
    if (typeof card.context.notYet === 'boolean') card.context.notYet = false;
  }
  return card;
}

module.exports = { chooseCard, neutralise, scrubStrings };

/* ⚠️ THE I/O ONLY WHEN RUN DIRECTLY. Without this guard, a test that required this file
   to exercise the functions above would overwrite the committed fixture as a side effect
   of importing it. */
if (require.main === module) {
  const status = require(path.join(__dirname, '..', 'engine', 'status.js'));
  const board = status.snapshot();
  const { chosen, ours } = chooseCard(board.agents);
  if (!chosen) {
    console.error('no PANE-based agent card of ours on this box, so there is nothing to record.');
    console.error('run this where agents are actually running in panes.');
    process.exit(1);
  }
  const card = neutralise(chosen);
  /* 🛑 REFUSE RATHER THAN WRITE A DIFFERENT SHAPE. */
  const before = Object.keys(chosen).sort().join(',');
  const after = Object.keys(card).sort().join(',');
  if (before !== after) {
    console.error('neutralisation changed the key set; refusing to write.');
    console.error('  producer: ' + before);
    console.error('  recorded: ' + after);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(card, null, 2) + '\n');
  console.log('recorded ' + Object.keys(card).length + ' keys from status.snapshot() -> ' + OUT);
  console.log('identifying content neutralised; every key and type is the producer\'s.');
  console.log('state=' + card.state + ' stateConfidence=' + card.stateConfidence
    + (ours.length > 1 ? '  (chose 1 of ' + ours.length + ' cards, preferring real evidence)' : ''));
}
