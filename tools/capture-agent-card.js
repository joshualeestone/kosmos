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
 *   - PINS these fields to constants: `hasAvatar`, `model`, `modelName`,
 *     `disruption.startedAt`, and the whole of `context` (`tokens`, `percent`,
 *     `ceiling`, `ceilingAssumed`, `overCeiling`, `notYet`, `confidence`, `because`).
 *     🛑 "SO A RE-RUN IS BYTE-IDENTICAL UNLESS THE SHAPE MOVED" WAS THE CLAIM HERE AND IT
 *     IS FALSE. A re-capture minutes later on the same box differs without any shape
 *     moving: `state`, `stateConfidence` and `runner` are restored from the RAW card
 *     (they are enum-bounded, see below), the structural booleans pass through as
 *     captured, and role/task/stateEvidence/stateProject/stateConflict/disruption each
 *     vary between null and a value. The committed recording holds `state: "working"`
 *     and `stateConfidence: "scraped"`, which are facts about one capture. What the pins
 *     buy is that the VOLATILE MEASUREMENTS do not move; they never bought byte equality.
 *     ⚠️ KEEP THIS LIST IN STEP WITH THE CODE. It has gone stale twice, in four places
 *     at once each time (here, render-talk.js's header, the README, and the plan). It is
 *     no longer only a rule: `render-talk-goldencard-2519.test.js` extracts the pinned
 *     names from the code below and fails if any of the four documents omits one.
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
 * 🛑 SPLIT OUT BECAUSE NOTHING DROVE THIS TOOL. Both refusals (no pane card, key set
 * changed) were guards nothing ran, and mutating the neutralisation redded no arm.
 * ⚠️ AND THE SPLIT ONLY REACHED THE FIRST OF THEM. The paneless refusal became drivable
 * here; the key-set comparison stayed inside the `require.main` block, unreachable from
 * any test, while this sentence read as though both were fixed. `keySet` is exported
 * below for that reason.
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
  return {
    chosen: paneOurs.find((a) => a.stateConfidence && a.stateConfidence !== 'none') || paneOurs[0] || null,
    ours,
    paneOurs,
  };
}

/* Every STRING anywhere under an object is replaced; non-strings keep their type and
   value. No identifying STRING can survive by being unlisted.
   🛑 THE GUARANTEE IS STRING-ONLY, AND SAYING SO IS THE POINT. An earlier version of
   this sentence read "nothing identifying can survive", which is broader than the code:
   numbers and booleans reach the recording verbatim, and an array's LENGTH survives
   even though its elements are scrubbed.
   🛑 AND THE REASSURING VERSION OF THIS SENTENCE WAS ALREADY WRONG WHEN IT WAS WRITTEN.
   It said "nothing identifying is numeric in today's card", and `disruption.startedAt`
   is an epoch-ms MACHINE TIMESTAMP the producer emits (status.js:5431) that no pin
   covered: `cause` scrubbed to `example-cause` while `startedAt` came out verbatim. It
   is reachable, not theoretical -- a restarting card carries CONFIDENCE.STRUCTURED, so
   `chooseCard` will prefer it. It is pinned below now.
   ⇒ THE LESSON IS THE SENTENCE, NOT THE FIELD. A comment that concludes "the non-string
   axis is clear today" is what stops the next person looking, and it was written in the
   same commit that left a timestamp unpinned.
   🛑 AND THE REPLACEMENT SENTENCE WAS WRONG TOO, ONE ITERATION LATER. It said "every
   non-string the producer supplies is either pinned below or is a documented exposure;
   there is no third category", and there WAS a third category: `profile` is FREE-FORM
   (store.readProfile returns whatever JSON is in the file), so the tree writes numbers
   into it that no pin names. `profile.doctrineVersion` is a producer NUMBER, written at
   birth by create.js:3651 from defaults.DOCTRINE_VERSION and again by doctrine.js:209,
   and `doctrineDeclined` beside it. Neither is identity-bearing, but neither was pinned
   nor documented, so a re-capture on almost any real agent was not byte-identical, which
   four places claim it is.
   ⇒ SO THE CATEGORIES ARE THREE, NAMED HONESTLY:
     1. PINNED below to constants (the list in the header).
     1b. RE-PINNED FROM THE RAW CARD because status.js ENUM-BOUNDS them: `state` and
        `stateConfidence` come from the STATE and CONFIDENCE constants, `runner` from a
        ternary that can only yield 'codex' or 'claude'. This is a REAL fourth category
        and calling it a sub-case of (1) is what let three successive versions of this
        paragraph say "exactly one of them" while these three sat outside all of it.
        ⚠️ It is also the shape this file was burned by four times, so the reliance is
        pinned by an arm rather than trusted: poison `state` with a path and it must not
        survive.
     2. STRUCTURAL BOOLEANS passed through by design -- nameDerived, isAgentPane,
        isAgentSession, isFleetSession, isNamedOurs, paneless, stateProjectInferred,
        activeWhileWaiting, stateReported, stateBackgroundWait, neverRecorded. Each has
        two possible values, carries nothing identifying, and MUST survive or the
        recording stops being a real card shape (`paneless: false` is load-bearing).
        ⚠️ TOP-LEVEL ONLY. A boolean nested outside `profile` (a future `context` flag,
        say) is in this category too and is not enumerated, because the enumeration is of
        the ones that exist today.
     3. THE `profile` SUBTREE, which gets the STRICTEST treatment of anything here:
        scrubNonStrings below neutralises every number and boolean under it, at any
        depth. It is free-form, so an allowlist there is a guarantee held by coincidence
        of what the tree happens to write today, which is the failure this whole file
        is a record of.
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

/* Every NON-string under an object becomes a constant of the same type; strings are left
   for scrubStrings, and shape is preserved at any depth.
   🛑 APPLIED TO `profile` ONLY, AND THAT SCOPE IS THE POINT. Everywhere else the card's
   numbers and booleans are meaningful (a pinned token count, `paneless: false`) and
   flattening them would make the recording stop being a real card. `profile` is the one
   free-form subtree: the tree writes whatever it likes into it, so nothing there can be
   allowlisted without the guarantee resting on today's contents. */
function scrubNonStrings(v) {
  if (v === null || typeof v !== 'object') return;
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (typeof val === 'number') v[k] = 0;
    else if (typeof val === 'boolean') v[k] = false;
    else if (val && typeof val === 'object') scrubNonStrings(val);
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
  /* 🛑 THE FREE-FORM SUBTREE GETS BOTH PASSES. scrubStrings took its strings; this takes
     its numbers and booleans, at any depth. `profile.doctrineVersion` (a producer number
     from create.js:3651) reached the committed file before this line existed. */
  if (card.profile && typeof card.profile === 'object') scrubNonStrings(card.profile);
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
  /* ⚠️ THE ONE PIN THAT DELIBERATELY DISAGREES WITH THE CAPTURED CARD. A producer `false`
     becomes `true`, and that is intended rather than an oversight: status.js emits
     `Boolean(safeAvatar(key))`, which depends on whether an avatar file happens to exist
     for that agent on that box, so recording it faithfully would make the fixture differ
     between machines and leave openDetail's avatar path unexercised. `true` is a value
     the producer emits, so the recording stays possible. The guard is a TYPE guard only:
     it stops a non-boolean being invented into one, it does not preserve `false`. */
  if (typeof card.hasAvatar === 'boolean') card.hasAvatar = true;
  /* 🛑 AN EPOCH-MS MACHINE TIMESTAMP, AND THE ONLY REASON IT IS NOT A LIVE LEAK IS THAT
     `disruption` is null in today's recording. status.js:5431 emits
     {cause, startedAt, timedOut}; scrubStrings took `cause` and left `startedAt`. */
  if (card.disruption && typeof card.disruption === 'object'
      && typeof card.disruption.startedAt === 'number') {
    card.disruption.startedAt = 1757000000000;
  }
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
    /* 🛑 THE TWO STRINGS IN context TOO, AND FOR THE SAME REASON THE NUMBERS ARE PINNED.
       scrubStrings left them as `example-confidence` and `example-because`, which are
       values the producer CANNOT EMIT: status.js bounds confidence to
       structured|scraped|none (CONFIDENCE, status.js:239-243) and draws because from a
       fixed set of sentences. So the recording carried an impossible card in exactly the
       subtree whose numbers we had just made coherent.
       ⇒ Pinned to the pair status.js produces FOR THESE PINNED NUMBERS.
       `measuredResult(tokens, ceiling, assumed)` (status.js:4299) returns
       confidence STRUCTURED and, when `assumed` is true, "measured, against a limit we
       have assumed rather than watched". 82646 of an assumed 1000000 is exactly that
       call, so the whole context block is now one coherent producer output rather than
       six pinned numbers beside two invented strings.
       ⚠️ CONSTANTS, NOT A RE-PIN FROM `live`. `because` interpolates nothing today but
       is not enum-bounded, and this file has been burned four times by re-pinning a
       field the producer does not bound. */
    if (typeof card.context.confidence === 'string') card.context.confidence = 'structured';
    if (typeof card.context.because === 'string') {
      card.context.because = 'measured, against a limit we have assumed rather than watched';
    }
  }
  return card;
}

/**
 * The key set the neutralisation must not change, as a comparable string.
 *
 * 🛑 EXPORTED BECAUSE THE REFUSAL THAT USES IT WAS A GUARD NOTHING RAN. The comparison
 * lived inside the `require.main` block, so no test could reach it, and it is the tool's
 * only structural check that the recording still matches the producer's shape. It is
 * load-bearing rather than decorative: several pins below ADD a key on a producer that
 * lacks one, which is precisely what it exists to catch.
 */
function keySet(card) { return Object.keys(card).sort().join(','); }

module.exports = { chooseCard, neutralise, scrubStrings, scrubNonStrings, keySet };

/* ⚠️ THE I/O ONLY WHEN RUN DIRECTLY. Without this guard, a test that required this file
   to exercise the functions above would overwrite the committed fixture as a side effect
   of importing it. */
if (require.main === module) {
  const status = require(path.join(__dirname, '..', 'engine', 'status.js'));
  const board = status.snapshot();
  const { chosen, ours, paneOurs } = chooseCard(board.agents);
  if (!chosen) {
    console.error('no PANE-based agent card of ours on this box, so there is nothing to record.');
    console.error('run this where agents are actually running in panes.');
    process.exit(1);
  }
  const card = neutralise(chosen);
  /* 🛑 REFUSE RATHER THAN WRITE A DIFFERENT SHAPE. */
  const before = keySet(chosen);
  const after = keySet(card);
  if (before !== after) {
    console.error('neutralisation changed the key set; refusing to write.');
    console.error('  producer: ' + before);
    console.error('  recorded: ' + after);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(card, null, 2) + '\n');
  console.log('recorded ' + Object.keys(card).length + ' keys from status.snapshot() -> ' + OUT);
  /* ⚠️ THE QUALIFIED SENTENCE, because this is the one surface a human actually reads.
     The unqualified version ("identifying content neutralised") was corrected in the
     header, the README and render-talk's header, and survived here longest. */
  console.log('identifying STRING content neutralised; non-strings are pinned or passed '
    + 'through (see the header); every key and type is the producer\'s.');
  console.log('state=' + card.state + ' stateConfidence=' + card.stateConfidence
    /* ⚠️ paneOurs, NOT ours. The choice is made over the PANE cards; counting `ours`
       described a set the tool did not choose from whenever the board had paneless
       cards, which is most boards. */
    + (paneOurs.length > 1 ? '  (chose 1 of ' + paneOurs.length + ' pane cards, preferring real evidence)' : ''));
}
