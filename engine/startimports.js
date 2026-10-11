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
    .replace(/(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g, ' ')   // review 2: a closer is a run of the SAME length
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[*[\]]/g, ' ');
}

/* The imports in one file's text, as absolute paths, in Claude Code's rule: `@` at the start or after whitespace, then
   non-space characters (a backslash-space is a space); a # ends the path; kept when it starts ./, ~/ or / (not / alone),
   or is a bare name starting with a letter, digit, ., _ or -; resolved from the file's folder. */
function importsIn(text, file, home) {
  const out = new Set();
  const re = /(?:^|[\s_])@((?:[^\s\\]|\\ )+)/g;
  /* Review 3: the subset does not model list items, where Claude Code scans an item's RAW text (code spans and comments
     included), nor a fence that an item's end closes. So the raw text is scanned too, nothing stripped, and the union
     kept: any difference from the lexer now errs toward denying more, never less. */
  const prose = proseOf(text) + '\n' + String(text);
  /* Review 1: resolved from the folder the file REALLY is in, as Claude Code does (it parses with the resolved path).
     The folder as given too, when it differs: under a linked folder both name one file, which the agent's tools can
     write by either spelling; for a linked FILE the given one is a different file nobody loads, a harmless extra. */
  const given = path.dirname(path.resolve(file));
  let real = given;
  try { real = path.dirname(fs.realpathSync.native(file)); } catch { /* as given */ }
  // Review 3: the folder as given only when the FILE is not itself a link (then it is a different file nobody loads).
  let fileIsLink = false;
  try { fileIsLink = fs.lstatSync(file).isSymbolicLink(); } catch { fileIsLink = false; }
  const bases = real === given || fileIsLink ? [real] : [real, given];
  let m;
  while ((m = re.exec(prose)) !== null) {
    let p = m[1];
    if (m[0].startsWith('_')) p = p.replace(/_+$/, '');   // _@b.md_: the closing emphasis mark is not the path's
    const h = p.indexOf('#');
    if (h !== -1) p = p.slice(0, h);
    p = p.replaceAll('\\ ', ' ');
    if (!p) continue;
    const ok = p.startsWith('./') || p.startsWith('~/') || (p.startsWith('/') && p !== '/')
      || (!p.startsWith('@') && !/^[#%^&*()]+/.test(p) && /^[a-zA-Z0-9._-]/.test(p));
    if (!ok) continue;
    if (p.startsWith('~/')) out.add(path.join(home, p.slice(2)));
    else for (const b of bases) out.add(path.resolve(b, p));
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

module.exports = { importTargets, importsIn, proseOf, MAX_DEPTH, TEXT_EXTS };
