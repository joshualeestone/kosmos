'use strict';
/**
 * How Windows spells a path, read without touching the disk (#7221). Pure functions of a string: a share or a device
 * namespace, a drive letter, a link target Kosmos may follow, a DOS device name, whether one path is written inside
 * another. engine/replyfile.js builds its Windows refusals on these; the device-name rule is shared with
 * engine/backuprestore.js and engine/win32zip.js.
 */
const path = require('node:path');

const NAMESPACE = /^[\\/]{2}/;                                   // \\host\share, //host/share, \\?\..., \\.\...
const LOCAL_LONG = /^[\\/]{2}[?.][\\/](?=[A-Za-z]:[\\/])/;       // \\?\C:\ and \\.\C:\, the namespace spellings of a local drive
/* Names Windows maps to devices whatever folder they are in, with any extension and with spaces before it (CON,
   nul.txt, COM1.log, `con .txt`), and the superscript digits: the names Microsoft documents as reserved. One copy for
   every module that checks a Windows name (#7221: replyfile, backuprestore and win32zip had three). Exactly what
   backuprestore refused before; only literal spaces before the extension (what Windows trims), so a Mac backup's
   `con .txt` stays a name. win32zip also refuses the DOS-era CLOCK$, on top of this, in its own file. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]) *(\..*)?$/i;
function isDevicePart(part) {
  return WINDOWS_DEVICE_NAME.test(String(part).replace(/[ .]+$/, ''));   // Windows drops trailing dots and spaces: "NUL. " is NUL
}
/* A \\ or // spelling that is not this computer's own drive or volume: a share, or a namespace that cannot be placed
   (\\.\pipe\..., another device), which every caller treats as not local, the safe reading. A local drive's \\?\C:\
   and \\.\C:\ spellings and a local volume's \\?\Volume{GUID}\ are not (review 10 finding 1: a link to a local volume
   had been refused as "on another computer"). */
function isNetworkSpelling(p) {
  return NAMESPACE.test(p) && !LOCAL_LONG.test(p) && !isLocalVolumeSpelling(p);
}
function driveOf(p) {
  const m = /^([A-Za-z]):/.exec(asDrivePath(p));   // C:\, and its \\?\C:\ and \??\C:\ spellings
  return m ? m[1].toUpperCase() : null;
}
/* A link's target as a drive path or a relative one, or null for anything else. An allow-list, not a list of
   network spellings (review 2 finding 1): a target written as \\?\GLOBALROOT\Device\Mup\<host>\<share> reads back
   as \??\GLOBALROOT\..., one backslash, which no \\ rule sees, and its realpath stalled 21 s on the Windows box.
   So the only targets followed are X:\... (also written \\?\X:\ or \??\X:\) and a plain relative path; a rooted
   target with no drive, a drive-relative one (C:x) and any other colon are refused unfollowed. */
const NT_LOCAL = /^\\\?\?\\(?=[A-Za-z]:[\\/])/;                  // \??\C:\..., the NT spelling of a local drive
function followableLinkTarget(to) {
  const t = String(to).replace(LOCAL_LONG, '').replace(NT_LOCAL, '');
  if (/^[A-Za-z]:[\\/]/.test(t)) return t.indexOf(':', 2) >= 0 ? null : t;
  if (/^[\\/]/.test(t) || t.includes(':')) return null;
  return t;
}
/* A share path's namespace spellings (\\?\UNC\host\share, \??\UNC\..., and the Mup device that serves shares,
   \\?\GLOBALROOT\Device\Mup\host\share) read as the plain \\host\share they name. */
const SHARE_NAMESPACE = /^(?:[\\/]{2}\?[\\/]UNC|\\\?\?\\UNC|[\\/]{2}[?.][\\/]GLOBALROOT[\\/]Device[\\/]Mup|\\\?\?\\GLOBALROOT\\Device\\Mup)[\\/]/i;
function asShareSpelling(p) {
  return String(p).replace(SHARE_NAMESPACE, '\\\\');
}
/* `\\host\share` of a network path, lower-cased (its namespace spellings read the same), or null. */
function shareOf(p) {
  const m = /^[\\/]{2}([^\\/?.][^\\/]*)[\\/]+([^\\/]+)/.exec(asShareSpelling(p));
  return m ? (m[1] + '\\' + m[2]).toLowerCase() : null;
}
/* A local volume named without a drive letter: \\?\Volume{GUID}\ or \\?\GLOBALROOT\Device\HarddiskVolumeN\. Local, so
   resolving it reaches no other computer; but its spelling cannot be compared with a drive path. */
const LOCAL_VOLUME = /^[\\/]{2}[?.][\\/](?:Volume\{[0-9a-f-]+\}|GLOBALROOT[\\/]Device[\\/]HarddiskVolume\d+)[\\/]/i;
function isLocalVolumeSpelling(p) {
  return LOCAL_VOLUME.test(String(p));
}
/* A path written as a plain share, \\host\share\... or //host/share/..., not the \\?\ or \\.\ namespaces. */
function isPlainShare(p) {
  return !/^[\\/]{2}[?.][\\/]/.test(String(p)) && shareOf(p) !== null;
}
/* A drive path's long (\\?\C:\) or NT (\??\C:\) spelling read as the plain drive path it is. */
function asDrivePath(p) {
  return String(p).replace(LOCAL_LONG, '').replace(NT_LOCAL, '');
}
/* Whether `given` is written inside `folder` (a drive path or a plain share), case-insensitively as Windows does. */
function writtenInside(given, folder) {
  const norm = (p) => path.win32.normalize(asDrivePath(p)).toLowerCase().replace(/\\+$/, '');
  const f = norm(folder);
  return (!!driveOf(f) || isPlainShare(f)) && norm(given).startsWith(f + '\\');
}
/* A share path with its host dropped: \share\rest, lower-cased, or null. Two spellings of one server (a name and its
   address) give the same tail, so a check that must fail closed can match on it. */
function shareTail(p) {
  if (!shareOf(p)) return null;
  const s = path.win32.normalize(asShareSpelling(p)).toLowerCase();
  return s.replace(/^\\\\[^\\]+/, '').replace(/\\+$/, '');
}
/* Whether a project folder left unresolved may hold the file, by spelling, erring toward yes: inside it as given or as
   resolved, or on a share whose path below the server matches, whatever the server is called (review 5 finding 1).
   A folder in a namespace this cannot place (not a drive, a share or a local volume: \\.\pipe\..., another device)
   answers yes (review 8 finding 1): unknown is treated as "may hold", so it refuses rather than lets through. */
function mayHold(folder, given, real) {
  if (writtenInside(given, folder) || writtenInside(real, folder)) return true;
  if (isNetworkSpelling(folder) && !shareOf(folder)) return true;
  const ft = shareTail(folder);
  return !!ft && [given, real].some((p) => { const t = shareTail(p); return !!t && t.startsWith(ft + '\\'); });
}

module.exports = { NAMESPACE, WINDOWS_DEVICE_NAME, isDevicePart, isNetworkSpelling, driveOf, followableLinkTarget, shareOf, isPlainShare, isLocalVolumeSpelling, asDrivePath, writtenInside, mayHold };
