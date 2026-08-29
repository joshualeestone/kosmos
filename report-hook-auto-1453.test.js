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
 * the surrounding lines' shape and silently reopen this.
 *
 * 🛑 THE FIRST VERSION OF THIS FILE COULD NOT SEE THAT SEVENTH CALL, WHICH IS
 * THE ONLY THING IT EXISTED FOR. It anchored `report` to the start of a line,
 * so an inline call -- `if x; then report started; fi`, `check && report
 * needs_you`, `rm -f "$M"; report stopped` -- was invisible. Measured, all
 * three MISSED against a control that matched. Shell style makes every one of
 * those natural, so the guard was blind in exactly the direction that reopens
 * the gap, and it would have reported clean while doing it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOOK = path.join(__dirname, 'install', 'kosmos-report-hook.sh');
const SRC = fs.readFileSync(HOOK, 'utf8');

/* Comment lines first, so the header block that explains this rule -- and any
   other prose containing the word -- cannot be read as a call. */
const CODE = SRC.split('\n').filter((l) => !/^[ \t]*#/.test(l)).join('\n');

/* A `report <state>` invocation wherever a command can legally begin: at the
   start of a line, or after a shell separator or block opener. */
const CALL = /(?:^|[;&|{]|\b(?:then|do|else|elif)\b)[ \t]*report[ \t]+([a-z_]+)((?:[ \t][^\n;]*)?)/gm;

function calls() {
  const out = [];
  for (const m of CODE.matchAll(CALL)) {
    out.push({ state: m[1], rest: m[2] || '', text: m[0].trim() });
  }
  return out;
}

test('the hook reports at least six states, so a zero from this file is not silence', () => {
  const found = calls();
  /* THE FLOOR. Six today; a minimum, so adding a seventh report is not a
     failure here -- it is a failure below, which is where the useful message
     lives. A guard that can return zero for a file it failed to read is not a
     guard. */
  assert.ok(found.length >= 6,
    'found ' + found.length + ' report calls in ' + HOOK + ', expected at least 6. '
    + 'Either the hook moved, or this pattern stopped matching it. Do not relax '
    + 'this to make it pass.');
});

test('every report the hook writes carries --auto, because the hook is the machine', () => {
  const missing = calls().filter((c) => !/(^|\s)--auto(\s|$)/.test(c.rest));
  assert.deepEqual(missing.map((c) => c.text), [],
    'these reports do not say the machine wrote them, so selfreport stores them '
    + 'as `by: agent` and every count of what agents really typed is wrong by '
    + 'that many. Add --auto (it changes nothing else: #900\'s guard is scoped '
    + 'to auto + idle and refuses no other state).');
});

test('--auto comes immediately after the state, so the CLI cannot read it as the sentence', () => {
  /* cmd_report's bash-3.2 flag loop BREAKS on the first non-flag argument, so
     `report needs_you "words" --auto` silently becomes part of the text and
     the report is recorded as agent-typed. Pinning the position rather than
     parsing the argument list is deliberate: the earlier version walked the
     arguments in pairs assuming every flag takes a value, and FALSE-POSITIVED
     on `--on "provider api (x)" --auto`, because a quoted multi-word value
     splits into several arguments. A guard that misfires on correct code gets
     deleted, so this asserts a convention the file already follows instead. */
  const late = calls().filter((c) => !/^[ \t]*--auto(\s|$)/.test(c.rest));
  assert.deepEqual(late.map((c) => c.text), [],
    '--auto must be the first argument after the state. Anywhere else and a '
    + 'future edit can slide free text in front of it, where the CLI\'s flag '
    + 'loop has already broken.');
});
