'use strict';

/**
 * The daily product-feedback report, stored locally (kosmos#2037).
 *
 * Josh, 2026-09-03: "allow people to have one of their agents, probably a
 * project manager, write and assemble a daily report of product feedback ...
 * things that didn't work and suggestions about how to make it better." The
 * frame is deliberate: the user's agent AUTHORS and SENDS a report; we do not
 * COLLECT telemetry. This module owns the first, always-on half of that: the
 * report is written to the user's own disk whether or not it is ever sent.
 *
 * 🔑 STORE LOCALLY REGARDLESS OF THE SWITCH (Josh, explicit). The send
 * switch (default-on / opt-out, #2013) governs TRANSMISSION only, not whether
 * the work happens: a local report is useful to the user's own agent even when
 * nothing leaves the machine. So NOTHING in this file reads a send flag; writing is
 * unconditional. The send layer (scrubbing + the gated seam) is a separate
 * module built on top of these files; see kosmos#2037.
 *
 * ⚠️ NOT ANONYMISED HERE, ON PURPOSE. An agent's findings name home-dir
 * paths, project/repo names and agent names (every real hand-written instance
 * so far carried a home path). That is fine on the user's OWN disk; it is the
 * SEND path that must scrub or state plainly what leaves. Do not add the word
 * "anonymous" to anything this module writes.
 *
 * One markdown file per day under <dataRoot>/feedback/YYYY-MM-DD.md, so the
 * user (and their agent) can read the history the same way they read any note.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/** The report directory, under the same data root everything else uses.
 *  store exposes the root as the getter `store.ROOT` (= dataRootFor for the
 *  current env, #1443/#1856), never a `root()` function. */
function dir() { return path.join(store.ROOT, 'feedback'); }

/**
 * YYYY-MM-DD in LOCAL time. The report boundary is the user's day, not UTC:
 * a "daily" report split at midnight UTC would cut a US evening's work in two.
 */
function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** True iff x is a bare YYYY-MM-DD STRING. The one date-shape gate, shared by
 *  the engine and the /api/feedback route so this path-safety check has a single
 *  source of truth and cannot drift across sites. Requires a string, so a
 *  non-string date (a JSON number/array/object) is rejected rather than
 *  ToString-coerced into a value that echoes back oddly. */
function isDateKey(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x); }

/** Reject anything that is not a bare YYYY-MM-DD, so a caller cannot walk out
 *  of the feedback dir via the date (the same untrusted-path care store.js
 *  takes with agent names). */
function assertDate(date) {
  if (!isDateKey(date)) {
    throw new Error('feedback: date must be YYYY-MM-DD, got ' + JSON.stringify(date));
  }
  return date;
}

function pathFor(date) { assertDate(date); return path.join(dir(), date + '.md'); }

/** today's date key, exported so a caller need not reach for `new Date()`. */
function today() { return dateKey(); }

/* kosmos#5317: one file per day, one SECTION per writer. Two agents on one install used to replace each other's
   report (only the last writer's reached the team). A section starts with this marker line, then a heading. */
const SECTION_RE = /^<!-- kosmos-feedback-from: ([^\n]*?) -->$/;
function sectionMarker(key) { return '<!-- kosmos-feedback-from: ' + key + ' -->'; }
function sectionHeading(key) { return key === '' ? '## From this computer' : '## From ' + key; }
/** The sections of a stored body, in order: [{ key, text }], `text` without its marker and heading. Text before any
 *  marker (a report from before #5317, or one written with no known writer) is the '' section: this computer. */
function sections(body) {
  const lines = String(body == null ? '' : body).split('\n');
  const pre = [];
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(SECTION_RE);
    if (m) { cur = { key: m[1], lines: [] }; out.push(cur); continue; }
    (cur ? cur.lines : pre).push(line);
  }
  // Exact, never trimmed at the front: write() stores `marker \n heading \n\n text \n` and text has no trailing space.
  const result = [];
  const preText = pre.join('\n').replace(/\s*$/, '');
  if (preText) result.push({ key: '', text: preText });
  for (const sct of out) {
    const raw = sct.lines.join('\n');
    const head = sectionHeading(sct.key) + '\n\n';
    result.push({ key: sct.key, text: (raw.startsWith(head) ? raw.slice(head.length) : raw).replace(/\s*$/, '') });
  }
  return result;
}
/* A body line that looks like a section marker would split the report on the next read: indent it by one space so it
   reads the same and is never taken for a marker. */
function neutral(text) {
  return String(text).split('\n').map((l) => (SECTION_RE.test(l) ? ' ' + l : l)).join('\n');
}
function writerKey(from) {
  if (from == null) return '';
  return String(from).replace(/[\r\n]/g, ' ').replace(/-->/g, '').trim().slice(0, 64);
}
/** Who is writing, for the CLIs: the agent its launch token names, else (with NO token) the agent whose tmux window
 *  this is (the resolver a kept message uses, engine/outbox.js resolveKeepSender), else null. A token that is present
 *  and names nobody is null too, never the pane: the no-downgrade rule. null writes the unnamed section. */
function writer(env) {
  try {
    const r = require('./outbox').resolveKeepSender(env || process.env);
    return r && r.ok ? r.name : null;
  } catch { return null; }
}
/** kosmos#5317: the body as it leaves this computer. Each writer's section is headed "Report 1", "Report 2", ... and
 *  never by an agent's name: the send scrub removes the names it can find (profiles, worker folders), and a legacy
 *  agent with neither is still a name, so the headings carry none at all. The local file keeps the names. */
function forSend(body) {
  const secs = sections(body);
  if (secs.length === 0) return body;
  if (secs.length === 1) return secs[0].text + '\n';   // exactly what readBody gives a one-writer day
  return secs.map((x, i) => '## Report ' + (i + 1) + '\n\n' + x.text + '\n').join('\n');
}
/* Two writers at once must not lose each other's section: the read-modify-write runs under a lock directory. */
function withLock(dest, fn) {
  const lock = dest + '.lock';
  const until = Date.now() + 5000;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      if (Date.now() > until) throw new Error('feedback: another write of this report is still running');
      /* review 1: a stale lock (a writer that crashed) is taken over by renaming it first, so two waiters cannot both
         remove the SAME stale lock. Review 2: not fully exclusive: a slow waiter can rename the fresh lock the first
         one just made, and then both write (last writer wins, one section lost). It needs a crashed writer AND two
         writes in the same 50 ms, so it is accepted rather than built out. */
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 30000) {
          const gone = lock + '.stale-' + process.pid + '-' + Date.now();
          fs.renameSync(lock, gone); fs.rmdirSync(gone); continue;
        }
      } catch { /* another waiter took it, or it was just released: try again */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch { /* gone */ } }
}

/**
 * Write a day's report for ONE writer. `body` is the agent-authored markdown; this wraps the day's file in a small
 * frontmatter header so the send layer and the reader can find the date and the install without parsing prose.
 * kosmos#5317: the day's file holds one section per writer (`opts.from`: an agent's name, or null for this computer).
 * Writing again REPLACES ONLY THAT WRITER'S SECTION, so a re-run regenerates rather than appending duplicates, and
 * another agent's report the same day is kept. A day with only an unknown writer is stored bare, exactly as before
 * #5317, and a report from before #5317 reads as that writer's section.
 *
 * Write-then-rename (the store.js pattern): an interrupted write cannot leave
 * a half-file that a later read treats as a real, truncated report.
 */
function write(body, opts) {
  const o = opts || {};
  const date = o.date ? assertDate(o.date) : today();
  const key = writerKey(o.from);
  // installId is this install's own random id (engine/ping.js). It lets a later
  // send de-duplicate one install's reports.
  let install = null;
  try { install = require('./ping').installId(); } catch { install = null; }
  const header = [
    '---',
    'date: ' + date,
    'install: ' + (install || 'unknown'),
    'generated_at: ' + new Date().toISOString(),
    '---',
    '',
  ].join('\n');
  fs.mkdirSync(dir(), { recursive: true });
  const dest = pathFor(date);
  return withLock(dest, () => {
    let prior = [];
    try { prior = sections(stripFrontmatter(fs.readFileSync(dest, 'utf8'))); } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    const mine = { key, text: neutral(String(body == null ? '' : body).replace(/\s*$/, '')) };
    const at = prior.findIndex((x) => x.key.toLowerCase() === key.toLowerCase());   // review 1: Mara and mara are one agent
    if (at >= 0) prior[at] = mine; else prior.push(mine);
    const content = header + (prior.length === 1 && prior[0].key === ''
      ? prior[0].text + '\n'
      : prior.map((x) => sectionMarker(x.key) + '\n' + sectionHeading(x.key) + '\n\n' + x.text + '\n').join('\n'));
    require('./store').saveFlushed(dest, content);   // #5434 slice 21: flushed before the rename (a unique temp, removed on failure; the folder after on POSIX)
    return { ok: true, path: dest, date, from: key || null, writers: prior.length };
  });
}
/** The raw file contents for a day, or null when there is no report. */
function read(date) {
  try { return fs.readFileSync(pathFor(date), 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Strip a leading `---\n...\n---\n` frontmatter header if present; otherwise
 *  return the input unchanged. The header regex consumes the header's own
 *  trailing newline, so the remainder is returned faithfully (no leading-blank-
 *  line stripping, which would silently drop a body the author meant to begin
 *  with blank lines). Exported so a second reader of these files (the #2246
 *  triage `--dir` path) strips the SAME way rather than re-implementing the
 *  regex and drifting from this one if the header format ever changes.
 *
 *  KNOWN EDGE: a body that OPENS with a `---` thematic break plus another `---`
 *  further down (e.g. `---\nHeading\n---\nbody`) is indistinguishable from
 *  frontmatter by this regex, so that opening block is stripped. Harmless for the
 *  store path (feedback.js always writes generated frontmatter first). For the
 *  triage `--dir` path over arbitrary tester notes it could clip a leading rule;
 *  low-risk and accepted rather than heuristically guessing YAML-vs-Markdown. */
function stripFrontmatter(raw) {
  const s = String(raw == null ? '' : raw);
  const m = s.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? s.slice(m[0].length) : s;
}

/** The `date:` (YYYY-MM-DD) from a report's `---`...`---` frontmatter header, or
 *  null. #2296: a pulled report (engine/feedbackpull.js) has a `<date>__<install>.md`
 *  name, not a bare `YYYY-MM-DD.md`, so triage's --dir reads the day from HERE
 *  instead of the filename, keeping --since working on the collected corpus.
 *  Read only within the header block, and only a well-formed date, so a `date:`
 *  in the prose body cannot be mistaken for the report's day. */
function frontmatterDate(raw) {
  const s = String(raw == null ? '' : raw);
  const fm = s.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) return null;
  const m = fm[1].match(/(?:^|\n)date:\s*(\d{4}-\d{2}-\d{2})\s*(?:\n|$)/);
  return m ? m[1] : null;
}

/** Just the body (frontmatter stripped), or null when there is no report. */
function readBody(date) {
  const raw = read(date);
  if (raw == null) return null;
  const body = stripFrontmatter(raw);
  // kosmos#5317: a day ONE writer wrote reads as exactly what it wrote (no heading, no name), as before sections; the
  // headings appear only once two writers share the day.
  const secs = sections(body);
  if (secs.length === 1) return secs[0].text + '\n';
  // review 1: the marker lines are storage, never shown: two writers read as their headings and text.
  return secs.map((x) => sectionHeading(x.key) + '\n\n' + x.text + '\n').join('\n');
}
/** kosmos#5317: what leaves the computer for a day, built from the STORED sections (never from a rendered body, so a
 *  heading an agent pasted back into its own report is just its text). */
function sendBody(date) {
  const raw = read(date);
  if (raw == null) return null;
  return forSend(stripFrontmatter(raw));
}

/** True when a report exists for the day. */
function has(date) { return read(date) != null; }

/** Available report dates, newest first. Empty when the dir does not exist. */
function list() {
  let names;
  try { names = fs.readdirSync(dir()); }
  catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  return names
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
    .map((n) => n.slice(0, -3))
    .sort()
    .reverse();
}

/* kosmos#6265: the folder `kosmos feedback pull` writes the collected reports into. Read lazily, so this module does
   not load the pull's code until a triage runs. */
function pulledDir() { return require('./feedbackpull').defaultDir(); }
/* Review 1: a regular .md file, not anything named like one (a subdirectory x.md is skipped by the reader). */
function hasReports(folder) {
  let names;
  try { names = fs.readdirSync(folder); } catch { return false; }
  /* stat follows a link, as the reader's readFileSync does (review 3), so the two agree on what counts. */
  return names.some((n) => { if (!/\.md$/.test(n)) return false; try { return fs.statSync(path.join(folder, n)).isFile(); } catch { return false; } });
}
/* This computer's own reports, through the store's reader (readBody drops the per-writer section markers, #5317). */
function readOwn(since, reports) {
  for (const date of list()) {
    if (since && date < since) continue;
    reports.push({ date, body: readBody(date) });
  }
}
/* Review 4: the OS's own spelling of each path (realpathSync.native), compared without case on Windows, so a --dir that
   names the store with other capitals or slashes is still the store. */
function samePath(a, b) {   // also feedbackpull.nextLine's comparison, so the two cannot disagree
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const fold = (p) => (process.platform === 'win32' ? real(p).toLowerCase() : real(p));
  return fold(a) === fold(b);
}
const newest = (reports) => reports.map((r) => r.date).filter(Boolean).sort().pop() || null;
/* The reports in one folder of .md files, oldest first (a pulled folder, or a --dir). */
function readFolder(folder, since, reports, notes) {
  let names;
  try { names = fs.readdirSync(folder); } catch { return false; }
  for (const name of names.filter((n) => /\.md$/.test(n)).sort()) {
    let raw;
    try { raw = fs.readFileSync(path.join(folder, name), 'utf8'); } catch { notes.push('skipping unreadable report: ' + name); continue; }
    const date = /^\d{4}-\d{2}-\d{2}\.md$/.test(name) ? name.slice(0, -3) : frontmatterDate(raw);
    if (since && (date === null || date < since)) continue;
    reports.push({ date, body: stripFrontmatter(raw) });
  }
  return true;
}
/**
 * The reports `kosmos feedback triage` reads (#2246), optionally only those on or
 * after `since`: a directory (`--dir`); with none, the folder `kosmos feedback pull`
 * fills when it holds a report file, else this computer's own store (#6265).
 * ONE reader for both CLIs (install/kosmos and the Windows
 * tools/windows/kosmos-cli.js), so the two cannot disagree about which reports a
 * digest covers (win32-cli-verbs).
 *
 * Returns { ok, reports: [{date, body}], notes, read, because }. `read` is the folder
 * read (a --dir naming this computer's own store reads it as the store). `notes` are the per-file skips (a subdirectory named x.md, a file that cannot
 * be read) and one line naming the folder read, which the caller prints on stderr and
 * carries on past; `ok:false` is a refusal (a bad --since,
 * an unreadable --dir), whose `because` the caller prints before exiting 2.
 *
 * A --dir file named `YYYY-MM-DD.md` takes its day from the name; any other name
 * (a pulled `<date>__<install>.md`) takes it from the frontmatter, and one with
 * neither has a null date, which a --since filter skips because it cannot confirm
 * the day.
 */
function reportsForTriage(opts) {
  const o = opts || {};
  const since = o.since || '';
  const notes = [];
  if (since && !isDateKey(since)) return { ok: false, because: '--since must be YYYY-MM-DD', reports: [], notes };
  const reports = [];
  if (o.dir && samePath(o.dir, dir())) {
    /* Review 3: --dir naming this computer's own store reads it as the default did, not as a plain folder (newest
       first, as the store lists it). Review 5: a missing store is still refused, as any unreadable --dir is. */
    if (!fs.existsSync(dir())) return { ok: false, because: 'cannot read --dir: ' + o.dir, reports: [], notes };
    readOwn(since, reports);
    notes.push('triage read this computer\'s own reports in ' + dir());
    return { ok: true, reports, notes, read: dir() };
  }
  if (o.dir) {
    if (!readFolder(o.dir, since, reports, notes)) return { ok: false, because: 'cannot read --dir: ' + o.dir, reports: [], notes };
    notes.push('triage read the reports in ' + o.dir);
    return { ok: true, reports, notes, read: o.dir };
  }
  /* kosmos#6265: with no --dir, the reports `kosmos feedback pull` collected are what a triage is for, so their folder
     is read when it holds any; only when it does not are this computer's own daily reports read. Either way the run
     says which folder it read (stderr in both commands), so a triage after a pull can never silently read old data. */
  const pulled = pulledDir();
  const pulledThere = hasReports(pulled);
  if (pulledThere && readFolder(pulled, since, reports, notes)) {
    const last = newest(reports);
    /* Review 5: --since can leave nothing of the pulled folder; the note says so, so an empty digest is not a mystery. */
    const what = !reports.length && since ? 'none on or after ' + since : last ? 'newest dated ' + last : 'none dated';
    notes.push('triage read the pulled reports in ' + pulled + ' (kosmos feedback pull fills it; ' + what + '); --dir ' + dir() + ' reads this computer\'s own');
    return { ok: true, reports, notes, read: pulled };
  }
  readOwn(since, reports);
  /* Review 2: a pulled folder that held reports but could not be read (gone between the two looks) says so. */
  notes.push('triage read this computer\'s own reports in ' + dir() + ': ' + (pulledThere ? 'the pulled reports in ' + pulled + ' could not be read' : 'there are no pulled reports in ' + pulled + ' (kosmos feedback pull fetches them)'));
  return { ok: true, reports, notes, read: dir() };
}

module.exports = { dir, dateKey, isDateKey, today, pathFor, write, writer, sections, forSend, sendBody, read, readBody, stripFrontmatter, frontmatterDate, has, list, reportsForTriage, samePath };
