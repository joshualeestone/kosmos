'use strict';

/**
 * #4592: the private CODEX_HOME used by a Kosmos-managed agent.
 *
 * This is shared by the supervisor that launches Codex and the board reader
 * that finds its rollouts. A named world's machine-wide session key includes
 * the world suffix, so its private state cannot collide with the same agent
 * name in another world.
 */

const path = require('node:path');
const fs = require('node:fs');
const launchidentity = require('./launchidentity');
const store = require('./store');

function forSession(session) {
  return path.join(store.ROOT, 'codex-homes', String(session));
}

function forAgent(name, worldId) {
  return forSession(launchidentity.launchKey(name, worldId || launchidentity.currentWorldId()));
}

/** Existing private homes, bounded to the one direct codex-homes level. */
function homes() {
  const root = path.join(store.ROOT, 'codex-homes');
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
}

module.exports = { forSession, forAgent, homes };
