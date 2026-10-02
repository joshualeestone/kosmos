'use strict';
/**
 * #3955: the release's highlights, for the "Kosmos has been updated" window.
 *
 * web/whats-new.json is written by the operator and committed to main before a cut, beside the
 * versions entry (agreed with Baron, 2026-09-26 08:32 CDT). release.sh never writes it: it is
 * ruled, user-facing wording. Its shape:
 *
 *   {"version":"0.6.98","highlights":[{"icon":"spark","title":"...","line":"..."}]}
 *
 * #4928: a platform cut on another number from the same work (Windows on 0.7.13 while the Mac is on
 * 0.7.16) is named in an optional "also": ["0.7.13"], so the same highlights show on both. Without it
 * the file is for one number only, and the other platform's people saw no window at all. A malformed
 * "also" fails the whole file (no window on either number), as any other problem does: fail closed.
 *
 * One definition of "a file the window can show", used twice: by the board (read, below, which
 * serves nothing it cannot draw) and by the cut (tools/whats-new-check.js, which refuses a cut
 * whose file is not for the version being cut).
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'web', 'whats-new.json');
let fileForTests = null;   // a test points the board at its own file; never the repo's
/* The icons the app draws (Mona Lisa's set, #3955), so a release never needs new artwork. */
const ICONS = Object.freeze(['swarm', 'tasks', 'phone', 'list', 'chat', 'shield', 'spark']);
const MAX_HIGHLIGHTS = 5;
const MAX_TITLE = 48;    // "about 40", with room for a word
const MAX_LINE = 140;    // one sentence of about 90 to 120
/* An em dash in any of its spellings (the house rule): the character, and the escapes a hand
   edit could leave in JSON. */
const EM_DASH = /\u2014|&mdash;|&#8212;|&#x2014;/i;
/* A version like 0.6.98: the one pattern for this module and tools/whats-new-check.js (round 12). */
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** Every problem with a parsed file, as sentences; an empty list means it is good for `version`. */
function problems(obj, version) {
  const out = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['it is not a JSON object'];
  if (typeof obj.version !== 'string' || !VERSION_RE.test(obj.version)) out.push('its "version" is not a version like 0.6.98');
  const also = obj.also === undefined ? [] : obj.also;
  if (!Array.isArray(also) || also.some((v) => typeof v !== 'string' || !VERSION_RE.test(v))) {
    out.push('its "also" is not a list of versions like 0.6.98');
  } else if (version && typeof obj.version === 'string' && VERSION_RE.test(obj.version)
      && obj.version !== version && !also.includes(version)) {
    out.push('it is for ' + [obj.version, ...also].join(' and ') + ', not ' + version);
  }
  const h = obj.highlights;
  if (!Array.isArray(h) || h.length < 1) { out.push('it has no highlights (1 to ' + MAX_HIGHLIGHTS + ')'); return out; }
  if (h.length > MAX_HIGHLIGHTS) out.push('it has ' + h.length + ' highlights; the window shows at most ' + MAX_HIGHLIGHTS);
  h.forEach((x, i) => {
    const n = 'highlight ' + (i + 1);
    if (!x || typeof x !== 'object') { out.push(n + ' is not an object'); return; }
    if (!ICONS.includes(x.icon)) out.push(n + '\'s icon "' + x.icon + '" is not one the app draws (' + ICONS.join(', ') + ')');
    for (const [key, max] of [['title', MAX_TITLE], ['line', MAX_LINE]]) {
      const v = x[key];
      if (typeof v !== 'string' || !v.trim()) { out.push(n + ' has no ' + key); continue; }
      if (v.length > max) out.push(n + '\'s ' + key + ' is ' + v.length + ' characters (at most ' + max + ')');
      if (EM_DASH.test(v)) out.push(n + '\'s ' + key + ' has an em dash');
    }
  });
  return out;
}

/**
 * The highlights to show for `version`, or null: null when there is no file, it cannot be read,
 * it is for another version (last release's text can never appear), or it has any problem.
 */
function read(version, file) {
  const at = file || fileForTests || FILE;
  let raw;
  try { raw = fs.readFileSync(at, 'utf8'); } catch (e) {
    if (!e || e.code !== 'ENOENT') logOnce(at + ' could not be read (' + ((e && e.code) || 'unknown') + ')');
    return null;
  }
  let obj;
  try { obj = JSON.parse(raw); } catch { logOnce(at + ' is not valid JSON'); return null; }
  if (!version) return null;
  const bad = problems(obj, version);
  if (bad.length) {
    // Another version's file is the ordinary state between cuts, so it is not logged; a broken one is.
    if (!(bad.length === 1 && /^it is for /.test(bad[0]))) logOnce(at + ': ' + bad[0]);
    return null;
  }
  return obj.highlights.map((x) => ({ icon: x.icon, title: x.title.trim(), line: x.line.trim() }));
}

/**
 * #4928: which highlights `version` would show, as the file's main "version", or null. Two numbers in one
 * file's "also" show the SAME words, so the board records this key when a window is dismissed and does not
 * open the same words again on the next number (Windows on 0.7.13, then 0.7.16, from one file).
 */
function key(version, file) {
  if (!read(version, file)) return null;
  try { return JSON.parse(fs.readFileSync(file || fileForTests || FILE, 'utf8')).version; } catch { return null; }
}

/* Round 12: a highlights file that exists but cannot be shown leaves one line in the board's log (once
   per problem, not per page load), so a window that did not appear can be traced. */
let lastLogged = null;
function logOnce(line) {
  if (line === lastLogged) return;
  lastLogged = line;
  try { console.warn('whats-new: ' + line); } catch { /* no console */ }
}
function setFileForTests(f) { fileForTests = f || null; lastLogged = null; }

module.exports = { FILE, ICONS, MAX_HIGHLIGHTS, MAX_TITLE, MAX_LINE, VERSION_RE, problems, read, key, setFileForTests };
