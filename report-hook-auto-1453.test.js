'use strict';

/**
 * #1453 / #1456: EVERY REPORT THIS HOOK WRITES IS MARKED AS MACHINE-WRITTEN.
 *
 * `--auto` means the machine wrote this on the agent's behalf, not the agent
 * choosing to say it (install/kosmos, above cmd_report). The hook IS the
 * machine, so all of its reports carry it -- and until #1453 exactly one did,
 * because the flag was added for #900's idle rule rather than for what it
 * means. Five of six machine-written reports were therefore indistinguishable
 * from an agent typing them, and `selfreport.record` now PERSISTS that mark,
 * so the gap stopped being a measurement nuisance and became a wrong field.
 *
 * ⚠️ A TRIPWIRE ON THE CLASS, NOT ON THE FIVE LINES THAT WERE WRONG. A seventh
 * report added later is the whole failure mode: it would be written against
 * the surrounding lines' shape and silently reopen this. The floor below is
 * what makes a zero mean something -- a renamed file, a moved hook or a regex
 * that stopped matching would otherwise pass as clean.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOOK = path.join(__dirname, 'install', 'kosmos-report-hook.sh');
const SRC = fs.readFileSync(HOOK, 'utf8');

/* A `report <state> ...` invocation, not a mention of one. Anchored to the
   start of a line so the header comment block that explains this rule -- and
   any other prose containing the word -- cannot be mistaken for a call. */
const CALL = /^[ \t]*report[ \t]+([a-z_]+)\b(.*)$/gm;

function calls() {
  const out = [];
  for (const m of SRC.matchAll(CALL)) out.push({ state: m[1], rest: m[2], line: m[0].trim() });
  return out;
}

test('the hook reports at least six states, so a zero from this file is not silence', () => {
  const found = calls();
  /* THE FLOOR. Six today; the assertion is a minimum, so adding a seventh
     report is not a failure here -- it is a failure in the test below, which
     is where the useful message lives. */
  assert.ok(found.length >= 6,
    'found ' + found.length + ' report calls in ' + HOOK + ', expected at least 6. '
    + 'Either the hook moved, or this pattern stopped matching it. Do not '
    + 'relax this: a guard that can return zero for a file it failed to read '
    + 'is not a guard.');
});

test('every report the hook writes carries --auto, because the hook is the machine', () => {
  const missing = calls().filter((c) => !/(^|\s)--auto(\s|$)/.test(c.rest));
  assert.deepEqual(missing.map((c) => c.line), [],
    'these reports do not say the machine wrote them, so selfreport will store '
    + 'them as `by: agent` and every count of what agents really typed is wrong '
    + 'by that many. Add --auto (it changes nothing else: #900\'s guard is '
    + 'scoped to auto + idle and refuses no other state).');
});

test('the flag reaches the CLI as a real flag, not as part of the sentence', () => {
  /* cmd_report's bash-3.2 loop breaks on the first non-flag argument, so
     `report needs_you "words" --auto` would silently become part of the text.
     Every call must place --auto before any free text. */
  const late = calls().filter((c) => {
    const args = c.rest.trim().split(/\s+/).filter(Boolean);
    const at = args.indexOf('--auto');
    if (at < 0) return false;
    /* Everything before --auto must itself be a flag or a flag's value. */
    const before = args.slice(0, at);
    for (let i = 0; i < before.length; i += 2) {
      if (!/^--(on|owner|until|project)$/.test(before[i])) return true;
    }
    return false;
  });
  assert.deepEqual(late.map((c) => c.line), [],
    '--auto appears after free text, where the CLI\'s flag loop has already '
    + 'broken, so it would be recorded as part of what the agent said.');
});
