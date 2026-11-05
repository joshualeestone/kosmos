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
// Review 1: an ack that could not go (Kosmos+ off, no token) is not due again for this long, or every poll with the chat open
// would POST and rewrite this file for up to the week.
const RETRY_MS = 60 * 60 * 1000;
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
function remember(session, id, now = Date.now(), { autoWait = false } = {}) {
  try {
    if (typeof session !== 'string' || !session || typeof id !== 'string' || !id) return;
    const all = read(now);
    const rows = (all[session] || []).filter((r) => r.id !== id);
    rows.push({ id, at: now, ...(autoWait ? { autoWait: true } : {}) });
    all[session] = rows.slice(-KEEP_PER_AGENT);
    write(all);
  } catch { /* its email goes, as it did before */ }
}

/** Whether opening this agent has anything to acknowledge. */
function due(session, now = Date.now()) {
  try {
    const rows = read(now)[session];
    return Array.isArray(rows) && rows.some((r) => !(Number.isFinite(r.tried) && now - r.tried < RETRY_MS));
  } catch { return false; }
}

/** The person opened this agent's chat. Acknowledges what is held and forgets what was handed over; one the coordinator
    was not reached with is kept for the next open. Returns how many were handed over. Never throws. */
function opened(session, ack, now = Date.now()) {
  try {
    const all = read(now);
    const rows = all[session];
    if (!rows) return 0;
    const left = rows.filter((r) => ack(r.id) !== true).map((r) => ({ ...r, tried: now }));
    const handed = rows.length - left.length;
    if (left.length) all[session] = left; else delete all[session];
    write(all);
    return handed;
  } catch { return 0; }
}

/** kosmos#8036: an automatic permission wait is over before the person opened it. Its pushes were marked when they went out, not
    worked out from the wait's time: a hook firing twice changes that time and sends no second push (review 1). True when one
    was held. An ack that could not go is kept for the next open, unmarked so the line is said once. Never throws. */
function ended(session, ack, now = Date.now()) {
  try {
    const all = read(now);
    const rows = all[session];
    if (!rows || !rows.some((r) => r.autoWait === true)) return false;
    const left = [];
    for (const r of rows) {
      if (r.autoWait !== true) { left.push(r); continue; }
      if (ack(r.id) !== true) left.push({ id: r.id, at: r.at, tried: now });
    }
    if (left.length) all[session] = left; else delete all[session];
    write(all);
    return true;
  } catch { return false; }
}

/* kosmos#8036: what the chat says, Kosmos's own words. Not the hook's: they can hold a command or a path (#7756 review 1). */
const WAIT_ENDED_LINE = 'No longer asking for permission. That request has passed, so nothing is needed from you now.';

module.exports = { ended, WAIT_ENDED_LINE, remember, due, opened, file, KEEP_MS, KEEP_PER_AGENT, RETRY_MS };
