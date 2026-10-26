'use strict';

/**
 * kosmos#7212 slice 2: the agents whose messages have waited at least half an hour behind their input box, as the
 * board's minute sweep last saw them, by session name: { since, count, box }. `since` is the oldest kept message's
 * arrival (ISO), `count` how many are kept, `box` what the box read ('text', 'empty' or 'unread').
 *
 * The sweep is the only writer (setAll, once a minute); the status rows read it (peek), so polling the board never
 * reads a pane. In memory only: after a restart the first sweep fills it again.
 */

const seen = new Map();

function setAll(rows) {
  seen.clear();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && typeof r.name === 'string' && r.name) seen.set(r.name, { since: r.since, count: r.count, box: r.box });
  }
}

function peek(name) {
  const v = seen.get(String(name));
  return v ? { ...v } : null;
}

function resetForTests() { seen.clear(); }

module.exports = { setAll, peek, resetForTests };
