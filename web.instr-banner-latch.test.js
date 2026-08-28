'use strict';
/**
 * 🛑 THE POLL MUST NOT BE ABLE TO SWITCH OFF ITS OWN RENDERER (#1237).
 *
 * Josh, on #1213: *"just the page refreshing made the error go away."* #1222 fixed
 * why the banner was WRONG. This is why it STAYED.
 *
 * The poll gated `renderStale` on `INSTR_READY`, and the poll also CLEARS
 * `INSTR_READY` whenever a tick answers `editable: false`. `INSTR_READY = true`
 * exists at exactly one place, inside `loadInstructions`, which the poll never
 * calls. So one transient answer latched the poll's renderer off for the life of
 * the open panel, and only reopening the panel could clear a banner that was no
 * longer true.
 *
 * ⚠️ `editable: false` IS ORDINARY. A pane that cannot be tied to an agent by
 * name answers it, and so does a momentarily unreadable file.
 *
 * 🔑 A LATCH CANNOT BE SEEN IN TWO STATES. Good-then-bad and bad-then-good both
 * look right; it takes good, transient bad, then good again, and the question is
 * whether the third one paints. `web.stale-banner.test.js` needed three states
 * over this same function for the same reason.
 *
 * 📌 THESE ARE SOURCE ASSERTIONS AND THAT IS DELIBERATE. The flag is module
 * scope, written in five places across two code paths hundreds of lines apart;
 * lifting one function cannot see the relationship between them. What has to
 * hold is a property of the WIRING: the poll reads a flag it cannot write.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/** The poll body: from `function tick` to the next top-level function after it. */
function pollBody() {
  const start = PAGE.indexOf('async function tick(');
  assert.ok(start > 0, 'could not find the poll to check it');
  const after = PAGE.indexOf('\n  function ', start + 10);
  const end = after > start ? after : start + 40000;
  return PAGE.slice(start, end);
}

test('#1237: the poll paints the banner on a flag it cannot switch off', () => {
  const body = pollBody();
  assert.ok(body.length > 2000, `the poll slice is ${body.length} chars, so this is looking in the wrong place`);

  // It renders behind the banner flag, not behind save-safety.
  assert.match(body, /renderStale\(fresh\.instructions\)/, 'the poll no longer paints the banner at all');
  const guard = body.slice(body.lastIndexOf('if (', body.indexOf('renderStale(fresh.instructions)')),
    body.indexOf('renderStale(fresh.instructions)'));
  assert.match(guard, /INSTR_BANNER/, 'the poll gates the banner on something other than INSTR_BANNER');
  assert.doesNotMatch(guard, /INSTR_READY/,
    'the poll gates the banner on INSTR_READY again, which it clears itself: one transient '
    + 'editable:false freezes the banner until the panel is reopened');

  // And it cannot clear that flag anywhere in its own body.
  assert.doesNotMatch(body, /INSTR_BANNER\s*=\s*false/,
    'the poll clears the flag its own renderer is gated on, which is the #1237 latch');
});

test('#1237: the banner flag is cleared only where the panel stops showing this agent', () => {
  const clears = PAGE.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /INSTR_BANNER\s*=\s*false/.test(line) && !/^\s*(\*|\/\/)/.test(line));
  assert.ok(clears.length >= 2, `found ${clears.length} clear sites, so this test is looking in the wrong place`);
  for (const [lineNo] of clears) {
    /* Each clear must sit within a few lines of an INSTR_READY clear, which is
       how the two panel-switch paths are written. A clear that drifts away from
       one is a clear on some OTHER condition, which is how the latch appeared. */
    const near = PAGE.split('\n').slice(lineNo - 6, lineNo + 5).join('\n');
    assert.match(near, /INSTR_READY\s*=\s*false|let INSTR_BANNER/,
      `INSTR_BANNER is cleared at line ${lineNo} away from a panel switch, which is how #1237 happened`);
  }
});

test('#1237: exactly one place arms save-safety, and the banner is armed on the not-editable path too', () => {
  /* ⭐ COMMENT LINES ARE EXCLUDED, AND THE FIRST DRAFT OF THIS TEST DID NOT DO
     THAT AND FAILED. The comment beside the flag says "`INSTR_READY = true`
     exists at exactly one place" -- and saying so made it exist at two. A
     detector keyed on a literal matches the prose that describes it, and here the
     prose was the explanation of this very defect. Third instance of that class
     on this codebase tonight (#1155's test comments, #1233's card comments, this).
     ⚠️ So: count the CODE. Anything that reads source has to say which half. */
  const armed = PAGE.split('\n')
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .filter((line) => /INSTR_READY\s*=\s*true/.test(line));
  assert.equal(armed.length, 1,
    'INSTR_READY is armed in more than one place; save-safety is a single-writer property');
  /* The banner must arm on BOTH load outcomes. A file we cannot edit still has a
     staleness note worth reporting, and arming there is what lets the poll keep
     it current instead of leaving it frozen at whatever the load drew. */
  const notEditable = PAGE.slice(PAGE.indexOf('This cannot be edited from this screen'));
  assert.match(notEditable.slice(0, 600), /INSTR_BANNER\s*=\s*true/,
    'the not-editable load path leaves the banner unarmed, so the poll cannot keep it current');

  /* ⚠️ AND THE ORDINARY LOAD PATH, which the first draft did not assert. Perturbing
     found it: deleting the arm beside `INSTR_READY = true` left every test green,
     so the banner would never arm at all on the common path and the poll would
     never paint. Both outcomes of a load have to arm it or the flag is dead. */
  const armedBanner = PAGE.split('\n')
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .filter((line) => /INSTR_BANNER\s*=\s*true/.test(line));
  assert.equal(armedBanner.length, 2,
    `the banner is armed at ${armedBanner.length} places; it must be armed on BOTH load outcomes, `
    + 'the editable one and the not-editable one');
});
