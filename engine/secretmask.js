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
  /* Indexed by their first 8 characters, so a reply is scanned once rather than once per form (every form
     is 12 characters or more). */
  knownByPrefix = new Map();
  knownByOpening = new Map();
  const walked = new Set();
  for (const f of knownForms) {
    const k = f.slice(0, 8);
    if (!knownByPrefix.has(k)) knownByPrefix.set(k, []);
    knownByPrefix.get(k).push(f);
    /* #3935: the word-skipping join assembles a form from runs of key characters, so it walks the form with
       every other character taken out (a password's ! and #, the spaced hex's spaces): those characters sit
       between runs in the text, not inside them. */
    const w = f.replace(NOT_KEY_CHARS, '');
    if (w.length < 12 || w.length > WORD_WALK_MAX_FORM || walked.has(w) || madeOfWords(w)) continue;
    /* An opening with no letter or digit (a PEM key's -----BEGIN) would start a walk at every markdown rule
       (review round 5). Such a value is still masked whole, and across lines by the separator copies. */
    if (!/[A-Za-z0-9]/.test(w.slice(0, OPENING_LEN))) continue;
    walked.add(w);
    const o = w.slice(0, OPENING_LEN);
    if (!knownByOpening.has(o)) knownByOpening.set(o, []);
    knownByOpening.get(o).push(w);
  }
}
/* A held value made only of words and numbers (Administrator1, Settings2024) is not walked (review round 3):
   the walk would assemble it out of an ordinary sentence ("Log in as Administrator on step 1") and mask
   the sentence. Split at case changes, digits and key punctuation, every piece is a word (three letters or
   more, with a vowel) or a number. Such a value is still masked wherever it is written whole. */
function madeOfWords(v) {
  const pieces = v.replace(/[+_/=-]/g, ' ').match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+/g) || [];
  return pieces.length > 0 && pieces.every((p) => /^[0-9]+$/.test(p) || (p.length >= 3 && /[aeiouy]/i.test(p)));
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
  /* A run of nine or more single characters, each followed by one space ("s k - a n t ..."), and not
     "I am a person": every space inside the run goes. */
  cur = deleting(cur.str, cur.map, /(?<!\S)(?:\S ){8,}\S(?!\S)/g, (m) => {
    const spans = [];
    for (let i = 1; i < m[0].length; i += 2) spans.push([m.index + i, m.index + i + 1]);
    return spans;
  });
  return cur;
}
/*
 * #3935: a HELD value whose pieces have WORDS between them (a row label, another filled column, a bullet's
 * description, prose around bold or backticked chunks). The two separator copies in mask() drop only
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
 * swallowing a reply. Returns [from, to) spans in the text, first piece to last.
 *
 * Not covered: pieces out of order or reversed; an opening piece shorter than four characters; a held value
 * made only of words and numbers (see madeOfWords); glue other than _ + - or / at either end and a label joined
 * with = on either side (glue in the middle of a run, say); a held form over WORD_WALK_MAX_FORM characters; and a key split
 * across two replies (the mask is per message).
 */
/* The most checks one reply may cost the walk. A reply that needs more is not searched to the end:
   wordSkippingSpans returns null and mask() withholds the whole message, because a search cut short is one
   that may have missed a key, and this file errs toward masking. What reaches it (review round 5): one held
   value near WORD_WALK_MAX_FORM whose opening the reply repeats a few hundred times (each mention looks ahead
   over about 4x the value), or thousands of held values sharing an opening that the reply repeats. Measured
   well inside it: a 50,000-character reply with five held Anthropic keys and 400 sk-ant-api03- mentions. */
const WORD_WALK_BUDGET = 250000;
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
  out.delete('');
  return [...out];
}
function wordSkippingSpans(text) {
  if (!knownByOpening.size) return [];
  let budget = WORD_WALK_BUDGET;
  const runs = [];
  for (const m of text.matchAll(/[A-Za-z0-9_+/=-]+/g)) {
    const variants = pieceVariants(m[0]);
    runs.push([m.index, m.index + m[0].length, m[0], variants, variants.reduce((n, v) => n + chunksOf(v.length), 0)]);
  }
  if (runs.length < 2) return [];
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
      const nexts = SKIPPABLE.has(f[opening.length]) ? [f[opening.length], f[opening.length + 1]] : [f[opening.length]];
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
  for (let r = 0; r < runs.length; r += 1) {
    const [runFrom] = runs[r];
    /* The opening is looked for in the run as written and in each variant a piece is tried as (glue taken off),
       so a key's own last _ or / is kept in one and italics or a label are gone in another. */
    for (const head of runs[r][3]) for (let q = 0; q + OPENING_LEN <= head.length; q += 1) {
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
      const from = runFrom + q;
      /* Only a form whose next character begins some run in reach can ever advance. */
      const live = new Set();
      for (let s = r + 1; s < runs.length && nonSpaceBefore[runs[s][1]] - nonSpaceBefore[from] <= 4 * maxLen; s += 1) {
        /* Every run visited is charged, matching or not (review round 1: charging only matches left the
           scan itself unbounded). */
        if ((budget -= 1) < 0) return null;
        for (const v of runs[s][3]) {
          const next = byNext.get(v[0]);
          if (!next) continue;
          if ((budget -= next.length) < 0) return null;
          for (const f of next) live.add(f);
        }
      }
      for (const f of live) {
        const bound = 4 * f.length;
        let reached = new Set([opening.length]);
        let movedAt = -1;   // where this walk first matched a piece after its opening
        for (let s = r + 1; s < runs.length; s += 1) {
          const [, sTo, , pieces, piecesCost] = runs[s];
          if (nonSpaceBefore[sTo] - nonSpaceBefore[from] > bound) break;
          let done = false;
          const next = new Set(reached);
          const at = [];
          for (const p of reached) { at.push(p); if (SKIPPABLE.has(f[p])) at.push(p + 1); }
          if ((budget -= at.length * piecesCost) < 0) return null;
          for (const p of at) {
            for (const piece of pieces) {
              if (!f.startsWith(piece, p)) continue;
              if (p + piece.length === f.length) { done = true; break; }
              next.add(p + piece.length);
              if (movedAt < 0) movedAt = runs[s][0];
            }
            if (done) break;
          }
          if (done) {
            const k = `${sTo} ${f}`;
            if (!completed.has(k)) completed.set(k, { f, to: sTo, starts: [] });
            completed.get(k).starts.push({ from, movedAt: movedAt < 0 ? runs[s][0] : movedAt });
            break;
          }
          reached = next;
        }
      }
    }
  }
  /* The same form completing at the same place from several starts (review rounds 2, 5 and 7). The latest start
     is always kept. An earlier one is kept too (an abandoned first try at the key, left readable otherwise)
     UNLESS a DIFFERENT held form completes between it and the latest start: that is two held keys sharing an
     opening (both sk-ant-api03-), where the earlier start is the first key's opening and would join the two into
     one span masking everything between. Stopping a walk at a later mention of the opening instead let a
     sentence naming the key's prefix between two pieces stop the only walk that could complete. */
  /* One sweep, not a scan per start (review round 8: comparing every completion with every other was quadratic,
     outside the budget, and cost seconds on a reply repeating an opening): completions in order of where they
     end, keeping the latest start seen for the two most recent DIFFERENT forms, answer each "did another form
     complete between this start and the latest one" in constant time. */
  const all = [...completed.values()];
  for (const c of all) c.latest = c.starts.reduce((m, st) => (st.from > m ? st.from : m), -1);
  const byEnd = [...all].sort((a, b) => a.to - b.to);
  const withRivals = all.filter((c) => c.starts.length > 1).sort((a, b) => a.latest - b.latest);
  let best = { at: -1, f: null }, second = { at: -1, f: null }, i = 0;
  for (const c of all) spans.push([c.latest, c.to]);
  for (const c of withRivals) {
    for (; i < byEnd.length && byEnd[i].to <= c.latest; i += 1) {
      const o = byEnd[i];
      if (o.f === best.f) { if (o.latest > best.at) best.at = o.latest; }
      else if (o.latest > best.at) { second = best; best = { at: o.latest, f: o.f }; }
      else if (o.latest > second.at) second = { at: o.latest, f: o.f };
    }
    const sibling = c.f !== best.f ? best.at : second.at;
    /* An earlier start is an abandoned try only if it got somewhere: its walk matched a piece before the latest
       start. A bare mention of the opening ("every key begins sk-ant-api03-") matched nothing there, and keeping
       it would mask the explanation between the mention and the key. */
    for (const { from, movedAt } of c.starts) if (from !== c.latest && sibling < from && movedAt < c.latest) spans.push([from, c.to]);
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
    for (const copy of [allKeyChars, longRuns]) {
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
          if (to - from !== f.length && nonSpaceIn(original, from, to, 4 * f.length) <= 4 * f.length) spans.push([from, to]);
          at = copy.str.indexOf(f, at + f.length);
        }
      }
    }
    /* #3935: and with WORDS between the pieces, which neither copy above can skip. */
    const words = wordSkippingSpans(original);
    if (!words) { hit('split_search_limit'); return { text: WITHHELD, fired: report() }; }
    for (const s of words) spans.push(s);
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

module.exports = { MASK, WITHHELD, mask, describeFired, setKnownSecrets, knownSecretCount };
