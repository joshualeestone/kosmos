'use strict';

/**
 * #1397. A row Kosmos REFUSED was recorded as the agent having spoken.
 *
 * `paintRoom`'s stamping loop took any row carrying a `from` and a parseable
 * `at`, and never read `kind`. `engine/messages.js` emits six kinds and several
 * carry a real `from` - so an agent whose message the product BLOCKED got a
 * speech stamp, and a stamp suppresses that agent's working indicator for a
 * poll. The agent is hidden while it is in fact still working.
 *
 * ⚠️ THE DIRECTION, STATED SO NOBODY OVER-SELLS THIS: it is the UNDER-claim and
 * it is bounded at one poll. #1150 was the over-claim, where a name shows beside
 * a reply already on screen, and that is the one Josh actually complained about.
 * Fixing this does not fix that and does not depend on it.
 *
 * 🔑 THE REAL BLOCK AND THE REAL VOCABULARY, BOTH LIFTED FROM THE SHIPPED PAGE.
 * The sets are sliced out of the page rather than declared here, because a test
 * that supplies its own `ROOM_NOT_SPEECH` would pass with every entry deleted
 * from the real one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const MESSAGES = fs.readFileSync(path.join(__dirname, 'engine', 'messages.js'), 'utf8');

/* Both set literals, taken from the page by name. A literal anchor is a
   position dressed as content, so each one fails CLOSED with a message saying
   the declaration moved, rather than silently testing an empty set. */
function liftSet(name) {
  const m = SCRIPT.match(new RegExp('const ' + name + ' = new Set\\(\\[[^\\]]*\\]\\);'));
  assert.ok(m, `${name} is no longer declared as a Set literal in the page; this test is reading nothing`);
  return m[0];
}

function stamper() {
  const from = SCRIPT.indexOf('const seededRoom =');
  assert.ok(from > -1, 'the seeding block moved; this test is no longer reading the real one');
  const END = 'ROOM_SPOKE_SEEDED.add(PJ_CURRENT);';
  const to = SCRIPT.indexOf(END, from);
  assert.ok(to > from, 'the seeding block no longer ends where this test expects');
  const BLOCK = liftSet('ROOM_NOT_SPEECH') + '\n' + SCRIPT.slice(from, to + END.length);
  assert.ok(BLOCK.includes('ROOM_NOT_SPEECH.has'),
    'the stamping loop no longer consults ROOM_NOT_SPEECH, so #1397 has been reverted');
  // eslint-disable-next-line no-new-func
  return new Function(
    'PJ_CURRENT', 'allRows', 'ROOM_SPOKE_SEEDED', 'ROOM_SPOKE_AT', 'OUT', 'body', 'Date',
    BLOCK + '\nOUT.push(seededRoom);',
  );
}

const row = (kind) => ({ from: 'dana', at: new Date().toISOString(), text: 'hi', ...(kind ? { kind } : {}) });

function stampedBy(kind) {
  const seed = stamper();
  const SPOKE = new Map();
  seed('project-a', [row(kind)], new Set(), SPOKE, [], { ok: true }, Date);
  return SPOKE.has('dana');
}

test('#1397: a refused row is not speech, and a real message still is', () => {
  /* 🔑 THE POSITIVE ARM FIRST. Without it every assertion below is satisfied by
     a loop that stamps NOTHING, which is a different defect wearing this fix's
     clothes: the working line would then show every name forever. */
  assert.equal(stampedBy('message'), true, 'a real message no longer stamps; the loop has stopped working entirely');
  assert.equal(stampedBy('post'), true, 'a post no longer counts as speech');

  /* THE DEFECT. */
  assert.equal(stampedBy('refused'), false,
    'a REFUSED message was recorded as speech, so a blocked agent loses its working indicator for a poll');
  assert.equal(stampedBy('valve'), false, 'a rate-limited row was recorded as speech');
  assert.equal(stampedBy('note'), false, "Kosmos's own note was recorded as an agent speaking");

  /* 🔑 THE DENY-DEFAULT ARM, and it pins the DIRECTION rather than the list.
     An unrecognised kind must still count as speech: that fails toward hiding
     an agent for one poll, where an allow-list default fails toward showing a
     name beside a reply already on screen, which is #1150. Delete this and the
     fix can be flipped to an allow-list with every other assertion green. */
  assert.equal(stampedBy('a-kind-that-does-not-exist-yet'), true,
    'an unrecognised kind was treated as non-speech; the default has been flipped to an allow-list, which fails toward the #1150 direction');
  assert.equal(stampedBy(null), true, 'a row with no kind at all stopped counting as speech');
});

test('#1397: every kind the engine emits is classified by the page', () => {
  const emitted = [...MESSAGES.matchAll(/kind: ?'([a-z]+)'/g)].map((m) => m[1]);
  /* A FLOOR ON THE POPULATION. An extractor that matched nothing would pass the
     coverage assertion below by having nothing to cover. */
  assert.ok(emitted.length >= 5,
    `only ${emitted.length} kinds found in engine/messages.js; the extractor looks broken and the coverage check below would pass for the wrong reason`);

  const declared = new Set(
    [...liftSet('ROOM_SPEECH_KINDS').matchAll(/'([a-z-]+)'/g),
      ...liftSet('ROOM_NOT_SPEECH').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]),
  );
  assert.ok(declared.size >= 5, 'the page declares fewer kinds than it has sets, so the lift is reading nothing');

  const unclassified = [...new Set(emitted)].filter((k) => !declared.has(k));
  assert.deepEqual(unclassified, [],
    'engine/messages.js emits a kind the page does not classify: ' + unclassified.join(', ')
    + '\nAdd it to ROOM_SPEECH_KINDS or ROOM_NOT_SPEECH in web/index.html.'
    + '\nUntil it is classified the deny-default treats it as speech, which hides that agent for a poll.');

  /* 🔑 AND THE COVERAGE CHECK MUST BE ABLE TO FAIL. Two vocabularies that agree
     because neither was read is the same green as two that agree because both
     were. This proves the comparison can say no. */
  assert.ok(!declared.has('zzz-never-emitted'),
    'the declared set contains a name nothing emits, so this comparison is not discriminating');
  assert.deepEqual(['zzz-fake'].filter((k) => !declared.has(k)), ['zzz-fake'],
    'the unclassified filter cannot detect an unknown kind, so its empty result above proves nothing');
});
