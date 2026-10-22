#!/usr/bin/env node
'use strict';
/**
 * kosmos#6239: END-TO-END PROOF that a family joins as Kosmos+Kids slice 2 says, through a LOCAL debug coordinator and
 * relay (never production), with two Kosmos boards on this Mac: P (a parent's computer) and K (the child's).
 *
 * USAGE (as tools/fed-own-e2e.js, #4693, whose helpers this reuses)
 *   1. Build the three debug binaries from kosmos-relay origin/main (it carries familykind-6239, relay#398, and
 *      familysay-6251, relay#399):
 *        cd <kosmos-relay> && CARGO_TARGET_DIR=<dir> cargo build --locked \
 *          --bin kosmos-coordinator --bin kosmos-relay --bin kosmos-tunnel
 *   2. From this repo's root:  FEDPROOF_BIN_DIR=<dir>/debug node tools/family-e2e-6239.js
 *      FEDPROOF_KEEP=1 keeps the sandbox and prints its path.
 *
 * WHAT IT PROVES, each step a person's own action through the real routes:
 *   1-2  a local coordinator (dev codes, no second factor) and relay come up.
 *   3-4  the parent signs up on the web (a browser session) and on P; the parent makes the child's account at a
 *        plus-address of the parent's (kosmos#6379), and that account signs in on K; the parent's browser opens P
 *        through the relay (the knock, kosmos#6887) and P allows it, as the console needs an allowed sign-in.
 *   5    the operator makes the family: org-create --kind family, the parent its admin.
 *   6    the parent makes a join code in the console (/v1/org/invites).
 *   7    K previews it: a family, with the family's own words (no company), and nothing joined (control).
 *   8    a join that does not say the words were shown is refused by the BOARD's own gate, org_family_words_unseen
 *        (the control for 9). The coordinator's gate behind it (an older board or another client) cannot be reached
 *        through a board that sends the words; kosmos-relay's api test kosmos6239_a_family_joins_only_from_a_board_
 *        that_showed_its_words covers it.
 *   9    with the words read and accepted on K, K joins; its board says family; the coordinator's audit row records
 *        the join with "words shown on the board's screen (the board's word)".
 *   9b   K's first report lands under the family's words (K's own row in the parent's console; nobody before, the control).
 *   10   the spent code, previewed again, is refused in words that name no company.
 *   11   K leaves the family.
 * Nothing here is production: every service and board runs under one mktemp sandbox on free high ports.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const https = require('node:https');
const dns = require('node:dns');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
// Absolute: the services run with cwd SANDBOX and the boards with cwd REPO, and the orphan
// sweep compares command lines against these exact paths.
// Required (rounds 1, 4, 6, 8): the three binaries must be built from relay main for this run, so no default can be
// trusted to hold them. USAGE above says how to build them.
if (!process.env.FEDPROOF_BIN_DIR) { console.error('set FEDPROOF_BIN_DIR to the debug dir holding kosmos-coordinator, kosmos-relay and kosmos-tunnel built from kosmos-relay origin/main (see USAGE at the top of this file)'); process.exit(2); }
const BIN_DIR = path.resolve(process.env.FEDPROOF_BIN_DIR);
const BIN = {
  coordinator: path.join(BIN_DIR, 'kosmos-coordinator'),
  relay: path.join(BIN_DIR, 'kosmos-relay'),
  tunnel: path.join(BIN_DIR, 'kosmos-tunnel'),
};
/* kosmos#4693: the coordinator is reached by a NAME, not 127.0.0.1. Since #4699 a board refuses
   an own code when its Kosmos+ address has no domain for computers to live under (an IP, a
   localhost, a two-label host: engine/account-computers.js computerDomain), so an IP-addressed
   coordinator fails the own-code join before anything is shared. `.localhost` names resolve to
   this machine (RFC 6761), so login.<FEDPROOF_DOMAIN> gives the domain FEDPROOF_DOMAIN, and the
   coordinator's KOSMOS_DOMAIN is set to it so the computers it names are trusted under it. */
const FEDPROOF_DOMAIN = 'fedproof.localhost';
const FEDPROOF_COORD_HOST = 'login.' + FEDPROOF_DOMAIN;
const KEEP = process.env.FEDPROOF_KEEP === '1';
// The bounded waits, worst case: coordinator 60 + relay 30 + 2 boards x 60 + 4 codes x 20 + P's waiting list 60
// + the console's Allow 45 + K's join 30 + the two audit polls 2 x 20 + K's first report (at worst the next 5-minute tick
// after the join, plus 90) 390 + a retried first sign-in 90 = 945 s, before HTTP timeouts (90 s each). 19 min leaves
// room for two.
const WATCHDOG_MS = Number(process.env.FEDPROOF_WATCHDOG_MS) || 19 * 60 * 1000;
const RUN = crypto.randomBytes(3).toString('hex');
// Round 11: a synchronous child (the preflight, dev-cert, org-create) blocks the watchdog's timer, so each has its own.
const SYNC_MS = 30000;
// A board arms its rollup ticks together when it starts (server.js: a setTimeout of 60 s and a setInterval of 5 min), so
// they fall at start + 60 s, 300 s, 600 s, 900 s ... A join does not start one: K's first report goes at the first tick
// after it joined. Step 9b waits for that tick plus REPORT_SLACK_MS for the send.
const ROLLUP_FIRST_MS = 60000;
const ROLLUP_EVERY_MS = 5 * 60000;
const REPORT_SLACK_MS = 90000;
// The offsets of a board's ticks after its timers are armed: 60 s, then 300, 600, 900 s ... (one source for step 9b).
const nextTickOffset = (t) => (t < ROLLUP_FIRST_MS ? ROLLUP_FIRST_MS : t < ROLLUP_EVERY_MS ? ROLLUP_EVERY_MS : t + ROLLUP_EVERY_MS);
// The company's consent hash, as kosmos-relay pins it (consent_hash_for("company") in coordinator/tests/api.rs): a
// family's words must not be these. A second copy, kept on purpose (round 17): deriving it in the run needs a second
// admin and a company join. If relay ever changes the company words, its pinned test changes; change this with it, or
// step 9's hash clause stops discriminating (the --kind company control in the plan is how to see it).
const COMPANY_CONSENT_HASH = '34a95f58313ab7cc39946efb67c9e744ae3fa8a85962f70b554a73ff9b88f1ba';   // kosmos#6594: the reviewer line split in two, each under the board's 300 (relay #546)
// One table: each step's label prefix and how many checks it makes. EXPECTED_CHECKS and the "never ran" list both come
// from it, so adding a check means changing one number here.
const STEP_CHECKS = { 'step 1': 1, 'step 2': 1, 'step 4': 4, 'step 4b': 4, 'step 5': 1, 'step 6': 1, 'step 7': 3, 'step 8': 1,
  'step 9': 3, 'step 9b': 2, 'step 10': 1, 'step 11': 3 };
const EXPECTED_CHECKS = Object.values(STEP_CHECKS).reduce((a, b) => a + b, 0);
const T0 = Date.now();

const results = [];
let halted = false;   // a signal or the watchdog is tearing the run down: main's late checks are not reported
// kosmos#6287: the helpers and module state named in tools.fedproof-helpers-in-sync-6287.test.js are kept identical in
// tools/fed-own-e2e.js and tools/family-e2e-6239.js (whole-line // comments may differ). A fix to one is made to both, or that test fails.
function chk(ok, label, extra) {
  if (halted) return !!ok;
  results.push({ ok: !!ok, label });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : '') + '  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  return !!ok;
}
function info(s) { console.log('      ' + s); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, every = 300) {
  const until = Date.now() + ms;
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(every);
  }
}

// ---------- sandbox, ports, processes ----------
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'family-6239-')));
const LOGS = path.join(SANDBOX, 'logs');
fs.mkdirSync(LOGS);
const started = [];   // { name, child, log }
let stopping = false; // set once the run is being torn down: no process may start after it

function fedproofPortFreeOn(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (e) => resolve(e && e.code === 'EADDRNOTAVAIL'));   // no such family here: nothing can take it
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}
// Review 1: free on BOTH loopback families. A name that resolves to [::1, 127.0.0.1] lets a client try either, so
// another process on the other family's port would be cross-talk with this run's coordinator.
// Review 2: this is checked once, at start. The coordinator binds only one family, so a process that takes the other
// family's port AFTER this check is not excluded. That is local cross-talk, never another machine.
async function fedproofPortFree(port) {
  return (await fedproofPortFreeOn(port, '127.0.0.1')) && (await fedproofPortFreeOn(port, '::1'));
}
const taken = new Set();
async function freePort() {
  for (let i = 0; i < 400; i++) {
    const p = 28000 + Math.floor(Math.random() * 1000);   // round 12: not fed-own-e2e.js's 27000s, so the two can run at once
    if (taken.has(p)) continue;
    if (await fedproofPortFree(p)) { taken.add(p); return p; }
  }
  throw new Error('no free port in 28000-28999');
}

function start(name, cmd, args, opts = {}) {
  if (stopping) throw new Error('the run is stopping; not starting ' + name);
  if (!opts.env) throw new Error('start(' + name + ') needs an explicit env');
  const log = path.join(LOGS, name + '.log');
  const fd = fs.openSync(log, 'a');
  const child = spawn(cmd, args, { cwd: opts.cwd || SANDBOX, env: opts.env, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  started.push({ name, child, log, env: opts.env });
  // A spawn failure (EACCES, ENOEXEC) is an 'error' event: logged, never an uncaught throw
  // that would skip the cleanup and orphan what already started.
  child.on('error', (err) => { try { fs.appendFileSync(log, '\n[harness] spawn error: ' + err.message + '\n'); } catch { /* sandbox gone */ } });
  child.on('exit', (code, sig) => { try { fs.appendFileSync(log, '\n[harness] exited code=' + code + ' signal=' + sig + '\n'); } catch { /* sandbox gone */ } });
  return { child, log };
}
function fedproofReadLog(log) { try { return fs.readFileSync(log, 'utf8'); } catch { return ''; } }
function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
/* The environment for the coordinator and relay: nothing inherited but PATH and TMPDIR. */
function serviceEnv(home, extra) {
  const env = {};
  for (const k of ['PATH', 'TMPDIR']) if (process.env[k]) env[k] = process.env[k];
  fs.mkdirSync(home, { recursive: true });
  return Object.assign(env, { HOME: home, NO_COLOR: '1' }, extra);
}
/* Every process on this machine with its parent, read once (the teardown walks descendants from it). */
function psTable() {
  const out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return out.split('\n').map((l) => l.match(/^\s*(\d+)\s+(\d+)\s(.*)$/)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] }));
}
function descendantsOf(pid, table) {
  const out = [];
  const q = [pid];
  while (q.length) {
    const p = q.shift();
    for (const r of table) if (r.ppid === p && !out.includes(r.pid)) { out.push(r.pid); q.push(r.pid); }
  }
  return out;
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
/* Stop exact pids: SIGTERM, then SIGKILL whatever is left after `graceMs`. */
async function stopPids(pids, graceMs = 3000) {
  const mine = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 1 && p !== process.pid);
  for (const p of mine) { try { process.kill(p, 'SIGTERM'); } catch { /* gone */ } }
  await waitFor(() => mine.every((p) => !alive(p)), graceMs, 100);
  for (const p of mine) if (alive(p)) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
}
function isLive(entry) { return !!entry.child.pid && entry.child.exitCode === null && entry.child.signalCode === null; }
/* The descendants an entry owns. While it is live they are walked from its pid and remembered
   (pid -> command line). Once it has exited its pid may be reused, so it is never walked again:
   only a remembered descendant still alive with the SAME command line is returned. */
function ownedDescendants(entry, table) {
  if (!entry.known) entry.known = new Map();
  if (isLive(entry)) {
    for (const d of descendantsOf(entry.child.pid, table)) {
      const row = table.find((r) => r.pid === d);
      if (row) entry.known.set(d, row.cmd);
    }
  }
  const out = [];
  for (const [d, cmd] of entry.known) { const row = table.find((r) => r.pid === d); if (row && row.cmd === cmd) out.push(d); }
  return out;
}
/* Every pid this run owns that is still alive: the started processes, their descendants,
   and anything whose command line names the sandbox (a seat orphaned by its board). */
function ownedAlive() {
  let table = [];
  try { table = psTable(); } catch { table = []; }
  const pids = new Set();
  for (const e of started) {
    if (isLive(e)) pids.add(e.child.pid);
    for (const d of ownedDescendants(e, table)) pids.add(d);
  }
  // An orphaned seat names the sandbox (its state dir) AND runs one of this run's binaries, or a
  // script inside the sandbox. A stranger that merely mentions the path (tail -f of a log, an
  // editor, a grep) runs something else and is never matched. Limit: a board (node <repo>/server.js)
  // never names the sandbox, so boards are stopped through the started list and their remembered
  // descendants only; an orphan that does not name the sandbox is not swept here.
  const ours = [...Object.values(BIN), process.execPath];
  // A sandbox script shows in ps as '/bin/sh <sandbox>/...', so an interpreter then the sandbox counts too.
  const runsOurs = (cmd) => cmd.startsWith(SANDBOX) || /^\/bin\/(ba|z)?sh /.test(cmd) && cmd.includes(' ' + SANDBOX)
    || ours.some((b) => cmd === b || cmd.startsWith(b + ' '));
  for (const r of table) if (r.pid !== process.pid && r.cmd.includes(SANDBOX) && runsOurs(r.cmd)) pids.add(r.pid);
  return [...pids].filter((p) => p !== process.pid && alive(p));
}
let cleaned = false;
let cleanedDone = false;
// Last resort: an exit that skipped the async cleanup still SIGTERMs every live started pid.
process.on('exit', () => {
  if (cleanedDone) return;
  for (const e of started) if (isLive(e)) { try { process.kill(e.child.pid, 'SIGTERM'); } catch { /* gone */ } }
});
async function fedproofCleanup() {
  if (cleaned) return;
  cleaned = true;
  stopping = true;
  // Re-walk until nothing is left: a board can spawn a seat between one ps and its own death.
  let left = [];
  for (let pass = 0; pass < 8; pass++) {
    left = ownedAlive();
    if (!left.length) break;
    await stopPids(left);
  }
  left = ownedAlive();
  if (left.length) console.log('WARN  processes this run owns are still alive: ' + left.join(','));
  cleanedDone = !left.length;
  if (KEEP) console.log('kept sandbox: ' + SANDBOX);
  else { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* left behind; nothing reports it (no startup leftover check) */ } }
}

// ---------- HTTP ----------
async function http(base, method, p, body, headers = {}) {
  const r = await fetch(base + p, {
    method,
    headers: Object.assign({ 'content-type': 'application/json' }, headers),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, text };
}
const SCREEN = { 'sec-fetch-site': 'same-origin' };

// ---------- coordinator ----------
let coord = null;
function devCodes(email) {
  const re = /\[dev\] (\S+) code for (\S+) \([^)]*\): (\d{6})/g;
  const out = [];
  let m;
  const text = fedproofReadLog(coord.log);
  while ((m = re.exec(text))) if (m[2] === email) out.push(m[3]);
  return out;
}
async function nextCode(email, before) {
  return waitFor(() => { const c = devCodes(email); return c.length > before ? c[c.length - 1] : null; }, 20000, 200);
}

/* A board signs in to an existing account: the in-app wizard's routes (#3149). */
async function boardSignin(b, email, name) {
  const before = devCodes(email).length;
  let retried = false;
  let r = await http(b.base, 'POST', '/api/remote/signin-start', { email });
  // The first tunnel call of a run can outlast the board's wait while the debug tunnel binary starts (seen twice, always
  // the first board to sign in): asked again once, on that answer only. The words are the board's own refusal for a tunnel
  // that does not answer (engine/remote.js); if they are reworded, this retry silently stops, which only loses the retry.
  if (r.status !== 200 && /did not answer in time/.test(r.text)) {
    info(b.letter + ' signin-start: the tunnel did not answer in time; asking once more');
    r = await http(b.base, 'POST', '/api/remote/signin-start', { email });
    retried = true;
  }
  if (r.status !== 200) { info(b.letter + ' signin-start ' + r.status + ' ' + r.text.slice(0, 200)); return false; }
  let code = await nextCode(email, before);
  // After a retry two codes may arrive (the first start may have gone through late): let them settle 2 s and take the
  // newest. A first code written more than 2 s after the retry's would still be taken; verify then fails, as itself.
  if (retried && code) { await sleep(2000); const all = devCodes(email); code = all[all.length - 1]; }
  if (!code) { info(b.letter + ': no sign-in code arrived for ' + email); return false; }
  r = await http(b.base, 'POST', '/api/remote/signin-verify', { email, code });
  if (r.status !== 200 || !r.json || r.json.stage !== 'session') { info(b.letter + ' signin-verify ' + r.status + ' ' + r.text.slice(0, 200)); return false; }
  r = await http(b.base, 'POST', '/api/remote/signin-register', { name });
  if (r.status !== 200 || !r.json || r.json.stage !== 'registered') { info(b.letter + ' signin-register ' + r.status + ' ' + r.text.slice(0, 300)); return false; }
  info(b.letter + ' registered at ' + r.json.address + ', standing ' + JSON.stringify(r.json.standing));
  return true;
}

// ---------- boards ----------
const REL = {};   // relay facts, filled at stand-up
function boardEnv(b) {
  const env = {};
  for (const k of ['PATH', 'LANG', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL']) if (process.env[k]) env[k] = process.env[k];
  return Object.assign(env, {
    HOME: b.home,
    PORT: String(b.port),
    AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
    // #4253: two boards per run, each a fresh install id; never phone home, report, or post to the community.
    AGENT_WORKFORCE_CREATED_URL: 'http://127.0.0.1:9/api/created',
    AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback',
    AGENT_WORKFORCE_COMMUNITY_URL: 'http://127.0.0.1:9/',
    AGENT_WORKFORCE_DATA: b.data,
    AGENT_WORKFORCE_WORKERS: b.workers,
    AGENT_WORKFORCE_LAUNCH: b.launch,
    AGENT_WORKFORCE_PROJECTS: b.projects,
    AGENT_WORKFORCE_TMUX_BIN: b.tmuxWrap,
    AGENT_WORKFORCE_FAKE_PANES: path.join(b.data, 'fake-panes'),
    AGENT_WORKFORCE_FAKE_SESSIONS: path.join(b.data, 'fake-sessions'),
    AGENT_WORKFORCE_FAKE_SCREEN: path.join(b.data, 'fake-screen'),
    AGENT_WORKFORCE_FEDERATION_LIVE: '1',
    AGENT_WORKFORCE_TUNNEL_BIN: BIN.tunnel,
    AGENT_WORKFORCE_TUNNEL_COORDINATOR: REL.coordinator,
    AGENT_WORKFORCE_TUNNEL_RELAY: REL.tunnelAddr,
    AGENT_WORKFORCE_TUNNEL_CA: REL.ca,
    AGENT_WORKFORCE_TUNNEL_STATE: b.state,
    /* kosmos#6887: the tunnel inherits this. Its gate asks for the second sign-in step unless told otherwise, and this
       run's coordinator mints none (KOSMOS_REQUIRE_SECOND 0), so without it P's gate refuses the parent's browser in 4b
       as "not valid any more" instead of asking P. */
    KOSMOS_REQUIRE_SECOND: '0',
  });
}
async function startBoard(letter) {
  // Checked before any file is made: a board started during teardown would write into the
  // sandbox the cleanup is about to remove.
  if (stopping) throw new Error('the run is stopping; not starting board ' + letter);
  const root = path.join(SANDBOX, 'board-' + letter);
  const b = { letter, root };
  for (const k of ['data', 'workers', 'launch', 'projects', 'home', 'state']) { b[k] = path.join(root, k); fs.mkdirSync(b[k], { recursive: true }); }
  fs.chmodSync(b.state, 0o700);
  b.port = await freePort();
  b.base = 'http://127.0.0.1:' + b.port;
  b.agent = 'roomer' + letter.toLowerCase();
  const fleet = require(path.join(REPO, 'test-support', 'fleet'));
  fs.writeFileSync(path.join(b.data, 'fake-panes'), fleet.line({ session: b.agent + '-discord', claim: b.agent, title: '✳ idle' }) + '\n');
  fs.writeFileSync(path.join(b.data, 'fake-sessions'), b.agent + '-discord\n');
  fs.writeFileSync(path.join(b.data, 'fake-screen'), '❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)\n');
  // The fake tmux (no agent runs here; the boards only need one to read).
  b.tmuxWrap = path.join(REPO, 'test-support', 'fake-tmux.sh');
  const s = start('board-' + letter, process.execPath, [path.join(REPO, 'server.js')], { cwd: REPO, env: boardEnv(b) });
  // Stamped at spawn: the board arms its rollup timers during its start, a little after this, so the modelled ticks fall
  // slightly EARLY. A join just past a modelled tick then waits for the next one, which is longer but never misses one.
  b.startedAt = Date.now();
  b.proc = s;
  // A board that EXITED (a port taken between the check and its bind) is reported at once.
  const up = await waitFor(async () => {
    if (s.child.exitCode !== null) return { exited: true };
    return (await fetch(b.base + '/api/projects', { signal: AbortSignal.timeout(3000) })).ok;
  }, 60000, 250);
  b.answeredAt = Date.now();   // the timers were armed somewhere between startedAt and this
  if (!up || up.exited) throw new Error('board ' + letter + (up ? ' exited at start' : ' did not answer on ' + b.base) + ' (log: ' + s.log + ')\n' + fedproofReadLog(s.log).slice(-2000));
  return b;
}
/* The web sign-up, as coordinator/src/signin.html drives it: the terms version is read off the served page (never
   hardcoded here), then signup start + verify with the dev code; the answer's session is the browser's. */
async function webSignupSession(email, deviceId) {
  const page = await fetch(REL.coordinator + '/signup', { signal: AbortSignal.timeout(10000) }).then((r) => r.text());
  const terms = (page.match(/var TERMS_VERSION = "([^"]+)"/) || [])[1];
  if (!terms) { info('the sign-up page carries no TERMS_VERSION'); return null; }
  const before = devCodes(email).length;
  let r = await http(REL.coordinator, 'POST', '/v1/signup/start', { email });
  if (r.status !== 200) { info('signup/start ' + r.status + ' ' + r.text.slice(0, 200)); return null; }
  const code = await nextCode(email, before);
  if (!code) { info('no signup code for ' + email); return null; }
  r = await http(REL.coordinator, 'POST', '/v1/signup/verify', { email, code, device_id: deviceId, device_name: 'family-e2e browser', accepted_terms: terms });
  if (r.status !== 200 || !r.json || !r.json.token) { info('signup/verify ' + r.status + ' ' + r.text.slice(0, 200)); return null; }
  return r.json;
}
const bearer = (tok) => ({ authorization: 'Bearer ' + tok });
/* kosmos#6887: a browser opens board b through the relay with its session, as the gate's sign-in page posts it
   (kosmos-relay crates/e2e/tests/door.rs sends the same request). Since kosmos-relay #433 (kosmos#6407) a computer lists
   only devices that asked it, and this POST is that asking: the gate notes the knock. TLS ends at b's tunnel, trusted by
   the CA in its state folder, under the address it registered. Resolves { status, text }; status 0 when no HTTP answer
   came back (the relay drops a name with no tunnel attached, measured: "visitor dropped: no tunnel registered"). */
function knockAt(b, token) {
  let host = null;
  let ca = null;
  try { host = fs.readFileSync(path.join(b.state, 'address'), 'utf8').trim() || null; } catch { /* said below */ }
  try { ca = fs.readFileSync(path.join(b.state, 'ca.crt')); } catch { /* said below */ }
  if (!host || !ca) return Promise.resolve({ status: 0, text: 'no ' + (host ? 'ca.crt' : 'address') + ' in ' + b.letter + '\'s tunnel state' });
  const body = JSON.stringify({ token });
  return new Promise((res) => {
    let done = false;
    const end = (status, text) => { if (!done) { done = true; res({ status, text }); } };
    let req;
    try {
      req = https.request({ host: '127.0.0.1', port: REL.publicPort, servername: host, ca, agent: false, method: 'POST', path: '/_kosmos/session',
        headers: { host, origin: 'https://' + host, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), connection: 'close' } },
      (r) => { let text = ''; r.setEncoding('utf8'); r.on('data', (d) => { text += d; }); r.on('end', () => end(r.statusCode || 0, text)); r.on('error', (e) => end(0, String(e.message || e))); });
    } catch (e) { end(0, String(e.message || e)); return; }
    req.on('error', (e) => end(0, String(e.message || e)));
    req.setTimeout(5000, () => { end(0, 'no answer in 5 s'); req.destroy(); });
    req.end(body);
  });
}

async function main() {
  console.log('#6239 family join proof, run ' + RUN + ', sandbox ' + SANDBOX);
  const { isRunnable } = require(path.join(REPO, 'engine', 'runners'));
  for (const [k, p] of Object.entries(BIN)) {
    if (!isRunnable(p)) throw new Error('missing or not executable: ' + k + ' binary at ' + p + ' (set FEDPROOF_BIN_DIR)');
  }
  // Review 4: binaries built before relay#398 have no family kind, and every family step would go red for that reason
  // alone. Such a coordinator does not know --kind; one that does refuses an unknown kind by name.
  {
    let said = '';
    let returned = false;   // round 18: exited 0, as opposed to killed, timed out or failing
    fs.mkdirSync(path.join(SANDBOX, 'kindcheck'), { recursive: true });
    try { execFileSync(BIN.coordinator, ['org-create', '--name', 'x', '--slug', 'x', '--admin', 'x@example.com', '--kind', 'nonsense'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: SYNC_MS, killSignal: 'SIGKILL', env: Object.assign(process.env.PATH ? { PATH: process.env.PATH } : {}, { HOME: SANDBOX, KOSMOS_DATA_DIR: path.join(SANDBOX, 'kindcheck') }) }); returned = true; }
    catch (e) {
      said = String(e.stderr || '') + String(e.stdout || '');
      if (!said) said = e.signal ? '(killed by ' + e.signal + (e.signal === 'SIGKILL' ? ', after ' + SYNC_MS / 1000 + ' s' : '') + ')' : '(' + (e.code || 'failed') + ', no output)';
    }
    if (returned && said === '') said = '(it exited 0: it accepted a nonsense kind)';
    if (!/--kind is company or family/.test(said)) {
      // Round 6: "stale" only when it does not know --kind; anything else is said as itself.
      // An older binary answers an unknown flag with its org-create usage line, which has no --kind (relay main before
      // #398: "org-create: usage: org-create --name <n> --slug <s> --admin <email> [--domain <d>]"). Anything else is
      // a different failure, said as itself.
      const stale = /usage: org-create/.test(said) && !/--kind/.test(said);
      throw new Error(stale
        ? 'the coordinator binary at ' + BIN.coordinator + ' predates the family kind (relay#398); rebuild from kosmos-relay origin/main (see USAGE). It said: ' + said.slice(0, 300)
        : 'the family-kind check could not run the coordinator binary at ' + BIN.coordinator + '. It said: ' + (said.slice(0, 600) || '(nothing)'));
    }
  }

  // 1. coordinator (as #4693: a loopback-only name, an allowlisted env, dev codes to its log)
  const coordAll = await dns.promises.lookup(FEDPROOF_COORD_HOST, { all: true }).catch((e) => ({ error: e }));
  if (coordAll.error || !coordAll.length || coordAll.some((a) => !['127.0.0.1', '::1'].includes(a.address))) {
    throw new Error(FEDPROOF_COORD_HOST + ' must resolve ONLY to this machine, got ' + (coordAll.error ? coordAll.error.code : coordAll.map((a) => a.address).join(', ')));
  }
  const coordAt = coordAll[0];
  const coordPort = await freePort();
  REL.coordinator = 'http://' + FEDPROOF_COORD_HOST + ':' + coordPort;
  const coordData = path.join(SANDBOX, 'coordinator');
  fs.mkdirSync(coordData);
  const coordEnv = serviceEnv(path.join(SANDBOX, 'coordinator-home'), {
    KOSMOS_DEV_MODE: '1', KOSMOS_REQUIRE_SECOND: '0', KOSMOS_FEDERATION_LIVE: '1', KOSMOS_DOMAIN: FEDPROOF_DOMAIN,
    KOSMOS_LISTEN: (coordAt.family === 6 ? '[::1]:' : '127.0.0.1:') + coordPort, KOSMOS_DATA_DIR: coordData });
  coord = start('coordinator', BIN.coordinator, [], { env: coordEnv });
  const meta = await waitFor(async () => {
    if (coord.child.exitCode !== null) return { exited: true };
    const r = await http(REL.coordinator, 'GET', '/v1/meta'); return r.status === 200 && r.json;
  }, 60000);
  if (!meta || meta.exited) throw new Error('the coordinator did not come up:\n' + fedproofReadLog(coord.log).slice(-2000));
  chk(typeof meta.coordinator_pubkey === 'string', 'step 1: local coordinator answers /v1/meta');

  // 2. relay (the boards' tunnels reach the coordinator through it)
  const relayEnv = serviceEnv(path.join(SANDBOX, 'relay-home'), { RUST_LOG: 'info' });
  const tlsDir = path.join(SANDBOX, 'relay-tls');
  try {
    execFileSync(BIN.relay, ['dev-cert', '--hosts', '127.0.0.1', '--out-dir', tlsDir], { stdio: ['ignore', 'pipe', 'pipe'], env: relayEnv, timeout: SYNC_MS, killSignal: 'SIGKILL' });
  } catch (e) { throw new Error('relay dev-cert failed: ' + String(e.stderr || e.message || e).slice(0, 600)); }
  const pinned = path.join(SANDBOX, 'relay-coordinator-key');
  fs.writeFileSync(pinned, meta.coordinator_pubkey + '\n');
  const pub = await freePort();
  const tun = await freePort();
  REL.tunnelAddr = '127.0.0.1:' + tun;
  REL.publicPort = pub;   // where a phone or browser reaches a computer (kosmos#6887: the parent's browser knocks at P)
  REL.ca = path.join(tlsDir, 'ca.pem');
  REL.args = ['serve', '--public-addr', '127.0.0.1:' + pub, '--tunnel-addr', REL.tunnelAddr,
    '--tunnel-cert', path.join(tlsDir, 'cert.pem'), '--tunnel-key', path.join(tlsDir, 'key.pem'), '--coordinator-key', pinned,
    /* kosmos#6887: the coordinator's domain, or the relay keeps its placeholder (kosmos.invalid), refuses every tunnel's
       ticket for the name the tunnel asks, and no browser can reach a board through it (only 4b's knock needs that). */
    '--domain', FEDPROOF_DOMAIN];
  const rl = start('relay', BIN.relay, REL.args, { env: relayEnv });
  REL.proc = rl; REL.log = rl.log;
  const relayUp = await waitFor(() => {
    if (rl.child.exitCode !== null) return { exited: true };
    return new Promise((res) => { const s = net.connect(tun, '127.0.0.1', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
  }, 30000);
  if (!relayUp || relayUp.exited) throw new Error('the relay did not come up:\n' + fedproofReadLog(rl.log).slice(-2000));
  chk(true, 'step 2: local relay listens (tunnel ' + REL.tunnelAddr + ')');

  // 3. two boards: P, the parent's computer, and K, the child's.
  const P = await startBoard('P');
  const K = await startBoard('K');
  info('step 3: boards P (' + P.port + ') and K (' + K.port + ') answer');

  // 4. the parent signs up on the web (a browser session) and signs in on P; the child's account signs in on K.
  // kosmos#6379: the child's account is one the parent makes, at an address the parent reads (here a plus-address
  // of the parent's). A child under 13 is not signed in at an address of their own.
  const parent = 'parent-' + RUN + '@example.com';
  const kid = 'parent-' + RUN + '+kid@example.com';
  const webDevice = 'family-web-' + RUN;
  const sess = await webSignupSession(parent, webDevice);
  // The session's match code is how P's row is found in 4b: it must be a real one (undefined would match a codeless row).
  chk(!!sess && typeof sess.match_code === 'string' && sess.match_code !== '', 'step 4: the parent\'s account is made through the web sign-up, with a browser session and its match code', sess ? 'device ' + sess.device_status + ', code ' + sess.match_code : '-');
  chk(await boardSignin(P, parent, 'famp-' + RUN), 'step 4: P signs in as the parent');
  chk(await webSignupSession(kid, 'family-kidweb-' + RUN) !== null, 'step 4: the parent makes the child\'s account through the web sign-up, at a plus-address of the parent\'s');
  chk(await boardSignin(K, kid, 'famk-' + RUN), 'step 4: K signs in as the child');

  // 4b. the parent's browser is allowed from P, as a person allows a new browser (the console needs an allowed sign-in).
  /* A browser is listed on a computer once it knocks there (kosmos#6407), so the harness knocks at P as the browser,
     through the relay; P's Allow is sent with the code the sign-up answered (the four characters the person would match
     on screen), and the console's own answer below (an allowed sign-in, or session_not_allowed) is what shows it took. */
  if (sess) {
    // CONTROL for step 6: before any Allow, the console refuses the parent's browser (not an allowed sign-in). Matched by
    // its words: the coordinator's answer carries no code field for this refusal, so the wording is the only handle.
    const c = await http(REL.coordinator, 'POST', '/v1/org/invites', {}, bearer(sess.token));
    chk(c.status === 403 && /allow this sign-in on one of your computers first/.test(c.text), 'step 4b control: before the Allow, the console refuses the parent\'s browser',
      c.status + ' ' + c.text.slice(0, 160) + (c.status === 403 ? ' (matched by its words: a 403 with other words means the coordinator reworded it)' : ''));
  }
  /* kosmos#6887: the browser asks P by opening it (the knock; without it P lists nothing since kosmos#6407). The gate
     answers a valid session it has not allowed with 403 pending and the code the browser shows, which must be the code
     the sign-up answered. Asked again, a second apart, until the gate says wait, for at most about 35 s (no new try
     starts after 30 s, and a try waits at most 5 s); the last answer is the one checked. A refusal can be momentary:
     no answer while P's tunnel is still attaching, and 403 "not valid any more" until its first poll names P's account
     (kosmos-relay gate.rs ACCOUNT_NOT_KNOWN_YET). */
  const parseKnock = (k) => { try { return JSON.parse(k.text); } catch { return null; } };
  let knock = { status: 0, text: 'no session' };
  if (sess) {
    const until = Date.now() + 30000;
    for (;;) {
      knock = await knockAt(P, sess.token);
      const j = parseKnock(knock);
      if ((knock.status === 403 && j && j.pending === true) || Date.now() >= until) break;
      await sleep(1000);
    }
  }
  const kj = parseKnock(knock);
  chk(knock.status === 403 && !!kj && kj.pending === true && !!sess && kj.code === sess.match_code,
    'step 4b: the parent\'s browser opens P through the relay and is told to wait, with the code its sign-up showed', knock.status + ' ' + String(knock.text).slice(0, 200));
  /* The coordinator names a session's device itself (kosmos#5422: an id the browser offers is replaced), so the row on
     P is found by the four characters the sign-up answered, as the person matches them on screen. */
  const listed = await waitFor(async () => {
    const p = await http(P.base, 'GET', '/api/remote/pending');
    const devs = p.json && Array.isArray(p.json.devices) ? p.json.devices : [];
    return devs.find((d) => d && sess && typeof sess.match_code === 'string' && sess.match_code !== '' && d.code === sess.match_code) || null;
  }, sess ? 60000 : 0, 1500);   // no session, nothing to find: no wait
  chk(!!listed, 'step 4b: P lists the parent\'s browser as waiting, with the code its sign-up showed', listed ? String(listed.device_id || '').slice(0, 8) + '... ' + listed.code : 'match code ' + (sess && sess.match_code));
  if (listed) {
    const r = await http(P.base, 'POST', '/api/remote/devices/allow', { device_id: listed.device_id, code: listed.code }, SCREEN);
    // Only that the route answered: before #6286's fix (kosmos#6291 with a tunnel carrying kosmos-relay#404) it said
    // allowed even for an id nobody holds, so the claim that the Allow took is step 6's, either way.
    chk(r.status === 200, 'step 4b: P\'s Allow route answers for the parent\'s browser', r.status + ' ' + r.text.slice(0, 200));
  }

  // 5. the operator makes the family (orgs are operator-made: org-create --kind family).
  let orgId = '';
  try {
    orgId = execFileSync(BIN.coordinator, ['org-create', '--name', 'Rivera family', '--slug', 'rivera-' + RUN, '--admin', parent, '--kind', 'family'],
      { env: coordEnv, encoding: 'utf8', timeout: SYNC_MS, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
    orgId = ((orgId.match(/^([0-9a-f]{32})\s*$/m) || [])[1]) || '';   // the id is its own line; logs go beside it
  } catch (e) { info('org-create: ' + String(e.stderr || e.message).slice(0, 300)); }
  chk(/^[0-9a-f]{32}$/.test(orgId), 'step 5: org-create --kind family makes the family, the parent its admin', orgId || '-');

  // 6. the parent makes a join code in the console, with the allowed browser session (only once there is a family).
  let code = '';
  if (sess && orgId) {
    // The Allow reaches the coordinator through P's tunnel, so the console may refuse for a moment first.
    let r = null;
    let lastErr = '';
    await waitFor(async () => {
      try { r = await http(REL.coordinator, 'POST', '/v1/org/invites', {}, bearer(sess.token)); } catch (e) { r = null; lastErr = String(e && e.message || e); return false; }
      return r.status === 200;
    }, 45000, 1500);
    if (!r) r = { status: 0, json: null, text: 'no answer: ' + lastErr };   // review 1: report the cause, not a TypeError
    code = r.json && (r.json.code || r.json.invite_code) || '';
    chk(r.status === 200 && !!code, 'step 6: the parent makes a join code in the console', r.status + ' ' + (code ? r.text.split(code).join('[code]') : r.text).slice(0, 160));
  }

  // 7. K previews the code: a family, with its own words, and nothing joined yet.
  let pv = null;
  if (code) {
    const r = await http(K.base, 'POST', '/api/org/preview', { code }, SCREEN);
    pv = r.json || {};
    // The org step 5 made, by its slug, not just any family.
    chk(r.status === 200 && pv.ok === true && pv.org && pv.org.kind === 'family' && pv.org.slug === 'rivera-' + RUN, 'step 7: K previews the code as the family step 5 made', r.status + ' ' + r.text.slice(0, 200));
    // Review 1: the words' own text, never the keys (a key could carry "family").
    const flat = (v) => (Array.isArray(v) ? v.flatMap(flat) : v && typeof v === 'object' ? Object.values(v).flatMap(flat) : typeof v === 'string' ? [v] : []);
    const words = flat(pv.consent || {}).join(' ');
    // By their text here (the board's preview answer carries no hash); step 9 pins the hash the join recorded as not
    // the company's, so this check does not rest on one word alone.
    chk(/family/i.test(words) && !/company/i.test(words), 'step 7: the words K shows are the family\'s, naming no company', words.slice(0, 160));
    const st = await http(K.base, 'GET', '/api/org', undefined, SCREEN);   // as the screen, as step 9 reads it
    chk(st.status === 200 && st.json && st.json.enrolled === false, 'step 7 control: K is not joined after a preview', st.status + ' ' + st.text.slice(0, 120));
  }

  let joined = false;
  let joinedAt = 0;
  // 8. a join that does not say the words were shown is refused (CONTROL for step 9). It shares step 9's ticket and code
  // on purpose: a refusal here must spend neither, and step 9 joining with them is what shows it. If step 9 then fails,
  // step 8's answer above is the first place to look.
  if (pv && pv.ticket) {
    const r = await http(K.base, 'POST', '/api/org/enroll', { code, accepted: true, ticket: pv.ticket }, SCREEN);
    chk(r.json && r.json.ok === false && r.json.code === 'org_family_words_unseen', 'step 8: a family join without the words screen is refused (the board\'s gate)', r.status + ' ' + r.text.slice(0, 200));
  }

  // 9. the parent reads the words on K and accepts them there: K joins the family.
  if (pv && pv.ticket) {
    const r = await http(K.base, 'POST', '/api/org/enroll', { code, accepted: true, ticket: pv.ticket, wordsShown: true }, SCREEN);
    joinedAt = Date.now();   // when the join was answered (step 9b's tick and offset count from here)
    joined = !!(r.json && r.json.ok === true);
    // The same ticket and code as step 8's refusal: a refusal here as org_ticket or a spent code means step 8 used them up.
    chk(joined, 'step 9: with the words read and accepted on K, K joins the family', r.status + ' ' + r.text.slice(0, 200)
      + (r.json && /org_ticket|org_code_used/.test(r.json.code || '') ? ' (step 8\'s refusal spent the ticket or the code)' : ''));
    const st = await waitFor(async () => { const g = await http(K.base, 'GET', '/api/org', undefined, SCREEN); return g.json && g.json.enrolled === true ? g.json : null; }, 30000, 1000);
    // Read as the screen: any other caller learns only whether K is enrolled, never which org (#5531 review 12).
    chk(st && st.org && st.org.kind === 'family', 'step 9: K\'s board says it is in a family (kind family)', st ? JSON.stringify(st.org) : '-');
    // The join record says the screen showing the words is the board's word, not proof.
    let a = null;
    let joinRow = null;
    let lastErr = '';
    // The coordinator writes the row before it answers the join, so the first read should find it; polled only so a slow
    // coordinator reads as slow, not as a missing row.
    await waitFor(async () => {
      try { a = await http(REL.coordinator, 'GET', '/v1/org/audit', undefined, bearer(sess.token)); } catch (e) { a = null; lastErr = String(e && e.message || e); return false; }
      const rows = a.json && Array.isArray(a.json.entries) ? a.json.entries : [];
      // Round 11: exactly one join in this family's log, K's (org-create writes org_created, not joined).
      const joins = rows.filter((e) => e && e.what === 'joined');
      joinRow = joins.length === 1 ? joins[0] : null;
      return !!joinRow;
    }, 20000, 1000);
    if (!a) a = { status: 0, text: 'no answer: ' + lastErr };   // round 7: report the cause, not a TypeError
    // And the hash of the words accepted is not the company's (round 16: the discriminating check for step 7's words).
    const accepted = ((joinRow && joinRow.detail || '').match(/consent sha256:([0-9a-f]{64})/) || [])[1] || '';
    chk(joinRow && /words shown on the board's screen \(the board's word\)/.test(joinRow.detail || '') && accepted && accepted !== COMPANY_CONSENT_HASH, 'step 9: the family\'s audit row records the join with the words shown as the board\'s claim', joinRow ? joinRow.detail : a.status + ' ' + a.text.slice(0, 160));
  }

  // 9b. K reports under the family's words. K's first rollup after the join is accepted by the coordinator only when
  // the words K accepted match the family's current ones (the rollup's own consent check), so K's row reporting is the
  // family's words working for reporting too. The words gate itself is not exercised here (no arm with mismatched
  // words): this measures that a report lands. CONTROL: straight after the join, before that tick, the console counts
  // nobody reporting.
  if (joined) {
    // The first tick at or after the join: start + 60 s if the join came first, else the next multiple of 300 s.
    const sinceStart = joinedAt - K.startedAt;
    let firstTick = ROLLUP_FIRST_MS;
    while (firstTick < sinceStart) firstTick = nextTickOffset(firstTick);
    const tickAt = K.startedAt + firstTick;
    const safe = async (route) => { try { return await http(REL.coordinator, 'GET', route, undefined, bearer(sess.token)); } catch (e) { return { status: 0, json: null, text: String(e && e.message || e) }; } };
    const ov = await safe('/v1/org/console/overview');
    const before = ov.json && ov.json.members ? ov.json.members.reporting : null;
    // The same measure the positive check reads: K's own row, present and not yet reported. The positive check's
    // reportedAt is a day, not a time, so this control is what shows the report came after the join.
    const inv0 = await safe('/v1/org/console/inventory');
    const row0 = (inv0.json && Array.isArray(inv0.json.members) ? inv0.json.members : []).find((m) => m && m.email === kid) || null;
    // The control passes only on its own condition: these reads, made after the join, show no report. That holds
    // whenever the tick falls, so a pass is sound. If a tick landed between the join and the reads, the row shows a
    // report and the control fails; nearTick then says why in the detail, so the red reads as timing (rerun).
    // Could a real tick have fallen from the join to just after these reads? A real tick at offset t lands between
    // startedAt + t and answeredAt + t (the board's boot is between them), for t = 60 s, then every 300 s.
    const readsDone = Date.now();
    let nearTick = false;
    for (let t = ROLLUP_FIRST_MS; K.startedAt + t <= readsDone + 5000; t = nextTickOffset(t)) {
      if (K.answeredAt + t >= joinedAt) { nearTick = true; break; }
    }
    chk(ov.status === 200 && before === 0 && inv0.status === 200 && !!row0 && !row0.reportedAt,
      'step 9b control: before K\'s first report, nobody reports and K\'s own row has no report',
      ov.status + ' reporting=' + before + '; ' + inv0.status + ' row ' + (row0 ? JSON.stringify({ state: row0.state, reportedAt: row0.reportedAt }) : 'not found') + (nearTick ? ' (a tick was due within 5 s or past: the control could not be read cleanly; rerun)' : ''));
    let row = null;
    let invStatus = 0;
    await waitFor(async () => {
      const inv = await safe('/v1/org/console/inventory');   // a thrown read sets status 0, not the last good read's
      invStatus = inv.status;
      const members = inv.json && Array.isArray(inv.json.members) ? inv.json.members : [];
      row = members.find((m) => m && m.email === kid) || null;
      return !!(row && row.reportedAt);
    }, Math.max(0, tickAt - Date.now()) + REPORT_SLACK_MS, 3000);
    // On a miss, K's own reason for not reporting yet (its /api/org reportingWait, read as the screen), so a skipped or
    // waiting tick reads differently from a refused report.
    let kWait = '';
    if (!(row && row.reportedAt)) {
      try { const k = await http(K.base, 'GET', '/api/org', undefined, SCREEN); kWait = '; K says reporting=' + (k.json && k.json.reporting) + ' wait=' + (k.json && k.json.reportingWait); } catch { kWait = '; K /api/org did not answer'; }
    }
    const offset = Math.round((joinedAt - K.startedAt) / 1000);   // from the enroll answer
    chk(!!(row && row.reportedAt), 'step 9b: K\'s first report lands under the family\'s words (its own row in the parent\'s console)',
      'joined ' + offset + ' s after K started; tick due ' + Math.round((tickAt - K.startedAt) / 1000) + ' s; inventory ' + invStatus + '; row ' + (row ? JSON.stringify({ state: row.state, reportedAt: row.reportedAt }) : 'not found') + kWait);
  }

  // 10. the spent code, previewed again: the coordinator checks a code before anything else, so it is told "used"
  // (not "already a member"), in the board's own sentence for a used code, which names no company. Only after step 9
  // spent it: an unspent code would fail here for step 9's reason.
  if (code && joined) {
    // A refused preview names no org to the board, so it says the shared sentence (orgenroll preview calls sayFor with
    // no kind; round 7 corrected round 3, which modelled a family choice the preview does not make).
    let usedWords;
    try { usedWords = ((require(path.join(REPO, 'engine', 'orgenroll')).SAY) || {}).org_code_used; } catch { usedWords = undefined; }
    // Round 12: a renamed sentence is named as itself, not a harness crash.
    if (typeof usedWords !== 'string' || !usedWords) info('step 10: engine/orgenroll SAY.org_code_used is not a sentence here');
    const r = await http(K.base, 'POST', '/api/org/preview', { code }, SCREEN);
    const b = (r.json && r.json.because) || '';
    chk(r.json && r.json.ok === false && r.json.code === 'org_code_used' && b === usedWords,
      'step 10: the used code is refused as used, in the board\'s own sentence', (r.json && r.json.code) + ': ' + (b || r.text.slice(0, 160)));
  }

  // 11. the child's computer leaves the family: only after it joined, and the family's own log records it.
  if (joined) {
    const r = await http(K.base, 'POST', '/api/org/leave', {}, SCREEN);
    chk(r.json && r.json.ok === true, 'step 11: K leaves the family', r.status + ' ' + r.text.slice(0, 200));
    const g = await http(K.base, 'GET', '/api/org', undefined, SCREEN);
    chk(g.status === 200 && g.json && g.json.enrolled === false, 'step 11: K is no longer joined', g.status + ' ' + g.text.slice(0, 120));
    let rows = [];
    // ok:true above means the coordinator confirmed the leave (a pending one answers pending, not ok), and it writes the
    // row before answering; polled only so a slow coordinator reads as slow, not as a missing row.
    let leftErr = '';
    await waitFor(async () => {
      leftErr = '';
      let a2 = null;
      try { a2 = await http(REL.coordinator, 'GET', '/v1/org/audit', undefined, bearer(sess.token)); } catch (e) { leftErr = String(e && e.message || e); return false; }
      if (a2.status !== 200) leftErr = a2.status + ' ' + a2.text.slice(0, 120);
      rows = a2.json && Array.isArray(a2.json.entries) ? a2.json.entries : [];
      return rows.filter((e) => e && e.what === 'left').length === 1;
    }, 20000, 1000);
    chk(rows.filter((e) => e && e.what === 'left').length === 1, 'step 11: the family\'s audit log records the leave (one "left" row)', rows.map((e) => e && e.what).join(',') + (leftErr ? '; ' + leftErr : ''));
  }
  // Review 1: a guarded step that did not run would leave the verdict on fewer checks; every one must have run.
  const ran = results.length;
  // Round 10: name the steps that never ran, so a gap explains itself.
  const stepOf = (label) => ((label || '').match(/^step \d+b?/) || [''])[0];
  const stepsSeen = new Set(results.map((x) => stepOf(x.label)));
  const never = Object.keys(STEP_CHECKS).filter((x) => !stepsSeen.has(x));
  // A step whose own count is off names itself too (a check added without updating STEP_CHECKS).
  const counts = {};
  for (const x of results) { const k = stepOf(x.label); if (k) counts[k] = (counts[k] || 0) + 1; }
  // A gap after an earlier red is usually that red's cascade: name the first one.
  const firstRed = results.find((x) => !x.ok);
  const off = Object.keys(STEP_CHECKS).filter((k) => (counts[k] || 0) !== STEP_CHECKS[k] && stepsSeen.has(k)).map((k) => k + ' ' + (counts[k] || 0) + '/' + STEP_CHECKS[k]);
  chk(ran === EXPECTED_CHECKS && !never.length && !off.length, 'end: every check ran (' + EXPECTED_CHECKS + ')', ran + ' ran' + (never.length ? '; never ran: ' + never.join(', ') : '') + (off.length ? '; counts off: ' + off.join(', ') : '') + ((never.length || off.length) && firstRed ? '; first red: ' + firstRed.label : ''));   // a new chk above: update STEP_CHECKS
}

(async () => {
  const dog = setTimeout(() => {
    // Review 4: say where it was, so a hang names its step.
    const last = results.length ? results[results.length - 1].label : 'before step 1';
    console.log('FAIL  watchdog: the run took over ' + WATCHDOG_MS / 1000 + ' s; the last check was: ' + last);
    results.push({ ok: false, label: 'watchdog' }); halted = true; fedproofFinish(1);
  }, WATCHDOG_MS);
  let crashed = null;
  try { await main(); } catch (err) { crashed = err; }
  clearTimeout(dog);
  if (stopping) return;   // the watchdog or a signal is already finishing the run
  if (crashed) chk(false, 'harness stopped early: ' + (crashed && crashed.message ? crashed.message.split('\n')[0] : crashed));
  const failed = results.filter((x) => !x.ok).length;
  if (failed || crashed) {
    if (crashed && crashed.message && crashed.message.includes('\n')) console.log(crashed.message);
    for (const e of started) { console.log('---- tail of ' + e.name + ' ----'); console.log(stripAnsi(fedproofReadLog(e.log)).split('\n').slice(-25).join('\n')); }
  }
  await fedproofFinish(failed ? 1 : 0);
})();
let finishing = false;
async function fedproofFinish(code) {
  if (finishing) return;
  finishing = true;
  stopping = true;
  await fedproofCleanup();
  const failed = results.filter((x) => !x.ok).length;
  console.log('VERDICT ' + (code === 0 && !failed ? 'PASS' : 'FAIL') + '  (' + (results.length - failed) + '/' + results.length + ' checks, '
    + Math.round((Date.now() - T0) / 1000) + ' s)');
  process.exit(code === 0 && !failed ? 0 : 1);
}
// A closed terminal (SIGHUP) makes stdout writes fail; that must not feed the error handler below.
for (const st of [process.stdout, process.stderr]) st.on('error', () => { /* terminal gone */ });
// Anything thrown outside main's own try (an event handler, a stray rejection) still tears down.
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (err) => {
  console.log('FAIL  harness error (' + ev + '): ' + (err && err.message ? err.message : err));
  results.push({ ok: false, label: 'harness error (' + ev + ')' }); halted = true; fedproofFinish(1);
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) process.on(sig, () => { if (!halted) console.log('interrupted (' + sig + ')'); results.push({ ok: false, label: 'interrupted (' + sig + ')' }); halted = true; fedproofFinish(1); });
