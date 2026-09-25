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
  /* A JSON Web Token, all three parts: the middle one is short enough to slip past the catch-all. */
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,2000}\.[A-Za-z0-9_-]{4,4000}\.[A-Za-z0-9_-]{8,2000}/g },
];

/*
 * Mask by VALUE (Ice Cream Kitty's review): the board knows the real keys it holds (the AI Models keys,
 * its secrets folder, its own token) and hands them here with setKnownSecrets. Every occurrence is
 * masked, also written as hex, base64 or base64url, so "show it as hex" does not get one out. Shape
 * patterns stay as the net for keys the board never held. Values under 12 characters are ignored, so
 * a short word can never be taken for a key. The values live only in this process's memory.
 */
let knownForms = [];
function setKnownSecrets(values) {
  const forms = new Set();
  let taken = 0;
  for (const v of Array.isArray(values) ? values : []) {
    if (typeof v !== 'string') continue;
    const k = v.trim();
    if (k.length < 12) continue;
    /* A bound on the work every reply pays (review round 1 measured 545ms per reply at 20,000 values). */
    if (taken >= MAX_KNOWN_VALUES) break;
    taken += 1;
    const buf = Buffer.from(k, 'utf8');
    const hex = buf.toString('hex');
    const spaced = hex.match(/../g).join(' ');
    for (const f of [k, hex, hex.toUpperCase(), spaced, spaced.toUpperCase(), buf.toString('base64'), buf.toString('base64').replace(/=+$/, ''), buf.toString('base64url')]) forms.add(f);
  }
  /* Longest first, so a value inside a longer one's encoding is not half-replaced. */
  knownForms = [...forms].sort((a, b) => b.length - a.length);
}
function knownSecretCount() { return knownForms.length; }

/* Zero-width and joining characters have no place in an answer and are the cheapest way to hide a key
   from a pattern, so they are removed before anything is matched. */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

/* A copy with the tricks undone (review): a key broken across lines, or spelled with a space between
   each character. It is only ever SEARCHED, never shown: if a known value or a named key shape is in
   it and was not in the text itself, the key's place in the text cannot be pinned down, so the whole
   message is withheld. */
/* Delete the characters `re` captures in group `g` from `str`, keeping `map` (each kept character's index
   in the original text) in step. */
function deleting(str, map, re, pick) {
  let outStr = '';
  const outMap = [];
  let last = 0;
  re.lastIndex = 0;
  for (const m of str.matchAll(re)) {
    /* `pick` names the spans to drop inside this match: one [from, to], or a list of them. */
    const drop = pick(m);
    if (!drop) continue;
    for (const [from, to] of (Array.isArray(drop[0]) ? drop : [drop])) {
      if (from < last) continue;
      outStr += str.slice(last, from);
      for (let i = last; i < from; i += 1) outMap.push(map[i]);   // a loop: spreading a long slice overflows the stack
      last = to;
    }
  }
  outStr += str.slice(last);
  for (let i = last; i < map.length; i += 1) outMap.push(map[i]);
  return { str: outStr, map: outMap };
}
/* The copy and, for each of its characters, where it sits in the text (review round 1: so a split key is
   masked exactly where its pieces are, rather than the whole message withheld). Joins a line break (one
   blank line allowed) between key characters, and closes up a spaced-out run of single characters. */
function normalisedCopy(text) {
  let cur = { str: text, map: Array.from(text, (_, i) => i) };
  /* Only where the join could be inside a key: three or more key characters on each side, and a digit,
     "-" or "_" in them. Two plain words across a line break (every list and table has them) are left
     alone, so an ordinary answer pays for no second scan (review round 2 measured four times the cost).
     Anchored at the start of a run of key characters, so a long run is tried once, not from every
     position in it (unanchored, a 200,000-character token took 37 seconds). */
  cur = deleting(cur.str, cur.map, /(?<![A-Za-z0-9_+/=-])([A-Za-z0-9_+/=-]{3,})((?:[ \t]*\r?\n){1,2}[ \t>|*`]*)(?=([A-Za-z0-9_+/=-]{3,}))/g, (m) => {
    if (!/[0-9_-]/.test(m[1] + m[3])) return null;
    const from = m.index + m[1].length;
    return [from, from + m[2].length];
  });
  /* A run of nine or more single characters, each followed by one space ("s k - a n t ..."), and not
     "I am a person": every space inside the run goes. */
  cur = deleting(cur.str, cur.map, /(?<!\S)(?:\S ){8,}\S(?!\S)/g, (m) => {
    const spans = [];
    for (let i = 1; i < m[0].length; i += 2) spans.push([m.index + i, m.index + i + 1]);
    return spans;
  });
  return cur;
}
const WITHHELD = `${'••••'} (Kosmos removed a password or key from this message.)`;
const MAX_KNOWN_VALUES = 2000;

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
/* Round 4: a digit is required (a word in brackets, "(leave blank)", and a setting's name,
   KOSMOS_AGENT_TOKEN, are not secrets). A password of letters and symbols only is the trade-off. */
const looksLikeSecretValue = (v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v) && !/^[~/(<[]/.test(v);
const hasDigitOrSymbol = looksLikeSecretValue;

/* A long run with upper case, lower case and a digit in it, and not all hex: the shape of a token
   no named pattern knows. Hex-only runs (git commits, checksums) are left alone. */
/* No slash in the run, so a file path (/Users/me/Library/Application Support) is never taken for one. */
const LONG_TOKEN = /[A-Za-z0-9+/_-]{32,600}={0,2}/g;
function looksRandom(run) {
  /* A slash is part of base64 (an AWS secret access key has them), but a run that starts like a path
     (/Users/..., ~/..., //host) is a path, and only the letters and digits are judged. */
  if (/^[/~]/.test(run) || run.includes('//')) return false;
  const s = run.replace(/[/=]/g, '');
  if (!(/[A-Za-z]/.test(s) && /[0-9]/.test(s)) || /^[0-9a-fA-F]+$/.test(s)) return false;
  /* Digits in two or more separate places: a random token scatters them (round 4 measured 10% of random
     32-character tokens slipping past a stricter rule). */
  if ((s.match(/[0-9]+/g) || []).length < 2) return false;
  /* A long name made of words (AddNewSetupGuide2SecretMasking2026, a flag, a branch, a class) is not a
     token: split at the case changes and digits, every piece reads as a word (three letters with a vowel)
     or a number. Random text almost never splits that way. */
  const pieces = s.replace(/[+_-]/g, ' ').match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+/g) || [];
  const wordish = (p) => /^[0-9]+$/.test(p) || (p.length >= 3 && /[aeiouy]/i.test(p));
  if (pieces.length >= 4 && pieces.every(wordish)) return false;
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
  const report = () => [...counts].map(([kind, count]) => ({ kind, count }));
  let original = text.replace(ZERO_WIDTH, '');
  /* The tricks first, on the ORIGINAL text: a known value, or a key shape, that exists only once a split
     or a spacing is undone is masked where its pieces sit in the text, line break included. Done before
     the ordinary masking, because masking the first half of a split key would hide the evidence and
     leave the second half showing. */
  const { str: norm, map } = normalisedCopy(original);
  if (norm !== original) {
    /* A match in the copy counts only if no match of the same pattern in the text itself is the same
       characters once whitespace is set aside: a private key block legitimately spans lines (the same key
       either way), while a split key's first line matches only its first half. */
    const bare = (x) => x.replace(/\s+/g, '');
    const spans = [];
    for (const f of knownForms) {
      if (original.includes(f)) continue;
      let at = norm.indexOf(f);
      while (at !== -1) { spans.push([map[at], map[at + f.length - 1] + 1]); at = norm.indexOf(f, at + f.length); }
    }
    for (const { re } of PATTERNS) {
      re.lastIndex = 0;
      const inText = new Set([...original.matchAll(re)].map((m) => bare(m[0])));
      re.lastIndex = 0;
      for (const m of norm.matchAll(re)) {
        if (!inText.has(bare(m[0]))) spans.push([map[m.index], map[m.index + m[0].length - 1] + 1]);
      }
      re.lastIndex = 0;
    }
    if (spans.length) {
      spans.sort((a, b) => a[0] - b[0]);
      let rebuilt = '';
      let last = 0;
      for (const [from, to] of spans) {
        if (to <= last) continue;
        rebuilt += original.slice(last, Math.max(from, last)) + MASK;
        last = to;
        hit('split_secret');
      }
      original = rebuilt + original.slice(last);
    }
  }
  let out = original;
  for (const f of knownForms) {
    if (!out.includes(f)) continue;
    out = out.split(f).join(MASK);
    hit('known_secret');
  }
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
  return { text: out, fired: report() };
}

/* The one-line log for a mask that fired: kinds and counts, never the value. */
function describeFired(fired) {
  return fired.map((f) => `${f.kind} x${f.count}`).join(', ');
}

module.exports = { MASK, WITHHELD, mask, describeFired, setKnownSecrets, knownSecretCount };
