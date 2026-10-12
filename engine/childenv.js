'use strict';
/**
 * kosmos#5889: the environment a desktop opener (xdg-open, /usr/bin/open) is started with. The board's own
 * process.env carries the board's values (its tokens among them), and the child can be a browser that runs for a long
 * time, so it is given only what a desktop needs to open a page or a folder: home, path, language, the display and its
 * authority, the session bus and runtime folder, and the desktop's identity and config variables. The list is
 * kosmos#5881's (engine/projects.js linuxOpenFolder, on its branch when this was written); once that lands it should
 * read this helper rather than keep its own copy.
 *
 * openerEnv(env = process.env) -> a new object holding only the listed variables that are set.
 * hasDesktop(env = process.env) -> true when a display is named (DISPLAY or WAYLAND_DISPLAY): on Linux without one an
 *   opener cannot show anything, and waiting on it only delays "use the link".
 */
const OPENER_KEYS = Object.freeze([
  'HOME', 'PATH', 'LANG', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  'XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'XDG_DATA_DIRS', 'XDG_CONFIG_HOME', 'XDG_CONFIG_DIRS',
  'DESKTOP_SESSION', 'XDG_SESSION_DESKTOP', 'KDE_FULL_SESSION', 'KDE_SESSION_VERSION', 'GNOME_DESKTOP_SESSION_ID',
]);

function openerEnv(env = process.env) {
  const out = {};
  for (const k of OPENER_KEYS) if (typeof env[k] === 'string' && env[k]) out[k] = env[k];
  return out;
}

function hasDesktop(env = process.env) {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

module.exports = { OPENER_KEYS, openerEnv, hasDesktop };
