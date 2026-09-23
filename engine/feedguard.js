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
 * go/no-go.
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

/* Size caps. A cap is a cheap structural defense: an enormous body is both a
   denial-of-space risk and a place to bury a payload. These are deliberately
   generous for real narrative posts and firm enough to refuse a blob. */
const LIMITS = Object.freeze({ agent: 80, session: 80, topic: 120, body: 4000, links: 8, linkLen: 2048 });

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
  { cls: 'secret_token', re: /AKIA[0-9A-Z]{16}/, why: 'AWS access key id' },
  { cls: 'secret_token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/, why: 'Slack token' },
  { cls: 'secret_token', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, why: 'PEM private key' },
  // Cardano / wallet material. This org's products deal in on-chain assets, so
  // a leaked wallet key is a real class here, not a hypothetical.
  { cls: 'secret_token', re: /(?:addr1|stake1|xprv|xpub|ed25519_sk1?)[0-9a-z]{20,}/, why: 'Cardano/wallet key material' },
  // A long, mixed, high-entropy run that is not a known prefix. Conservative on
  // purpose: >= 32 chars with at least three character classes. A 40-char git
  // sha (one class, hex) does NOT trip this; a random API token does. Because we
  // are fail-closed, the cost of a rare false positive is a held post. The scan
  // input is length-capped (see contentFindings) so the lookaheads cannot become
  // a CPU sink on a huge body.
  { cls: 'high_entropy', re: /(?=[^\s]*[a-z])(?=[^\s]*[A-Z])(?=[^\s]*[0-9])[A-Za-z0-9_\-+/=]{32,}/, why: 'long high-entropy token' },
  // Email address. A human email is PII. The agent's own persona handle is not
  // an email, so this does not fire on legitimate identity.
  { cls: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, why: 'email address (PII)' },
  // Phone number in a recognizable shape. Kept specific (a real phone layout)
  // rather than "any run of digits", which would flag every id and timestamp.
  { cls: 'phone', re: /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/, why: 'phone number (PII)' },
  // A material currency figure. This is the April $249,000 class: a real
  // financial number on a public surface. Small change ($5) does not trip it;
  // a grouped or four-plus-digit amount does. Both the $-prefixed and the
  // spelled-out (`249,000 USD` / `249000 dollars`) forms are covered, because
  // the un-symbol form is the more likely paraphrase. A backstop, not a ledger
  // scan -- the real protection is not naming a real financial in a post at all.
  { cls: 'financial', re: /(?:USD\s?)?\$\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/, why: 'grouped currency amount' },
  { cls: 'financial', re: /\$\s?\d{4,}(?:\.\d+)?\b/, why: 'large currency amount' },
  { cls: 'financial', re: /\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*(?:USD|dollars?)\b/i, why: 'grouped currency amount (spelled)' },
  { cls: 'financial', re: /\b\d{4,}(?:\.\d+)?\s*(?:USD|dollars?)\b/i, why: 'large currency amount (spelled)' },
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

/* Turn a candidate into the list of string fields to scan. Every string-bearing
   field is scanned DIRECTLY here (agent, session, at, topic, body, links), so a
   field's coverage never depends on the whole-object serialization succeeding.
   contentFindings ADDS the serialization on top, as defense in depth for a
   secret buried in an unexpected field -- but the serialization is never the
   ONLY scan any field gets. Each value is truncated to SCAN_CAP. */
function scannableStrings(candidate) {
  const out = [];
  const push = (v) => { if (typeof v === 'string' && v) out.push(v.length > SCAN_CAP ? v.slice(0, SCAN_CAP) : v); };
  push(candidate.agent);
  push(candidate.session);
  push(candidate.at);
  push(candidate.topic);
  push(candidate.body);
  if (Array.isArray(candidate.links)) candidate.links.forEach(push);
  return out;
}

/* The structural half: the minimization contract. Fail-closed on anything that
   is not exactly the closed shape. Returns findings (empty when the shape is
   clean). */
function structuralFindings(candidate) {
  const f = [];
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    f.push({ cls: 'malformed', field: null, why: 'candidate is not an object' });
    return f; // nothing else is meaningful
  }
  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_FIELDS.includes(key)) f.push({ cls: 'unexpected_field', field: key, why: 'field is not in the closed post shape' });
  }
  for (const key of REQUIRED_FIELDS) {
    if (candidate[key] === undefined || candidate[key] === null) f.push({ cls: 'missing_field', field: key, why: 'required field is absent' });
  }
  if (candidate.kind !== undefined && candidate.kind !== KIND) {
    f.push({ cls: 'wrong_kind', field: 'kind', why: 'kind must be ' + KIND });
  }
  // `v` must be a plain number. This is minimization AND a fail-closed guard: an
  // exotic value here (a BigInt) is what makes JSON.stringify throw, which is the
  // path a leak could ride if serialization were a field's only scan. It is not
  // (scannableStrings scans every field directly), but refusing a non-number v
  // closes the throw at its source too.
  if (candidate.v !== undefined && candidate.v !== null && typeof candidate.v !== 'number') {
    f.push({ cls: 'wrong_type', field: 'v', why: 'v must be a number' });
  }
  const strCap = (field) => {
    const v = candidate[field];
    if (v === undefined || v === null) return;
    if (typeof v !== 'string') { f.push({ cls: 'wrong_type', field, why: field + ' must be a string' }); return; }
    if (v.length > LIMITS[field]) f.push({ cls: 'oversize', field, why: field + ' exceeds ' + LIMITS[field] + ' chars' });
  };
  strCap('agent'); strCap('session'); strCap('topic'); strCap('body');
  // agent must be a persona, never an email address masquerading as a handle.
  if (typeof candidate.agent === 'string' && /@/.test(candidate.agent)) {
    f.push({ cls: 'agent_not_persona', field: 'agent', why: 'agent must be a persona handle, not an address' });
  }
  if (candidate.links !== undefined && candidate.links !== null) {
    if (!Array.isArray(candidate.links)) {
      f.push({ cls: 'wrong_type', field: 'links', why: 'links must be an array' });
    } else {
      if (candidate.links.length > LIMITS.links) f.push({ cls: 'oversize', field: 'links', why: 'too many links' });
      candidate.links.forEach((l, i) => {
        if (typeof l !== 'string' || l.length > LIMITS.linkLen) { f.push({ cls: 'wrong_type', field: 'links[' + i + ']', why: 'link must be a short string' }); return; }
        if (!/^https?:\/\//.test(l)) f.push({ cls: 'bad_link', field: 'links[' + i + ']', why: 'link must be an http(s) URL' });
      });
    }
  }
  return f;
}

/* The content half: the pattern net over the authored strings.
 *
 * Two scan SCOPES, deliberately different:
 *   - Secret/PII PATTERNS scan every authored string (topic, body, links) AND a
 *     serialization of the whole candidate, because a key is a leak wherever it
 *     hides, including a link or an unexpected field.
 *   - The human-name denylist scans AUTHORED PROSE ONLY (topic, body). It must
 *     NOT scan links or the serialized object: the operator's GitHub handle
 *     ('joshualeestone') is a structural part of every kosmos repo URL, so
 *     scanning a link for it would hold every post that links to the project.
 *     A human name is a leak when an agent WRITES it about a person; a handle
 *     inside a URL host is not that. */
function contentFindings(candidate, denyNames) {
  const f = [];
  const strings = scannableStrings(candidate);
  // The whole-object serialization is defense in depth for a secret buried in an
  // unexpected field. If it THROWS (e.g. a BigInt or a circular reference in an
  // allowed-but-untyped field), that is itself a fail-closed finding -- never a
  // silent empty that would drop this extra scan. The per-field scans above have
  // already covered every string field directly, so a throw here does not blind
  // any field; it only forfeits the belt-and-braces pass, and we hold the post.
  let whole = '';
  try { whole = JSON.stringify(candidate); } catch { f.push({ cls: 'unserializable', field: null, why: 'candidate could not be serialized' }); whole = ''; }
  if (whole.length > SCAN_CAP) whole = whole.slice(0, SCAN_CAP);
  const patternHaystacks = strings.concat(whole ? [whole] : []);
  for (const s of patternHaystacks) {
    for (const p of PATTERNS) {
      let hit = false;
      try { hit = p.re.test(s); } catch { hit = true; } // a thrown regex fails closed
      if (hit) f.push({ cls: p.cls, field: null, why: p.why });
    }
  }
  const prose = [candidate && candidate.topic, candidate && candidate.body].filter((s) => typeof s === 'string' && s);
  for (const s of prose) {
    for (const name of denyNames) {
      if (name && s.toLowerCase().includes(String(name).toLowerCase())) {
        f.push({ cls: 'human_name', field: null, why: 'a denylisted human name is present' });
      }
    }
  }
  // De-duplicate identical (cls, why) pairs so a finding list stays readable.
  const seen = new Set();
  return f.filter((x) => { const k = x.cls + '|' + x.why; if (seen.has(k)) return false; seen.add(k); return true; });
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
 */
function guard(candidate, opts = {}) {
  let findings;
  try {
    const denyNames = DEFAULT_DENY_NAMES.concat(Array.isArray(opts.denyNames) ? opts.denyNames : []);
    findings = structuralFindings(candidate).concat(contentFindings(candidate, denyNames));
  } catch (err) {
    // Nothing in inspection may throw to the caller; an unexpected failure is a
    // hold, never a pass. This is the fail-closed guarantee at the top level.
    findings = [{ cls: 'inspection_error', field: null, why: 'inspection failed: held' }];
  }
  const clean = findings.length === 0;
  const trusted = opts.trusted === true;
  const publish = clean && trusted;
  return { clean, findings, trusted, publish, disposition: publish ? 'publish' : 'hold' };
}

module.exports = { guard, ALLOWED_FIELDS, REQUIRED_FIELDS, KIND, LIMITS, PATTERNS, DEFAULT_DENY_NAMES };
