'use strict';

/**
 * The stale check's silences each say which one they are.
 *
 * 🛑 #1042's SYMPTOM IS "THE NOTICE DID NOT APPEAR", and checkWhetherThisAppIsBehind
 * had SIX ways to return having said nothing: no readable app version, an
 * unbuildable URL, no answer from the board, an answer with no readable version,
 * the versions being equal, and the notice already shown.
 *
 * ⚠️ ONLY THE LAST TWO ARE CORRECT SILENCES. The other four left no trace at
 * all, so somebody debugging a missing notice could not tell which had happened
 * -- or whether the check had run. A silence with four causes and one
 * appearance is the defect this fleet spent 2026-08-27 finding in its own
 * instruments; this instance is in the product, on the one card that cannot be
 * tested on this machine.
 *
 * 🔑 WHAT THIS FILE ACTUALLY PROTECTS, and it is not the strings. It is that
 * ADDING A NEW QUIET EXIT FAILS THE SUITE until the new exit declares itself.
 * The count is the guard; the distinctness stops two failures rendering as one
 * line, which would put us back where we started with extra steps.
 *
 * 📌 Read from source rather than run, because the four exits live in a
 * URLSession callback and an AppKit delegate that no selftest can construct.
 * The Swift selftest hatch covers the comparison; this covers the shape.
 *
 *   node --test native-app.stale-silences.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SRC = fs.readFileSync('native-app/main.swift', 'utf8');

test('the instrument is reading something', () => {
  assert.ok(SRC.length > 40000, `main.swift read back only ${SRC.length} bytes; every assertion below would pass for the wrong reason`);
  assert.ok(SRC.includes('func checkWhetherThisAppIsBehind'), 'the stale check moved or was renamed');
});

/* The body of the check, so a call site elsewhere in the file cannot satisfy
   an assertion about this function. */
function checkBody() {
  const start = SRC.indexOf('private func checkWhetherThisAppIsBehind(port: Int) {');
  assert.ok(start > 0, 'checkWhetherThisAppIsBehind moved or was renamed');
  const end = SRC.indexOf('\n    private func ', start + 10);
  assert.ok(end > start, 'could not find the end of checkWhetherThisAppIsBehind');
  return SRC.slice(start, end);
}

test('every quiet exit declares which one it is, and no two say the same thing', () => {
  const body = checkBody();
  const said = [...body.matchAll(/sayQuietStaleReason\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

  /* 🛑 FOUR, AND THE NUMBER IS THE POINT. If somebody adds a fifth `return`
     that says nothing, this goes red and they have to decide whether it is a
     correct silence (equal versions, notice already shown) or one more
     invisible way for the notice not to appear. That decision is the whole
     value; the file cannot make it for them. */
  assert.equal(said.length, 4,
    `expected 4 declared quiet exits, found ${said.length}: ${said.join(' | ')}. `
    + `A new silent return must either declare itself with sayQuietStaleReason, or be a genuinely correct `
    + `silence (equal versions, notice already shown) and this count updated in the same commit.`);

  /* 🛑 AND THE COUNT OF BARE RETURNS, WHICH IS THE ASSERTION THAT ACTUALLY
     KEEPS THE PROMISE ABOVE. The first version of this file counted only the
     DECLARED exits, then claimed in its own docstring that "adding a new quiet
     exit fails the suite". It did not: a control that inserted
     `guard port > 0 else { return }` left the declared count at 4 and the file
     stayed green. That is the same mistake as asserting a fix instead of the
     property -- the test measured what I had just written rather than what I
     had promised.
     ⚠️ Comments stripped first: this function's bare returns are each explained
     in prose directly above them, and a naive count reads those explanations. */
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const bare = [...stripped.matchAll(/else \{ return \}/g)].length;
  assert.equal(bare, 5,
    `expected 5 bare returns in this function, found ${bare}. The five allowed are: the notice already shown; `
    + `the weak-self unwrap; equal versions; the mismatch-log dedup latch; and the already-shown re-check on the main `
    + `thread. A SIXTH is a new way for the notice not to appear with no trace -- declare it with sayQuietStaleReason, `
    + `or if it is genuinely a correct silence, say why and update this count in the same commit.`);

  assert.equal(new Set(said).size, said.length,
    `two quiet exits share a sentence: ${said.join(' | ')}. Distinct causes rendering as one line puts a reader back where they started`);

  /* Each says a REASON. None offers a remedy: we have a measured fix for none
     of these, and inventing one is the defect #1042 is about. */
  for (const line of said) {
    assert.ok(!/\breinstall\b|\bupdate\b|\brelaunch\b|\bquit\b/i.test(line),
      `a quiet-exit line offers an instruction ("${line}"). These paths have no measured remedy, and a screen or log that invents one is the defect this card is about`);
  }
});

test('the two correct silences stay silent, and are marked as deliberate', () => {
  const body = checkBody();
  assert.match(body, /guard theirs != mine else \{ return \}/,
    'the equal-versions exit changed shape; it must stay a bare return, because logging a non-event is how a diagnostic file stops being read');
  assert.match(body, /guard !staleAppNoticeShown else \{ return \}/,
    'the already-shown exit changed shape; it must stay a bare return');
  assert.ok(/correct silences/i.test(body),
    'the comment marking the deliberate silences is gone; without it the next reader sees two undeclared exits and "fixes" them');
});

test('the reasons are latched, so a repeating navigation cannot bury the log', () => {
  /* didFinish fires on every main-frame navigation -- Cmd-R, the Settings
     item's location.assign, the board's own reloads -- so this check repeats
     until the notice fires. Unlatched logging would write the same sentence
     until the file is useless. */
  assert.match(SRC, /loggedQuietStaleReasons\s*=\s*Set<String>\(\)/, 'the per-reason latch is gone');
  assert.match(SRC, /loggedQuietStaleReasons\.insert\([^)]*\)\.inserted/,
    'the latch is no longer consulted before logging, so a repeating navigation can bury the diagnostic file');
});
