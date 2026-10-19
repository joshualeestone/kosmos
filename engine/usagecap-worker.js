'use strict';

/**
 * kosmos#6309: the usage cap's counter, a worker thread started by engine/usagecap.js, so counting the month never
 * blocks the board's message path. Told the cap's zone and the board's config folders ({ tz, roots }), it counts the month (usagecap.monthTokens, its own
 * cache in this thread) a bounded amount every CATCH_UP_MS until the count has caught up, then again every RECOUNT_MS,
 * posting each count as { tz, since, tokens, complete }. The pause between catch-up turns keeps a heavy month (measured:
 * over 31 minutes of reads on one computer) from holding a core the whole time. Never throws out of a count: a failed
 * one is retried RECOUNT_MS later.
 */

const { parentPort } = require('node:worker_threads');
const usagecap = require('./usagecap');

const RECOUNT_MS = 10 * 1000;
const CATCH_UP_MS = 250;
let tz = null;
let roots = [];   // the board's config folders, sent with the zone
let timer = null;   // always a setTimeout handle

function turn() {
  timer = null;
  if (tz === null) return;
  let r = null;
  try { r = usagecap.monthTokens(tz, Date.now(), roots); } catch { r = null; }
  if (r) parentPort.postMessage({ tz, since: r.since, tokens: r.tokens, complete: r.complete });
  timer = setTimeout(turn, r && !r.complete ? CATCH_UP_MS : RECOUNT_MS);
}

parentPort.on('message', (m) => {
  if (!m || typeof m.tz !== 'string') return;
  tz = m.tz;
  roots = Array.isArray(m.roots) ? m.roots.filter((x) => typeof x === 'string') : [];
  if (timer) clearTimeout(timer);
  timer = setTimeout(turn, 0);
});
