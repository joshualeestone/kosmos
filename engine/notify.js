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

const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const FILE = path.join(BASE, 'notify.json');
const DEFAULT_ENDPOINT = 'https://installkosmos.com/api/happened';
const KINDS = new Set(['posted', 'replied', 'needs_you']);

let sender = null;
const endpoint = () => process.env.AGENT_WORKFORCE_NOTIFY_URL || DEFAULT_ENDPOINT;

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
    checked against it: no field here may ever carry a message's words. */
function payload({ kind, agent, project, at }) {
  return {
    installId: ping.installId(),
    kind,
    agent: String(agent || '').slice(0, 80),
    project: project ? String(project).slice(0, 120) : null,
    at: at || new Date().toISOString(),
  };
}

/** Say that something happened. Never throws, never awaited, never sends
    when off, never sends under test without an injected sender. */
function happened(event) {
  try {
    if (!event || !KINDS.has(event.kind)) return;
    if (!sender && ping.underTest()) return;
    if (!read().on) return;
    const body = JSON.stringify(payload(event));
    const post = sender || ((url, init) => fetch(url, init));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    Promise.resolve(post(endpoint(), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ctl.signal,
    })).catch(() => { /* fire and forget */ }).finally(() => clearTimeout(timer));
  } catch { /* nothing here may reach the caller */ }
}

function setSender(f) { sender = typeof f === 'function' ? f : null; }

module.exports = { FILE, KINDS, DEFAULT_ENDPOINT, read, setOn, payload, happened, setSender };
