'use strict';
/**
 * The last thing on screen is the thing you still have to do (#1334).
 *
 * 🛑 THE FAILURE THIS IS FOR. On 2026-08-28 Josh installed Claude Code on a
 * fresh Mac. It printed "successfully installed", then the PATH instruction,
 * then "Installation complete!". He typed the command, got "command not
 * found", and asked whether he was missing something. The instruction he
 * needed was on his screen. The eye goes success to success, and an action
 * sandwiched between them is read as decoration.
 *
 * ⚠️ OURS HAD A MILDER VERSION AND IT FIRED ON HIM TEN MINUTES LATER. We wire
 * the profile ourselves rather than asking, which is the better thing, but we
 * said so about a thousand lines before the end and then finished on the
 * dashboard address. In the window he was standing in, `kosmos` did not work,
 * and he had just had that exact experience with another installer.
 *
 * ⭐ PINNED AT A POSITION, NOT MERELY PRESENT, for the same reason as the
 * printed-not-run banner at the top and bottom of the installer: "the bottom
 * of the scroll is where the reader actually is." An action that is present
 * but above a success line is the bug, not the fix, so a test that only
 * asserted presence would pass on the exact shape this card is about.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const SETUP = fs.readFileSync(nodePath.join(__dirname, 'install', 'setup.sh'), 'utf8');

/* The action's own line, and the success lines it must come after. Matched on
   the printf payloads rather than on comments, so prose about the change
   cannot satisfy the test. */
const ACTION = SETUP.indexOf('One more thing: typing');
const RUNNING = SETUP.lastIndexOf('Kosmos is running.');
const DASHBOARD = SETUP.lastIndexOf('Your dashboard: http://127.0.0.1');

test('the installer tells you the one thing you still have to do', () => {
  assert.notEqual(ACTION, -1, 'nothing tells the person their current Terminal cannot see kosmos');
  assert.match(SETUP, /export PATH="%s:\$PATH"/,
    'it names the problem without giving the command that fixes it');
});

test('and it says it LAST, after every success line', () => {
  /* 🔑 THE ARM THAT MATTERS. Presence is not the property; position is. If this
     moves above the dashboard block it is back to being decoration between two
     pieces of good news, which is the exact shape that cost Josh the call. */
  assert.ok(RUNNING !== -1 && DASHBOARD !== -1, 'the success lines moved; this test needs updating with them');
  assert.ok(ACTION > RUNNING,
    'the action is printed BEFORE "Kosmos is running", so it reads as part of the success');
  assert.ok(ACTION > DASHBOARD,
    'the action is printed BEFORE the dashboard address, so a success line follows it');
});

test('nothing that sounds like success comes after it', () => {
  /* ⚠️ The card's rule is not "put it late". It is "never followed by a success
     line", which is a different and stricter thing: one cheerful printf added
     underneath later would undo this without touching the action at all. */
  const after = SETUP.slice(ACTION);
  for (const claim of ['Kosmos is running', 'Your dashboard', 'installed successfully', 'Installation complete']) {
    assert.ok(!after.includes(claim),
      `"${claim}" is printed after the action, which puts the action back in the middle`);
  }
});

test('it stays quiet when there is nothing for the person to do', () => {
  /* 🛑 SCOPED TO THE TAIL, AND THAT IS NOT PEDANTRY. The installer has a SECOND,
     byte-identical `case ":$PATH:"` block a thousand lines up, where it decides
     whether to wire the profile at all. A whole-file match therefore passes on
     that one no matter what the closing lines do: I wrote this arm unscoped,
     deleted the gate around the action, and the test stayed green. It was
     decoration until the perturbation showed it. */
  const TAIL = SETUP.slice(RUNNING);
  /* 📌 A closing line that always fires is a closing line people stop reading.
     The condition is measured rather than assumed: not "did we just wire a
     profile", which is a proxy wrong in both directions, but whether the bin
     directory is on PATH in THIS process, which is the shell they are about to
     type into. */
  assert.match(TAIL, /case ":\$PATH:" in\n\s*\*":\$BIN_DIR:"\*\) ;;/,
    'the closing action is not gated on the bin directory being absent from PATH');
  assert.match(TAIL, /if \[ -f "\$BIN_DIR\/kosmos" \] && \[ -x "\$BIN_DIR\/kosmos" \]; then/,
    'it would tell a person to add a directory that has no kosmos in it');
});
