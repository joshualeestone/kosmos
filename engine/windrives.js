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
const os = require('node:os');
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
let failedAt = 0;      // a learn that failed: not tried again in the foreground for REFRESH_MS
let testTable = null;  // set by tests only
let learning = null;
let relearned = new Set();   // letters an attach re-learned for since the last refresh (once each)

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
function took(t) {
  if (t) { table = t; learnedAt = Date.now(); relearned = new Set(); }
  else failedAt = Date.now();
}

/* Learn the table now (blocking, bounded). Only on Windows; elsewhere the table stays unknown. */
function learnSync(timeoutMs = 3000) {
  if (process.platform !== 'win32') return null;
  try {
    took(parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })));
  } catch { took(null); /* unknown: callers behave as before */ }
  return table;
}

/* Learn it in the background (board start, and the periodic refresh). */
function learnSoon() {
  if (process.platform !== 'win32' || learning) return;
  learning = new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { encoding: 'utf8', timeout: 10000, windowsHide: true }, (err, out) => {
      took(err ? null : parse(out));
      learning = null;
      resolve(table);
    });
  });
}

/* Board start (server.js start): learn in the background now and every REFRESH_MS, so an attach rarely waits on it.
   The timer is unref'd: it never keeps a process alive. */
let refreshing = null;
function startRefreshing() {
  if (process.platform !== 'win32' || refreshing) return;
  learnSoon();
  refreshing = setInterval(learnSoon, REFRESH_MS);
  if (refreshing.unref) refreshing.unref();
}

/* The entry for a drive letter, or null when the table is unknown. A letter the table does not list is learned again
   once (a drive mapped since the last refresh); still unlisted -> 'absent'. A learn that failed is not tried again in
   the foreground for REFRESH_MS, so a broken PowerShell costs one attach at most 3 s a minute, never every attach. */
function driveInfo(letter) {
  const L = String(letter || '').toUpperCase();
  if (!/^[A-Z]$/.test(L)) return null;
  if (testTable === UNKNOWN) return null;
  if (testTable) return testTable.get(L) || { kind: 'absent', share: null };
  if (!table) { if (Date.now() - failedAt > REFRESH_MS) learnSync(); }
  else if (Date.now() - learnedAt > REFRESH_MS) learnSoon();
  if (!table) return null;
  if (!table.has(L) && !relearned.has(L)) { relearned.add(L); learnSync(); }
  return (table && table.get(L)) || { kind: 'absent', share: null };
}

/* Whether a share's server may be THIS computer, erring toward yes: a folder on this computer reached through a share
   (\\localhost\c$\x, \\127.0.0.2\share, \\<this name>\share, one of this computer's addresses) can hold a local file,
   so it must never be read as "another computer". Any host spelled in a way Windows may read as a number this does not
   parse (127.1, 2130706433, 0177.0.0.1, 0x7f.1) counts as this computer too. A DNS alias of this computer is missed
   (named in the plan). */
function isThisComputer(host) {
  let h = String(host || '').toLowerCase().replace(/@.*$/, '').replace(/\.+$/, '');   // \\host@SSL@443\: WebDAV
  if (!h) return true;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.ipv6-literal.net')) h = h.slice(0, -'.ipv6-literal.net'.length).replace(/-/g, ':').replace(/s/g, '%');
  h = h.replace(/%.*$/, '');
  const six = canonical6(h);
  if (six === '0:0:0:0:0:0:0:0' || six === '0:0:0:0:0:0:0:1' || (six && /^0:0:0:0:0:ffff:7f/.test(six))) return true;   // ::, ::1, ::ffff:127.x
  const first = h.split('.')[0];
  if (first === 'localhost' || /^127\./.test(h) || /^0+\./.test(h)) return true;
  let me = '';
  try { me = os.hostname().toLowerCase().split('.')[0]; } catch { me = ''; }
  if (me && first === me) return true;
  /* A host made only of digits, dots and hex marks that is not a plain four-part address is read by Windows as a
     number in some other form, so it may be 127.0.0.1. */
  if (/^[0-9a-fx.]+$/.test(h) && !/[g-wyz]/.test(h)) {
    const parts = h.split('.');
    const plain = parts.length === 4 && parts.every((p) => /^(?:0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255);
    if (!plain) return true;
  }
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        const addr = String(a.address).toLowerCase().replace(/%.*$/, '');
        if (addr === h || (six && canonical6(addr) === six)) return true;
      }
    }
  } catch { return true; }
  return false;
}
/* An IPv6 address as eight lower-case hex groups with no leading zeros (an embedded IPv4 tail read as two groups), so
   two spellings of one address compare equal; null for anything that is not one. */
function canonical6(h) {
  if (!require('node:net').isIPv6(h)) return null;
  let s = h;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) s = s.slice(0, v4.index) + ((+v4[1] << 8) | +v4[2]).toString(16) + ':' + ((+v4[3] << 8) | +v4[4]).toString(16);
  const [head, tail] = s.includes('::') ? s.split('::') : [s, null];
  const a = head ? head.split(':') : [];
  const b = tail === null ? [] : (tail ? tail.split(':') : []);
  const groups = tail === null ? a : a.concat(Array(8 - a.length - b.length).fill('0'), b);
  return groups.length === 8 ? groups.map((g) => parseInt(g, 16).toString(16)).join(':') : null;
}
/* The server named by a \\host\share spelling (any case), or null. */
function hostOf(unc) {
  const m = /^[\\/]{2}([^\\/]+)/.exec(String(unc || ''));
  return m ? m[1] : null;
}

/* Whether the table is known (learned, or a test's). Unknown -> every caller behaves exactly as before #7232. */
function known() { return driveInfo('C') !== null; }

/* Where a drive letter's folders are, for a check that must fail closed:
   - null: the table is unknown, or the letter is local, or it is a network drive whose server is this computer: treat
     the letter exactly as before #7232 (walk it, resolve it);
   - { absent: true }: no drive has that letter, so nothing there can be walked or resolved;
   - { remote: true, share }: a network drive on ANOTHER computer, `share` its \\host\share, or null when the redirector
     did not name one (EnumNetworkDrives omitting a letter GetDrives calls Network): the caller then cannot know which
     server it is, this computer included, and must fail closed. */
function placeOf(letter) {
  const info = driveInfo(letter);
  if (!info || info.kind === 'local') return null;
  if (info.kind === 'absent') return { absent: true };
  if (info.share && isThisComputer(hostOf(info.share))) return null;
  return { remote: true, share: info.share || null };
}

/* Tests only: a fixed table (a Map or an object of letter -> {kind, share}), false for a table that could not be
   learned, or null to go back to the real one. Gated as replyfile's setRealpathForTests is, so nothing in a running
   board can turn it on. */
const UNKNOWN = Symbol('unknown');
function setTableForTests(t) {
  if (!require('./store').isTestProcess(process.env)) throw new Error('setTableForTests is for tests only');
  if (t === false) { testTable = UNKNOWN; return; }
  testTable = t == null ? null : (t instanceof Map ? t : new Map(Object.entries(t).map(([k, v]) => [k.toUpperCase(), v])));
}

module.exports = { known, placeOf, isThisComputer, hostOf, startRefreshing, setTableForTests, parseForTests: parse };
