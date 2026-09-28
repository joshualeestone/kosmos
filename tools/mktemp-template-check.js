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
 *
 * ⚠️ PER LINE, NOT A SHELL PARSER. Quote state does not carry across lines, so a heredoc
 * body or a multi-line string can read as code (a false positive: this checker's own
 * test excludes itself for its fixtures), and a line closing a multi-line quote before a
 * call can read as text (a false negative). The wrappers it looks through are a fixed list (WRAP
 * below); a call behind another wrapper may be missed (`flock /x mktemp` is, while `x=$(ionice mktemp)`
 * is caught only because the `x=` assignment arm swallows the one word), so extend WRAP when one appears.
 * It checks that a template EXISTS, not that it sits under TMPDIR: a literal `/tmp/...XXXXXX` passes
 * and does not land in the per-run root, so such a call needs its own cleanup (the in-tree ones have
 * traps). Only a `-t` BEFORE the template is seen; after it, macOS getopt has stopped reading flags.
 * The negative control pins the shapes it finds.
 */
const fs = require('node:fs');

/* A command position: `$(`, a backtick, line start, after ; & | ! { ( ) (a `case` arm), or
   after a shell keyword, or at the start of a quoted string (which counts only where that string is
   a script: see codeMask). Then any wrappers (`command`, `env`, `exec`, `sudo`, `nice`, `time`,
   `nohup`, `xargs`, `timeout`, `stdbuf`, with their options) and `VAR=value` assignments, then the binary, by
   name or by path (`/usr/bin/mktemp`). */
const PRE = String.raw`(?:\$\(|` + '`' + String.raw`|^|[;&|!{()]|\b(?:if|then|do|else|elif|while|until)\b|(?:^|(?<=[\s=(;&|` + '`' + String.raw`]))["'])`;
const OPT = String.raw`(?:\s+-[\w-]+\S*(?:\s+(?:"[^"]*"|'[^']*'|[^\s-]\S*))?)*`;
const WRAP = String.raw`\s*(?:(?:builtin|command|env|exec|sudo|nice|time|nohup|xargs|stdbuf|caffeinate|arch)` + OPT + String.raw`\s+|timeout` + OPT + String.raw`\s+[\d.]+[smhd]?\s+)*`
  + String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)*`;
/* The name may be quoted (`"mktemp" -d` runs mktemp all the same). */
const BIN = String.raw`(["']?)\\?(?:\/[\w./-]*\/)?mktemp\1(?![\w.-])`;
const CALL = new RegExp(PRE + WRAP + BIN, 'g');

/* What comes right before a quoted string that is itself a script: a shell's `-c` (in a flag
   cluster too: `-lc`, `-ec`), `eval`, or `trap`. A `-c` on anything else (`grep -c`) is not. */
const SCRIPT_ARG = /(?:(?:^|[\s;&|(`])(?:\S*\/)?(?:ba|z|da|k)?sh(?:\s+-[A-Za-z]+)*\s+-[A-Za-z]*c|(?:^|[\s;&|(`])(?:eval|trap))\s*$/;

/** A call's arguments: from after the binary to the end of the command, which is a `;`, `&`,
    `|`, a redirection, a backtick or an unmatched `)`. Quotes and a nested `$(...)` are kept
    whole, so `-t "$(basename $0)"` is one word. */
function argsAt(line, from) {
  let depth = 0; let q = '';
  for (let i = from; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '\\' && q === '"') { i += 1; continue; }
      if (ch === q) q = '';
      else if (q === '"' && ch === '$' && line[i + 1] === '(') { depth += 1; i += 1; }
      else if (q === '"' && ch === ')' && depth > 0) depth -= 1;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '\\') { i += 1; continue; }
    if (ch === '$' && line[i + 1] === '(') { depth += 1; i += 1; continue; }
    if (ch === ')') { if (depth === 0) return line.slice(from, i); depth -= 1; continue; }
    if (depth === 0 && /[;&|<>`]/.test(ch)) return line.slice(from, i);
  }
  return line.slice(from);
}

/** The arguments of one call as shell words: whitespace splits only outside quotes and outside
    a nested `$(...)`, so `"$(basename "$0")"` is one word. Quotes are dropped. */
function words(s) {
  const out = [];
  let cur = ''; let has = false; let q = ''; let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) {
      if (ch === q && depth === 0) { q = ''; continue; }
      if (ch === '$' && s[i + 1] === '(') { depth += 1; cur += '$('; i += 1; continue; }
      if (ch === ')' && depth > 0) depth -= 1;
      cur += ch; continue;
    }
    if (depth > 0) {
      if (ch === '(') depth += 1; else if (ch === ')') depth -= 1;
      cur += ch; continue;
    }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (ch === '$' && s[i + 1] === '(') { depth += 1; cur += '$('; has = true; i += 1; continue; }
    if (/\s/.test(ch)) { if (has || cur) { out.push(cur); cur = ''; has = false; } continue; }
    cur += ch; has = true;
  }
  if (has || cur) out.push(cur);
  return out;
}

/** True when the call passes a positional template ending in X's. A short-flag cluster holding `t` or `p`
    takes the next word as its value; any `-t` (alone or in a cluster) is a leak outright, because macOS
    then also creates `<prefix>.XXXX` in the per-user root. A template must be written out inline:
    `mktemp -d "$T"` is reported, since the checker cannot see what $T holds.
    The fd number in front of a redirection (`2>/dev/null`) is not one either. */
function hasTemplate(args) {
  const w = words(args.replace(/\s#.*$/, '').replace(/\s\d+\s*$/, ''));
  for (let i = 0; i < w.length; i += 1) {
    // `-t` makes macOS create a SECOND file in the per-user root even beside a template, so any
    // call carrying it leaks, whatever else it passes.
    if (/^-[A-Za-z]*t[A-Za-z]*$/.test(w[i])) return false;
    if (/^-[A-Za-z]+$/.test(w[i])) { if (/p/.test(w[i])) i += 1; continue; }
    if (w[i].startsWith('-')) continue;
    // A template must END in a run of X's for mktemp to randomise; `"$T/fixed"` names one fixed
    // path every time, so it is no template at all.
    return /XXX+$/.test(w[i]);
  }
  return false;
}

/** For each character of a line, whether it is shell CODE (true) or inside a quoted string or a
    comment (false). A `$(...)` or a backtick inside double quotes is code again, so
    `x="$(mktemp -d)"` counts and `echo "if mktemp -d"` or `: # if mktemp -d` does not. A string
    handed to `-c` (`bash -c '...'`, `sh -ec "..."`), `eval` or `trap` is a script, so it is
    code too. */
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
    if ((ch === "'" || ch === '"') && SCRIPT_ARG.test(line.slice(0, i))) {
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
      // `command -v mktemp` asks whether mktemp exists; it does not run it.
      if (/\bcommand\s+-[A-Za-z]*[vV]/.test(m[0])) continue;
      // The word itself must be code: a mention in a string or a comment is not a call. A quoted
      // name is judged by what precedes its opening quote.
      const qn = m[0].search(/(["'])(?:\/[\w./-]*\/)?mktemp\1(?![\w.-])/);
      let at;
      if (qn >= 0) {
        // A quoted NAME ("mktemp" -d): it is code when what comes right before the quote is code.
        at = m.index + qn;
        if (at > 0 && !mask[at - 1] && !/\s/.test(line[at - 1])) continue;
      } else {
        at = m.index + m[0].search(/mktemp(?![\w.-])/);
        if (!mask[at]) continue;
      }
      if (!hasTemplate(argsAt(line, m.index + m[0].length))) hits.push({ line: start + 1, text: line.trim() });
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
