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
 * 🛑 OFF BY DEFAULT, FOR NOW. Josh ruled #2037 default-checked-on, but a
 * default-on phone-home with no off-switch is the exact harm #2020 documents.
 * The default flips ON in the same change that ships the Settings/setup control
 * (#2013: a default and its control are ONE decision). Until that control
 * exists, read() fails to OFF and nothing leaves the machine.
 *
 * 🔑 WHAT LEAVES IS SCRUBBED. feedback.js keeps home paths / project / agent
 * names on disk on purpose (useful to the user's own agent). The SEND path is
 * where that gets redacted: scrub() rewrites home paths to `~` so what leaves
 * is de-identified. It is NOT called "anonymous" anywhere -- a body can still
 * name a project, and #2037 forbids that word on this data.
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
 * The opt-in preference. Fails to OFF, like ping/notify: an absent file means
 * nobody has turned it on yet (and the default is off until the control ships);
 * a present-but-unreadable file could be hiding an off we cannot see, and the
 * only thing gated here is data leaving the machine.
 */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return { on: false, ok: true };
    return { on: false, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, ok: false }; }
  if (!parsed || typeof parsed !== 'object') return { on: false, ok: false };
  return { on: parsed.on === true, ok: true };
}

function write(patch) {
  const cur = read();
  const next = { on: cur.on, ...patch };
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
function scrub(text) {
  if (text == null) return '';
  let out = String(text);
  // Any macOS or Linux account home: /Users/<name> or /home/<name> -> ~. The
  // segment stops at the next / or whitespace or quote, so ONLY the home
  // segment is replaced and EVERY account is covered (not just this machine's)
  // -- a report can quote another agent's path, and that name must not leave
  // either.
  out = out.replace(/\/(?:Users|home)\/[^/\s"']+/g, '~');
  // Windows account home: C:\Users\<name> -> ~. store.js carries a real win32
  // branch (roaming AppData), so Windows is a supported install target and a
  // backslash home path must be redacted too -- the POSIX arm above, being
  // forward-slash bound, never reaches it.
  out = out.replace(/[A-Za-z]:\\Users\\[^\\/\s"']+/g, '~');
  // This machine's own home, for an exotic layout the shapes above miss (a
  // custom $HOME, /var/root, or a non-C:\Users Windows home). BOUNDED with a
  // lookahead (including a backslash) so a home that PREFIXES another dir is
  // not half-rewritten -- an unbounded substring replace turns /home/jo into ~
  // inside /home/joanna, corrupting the body and leaking a fragment.
  let home = null;
  try { home = os.homedir(); } catch { home = null; }
  if (home && !/^\/(?:Users|home)\//.test(home) && !/^[A-Za-z]:\\Users\\/.test(home)) {
    const esc = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc + '(?=[/\\\\\\s"\']|$)', 'g'), '~');
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

/* Test hooks. Production never calls these. */
function setSender(f) { sender = f; }

module.exports = {
  FILE, read, setOn, write, scrub, payload, maybeSend, setSender, underTest,
  DEFAULT_ENDPOINT, CONSENT_VERSION,
};
