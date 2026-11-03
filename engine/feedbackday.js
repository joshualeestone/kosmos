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
function conversation(messages, name, date, dateKey) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object') continue;
    const d = onDay(m.at, date, dateKey);
    if (!d) continue;
    out.push({ d, mine: m.from === name, text: firstLine(m.text) });
  }
  return out.sort((a, b) => a.d - b.d);
}

/* Task transcript files are `<project key>.task-<number>.jsonl` (engine/taskchat.js taskChatFile). */
const TASK_FILE = /^(.+)\.task-(\d+)\.jsonl$/;

/* The tasks this agent changed on `date`: [{ project, number, kinds }], by project then number. Only rows it wrote
   (`by` its name) count; a row the person wrote, or one naming nobody, is not this agent's change. */
function taskChanges(files, readTask, name, date, dateKey) {
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
      if (!r || r.by !== name || !onDay(r.at, date, dateKey)) continue;
      if (typeof r.kind === 'string' && !kinds.includes(r.kind)) kinds.push(r.kind);
    }
    if (kinds.length) out.push({ project, number, kinds });
  }
  return out.sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : a.number - b.number));
}

/* The task files touched on `date` by their modification time: a file not written today has no row from today. */
function listTaskFilesDefault(date, dateKey) {
  const dir = require('./taskchat').taskChatsDir();
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => {
    if (!TASK_FILE.test(n)) return false;
    try { return dateKey(fs.statSync(path.join(dir, n)).mtime) === date; } catch { return false; }
  });
}

/**
 * The digest as lines. `o.name` is the agent (feedback.writer); `o.date` the person's local day (feedback.today()).
 * A conversation that cannot be read says so, never "nothing today".
 */
function digest(o) {
  const fb = require('./feedback');
  const dateKey = o.dateKey || fb.dateKey;
  const date = o.date || fb.today();
  const name = o.name;
  const readThread = o.readThread || ((n) => { const chat = require('./chat'); return chat.readThread(chat.DIRECT, n).messages; });
  const listTaskFiles = o.listTaskFiles || (() => listTaskFilesDefault(date, dateKey));
  const readTask = o.readTask || ((p, n) => require('./taskchat').read(p, n));

  const lines = ['Your day on this computer, ' + date + ' (for your feedback report; nothing here is sent anywhere).', ''];
  let talk = null;
  try { talk = conversation(readThread(name), name, date, dateKey); } catch { talk = null; }
  if (talk == null) {
    lines.push('Your conversation with your person: Kosmos could not read it on this computer.');
  } else if (talk.length === 0) {
    lines.push('Your conversation with your person: nothing today.');
  } else {
    const theirs = talk.filter((t) => !t.mine).length;
    lines.push('Your conversation with your person today: ' + theirs + ' from them, ' + (talk.length - theirs) + ' from you.');
    const shown = talk.slice(-MAX_MESSAGES);
    if (shown.length < talk.length) lines.push('  (the last ' + shown.length + ')');
    for (const t of shown) lines.push('  ' + hhmm(t.d) + ' ' + (t.mine ? 'you' : 'them') + ': ' + t.text);
  }
  lines.push('');
  let changes;
  try { changes = taskChanges(listTaskFiles(), readTask, name, date, dateKey); } catch { changes = null; }
  if (changes == null) lines.push('Tasks you changed today: Kosmos could not read them on this computer.');
  else if (changes.length === 0) lines.push('Tasks you changed today: none.');
  else {
    lines.push('Tasks you changed today (read one with kosmos task activity <project> <number>):');
    for (const c of changes) lines.push('  ' + c.project + ' #' + c.number + ': ' + c.kinds.join(', '));
  }
  return lines;
}

module.exports = { digest, conversation, taskChanges, firstLine, MAX_MESSAGES, LINE_MAX };
