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
  held: 'not sent: Kosmos is holding its messages to this agent for now',
  limit: 'not sent: this board had reached its hourly limit for messages to agents',
});
/* `prompted` covers a paste Kosmos saw land and one it could not confirm (communityturn counts both as reached). */
const UNCONFIRMED_WORDS = 'sent, but Kosmos could not confirm it arrived';
/* Why a line was held (chat.deliverAutomatic's heldBy / heldFor). A reason outside this set gets TURN_WORDS.held. */
const HELD_WORDS = Object.freeze({
  menu: 'not sent: a question on its screen was waiting for an answer',
  signin: 'not sent: it was signed out of its provider',
  limit: 'not sent: it had reached its provider\'s usage limit',
  quota: 'not sent: the Google quota its provider shares was used up',
  cap: 'not sent: your person\'s limit on how many agents work at once was reached',
});
const DELIVERIES = Object.freeze(['placed', 'unconfirmed']);
const own = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
/* The words for one kept reminder. */
function reminderWords(rem) {
  if (rem.act === 'held') return (rem.heldFor === 'signin' ? HELD_WORDS.signin : own(HELD_WORDS, rem.heldBy) ? HELD_WORDS[rem.heldBy] : null) || TURN_WORDS.held;
  if (rem.act === 'prompted' && rem.delivery !== 'placed') return UNCONFIRMED_WORDS;
  return TURN_WORDS[rem.act];
}
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
  const out = Object.create(null);   // an agent may be named "constructor": only its own record is ever its reminder
  for (const [k, v] of Object.entries(d)) {
    if (!k || !v || typeof v !== 'object' || !Number.isFinite(v.at) || !own(TURN_WORDS, v.act)) continue;
    out[k] = { at: v.at, act: v.act,
      ...(DELIVERIES.includes(v.delivery) ? { delivery: v.delivery } : {}),
      ...(own(HELD_WORDS, v.heldBy) ? { heldBy: v.heldBy } : {}),
      ...(v.heldFor === 'signin' ? { heldFor: 'signin' } : {}) };
  }
  return out;
}

/**
 * Keep one turn-pass result as that agent's newest. `r` is a result of communityturn.tickOnce, { session, act,
 * delivery }, with the hold's `heldBy` / `heldFor` when the line was held. False when nothing was written. Never throws.
 */
function noteTurn(r, now = Date.now()) {
  try {
    if (!r || typeof r.session !== 'string' || !r.session || !Object.prototype.hasOwnProperty.call(TURN_WORDS, r.act)) return false;
    const cur = readTurns();
    if (cur === null) return false;
    cur[r.session] = { at: Number.isFinite(now) ? now : Date.now(), act: r.act,
      ...(DELIVERIES.includes(r.delivery) ? { delivery: r.delivery } : {}),
      ...(own(HELD_WORDS, r.heldBy) ? { heldBy: r.heldBy } : {}),
      ...(r.heldFor === 'signin' ? { heldFor: 'signin' } : {}) };
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
    const mine = own(owed, sessionName) ? owed[sessionName] : null;
    return Boolean(mine && mine.sections.includes('community'));
  } catch { return null; }
}

/* 'yes' | 'being_made' | 'name_held' | 'refused' | 'none' | 'unreadable': this agent's account at the community address
   this board sends to, from that address's keys (the record communitystatus reads). Not communitysend.hasAccount: that
   one answers a delete's confirmation, and counts an unreadable file, another address and a refused account as yes. */
function accountState(sessionName) {
  let raw;
  try { raw = fs.readFileSync(require('./communitysend')._paths.keysFile(), 'utf8'); } catch (err) { return err && err.code === 'ENOENT' ? 'none' : 'unreadable'; }
  let keys;
  try { keys = JSON.parse(raw); } catch { return 'unreadable'; }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return 'unreadable';
  const k = own(keys, sessionName) ? keys[sessionName] : null;
  if (!k || typeof k !== 'object') return 'none';
  if (k.refused) return 'refused';
  if (k.apiKey) return 'yes';
  if (k.registering) return k.registering.taken ? 'name_held' : 'being_made';
  return 'none';
}

/* true | false | null: is this agent's folder the person's own (a connected agent)? Kosmos never adds the section there. */
function isConnected(sessionName) {
  try { return require('./communityblock').connected(sessionName) === true; } catch { return null; }
}

/**
 * One agent's row. `deps` replaces a read for a test: { block, reread, account, connected, switchState, addressOk,
 * items, turns }.
 *   { session, switch: 'on'|'off'|'unreadable', addressOk, block, connected, rereadOwed, account (accountState),
 *     reminder: { at, act, delivery?, heldBy?, heldFor? } | null | 'unreadable',
 *     lastPost: { title, at, state } | null | 'unreadable', held: n | null }
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
    connected: safe(() => pick('connected', isConnected)(session), null),
    account: safe(() => pick('account', accountState)(session), 'unreadable'),
    reminder: turns === null ? 'unreadable' : (own(turns, session) ? turns[session] : null),
    lastPost: posts === null ? 'unreadable' : (posts.length ? { title: posts[0].title, at: posts[0].at, state: posts[0].state } : null),
    held: Array.isArray(items) ? items.filter((x) => x && x.state === 'held').length : null,
  };
}

const ACCOUNT_WORDS = Object.freeze({
  yes: 'yes',
  being_made: 'being made: Kosmos asked the community for one and has not had its answer yet',
  name_held: 'waiting: an earlier try made one under your name and Kosmos never received its key, so it waits rather than make a second',
  refused: 'the community has refused this agent, so nothing it writes is sent',
  none: 'not yet. Kosmos makes one the first time something of yours goes to the community',
  unreadable: 'Kosmos cannot read its record of accounts just now, so it cannot say',
});
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
    absent: row.connected === false ? 'not there. Kosmos adds it when you next start, or when Kosmos itself next starts, while the community is on'
      : row.connected === true ? 'not there. You work in your person\'s own folder, and Kosmos does not add this section to instructions there'
      : 'not there',
    ambiguous: 'there more than once, so Kosmos cannot tell which is its own and leaves it alone; tell your person',
    no_file: 'you have no instructions file, and Kosmos will not create one',
    unreadable: 'Kosmos could not read your instructions just now',
  })[row.block]);
  out.push('- A community account: ' + (own(ACCOUNT_WORDS, row.account) ? ACCOUNT_WORDS[row.account] : ACCOUNT_WORDS.unreadable));
  out.push('- The last reminder from Kosmos: ' + (row.reminder === 'unreadable' ? 'Kosmos cannot read its record of reminders just now'
    : row.reminder === null ? 'none on record' : utc(row.reminder.at) + ', ' + reminderWords(row.reminder)));
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

/** Every agent's row, for the owner's view. `roster` is the board's cards; a card without a session name is skipped.
 *  Null when there is no roster to read. */
function rowsFor(roster, deps) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(roster)) return null;   // an unreadable roster is not "no agents"
  for (const c of roster) {
    const s = c && typeof c.sessionName === 'string' ? c.sessionName : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push({ name: typeof c.name === 'string' && c.name ? c.name : s, ...rowFor(s, deps) });
  }
  return out;
}

module.exports = { TURN_WORDS, HELD_WORDS, UNCONFIRMED_WORDS, ACCOUNT_WORDS, REMINDER_NOTE, turnsFile, readTurns, noteTurn, blockState, rereadOwed, accountState, rowFor, linesFor, readyText, rowsFor };
