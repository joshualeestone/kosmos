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

/** Every problem with a parsed file, as sentences; an empty list means it is good for `version`. */
function problems(obj, version) {
  const out = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['it is not a JSON object'];
  if (typeof obj.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(obj.version)) out.push('its "version" is not a version like 0.6.98');
  else if (version && obj.version !== version) out.push('it is for ' + obj.version + ', not ' + version);
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
  let obj;
  try { obj = JSON.parse(fs.readFileSync(file || fileForTests || FILE, 'utf8')); } catch { return null; }
  if (!version || problems(obj, version).length) return null;
  return obj.highlights.map((x) => ({ icon: x.icon, title: x.title.trim(), line: x.line.trim() }));
}

function setFileForTests(f) { fileForTests = f || null; }

module.exports = { FILE, ICONS, MAX_HIGHLIGHTS, MAX_TITLE, MAX_LINE, problems, read, setFileForTests };
