'use strict';

/**
 * The runner-neutral rules for a hook command Kosmos writes into a runner's settings file (kosmos#8348): which paths may
 * ride in the command, and whether a path is too short-lived for the file it goes into. unsafeForCommand is shared by
 * geminisettings.js (Gemini) and codexhooks.js (Codex), which write the same win32 form, `& '<node>' '<bridge>'`.
 * ephemeralIntoDurable is the one #1582 rule for every hook writer: those two, and since kosmos#8365 Claude's report hook
 * and statusline (reporthook.ephemeralMismatch) and Grok (groksettings.js). Moved here unchanged from geminisettings.js,
 * except that on win32 the temp test also compares canonical, case-folded spellings.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/* Refuse a path carrying a character that would break out of, or execute inside,
   the quoted shell command. LOAD-BEARING: the command is a shell string.
   posix: the path rides in a double-quoted sh string, so a quote, backslash,
   dollar or backtick is refused (reporthook.js's posix set).
   win32: the path rides in a single-quoted POWERSHELL literal, which only a single
   quote can end, and PowerShell counts the typographic U+2018..U+201B as single
   quotes too, so those are refused with it. Double quotes (straight and
   U+201C..U+201E), dollar, backtick and percent are inert inside '...' but refused
   anyway: over-refuse, never under-refuse (a refused path degrades to scraping),
   and it keeps the set a superset of reporthook.js's win32 one. A backslash is
   ALLOWED on win32, the ordinary separator; refusing it was #4010. CR/LF are
   refused on both. A non-string is unsafe rather than throwing. */
function unsafeForCommand(s, plat) {
  if (typeof s !== 'string') return true;
  if ((plat || process.platform) === 'win32') return /['"`$%\r\n\u2018-\u201E]/.test(s);
  return /["\\$`\r\n]/.test(s);
}

/* The #1582 class (from reporthook.js; see geminisettings.ensurePrepared): whether writing any of `paths` (nulls skipped)
   into the file at `durablePath` would point a durable file outside the temp root at a path inside it. os.tmpdir() is
   compared in its own spelling and resolved, because macOS gives the UNRESOLVED /var/folders form while the paths
   reaching a settings file are the RESOLVED /private/var form.
   win32 (kosmos#8348): the temp root may also be an 8.3 short name (C:\\Users\\RUNNER~1\\...), which only the NATIVE
   realpath expands, and case names no other folder there, so each path is compared in its own spelling and in its
   native canonical one, all lowercased, with either slash as the separator (Windows reads C:/x and C:\x as one
   folder, and a posix host running this rule through the seam spells its paths with /). A path that does not exist
   yet keeps its own spelling. `opts.platform` picks the rule (a test seam); posix is exactly the rule
   geminisettings.js had. */
function ephemeralIntoDurable(durablePath, paths, opts) {
  const win = ((opts && opts.platform) || process.platform) === 'win32';
  const rawTmp = os.tmpdir();
  const roots = [rawTmp];
  try { roots.push(fs.realpathSync(rawTmp)); } catch { /* keep the raw value */ }
  if (win) { try { roots.push(fs.realpathSync.native(rawTmp)); } catch { /* keep the others */ } }
  const fold = (p) => (win ? p.replace(/\//g, '\\').toLowerCase() : p);
  const spellings = (p) => {
    if (!win) return [p];
    const out = [p];
    try { out.push(fs.realpathSync.native(p)); } catch { /* not there yet: its own spelling */ }
    return out;
  };
  const sep = win ? '\\' : path.sep;   // fold has made every win32 separator a backslash
  const underRoot = (p, root) => typeof p === 'string' && (fold(p) === fold(root) || fold(p).startsWith((win ? fold(root).replace(/\\$/, '') : root) + sep));
  const ephemeral = (p) => typeof p === 'string' && spellings(p).some((s) => roots.some((r) => underRoot(s, r)));
  const durable = typeof durablePath === 'string' && !ephemeral(durablePath);
  return durable && (paths || []).some((p) => p !== null && p !== undefined && ephemeral(p));
}

module.exports = { unsafeForCommand, ephemeralIntoDurable };
