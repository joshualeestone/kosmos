'use strict';
/* #9024: a real pwsh started by a node test, off Windows, with a startup cache of its own.
 *
 * Off Windows pwsh replays and rewrites a per-user startup profile, $XDG_CACHE_HOME/powershell/
 * StartupProfileData-NonInteractive (~/.cache/powershell/ when XDG_CACHE_HOME is unset). That one file is shared by
 * every validation on the Mac. Three times (10-17, 11-19, 11-24) it was left damaged, and every later pwsh start
 * crashed (FileLoadException ... System.Text.RegularExpressions, SIGABRT), which failed "#7820 the PowerShell scripts
 * parse" in every full run, on main too, as if the change under test were wrong. #6352 gave shell tests their own
 * cache (tools.pwsh-cache-6352.test.js); this does the same for node tests.
 *
 *   pwshEnv(extra)  the env for a pwsh start: process.env, then extra, then XDG_CACHE_HOME set to a folder made once
 *                   for this test process and removed when it exits. On Windows the profile lives under LOCALAPPDATA
 *                   and nothing is changed.
 *   pwshState(exe)  'missing' when exe does not exist; 'ok' when `1+1` prints 2; otherwise the sentence a test fails
 *                   with, so a pwsh that cannot start reads as that and never as a parse failure or a quiet skip.
 *
 * Measured on the fleet Mac (pwsh 7.6.5): with XDG_CACHE_HOME set, pwsh writes its profile there and the shared
 * file's mtime does not change. tools.pwsh-cache-9024.test.js pins which node tests use this. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let cache = null;
function cacheDir() {
  if (cache) return cache;
  cache = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-pwsh-cache-'));
  const made = cache;
  process.on('exit', () => { try { fs.rmSync(made, { recursive: true, force: true }); } catch { /* the run root goes anyway */ } });
  return cache;
}

function pwshEnv(extra) {
  const env = { ...process.env, ...(extra || {}) };
  if (process.platform !== 'win32') env.XDG_CACHE_HOME = cacheDir();
  return env;
}

const BROKEN = 'pwsh broken on this machine (startup cache?)';
function pwshState(exe, timeoutMs) {
  const limit = timeoutMs || 60000;   // timeoutMs only for this helper's own test
  const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', '1+1'], { env: pwshEnv(), encoding: 'utf8', windowsHide: true, timeout: limit });
  if (r.error && r.error.code === 'ENOENT') return 'missing';
  if (r.status === 0 && String(r.stdout).trim() === '2') return 'ok';
  // A start with a fresh cache is slower (17 s once on a loaded CI Mac, #7998); a timeout is a busy machine, not the cache.
  if (r.error && r.error.code === 'ETIMEDOUT') return 'pwsh did not answer 1+1 within ' + Math.round(limit / 1000) + ' s on this machine (busy?): ' + exe;
  const why = r.error ? r.error.message : (r.signal ? 'ended by ' + r.signal : 'rc ' + r.status);
  const first = String(r.stderr || r.stdout || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return BROKEN + ': ' + exe + ' could not run 1+1 (' + why + ')' + (first ? ': ' + first.slice(0, 200).replace(/\.$/, '') : '')
    + '. Off Windows, move ~/.cache/powershell/StartupProfileData-NonInteractive aside (never delete it); pwsh rebuilds it.';
}

module.exports = { pwshEnv, pwshState, BROKEN };
