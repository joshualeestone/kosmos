'use strict';
/**
 * #6692: on Windows, the folders (and files) that keep this copy's record of the release key list (engine/manifest-verify.js
 * trustedKeys, KEY_LIST_STATE) must be reachable only by the person who owns them, SYSTEM and Administrators.
 * File modes mean nothing there (Node's chmod only toggles read-only), so the access list is what is read.
 *
 * aclRefusal(dirs) reads each folder's owner and access list through Windows PowerShell and answers a sentence
 * saying what to fix, or null when every folder is the person's own. It never changes an access list: a folder
 * another account can reach is refused, not repaired. Anything it cannot read is refused too.
 *
 * judge(answer) is the pure rule, so the suites can check it on any computer.
 */
const cp = require('node:child_process');
const path = require('node:path');

const SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';
/* An entry for CREATOR OWNER stands for whoever creates a file inside: this copy, so the person themselves. */
const CREATOR_OWNER_SID = 'S-1-3-0';
const WELL_KNOWN = Object.freeze({
  'S-1-1-0': 'Everyone',
  'S-1-5-11': 'Authenticated Users',
  'S-1-5-32-545': 'Users',
  'S-1-5-32-546': 'Guests',
  'S-1-5-4': 'INTERACTIVE',
});
/* File systems with no access lists (and no hard links). */
const FAT = /^(FAT|FAT12|FAT16|FAT32|exFAT)$/i;
/* A first PowerShell start under an antivirus scan can be slow (win32update.js SIGNATURE_TIMEOUT_MS). */
const DEFAULT_TIMEOUT_MS = 60000;

/* One JSON answer per folder, in order: the owner, the running account, and every entry with its SID and name. */
const ACL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$sidType = [System.Security.Principal.SecurityIdentifier]',
  '$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  '$answers = @()',
  "foreach ($p in ($env:KOSMOS_ACL_DIRS -split \"`n\")) {",
  '  if (-not $p) { continue }',
  /* A FAT32 or exFAT drive keeps no access list at all (.NET reads it as Everyone: full control): say which. */
  '  $fmt = $null',
  '  try { $fmt = (New-Object System.IO.DriveInfo ([System.IO.Path]::GetPathRoot($p))).DriveFormat } catch { $fmt = $null }',
  "  if ($fmt -match '^(FAT|FAT12|FAT16|FAT32|exFAT)$') { $answers += @{ dir = $p; format = $fmt; owner = $null; rules = @() }; continue }",
  '  if ([System.IO.Directory]::Exists($p)) { $acl = (New-Object System.IO.DirectoryInfo $p).GetAccessControl() }',
  '  else { $acl = (New-Object System.IO.FileInfo $p).GetAccessControl() }',
  '  $rules = @()',
  '  foreach ($r in $acl.GetAccessRules($true, $true, $sidType)) {',
  '    $name = $null',
  '    try { $name = $r.IdentityReference.Translate([System.Security.Principal.NTAccount]).Value } catch { $name = $null }',
  "    $rules += @{ sid = $r.IdentityReference.Value; name = $name; allow = ([string] $r.AccessControlType -eq 'Allow') }",
  '  }',
  '  $answers += @{ dir = $p; owner = $acl.GetOwner($sidType).Value; rules = $rules }',
  '}',
  '$json = ConvertTo-Json -Compress -Depth 5 -InputObject @{ user = $user; dirs = $answers }',
  // Redirected output is in the console code page: anything outside ASCII (a name like José) goes as \uXXXX.
  "$json = [regex]::Replace($json, '[^\\x00-\\x7F]', { param($m) '\\u{0:x4}' -f [int][char] $m.Value })",
  '[Console]::Out.Write($json)',
].join('\n');

function shown(rule) {
  return WELL_KNOWN[rule.sid] || rule.name || rule.sid;
}

/**
 * The rule. `answer` is { user, dirs: [{ dir, owner, rules: [{ sid, name, allow }] }] }. Returns the sentence to
 * refuse with, or null.
 */
function judge(answer) {
  if (!answer || typeof answer.user !== 'string' || !answer.user || !Array.isArray(answer.dirs) || !answer.dirs.length) {
    return 'the access list of the folder that keeps this copy\'s record of the release key list could not be read';
  }
  const own = new Set([answer.user, SYSTEM_SID, ADMINISTRATORS_SID]);
  for (const d of answer.dirs) {
    if (!d || typeof d.dir !== 'string' || !Array.isArray(d.rules)) {
      return 'the access list of the folder that keeps this copy\'s record of the release key list could not be read';
    }
    if (typeof d.format === 'string' && FAT.test(d.format)) {
      return `${d.dir} is on a ${d.format} drive, which keeps no permissions and cannot make hard links, so this copy's record `
        + 'of the release key list cannot be kept private there. Keep the Kosmos data folder on an NTFS drive';
    }
    if (!own.has(d.owner)) {
      return `${d.dir} (part of this copy's record of the release key list) belongs to another account (${d.owner}). `
        + 'Make yourself its owner (right-click it, Properties, Security, Advanced)';
    }
    const others = [];
    for (const r of d.rules) {
      if (!r || r.allow !== true) continue;   // a deny entry takes access away, never gives it
      if (own.has(r.sid) || r.sid === CREATOR_OWNER_SID) continue;
      const who = shown(r);
      if (!others.includes(who)) others.push(who);
    }
    if (others.length) {
      return `${d.dir} (part of this copy's record of the release key list) can also be reached by ${others.join(', ')}. `
        + 'Remove those entries (right-click it, Properties, Security), leaving only you, SYSTEM and Administrators';
    }
  }
  return null;
}

/** Reads the access lists through Windows PowerShell. Resolves to the parsed answer; rejects with an Error. */
function readAcls(dirs, { env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const ps = path.win32.join(env.SystemRoot || process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const childEnv = { ...process.env, KOSMOS_ACL_DIRS: dirs.join('\n') };
  for (const key of Object.keys(childEnv)) if (key.toLowerCase() === 'psmodulepath') delete childEnv[key];
  return new Promise((resolve, reject) => {
    cp.execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', ACL_SCRIPT], {
      encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, env: childEnv,
    }, (err, stdout) => {
      if (err) { reject(new Error(err.code === 'ENOENT' ? 'Windows PowerShell is not where Windows keeps it' : 'Windows PowerShell could not read it')); return; }
      try { resolve(JSON.parse(String(stdout).trim())); } catch { reject(new Error('Windows PowerShell answered in a form Kosmos could not read')); }
    });
  });
}

/** null when every folder in `dirs` is the person's own; otherwise the sentence to refuse with. Never throws. */
async function aclRefusal(dirs, opts = {}) {
  const platform = opts.platform || process.platform;
  const list = [].concat(dirs).filter(Boolean);
  if (platform !== 'win32') return 'the access list of the folder that keeps this copy\'s record of the release key list can only be read on Windows';
  if (!list.length) return judge(null);
  let answer;
  try { answer = await (opts.read || readAcls)(list, opts); } catch (e) {
    return `the access list of the folder that keeps this copy's record of the release key list could not be read (${(e && e.message) || e})`;
  }
  // ConvertTo-Json writes a one-item array as the item itself.
  if (answer && answer.dirs && !Array.isArray(answer.dirs)) answer = { ...answer, dirs: [answer.dirs] };
  if (answer && Array.isArray(answer.dirs)) answer.dirs = answer.dirs.map((d) => (d && d.rules && !Array.isArray(d.rules) ? { ...d, rules: [d.rules] } : d));
  if (answer && Array.isArray(answer.dirs) && answer.dirs.length !== list.length) return judge(null);
  return judge(answer);
}

module.exports = { aclRefusal, judge, readAcls, SYSTEM_SID, ADMINISTRATORS_SID, CREATOR_OWNER_SID };
