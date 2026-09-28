#!/usr/bin/env node
'use strict';
/**
 * #4298: find `mktemp` calls that name no path template.
 *
 * macOS `mktemp` IGNORES TMPDIR: with no template (`mktemp`, `mktemp -d`) or with
 * only `-t name`, it creates `tmp.XXXXXXXXXX` (or `name.XXXX`) in the per-user temp
 * root, outside the per-run root tools/run-tests.sh gives every test. So a test
 * that makes one leaves it in the real TMPDIR unless it removes it itself (#4273
 * measured about 2,480 a day). A positional template puts it where TMPDIR says:
 *   mktemp -d "${TMPDIR:-/tmp}/<name>.XXXXXXXXXX"
 *
 *   node tools/mktemp-template-check.js <file>...   prints file:line for each bare call, exit 1 if any
 *
 * Only a CALL counts: `mktemp` at the start of a command ($( , backtick, line start,
 * or after ; && || |), never the word inside an echo or a comment.
 */
const fs = require('node:fs');

/* A call may name the binary by path (`/usr/bin/mktemp`). Its arguments stop at a
   redirection, and the fd number in front of one (`2>/dev/null`) is not a template. */
const CALL = /(?:\$\(|`|^|[;&|]\s*)\s*(?:\/[\w./-]*\/)?mktemp\b([^)`;&|<>\n]*)/g;

/** The arguments of one call, split on whitespace with simple quote awareness. */
function words(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
  return out;
}

/** True when the call passes a positional template. `-t` takes a value, which is NOT a template on macOS. */
function hasTemplate(args) {
  const w = words(args.replace(/\s#.*$/, '').replace(/\s\d+\s*$/, ''));
  for (let i = 0; i < w.length; i += 1) {
    if (w[i] === '-t' || w[i] === '-p') { i += 1; continue; }
    if (w[i].startsWith('-')) continue;
    return true;
  }
  return false;
}

function bareCalls(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    for (const m of line.matchAll(CALL)) {
      if (!hasTemplate(m[1])) hits.push({ line: i + 1, text: line.trim() });
    }
  });
  return hits;
}

module.exports = { bareCalls, hasTemplate };

if (require.main === module) {
  let n = 0;
  for (const f of process.argv.slice(2)) {
    for (const h of bareCalls(fs.readFileSync(f, 'utf8'))) {
      console.log(`${f}:${h.line}: ${h.text.slice(0, 160)}`);
      n += 1;
    }
  }
  process.exit(n ? 1 : 0);
}
