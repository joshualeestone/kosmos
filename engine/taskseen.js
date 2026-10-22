'use strict';

/**
 * #6947 (agent feedback 10-22): when the person last opened a task's page, so an agent that left a nudge on the task
 * can tell "not seen yet" from "seen, not acted on".
 *
 * WHAT "SEEN" MEANS HERE: the person opened that task's page in Kosmos (the board's web page), with the page visible,
 * or came back to the tab while it was open. It is recorded when the page says so (POST .../task/<n>/seen), never
 * from the page's own background reads, which run on a timer whether or not anyone is looking.
 * What it misses is in the plan (.claude/plans/nudge-seen-6947.md): a nudge read somewhere else (the project room, a
 * notification, the task's card in a column), and a page opened but not read.
 *
 * One small file per task under its own folder, `<data>/task-seen/`, NOT beside the task's conversation in
 * task-chats/: the room's progress allowance (engine/messages.js) counts any recently written file there as a step
 * forward, and the person opening a task is not one. Keyed as taskchat keys a task (project id, number).
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DIRNAME = 'task-seen';

function seenDir() {
  return path.join(store.ROOT, DIRNAME);
}

function seenFile(projectId, number) {
  if (projectId == null || !Number.isInteger(number) || number <= 0) return null;
  let k;
  try { k = store.safeKey(String(projectId)); } catch { return null; }
  return k ? path.join(seenDir(), `${k}.task-${number}.json`) : null;
}

/** Record that the person opened the task now. Returns the ISO time, or null when it could not be written (never
 *  throws: a failed record must not break the page that sent it). Written whole and renamed into place. */
function markSeen(projectId, number, at = new Date()) {
  const file = seenFile(projectId, number);
  if (!file) return null;
  const iso = at.toISOString();
  try {
    fs.mkdirSync(seenDir(), { recursive: true });
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ at: iso }) + '\n');
    fs.renameSync(tmp, file);
    return iso;
  } catch {
    return null;
  }
}

/** When the person last opened the task, as an ISO string, or null (never opened, or unreadable). */
function seenAt(projectId, number) {
  const file = seenFile(projectId, number);
  if (!file) return null;
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    return o && typeof o.at === 'string' && Number.isFinite(Date.parse(o.at)) ? o.at : null;
  } catch {
    return null;
  }
}

module.exports = { markSeen, seenAt, seenDir };
