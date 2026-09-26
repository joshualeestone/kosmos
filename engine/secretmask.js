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
let knownSignature = null;
let indexBuilds = 0;   // for tests: how many times the index was rebuilt
function setKnownSecrets(values) {
  /* The board reloads the held set every few minutes; an unchanged set keeps its index (review round 23: a rebuild
     at the value cap took about 2 seconds of the event loop). */
  const list = Array.isArray(values) ? values.filter((v) => typeof v === 'string') : [];
  /* Sorted (review round 24): the files are read in directory order, which need not repeat, and the same set in
     another order is still the same set. The index itself is built from the list as given. */
  /* A hash of the sorted list as JSON (review round 25): a join on a separator collided when a value held that
     separator, and kept a copy of every held file. */
  const signature = require('crypto').createHash('sha256').update(JSON.stringify([...list].sort())).digest('hex');
  if (signature === knownSignature) return;
  knownSignature = signature;
  indexBuilds += 1;
  maskCache.clear();
  maskCacheChars = 0;
  const forms = new Set();
  const heldValues = [];   // the values taken, as trimmed: the same set the forms and the fragment index come from
  const walkable = new Set();   // forms of values that are not NAME=value lines
  for (const v of list) {
    const k = v.trim();
    if (k.length < MIN_VALUE_LEN) continue;
    /* A bound on the work every reply pays (review round 1 measured 545ms per reply at 20,000 values). */
    if (heldValues.length >= MAX_KNOWN_VALUES) break;
    heldValues.push(k);
  }
  const heldSet = new Set(heldValues);
  notWalked = new Set(heldValues.filter((k) => envLike(k, heldSet)));
  for (const k of heldValues) {
    const buf = Buffer.from(k, 'utf8');
    const hex = buf.toString('hex');
    const spaced = hex.match(/../g).join(' ');
    /* A whole NAME=value line held from a secrets file, or a whole env file (review rounds 21, 22 and 25): its
       NAMES are public, and walking it, or any encoding of it, would mask a name in a reply that only mentions it.
       Its forms are still masked whole; each value is held on its own, and walked from there. */
    const env = notWalked.has(k);
    for (const f of [k, hex, hex.toUpperCase(), spaced, spaced.toUpperCase(), buf.toString('base64'), buf.toString('base64').replace(/=+$/, ''), buf.toString('base64url')]) {
      forms.add(f);
      if (!env) walkable.add(f);
    }
  }
  /* Longest first, so a value inside a longer one's encoding is not half-replaced. */
  knownForms = [...forms].sort((a, b) => b.length - a.length);
  /* Indexed by their first 8 characters, so a reply is scanned once rather than once per form (every form
     is 12 characters or more). */
  knownByPrefix = new Map();
  knownByOpening = new Map();
  knownGrams = new Set();
  const walked = new Set();
  for (const f of knownForms) {
    const k = f.slice(0, 8);
    if (!knownByPrefix.has(k)) knownByPrefix.set(k, []);
    knownByPrefix.get(k).push(f);
    /* #3935: the word-skipping join assembles a form from runs of key characters, so it walks the form with
       every other character taken out (a password's ! and #, the spaced hex's spaces): those characters sit
       between runs in the text, not inside them. */
    if (!walkable.has(f)) continue;
    const w = f.replace(NOT_KEY_CHARS, '');
    addWalked(w, walked);
    /* A key given WITHOUT its public prefix (review round 15): a reply that leaves out sk-ant-api03- and splits
       the rest by words starts no walk from the prefix, so the part after the last - or _ in the first 16
       characters is walked as a form of its own. */
    const cut = publicHeadCut(w);
    if (cut > 0) addWalked(w.slice(cut + 1), walked);
  }
  /* Every FRAGMENT_LEN-character slice of each held value as given (not its encodings, which would multiply the
     index), for fragmentsIn (review round 19). A word-shaped value is left out, as the walk leaves it out. */
  const sliced = [];
  for (const v of heldValues) {
    if (notWalked.has(v)) continue;
    const w = v.replace(NOT_KEY_CHARS, '');
    if (w.length < FRAGMENT_LEN || w.length > WORD_WALK_MAX_FORM || madeOfWords(w)) continue;
    /* Not the public prefix (sk-ant-api03 is itself 12 characters, and the whole guide names it): slices start
       after the last - or _ in the first 16 characters, as the prefix-less walk does. */
    let from = publicHeadCut(w) + 1;
    /* A URL's scheme, host and path are public (review round 23: a held webhook's com/api/webhooks slices masked a
       guide's placeholder URL), so a URL-shaped value is sliced only after its last /, where its token sits. */
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(v)) from = Math.max(from, w.lastIndexOf('/') + 1);
    if (w.length - from < FRAGMENT_LEN) continue;
    sliced.push([w, from]);
  }
  /* Over MAX_GRAMS, values are indexed at a stride rather than the first ones in full and the rest not at all
     (review round 22: a full index skipped later values silently). A slice starts every stride characters, so any
     FRAGMENT_LEN + stride - 1 consecutive characters of a value still hold an indexed slice: coverage thins by a
     known amount, for every value. Keys come first (review round 26: a bare 12-character excerpt of a key was
     missed once long values thinned the index): values up to KEY_LEN_MAX keep every slice while they fit, and
     only the longer ones (whole files) are thinned, with what is left. */
  const short = sliced.filter(([w, from]) => w.length - from <= KEY_LEN_MAX);
  const long = sliced.filter(([w, from]) => w.length - from > KEY_LEN_MAX);
  const count = (list) => list.reduce((n, [w, from]) => n + w.length - from - FRAGMENT_LEN + 1, 0);
  const shortSlices = count(short);
  keyStride = Math.max(1, Math.ceil(shortSlices / MAX_GRAMS));
  const room = Math.max(MAX_GRAMS - Math.ceil(shortSlices / keyStride), 1);
  fragmentStride = Math.max(keyStride, Math.ceil(count(long) / room), 1);
  for (const [list, stride] of [[short, keyStride], [long, fragmentStride]]) {
    for (const [w, from] of list) {
      for (let i = from; i + FRAGMENT_LEN <= w.length; i += stride) knownGrams.add(w.slice(i, i + FRAGMENT_LEN));
    }
  }
}
/* #3935 (review round 19): a key whose first chunk is under OPENING_LEN starts no walk, and the rest can sit in
   the reply as one run (Zq then 8vLm3pRt6wXy9kHb2nWc4d: 22 of 24 characters). Any run holding FRAGMENT_LEN
   consecutive characters of a held value is masked whole, within these limits: FRAGMENT_LEN + fragmentStride - 1 for a value over KEY_LEN_MAX (and keyStride for keys, 1
   unless keys alone fill it)
   characters once the index is thinned; not a run made of words; not a value over WORD_WALK_MAX_FORM, a
   NAME=value line (its value is held on its own), the public head before the first 16 characters' last - or _,
   or a URL's scheme, host and path. That many consecutive characters of a random value
   do not turn up in ordinary text by chance, and the shortest value held at all is this long. */
const FRAGMENT_LEN = 12;
/* A bound on the fragment index's memory: 2,000 values of a key's length are about 200,000 slices. Past it the
   index is thinned evenly (fragmentStride), never cut off, so it holds at most MAX_GRAMS plus one slice per value
   (rounding). */
const MAX_GRAMS = 400000;
let fragmentStride = 1;   // the stride of values over KEY_LEN_MAX
let keyStride = 1;   // the stride of values up to it: 1 unless keys alone fill the index
/* A value this long or shorter is a key or a password, not a file. */
const KEY_LEN_MAX = 256;
/* A held value that is a whole environment line, NAME=value, whose value engine/knownsecrets.js also holds on its
   own (the same NAME=value test, then trimmed and unquoted), long enough to be held here (review round 23). Padded
   base64 (Zq8vLm3pRt6wXy9kHb2nWc4dQ1==) has the same shape, but its "value" is the padding, never held: that is a
   secret, not a line, and it is walked like any other. */
function isEnvLine(v, heldSet) {
  const m = /^[A-Za-z_][A-Za-z0-9_]*=(.*)$/.exec(v);
  if (!m) return false;
  const value = m[1].trim().replace(/^["']|["']$/g, '');
  /* Only when that value is really held (review round 25): past MAX_KNOWN_VALUES it may not be, and then the line
     is the only way to walk it. */
  return value.length >= MIN_VALUE_LEN && (!heldSet || heldSet.has(value));
}
/* A held value not walked or sliced: a NAME=value line, or a whole file of lines each held on its own (an env
   file, whose second and later NAMES would otherwise sit inside a walked value, review round 25). A line under
   MIN_VALUE_LEN is not held, and is not a key by this file's measure. */
function envLike(v, heldSet) {
  if (isEnvLine(v, heldSet)) return true;
  if (!/\n/.test(v)) return false;
  const lines = v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return lines.some((x) => isEnvLine(x, heldSet)) && lines.every((x) => x.length < MIN_VALUE_LEN || heldSet.has(x));
}
/* Values shorter than this are not held, so a short word is never taken for a key. */
const MIN_VALUE_LEN = 12;
/* A key's public head (sk-ant-api03-, ghp_) ends at the last - or _ within this many characters. */
const PUBLIC_HEAD_MAX = 16;
/* Where a held value's public head ends: the index of that last - or _, or -1 when it has none (review round 25:
   one rule for the prefix-less walk, the fragment slices and the repeated-opening check). */
function publicHeadCut(w) {
  return Math.max(w.lastIndexOf('-', PUBLIC_HEAD_MAX - 1), w.lastIndexOf('_', PUBLIC_HEAD_MAX - 1));
}
let notWalked = new Set();
let knownGrams = new Set();
const FRAGMENT_RUN = new RegExp(`[A-Za-z0-9_+/=-]{${FRAGMENT_LEN},}`, 'g');
function fragmentsIn(text) {
  const spans = [];
  if (!knownGrams.size) return spans;
  for (const m of text.matchAll(FRAGMENT_RUN)) {
    /* A run that is itself words (a webhook URL's com/api/webhooks/, which a guide names) is ordinary text. */
    if (madeOfWords(m[0])) continue;
    /* The whole run, however long (review round 20: a cap left a fragment past it unread): one Set lookup per
       position, so the cost stays linear in the reply. */
    const run = m[0];
    for (let i = 0; i + FRAGMENT_LEN <= run.length; i += 1) {
      if (knownGrams.has(run.slice(i, i + FRAGMENT_LEN))) { spans.push([m.index, m.index + run.length]); break; }
    }
  }
  return spans;
}
function addWalked(w, walked) {
  if (w.length < MIN_VALUE_LEN || w.length > WORD_WALK_MAX_FORM || walked.has(w) || madeOfWords(w)) return;
  /* An opening with no letter or digit (a PEM key's -----BEGIN) would start a walk at every markdown rule
     (review round 5). Such a value is still masked whole, and across lines by the separator copies. */
  if (!/[A-Za-z0-9]/.test(w.slice(0, OPENING_LEN))) return;
  walked.add(w);
  const o = w.slice(0, OPENING_LEN);
  if (!knownByOpening.has(o)) knownByOpening.set(o, []);
  knownByOpening.get(o).push(w);
}
/* A held value made only of words and numbers (Administrator1, Settings2024) is not walked (review round 3):
   the walk would assemble it out of an ordinary sentence ("Log in as Administrator on step 1") and mask
   the sentence. Split at case changes, digits and key punctuation, every piece is a word or a number. Such a
   value is still masked wherever it is written whole.
   A word is three letters or more, a quarter of them vowels, with no run of four consonants (review round 16:
   "has a vowel" alone called 98% of random single-case secrets, zvqxrpldkinaeout, words, so they were never
   walked and leaked split by a word). Measured over 20,000 each: random lowercase or uppercase 16-character
   secrets 7% are still taken for words (12 characters: 15%), random keys and hex 0%; Administrator1,
   Settings2024, Password123 and correcthorsebatterystaple are words. */
/* Not looksRandom's wordish, on purpose: that one decides whether the catch-all may leave a long NAME alone (loose,
   so fewer names are masked); this one decides whether a held value is too word-like to walk (strict, so fewer
   secrets escape the walk). One rule would loosen one of them. */
function wordLike(p) {
  if (/^[0-9]+$/.test(p)) return true;
  if (p.length < 3) return false;
  return (p.match(/[aeiouy]/gi) || []).length / p.length >= 0.25 && !/[b-df-hj-np-tv-xz]{4,}/i.test(p);
}
function madeOfWords(v) {
  const pieces = v.replace(/[+_/=-]/g, ' ').match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+/g) || [];
  return pieces.length > 0 && pieces.every(wordLike);
}
let knownByPrefix = new Map();
/* The held forms the word walk assembles (key characters only), by their first OPENING_LEN characters (#3935). */
let knownByOpening = new Map();
const NOT_KEY_CHARS = /[^A-Za-z0-9_+/=-]+/g;
/* The board also holds whole files (engine/knownsecrets.js, up to 64KB) and their encodings. A form that
   long is not a key someone spells out in pieces, and the walk's reach grows with the form's length, so
   only forms up to this length are walked (review round 1: one 40,000-character held value made a reply
   that repeated its opening cost over a second). Longer forms are still masked whole by known_secret. */
const WORD_WALK_MAX_FORM = 1024;
/* The shortest first piece that starts a walk, and the width of the held forms' opening index. Shorter and
   ordinary words would start walks against every held value sharing their letters; the cost is that a key
   cut into chunks of three or fewer, with words between them, is not caught (stated under wordSkippingSpans). */
const OPENING_LEN = 4;
/* A key's own separators, which a reply may drop where it splits the key (sk-ant-api03 then the rest). */
const SKIPPABLE = new Set(['-', '_']);
/* How many of them in a row a reply may drop at one split (review round 12: a doubled "--" or "__" is common
   in a base64url form, and skipping only one let such a key through whole). A cap keeps the walk bounded. */
const SKIP_RUN = 3;
/* The characters a partial try must match after its opening, in non-word pieces of OPENING_LEN or more, before its
   pieces are masked (review round 11): enough that coincidence in ordinary text is out of reach, and less than
   any key's length, so a try that gave half a key away is still caught. */
const PARTIAL_MIN = 8;
/* The positions a piece may start from at p: p itself, and past each of up to SKIP_RUN separators there. */
function skipsFrom(f, p) {
  const out = [p];
  for (let k = 0; k < SKIP_RUN && SKIPPABLE.has(f[p + k]); k += 1) out.push(p + k + 1);
  return out;
}
/* The held forms that occur in `str`, longest first. */
function knownFormsIn(str) {
  if (!knownByPrefix.size || typeof str !== 'string') return [];
  const found = new Set();
  for (let i = 0; i + 8 <= str.length; i += 1) {
    const cands = knownByPrefix.get(str.slice(i, i + 8));
    if (!cands) continue;
    for (const f of cands) if (str.startsWith(f, i)) found.add(f);
  }
  return [...found].sort((a, b) => b.length - a.length);
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
  /* UTF-16 positions (review round 1 of the separator change): Array.from(text, fn) walks CODE POINTS, so
     with an emoji earlier in the text every later position was off, and a split key's tail was left showing. */
  let cur = { str: text, map: Array.from({ length: text.length }, (_, i) => i) };
  /* Every line break between key characters is joined (up to two blank lines), with any quote or list
     marker after it. No gate on what surrounds it: review round 3 measured that gating the join (plain
     letters on both sides, or fewer than three characters on one side) left split keys readable. The
     cost of ordinary lists is paid down below instead, by searching the copy only for what could match. */
  cur = deleting(cur.str, cur.map, /[A-Za-z0-9_+/=-]((?:[ \t]*\r?\n){1,3}[ \t>|*`]*)(?=[A-Za-z0-9_+/=-])/g,
    (m) => [m.index + 1, m.index + m[0].length]);
  return unspaced(cur.str, cur.map);
}
/* A run of nine or more single characters, each followed by one space ("s k - a n t ..."), and not
   "I am a person": every space inside the run goes. */
function unspaced(text, map = Array.from({ length: text.length }, (_, i) => i)) {
  return deleting(text, map, /(?<!\S)(?:\S ){8,}\S(?!\S)/g, (m) => {
    const spans = [];
    for (let i = 1; i < m[0].length; i += 2) spans.push([m.index + i, m.index + i + 1]);
    return spans;
  });
}
/*
 * #3935: a HELD value whose pieces have WORDS between them (a row label, another filled column, a bullet's
 * description, prose around bold or backticked chunks). The separator copies in mask() (#3938's two) drop only
 * characters no key uses and runs of three or fewer key characters, so any run of four or more between
 * pieces defeated them and the whole key showed.
 *
 * The reply is cut into runs of key characters. A form is started by a run that ENDS with the form's
 * opening (four characters or more, so "KEY=Ab3d" starts it as well as "Ab3d"); the runs after it are
 * walked in order, and a run that is exactly the form's next part advances it while any other run is
 * skipped as noise. Every position the form could have reached is kept, not only the latest, so a short
 * noise run that happens to equal the next part ("1" in a row label) cannot derail the real assembly.
 * The walk stops at the same bound as the separator copies: at most 4x the form's length in
 * non-whitespace characters from the first piece, which is what stops two far-apart words from
 * swallowing a reply. Returns [from, to) spans in the text, one per matched piece (review round 18).
 *
 * Not covered:
 *  - pieces out of order or reversed;
 *  - an opening piece shorter than OPENING_LEN characters, when the rest is split again into runs under
 *    FRAGMENT_LEN (a longer rest is masked by fragmentsIn);
 *  - a held value madeOfWords takes for words and numbers;
 *  - a partial try (one that never completes) with under PARTIAL_MIN characters after its opening, counted in
 *    non-word pieces of OPENING_LEN or more; a try that reaches it is masked piece by piece;
 *  - glue in the middle of a run other than - or _ between chunks and a label joined by =, - or _ on either side;
 *  - a held form over WORD_WALK_MAX_FORM characters;
 *  - pieces that overlap (a character given twice, at the end of one piece and the start of the next);
 *  - a key split across two replies (the mask is per message).
 */
/* The most checks one reply may cost the walk. A reply that needs more is not searched to the end:
   wordSkippingSpans returns null and mask() withholds the whole message, because a search cut short is one
   that may have missed a key, and this file errs toward masking. What reaches it (review round 5): one held
   value near WORD_WALK_MAX_FORM whose opening the reply repeats a few hundred times (each mention looks ahead
   over about 4x the value), or thousands of held values sharing an opening that the reply repeats. What fills it
   grows with (held forms sharing an opening) x (mentions of that opening in the reply). Measured with random keys
   (review round 19), five held Anthropic keys and guide prose naming sk-ant-api03- each time: withheld in 6 of
   20 trials at 400 mentions (49,000 characters), 1 of 20 at 160, never at 80 or fewer. That was at a budget of
   250,000; review round 21 measured denser prose (a mention every 130 characters) withheld 9 of 20 times at 80
   mentions with five keys, while an exhausted search had cost only 37 to 50ms, so the budget is 1,250,000: what
   matters is mentions per character, and every adversarial test still ends at it within its CPU bound. At this
   budget an exhausted search costs about 1 to 1.3 seconds (review round 23, 50,000-character replies), and a
   1,440-character reply naming sk-ant-api03- 20 times about 50 to 280ms; mask() caches results, so a stored reply
   served on every poll pays that once per held set, not per read. Earlier measurements (review round 13): well
   inside it, a 50,000-character reply with five held Anthropic keys and 400 sk-ant-api03- mentions. Measured
   reaching it (review round 13): ten held Anthropic keys and a 36,000-character reply repeating a paragraph that
   names sk-ant-api03- 200 times, withheld; whether it trips depends on the keys' random next characters. */
const WORD_WALK_BUDGET = 1250000;
/* How many tails after, and heads before, a - or _ one run offers as pieces (review rounds 15 to 19). */
const PIECE_VARIANTS_MAX = 4;
/* How far a split value may spread: its pieces within this many times its length, counted in characters that are
   not spaces. One constant for the separator copies and the word walk (review round 24), so their reach cannot
   drift apart. */
const SPLIT_REACH = 4;
/* A comparison is charged by the characters it can read, one unit per 16 (review round 6): an opening or a
   piece can be up to WORD_WALK_MAX_FORM long, and counting comparisons alone let 2,000 held values sharing a
   1,000-character prefix cost two seconds under the budget. An ordinary opening or piece is one unit. */
const chunksOf = (len) => Math.max(1, Math.ceil(len / 16));
/* A piece as written can carry key characters that are not the key's (review round 1): a label joined
   with = (part2=Ab3d), markdown italics (_Ab3d_), a slash before or after. Each run is tried as written and with
   those taken off. */
function pieceVariants(run) {
  const out = new Set([run]);
  const trimmed = run.replace(/^[-+_/]+/, '').replace(/[-+_/]+$/, '');
  if (trimmed) out.add(trimmed);
  /* An = inside the run, not base64 padding at its end, joins a label to the piece on one side or the other:
     part2=Ab3d (the piece follows the LAST =) or Ab3d=part2 (the piece comes before the FIRST). */
  if (!/=$/.test(trimmed)) {
    const last = trimmed.lastIndexOf('=');
    if (last > 0) out.add(trimmed.slice(last + 1));
    const first = trimmed.indexOf('=');
    if (first > 0) out.add(trimmed.slice(0, first));
  }
  /* A key's chunks joined by its own separators, licence-key style (Qw8e-Rt2y), with words between the groups
     (review round 14): the run is tried with every - and _ taken out as well, one piece of the key. */
  for (const v of [...out]) if (/[^-_][-_]+[^-_]/.test(v)) out.add(v.replace(/[-_]+/g, ''));
  /* A label joined by a hyphen (chunk-2-Rt2mNp9b, review round 15): each tail after a - or _, up to four, and
     only tails of OPENING_LEN or more (a shorter one, "Wor" of pi03-Wor, is coincidence, not a piece). */
  /* Taken from the END (review round 17): the piece is the last part, so a label with many hyphens
     (my-long-label-name-Rt2mNp9b) still offers it within the four. */
  let tails = 0;
  for (let k = trimmed.length - 1 - OPENING_LEN; k > 0 && tails < PIECE_VARIANTS_MAX; k -= 1) {
    if (trimmed[k] === '-' || trimmed[k] === '_') { out.add(trimmed.slice(k + 1)); tails += 1; }
  }
  /* And the heads before a - or _, from the START, up to four (review round 19): a label glued AFTER the piece
     (Zq8vLm3p-part1, Zq8vLm3p_a), as = is already handled on both sides. */
  let heads = 0;
  for (let k = OPENING_LEN; k < trimmed.length - 1 && heads < PIECE_VARIANTS_MAX; k += 1) {
    if (trimmed[k] === '-' || trimmed[k] === '_') { out.add(trimmed.slice(0, k)); heads += 1; }
  }
  out.delete('');
  return [...out];
}
function wordSkippingSpans(text) {
  if (!knownByOpening.size) return [];
  let budget = WORD_WALK_BUDGET;
  const runs = [];
  for (const m of text.matchAll(/[A-Za-z0-9_+/=-]+/g)) {
    runs.push([m.index, m.index + m[0].length, m[0]]);
  }
  if (runs.length < 2) return [];
  /* A run's piece variants and what comparing them costs, built on first use. */
  const built = new Map();
  const varsOf = (i) => {
    let v = built.get(i);
    if (!v) { const vs = pieceVariants(runs[i][2]); v = [vs, vs.reduce((n, x) => n + chunksOf(x.length), 0)]; built.set(i, v); }
    return v;
  };
  const hasOpening = (raw) => {
    for (const str of /[-_]/.test(raw) ? [raw, raw.replace(/[-_]+/g, '')] : [raw]) {
      for (let q = 0; q + OPENING_LEN <= str.length; q += 1) if (knownByOpening.has(str.slice(q, q + OPENING_LEN))) return true;
    }
    return false;
  };
  /* nonSpaceBefore[i]: non-whitespace characters in text[0, i), so any span's count is one subtraction.
     Built on the first opening found, so a reply with none pays nothing for it. */
  let nonSpaceBefore = null;
  const countNonSpace = () => {
    nonSpaceBefore = new Uint32Array(text.length + 1);
    for (let i = 0; i < text.length; i += 1) nonSpaceBefore[i + 1] = nonSpaceBefore[i] + (/\s/.test(text[i]) ? 0 : 1);
  };
  const spans = [];
  const completed = new Map();   // `${end} ${form}` -> { f, to, starts: every start that completed there }
  /* The forms an opening can start, grouped by the character that must begin the next piece, with the
     longest form's bound. Cached per opening for this reply: the cost test's 2,000 held values share one
     opening that occurs 4,000 times, and walking every form from every start cost 12 seconds. */
  const byOpening = new Map();
  const groupsFor = (opening, cands) => {
    let g = byOpening.get(opening);
    if (g) return g;
    /* Charged: each distinct opening scans every form under its 4-character index once (review round 3). */
    if ((budget -= cands.length * chunksOf(opening.length)) < 0) return null;
    g = { byNext: new Map(), maxLen: 0 };
    for (const f of cands) {
      /* The whole form inside one run is contiguous: the ordinary known_secret pass masks it. */
      if (opening.length >= f.length || !f.startsWith(opening)) continue;
      /* A key's own - or _ at the split may be left out of the reply (review round 7): the next piece can then
         start with the character after it. */
      const nexts = skipsFrom(f, opening.length).map((q) => f[q]);
      for (const c of nexts) {
        if (c === undefined) continue;
        if (!g.byNext.has(c)) g.byNext.set(c, []);
        g.byNext.get(c).push(f);
      }
      g.maxLen = Math.max(g.maxLen, f.length);
    }
    byOpening.set(opening, g);
    return g;
  };
  /* Where a matched piece sits in its run (review round 26): a label glued after it (Zq8vLm3p=Some-words,
     Zq8vLm3p-part1) is not the key, so only the piece is masked. The run's end if the piece ends it, else the
     piece's first place in the run; a piece that is not a plain substring (the run with its - and _ taken out)
     masks the whole run. */
  const pieceSpan = (i, piece) => {
    const [a, b, t] = runs[i];
    if (t.endsWith(piece)) return [b - piece.length, b];
    const at = t.indexOf(piece);
    return at >= 0 ? [a + at, a + at + piece.length] : [a, b];
  };
  for (let r = 0; r < runs.length; r += 1) {
    const [runFrom] = runs[r];
    /* The opening is looked for in the run as written and in each variant a piece is tried as (glue taken off),
       so a key's own last _ or / is kept in one and italics or a label are gone in another. */
    /* Every variant is a substring of the run or of the run without its - and _, so a run holding no indexed
       opening in either starts nothing, and its variants are not built (review round 18: building them for
       every run cost 2.5x on text dense with - _ and =, when nothing matched). */
    if (!hasOpening(runs[r][2])) continue;
    for (const head of varsOf(r)[0]) for (let q = 0; q + OPENING_LEN <= head.length; q += 1) {
      const cands = knownByOpening.get(head.slice(q, q + OPENING_LEN));
      if (!cands) continue;
      const opening = head.slice(q);
      /* Longer than any walked form, so a prefix of none: not looked up, and not charged (review round 7). */
      if (opening.length > WORD_WALK_MAX_FORM) continue;
      const group = groupsFor(opening, cands);
      if (!group) return null;
      const { byNext, maxLen } = group;
      if (!maxLen) continue;
      if (!nonSpaceBefore) countNonSpace();
      /* q indexes the VARIANT, which is the run or a slice of it with glue taken off the front, so `from` is at
         or before the true opening: it can only mask a little more (a glued label), never less. */
      const from = runFrom + q;
      /* Only a form whose next character begins some run in reach can ever advance. */
      const live = new Set();
      for (let s = r + 1; s < runs.length && nonSpaceBefore[runs[s][1]] - nonSpaceBefore[from] <= SPLIT_REACH * maxLen; s += 1) {
        /* Every run visited is charged, matching or not (review round 1: charging only matches left the
           scan itself unbounded). */
        if ((budget -= 1) < 0) return null;
        for (const v of varsOf(s)[0]) {
          const next = byNext.get(v[0]);
          if (!next) continue;
          if ((budget -= next.length) < 0) return null;
          for (const f of next) live.add(f);
        }
      }
      for (const f of live) {
        const bound = SPLIT_REACH * f.length;
        let reached = new Set([opening.length]);
        let movedAt = -1;   // where this walk first matched a piece after its opening
        let doneFrom = null;   // the last piece: its run, and the position it started at
        const via = new Map();   // position -> { s: the run that reached it, prev: the position before }
        let best = opening.length;
        let finished = false;
        for (let s = r + 1; s < runs.length; s += 1) {
          const [, sTo] = runs[s];
          const [pieces, piecesCost] = varsOf(s);
          if (nonSpaceBefore[sTo] - nonSpaceBefore[from] > bound) break;
          let done = false;
          const next = new Set(reached);
          /* Each start position, with the reached position it came from: a piece matched past a skipped
             separator links back to where the walk had got to, not to the skip (review round 17: linking to the
             skip broke the trace back, and every piece before it was left readable). */
          const at = [];
          for (const p of reached) for (const q of skipsFrom(f, p)) at.push([q, p]);
          if ((budget -= at.length * piecesCost) < 0) return null;
          for (const [q, p] of at) {
            for (const piece of pieces) {
              if (!f.startsWith(piece, q)) continue;
              const end = q + piece.length;
              if (end === f.length) { done = true; doneFrom = { s, prev: p, start: q }; break; }
              next.add(end);
              if (!via.has(end)) via.set(end, { s, prev: p, start: q });
              if (end > best) best = end;
              if (movedAt < 0) movedAt = runs[s][0];
            }
            if (done) break;
          }
          if (done) {
            const k = `${sTo} ${f}`;
            if (!completed.has(k)) completed.set(k, { f, to: sTo, starts: [] });
            /* The runs this walk matched, opening first, so an earlier start can be masked piece by piece. */
            const matched = [pieceSpan(r, opening)];
            for (let step = doneFrom, end = f.length; step; end = step.prev, step = via.get(step.prev) || null) matched.push(pieceSpan(step.s, f.slice(step.start, end)));
            completed.get(k).starts.push({ from, movedAt: movedAt < 0 ? runs[s][0] : movedAt, matched });
            finished = true;
            break;
          }
          reached = next;
        }
        /* A walk that got part of the way and then ran out of reach (review round 10): an abandoned first try
           at a key, cut off from the retry by other text, or a key given only in part. Only pieces of
           OPENING_LEN or more AFTER the opening count, and they must come to 8 characters or more (review
           round 11): the opening can be a key's PUBLIC prefix (sk-ant-api03 is 12 characters on its own), and
           a one-character run that happens to be the key's next character (a bullet's "-", the word "a", a
           step number) is ordinary text. Then the opening and those pieces are masked, each on its own, never
           the text between them. */
        if (!finished && via.has(best)) {
          const found = [];
          let after = 0;
          for (let at = best; via.has(at); at = via.get(at).prev) {
            const step = via.get(at);
            /* Only a piece that is not made of words or numbers counts (review round 13): a URL-shaped held value's
               public scheme and host (https, discord, com) are words, and a reply naming them is not a try. */
            if (at - step.start >= OPENING_LEN && !madeOfWords(f.slice(step.start, at))) { found.push(pieceSpan(step.s, f.slice(step.start, at))); after += at - step.start; }
          }
          if (after >= PARTIAL_MIN) {
            spans.push(pieceSpan(r, opening));
            for (const sp of found) spans.push(sp);
          }
        }
      }
    }
  }
  /* The same form completing at the same place from several starts (review rounds 2, 5, 7, 9 and 10). The latest
     start is always kept. An earlier one is kept only if its walk got somewhere before the latest start, a piece
     matched there: an abandoned first try at the key. It is not kept when its walk first moved AFTER the latest
     start, which covers both a bare mention of the opening ("every key begins sk-ant-api03-", masking the
     explanation between would hide it) and two held keys sharing an opening (the second key's walk from the
     first key's opening moves only on the second key's own pieces, all after its own start; keeping it would
     join the two into one span masking everything between). Linear: one pass over the starts. */
  for (const c of completed.values()) {
    const latest = c.starts.reduce((m, st) => (st.from > m ? st.from : m), -1);
    /* Piece by piece, the latest start too (review round 18): one span from the first piece to the last took
       the row labels, columns and bullet text between them, so a word-labelled table collapsed to one row. */
    for (const st of c.starts) if (st.from === latest) for (const m of st.matched) spans.push(m);
    /* An earlier start is masked piece by piece, not as one span to the end (review round 16): a retry within
       reach joined the two and hid the prose between them ("Sorry, again:"). */
    for (const { from, movedAt, matched } of c.starts) if (from !== latest && movedAt < latest) for (const m of matched) spans.push(m);
    /* An earlier start dropped above still shows its opening run. That is right for a public prefix (the bare
       mention), but a repeated opening that is not public (review round 23: "Here Qw8eRt2y, I mean Qw8eRt2y then
       ...") leaves the key's first characters readable. So an earlier start's opening run is masked on its own
       when it holds PARTIAL_MIN characters or more past the value's public head that are not words. */
    const cut = publicHeadCut(c.f);
    const head = cut > 0 ? c.f.slice(0, cut + 1) : '';
    for (const { from, movedAt, matched } of c.starts) {
      if (from === latest || movedAt < latest || !matched.length) continue;
      const open = matched.reduce((m, sp) => (sp[0] < m[0] ? sp : m));
      /* Not the latest start's own run begun earlier (a label glued on, KEY=sk-ant-a): only a separate copy. */
      if (open[1] > latest) continue;
      const piece = text.slice(open[0], open[1]).replace(NOT_KEY_CHARS, '');
      /* The piece may be the head itself without its last - or _ (review round 26 masks only the matched piece). */
      const common = !head ? 0 : piece.startsWith(head) ? head.length : head.startsWith(piece) ? piece.length : 0;
      const own = piece.slice(common);
      if (own.length >= PARTIAL_MIN && !madeOfWords(own)) spans.push(open);
    }
  }
  return spans;
}
/* How many characters of text[from, to) are not whitespace, counting no further than `cap + 1`. */
function nonSpaceIn(text, from, to, cap = Infinity) {
  let n = 0;
  for (let i = from; i < to && n <= cap; i += 1) if (!/\s/.test(text[i])) n += 1;
  return n;
}
const WITHHELD = `${'••••'} (Kosmos removed a password or key from this message.)`;
/* When the search for a split key ran out of its budget (review round 19): nothing may have been found, so the
   message is withheld, and it does not claim a key was removed. */
const UNCHECKED = `${'••••'} (Kosmos could not finish checking this message for passwords or keys, so it is not shown.)`;
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
/* Results by text, for the held set in force (review round 23): the board masks every served row of the guide's
   thread on every read, and a reply that fills the walk's budget costs about a second, so a stored reply is not
   searched again on each poll. Cleared whenever the held set changes; bounded, oldest out first. */
const MASK_CACHE_MAX = 1000;
const MASK_CACHE_TEXT_MAX = 65536;
/* And by characters held, texts and results together (review round 25: 1,000 entries of 64K each is 128MB). */
const MASK_CACHE_CHARS_MAX = 4000000;
let maskCacheChars = 0;
const maskCache = new Map();
function mask(text) {
  if (typeof text !== 'string' || !text || text.length > MASK_CACHE_TEXT_MAX) return maskFresh(text);
  const hit = maskCache.get(text);
  if (hit) return { text: hit.text, fired: hit.fired.map((f) => ({ ...f })) };
  const out = maskFresh(text);
  const cost = text.length + out.text.length;
  while (maskCache.size && (maskCache.size >= MASK_CACHE_MAX || maskCacheChars + cost > MASK_CACHE_CHARS_MAX)) {
    const [oldest, was] = maskCache.entries().next().value;
    maskCacheChars -= oldest.length + was.text.length;
    maskCache.delete(oldest);
  }
  maskCache.set(text, { text: out.text, fired: out.fired.map((f) => ({ ...f })) });
  maskCacheChars += cost;
  return out;
}
function maskFresh(text) {
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
  const spans = [];
  /* #3769 (Ice Cream Kitty's re-check after #3800): a HELD value written with other characters between its
     pieces, a table row per chunk (| Ab3d | Ef7h |) or one character at a time (s,k,-,a,n,t), is not joined
     by the copy above, which only closes line breaks and single spaces. So a second copy keeps ONLY the
     characters a key is made of, and is searched for held values alone: prose is never matched against
     it, and a 12-character-or-longer held value does not assemble itself from unrelated words. A hit is
     masked from its first piece to its last. An occurrence that is already contiguous in the text is
     left to the ordinary pass below (it is the same value, masked as known_secret).
     Two copies, because the noise between pieces comes in two kinds: characters no key uses (| , ; . and
     spaces), which the first copy drops, and SHORT runs of key characters, such as a table's row number or
     its --- divider (| 0 | Ab3dEf7h |), which the second copy drops by keeping only runs of four or more. */
  if (knownByPrefix.size) {
    const identity = Array.from({ length: original.length }, (_, i) => i);   // UTF-16 positions, as slice uses
    const allKeyChars = deleting(original, identity, /[^A-Za-z0-9_+/=-]+/g, (m) => [m.index, m.index + m[0].length]);
    const longRuns = deleting(original, identity, /[A-Za-z0-9_+/=-]{1,3}(?![A-Za-z0-9_+/=-])|[^A-Za-z0-9_+/=-]+/g,
      (m) => (m.index > 0 && /[A-Za-z0-9_+/=-]/.test(original[m.index - 1]) && /^[A-Za-z0-9_+/=-]/.test(m[0]) ? null : [m.index, m.index + m[0].length]));
    /* #3935 (review round 13): a key in chunks joined by its own separators, licence-key style
       (Qw8e-Rt2y-Ui9o-...), is one run to both copies above, so it was never joined. This copy drops - and _
       too. A held form containing either cannot occur in it, so only forms without them are ever found here. */
    const noSeps = deleting(original, identity, /[^A-Za-z0-9+/=]+/g, (m) => [m.index, m.index + m[0].length]);
    /* With no - or _ in the text the third copy is the first one again: not searched twice (review round 14). */
    for (const copy of noSeps.str === allKeyChars.str ? [allKeyChars, longRuns] : [allKeyChars, longRuns, noSeps]) {
      if (copy.str === original) continue;
      for (const f of knownFormsIn(copy.str)) {
        let at = copy.str.indexOf(f);
        while (at !== -1) {
          const from = copy.map[at], to = copy.map[at + f.length - 1] + 1;
          /* Local only (review round 1): without a bound, a held value that two ordinary words happen to
             spell, thousands of characters apart, masked all the text between them. The bound counts only
             the NON-WHITESPACE characters in the span (review round 2): column padding in an aligned table is
             layout, not noise, and measuring raw distance let an ordinary padded table leak the whole key.
             Real splits carry little else (a row number and two pipes per chunk); four times the value is
             generous for them and far below a swallowed table. */
          if (to - from !== f.length && nonSpaceIn(original, from, to, SPLIT_REACH * f.length) <= SPLIT_REACH * f.length) spans.push([from, to]);
          at = copy.str.indexOf(f, at + f.length);
        }
      }
    }
    /* #3935: and with WORDS between the pieces, which neither copy above can skip. */
    const words = wordSkippingSpans(original);
    if (!words) { hit('split_search_limit'); return { text: UNCHECKED, fired: report() }; }
    for (const s of words) spans.push(s);
    for (const s of fragmentsIn(original)) spans.push(s);
    /* And in a copy with only single-character spacing closed up (review round 25): a key spaced one character
       at a time WITH words between its chunks ("Z q 8 v L m 3 p then w X y 9 ...") is neither. Not the copy above,
       which also joins line breaks and would carry a span into the next line's words. Only when the copy differs,
       so an ordinary reply pays nothing more; its own budget, withheld the same way. */
    const spacedCopy = unspaced(original);
    if (spacedCopy.str !== original) {
      const back = (sp) => [spacedCopy.map[sp[0]], spacedCopy.map[sp[1] - 1] + 1];
      const wordsN = wordSkippingSpans(spacedCopy.str);
      if (!wordsN) { hit('split_search_limit'); return { text: UNCHECKED, fired: report() }; }
      for (const s of wordsN) spans.push(back(s));
      for (const s of fragmentsIn(spacedCopy.str)) spans.push(back(s));
    }
  }
  if (norm !== original) {
    /* A match in the copy counts only if no match of the same pattern in the text itself is the same
       characters once whitespace is set aside: a private key block legitimately spans lines (the same key
       either way), while a split key's first line matches only its first half. */
    const bare = (x) => x.replace(/\s+/g, '');
    const inOriginal = new Set(knownFormsIn(original));
    for (const f of knownFormsIn(norm)) {
      if (inOriginal.has(f)) continue;
      let at = norm.indexOf(f);
      while (at !== -1) { spans.push([map[at], map[at + f.length - 1] + 1]); at = norm.indexOf(f, at + f.length); }
    }
    /* The key shapes are searched in the copy only when it holds one of their openings: an ordinary list
       or table joins lines but holds none, and pays nothing more (review round 2's cost finding). */
    const shapeHint = /sk-|sk_|rk_|xai-|AIza|gh[pousr]_|github_pat_|AKIA|ASIA|xox[abprs]-|glpat-|eyJ|-----BEGIN/.test(norm);
    for (const { re } of (shapeHint ? PATTERNS : [])) {
      re.lastIndex = 0;
      const inText = new Set([...original.matchAll(re)].map((m) => bare(m[0])));
      re.lastIndex = 0;
      for (const m of norm.matchAll(re)) {
        if (!inText.has(bare(m[0]))) spans.push([map[m.index], map[m.index + m[0].length - 1] + 1]);
      }
      re.lastIndex = 0;
    }
  }
  if (spans.length) {
    spans.sort((a, b) => a[0] - b[0]);
    let rebuilt = '';
    let last = 0;
    for (const [from, to] of spans) {
      if (to <= last) continue;
      /* Overlapping an earlier span: widen that one's mask rather than print a second next to it. */
      if (from < last) { last = to; continue; }
      rebuilt += original.slice(last, from) + MASK;
      last = to;
      hit('split_secret');
    }
    original = rebuilt + original.slice(last);
  }
  let out = original;
  for (const f of knownFormsIn(out)) {
    if (!out.includes(f)) continue;   // a longer form masked first may have taken it
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

/* For tests: the fragment index's size and stride, and how many times the held set was rebuilt. */
function fragmentIndexStats() { return { size: knownGrams.size, stride: fragmentStride, keyStride, builds: indexBuilds }; }
module.exports = { MASK, WITHHELD, UNCHECKED, mask, describeFired, setKnownSecrets, knownSecretCount, fragmentIndexStats };
