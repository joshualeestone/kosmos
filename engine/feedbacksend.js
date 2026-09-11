'use strict';

/**
 * Sending the daily product-feedback report off the machine (kosmos#2037, the
 * TRANSMIT half of the loop).
 *
 * engine/feedback.js writes the report to the user's own disk unconditionally.
 * THIS is the separate, gated send layer that file names: it reads a day's
 * report, scrubs it, and POSTs it to the collector -- but only when the person
 * has opted in. Storing locally is always on; SENDING is the switch.
 *
 * The contract with the collector (kosmos#2246, Ice Cream Kitty) is exactly:
 *   POST <endpoint>  application/json
 *   { install, date, generated_at, body, consent: { given, version } }
 *   200 { ok: true, id: "<server-id>" }
 * payload() below is the single source of that shape; a test pins the keys so
 * the two sides cannot drift.
 *
 * 🛑 ON BY DEFAULT. Josh ruled #2037 default-checked-on ("baked in day one",
 * 2026-09-05), and the default flips ON in the SAME change that ships the
 * Settings > Automation opt-out switch and the board send trigger (#2013: a
 * default and its control are ONE decision, landed together). So a never-asked
 * machine SENDS its scrubbed daily report by default; the person opts OUT in
 * Settings. The install-time disclosure surface (a switch on the install flow's
 * Screen 6) is the immediate fast-follow (PR-C2). A present-but-UNREADABLE file
 * still fails to OFF, the safe direction for a body leaving the machine.
 *
 * 🔑 WHAT LEAVES IS SCRUBBED. feedback.js keeps home paths / project / agent
 * names on disk on purpose (useful to the user's own agent). The SEND path is
 * where that gets redacted: scrub() rewrites home paths to `~`, redacts this
 * install's agent/project/account names, AND (kosmos#1760) redacts credential
 * shapes -- provider keys, Bearer tokens, and labelled secret assignments -- so a
 * key quoted in a "what broke" report does not leave the box. It is NOT called
 * "anonymous" anywhere -- a body can still name a project, and #2037 forbids that
 * word on this data.
 *
 * 🛑 A SEND CAN NEVER BLOCK, SLOW, OR THROW INTO A CALLER. Every path is
 * fire-and-forget with a short timeout and every error is swallowed -- the
 * ping.js discipline, for the same reason: the person asked for a report to be
 * written, not for a network round-trip.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('./store');
const feedback = require('./feedback');
const projects = require('./projects');
const create = require('./create'); // for WORKERS_DIR, the one definition of the workers root

// #1856: route through the one data-root derivation (store.ROOT = dataRootFor),
// like ping/notify -- prod-inert when AGENT_WORKFORCE_DATA is unset.
const BASE = store.ROOT;
const FILE = path.join(BASE, 'feedbacksend.json');
const DEFAULT_ENDPOINT = 'https://installkosmos.com/api/feedback';

/**
 * The version tag of the opt-in copy the user agreed to. Sent inside `consent`
 * so the record is self-describing and a later wording change is traceable
 * server-side. Bump this whenever the disclosure copy changes.
 */
const CONSENT_VERSION = '2026-09-05';

let sender = null;   // tests inject; production uses global fetch
const endpoint = () => process.env.AGENT_WORKFORCE_FEEDBACK_URL || DEFAULT_ENDPOINT;

/**
 * The opt-in preference. A never-asked machine (no file) defaults ON, Josh's
 * ruling: the daily report is "baked in day one", a default-checked opt-in
 * (#2037/#2013, relayed by Splinter 2026-09-05, the launch's #1 feature). The
 * Settings switch is the opt-OUT and carries the disclosure copy; the
 * install-time disclosure checkbox is the immediate fast-follow (PR-C2).
 * A present-but-UNREADABLE file still fails to OFF (unlike the never-asked
 * default): it could be hiding an off we cannot see, and the only thing gated
 * here is a report body leaving the machine. Same split as ping.js.
 */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return { on: true, sent: null, ok: true };
    return { on: false, sent: null, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, sent: null, ok: false }; }
  if (!parsed || typeof parsed !== 'object') return { on: false, sent: null, ok: false };
  // `sent` is the date key (YYYY-MM-DD) of the last report the board actually
  // sent, the once-per-day dedup marker. A non-string is treated as never-sent.
  return { on: parsed.on === true, sent: typeof parsed.sent === 'string' ? parsed.sent : null, ok: true };
}

function write(patch) {
  const cur = read();
  // Preserve BOTH fields across a partial write: setOn must not wipe the `sent`
  // dedup marker, and markSent must not flip `on`. JSON.stringify drops an
  // undefined/null `sent` cleanly, so a never-sent file stays {on:...}.
  const next = { on: cur.on, ...(cur.sent ? { sent: cur.sent } : {}), ...patch };
  delete next.ok;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next) + '\n');
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

function setOn(on) {
  if (typeof on !== 'boolean') return { ok: false, because: 'that has to be on or off' };
  return write({ on });
}

/**
 * Rewrite absolute home paths to `~` so a report body does not carry an account
 * name off the machine. The generic macOS shape `/Users/<name>` is rewritten
 * first (so it covers ANY account a report might quote, not just this one),
 * then this machine's own home is rewritten too -- which matters off macOS
 * (CI / a non-/Users home) where the generic shape would not have matched.
 */
// #2037 (revision): the identifying names on THIS install -- every agent name,
// every project name, and the OS account name -- gathered so scrub() can redact
// them as a BACKSTOP. The primary defence is the author prompt itself, which
// tells the report writer not to include usernames, agent names or project
// names; this catches a slip. Every source is wrapped so a source that cannot
// be read contributes nothing and the send still goes (path-scrubbed, and the
// body was authored under the prompt rule) rather than throwing on a path that
// must never throw -- the same fail-soft the module's send layer keeps.
const NAME_MINLEN = 4; // shorter than this, a name is too likely a common word to redact safely
const NAME_STOP = new Set(['kosmos']); // the product is the report's SUBJECT, never identifying
function installNames() {
  const names = new Set();
  const add = (v) => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (t.length >= NAME_MINLEN && !NAME_STOP.has(t.toLowerCase())) names.add(t);
  };
  // Agents: every profile's display name and its on-disk key.
  try {
    for (const f of fs.readdirSync(store.PROFILES)) {
      if (!f.endsWith('.json')) continue;
      add(f.slice(0, -5));
      // One unreadable/garbled profile must not lose the display names of the rest.
      try { add(JSON.parse(fs.readFileSync(path.join(store.PROFILES, f), 'utf8')).displayName); } catch { /* skip this one */ }
    }
  } catch { /* no profiles dir yet: nothing to add */ }
  // Agents, also by their on-disk worker folder, so an agent whose profile write
  // failed but whose folder exists is still covered. A pure-tmux agent that
  // Kosmos never created or connected has neither a profile nor a folder and is
  // left to the prompt rule -- reading the live tmux roster here would make a
  // send path depend on tmux, which it must never do.
  try {
    for (const ent of fs.readdirSync(create.WORKERS_DIR, { withFileTypes: true })) {
      if (ent.isDirectory() && !ent.name.startsWith('.')) add(ent.name);
    }
  } catch { /* no workers dir yet: nothing to add */ }
  // Projects: each project's name (readAll throws UNREADABLE on a damaged file).
  try { for (const p of projects.readAll()) add(p && p.name); } catch { /* unreadable: nothing to add */ }
  // The OS account name, which can appear in a body without a leading path arm
  // ever matching it (the "user name" case beyond home paths).
  try { add(os.userInfo().username); } catch { /* no account info: nothing to add */ }
  // Longest first, so a name that CONTAINS another (e.g. "Mona Lisa" over "Mona")
  // is redacted before its fragment, and the fragment then finds nothing left.
  return [...names].sort((a, b) => b.length - a.length);
}

function scrub(text) {
  if (text == null) return '';
  let out = String(text);
  // Any macOS or Linux account home: /Users/<name> or /home/<name> -> ~. The
  // segment stops at the next / or whitespace or quote, so ONLY the home
  // segment is replaced and EVERY account is covered (not just this machine's)
  // -- a report can quote another agent's path, and that name must not leave
  // either.
  // CASE-INSENSITIVE on purpose (the `i` flag on every arm below). macOS and
  // Windows filesystems are case-insensitive, so a body can quote `/users/joe`
  // or `c:\users\joe` for a real path; a case-sensitive guard narrower than the
  // class it names becomes the leak it was meant to prevent. Over-scrubbing a
  // capitalized non-path token (`/Home/Dashboard`) is the safe direction.
  out = out.replace(/\/(?:Users|home)\/[^/\s"']+/gi, '~');
  // Windows account home: C:\Users\<name> -> ~. store.js carries a real win32
  // branch (roaming AppData), so Windows is a supported install target and a
  // backslash home path must be redacted too -- the POSIX arm above, being
  // forward-slash bound, never reaches it.
  out = out.replace(/[A-Za-z]:\\Users\\[^\\/\s"']+/gi, '~');
  // This machine's own home, for an exotic layout the shapes above miss (a
  // custom $HOME, /var/root, or a non-C:\Users Windows home). BOUNDED with a
  // lookahead (including a backslash) so a home that PREFIXES another dir is
  // not half-rewritten -- an unbounded substring replace turns /home/jo into ~
  // inside /home/joanna, corrupting the body and leaking a fragment.
  let home = null;
  try { home = os.homedir(); } catch { home = null; }
  if (home && !/^\/(?:Users|home)\//i.test(home) && !/^[A-Za-z]:\\Users\\/i.test(home)) {
    const esc = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc + '(?=[/\\\\\\s"\']|$)', 'gi'), '~');
  }
  // 🛑 ORDER (kosmos#1760 iter-6): home-path arms (above) -> SECRET arms
  // (next) -> install-NAME arm (END of this function). The name arm MUST run
  // last: if it ran before the secret arms, a project/agent literally named
  // "Token"/"Secret"/"Password" would have its LABEL redacted to [redacted]
  // first, leaving the labelled-assignment secret arm nothing to anchor on and
  // the credential VALUE in the clear. Full name-arm rationale + residuals are
  // documented at that arm at the end of the function.
  // #1760 (audit slice 15): redact SECRETS with the same belt-and-suspenders the
  // names get. The body answers "what bugs did you hit / what's broken / what
  // would help technically", which invites quoting an error, a log line, or a
  // config -- exactly where a live credential rides along. The author prompt now
  // forbids secrets too (roles.js); this is the backstop for a slip, since a
  // credential is the most catastrophic thing a body leaving the machine could
  // carry, and the one class the name/path arms above never touched. Over-
  // redaction is the safe direction (the same choice every arm above makes): a
  // feedback report is about what is rough, never about a literal token value,
  // so a `[redacted-secret]` where a secret-shaped string was costs it nothing.
  //
  // High-confidence provider shapes, each anchored on its OWN fixed prefix so a
  // normal English word can never match. `sk-` also carries a leading
  // non-alphanumeric lookbehind so "risk-management-strategy" (the 's' preceded
  // by 'i') cannot match "sk-management-strategy" inside it and corrupt prose --
  // the one prefix that is a common word-tail. A legitimate word-boundary
  // kebab identifier that happens to start `sk-` (e.g. "sk-button-primary-widget")
  // IS still swallowed; that is the documented over-redaction-is-safe direction,
  // not a bug -- a real credential must not survive because a UI class name might.
  // Stripe keys use `sk_`/`rk_` (underscore, not hyphen) so they need their own
  // arm; Stripe is Kosmos's payment provider, so a Stripe secret quoted in an
  // error is a realistic leak the OpenAI hyphen arm never reaches.
  //
  // This list is a DELIBERATELY CURATED SUBSET of high-frequency prefixes, NOT an
  // exhaustive credential catalogue -- chasing every provider is a treadmill and
  // the backstop's value does not require completeness. The author prompt is the
  // primary defence; a provider not listed here falls to the labelled-assignment
  // arm below and to that prompt. Add a prefix only when it is fixed and
  // high-entropy enough that it cannot match ordinary report prose.
  // EVERY prefix arm carries the same `(?<![A-Za-z0-9])` lookbehind, so none can
  // match mid-word (e.g. `gho_` inside "flagho_..." would otherwise redact "fla"
  // and corrupt the word). The name arm above documents this reasoning for `sk-`;
  // it applies uniformly here.
  const SECRET_PATTERNS = [
    /(?<![A-Za-z0-9])sk-(?:ant-)?[A-Za-z0-9_-]{16,}/g,            // OpenAI / Anthropic keys
    /(?<![A-Za-z0-9])[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g,      // Stripe secret / restricted keys
    /(?<![A-Za-z0-9])gh[posru]_[A-Za-z0-9]{20,}/g,               // GitHub classic tokens (ghp/gho/ghs/ghr/ghu)
    /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/g,             // GitHub fine-grained PAT
    /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{20,}/g,                      // npm access token
    /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}/g,                          // AWS access key id
    /(?<![A-Za-z0-9])ASIA[0-9A-Z]{16}/g,                          // AWS temporary access key id
    /(?<![A-Za-z0-9])AIza[A-Za-z0-9_-]{16,}/g,                    // Google API key
    /(?<![A-Za-z0-9])ya29\.[A-Za-z0-9_-]{20,}/g,                  // Google OAuth access token
    /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/gi,            // Slack bot/user/app tokens
    /(?<![A-Za-z0-9])xapp-[A-Za-z0-9-]{10,}/gi,                   // Slack app-level token
    /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, // three-segment JWT
  ];
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted-secret]');
  // A credential embedded in a URL's userinfo: `scheme://user:PASSWORD@host` (a
  // pasted DB connection string or curl URL, very common in a "what broke"
  // report). Keep scheme+user, redact the password before the `@`. The user part
  // is optional so `redis://:pass@host` is covered too.
  // 🛑 EVERY run here is BOUNDED (kosmos#1760 iter-7). An unbounded `*`/`+` before
  // a required terminator (`://`, `@`) is O(N^2) via backtracking, and scrub()
  // runs SYNCHRONOUSLY on the board's event loop over agent-authored free text
  // where a long dotted/hex run (a stack trace, a digest chain) or a long
  // no-`@` connection-string fragment is ordinary -- so an unbounded quantifier
  // would stall the board and break this module's "a send can never block"
  // invariant. Real schemes are <=32 chars and userinfo is short, so the caps
  // below never truncate a real credential.
  out = out.replace(/([a-z][a-z0-9+.-]{0,31}:\/\/[^\s:@/]{0,200}:)[^\s:@/]{1,200}@/gi, '$1[redacted-secret]@');
  // HTTP auth headers: keep the scheme word, redact the credential. `Bearer`
  // (JWT/opaque) ENDS on a non-`.`/`-` char so a trailing sentence period
  // ("...Bearer abc123. then") is given back, not eaten. `Basic` is base64
  // user:pass; its char class has no `.` so it stops at a period on its own. Both
  // use the non-alnum lookbehind idiom (not `\b`) for consistency with the arms above.
  out = out.replace(/(?<![A-Za-z0-9])(Bearer\s+)[A-Za-z0-9._~+/=-]{15,}[A-Za-z0-9_~+/=]/gi, '$1[redacted-secret]');
  out = out.replace(/(?<![A-Za-z0-9])(Basic\s+)[A-Za-z0-9+/]{15,}={0,2}/gi, '$1[redacted-secret]');
  // A labelled assignment `<label> = <value>`: keep the label + separator, redact
  // ONLY a >=8-char no-space value THAT LOOKS LIKE A CREDENTIAL. Four deliberate
  // parts:
  //   * The leading lookbehind is `(?<![A-Za-z0-9])` NOT `\b`: `\b` does not fire
  //     between `_` and a letter, so `client_secret=`, `access_token=`,
  //     `refresh_token:`, `api_secret=`, `private_key=` -- the exact snake_case
  //     shapes a config or .env quotes -- would slip through. The lookbehind lets
  //     a `_`/`-`/space/start precede the label, so those anchor on their trailing
  //     `secret`/`token`/`key`.
  //   * The separator group `(["']?\s*[:=]\s*["']?)` tolerates a quote on EITHER
  //     side, so a JSON body `"api_key": "value"` / `"token":"value"` -- the most
  //     common way a config or an API error is pasted into a report -- matches, not
  //     just the unquoted `token=value` form. The quotes are captured INTO $2 so
  //     they survive in the output; the value's own closing quote is left outside
  //     the match, so `"[redacted-secret]"` stays balanced.
  //   * The value carries a `(?=[^\s'"]*[0-9~=+\/])` requirement: it must contain
  //     a digit or a base64 symbol. `.` and `-` are DELIBERATELY EXCLUDED from this
  //     set even though a credential may contain them, because they are also
  //     ordinary prose: a sentence-final period ("token: undefined.") and a
  //     hyphenated word ("token: read-only", "not-found") would otherwise trip the
  //     guard and gut exactly the diagnostic bug-signal a report is FOR -- the word
  //     after the label is often the finding itself. A real credential essentially
  //     always carries a digit or a base64 symbol, or is caught by a provider arm
  //     above; the residual (a value of only letters/`.`/`-` with no digit or
  //     base64 symbol) falls to the author prompt, the primary defence.
  //   * The value class stops at `& , ;` as well as whitespace/quotes, so a query
  //     string ("token=abc123&email=x"), a comma list ("token=undefined,count=5")
  //     and a cookie/config chain ("session=x;token=def456;secure=1") each redact
  //     only their own secret param and leave the rest intact -- rather than one
  //     greedy match swallowing across the separators (kosmos#1760 iter-8). And
  //     the capture ENDS on a non-delimiter so trailing SENTENCE punctuation
  //     ("token=abc123.", "(token=abc123)") is given back, not eaten.
  //   * Every quantifier is BOUNDED (`{8}` existence gate, `{0,512}` scan + capture)
  //     so a multi-MB degenerate run in agent-authored free text cannot drive V8's
  //     regex to a stack overflow -- scrub() runs synchronously on the board event
  //     loop, so the same "no unbounded run" rule the URL arm follows applies here.
  //     512 is far above any real credential length.
  //   * Known residual, stated like the name arm states its own: a value with NO
  //     separator ("the token is abcd1234efgh") is not caught by this arm, and a
  //     generic all-letters credential (no digit/symbol) is not caught either.
  //     Both fall to the provider-shape arms above or to the author prompt, the
  //     primary defence -- this arm is the backstop, not the whole wall.
  out = out.replace(/(?<![A-Za-z0-9])(api[_-]?key|secret|token|password|passwd|key)(["']?\s*[:=]\s*["']?)(?=[^\s'"&,;]{8})(?=[^\s'"&,;]{0,512}[0-9~=+\/])([^\s'"&,;]{0,512}[^\s'"&,;.:!?()\[\]{}<>])/gi, '$1$2[redacted-secret]');
  // #2037 (revision): redact this install's identifying names as a backstop to the
  // author prompt -- AFTER the secret arms above (see the ordering note). Unicode-
  // aware lookarounds, not `\b`: `\b` fires only at ASCII, so an accented/CJK name
  // or one bordered by punctuation would leak. Longest-first (installNames sorts)
  // so a fragment cannot pre-empt a full name; a name that is also a common word is
  // over-redacted, the safe direction. Residuals (a name below NAME_MINLEN, a bare
  // fragment of a multi-word name, a normalization variant) fall to the prompt.
  for (const n of installNames()) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp('(?<![\\p{L}\\p{N}_])' + esc + '(?![\\p{L}\\p{N}_])', 'giu'), '[redacted]');
  }
  return out;
}

/** Parse `generated_at` out of a report's frontmatter header, or null. The
 *  field is the LAST line of the header, so match it WITHIN the `---`...`---`
 *  block rather than expecting more header after it (which never comes). */
function generatedAt(rawReport) {
  if (typeof rawReport !== 'string') return null;
  const fm = rawReport.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return null;
  const m = fm[1].match(/(?:^|\n)generated_at:\s*([^\n]+)/);
  return m ? m[1].trim() : null;
}

/**
 * The payload for a day, matching the #2246 collect contract EXACTLY. Returns
 * null when there is no report for that day (nothing to send). `consent.given`
 * is always true because a send only happens when the opt-in is on; the field
 * is kept explicit so the stored record is self-describing.
 */
function payload(date) {
  const d = date || feedback.today();
  const raw = feedback.read(d);
  if (raw == null) return null;
  let install = null;
  try { install = require('./ping').installId(); } catch { install = null; }
  return {
    install: install || 'unknown',
    date: d,
    generated_at: generatedAt(raw) || new Date().toISOString(),
    body: scrub(feedback.readBody(d)),
    consent: { given: true, version: CONSENT_VERSION },
  };
}

/**
 * 🛑 A TEST RUN MUST NEVER PHONE HOME. `NODE_TEST_CONTEXT` is set by node's own
 * test runner in every test process and by nothing else, so it cannot be true
 * for a real install and cannot be false for a test -- the same signal ping.js
 * settled on after keying on a data-path variable silently disabled telemetry.
 */
function underTest() {
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

/**
 * Send a day's report IF the person has opted in. Fire-and-forget: returns
 * nothing, so no future edit can make a report-write wait on the network. A
 * missing or down collector (including the 404 before the collect route ships)
 * loses nothing -- the report is already safe on disk.
 */
function maybeSend(date) {
  try {
    /* Only guard the REAL network. A test that injected its own sender touches
       no network, so guarding it there would make the send path untestable --
       ping.js's exact reasoning. */
    if (!sender && underTest()) return;
    if (!read().on) return;
    const data = payload(date);
    if (!data) return;   // no report for that day, nothing to send
    const post = sender || ((url, init) => fetch(url, init));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    Promise.resolve(post(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
      signal: ctl.signal,
    })).catch(() => { /* fire and forget: no collector, no problem */ })
      .finally(() => clearTimeout(timer));
  } catch { /* nothing here may reach the caller */ }
}

/**
 * The board-sweep entry point: send a day's report AT MOST ONCE, even though the
 * board calls this on a repeating timer. The short-lived `kosmos feedback` CLI
 * cannot fire-and-forget a send (it exits), so the long-lived board owns the
 * trigger (#2037 PR-C1). Dedup lives here, not in maybeSend, so the direct/test
 * callers of maybeSend keep their unguarded semantics.
 *
 * 🛑 MARK-SENT BEFORE THE POST, ON PURPOSE. The send is fire-and-forget, so a
 * failed POST cannot be observed here anyway; marking sent up front means a
 * down collector does not make the sweep re-POST every hour for the rest of the
 * day. It is a best-effort DAILY report - a missed day is lost, next day's
 * sends. Returns nothing (like maybeSend), so no caller can wait on it.
 */
function sendDailyOnce(date) {
  try {
    // Same guard maybeSend applies, but EARLIER so a test run does not even
    // record a `sent` marker for a send that the underTest guard will block.
    // Only when nothing has been injected: a test with its own sender is
    // exercising the real path and must be allowed to mark + send.
    if (!sender && underTest()) return;
    const d = date || feedback.today();
    const st = read();                    // one read for both gates, atomic within the tick
    if (!st.on) return;                   // opt-in gate (default ON; the person opts out in Settings)
    if (st.sent === d) return;            // already sent today
    if (feedback.read(d) == null) return; // no report for that day, nothing to mark or send
    // Mark first, and only send if the mark PERSISTED. If the setting-file write
    // fails (disk full/permission) we do NOT send: an unrecorded send would make
    // every hourly sweep re-POST the same day's report to the collector forever,
    // which is the exact failure this once-per-day guard exists to prevent. A
    // missed day (favouring not-sending) is the safe direction for a best-effort
    // daily report.
    if (!markSent(d).ok) return;
    maybeSend(d);
  } catch { /* nothing here may reach the caller */ }
}

function markSent(date) { return write({ sent: date }); }

/* Test hooks. Production never calls these. */
function setSender(f) { sender = f; }

module.exports = {
  FILE, read, setOn, write, scrub, payload, maybeSend, sendDailyOnce, markSent,
  setSender, underTest, DEFAULT_ENDPOINT, CONSENT_VERSION,
};
