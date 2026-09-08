'use strict';
/* kosmos#988: tell the coordinator while an update is applying, so a person on
 * their phone is told "your Mac is updating Kosmos, back in a moment" instead of
 * "Kosmos is not answering on this computer".
 *
 * Josh saw the second message from his phone one minute after 0.5.68 served. His
 * Mac had taken the update and restarted the board. The relay was up; only the
 * board behind it was down for the restart. A person cannot tell that apart from
 * a broken Mac, and the honest reading of what they can see is "it broke".
 *
 * THE CONTRACT, from the coordinator route's author (Ice Cream Kitty, #988):
 *   POST /v1/mac/updating {"seconds": N}  when it begins applying
 *   POST /v1/mac/updating {"seconds": 0}  when it finishes
 * The deadline is capped at 15 minutes server-side, so asking for more is safe
 * and simply gets the cap.
 *
 * 🛑 WHY THIS SPEAKS HTTP DIRECTLY INSTEAD OF GOING THROUGH kosmos-tunnel.
 * remote.js does not speak HTTP to the coordinator; it spawns the tunnel binary
 * with subcommands. Adding an `updating` subcommand looks smaller and is
 * strictly slower: the tunnel source is not in this repo at all, and the binary
 * is bundled, so a new subcommand reaches no Mac until a release cut. The mac
 * already holds the client certificate this route needs (remote.js requires
 * mac_id, address, tls.crt and tls.key before it calls itself enrolled), and
 * node can present it directly.
 *
 * 🛑 NOTHING HERE MAY FAIL AN UPDATE. The caller is the one route that installs
 * software. engine/notify.js is the precedent and this copies its shape: an
 * outer try/catch that swallows everything, a short abort, fire and forget. A
 * missed announce degrades to exactly today's behaviour, which is the whole
 * point of failing open rather than retrying.
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { URL } = require('node:url');
const remote = require('./remote');

const ROUTE = '/v1/mac/updating';
/* Short on purpose. This runs microseconds after the installer is spawned, on a
 * box that is about to be busy; a slow coordinator must not hold the update. */
const TIMEOUT_MS = 3000;
/* Ask for more than any install should need. The server caps at 15 minutes, so
 * this is a request for the cap rather than a promise about duration. */
const DEFAULT_SECONDS = 900;

let sender = null;   // test seam: replaces the transport, never the decision

/* announce(seconds) -- best effort, returns nothing, throws nothing, blocks
 * nothing. `seconds` 0 means "finished". */
function announce(seconds, opts) {
  try {
    const n = Number.isFinite(Number(seconds)) ? Math.max(0, Math.trunc(Number(seconds))) : DEFAULT_SECONDS;
    /* Not enrolled means there is no coordinator to tell and no client
       certificate to tell it with. Silence is correct, not an error. */
    if (!sender && !remote.enrolled()) return;
    const dir = remote.stateDir();
    let cert = null;
    let key = null;
    if (!sender) {
      try {
        cert = fs.readFileSync(path.join(dir, 'tls.crt'));
        key = fs.readFileSync(path.join(dir, 'tls.key'));
      } catch { return; /* enrolled() said they exist; if they vanished, stay quiet */ }
    }
    const body = JSON.stringify({ seconds: n });
    if (sender) { try { sender({ seconds: n, body, route: ROUTE, opts: opts || null }); } catch { /* a test seam may not break the caller either */ } return; }

    const u = new URL(ROUTE, remote.coordinator());
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      cert,
      key,
      timeout: TIMEOUT_MS,
    });
    /* Every one of these is a path an update must survive. */
    req.on('error', () => { /* unreachable coordinator, TLS refusal, DNS */ });
    req.on('timeout', () => { try { req.destroy(); } catch { /* already gone */ } });
    req.on('response', (res) => { try { res.resume(); } catch { /* drain, ignore body */ } });
    req.end(body);
  } catch { /* nothing here may reach the caller */ }
}

function setSender(f) { sender = typeof f === 'function' ? f : null; }

module.exports = { ROUTE, TIMEOUT_MS, DEFAULT_SECONDS, announce, setSender };
