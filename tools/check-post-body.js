#!/usr/bin/env node
'use strict';
/**
 * Check a body file before it becomes Josh-facing text on GitHub (#1491).
 *
 * 🛑 TWO DEFECTS, ONE MOMENT. Both happen in the seconds between writing a PR
 * or issue body and posting it, and both are silent.
 *
 * 1. `gh ... --body "..."` with DOUBLE QUOTES executes backticks in the body.
 *    A backticked function name RUNS AS A COMMAND and the literal text is gone.
 *    Measured: a name that appeared twice in the source appeared ZERO times in
 *    the posted body. Nothing errors, and the PR looks written.
 *
 * 2. Nothing sweeps what we post for em dashes. Josh's one absolute rule, and
 *    PR bodies were the surface with no guard at all: `engine/create.test.js`
 *    checks ROLE FILES and only the `—` spelling.
 *
 * ⚠️ THIS IS THE THIRD TIME THE FLEET HAS WRITTEN THIS DOWN AND THE SECOND TIME
 * IT DID NOT HELP. The backtick remedy was already in one agent's memory with
 * the fix; the agent who hit it did not have that memory. I have that memory,
 * and I hit it anyway TEN MINUTES before writing this file, closing #1545.
 * ⇒ Knowing a failure by name does not prevent it. A command you run does.
 *
 * Usage, and the point is that it is one word longer than posting unchecked:
 *
 *   node tools/check-post-body.js body.md && gh pr create --body-file body.md
 *
 * Exit 0 clean, 1 if anything would reach Josh wrong, 2 on usage error.
 *
 * 🛑 SCOPE: THIS IS FOR BODIES, NOT FOR SOURCE FILES. A body is Josh-facing in
 * its entirety, so every character in it counts. A source file is not: an em
 * dash in a code comment is developer prose he never reads.
 *
 * ⚠️ Pointed at source it produces FALSE POSITIVES, measured rather than
 * guessed: run over `engine/roles.js` it reports three, all inside the file's
 * header comment block. The composed role text that actually reaches an agent
 * has ZERO across all 34 roles, and `engine/create.test.js` already guards
 * that correctly. Use this on the thing you are about to POST.
 */
const fs = require('fs');

/**
 * All five spellings. A check for the literal character alone misses four, and
 * the one that reached a live pay screen was the SOURCE ESCAPE inside a string
 * literal, which no literal-character grep can see.
 */
const SPELLINGS = [
  { name: 'literal em dash', pat: /—/g },
  { name: 'HTML entity &mdash;', pat: /&mdash;/g },
  { name: 'decimal entity &#8212;', pat: /&#8212;/g },
  { name: 'hex entity &#x2014;', pat: /&#x2014;/gi },
  { name: 'source escape \\u2014', pat: /\\u\{?2014\}?/g },
];

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function check(text) {
  const problems = [];
  for (const { name, pat } of SPELLINGS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(text)) !== null) {
      problems.push({ kind: 'em-dash', name, line: lineOf(text, m.index) });
      if (m.index === pat.lastIndex) pat.lastIndex++;
    }
  }
  const ticks = (text.match(/`/g) || []).length;
  return { problems, ticks };
}

function main(argv) {
  if (argv.length !== 1) {
    process.stderr.write('usage: check-post-body FILE   (then post with --body-file, never --body)\n');
    return 2;
  }
  let text;
  try {
    text = fs.readFileSync(argv[0], 'utf8');
  } catch (e) {
    process.stderr.write(`check-post-body: ${e.message}\n`);
    return 2;
  }
  const { problems, ticks } = check(text);

  for (const p of problems) {
    process.stdout.write(`${argv[0]}:${p.line}: ${p.name}\n`);
  }
  if (problems.length) {
    process.stdout.write(
      `\n${problems.length} em dash(es). Josh edits these out of everything; ` +
        'a PR body is text he reads.\n'
    );
  }

  /* 🔑 THE BACKTICK NOTE IS ADVICE, NOT A REFUSAL, AND THAT IS DELIBERATE.
     Backticks in a body are correct and normal: they are how code is quoted.
     The defect is not having them, it is posting with --body instead of
     --body-file. Refusing here would make the tool wrong about good input and
     it would be switched off. So it says the one sentence that matters, only
     when there is something to lose. */
  if (ticks > 0) {
    process.stderr.write(
      `check-post-body: this body contains ${ticks} backtick(s). Post it with ` +
        '--body-file. With --body "..." the shell EXECUTES them and the text ' +
        'vanishes silently.\n'
    );
  }
  return problems.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { check, SPELLINGS };
