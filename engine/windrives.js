'use strict';
/**
 * #7232: which drive letters on this Windows computer are network drives, and the share each one maps to, learned
 * WITHOUT contacting any server: GetDriveType (through [IO.DriveInfo]::DriveType, never IsReady or the sizes, which do
 * contact it) and WScript.Network's EnumNetworkDrives, which reads the local redirector. One PowerShell call, numbers and
 * paths only, so it reads the same in every system language. Used by replyfile so a project or agent folder on a mapped
 * drive whose server is down is never walked or resolved during an attach (see .claude/plans/win-attach-cost-7232.md).
 *
 * The table is a Map of upper-case letter -> { kind: 'local' | 'remote' | 'absent', share: '\\\\host\\share' | null }.
 * Unknown (never learned, or the call failed) -> null, and callers behave exactly as before #7232.
 */
const { execFileSync, execFile } = require('node:child_process');

const REFRESH_MS = 60 * 1000;
const SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$net = @{}',
  'try { $e = (New-Object -ComObject WScript.Network).EnumNetworkDrives(); for ($i = 0; $i -lt $e.Count; $i += 2) { $net[$e.Item($i).TrimEnd(":").ToUpper()] = $e.Item($i + 1) } } catch {}',
  'foreach ($d in [IO.DriveInfo]::GetDrives()) { $l = $d.Name.Substring(0, 1).ToUpper(); "{0}`t{1}`t{2}" -f $l, [int]$d.DriveType, $net[$l] }',
].join('; ');

let table = null;      // Map, or null when unknown
let learnedAt = 0;
let testTable = null;  // set by tests only
let learning = null;

/* DriveType 4 is Network; 0 (Unknown) and 1 (NoRootDirectory) are absent; anything else is local to this computer. */
function parse(out) {
  const t = new Map();
  for (const line of String(out).split(/\r?\n/)) {
    const [letter, type, share] = line.split('\t');
    if (!/^[A-Z]$/.test(letter || '')) continue;
    const n = Number(type);
    const kind = n === 4 ? 'remote' : n === 0 || n === 1 ? 'absent' : 'local';
    t.set(letter, { kind, share: kind === 'remote' && share ? share.trim() : null });
  }
  return t.size ? t : null;
}

/* Learn the table now (blocking, bounded). Only on Windows; elsewhere the table stays unknown. */
function learnSync(timeoutMs = 3000) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
    table = parse(out);
    learnedAt = Date.now();
  } catch { /* unknown: callers behave as before */ }
  return table;
}

/* Learn it in the background (board start, and the periodic refresh). */
function learnSoon() {
  if (process.platform !== 'win32' || learning) return;
  learning = new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { encoding: 'utf8', timeout: 10000, windowsHide: true }, (err, out) => {
      if (!err) { const t = parse(out); if (t) { table = t; learnedAt = Date.now(); } }
      learning = null;
      resolve(table);
    });
  });
}

/* The entry for a drive letter, or null when the table is unknown. A letter the table does not list is learned again
   once (a drive mapped since the last refresh); still unlisted -> 'absent'. */
function driveInfo(letter) {
  const L = String(letter || '').toUpperCase();
  if (!/^[A-Z]$/.test(L)) return null;
  if (testTable) return testTable.get(L) || { kind: 'absent', share: null };
  if (!table || Date.now() - learnedAt > REFRESH_MS) { if (table) learnSoon(); else learnSync(); }
  if (!table) return null;
  if (!table.has(L)) learnSync();
  return (table && table.get(L)) || { kind: 'absent', share: null };
}

/* Tests only: a fixed table (a Map or an object of letter -> {kind, share}), or null to clear. */
function setTableForTests(t) {
  testTable = t == null ? null : (t instanceof Map ? t : new Map(Object.entries(t).map(([k, v]) => [k.toUpperCase(), v])));
}

module.exports = { driveInfo, learnSync, learnSoon, setTableForTests, _parse: parse };
