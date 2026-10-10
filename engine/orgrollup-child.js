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
 * The world id is this Kosmos's own (minted in its own data root once, as the enrolled one's is). A failure prints
 * {"ok":false} and exits 0, so the caller treats it as "no report for this Kosmos this time".
 */

async function main(mode) {
  if (mode === 'tick') return { ok: true, result: await require('./orgrollup').tick() };
  if (mode !== 'gather') return { ok: false, because: 'unknown mode' };
  const oe = require('./orgenroll');
  const rollup = require('./orgrollup');
  const world = oe.worldId();
  const gathered = await rollup.gather();
  return { ok: true, world, gathered };
}

if (require.main === module) {
  main(process.argv[2]).then(
    (out) => { process.stdout.write(JSON.stringify(out) + '\n'); },
    () => { process.stdout.write(JSON.stringify({ ok: false, because: 'the read failed' }) + '\n'); },
  );
}

module.exports = { main };
