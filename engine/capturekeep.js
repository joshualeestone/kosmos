'use strict';
/* kosmos#7693: one blocking `tmux capture-pane` per agent on every status read held the board's only thread for seconds on a
   busy computer, long enough that `/api/health` went unanswered for 30 s (measured 10-31). When a round of captures was slow,
   this hands back the text kept from a background round instead, so the thread is not held. On a computer where captures are
   quick it is not in the way: read() is the blocking capture, as before.

   A round is the captures between one snapshot's begin() and end(). `blocking(target, lines)` and `background(target, lines, done)`
   are the two real captures, passed in so the tests need no tmux. */

const SLOW_ROUND_MS = 1000;   // a round's captures taking this long means the next ones use kept text
const CALM_ROUNDS = 3;        // this many quick background rounds in a row go back to live reads
const MAX_AGE_MS = 4000;      // kept text older than this is not used
const AT_ONCE = 4;            // background captures running together

function makeKeep({ blocking, background, now = Date.now }) {
  const kept = new Map();     // `${target}\0${lines}` -> { text, at }
  let slow = false, calm = 0, spent = 0, refreshing = false;
  const wanted = new Map();   // key -> { target, lines }, this round's panes

  function begin() { spent = 0; wanted.clear(); }

  function read(target, lines) {
    const key = `${target}\0${lines}`;
    wanted.set(key, { target, lines });
    const k = kept.get(key);
    if (slow && k && now() - k.at <= MAX_AGE_MS) return k.text;
    const t0 = now();
    const text = blocking(target, lines);
    spent += now() - t0;   // only the captures: the rest of a snapshot's per-agent work is not what this can save
    if (text !== null && text !== undefined) kept.set(key, { text, at: now() }); else kept.delete(key);
    return text;
  }

  function refresh() {
    if (refreshing || wanted.size === 0) return;
    refreshing = true;
    const queue = [...wanted.entries()];
    const started = now();
    let running = 0;
    const next = () => {
      while (running < AT_ONCE && queue.length) {
        const [key, p] = queue.shift();
        running += 1;
        let settled = false;
        const finish = (text) => {
          if (settled) return;
          settled = true;
          if (text !== null && text !== undefined) kept.set(key, { text, at: now() });   // a failed look keeps the old text until its age runs out
          running -= 1;
          if (queue.length) { next(); return; }
          if (running > 0) return;
          refreshing = false;
          calm = now() - started < SLOW_ROUND_MS ? calm + 1 : 0;
          if (calm >= CALM_ROUNDS) { slow = false; calm = 0; }
        };
        try { background(p.target, p.lines, finish); } catch { finish(null); }
      }
    };
    next();
  }

  function end() {
    if (!slow && spent >= SLOW_ROUND_MS) { slow = true; calm = 0; }
    if (slow) refresh();
  }

  // Keep nothing for panes that have gone, so the map cannot grow for ever.
  function forgetExcept() { for (const key of kept.keys()) if (!wanted.has(key)) kept.delete(key); }

  return { begin, read, end, forgetExcept, isSlow: () => slow };
}

module.exports = { makeKeep, SLOW_ROUND_MS, CALM_ROUNDS, MAX_AGE_MS, AT_ONCE };
