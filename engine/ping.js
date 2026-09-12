'use strict';

/**
 * Telling the Kosmos team when an agent was created (#238, restored #2960).
 *
 * Josh, 2026-08-22: he wants two numbers on the homepage, installs and agents
 * created, and ruled the collection settled ("we've had a lot of discussion
 * around this and it's fine"). A default-checked box on the create page, which
 * anybody can untick.
 *
 * Re-introduced 2026-09-12 with opt-out + disclosure (#2960). The server-side
 * receiver (chaoskosmos-site api/created.js + api/counts.js) is intact; this
 * restores the client-side sender.
 *
 * 🛑 WHAT GOES, EXHAUSTIVELY, AND THIS LIST IS THE FEATURE. Nothing about the
 * agent itself: not its name, its role, its instructions, its model, its
 * projects, or anything typed. The EVENT, never its contents.
 *
 *   installId   a random id made on this machine, in this file, once
 *   at          when
 *   version     which Kosmos
 *   os          the macOS version
 *
 * ⚠️ THE IP ARRIVES ON ITS OWN. Every HTTP request carries one; there is no
 * version of this that does not have it, and it is deliberately NOT NAMED on
 * screen (Josh, 22:55: "we're not saying anything about IP to white collar
 * workers"). Recorded here so a future reader does not take the silence for an
 * oversight and change it in either direction without asking him.
 *
 * 🔑 THE INSTALL ID IS WHAT MAKES THE IP UNNECESSARY FOR THE NUMBERS. A shared
 * office undercounts on IP and a roaming laptop overcounts, and you cannot tell
 * which; a per-install id gives both numbers exactly. (Mona Lisa's point, and
 * the reason this file generates one rather than leaning on the address.)
 *
 * 🛑 IT CAN NEVER BLOCK, SLOW OR FAIL A CREATION. The person asked for an
 * agent, not for a report. Every path here is fire-and-forget with a short
 * timeout, every error is swallowed, and the caller is not given a promise it
 * could accidentally await.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');
const { version: VERSION } = require('../package.json');

const BASE = store.ROOT;
const FILE = path.join(BASE, 'ping.json');
const DEFAULT_ENDPOINT = 'https://installkosmos.com/api/created';

let sender = null;
const endpoint = () => process.env.AGENT_WORKFORCE_PING_URL || DEFAULT_ENDPOINT;

function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { on: true, installId: null, ok: true };
    return { on: false, installId: null, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, installId: null, ok: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { on: false, installId: null, ok: false };
  return {
    on: typeof parsed.on === 'boolean' ? parsed.on : true,
    installId: typeof parsed.installId === 'string' && parsed.installId ? parsed.installId : null,
    ok: true,
  };
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

function installId() {
  const had = read();
  if (had.installId) return had.installId;
  const made = crypto.randomUUID();
  write({ installId: made });
  return made;
}

function payload() {
  return {
    event: 'agent_created',
    installId: installId(),
    at: new Date().toISOString(),
    version: VERSION,
    os: os.release(),
  };
}

function underTest() {
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

function agentCreated({ wanted } = {}) {
  try {
    if (!sender && underTest()) return;
    if (wanted === false) return;
    const pref = read();
    if (!pref.on) return;
    const body = JSON.stringify(payload());
    const post = sender || ((url, init) => fetch(url, init));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    Promise.resolve(post(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: ctl.signal,
    })).catch(() => { /* fire and forget */ })
      .finally(() => clearTimeout(timer));
  } catch { /* nothing here may reach the caller */ }
}

function setSender(f) { sender = f; }

module.exports = { FILE, read, setOn, installId, payload, agentCreated, setSender, underTest, DEFAULT_ENDPOINT };
