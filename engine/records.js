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
 * A row: { name, key, status, confirmed, source, by, byPerson, confirmers, createdAt, updatedAt }.
 *   - name: as first written (the canonical name); key: the name folded (Unicode form, case, runs of spaces), so one
 *     entity is one row.
 *   - confirmed: YYYY-MM-DD, the date of the row's latest evidence. A write that creates the row or names its status
 *     IS evidence, so it is today unless the writer says when the evidence is from; it never moves the date behind a
 *     confirmer the row keeps (#8261). A write that leaves the status out (a source fix) checked nothing and never
 *     moves the date (#8553), and a status write from a writer the board could not name keeps a kept confirmer's
 *     date. Pinned by tests both ways.
 *   - status and source are optional; a write leaves a field alone unless it names it ('' clears it).
 *   - by / byPerson: the latest writer, filled in by the board from the writer's own card, never typed; null and false
 *     when the board could not name the writer (no token and no pane it could match, and not the screen). Such a
 *     write adds nobody to the confirmers; if it names a new status it empties them, like any new status (#8553). A
 *     writer the board names but whose name is over CONFIRMER_NAME_MAX is in by and is not a confirmer either.
 *   - confirmers (#8261): every distinct writer that created the row or named its current status (a write that
 *     leaves the status out, such as a source fix, adds nobody), in the order each first confirmed it
 *     (a repeat write does not move a name, only refreshes its date), at most CONFIRMERS_MAX, the earliest dropped
 *     first. Each keeps the date of its own evidence; when any is fresh, one older than STALE_DAYS no longer counts
 *     (on a write or a read), so a stale check beside a fresh one never reads as a second check. A second agent
 *     confirming a row adds a name instead of replacing the first. A write that changes the status starts the list
 *     again with that writer. A row written before this field seeds it from its by / byPerson.
 * A project may say what its rows are (recordsLabel: "accounts"); the default is "records".
 * Stale: confirmed more than STALE_DAYS ago. It is a fact to read on the page and in the list, never a refusal.
 */

const projects = require('./projects');

const NAME_MAX = 200;
const STATUS_MAX = 80;
const SOURCE_MAX = 500;
const LABEL_MAX = 40;
/* The rows live inside projects.json, which every board read parses whole and every write rewrites. A row at every
   field's limit, with CONFIRMERS_MAX dated confirmers of CONFIRMER_NAME_MAX-character names and an 80-character by,
   is about 1,900 characters of JSON (about 1,250 without confirmers), so 500 rows is about 950 KB per project
   (kosmos#8261 measured it). That is a typical case, not a bound: by is not capped here, the key can expand under
   NFKC, quotes and backslashes double in JSON, and non-ASCII text takes more bytes than characters. */
const ROWS_MAX = 500;
const STALE_DAYS = 30;
const CONFIRMERS_MAX = 5;
/* A confirmer's name is the board's session name, which nothing else caps; a longer one is left off the list (its
   write still lands, and by still records it), so the list's size has a real bound. */
const CONFIRMER_NAME_MAX = 80;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/* A line break: control characters (a newline would split a CLI line; a tab, a column), the C1 controls, and the
   line and paragraph separators. Built from code points: a separator written literally in a regex literal breaks
   the parse. */
const LINE_RE = (() => {
  const c = (n) => String.fromCharCode(n);
  return new RegExp('[' + [[0x00, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029]].map(([a, b]) => c(a) + '-' + c(b)).join('') + ']');
})();
/** Why a field cannot be stored, or null. Refused rather than stripped. Past a line break, the invisibles are the ones
 *  the rest of the board takes off a line (projectview.one): direction overrides and marks, the zero-width space and
 *  BOM, word joiners, the Unicode tag block (read by a model, invisible to a person: a channel between agents), and
 *  runs of joiners. The zero-width joiner and non-joiner stay, one or two at a time, as there: family emoji and
 *  Persian and Indic spellings need them. */
function badText(s, what) {
  if (LINE_RE.test(s)) return what + ' has to be on one line';
  if (require('./projectview').one(s) !== s.replace(/\s+/g, ' ').trim()) {
    return what + ' cannot hold hidden or direction-changing characters';
  }
  return null;
}

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
  const bad = badText(v.trim(), 'a record name');   // before the spaces fold, so a newline is refused, not turned into one
  if (bad) throw fail(bad);
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
  const bad = badText(s, 'the ' + what);
  if (bad) throw fail(bad);
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

/** A writer as a confirmer: { by, person }, or null when the write names nobody. */
function confirmerOf(by, person) {
  if (person === true) return { by: null, person: true };
  return typeof by === 'string' && by && by.length <= CONFIRMER_NAME_MAX ? { by, person: false } : null;
}
const sameConfirmer = (a, b) => a.person === b.person && (a.person || a.by === b.by);
/** A stored row's confirmers, each with the date of its own evidence: its list, or, for a row written before
    #8261, its latest writer with the row's date. */
function confirmersOf(row) {
  if (Array.isArray(row.confirmers)) {
    return row.confirmers.filter((c) => c && (c.person === true || (typeof c.by === 'string' && c.by && c.by.length <= CONFIRMER_NAME_MAX)))
      .map((c) => ({ by: c.person === true ? null : c.by, person: c.person === true,
        confirmed: typeof c.confirmed === 'string' ? c.confirmed : row.confirmed }));
  }
  const one = confirmerOf(row.by, row.byPerson);
  return one ? [{ ...one, confirmed: row.confirmed }] : [];
}
/** When any confirmer's own evidence is fresh, only the fresh ones count: an old check beside a fresh one is not a
    second check. When none is fresh, all are kept: the row reads stale, and still says who confirmed it. */
function freshConfirmers(list, now) {
  const fresh = list.filter((c) => { const a = ageDays(c.confirmed, now); return a !== null && a <= STALE_DAYS; });
  return fresh.length ? fresh : list;
}

/** One row as a reader gets it: the stored fields, plus how old its evidence is and whether that is stale. */
function view(row, now) {
  const age = ageDays(row.confirmed, now);
  return {
    name: row.name, status: row.status || '', confirmed: row.confirmed, source: row.source || '',
    by: row.by || null, byPerson: row.byPerson === true, confirmedBy: freshConfirmers(confirmersOf(row), now),
    updatedAt: row.updatedAt || null,
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
    const nextStatus = status === undefined ? (before.status || '') : status;
    const me = confirmerOf(by, person);
    // A writer confirms the status only by naming it (or by creating the row): a write that fixes the source alone
    // checked nothing. A new status starts the list again: a confirmation of the old status is not one of the new.
    const namesStatus = status !== undefined;
    let confirmers = i < 0 || (namesStatus && nextStatus !== (before.status || '')) ? [] : confirmersOf(before);
    if (me && (i < 0 || namesStatus)) {
      // A repeat write refreshes the writer's own date (never moves it back); a new writer joins at the end.
      const idx = confirmers.findIndex((c) => sameConfirmer(c, me));
      if (idx < 0) confirmers = [...confirmers, { ...me, confirmed }];
      else if (confirmed > confirmers[idx].confirmed) confirmers = confirmers.map((c, j) => (j === idx ? { ...c, confirmed } : c));
    }
    // Stale ones go before the cap, so a stale (or backdated) confirmer never pushes out a fresh one. (When none is
    // fresh all are kept, and then the cap alone decides which five stay.)
    confirmers = freshConfirmers(confirmers, now).slice(-CONFIRMERS_MAX);
    // The row's date is its latest evidence: a backdated write never moves it behind a confirmer it keeps.
    // The row's date (#8553): a write that leaves the status out (a source fix) checked nothing, so it never gives
    // the row a new date; a status write from a writer the board could not name keeps a kept confirmer's date;
    // otherwise the written date, never behind a kept confirmer.
    const counted = !!me && (i < 0 || namesStatus);
    const newest = confirmers.reduce((d, c) => (c.confirmed > d ? c.confirmed : d), '');
    const later = (a, b) => (a > b ? a : b);
    const rowConfirmed = i >= 0 && !namesStatus ? later(before.confirmed || confirmed, newest)
      : confirmers.length && !counted ? newest : later(confirmed, newest);
    const row = {
      // The name as first written stays the row's name: an update spelled "acme" does not rename the person's "Acme Inc".
      ...before, name: i < 0 ? clean : before.name, key, confirmed: rowConfirmed,
      status: nextStatus,
      source: source === undefined ? (before.source || '') : source,
      by: by || null, byPerson: person === true, confirmers, updatedAt: at,
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

/** " by ana", " by ana and bo", " by ana, bo and the person": every confirmer of the row's status (#8261). */
function whoWords(r) {
  // An answer with no confirmedBy (a caller handing renderList an older board's answer; the board's own always has
  // one) names its latest writer only. An empty list (a new status from nobody named) names nobody: the latest writer
  // may not have confirmed the status at all.
  const latest = confirmerOf(r.by, r.byPerson);
  const list = Array.isArray(r.confirmedBy) ? r.confirmedBy : latest ? [latest] : [];
  const names = list.map((c) => (c && c.person ? 'the person' : c && c.by)).filter(Boolean);
  if (!names.length) return '';
  return ' by ' + (names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);
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
    const who = whoWords(r);
    return '  ' + r.name + ' | ' + (r.status || '-') + ' | confirmed ' + r.confirmed + ' (' + ageWords(r.ageDays)
      + (r.stale ? ', stale' : '') + ')' + who + ' | ' + (r.source || '-');
  });
  return [head, ...lines].join('\n');
}

module.exports = { list, set, remove, setLabel, renderList, ageWords, keyOf, today, ageDays, STALE_DAYS, NAME_MAX, STATUS_MAX, SOURCE_MAX, LABEL_MAX, ROWS_MAX, CONFIRMERS_MAX, CONFIRMER_NAME_MAX };
