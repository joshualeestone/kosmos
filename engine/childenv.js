'use strict';
/**
 * kosmos#5889: the environment a desktop opener (xdg-open, /usr/bin/open) is started with. The board's own
 * process.env carries the board's values (its tokens among them), and the child can be a browser that runs for a long
 * time, so it is given only what a desktop needs to open a page or a folder: home, path, language, the display and its
 * authority, the session bus and runtime folder, and the desktop's identity and config variables. The base list is
 * kosmos#5881's (engine/projects.js linuxOpenFolder, on its branch when this was written); once that lands it should
 * read this helper rather than keep its own copy.
 *
 * Beyond that base the list holds what xdg-open, or a browser it starts and that keeps it for its whole life, reads:
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
 * winOpenerEnv(env = process.env) -> the same for the Windows opener (kosmos#5895): its own list, matched case-blind,
 *   one entry per name.
 * hasDesktop(env = process.env) -> true when something can show a page: a display (DISPLAY or WAYLAND_DISPLAY), WSL
 *   (WSL_DISTRO_NAME, where xdg-open hands the page to Windows), or VS Code Remote (BROWSER with VSCODE_IPC_HOOK_CLI,
 *   which forwards the page to the person's own machine). BROWSER alone does not count: on a server it is often a
 *   terminal browser, which shows nothing, does not exit, and would read as "opened". On Linux with none of these an
 *   opener cannot show anything, and waiting on it only delays "use the link".
 *   Known limit: a board run as the systemd user unit sees a display only if the session imported it into the user
 *   manager (GNOME and KDE do; a bare sway, Hyprland or i3 session may not), so such a board answers "use the link".
 *   Without a display xdg-open almost always failed there before too.
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

/**
 * kosmos#5895: the Windows opener's list. There the opener is `rundll32 url.dll,FileProtocolHandler <url>`, and
 * MEASURED on the Windows box (2026-11-09): the program it starts inherits rundll32's environment, not Explorer's (a
 * caller's marker variable reached a stand-in URL handler; the default browser, Edge, is registered as a plain command
 * line, so a browser started cold gets the same). With ONLY these present, less the CommonProgramFiles, ALLUSERSPROFILE
 * and ARM64 folder names (added after, and adding a name can only give rundll32 more), rundll32 still started the
 * handler, and a variable outside the list did not reach it. Two things add to the list, neither of them a secret:
 * node's process layer (libuv) copies a fixed set into any Windows child that lacks them, from this process
 * (HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR),
 * and the browser adds two FPS_BROWSER_* profile ones. Windows variable names are case-insensitive
 * (engine/win32env.js), so the match is too, and each kept variable keeps the name it came with.
 * Kept on purpose, as on the other platforms: the proxy variables (the person's network settings). Also kept: the
 * CommonProgramFiles family, ALLUSERSPROFILE (ProgramData's older name) and the ARM64 folders, which hold no secret and which an
 * installed browser may look up. MEASURED as well
 * (2026-11-11): Edge itself, started cold (headless, its own throwaway profile), rendered a page with this list, and
 * also with an EMPTY environment, so a missing variable here cannot stop Edge from starting. Not measured: Chrome and
 * Firefox (not on the box). rundll32 exits 0 once it hands the URL off, so a browser that failed to start for want of
 * a variable would still read as opened, the person left with the link (kosmos#8369).
 */
const WIN_OPENER_KEYS = Object.freeze([
  'SystemRoot', 'windir', 'ComSpec', 'PATHEXT', 'PATH', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA',
  'LOCALAPPDATA', 'TEMP', 'TMP', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'PUBLIC',
  'SystemDrive', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS',
  'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'ALLUSERSPROFILE',
  'ProgramFiles(Arm)', 'CommonProgramFiles(Arm)',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
]);
const WIN_OPENER_LOWER = new Set(WIN_OPENER_KEYS.map((k) => k.toLowerCase()));

function winOpenerEnv(env = process.env) {
  const out = {};
  /* One per name, case-blind: the first spelling in the source wins (on purpose, not node's own rule, which sorts
     and keeps PATH over Path), so the child never gets PATH and Path both. */
  const seen = new Set();
  for (const [k, v] of Object.entries(env)) {
    const low = k.toLowerCase();
    if (typeof v !== 'string' || !v || !WIN_OPENER_LOWER.has(low) || seen.has(low)) continue;
    seen.add(low);
    out[k] = v;
  }
  return out;
}

function hasDesktop(env = process.env) {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.WSL_DISTRO_NAME || (env.BROWSER && env.VSCODE_IPC_HOOK_CLI));
}

module.exports = { OPENER_KEYS, openerEnv, WIN_OPENER_KEYS, winOpenerEnv, hasDesktop };
