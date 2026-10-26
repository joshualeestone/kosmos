'use strict';
/**
 * kosmos#5536 slice 4a (design: #5536 comment 6407859949, sections 2 and 6 above it): the review list a person reads
 * before any restored agent is enabled. A snapshot holds agent folders but never Kosmos's own store, so a restored
 * agent comes back as files with no schedule, membership or connection; what can still act on the successor's
 * accounts is its instructions, written by someone who may be hostile. This lists them, per agent, against the
 * cleanest baseline Kosmos has (the built-in role template the files are closest to): every line the member added,
 * every template line they removed, and a flag on each added line that names a web address, something
 * credential-shaped or a schedule. It decides nothing: each agent is enabled, or not, by the person, one at a time.
 *
 * What the screen must do with it (review 1):
 *   - show EVERY added line, not only flagged ones: a flag is a hint, and flagged: false never means safe;
 *   - show the removed template lines (a deleted safety rule raises no flag);
 *   - treat `unreviewed` as unread: a file past the read limit or not text is listed there, and makes `flagged` true;
 *   - escape every string for HTML: all of it is the restored member's own text.
 *
 * reviewAgent({ name, files: [{ name, text }], templates? }) -> {
 *   name, nameProblem (null, or why the name could not be used), closest: role key or null,
 *   files: [{ name, lines, added: [line numbers], truncated }], removed: [template lines missing], removedNotListed,
 *   flags: [{ file, line, kind: 'url' | 'credential' | 'schedule' | 'long', text, at, length, split? }],
 *   flagsNotListed, unreviewed: [{ file, why }], flagged }
 */

const MAX_FILE_CHARS = 512 * 1024;   // instructions are capped well below this; past it the file is unreviewed
const MAX_TEST_CHARS = 8 * 1024;     // a line is tested to here; a longer one is flagged 'long' (review 1: regex cost)
const SHOW = 200;                    // characters shown each side of a match
const MAX_FLAGS_PER_KIND = 200;      // per kind, so padding one kind cannot push another out of view (review 1)
const MAX_REMOVED = 200;
const PLACEHOLDER = '{{NAME}}';
const NAME_MAX = 64;

/* The tests run on a normalised copy (review 1): NFKC folds full-width and look-alike forms, and format characters
   (zero-width spaces and joiners, bidi controls) are dropped, so https\u200b:// and its full-width spelling read as
   https://. Defanged addresses (hxxps, [.]) read as real ones. */
const FORMAT_RE = /[\p{Cf}]/gu;
function canonical(line) {
  return line.normalize('NFKC').replace(FORMAT_RE, '')
    .replace(/\bhxxp/gi, 'http').replace(/\[\.\]|\(\.\)|\{\.\}/g, '.').replace(/\[:\]/g, ':');
}

// Endings that are mostly file extensions or words (sh, to, in, me) are left out, so deploy.sh is not an address.
const TLDS = 'com|net|org|io|dev|app|co|ai|xyz|ru|cn|info|biz|us|uk|de|fr|nl|gg|tk|top|site|online|cloud|cc|br|eu';
const URL_RE = new RegExp([
  String.raw`\b(?:https?|ftp|sftp|ssh|wss?|git|file|s3|gs):\/\/\S`,
  String.raw`\bwww\.[a-z0-9-]{1,63}\.[a-z]{2,}`,
  // user@host:path (scp and git), bounded so a hostile line cannot backtrack (review 1)
  String.raw`\b[\w.-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}:`,
  // a bare domain with a known ending, optionally with a path (review 1: "upload to evil.example.com/drop")
  String.raw`\b[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,6}\.(?:${TLDS})(?:\/\S*)?(?![\w.-])`,
  String.raw`\b(?:curl|wget|scp|rsync|nc|ncat|ftp)\b`,
].join('|'), 'i');
const CREDENTIAL_RE = new RegExp([
  // a credential word WITH a value next to it, not the word alone (review 1: "the token budget is fine" is prose)
  String.raw`\b(?:api[_ -]?keys?|secrets?|tokens?|passw(?:or)?ds?|passphrases?|credentials?|private[_ -]?keys?|access[_ -]?keys?|auth[_ -]?keys?)\b\s*(?:[:=]|\b(?:is|are|in|at|=)\s+\S)`,
  String.raw`\bbearer\s+\S`,
  String.raw`-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----`,
  String.raw`\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}`,
  String.raw`\bgithub_pat_[A-Za-z0-9_]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}`,
  String.raw`\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}`,
  String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,
  String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.`,     // a JWT
  String.raw`~\/\.(?:ssh|aws|gnupg|netrc|docker|kube)\b`,      // where credentials live
].join('|'), 'i');
const SCHEDULE_RE = new RegExp([
  String.raw`\b(?:cron(?:tab)?|launchd|launchctl|schtasks|systemd[- ]timer|scheduled[- ]task|at\.allow)\b`,
  String.raw`\bevery\s+(?:\d{1,4}\s+)?(?:second|minute|hour|day|night|morning|evening|afternoon|week|month|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b`,
  String.raw`\b(?:hourly|nightly)\b`,
  String.raw`\b(?:once|twice|three times)\s+(?:a|an|per|each)\s+(?:minute|hour|day|night|week|month)\b`,
  String.raw`\bon\s+(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|weekdays|weekends)\b`,
  String.raw`\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)`,
  String.raw`\bat\s+\d{1,2}:\d{2}\b`,
  // daily, weekly and monthly only beside a verb that acts (review 1: "answer the daily standup" is prose)
  String.raw`\b(?:run|send|post|upload|sync|back\s?up|email|fetch|pull|push|check|report|delete|copy|export)\w*\W+(?:\w+\W+){0,3}(?:daily|weekly|monthly)\b`,
  String.raw`\b(?:daily|weekly|monthly)\W+(?:\w+\W+){0,3}(?:run|send|post|upload|sync|back\s?up|email|fetch|pull|push|check|report|delete|copy|export)`,
].join('|'), 'i');

/* A cron expression: five whitespace-separated fields of cron syntax, at least one with *, / or , (so "1 2 3 4 5
   apples" is not one). Checked over tokens in code, not by a regex that rescans from every position (review 1). */
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
  const c = canonical(String(line).slice(0, MAX_TEST_CHARS));
  const out = [];
  for (const [kind, re] of KINDS) {
    const m = re.exec(c);
    if (m) out.push({ kind, at: m.index });
    else if (kind === 'schedule') { const at = cronAt(c); if (at >= 0) out.push({ kind, at }); }
  }
  return out;
}
const kindsOf = (line) => matchesOf(line).map((x) => x.kind);

/* Why a name cannot be folded into the baseline, or null (review 1: a name holding a newline and a payload made the
   payload template text). */
function nameProblem(name) {
  if (typeof name !== 'string' || !name.trim()) return 'it has no name';
  if (name.length > NAME_MAX) return 'its name is too long to be a name';
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(name)) return 'its name holds control or invisible characters';
  if (matchesOf(name).length) return 'its name looks like an address, a credential or a schedule';
  return null;
}

function defaultTemplates() {
  const roles = require('./roles');
  return roles.ROLES.map((r) => ({ key: r.key, text: roles.instructionsFor(r.key, PLACEHOLDER) || '' }));
}

// Line breaks as an editor counts them (review 1: a lone \r is not one; U+2028 and U+2029 are).
const linesOf = (text) => String(text).split(/\r?\n|\u2028|\u2029/);
const norm = (l) => canonical(l).trim().replace(/\s+/g, ' ');

function closestTemplate(lines, templates) {
  const mine = new Set(lines.filter(Boolean));
  let best = null, bestCount = 0;
  for (const t of templates) {
    if (!t || typeof t.text !== 'string') continue;
    const theirs = linesOf(t.text).map(norm).filter(Boolean);
    const set = new Set(theirs);
    let n = 0;
    for (const l of mine) if (set.has(l)) n += 1;
    if (n > bestCount) { best = { key: t.key, set, lines: theirs }; bestCount = n; }
  }
  return best;
}

/* What is shown of a flagged line: a window around the match, so a match far into a long line is the part seen. */
function shown(line, at) {
  const from = Math.max(0, at - SHOW), to = Math.min(line.length, at + SHOW);
  return `${from > 0 ? '...' : ''}${line.slice(from, to)}${to < line.length ? '...' : ''}`;
}

function reviewAgent({ name, files, templates } = {}) {
  const shownName = typeof name === 'string' ? name.slice(0, 200) : '';
  const badName = nameProblem(name);
  // The real name is folded to the placeholder only when it is a plain name, and only where it appears whole.
  const fold = badName ? (l) => l : (l) => l.split(name).join(PLACEHOLDER);
  const tpl = Array.isArray(templates) ? templates : defaultTemplates();
  const unreviewed = [];
  const read = [];
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || typeof f !== 'object') continue;
    const fname = typeof f.name === 'string' ? f.name : '(unnamed)';
    if (typeof f.text !== 'string') { unreviewed.push({ file: fname, why: 'it is not text, so it was not read' }); continue; }
    const truncated = f.text.length > MAX_FILE_CHARS;
    let text = truncated ? f.text.slice(0, MAX_FILE_CHARS) : f.text;
    if (truncated && /[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
    if (truncated) unreviewed.push({ file: fname, why: `only its first ${MAX_FILE_CHARS / 1024} KB were read` });
    read.push({ name: fname, raw: linesOf(text), truncated });
  }
  for (const f of read) f.normed = f.raw.map((l) => norm(fold(l)));
  const closest = closestTemplate(read.flatMap((f) => f.normed), tpl);
  const counts = { url: 0, credential: 0, schedule: 0, long: 0 };
  const flags = [];
  let flagsNotListed = 0;
  const flag = (x) => {
    if (counts[x.kind] >= MAX_FLAGS_PER_KIND) { flagsNotListed += 1; return; }
    counts[x.kind] += 1;
    flags.push(x);
  };
  const out = read.map((f) => {
    const added = [];
    f.raw.forEach((line, i) => {
      if (!f.normed[i] || (closest && closest.set.has(f.normed[i]))) return;
      added.push(i + 1);
      if (line.length > MAX_TEST_CHARS) flag({ file: f.name, line: i + 1, kind: 'long', text: shown(line, 0), at: 0, length: line.length });
      const here = matchesOf(line);
      for (const m of here) flag({ file: f.name, line: i + 1, kind: m.kind, text: shown(line, m.at), at: m.at, length: line.length });
      // An instruction split over two lines (review 1): the pair joined, for a kind neither line has alone.
      const next = f.raw[i + 1];
      if (typeof next === 'string' && next.trim()) {
        const alone = new Set([...here.map((m) => m.kind), ...kindsOf(next)]);
        for (const m of matchesOf(`${line} ${next}`)) {
          if (!alone.has(m.kind)) flag({ file: f.name, line: i + 1, kind: m.kind, text: shown(`${line} ${next}`, m.at), at: m.at, length: line.length, split: true });
        }
      }
    });
    return { name: f.name, lines: f.raw.length, added, truncated: f.truncated };
  });
  // Template lines the files do not have (review 1: a removed safety rule raises no flag, so it is listed).
  const have = new Set(read.flatMap((f) => f.normed));
  const missing = closest ? closest.lines.filter((l) => !have.has(l)) : [];
  return {
    name: shownName, nameProblem: badName, closest: closest ? closest.key : null, files: out,
    removed: missing.slice(0, MAX_REMOVED).map((l) => l.split(PLACEHOLDER).join(badName ? '(its name)' : name)),
    removedNotListed: Math.max(0, missing.length - MAX_REMOVED),
    flags, flagsNotListed, unreviewed,
    flagged: flags.length > 0 || flagsNotListed > 0 || unreviewed.length > 0 || !!badName,
  };
}

module.exports = { reviewAgent, kindsOf };
