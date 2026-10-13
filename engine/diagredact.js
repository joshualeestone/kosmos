'use strict';

/* #5959 slice 4: what is taken out of the diagnostics file before it leaves the engine.

   One function for every string in the file, in this order:
   0. a value the board holds (who.secrets: its token, the agents' tokens), wherever it appears;
   1. a header's credential (Authorization, Cookie) and a JSON field named like a secret, value only; then
      secretmask.mask, the backup scan's redactor (keys, tokens, an env line's value);
   2. the home folder, as `~`, with any separator and in any case, and any other account's folder name under Users or
      home, as [user];
   3. email addresses, as [email];
   4. this computer's user name and host name (long and short forms), as [user] and [computer], matched whole
      (not inside a longer name) and in any case. A generic host name (localhost) is not replaced.
   A name shorter than MIN_NAME_CHARS is left alone rather than replaced everywhere it appears inside other words. */

const os = require('node:os');
const secretmask = require('./secretmask');

const MIN_NAME_CHARS = 3;
const MIN_SECRET_CHARS = 16;   // a held value shorter than this is not masked by value (it would hit ordinary text)
// The last label is letters, as a real domain's is: a package's `name@1.2.3` is not an address.
// Bounded parts (an address's own limits), so a long run of name characters with no @ cannot make it slow.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;
// A user folder in any account's path: /Users/x, /home/x, C:\Users\x (any separator, any case). A name with spaces
// ("Cy Doe") is taken whole when a separator follows it; a bare /Users/x at the end of a phrase stops at the space.
const OTHER_HOMES = /((?:^|[^A-Za-z0-9_.-])(?:[A-Za-z]:)?(?:\\\\|\\|\/|%2F|%5C)(?:Users|home)(?:\\\\|\\|\/|%2F|%5C))(?!\[user\])(?:[^\\\/\s'\"`<>:|*?%~]+(?: [^\\\/\s'\"`<>:|*?%~]+)*(?=(?:\\\\|\\|\/|%2F|%5C))|[^\\\/\s'\"`<>:|*?%~]+)/gi;
/* Credentials secretmask does not know by shape (it finds vendor keys and key=value pairs): a header's value, a cookie,
   and a JSON field named like a secret. The name stays, so a reader still sees what was there; the value goes. */
const CRED_PATTERNS = [
  // Authorization: Bearer x / Basic x / Token x (a header line, or a logged headers object)
  [/\b((?:proxy-)?authorization["']?\s*[:=]\s*["']?(?:(?:bearer|basic|token|digest)\s+)?)[^\s"',;}]+/gi, '$1'],
  // a bare scheme and its value
  [/\b((?:bearer|basic)\s+)[A-Za-z0-9._~+\/=-]{8,}/gi, '$1'],
  // Cookie: a=b; c=d (every value)
  [/\b((?:set-)?cookie["']?\s*[:=]\s*["']?)[^\r\n"']+/gi, '$1'],
  // "authToken": "x", "client_secret": "x", "password": "x", "apiKey": "x"
  // (not any name with "auth" in it: authMode and author are facts a builder needs; an escaped quote stays in the value)
  [/("[A-Za-z0-9_-]*(?:token|secret|password|passwd|apikey|api_key|authorization)[A-Za-z0-9_-]*"\s*:\s*")(?:[^"\\]|\\.)*(")/gi, '$1$2'],
];

// Host names every computer can have, which name no one: replacing them would only damage lines like a localhost URL.
const GENERIC_HOSTS = new Set(['localhost', 'localhost.localdomain']);

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* A whole-name pattern: not preceded or followed by a name character, so "agent1" never matches inside "agent12". */
function wholeName(name) {
  // A name just after a URL-encoded separator (%2F, %5C) is whole too, as in a logged ?path=%2FUsers%2Fpat%2F.
  return new RegExp('(?:(?<![A-Za-z0-9_.-])|(?<=%2F|%5C))' + escapeRe(name) + '(?![A-Za-z0-9_-])', 'gi');
}

/* Reads this computer's names once per call to makeRedactor; `who` is the test seam, and `who.secrets` the values the
   board holds, masked by value. */
function makeRedactor(who) {
  const w = who || {};
  const home = typeof w.home === 'string' ? w.home : os.homedir();
  const user = typeof w.user === 'string' ? w.user : (() => { try { return os.userInfo().username; } catch { return ''; } })();
  const host = typeof w.host === 'string' ? w.host : os.hostname();
  const hosts = [...new Set([host, host.split('.')[0]])].filter((h) => h && h.length >= MIN_NAME_CHARS && !GENERIC_HOSTS.has(h.toLowerCase()))
    .sort((a, b) => b.length - a.length);   // the long form first, so its short form does not leave ".local" behind
  const names = [
    ...hosts.map((h) => [wholeName(h), '[computer]']),
    ...(user && user.length >= MIN_NAME_CHARS ? [[wholeName(user), '[user]']] : []),
  ];
  /* The home folder however a line spells it: any separator (\, a doubled \ as in JSON, or /) and any case (Windows and
     macOS paths ignore case). Its last segment is also a name when it differs from the user name (a "Pat Smith" folder
     for a pat.smith account), so it is replaced as [user] too. */
  const segs = typeof home === 'string' ? home.split(/[\\/]+/).filter(Boolean) : [];
  const SEP = '(?:\\\\\\\\|\\\\|/|%2F|%5C)';   // \\, \, /, or URL-encoded / and \ (the 'i' flag takes %2f too)
  const homeRe = segs.length && home.length > 1
    ? new RegExp((/^[\\/]/.test(home) ? SEP : '') + segs.map(escapeRe).join(SEP) + '(?=' + SEP + '|$|[^A-Za-z0-9_.-])', 'gi')
    : null;
  const folder = segs.length ? segs[segs.length - 1] : '';
  if (folder && folder.length >= MIN_NAME_CHARS && folder.toLowerCase() !== String(user || '').toLowerCase()) {
    names.push([wholeName(folder), '[user]']);
  }

  // Values the board holds (its token, the agents' tokens), masked wherever they appear, before any shape is looked for.
  const known = (Array.isArray(w.secrets) ? w.secrets : []).filter((v) => typeof v === 'string' && v.length >= MIN_SECRET_CHARS)
    .sort((a, b) => b.length - a.length);

  function redactText(text) {
    if (typeof text !== 'string' || !text) return text;
    let out = text;
    for (const v of known) if (out.includes(v)) out = out.split(v).join(secretmask.MASK);
    for (const [re, keep] of CRED_PATTERNS) out = out.replace(re, (...m) => keep.replace(/\$(\d)/g, (_, n) => (n === '1' ? m[1] + secretmask.MASK : m[Number(n)] || '')));
    out = secretmask.mask(out).text;
    if (homeRe) out = out.replace(homeRe, '~');
    // Any other account's folder too (a shared computer): the folder name under Users or home names a person.
    out = out.replace(OTHER_HOMES, (m, lead) => lead + '[user]');
    out = out.replace(EMAIL, '[email]');
    for (const [re, word] of names) out = out.replace(re, word);
    return out;
  }

  /* Every string value in a plain value, as a new value; the input is not changed. Keys are left alone: in the
     diagnostics file they are all the code's own words, and a name equal to one (a host called "log") must not rename it. */
  function redactDeep(value) {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(redactDeep);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
      return out;
    }
    return value;
  }

  return { redactText, redactDeep };
}

module.exports = { makeRedactor, MIN_NAME_CHARS };
