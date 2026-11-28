'use strict';
/**
 * kosmos#8378: how the connector (kosmos-tunnel) is started, given its path and its arguments.
 *
 * A path ending in .js or .cjs (any case) is a JavaScript stand-in for the connector, which is what the tests write
 * and point AGENT_WORKFORCE_TUNNEL_BIN at. Windows cannot run a script by its shebang line, so spawning such a file
 * directly fails with ENOENT there; it is run as this same node (process.execPath) with the script as the first
 * argument instead, on every platform, so the tests run the same way everywhere. Any other path is spawned exactly as
 * before: the same file and the same arguments.
 *
 * This widens nothing. A real connector binary never ends in .js (it is kosmos-tunnel, or kosmos-tunnel.exe on
 * Windows), and the environment variable already decides which program is run; this only says how a script there is
 * started.
 *
 * kosmos#9269: the codex and grok sign-ins start through it too (engine/openaiaccounts.js, engine/grokaccounts.js); a
 * real codex or grok is codex.exe or grok.exe on Windows and never ends in .js elsewhere.
 *
 * Two behaviours follow, both only for a .js path (a test's stand-in, or a runner override that names a script): a missing .js file starts node, which exits 1
 * ("Cannot find module"), where spawning a missing binary gave ENOENT; and a script whose shebang names another runtime
 * (bun, deno) runs under this node instead.
 *
 * Kept in its own file, with no other requires, so engine/win32uninstall.js can use it without loading engine/remote.js.
 */

const SCRIPT = /\.c?js$/i;

function tunnelCommand(bin, args = []) {
  if (typeof bin === 'string' && SCRIPT.test(bin)) return { file: process.execPath, args: [bin, ...args] };
  return { file: bin, args };   // the very same array: nothing about a real binary's start changes
}

module.exports = { tunnelCommand };
