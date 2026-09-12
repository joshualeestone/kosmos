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
 * 📌 HOW A PROCESS KNOWS ITS WORLD: `KOSMOS_WORLD` in its environment, absent (or
 * empty) for the default world. The board sets it when it boots into a named
 * world (worlds.applyActiveWorldEnv). On Windows every agent-side process has it
 * before its first store-using require: the anchored boot shim reads it from the
 * task's argument line and applies it (worlds.applyAgentWorldEnv). On the Mac the
 * supervisor hands each pane KOSMOS_WORLD (empty for the default world) and the
 * world's store roots (#2874). The agent's hooks and `kosmos` command inherit it.
 * So a module that names a task or a pipe asks `currentWorldId()` and never
 * needs a world passed in.
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

/* A Discord-bridged agent runs in a tmux session named `<name>-discord`, and is
   filed everywhere else (its profile, its roster card, its thread) under the bare
   `<name>`. The board has always stripped it without requiring it. */
const DISCORD_SESSION_SUFFIX = /-discord$/;

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

/* The characters a world id keeps on the wire. A world id is CLEAN_ID
   (`[a-z0-9_-]`), so this never changes a real one; it stops anything else in
   KOSMOS_WORLD (a newline would start a second header) from reaching a request.
   install/kosmos strips KOSMOS_WORLD with `tr -cd` over this same set;
   cli.world-outbox-1704.test.js pins the two. */
const WORLD_HEADER_CHARSET = 'A-Za-z0-9_-';
const NOT_A_WORLD_HEADER_CHAR = new RegExp('[^' + WORLD_HEADER_CHARSET + ']', 'g');

/** The `x-kosmos-world` value for a world id as a process holds it: stripped to
    WORLD_HEADER_CHARSET, then "default" if nothing is left. The one rule every JS
    client and the board apply, and the one install/kosmos applies in shell. */
function worldIdForHeader(value) {
  return worldIdOrDefault(String(value == null ? '' : value).replace(NOT_A_WORLD_HEADER_CHAR, ''));
}

/** This process's `x-kosmos-world` value, from its environment. */
function worldHeaderValue(env) {
  return worldIdForHeader((env || process.env)[WORLD_ENV_VAR]);
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

/** The agent a tmux session is, as this Kosmos files it: the session's name in
    `worldId` (nameInWorld; null for another Kosmos's session), then without a
    Discord bridge's `-discord`. The ONE rule status.parsePanes names a roster card
    by and the outbox names a kept send's sender by (review round 2).
    ⚠️ The strip runs on the NAME, never the raw session: a world id can end in
    `-discord` (CLEAN_ID allows it), so stripping the session first would mangle
    `ava+qa-discord` into `ava+qa`. */
function agentNameFromSession(session, worldId) {
  const inWorld = nameInWorld(session, worldId);
  return inWorld === null ? null : inWorld.replace(DISCORD_SESSION_SUFFIX, '');
}

module.exports = {
  WORLD_ENV_VAR, DEFAULT_WORLD_ID, WORLD_SEPARATOR, WORLD_HEADER, WORLD_HEADER_CHARSET,
  isDefaultWorld, worldIdOrDefault, currentWorldId, worldIdForHeader, worldHeaderValue,
  launchKey, parseKey, nameInWorld, agentNameFromSession,
};
