'use strict';

/**
 * kosmos#6309: the usage cap's counter, a worker thread started by engine/usagecap.js, so counting the month never
 * blocks the board's message path. Told the cap's zone ({ tz }), it counts the month (usagecap.monthTokens, its own
 * cache in this thread) until the count has caught up, then again every RECOUNT_MS, posting each count as
 * { tz, since, tokens, complete }. Never throws out of a count: a failed one is retried at the next turn.
 */

const { parentPort } = require('node:worker_threads');
const usagecap = require('./usagecap');

const RECOUNT_MS = 10 * 1000;
let tz = null;
let timer = null;

function turn() {
  timer = null;
  if (tz === null) return;
  let r = null;
  try { r = usagecap.monthTokens(tz, Date.now()); } catch { r = null; }
  if (r) parentPort.postMessage({ tz, since: r.since, tokens: r.tokens, complete: r.complete });
  timer = r && !r.complete ? setImmediate(turn) : setTimeout(turn, RECOUNT_MS);
}

parentPort.on('message', (m) => {
  if (!m || typeof m.tz !== 'string') return;
  tz = m.tz;
  if (timer) { clearTimeout(timer); clearImmediate(timer); }
  timer = setImmediate(turn);
});
