'use strict';
/*
 * kosmos#5532 widening (Josh, #admin 2026-10-09 08:43: everything on a work computer is company property): the rollup
 * of a Kosmos that is NOT the one this board serves. The board starts this file with that Kosmos's folders applied to
 * the environment as an agent of it gets them (worlds.applyAgentWorldEnv), so every reader below resolves that Kosmos's own store, exactly as its own
 * board would. `gather` sends nothing; `tick` is the enrolled Kosmos's own rollup tick. Each prints one line of JSON and
 * exits.
 *
 *   node engine/orgrollup-child.js gather   ->  {"ok":true,"world":"<opaque id>","gathered":{...}}
 *   node engine/orgrollup-child.js tick     ->  {"ok":true,"result":{...}}   (the enrolled Kosmos's own rollup, when the
 *                                                board on screen serves another Kosmos; that tick sends)
 *
 * The world id is this Kosmos's own (minted in its own data root once, as the enrolled one's is). A failed gather
 * prints {"ok":false} and exits 0, so the caller treats it as "no report for this Kosmos this time". `tick` prints the
 * tick's own result, which the board does not read: it logs only a failed or timed-out child.
 */

async function main(mode) {
  if (mode === 'tick') return { ok: true, result: await require('./orgrollup').tick() };
  if (mode !== 'gather') return { ok: false, because: 'unknown mode' };
  const oe = require('./orgenroll');
  const rollup = require('./orgrollup');
  /* siblingId() mints this Kosmos's opaque id for being reported as ANOTHER Kosmos, in its own data root on its first
     read: the one write a gather makes. Never its enrollment id (worldId), so if it later enrolls elsewhere the two
     companies cannot match it (board review 7). */
  const world = oe.siblingId();
  const gathered = await rollup.gather();
  // Whether this Kosmos holds an enrollment record of its own (any company): such a Kosmos reports for itself, or for
  // another company, never under the enrolled one's (board review 3).
  let enrolled = true;
  try { enrolled = !!oe.readEnrollment(); } catch { enrolled = true; }   // unreadable: treated as enrolled, not sent
  return { ok: true, world, enrolled, gathered };
}

if (require.main === module) {
  /* Bounded by itself (board review 5): its parent's timer dies with the parent, so a read that hangs, or a tick whose
     board was killed, ends here. Unref'd: it never keeps a finished child alive. */
  const r = require('./orgrollup');
  const bound = process.argv[2] === 'tick' ? r.TICK_CHILD_TIMEOUT_MS : r.GATHER_TIMEOUT_MS;
  setTimeout(() => process.exit(1), bound).unref();
  main(process.argv[2]).then(
    // Exit once the line is flushed (board review 1): a handle a reader left open must not turn every read into the
    // caller's timeout, which reads as no report.
    (out) => { process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(0)); },
    () => { process.stdout.write(JSON.stringify({ ok: false, because: 'the read failed' }) + '\n', () => process.exit(0)); },
  );
}

module.exports = { main };
