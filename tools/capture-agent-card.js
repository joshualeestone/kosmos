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
 *     `because` line, any `stateConflict` sentence, the scraped evidence line, and the
 *     two profile ids. It preserves each field's TYPE: a null stays null.
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
 * set changed) were guards nothing ran, and mutating the neutralisation reded no arm.
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
   value. Nothing identifying can survive by being unlisted. */
function scrubStrings(v) {
  if (v === null || typeof v !== 'object') return;
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (typeof val === 'string') {
      v[k] = k === 'idInstall' ? '00000000-0000-4000-8000-000000000000'
        : /^\d{4}-\d{2}-\d{2}T/.test(val) ? '2026-09-03T00:00:00.000Z'
        : k === 'id' ? '0'.repeat(val.length)
        : 'example-' + k.toLowerCase();
    } else if (val && typeof val === 'object') {
      scrubStrings(val);
    }
  }
}

function neutralise(live) {
  const card = JSON.parse(JSON.stringify(live));
  card.session = 'april-discord';
  card.sessionName = 'april';
  card.name = 'April';
  card.target = 'april-discord:0.0';
  /* 🛑 PRESERVE EVERY TYPE. The producer emits null for several of these, and an
     unconditional string invents a value it cannot produce. MEASURED on an 18-agent
     board: role string x14 / null x4, stateEvidence null x13 / string x5, stateProject
     null x18. An earlier version assigned all three unconditionally. */
  if (typeof card.role === 'string') card.role = 'example worker';
  if (typeof card.task === 'string') card.task = 'an example task';
  if (typeof card.stateEvidence === 'string') card.stateEvidence = '✽ Working… (2m 36s · ↓ 11.4k tokens)';
  if (typeof card.stateProject === 'string') card.stateProject = 'example-project';
  if (typeof card.because === 'string') card.because = 'it is mid-task';
  /* status.js emits `status.conflict || null`: a sentence or null, NEVER an empty string.
     An earlier version forced '', a value the producer cannot emit. */
  if (typeof card.stateConflict === 'string') card.stateConflict = 'an example conflict';
  /* 🛑 NEUTRALISE THE PROFILE BY DEFAULT, NOT BY LIST. It is a free-form operator record;
     the tree also writes `dir` (an ABSOLUTE PATH), `displayName`, `role` and `reportsTo`.
     A list-based scrub is clean only for the agent that happened to be captured. */
  scrubStrings(card.profile);
  /* PIN the volatile values so a re-run is byte-identical unless the SHAPE moved. */
  card.hasAvatar = true;
  if (card.context && typeof card.context === 'object') {
    if (typeof card.context.tokens === 'number') card.context.tokens = 82646;
    if (typeof card.context.percent === 'number') card.context.percent = 8;
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
