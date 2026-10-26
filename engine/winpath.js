'use strict';
/**
 * How Windows spells a path, read without touching the disk (#7221). Pure functions of a string: a share or a device
 * namespace, a drive letter, a link target Kosmos may follow, a DOS device name, whether one path is written inside
 * another. engine/replyfile.js builds its Windows refusals on these; the device-name rule is shared with
 * engine/backuprestore.js and engine/win32zip.js. One classifier returning a single kind per spelling is #7249.
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
/* A \\ or // spelling, or an NT \??\ one, that is not this computer's own drive or volume: a share (\\host\share,
   \??\UNC\..., \??\GLOBALROOT\Device\Mup\...), or a namespace that cannot be placed (\\.\pipe\..., another device),
   which every caller treats as not local, the safe reading. A local drive's \\?\C:\, \\.\C:\ and \??\C:\ spellings and
   a local volume's \\?\Volume{GUID}\ are not (review 10 finding 1: a link to a local volume had been refused as "on
   another computer"; review 19 finding 2: the NT \??\ spellings of a share had read as local). */
const NT_LOCAL = /^\\\?\?\\(?=[A-Za-z]:[\\/])/;                  // \??\C:\..., the NT spelling of a local drive
/* A local drive reached through the object manager's DosDevices aliases (review 22 finding 1): \??\Global\C:\,
   \??\GLOBALROOT\GLOBAL??\C:\, \??\GLOBALROOT\??\C:\ and their \\?\ and \\.\ forms all name drive C. */
const DRIVE_ALIAS = /^(?:\\\?\?\\|[\\/]{2}[?.][\\/])(?:Global[\\/]|GLOBALROOT[\\/](?:GLOBAL\?\?|\?\?)[\\/])+(?=[A-Za-z]:[\\/])/i;
const NT_PREFIX = /^\\\?\?\\/;
function isNetworkSpelling(p) {
  const s = String(p);
  const namespaced = (NAMESPACE.test(s) && !LOCAL_LONG.test(s)) || (NT_PREFIX.test(s) && !NT_LOCAL.test(s));
  return namespaced && !isLocalVolumeSpelling(s);
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
function followableLinkTarget(to) {
  const t = asDrivePath(to);
  if (/^[A-Za-z]:[\\/]/.test(t)) return t.indexOf(':', 2) >= 0 ? null : t;
  if (t.includes(':') || t.includes('?')) return null;
  /* A root-relative target (\dir\x, what mklink writes for a target typed without a drive) is a path on the link's own
     drive, resolved against it like a relative one (review 11 finding 3). Not one that names the object manager's own
     folder \Device\ (anything with a `?`, like \GLOBAL??\, is refused above), which only the NT spellings may reach. The word
     is matched whole (review 12 NIT), so \devices\x or \Global-share\x is a folder like any other. */
  if (/^[\\/](?![\\/])/.test(t)) return /^[\\/]device(?:[\\/]|$)/i.test(t) ? null : t;
  if (/^[\\/]/.test(t)) return null;
  return t;
}
/* A share path's namespace spellings (\\?\UNC\host\share, \??\UNC\..., and the Mup device that serves shares,
   \\?\GLOBALROOT\Device\Mup\host\share) read as the plain \\host\share they name. */
const SHARE_NAMESPACE = /^(?:(?:[\\/]{2}[?.][\\/]|\\\?\?\\)(?:Global[\\/]|GLOBALROOT[\\/](?:GLOBAL\?\?|\?\?)[\\/])?UNC|[\\/]{2}[?.][\\/]GLOBALROOT[\\/]Device[\\/]Mup|\\\?\?\\GLOBALROOT\\Device\\Mup)[\\/]/i;
function asShareSpelling(p) {
  return String(p).replace(SHARE_NAMESPACE, '\\\\');
}
/* `\\host\share` of a network path, lower-cased (its namespace spellings read the same), or null. */
function shareOf(p) {
  const m = /^[\\/]{2}([^\\/?.][^\\/]*)[\\/]+([^\\/]+)/.exec(asShareSpelling(p));
  return m ? (m[1] + '\\' + m[2]).toLowerCase() : null;
}
/* A local volume named without a drive letter: \\?\Volume{GUID}\ or \\?\GLOBALROOT\Device\HarddiskVolumeN\, and the
   same in the NT spelling a link target reads back in (\??\Volume{GUID}\, \??\GLOBALROOT\Device\HarddiskVolumeN\).
   Local, so resolving it reaches no other computer; but its spelling cannot be compared with a drive path. A Volume
   Shadow Copy (\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopyN\) is a local volume too (review 27 finding 1). */
const LOCAL_VOLUME = /^(?:[\\/]{2}[?.][\\/]|\\\?\?\\)(?:Volume\{[0-9a-f-]+\}|GLOBALROOT[\\/]Device[\\/]HarddiskVolume(?:ShadowCopy)?\d+)[\\/]/i;
function isLocalVolumeSpelling(p) {
  return LOCAL_VOLUME.test(String(p));
}
/* A path written as a plain share, \\host\share\... or //host/share/..., not the \\?\ or \\.\ namespaces. */
function isPlainShare(p) {
  return !/^[\\/]{2}[?.][\\/]/.test(String(p)) && !NT_PREFIX.test(String(p)) && shareOf(p) !== null;
}
/* A drive path's long (\\?\C:\) or NT (\??\C:\) spelling read as the plain drive path it is. */
function asDrivePath(p) {
  return String(p).replace(DRIVE_ALIAS, '').replace(LOCAL_LONG, '').replace(NT_LOCAL, '');
}
/* Whether `given` is written inside `folder` (a drive path or a plain share), case-insensitively as Windows does. */
function writtenInside(given, folder) {
  const f = asWritten(folder);
  return (!!driveOf(f) || isPlainShare(f)) && asWritten(given).startsWith(f + '\\');
}
/* A path as Windows compares spellings: its drive spellings read as the drive path, normalized, lower-cased, with no
   trailing separator. The one normalizer writtenInside and sameWrittenPath share (review 13). */
function asWritten(p) {
  return path.win32.normalize(asDrivePath(p)).toLowerCase().replace(/\\+$/, '');
}
/* Whether two paths are written the same, as Windows compares them (case-insensitively, either slash). */
function sameWrittenPath(a, b) {
  return asWritten(a) === asWritten(b);
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
   A folder in a namespace this cannot place (not a drive, a share or a local volume) answers yes, refuse rather than
   let through, unless it is one that holds no files at all (isNoFileNamespace: a pipe, a mailslot, a DOS device), so
   one such project row cannot make every agent's project attach refuse (reviews 8, 12 and 23). */
function mayHold(folder, given, real) {
  if (writtenInside(given, folder) || writtenInside(real, folder)) return true;
  if (isNetworkSpelling(folder) && !shareOf(folder)) return !isNoFileNamespace(folder);
  const f = asWritten(folder);
  if ((!!driveOf(f) || isPlainShare(f)) && [given, real].some((p) => insideAllowingShortNames(asWritten(p), f))) return true;
  const ft = shareTail(folder);
  return !!ft && [given, real].some((p) => { const t = shareTail(p); return !!t && insideAllowingShortNames(t, ft); });
}
/* An 8.3 short name (RUNNER~1, PROGRA~1, AB12C4~1.TXT). Windows gives one to a long name, and a path may be written
   with either, but realpath gives the long one, so a folder written with a short name never matches by spelling the
   real path of a file in it (CI's temp folder is C:\Users\RUNNER~1\...). Which long name a short one stands for
   cannot be known without asking the disk, or the share, so where a match must err toward yes a short name stands
   for any one name. Only mayHold uses this: a check that lets a path through never does. */
const SHORT_NAME = /^[^\\~]{1,8}~\d+(?:\.[^\\.]{0,3})?$/;
function insideAllowingShortNames(p, folder) {
  const ps = p.split('\\');
  const fparts = folder.split('\\');
  return ps.length > fparts.length && fparts.every((s, i) => s === ps[i] || SHORT_NAME.test(s) || SHORT_NAME.test(ps[i]));
}

/* Whether a path starts \\ or // (a share, or the \\?\ and \\.\ namespaces, a local drive's long spelling too). */
function isNamespaceSpelling(p) {
  return NAMESPACE.test(String(p));
}
/* Whether a path is a local drive path written in a namespace form: \\?\C:\, \\.\C:\ or the NT \??\C:\. */
function isLongDrivePath(p) {
  return LOCAL_LONG.test(String(p)) || NT_LOCAL.test(String(p));
}

/* A namespace that holds no files at all: named pipes, mailslots and the DOS devices (\\.\pipe\..., \\.\COM1). An
   ALLOW-LIST (review 23 finding 1): any other spelling that cannot be placed may name a drive (Windows follows its
   DosDevices aliases any number of times: \\?\Global\Global\C:\ is C:\), so it is never read as holding nothing. */
const NO_FILE_NAMESPACE = /^(?:[\\/]{2}[?.][\\/]|\\\?\?\\)(?:(?:pipe|mailslot)[\\/]|(?:COM\d+|LPT\d+|CON|NUL|AUX|PRN|CONIN\$|CONOUT\$)(?:[\\/]|$))/i;
function isNoFileNamespace(p) {
  return NO_FILE_NAMESPACE.test(String(p));
}

module.exports = { isNoFileNamespace, WINDOWS_DEVICE_NAME, isNamespaceSpelling, isLongDrivePath, isDevicePart, isNetworkSpelling, driveOf, followableLinkTarget, shareOf, asShareSpelling, isPlainShare, isLocalVolumeSpelling, asDrivePath, writtenInside, sameWrittenPath, mayHold };
