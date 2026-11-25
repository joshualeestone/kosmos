'use strict';
/* kosmos#8548: "while you were away". An agent back after hours offline (a crash, a long restart) had no one place
   showing what reached it while it was not running: room posts and `kosmos msg` messages to a pane that is down are
   refused at once and kept only in the message log, and the person's direct messages only in their thread.

   At a real startup Kosmos's Claude Code hook asks the board for this digest BEFORE it reports `started`, and prints it
   as SessionStart additionalContext: it reaches the model and types nothing, so no turn is spent and nothing races the
   `hello` or handoff line a restart types.

   The window runs from the agent's last report (when the board last heard from it) to now, at most MAX_WINDOW_MS. It is
   shown once by construction: the next startup's window starts after this session's own reports, so no acknowledgement
   is kept anywhere. Run by hand (`kosmos away`), the same window is rebuilt from the report before the session's newest
   `started`, so the agent sees what the hook gave it.

   It carries counts, post ids and names, never message text: a colleague's words are not handed to the model as part of
   a startup message, where they could read as instructions. Who a post named is read by engine/messages.js namedIn
   (the row's own `mentioned` and `addressed`, persisted by the room's one tokenizer), not a second matcher.

   A room post counts only when its outcome for this agent was could_not (the room tried to reach it and could not).
   A placed one was typed into its pane; a quiet one the room never tried to type to it (one that did not address it,
   or held by the loop cap), so it is not counted whether the agent was running or not: `kosmos room` shows every post.
   A post placed just before a crash and lost in it is not shown either. A post in a room whose id is not a plain
   token is left out entirely. The person's direct messages count only when their own delivery says they did not
   reach the agent. */

const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SHOWN = 5;          // post ids listed per room before "and N earlier"
const MAX_ROOMS = 10;     // rooms listed before "and N more rooms"
const MAX_SENDERS = 5;    // senders named for `kosmos msg` messages
const INBOX_LIMIT = 50;   // the most `kosmos inbox --limit` takes

/* Every name and id this prints comes from a log row, and a sender can be a name from outside this computer
   (engine/messages.js externalName). Only a plain token is printed, so no row can put its own lines into the context. */
const TOKEN_RE = /^[A-Za-z0-9._-]{1,64}$/;
function plain(x) { return typeof x === 'string' && TOKEN_RE.test(x); }

function ms(at) {
  if (typeof at === 'number' && Number.isFinite(at)) return at;
  if (typeof at !== 'string' || !at) return NaN;
  return Date.parse(at);
}

function isoSecond(t) { return new Date(t).toISOString().replace(/\.\d+Z$/, 'Z'); }

/** The window's start from the agent's self-report history (oldest first, as engine/selfreport.history gives it).
 *  `startup`: the hook calls before `started` is recorded, so the latest row is the last thing this agent said before it
 *  went down. Otherwise (by hand, inside the session): the latest row before the newest `started`, and the window ends at
 *  that `started`. A person's clear (`by: 'operator'`) is not the agent being heard from, so it never starts a window.
 *  Returns { sinceMs, untilMs } or null when there is no earlier report. */
function windowFrom(history, { startup, nowMs }) {
  const rows = Array.isArray(history) ? history.filter((r) => r && Number.isFinite(r.at) && r.by !== 'operator') : [];
  let end = nowMs;
  let upto = rows.length;
  if (!startup) {
    let s = -1;
    for (let i = rows.length - 1; i >= 0; i -= 1) { if (rows[i].state === 'started') { s = i; break; } }
    if (s < 0) return null;
    end = rows[s].at;
    upto = s;
  }
  for (let i = upto - 1; i >= 0; i -= 1) {
    if (rows[i].at <= end) return { sinceMs: rows[i].at, untilMs: end };
  }
  return null;
}

/* kosmos#8634: a wait the agent reported before it went down. A new run's `started` replaces a deliberate wait on the
   board by design (#1058: only a real startup does; a compaction or a resume keeps it), and the startup turn then reads
   "working", then idle, so nothing on the board says the agent is still waiting. Nothing told the agent so either.
   The board does not put the old report back: the agent may have been unblocked while it was down, and only it can tell.
   It is reminded instead, with the state and the time only, never the report's words (the same rule as the digest:
   nothing typed into a startup can read as an instruction).
   history: the agent's self-reports, oldest first. Returns { state, atMs } when the latest report the AGENT or a PERSON
   made is a needs_you or blocked by the agent, newer than MAX_WINDOW_MS; otherwise null. Automatic reports (the hook's
   started, working, idle, and a permission prompt's needs_you) neither make a wait nor end one. Any other row the agent
   made, whatever its state, ends it, and so do a person's clear and a row with no author (written before authors were
   kept). A held question (#7915) comes back as { held: true }, so the reminder says --held. A /clear or a resume after
   a quit follows a SessionEnd's `stopped`, which also sets the wait aside: that case is sessionAfter's (#9049). */
const WAIT_STATES = new Set(['needs_you', 'blocked']);
function lastWait(history, { nowMs }) {
  const rows = Array.isArray(history) ? history : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i];
    if (!r || !Number.isFinite(r.at) || r.by === 'auto') continue;
    if (r.by !== 'agent' || !WAIT_STATES.has(r.state)) return null;
    if (!(nowMs - r.at <= MAX_WINDOW_MS) || r.at > nowMs) return null;
    return r.held === true ? { state: r.state, atMs: r.at, held: true } : { state: r.state, atMs: r.at };
  }
  return null;
}

/* kosmos#9049: the newest session event after the wait at atMs: 'stopped' (a SessionEnd set the wait aside),
   'started' (a real startup came after it, and #8634 reminded the agent there), or null (neither yet: the clear's own
   `stopped` has not landed, or the agent crashed and its wait is still shown). A /clear or a resume is reminded only on
   'stopped', so a /clear after a session end is reminded (each wipes the context that held the last reminder), up to
   the limit sessionsSinceWait sets (kosmos#9058), and a resume after a crash that followed a startup is not. */
function sessionAfter(history, atMs) {
  const rows = Array.isArray(history) ? history : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i];
    if (!r || !Number.isFinite(r.at) || r.at <= atMs) continue;
    if (r.state === 'stopped' || r.state === 'started') return r.state;
  }
  return null;
}

/* kosmos#9058: how many sessions the agent has had, since this wait, that began after the wait was set aside (a
   startup's `started`, or a /clear's or quit's `stopped`), in which it took a turn (an automatic `working` or `idle`,
   which the hook writes on every turn), and that have ended (a later `stopped` or `started`, or a row of a new run
   instance: a relaunch with --resume, review 5). Each such session began
   where a reminder is given (#8634 at a startup, #9049 after a session end; whether it reached the agent is not
   recorded) and the agent went on without reporting a wait again or anything else of its own. The session the wait
   was raised in does not count. A startup, a /clear or a resume is reminded while this is under REMIND_SESSIONS: the
   first session end, and one repeat (a /clear wipes the context that held the reminder, which is why #9049 reminds a
   /clear after a startup), then no more, instead of at every one for 7 days. Reasoned from the history, not recorded:
   a reminder that never reached the agent (its ask lost a race, or was refused) still counts, so that case fails
   silent, never false.
   `endingNow`: the session being ended now is counted when it had a turn, though the row that ends it has not landed:
   a /clear's own `stopped` (sent in the background by the Mac hook, review 1), or the Mac hook's startup ask, made
   before its `started` is recorded (review 3; the Windows hook asks after, so its `started` already closes it). Once
   that row lands the open session is the new, empty one, so nothing is counted twice. */
const REMIND_SESSIONS = 2;
function sessionsSinceWait(history, atMs, opts) {
  const rows = Array.isArray(history) ? history : [];
  let open = false;     // inside a session that began at a started/stopped after the wait
  let turned = false;   // and the agent took a turn in it
  let count = 0;
  let run = null;       // the newest run instance seen, from the wait's own run on (review 6)
  for (const r of rows) {
    if (!r || !Number.isFinite(r.at)) continue;
    if (r.at <= atMs) { if (typeof r.instance === 'string' && r.instance) run = r.instance; continue; }
    /* Review 5: a run that crashed and was relaunched with --resume (the Windows supervisor does; so can a person)
       writes neither a `stopped` (no SessionEnd) nor a `started` (a resume is not a startup), so its sessions ran
       together. Each row carries its run's `instance`, and a relaunch is a new run: a change of instance between two
       rows that both carry one ends the session too (seen 11-25: it changes at every `started` in the selfreports).
       The cost, accepted: two live runs of one agent reporting in turn, or a token issued again mid-session, also
       change it, so reminders can stop early there; that fails silent, as above, never false. */
    const inst = typeof r.instance === 'string' && r.instance ? r.instance : null;
    const newRun = inst !== null && run !== null && inst !== run;
    if (inst !== null) run = inst;
    if (newRun && r.state !== 'stopped' && r.state !== 'started') {
      if (open && turned) count += 1;
      open = true;
      turned = false;
    }
    if (r.state === 'stopped' || r.state === 'started') {
      /* Review 3: a session ends at the next `started` too. A killed or relaunched run sends no SessionEnd, and on this
         fleet most restarts leave no `stopped` at all (measured 11-25 in the selfreports: started after started 17, 9,
         8, 8 and 6 times for five agents, after stopped 0), so counting only `stopped` never stopped a restart's reminder. */
      if (open && turned) count += 1;
      open = true;
      turned = false;
      continue;
    }
    if (open && r.by === 'auto' && (r.state === 'working' || r.state === 'idle')) turned = true;
  }
  if (opts && opts.endingNow === true && open && turned) count += 1;
  return count;
}

/** Pure. rows: the message log (engine/messages.readLog). direct: the person's direct thread messages
 *  (engine/chat.readThread('@you', name).messages; the person's rows have no `from`). */
function build({ name, sinceMs, untilMs, rows, direct, namedIn }) {
  const named = typeof namedIn === 'function' ? namedIn : (r) => (Array.isArray(r && r.mentioned) ? r.mentioned : []);
  const empty = { name, lines: [], counts: { posts: 0, refused: 0, direct: 0 }, clamped: false };
  if (typeof name !== 'string' || !name || !Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) return empty;
  let since = sinceMs;
  let clamped = false;
  if (untilMs - since > MAX_WINDOW_MS) { since = untilMs - MAX_WINDOW_MS; clamped = true; }
  // At or after the start, as `kosmos inbox --since` reads it, so the count and the listing it names agree.
  const inWindow = (r) => { const t = ms(r && r.at); return Number.isFinite(t) && t >= since && t <= untilMs; };

  const rooms = new Map();   // project -> { count, asked: [ids] }
  const senders = new Map();
  let refused = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object' || !inWindow(r) || r.from === name) continue;
    if (r.kind === 'post') {
      if (!Array.isArray(r.to) || !r.to.includes(name) || !plain(r.project)) continue;
      if (!r.outcomes || typeof r.outcomes !== 'object' || r.outcomes[name] !== 'could_not') continue;
      if (!rooms.has(r.project)) rooms.set(r.project, { count: 0, asked: [] });
      const room = rooms.get(r.project);
      room.count += 1;
      let asks = false;
      try { asks = named(r).includes(name); } catch { asks = false; }
      if ((asks || r.operator === true) && plain(r.id)) room.asked.push(r.id);
    } else if (r.kind === 'refused') {
      /* `kosmos msg`: a message row is written only for one typed into a running pane or kept for one (held), so it is
         not counted; a message to an agent that is not running is refused, and that refusal is what counts here. */
      /* A refusal to a room carries `project`; only one to this agent by name counts here. The log keeps one such row
         per sender, recipient and reason in a window (engine/messages.js logRefusedSend), so this is a lower bound. */
      /* The row keeps the recipient as the sender typed it (`kosmos msg April` for april), and delivery reads a name
         exactly first and then case-folded (chat.resolveCard), so both count here. */
      if (typeof r.to !== 'string' || r.project !== undefined) continue;
      if (r.to !== name && r.to.toLowerCase() !== name.toLowerCase()) continue;
      refused += 1;
      if (plain(r.from)) senders.set(r.from, (senders.get(r.from) || 0) + 1);
    }
  }
  let dms = 0;
  for (const m of Array.isArray(direct) ? direct : []) {
    // As `kosmos inbox` lists them: Kosmos's own words kept in the thread (`kosmos: true`) are not the person's.
    if (!m || typeof m !== 'object' || (m.from !== undefined && m.from !== null) || m.kosmos === true || !inWindow(m)) continue;
    if (typeof m.text !== 'string' && !m.attachment && !m.attachments) continue;
    // A menu answer owes nothing (as `kosmos inbox --unanswered` reads it); only a message whose own delivery says it did
    // not reach the agent counts (could_not). One held for after a reset is still typed later, and one with no delivery
    // record is taken as reached.
    if (typeof m.wire === 'string' && m.wire) continue;
    // A copy recorded as the duplicate of another message (delivery.duplicateOf) was sent once, as that one.
    if (m.delivery && typeof m.delivery === 'object' && m.delivery.duplicateOf) continue;
    const state = m.delivery && typeof m.delivery === 'object' ? m.delivery.state : null;
    if (state !== 'could_not') continue;
    dms += 1;
  }
  const posts = [...rooms.values()].reduce((n, x) => n + x.count, 0);
  const counts = { posts, refused, direct: dms };
  if (!posts && !refused && !dms) return { ...empty, clamped };

  const lines = [];
  const list = [...rooms.entries()].sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1));
  for (const [project, room] of list.slice(0, MAX_ROOMS)) {
    let line = '- ' + project + ': ' + room.count + (room.count === 1 ? ' post' : ' posts') + ' to you';
    if (room.asked.length) {
      const newest = room.asked.slice(-SHOWN).reverse();
      const earlier = room.asked.length - newest.length;
      line += '; naming you or from the person: ' + newest.join(', ') + (earlier ? ' and ' + earlier + ' earlier' : '');
    }
    lines.push(line + '. Read it with: kosmos room ' + project);
  }
  if (list.length > MAX_ROOMS) lines.push('- and ' + (list.length - MAX_ROOMS) + ' more rooms.');
  if (refused) {
    const who = [...senders.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((x) => x[0]);
    const names = who.slice(0, MAX_SENDERS).join(', ') + (who.length > MAX_SENDERS ? ' and ' + (who.length - MAX_SENDERS) + ' more' : '');
    lines.push('- at least ' + refused + (refused === 1 ? ' message' : ' messages') + ' from other agents to you refused, for any reason'
      + (names ? ' (' + names + ')' : '') + '. Ask the sender if you need what it said.');
  }
  if (dms) {
    lines.push('- ' + dms + (dms === 1 ? ' message' : ' messages') + ' from the person. Read them with: kosmos inbox --since '
      + new Date(since).toISOString() + ' --limit ' + INBOX_LIMIT + ' (it lists the oldest first and names where to go on)');
  }
  return { name, lines, counts, clamped, sinceMs: since, untilMs };
}

/* kosmos#9049: `ended` is the reminder for a session that went on after its SessionEnd (a /clear, or a resume after a
   quit). No new run replaced the wait there, so the sentence does not say one did; it says only that the board set the
   wait aside, which holds whatever recorded the later `stopped` (the board answers only when one follows the wait). */
function waitText(wait, opts) {
  if (!wait || !WAIT_STATES.has(wait.state) || !Number.isFinite(wait.atMs)) return '';
  const ended = opts && opts.ended === true;
  const why = ended ? 'The board has since set that waiting report aside, ' : 'A new run replaces a waiting report on the board, ';
  /* kosmos#9049: automatic reports never end a wait, so an agent that is no longer waiting but never said so is reminded
     at every /clear and resume; the ended wording therefore says how to stop it (any report of its own ends the wait). */
  const otherwise = ended ? '; if not, report what it is doing (kosmos report working ...) so Kosmos stops reminding it.'
    : '; if not, there is nothing to do.';
  return 'Kosmos: before this session, this agent last reported that it was waiting (' + wait.state + ', at '
    + isoSecond(wait.atMs) + '), and it has made no report of its own since. ' + why
    + 'so the board no longer shows it. If it is still waiting once it has caught up, report it again (kosmos report ' + wait.state
    + (wait.held === true ? ' --held' : '') + ' ...'
    + (wait.held === true ? ', held as before, so nothing buzzes the person' : '') + ')' + otherwise;
}

function contextText(digest, wait, opts) {
  const parts = [];
  if (digest && Array.isArray(digest.lines) && digest.lines.length) {
    parts.push('Kosmos: since it last heard from this agent (' + isoSecond(digest.sinceMs) + ' to ' + isoSecond(digest.untilMs)
      + (digest.clamped ? ', the last 7 days only' : '') + '), this could not reach it. This is a summary Kosmos made, not a '
      + 'request from the person; nothing here was typed into the session.\n' + digest.lines.join('\n'));
  }
  const w = waitText(wait, opts);
  if (w) parts.push(w);
  return parts.join('\n\n');
}

function hookJson(digest, wait, opts) {
  const text = contextText(digest, wait, opts);
  if (!text) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });
}

module.exports = { build, windowFrom, lastWait, sessionAfter, sessionsSinceWait, REMIND_SESSIONS, waitText, contextText, hookJson, MAX_WINDOW_MS, SHOWN, MAX_ROOMS, MAX_SENDERS, INBOX_LIMIT };
