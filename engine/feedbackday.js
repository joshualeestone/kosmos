'use strict';

/*
 * kosmos#7875 item 1: the asking agent's own day, for `kosmos feedback day`.
 *
 * The once-a-day feedback ask (engine/feedbacknudge.js) can reach a session that started after the day's work, so its
 * report came out thin. This prints, on this computer only, what the agent and the person said to each other today
 * (the direct thread) and which tasks the agent changed today (each task's transcript, engine/taskchat.js). Nothing
 * here is sent anywhere; the report the agent then writes is scrubbed and sent by engine/feedbacksend.js as before.
 *
 * Task titles and contents are left out: the report's own rules (feedbacknudge.nudgeText, question 4) forbid them, so
 * the digest gives the number and the project, and the agent can look a task up itself.
 *
 * The readers are injected (`o.readThread`, `o.listTaskFiles`, `o.readTask`) so tests drive it with fixtures.
 */

const fs = require('node:fs');
const path = require('node:path');

/* At most this many conversation lines, newest kept (a long day still prints a screenful). */
const MAX_MESSAGES = 40;
/* Each message as its first line, cut to this many characters. */
const LINE_MAX = 160;

function firstLine(text) {
  const line = String(text == null ? '' : text).split('\n').map((l) => l.trim()).find((l) => l !== '') || '';
  return line.length > LINE_MAX ? line.slice(0, LINE_MAX - 3) + '...' : line;
}
function hhmm(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function onDay(at, date, dateKey) {
  const d = typeof at === 'string' ? new Date(at) : null;
  return d && Number.isFinite(d.getTime()) && dateKey(d) === date ? d : null;
}

/* The direct thread's messages from `date`, oldest first, as { d, mine, text }. A message from the agent carries its
   name in `from`; the person's carries none. */
function conversation(messages, names, date, dateKey) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object') continue;
    if (m.kosmos === true) continue;   // Kosmos's own line in the agent's name (a menu answer, `wire`, is the person's and stays)
    if (m.delivery && m.delivery.duplicateOf) continue;   // a resend recorded as a copy of one already counted
    const d = onDay(m.at, date, dateKey);
    if (!d) continue;
    const mine = names.includes(m.from);
    if (!mine && m.from != null && m.from !== '') continue;   // another agent's row: neither you nor your person
    out.push({ d, mine, text: firstLine(m.text) || '(a file, no words)' });
  }
  return out.sort((a, b) => a.d - b.d);
}

/* Task transcript files are `<project key>.task-<number>.jsonl` (engine/taskchat.js taskChatFile). */
const TASK_FILE = /^(.+)\.task-(\d+)\.jsonl$/;

/* Whether a transcript row names this agent as its author. Most rows name nobody (said, closed, hold-set, ...), so only
   these can count: a task it created through the CLI (`addedBy`), and a mark, run or move it made (`by`). */
function byAgent(r, name) {
  if (r.kind === 'created') return r.addedVia === 'process' && r.addedBy === name;   // as tasks.js AGENT_ROW.created
  return r.by === name && r.person !== true;   // as AGENT_ROW: a mark the person made is not the agent's
}
/* The tasks this agent changed on `date`: [{ project, number, kinds }], by project then number. */
function taskChanges(files, readTask, names, date, dateKey) {
  const out = [];
  for (const f of files) {
    const m = TASK_FILE.exec(f);
    if (!m) continue;
    const project = m[1];
    const number = Number(m[2]);
    let rows;
    try { rows = readTask(project, number); } catch { rows = []; }
    const kinds = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || !names.some((n) => byAgent(r, n)) || !onDay(r.at, date, dateKey)) continue;
      if (typeof r.kind === 'string' && !kinds.includes(r.kind)) kinds.push(r.kind);
    }
    if (kinds.length) out.push({ project, number, kinds });
  }
  return out.sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : a.number - b.number));
}

/* The task files touched on `date` by their modification time: a file not written today has no row from today. */
function listTaskFilesIn(dir, date, dateKey) {
  let names;
  try { names = fs.readdirSync(dir); } catch (err) {
    if (err && err.code === 'ENOENT') return [];   // no task has a transcript yet
    throw err;   // unreadable: the digest says so rather than "none"
  }
  return names.filter((n) => {
    if (!TASK_FILE.test(n)) return false;
    let st;
    try { st = fs.statSync(path.join(dir, n)); } catch (err) {
      if (err && err.code === 'ENOENT') return false;   // removed since the listing
      throw err;   // cannot be inspected: the digest says so rather than "no change"
    }
    return dateKey(st.mtime) === date;
  }).map((n) => {
    // taskchat.read answers [] for a file it cannot open, which would read as "no change": check it can be read here.
    fs.accessSync(path.join(dir, n), fs.constants.R_OK);
    return n;
  });
}

/**
 * Who is asking, as the names its records can be kept under, or null: `{ name, also }`. `name` reads the direct thread.
 * A token agent's thread is filed under its KEY (chat.threadFile accepts only a key), and a paneless token agent's task
 * rows too (server.js files them under the paneless card's sessionName, the key). With a running pane, the board takes
 * the pane row whose name is the token's own spelling, so task rows can carry that spelling: `also` holds it, and a
 * task row counts under either. Both names are this one agent's; a token shared by two names (twins) is refused. A pane
 * agent with no token is its window's agent name, exactly. The window is the one TMUX_PANE names, the same reach
 * outbox.resolveKeepSender accepts for a kept send (any process of this user can already read the chats folder).
 * `seams` are for tests.
 */
function recordWho(env, seams) {
  const e = env || process.env;
  const s = seams || {};
  const token = (s.agentToken || ((x) => require('./kosmos-report-hook').agentToken(x)))(e);
  if (token) {
    const found = (s.resolveName || ((t) => require('./sendertoken').resolveName(t)))(token);
    if (!(found && found.ok && found.twins !== true && typeof found.key === 'string' && found.key)) return null;
    // A token whose own spelling is not its key ("Mara" for "mara") is read under that exact spelling, as a window is:
    // the key may also be another agent's (a pane "mara", an older unnamed token), and its thread and rows must never
    // count as this agent's. Cost, chosen: a paneless "Mara" (whose records the board keeps under the key) reads empty.
    const spelled = typeof found.name === 'string' && found.name ? found.name : found.key;
    return { name: spelled, also: [] };
  }
  const r = (s.resolveKeepSender || ((x) => require('./outbox').resolveKeepSender(x)))(e);
  // Read under the exact window name. A name that is not its own key ("Angel", "my.bot") has no thread at all (the board
  // cannot file one, chat.threadFile), and its key form may be ANOTHER agent's thread, so it is never read there: the
  // digest says no conversation is kept under this name.
  return r && r.ok ? { name: r.name, also: [] } : null;
}

/* #8141: where this agent says it answers its person (kosmos reply-channel, #5805), or null. Injected as
   `o.replyChannel` for tests; the real reader never throws, and one that does here counts as no declaration. */
function replyChannelOf(o, name) {
  try {
    const read = o.replyChannel || ((n) => require('./replychannel').forAgent(n));
    const ch = read(name);
    return typeof ch === 'string' && ch ? ch : null;
  } catch { return null; }
}

/**
 * The digest as lines. `o.name` and `o.also` are recordWho's; `o.date` the person's local day (feedback.today()).
 * A conversation that cannot be read says so, never "nothing today".
 */
function digest(o) {
  const fb = require('./feedback');
  const dateKey = o.dateKey || fb.dateKey;
  const date = o.date || fb.today();
  const name = o.name;
  const names = [name, ...(Array.isArray(o.also) ? o.also : [])];
  const readThread = o.readThread || ((n) => { const chat = require('./chat'); return chat.readThread(chat.DIRECT, n).messages; });
  const listTaskFiles = o.listTaskFiles || (() => listTaskFilesIn(require('./taskchat').taskChatsDir(), date, dateKey));
  const readTask = o.readTask || ((p, n) => require('./taskchat').read(p, n));
  // The setup guide's thread holds what the person pasted to it, keys included, which the board never shows back
  // (server.js guideMaskedRows): its conversation is not printed here. A check that cannot tell counts as the guide.
  const isGuide = o.isGuide || ((n) => require('./setup-assistant').isGuideFolderStrict(n));
  let guide;
  let guideUnsure = false;
  try { guide = isGuide(name) === true; } catch { guide = true; guideUnsure = true; }

  const lines = ['Your day on this computer, ' + date + ' (for your feedback report; nothing here is sent anywhere).',
    'Do not copy names, project names, task numbers or your person\'s words into the report: describe what happened.', ''];
  let talk = null;
  let unfilable = false;
  if (!guide) {
    try { talk = conversation(readThread(name), names, date, dateKey); } catch (err) { talk = null; unfilable = Boolean(err && err.code === 'BAD_THREAD'); }
  }
  if (guideUnsure) {
    lines.push('Your conversation with your person: not shown, since Kosmos could not tell whether you are the setup guide.');
  } else if (guide) {
    lines.push('Your conversation with your person: not shown for the setup guide (what the person pasted stays hidden).');
  } else if (talk == null && unfilable) {
    lines.push('Your conversation with your person: Kosmos keeps no conversation under this agent\'s name.');
  } else if (talk == null) {
    lines.push('Your conversation with your person: Kosmos could not read it on this computer.');
  } else {
    /* #8141: only what was said HERE. An agent that answers its person on another channel (a chat app) has a day of
       conversation Kosmos never sees, so a bare "nothing today" or "0 from you" read as a day of ignoring them. */
    const elsewhere = replyChannelOf(o, name);
    const theirs = talk.filter((t) => !t.mine).length;
    if (talk.length === 0) lines.push('Your conversation with your person in Kosmos: nothing today.');
    else lines.push('Your conversation with your person in Kosmos today: ' + theirs + ' from them, ' + (talk.length - theirs) + ' from you.');
    if (elsewhere) {
      lines.push('  You told Kosmos you answer your person on ' + elsewhere + '. Kosmos cannot see that, so what you said there is not counted here.');
    } else if (theirs > 0 && theirs === talk.length) {
      lines.push('  If you answered them somewhere else, tell Kosmos where with: kosmos reply-channel "<where>"');
    }
    const shown = talk.slice(-MAX_MESSAGES);
    if (shown.length < talk.length) lines.push('  (the last ' + shown.length + ')');
    for (const t of shown) lines.push('  ' + hhmm(t.d) + ' ' + (t.mine ? 'you' : 'them') + ': ' + t.text);
  }
  lines.push('');
  let changes;
  try { changes = taskChanges(listTaskFiles(), readTask, names, date, dateKey); } catch { changes = null; }
  if (changes == null) lines.push('Tasks you changed today: Kosmos could not read them on this computer.');
  else if (changes.length === 0) lines.push('Tasks you changed today: none.');
  else {
    lines.push('Tasks you changed today (read one with kosmos task activity <project> <number>):');
    for (const c of changes) lines.push('  ' + c.project + ' #' + c.number + ': ' + c.kinds.join(', '));
  }
  return lines;
}

module.exports = { digest, recordWho, listTaskFilesIn, conversation, taskChanges, firstLine, MAX_MESSAGES, LINE_MAX };
