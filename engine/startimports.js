'use strict';
/* #5774 route 3: the files Claude Code's instruction files pull in with an `@path` import. Claude Code reads an
   imported file as instructions at every start, and it can sit anywhere, so a token-only agent's file tools could
   rewrite what every session importing it is told. This follows the imports the way Claude Code 2.1.296 does
   (measured from its own bundle) and returns the files to deny; engine/setup-assistant.js denies them. */
const fs = require('fs');
const path = require('path');

const MAX_DEPTH = 5;   // Claude Code loads the importing file at depth 0 and refuses depth 5
const MAX_BYTES = 256 * 1024;
const MAX_FILES = 2000;   // files read in all; a scan cut short is named

/* A regular file's text, or null (absent, a folder, a FIFO, unreadable). */
function readText(f) {
  try {
    if (!fs.statSync(f).isFile()) return null;
    const fd = fs.openSync(f, 'r');
    try { const b = Buffer.alloc(MAX_BYTES); return b.toString('utf8', 0, fs.readSync(fd, b, 0, b.length, 0)); } finally { fs.closeSync(fd); }
  } catch { return null; }
}

/* The text Claude Code scans for imports: markdown with its code left out. Claude Code lexes the file and skips code and
   code-span tokens, and strips HTML comments. Here: fenced code blocks, inline code spans and HTML comments are
   removed. Indented code is NOT removed, so an import-like word there is still read: the safe direction. */
function proseOf(text) {
  const out = [];
  let fence = null;
  for (const line of String(text).split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
      out.push('');
      continue;
    }
    if (m && !(m[1][0] === '`' && line.slice(line.indexOf(m[1]) + m[1].length).includes('`'))) { fence = m[1]; out.push(''); continue; }
    out.push(line);
  }
  return out.join('\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(`+)[\s\S]*?\1/g, ' ');
}

/* The imports in one file's text, as absolute paths, in Claude Code's rule: `@` at the start or after whitespace, then
   non-space characters (a backslash-space is a space); a # ends the path; kept when it starts ./, ~/ or / (not / alone),
   or is a bare name starting with a letter, digit, ., _ or -; resolved from the file's folder. */
function importsIn(text, file, home) {
  const out = new Set();
  const re = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
  const prose = proseOf(text);
  let m;
  while ((m = re.exec(prose)) !== null) {
    let p = m[1];
    const h = p.indexOf('#');
    if (h !== -1) p = p.slice(0, h);
    p = p.replaceAll('\\ ', ' ');
    if (!p) continue;
    const ok = p.startsWith('./') || p.startsWith('~/') || (p.startsWith('/') && p !== '/')
      || (!p.startsWith('@') && !/^[#%^&*()]+/.test(p) && /^[a-zA-Z0-9._-]/.test(p));
    if (!ok) continue;
    out.add(p.startsWith('~/') ? path.join(home, p.slice(2)) : path.resolve(path.dirname(file), p));
  }
  return [...out];
}

/* Every file the roots import, at any depth Claude Code loads. Returns { files, unsafe }:
   - files: each import target (absent ones too: the agent could create one), not folders, not the roots themselves;
   - unsafe: a scan cut short, named. */
function importTargets(roots, { home, maxFiles = MAX_FILES } = {}) {
  const files = new Set();
  const unsafe = [];
  const seen = new Set();
  const key = (f) => { try { return fs.realpathSync.native(f); } catch { return path.resolve(f); } };
  let queue = [...new Set(roots.map((r) => path.resolve(r)))].map((f) => [f, 0]);
  let read = 0;
  while (queue.length) {
    const next = [];
    for (const [f, depth] of queue) {
      const k = key(f);
      if (seen.has(k)) continue;
      seen.add(k);
      if (++read > maxFiles) { unsafe.push(`the files Claude Code's instruction files import (more than ${maxFiles}), so some are not denied`); return { files: [...files], unsafe }; }
      const text = readText(f);
      if (text === null) continue;
      if (depth + 1 >= MAX_DEPTH) continue;
      for (const t of importsIn(text, f, home)) {
        let isDir = false;
        try { isDir = fs.statSync(t).isDirectory(); } catch { /* absent: still a target */ }
        if (isDir) continue;
        files.add(t);
        next.push([t, depth + 1]);
      }
    }
    queue = next;
  }
  for (const r of roots) files.delete(path.resolve(r));
  return { files: [...files], unsafe };
}

module.exports = { importTargets, importsIn, proseOf, MAX_DEPTH };
