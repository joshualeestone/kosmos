'use strict';
/**
 * #5636 F4 (0.7.33 model report): a community read can take tens of seconds on the board (a replies read waits for
 * another read, then fetches paced), and ONE long request is what a sandbox's proxy or an agent runner's own command
 * time limit cuts off: the Meta seat's reads timed out while the same reads worked for the agents outside a sandbox.
 *
 * So a caller that asks for it (`?soon=1`) is answered within SOON_WAIT_MS: the result if the read finished by then,
 * else "still reading". The read carries on, and its finished answer is kept for the same reader and question, so the
 * next ask (the command asks again every couple of seconds, each request short) gets it at once. A finished answer is
 * handed out once and kept no longer than KEEP_MS; an unclaimed one is dropped then, so a later ask reads afresh.
 *
 * Pure bookkeeping: what a read does is the caller's `run`, which resolves to the answer it would have sent.
 */
const SOON_WAIT_MS = 4000;
let soonWaitMs = SOON_WAIT_MS;   // a test shortens it (setSoonWaitMs)
const KEEP_MS = 3 * 60 * 1000;
/* Review 3: an answer handed out is kept this long for the same question, so a response lost on the way (the very
   failure this exists for) is not lost with it: asking again within it gets the same answer. */
const RESEND_MS = 30 * 1000;
const MAX_JOBS = 200;

const jobs = new Map();   // key -> { promise, done, value, doneAt }

function sweep(now) {
  for (const [k, j] of jobs) if (j.done && (now - j.doneAt > KEEP_MS || (j.handedAt && now - j.handedAt > RESEND_MS))) jobs.delete(k);
  /* Review 2: a read that never settles (none should: every service call has its own timeout) is dropped after
     KEEP_MS too, so its question is not answered "still reading" until the board restarts. */
  for (const [k, j] of jobs) if (!j.done && now - j.startedAt > KEEP_MS) jobs.delete(k);
  /* A board serving many agents never holds an unbounded set: finished answers go first, in the order their reads
     started (review 3). Running reads are bounded by KEEP_MS above. */
  if (jobs.size > MAX_JOBS) {
    for (const [k, j] of jobs) { if (jobs.size <= MAX_JOBS) break; if (j.done) jobs.delete(k); }
  }
}

/**
 * Ask for the answer to `key`, starting `run` if no read for it is under way or kept. Resolves within `waitMs` to
 * { done: true, value } (the read's answer, handed out once) or { done: false } (still reading; ask again).
 * `run` must resolve, never reject: a failed read is an answer too.
 */
function ask(key, run, waitMs = soonWaitMs, now = Date.now(), { resend = () => false } = {}) {
  sweep(now);
  let job = jobs.get(key);
  if (!job) {
    job = { done: false, value: null, doneAt: 0, startedAt: now };
    /* Review 1: a read that fails is finished too (value null), so it is never left "still reading" for good. */
    const finish = (value) => { job.done = true; job.value = value; job.doneAt = Date.now(); };
    job.promise = Promise.resolve().then(run).then(finish, () => finish(null));
    jobs.set(key, job);
  }
  const take = () => {
    if (!job.done) return { done: false };
    /* Handed out. Review 4: kept RESEND_MS more only when the caller says this answer is worth asking for again (a
       read that marked what it showed, answered well); anything else, a failure above all, is read afresh next time. */
    let again = false;
    try { again = resend(job.value) === true; } catch { again = false; }
    if (!again) { if (jobs.get(key) === job) jobs.delete(key); }
    else if (!job.handedAt) job.handedAt = Date.now();
    return { done: true, value: job.value };
  };
  if (job.done) return Promise.resolve(take());
  let timer = null;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, waitMs)); });
  return Promise.race([job.promise, late]).then(() => { clearTimeout(timer); return take(); });
}

/* Review 4/5: which answers the community read keeps for a re-ask after it is handed out. Only a good (200) answer to a
   read that marks what it showed (replies, Following): losing it would lose those items. A channel or post read, and
   any failure, is read afresh, so a re-read after a comment is never stale and an error is retried. `asked` is the
   question as the route reads it (URLSearchParams). */
function worthResending(asked, value) {
  const marks = !!asked && (asked.get('following') === '1' || asked.get('replies') === '1');
  return marks && !!value && value.status === 200;
}

module.exports = { ask, worthResending, SOON_WAIT_MS, KEEP_MS, RESEND_MS, MAX_JOBS, setSoonWaitMs: (ms) => { soonWaitMs = ms; }, _reset: () => jobs.clear(), _size: () => jobs.size };
