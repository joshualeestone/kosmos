'use strict';
/**
 * kosmos#5889: the environment a desktop opener (xdg-open, /usr/bin/open) is started with. The board's own
 * process.env carries the board's values (its tokens among them), and the child can be a browser that runs for a long
 * time, so it is given only what a desktop needs to open a page or a folder: home, path, language, the display and its
 * authority, the session bus and runtime folder, and the desktop's identity and config variables. The base list is
 * kosmos#5881's (engine/projects.js linuxOpenFolder, on its branch when this was written); once that lands it should
 * read this helper rather than keep its own copy.
 *
 * Added in review (each one something xdg-open, or a browser it starts and that keeps it for its whole life, reads):
 * BROWSER (xdg-open tries it first), the XDG data, cache and state folders (mimeapps and .desktop files), the locale
 * (LANGUAGE and the standard LC_ names, by name, not by prefix: an LC_ prefix would also pass anything smuggled in an
 * LC_ variable over ssh), the user's name, TMPDIR, the toolkit backend hints, input method (CJK typing) and HiDPI
 * scaling, WSL's own variables (wslview), VS Code Remote's helper socket (its BROWSER script needs it), the Kerberos
 * credential cache (company single sign-on), MATE's desktop id, and the proxy variables.
 * Kept on purpose: the proxies and KRB5CCNAME are the person's own network and sign-in settings, and a company sign-in
 * page may not load without them. Weakest premise: a proxy URL can carry a user and password; it is the person's, and
 * the page needs it.
 *
 * openerEnv(env = process.env) -> a new object holding only the listed variables that are set.
 * hasDesktop(env = process.env) -> true when something can show a page: a display (DISPLAY or WAYLAND_DISPLAY), WSL
 *   (WSL_DISTRO_NAME, where xdg-open hands the page to Windows), or VS Code Remote (BROWSER with VSCODE_IPC_HOOK_CLI,
 *   which forwards the page to the person's own machine). BROWSER alone does not count: on a server it is often a
 *   terminal browser, which shows nothing, does not exit, and would read as "opened". On Linux with none of these an
 *   opener cannot show anything, and waiting on it only delays "use the link".
 */
const OPENER_KEYS = Object.freeze([
  'HOME', 'PATH', 'LANG', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  'XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'XDG_DATA_DIRS', 'XDG_CONFIG_HOME', 'XDG_CONFIG_DIRS',
  'DESKTOP_SESSION', 'XDG_SESSION_DESKTOP', 'KDE_FULL_SESSION', 'KDE_SESSION_VERSION', 'GNOME_DESKTOP_SESSION_ID',
  'MATE_DESKTOP_SESSION_ID',
  'BROWSER', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'USER', 'LOGNAME', 'TMPDIR',
  'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_NUMERIC', 'LC_TIME', 'LC_COLLATE', 'LC_MONETARY', 'LC_MESSAGES', 'LC_PAPER',
  'LC_NAME', 'LC_ADDRESS', 'LC_TELEPHONE', 'LC_MEASUREMENT', 'LC_IDENTIFICATION',
  'GDK_BACKEND', 'QT_QPA_PLATFORM', 'MOZ_ENABLE_WAYLAND',
  'XMODIFIERS', 'GTK_IM_MODULE', 'QT_IM_MODULE',
  'GDK_SCALE', 'GDK_DPI_SCALE', 'QT_SCALE_FACTOR', 'QT_AUTO_SCREEN_SCALE_FACTOR', 'XCURSOR_SIZE', 'XCURSOR_THEME',
  'WSL_DISTRO_NAME', 'WSL_INTEROP', 'VSCODE_IPC_HOOK_CLI', 'KRB5CCNAME',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
]);

function openerEnv(env = process.env) {
  const out = {};
  for (const k of OPENER_KEYS) if (typeof env[k] === 'string' && env[k]) out[k] = env[k];
  return out;
}

function hasDesktop(env = process.env) {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.WSL_DISTRO_NAME || (env.BROWSER && env.VSCODE_IPC_HOOK_CLI));
}

module.exports = { OPENER_KEYS, openerEnv, hasDesktop };
