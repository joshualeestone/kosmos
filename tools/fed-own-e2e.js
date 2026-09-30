#!/usr/bin/env node
'use strict';
/**
 * kosmos#4693: END-TO-END PROOF that two Kosmos boards on this Mac, signed in as
 * two computers of ONE Kosmos+ account, share a project room through a LOCAL debug
 * coordinator and relay (never production). The proof for #4649 (own-account room,
 * a seat per computer).
 *
 * USAGE
 *   1. Build the three debug binaries from kosmos-relay (origin/main, which carries
 *      #213 own-room ticket + per-computer seat, #214, #215 `fed-room --own-project`):
 *        cd <kosmos-relay> && CARGO_TARGET_DIR=<dir> cargo build \
 *          -p kosmos-coordinator --bin kosmos-coordinator -p kosmos-relay-server -p kosmos-tunnel-client
 *   2. From this repo's root:
 *        FEDPROOF_BIN_DIR=<dir>/debug node tools/fed-own-e2e.js
 *      FEDPROOF_BIN_DIR defaults to /Volumes/BigLobsterStorage/targets/renet-4693/debug,
 *      which is an external SSD on ONE Mac (agent1's). On any other machine set it.
 *      FEDPROOF_KEEP=1 keeps the sandbox (logs, data roots) and prints its path.
 *      FEDPROOF_WATCHDOG_MS (default 15 min, the sum of the bounded waits below plus
 *      margin), FEDPROOF_DELIVERY_MS (30 s) and FEDPROOF_ABSENCE_MS (12 s) tune the waits.
 *
 * WHAT IT DOES (every file under ONE mktemp sandbox, every port a free high port,
 * checked free before use; the live board and 16180-16199 are never touched)
 *   1. Starts the coordinator (KOSMOS_DEV_MODE=1: codes to stdout, REQUIRE_SECOND=0,
 *      FEDERATION_LIVE=1) and waits on GET /v1/meta. The coordinator and relay get an
 *      ALLOWLISTED environment (PATH, TMPDIR, a sandboxed HOME, and only the KOSMOS_*
 *      keys set here), never this shell's, which may carry real keys.
 *   2. Cuts dev relay certs and starts the relay, pinned to the coordinator pubkey
 *      /v1/meta reports (the same key every Mac state dir pins at setup).
 *   3. Starts boards A, B (and later C) from this checkout, each with its own data
 *      root, workers, projects, launch dir, HOME, tunnel state and a fake tmux that
 *      logs what Kosmos types into the agent (typed.log).
 *   4. The Kosmos+ account is made through the coordinator's web sign-up (/v1/signup,
 *      with the terms version read off the served /signup page: the board's own setup
 *      route refuses to CREATE an account, #4454). A and B then both sign in to it
 *      through the board's Plus wizard routes (signin-start/verify/register), reading
 *      each dev code off the coordinator's stdout. Distinct mac_id, standing good.
 *   5. A makes a project and its own code; B verifies and joins it (edge "own:<ref>").
 *   6. Both seats up; A posts, B must hold it as an external row; B posts, A must hold
 *      it. Each computer has its own seat (two distinct relay members in one room).
 *      The inbound federated text never reaches the other board's pane (typed.log),
 *      while each board's OWN local post does (the instrument's positive control, on
 *      both boards). Both typed.logs are read again at the very end of the run.
 *   7. Controls that can fail: (a) board C on a DIFFERENT account joins with A's own
 *      code and must end up in a different room, exchanging nothing with A or B; then
 *      C is stopped and its seat must LEAVE the relay's member list (the control for the
 *      log parser's "disconnected" half), while A's and B's stay; (b) with the relay
 *      stopped, a post on A must not arrive on B (bounded wait) and a "not connected"
 *      note must be the very next row after THAT post in A's room (and the row after an
 *      earlier post must not be one); (c) the harness's own detector reports FAIL for a
 *      string that was never posted; (d) the relay-log parser is run on a fixture and must
 *      keep a seated member and drop a disconnected one; (e) the env allowlist check must
 *      flag a board's env, which is not service-shaped.
 *   8. PASS/FAIL per step, a verdict, exit 1 on any FAIL. Every process it started
 *      (and each one's descendants: seats, tunnels) is stopped by exact pid, and the
 *      sandbox removed, on success and on failure. Once stopping has begun no new
 *      process is started, and the stop is repeated until nothing it owns is left.
 *
 * SAFETY: processes are only ever signalled by exact pid, and only pids this run
 * started or found as their descendants, or whose command line names this run's
 * sandbox. Never a process-group, user-wide or name-pattern kill.
 *
 * Helper names carry a `fedproof` prefix where a plain name (cleanup, readLog...) could
 * match an engine export: engine.reachable.test.js counts any file under tools/ that
 * names an export as its caller, so a generic name here could hide a real orphan.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
// This Mac's external SSD; on any other machine FEDPROOF_BIN_DIR must be set.
const BIN_DIR = process.env.FEDPROOF_BIN_DIR || '/Volumes/BigLobsterStorage/targets/renet-4693/debug';
const BIN = {
  coordinator: path.join(BIN_DIR, 'kosmos-coordinator'),
  relay: path.join(BIN_DIR, 'kosmos-relay'),
  tunnel: path.join(BIN_DIR, 'kosmos-tunnel'),
};
const KEEP = process.env.FEDPROOF_KEEP === '1';
const DELIVERY_MS = Number(process.env.FEDPROOF_DELIVERY_MS) || 30000;   // how long a delivery may take
const ABSENCE_MS = Number(process.env.FEDPROOF_ABSENCE_MS) || 12000;     // how long an absence is watched
const SEND_MS = 30000;                                                      // how long a post may keep "staying local"
const LEAVE_MS = 30000;                                                     // how long a stopped seat may take to leave
// The bounded waits, worst case: coordinator 60 + relay 30 + 3 boards x 60 + 6 codes x 20
// + seats 90 + 3 sends x 30 + 2 deliveries x 30 + C's seat 45 + C leaving 30 + 2 absences
// x 12 + 7b send 30 + 2 = ~770 s, before HTTP timeouts. 15 min covers it with margin.
const WATCHDOG_MS = Number(process.env.FEDPROOF_WATCHDOG_MS) || 15 * 60 * 1000;
const RUN = crypto.randomBytes(3).toString('hex');
const T0 = Date.now();

const results = [];
let halted = false;   // a signal or the watchdog is tearing the run down: main's late checks are not reported
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
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fedown-4693-')));
const LOGS = path.join(SANDBOX, 'logs');
fs.mkdirSync(LOGS);
const started = [];   // { name, child, log }
let stopping = false; // set once the run is being torn down: no process may start after it

function fedproofPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}
const taken = new Set();
async function freePort() {
  for (let i = 0; i < 400; i++) {
    const p = 27000 + Math.floor(Math.random() * 1000);
    if (taken.has(p)) continue;
    if (await fedproofPortFree(p)) { taken.add(p); return p; }
  }
  throw new Error('no free port in 27000-27999');
}

function start(name, cmd, args, opts = {}) {
  if (stopping) throw new Error('the run is stopping; not starting ' + name);
  if (!opts.env) throw new Error('start(' + name + ') needs an explicit env');
  const log = path.join(LOGS, name + '.log');
  const fd = fs.openSync(log, 'a');
  const child = spawn(cmd, args, { cwd: opts.cwd || SANDBOX, env: opts.env, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  started.push({ name, child, log, env: opts.env });
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
/* The keys an env handed to the coordinator or relay may carry: anything else came from
   somewhere this harness did not choose. Returns the keys outside that list. */
const SERVICE_KEYS = new Set(['PATH', 'TMPDIR', 'HOME', 'NO_COLOR', 'RUST_LOG']);
function fedproofForeignKeys(env) {
  return Object.keys(env || {}).filter((k) => !SERVICE_KEYS.has(k) && !k.startsWith('KOSMOS_'));
}

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
/* One started process and every descendant it has now (seats, tunnels), by exact pid. */
async function stopTree(entry) {
  let table = [];
  try { table = psTable(); } catch { table = []; }
  const pid = entry.child.pid;
  await stopPids([...descendantsOf(pid, table), pid]);
}
/* Every pid this run owns that is still alive: the started processes, their descendants,
   and anything whose command line names the sandbox (a seat orphaned by its board). */
function ownedAlive() {
  let table = [];
  try { table = psTable(); } catch { table = []; }
  const pids = new Set();
  for (const e of started) {
    if (!e.child.pid) continue;
    if (e.child.exitCode === null && e.child.signalCode === null) pids.add(e.child.pid);
    for (const d of descendantsOf(e.child.pid, table)) pids.add(d);
  }
  for (const r of table) if (r.cmd.includes(SANDBOX) && r.pid !== process.pid) pids.add(r.pid);
  return [...pids].filter((p) => p !== process.pid && alive(p));
}
let cleaned = false;
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
  if (KEEP) console.log('kept sandbox: ' + SANDBOX);
  else { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* reported by the next run's leftovers */ } }
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

/* The web sign-up, as coordinator/src/signin.html drives it: the terms version is read off
   the served page (never hardcoded here), then signup start + verify with the dev code. */
async function webSignup(email) {
  const page = await fetch(REL.coordinator + '/signup', { signal: AbortSignal.timeout(10000) }).then((r) => r.text());
  const terms = (page.match(/var TERMS_VERSION = "([^"]+)"/) || [])[1];
  if (!terms) { info('the sign-up page carries no TERMS_VERSION'); return false; }
  const before = devCodes(email).length;
  let r = await http(REL.coordinator, 'POST', '/v1/signup/start', { email });
  if (r.status !== 200) { info('signup/start ' + r.status + ' ' + r.text.slice(0, 200)); return false; }
  const code = await nextCode(email, before);
  if (!code) { info('no signup code for ' + email); return false; }
  r = await http(REL.coordinator, 'POST', '/v1/signup/verify', { email, code, device_id: 'fedproof-web-' + RUN, device_name: 'fedproof browser', accepted_terms: terms });
  if (r.status !== 200) { info('signup/verify ' + r.status + ' ' + r.text.slice(0, 200)); return false; }
  return true;
}
/* A board signs in to an existing account: the in-app wizard's routes (#3149). */
async function boardSignin(b, email, name) {
  const before = devCodes(email).length;
  let r = await http(b.base, 'POST', '/api/remote/signin-start', { email });
  if (r.status !== 200) { info(b.letter + ' signin-start ' + r.status + ' ' + r.text.slice(0, 200)); return false; }
  const code = await nextCode(email, before);
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
  // What Kosmos types into the agent: a wrapper that logs set-buffer text, then acts as the fake tmux.
  b.typed = path.join(b.data, 'typed.log');
  fs.writeFileSync(b.typed, '');
  b.tmuxWrap = path.join(b.data, 'tmux-wrap.sh');
  fs.writeFileSync(b.tmuxWrap, '#!/bin/sh\n[ "$1" = set-buffer ] && printf \'%s\\n\' "$*" >> "' + b.typed + '"\nexec "'
    + path.join(REPO, 'test-support', 'fake-tmux.sh') + '" "$@"\n', { mode: 0o755 });
  const s = start('board-' + letter, process.execPath, [path.join(REPO, 'server.js')], { cwd: REPO, env: boardEnv(b) });
  b.proc = s;
  // A board that EXITED (a port taken between the check and its bind) is reported at once.
  const up = await waitFor(async () => {
    if (s.child.exitCode !== null) return { exited: true };
    return (await fetch(b.base + '/api/projects', { signal: AbortSignal.timeout(3000) })).ok;
  }, 60000, 250);
  if (!up || up.exited) throw new Error('board ' + letter + (up ? ' exited at start' : ' did not answer on ' + b.base) + ' (log: ' + s.log + ')\n' + fedproofReadLog(s.log).slice(-2000));
  return b;
}
function remoteJson(b) { try { return JSON.parse(fs.readFileSync(path.join(b.data, 'Kosmos', 'remote.json'), 'utf8')); } catch { return {}; } }
function fedproofStateFile(b, f) { try { return fs.readFileSync(path.join(b.state, f), 'utf8').trim(); } catch { return null; } }
async function roomText(b, id) {
  const r = await http(b.base, 'GET', '/api/project/' + encodeURIComponent(id) + '/room?as=text');
  return r.status === 200 ? r.text : '';
}
async function post(b, id, text) {
  const r = await http(b.base, 'POST', '/api/project/' + encodeURIComponent(id) + '/room', { text });
  return r;
}
/* The detector every delivery assertion uses: the text as an EXTERNAL row in b's room. */
async function hasExternal(b, id, text) {
  const t = await roomText(b, id);
  return t.split('\n').some((l) => l.includes(text) && /\[external (person|agent)\] /.test(l));
}
const ANY_STAYED = /stayed on this computer/i;
// ONLY the not-connected variants of engine/fedseats.js post(): the seat is down, or the
// own-room seat was refused. Not "ended", "nobody has joined", sealed-room or too-long.
const NOT_CONNECTED = /stayed on this computer: (the connection to the external project is not up right now|this project is not connected to your other computers right now)/;
/* The room lines AFTER the (last) line carrying `text`, or null if `text` is not there. */
async function linesAfter(b, id, text) {
  const lines = (await roomText(b, id)).split('\n');
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(text)) at = i;
  return at < 0 ? null : lines.slice(at + 1);
}
/* The first non-blank room line after the line carrying `text` ('' if none). A note is tied
   to a post by being the VERY NEXT row: a note from any other post would sit after that post. */
function fedproofNextLine(after) { return ((after || []).find((l) => l.trim()) || ''); }
/* Post, and repeat with a fresh text while the board answers that post with a "stayed on
   this computer" note (its seat not yet marked connected). The note is written in the same
   request (server.js federateOut), so it is in the room when the response arrives. */
async function postUntilSent(b, id, prefix) {
  const until = Date.now() + SEND_MS;
  const tried = [];
  for (;;) {
    const text = prefix + '-' + crypto.randomBytes(3).toString('hex');
    const r = await post(b, id, text);
    tried.push(text);
    const after = await linesAfter(b, id, text);
    const stayed = after && after.some((l) => ANY_STAYED.test(l));
    if (r.status === 200 && after && !stayed) return { text, r, tried };
    if (Date.now() > until) return { text: null, r, tried };
    await sleep(500);
  }
}

// ---------- relay log ----------
function relayMembers() { return fedproofParseMembers(stripAnsi(fedproofReadLog(REL.log))); }
/* The live members a relay log's text describes (pure, so it can be checked on a fixture). */
function fedproofParseMembers(text) {
  const seated = new Map();   // "room|member" -> live count
  // tracing's default line: `<time>  INFO <target>: federation member authenticated peer=.. room=.. member=..`
  // and `... federation member disconnected peer=.. room=.. member=..` (kosmos-relay serve.rs).
  for (const line of text.split('\n')) {
    const ev = line.match(/federation member (authenticated|disconnected)/);
    const room = line.match(/\broom=(\S+)/);
    const member = line.match(/\bmember=(\S+)/);
    if (!ev || !room || !member) continue;
    const k = room[1] + '|' + member[1];
    seated.set(k, (seated.get(k) || 0) + (ev[1] === 'authenticated' ? 1 : -1));
  }
  const live = [];
  for (const [k, n] of seated) if (n > 0) { const [room, member] = k.split('|'); live.push({ room, member }); }
  return live;
}

const TYPED_WATCH = [];   // { board, text, expect } re-read at the end of the run

async function main() {
  console.log('#4693 own-account room proof, run ' + RUN + ', sandbox ' + SANDBOX);
  for (const [k, p] of Object.entries(BIN)) if (!fs.existsSync(p)) throw new Error('missing ' + k + ' binary at ' + p + ' (set FEDPROOF_BIN_DIR)');

  // 1. coordinator
  const coordPort = await freePort();
  REL.coordinator = 'http://127.0.0.1:' + coordPort;
  const coordData = path.join(SANDBOX, 'coordinator');
  fs.mkdirSync(coordData);
  coord = start('coordinator', BIN.coordinator, [], { env: serviceEnv(path.join(SANDBOX, 'coordinator-home'), {
    KOSMOS_DEV_MODE: '1', KOSMOS_REQUIRE_SECOND: '0', KOSMOS_FEDERATION_LIVE: '1',
    KOSMOS_LISTEN: '127.0.0.1:' + coordPort, KOSMOS_DATA_DIR: coordData }) });
  // Load-tolerant (a debug build on a busy Mac), but a coordinator that EXITED (a port taken
  // between the check and its bind) is reported at once rather than waited on.
  const meta = await waitFor(async () => {
    if (coord.child.exitCode !== null) return { exited: true };
    const r = await http(REL.coordinator, 'GET', '/v1/meta'); return r.status === 200 && r.json;
  }, 60000);
  if (meta && meta.exited) throw new Error('the coordinator exited at start:\n' + fedproofReadLog(coord.log).slice(-2000));
  chk(meta && typeof meta.coordinator_pubkey === 'string', 'step 1: local coordinator answers /v1/meta', meta ? 'federation_live=' + meta.federation_live : 'no answer');
  if (!meta) throw new Error('coordinator did not come up:\n' + fedproofReadLog(coord.log).slice(-2000));
  chk(meta.federation_live === true, 'step 1: coordinator reports federation_live');

  // 2. relay
  const relayEnv = serviceEnv(path.join(SANDBOX, 'relay-home'), { RUST_LOG: 'info' });
  const tls = path.join(SANDBOX, 'relay-tls');
  execFileSync(BIN.relay, ['dev-cert', '--hosts', '127.0.0.1', '--out-dir', tls], { stdio: 'ignore', env: relayEnv });
  const pinned = path.join(SANDBOX, 'relay-coordinator-key');
  fs.writeFileSync(pinned, meta.coordinator_pubkey + '\n');
  const pub = await freePort();
  const tun = await freePort();
  REL.tunnelAddr = '127.0.0.1:' + tun;
  REL.ca = path.join(tls, 'ca.pem');
  REL.args = ['serve', '--public-addr', '127.0.0.1:' + pub, '--tunnel-addr', REL.tunnelAddr,
    '--tunnel-cert', path.join(tls, 'cert.pem'), '--tunnel-key', path.join(tls, 'key.pem'), '--coordinator-key', pinned];
  const rl = start('relay', BIN.relay, REL.args, { env: relayEnv });
  REL.proc = rl; REL.log = rl.log;
  const relayUp = await waitFor(() => {
    if (rl.child.exitCode !== null) return { exited: true };
    return new Promise((res) => { const s = net.connect(tun, '127.0.0.1', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
  }, 30000);
  if (relayUp && relayUp.exited) throw new Error('the relay exited at start:\n' + fedproofReadLog(rl.log).slice(-2000));
  chk(relayUp, 'step 2: local relay listens (tunnel ' + REL.tunnelAddr + '), pinned to the coordinator key');
  if (!relayUp) throw new Error('relay did not come up:\n' + fedproofReadLog(rl.log).slice(-2000));
  // The relay-log parser, on a fixture in the relay's own line shape: one member seated and
  // then disconnected, one seated and kept. Both halves must come out, or the live checks
  // below (seats up, nobody disconnected, C's seat left) could not tell anything apart.
  const fx = fedproofParseMembers([
    '2026-09-30T00:00:00Z  INFO kosmos_relay_server::serve: federation member authenticated peer=127.0.0.1:1 room=fxroom member=acct:mac1',
    '2026-09-30T00:00:01Z  INFO kosmos_relay_server::serve: federation member authenticated peer=127.0.0.1:2 room=fxroom member=acct:mac2',
    '2026-09-30T00:00:02Z  INFO kosmos_relay_server::serve: federation member disconnected peer=127.0.0.1:1 room=fxroom member=acct:mac1',
  ].join('\n')).map((m) => m.member);
  chk(fx.includes('acct:mac2'), 'step 2 control: the relay-log parser holds a seated member (fixture)', JSON.stringify(fx));
  chk(!fx.includes('acct:mac1'), 'step 2 control: the relay-log parser drops a member after its "disconnected" line (fixture)', JSON.stringify(fx));
  // The coordinator and relay were handed only the allowlisted keys (never this shell's).
  for (const e of started.filter((x) => x.name === 'coordinator' || x.name === 'relay')) {
    const foreign = fedproofForeignKeys(e.env);
    chk(e.env && e.env.HOME && e.env.HOME.startsWith(SANDBOX) && !foreign.length, 'step 2: the ' + e.name + ' got an allowlisted env with a sandboxed HOME',
      foreign.length ? 'foreign keys: ' + foreign.join(',') : 'keys: ' + Object.keys(e.env || {}).join(','));
  }

  // 3. boards A and B (startBoard throws if one does not answer, so this is a marker, not a check)
  const A = await startBoard('A');
  const B = await startBoard('B');
  info('step 3: boards A (' + A.port + ') and B (' + B.port + ') answer, each sandboxed with a fake agent');
  // Control for the env allowlist check: a board's env (AGENT_WORKFORCE_*, USER) is NOT
  // service-shaped, so the same instrument does flag foreign keys when there are some.
  const boardForeign = fedproofForeignKeys((started.find((x) => x.name === 'board-A') || {}).env);
  chk(boardForeign.length > 0, 'step 3 control: the env allowlist check flags foreign keys (board A\'s env has some)', boardForeign.slice(0, 4).join(','));

  // 4. The account is made the way a person makes it: the web sign-up page (it carries
  // the terms version the person ticks; the board's own setup route refuses to create an
  // account without it, #4454). Then BOTH boards sign in to it through the board's own
  // Plus wizard routes, as a person's two computers do.
  const email = 'fedproof-' + RUN + '@example.com';
  chk(await webSignup(email), 'step 4: the Kosmos+ account is created through the web sign-up (terms accepted)');
  chk(await boardSignin(A, email, 'fedown-a-' + RUN), 'step 4: A signs in to the account (signin-start/verify/register)');
  chk(await boardSignin(B, email, 'fedown-b-' + RUN), 'step 4: B signs in with the same email, as a second computer (same account is asserted at the seats, step 6)');
  const macA = fedproofStateFile(A, 'mac_id');
  const macB = fedproofStateFile(B, 'mac_id');
  chk(macA && macB && macA !== macB, 'step 4: both enrolled with distinct mac_id', (macA || '-') + ' / ' + (macB || '-'));
  chk(remoteJson(A).standing === 'good' && remoteJson(B).standing === 'good', 'step 4: both hold standing good (Kosmos+)',
    remoteJson(A).standing + ' / ' + remoteJson(B).standing);

  // 5. A: a project with an agent, and its own code. B: verify + join with that code.
  let r = await http(A.base, 'POST', '/api/projects', { name: 'Shared ' + RUN });
  const pidA = r.json && r.json.project && r.json.project.id;
  chk(!!pidA, 'step 5: A creates the project', r.status + ' ' + (pidA || r.text.slice(0, 200)));
  r = await http(A.base, 'POST', '/api/project/' + encodeURIComponent(pidA) + '/agent/' + A.agent);
  chk(r.status === 200, 'step 5: A adds its agent to the project', r.status + ' ' + r.text.slice(0, 160));
  r = await http(A.base, 'POST', '/api/federation/own-code', { project: pidA }, SCREEN);
  const own = r.json && r.json.code;
  chk(typeof own === 'string' && own.startsWith('kosmos-own:'), 'step 5: A makes the own code', r.status + ' ' + (own ? own.slice(0, 24) + '...' : r.text.slice(0, 200)));
  const ref = own ? JSON.parse(Buffer.from(own.slice('kosmos-own:'.length), 'base64url').toString('utf8')).ref : null;
  r = await http(B.base, 'POST', '/api/federation/verify', { code: own }, SCREEN);
  chk(r.status === 200 && r.json && r.json.edge_id === 'own:' + ref, 'step 5: B verifies the own code (edge own:<ref>)', r.status + ' ' + r.text.slice(0, 200));
  r = await http(B.base, 'POST', '/api/federation/join', { edge_id: 'own:' + ref, agents: [] }, SCREEN);
  const pidB = r.json && r.json.id;
  chk(r.status === 200 && !!pidB, 'step 5: B joins the shared project', r.status + ' ' + (pidB || r.text.slice(0, 200)));
  r = await http(B.base, 'POST', '/api/project/' + encodeURIComponent(pidB) + '/agent/' + B.agent);
  chk(r.status === 200, 'step 5: B adds its agent to the joined project', r.status + ' ' + r.text.slice(0, 160));

  // 6. seats, then posts both ways.
  const seats = await waitFor(() => {
    const live = relayMembers();
    const byRoom = new Map();
    for (const s of live) byRoom.set(s.room, (byRoom.get(s.room) || new Set()).add(s.member));
    for (const [room, members] of byRoom) if (members.size >= 2) return { room, members: [...members] };
    return null;
  }, 90000, 500);
  chk(!!seats, 'step 6: two seats up in ONE relay room, one per computer (distinct members)',
    seats ? 'room ' + seats.room.slice(0, 12) + '... members ' + seats.members.join(', ') : 'live: ' + JSON.stringify(relayMembers()));
  if (!seats) throw new Error('the seats never came up; see board logs');
  // A relay member is `<account>:<mac_id>` (kosmos-relay #213, a seat per computer): one account part,
  // and each board's OWN mac_id as a seat.
  const parts = seats.members.map((m) => m.split(':'));
  chk(parts.every((p) => p.length === 2) && parts[0][0] === parts[1][0], 'step 6: both seats belong to ONE account', parts.map((p) => p[0]).join(' / '));
  chk(new Set(parts.map((p) => p[1])).size === 2 && parts.some((p) => p[1] === macA) && parts.some((p) => p[1] === macB),
    'step 6: each computer holds its OWN seat (member = its own mac_id)', parts.map((p) => p[1]).join(' / '));

  // The board marks a seat connected when the connector prints its event, just after the
  // relay's line; a post before that is answered "stayed on this computer", so retry until not.
  const sa = await postUntilSent(A, pidA, 'from-A-' + RUN);
  const aText = sa.text;
  chk(!!aText && sa.r.json && sa.r.json.delivery && sa.r.json.delivery.state !== 'could_not', 'step 6: A posts into the room and it is not kept local',
    'attempts ' + sa.tried.length + ', ' + sa.r.text.slice(0, 160));
  const gotA = aText && await waitFor(() => hasExternal(B, pidB, aText), DELIVERY_MS);
  chk(!!gotA, 'step 6: A\'s post arrives on B as an external row');
  const sb = await postUntilSent(B, pidB, 'from-B-' + RUN);
  const bText = sb.text;
  chk(!!bText && sb.r.json && sb.r.json.delivery && sb.r.json.delivery.state !== 'could_not', 'step 6: B posts into the room and it is not kept local',
    'attempts ' + sb.tried.length + ', ' + sb.r.text.slice(0, 160));
  const gotB = bText && await waitFor(() => hasExternal(A, pidA, bText), DELIVERY_MS);
  chk(!!gotB, 'step 6: B\'s post arrives on A as an external row');
  // Read off the relay log's authenticated/disconnected pairs. The "disconnected" half is
  // proven parseable by the live control at the end of 7a (C's seat must leave).
  const still = relayMembers().filter((s) => s.room === seats.room);
  chk(still.length >= 2 && new Set(still.map((s) => s.member)).size >= 2, 'step 6: after both posts, the relay log shows no disconnect of either seat',
    still.map((s) => s.member).join(', '));
  // Inbound is a stored row, never typed into a pane. The instrument must be able to see
  // a typed line at all, on BOTH boards: each board's OWN local post is typed into its agent.
  chk(!!aText && fedproofReadLog(A.typed).includes(aText), 'step 6 control: A\'s typed.log records what Kosmos types (A\'s own post reached A\'s agent)');
  chk(!!bText && fedproofReadLog(B.typed).includes(bText), 'step 6 control: B\'s typed.log records what Kosmos types (B\'s own post reached B\'s agent)');
  chk(!fedproofReadLog(B.typed).includes(aText), 'step 6: A\'s federated post was NOT typed into B\'s agent pane (inbound is a stored row)');
  chk(!fedproofReadLog(A.typed).includes(bText), 'step 6: B\'s federated post was NOT typed into A\'s agent pane');
  TYPED_WATCH.push({ board: A, text: aText, expect: true }, { board: B, text: bText, expect: true },
    { board: B, text: aText, expect: false }, { board: A, text: bText, expect: false });

  // 7c. the harness's own detector reports absence for a string never posted.
  const never = 'never-posted-' + RUN;
  const falsePos = await waitFor(() => hasExternal(B, pidB, never), 2000);
  chk(!falsePos, 'step 7c: negative control, the detector reports FAIL for a string that was never posted');

  // 7a. a DIFFERENT account cannot use A's own code to reach A's room.
  const C = await startBoard('C');
  const emailC = 'fedproof-other-' + RUN + '@example.com';
  const cOk = (await webSignup(emailC)) && (await boardSignin(C, emailC, 'fedother-c-' + RUN));
  chk(cOk && remoteJson(C).standing === 'good' && fedproofStateFile(C, 'mac_id'), 'step 7a: board C signs in on a DIFFERENT Kosmos+ account (standing good)');
  r = await http(C.base, 'POST', '/api/federation/verify', { code: own }, SCREEN);
  const cVerify = r.status;
  let pidC = null;
  if (r.status === 200) {
    r = await http(C.base, 'POST', '/api/federation/join', { edge_id: 'own:' + ref, agents: [] }, SCREEN);
    pidC = r.status === 200 && r.json ? r.json.id : null;
  }
  info('C verify ' + cVerify + ', join ' + (pidC ? 'made project ' + pidC : 'refused'));
  // Reported, not failed: the SAFETY property (nothing crosses accounts) is what this control
  // asserts. An own code carries no account, so another account's computer accepts it and makes
  // a project whose seat sits alone in its own account's room, with no word that it never will
  // connect (kosmos#4693 finding for #4649).
  if (pidC) console.log('NOTE  a different account\'s computer ACCEPTED the own code (verify ' + cVerify + ', join 200): it gets a project that can never connect, and no refusal says why');
  if (pidC) {
    // C joined locally; its seat must be in ITS account's room, never A's.
    const cSeat = await waitFor(() => relayMembers().find((s) => s.room !== seats.room && !seats.members.includes(s.member)), 45000, 500);
    const cInARoom = relayMembers().filter((s) => s.room === seats.room);
    chk(cInARoom.length === 2, 'step 7a: A\'s room still holds exactly the two same-account seats (C is not in it)', cInARoom.map((s) => s.member).join(', '));
    // Without this the absence below could be C simply having no seat; with it, C is seated,
    // in its own account's room.
    chk(!!cSeat, 'step 7a: C holds a seat, in a DIFFERENT room (its own account\'s)', cSeat ? 'room ' + cSeat.room.slice(0, 12) + '... member ' + cSeat.member : 'no seat seen');
    const sc = await postUntilSent(C, pidC, 'from-C-' + RUN);
    const cText = sc.text;
    chk(!!cText && sc.r.json && sc.r.json.delivery && sc.r.json.delivery.state !== 'could_not', 'step 7a: C posts into its room and it is not kept local',
      'attempts ' + sc.tried.length + ', ' + sc.r.text.slice(0, 160));
    const aText2 = 'from-A-again-' + RUN;
    r = await post(A, pidA, aText2);
    chk(r.status === 200, 'step 7a: A posts a second time', r.status + ' ' + r.text.slice(0, 120));
    TYPED_WATCH.push({ board: B, text: aText2, expect: false });
    const cTexts = sc.tried;   // every C attempt, not only the one that went
    const leak = await waitFor(async () => {
      for (const t of cTexts) if ((await hasExternal(A, pidA, t)) || (await hasExternal(B, pidB, t))) return true;
      return hasExternal(C, pidC, aText2);
    }, ABSENCE_MS);
    chk(!leak, 'step 7a: nothing crosses between C and A/B (watched ' + ABSENCE_MS / 1000 + ' s)');
    // The watch was live: A's second post DID reach B in the same window.
    chk(await hasExternal(B, pidB, aText2), 'step 7a control: in that window A\'s second post did reach B');
    const cNotes = (await roomText(C, pidC)).split('\n').filter((l) => l.includes('[kosmos]'));
    info('what C\'s room tells its person: ' + (cNotes.length ? cNotes.map((l) => l.trim()).join(' | ') : '(no Kosmos note)'));
    // Control for the relay-log parser's "disconnected" half: stop board C (its exact pid and
    // descendants) and C's member must LEAVE the live list, while A's and B's stay. Without
    // this, the "no disconnect" checks could not fail if the relay's wording changed.
    if (cSeat) {
      await stopTree(C.proc);
      const gone = await waitFor(() => !relayMembers().some((s) => s.member === cSeat.member && s.room === cSeat.room), LEAVE_MS, 300);
      chk(!!gone, 'step 7a control: board C stopped, and its seat LEAVES the relay\'s member list (the parser sees a disconnect)',
        'live: ' + relayMembers().map((s) => s.member).join(', '));
      const kept = relayMembers().filter((s) => s.room === seats.room).map((s) => s.member);
      chk(seats.members.every((m) => kept.includes(m)), 'step 7a: A\'s and B\'s seats are still held after C\'s left (a disconnect of theirs would show)', kept.join(', '));
    }
  } else {
    info('step 7a: C could not join with A\'s own code (refused at verify/join)');
    console.log('NOTE  C never held a seat, so the relay-log parser\'s "disconnected" half had no live control this run; the step 6 no-disconnect check is unproven');
  }

  // 7b. relay down: a post is not delivered, and A does not claim it was.
  await stopTree(REL.proc);
  const down = await waitFor(() => !alive(REL.proc.child.pid), 5000, 100);
  chk(!!down, 'step 7b: relay stopped');
  // Post until A answers a post with the not-connected note (its seat has seen the relay go).
  // The note must follow THAT post in A's room, and the count of such notes must rise.
  const dTried = [];
  let dText = null;
  let dResp = null;
  const noteCount = async () => (await roomText(A, pidA)).split('\n').filter((l) => NOT_CONNECTED.test(l)).length;
  const notesBefore = await noteCount();
  await waitFor(async () => {
    const t = 'while-relay-down-' + RUN + '-' + crypto.randomBytes(3).toString('hex');
    const pr = await post(A, pidA, t);
    dTried.push(t);
    const after = await linesAfter(A, pidA, t);
    if (NOT_CONNECTED.test(fedproofNextLine(after))) { dText = t; dResp = pr; return true; }
    return false;
  }, SEND_MS, 500);
  const notesAfter = await noteCount();
  chk(!!dText && dResp.status === 200 && dResp.json && dResp.json.delivery && dResp.json.delivery.state !== 'could_not',
    'step 7b: A\'s post while the relay is down is placed locally (response 200, not could_not)',
    dResp ? dResp.status + ' ' + dResp.text.slice(0, 160) : 'no post was answered with a not-connected note');
  if (dTried.length > 1) console.log('NOTE  ' + (dTried.length - 1) + ' post(s) after the relay stopped got no note (the seat had not yet seen it go); they are watched below too');
  const aAfter = dText ? await linesAfter(A, pidA, dText) : null;
  const aNext = fedproofNextLine(aAfter);
  chk(!!dText && NOT_CONNECTED.test(aNext) && notesAfter > notesBefore,
    'step 7b: A says THAT post stayed on this computer, not connected (the note is the very next row after it, count ' + notesBefore + ' -> ' + notesAfter + ')',
    (aNext || 'no such note').trim().slice(0, 160));
  // Control for that tie: the row right after an EARLIER post (A's second post in 7a, or its
  // first in step 6) is not a not-connected note, so "the next row" does not pass for any post.
  const earlier = TYPED_WATCH.find((w) => w.board === A && w.expect && w.text);
  const earlierAfter = earlier ? await linesAfter(A, pidA, earlier.text) : null;
  const earlierNext = fedproofNextLine(earlierAfter);
  chk(!!earlierAfter && !NOT_CONNECTED.test(earlierNext), 'step 7b control: the row after A\'s step 6 post is NOT a not-connected note (the tie discriminates)',
    (earlierNext || '(end of room)').trim().slice(0, 120));
  const delivered = await waitFor(async () => { for (const t of dTried) if (await hasExternal(B, pidB, t)) return true; return false; }, ABSENCE_MS);
  chk(!delivered, 'step 7b: with the relay down, none of A\'s posts arrives on B (watched ' + ABSENCE_MS / 1000 + ' s)');

  // End of run: a delayed typing path would put a federated text into a pane late.
  for (const w of TYPED_WATCH) {
    if (!w.text) continue;
    const has = fedproofReadLog(w.board.typed).includes(w.text);
    chk(has === w.expect, 'end: ' + w.board.letter + '\'s typed.log ' + (w.expect ? 'still holds its own post (control)' : 'still does NOT hold the federated ' + w.text.split('-' + RUN)[0]));
  }
}

(async () => {
  const dog = setTimeout(() => { console.log('FAIL  watchdog: the run took over ' + WATCHDOG_MS / 1000 + ' s'); results.push({ ok: false }); halted = true; fedproofFinish(1); }, WATCHDOG_MS);
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
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (!halted) console.log('interrupted (' + sig + ')'); results.push({ ok: false }); halted = true; fedproofFinish(1); });
