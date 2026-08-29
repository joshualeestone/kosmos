'use strict';
/**
 * The outbound "something happened" call: the seam a phone notification will
 * ride on (Josh, 2026-08-23 1:34 PM: "an outbound ping whenever an agent
 * posts something... we would know to push a push notification on a
 * smartphone app. That would be something we should think about
 * architecturally as we're building it").
 *
 * 🔑 THE SHAPE IS DECIDED NOW SO THE WEB VERSION AND THE APP DO NOT FIGHT
 * LATER. One POST per event, fire and forget, to an endpoint that today is
 * nobody's (off by default, and the relay that will answer it does not exist
 * yet). The payload carries WHO and WHAT and WHEN and never the words: the
 * agent's name, the kind of event, the project's name when there is one, the
 * time, and this install's random id. The words stay on the Mac; the phone
 * fetches them from the Mac when it is opened.
 *
 * ⚠️ THE SAME HONESTY RULE AS THE CREATED PING (#331): off by default, one
 * switch in Settings whose copy says exactly what leaves the Mac, and a
 * sentence that stays true if the endpoint changes. Same seams as ping.js
 * (a sender tests inject; a refusal to send under test with no sender) so a
 * suite never reaches the internet and the send path stays testable.
 *
 * Events today, both from the record the board already keeps:
 *   'posted'   an agent posted in a project room (not the person's own post)
 *   'replied'  an agent answered in the person's own thread with it
 * 'needs_you' is the next one and needs the state transition, not a write;
 * it is named here so the payload's `kind` is a closed list from the start.
 *
 * ⚠️ AND ALMOST NO PRODUCER OF THIS TRANSITION IS THE AGENT'S OWN JUDGEMENT.
 * Two things produce it in practice -- the pane reader, whose verdict is
 * composed in `status.classify` at read time and is never written anywhere
 * (`reconcileReport` is where that verdict is given precedence over a report,
 * a different step), and the PermissionRequest hook, which does write a
 * self-report on an agent's behalf. Neither is an agent deciding it needs a
 * person. A working agent has typed it, but only just: "almost" is doing real
 * work in that sentence, and the record also holds a run of them from
 * walkthrough fixtures, which are not colleagues.
 * ⇒ They are not the same QUALITY of event either, and that matters here more
 * than anywhere: a permission box is a real machine event and a genuine
 * person-blocker, while a scraped one is an inference about what a screen
 * looked like. So a ping wired to this kind would carry a mixture of the two,
 * which is a weaker claim than the other two kinds make and is worth saying
 * before the relay exists rather than after.
 * 📌 NO COUNTS HERE, AND THAT IS NOW TRUE RATHER THAN ASSERTED: an earlier
 * version of this block claimed "no number here on purpose" while carrying
 * three of them eleven lines above the claim. The measurement and the argument
 * live at `status.js` rule 3, which is the copy to PREFER because it carries a
 * snapshot clock time. It is NOT the only copy, and rule 3 names the others;
 * re-run them with `node tools/needs-you-source.js`.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const ping = require('./ping');

const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const FILE = path.join(BASE, 'notify.json');
const DEFAULT_ENDPOINT = 'https://installkosmos.com/api/happened';
const KINDS = new Set(['posted', 'replied', 'needs_you']);

let sender = null;
const endpoint = () => process.env.AGENT_WORKFORCE_NOTIFY_URL || DEFAULT_ENDPOINT;

/* The notify-only credential the coordinator mints per Mac (#462). Read from a
   seam the client fills, exactly as the endpoint is (the launcher exports it,
   wherever the client stored the minted value). Deliberately NOT the Mac's
   identity key: one credential per power, so a leaked notify token can send
   noisy events and never touch standing. Absent today, because the endpoint is
   still our own /api/happened, which wants no token; present the day it points
   at the relay's POST /v1/mac/notify, which requires x-kosmos-notify-token. */
const notifyToken = () => process.env.AGENT_WORKFORCE_NOTIFY_TOKEN || '';

/** Off until somebody turns it on: there is nothing on the other end yet. */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { on: false, ok: true };
    return { on: false, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, ok: false }; }
  if (!parsed || typeof parsed !== 'object') return { on: false, ok: false };
  return { on: parsed.on === true, ok: true };
}
function write(patch) {
  const next = { ...read(), ...patch };
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

/** What leaves the Mac. Exported so the test and the Settings copy can be
    checked against it: no field here may ever carry a message's words.
      installId  this install's random id (the created ping's; read here
                 through ping.installId, which mints and stores it on first
                 use, the one cross-feature write, and the same id the
                 created ping sends so one Mac is one install on both)
      id         the event's own key (a post's message id; a reply's
                 agent-plus-time), so a coordinator can de-duplicate and a
                 phone can ask the Mac for this one; null when there is none
      kind       one of KINDS
      agent      the agent's shown name, for the notification's words
      session    the agent's session name, the key the Mac's routes use
      project    the project's name, or null
      at         when */
function payload({ kind, id, agent, session, project, at }) {
  return {
    installId: ping.installId(),
    id: id ? String(id).slice(0, 120) : null,
    kind,
    agent: String(agent || '').slice(0, 80),
    session: session ? String(session).slice(0, 80) : null,
    project: project ? String(project).slice(0, 120) : null,
    at: at || new Date().toISOString(),
  };
}

/** Say that something happened. Never throws, never awaited, never sends
    when off, never sends under test without an injected sender. */
function happened(event) {
  try {
    /* An unknown kind is a caller's typo, and a silent drop is a notification
       that never comes with no symptom. It is said once to the board's log
       (stderr, which launchd keeps) and dropped; a throw here would be
       swallowed by the catch below and be the same silence. */
    if (!event || !KINDS.has(event.kind)) {
      process.stderr.write('notify: unknown kind ' + JSON.stringify(event && event.kind) + ', not sent\n');
      return;
    }
    if (!sender && ping.underTest()) return;
    if (!read().on) return;
    const body = JSON.stringify(payload(event));
    const post = sender || ((url, init) => fetch(url, init));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    /* #462: the notify-only token when the client has configured one, and
       nothing extra when it has not. Today the endpoint is our own
       /api/happened and no token is set, so this adds no header and the
       request is byte-for-byte what it was; the header appears the day the
       endpoint becomes the relay's POST /v1/mac/notify, which requires it. */
    const headers = { 'content-type': 'application/json' };
    const token = notifyToken();
    if (token) headers['x-kosmos-notify-token'] = token;
    let p;
    try { p = Promise.resolve(post(endpoint(), { method: 'POST', headers, body, signal: ctl.signal })); }
    catch (err) { clearTimeout(timer); throw err; }
    p.catch(() => { /* fire and forget */ }).finally(() => clearTimeout(timer));
  } catch { /* nothing here may reach the caller */ }
}

function setSender(f) { sender = typeof f === 'function' ? f : null; }

module.exports = { FILE, KINDS, DEFAULT_ENDPOINT, read, setOn, payload, happened, setSender };
