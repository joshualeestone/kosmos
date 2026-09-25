'use strict';

/**
 * #3769: mask anything shaped like a secret in text the setup guide says, before it reaches the
 * person (the bubble, its direct messages) or is stored. Josh, 2026-09-25 11:54: "We need to make
 * sure the helper agent doesn't give out any passwords or keys or anything".
 *
 * This is the LAST of three layers, and the one that does not depend on the model behaving: the
 * guide's instructions tell it never to show a secret, and Kosmos launches it with deny rules on
 * credential files and with none of the tokens Kosmos holds (engine/setup-assistant.js,
 * bin/agent-supervisor.sh). A secret that gets past both still arrives here as text.
 *
 * - Each match becomes MASK. `mask()` says WHICH kinds fired and how many, never the value, so a
 *   caller can log that a mask fired without logging what it hid.
 * - Every pattern is bounded (no unbounded quantifier next to an optional terminator), so a long
 *   reply cannot make it backtrack: it runs synchronously on the board's event loop, the lesson
 *   #1760 paid for in engine/feedbacksend.js.
 * - It errs toward masking. A long random-looking word that is not a secret is shown as MASK; a
 *   real key shown in full is the failure this exists to prevent.
 */

const MASK = '••••';

/* Order matters only for reporting: the specific shapes run before the generic ones, so a key is
   counted as what it is rather than as "long random token". */
const PATTERNS = [
  { kind: 'private_key', re: /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]{0,12000}?-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----/g },
  /* A header with no end in reach: mask the header and the key text after it on the same run. */
  { kind: 'private_key', re: /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[A-Za-z0-9+/=\s]{0,12000}/g },
  { kind: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{8,300}/g },
  { kind: 'openai_key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,300}/g },
  { kind: 'xai_key', re: /\bxai-[A-Za-z0-9_-]{16,300}/g },
  { kind: 'google_key', re: /\bAIza[0-9A-Za-z_-]{30,60}/g },
  { kind: 'github_token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,255}/g },
  { kind: 'github_token', re: /\bgithub_pat_[A-Za-z0-9_]{20,255}/g },
  { kind: 'aws_key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'slack_token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,300}/g },
  { kind: 'stripe_key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,300}/g },
  { kind: 'gitlab_token', re: /\bglpat-[A-Za-z0-9_-]{20,300}/g },
];

/* A sign-in inside a link, scheme://user:password@host: the password is masked, the rest kept. */
const URL_CREDENTIAL = /\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]{1,100}:)([^\s@/]{1,200})@/gi;

/* "password = hunter2", "API_KEY: abc...", "token=..." : the VALUE is masked and the name kept, so
   the sentence still reads. Six characters or more, so "token: none" and prose survive. */
/* A secret word, then up to two more name parts, so SECRET_KEY, SECRET_KEY_BASE and API_KEY_ID are
   caught as well as SECRET (review round 3). */
const SECRET_NAMES = '(?:password|passwd|passphrase|secret(?:[_-]?key)?|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)(?:[_-][A-Za-z0-9]{1,20}){0,2}';
const ASSIGNMENT = new RegExp(`\\b((?:[A-Za-z0-9]{1,40}[_-])?${SECRET_NAMES}["']?[ \\t]{0,3}[:=][ \\t]{0,3}["']?)([^\\s"'\`,;<>]{6,400})`, 'gi');
/* The same in words, "your password is hunter2hunter", "the API key is: AbC123...". The value must
   hold a digit or a symbol, so "the password is required" stays readable. */
const SPOKEN = new RegExp(`\\b(${SECRET_NAMES.replace('api[_-]?key', 'api[_ -]?key').replace('access[_-]?key', 'access[_ -]?key').replace('private[_-]?key', 'private[_ -]?key').replace('secret(?:[_-]?key)?', 'secret(?:[_ -]?key)?')}[ \\t]{1,3}(?:is|was)(?:[ \\t]{0,3}:[ \\t]{0,3}|[ \\t]{1,3})["'\`]?)([^\\s"'\`,;<>]{6,400})`, 'gi');
/* A bare "key" only with = or : and a value holding a digit (a hex key, say): "key: Enter" survives. */
const BARE_KEY = /\b(key["']?[ \t]{0,3}[:=][ \t]{0,3}["']?)([^\s"'`,;<>]{8,400})/gi;
/* The sentence's own closing punctuation stays outside the mask ("... is hunter2hunter." keeps its stop). */
/* Only a full stop or a closing bracket: "!" and "?" are common last characters of a real password. */
const splitTail = (v) => { const t = /[.)\]]+$/.exec(v); return t ? [v.slice(0, t.index), t[0]] : [v, '']; };
/* The shape of a value worth hiding: letters with a digit or a symbol in them, and not a path. Plain
   words ("Password: required", "Token: Settings") are a form being explained, not a secret. */
const looksLikeSecretValue = (v) => /[A-Za-z]/.test(v) && (/[0-9]/.test(v) || /[^A-Za-z0-9]/.test(v)) && !/^[~/]/.test(v);
const hasDigitOrSymbol = looksLikeSecretValue;

/* A long run with upper case, lower case and a digit in it, and not all hex: the shape of a token
   no named pattern knows. Hex-only runs (git commits, checksums) are left alone. */
/* No slash in the run, so a file path (/Users/me/Library/Application Support) is never taken for one. */
const LONG_TOKEN = /[A-Za-z0-9+_-]{32,600}={0,2}/g;
function looksRandom(s) {
  if (!(/[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s)) || /^[0-9a-fA-F]+$/.test(s)) return false;
  /* Digits in three or more separate places: a random token scatters them, a long name made of words
     (AddNewSetupGuideSecretMaskingSupport2026, a flag or a branch) carries one number (review round 3). */
  if ((s.match(/[0-9]+/g) || []).length < 3) return false;
  /* A link slug or a file name made of words (Getting-Started-With-Your-First-Agent-2026) is not a token:
     four or more short parts joined by - or _. */
  const parts = s.split(/[-_]/);
  return !(parts.length >= 4 && parts.every((p) => p.length <= 12));
}

/**
 * { text, fired } where `fired` is [{ kind, count }] in the order the kinds first fired; empty
 * when nothing was masked. A non-string comes back unchanged with nothing fired.
 */
function mask(text) {
  if (typeof text !== 'string' || !text) return { text, fired: [] };
  const counts = new Map();
  const hit = (kind) => { counts.set(kind, (counts.get(kind) || 0) + 1); };
  let out = text;
  for (const { kind, re } of PATTERNS) {
    out = out.replace(re, () => { hit(kind); return MASK; });
  }
  out = out.replace(URL_CREDENTIAL, (whole, head, value) => {
    if (value === MASK) return whole;
    hit('url_credential');
    return head + MASK + '@';
  });
  out = out.replace(ASSIGNMENT, (whole, name, raw) => {
    const [value, tail] = splitTail(raw);
    if (value.length < 6 || value.startsWith(MASK) || !looksLikeSecretValue(value)) return whole;
    hit('assigned_secret');
    return name + MASK + tail;
  });
  out = out.replace(SPOKEN, (whole, name, raw) => {
    const [value, tail] = splitTail(raw);
    if (value.length < 6 || value.startsWith(MASK) || !hasDigitOrSymbol(value)) return whole;
    hit('assigned_secret');
    return name + MASK + tail;
  });
  out = out.replace(BARE_KEY, (whole, name, raw) => {
    const [value, tail] = splitTail(raw);
    if (value.length < 8 || value.startsWith(MASK) || !/[0-9]/.test(value)) return whole;
    hit('assigned_secret');
    return name + MASK + tail;
  });
  out = out.replace(LONG_TOKEN, (run) => {
    if (!looksRandom(run)) return run;
    hit('long_token');
    return MASK;
  });
  return { text: out, fired: [...counts].map(([kind, count]) => ({ kind, count })) };
}

/* The one-line log for a mask that fired: kinds and counts, never the value. */
function describeFired(fired) {
  return fired.map((f) => `${f.kind} x${f.count}`).join(', ');
}

module.exports = { MASK, mask, describeFired };
