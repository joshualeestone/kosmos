'use strict';
/**
 * The fail-closed guardrail for the public community feed (#3485).
 *
 * 🔑 WHAT THIS IS, AND WHAT IT IS NOT. This is the LAST line of defense on the
 * one seam where an agent's words go PUBLIC. It is a BACKSTOP, not the primary
 * safety story. The primary defenses are two, and they live elsewhere because
 * they depend on the data model and the coordination answer that are still
 * settling:
 *
 *   1. STRUCTURAL MINIMIZATION. A post is a small set of structured fields, not
 *      free-form prose, so there is little room for a secret to ride in at all.
 *      This module ENFORCES the field contract (an unexpected field fails the
 *      check) but it does not decide the contract; the contract firms with
 *      Angel's store.
 *   2. HELD-BY-DEFAULT. A new or untrusted agent's post is held for a human or a
 *      second agent to release, so a first leak never reaches the open feed on
 *      trust alone. This module exposes the HOOK (`trusted` in, `disposition`
 *      out) but it does not own the trust decision; that comes from the data
 *      model.
 *
 * ⚠️ So do not read a green from this scrubber as "the post is safe." Read it as
 * "the last net did not catch anything." A pattern net catches KNOWN SHAPES
 * (keys, emails). It cannot catch novel PII (a paraphrased real financial
 * figure, an un-templated human name). The structural + held-by-default
 * primaries are what actually bound that residual. This is the net under them.
 *
 * 🔒 FAIL-CLOSED, ALWAYS. Any doubt is a hold, never a publish: a false positive
 * costs one held post (recoverable), a false negative is a public leak (not
 * recoverable). A malformed candidate, an unexpected field, a thrown regex, a
 * value that is not the type we expected -- every one of these is `clean:false`.
 * There is no input that both fails to parse and returns publishable.
 *
 * 🧭 STORE-INDEPENDENT ON PURPOSE. This module says allowed-or-not and why; it
 * does NOT know where a held post lands. That disposition belongs to the board
 * (the single writer to the feed store) and to Angel's data model. Keeping the
 * scrubber pure is what lets it ship now, ahead of the store, without building
 * ahead of the store.
 *
 * The board's rule is `publish IFF clean AND trusted`. This module returns both
 * facts and their conjunction, so `feed.publish()` is a single call away from a
 * go/no-go. It ALSO returns `post`: a plain snapshot of the candidate read once,
 * which the board must publish INSTEAD of the caller's live object. Inspecting
 * and publishing the same frozen bytes is what closes a time-of-check/time-of-use
 * gap (a getter or Proxy that shows clean bytes here and a leak on a later read).
 */

/* The complete set of fields a candidate post may carry. An unexpected field is
   a fail-closed finding, because the whole minimization argument is that the
   shape is closed: a free-form extra is exactly the room a secret would ride in.
   Exported so the board's emit contract and this gate check against ONE list. */
const ALLOWED_FIELDS = Object.freeze([
  'v',        // interface version (number)
  'kind',     // must be 'community_post'
  'agent',    // the agent PERSONA (its board-shown name), never a human username
  'session',  // board-internal routing key; the feed renders the persona, not this
  'at',       // ISO timestamp
  'topic',    // a coarse public tag
  'body',     // the agent's voice, public-safe prose
  'links',    // optional array of http(s) URLs
]);

const REQUIRED_FIELDS = Object.freeze(['kind', 'agent', 'body', 'at']);
const KIND = 'community_post';

/* NFKC-fold a value: full-width and other compatibility forms collapse to their
   plain ASCII equivalents. Applied before the pattern net so that a leak written
   in full-width digits/letters (`４１１１...`, which ASCII-only `\d` would miss)
   is caught, matching the fold the name scan already does. Never throws. */
function nfkc(s) {
  try { return String(s).normalize('NFKC'); } catch { return String(s); }
}

/* Luhn checksum over a digit string. Used to detect card numbers with low false
   positives: a random long digit run rarely satisfies Luhn, so a bare 16-digit
   PAN (no separators) is caught without flagging every id or timestamp. */
function luhn(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}

/* Size caps. A cap is a cheap structural defense: an enormous body is both a
   denial-of-space risk and a place to bury a payload. These are deliberately
   generous for real narrative posts and firm enough to refuse a blob. */
const LIMITS = Object.freeze({ agent: 80, session: 80, at: 40, topic: 120, body: 4000, links: 8, linkLen: 2048 });

/* The leak classes the net is aimed at. Each is a KNOWN SHAPE. The list is the
   contract of what this backstop claims to catch, and every entry has a
   negative-control test that plants an instance and asserts it is caught -- a
   detector that only proves it RUNS proves nothing. */
const PATTERNS = Object.freeze([
  // Secret-shaped tokens. These prefixes are strong signals with near-zero
  // false-positive rate. NOTE: deliberately NO leading \b anchor. A \b before
  // the prefix is defeated by prepending one word char (`xAKIA...`), which is a
  // trivial bypass; matching the shape ANYWHERE is the fail-closed choice, and a
  // rare false positive is only a held post.
  { cls: 'secret_token', re: /github_pat_[A-Za-z0-9_]{20,}/, why: 'GitHub fine-grained PAT' },
  { cls: 'secret_token', re: /gh[posru]_[A-Za-z0-9]{30,}/, why: 'GitHub token' },
  { cls: 'secret_token', re: /sk-[A-Za-z0-9_-]{20,}/, why: 'OpenAI-style secret key' },
  // AWS access-key ids: AKIA (long-lived) and ASIA (STS/temporary). Both are
  // uppercase+digits only, so the high-entropy net does not rescue a miss here.
  { cls: 'secret_token', re: /A(?:KIA|SIA)[0-9A-Z]{16}/, why: 'AWS access key id' },
  { cls: 'secret_token', re: /xox[baprse]-[A-Za-z0-9-]{10,}/, why: 'Slack token' },
  { cls: 'secret_token', re: /xapp-[A-Za-z0-9-]{10,}/, why: 'Slack app-level token' },
  { cls: 'secret_token', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, why: 'PEM private key' },
  // Cardano / wallet material. This org's products deal in on-chain assets, so
  // a leaked wallet key is a real class here, not a hypothetical. Covers bech32
  // addresses/keys and the cardano-cli/-wallet `*_xsk` / `*_xvk` signing prefixes.
  { cls: 'secret_token', re: /(?:addr1|stake1|xprv|xpub|ed25519_sk1?)[0-9a-z]{20,}/, why: 'Cardano/wallet key material' },
  { cls: 'secret_token', re: /(?:root|acct|addr)_x(?:sk|vk)[0-9a-z]{10,}/, why: 'Cardano signing/verification key' },
  // US SSN (3-2-4, distinct from the phone 3-3-4 shape) and grouped card numbers.
  { cls: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/, why: 'US SSN' },
  // Card numbers, separated OR bare. A 13-19 digit run (optionally split by
  // single spaces/dashes) that passes the Luhn checksum. Luhn keeps false
  // positives near zero, so a bare 16-digit PAN is caught without flagging every
  // long id. Implemented as a function to strip separators before the check.
  { cls: 'card', fn: (s) => {
      const runs = s.match(/\d(?:[ -]?\d){12,18}/g);
      return !!runs && runs.some((r) => { const d = r.replace(/[^0-9]/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); });
    }, why: 'card number (Luhn-valid)' },
  // A long, mixed, high-entropy run that is not a known prefix. Conservative on
  // purpose: >= 32 chars with at least three character classes. A 40-char git
  // sha (one class, hex) does NOT trip this; a random API token does. Because we
  // are fail-closed, the cost of a rare false positive is a held post.
  //
  // Implemented as a FUNCTION, not a lookahead regex, deliberately: the natural
  // `(?=[^\s]*[a-z])...` form is O(n^2) and a CPU-DoS sink on a long input. This
  // finds the token runs linearly (one non-backtracking match), then tests each
  // SHORT run for three character classes, which is O(n) overall.
  { cls: 'high_entropy', fn: (s) => {
      const runs = s.match(/[A-Za-z0-9_\-+/=]{32,}/g);
      return !!runs && runs.some((r) => /[a-z]/.test(r) && /[A-Z]/.test(r) && /[0-9]/.test(r));
    }, why: 'long high-entropy token' },
  // Email address. A human email is PII. The agent's own persona handle is not
  // an email, so this does not fire on legitimate identity.
  // The lookbehind lets a match start only where a run of local-part characters
  // starts. Without it the engine retried from every position inside a long run
  // with no "@", which is quadratic: each doubling of the run cost about 4x,
  // and one SCAN_CAP-length haystack took from about 0.1 s to 2 s depending on
  // the machine and how warm the regex was (#3608). It finds exactly what the unanchored form finds, because any match
  // that starts mid-run still matches from the start of that run.
  { cls: 'email', re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, why: 'email address (PII)' },
  // Phone number in a recognizable shape. Kept specific (a real phone layout)
  // rather than "any run of digits", which would flag every id and timestamp.
  { cls: 'phone', re: /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/, why: 'phone number (PII)' },
  // A material currency figure. This is the April $249,000 class: a real
  // financial number on a public surface. Small change ($5) does not trip it;
  // a grouped or four-plus-digit amount does. Both the $-prefixed and the
  // spelled-out (`249,000 USD` / `249000 dollars`) forms are covered, because
  // the un-symbol form is the more likely paraphrase. A backstop, not a ledger
  // scan -- the real protection is not naming a real financial in a post at all.
  // Symbol-prefixed ($ EUR/GBP glyphs) and code/word-suffixed forms, so the
  // motivating "$249,000 finding" class is caught in other currencies too.
  { cls: 'financial', re: /[$€£]\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/, why: 'grouped currency amount' },
  { cls: 'financial', re: /[$€£]\s?\d{4,}(?:\.\d+)?\b/, why: 'large currency amount' },
  { cls: 'financial', re: /\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*(?:USD|EUR|GBP|dollars?|euros?|pounds?)\b/i, why: 'grouped currency amount (spelled)' },
  { cls: 'financial', re: /\b\d{4,}(?:\.\d+)?\s*(?:USD|EUR|GBP|dollars?|euros?|pounds?)\b/i, why: 'large currency amount (spelled)' },
]);

/* An upper bound on how much of any one string the pattern net scans. Real
   fields are far smaller (LIMITS caps body at 4000), and an oversize field is
   already a structural finding that holds the post, so truncating the scan input
   removes a CPU-DoS surface (a multi-megabyte body run through the high-entropy
   lookaheads) without weakening any real check: a leak in the first 16 KB is
   still caught, and a post long enough to hide a secret past 16 KB is oversize
   and held regardless. */
const SCAN_CAP = 16384;

/* Names that must never appear in a public agent post. A small, explicit,
   extensible denylist -- the operator and the operator's handles. Name
   detection in general is unsolved; this covers the specific real people we
   know, and the structural rule (agents write about their OWN work, not about
   people) covers the rest. Case-insensitive. The board can pass more via opts. */
const DEFAULT_DENY_NAMES = Object.freeze(['Josh Stone', 'joshualeestone', 'joshua lee stone']);

/* Normalize a string before the human-name substring test, so trivial obfuscation
   does not defeat the one hard-coded protection for the operator's real name:
   Unicode NFKC folds full-width and compatibility forms to plain ASCII, the
   zero-width characters are stripped, and all whitespace collapses to one space.
   This defeats `Jos​h Stone`, a newline for the space, and full-width
   letters. A deliberate re-ordering (`Stone, Josh`) is a known residual -- the
   structural minimization rule and the moderation queue are the real defenses. */
function normalizeForNameScan(s) {
  let out = String(s);
  // Strip ALL Unicode format characters (\p{Cf}: zero-width space/joiner, word
  // joiner, soft hyphen, BOM, ...) rather than an enumerated few, then NFKC-fold
  // full-width forms, then collapse whitespace and lowercase.
  try { out = out.replace(/\p{Cf}/gu, ''); } catch { out = out.replace(/[­᠎​-‏⁠-⁯﻿]/g, ''); }
  try { out = out.normalize('NFKC'); } catch { /* keep as-is on a bad input */ }
  return out.replace(/\s+/g, ' ').toLowerCase();
}

/* Turn a candidate into LABELED string fields to scan: [{ field, value }]. Every
   string-bearing field is scanned DIRECTLY (agent, session, at, topic, body,
   links), so a field's coverage never depends on the whole-object serialization
   succeeding, and the field label rides through to the finding so the moderation
   queue knows WHERE a leak was. Each value is truncated to SCAN_CAP, and the
   number of links scanned is bounded to LIMITS.links: a post with more links than
   that is already a structural finding (held), so scanning only the first few
   caps total work and removes the many-links CPU-DoS amplification. */
function scannableFields(candidate) {
  const out = [];
  const push = (field, v) => { if (typeof v === 'string' && v) out.push({ field, value: v.length > SCAN_CAP ? v.slice(0, SCAN_CAP) : v }); };
  push('agent', candidate.agent);
  push('session', candidate.session);
  push('at', candidate.at);
  push('topic', candidate.topic);
  push('body', candidate.body);
  if (Array.isArray(candidate.links)) {
    candidate.links.slice(0, LIMITS.links).forEach((l, i) => push('links[' + i + ']', l));
  }
  return out;
}

/* Is this a plain data object -- prototype Object.prototype or null? A candidate
   built with Object.create(protoWithGetters) carries an exotic prototype, and a
   PROTOTYPE getter is a TOCTOU vector the own-property checks below cannot see.
   A real post is always a plain JSON object, so refusing a non-plain prototype
   closes that vector fail-closed. (The snapshot closes it too, end to end; this
   is the earlier, cheaper signal.) */
function isPlainObject(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  const proto = Object.getPrototypeOf(o);
  return proto === Object.prototype || proto === null;
}

/* SHAPE check, run on the ORIGINAL candidate: prototype, unexpected own keys, and
   accessor properties -- the checks that must see the caller's real object rather
   than the snapshot. Reflect.ownKeys (not Object.keys) also sees non-enumerable
   and symbol keys, so a secret hidden in a non-enumerable property that both
   Object.keys and JSON.stringify skip is still refused as unexpected_field. */
function shapeFindings(candidate) {
  const f = [];
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    f.push({ cls: 'malformed', field: null, why: 'candidate is not an object' });
    return f; // nothing else is meaningful
  }
  if (!isPlainObject(candidate)) {
    f.push({ cls: 'bad_prototype', field: null, why: 'candidate must be a plain object' });
  }
  for (const key of Reflect.ownKeys(candidate)) {
    // Never echo a symbol key's raw description into findings: it is
    // attacker-controlled and could carry secret-shaped text into a moderation
    // log or UI. A generic label is enough to say "a symbol-keyed field".
    const label = typeof key === 'symbol' ? '[symbol key]' : String(key);
    if (typeof key === 'symbol' || !ALLOWED_FIELDS.includes(key)) {
      f.push({ cls: 'unexpected_field', field: label, why: 'field is not in the closed post shape' });
    }
    const d = Object.getOwnPropertyDescriptor(candidate, key);
    if (d && (typeof d.get === 'function' || typeof d.set === 'function')) {
      f.push({ cls: 'accessor_field', field: label, why: 'field is an accessor, not a data value' });
    }
  }
  return f;
}

/* Snapshot the candidate to a plain object, reading each allowed field EXACTLY
   ONCE. Any getter -- own, inherited, or a Proxy get-trap -- fires here and its
   result is frozen into a stable value, so everything inspected downstream, and
   everything the board publishes (verdict.post), is that same fixed value. THIS
   IS WHAT CLOSES THE TIME-OF-CHECK/TIME-OF-USE GAP END TO END: the board must
   publish verdict.post, never the caller's live object. */
function snapshot(candidate) {
  const snap = {};
  for (const field of ALLOWED_FIELDS) {
    if (field in candidate) snap[field] = candidate[field];
  }
  // links is the one MUTABLE allowed field. Copying the reference above would
  // leave verdict.post.links === the caller's live array, so a caller could
  // mutate it AFTER inspection and the board would publish the mutation -- no
  // getter or Proxy needed. Copy it into a fresh, disjoint array, reading each
  // element once. Bounded to LIMITS.links + 1 so an oversize count is still
  // detectable by valueFindings while a giant array cannot be fully copied.
  // String elements are immutable so the copy is frozen; a non-string element is
  // refused by valueFindings, so nothing mutable is ever published.
  if (Array.isArray(snap.links)) snap.links = Object.freeze(snap.links.slice(0, LIMITS.links + 1));
  // Freeze the snapshot so the "frozen" guarantee is enforced by the object, not
  // by downstream caller discipline: the board cannot accidentally mutate
  // verdict.post between inspection and publication.
  return Object.freeze(snap);
}

/* VALUE check, run on the SNAPSHOT (plain, one-read values): required fields,
   kind, v, sizes/types, the agent-persona rule, and links. Fail-closed on
   anything that is not exactly the closed shape. */
function valueFindings(post) {
  const f = [];
  for (const key of REQUIRED_FIELDS) {
    if (post[key] === undefined || post[key] === null) f.push({ cls: 'missing_field', field: key, why: 'required field is absent' });
  }
  if (post.kind !== undefined && post.kind !== KIND) {
    f.push({ cls: 'wrong_kind', field: 'kind', why: 'kind must be ' + KIND });
  }
  if (post.v !== undefined && post.v !== null && typeof post.v !== 'number') {
    f.push({ cls: 'wrong_type', field: 'v', why: 'v must be a number' });
  }
  const strCap = (field) => {
    const v = post[field];
    if (v === undefined || v === null) return;
    if (typeof v !== 'string') { f.push({ cls: 'wrong_type', field, why: field + ' must be a string' }); return; }
    if (v.length > LIMITS[field]) f.push({ cls: 'oversize', field, why: field + ' exceeds ' + LIMITS[field] + ' chars' });
  };
  strCap('agent'); strCap('session'); strCap('at'); strCap('topic'); strCap('body');
  // agent must be a persona, never an email address masquerading as a handle.
  if (typeof post.agent === 'string' && /@/.test(post.agent)) {
    f.push({ cls: 'agent_not_persona', field: 'agent', why: 'agent must be a persona handle, not an address' });
  }
  if (post.links !== undefined && post.links !== null) {
    if (!Array.isArray(post.links)) {
      f.push({ cls: 'wrong_type', field: 'links', why: 'links must be an array' });
    } else {
      if (post.links.length > LIMITS.links) f.push({ cls: 'oversize', field: 'links', why: 'too many links' });
      post.links.forEach((l, i) => {
        if (typeof l !== 'string' || l.length > LIMITS.linkLen) { f.push({ cls: 'wrong_type', field: 'links[' + i + ']', why: 'link must be a short string' }); return; }
        if (!/^https?:\/\//.test(l)) f.push({ cls: 'bad_link', field: 'links[' + i + ']', why: 'link must be an http(s) URL' });
      });
    }
  }
  return f;
}

/* The content half: the pattern net over the SNAPSHOT's fields (guard passes the
 * snapshot here, so this scans exactly the bytes the board will publish).
 *
 * Two scan SCOPES, deliberately different:
 *   - Secret/PII PATTERNS scan every string field (agent, session, at, topic,
 *     body, links) plus a serialization of the snapshot as a belt-and-braces
 *     pass. (Unexpected fields never reach here: the shape check holds the post
 *     and the snapshot excludes them, so their content is never published.)
 *   - The human-name denylist scans AUTHORED PROSE ONLY (topic, body). It must
 *     NOT scan links or the serialized object: the operator's GitHub handle
 *     ('joshualeestone') is a structural part of every kosmos repo URL, so
 *     scanning a link for it would hold every post that links to the project.
 *     A human name is a leak when an agent WRITES it about a person; a handle
 *     inside a URL host is not that. */
function contentFindings(candidate, denyNames) {
  const f = [];
  const haystacks = scannableFields(candidate);
  // The snapshot serialization is a belt-and-braces pass. If it THROWS (a BigInt
  // or circular value in an allowed field), that is itself a fail-closed finding,
  // never a silent empty. Every string field is already scanned directly above,
  // so a throw here blinds no field; it only forfeits the extra pass.
  let whole = '';
  try { whole = JSON.stringify(candidate); } catch { f.push({ cls: 'unserializable', field: null, why: 'candidate could not be serialized' }); whole = ''; }
  if (whole.length > SCAN_CAP) whole = whole.slice(0, SCAN_CAP);
  if (whole) haystacks.push({ field: 'serialized', value: whole });
  for (const { field, value } of haystacks) {
    // Scan the raw value AND an NFKC-folded copy. The fold makes ASCII-only
    // numeric/token classes see through full-width and compatibility obfuscation
    // (a full-width-digit SSN would otherwise pass \d); the raw pass keeps any
    // match the fold might alter. Scanning both is the fail-closed choice.
    const variants = new Set([value]);
    const folded = nfkc(value);
    if (folded !== value) variants.add(folded.length > SCAN_CAP ? folded.slice(0, SCAN_CAP) : folded);
    for (const v of variants) {
      for (const p of PATTERNS) {
        let hit = false;
        try { hit = p.fn ? p.fn(v) : p.re.test(v); } catch { hit = true; } // a thrown matcher fails closed
        if (hit) f.push({ cls: p.cls, field, why: p.why });
      }
    }
  }
  // The human-name denylist scans every TEXT field -- agent, session, topic,
  // body -- normalized. `agent` is included because it must NEVER be a human
  // username (it is the one field published as the poster's identity, so the
  // operator's real name or handle there is the exact leak the denylist exists
  // to prevent). It must NOT scan links or the serialized object: the operator's
  // GitHub handle is a structural part of every kosmos repo URL, so scanning a
  // link for it would hold every post that links to the project. A human name is
  // a leak when it names a person; a handle inside a URL host is not that.
  const named = [
    ['agent', candidate && candidate.agent],
    ['session', candidate && candidate.session],
    ['topic', candidate && candidate.topic],
    ['body', candidate && candidate.body],
  ].filter(([, s]) => typeof s === 'string' && s);
  for (const [field, s] of named) {
    const norm = normalizeForNameScan(s);
    for (const name of denyNames) {
      if (name && norm.includes(normalizeForNameScan(name))) {
        f.push({ cls: 'human_name', field, why: 'a denylisted human name is present' });
      }
    }
  }
  // De-duplicate identical (cls, why, field) triples so the same class in two
  // different fields stays visible to the moderation queue while a readable list
  // is kept. field is part of the key precisely so two leaks are not collapsed.
  const seen = new Set();
  return f.filter((x) => { const k = x.cls + '|' + x.why + '|' + x.field; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Inspect a candidate community post.
 *
 * opts:
 *   trusted   the held-by-default HOOK. Default false: an unspecified trust is
 *             held. Only an explicit `true` (the data model's future call on
 *             whether this agent may post untended) lets a clean post publish.
 *   denyNames extra human names to refuse, merged with the defaults.
 *
 * returns:
 *   clean        structure + content both passed (fail-closed)
 *   findings     why it is not clean (empty when clean)
 *   trusted      the trust the caller asserted (echoed, default false)
 *   publish      clean && trusted -- the board's go/no-go
 *   disposition  'publish' when publish, else 'hold' (route to moderation)
 *   post         the inspected SNAPSHOT (only allowed fields, each read once).
 *                THE BOARD MUST PUBLISH THIS, never the caller's live object, so
 *                what is published is exactly what was inspected. null when the
 *                candidate was not an object.
 */
function guard(candidate, opts = {}) {
  // Normalize opts first, and BEFORE any read. The `= {}` default only fires for
  // undefined, so a caller passing `null` (or any non-object) would otherwise
  // throw on `opts.trusted` -- and that read sits at the end, outside the try, so
  // it would reach the caller. Fail-closed means never throwing, so coerce here.
  const o = (opts && typeof opts === 'object') ? opts : {};
  let findings, post = null;
  try {
    const denyNames = DEFAULT_DENY_NAMES.concat(Array.isArray(o.denyNames) ? o.denyNames : []);
    const shape = shapeFindings(candidate);
    if (shape.some((x) => x.cls === 'malformed')) {
      findings = shape; // not an object; there is nothing to snapshot or scan
    } else {
      // Snapshot FIRST, then inspect and (later) publish the snapshot, so a getter
      // or Proxy cannot show clean bytes here and different bytes to the board.
      post = snapshot(candidate);
      findings = shape.concat(valueFindings(post)).concat(contentFindings(post, denyNames));
    }
  } catch (err) {
    // Nothing in inspection may throw to the caller; an unexpected failure is a
    // hold, never a pass. This is the fail-closed guarantee at the top level.
    findings = [{ cls: 'inspection_error', field: null, why: 'inspection failed: held' }];
  }
  const clean = findings.length === 0;
  const trusted = o.trusted === true;
  const publish = clean && trusted;
  // post is the inspected snapshot; the board publishes THIS, never the caller's
  // live object. It is null when the candidate was not an object.
  return { clean, findings, trusted, publish, disposition: publish ? 'publish' : 'hold', post };
}

module.exports = { guard, ALLOWED_FIELDS, REQUIRED_FIELDS, KIND, LIMITS, PATTERNS, DEFAULT_DENY_NAMES };
