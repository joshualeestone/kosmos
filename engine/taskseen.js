'use strict';

/**
 * #6947 (agent feedback 10-22): when the person last opened a task's page, so an agent that left a nudge on the task
 * can tell "not seen yet" from "seen, not acted on".
 *
 * WHAT "SEEN" MEANS HERE: the task's conversation was drawn on the person's screen in Kosmos (the board's web page):
 * they opened the task's page, or came back to the tab while it was open, which draws it again first. It is recorded
 * when the page says so (POST .../task/<n>/seen), not from any read the page makes.
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
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    fs.mkdirSync(seenDir(), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ at: iso }) + '\n');
    fs.renameSync(tmp, file);
    return iso;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* never written */ }
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
