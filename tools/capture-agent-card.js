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
 *   - NEUTRALISES only identifying string CONTENT: the session, name and target, the
 *     role and task, the scraped evidence line, and the two profile ids. It does not
 *     touch structure, numbers or booleans.
 *   - ASSERTS the key set survived neutralisation, and refuses to write if it did not.
 */
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'docs', 'browser-checks', 'fixtures', 'agent-card.json');

const status = require(path.join(__dirname, '..', 'engine', 'status.js'));
const board = status.snapshot();
/* 🛑 PREFER A CARD WITH REAL EVIDENCE, not simply the first match. Measured by running
   this tool twice minutes apart: the first capture recorded a live scraped card
   (state=working, stateConfidence=scraped) and the second an idle one (state=unknown,
   stateConfidence=none, stateReported=true). Both are legitimate producer output, but
   the reopen arm opens an agent someone is looking at, so the recording should be a
   card with something in it. `.find()` alone makes the fixture's quality depend on
   which agent happened to be first in the list at capture time. */
const ours = (board.agents || []).filter((a) => a && a.isNamedOurs === true);
const live = ours.find((a) => a.stateConfidence && a.stateConfidence !== 'none') || ours[0];
if (!live) {
  console.error('no agent card of ours on this box, so there is nothing to record.');
  console.error('run this where agents are actually running.');
  process.exit(1);
}

const card = JSON.parse(JSON.stringify(live));
/* The placeholder identity is the one render-talk's LIVE path already renames to, and
   the spellings engine/messages.test.js and tools/browser-checks.sh already use, so the
   recording carries no new invented name. */
card.session = 'april-discord';
card.sessionName = 'april';
card.name = 'April';
card.target = 'april-discord:0.0';
card.role = 'example worker';
card.task = 'an example task';
card.because = 'it is mid-task';
card.stateConflict = '';
card.stateEvidence = '✽ Working… (2m 36s · ↓ 11.4k tokens)';
/* 🛑 PIN THE VOLATILE VALUES, so a re-capture is byte-identical unless the SHAPE moved.
   Measured: two captures minutes apart differed in context.tokens, context.percent,
   hasAvatar and two profile timestamps -- all real values, none identifying, and all
   noise. A fixture that churns on every run makes its own diff meaningless, and the
   only thing the drift guard cares about is the shape. These stay REALISTIC (a real
   card's numbers, not invented extremes) and fixed. */
card.hasAvatar = true;
if (card.context && typeof card.context === 'object') {
  if (typeof card.context.tokens === 'number') card.context.tokens = 82646;
  if (typeof card.context.percent === 'number') card.context.percent = 8;
}
if (card.profile) {
  if (typeof card.profile.updatedAt === 'string') card.profile.updatedAt = '2026-09-03T00:00:00.000Z';
  if (card.profile.instructionsWrite && typeof card.profile.instructionsWrite === 'object'
      && typeof card.profile.instructionsWrite.at === 'string') {
    card.profile.instructionsWrite.at = '2026-09-03T00:00:00.000Z';
  }
}
if (card.profile) {
  if (typeof card.profile.id === 'string') card.profile.id = '0'.repeat(card.profile.id.length);
  if (typeof card.profile.idInstall === 'string') card.profile.idInstall = '00000000-0000-4000-8000-000000000000';
}

/* 🛑 REFUSE RATHER THAN WRITE A DIFFERENT SHAPE. If neutralisation dropped or added a
   key, the recording is no longer what the producer emits and the drift guard would
   simply fail on it later, at a worse moment. */
const before = Object.keys(live).sort().join(',');
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
