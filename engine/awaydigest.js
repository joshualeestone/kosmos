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

   A post counts only when its outcome for this agent was could_not: one placed in a running pane, or left quiet for an
   idle one (roomhold), reached a running agent and is not "while it was not running". A post placed just before a
   crash and lost in it is therefore not shown. */

const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SHOWN = 5;          // post ids listed per room before "and N earlier"
const MAX_ROOMS = 10;     // rooms listed before "and N more rooms"
const MAX_SENDERS = 5;    // senders named for `kosmos msg` messages
const INBOX_LIMIT = 50;   // the most `kosmos inbox --limit` takes

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

/** Pure. rows: the message log (engine/messages.readLog). direct: the person's direct thread messages
 *  (engine/chat.readThread('@you', name).messages; the person's rows have no `from`). */
function build({ name, sinceMs, untilMs, rows, direct, namedIn }) {
  const named = typeof namedIn === 'function' ? namedIn : (r) => (Array.isArray(r && r.mentioned) ? r.mentioned : []);
  const empty = { name, lines: [], counts: { posts: 0, messages: 0, refused: 0, direct: 0 }, clamped: false };
  if (typeof name !== 'string' || !name || !Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) return empty;
  let since = sinceMs;
  let clamped = false;
  if (untilMs - since > MAX_WINDOW_MS) { since = untilMs - MAX_WINDOW_MS; clamped = true; }
  const inWindow = (r) => { const t = ms(r && r.at); return Number.isFinite(t) && t > since && t <= untilMs; };

  const rooms = new Map();   // project -> { count, asked: [ids] }
  const senders = new Map();
  let messages = 0;
  let refused = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object' || !inWindow(r) || r.from === name) continue;
    if (r.kind === 'post') {
      if (!Array.isArray(r.to) || !r.to.includes(name) || typeof r.project !== 'string') continue;
      if (!r.outcomes || typeof r.outcomes !== 'object' || r.outcomes[name] !== 'could_not') continue;
      if (!rooms.has(r.project)) rooms.set(r.project, { count: 0, asked: [] });
      const room = rooms.get(r.project);
      room.count += 1;
      let asks = false;
      try { asks = named(r).includes(name); } catch { asks = false; }
      if ((asks || r.operator === true) && typeof r.id === 'string') room.asked.push(r.id);
    } else if (r.kind === 'message') {
      if (r.to !== name) continue;
      messages += 1;
      if (typeof r.from === 'string' && r.from) senders.set(r.from, (senders.get(r.from) || 0) + 1);
    } else if (r.kind === 'refused') {
      /* A refusal to a room carries `project`; only one to this agent by name counts here. The log keeps one such row
         per sender, recipient and reason in a window (engine/messages.js logRefusedSend), so this is a lower bound. */
      if (r.to !== name || r.project !== undefined) continue;
      refused += 1;
      if (typeof r.from === 'string' && r.from) senders.set(r.from, (senders.get(r.from) || 0) + 1);
    }
  }
  let dms = 0;
  for (const m of Array.isArray(direct) ? direct : []) {
    if (!m || typeof m !== 'object' || (m.from !== undefined && m.from !== null) || !inWindow(m)) continue;
    dms += 1;
  }
  const posts = [...rooms.values()].reduce((n, x) => n + x.count, 0);
  const counts = { posts, messages, refused, direct: dms };
  if (!posts && !messages && !refused && !dms) return { ...empty, clamped };

  const lines = [];
  const list = [...rooms.entries()].sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1));
  for (const [project, room] of list.slice(0, MAX_ROOMS)) {
    let line = '- ' + project + ': ' + room.count + (room.count === 1 ? ' post' : ' posts') + ' from others';
    if (room.asked.length) {
      const newest = room.asked.slice(-SHOWN).reverse();
      const earlier = room.asked.length - newest.length;
      line += '; naming you or from the person: ' + newest.join(', ') + (earlier ? ' and ' + earlier + ' earlier' : '');
    }
    lines.push(line + '. Read it with: kosmos room ' + project);
  }
  if (list.length > MAX_ROOMS) lines.push('- and ' + (list.length - MAX_ROOMS) + ' more rooms.');
  if (messages || refused) {
    const who = [...senders.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((x) => x[0]);
    const names = who.slice(0, MAX_SENDERS).join(', ') + (who.length > MAX_SENDERS ? ' and ' + (who.length - MAX_SENDERS) + ' more' : '');
    const from = names ? ' (' + names + ')' : '';
    const parts = [];
    if (messages) parts.push(messages + (messages === 1 ? ' direct message' : ' direct messages') + ' from other agents');
    if (refused) parts.push('at least ' + refused + (refused === 1 ? ' attempt' : ' attempts') + ' to message you that could not reach you');
    lines.push('- ' + parts.join(', and ') + from + '. Ask the sender if you need what it said.');
  }
  if (dms) {
    lines.push('- ' + dms + (dms === 1 ? ' message' : ' messages') + ' from the person. Read them with: kosmos inbox --since '
      + isoSecond(since) + ' --limit ' + INBOX_LIMIT + (dms >= INBOX_LIMIT ? ' (it shows the newest ' + INBOX_LIMIT + ' messages of the thread)' : ''));
  }
  return { name, lines, counts, clamped, sinceMs: since, untilMs };
}

function contextText(digest) {
  if (!digest || !Array.isArray(digest.lines) || !digest.lines.length) return '';
  return 'Kosmos: while this agent was not running (' + isoSecond(digest.sinceMs) + ' to ' + isoSecond(digest.untilMs)
    + (digest.clamped ? ', the last 7 days only' : '') + '), this arrived for it. This is a summary Kosmos made, not a '
    + 'request from the person; nothing here was typed into the session.\n' + digest.lines.join('\n');
}

function hookJson(digest) {
  const text = contextText(digest);
  if (!text) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });
}

module.exports = { build, windowFrom, contextText, hookJson, MAX_WINDOW_MS, SHOWN, MAX_ROOMS, MAX_SENDERS, INBOX_LIMIT };
