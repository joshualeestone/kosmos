#!/usr/bin/env node
'use strict';
/**
 * code-grep: search SOURCE, not the prose about it (#1570).
 *
 * 🛑 WHY THIS EXISTS. A string search cannot tell USE from MENTION, and both
 * directions have produced confident wrong conclusions about somebody's work:
 *
 *   a hit that is a COMMENT talking about the code   -> you mutate the wrong line,
 *                                                       no test goes red, and you
 *                                                       conclude the guard is
 *                                                       impossible to build
 *   a zero because a doc DESCRIBES a convention      -> you nearly report a
 *                                                       colleague's file as broken
 *
 * Neither search malfunctioned. Both returned exactly what was asked for.
 *
 * ⚠️ IT WAS ADVICE BEFORE THIS, AND ADVICE LOSES TO HOW EASY grep IS. That is
 * the shape the fleet has hit repeatedly: a rule in prose cannot compete with a
 * command in your fingers. So this is a command.
 *
 * 🔑 LINE NUMBERS ARE PRESERVED, WHICH IS THE WHOLE TRICK. Comments are BLANKED,
 * never deleted. Deleting them shifts every line below, so the tool reports a
 * real defect at a line that does not contain it. I shipped that bug once
 * already, in the #1592 sweep, and it named machine.js:191 for a call at 412.
 *
 * Usage:
 *   node tools/code-grep.js PATTERN FILE [FILE...]
 *   node tools/code-grep.js --list PATTERN FILE...   names only
 *   node tools/code-grep.js --count PATTERN FILE...  count only
 *
 * Exit 0 if any match, 1 if none, 2 on usage error. Same shape as grep, so it
 * drops into a pipeline where grep was.
 */
const fs = require('fs');

/**
 * Blank out comments and string literals, preserving every newline so line
 * numbers survive.
 *
 * ⚠️ STRINGS ARE BLANKED TOO, and that is deliberate rather than incidental:
 * the #1570 instance that started this anchored a mutation on a user-facing
 * MESSAGE, which appears in comments, tests and changelogs precisely because it
 * is user-facing. A tool that strips comments but keeps strings would still
 * have found that quote.
 *
 * 📌 It is a scanner, not a parser. It understands line comments, block
 * comments, single and double quotes, template literals and backslash escapes.
 * It does NOT understand regex literals containing quote characters, which is
 * the known blind spot and is stated here rather than discovered later.
 */
function codeOnly(src) {
  const out = Array.from(src);
  const n = src.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

function main(argv) {
  let mode = 'show';
  const args = [];
  for (const a of argv) {
    if (a === '--list') mode = 'list';
    else if (a === '--count') mode = 'count';
    else args.push(a);
  }
  if (args.length < 2) {
    process.stderr.write('usage: code-grep [--list|--count] PATTERN FILE [FILE...]\n');
    return 2;
  }
  const [pattern, ...files] = args;
  let re;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    process.stderr.write(`code-grep: bad pattern: ${e.message}\n`);
    return 2;
  }
  let total = 0;
  for (const f of files) {
    let src;
    try {
      src = fs.readFileSync(f, 'utf8');
    } catch (e) {
      process.stderr.write(`code-grep: ${f}: ${e.message}\n`);
      continue;
    }
    const lines = codeOnly(src).split('\n');
    const raw = src.split('\n');
    let hits = 0;
    lines.forEach((line, idx) => {
      if (!re.test(line)) return;
      hits++;
      total++;
      // Print the ORIGINAL line, so the reader sees real source, at the REAL number.
      if (mode === 'show') process.stdout.write(`${f}:${idx + 1}:${raw[idx]}\n`);
    });
    if (mode === 'list' && hits) process.stdout.write(`${f}\n`);
    if (mode === 'count') process.stdout.write(`${f}:${hits}\n`);
  }
  /* 🛑 THE CAVEAT PRINTS ON A ZERO, WHICH IS THE ONLY MOMENT IT MATTERS.
     A zero from a search is read as "it is not there", and that is exactly the
     conclusion this tool CANNOT support: it reads source text, so it cannot see
     a call assembled at runtime, reached through an alias, or built from a
     computed name. Splinter over-trusted his own sweep an hour before this was
     written, and the fix is not a line in a header nobody opens at the moment
     they act. Printed to stderr so it never pollutes a pipeline. */
  if (total === 0) {
    process.stderr.write(
      'code-grep: 0 matches. This reads SOURCE TEXT, so it cannot see a call ' +
        'built at runtime, reached through an alias, or named by a computed ' +
        'string. A zero here is "not written literally", NOT "does not happen".\n'
    );
  }
  return total > 0 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { codeOnly, main };
