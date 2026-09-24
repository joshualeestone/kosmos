'use strict';
/**
 * A fake kosmos-tunnel binary for the `mac-request` verb (#3626), and a network
 * tripwire.
 *
 * The real verb (kosmos-relay #103) reads a JSON body from stdin, signs the request
 * with the Mac key and prints the coordinator's JSON answer. This fake records
 * exactly what the board handed it (argv and stdin, one JSON line per call) and
 * answers the way FAKE_MAC_REQUEST_MODE says, read at each call:
 *
 *   ok:<json>     print <json>, exit 0 (the coordinator accepted it)
 *   refused       the real verb's shape for a 401, exit 1
 *   garbage       print text that is not JSON, exit 0
 *   old-tunnel    what a tunnel without the verb says, exit 2
 *   hang          never answers (for the timeout arm)
 *
 * Point AGENT_WORKFORCE_TUNNEL_BIN at `bin` BEFORE the first call; it is also the
 * seam the suite guards in mac-standing.js and updating.js key on.
 *
 * tripwire() replaces https.request and http.request with throwing spies. A module
 * that went back to dialling the coordinator directly (the unsigned path #3626
 * removed) trips it, so an arm wrapped in it goes red.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

function makeFakeTunnel() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fake-mac-request-'));
  const bin = path.join(dir, 'fake-kosmos-tunnel');
  const recordFile = path.join(dir, 'record.jsonl');
  fs.writeFileSync(bin, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
const mode = process.env.FAKE_MAC_REQUEST_MODE || 'ok:{}';
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(recordFile)}, JSON.stringify({ args, stdin }) + '\\n');
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  if (mode === 'refused') { process.stderr.write('the coordinator said no (401): missing signature headers\\n'); process.exit(1); }
  if (mode === 'garbage') { process.stdout.write('this is not json\\n'); process.exit(0); }
  if (mode === 'old-tunnel') { process.stderr.write("error: unrecognized subcommand 'mac-request'\\n"); process.exit(2); }
  if (mode.startsWith('ok:')) { process.stdout.write(mode.slice(3) + '\\n'); process.exit(0); }
  process.stderr.write('fake tunnel: unknown mode ' + mode + '\\n'); process.exit(3);
});
`, { mode: 0o755 });

  function calls() {
    let text = '';
    try { text = fs.readFileSync(recordFile, 'utf8'); } catch { return []; }
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  function reset() { try { fs.rmSync(recordFile, { force: true }); } catch { /* nothing to reset */ } }
  function flag(call, name) { const i = call.args.indexOf(name); return i === -1 ? null : call.args[i + 1]; }
  return { bin, dir, calls, reset, flag };
}

/* Wait until `n` calls are recorded (the fire-and-forget announce() does not hand
   back a promise), or give up after `ms`. */
async function waitForCalls(fake, n, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fake.calls().length >= n) return fake.calls();
    await new Promise((r) => setTimeout(r, 20));
  }
  return fake.calls();
}

function tripwire() {
  const real = { http: http.request, https: https.request };
  const dialled = [];
  const trip = (proto) => (...a) => {
    const o = a[0] && typeof a[0] === 'object' ? a[0] : {};
    dialled.push(proto + ' ' + (o.hostname || o.host || String(a[0])) + (o.path || ''));
    throw new Error('#3626 tripwire: a direct ' + proto + ' request was made; Mac routes must go through the tunnel');
  };
  http.request = trip('http');
  https.request = trip('https');
  return { dialled, restore() { http.request = real.http; https.request = real.https; } };
}

module.exports = { makeFakeTunnel, waitForCalls, tripwire };
