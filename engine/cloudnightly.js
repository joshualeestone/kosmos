'use strict';
/**
 * kosmos#8786 S2: once a night, a Kosmos Cloud box installs the newest PROD build by itself.
 *
 * This file only DECIDES. `kosmos cloud-update` (install/kosmos) runs it from its own systemd user timer, outside the
 * board's unit (S1 to S2 interface, point 2), and on "run" hands the install to the existing `kosmos update --if-newer`
 * with KOSMOS_UPDATE_CHANNEL=prod, which brings the board's own channel rules, the Updates switch, the fleet's pause,
 * the signed run-setup and the one-installer-at-a-time marker (logs/install.started). Nothing here installs.
 *
 * The night is skipped, and the next night tries again, when any of these hold, in this order:
 *   - not Linux, or not a Kosmos Cloud box (engine/cloudmachine.js, the tunnel's `hosted` latch)   silent
 *   - the Updates switch is off, or its file cannot be read (autoupdate.read: unreadable is off)
 *   - another install started under 30 minutes ago (logs/install.started, the same bound as the CLI)
 *   - the signed check is not available: app/engine/manifest-verify.js or runtime/bin/node missing, or no key pinned.
 *     setup.sh carries on unchecked without them, which is right for a person repairing by hand and wrong for a run
 *     nobody watches.
 *   - the board cannot be read (stopped, or not answering): a person may have stopped it, and an install restarts it
 *   - an agent is working, at the first look or at a second look a few minutes later
 *   - another install started during the wait between the two looks
 *
 * What that guarantees, exactly: no agent read as working at either look, the last one moments before the update look
 * starts. An agent that starts work after it, while the new version downloads, is not seen.
 *
 * ⚠️ BUSY MEANS STATE 'working' ON /api/status, the board's own reading. An agent that is asking the person
 * (needs_you) is waiting, not working, and does not hold the night: the install restarts the board, not the agent's
 * question. An agent the board could not read at all is not counted busy either; if that proves wrong on a real box,
 * the one place to change is busyAgents().
 *
 * Every seam is injectable for tests; the CLI passes none.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const INSTALL_FRESH_MS = 30 * 60 * 1000;
const SECOND_LOOK_MS = 3 * 60 * 1000;

function kosmosHome(env = process.env) {
  return path.resolve(env.KOSMOS_HOME || path.join(require('os').homedir(), '.local', 'share', 'kosmos'));
}

/* The signed check run-setup needs: the installed verifier, the bundled node, and at least one pinned key. */
function signedCheck(home) {
  const verifier = path.join(home, 'app', 'engine', 'manifest-verify.js');
  const node = path.join(home, 'runtime', 'bin', 'node');
  if (!fs.existsSync(verifier)) return { ok: false, because: 'the installed signature checker is missing (' + verifier + ')' };
  if (!fs.existsSync(node)) return { ok: false, because: 'the bundled runtime is missing (' + node + ')' };
  let keys;
  try { keys = require(verifier).KEYS; } catch (err) {
    return { ok: false, because: 'the installed signature checker could not be loaded: ' + ((err && err.message) || String(err)) };
  }
  if (!Array.isArray(keys) || keys.length === 0) return { ok: false, because: 'no signing key is pinned in this install' };
  return { ok: true };
}

/* Age of logs/install.started in ms, or null when there is none. */
function installStartedAge(home, now = Date.now()) {
  try { return now - fs.statSync(path.join(home, 'logs', 'install.started')).mtimeMs; } catch { return null; }
}

/* GET /api/status on this computer's board, with the board token. Resolves the parsed body, or rejects. */
function readStatus({ port, token, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers[require('./boardauth').HEADER_NAME] = token;
    const req = http.request({ host: '127.0.0.1', port, path: '/api/status', method: 'GET', headers, timeout: timeoutMs }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error('the board answered ' + res.statusCode)); return; }
        try { resolve(JSON.parse(data)); } catch { reject(new Error('the board\'s answer was not readable')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('the board did not answer within ' + timeoutMs + ' ms')); });
    req.on('error', reject);
    req.end();
  });
}

/* Names of the agents the board reads as working. A body without an agents list is unreadable, not idle. */
function busyAgents(body) {
  if (!body || !Array.isArray(body.agents)) throw new Error('the board\'s answer had no agents list');
  return body.agents.filter((a) => a && a.state === 'working').map((a) => String(a.sessionName || a.name || '?'));
}

/**
 * Resolves { run: true } or { run: false, why, quiet }. `quiet` is true only for "not a Cloud box", which is every
 * computer that is not one and must leave no line in its log.
 */
async function decide({
  platform = process.platform,
  isCloud = () => require('./cloudmachine').isCloudMachine(),
  updatesOn = () => require('./autoupdate').read(),
  home = kosmosHome(),
  clock = () => Date.now(),
  startedAge = (h, n) => installStartedAge(h, n),
  signed = (h) => signedCheck(h),
  status = () => readStatus({ port: require('./create').boardPort(), token: require('./boardauth').readToken() }),
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  secondLookMs = SECOND_LOOK_MS,
} = {}) {
  if (platform !== 'linux') return { run: false, why: 'not Linux', quiet: true };
  let cloud = false;
  try { cloud = Boolean(isCloud()); } catch { cloud = false; }
  if (!cloud) return { run: false, why: 'not a Kosmos Cloud computer', quiet: true };

  let pref;
  try { pref = updatesOn() || {}; } catch { pref = { on: false, ok: false }; }
  if (!pref.on) {
    return { run: false, why: pref.ok === false ? 'the Updates setting could not be read, so it counts as off' : 'updates are turned off in Settings' };
  }

  const freshInstall = () => { const age = startedAge(home, clock()); return age !== null && age < INSTALL_FRESH_MS; };
  if (freshInstall()) return { run: false, why: 'another update started on this computer less than 30 minutes ago' };

  let sc;
  try { sc = signed(home) || { ok: false, because: 'no answer' }; } catch (err) { sc = { ok: false, because: (err && err.message) || String(err) }; }
  if (!sc.ok) return { run: false, why: 'the signature check is not available: ' + sc.because };

  for (const look of ['first', 'second']) {
    if (look === 'second') await wait(secondLookMs);
    let busy;
    try { busy = busyAgents(await status()); } catch (err) {
      return { run: false, why: 'the board could not be read (' + ((err && err.message) || String(err)) + ')' };
    }
    if (busy.length) return { run: false, why: 'an agent is working (' + busy.join(', ') + ')' + (look === 'second' ? ', at the second look' : '') };
  }
  // Again after the wait: a person who started an update by hand meanwhile holds the marker, and two installers must not run.
  if (freshInstall()) return { run: false, why: 'another update started on this computer while it was checking' };
  return { run: true };
}

/* `node cloudnightly.js decide`: prints one tab-separated line, `run` or `skip<TAB>quiet|said<TAB><why>`, exit 0. */
if (require.main === module && process.argv[2] === 'decide') {
  decide().then((d) => {
    if (d.run) process.stdout.write('run\n');
    else process.stdout.write('skip\t' + (d.quiet ? 'quiet' : 'said') + '\t' + String(d.why).replace(/[\t\n]/g, ' ') + '\n');
  }, (err) => {
    process.stdout.write('skip\tsaid\tthe nightly check failed: ' + String((err && err.message) || err).replace(/[\t\n]/g, ' ') + '\n');
  });
}

module.exports = { decide, signedCheck, installStartedAge, readStatus, busyAgents, INSTALL_FRESH_MS, SECOND_LOOK_MS };
