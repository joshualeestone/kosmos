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
 * Only a CALL counts: `mktemp` in a command position (see PRE below), never the word
 * inside an echo or a comment.
 */
const fs = require('node:fs');

/* A command position: `$(`, a backtick, line start, after ; & | ! { (, or after a shell
   keyword. Then any `command`/`env`/`exec` wrappers and `VAR=value` assignments, then the
   binary, by name or by path (`/usr/bin/mktemp`). */
const PRE = String.raw`(?:\$\(|` + '`' + String.raw`|^|[;&|!{(]|\b(?:if|then|do|else|elif|while|until)\b)`;
const WRAP = String.raw`\s*(?:(?:command|env|exec)\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)*`;
const BIN = String.raw`(?:\/[\w./-]*\/)?mktemp(?![\w.-])`;
/* The arguments stop at a redirection or the end of the command. */
const CALL = new RegExp(PRE + WRAP + BIN + String.raw`([^)` + '`' + String.raw`;&|<>\n]*)`, 'g');

/** The arguments of one call, split on whitespace with simple quote awareness. */
function words(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
  return out;
}

/** True when the call passes a positional template. A short-flag cluster holding `t` or `p`
    (`-t`, `-dt`) takes the next word as its value, and on macOS that value is NOT a template.
    The fd number in front of a redirection (`2>/dev/null`) is not one either. */
function hasTemplate(args) {
  const w = words(args.replace(/\s#.*$/, '').replace(/\s\d+\s*$/, ''));
  for (let i = 0; i < w.length; i += 1) {
    if (/^-[A-Za-z]+$/.test(w[i])) { if (/[tp]/.test(w[i])) i += 1; continue; }
    if (w[i].startsWith('-')) continue;
    return true;
  }
  return false;
}

/** For each character of a line, whether it is shell CODE (true) or inside a quoted string or a
    comment (false). A `$(...)` or a backtick inside double quotes is code again, so
    `x="$(mktemp -d)"` counts and `echo "if mktemp -d"` or `: # if mktemp -d` does not. A string
    handed to `-c` (`bash -c '...'`, `sh -c "..."`) is a script, so it is code too. */
function codeMask(line) {
  const mask = new Array(line.length).fill(false);
  const stack = [{ kind: 'code', depth: 0 }];
  for (let i = 0; i < line.length; i += 1) {
    const top = stack[stack.length - 1];
    const ch = line[i];
    if (top.kind === 'sq') { if (ch === "'") stack.pop(); continue; }
    if (top.kind === 'dq') {
      if (ch === '\\') { i += 1; continue; }
      if (ch === '"') { stack.pop(); continue; }
      if (ch === '$' && line[i + 1] === '(') { stack.push({ kind: 'code', depth: 1 }); mask[i] = true; mask[i + 1] = true; i += 1; continue; }
      if (ch === '`') { stack.push({ kind: 'bt' }); mask[i] = true; continue; }
      continue;
    }
    // code, backtick code, or the body of a `-c` string
    mask[i] = true;
    if (top.close && ch === top.close) { mask[i] = false; stack.pop(); continue; }
    if (ch === '\\') { mask[i + 1] = true; i += 1; continue; }
    if (top.kind === 'bt' && ch === '`') { stack.pop(); continue; }
    if ((ch === "'" || ch === '"') && /(?:^|\s)-c\s*$/.test(line.slice(0, i))) {
      mask[i] = false; stack.push({ kind: 'code', depth: 0, close: ch }); continue;
    }
    if (ch === "'") { mask[i] = false; stack.push({ kind: 'sq' }); continue; }
    if (ch === '"') { mask[i] = false; stack.push({ kind: 'dq' }); continue; }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) { for (let j = i; j < line.length; j += 1) mask[j] = false; break; }
    if (top.kind === 'code' && top.depth > 0) {
      if (ch === '(') top.depth += 1;
      else if (ch === ')') { top.depth -= 1; if (top.depth === 0) stack.pop(); }
    }
  }
  return mask;
}

/** Bare calls in a file's text, by the line each command STARTS on. A backslash-newline
    continues a command, so a call split across lines is read whole. */
function bareCalls(text) {
  const hits = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const start = i;
    let line = lines[i];
    while (/\\$/.test(line) && i + 1 < lines.length) { i += 1; line = line.slice(0, -1) + ' ' + lines[i]; }
    if (/^\s*#/.test(line)) continue;
    const mask = codeMask(line);
    for (const m of line.matchAll(CALL)) {
      // The word itself must be code: a mention in a string or a comment is not a call.
      const at = m.index + m[0].search(/mktemp(?![\w.-])/);
      if (!mask[at]) continue;
      if (!hasTemplate(m[1])) hits.push({ line: start + 1, text: line.trim() });
    }
  }
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
