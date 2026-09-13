'use strict';

/**
 * win32-board-copy: the ONE way the board hands something to Windows' own shell.
 *
 * The Mac board opens folders, files and System Settings panes with `/usr/bin/open`.
 * None of that exists on Windows, so every such button answered "Finder did not
 * open" or "System Settings did not open" there (parity audit P0-6, installer audit
 * W-11/W-16/W-19/W-25). This module is the Windows counterpart, and it is the only
 * place the board starts `explorer.exe`, so the rules below cannot drift between
 * the four callers (project folder, project file, the Kosmos folder, sleep settings).
 *
 * 🔑 DETACHED AND NEVER WAITED ON. `explorer.exe <folder>` hands the request to the
 * running shell and exits, and it exits 1 even when the window opened. A caller that
 * waited and read the status would report every success as a failure. So the child
 * is spawned detached with no stdio and unref'd; "it opened" is the window itself,
 * and only a spawn that throws synchronously is reported as a failure.
 *
 * 🛑 NOTHING FROM A PAGE IS PASSED THROUGH UNCHECKED. Explorer parses its own command
 * line, and `/select,`, `/e,` and `/root,` are switches, so a string that begins with
 * a switch character is not a path. Every target must be an absolute drive or UNC
 * path with no quote or control character, and must exist as the kind of thing the
 * caller asked to open. Settings pages are a closed list; no caller can name a URI.
 * Arguments go as an array with no shell, so nothing is ever interpreted by cmd.
 *
 * ⚠️ LIVE-EXECUTION GATED (repo convention 3). Without the production opt-in and
 * without an injected runner this refuses, and inside a `node --test` process it
 * throws, so no test can open a real Explorer window on the machine running it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const liveExecution = require('./live-execution');

/**
 * The Settings pages the board may open, by purpose. A closed list on purpose: the
 * routes in front of this take no URI from the page, so they cannot become a way to
 * launch arbitrary protocol handlers. `ms-settings:powersleep` is the Windows 10 and
 * 11 page that holds "When plugged in, put my device to sleep after".
 */
const SETTINGS_PAGES = Object.freeze({ sleep: 'ms-settings:powersleep' });

/**
 * A drive path (`C:\...`) or a UNC share (`\\server\share...`). A bare rooted path
 * (`\foo`) is refused because its drive is whatever the process's is, and a leading
 * `/` is refused because Explorer reads it as a switch.
 */
const ABSOLUTE_WINDOWS_PATH = /^(?:[A-Za-z]:\\|\\\\[^\\/]+\\[^\\/]+)/;

/** A quote would end Node's argument quoting early; a control character is never a real path. */
const UNSAFE_PATH_CHARACTERS = /["\u0000-\u001f]/;

/** The sentence every refused or failed launch reports, so the page says one true thing. */
const EXPLORER_DID_NOT_OPEN = 'File Explorer did not open';

let runner = null;
/** Test seam: receives (explorerPath, args) instead of a real spawn. */
function setRunner(fn) { runner = typeof fn === 'function' ? fn : null; }

let statForTests = null;
/** Test seam: the existence check, so a Mac can assert the Windows arm with a Windows path. */
function setStatForTests(fn) { statForTests = typeof fn === 'function' ? fn : null; }

function explorerPath() {
  const windowsRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return path.win32.join(windowsRoot, 'explorer.exe');
}

/**
 * Why this target must not be handed to Explorer, or null when it may be.
 * @param {string} target
 * @param {'folder'|'file'} kind
 */
function targetRefusal(target, kind) {
  if (typeof target !== 'string' || !target) return 'there is nothing to open';
  if (UNSAFE_PATH_CHARACTERS.test(target)) return 'that is not a place File Explorer can open';
  const normalized = path.win32.normalize(target);
  if (!ABSOLUTE_WINDOWS_PATH.test(normalized)) return 'that is not a place File Explorer can open';
  let stat;
  try {
    stat = (statForTests || fs.statSync)(normalized);
  } catch {
    return kind === 'folder' ? 'that folder is not there any more' : 'that file is not there any more, or it was moved';
  }
  if (kind === 'folder' && !stat.isDirectory()) return 'that is not a folder';
  if (kind === 'file' && !stat.isFile()) return 'that is not a file we can open';
  return null;
}

function launch(args) {
  const exe = explorerPath();
  if (runner) return runner(exe, args);
  if (!liveExecution.liveExecutionAllowed()) {
    liveExecution.refuseOrWarn('win32explorer', exe, args);
    return { ok: false, because: EXPLORER_DID_NOT_OPEN };
  }
  try {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
    /* A missing explorer.exe arrives here asynchronously, after we have answered.
       It cannot change the answer any more, so it is logged with the command, which
       is what makes that rare failure diagnosable from the board's log alone. */
    child.on('error', (err) => {
      process.stderr.write('[win32explorer] ' + exe + ' ' + args.join(' ') + ' failed to start: '
        + String((err && err.message) || err) + '\n');
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    if (err instanceof ReferenceError || err instanceof TypeError) throw err;
    process.stderr.write('[win32explorer] ' + exe + ' ' + args.join(' ') + ' could not be spawned: '
      + String((err && err.message) || err) + '\n');
    return { ok: false, because: EXPLORER_DID_NOT_OPEN };
  }
}

/** Open a folder in File Explorer, showing what is inside it. */
function openFolder(folder) {
  const refusal = targetRefusal(folder, 'folder');
  if (refusal) return { ok: false, because: refusal };
  return launch([path.win32.normalize(folder)]);
}

/** Open one file with whatever Windows opens that kind of file with. */
function openFile(file) {
  const refusal = targetRefusal(file, 'file');
  if (refusal) return { ok: false, because: refusal };
  return launch([path.win32.normalize(file)]);
}

/** Open one of the closed list of Settings pages, by purpose. */
function openSettingsPage(purpose) {
  if (!Object.prototype.hasOwnProperty.call(SETTINGS_PAGES, purpose)) {
    return { ok: false, because: 'that is not a Settings page Kosmos opens' };
  }
  return launch([SETTINGS_PAGES[purpose]]);
}

module.exports = {
  SETTINGS_PAGES,
  EXPLORER_DID_NOT_OPEN,
  explorerPath,
  openFolder,
  openFile,
  openSettingsPage,
  setRunner,
  setStatForTests,
};
