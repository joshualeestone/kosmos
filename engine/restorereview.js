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
 *     Unicode tag characters shows as nothing but is read by a model).
 *
 * reviewAgent({ name, files: [{ name, text }], templates? }) -> {
 *   name, nameProblem, closest: role key or null,
 *   files: [{ name, instructions: bool, lines, added: [line numbers], removed: [template lines], truncated }],
 *   flags: [{ file, line, kind: 'url' | 'credential' | 'schedule' | 'invisible' | 'long', text, at, length, split? }],
 *   flagsNotListed, unreviewed: [{ file, why }], flagged }
 */

const MAX_FILE_CHARS = 512 * 1024;   // instructions are capped at 256 KB; past this a file is unreviewed
const MAX_TOTAL_CHARS = 4 * 1024 * 1024;   // across files (review 2: fifty large notes blocked the board for 12 s)
const MAX_TEST_CHARS = 8 * 1024;     // a line is tested to here; a longer one is flagged 'long'
const MAX_DIFF_CELLS = 8 * 1000 * 1000;   // past this a file is not diffed: every line counts as added
const SHOW = 200;
const MAX_FLAGS_PER_KIND = 200;
const MAX_REMOVED = 200;
const PLACEHOLDER = '{{NAME}}';
const NAME_MAX = 64;
const INSTRUCTION_FILES = new Set(['claude.md', 'agents.md', 'gemini.md']);

/* Invisible code points (review 2): format characters (zero-width, bidi, the Unicode tag block), variation
   selectors, and the tag block itself. A line holding one is never a template line and is flagged. */
const INVISIBLE_RE = /[\p{Cf}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/u;
/* For the tests only: tag characters (U+E0020-E007E) are decoded to the ASCII they spell, so a hidden URL is still a
   URL; other invisible code points are dropped; NFKC folds full-width forms; defanged addresses read as real. */
function canonical(line) {
  return line.replace(/[\u{E0020}-\u{E007E}]/gu, (c) => String.fromCharCode(c.codePointAt(0) - 0xE0000))
    .normalize('NFKC').replace(/[\p{Cf}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu, '')
    .replace(/\bhxxp/gi, 'http').replace(/\[\.\]|\(\.\)|\{\.\}/g, '.').replace(/\[:\]/g, ':');
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
  const c = canonical(raw);
  const out = [];
  for (const [kind, re] of KINDS) {
    const m = re.exec(c);
    if (m) out.push({ kind, at: m.index });
    else if (kind === 'schedule') { const at = cronAt(c); if (at >= 0) out.push({ kind, at }); }
  }
  const inv = INVISIBLE_RE.exec(raw);
  if (inv) out.push({ kind: 'invisible', at: inv.index });
  return out;
}
const kindsOf = (line) => matchesOf(line).map((x) => x.kind);

function nameProblem(name) {
  if (typeof name !== 'string' || !name.trim()) return 'it has no name';
  if (name.length > NAME_MAX) return 'its name is too long to be a name';
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
const norm = (l) => l.normalize('NFKC').trim().replace(/\s+/g, ' ');

function closestTemplate(lines, templates) {
  const mine = new Set(lines.filter(Boolean));
  let best = null, bestCount = 0;
  for (const t of templates) {
    if (!t || typeof t.text !== 'string') continue;
    const theirs = linesOf(t.text).map(norm).filter(Boolean);
    const set = new Set(theirs);
    let n = 0;
    for (const l of mine) if (set.has(l)) n += 1;
    if (n > bestCount) { best = { key: t.key, lines: theirs }; bestCount = n; }
  }
  return best;
}

/* The longest common subsequence of a file's non-blank lines and the template's, IN ORDER (review 2: a set let a
   reordered template, or a rule moved to another file, review clean). Returns which file lines (by index) are matched
   and which template lines are. Past MAX_DIFF_CELLS, nothing matches: every line is added (the safe direction). */
function align(fileLines, tpl) {
  const idx = [];
  fileLines.forEach((l, i) => { if (l) idx.push(i); });
  const a = idx.map((i) => fileLines[i]);
  const n = a.length, m = tpl.length;
  const matchedFile = new Set(), matchedTpl = new Set();
  if (!n || !m || n * m > MAX_DIFF_CELLS) return { matchedFile, matchedTpl, diffed: !(n * m > MAX_DIFF_CELLS) };
  // Lengths of LCS suffixes, one row per file line (Uint32, so 8M cells is 32 MB at most).
  const W = m + 1;
  const L = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      L[i * W + j] = a[i] === tpl[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === tpl[j]) { matchedFile.add(idx[i]); matchedTpl.add(j); i += 1; j += 1; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i += 1;
    else j += 1;
  }
  return { matchedFile, matchedTpl, diffed: true };
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
  for (const f of Array.isArray(files) ? files : []) {
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
    read.push({ name: fname, raw: linesOf(text), truncated, instructions: INSTRUCTION_FILES.has(base) });
  }
  for (const f of read) f.normed = f.raw.map(norm);
  // The closest template, from the instruction files only (notes are never matched against a template).
  const closest = closestTemplate(read.filter((f) => f.instructions).flatMap((f) => f.normed), tpl);
  const counts = { url: 0, credential: 0, schedule: 0, invisible: 0, long: 0 };
  const flags = [];
  let flagsNotListed = 0;
  const flag = (x) => {
    if (counts[x.kind] >= MAX_FLAGS_PER_KIND) { flagsNotListed += 1; return; }
    counts[x.kind] += 1;
    flags.push(x);
  };
  const out = read.map((f) => {
    const al = f.instructions && closest ? align(f.normed, closest.lines) : { matchedFile: new Set(), matchedTpl: new Set(), diffed: false };
    if (f.instructions && closest && !al.diffed) unreviewed.push({ file: f.name, why: 'it is too long to compare with its template, so every line counts as added' });
    const added = [];
    f.raw.forEach((line, i) => {
      if (!line.trim() && !INVISIBLE_RE.test(line)) return;
      if (al.matchedFile.has(i)) return;
      added.push(i + 1);
      if (line.length > MAX_TEST_CHARS) flag({ file: f.name, line: i + 1, kind: 'long', text: shown(line, 0), at: 0, length: line.length });
      const here = matchesOf(line);
      for (const m of here) flag({ file: f.name, line: i + 1, kind: m.kind, text: shown(line, m.at), at: m.at, length: line.length });
      const next = f.raw[i + 1];
      if (typeof next === 'string' && next.trim()) {
        const alone = new Set([...here.map((m) => m.kind), ...kindsOf(next)]);
        for (const m of matchesOf(`${line} ${next}`)) {
          if (!alone.has(m.kind)) flag({ file: f.name, line: i + 1, kind: m.kind, text: shown(`${line} ${next}`, m.at), at: m.at, length: line.length, split: true });
        }
      }
    });
    // Removed, per instruction file (review 2: a rule moved into a notes file is still gone from the instructions).
    const removed = f.instructions && closest ? closest.lines.filter((_, j) => !al.matchedTpl.has(j)) : [];
    return { name: f.name, instructions: f.instructions, lines: f.raw.length, added, removed: removed.slice(0, MAX_REMOVED), removedNotListed: Math.max(0, removed.length - MAX_REMOVED), truncated: f.truncated };
  });
  return {
    name: shownName, nameProblem: badName, closest: closest ? closest.key : null, files: out,
    flags, flagsNotListed, unreviewed,
    // A removed template line counts too: a deleted safety rule is something to look at, not a clean file.
    flagged: flags.length > 0 || flagsNotListed > 0 || unreviewed.length > 0 || !!badName || out.some((f) => f.removed.length > 0),
  };
}

module.exports = { reviewAgent, kindsOf };
