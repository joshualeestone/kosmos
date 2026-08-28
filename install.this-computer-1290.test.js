'use strict';

/**
 * One product, one word for the machine (#1290, following #1270).
 *
 * #1270 made the app say "this computer" everywhere, for Windows (#1112, #1118).
 * The installer, the Mac app and the pkg screen kept "this Mac", because they
 * are macOS-only and the word is true there. The card asked for a decision:
 * keep them, or say "this computer" everywhere.
 *
 * 🔑 THE ANSWER IS NEITHER, BECAUSE THE 18 OCCURRENCES WERE DOING TWO JOBS.
 * Most were about the machine you are sitting at, where "this computer" loses
 * nothing: a port in use, your agents' files, the Applications folder. THREE
 * were about the machine BEING A MAC, where it loses the sentence:
 *
 *   "Kosmos needs a Mac with Apple silicon (M1 or newer). This computer is arm64."
 *
 * ⇒ THE RULE: "this Mac" only where the sentence is telling you about macOS,
 * Apple silicon or the architecture. Everywhere else, "this computer".
 *
 * ⭐ AND THE RULE IS MECHANICALLY CHECKABLE, which is why this is a test and not
 * a line in a document. The card expected an allowlist somebody has to
 * maintain; a sentence that says "this Mac" while talking about ports carries
 * no macOS word, and one that talks about the macOS floor always does.
 *
 * 🛑 THE RULE WAS WRITTEN FIRST AND THEN TESTED AGAINST THE KEEPS, AND THREE OF
 * SIX FAILED IT: "the copy of tmux will not run on this Mac" is about the
 * architecture, but the SENTENCE does not say so; the reason lived in the
 * surrounding block. Those three became "this computer" rather than the rule
 * being loosened to accommodate them. A guard that has to be widened to fit
 * its own subject is not a guard.
 *
 *   node --test install.this-computer-1290.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

/* Comment syntax differs per file, and a "this Mac" inside a comment is
   documentation rather than something a person reads on screen. */
const FILES = [
  { path: 'install/setup.sh', comment: /^\s*#/ },
  { path: 'install/kosmos', comment: /^\s*#/ },
  { path: 'native-app/main.swift', comment: /^\s*(\/\/|\*|\/\*)/ },
  { path: 'install/pkg-scripts/installing.html', comment: /^\s*(<!--|\*)/ },
];

/* The words that make "this Mac" the right phrase: the sentence is telling you
   something about macOS itself. */
const MAC_SUBJECT = /macos|apple silicon|darwin|arm64|\$ARCH/i;

function liveMacLines(path, commentRe) {
  return fs.readFileSync(path, 'utf8').split('\n')
    .map((line, i) => ({ n: i + 1, line }))
    .filter((r) => /this Mac|This Mac/.test(r.line))
    .filter((r) => !commentRe.test(r.line));
}

test('#1290: the instrument reads the files at all', () => {
  for (const { path } of FILES) {
    const body = fs.readFileSync(path, 'utf8');
    assert.ok(body.length > 200, `${path} is empty or unreadable, so every assertion below passes for the wrong reason`);
  }
  /* CONTROL: the phrase this card is about must appear SOMEWHERE live, or the
     rule below is being checked against a corpus that has already lost it. */
  const total = FILES.reduce((n, f) => n + liveMacLines(f.path, f.comment).length, 0);
  assert.ok(total > 0, 'no live "this Mac" survives anywhere, so this test is guarding nothing');
});

test('#1290: "this Mac" survives only where the sentence is about macOS itself', () => {
  const offenders = [];
  for (const { path, comment } of FILES) {
    for (const r of liveMacLines(path, comment)) {
      if (!MAC_SUBJECT.test(r.line)) offenders.push(`${path}:${r.n}  ${r.line.trim().slice(0, 90)}`);
    }
  }
  assert.deepEqual(offenders, [],
    'a user-facing sentence says "this Mac" without telling the reader anything about macOS. '
    + 'The app says "this computer" and one product should use one word:\n  ' + offenders.join('\n  '));
});

test('CONTROL: the rule can return the dangerous answer', () => {
  /* A line the rule must REJECT, and one it must ACCEPT. Without both, a rule
     that accepted everything would pass the test above forever. */
  const BAD = '      die "Another app on this Mac is using port $PORT, which Kosmos needs."';
  const GOOD = '  *) die "Kosmos needs a Mac with Apple silicon (M1 or newer). This Mac is $ARCH." ;;';
  assert.equal(MAC_SUBJECT.test(BAD), false, 'the rule accepts a sentence about ports, so it forbids nothing');
  assert.equal(MAC_SUBJECT.test(GOOD), true, 'the rule rejects a sentence about Apple silicon, so it would force a worse word');
});
