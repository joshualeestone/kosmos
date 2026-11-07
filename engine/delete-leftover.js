'use strict';
/**
 * Delete what is left of an agent (#514).
 *
 * `remove.js`'s first rule is that nothing on disk is ever deleted, and that
 * rule is what makes a removal reversible. It is also why a removed agent's
 * name stays taken: `create.js` refuses a name whose folder or job file still
 * exists. So a person who removed an agent and wants the name back has,
 * until this module, no way through the product. This is the separate verb
 * that frees the name, kept out of `remove.js` on purpose so the never-delete
 * rule there stays true to the letter.
 *
 * THE TWO QUESTIONS (the product's own rule for anything you cannot take
 * back): can the person undo it themselves, and before anyone acted on it?
 * A folder that goes to the Mac's Trash answers yes to both, so that is what
 * this does whenever it can: the folder and the job file are MOVED into
 * `~/.Trash` under a dated name, where Finder shows them and the person can
 * drag them back (on Linux the desktop Trash, `~/.local/share/Trash`, with the
 * record a file manager needs to put them back; #5445; on Windows the Recycle
 * Bin, kosmos#7820). Only when the Trash cannot take them (a different volume,
 * no Trash directory, or on Windows anything that rules the Recycle Bin out)
 * are they deleted for good, and the plan says which BEFORE the click, so the
 * confirmation is never lighter than the act.
 *
 * What it touches, and nothing else: `<WORKERS_DIR>/<name>`,
 * `<AGENTS_DIR>/<label>.plist` (both resolved by `create.js`, one definition
 * of where an agent lives), the agent's SENDER TOKENS, its failed-restart
 * record, its community moderation standing (#5000, which goes back to the
 * start), and (#4994) its COMMUNITY ACCOUNT, which is retired: a request file
 * under the community folder, and a never-send mark on its posts and comments
 * in the board's community store.
 *
 * 🛑 ON WINDOWS THE SECOND OF THOSE IS NOT A FILE (#570). The job is a Scheduled
 * Task, so this module -- which exists to say a name is FREE -- was looking for a
 * plist that platform never writes, finding none, and freeing names while the
 * task stayed registered to start an agent under them at the next logon. The
 * win32 arm asks `win32job` and unregisters the task instead of moving a file;
 * a look it cannot make REFUSES rather than reporting an empty machine.
 *
 * 🛑 THE TOKENS ARE HERE BECAUSE OF #1131, AND THE LAST LINE OF THIS FILE IS
 * WHY. On success it says "The name is free." A freed name is re-usable, and
 * until this call the token store was the one thing that outlived the files:
 * `resolve()` matches a token to a NAME, so a credential minted for the old
 * agent re-attached to the next agent that took the name. `sendertoken`'s own
 * header has always said a caller that deletes an agent MUST call `revoke()`.
 * Nothing did. Deleting the files while leaving the credential is the half of
 * the job that looks finished. A folder that is a symlink, or that resolves
 * outside WORKERS_DIR, is refused rather than followed. A name with a live
 * session is refused: this is for leftovers, and a running agent is not one.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const create = require('./create');
const remove = require('./remove');
const liveExec = require('./live-execution');
const sendertoken = require('./sendertoken');
const status = require('./status');

const OUTCOME = { DELETED: 'deleted', REFUSED: 'refused', PARTIAL: 'partial' };
/* 🛑 A FUNCTION, NOT A CONST (#1432). Frozen at require time this read past
   the sandbox seam: a caller setting `AGENT_WORKFORCE_HOME` AFTER requiring
   this module operated on the operator's real machine while believing it was
   sandboxed. Measured elsewhere in this class: `accounts.list()` returned four
   of the operator's real accounts against an empty fixture (#1419). */
function homeDir() { return process.env.AGENT_WORKFORCE_HOME || os.homedir(); }
/* #5445: on Linux the desktop Trash is the freedesktop one, $XDG_DATA_HOME/Trash/files (default
   ~/.local/share/Trash/files), not ~/.Trash, which no Linux file manager shows. A sandboxed home
   (AGENT_WORKFORCE_HOME) ignores XDG_DATA_HOME, which names the person's real folder. */
function linuxTrashRoot() {
  const xdg = !process.env.AGENT_WORKFORCE_HOME && process.env.XDG_DATA_HOME;
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(homeDir(), '.local', 'share'), 'Trash');
}
const TRASH = (platform) => process.env.AGENT_WORKFORCE_TRASH
  || ((platform || process.platform) === 'linux' ? path.join(linuxTrashRoot(), 'files') : path.join(homeDir(), '.Trash'));
/* A walk that stops counting past this many entries: the numbers are for a
   sentence, and "more than 20,000 files" is the honest form past it. */
const WALK_CAP = 20000;

/* Test seam for the one thing this runs: `launchctl bootout` before the job
   file goes, so launchd does not keep a job whose file has vanished. */
let runner = null;
/* Drive root -> { info, at }: the drive probe's answer, kept a minute (the agent page asks on every visit, and each ask
   is a PowerShell start; a minute is short enough that a changed Recycle Bin setting is seen). A probe that gave no
   answer is kept 5 s, and a running delete's own re-plan reads the answers its warm kept whatever their age. Cleared by
   setRunner/resetForTests (below) so a test's new answer is heard. */
const driveTypes = new Map();
/* kosmos#7835: drive root -> the probe running for it off the board, so two pages opening together share one. */
const probing = new Map();
/* #1598: honor AGENT_WORKFORCE_DRY_RUN, symmetric with remove.js. Without this,
   an operator who set the env on the opted-in board got asymmetric behaviour,
   remove dry-runs while this executes live. Read at load (the board reads env at
   startup); a test controls it through resetForTests. */
let DRY_RUN = process.env.AGENT_WORKFORCE_DRY_RUN === '1';
function setRunner(fn) { runner = typeof fn === 'function' ? fn : null; if (!runner) DRY_RUN = true; driveTypes.clear(); probing.clear(); }
/* Test seam (#1598): back to fail-closed (no runner, dry-run flag off) so a test
   can exercise the live-execution gate directly. */
function resetForTests() { runner = null; DRY_RUN = false; driveTypes.clear(); probing.clear(); }
function run(file, args, opts) {
  if (runner) return runner(file, args, opts);
  if (DRY_RUN) return { ok: true, stdout: '', dryRun: true };
  /* #1598: fail closed, the same gate as remove.js. This module had NO dry-run
     default of its own, so before the fix a fresh require went straight to live
     launchctl/tmux (its one call spells `launchctl` bare and also boots jobs).
     Live only when production has opted in; otherwise refuseOrWarn throws in a
     test (refusing to fake success) or warns loudly and we dry-run in prod. */
  if (!liveExec.liveExecutionAllowed()) {
    liveExec.refuseOrWarn('engine/delete-leftover.js', file, args);
    return { ok: true, stdout: '', dryRun: true };
  }
  try {
    return { ok: true, stdout: execFileSync(file, args, { encoding: 'utf8', timeout: (opts && opts.timeout) || 20000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...(opts && opts.env ? { env: opts.env } : {}) }) };
  } catch (err) {
    return { ok: false, code: err && err.status, stderr: String(err && err.stderr || '') };
  }
}
/* kosmos#7835: run() without holding the board, for the Windows PowerShell calls that can take seconds (the drive probe)
   or minutes (a Recycle Bin move behind a hidden error dialog). The same seams and gate as run(): a test runner (whose
   answer may be a promise), the dry-run flag, the live-execution gate. */
async function runAsync(file, args, opts) {
  if (runner) return runner(file, args, opts);
  if (DRY_RUN) return { ok: true, stdout: '', dryRun: true };
  if (!liveExec.liveExecutionAllowed()) {
    liveExec.refuseOrWarn('engine/delete-leftover.js', file, args);
    return { ok: true, stdout: '', dryRun: true };
  }
  return execAsync(file, args, opts);
}
/* The live half, the shape of remove.js's execAsync (#6173), with this module's env and windowsHide: it ALWAYS answers.
   SIGKILL at the limit (a SIGTERM can be ignored); a last timer answers even when the pipes never close (a grandchild,
   such as a hidden dialog's, holding them), so a delete's hold on its name always ends; stdin closed, as run()'s
   'ignore'; a process killed at its limit has no exit code (Windows reports it as exit 1, which would read as a real
   answer). */
const EXEC_HARD_GRACE_MS = 5000;
function execAsync(file, args, opts) {
  return new Promise((resolve) => {
    const text = (v) => (v == null ? '' : String(v)).slice(0, 2000);
    const limit = (opts && opts.timeout) || 20000;
    let answered = false;
    let hard = null;
    const answer = (v) => { if (answered) return; answered = true; clearTimeout(hard); resolve(v); };
    let child;
    try {
      child = execFile(file, args, { encoding: 'utf8', timeout: limit, killSignal: 'SIGKILL', windowsHide: true, ...(opts && opts.env ? { env: opts.env } : {}) },
        (err, stdout, stderr) => {
          if (!err) { answer({ ok: true, stdout: String(stdout || '') }); return; }
          // No stdout on a failure, as run(): a line printed before the kill is not this answer.
          answer({ ok: false, code: !err.killed && typeof err.code === 'number' ? err.code : null, stderr: text(stderr) });
        });
    } catch (err) { answer({ ok: false, code: null, stderr: text(err && err.message) }); return; }
    hard = setTimeout(() => answer({ ok: false, code: null, stderr: 'it did not answer within its time limit' }), limit + EXEC_HARD_GRACE_MS);
    if (hard.unref) hard.unref();
    if (child && child.stdin) child.stdin.end();
  });
}

function insideDir(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Count what a folder holds: files, bytes, newest change. Never follows
    symlinks. Capped, and says so. */
function measure(dir) {
  let files = 0;
  let bytes = 0;
  let newest = 0;
  let capped = false;
  let git = false;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (files >= WALK_CAP) { capped = true; break; }
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) { files += 1; continue; }
      if (e.isDirectory()) {
        if (d === dir && e.name === '.git') git = true;
        stack.push(p);
        continue;
      }
      files += 1;
      try {
        const st = fs.statSync(p);
        bytes += st.size;
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch { /* counted, not sized */ }
    }
    if (capped) break;
  }
  return { files, bytes, newest: newest ? Math.floor(newest / 1000) : 0, capped, git };
}

function sizeWords(bytes) {
  if (bytes < 1024) return bytes + ' bytes';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' GB';
}
function agoWords(unix, now) {
  if (!unix) return '';
  const s = Math.max(0, Math.floor((now || Date.now()) / 1000 - unix));
  if (s < 60) return 'a moment ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
  const h = Math.floor(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 30) return d + ' days ago';
  return 'on ' + new Date(unix * 1000).toISOString().slice(0, 10);
}
function filesWords(m) {
  const n = m.capped ? 'more than ' + m.files.toLocaleString('en-US') : m.files.toLocaleString('en-US');
  return n + (m.files === 1 && !m.capped ? ' file' : ' files');
}

/* kosmos#7820: ON WINDOWS THE TRASH IS THE RECYCLE BIN, which is not a folder Kosmos can rename into: `%USERPROFILE%\.Trash`
   does not exist there and no Windows person would look in it, so before this every Windows folder was deleted for good.
   The move goes through Windows PowerShell's VisualBasic FileSystem.DeleteDirectory(..., SendToRecycleBin), the one call
   that puts a folder where Explorer's Restore can bring it back, with no new binary. The path reaches PowerShell in an
   environment variable, never inside the script text, so no character in a folder name can become code.
   🛑 THE RECYCLE BIN CAN SAY YES AND DELETE ANYWAY. With 'OnlyErrorDialogs' nothing is asked, so Windows deletes outright
   when the drive has no Recycle Bin (removable, network), when the drive is set to remove files immediately (the
   volume's NukeOnDelete, or the NoRecycleFiles policy), or when the folder is bigger than the Recycle Bin may hold. So
   the plan offers the Recycle Bin only when the drive probe rules all of those out (`binVerdict`); anything it cannot
   read answers no and keeps the honest "for good" sentence and the typed name. After the move the script counts the
   folder IN the Recycle Bin: only then does the outcome say the files are there.
   ⚠️ 'OnlyErrorDialogs' still shows ERROR dialogs (there is no option that recycles and hides them). A file held open can
   raise one from the hidden PowerShell, which nobody may see; the call then waits until the timeout ends it, and the
   folder can be left partly in the Recycle Bin. Both calls are synchronous, like the fs.rmSync they replace, so the
   whole board waits with them (every page and request), which is accepted here and named in the plan; the drive answer
   is kept a minute per drive so a plan and its delete ask once. */
function powershell() {
  return path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
const RECYCLE_PATH_VAR = 'KOSMOS_RECYCLE_PATH';
/* Prints one line of JSON, or UNKNOWN: the drive's type and size, the NoRecycleFiles policy, and the volume's own
   Recycle Bin settings (NukeOnDelete, MaxCapacity in MB), which are null when they could not be read. */
const DRIVE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
  String.raw`try { $r=[System.IO.Path]::GetPathRoot($env:KOSMOS_RECYCLE_PATH); if (-not $r -or $r.StartsWith('\\')) { 'UNKNOWN'; exit 0 }`
    + String.raw`; $d=New-Object System.IO.DriveInfo $r; $o=[ordered]@{ type=[string]$d.DriveType; total=[int64]$d.TotalSize; policy=$false; nuke=$null; maxMB=$null; globalNuke=$null; globalMaxMB=$null }`
    + String.raw`; $g=Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket' -ErrorAction SilentlyContinue; if ($g) { $o.globalNuke=$g.NukeOnDelete; $o.globalMaxMB=$g.MaxCapacity }`
    + String.raw`; foreach ($k in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer','HKLM:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer') { $v=(Get-ItemProperty -LiteralPath $k -Name NoRecycleFiles -ErrorAction SilentlyContinue).NoRecycleFiles; if ($v -eq 1) { $o.policy=$true } }`
    + String.raw`; try { $vol=(Get-CimInstance Win32_Volume -Filter ('DriveLetter=''' + $r.Substring(0,2) + '''')).DeviceID; if ($vol -match '\{[0-9A-Fa-f-]+\}') { $bb=Get-ItemProperty -LiteralPath ('HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\' + $Matches[0]) -ErrorAction SilentlyContinue; if ($bb) { $o.nuke=$bb.NukeOnDelete; $o.maxMB=$bb.MaxCapacity } } } catch { }`
    + String.raw`; $o | ConvertTo-Json -Compress } catch { 'UNKNOWN' }`,
].join('; ');
/* The Recycle Bin is offered only with room to spare: 90% of its limit. With no limit recorded for the volume, 5% of
   the drive stands in for it, the low end of what Windows sets by default. */
const BIN_ROOM = 0.9;
const BIN_DEFAULT_SHARE = 0.05;
/** win32: from the drive probe's answer and the folder's measure, whether the Recycle Bin will really keep it. */
function binVerdict(info, m) {
  // globalNuke: Windows' "one setting for all drives" switch, read whether or not that mode is on (a yes there is a no).
  if (!info || info.type !== 'Fixed' || info.policy === true || Number(info.nuke) === 1 || Number(info.globalNuke) === 1) return false;
  if (m && m.capped) return false;   // its size is not known, so it cannot be said to fit
  // The smaller of the volume's own limit and the "one setting for all drives" one, whichever were read.
  const limits = [info.maxMB, info.globalMaxMB].filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
  const maxBytes = limits.length
    ? Math.min(...limits) * 1024 * 1024
    : (Number.isFinite(Number(info.total)) && Number(info.total) > 0 ? Number(info.total) * BIN_DEFAULT_SHARE : 0);
  return maxBytes > 0 && ((m && m.bytes) || 0) <= maxBytes * BIN_ROOM;
}
/* Whether the folder landed in the Recycle Bin is read by COUNTING the items there with its name and original folder,
   before and after the call: a new one means it is there. No delete time is compared (the Recycle Bin's own time and
   PowerShell's clock need not agree on a time zone), and an older item with the same name cannot pass for this one. */
const RECYCLE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
  '$p=$env:KOSMOS_RECYCLE_PATH',
  '$dir=[System.IO.Path]::GetDirectoryName($p); $leaf=[System.IO.Path]::GetFileName($p); $stem=[System.IO.Path]::GetFileNameWithoutExtension($p); $isFile=Test-Path -LiteralPath $p -PathType Leaf',
  // Each count stops after 15 s, so a large Recycle Bin cannot eat the move's own time; a stopped count reads UNVERIFIED.
  "function Get-KosmosBinCount { $sw=[System.Diagnostics.Stopwatch]::StartNew(); $n=0; foreach ($i in (New-Object -ComObject Shell.Application).Namespace(10).Items()) { if ($sw.Elapsed.TotalSeconds -gt 15) { throw 'slow' }; if (($i.Name -eq $leaf -or ($isFile -and $i.Name -eq $stem)) -and ([string]$i.ExtendedProperty('System.Recycle.DeletedFrom')).TrimEnd([char]92) -eq $dir.TrimEnd([char]92)) { $n++ } }; $n }",
  '$before=$null; try { $before=Get-KosmosBinCount } catch { }',
  // A single file (an agent's settings or picture) goes through DeleteFile, a folder through DeleteDirectory.
  "try { Add-Type -AssemblyName Microsoft.VisualBasic; if (Test-Path -LiteralPath $p -PathType Leaf) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } } catch { $e=$_.Exception; if ($e.InnerException) { $e=$e.InnerException }; 'FAILED ' + $e.Message; exit 0 }",
  "if (Test-Path -LiteralPath $p) { 'STILL'; exit 0 }",
  "if ($null -eq $before) { 'UNVERIFIED'; exit 0 }",
  "$after=$null; try { $after=Get-KosmosBinCount } catch { 'UNVERIFIED'; exit 0 }",
  "if ($after -gt $before) { 'RECYCLED' } else { 'GONE' }",
].join('; ');
const DRIVE_KEEP_MS = 60000;
/* kosmos#7835 item 2: a probe that gave no answer (timed out on a busy machine) is kept only this long, so one slow
   start does not make every plan on that drive say "for good" for a whole minute. */
const DRIVE_FAIL_KEEP_MS = 5000;
const keptFor = (kept) => (kept && kept.info ? DRIVE_KEEP_MS : DRIVE_FAIL_KEEP_MS);
const DRIVE_TIMEOUT_MS = 5000;
/* kosmos#7835 item 5: the warm runs off the board, so it can wait for a cold PowerShell start (often past 5 s on a
   Windows machine just started), which would otherwise make the first plan after it say "for good". */
const DRIVE_WARM_TIMEOUT_MS = 20000;
const RECYCLE_TIMEOUT_MS = 120000;
function psRun(script, p, timeout) {
  return run(powershell(), ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, [RECYCLE_PATH_VAR]: p }, timeout });
}
function psRunAsync(script, p, timeout) {
  return runAsync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, [RECYCLE_PATH_VAR]: p }, timeout });
}
/* The real path of the folder that HOLDS `p`, joined with `p`'s own name: a link on the way is judged by the volume
   the files are on, and a link AT `p` (a settings file or picture can be one) is what goes to the Recycle Bin, never
   the file it points at, as renameSync and rmSync act on the link itself on the Mac and Linux. */
function realPath(p) {
  const P = /^[A-Za-z]:[\\/]|^\\\\/.test(p) ? path.win32 : path;   // a Windows path is split by Windows rules on any host
  return P.join(fs.realpathSync.native(P.dirname(p)), P.basename(p));
}
/* The path the probe asks about and its drive root, or null when the Recycle Bin is ruled out before any probe (a path
   that cannot be read, a network share). */
function driveOf(p) {
  if (typeof p !== 'string' || p.startsWith('\\\\')) return null;
  let real = p;
  try { real = realPath(p); } catch (err) { if (!(err && err.code === 'ENOENT')) return null; }
  if (real.startsWith('\\\\')) return null;
  return { real, root: path.win32.parse(real).root.toLowerCase() };
}
function keepDrive(root, out) {
  let info = null;
  if (out && out.ok) { try { info = JSON.parse(String(out.stdout || '').trim()); } catch { info = null; } }
  if (root && !(out && out.dryRun)) driveTypes.set(root, { info, at: Date.now() });
  return info;
}
/* `pinned` (kosmos#7835): drive roots a running delete warmed. Its own re-plan reads their kept answers whatever their
   age (a short keep could run out between the warm and the re-plan and start the probe again on the board's thread);
   every other plan keeps the ordinary 5 s / 60 s keeps. */
function freshDrive(root, pinned) {
  const kept = root ? driveTypes.get(root) : null;
  // A pinned answer can be a failed one (no answer, so "for good"): the re-plan then asks for the typed name, and a
  // delete confirmed without it is refused with that plan, so the person confirms the stronger loss.
  if (kept && pinned && pinned.includes(root)) return kept;
  return kept && Date.now() - kept.at < keptFor(kept) ? kept : null;
}
/** win32: whether the Recycle Bin can take `p`, whose measure (bytes, capped) is `m`. See `binVerdict`; any answer
    we cannot read is false. kosmos#7835: `how.probe` false answers from a kept probe only, never starting PowerShell;
    `how.pinned` names drive roots whose kept answer stands whatever its age. */
function recycleBinCanTake(p, m, how) {
  const d = driveOf(p);
  if (!d) return false;
  const kept = freshDrive(d.root, how && how.pinned);
  if (kept) return binVerdict(kept.info, m);
  if (how && how.probe === false) return false;
  let out;
  try { out = psRun(DRIVE_SCRIPT, d.real, DRIVE_TIMEOUT_MS); } catch (err) {
    if (err && err.code === 'LIVE_EXECUTION_REFUSED') throw err;   // live-execution.js: let the refusal through
    out = { ok: false };
  }
  return binVerdict(keepDrive(d.root, out), m);
}
/* kosmos#7835: the same probe without holding the board, kept for the synchronous plan that follows. One probe per
   drive at a time: two agent pages opening together share it. */
function warmDrive(p) {
  const d = driveOf(p);
  if (!d || !d.root) return Promise.resolve(null);
  if (freshDrive(d.root)) return Promise.resolve(d.root);
  const before = driveTypes.get(d.root);
  const stored = () => (driveTypes.get(d.root) !== before ? d.root : null);
  if (probing.has(d.root)) return probing.get(d.root).then(stored);
  const go = (async () => {
    let out;
    try { out = await psRunAsync(DRIVE_SCRIPT, d.real, DRIVE_WARM_TIMEOUT_MS); } catch (err) {
      if (err && err.code === 'LIVE_EXECUTION_REFUSED') return;   // the synchronous plan meets the refusal itself
      out = { ok: false };
    }
    keepDrive(d.root, out);
  })().finally(() => { if (probing.get(d.root) === go) probing.delete(d.root); });
  probing.set(d.root, go);
  return go.then(stored);
}
/** win32: send `p` to the Recycle Bin. 'recycled' (it is there), 'gone' (it is gone, and not found in the Recycle Bin),
    'unverified' (it is gone, and the Recycle Bin could not be read), or throws with what went wrong. The folder's
    absence is checked here too: the script's word alone is not trusted. */
function recycle(p) {
  return recycleOutcome(p, psRun(RECYCLE_SCRIPT, realPath(p), RECYCLE_TIMEOUT_MS));
}
/* kosmos#7835: the same move without holding the board. */
async function recycleAsync(p) {
  return recycleOutcome(p, await psRunAsync(RECYCLE_SCRIPT, realPath(p), RECYCLE_TIMEOUT_MS));
}
/* What the move's answer means: { where, note? }, or throws while it is still there. kosmos#7835 item 4: an error
   Windows raised after it was already gone is kept as the step's note, not dropped. */
function recycleOutcome(p, out) {
  const said = String((out && out.stdout) || '').trim();
  if (fs.existsSync(p)) {
    if (said.startsWith('FAILED ')) throw new Error(said.slice(7));
    if (said === 'STILL') throw new Error('Windows left it where it was');
    // PowerShell that timed out or did not start: say which, for whoever reads the step.
    if (out && out.ok === false) {
      const why = String(out.stderr || '').trim().split(/\r?\n/)[0];
      throw new Error('Windows PowerShell did not finish' + (out.code !== undefined && out.code !== null ? ` (exit ${out.code})` : '') + (why ? `: ${why}` : ''));
    }
    throw new Error('still there');
  }
  if (said.startsWith('FAILED ')) return { where: 'unverified', note: 'Windows said: ' + said.slice(7) };
  return { where: said === 'RECYCLED' ? 'recycled' : (said === 'GONE' ? 'gone' : 'unverified') };
}
/* The words for where the files go: a Windows person looks for the Recycle Bin, not the Trash. */
function binWords(platform) { return platform === 'win32' ? 'the Recycle Bin' : 'the Trash'; }

/** Whether the Trash can take a path: it exists, and it is on the same
    volume, so a rename works and nothing is copied-then-deleted. */
/* kosmos#7835: what a plan's options say about probing the drive (see recycleBinCanTake). */
function probeHow(opts) { return { probe: !(opts && opts.probe === false), pinned: (opts && opts.pinned) || null }; }
function trashCanTake(p, platform, m, how) {
  if ((platform || process.platform) === 'win32') return recycleBinCanTake(p, m, how);
  try {
    let t;
    try { t = fs.statSync(TRASH(platform)); } catch (e) {
      /* #5445: a Linux desktop makes its Trash on first use, so a missing one is made at the move (as the Mac's
         mkdir does); the volume is then its home's. Anywhere else a missing Trash still cannot take it. */
      if (!(e && e.code === 'ENOENT' && (platform || process.platform) === 'linux' && !process.env.AGENT_WORKFORCE_TRASH)) throw e;
      // The nearest folder that exists on the way to it: the volume the mkdir will make the Trash on (review 1).
      let at = path.dirname(TRASH(platform));
      for (;;) { try { t = fs.statSync(at); break; } catch (e2) { if (!(e2 && e2.code === 'ENOENT') || path.dirname(at) === at) throw e2; at = path.dirname(at); } }
    }
    if (!t.isDirectory()) return false;
    return fs.statSync(p).dev === t.dev;
  } catch { return false; }
}

/* #5003: the agent's own spelling of `asked`, read from the disk, on a case-blind platform, and only when the two differ
   in case alone. In order:
   1. (Mac) the name inside its auto-start file's real name: that file IS the launchd label the delete must stop, so
      when it exists its spelling wins and the folder is NOT read at all (the early return is deliberate).
   2. its folder's real name, but only when no folder is recorded for the agent, so the folder is the default one in
      the workers folder (workerDir answers a recorded folder or that, nothing else). A connected agent's recorded
      folder can be named anything (discover.connect lets a person type the name), so its name says nothing.
   A linked folder is not read here (plan() refuses it). Anything unreadable leaves `asked`.
   ⚠️ KNOWN GAP: a Windows leftover with ONLY its startup task. Task Scheduler ignores case, so the task is removed,
   but the board's other records keep the asked spelling. Reading the task's real name means parsing schtasks
   output, which this Mac-built change cannot test against a real Windows answer. */
function realCaseName(asked, platform) {
  if (platform !== 'darwin' && platform !== 'win32') return asked;
  const sameButCase = (real) => (typeof real === 'string' && real !== asked && real.toLowerCase() === asked.toLowerCase() ? real : null);
  if (platform === 'darwin') {
    try {
      const real = path.basename(fs.realpathSync.native(create.plistPath(asked)), '.plist');
      const parsed = create.parseServiceLabel(real);
      const named = sameButCase(parsed && parsed.name);
      if (parsed) return named || asked;
    } catch { /* no auto-start file: try the folder */ }
  }
  let recorded = null;
  try { recorded = require('./store').readProfile(asked).dir || null; } catch { recorded = null; }
  if (recorded) return asked;
  try {
    const dir = create.workerDir(asked);
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) return asked;
    const real = fs.realpathSync.native(dir);
    return sameButCase(path.basename(real)) || asked;
  } catch { return asked; }
}

/**
 * What deleting would do, in the engine's words. `ok: false` with a `because`
 * when it must not be offered. The confirmation paints THESE words, never its
 * own, so the description of the act cannot drift from the act.
 */
function plan(name, opts) {
  const now = (opts && opts.now) || Date.now();
  /* ⚠️ INJECTED, NOT READ (#570). This module decides whether a NAME IS FREE,
     and on win32 it asked a `.plist` -- a file that platform never writes -- so
     it could not see a leftover Scheduled Task and would free a name while the
     task stayed registered, ready to start an agent under it at the next logon.
     The default is the real platform, so production is unchanged; the parameter
     is what lets the fleet's Macs drive the win32 arm. */
  const platform = (opts && opts.platform) || process.platform;
  /* #5003: on a case-blind disk the leftover may be asked for in a case other than its own ('miles' for Miles). The
     files are found either way, but launchd's label, the removed-list record and the board's other records are
     keyed by the agent's OWN spelling, so every later step uses the name as it is on disk. */
  const clean = realCaseName(create.cleanName(name), platform);
  const unsafe = remove.unsafeToActOn(clean);
  if (unsafe) return { ok: false, because: unsafe };
  /* #6173 (Liu Kang m5550): an agent an account move holds is not a leftover. Its restart closes the window before it
     loads the new job, and in that gap there is no live session while the folder and job file are all there, which is
     exactly what a leftover looks like. Refused in the move's own sentence before anything below is read. */
  const held = remove.moveRefusal(clean);
  if (held) return { ok: false, because: held.because };
  const shown = status.readIdentity(clean).displayName || clean;

  let live = null;
  /* #5003: a Mac's or a Windows disk does not tell case apart, so workerDir('miles') and plistPath('miles') find the
     files of an agent named Miles. The running check must be just as blind to case, or a delete asked as 'miles'
     while Miles runs finds no live session and moves the RUNNING agent's folder and job. Case-blind here is the safe
     side: on a rare case-sensitive disk it refuses a delete that would have been fine, and the sentence says Kosmos took
     the two names as one. */
  const caseBlind = platform === 'darwin' || platform === 'win32';
  const sameName = (a) => (caseBlind ? String(a).toLowerCase() === clean.toLowerCase() : a === clean);
  try { live = status.paneRoster().find((c) => sameName(c.sessionName)) || null; }
  catch {
    return { ok: false, because: `we could not check whether ${shown} is running right now, so we have not offered to delete anything. Try again in a moment.` };
  }
  if (live) {
    const who = live.sessionName === clean ? shown : (status.readIdentity(live.sessionName).displayName || live.sessionName);
    const same = live.sessionName === clean ? '' : ` (Kosmos treats ${clean} and ${live.sessionName} as the same name here)`;
    return { ok: false, because: `${who} is running${same}, so there is nothing left over to delete. Remove it first if you want it gone.` };
  }

  const folderPath = create.workerDir(clean);
  /* On the Mac the job is a FILE, and freeing the name means moving it to the
     Trash beside the folder. On Windows it is a REGISTRATION, so there is
     nothing to move and `path` stays null -- `del` below removes it through
     `win32job` instead. `label` is what a person would recognise in Task
     Scheduler, the same role the launchd label plays. */
  const jobPath = platform === 'win32'
    ? null
    : (platform === 'linux' ? require('./linuxjob').unitPath(clean) : create.plistPath(clean));
  let folder = null;
  let lst = null;
  try { lst = fs.lstatSync(folderPath); } catch { lst = null; }
  if (lst) {
    if (lst.isSymbolicLink()) {
      return { ok: false, because: `${shown}'s folder is a link to somewhere else, so Kosmos will not delete it. Remove the link yourself if you are sure.` };
    }
    if (!lst.isDirectory() || !insideDir(fs.realpathSync(folderPath), fs.realpathSync(create.WORKERS_DIR))) {
      return { ok: false, because: `${shown}'s folder is not where Kosmos keeps agents, so Kosmos will not delete it.` };
    }
    const m = measure(folderPath);
    folder = { path: folderPath, ...m, trash: trashCanTake(folderPath, platform, m, probeHow(opts)) };
  }
  let job = null;
  if (platform === 'win32') {
    const win32job = require('./win32job');
    const seen = win32job.presence(clean);
    /* 🛑 A LOOK THAT FAILED IS NOT "NOTHING IS LEFT". Every other refusal in
       this function is a sentence about something we could see; this one has to
       be a sentence about not being able to see. Freeing a name while a task
       still points at it is how an agent comes back at logon under a name
       somebody has since given to a different agent -- the worst outcome this
       module has, and it costs one refusal to avoid. Same posture as the
       running-agent check above, which refuses for the same reason. */
    if (!seen.known) {
      return { ok: false, because: `we could not check whether anything still starts ${shown} at login, so we have not offered to delete anything. Try again in a moment.` };
    }
    /* kosmos#8177: Task Scheduler ignores letter case, so a task found under ANOTHER spelling, for a name with no exact
       folder of its own (remove.taskIsAnotherSpellings), is that spelling's (`cai`'s, for `Cai`), and deleting
       `Kosmos\agent-Cai` would delete it. Refuse rather than touch it. */
    if (remove.taskIsAnotherSpellings(clean, seen)) {
      return { ok: false, because: `nothing starts ${shown} at login, but Windows has a startup task for ${String(seen.spelledOtherwise).replace(/^.*\\agent-/, '')} (the same name in other letter case), and deleting ${shown}'s would delete that one. So we have not offered to delete anything.` };
    }
    if (seen.registered) job = { path: null, label: win32job.taskName(clean), task: true, trash: false };
  } else if (fs.existsSync(jobPath)) {
    const isLinux = platform === 'linux';
    job = {
      path: jobPath,
      label: isLinux ? require('./linuxjob').unitName(clean) : create.serviceLabel(clean),
      /* #4918 review 1: a systemd unit is deleted by linuxjob.remove, never moved to the Trash, so the Trash promise
         is never made for it. */
      trash: isLinux ? false : trashCanTake(jobPath, platform),
      ...(isLinux ? { unit: true } : {}),
    };
  }
  /* kosmos#7825: with no folder and no job, the name's stored settings or picture can still be left over (a delete from
     before #7819, or a #7819 PARTIAL), and a new agent under the name would start with them. Offered only when they are
     not somebody's on purpose: see strandedRefusal. */
  let recs = null;
  let damagedSettings = false;
  if (!folder && !job) {
    try { recs = namedRecords(clean, null); } catch {
      return { ok: false, because: `we could not check what Kosmos has stored for ${shown}, so we have not offered to delete anything. Try again in a moment.` };
    }
    if (recs.kept) {
      const kw = recs.keptWords;
      return { ok: false, because: `nothing of ${shown} is left on this computer except ${kw.words}, which stay${kw.plural ? '' : 's'} because ${recs.kept}, so there is nothing to delete.` };
    }
    if (!recs.records.length) {
      return { ok: false, because: `nothing of ${shown} is left on this computer, so there is nothing to delete. If the name is still refused, something else holds it.` };
    }
    const st = strandedRefusal(clean, shown);
    if (st.because) return { ok: false, because: st.because };
    damagedSettings = st.damaged;
  }
  const recordsOnly = Boolean(recs);

  /* One mode for the whole act, so the sentence is one sentence: to the
     Trash only if EVERYTHING can go there. */
  /* #4918 review 31: a systemd unit is removed by systemd whatever happens to the folder, so it does not decide whether
     the folder can go to the Trash (a folder-only Linux leftover already does). */
  // review 32: only with a folder; a unit-only leftover moves nothing, so it never promises the Trash.
  /* kosmos#7820: a Scheduled Task too. It is unregistered, never moved, so it does not decide whether the folder can go
     to the Recycle Bin; without this a removed Windows agent (folder plus disabled task, the usual leftover) never could. */
  const toTrash = (!folder || folder.trash) && (!job || job.trash || (Boolean(job.unit || job.task) && Boolean(folder)));
  const loses = [];
  if (folder) {
    const what = filesWords(folder) + (folder.files ? ', ' + sizeWords(folder.bytes) : '');
    const when = folder.newest ? ', last changed ' + agoWords(folder.newest, now) : '';
    loses.push(`Its folder: ${what}${when}` + (folder.git ? ', including a git repository' : ''));
  }
  /* ⚠️ THE NOUN FOLLOWS THE SUBSTRATE, because the person has to be able to go
     and look at the thing we name. On the Mac it is a file in a folder they can
     open; on Windows it is an entry in Task Scheduler and there is no file to
     speak of. Calling a Scheduled Task an "auto-start file" sends somebody
     hunting for something that does not exist. */
  const jobIsTask = Boolean(job && job.task);
  // #4918 review 30: a systemd unit is a registration too, not a file the person keeps: same nouns as a Scheduled Task.
  const jobIsService = jobIsTask || Boolean(job && job.unit);
  if (job) {
    loses.push(jobIsService
      ? 'Its startup job, so nothing tries to start it again'
      : 'Its auto-start file, so nothing tries to start it again');
  }
  /* #7819: its settings and picture go with the files. To the Trash only when the folder goes there AND the Trash can
     take them (the data root can be on another volume); otherwise deleted for good, and the plan says which. */
  /* A look that failed refuses, as the running check above does: read as "nothing stored", the plan would promise a
     free name and leave the profile behind. */
  if (!recs) try { recs = namedRecords(clean, folder ? folder.path : null); } catch {
    return { ok: false, because: `we could not check what Kosmos has stored for ${shown}, so we have not offered to delete anything. Try again in a moment.` };
  }
  const bin = binWords(platform);   // kosmos#7820
  const recordsTrash = toTrash && recs.records.every((r) => trashCanTake(r.file, platform, undefined, probeHow(opts)));
  const recordsLost = recs.records.length > 0 && !recordsTrash;
  if (recs.records.length) {
    const w = recordsWords(recs.records);
    loses.push(`${w.cap}: ${recordsTrash ? (recordsOnly ? `to ${bin}` : `to ${bin} with the files`) : 'deleted for good'}, and a new agent with this name starts without ${w.plural ? 'them' : 'it'}`);
  }
  if (damagedSettings) loses.push('Its settings file is not in a form Kosmos can read, so Kosmos could not check what it recorded before offering it');
  // Kept, and said before the click: a new agent under the name will share them.
  if (recs.kept) loses.push(`${recs.keptWords.cap} stay${recs.keptWords.plural ? '' : 's'}: ${recs.kept}, and a new agent with this name shares ${recs.keptWords.plural ? 'them' : 'it'}`);
  /* #4994: the delete retires the name's community account, which no Trash brings back, so the confirmation says so
     rather than promising everything can be got back. */
  let community = false;
  try { community = require('./communitysend').hasAccount(clean); } catch { community = true; }   // cannot tell: say it
  if (community) loses.push('Its community account: anything it posted there stays up, and a new agent with this name joins as a new account, under a changed public name if the old one is still taken');
  /* What it wrote for the community and has not sent is marked never to send by the delete, and a folder brought back
     from the Trash does not undo that, so it is named even when there is no account. */
  let waiting = 0;
  try { waiting = require('./communitysend').unsentCount(clean); } catch { waiting = 1; }
  if (waiting) loses.push('Anything it wrote for the community that has not gone out yet: it never goes, even if you bring its folder back');
  const question = `Delete what is left of ${shown}?`;
  /* A Scheduled Task holds nothing a person can lose, so a job-only leftover is
     not the "gone for good" case the Trash sentence is written for. */
  const jobOnlyTask = jobIsService && !folder;
  let reassurance = toTrash && job && (job.unit || job.task) && folder
    // #4918 review 31: the folder goes to the Trash; the unit is removed, not moved, so "everything" would be false.
    ? `Its files go to ${bin}, where you can get them back until you empty it, and its startup job is removed${community ? '. Its community account does not come back' : waiting ? '. Anything it wrote for the community that has not gone out stays unsent' : ''}. After this, the name ${shown} is free for a new agent.`
    : toTrash
    ? (community || waiting
      ? `Its files go to ${bin}, where you can get them back until you empty it. ${community ? 'Its community account does not come back' : 'Anything it wrote for the community that has not gone out stays unsent'}. After this, the name ${shown} is free for a new agent.`
      : `${recs.kept ? `Its files go to ${bin}, where you can get them back until you empty it` : `Everything goes to ${bin}, where you can get it back until you empty it`}. After this, the name ${shown} is free for a new agent.`)
    : jobOnlyTask
      ? `Nothing you can lose is stored in it${community ? ', but its community account does not come back' : waiting ? ', but anything it wrote for the community that has not gone out stays unsent' : ''}. After this, the name ${shown} is free for a new agent.`
      : `This cannot be undone: ${bin} cannot take these files, so they will be deleted for good${community ? ', and its community account does not come back' : waiting ? ', and anything it wrote for the community that has not gone out stays unsent' : ''}. After this, the name ${shown} is free for a new agent.`;
  /* #7819: a sentence promising the Trash, or "nothing you can lose", is false once settings or a picture go for good. */
  if (recordsLost && (toTrash || jobOnlyTask)) {
    const w = recordsWords(recs.records);
    reassurance = `${toTrash ? `Its files go to ${bin}, where you can get them back until you empty it${job && (job.unit || job.task) ? ', and its startup job is removed' : ''}, but ` : ''}${toTrash ? w.words : w.cap} cannot go to ${bin}, so ${w.plural ? 'they are' : 'it is'} deleted for good${community ? ', and its community account does not come back' : waiting ? ', and anything it wrote for the community that has not gone out stays unsent' : ''}. After this, the name ${shown} is free for a new agent.`;
  }
  // kosmos#7825: only stored records are left, so every sentence is about them; there are no files or job to name.
  const rw = recordsOnly ? recordsWords(recs.records) : null;
  if (recordsOnly) {
    const tail = `${community ? ', and its community account does not come back' : waiting ? ', and anything it wrote for the community that has not gone out stays unsent' : ''}. After this, the name ${shown} is free for a new agent.`;
    reassurance = recordsTrash
      ? `${rw.cap} go${rw.plural ? '' : 'es'} to ${bin}, where you can get ${rw.plural ? 'them' : 'it'} back until you empty it${tail}`
      : `This cannot be undone: ${bin} cannot take ${rw.words}, so ${rw.plural ? 'they are' : 'it is'} deleted for good${tail}`;
  }
  const verb = recordsOnly
    ? (recordsTrash ? `Move ${rw.words} to ${bin}` : `Delete ${rw.words} for good`)
    : folder
    ? (toTrash ? `Move ${filesWords(folder)} to ${bin}` : `Delete ${filesWords(folder)} for good`)
    : jobIsService ? 'Remove its startup job'
      : (toTrash ? `Move the auto-start file to ${bin}` : 'Delete the auto-start file for good');
  const hint = recordsOnly
    ? `Kosmos still has ${rw.words} for ${shown}, though nothing else of it is left, and a new agent with this name would start with ${rw.plural ? 'them' : 'it'}.`
    : folder
    ? `${shown}'s folder is still on this computer (${filesWords(folder)}${folder.newest ? ', last changed ' + agoWords(folder.newest, now) : ''}), and the name stays taken until it is gone.`
    : jobIsService
      ? `Something on this computer still starts ${shown} when you log in, and the name stays taken until it is gone.`
      : `An auto-start file for ${shown} is still on this computer, and the name stays taken until it is gone.`;
  return {
    ok: true,
    name: clean,
    shown,
    toTrash,
    /* Typing the name is asked only when nothing can bring the FILES back --
       and a job-only Windows leftover has none, so asking there would be
       ceremony rather than protection. The Mac's cases are untouched. */
    typeToConfirm: ((toTrash || jobOnlyTask) && !recordsLost) ? null : shown,   // #7819: settings lost for good ask too
    folder: folder && { path: folder.path, files: folder.files, bytes: folder.bytes, newest: folder.newest, capped: folder.capped, git: folder.git },
    records: { files: recs.records, trash: recordsTrash, kept: recs.kept, keptWords: recs.keptWords || null },   // #7819
    /* `task` travels so `del` knows whether to move a file or unregister a job;
       `path` is null on win32 and every reader of it must check. */
    job: job && { path: job.path, label: job.label, ...(jobIsTask ? { task: true } : {}), ...(job.unit ? { unit: true } : {}) },
    question,
    reassurance,
    loses,
    verb,
    hint,
  };
}

/* kosmos#7825 (review 7): where a recorded folder really is, as the disk spells it: { path } or { because }. Resolved one
   part at a time from the root, so every link on the way is followed, wherever it sits (a check that trusted the
   spelling, or stopped at the first link, let a folder behind a dangling link through, twice). The first part that is
   not there (ENOENT, or ENOTDIR under a file) and everything after it are the gone rest, joined on as written. A link
   that leads nowhere or loops is 'dangling'; any other failed look is 'unlookable'. The existing part is resolved once
   more at the end so its case is the disk's own (.../Workers is .../workers on a case-blind disk). */
function resolveRecordedFolder(dir) {
  const abs = path.resolve(dir);
  const root = path.parse(abs).root;
  const parts = abs.slice(root.length).split(path.sep).filter(Boolean);
  let at = root;
  let i = 0;
  for (; i < parts.length; i += 1) {
    const next = path.join(at, parts[i]);
    let st;
    try { st = fs.lstatSync(next); } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) break;
      return { because: 'unlookable' };
    }
    if (st.isSymbolicLink()) {
      try { at = fs.realpathSync.native(next); } catch (e) {
        return { because: e && (e.code === 'ENOENT' || e.code === 'ELOOP' || e.code === 'ENOTDIR') ? 'dangling' : 'unlookable' };
      }
    } else {
      at = next;
    }
  }
  let base;
  try { base = fs.realpathSync.native(at); } catch {
    // A root that is not there (a Windows drive or share that is not connected, review 8) is a gone rest, not a passing fault.
    if (at !== root) return { because: 'unlookable' };
    base = root;
  }
  return { path: path.join(base, ...parts.slice(i)) };
}

/* kosmos#7825: why a name with only stored settings or a picture left must NOT be offered for deleting, or null when they
   are a leftover. Settings are written on purpose before an agent has a folder in two places this answers:
   - a world start waiting to retry (engine/worldstarts.js writes provider and policyHeld before a held create retries),
     read from its record. Not from policyHeld alone: removing an agent drops its entry and leaves the mark
     (remove.recordRemoval), and Repair cannot start a name with no folder (create.installJob), so a marked profile with
     no entry is stranded like any other;
   - a connected agent whose recorded folder is outside the workers folder and not reachable right now (a disk or share
     that is not connected): its folder is not gone, only out of sight.
   The profile is read here, not through store.readProfile, which answers {} for a file it cannot read: a failed look
   refuses, as every other one in plan() does. A file that reads but is not settings is offered (review 4): it cannot be
   a world start's (that is checked by the record), every reader already treats it as empty, so whatever it recorded is
   lost to its agent anyway, and refusing left it under the name for good. The plan says it could not be checked.
   { because } to refuse, else { damaged }. */
function strandedRefusal(name, shown) {
  const store = require('./store');
  const couldNot = `we could not read what Kosmos has stored for ${shown}, so we have not offered to delete anything. Try again in a moment.`;
  let prof = {};
  let raw = null;
  try { raw = fs.readFileSync(store.profilePath(name), 'utf8'); } catch (e) {
    if (!(e && e.code === 'ENOENT')) return { because: couldNot };   // a picture alone has no profile; anything else is a failed look
  }
  let damaged = false;
  if (raw !== null) { try { prof = JSON.parse(raw); } catch { damaged = true; } }
  if (!prof || typeof prof !== 'object' || Array.isArray(prof)) damaged = true;
  if (damaged) prof = {};
  const pending = require('./worldstarts').pendingNames();
  if (pending === null) return { because: `we could not check whether ${shown} is waiting to start, so we have not offered to delete anything. Try again in a moment.` };
  let key;
  try { key = store.safeKey(name); } catch { key = null; }
  const sameKey = (n) => { try { return store.safeKey(n) === key; } catch { return false; } };
  if (pending.some((n) => n === name || (key && sameKey(n)))) return { because: `${shown} is waiting to start on this computer, so its settings are not left over.` };
  const dir = typeof prof.dir === 'string' && prof.dir && path.isAbsolute(prof.dir) ? prof.dir : null;
  if (dir) {
    const where = resolveRecordedFolder(dir);
    if (where.because === 'unlookable') return { because: `we could not check where ${shown}'s folder was, so we have not offered to delete anything. Try again in a moment.` };
    if (where.because === 'dangling') return { because: `${shown}'s folder is behind a link that leads nowhere right now, perhaps to a disk or a shared folder that is not connected, so Kosmos will not delete its settings.` };
    // Both sides by the same walk (review 8): a workers folder that is gone with its last agent still resolves its parents.
    const wAt = resolveRecordedFolder(create.WORKERS_DIR);
    if (wAt.because) return { because: `we could not check where ${shown}'s folder was, so we have not offered to delete anything. Try again in a moment.` };
    const w = wAt.path;
    if (where.path !== w && !insideDir(where.path, w)) {
      /* Something is there (a link, a file), so the sentence must not send the person to check a cable (review 5). A
         real folder there never reaches this: workerDir follows it and plan()'s folder rule refuses first. */
      let there = false;
      try { fs.lstatSync(dir); there = true; } catch { there = false; }
      return { because: there
        ? `${shown}'s folder is not where Kosmos keeps agents, so Kosmos will not delete its settings.`
        // review 7: true whether its disk is unplugged or the folder is simply gone from a disk that is there.
        : `${shown}'s folder is not there now and is not where Kosmos keeps agents. It may be on a disk or a shared folder that is not connected, so Kosmos will not delete its settings.` };
    }
  }
  return { damaged };
}

/* #7819: the stored records keyed by this name: its profile, its picture files and the picture's kept originals, as
   [{ what, file }]. Keyed the way store keys them (safeKey: lower-cased, punctuation dropped), by the name asked for
   ONLY: a folder's basename can be another agent's name (a connected agent records another's freed folder,
   discover.connect), and a case variant already shares the key. Kept when a live session, or a folder in the workers
   folder that is not this leftover's own folder, has a name that maps to the same key (Miles and miles share one
   profile). Not seen: a stopped agent connected to a folder outside the workers folder under a colliding spelling.
   { records, kept } with kept a sentence about who holds them, or null. `folderPath` is the plan's folder, or null. */
function namedRecords(name, folderPath) {
  const store = require('./store');
  let key;
  try { key = store.safeKey(name); } catch { return { records: [], kept: null }; }
  const real = (f) => { try { return fs.realpathSync.native(f); } catch { return null; } };
  const own = folderPath ? real(folderPath) : null;
  let kept = null;
  const note = (n, dir) => {
    if (kept || n === name) return;
    if (dir && own && real(dir) === own) return;   // this leftover's own folder, under its own spelling
    try { if (store.safeKey(n) === key) kept = `${n} uses the same stored name`; } catch { /* not a name */ }
  };
  for (const c of status.paneRoster()) note(c.sessionName, null);
  // A workers folder that cannot be read throws (plan() refuses): read as empty it would hide a folder sharing the key.
  let entries = [];
  try { entries = fs.readdirSync(create.WORKERS_DIR, { withFileTypes: true }); } catch (e) { if (!(e && e.code === 'ENOENT')) throw e; }
  for (const e of entries) if (e.isDirectory()) note(e.name, path.join(create.WORKERS_DIR, e.name));
  const records = [];
  // Not fs.existsSync: it answers false for a file it cannot see, which would read "could not look" as "none".
  let hasProfile = true;
  try { fs.statSync(store.profilePath(name)); } catch (e) { if (e && e.code === 'ENOENT') hasProfile = false; else throw e; }
  if (hasProfile) records.push({ what: 'its settings', file: store.profilePath(name) });
  const pics = store.pictureFiles(name);
  for (const f of pics.pictures) records.push({ what: 'its picture', file: f });
  for (const f of pics.originals) records.push({ what: 'its picture', file: f });
  // Kept only when there is something to keep: with nothing stored, there is nothing to say stays.
  if (kept) return { records: [], kept: records.length ? kept : null, keptWords: records.length ? recordsWords(records) : null };
  return { records, kept: null };
}
/* The words for what is stored, and whether they take a plural verb: "its settings" (plural), "its picture",
   "its settings and picture". */
function recordsWords(records) {
  const has = (w) => records.some((r) => r.what === w);
  const words = has('its settings') && has('its picture') ? 'its settings and picture' : has('its settings') ? 'its settings' : 'its picture';
  return { words, plural: words !== 'its picture', cap: words.charAt(0).toUpperCase() + words.slice(1) };
}

/* Moves the plan's records where the plan said: the Trash when p.records.trash, else deleted for good. One step per
   kind (settings, picture), failed if any file of it would not go. A dead writer's temps beside the picture
   (store.removeAvatar) are deleted after: they are copies a save never finished. */
function* moveRecords(p, platform) {
  const steps = [];
  if (p.records.kept) steps.push({ step: 'its settings and picture', ok: true, because: `kept: ${p.records.kept}` });
  const failed = new Map();
  const moved = new Set();
  for (const r of p.records.files) {
    try {
      if (p.records.trash && platform === 'win32') {
        // kosmos#7820: the Recycle Bin, as the folder; a record it did not keep is reported like the folder.
        // kosmos#7835: handed to whoever drives the delete, as the folder's move is.
        const got = yield { recycle: r.file };
        const where = got && got.where;
        if (where === 'gone') steps.binMissed = [...(steps.binMissed || []), r.what];
        else if (where === 'unverified') steps.binUnsure = [...(steps.binUnsure || []), r.what];
        if (got && got.note) steps.notes = { ...(steps.notes || {}), [r.what]: got.note };
      } else if (p.records.trash) {
        fs.mkdirSync(TRASH(platform), { recursive: true });
        const to = trashName(r.file, platform);
        fs.renameSync(r.file, to);
        if (platform === 'linux') { try { writeTrashInfo(r.file, to); } catch { /* moved; only the put-back record is missing */ } }
      } else {
        fs.rmSync(r.file, { force: true });
      }
      if (fs.existsSync(r.file)) throw new Error('still there');
      moved.add(r.what);
    } catch (err) {
      if (!failed.has(r.what)) failed.set(r.what, String((err && err.message) || err));
    }
  }
  for (const what of ['its settings', 'its picture']) {
    if (failed.has(what)) steps.push({ step: what, ok: false, because: failed.get(what) });
    else if (moved.has(what)) steps.push({ step: what, ok: true, ...(steps.notes && steps.notes[what] ? { note: steps.notes[what] } : {}) });
  }
  if (moved.has('its picture') && !failed.has('its picture')) { try { require('./store').removeAvatar(p.name); } catch { /* the picture itself is gone */ } }
  return steps;
}

function trashName(p, platform) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(TRASH(platform), `${path.basename(p)} (Kosmos ${stamp})`);
}

/* #5445: a Linux file manager lists a trashed item, and can put it back, only with its .trashinfo beside it in
   Trash/info (the freedesktop Trash spec): where it came from and when. Not written for a test's own Trash folder. */
function writeTrashInfo(from, to) {
  if (process.env.AGENT_WORKFORCE_TRASH) return;
  const info = path.join(linuxTrashRoot(), 'info');
  fs.mkdirSync(info, { recursive: true });
  const when = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
  const enc = path.resolve(from).split('/').map(encodeURIComponent).join('/');
  fs.writeFileSync(path.join(info, path.basename(to) + '.trashinfo'), `[Trash Info]\nPath=${enc}\nDeletionDate=${date}\n`);
}

/** The act. Re-plans first, so nothing is deleted that the plan would not
    have offered a moment ago. `typed` must match when the plan asks for it. */
function* delSteps(name, opts) {
  /* #6173: asked again here, not only through the re-plan below: the person sees the plan and confirms it in a separate
     request, and a move can start in between. */
  const held = remove.moveRefusal(realCaseName(create.cleanName(name), (opts && opts.platform) || process.platform));
  if (held) return { outcome: OUTCOME.REFUSED, because: held.because };
  /* The re-plan must ask the SAME platform the caller planned against, or a
     test (and a Mac driving the win32 arm) plans one act and performs another. */
  // kosmos#7835: and the drives delAsync warmed, whose answers this re-plan reads whatever their age.
  const p = plan(name, opts && (opts.platform || opts.pinned)
    ? { ...(opts.platform ? { platform: opts.platform } : {}), ...(opts.pinned ? { pinned: opts.pinned } : {}) } : undefined);
  if (!p.ok) return { outcome: OUTCOME.REFUSED, because: p.because };
  const platform = (opts && opts.platform) || process.platform;
  if (p.typeToConfirm && String((opts && opts.typed) || '').trim() !== p.typeToConfirm) {
    /* kosmos#7820: the plan travels with this refusal. On Windows the Recycle Bin answer can change between the plan
       the person read and this one (a minute-old drive answer, a probe that now times out), and a dialog that showed
       no name to type has nowhere to type it; the page repaints from this plan instead of leaving them stuck. */
    return { outcome: OUTCOME.REFUSED, because: `type ${p.typeToConfirm} to confirm; nothing was deleted`, plan: p };
  }
  const steps = [];
  /* #5000: the name's community moderation standing, FIRST. The board keys trust by the agent's name, so without
     this a new agent under the freed name would start with the deleted agent's standing. It goes before anything
     is moved because it is the one step a retry could never reach afterwards: once the folder and the job
     are gone and nothing is stored under the name, plan() finds nothing left and refuses. Resetting a leftover's standing early costs nothing (it is not
     running, and a standing only drops). If it fails, nothing has been touched yet, so the delete is refused
     whole and can simply be tried again. The folder's own name is reset too when the case differs from the one
     asked for (a Mac's disk does not tell Miles from miles; the board's trust key does). */
  try {
    const cs = require('./communitystore');
    const names = new Set([p.name]);
    if (p.folder && p.folder.path) { try { names.add(path.basename(fs.realpathSync.native(p.folder.path))); } catch { /* the asked-for name is reset above */ } }
    for (const n of names) cs.forgetTrust(n);
    steps.push({ step: 'its community standing', ok: true });
  } catch (err) {
    return {
      outcome: OUTCOME.REFUSED,
      because: 'we could not reset its standing in the community, so nothing was deleted.',
      steps: [{ step: 'its community standing', ok: false, because: String((err && err.message) || err) }],
    };
  }
  const gone = [];
  const stuck = [];
  /* kosmos#7820: what did not land in the Recycle Bin (gone and not found there) or could not be checked, by name, so the
     sentence names the folder's files or the settings and picture, whichever it was. */
  const missed = [];
  const unsure = [];
  /* kosmos#7835: a generator, so the Windows move is handed to whoever drives the delete (del in place, delAsync
     without holding the board); every other step runs here, in order, either way. */
  const move = function* (from, what) {
    let note = '';
    try {
      if (p.toTrash && platform === 'win32') {
        const got = yield { recycle: from };
        const where = got && got.where;
        if (got && got.note) note = got.note;
        if (where === 'gone') missed.push('its files');
        else if (where === 'unverified') unsure.push('its files');
      } else if (p.toTrash) {
        fs.mkdirSync(TRASH(platform), { recursive: true });
        const to = trashName(from, platform);
        fs.renameSync(from, to);
        if (platform === 'linux') { try { writeTrashInfo(from, to); } catch { /* moved; only the put-back record is missing */ } }
      } else {
        fs.rmSync(from, { recursive: true, force: true });
      }
      if (fs.existsSync(from)) throw new Error('still there');
      gone.push(what);
      steps.push({ step: what, ok: true, ...(note ? { note } : {}) });
    } catch (err) {
      stuck.push(what);
      steps.push({ step: what, ok: false, because: String(err && err.message || err) });
    }
  };
  if (p.job && p.job.task) {
    /* 🛑 THE WINDOWS JOB IS A REGISTRATION, NOT A FILE, so there is nothing to
       move: it is deleted from Task Scheduler or it is still there. `remove`
       ends the task and is idempotent about one that was never registered, and
       it reports rather than throws -- so a failure lands in `stuck` and the
       outcome is PARTIAL, exactly as an unmovable file would. It must NOT be
       silently skipped: this whole function ends by saying "The name is free",
       and a name is not free while something still starts an agent under it. */
    const what = 'its startup job';
    let out;
    try { out = require('./win32job').remove(p.name); }
    catch (err) { out = { ok: false, because: String((err && err.message) || err) }; }
    if (out && out.ok) { gone.push(what); steps.push({ step: what, ok: true }); }
    else { stuck.push(what); steps.push({ step: what, ok: false, because: (out && out.because) || 'no reason given' }); }
  } else if (p.job && p.job.unit) {
    const what = 'its startup job';
    let out;
    try {
      // { ok } only when the unit file is gone (#4918 review 1); through this module's run() seam (review 7).
      const lj = require('./linuxjob');
      lj.ensureRuntimeDir();
      out = lj.runWith((file, args) => run(file, args), () => lj.remove(p.name));
    } catch (err) {
      out = { ok: false, because: String((err && err.message) || err) };
    }
    if (out && out.ok) { gone.push(what); steps.push({ step: what, ok: true }); }
    else { stuck.push(what); steps.push({ step: what, ok: false, because: (out && out.because) || 'no reason given' }); }
  } else if (p.job) {
    /* Stop the job first, so launchd does not hold a job whose file has
       gone. Best effort: a job that was never loaded answers "not found",
       which is the state we want. */
    run('launchctl', ['bootout', `gui/${process.getuid ? process.getuid() : 501}/${p.job.label}`]);
    yield* move(p.job.path, 'its auto-start file');
  }
  /* #4918 review 31: a startup job systemd would not remove (the user bus unreachable) keeps the folder when the folder
     would be deleted for good: losing the files while the unit stays is the worst of both. Into the Trash it can go. */
  /* review 32: kept whether or not there is a Trash: the folder is what shows the leftover on the board, and moving it
     while the unit still holds the name would leave nothing to look at. */
  // review 40: with or without a folder; a unit systemd still holds keeps every record, as review 35 decided.
  if (p.job && p.job.unit && stuck.includes('its startup job')) {   // review 33: Linux units only; Windows unchanged
    if (p.folder) {
      stuck.push('its folder');
      steps.push({ step: 'its folder', ok: false, because: 'kept, because its startup job could not be removed' });
    }
    /* review 35: stop here. Nothing was deleted, so the removal record, the tokens and the crash history stay: dropping
       them would bring the agent back as an ordinary one with dead tokens and nothing on screen to retry from. */
    return {
      outcome: OUTCOME.REFUSED,
      // review 37: the community standing reset (#5000) has already run and cannot be undone, so the sentence says so.
      because: `systemd would not remove ${p.shown}'s startup job${p.folder ? ', so its folder was kept too' : ''}. The name stays taken; try again once this computer's user services are reachable. Its standing in the community was reset, so if it comes back it starts at the beginning.`,
      steps,
    };
  } else if (p.folder) yield* move(p.folder.path, 'its folder');
  /* The removed-list record, if any, is what keeps a name hidden on the
     board; with the files gone it has nothing to point at. Forgotten after the records below, and only once they went
     (kosmos#7825): the removed list's row is how a person reaches "Delete its files" again, so settings that would not
     move keep it. */
  const forgetRemoval = () => { try { remove.forget(p.name); } catch { /* the record is inert without files */ } };
  /* #1131. NOT best-effort, unlike `forgetRemoval` above: a removal record with no
     files is inert, but a TOKEN with no files is a live credential for a name
     we are about to advertise as free. A failure here belongs in `stuck`, so
     the outcome is PARTIAL and says so, rather than DELETED with a sentence
     promising the name is free.
     ⚠️ An agent that never had a token is the COMMON case and is not a
     failure: `revoke` answers ENOENT with `ok: true`, so this stays quiet for
     every agent that never spoke. */
  let tokens;
  try { require('./disruption').clear(p.name); } catch { /* #4006: best-effort, with the tokens below */ }
  try { require('./crashloop').forget(p.name); } catch { /* #5154: its runs go with it */ }
  try { require('./observed').forgetAgent(p.name); } catch { /* #5959 slice 2: nor the old name's last-seen time */ }
  try { require('./stuckterminal').forget(p.name); } catch { /* #5154 slice C: its stuck-terminal anchor goes too */ }
  try { require('./toolloop').forget(p.name); } catch { /* #6071: nor a run of repeated tool failures */ }
  try { require('./ownbounds').forget(p.name); } catch { /* #5154 slice B: its own-bound give-up episodes go too */ }
  try { require('./instructionreread').forget(p.name); } catch { /* kosmos#7149: its copy of what it last read, and its changes file */ }
  try { require('./liveness').forget(p.name); } catch { /* #5957 slice 3: and its last report */ }
  try { tokens = sendertoken.revoke(p.name); } catch (err) {
    tokens = { ok: false, because: String((err && err.message) || err) };
  }
  if (tokens && tokens.ok === true) {
    steps.push({ step: 'its sender tokens', ok: true });
  } else {
    stuck.push('its sender tokens');
    steps.push({ step: 'its sender tokens', ok: false, because: (tokens && tokens.because) || 'no reason given' });
  }
  /* #7819: its settings and picture, LAST of the files: the folder is found through the profile (create.workerDir
     reads its `dir`), and an agent whose job could not be removed must keep them. Only once the folder and the job are
     gone. NOT best-effort: left behind they make a new agent under the name the old one (writeProfile keeps a stored
     `id`, #170, and every field a create does not write; the picture is the old one's). */
  if (!stuck.some((s) => s !== 'its sender tokens')) {
    const recStepsOut = yield* moveRecords(p, platform);
    for (const x of recStepsOut.binMissed || []) if (!missed.includes(x)) missed.push(x);   // kosmos#7820
    for (const x of recStepsOut.binUnsure || []) if (!unsure.includes(x)) unsure.push(x);
    for (const st of recStepsOut) {
      steps.push(st);
      if (st.ok) { if (!st.because) gone.push(st.step); } else stuck.push(st.step);
    }
  }
  if (!stuck.includes('its settings') && !stuck.includes('its picture')) forgetRemoval();
  /* #4994: the name's community account. NOT best-effort, for the same reason as the tokens above: a new agent
     under the freed name would otherwise post as the old one, with its public posts and profile. The account is
     retired, not dropped (communitysend.requestRetire says why); this only records the request, which is applied
     before the community sender next acts. Only once the folder and the job are gone: retiring cannot be undone,
     and while either is left the agent can still start. A stuck token alone does not hold it back, because a retry
     is refused once the folder and job are gone, so this is the only chance to retire it. Stuck settings or a picture
     hold it back only when they were all that was left (kosmos#7825): plan() offers those again, so a retry reaches it,
     and retiring while nothing was deleted would be the one step of a REFUSED delete that cannot be undone. */
  const recordsOnlyPlan = !p.folder && !p.job;
  if (!stuck.some((s) => s !== 'its sender tokens' && (recordsOnlyPlan || (s !== 'its settings' && s !== 'its picture')))) {
    try {
      require('./communitysend').requestRetire(p.name);
      steps.push({ step: 'its community account', ok: true });
    } catch (err) {
      stuck.push('its community account');
      steps.push({ step: 'its community account', ok: false, because: String((err && err.message) || err) });
    }
  }
  /* kosmos#7820: what a Recycle Bin move that did not land there means, said on the partial path as on the full one.
     "Could not find" rather than "deleted for good": the search matches the Recycle Bin's name for the item, which
     Kosmos has not measured against every Windows setting. */
  const binMissed = missed.length > 0;
  const binUnsure = unsure.length > 0;
  const plural = (xs) => xs.length > 1 || xs[0] !== 'its picture';   // its files, its settings: plural nouns
  const binNote = [
    binMissed ? `Kosmos could not find ${missed.join(' and ')} in the Recycle Bin afterwards, so Windows may have deleted ${plural(missed) ? 'them' : 'it'} for good.` : '',
    binUnsure ? `Kosmos could not check that Windows put ${unsure.join(' and ')} in the Recycle Bin, so look there before you empty it.` : '',
  ].filter(Boolean).join(' ');
  if (stuck.length) {
    /* #7819: a record that would not move is still a leftover; since kosmos#7825 plan() offers it alone, so the sentence
       says what it means and that deleting again clears it. */
    const left = stuck.filter((x) => x === 'its settings' || x === 'its picture');
    const lw = recordsWords(left.map((what) => ({ what })));
    /* The retry is promised only where a person can reach it (review 3): the removed list's row, kept above. An agent
       deleted from its own page that was never removed has no row, and with its folder gone no page either. */
    let door = false;
    try { door = left.length > 0 && remove.isRemoved(p.name); } catch { door = false; }
    const tail = left.length ? ` ${lw.cap} ${lw.plural ? 'are' : 'is'} still on this computer, so a new agent with this name would start with ${lw.plural ? 'them' : 'it'}.${door ? ` Deleting what is left again from the removed agents list clears ${lw.plural ? 'them' : 'it'}.` : ''}` : '';
    // The verb for what could not go: a record follows the records' own mode, which can differ from the folder's.
    const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const verbFor = (x) => (x === 'its startup job' ? 'remove' : x === 'its sender tokens' ? 'revoke' : (x === 'its settings' || x === 'its picture') ? (p.records.trash ? 'move' : 'delete') : (p.toTrash ? 'move' : 'delete'));
    return {
      outcome: gone.length ? OUTCOME.PARTIAL : OUTCOME.REFUSED,
      /* #4994: the community account is retired, not moved or deleted, and only once everything else is gone, so a
         failure there is its own sentence: the old account still answers to the name. #5000's standing reset has
         already run by here (it is unconditional and early-returns on failure), so the all-stuck tail says so. */
      because: ((stuck.length === 1 && stuck[0] === 'its community account' && gone.length)
        ? `${gone.join(' and ')} ${gone.length === 1 && gone[0] !== 'its settings' ? 'is' : 'are'} gone, but we could not retire its community account yet. Making a new agent with this name retires it first, or refuses.`
        : (stuck.some((x) => x !== 'its community account')
          // kosmos#7820: each item's own verb; a startup job is removed, never moved, whatever happens to the folder.
          ? `we could not ${stuck.filter((x) => x !== 'its community account').map((x) => verbFor(x) + ' ' + x).join(' or ')}`
            + (stuck.includes('its community account') ? ', or retire its community account yet' : '')
          : 'we could not retire its community account yet. Making a new agent with this name retires it first, or refuses')
          + '. ' + (gone.length ? `${cap(gone.join(' and '))} ${gone.length === 1 && gone[0] !== 'its settings' ? 'is' : 'are'} gone.` : `${recordsOnlyPlan ? `Nothing was ${p.records.trash ? 'moved' : 'deleted'}` : `None of its files were ${p.toTrash ? 'moved' : 'deleted'}`}. Its standing in the community was reset, so a new agent with this name starts at the beginning.`)
          // kosmos#7820: a Recycle Bin move that stopped partway leaves some files there.
          + (platform === 'win32' && p.toTrash && stuck.includes('its folder') ? ' Some of its files may already be in the Recycle Bin.' : '')) + tail
        + (binNote ? ' ' + binNote : ''),
      steps,
    };
  }
  return {
    outcome: OUTCOME.DELETED,
    toTrash: p.toTrash && !binMissed && !binUnsure,
    shown: p.shown,
    /* The sentence has to match what was actually removed: a Windows leftover
       can be a startup job and NOTHING else, and "their files are deleted" about
       an agent that had none is a false sentence in the one line that reports
       the act. */
    said: (!p.folder && !p.job   // kosmos#7825: only stored records were left
      // kosmos#7820: a record the Recycle Bin did not keep, or that could not be checked, is said as such.
      ? (() => { const w = recordsWords(p.records.files); const n = w.words.replace(/^its /, ''); return binNote ? `${p.shown}'s ${n} ${w.plural ? 'are' : 'is'} gone. ${binNote} The name is free.` : `${p.shown}'s ${n} ${w.plural ? 'are' : 'is'} ${p.records.trash ? `in ${binWords(platform)}` : 'deleted'}. The name is free.`; })()
      : !p.folder && p.job && (p.job.task || p.job.unit)   // review 32: a unit-only leftover moved nothing either
      ? `Nothing starts ${p.shown} any more. The name is free.`
      : p.toTrash && (binMissed || binUnsure)
        // The folder's own files are said to be in the Recycle Bin when only a record was not.
        ? `${p.shown}'s files ${missed.includes('its files') || unsure.includes('its files') ? 'are gone from its folder' : `are in ${binWords(platform)}`}. ${binNote} The name is free.`
      : p.toTrash
        ? `${p.shown}'s files are in ${binWords(platform)}. The name is free.`
        : `${p.shown}'s files are deleted. The name is free.`)
      // #7819: settings kept because another agent may own them are said, so "free" is not read as "fresh".
      + (p.records && p.records.kept ? ` ${p.records.keptWords.cap} stay${p.records.keptWords.plural ? '' : 's'} (${p.records.kept}), so a new agent with this name shares ${p.records.keptWords.plural ? 'them' : 'it'}.` : ''),
    steps,
  };
}

/* kosmos#7825 PR 2: the names whose only remains are stored settings, for the removed list, which is the one screen
   that lists agents with no card. A profile with no folder, a job KNOWN to be absent (survey's null, "could not look",
   is left out: hiding a real leftover beats offering a wrong one), not on the removed list (those rows are drawn
   already), and no world start waiting under the stored name. Built on register.survey, the reader Repair and the
   board's offline rows use, so "no folder, no job" means one thing everywhere. Not filtered by the recorded-folder rule:
   that look can block on a share that is gone, and this is polled; the click asks plan(), which refuses with the true
   sentence. Two cheap exclusions instead (review 1): a running agent (its folder can go while it runs), and a profile
   recording a folder outside the workers folder (read from the profile, never looked at, so a share that is gone
   cannot block the poll; such a folder may only be out of sight). `opts.survey` is a survey the caller already took
   (the board's 5 s poll takes one), so the list does not read every job twice.
   { ok, names: [{ name, shownAs }] }; ok false lists none. */
function settingsLeftovers(opts) {
  const s = (opts && opts.survey) || require('./register').survey(opts);
  if (!s || !s.ok) return { ok: false, names: [] };
  const platform = (opts && opts.platform) || process.platform;
  const caseBlind = platform === 'darwin' || platform === 'win32';
  const fold = (n) => (caseBlind ? String(n).toLowerCase() : String(n));
  let running;
  try { running = new Set(status.paneRoster().map((c) => fold(c.sessionName))); } catch { return { ok: false, names: [] }; }
  // Both spellings of the workers folder (review 3: /var is /private/var on a Mac); the workers folder exists, so
  // resolving it cannot block on a share that is gone. The recorded folder itself is never looked at.
  const workers = [path.resolve(create.WORKERS_DIR)];
  try { workers.push(fs.realpathSync.native(create.WORKERS_DIR)); } catch { /* the written spelling only */ }
  const outside = (name) => {
    let dir = null;
    try { dir = require('./store').readProfile(name).dir; } catch { dir = null; }
    if (typeof dir !== 'string' || !dir || !path.isAbsolute(dir)) return false;
    const d = path.resolve(dir);
    return !workers.some((w) => fold(d) === fold(w) || insideDir(fold(d), fold(w)));
  };
  const pending = require('./worldstarts').pendingNames();
  if (pending === null) return { ok: false, names: [] };
  const store = require('./store');
  const keyOf = (n) => { try { return store.safeKey(n); } catch { return null; } };
  const waiting = new Set(pending.map(keyOf).filter(Boolean));
  const names = s.agents
    .filter((a) => a.profile === true && a.folder === false && a.job === false && !a.removed && !waiting.has(keyOf(a.name))
      && !running.has(fold(a.name)) && !outside(a.name))
    .map((a) => ({ name: a.name, shownAs: a.shownAs || a.name }));
  return { ok: true, names };
}

/** Delete what is left of an agent, in place: a Windows move runs here and holds the caller until it ends. */
function del(name, opts) {
  const steps = delSteps(name, opts);
  let r = steps.next();
  while (!r.done) {
    let got;
    let err = null;
    try { got = recycle(r.value.recycle); } catch (e) { err = e; }
    r = err ? steps.throw(err) : steps.next(got);
  }
  return r.value;
}

/* kosmos#7835: the drive probe and the Recycle Bin moves (Windows PowerShell) held the whole board, every page, request
   and health check, while they ran: the probe up to 5 s on an agent page, a move up to 120 s behind a hidden error
   dialog. planAsync and delAsync give the same answers as plan and del with those waits off the board. Still in the
   board's own time: the plan itself (folder measure, roster), and Task Scheduler's removal of a startup job. */
const deleting = new Set();
/* The name a delete holds, folded as create folds a name (slugFor: "Miles Davis" and "miles-davis" are one agent), so
   any spelling of the same agent meets the hold. */
function askedKey(name) {
  try { return String(create.slugFor(name) || create.cleanName(name) || name).toLowerCase(); } catch { return String(name).toLowerCase(); }
}
/** Whether a delete of what is left under this name is running now (create and restore refuse the name meanwhile). */
function deletingName(name) { return deleting.size > 0 && name != null && deleting.has(askedKey(name)); }
/* kosmos#7835: any delete running. A board restart (an update, the restart button, a Kosmos switch) would end it partway,
   after the folder moved and before its records, so the board's restarts wait for it (server.js moveHoldsBoard). */
function deletingNow() { return deleting.size > 0; }
const DELETING_BOARD_BECAUSE = "An agent's leftover files are being deleted now, and this would restart the board in the middle of it. Try again in a minute.";
const DELETING_MOVE_BECAUSE = "An agent's leftover files are being deleted now, so no agent was moved. Try again in a minute.";
const DELETING_BECAUSE = 'a delete of what is left of this agent is running now; try again when it has finished';
/* The drive roots warmed (`roots`, for delAsync to pin), and the plan made to find the paths (`first`) with whether any
   drive still had to be asked (`probed`): when none did, `first` already read every answer the plan needs. */
async function warmFor(name, opts) {
  let first = null;
  try { first = plan(name, { ...(opts || {}), probe: false }); } catch { return { roots: [], first: null, probed: true }; }
  if (!first || first.ok !== true) return { roots: [], first: null, probed: true };
  const paths = [first.folder && first.folder.path, ...((first.records && first.records.files) || []).map((r) => r.file)].filter(Boolean);
  const probed = paths.some((p) => { const d = driveOf(p); return !!(d && d.root && !freshDrive(d.root)); });
  // Together: one after another, a failed probe's short keep could end while the next drive is still being asked.
  const roots = (await Promise.all(paths.map((p) => warmDrive(p)))).filter(Boolean);
  return { roots, first, probed };
}
/** plan, with the Windows drive probe run first without holding the board. While a delete of the name runs, its files
    are on their way out, so the plan says that rather than reading them half-moved. */
async function planAsync(name, opts) {
  const win = ((opts && opts.platform) || process.platform) === 'win32';
  if (win && deletingName(name)) return { ok: false, running: true, because: DELETING_BECAUSE };   // kosmos#7852: the page can say so
  const warm = win ? await warmFor(name, opts) : null;
  // Asked again: a delete of the name can have started while the probe ran.
  if (win && deletingName(name)) return { ok: false, running: true, because: DELETING_BECAUSE };   // kosmos#7852: the page can say so
  if (warm && warm.first && !warm.probed) return warm.first;
  return plan(name, opts);
}
/** del, with the Windows drive probe and Recycle Bin moves run without holding the board. One at a time per name: a
    second delete of the same agent while one runs is refused, since its steps would interleave. */
async function delAsync(name, opts) {
  if (((opts && opts.platform) || process.platform) !== 'win32') return del(name, opts);
  const key = askedKey(name);
  if (deleting.has(key)) return { outcome: OUTCOME.REFUSED, because: DELETING_BECAUSE };
  deleting.add(key);
  try {
    const { roots } = await warmFor(name, opts);
    const steps = delSteps(name, { ...(opts || {}), pinned: roots });
    let r = steps.next();
    while (!r.done) {
      let got;
      let err = null;
      try { got = await recycleAsync(r.value.recycle); } catch (e) { err = e; }
      r = err ? steps.throw(err) : steps.next(got);
    }
    return r.value;
  } finally {
    deleting.delete(key);
  }
}

module.exports = { OUTCOME, plan, del, planAsync, delAsync, deletingName, deletingNow, DELETING_BOARD_BECAUSE, DELETING_MOVE_BECAUSE, execAsync, settingsLeftovers, setRunner, resetForTests, run, measure, TRASH, writeTrashInfo, RECYCLE_SCRIPT, DRIVE_SCRIPT, DRIVE_TIMEOUT_MS, DRIVE_WARM_TIMEOUT_MS, recycleBinCanTake, binVerdict };   // the scripts, the drive time limits, execAsync, recycleBinCanTake and binVerdict are exported for tests (#5445, kosmos#7820, kosmos#7835)
