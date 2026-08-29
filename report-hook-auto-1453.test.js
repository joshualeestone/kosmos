'use strict';

/**
 * #1453 / #1456: EVERY REPORT THIS HOOK WRITES IS MARKED AS MACHINE-WRITTEN.
 *
 * `--auto` means the machine wrote this on the agent's behalf, not the agent
 * choosing to say it (install/kosmos, above cmd_report). The hook IS the
 * machine, so all SEVEN of its reports carry it -- and until #1453 exactly one
 * did, because the flag was added for #900's idle rule rather than for what it
 * means. Machine-written reports were therefore indistinguishable from an agent
 * typing them, and `selfreport.record` now PERSISTS that mark, so the gap
 * stopped being a measurement nuisance and became a wrong field.
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
 *
 * 🛑 AND THE REWRITE WAS STILL WRONG TWICE, FOUND BY ICE CREAM KITTY IN CROSS
 * REVIEW, BOTH WITH A CONTROL PROVING THE INSTRUMENT COULD SAY NO:
 *
 *   seventh) report needs_you "x" ;;   SURVIVED -- the separator class had no
 *                                      `)`, and THE HOOK IS A CASE STATEMENT:
 *                                      every one of its six calls lives in an
 *                                      arm, so an inline arm is the natural
 *                                      shape for the seventh.
 *   report "$STATE" "x"                SURVIVED BOTH -- `[a-z_]+` cannot match
 *                                      a variable, so the call was invisible to
 *                                      the matcher AND missing from the floor,
 *                                      which is the case the floor exists to
 *                                      make impossible.
 *
 * ⭐ HER FIX WAS A LOOSE COUNT COMPARED AGAINST THE STRICT ONE. The idea was
 * right and the implementation was not, which #1466 found:
 *
 * 🛑 THE THIRD VERSION WAS BLIND TOO, AND ITS CONTROL COULD NOT SAY SO. Both
 * patterns shared one separator class, and the SEVENTH call site is a COMMAND
 * SUBSTITUTION -- `STARTED_OUT=$("$KOSMOS" report started --auto 2>&1)`, the
 * synchronous delivery check -- whose preceding character is the closing quote
 * of `"$KOSMOS"`. Neither `(` nor `"` was in the class, so BOTH read 6 against
 * a hook with 7 calls, AGREED, and this file called that agreement proof it had
 * found them all. The floor was 6, derived from what the pattern happened to
 * find rather than from the real count, so it agreed as well.
 *
 * ⇒ Every machine-written `started` recorded as `by: 'agent'` for a day, on the
 * one lifecycle event that fires in every single session (#1466, Renet Tilley).
 *
 * ⭐⭐ THE LESSON THAT OUTLIVES THIS FILE: two patterns built on ONE mechanism
 * cannot disagree about that mechanism's blind spot. A control must differ in
 * MECHANISM, not merely in permissiveness. Three attempts at a looser regex all
 * failed the same way.
 *
 * ✅ SO THE INVARIANT IS NO LONGER A COUNT, IT IS A CLASSIFICATION. Every
 * `report` followed by an argument is assigned a kind (call / probe / forwarder
 * / variable-state / unclassified). A shape nobody anticipated lands in
 * `unclassified` BY DEFAULT and fails printing its own text, rather than
 * requiring a pattern to have predicted it. The separate vocabulary-vs-separator
 * comparison is kept, and it is worth something now because those two genuinely
 * key on different things.
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
   start of a line, after a shell separator or block opener, or inside a COMMAND
   SUBSTITUTION.

   🛑 `(` AND `"` ARE IN THIS CLASS BECAUSE OF #1466. The seventh call is
   `STARTED_OUT=$("$KOSMOS" report started --auto 2>&1)` -- the synchronous
   delivery check -- and the character in front of `report` there is the closing
   quote of `"$KOSMOS"`. Neither was in the class, so the call this whole file
   exists to notice was invisible to it for a day. */
const CALL = /(?:^|[;&|{)("]|\b(?:then|do|else|elif)\b)[ \t]*report[ \t]+([a-z_]+)((?:[ \t][^\n;]*)?)/gm;

/* 🛑 THE OLD CONTROL HERE WAS A SECOND REGEX SHARING `CALL`'s SEPARATOR CLASS,
   AND THAT MADE IT WORTHLESS. Two patterns built on one mechanism cannot
   disagree about that mechanism's blind spot. Both read 6 while the hook had 7
   call sites, both were blind to the same command substitution, and this file
   treated their agreement as proof it had found them all (#1466, Renet Tilley).

   ⭐ A control must differ in MECHANISM, not merely in permissiveness. Replacing
   it with a looser regex just moved the arithmetic around: three attempts each
   produced a count that disagreed with `CALL` for reasons that were not defects
   (the wrapper's own definition, the two capability probes that pass NO state,
   the forwarder's `"$@"`).

   ✅ SO THE INVARIANT IS NOT A COUNT, IT IS A CLASSIFICATION. Every `report`
   followed by an argument is assigned a kind. An occurrence nobody has taught
   this file about is UNCLASSIFIED and fails, printing its own text -- which is
   strictly more useful than "loose=9 strict=7", and cannot be satisfied by a
   pattern that happens to miss the same thing twice. */

function calls() {
  const out = [];
  for (const m of CODE.matchAll(CALL)) {
    out.push({ state: m[1], rest: m[2] || '', text: m[0].trim() });
  }
  return out;
}

const STATES = ['started', 'working', 'idle', 'needs_you', 'blocked', 'stopped'];

/* Quoted text is MASKED before scanning, because the hook's own prose about
   "the report verb" and "the report could not be recorded" lives inside strings
   on NON-comment lines, and a scan with no separator concept reads those as
   calls. Masking rather than deleting keeps every real call's shape intact: the
   state always precedes the quoted argument.

   🛑 THE FORWARDER IS MASKED FIRST AND DELIBERATELY. `report "$@"` (the wrapper
   passing its own arguments through) and `report "$STATE"` (a call whose state
   nothing can check) COLLAPSE TO THE SAME `report ""` once strings are masked,
   and only one of them is a defect. Masking `"$@"` to a sentinel first is what
   keeps them distinguishable.

   ⚠️ `\n` is excluded from the class. Without it the pattern matched from one
   string's closing quote to the next string's opening quote, across lines,
   collapsing unrelated code into one span and losing four real calls. */
const MASKED = CODE
  .replace(/"\$@"/g, '@FORWARDED@')
  .replace(/"[^"\n\\]*"/g, '""');

const OCCUR = /\breport[ \t]+(\S+)/g;

function classify(tok) {
  if (STATES.includes(tok)) return 'call';
  /* The two capability probes ask the CLI whether it knows the verb and pass
     NO state, so what follows is a redirection. */
  if (/^[0-9]?[<>&|]/.test(tok)) return 'probe';
  /* The wrapper forwarding its own arguments. `"$@"` and `"$STATE"` are the
     same SHAPE and only one is a call site, so this is matched by name. */
  if (tok === '@FORWARDED@') return 'forwarder';
  /* 🛑 A state behind a variable. NOT benign: the strict matcher cannot parse
     it, so its --auto is checked by nothing. Ice Cream Kitty found this shape;
     it is reported rather than tolerated. */
  if (tok === '""') return 'variable-state';
  return 'unclassified';
}

function occurrences() {
  return [...MASKED.matchAll(OCCUR)].map((m) => ({ tok: m[1], kind: classify(m[1]) }));
}

test('every `report` in the hook is a kind this guard recognises', () => {
  /* The #1466 replacement for the loose-vs-strict count. A new call written in
     a shape nobody anticipated lands here by DEFAULT, rather than needing a
     pattern to have predicted it. */
  const unknown = occurrences().filter((o) => o.kind === 'unclassified');
  assert.deepEqual(unknown.map((o) => o.tok), [],
    'a `report` occurrence in a shape this file does not recognise. If it is a '
    + 'real call site, the checks below cannot see it and its --auto is verified '
    + 'by nothing: teach classify() the shape rather than deleting this test.');

  const variable = occurrences().filter((o) => o.kind === 'variable-state');
  assert.deepEqual(variable.map((o) => o.tok), [],
    'the state is behind a variable, so no static check can tell which state is '
    + 'reported or whether --auto is present. Pass a literal state.');
});

test('the classifier finds every call the strict matcher does, and no fewer', () => {
  /* The two disagree only if one of them is broken, and they are built on
     DIFFERENT mechanisms: `CALL` keys on shell separators, `classify` keys on
     the state vocabulary. That is what makes the comparison worth anything --
     the pair it replaced shared a separator class and could not disagree. */
  const byVocab = occurrences().filter((o) => o.kind === 'call').length;
  const bySeparator = calls().length;
  assert.equal(byVocab, bySeparator,
    'vocabulary found ' + byVocab + ' calls, separators found ' + bySeparator
    + '. These key on different things, so a mismatch means one is blind: a call '
    + 'in a shell position the separator class does not know (this was #1466: a '
    + 'command substitution, `$("$KOSMOS" report started ...)`), or a state word '
    + 'missing from STATES.');
});

test('the hook reports at least seven states, so a zero from this file is not silence', () => {
  const found = calls();
  /* THE FLOOR. SEVEN today, raised from six by #1466: the old floor was
     derived from what the pattern happened to find rather than from the real
     call count, so it agreed with a blind matcher instead of contradicting it.
     A minimum, so adding an eighth is not a failure here -- it is a failure
     below, which is where the useful message lives. */
  assert.ok(found.length >= 7,
    'found ' + found.length + ' report calls in ' + HOOK + ', expected at least 7. '
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
