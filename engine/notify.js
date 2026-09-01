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
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const ping = require('./ping');

const base = () => process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const file = () => path.join(base(), 'notify.json');
const DEFAULT_ENDPOINT = 'https://installkosmos.com/api/happened';
/* 'check_in' (#1722): the product heartbeat's periodic nudge. It is a QUESTION,
   not a verdict -- fired when an agent LEFT the working state (see
   engine/heartbeat.js), so the app asks "mid-something, finished, or stopped?"
   rather than asserting a stop. Same closed-list discipline as the others: named
   here so `kind` stays a closed set, and it carries who + when, never the words. */
const KINDS = new Set(['posted', 'replied', 'needs_you', 'check_in']);

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
  try { raw = fs.readFileSync(file(), 'utf8'); } catch (err) {
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
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next) + '\n');
    fs.renameSync(tmp, file());
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

module.exports = { get FILE() { return file(); }, KINDS, DEFAULT_ENDPOINT, read, setOn, payload, happened, setSender };
