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
 * 🛑 THREE WAYS A PATH BECOMES AN ATTACK, EACH CLOSED HERE (review round 1):
 *
 *   1. A NETWORK OR DEVICE PATH. Opening `\\host\share` makes Explorer authenticate to
 *      that host over SMB or WebDAV, handing it the person's NTLMv2 hash; `\\?\`,
 *      `\\.\` and GLOBALROOT reach devices and shadow copies. Only a path on one of
 *      this computer's own drive letters is accepted, for both open and reveal.
 *   2. A FILE THAT RUNS. Explorer "opens" a .bat, .lnk, .hta or .vbs by running it, and
 *      a file an agent wrote carries no Mark of the Web, so SmartScreen never asks. A
 *      file opens only when its type is on OPENABLE_FILE_EXTENSIONS; anything else is
 *      SHOWN in File Explorer (selected in its folder) and never run.
 *   3. A COMMA. Explorer splits its command line on commas, and Node quotes an argument
 *      only for spaces, tabs and quotes, so `Q3,Q4` opened the wrong place and
 *      `x,/root,` rewrote Explorer's switches. The path always travels as ONE quoted
 *      argument, passed verbatim, and a path containing a quote is refused.
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
 * The file types Kosmos will OPEN from a project's Documents list: documents, images,
 * audio, video and archives, whose default Windows handlers display content rather
 * than execute it. An allow-list rather than a deny-list because the set of types
 * Windows will run is open-ended (.bat .cmd .exe .lnk .url .hta .vbs .js .wsf .ps1 .scr
 * .pif .cpl .msc .msi .appref-ms, and whatever an installed program registers next);
 * a list of what is safe to open can only fail by showing a harmless file instead of
 * opening it. Everything not listed is revealed in File Explorer instead.
 *
 * `.rtf` is deliberately NOT here (review round 2): its default handler has a long
 * history of parser bugs reachable by simply opening a crafted file, and an agent can
 * write one into a project. It is shown in File Explorer like any unlisted type.
 */
const OPENABLE_FILE_EXTENSIONS = Object.freeze(new Set([
  '.txt', '.md', '.csv', '.tsv', '.log', '.json',
  '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic',
  '.mp3', '.m4a', '.wav', '.mp4', '.mov',
  '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp',
  '.zip',
]));

/** What a person reads when a file was shown rather than opened. */
const REVEALED_INSTEAD_SENTENCE = 'Kosmos showed this file in File Explorer instead of opening it, because files of this type can run programs.';

/** The only accepted shape: a path on a drive letter of this computer. */
const DRIVE_LETTER_PATH = /^[A-Za-z]:\\/;

/** A quote would end the quoting this module adds; a control character is never a real path. */
const UNSAFE_PATH_CHARACTERS = /["\u0000-\u001f]/;

/** The sentence every refused or failed launch reports, so the page says one true thing. */
const EXPLORER_DID_NOT_OPEN = 'File Explorer did not open';
const NOT_A_LOCAL_PLACE = 'Kosmos only opens places on this computer\'s own drives, not network shares or device paths';
const NOT_A_PLACE = 'that is not a place File Explorer can open';

let runner = null;
/** Test seam: receives (explorerPath, args) instead of a real spawn. */
function setRunner(fn) { runner = typeof fn === 'function' ? fn : null; }

let spawnForTests = null;
/** Test seam BELOW the live gate: replaces child_process.spawn for foregroundSettings only,
    so a test can see the spawn options the real launch passes (the runner seam above
    returns before them). */
function setSpawnForTests(fn) { spawnForTests = typeof fn === 'function' ? fn : null; }

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
  if (UNSAFE_PATH_CHARACTERS.test(target)) return NOT_A_PLACE;
  /* Checked on the RAW string as well as the normalized one: `//host/share` and
     `\\?\C:\` are both network or device forms before normalization tidies them. */
  if (/^[\\/]{2}/.test(target)) return NOT_A_LOCAL_PLACE;
  const normalized = path.win32.normalize(target);
  if (normalized.startsWith('\\\\')) return NOT_A_LOCAL_PLACE;
  if (!DRIVE_LETTER_PATH.test(normalized)) return NOT_A_PLACE;
  /* A colon past the drive letter is an alternate data stream (`notes.txt:evil.exe`). */
  if (normalized.indexOf(':', 2) > -1) return NOT_A_PLACE;
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

/**
 * The file's type as Windows will judge it: the last extension, lowercased, after the
 * trailing dots and spaces Windows itself strips (`report.pdf.bat.` runs as a .bat).
 */
function fileTypeOf(file) {
  const name = path.win32.basename(file).replace(/[. ]+$/, '');
  return path.win32.extname(name).toLowerCase();
}

/**
 * ONE argument, quoted, and passed verbatim so Node adds nothing and Explorer reads the
 * whole path as one path, commas and all. Trailing separators are dropped (a quoted
 * `C:\x\"` would read as an escaped quote), except on a bare drive root.
 */
function quotedPath(normalized) {
  const trimmed = normalized.length > 3 ? normalized.replace(/\\+$/, '') : normalized;
  return '"' + trimmed + '"';
}

function launch(args) {
  const exe = explorerPath();
  if (runner) return runner(exe, args);
  if (!liveExecution.liveExecutionAllowed()) {
    liveExecution.refuseOrWarn('win32explorer', exe, args);
    return { ok: false, because: EXPLORER_DID_NOT_OPEN };
  }
  try {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false, shell: false, windowsVerbatimArguments: true });
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
  return launch([quotedPath(path.win32.normalize(folder))]);
}

/**
 * Why a RESOLVED target must not be judged or opened, or null. It may be a UNC path (a
 * mapped drive resolves to one), but never a device form, a stream or an unsafe character.
 */
function resolvedTargetRefusal(resolved) {
  if (typeof resolved !== 'string' || !resolved || UNSAFE_PATH_CHARACTERS.test(resolved)) return NOT_A_PLACE;
  const normalized = path.win32.normalize(resolved);
  if (/^\\\\[?.]\\/.test(normalized) || /^[\\/]{2}[?.][\\/]/.test(resolved)) return NOT_A_LOCAL_PLACE;
  const streamFrom = DRIVE_LETTER_PATH.test(normalized) ? 2 : 0;
  if (normalized.indexOf(':', streamFrom) > -1) return NOT_A_PLACE;
  return null;
}

/**
 * Open one file with whatever Windows opens that kind of file with, when its type is
 * one that displays rather than runs; otherwise show it selected in its folder, and
 * say so. `revealedInstead` and `say` travel to the page, which shows the sentence.
 *
 * 🔑 TWO PATHS, TWO QUESTIONS (review round 2). `file` is the RESOLVED target, which is
 * what actually opens, so its type decides open versus reveal. `opts.namedAs` is the path
 * the person's project record names, before resolution. The drive-letter rule applies
 * to THAT path, and Explorer is handed it. A folder on a mapped drive (`Z:\`) resolves to
 * `\\server\share`, and refusing it here while "Open in File Explorer" opens the same
 * `Z:\` folder raw would be two answers to one question; the person or their IT chose
 * that server, and the board's own folder check already reaches it. A record that names
 * a UNC or device path itself is still refused.
 */
function openFile(file, opts) {
  const namedAs = opts && typeof opts.namedAs === 'string' ? opts.namedAs : file;
  const refusal = targetRefusal(namedAs, 'file');
  if (refusal) return { ok: false, because: refusal };
  if (namedAs !== file) {
    const resolvedRefusal = resolvedTargetRefusal(file);
    if (resolvedRefusal) return { ok: false, because: resolvedRefusal };
  }
  const launched = path.win32.normalize(namedAs);
  if (OPENABLE_FILE_EXTENSIONS.has(fileTypeOf(path.win32.normalize(file)))) return launch([quotedPath(launched)]);
  const shown = launch(['/select,' + quotedPath(launched)]);
  return shown.ok ? { ok: true, revealedInstead: true, say: REVEALED_INSTEAD_SENTENCE } : shown;
}

/** #4930: show one file selected in its folder in File Explorer (never opens it). */
function revealFile(file) {
  // The refusal's own words speak of opening; this never opens, so it says what it could not do.
  if (targetRefusal(file, 'file')) return { ok: false, because: 'Kosmos cannot show that file in File Explorer' };
  return launch(['/select,' + quotedPath(path.win32.normalize(file))]);
}

/** Open one of the closed list of Settings pages, by purpose. */
function openSettingsPage(purpose) {
  if (!Object.prototype.hasOwnProperty.call(SETTINGS_PAGES, purpose)) {
    return { ok: false, because: 'that is not a Settings page Kosmos opens' };
  }
  return launch([SETTINGS_PAGES[purpose]]);
}

/**
 * Bring the Settings window to the FOREGROUND after openSettingsPage opened it.
 *
 * 🛑 WHY THIS IS NEEDED. An `ms-settings:` page opened by the board comes up BEHIND the
 * Kosmos window: the board is a background process, and Windows' foreground lock denies
 * a window raised by a process that does not itself hold the foreground. On the Mac the
 * same button uses `/usr/bin/open`, which foregrounds System Settings for free, so this
 * is the Windows half of that parity (#3324, Josh's laptop, first-run sleep step).
 *
 * 🔑 BEST EFFORT, NEVER WAITED ON, and its result does not change whether the
 * page opened. The page is already up; a helper that cannot raise it leaves the window
 * behind, which is exactly the pre-fix state, so a failure here is silent by design.
 *
 * The technique is the documented one for foregrounding another process's window from a
 * background one: attach this thread's input queue to the current foreground thread's
 * (AttachThreadInput), which lifts the lock for the call, then SetForegroundWindow. It
 * polls briefly because the Settings window appears a moment after the launch returns.
 *
 * 🔑 THE WINDOW IS NOT SystemSettings'. Settings is a packaged app: its top-level window
 * is an `ApplicationFrameWindow` owned by ApplicationFrameHost, and SystemSettings only
 * owns a CoreWindow CHILD inside it, so SystemSettings' MainWindowHandle is 0 (measured on
 * Windows 11 24H2, 2026-10-02; the first version looked there, found nothing, and the
 * window stayed behind). FrameOf finds the visible frame whose child belongs to a
 * SystemSettings pid. The title is not matched: it is localized.
 *
 * NOTHING CALLER-CONTROLLED reaches the shell: the script is a fixed constant, and it is
 * passed as -EncodedCommand (base64 UTF-16LE) so it survives argv as ONE space-free token
 * with no quoting to get wrong. windowsHide is true here (unlike the Explorer launch): a
 * helper the person never asked to see must not flash a console window.
 */
const FOREGROUND_SETTINGS_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  'Add-Type -Namespace KWin -Name Native -MemberDefinition @\'',
  '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
  '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);',
  '[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);',
  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);',
  '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
  '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
  'public delegate bool EnumProc(IntPtr h, IntPtr l);',
  '[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);',
  '[DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);',
  '[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);',
  '[DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);',
  '[DllImport("user32.dll", EntryPoint="GetWindowThreadProcessId")] static extern uint WindowPid(IntPtr h, out uint pid);',
  'public static IntPtr FrameOf(uint pid) {',
  '  IntPtr found = IntPtr.Zero;',
  '  EnumWindows(delegate(IntPtr f, IntPtr l) {',
  '    if (!IsWindowVisible(f)) return true;',
  '    var c = new System.Text.StringBuilder(64); GetClassName(f, c, 64);',
  '    if (c.ToString() != "ApplicationFrameWindow") return true;',
  '    EnumChildWindows(f, delegate(IntPtr k, IntPtr m) {',
  '      uint p; WindowPid(k, out p);',
  '      if (p != 0 && p == pid) { found = f; return false; }',
  '      return true;',
  '    }, IntPtr.Zero);',
  '    return found == IntPtr.Zero;',
  '  }, IntPtr.Zero);',
  '  return found;',
  '}',
  '\'@',
  '$deadline=(Get-Date).AddSeconds(5)',
  'do{',
  '  $h=[IntPtr]::Zero',
  '  foreach($p in Get-Process -Name SystemSettings -ErrorAction SilentlyContinue){',
  '    $h=[KWin.Native]::FrameOf([uint32]$p.Id)',
  '    if($h -eq [IntPtr]::Zero -and $p.MainWindowHandle -ne 0){ $h=$p.MainWindowHandle }',
  '    if($h -ne [IntPtr]::Zero){ break }',
  '  }',
  '  if($h -ne [IntPtr]::Zero){',
  '    $fg=[KWin.Native]::GetForegroundWindow()',
  '    $ft=[KWin.Native]::GetWindowThreadProcessId($fg,[IntPtr]::Zero)',
  '    $me=[KWin.Native]::GetCurrentThreadId()',
  '    [void][KWin.Native]::AttachThreadInput($me,$ft,$true)',
  '    if([KWin.Native]::IsIconic($h)){ [void][KWin.Native]::ShowWindowAsync($h,9) }',
  '    [void][KWin.Native]::SetForegroundWindow($h)',
  '    [void][KWin.Native]::AttachThreadInput($me,$ft,$false)',
  '    if([KWin.Native]::GetForegroundWindow() -eq $h){ break }',
  '  }',
  '  Start-Sleep -Milliseconds 120',
  '} while((Get-Date) -lt $deadline)',
].join('\n');

function powershellPath() {
  const windowsRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/* 🛑 NOT DETACHED, unlike the Explorer launch above. `detached` on Windows means
   DETACHED_PROCESS: no console at all, and powershell.exe 5.1 started that way exits 0 in
   ~65 ms without running a line (measured 2026-10-02; the same launch without it runs).
   The first version was detached, so the helper never ran. windowsHide gives it a HIDDEN
   console instead, and unref() keeps it never-waited-on. Not detached also means libuv
   puts it in the board's kill-on-close job, so it dies if the board exits: acceptable,
   its whole life is the few seconds it takes to find and raise one window. */
const FOREGROUND_SPAWN_OPTIONS = Object.freeze({ detached: false, stdio: 'ignore', windowsHide: true, shell: false });

/** Raise the Settings window; see FOREGROUND_SETTINGS_SCRIPT. Best effort. */
function foregroundSettings() {
  const exe = powershellPath();
  /* -WindowStyle Hidden is belt and braces: what actually hides the console is windowsHide
     in FOREGROUND_SPAWN_OPTIONS (CREATE_NO_WINDOW). */
  const args = ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand',
    Buffer.from(FOREGROUND_SETTINGS_SCRIPT, 'utf16le').toString('base64')];
  if (runner) return runner(exe, args);
  if (!liveExecution.liveExecutionAllowed()) {
    liveExecution.refuseOrWarn('win32explorer', exe, args);
    return { ok: false, because: EXPLORER_DID_NOT_OPEN };
  }
  try {
    const child = (spawnForTests || spawn)(exe, args, FOREGROUND_SPAWN_OPTIONS);
    child.on('error', (err) => {
      process.stderr.write('[win32explorer] ' + exe + ' foreground helper failed to start: '
        + String((err && err.message) || err) + '\n');
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    if (err instanceof ReferenceError || err instanceof TypeError) throw err;
    return { ok: false, because: EXPLORER_DID_NOT_OPEN };
  }
}

module.exports = {
  SETTINGS_PAGES,
  OPENABLE_FILE_EXTENSIONS,
  REVEALED_INSTEAD_SENTENCE,
  EXPLORER_DID_NOT_OPEN,
  explorerPath,
  powershellPath,
  openFolder,
  openFile,
  revealFile,
  openSettingsPage,
  foregroundSettings,
  FOREGROUND_SETTINGS_SCRIPT,
  FOREGROUND_SPAWN_OPTIONS,
  setSpawnForTests,
  setRunner,
  setStatForTests,
};
