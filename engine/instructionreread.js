'use strict';
/**
 * kosmos#5297 (and #4890's running-agent half): telling a RUNNING agent that a section of its instructions file changed.
 *
 * An agent reads its instructions file once, when its session starts (engine/instructions.js), so a section rewritten
 * while it runs reaches it only at its next restart. A user's 0.7.22 report (Josh, 2026-10-05) found five running agents
 * still following the community rules and the CLI text they started with, days after both changed. Kosmos now writes two
 * such changes while agents run, and each one owes the agent a line telling it to read that section again:
 *   - community: the Kosmos+ community block, refreshed at every board start (communityblock.refreshEveryone);
 *   - rules: the working rules, rewritten only when the person accepts the refresh (engine/doctrine.js refresh, #539).
 *
 * chat drops a line it cannot place (the shared-quota hold, a busy or unreachable pane), so the debt is kept on disk
 * until a line lands (PLACED or UNCONFIRMED), and the board retries it. { session: { at, sections: [...] } }, atomic tmp +
 * rename; an unreadable or odd file reads as empty. A debt older than GIVE_UP_MS is dropped: by then the agent has
 * almost certainly restarted and read the file itself.
 */
const fs = require('node:fs');
const path = require('node:path');

const GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;
const SECTIONS = Object.freeze({
  community: 'the section headed "The Kosmos+ community"',
  rules: 'the working rules (Kosmos updated them with your person\'s OK)',
});

function file() { return path.join(require('./store').ROOT, 'instruction-reread.json'); }

function readOwed() {
  try {
    const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
    const out = {};
    for (const [k, v] of Object.entries(d)) {
      if (!k || !v || typeof v !== 'object' || !Number.isFinite(v.at) || !Array.isArray(v.sections)) continue;
      const sections = v.sections.filter((s) => Object.prototype.hasOwnProperty.call(SECTIONS, s));
      if (sections.length) out[k] = { at: v.at, sections };
    }
    return out;
  } catch { return {}; }
}

function writeOwed(owed) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(owed) + '\n');
    fs.renameSync(tmp, file());
    return true;
  } catch { return false; }
}

/* Pure: the map with `section` owed to `session`. The first debt's time is kept, so a section owed again does not
   postpone giving up. */
function owe(owed, session, section, now = Date.now()) {
  if (!session || !Object.prototype.hasOwnProperty.call(SECTIONS, section)) return { ...owed };
  const cur = owed[session];
  const sections = cur ? [...new Set([...cur.sections, section])] : [section];
  return { ...owed, [session]: { at: cur ? cur.at : now, sections } };
}

/* Read, owe and write in one step, for a caller that is not holding the map. */
function oweNow(session, section, now = Date.now()) {
  return writeOwed(owe(readOwed(), session, section, now));
}

/* Pure: the map after one delivery verdict. A line that landed clears the agent's whole debt (it named every section
   owed); anything else keeps it, until GIVE_UP_MS. */
function settle(owed, session, verdict, DELIVERY, now = Date.now()) {
  const next = { ...owed };
  const state = verdict && verdict.state;
  const landed = Boolean(DELIVERY) && (state === DELIVERY.PLACED || state === DELIVERY.UNCONFIRMED)
    && !(verdict && (verdict.held === true || verdict.busy === true));
  if (landed || !next[session] || now - next[session].at > GIVE_UP_MS) delete next[session];
  return next;
}

/* The one line for an agent's debt, naming every section it owes. */
function lineFor(sections) {
  const named = (Array.isArray(sections) ? sections : []).filter((s) => Object.prototype.hasOwnProperty.call(SECTIONS, s));
  if (!named.length) return null;
  const list = named.map((s) => SECTIONS[s]);
  const what = list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  return 'Kosmos here: your instructions file has changed since you started. Read ' + what + ' in it again now. '
    + 'What it says now replaces what you read when you started.';
}

module.exports = { GIVE_UP_MS, SECTIONS, file, readOwed, writeOwed, owe, oweNow, settle, lineFor };
