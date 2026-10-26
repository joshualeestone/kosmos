'use strict';
/**
 * kosmos#5536 slice 4a (design: #5536 comment 6407859949, sections 2 and 6 above it): the review list a person reads
 * before any restored agent is enabled. A snapshot holds agent folders but never Kosmos's own store, so a restored
 * agent comes back as files with no schedule, membership or connection; what can still act on the successor's
 * accounts is its instructions. This lists them, per agent, against the cleanest baseline Kosmos has (the built-in
 * role template the file is closest to), and flags each line that names a web address, something credential-shaped
 * or a schedule. It decides nothing: each agent is enabled, or not, by the person, one at a time.
 *
 * Every string it returns is the restored member's own text: escape all of it for HTML.
 *
 * reviewAgent({ name, files: [{ name, text }], templates? }) -> {
 *   name, files: [{ name, lines, added: [line numbers not in the closest template], truncated }],
 *   closest: role key or null, flags: [{ file, line, kind: 'url' | 'credential' | 'schedule', text }], flagged: bool
 * }
 *   files: the agent's instruction files as read from its restored folder (CLAUDE.md, AGENTS.md, GEMINI.md and any
 *   memory notes); templates: [{ key, text }], by default every built-in role's instructions for this name.
 */

const MAX_FILE_CHARS = 512 * 1024;   // instructions are capped at a fraction of this; past it the rest is not read
const MAX_LINE_SHOWN = 400;          // a flagged line is shown cut to this, so one line cannot fill the screen
const MAX_FLAGS = 500;               // per agent; the count past it is still reported

/* What each kind catches, as plain regular expressions over one line. They over-flag rather than miss: a false flag
   costs a glance, a missed one runs on someone else's accounts. */
const KINDS = [
  ['url', /\b(?:https?|ftp|ssh|wss?):\/\/\S+|\bwww\.[a-z0-9-]+\.[a-z]{2,}\b|\b[a-z0-9.-]+@[a-z0-9-]+\.[a-z0-9.-]+:\S+/i],
  ['credential', new RegExp([
    String.raw`\b(?:api[_ -]?key|secret|token|passw(?:or)?d|passphrase|bearer|credential|private[_ -]?key|access[_ -]?key)\b`,
    String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`,
    String.raw`\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}`,          // provider keys in the sk-... shape
    String.raw`\bgh[pousr]_[A-Za-z0-9]{20,}`,               // GitHub tokens
    String.raw`\bAKIA[0-9A-Z]{16}\b`,                       // AWS access key ids
    String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,             // Slack tokens
  ].join('|'), 'i')],
  ['schedule', new RegExp([
    String.raw`\b(?:cron(?:tab)?|launchd|launchctl|schtasks|systemd timer|scheduled? task)\b`,
    String.raw`\bevery\s+(?:\d+\s+)?(?:minute|hour|day|night|morning|evening|week|month|weekday)s?\b`,
    String.raw`\b(?:hourly|nightly|daily|weekly|monthly)\b`,
    String.raw`\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b`,
    String.raw`\bat\s+\d{1,2}:\d{2}\b`,
    String.raw`(?:^|\s)(?:\*|\d{1,2}(?:[-,/]\d{1,2})*)(?:\s+(?:\*|\d{1,2}(?:[-,/]\d{1,2})*)(?:/\d+)?){4}(?:\s|$)`,   // a cron expression
  ].join('|'), 'i')],
];

/* The default baseline: every built-in role's instructions for this agent's name. */
function defaultTemplates(name) {
  const roles = require('./roles');
  return roles.ROLES.map((r) => ({ key: r.key, text: roles.instructionsFor(r.key, name) || '' }));
}

const linesOf = (text) => String(text).split(/\r\n|\r|\n/);
const norm = (l) => l.trim().replace(/\s+/g, ' ');

/* The template sharing the most non-blank lines with these, or null when none shares any. */
function closestTemplate(lines, templates) {
  const mine = new Set(lines.map(norm).filter(Boolean));
  let best = null, bestCount = 0;
  for (const t of templates) {
    if (!t || typeof t.text !== 'string') continue;
    const theirs = new Set(linesOf(t.text).map(norm).filter(Boolean));
    let n = 0;
    for (const l of mine) if (theirs.has(l)) n += 1;
    if (n > bestCount) { best = { key: t.key, set: theirs }; bestCount = n; }
  }
  return best;
}

/* Which kinds a line is, in KINDS order. */
function kindsOf(line) {
  return KINDS.filter(([, re]) => re.test(line)).map(([k]) => k);
}

function reviewAgent({ name, files, templates } = {}) {
  const shownName = typeof name === 'string' ? name : '';
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.name === 'string' && typeof f.text === 'string');
  const tpl = Array.isArray(templates) ? templates : defaultTemplates(shownName);
  const read = list.map((f) => {
    const truncated = f.text.length > MAX_FILE_CHARS;
    return { name: f.name, lines: linesOf(truncated ? f.text.slice(0, MAX_FILE_CHARS) : f.text), truncated };
  });
  // One baseline for the agent: the template closest to all its files together.
  const closest = closestTemplate(read.flatMap((f) => f.lines), tpl);
  const flags = [];
  let flagsNotListed = 0;
  const out = read.map((f) => {
    const added = [];
    f.lines.forEach((line, i) => {
      const n = norm(line);
      if (!n || (closest && closest.set.has(n))) return;
      added.push(i + 1);
      // Only lines the member added are flagged: a line identical to Kosmos's own template is Kosmos's words, and
      // flagging the templates' own "token" or "daily" would bury the lines that matter.
      for (const kind of kindsOf(line)) {
        if (flags.length >= MAX_FLAGS) { flagsNotListed += 1; continue; }
        flags.push({ file: f.name, line: i + 1, kind, text: line.length > MAX_LINE_SHOWN ? `${line.slice(0, MAX_LINE_SHOWN)}...` : line });
      }
    });
    return { name: f.name, lines: f.lines.length, added, truncated: f.truncated };
  });
  return { name: shownName, files: out, closest: closest ? closest.key : null, flags, flagsNotListed, flagged: flags.length > 0 };
}

module.exports = { reviewAgent, kindsOf };
