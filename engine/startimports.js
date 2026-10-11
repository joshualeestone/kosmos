'use strict';
/* #5774 route 3: the files Claude Code's instruction files pull in with an `@path` import. Claude Code reads an
   imported file as instructions at every start, and it can sit anywhere, so a token-only agent's file tools could
   rewrite what every session importing it is told. This follows the imports the way Claude Code 2.1.296 does
   (measured from its own bundle) and returns the files to deny; engine/setup-assistant.js denies them. */
const fs = require('fs');
const path = require('path');

const MAX_DEPTH = 5;   // Claude Code loads the importing file at depth 0 and refuses depth 5
const MAX_BYTES = 4194304;   // Claude Code's own limit: a larger instruction file is skipped, so are its imports (review 1)
const MAX_FILES = 2000;   // files READ in all (absent roots do not count, review 1); a scan cut short is named
/* Review 1: Claude Code skips an import whose extension is not one of its text extensions (it logs "Skipping non-text
   file in @include"): such a file is not read as instructions, so it is not a target. No extension is read. Compared
   lowercased, as 2.1.296 does (so its ".R" entry is the same as ".r"). */
const TEXT_EXTS = new Set(['.md', '.txt', '.text', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.html', '.htm', '.css', '.scss',
  '.sass', '.less', '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.pyi', '.pyw', '.rb', '.erb', '.rake', '.go', '.rs',
  '.java', '.kt', '.kts', '.scala', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.cs', '.swift', '.sh', '.bash', '.zsh', '.fish',
  '.ps1', '.bat', '.cmd', '.env', '.ini', '.cfg', '.conf', '.config', '.properties', '.sql', '.graphql', '.gql', '.proto', '.vue',
  '.svelte', '.astro', '.ejs', '.hbs', '.pug', '.jade', '.php', '.pl', '.pm', '.lua', '.r', '.dart', '.ex', '.exs', '.erl', '.hrl',
  '.clj', '.cljs', '.cljc', '.edn', '.hs', '.lhs', '.elm', '.ml', '.mli', '.f', '.f90', '.f95', '.for', '.cmake', '.make', '.makefile',
  '.gradle', '.sbt', '.rst', '.adoc', '.asciidoc', '.org', '.tex', '.latex', '.lock', '.log', '.diff', '.patch']);
const isText = (p) => { const e = path.extname(p).toLowerCase(); return !e || TEXT_EXTS.has(e); };

/* A regular file's text, or null (absent, a folder, a FIFO, unreadable). */
function readText(f) {
  try {
    const st = fs.statSync(f);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return fs.readFileSync(f, 'utf8');
  } catch { return null; }
}

/* The text Claude Code scans for imports: markdown with its code left out. Claude Code lexes the file (marked, gfm off)
   and skips code and code-span tokens, and strips HTML comments. Here: fenced code blocks, inline code spans and HTML
   comments are removed. Indented code is NOT removed, so an import-like word there is still read: the safe direction.
   Review 1: a code span never crosses a blank line (a stray backtick swallowed paragraphs), and spans go before
   comments (a `<!--` inside a span opened a comment). Emphasis and link marks are token edges in the lexer, so
   `**@a.md**` and `[@c.md](u)` are imports: * [ ] become spaces here, and a _ before the @ is an edge (importsIn). */
function proseOf(text) {
  const out = [];
  let fence = null, fenceIndent = 0;
  for (const line of String(text).split('\n')) {
    const m = /^( {0,3})(`{3,}|~{3,})/.exec(line);
    if (fence) {
      /* Review 7: a fence opened INDENTED (inside a list item) ends with its item, at the first non-blank line indented
         less than the fence: an unclosed one there no longer hides the rest of the file. */
      const lead = /^ */.exec(line)[0].length;
      if (fenceIndent > 0 && /\S/.test(line) && lead < fenceIndent) fence = null;
      else {
        if (m && m[2][0] === fence[0] && m[2].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
        out.push('');
        continue;
      }
    }
    if (m && !(m[2][0] === '`' && line.slice(line.indexOf(m[2]) + m[2].length).includes('`'))) { fence = m[2]; fenceIndent = m[1].length; out.push(''); continue; }
    out.push(line);
  }
  return stripComments(stripCodeSpans(out.join('\n'))).replace(/[*[\]]/g, ' ');
}
/* Review 5: both strips are LINEAR. The text is the agent's to write (its own instruction files are roots), and the
   regex forms were quadratic on an unclosed `<!--` repeated, or on backtick runs of many lengths: enough to stall the
   guard for every agent. A code span: a backtick run closed by the next run of the SAME length in the same paragraph
   (review 2), with nothing between a blank line. */
function stripCodeSpans(t) {
  const runs = [];   // [start, length, paragraph]
  let para = 0;
  for (let i = 0; i < t.length;) {
    if (t[i] === '\n') {
      let j = i + 1;
      while (j < t.length && (t[j] === ' ' || t[j] === '\t')) j++;
      if (t[j] === '\n') para++;
      i++;
    } else if (t[i] === '`') {
      // Review 9: a backtick after an odd number of backslashes is escaped: literal text, not a span edge.
      let bs = 0;
      for (let b = i - 1; b >= 0 && t[b] === '\\'; b--) bs++;
      if (bs % 2 === 1) { i++; continue; }
      let j = i;
      while (j < t.length && t[j] === '`') j++;
      runs.push([i, j - i, para]);
      i = j;
    } else i++;
  }
  const byLen = new Map();
  runs.forEach((r, k) => { if (!byLen.has(r[1])) byLen.set(r[1], []); byLen.get(r[1]).push(k); });
  const next = new Map();   // per length, how far its list has been consumed
  const cut = [];
  for (let k = 0; k < runs.length; k++) {
    const [start, len, para0] = runs[k];
    const list = byLen.get(len);
    let q = next.get(len) || 0;
    while (q < list.length && list[q] <= k) q++;
    next.set(len, q);
    if (q < list.length && runs[list[q]][2] === para0) {
      const close = runs[list[q]];
      cut.push([start, close[0] + close[1]]);
      const end = list[q];
      while (k < end) k++;   // the runs inside the span are its text
      next.set(len, q + 1);
    }
  }
  if (!cut.length) return t;
  let out = '', at = 0;
  for (const [a, b] of cut) { out += t.slice(at, a) + ' '; at = b; }
  return out + t.slice(at);
}
function stripComments(t) {
  let out = '', at = 0;
  for (;;) {
    const a = t.indexOf('<!--', at);
    if (a === -1) break;
    const b = t.indexOf('-->', a + 4);
    if (b === -1) break;   // unclosed: the rest stays text
    out += t.slice(at, a) + ' ';
    at = b + 3;
  }
  return out + t.slice(at);
}

/* Review 7: the text Claude Code's RAW pass sees: list items only (marked hands an item's content on as raw text). A
   list runs from a list marker (- * + or 1. 1), at most 3 spaces in) until a blank line followed by an unindented line,
   or a fence at column 0, which ends it; everything else is blanked. Lines inside a list stay, its fences included.
   Linear. A shape this misses as a list (an unusual marker) is still read by the token pass, so only a code span or
   comment inside such an item could be missed. */
function listText(text) {
  const out = [];
  let inList = false, prevBlank = false, fence = null;
  for (const line of String(text).split('\n')) {
    const blank = /^\s*$/.test(line);
    /* Review 9: a fenced block OUTSIDE a list is code, whatever its lines look like (`- @docs/x.md` in an example). */
    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!inList && fence) { if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null; out.push(''); prevBlank = blank; continue; }
    if (!inList && fm) { fence = fm[1]; out.push(''); prevBlank = blank; continue; }
    if (/^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/.test(line)) inList = true;
    else if (inList && !blank && !/^\s/.test(line) && (prevBlank || /^(?:`{3,}|~{3,})/.test(line))) inList = false;
    out.push(inList ? line : '');
    prevBlank = blank;
  }
  return out.join('\n');
}
/* The imports in one file's text, as absolute paths, in Claude Code's rule: `@` at the start or after whitespace, then
   non-space characters (a backslash-space is a space); a # ends the path; kept when it starts ./, ~/ or / (not / alone),
   or is a bare name starting with a letter, digit, ., _ or -; resolved from the file's folder. */
function importsIn(text, file, home) {
  const out = new Set();
  /* Claude Code makes two passes. The characters allowed before the @ are matched exactly in each; where each pass runs
     is approximated as stated:
     - Review 3: a list item's RAW text (code spans and comments included) with its own pattern, (?:^|\s)@: whitespace
       only. Review 7: only list text is scanned this way (listText); scanning the whole raw file turned a fenced example
       (`npx tsx @src/index.ts`) into a name denied in every agent's folder.
     - Review 5: each marked TEXT token, which can START at an @ just after another token ends: inline HTML or an
       autolink (>), a link or image ()), an emphasis mark (* _), a closing code span (stripped to a space here), or an
       escaped character (\#). Review 6: those edges only, not any punctuation: in "a/@b" or "https://x.com/@u" the @ is
       inside one text token (marked's text breaks before \ < ! [ ` * _ and merges neighbours), so it is not an import.
     An e-mail address (a letter before the @) is neither. */
  const raw = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
  const tok = /(?:^|[\s>)_]|\\.)@((?:[^\s\\]|\\ )+)/g;   // * is already a space (proseOf)
  /* Review 1: resolved from the folder the file REALLY is in, as Claude Code does (it parses with the resolved path).
     The folder as given too, when only a FOLDER on the way is linked: both name one file, which the agent's tools can
     write by either spelling. */
  const given = path.dirname(path.resolve(file));
  let real = given;
  try { real = path.dirname(fs.realpathSync.native(file)); } catch { /* as given */ }
  // Review 3: the folder as given only when the FILE is not itself a link (then it is a different file nobody loads).
  let fileIsLink = false;
  try { fileIsLink = fs.lstatSync(file).isSymbolicLink(); } catch { fileIsLink = false; }
  const bases = real === given || fileIsLink ? [real] : [real, given];
  const addPath = (raw) => {
    let p = raw;
    const h = p.indexOf('#');
    if (h !== -1) p = p.slice(0, h);
    p = p.replaceAll('\\ ', ' ');
    if (!p) return;
    // Review 9: a path whose last part is empty, . or .. names a folder, which Claude Code never loads as a file; proseOf's
    // star-to-space also makes one from `@lib/*` or `@conf/.*`, which would be a rule over the whole folder.
    const last = p.split('/').pop();
    if (last === '' || last === '.' || last === '..') return;   // `lib/`, `conf/.` (from `@conf/.*`), `..`: a folder
    const ok = p.startsWith('./') || p.startsWith('~/') || (p.startsWith('/') && p !== '/')
      || (!p.startsWith('@') && !/^[#%^&*()]+/.test(p) && /^[a-zA-Z0-9._-]/.test(p));
    if (!ok) return;
    if (p.startsWith('~/')) out.add(path.join(home, p.slice(2)));
    else for (const b of bases) out.add(path.resolve(b, p));
  };
  const found = [];
  let m;
  const text0 = String(text);
  const listed = listText(text0);
  while ((m = raw.exec(listed)) !== null) found.push(m[1]);
  const prose = proseOf(text0);
  while ((m = tok.exec(prose)) !== null) found.push(m[1]);
  for (const p of found) {
    addPath(p);
    /* Review 5: Claude Code's text token also ENDS at the next token, so the path stops there: at inline HTML or an
       autolink (<), a code span (`), a link or image ([ ] !), or a closing emphasis mark (**@a.md**, _@b.md_). Each such
       shorter path is added too. */
    const cut = p.search(/[<`[\]!]/);
    if (cut > 0) addPath(p.slice(0, cut));
    const bare = p.replace(/[_*]+$/, '');
    if (bare && bare !== p) addPath(bare);
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
      const text = readText(f);
      if (text === null) continue;
      if (++read > maxFiles) { unsafe.push(`the files Claude Code's instruction files import (more than ${maxFiles}), so some are not denied`); return { files: [...files], unsafe }; }
      if (depth + 1 >= MAX_DEPTH) continue;
      for (const t of importsIn(text, f, home)) {
        let isDir = false;
        try { isDir = fs.statSync(t).isDirectory(); } catch { /* absent: still a target */ }
        if (isDir || !isText(t)) continue;
        files.add(t);
        next.push([t, depth + 1]);
      }
    }
    queue = next;
  }
  const rootKeys = new Set(roots.map(key));
  return { files: [...files].filter((f) => !rootKeys.has(key(f))), unsafe };
}

module.exports = { importTargets, importsIn, proseOf, listText, MAX_DEPTH, TEXT_EXTS };
