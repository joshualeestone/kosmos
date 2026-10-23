'use strict';

/**
 * #6994: a project's records. One small table per project of the things it keeps track of (accounts, leads,
 * vendors, applications), so agents and the person can answer "what is the current list, and how fresh is each
 * entry?" without reconciling a spreadsheet, the project folder and earlier task outputs by hand.
 *
 * ⚠️ WHY A STORE AND NOT A CSV IN THE PROJECT FOLDER (the card's weakest premise, decided on the card). A shared
 * CSV is a shared file, but two agents updating rows each rewrite the whole file and the second write drops the
 * first one's row; nothing keeps "Acme" and "ACME" one row; and "last confirmed" is a column each agent has to
 * remember. Here the rows live inside the project record, like its tasks, and every write goes through
 * projects.mutate in the one board process, so two agents' updates apply one after the other and both survive.
 *
 * A row: { name, key, status, confirmed, source, by, byPerson, createdAt, updatedAt }.
 *   - name: as last written; key: the name folded (case, runs of spaces), so one entity is one row.
 *   - confirmed: YYYY-MM-DD, the date of the row's latest evidence. A write IS evidence, so it is today unless
 *     the writer says when the evidence is from.
 *   - status and source are optional; a write leaves a field alone unless it names it ('' clears it).
 * A project may say what its rows are (recordsLabel: "accounts"); the default is "records".
 * Stale: confirmed more than STALE_DAYS ago. It is a fact to read on the page and in the list, never a refusal.
 */

const projects = require('./projects');

const NAME_MAX = 200;
const STATUS_MAX = 80;
const SOURCE_MAX = 1000;
const LABEL_MAX = 40;
const ROWS_MAX = 2000;
const STALE_DAYS = 30;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/* Refused rather than stripped: control characters (a newline would split a CLI line; a tab, a column), the C1
   controls, the line and paragraph separators, the direction marks and overrides (U+202E would make a row read
   backwards), and the zero-width characters (one would make two rows that look the same): the set taskMessageSummary
   keeps off a line, plus the bidi and zero-width ones. */
const CONTROL_RE = (() => {
  // Built from code points: a separator or an override written literally in a regex literal breaks the parse.
  const c = (n) => String.fromCharCode(n);
  const set = [[0x00, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2060], [0x2066, 0x2069], [0xfeff, 0xfeff]];
  return new RegExp('[' + set.map(([a, b]) => c(a) + '-' + c(b)).join('') + ']');
})();

function fail(message, status) {
  const err = new Error(message);
  err.status = status || 400;
  return err;
}

/** The comparison key for a name: Unicode-normalised (NFKC, so a name typed with a composed or a combining accent is
 *  one row), trimmed, inner spaces collapsed, case folded. Spelling variants ("Acme Inc", "Acme") stay two rows. */
function keyOf(name) {
  return String(name).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Today's date on this computer, as YYYY-MM-DD (the person's own calendar day, not UTC's). */
function today(now) {
  const d = new Date(now === undefined ? Date.now() : now);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** Days from a YYYY-MM-DD date to today, counted in calendar days (negative for a future date). */
function ageDays(date, now) {
  const m = DATE_RE.exec(String(date || ''));
  if (!m) return null;
  const t = DATE_RE.exec(today(now));
  const a = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const b = Date.UTC(+t[1], +t[2] - 1, +t[3]);
  return Math.round((b - a) / 86400000);
}

function cleanName(v) {
  if (typeof v !== 'string' || !v.trim()) throw fail('a record needs a name');
  if (CONTROL_RE.test(v.trim())) throw fail('a record name has to be on one line');   // before the spaces fold
  const name = v.trim().replace(/\s+/g, ' ');
  if (name.length > NAME_MAX) throw fail('a record name can be at most ' + NAME_MAX + ' characters');
  return name;
}

/** A text field a write names: undefined leaves it alone, '' or null clears it. */
function cleanText(v, what, max) {
  if (v === undefined) return undefined;
  if (v === null) return '';
  if (typeof v !== 'string') throw fail('the ' + what + ' has to be text');
  const s = v.trim();
  if (CONTROL_RE.test(s)) throw fail('the ' + what + ' has to be on one line');
  if (s.length > max) throw fail('the ' + what + ' can be at most ' + max + ' characters');
  return s;
}

/** The confirmed date a write names, or today. A real calendar date, at most one day after today: "today" is this
 *  computer's calendar day, and an agent that takes its date from `date -u` is a day ahead every evening west of UTC. */
function cleanConfirmed(v, now) {
  if (v === undefined || v === null || v === '') return today(now);
  if (typeof v !== 'string') throw fail('the confirmed date has to be written YYYY-MM-DD');
  const m = DATE_RE.exec(v.trim());
  if (!m) throw fail('the confirmed date has to be written YYYY-MM-DD');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw fail('the confirmed date ' + v.trim() + ' is not a real date');
  }
  if (ageDays(v.trim(), now) < -1) throw fail('the confirmed date cannot be in the future (today on this computer is ' + today(now) + ')');
  return v.trim();
}

function projectOrThrow(projectId) {
  const p = projects.readAll().find((x) => x.id === projectId);
  if (!p) throw fail('there is no project by that name', 404);
  return p;
}

/** One row as a reader gets it: the stored fields, plus how old its evidence is and whether that is stale. */
function view(row, now) {
  const age = ageDays(row.confirmed, now);
  return {
    name: row.name, status: row.status || '', confirmed: row.confirmed, source: row.source || '',
    by: row.by || null, byPerson: row.byPerson === true, updatedAt: row.updatedAt || null,
    ageDays: age, stale: age !== null && age > STALE_DAYS,
  };
}

/** A project's records, sorted by name, with its label and the stale threshold. */
function list(projectId, { now } = {}) {
  const p = projectOrThrow(projectId);
  const rows = (Array.isArray(p.records) ? p.records : []).filter((r) => r && typeof r.name === 'string')
    .map((r) => view(r, now)).sort((a, b) => keyOf(a.name).localeCompare(keyOf(b.name)));
  return { label: p.recordsLabel || 'records', staleDays: STALE_DAYS, rows, stale: rows.filter((r) => r.stale).length };
}

/**
 * Add a record, or update the one with the same name (see keyOf). Returns { row, created }.
 * fields: { status, confirmed, source }; who: { by, person }.
 */
function set(projectId, name, fields = {}, { by = null, person = false, now } = {}) {
  const clean = cleanName(name);
  const key = keyOf(clean);
  const status = cleanText(fields.status, 'status', STATUS_MAX);
  const source = cleanText(fields.source, 'source', SOURCE_MAX);
  const confirmed = cleanConfirmed(fields.confirmed, now);
  const at = new Date(now === undefined ? Date.now() : now).toISOString();
  let out = null;
  projectOrThrow(projectId);
  projects.mutate(projectId, (p) => {
    const rows = Array.isArray(p.records) ? p.records.slice() : [];
    const i = rows.findIndex((r) => r && r.key === key);
    if (i < 0 && rows.length >= ROWS_MAX) throw fail('a project can keep at most ' + ROWS_MAX + ' records', 409);
    const before = i < 0 ? { createdAt: at } : rows[i];
    const row = {
      ...before, name: clean, key, confirmed,
      status: status === undefined ? (before.status || '') : status,
      source: source === undefined ? (before.source || '') : source,
      by: by || null, byPerson: person === true, updatedAt: at,
    };
    if (i < 0) rows.push(row); else rows[i] = row;
    out = { row: view(row, now), created: i < 0 };
    return { ...p, records: rows };
  });
  return out;
}

/** Remove the record with this name. Throws 404 when there is none. */
function remove(projectId, name) {
  const key = keyOf(cleanName(name));
  const p = projectOrThrow(projectId);
  if (!(Array.isArray(p.records) ? p.records : []).some((r) => r && r.key === key)) {
    throw fail('there is no record called ' + String(name).trim() + ' on this project', 404);
  }
  let gone = null;
  projects.mutate(projectId, (q) => {
    const rows = (Array.isArray(q.records) ? q.records : []).filter((r) => {
      if (r && r.key === key) { gone = r.name; return false; }
      return true;
    });
    return { ...q, records: rows };
  });
  return { name: gone };
}

/** Say what a project's records are ("accounts"); '' or null goes back to "records". */
function setLabel(projectId, label) {
  const clean = cleanText(label === undefined ? null : label, 'label', LABEL_MAX);
  projectOrThrow(projectId);
  projects.mutate(projectId, (p) => {
    const next = { ...p };
    if (clean) next.recordsLabel = clean; else delete next.recordsLabel;
    return next;
  });
  return { label: clean || 'records' };
}

/** How old a row's evidence reads: "today", "yesterday", "N days ago". */
function ageWords(days) {
  if (days === null || days === undefined) return 'date unknown';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}

/**
 * The list as both CLIs print it (one module, so the Mac and Windows words cannot drift): a heading with the
 * count and the stale count, then one line per row, "name | status | confirmed DATE (AGE[, stale]) by WHO | source".
 */
function renderList(out, { projectId, projectName } = {}) {
  const label = out.label || 'records';
  const where = projectName ? ' on ' + projectName : '';
  if (!out.rows.length) {
    return 'No ' + label + where + ' yet. Add one with: kosmos records set ' + (projectId || '<project-id>')
      + ' "<name>" --status "<status>" --source "<link or file>"';
  }
  // The count after the label ("Accounts on Pipeline: 3"), so a custom label never reads "1 accounts".
  const head = label.charAt(0).toUpperCase() + label.slice(1) + where + ': ' + out.rows.length
    + (out.stale ? ', ' + out.stale + ' stale (evidence more than ' + out.staleDays + ' days old)' : '');
  const lines = out.rows.map((r) => {
    const who = r.byPerson ? ' by the person' : r.by ? ' by ' + r.by : '';
    return '  ' + r.name + ' | ' + (r.status || '-') + ' | confirmed ' + r.confirmed + ' (' + ageWords(r.ageDays)
      + (r.stale ? ', stale' : '') + ')' + who + ' | ' + (r.source || '-');
  });
  return [head, ...lines].join('\n');
}

module.exports = { list, set, remove, setLabel, renderList, ageWords, keyOf, today, ageDays, STALE_DAYS, NAME_MAX, STATUS_MAX, SOURCE_MAX, ROWS_MAX };
