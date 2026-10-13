'use strict';

/* #5959 slice 4: what is taken out of the diagnostics file before it leaves the engine.

   One function for every string in the file, in this order:
   1. secretmask.mask, the backup scan's redactor (keys, tokens, an env line's value);
   2. the home folder, as `~`;
   3. email addresses, as [email];
   4. this computer's user name and host name (long and short forms), as [user] and [computer], matched whole
      (not inside a longer name) and in any case.
   A name shorter than MIN_NAME_CHARS is left alone rather than replaced everywhere it appears inside other words. */

const os = require('node:os');
const secretmask = require('./secretmask');

const MIN_NAME_CHARS = 3;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

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
  const hosts = [...new Set([host, host.split('.')[0]])].filter((h) => h && h.length >= MIN_NAME_CHARS)
    .sort((a, b) => b.length - a.length);   // the long form first, so its short form does not leave ".local" behind
  const names = [
    ...hosts.map((h) => [wholeName(h), '[computer]']),
    ...(user && user.length >= MIN_NAME_CHARS ? [[wholeName(user), '[user]']] : []),
  ];
  const homeRe = home && home.length > 1 ? new RegExp(escapeRe(home.replace(/[\\/]+$/, '')) + '(?=[\\\\/]|$|[^A-Za-z0-9_.-])', 'g') : null;

  function redactText(text) {
    if (typeof text !== 'string' || !text) return text;
    let out = secretmask.mask(text).text;
    if (homeRe) out = out.replace(homeRe, '~');
    out = out.replace(EMAIL, '[email]');
    for (const [re, word] of names) out = out.replace(re, word);
    return out;
  }

  /* Every string in a plain value (object keys included), as a new value; the input is not changed. */
  function redactDeep(value) {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(redactDeep);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[redactText(k)] = redactDeep(v);
      return out;
    }
    return value;
  }

  return { redactText, redactDeep };
}

module.exports = { makeRedactor, MIN_NAME_CHARS };
