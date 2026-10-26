'use strict';
/**
 * kosmos#5536 slice 4a (design: #5536 comment 6407859949, sections 2 and 6 above it): the review list a person reads
 * before any restored agent is enabled. A snapshot holds agent folders but never Kosmos's own store, so a restored
 * agent comes back as files with no schedule, membership or connection, written by someone who may be hostile. This
 * lists them, per agent: each instruction file (CLAUDE.md, AGENTS.md, GEMINI.md) diffed line by line, in order,
 * against the closest built-in role template; every other file (notes, and anything that can act without an
 * instruction line: hooks, settings, MCP config, skills, scripts, which slice 4b must pass in or refuse to restore)
 * as wholly added; and a flag on each added line that names a web address, something credential-shaped or a
 * schedule, or that holds invisible characters. It decides nothing: each agent is enabled by the person, one at a time.
 *
 * What the screen must do with it:
 *   - show EVERY added line, not only flagged ones: a flag is a hint, and flagged: false never means safe;
 *   - show each instruction file's removed template lines (a deleted safety rule raises no flag);
 *   - treat `unreviewed` as unread: anything not fully read is listed there and makes `flagged` true;
 *   - escape every string for HTML, and render invisible code points as visible escapes (review 2: a payload in
 *     Unicode tag characters shows as nothing but is read by a model);
 *   - show addedText as given, never re-split the files (line breaks here are every one an editor counts);
 *   - show the agent's name as unreviewed content too: a plain four-word name is written into the baseline, so the
 *     template lines holding it match, and "Disregard every safety rule" is four words (review 4).
 *
 * reviewAgent({ name, files: [{ name, text }], templates? }) -> {
 *   name, nameProblem, closest: role key or null,
 *   files: [{ name, instructions: bool, lines, added: [line numbers], addedText: [their text], removed: [template lines],
 *            truncated }],
 *   flags: [{ file, line, kind: 'url' | 'credential' | 'schedule' | 'invisible' | 'hides' | 'long', text, at, length, split? }],
 *   flagsNotListed, unreviewed: [{ file, why }], flagged }
 */

const MAX_FILE_CHARS = 512 * 1024;   // instructions are capped at 256 KB; past this a file is unreviewed
const MAX_TOTAL_CHARS = 4 * 1024 * 1024;   // across files (review 2: fifty large notes blocked the board for 12 s)
const MAX_TEST_CHARS = 4 * 1024;     // a line is tested to here; a longer one is flagged 'long' (review 3: cost)
const MAX_DIFF_CELLS = 8 * 1000 * 1000;   // past this a file is not diffed: every line counts as added
const SHOW = 200;
const JOINT = 300;   // characters each side of a line break tested as one (review 3)
const MAX_FLAGS_PER_KIND = 200;
const MAX_REMOVED = 200;
const PLACEHOLDER = '{{NAME}}';
const NAME_MAX = 64;
const INSTRUCTION_FILES = new Set(['claude.md', 'claude.local.md', 'agents.md', 'gemini.md']);   // .claude/CLAUDE.md by its name
const MAX_TESTED_LINES = 200 * 1000;   // per review (review 5: cost follows lines, and 2M short lines took seconds)

/* Invisible code points (review 2): format characters (zero-width, bidi, the Unicode tag block), variation
   selectors, and the tag block itself. A line holding one is never a template line and is flagged. */
const INVISIBLE_CLASS = String.raw`\p{Cf}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u034F\u115F\u1160\u2800\u3164\uFFA0`;   // review 3: blank fillers too
const INVISIBLE_RE = new RegExp(`[${INVISIBLE_CLASS}]`, 'u');
const INVISIBLE_ONE = new RegExp(`^[${INVISIBLE_CLASS}]$`, 'u');
/* For the tests only: tag characters (U+E0020-E007E) are decoded to the ASCII they spell, so a hidden URL is still a
   URL; other invisible code points are dropped; NFKC folds full-width forms; defanged addresses read as real. */
function canonical(line) { return canonicalMap(line).text; }
/* The canonical text and, for each of its UTF-16 units, the index in the raw line it came from (review 3: a match's
   position was the canonical one, so zero-width padding shifted the shown window off the match). */
function canonicalMap(line) {
  let text = '';
  const map = [];
  let i = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    let out;
    if (cp >= 0xE0020 && cp <= 0xE007E) out = String.fromCharCode(cp - 0xE0000);
    else if (INVISIBLE_ONE.test(ch)) out = '';
    else out = ch.normalize('NFKC');
    for (let k = 0; k < out.length; k += 1) map.push(i);
    text += out;
    i += ch.length;
  }
  // Defanged addresses read as real ones, keeping the map in step.
  const defang = [[/hxxp/gi, 'http'], [/\[\.\]|\(\.\)|\{\.\}/g, '.'], [/\[:\]/g, ':']];
  for (const [re, to] of defang) {
    let nt = '', nm = [], last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      nt += text.slice(last, m.index); nm.push(...map.slice(last, m.index));
      const rep = m[0].toLowerCase() === 'hxxp' ? (m[0][0] === 'H' ? 'Http' : 'http') : to;
      nt += rep; for (let k = 0; k < rep.length; k += 1) nm.push(map[m.index] ?? i);
      last = m.index + m[0].length;
    }
    nt += text.slice(last); nm.push(...map.slice(last));
    text = nt; map.length = 0; map.push(...nm);
  }
  return { text, map, end: i };
}

// Endings that are mostly file extensions or words (sh, to, in, me) are left out, so deploy.sh is not an address.
const TLDS = 'com|net|org|io|dev|app|co|ai|xyz|ru|cn|info|biz|us|uk|de|fr|nl|gg|tk|top|site|online|cloud|cc|br|eu';
const URL_RE = new RegExp([
  String.raw`\b(?:https?|ftp|sftp|ssh|wss?|git|file|s3|gs):\/\/\S`,
  String.raw`\bwww\.[a-z0-9-]{1,63}\.[a-z]{2,}`,
  String.raw`\b[\w.-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}:`,
  String.raw`\b[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,6}\.(?:${TLDS})(?:\/\S*)?(?![\w.-])`,
  String.raw`\b(?:curl|wget|scp|rsync|nc|ncat|ftp)\b`,
].join('|'), 'i');
const CREDENTIAL_RE = new RegExp([
  String.raw`\b(?:api[_ -]?keys?|secrets?|tokens?|passw(?:or)?ds?|passphrases?|credentials?|private[_ -]?keys?|access[_ -]?keys?|auth[_ -]?keys?)\b\s*(?:[:=]|\b(?:is|are|in|at|=)\s+\S)`,
  String.raw`\bbearer\s+\S`,
  String.raw`-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----`,
  String.raw`\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}`,
  String.raw`\bgithub_pat_[A-Za-z0-9_]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}`,
  String.raw`\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}`,
  String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,
  String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.`,
  String.raw`~\/\.(?:ssh|aws|gnupg|netrc|docker|kube)\b`,
].join('|'), 'i');
const SCHEDULE_RE = new RegExp([
  String.raw`\b(?:cron(?:tab)?|launchd|launchctl|schtasks|systemd[- ]timer|scheduled[- ]task|at\.allow)\b`,
  String.raw`\bevery\s+(?:\d{1,4}\s+)?(?:second|minute|hour|day|night|morning|evening|afternoon|week|month|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b`,
  String.raw`\b(?:hourly|nightly)\b`,
  String.raw`\b(?:once|twice|three times)\s+(?:a|an|per|each)\s+(?:minute|hour|day|night|week|month)\b`,
  String.raw`\bon\s+(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|weekdays|weekends)\b`,
  String.raw`\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)`,
  String.raw`\bat\s+\d{1,2}:\d{2}\b`,
  String.raw`\b(?:run|send|post|upload|sync|back\s?up|email|fetch|pull|push|check|report|delete|copy|export)\w*\W+(?:\w+\W+){0,3}(?:daily|weekly|monthly)\b`,
  String.raw`\b(?:daily|weekly|monthly)\W+(?:\w+\W+){0,3}(?:run|send|post|upload|sync|back\s?up|email|fetch|pull|push|check|report|delete|copy|export)`,
].join('|'), 'i');

/* A cron expression: five fields of cron syntax, at least one with *, / or , (checked over tokens, not by regex). */
const CRON_FIELD = /^(?:\*|\d{1,2}(?:-\d{1,2})?)(?:\/\d{1,2})?(?:,(?:\*|\d{1,2}(?:-\d{1,2})?)(?:\/\d{1,2})?){0,10}$/;
function cronAt(line) {
  const toks = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line)) && toks.length < 4096) toks.push({ t: m[0], at: m.index });
  for (let i = 0; i + 5 <= toks.length; i += 1) {
    const w = toks.slice(i, i + 5);
    if (w.every((x) => CRON_FIELD.test(x.t)) && w.some((x) => /[*/,]/.test(x.t))) return w[0].at;
  }
  return -1;
}

const KINDS = [['url', URL_RE], ['credential', CREDENTIAL_RE], ['schedule', SCHEDULE_RE]];

/* Each kind a line is, with where it matched: [{ kind, at }]. Tests the first MAX_TEST_CHARS only. */
function matchesOf(line) {
  const raw = String(line).slice(0, MAX_TEST_CHARS);
  // Fast path (review 5): plain printable ASCII with nothing to decode is its own canonical form.
  const plain = /^[\x20-\x7e\t]*$/.test(raw) && !/hxxp|[\[({]/i.test(raw);
  const { text: c, map, end } = plain ? { text: raw, map: null, end: raw.length } : canonicalMap(raw);
  const back = (k) => (!map ? k : k < map.length ? map[k] : end);   // a canonical position, in the raw line
  const out = [];
  for (const [kind, re] of KINDS) {
    const m = re.exec(c);
    if (m) out.push({ kind, at: back(m.index) });
    else if (kind === 'schedule') { const at = cronAt(c); if (at >= 0) out.push({ kind, at: back(at) }); }
  }
  const inv = INVISIBLE_RE.exec(raw);
  if (inv) out.push({ kind: 'invisible', at: inv.index });
  return out;
}
const kindsOf = (line) => matchesOf(line).map((x) => x.kind);

/* A name Kosmos will write into the baseline: a strict name shape (review 3: a 63-character name holding a sentence
   passed every other check and became template text). Anything else keeps the placeholder, so every line holding it
   is added. */
const NAME_SHAPE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}' .-]{0,39}$/u;
function nameProblem(name) {
  if (typeof name !== 'string' || !name.trim()) return 'it has no name';
  if (name.length > NAME_MAX) return 'its name is too long to be a name';
  if (!NAME_SHAPE.test(name) || name.trim().split(/\s+/).length > 4 || /\.\s|\.\.|^\.|\.$/.test(name.trim())) return 'its name is not shaped like a name';
  if (/[\p{Cc}\p{Cf}\u2028\u2029\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/u.test(name)) return 'its name holds control or invisible characters';
  if (matchesOf(name).length) return 'its name looks like an address, a credential or a schedule';
  return null;
}

/* The baseline (review 2): a plain name is put straight into each template, as Kosmos would write it, so its ordinary
   words are never rewritten; a name that is not plain keeps the placeholder, and nothing is folded into it. */
function defaultTemplates(name, plain) {
  const roles = require('./roles');
  return roles.ROLES.map((r) => ({ key: r.key, text: roles.instructionsFor(r.key, plain ? name : PLACEHOLDER) || '' }));
}

// Every line break an editor counts (review 2: VS Code and git count a lone CR; U+2028 and U+2029 too).
const linesOf = (text) => String(text).split(/\r\n|\r|\n|\u2028|\u2029/);
// Compared as written, after NFKC and whitespace only: invisible characters are NOT stripped (review 2), so a line
// with any is never equal to a template line.
// Leading whitespace is kept (review 4: an indented block is code in Markdown, so an indent change must count), and
// only spaces and tabs collapse (\s would also swallow U+FEFF).
const norm = (l) => l.normalize('NFKC').replace(/[ \t]+$/, '').replace(/(\S)[ \t]+/g, '$1 ');

/* The template sharing the most lines with these, found through one index from line to templates (review 3: every
   template against every line was seconds on a large restore). Ties go to the first. */
function closestTemplate(lines, templates) {
  const index = new Map();
  const kept = [];
  templates.forEach((t) => {
    if (!t || typeof t.text !== 'string') return;
    const theirs = linesOf(t.text).map(norm).filter(Boolean);
    const ti = kept.push({ key: t.key, lines: theirs }) - 1;
    for (const l of new Set(theirs)) { if (!index.has(l)) index.set(l, []); index.get(l).push(ti); }
  });
  const counts = new Uint32Array(kept.length);
  for (const l of new Set(lines.filter(Boolean))) for (const ti of index.get(l) || []) counts[ti] += 1;
  let best = -1;
  counts.forEach((n, ti) => { if (n > 0 && (best < 0 || n > counts[best])) best = ti; });
  return best < 0 ? null : kept[best];
}

/* A line that can make what follows it stop being instructions in Markdown or HTML: a fence, a comment, or a block
   whose content is not rendered as text (review 4: a parser of these regions kept falling out of step with Markdown,
   so there is no parser: see the rule where it is used). */
// Review 5: not a list of tag names (any element can be hidden, <div hidden>, and <? <![CDATA[ <!x <svg> all hide
// what follows), but any tag-like '<' at all, plus a link reference definition opening a title. Only ADDED lines
// count: the templates' own '<name>' placeholders are matched lines, so a clean restore never trips it. A member
// who adds a line with a placeholder makes everything after it count as removed: noisy, never unsafe.
const HIDE_RE = /```|~~~|-->|<[A-Za-z!?\/]|^\s{0,3}\[[^\]]+\]:\s*\S*\s*["'(]/;

/* The longest common subsequence of a file's non-blank lines and the template's, IN ORDER (review 2: a set let a
   reordered template, or a rule moved to another file, review clean). Returns which file lines (by index) are matched
   and which template lines are. Past MAX_DIFF_CELLS, nothing matches: every line is added (the safe direction). */
function align(fileLines, tpl) {
  const idx = [];
  fileLines.forEach((l, i) => { if (l) idx.push(i); });
  const a = idx.map((i) => fileLines[i]);
  const n = a.length, m = tpl.length;
  const matchedFile = new Set(), matchedTpl = new Set();
  const pairs = [];
  if (!n || !m || n * m > MAX_DIFF_CELLS) return { matchedFile, matchedTpl, pairs, diffed: !(n * m > MAX_DIFF_CELLS) };
  // Lengths of LCS suffixes, one row per file line (Uint32, so 8M cells is 32 MB at most).
  const W = m + 1;
  const L = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      L[i * W + j] = a[i] === tpl[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === tpl[j]) { matchedFile.add(idx[i]); matchedTpl.add(j); pairs.push([idx[i], j]); i += 1; j += 1; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i += 1;
    else j += 1;
  }
  return { matchedFile, matchedTpl, pairs, diffed: true };
}

function shown(line, at) {
  const from = Math.max(0, at - SHOW), to = Math.min(line.length, at + SHOW);
  return `${from > 0 ? '...' : ''}${line.slice(from, to)}${to < line.length ? '...' : ''}`;
}

function reviewAgent({ name, files, templates } = {}) {
  const shownName = typeof name === 'string' ? name.slice(0, 200) : '';
  const badName = nameProblem(name);
  const tpl = Array.isArray(templates) ? templates : defaultTemplates(name, !badName);
  const unreviewed = [];
  const read = [];
  let budget = MAX_TOTAL_CHARS;
  // Instruction files are read first (review 3: notes listed ahead of CLAUDE.md spent the budget on it), then the
  // order the caller gave is put back.
  const given = (Array.isArray(files) ? files : []).map((f, order) => ({ f, order }));
  const isInstr = (f) => !!f && typeof f === 'object' && typeof f.name === 'string' && INSTRUCTION_FILES.has(f.name.split(/[\\/]/).pop().toLowerCase());
  given.sort((x, y) => (isInstr(y.f) - isInstr(x.f)) || (x.order - y.order));
  for (const { f, order } of given) {
    // Nothing handed in disappears without a trace (review 2).
    if (!f || typeof f !== 'object') { unreviewed.push({ file: '(unnamed)', why: 'it is not a file' }); continue; }
    const fname = typeof f.name === 'string' ? f.name : '(unnamed)';
    if (typeof f.text !== 'string') { unreviewed.push({ file: fname, why: 'it is not text, so it was not read' }); continue; }
    if (budget <= 0) { unreviewed.push({ file: fname, why: 'the review had already read as much as it reads' }); continue; }
    const limit = Math.min(MAX_FILE_CHARS, budget);
    const truncated = f.text.length > limit;
    let text = truncated ? f.text.slice(0, limit) : f.text;
    if (truncated && /[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
    budget -= text.length;
    if (truncated) unreviewed.push({ file: fname, why: `only its first ${Math.floor(limit / 1024)} KB were read` });
    const base = fname.split(/[\\/]/).pop().toLowerCase();
    read.push({ name: fname, raw: linesOf(text), truncated, instructions: INSTRUCTION_FILES.has(base), order });
  }
  read.sort((x, y) => x.order - y.order);
  for (const f of read) f.normed = f.raw.map(norm);
  // The closest template, from the instruction files only (notes are never matched against a template).
  const closest = closestTemplate(read.filter((f) => f.instructions).flatMap((f) => f.normed), tpl);
  const counts = { url: 0, credential: 0, schedule: 0, invisible: 0, long: 0, hides: 0 };
  const flags = [];
  let flagsNotListed = 0;
  const flag = (x) => {
    if (counts[x.kind] >= MAX_FLAGS_PER_KIND) { flagsNotListed += 1; return; }
    counts[x.kind] += 1;
    flags.push(x);
  };
  let tested = 0;
  const untested = new Set();
  const out = read.map((f) => {
    const al = f.instructions && closest ? align(f.normed, closest.lines) : { matchedFile: new Set(), matchedTpl: new Set(), pairs: [], diffed: false };
    // After the first ADDED line with a hiding marker, every template line further down counts as removed (review
    // 4): it may no longer be read as an instruction, and telling which it is would need a Markdown parser that a
    // hostile file could again fall out of step with. Noisy for a member who added one (rare), never unsafe. A
    // template's own fence is a matched line, so it never starts this.
    if (f.instructions && al.pairs.length) {
      const firstHide = f.raw.findIndex((l, i) => !al.matchedFile.has(i) && HIDE_RE.test(l));
      if (firstHide >= 0) for (const [fi, tj] of al.pairs) if (fi > firstHide) { al.matchedFile.delete(fi); al.matchedTpl.delete(tj); }
    }
    if (f.instructions && closest && !al.diffed) unreviewed.push({ file: f.name, why: 'it is too long to compare with its template, so every line counts as added' });
    const added = [];
    // Each line is matched once (review 3: alone, as a neighbour and joined was three times the work).
    const cache = new Map();
    const matches = (i) => { if (!cache.has(i)) cache.set(i, matchesOf(f.raw[i])); return cache.get(i); };
    const isAdded = (i) => (f.raw[i].trim() || INVISIBLE_RE.test(f.raw[i])) && !al.matchedFile.has(i);
    f.raw.forEach((line, i) => {
      if (!isAdded(i)) return;
      added.push(i + 1);
      // Past the per-review line budget, an added line is listed but not tested, and the file is unreviewed.
      if (tested >= MAX_TESTED_LINES) {
        if (!untested.has(f.name)) { untested.add(f.name); unreviewed.push({ file: f.name, why: 'it has more lines than the review tests, so the rest were listed but not checked' }); }
        return;
      }
      tested += 1;
      if (line.length > MAX_TEST_CHARS) flag({ file: f.name, line: i + 1, kind: 'long', text: shown(line, 0), at: 0, length: line.length });
      const hm = HIDE_RE.exec(line);
      if (hm) flag({ file: f.name, line: i + 1, kind: 'hides', text: shown(line, hm.index), at: hm.index, length: line.length });
      const here = matches(i);
      for (const m of here) flag({ file: f.name, line: i + 1, kind: m.kind, text: shown(line, m.at), at: m.at, length: line.length });
      // An instruction split over two lines: only the joint is tested (the end of this line, the start of the next).
      const next = f.raw[i + 1];
      // Only between two lines with something to split (review 5: one-character lines doubled the cost).
      if (typeof next === 'string' && next.trim().length >= 3 && line.trim().length >= 3) {
        const alone = new Set([...here.map((m) => m.kind), ...(isAdded(i + 1) ? matches(i + 1) : matchesOf(next)).map((m) => m.kind)]);
        const joint = `${line.slice(-JOINT)} ${next.slice(0, JOINT)}`;
        for (const m of matchesOf(joint)) {
          if (!alone.has(m.kind)) flag({ file: f.name, line: i + 1, kind: m.kind, text: shown(joint, m.at), at: m.at, length: line.length, split: true });
        }
      }
    });
    // Removed, per instruction file (review 2: a rule moved into a notes file is still gone from the instructions).
    const removed = f.instructions && closest ? closest.lines.filter((_, j) => !al.matchedTpl.has(j)) : [];
    // The added lines' own text too (review 4), so a screen never re-splits the file its own way and numbers drift.
    const addedText = added.map((n) => f.raw[n - 1]);
    return { name: f.name, instructions: f.instructions, lines: f.raw.length, added, addedText, removed: removed.slice(0, MAX_REMOVED), removedNotListed: Math.max(0, removed.length - MAX_REMOVED), truncated: f.truncated };
  });
  return {
    name: shownName, nameProblem: badName, closest: closest ? closest.key : null, files: out,
    flags, flagsNotListed, unreviewed,
    // A removed template line counts too: a deleted safety rule is something to look at, not a clean file.
    flagged: flags.length > 0 || flagsNotListed > 0 || unreviewed.length > 0 || !!badName || out.some((f) => f.removed.length > 0),
  };
}

module.exports = { reviewAgent, kindsOf };
