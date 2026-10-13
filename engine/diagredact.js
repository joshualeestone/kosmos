'use strict';

/* #5959 slice 4: what is taken out of the diagnostics file before it leaves the engine.

   One function for every string in the file, in this order:
   1. secretmask.mask, the backup scan's redactor (keys, tokens, an env line's value);
   2. the home folder, as `~`, with any separator and in any case;
   3. email addresses, as [email];
   4. this computer's user name and host name (long and short forms), as [user] and [computer], matched whole
      (not inside a longer name) and in any case. A generic host name (localhost) is not replaced.
   A name shorter than MIN_NAME_CHARS is left alone rather than replaced everywhere it appears inside other words. */

const os = require('node:os');
const secretmask = require('./secretmask');

const MIN_NAME_CHARS = 3;
// The last label is letters, as a real domain's is: a package's `name@1.2.3` is not an address.
// Bounded parts (an address's own limits), so a long run of name characters with no @ cannot make it slow.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;
// Host names every computer can have, which name no one: replacing them would only damage lines like a localhost URL.
const GENERIC_HOSTS = new Set(['localhost', 'localhost.localdomain']);

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* A whole-name pattern: not preceded or followed by a name character, so "agent1" never matches inside "agent12". */
function wholeName(name) {
  return new RegExp('(?<![A-Za-z0-9_.-])' + escapeRe(name) + '(?![A-Za-z0-9_-])', 'gi');
}

/* Reads this computer's names once per call to makeRedactor; `who` is the test seam. */
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
  const SEP = '(?:\\\\\\\\|\\\\|/)';
  const homeRe = segs.length && home.length > 1
    ? new RegExp((/^[\\/]/.test(home) ? SEP : '') + segs.map(escapeRe).join(SEP) + '(?=' + SEP + '|$|[^A-Za-z0-9_.-])', 'gi')
    : null;
  const folder = segs.length ? segs[segs.length - 1] : '';
  if (folder && folder.length >= MIN_NAME_CHARS && folder.toLowerCase() !== String(user || '').toLowerCase()) {
    names.push([wholeName(folder), '[user]']);
  }

  function redactText(text) {
    if (typeof text !== 'string' || !text) return text;
    let out = secretmask.mask(text).text;
    if (homeRe) out = out.replace(homeRe, '~');
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
