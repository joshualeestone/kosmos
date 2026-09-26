'use strict';
/**
 * #718: the leak guard's checks, shared by docs/browser-checks/mobile-shots.js (which
 * runs them over each screen and its report) and tools.mobile-shots-leak-718.test.js
 * (which proves each kind fires). What must never appear in a shot or its report: an
 * email the board injected (not example.com / .org / .net, and not one that ships in
 * web/index.html), an API key (sk-, AIza, xai-), or this Mac's home path, user name or
 * host name. A hit is reported by kind and length only: the message lands in shared logs.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const REAL_HOME = os.homedir();
const REAL_USER = os.userInfo().username;
const REAL_HOST = os.hostname().replace(/\.local$/, '');
/* Email-shaped strings that ship verbatim in web/index.html (a placeholder such
   as josh@you.com, a pattern fragment) are the same product text for everyone,
   so they cannot leak anything; only data the board injects is judged. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// OpenAI / Anthropic (sk-...), Google Gemini (AIza...) and xAI Grok (xai-...) keys.
const KEY_RE = /\b(?:sk-[A-Za-z0-9_-]{2,}|AIza[0-9A-Za-z_-]{20,}|xai-[A-Za-z0-9]{20,})/g;
const SHIPPED_HTML = fs.readFileSync(path.join(REPO, 'web', 'index.html'), 'utf8');
const SHIPPED_EMAILS = new Set(SHIPPED_HTML.match(EMAIL_RE) || []);
/* e.g. the `sk-ant-` placeholder on the API key field. This scan catches a full key
   on screen; a key shown masked or as a suffix is not visible to it, and the accounts
   preflight in mobile-shots.js is what stops a board that has one (the `account` control proves it). */
const SHIPPED_KEYS = new Set(SHIPPED_HTML.match(KEY_RE) || []);
const escapeRegExp = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* A login or host name that is also a word the product ships (`kosmos`,
   `agent`, the first-run placeholder `Josh`) would stop every run on the
   product's own text, so that one check is switched off, SAID so at the start
   of the run, and the home-path, email and key checks still stand. */
const nameCheck = (name, label) => {
  if (!name || name.length <= 2) return null;
  const re = new RegExp('\\b' + escapeRegExp(name) + '\\b', 'i');
  if (re.test(SHIPPED_HTML)) {
    console.log(`note  the ${label}-name check is off: this Mac's ${label} name is a word in web/index.html`);
    return null;
  }
  return re;
};
const REAL_USER_RE = nameCheck(REAL_USER, 'user');
const REAL_HOST_RE = nameCheck(REAL_HOST, 'host');
/* Judged on what a screenshot or a hover can show: the rendered text, form
   values, and title / aria-label / alt / placeholder. NOT the page source, whose
   comments and script would match a common login name such as a word in a
   code comment, and stop every run on that Mac. A hit is reported by kind and
   length only, no characters of it, because the message lands in shared logs. */
const mask = (t, kind) => (kind || (t.includes('@') ? 'an email address' : 'a value')) + ` (${t.length} chars)`;
/* The checks themselves, on any text: the page's, and the report's (tap-target names are
   read from textContent, which the page scan does not see). */
function hitsIn(text) {
  // Keyed on what was found, so two different hits of one length count as two; masked only for printing.
  const hits = new Map();
  for (const m of text.match(EMAIL_RE) || []) {
    if (!/@example\.(com|org|net)$/i.test(m) && !SHIPPED_EMAILS.has(m)) hits.set('email:' + m, mask(m));
  }
  // macOS paths are case-insensitive: the home shown in another case is the same leak.
  if (REAL_HOME.length > 1 && text.toLowerCase().includes(REAL_HOME.toLowerCase())) hits.set('home', 'home: ' + mask(REAL_HOME));
  if (REAL_USER_RE && REAL_USER_RE.test(text)) hits.set('user', 'user: ' + mask(REAL_USER));
  if (REAL_HOST_RE && REAL_HOST_RE.test(text)) hits.set('host', 'host: ' + mask(REAL_HOST));
  for (const m of text.match(KEY_RE) || []) if (!SHIPPED_KEYS.has(m)) hits.set('key:' + m, mask(m, 'a key'));
  return [...hits.values()];
}

module.exports = { hitsIn };
