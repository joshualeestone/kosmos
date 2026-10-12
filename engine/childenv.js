'use strict';
/**
 * kosmos#5889: the environment a desktop opener (xdg-open, /usr/bin/open) is started with. The board's own
 * process.env carries the board's values (its tokens among them), and the child can be a browser that runs for a long
 * time, so it is given only what a desktop needs to open a page or a folder: home, path, language, the display and its
 * authority, the session bus and runtime folder, and the desktop's identity and config variables. The list is
 * kosmos#5881's (engine/projects.js linuxOpenFolder, on its branch when this was written); once that lands it should
 * read this helper rather than keep its own copy.
 *
 * Review 1 widened it with what xdg-open and a browser it starts read: BROWSER (xdg-open tries it first), the XDG data,
 * cache and state folders (where mimeapps and .desktop files live), the locale (LANGUAGE and every LC_ variable), the
 * user's name, TMPDIR, the toolkit backend hints, WSL's own variables (wslview), and the proxy variables. The proxies
 * are kept on purpose: they are the person's own network settings, and a browser started without them may not reach
 * the page. Weakest premise: a proxy URL can carry a user and password; it is the person's, and the page needs it.
 *
 * openerEnv(env = process.env) -> a new object holding only the listed variables that are set.
 * hasDesktop(env = process.env) -> true when something can show a page: a display (DISPLAY or WAYLAND_DISPLAY), a
 *   browser the person named (BROWSER), or WSL (WSL_DISTRO_NAME, where xdg-open hands the page to Windows). On Linux
 *   with none of these an opener cannot show anything, and waiting on it only delays "use the link".
 */
const OPENER_KEYS = Object.freeze([
  'HOME', 'PATH', 'LANG', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  'XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'XDG_DATA_DIRS', 'XDG_CONFIG_HOME', 'XDG_CONFIG_DIRS',
  'DESKTOP_SESSION', 'XDG_SESSION_DESKTOP', 'KDE_FULL_SESSION', 'KDE_SESSION_VERSION', 'GNOME_DESKTOP_SESSION_ID',
  'BROWSER', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'LANGUAGE', 'USER', 'LOGNAME', 'TMPDIR',
  'GDK_BACKEND', 'QT_QPA_PLATFORM', 'MOZ_ENABLE_WAYLAND', 'WSL_DISTRO_NAME', 'WSL_INTEROP',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
]);
const OPENER_PREFIXES = Object.freeze(['LC_']);

function openerEnv(env = process.env) {
  const out = {};
  for (const k of Object.keys(env)) {
    if (!OPENER_KEYS.includes(k) && !OPENER_PREFIXES.some((p) => k.startsWith(p))) continue;
    if (typeof env[k] === 'string' && env[k]) out[k] = env[k];
  }
  return out;
}

function hasDesktop(env = process.env) {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.BROWSER || env.WSL_DISTRO_NAME);
}

module.exports = { OPENER_KEYS, OPENER_PREFIXES, openerEnv, hasDesktop };
