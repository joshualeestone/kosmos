'use strict';
/*
 * kosmos#5536 slice 4c-2 part 2: the restore listing (restoreworld.listRestoredAgents), run away from the board's event
 * loop. A listing reads up to 32 MB of briefs and runs git for up to 22 s (400 reads), all synchronously, so
 * the board starts this file instead (restoreworld.listRestoredAgentsInChild) with the Restored world's folders
 * applied to the environment by worlds.applyWorldEnv, marker included. Anything here that loads create.js then fixes
 * its store root to that world, never to the one the board serves.
 *
 *   node engine/restoreworld-child.js list <base> <world id> [<restore folder>]
 *     ->  {"ok":true,"root":"<its store root>","listing":{agents, shared, more, because?}}   (listRestoredAgents's answer;
 *         root is store.ROOT as this process resolves it, which the board checks is the Restored world's)
 *     or  {"ok":false,"because":"..."}                            (the world is not on the list, or the read failed)
 *
 * It writes nothing. It prints one line and exits 0; the caller treats any other ending as a listing that failed.
 */

async function main(mode, base, worldId, restoreDir) {
  if (mode !== 'list') return { ok: false, because: 'unknown mode' };
  if (typeof base !== 'string' || !base || typeof worldId !== 'string' || !worldId) return { ok: false, because: 'the listing was asked without a Kosmos' };
  const worlds = require('./worlds');
  // The world as the registry records it, never as the caller describes it: listRestoredAgents checks it is on the
  // list too, and an id the registry does not hold answers a refusal, not an empty restore.
  const world = worlds.readRegistry(base).worlds.find((w) => w.id === worldId);
  if (!world) return { ok: false, because: 'this is not a Kosmos on your list, so nothing in it is offered' };
  const listing = require('./restoreworld').listRestoredAgents({ base, world, restoreDir: restoreDir || undefined });
  return { ok: true, root: require('./store').ROOT, listing };
}

if (require.main === module) {
  /* Bounds the end, not the listing: listRestoredAgents is synchronous, so this timer cannot fire while it runs (its own
     git and brief budgets bound it, and the parent's timeout kills it). It ends a child whose output will not flush or
     whose handles stay open after the line. Unref'd, so it never keeps a finished child alive. */
  setTimeout(() => process.exit(1), require('./restoreworld').LIST_CHILD_TIMEOUT_MS).unref();
  main(process.argv[2], process.argv[3], process.argv[4], process.argv[5]).then(
    // Exit once the line is flushed: a handle left open must not turn every listing into the caller's timeout.
    (out) => { process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(0)); },
    () => { process.stdout.write(JSON.stringify({ ok: false, because: 'the listing could not be read' }) + '\n', () => process.exit(0)); },
  );
}

module.exports = { main };
