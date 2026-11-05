'use strict';
/**
 * kosmos#8024: which needs-you pushes for an agent the person has not opened yet, so opening the agent's chat can tell the
 * coordinator they are dealt with (phonenotify.acked), and its deferred email (#2336) never goes. Only stalls and turns
 * could be acknowledged before; a report or a stuck terminal never was, because nothing kept their ids.
 *
 * Kept on disk, since the email waits longer than a board may run. One small file; a few ids per agent and only for a week,
 * since the coordinator has decided by then and an ack for a row it cannot match does nothing.
 *
 * "Opened" is the person's own screen on the agent's chat, board or phone. A push merely delivered does not count, and
 * neither does an agent's own request (server.js decides that, with isViaScreen).
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_PER_AGENT = 5;
function file() { return path.join(store.ROOT, 'needs-you-acks.json'); }

function read(now) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [who, rows] of Object.entries(parsed)) {
    if (!Array.isArray(rows)) continue;
    const kept = rows.filter((r) => r && typeof r.id === 'string' && r.id && Number.isFinite(r.at) && now - r.at < KEEP_MS);
    if (kept.length) out[who] = kept;
  }
  return out;
}
function write(all) {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all));
  fs.renameSync(tmp, f);
}

/** A needs-you push for this agent went out. Never throws: a notification is never a reason to fail what it rides on. */
function remember(session, id, now = Date.now()) {
  try {
    if (typeof session !== 'string' || !session || typeof id !== 'string' || !id) return;
    const all = read(now);
    const rows = (all[session] || []).filter((r) => r.id !== id);
    rows.push({ id, at: now });
    all[session] = rows.slice(-KEEP_PER_AGENT);
    write(all);
  } catch { /* its email goes, as it did before */ }
}

/** Whether opening this agent has anything to acknowledge. */
function due(session, now = Date.now()) {
  try { return Array.isArray(read(now)[session]); } catch { return false; }
}

/** The person opened this agent's chat. Acknowledges what is held and forgets what was handed over; one the coordinator
    was not reached with is kept for the next open. Returns how many were handed over. Never throws. */
function opened(session, ack, now = Date.now()) {
  try {
    const all = read(now);
    const rows = all[session];
    if (!rows) return 0;
    const left = rows.filter((r) => ack(r.id) !== true);
    const handed = rows.length - left.length;
    if (left.length) all[session] = left; else delete all[session];
    write(all);
    return handed;
  } catch { return 0; }
}

module.exports = { remember, due, opened, file, KEEP_MS, KEEP_PER_AGENT };
