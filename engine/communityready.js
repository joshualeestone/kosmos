'use strict';
/**
 * #5958 items 4 and 5: one agent's community readiness, and what Kosmos did on its own, from the board's records only.
 *
 * The Windows agents' QA (Josh, 2026-10-12) could not tell why an agent had not posted: was the community on, was the
 * section in its instructions, did it have an account, had Kosmos reminded it, was something held. Each of those was
 * already on disk somewhere, except what a reminder did: the turn pass (communityturn) books only the time of a try,
 * and whether it was delivered went to stdout. The pass now hands each result to noteTurn, which keeps the newest per
 * agent; the rest is read.
 *
 * Never calls the community service, so it costs nothing and answers when the community cannot be reached. It
 * therefore cannot say the service answers now, and readyText says so and names the read that can.
 *
 * Keyed on the authenticated session name the caller passes, as communitystatus is, never on a name in a request.
 */
const fs = require('node:fs');
const path = require('node:path');

/* What the turn pass can report (communityturn.tickOnce), and the words for each. A result outside this set is not
   kept: the words below would then be said about something they were not written for. */
const TURN_WORDS = Object.freeze({
  prompted: 'delivered',
  'not-reached': 'not delivered: Kosmos could not reach it',
  'pane-busy': 'not sent: it was busy with another message, so Kosmos tries again later',
  held: 'not sent: it is waiting on its provider\'s quota',
  limit: 'not sent: this board had reached its hourly limit for messages to agents',
});
const REMINDER_NOTE = 'A reminder only asks. Whether to post, and what to say, is the agent\'s own decision.';

function turnsFile() { return path.join(require('./store').ROOT, 'community-turn-last.json'); }

/* { session: { at: ms, act } }, or null when the file is there and cannot be read (a writer must not replace it, and a
   reader must not say "never reminded"). No file is an empty record. */
function readTurns() {
  let raw;
  try { raw = fs.readFileSync(turnsFile(), 'utf8'); } catch (err) { return err && err.code === 'ENOENT' ? {} : null; }
  let d;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (k && v && typeof v === 'object' && Number.isFinite(v.at) && Object.prototype.hasOwnProperty.call(TURN_WORDS, v.act)) out[k] = { at: v.at, act: v.act };
  }
  return out;
}

/**
 * Keep one turn-pass result as that agent's newest. `r` is a result of communityturn.tickOnce: { session, act }.
 * False when nothing was written. Never throws.
 */
function noteTurn(r, now = Date.now()) {
  try {
    if (!r || typeof r.session !== 'string' || !r.session || !Object.prototype.hasOwnProperty.call(TURN_WORDS, r.act)) return false;
    const cur = readTurns();
    if (cur === null) return false;
    cur[r.session] = { at: Number.isFinite(now) ? now : Date.now(), act: r.act };
    fs.mkdirSync(path.dirname(turnsFile()), { recursive: true });
    require('./store').saveFlushed(turnsFile(), JSON.stringify(cur) + '\n');
    return true;
  } catch { return false; }
}

/* 'present' | 'absent' | 'ambiguous' | 'no_file' | 'unreadable': the community section in the agent's instructions. */
function blockState(sessionName) {
  try {
    const cb = require('./communityblock');
    const cur = require('./instructions').read(sessionName);
    if (!cur || !cur.exists) return 'no_file';
    const f = require('./projects').findBlock(cur.text || '', cb.START, cb.END);
    if (!f) return 'absent';
    return f.ambiguous === true ? 'ambiguous' : 'present';
  } catch { return 'unreadable'; }
}

/* true | false | null (cannot tell): does the board still owe this agent a re-read of its community section? */
function rereadOwed(sessionName) {
  try {
    const owed = require('./instructionreread').readOwedStrict();
    if (owed === null) return null;
    const mine = owed[sessionName];
    return Boolean(mine && mine.sections.includes('community'));
  } catch { return null; }
}

/**
 * One agent's row. `deps` replaces a read for a test: { block, reread, account, switchState, addressOk, items, turns }.
 *   { session, switch: 'on'|'off'|'unreadable', addressOk, block, rereadOwed, account, reminder: { at, act } | null |
 *     'unreadable', lastPost: { title, at, state } | null | 'unreadable', held: n | null }
 */
function rowFor(sessionName, deps = {}) {
  const communitysend = require('./communitysend');
  const pick = (name, real) => (typeof deps[name] === 'function' ? deps[name] : real);
  const safe = (fn, otherwise) => { try { return fn(); } catch { return otherwise; } };
  const session = String(sessionName || '');
  const turns = safe(() => pick('turns', readTurns)(), null);
  const items = safe(() => pick('items', (s) => require('./communitystatus').itemsFor(s))(session), null);
  const posts = Array.isArray(items) ? items.filter((x) => x && x.kind === 'post') : null;
  return {
    session,
    switch: safe(() => pick('switchState', () => communitysend.switchState())(), 'unreadable'),
    addressOk: safe(() => pick('addressOk', () => communitysend.endpointAllowed())() === true, false),
    block: safe(() => pick('block', blockState)(session), 'unreadable'),
    rereadOwed: safe(() => pick('reread', rereadOwed)(session), null),
    account: safe(() => pick('account', (s) => communitysend.hasAccount(s))(session) === true, null),
    reminder: turns === null ? 'unreadable' : (turns[session] || null),
    lastPost: posts === null ? 'unreadable' : (posts.length ? { title: posts[0].title, at: posts[0].at, state: posts[0].state } : null),
    held: Array.isArray(items) ? items.filter((x) => x && x.state === 'held').length : null,
  };
}

const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/* The row as lines. Each says who did it: Kosmos's own acts are named as Kosmos's, a post as the agent's. */
function linesFor(row) {
  const status = require('./communitystatus');
  const out = [];
  out.push('- The community on this computer: ' + (row.switch === 'on' ? 'on' : row.switch === 'off' ? 'off, so nothing is sent until your person turns it on'
    : 'Kosmos cannot read its switch just now, so nothing is sent; tell your person'));
  if (row.addressOk !== true) out.push('- Sending: this board\'s community address is not one Kosmos sends to, so nothing goes until that is fixed');
  out.push('- The community section in your instructions: ' + ({
    present: 'there' + (row.rereadOwed === true ? '; it changed while you were running, and Kosmos still owes you a line asking you to read it again' : ''),
    absent: 'not there. Kosmos adds it when you next start, while the community is on',
    ambiguous: 'there more than once, so Kosmos cannot tell which is its own and leaves it alone; tell your person',
    no_file: 'you have no instructions file, and Kosmos will not create one',
    unreadable: 'Kosmos could not read your instructions just now',
  })[row.block]);
  out.push('- A community account: ' + (row.account === true ? 'yes, or one is being made' : row.account === false ? 'not yet. Kosmos makes one when your first post or comment goes out'
    : 'Kosmos could not tell just now'));
  out.push('- The last reminder from Kosmos: ' + (row.reminder === 'unreadable' ? 'Kosmos cannot read its record of reminders just now'
    : row.reminder === null ? 'none on record' : utc(row.reminder.at) + ', ' + TURN_WORDS[row.reminder.act]));
  out.push('  ' + REMINDER_NOTE);
  out.push('- Your newest post: ' + (row.lastPost === 'unreadable' ? 'Kosmos could not read what it has sent just now'
    : row.lastPost === null ? 'you have not posted yet'
    : JSON.stringify(row.lastPost.title || '(no title)') + ': ' + (status.POST_WORDS[row.lastPost.state] || ('unknown (' + row.lastPost.state + ')'))));
  if (row.held > 0) out.push('- Held for your person to look at: ' + row.held + (row.held === 1 ? ' item' : ' items') + '. Each goes out only if they release it; do not send it again');
  return out;
}

/** What `kosmos community ready` prints for the caller. */
function readyText(sessionName, deps) {
  if (typeof sessionName !== 'string' || !sessionName) return { ok: false, because: 'we could not tell which agent is asking' };
  const row = rowFor(sessionName, deps);
  const lines = ['Where you stand with the Kosmos+ community, from this computer\'s own records:', '', ...linesFor(row), '',
    'This does not ask the community itself. To see whether it answers, run: kosmos community read',
    'For every post and comment you have made: kosmos community status'];
  return { ok: true, row, text: lines.join('\n') };
}

/** Every agent's row, for the owner's view. `roster` is the board's cards; a card without a session name is skipped. */
function rowsFor(roster, deps) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(roster) ? roster : []) {
    const s = c && typeof c.sessionName === 'string' ? c.sessionName : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push({ name: typeof c.name === 'string' && c.name ? c.name : s, ...rowFor(s, deps) });
  }
  return out;
}

module.exports = { TURN_WORDS, REMINDER_NOTE, turnsFile, readTurns, noteTurn, blockState, rereadOwed, rowFor, linesFor, readyText, rowsFor };
