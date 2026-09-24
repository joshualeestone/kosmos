'use strict';
/**
 * Phone notifications (#718). When the person has turned them on, the board
 * tells the Kosmos+ coordinator that an agent needs them or answered them, and
 * the coordinator pushes it to the phones they subscribed on its sign-in page
 * ("Notify me on this phone"). Josh, 2026-09-24: "100% the main reason we want
 * mobile apps is for push notifications."
 *
 * OFF UNTIL THE PERSON TURNS IT ON. Nothing is sent while off, and an
 * unreadable setting reads as off. This is not the "something happened" seam
 * deleted in #2623 (#2631): that sent to our own endpoint by default with the
 * install id. This sends only to the coordinator the Mac is already connected
 * to, only after a person asks, and with its own random id (`notifyId`), never
 * ping.installId(), which is promised never to leave the Mac.
 *
 * What leaves the Mac per event is exactly `payload()` below: the kind, the
 * agent's shown name, its session name, the project name when there is one, an
 * event id, the time, and notifyId. Never a message's words. The coordinator
 * adds the Mac's own address, which is where a tap on the phone opens.
 *
 * The notify-only token is minted at the coordinator's
 * POST /v1/mac/notify-credential through the tunnel binary (remote.macRequest),
 * because only the tunnel holds the Mac's key. It is kept owner-only in the
 * tunnel's state dir and can send events and nothing else.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');
const remote = require('./remote');

const KINDS = new Set(['needs_you', 'replied']);
const TOKEN_SHAPE = /^knt1_[A-Za-z0-9_-]{8,200}$/;
const NOTIFY_ROUTE = '/v1/mac/notify';
const CREDENTIAL_ROUTE = '/v1/mac/notify-credential';
const TIMEOUT_MS = 4000;
// The coordinator's caps (coordinator/src/notify.rs `caps`); it refuses anything over.
const CAPS = { id: 120, agent: 80, session: 80, project: 120 };

const file = () => path.join(remote.stateDir(), 'phone-notify.json');

/** { on, notifyId, token }. Missing file: off. Unreadable, unparseable or not a
    plain object: off. Only an explicit `on: true` is on. */
function readState() {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return { on: false, notifyId: null, token: null }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { on: false, notifyId: null, token: null };
  return {
    on: parsed.on === true,
    notifyId: typeof parsed.notifyId === 'string' ? parsed.notifyId : null,
    token: typeof parsed.token === 'string' && TOKEN_SHAPE.test(parsed.token) ? parsed.token : null,
  };
}

function writeState(next) {
  try {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, f);
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

/** What the Settings screen shows. Never the token. */
function status() {
  const s = readState();
  return { on: s.on, connected: remote.enrolled(), signinUrl: signinUrl() };
}

function signinUrl() {
  try { return new URL('/signin', remote.coordinator()).toString(); } catch { return null; }
}

/** Turn phone notifications on: mint the notify token if there is none yet,
    then save on. Refused, with nothing saved, when the Mac is not connected to
    Kosmos+ or the mint fails. */
async function turnOn() {
  if (!remote.enrolled()) {
    return { ok: false, because: 'connect this computer to Kosmos+ first, then turn phone notifications on' };
  }
  const s = readState();
  const notifyId = s.notifyId || crypto.randomUUID();
  let token = s.token;
  if (!token) {
    const minted = await remote.macRequest('POST', CREDENTIAL_ROUTE, { install_id: notifyId });
    if (!minted.ok) return { ok: false, because: 'Kosmos+ did not answer: ' + minted.because };
    token = minted.data && typeof minted.data.token === 'string' ? minted.data.token : '';
    if (!TOKEN_SHAPE.test(token)) return { ok: false, because: 'Kosmos+ answered in a shape we could not use' };
  }
  const saved = writeState({ on: true, notifyId, token });
  if (!saved.ok) return saved;
  return { ok: true };
}

/** Turn them off. The token is kept so turning back on needs no new mint; it
    can only send events, and nothing is sent while off. */
function turnOff() {
  const s = readState();
  return writeState({ on: false, notifyId: s.notifyId, token: s.token });
}

const cap = (v, n) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, n));

function payload(notifyId, { kind, id, agent, session, project }) {
  return {
    installId: notifyId,
    id: cap(id, CAPS.id),
    kind,
    agent: String(agent || 'An agent').slice(0, CAPS.agent),
    session: cap(session, CAPS.session),
    project: cap(project, CAPS.project),
    at: new Date().toISOString(),
  };
}

// Test seam: (url, headers, body) => void. Without one, node --test never dials.
let sender = null;
function setSender(fn) { sender = typeof fn === 'function' ? fn : null; }

function defaultSend(url, headers, body) {
  const u = new URL(url);
  const req = (u.protocol === 'http:' ? http : https).request(
    { method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname,
      headers: { ...headers, 'content-length': Buffer.byteLength(body) }, timeout: TIMEOUT_MS, agent: false },
    (res) => { res.resume(); },
  );
  req.on('error', () => {});
  req.on('timeout', () => { try { req.destroy(); } catch { /* gone */ } });
  req.end(body);
}

/** Tell the coordinator something happened. Never throws, never awaited. Sends
    only when on, connected, holding a token, and the kind is one we send. */
function happened(event) {
  try {
    if (!event || !KINDS.has(event.kind)) return;
    if (!sender && process.env.NODE_TEST_CONTEXT) return;
    const s = readState();
    if (!s.on || !s.token || !s.notifyId) return;
    if (!remote.enrolled()) return;
    const base = new URL(remote.coordinator());
    const url = new URL(base.pathname.replace(/\/+$/, '') + NOTIFY_ROUTE, base).toString();
    const body = JSON.stringify(payload(s.notifyId, event));
    (sender || defaultSend)(url, { 'content-type': 'application/json', 'x-kosmos-notify-token': s.token }, body);
  } catch { /* a notification is never a reason to fail the report it rides on */ }
}

module.exports = { KINDS, status, turnOn, turnOff, happened, payload, setSender, readState };
