'use strict';
/**
 * Phone notifications (#718). When the person has turned them on, the board
 * tells the Kosmos+ coordinator that an agent needs them or answered them, and
 * the coordinator pushes it to their phones through the Kosmos phone app (Josh,
 * 2026-09-24: apps only). Josh, 2026-09-24: "100% the main reason we want
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
// The coordinator's caps in UTF-8 BYTES (coordinator/src/notify.rs `caps`, Rust
// String::len); it refuses anything over, so capping by characters would drop a
// non-ASCII name silently.
const CAPS = { id: 120, agent: 80, session: 80, project: 120 };
// At most one needs_you buzz per agent per this long: permission prompts file a
// needs_you each, and a busy session would otherwise buzz on every one.
const NEEDS_YOU_COOLDOWN_MS = 5 * 60 * 1000;

const file = () => path.join(remote.stateDir(), 'phone-notify.json');

/** A coordinator URL for `route`, keeping a self-hosted path prefix
    (https://h/kosmos -> https://h/kosmos/<route>). The one derivation. */
function coordinatorUrl(route) {
  const base = new URL(remote.coordinator());
  return new URL(base.pathname.replace(/\/+$/, '') + route, base).toString();
}

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
  return { on: s.on, connected: remote.enrolled() };
}

/** Turn phone notifications on: mint a fresh notify token (minting replaces
    any earlier one at the coordinator, so a token it no longer knows is never
    reused), then save on. One turn-on at a time: two at once would each mint and
    could save the token the coordinator had already replaced. Refused, with
    nothing saved, when this computer is not connected to Kosmos+ or the mint
    fails. */
let turningOn = null;
function turnOn() {
  if (!turningOn) turningOn = doTurnOn().finally(() => { turningOn = null; });
  return turningOn;
}
async function doTurnOn() {
  if (!remote.enrolled()) {
    return { ok: false, because: 'connect this computer to Kosmos+ first, then turn phone notifications on' };
  }
  const s = readState();
  const notifyId = s.notifyId || crypto.randomUUID();
  const minted = await remote.macRequest('POST', CREDENTIAL_ROUTE, { install_id: notifyId });
  if (!minted.ok) {
    if (/unrecognized subcommand|mac-request/.test(String(minted.because || ''))) {
      return { ok: false, because: 'Kosmos on this computer needs an update before phone notifications can be turned on' };
    }
    // The raw reason goes to the board's log; the person gets a sentence.
    process.stderr.write('phonenotify: turning on failed: ' + String(minted.because || '') + '\n');
    return { ok: false, because: 'Kosmos+ could not be reached just now. Try again in a minute.' };
  }
  const token = minted.data && typeof minted.data.token === 'string' ? minted.data.token : '';
  if (!TOKEN_SHAPE.test(token)) return { ok: false, because: 'Kosmos+ answered in a shape we could not use' };
  return writeState({ on: true, notifyId, token });
}

/** Turn them off. Nothing is sent while off. The token is kept on disk (it can
    only send events), and turning on again mints a new one anyway. Waits for a
    turn-on in flight, so that turn-on cannot save `on` over this. */
async function turnOff() {
  if (turningOn) { try { await turningOn; } catch { /* its outcome does not matter here */ } }
  const s = readState();
  return writeState({ on: false, notifyId: s.notifyId, token: s.token });
}

/** `v` cut to at most `n` UTF-8 bytes, never inside a character. */
function capBytes(v, n) {
  let out = '';
  let used = 0;
  for (const ch of String(v)) {
    const size = Buffer.byteLength(ch);
    if (used + size > n) break;
    out += ch;
    used += size;
  }
  return out;
}
const cap = (v, n) => (v === null || v === undefined || v === '' ? null : capBytes(v, n));

function payload(notifyId, { kind, id, agent, session, project }) {
  return {
    installId: notifyId,
    id: cap(id, CAPS.id),
    kind,
    agent: capBytes(agent || 'An agent', CAPS.agent),
    session: cap(session, CAPS.session),
    project: cap(project, CAPS.project),
    at: new Date().toISOString(),
  };
}

// Test seams: (url, headers, body) => void, and a clock. Without an injected
// sender, node --test never dials.
let sender = null;
function setSender(fn) { sender = typeof fn === 'function' ? fn : null; }
let clock = () => Date.now();
function setClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }
const lastNeedsYou = new Map();   // session -> when its last needs_you was sent

function defaultSend(url, headers, body) {
  const u = new URL(url);
  const req = (u.protocol === 'http:' ? http : https).request(
    { method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname,
      headers: { ...headers, 'content-length': Buffer.byteLength(body) }, timeout: TIMEOUT_MS, agent: false },
    (res) => {
      // A refused send stops notifications with no other symptom, so say so in
      // the board's log (never the token or the payload).
      if (res.statusCode < 200 || res.statusCode >= 300) {
        process.stderr.write('phonenotify: Kosmos+ answered ' + res.statusCode + ' to a notification\n');
      }
      res.resume();
    },
  );
  req.on('error', (err) => {
    process.stderr.write('phonenotify: could not reach Kosmos+: ' + ((err && err.code) || 'error') + '\n');
  });
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
    if (event.kind === 'needs_you') {
      const key = String(event.session || event.agent || '');
      const now = clock();
      const last = lastNeedsYou.get(key);
      if (last !== undefined && now - last < NEEDS_YOU_COOLDOWN_MS) return;
      if (lastNeedsYou.size > 500) {
        for (const [k, t] of lastNeedsYou) if (now - t >= NEEDS_YOU_COOLDOWN_MS) lastNeedsYou.delete(k);
      }
      lastNeedsYou.set(key, now);
    }
    const url = coordinatorUrl(NOTIFY_ROUTE);
    const body = JSON.stringify(payload(s.notifyId, event));
    (sender || defaultSend)(url, { 'content-type': 'application/json', 'x-kosmos-notify-token': s.token }, body);
  } catch { /* a notification is never a reason to fail the report it rides on */ }
}

module.exports = { KINDS, NEEDS_YOU_COOLDOWN_MS, status, turnOn, turnOff, happened, payload, setSender, setClock, readState, resetCooldownForTests: () => lastNeedsYou.clear() };
