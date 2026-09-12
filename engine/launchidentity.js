'use strict';
/**
 * #1704 / #2827 / #2828: ONE derivation of the key an agent's OS-level launch
 * identity is built from, per Kosmos ("world").
 *
 * 🛑 THE DEFECT THIS EXISTS FOR. An agent's Scheduled Task (`Kosmos\agent-<name>`),
 * its channel pipe, its launchd label and its tmux session are MACHINE-WIDE, and
 * every one of them was derived from the bare agent name. A world's data is
 * separate, but those names are not, so the same agent name in two Kosmoses
 * collided: a remove in Kosmos B disabled and stopped Kosmos A's agent, and on
 * Windows a create in B overwrote A's task with `/Create /F` (#2828). Importing
 * agents into a new Kosmos (#2563) copies them UNDER THE SAME NAMES, so the
 * first import sets the collision up.
 *
 * 🔑 THE DEFAULT WORLD IS UNCHANGED, BYTE FOR BYTE. Its key is the bare name, so
 * every existing install keeps its task names, pipes, labels and sessions and
 * needs no migration. Only a NAMED world's agents are keyed `<name>+<worldId>`.
 *
 * ⚠️ WHY `+`. It is the one character that can never occur on either side of the
 * key: agent names are `NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/` (create.js) and
 * world ids are `CLEAN_ID = /^[a-z0-9_-]+$/` (worlds.js). So parsing a key back is
 * unambiguous, and `launchidentity-1704.test.js` reads both rules out of their
 * source and fails if either ever admits it. It is also legal where the key
 * lands: a Scheduled Task name (schtasks forbids `\ / : * ? " < > |`) and a named
 * pipe.
 *
 * 📌 HOW A PROCESS KNOWS ITS WORLD: `KOSMOS_WORLD` in its environment, absent for
 * the default world. The board sets it when it boots into a named world
 * (worlds.applyActiveWorldEnv). On Windows every agent-side process has it before
 * its first store-using require: the anchored boot shim reads it from the task's
 * argument line and applies it (worlds.applyAgentWorldEnv), and the agent's hooks
 * and `kosmos` command inherit it. (The Mac's agents get it in the Mac slice,
 * PR1m.) So a module that names a task or a pipe asks `currentWorldId()` and
 * never needs a world passed in.
 *
 * A LEAF, WITH NO REQUIRES: the anchored boot shim and worlds.js both load it
 * before any module that freezes store.ROOT.
 */

/* The environment variable that carries an agent's Kosmos. Absent (or "default")
   means the default world, which is every install that has never made a second
   Kosmos. */
const WORLD_ENV_VAR = 'KOSMOS_WORLD';

/* Must equal worlds.DEFAULT_ID. Duplicated rather than required so this stays a
   leaf; launchidentity-1704.test.js pins the two equal. */
const DEFAULT_WORLD_ID = 'default';

/* See the header: the one character neither an agent name nor a world id can hold. */
const WORLD_SEPARATOR = '+';

/* #1704 PR2 (plan §5): the request header every agent-side client names its
   Kosmos in, so a board serving ANOTHER Kosmos can answer "wrong world" (421)
   instead of refusing the send as a stranger's and losing it. Here, beside the
   env var it carries, because this leaf is the one module the hook, the Codex
   bridge, the Windows CLI and server.js can all load before anything freezes
   store.ROOT. install/kosmos writes the same name in shell; a test pins the two
   equal. */
const WORLD_HEADER = 'x-kosmos-world';

function isDefaultWorld(worldId) {
  return worldId === undefined || worldId === null || worldId === '' || worldId === DEFAULT_WORLD_ID;
}

/** A world id in the one form every comparison uses: "default" for the default
    world however it is spelled (absent, empty, "default"), else the id as text.
    The board normalises an agent's `x-kosmos-world` header and its own booted id
    through this, so both sides of the comparison follow one rule. */
function worldIdOrDefault(value) {
  return isDefaultWorld(value) ? DEFAULT_WORLD_ID : String(value);
}

/** The Kosmos this process belongs to, from its environment. */
function currentWorldId(env) {
  return worldIdOrDefault((env || process.env)[WORLD_ENV_VAR]);
}

/** The key an agent's machine-wide names are built from: the bare name in the
    default world, `<name>+<worldId>` in a named one. */
function launchKey(name, worldId) {
  const n = String(name);
  return isDefaultWorld(worldId) ? n : n + WORLD_SEPARATOR + String(worldId);
}

/** The inverse of launchKey. A key with no separator is a default-world agent. */
function parseKey(key) {
  const k = String(key);
  const at = k.indexOf(WORLD_SEPARATOR);
  if (at < 0) return { name: k, worldId: DEFAULT_WORLD_ID };
  return { name: k.slice(0, at), worldId: k.slice(at + 1) };
}

/** The agent name a key stands for IN THIS WORLD, or null when the key belongs
    to another Kosmos. How a machine-wide listing becomes one board's roster. */
function nameInWorld(key, worldId) {
  const parsed = parseKey(key);
  const want = isDefaultWorld(worldId) ? DEFAULT_WORLD_ID : String(worldId);
  return parsed.worldId === want ? parsed.name : null;
}

module.exports = {
  WORLD_ENV_VAR, DEFAULT_WORLD_ID, WORLD_SEPARATOR, WORLD_HEADER,
  isDefaultWorld, worldIdOrDefault, currentWorldId, launchKey, parseKey, nameInWorld,
};
