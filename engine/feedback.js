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
 * 🔑 STORE LOCALLY REGARDLESS OF THE SWITCH (Josh, explicit). The opt-in
 * switch governs TRANSMISSION only, not whether the work happens: a local
 * report is useful to the user's own agent even when nothing leaves the
 * machine. So NOTHING in this file reads a send/opt-in flag; writing is
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

/**
 * Write (replace) a day's report. `body` is the agent-authored markdown; this
 * wraps it in a small frontmatter header so the send layer and the reader can
 * find the date and the install without parsing prose. Idempotent: writing
 * again the same day replaces the file, so a re-run regenerates rather than
 * appending duplicates.
 *
 * Write-then-rename (the store.js pattern): an interrupted write cannot leave
 * a half-file that a later read treats as a real, truncated report.
 */
function write(body, opts) {
  const o = opts || {};
  const date = o.date ? assertDate(o.date) : today();
  // installId is this install's own random anchor (notify/ping reuse it). It
  // is not PII and it lets a later send de-duplicate one machine's reports.
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
  const content = header + String(body == null ? '' : body).replace(/\s*$/, '') + '\n';

  fs.mkdirSync(dir(), { recursive: true });
  const dest = pathFor(date);
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, dest);
  return { ok: true, path: dest, date };
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
 *  regex and drifting from this one if the header format ever changes. */
function stripFrontmatter(raw) {
  const s = String(raw == null ? '' : raw);
  const m = s.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? s.slice(m[0].length) : s;
}

/** Just the body (frontmatter stripped), or null when there is no report. */
function readBody(date) {
  const raw = read(date);
  if (raw == null) return null;
  return stripFrontmatter(raw);
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

module.exports = { dir, dateKey, isDateKey, today, pathFor, write, read, readBody, stripFrontmatter, has, list };
