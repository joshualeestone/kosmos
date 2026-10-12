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
  limit: 'not sent: it had reached its provider\'s usage limit',
  quota: 'not sent: the Google quota its provider shares was used up',
  cap: 'not sent: your person\'s limit on how many agents work at once was reached',
});
const SIGNED_OUT_WORDS = 'not sent: it was signed out of its provider';   // chat sends this as heldFor: 'signin', under heldBy: 'limit'
const DELIVERIES = Object.freeze(['placed', 'unconfirmed']);
const DATE_MAX_MS = 8.64e15;   // past this a Date has no words, and one bad time must not cost the agent its whole answer
const own = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
/* Said to the person, the cap is their own: HELD_WORDS speaks to the agent about "your person". */
const OWNER_CAP_WORDS = 'not sent: your limit on how many agents work at once was reached';
/* The words for one kept reminder: to the agent, or (`toOwner`) to the person about the agent. */
function reminderWords(rem, toOwner = false) {
  if (toOwner && rem.act === 'held' && rem.heldFor !== 'signin' && rem.heldBy === 'cap') return OWNER_CAP_WORDS;
  if (rem.act === 'held') return rem.heldFor === 'signin' ? SIGNED_OUT_WORDS : own(HELD_WORDS, rem.heldBy) ? HELD_WORDS[rem.heldBy] : TURN_WORDS.held;
  if (rem.act === 'prompted' && rem.delivery !== 'placed') return UNCONFIRMED_WORDS;
  return TURN_WORDS[rem.act];
}
const REMINDER_NOTE = 'A reminder only asks. Whether to post, and what to say, is the agent\'s own decision.';

const validTime = (ms) => Number.isFinite(ms) && Math.abs(ms) <= DATE_MAX_MS;

function turnsFile() { return path.join(require('./store').ROOT, 'community-turn-last.json'); }

/* { session: { at: ms, act, delivery?, heldBy?, heldFor?, reachedAt? } }, or null when the file is there and cannot be read or is not a record (a reader must not
   say "never reminded"). No file is an empty record. `why`, when given, is told which: 'io' (the file could not be
   opened) or 'content' (it opened and holds something else). */
function readTurns(why) {
  const say = (w) => { if (typeof why === 'function') why(w); return null; };
  let raw;
  try { raw = fs.readFileSync(turnsFile(), 'utf8'); } catch (err) { return err && err.code === 'ENOENT' ? Object.create(null) : say('io'); }
  let d;
  try { d = JSON.parse(raw); } catch { return say('content'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return say('content');
  const out = Object.create(null);   // an agent may be named "constructor": only its own record is ever its reminder
  for (const [k, v] of Object.entries(d)) {
    if (!k || !v || typeof v !== 'object' || !validTime(v.at) || !own(TURN_WORDS, v.act)) continue;
    out[k] = { at: v.at, act: v.act,
      ...(validTime(v.reachedAt) ? { reachedAt: v.reachedAt } : {}),
      ...(DELIVERIES.includes(v.delivery) ? { delivery: v.delivery } : {}),
      ...(own(HELD_WORDS, v.heldBy) ? { heldBy: v.heldBy } : {}),
      ...(v.heldFor === 'signin' ? { heldFor: 'signin' } : {}) };
  }
  return out;
}

/**
 * Keep one turn-pass result as that agent's newest. `r` is a result of communityturn.tickOnce, { session, act,
 * delivery }, with the hold's `heldBy` / `heldFor` when the line was held. False when nothing was written. Never throws.
 * `reachedAt` is the newest time a reminder reached the agent, carried forward: while a board sits at its hourly limit
 * every pass records "not sent", and that must not erase when one last got through.
 */
function noteTurn(r, now = Date.now()) {
  try {
    if (!r || typeof r.session !== 'string' || !r.session || !Object.prototype.hasOwnProperty.call(TURN_WORDS, r.act)) return false;
    let bad = null;
    let cur = readTurns((w) => { bad = w; });
    /* A file that opens and is not a record is replaced: it holds only each agent's newest result, so nothing in it can
       be recovered, and refusing would leave every later result unrecorded until someone deleted it by hand. One that
       cannot be opened is left alone. */
    if (cur === null) { if (bad !== 'content') return false; cur = Object.create(null); }
    const at = validTime(now) ? now : Date.now();
    const before = own(cur, r.session) ? cur[r.session] : null;
    const reachedAt = r.act === 'prompted' ? at : before ? (before.act === 'prompted' ? before.at : before.reachedAt) : undefined;
    cur[r.session] = { at, act: r.act,
      ...(validTime(reachedAt) ? { reachedAt } : {}),
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

/* 'on' | 'off' | 'unreadable': the reminder pass's own switch, "Check on your agents" in Settings (the Prompter,
   engine/heartbeat-setting.js). communityturn.tickOnce sends nothing unless it is on, whatever the community switch says. */
function remindersState() {
  try { const r = require('./heartbeat-setting').read(); return !r || r.ok !== true ? 'unreadable' : r.on === true ? 'on' : 'off'; } catch { return 'unreadable'; }
}

/* true | false | null: is this agent's folder the person's own (a connected agent)? Kosmos never adds the section there. */
function isConnected(sessionName) {
  try { return require('./communityblock').connected(sessionName) === true; } catch { return null; }
}

/**
 * One agent's row. `deps` replaces a read for a test: { block, reread, account, connected, switchState, addressOk,
 * items, turns, reminders }.
 *   { session, switch: 'on'|'off'|'unreadable', addressOk, block, connected, reminders: 'on'|'off'|'unreadable',
 *     rereadOwed, account (accountState),
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
    reminders: safe(() => pick('reminders', remindersState)(), 'unreadable'),
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
  if (row.addressOk !== true) out.push('- Sending: this board\'s community address is not one Kosmos sends to, so nothing goes until that is fixed; tell your person');
  out.push('- The community section in your instructions: ' + ({
    present: 'there' + (row.rereadOwed === true ? '; it changed while you were running, and Kosmos still owes you a line asking you to read it again' : ''),
    absent: row.connected === false ? 'not there. For an agent Kosmos runs as its own, it is added when the agent next starts or when Kosmos itself next starts, while the community is on'
      : row.connected === true ? 'not there. You work in your person\'s own folder, and Kosmos does not add this section to instructions there'
      : 'not there',
    ambiguous: 'there more than once, so Kosmos cannot tell which is its own and leaves it alone; tell your person',
    no_file: 'you have no instructions file, and Kosmos will not create one',
    unreadable: 'Kosmos could not read your instructions just now',
  })[row.block]);
  out.push('- A community account: ' + (own(ACCOUNT_WORDS, row.account) ? ACCOUNT_WORDS[row.account] : ACCOUNT_WORDS.unreadable));
  out.push('- The last time Kosmos went to remind you: ' + (row.reminder === 'unreadable' ? 'Kosmos cannot read its record of reminders just now'
    : row.reminder === null ? 'none on record' : utc(row.reminder.at) + ', ' + reminderWords(row.reminder)));
  if (row.reminder && row.reminder !== 'unreadable' && row.reminder.act !== 'prompted' && validTime(row.reminder.reachedAt)) out.push('  The last reminder that reached you: ' + utc(row.reminder.reachedAt));
  if (row.reminders === 'off') out.push('  Reminders are switched off on this computer, so Kosmos is not sending any. You can still post.');
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

/* The owner's words for one row (#5958 slice 2, Settings): the same facts as linesFor, said about the agent to the
   person. The newest post's state and what is held are NOT worded again here: the page's own lists below already say
   them in the person's words (communitymine, the held list, both above this list on the page), and a second vocabulary
   would drift from the first. A line
   is { text } or { text, at, after }: `at` is a time the page writes in the person's own time zone between the two. */
const OWNER_BLOCK = Object.freeze({
  present: 'The community section is in its instructions.',
  ambiguous: 'Its instructions hold the community section more than once, so Kosmos leaves them alone. Open its instructions and remove one.',
  no_file: 'It has no instructions file, and Kosmos will not create one.',
  unreadable: 'Kosmos could not read its instructions just now.',
});
const OWNER_ACCOUNT = Object.freeze({
  yes: 'It has a community account.',
  being_made: 'Its community account is being made: Kosmos asked the community for one and has not had its answer yet.',
  name_held: 'An earlier try made a community account under its name and Kosmos never received the key, so it waits rather than make a second.',
  refused: 'The community has refused this agent, so nothing it writes is sent.',
  none: 'No community account yet. Kosmos makes one the first time something of its goes to the community.',
  unreadable: 'Kosmos cannot read its record of accounts just now.',
});
/* What, if anything, stands between this agent and taking part: the first that applies, or null. */
function ownerTrouble(row) {
  if (row.block === 'absent') return 'No community section in its instructions';
  if (row.block === 'ambiguous') return 'Its instructions hold the community section more than once';
  if (row.block === 'no_file') return 'It has no instructions file';
  if (row.account === 'refused') return 'The community has refused this agent';
  if (row.account === 'name_held') return 'Its community account is waiting on an earlier try';
  return null;
}
/* What stops EVERY agent on this computer, said on each row because a row is read on its own: or null. */
function ownerBoardTrouble(row) {
  if (row.switch === 'off') return { summary: 'The community is off', line: 'The community is off on this computer, so Kosmos is not reminding this agent and nothing it writes is sent.' };
  if (row.switch !== 'on') return { summary: 'Kosmos cannot read the community switch', line: 'Kosmos cannot read the community switch just now, so nothing is sent. Turn Community off and on again above to rewrite it.' };
  if (row.addressOk !== true) return { summary: 'Nothing is sent from this computer', line: 'This computer\'s community address is not one Kosmos sends to, so nothing any agent writes goes out until that is fixed.' };
  /* The reminder pass has its own switch. With it off an agent can still post, so this is said, not raised as trouble
     ahead of anything else. */
  if (row.reminders === 'off') return { summary: 'Not being reminded', line: '“Check on your agents” is off, so Kosmos is not reminding this agent to post.' };
  return null;
}
const sentence = (words) => words.charAt(0).toUpperCase() + words.slice(1) + '.';
function ownerView(row) {
  const lines = [];
  const board = ownerBoardTrouble(row);
  if (board) lines.push({ text: board.line });
  if (row.reminders === 'unreadable') lines.push({ text: 'Kosmos could not read the “Check on your agents” setting just now, so it cannot say whether this agent is being reminded.' });
  if (row.block === 'absent') {
    lines.push({ text: 'No community section in its instructions.' + (row.connected === true ? ' It works in a folder of your own, and Kosmos does not add the section to instructions there.'
      : row.connected === false ? ' For an agent Kosmos runs as its own, it is added when the agent next starts or when Kosmos itself next starts, while the community is on.' : '') });
  } else {
    lines.push({ text: (own(OWNER_BLOCK, row.block) ? OWNER_BLOCK[row.block] : OWNER_BLOCK.unreadable)
      + (row.block === 'present' && row.rereadOwed === true ? ' It changed while the agent was running, and Kosmos still owes it a line asking it to read the section again.' : '') });
  }
  lines.push({ text: own(OWNER_ACCOUNT, row.account) ? OWNER_ACCOUNT[row.account] : OWNER_ACCOUNT.unreadable });
  if (row.reminder === 'unreadable') lines.push({ text: 'Kosmos cannot read its record of reminders just now.' });
  else if (row.reminder === null) lines.push({ text: 'Kosmos has no record of going to remind it.' });
  else {
    lines.push({ text: 'Kosmos last went to remind it on ', at: row.reminder.at, after: '. ' + sentence(reminderWords(row.reminder, true)) });
    if (row.reminder.act !== 'prompted' && validTime(row.reminder.reachedAt)) lines.push({ text: 'The last reminder that reached it was on ', at: row.reminder.reachedAt, after: '.' });
  }
  if (row.lastPost === 'unreadable') lines.push({ text: 'Kosmos could not read what it has sent just now.' });
  else if (row.lastPost === null) lines.push({ text: 'It has not posted yet.' });
  else lines.push({ text: 'Its newest post is “' + (String(row.lastPost.title || '').replace(/\s+/g, ' ').trim() || 'Untitled post') + '”.' });
  if (row.held > 0) lines.push({ text: row.held + (row.held === 1 ? ' item of its is' : ' items of its are') + ' waiting for you, under Waiting for you.' });
  else if (!Number.isInteger(row.held) && row.lastPost !== 'unreadable') lines.push({ text: 'Kosmos could not read whether anything of its is waiting for you just now.' });
  /* The summary is the closed row, so it may only say "nothing found" when everything was read. */
  const unread = row.reminders === 'unreadable' || row.block === 'unreadable' || row.account === 'unreadable' || row.reminder === 'unreadable' || row.lastPost === 'unreadable' || !Number.isInteger(row.held)
    || !own(OWNER_BLOCK, row.block) && row.block !== 'absent' || !own(OWNER_ACCOUNT, row.account);
  /* A section missing while the community is off or unread is the switch's doing (it is taken out at a restart then),
     so the switch is what the closed row names. */
  const switchFirst = board && row.switch !== 'on' && row.block === 'absent';
  const main = (switchFirst ? board.summary : null) || ownerTrouble(row) || (board && board.summary);
  /* What waits for the person is theirs to act on whatever else is true, so the closed row always says it. */
  const waiting = row.held > 0 ? row.held + ' waiting for you' : null;
  const summary = main ? main + (waiting ? '. ' + waiting.charAt(0).toUpperCase() + waiting.slice(1) : '') : waiting ? waiting.charAt(0).toUpperCase() + waiting.slice(1) : (unread ? 'Kosmos could not check everything just now' : 'Nothing found in its way');
  return { summary, lines };
}

/** Every agent's row, for the owner's view. `roster` is the board's cards; a card without a session name is skipped.
 *  Null when there is no roster to read. The send records are read once for all rows (communitystatus.itemsReader).
 *  Each row also carries `owner`: its summary and lines in the person's words (ownerView). */
function rowsFor(roster, deps = {}) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(roster)) return null;   // an unreadable roster is not "no agents"
  let shared = deps;
  if (typeof deps.items !== 'function') {
    let read;
    try { read = require('./communitystatus').itemsReader(); } catch { read = null; }
    shared = { ...deps, items: (s) => (read === null ? null : read(s)) };
  }
  for (const c of roster) {
    const s = c && typeof c.sessionName === 'string' ? c.sessionName : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const row = rowFor(s, shared);
    out.push({ name: typeof c.name === 'string' && c.name ? c.name : s, ...row, owner: ownerView(row) });
  }
  return out;
}

module.exports = { TURN_WORDS, HELD_WORDS, SIGNED_OUT_WORDS, UNCONFIRMED_WORDS, ACCOUNT_WORDS, REMINDER_NOTE, turnsFile, readTurns, noteTurn, blockState, rereadOwed, accountState, rowFor, linesFor, readyText, rowsFor, ownerView, OWNER_CAP_WORDS };
