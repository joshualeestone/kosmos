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
 *      FEDPROOF_BIN_DIR defaults to /Volumes/BigLobsterStorage/targets/renet-4693/debug.
 *      FEDPROOF_KEEP=1 keeps the sandbox (logs, data roots) and prints its path.
 *
 * WHAT IT DOES (every file under ONE mktemp sandbox, every port a free high port,
 * checked free before use; the live board and 16180-16199 are never touched)
 *   1. Starts the coordinator (KOSMOS_DEV_MODE=1: codes to stdout, REQUIRE_SECOND=0,
 *      FEDERATION_LIVE=1) and waits on GET /v1/meta.
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
 *      The inbound federated text never reaches B's pane (typed.log), while B's own
 *      local post does (the instrument's positive control).
 *   7. Controls that can fail: (a) board C on a DIFFERENT account joins with A's own
 *      code and must end up in a different room, exchanging nothing with A or B;
 *      (b) with the relay stopped, a post on A must not arrive on B (bounded wait)
 *      and A must say it stayed local; (c) the harness's own detector reports FAIL
 *      for a string that was never posted.
 *   8. PASS/FAIL per step, a verdict, exit 1 on any FAIL. Every process it started
 *      (and each one's descendants: seats, tunnels) is stopped by exact pid, and the
 *      sandbox removed, on success and on failure.
 *
 * SAFETY: processes are only ever signalled by exact pid, and only pids this run
 * started or found as their descendants, or whose command line names this run's
 * sandbox. Never a process-group, user-wide or name-pattern kill.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const BIN_DIR = process.env.FEDPROOF_BIN_DIR || '/Volumes/BigLobsterStorage/targets/renet-4693/debug';
const BIN = {
  coordinator: path.join(BIN_DIR, 'kosmos-coordinator'),
  relay: path.join(BIN_DIR, 'kosmos-relay'),
  tunnel: path.join(BIN_DIR, 'kosmos-tunnel'),
};
const KEEP = process.env.FEDPROOF_KEEP === '1';
const DELIVERY_MS = Number(process.env.FEDPROOF_DELIVERY_MS) || 30000;   // how long a delivery may take
const ABSENCE_MS = Number(process.env.FEDPROOF_ABSENCE_MS) || 12000;     // how long an absence is watched
const WATCHDOG_MS = 8 * 60 * 1000;
const RUN = crypto.randomBytes(3).toString('hex');
const T0 = Date.now();

const results = [];
function chk(ok, label, extra) {
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

function portFree(port) {
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
    if (await portFree(p)) { taken.add(p); return p; }
  }
  throw new Error('no free port in 27000-27999');
}

function start(name, cmd, args, opts = {}) {
  const log = path.join(LOGS, name + '.log');
  const fd = fs.openSync(log, 'a');
  const child = spawn(cmd, args, { cwd: opts.cwd || SANDBOX, env: opts.env || process.env, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  started.push({ name, child, log });
  child.on('exit', (code, sig) => { fs.appendFileSync(log, '\n[harness] exited code=' + code + ' signal=' + sig + '\n'); });
  return { child, log };
}
function readLog(log) { try { return fs.readFileSync(log, 'utf8'); } catch { return ''; } }
function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }

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
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  let table = [];
  try { table = psTable(); } catch { table = []; }
  const pids = [];
  for (const e of started) { if (e.child.pid) { pids.push(e.child.pid, ...descendantsOf(e.child.pid, table)); } }
  // And anything still running whose command line names this run's sandbox (an orphaned
  // seat or tunnel whose board already exited): exact pids, never a pattern kill.
  for (const r of table) if (r.cmd.includes(SANDBOX) && r.pid !== process.pid) pids.push(r.pid);
  await stopPids(pids);
  let left = [];
  try { left = psTable().filter((r) => r.cmd.includes(SANDBOX) && r.pid !== process.pid); } catch { left = []; }
  if (left.length) console.log('WARN  processes still naming the sandbox: ' + left.map((r) => r.pid).join(','));
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
  const text = readLog(coord.log);
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
  const up = await waitFor(async () => (await fetch(b.base + '/api/projects', { signal: AbortSignal.timeout(3000) })).ok, 60000, 250);
  if (!up) throw new Error('board ' + letter + ' did not answer on ' + b.base + ' (log: ' + s.log + ')\n' + readLog(s.log).slice(-2000));
  return b;
}
function remoteJson(b) { try { return JSON.parse(fs.readFileSync(path.join(b.data, 'Kosmos', 'remote.json'), 'utf8')); } catch { return {}; } }
function stateFile(b, f) { try { return fs.readFileSync(path.join(b.state, f), 'utf8').trim(); } catch { return null; } }
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

// ---------- relay log ----------
function relayMembers() {
  const text = stripAnsi(readLog(REL.log));
  const seated = new Map();   // "room|member" -> live count
  // tracing's default line: `<time>  INFO <target>: federation member authenticated peer=.. room=.. member=..`
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

async function main() {
  console.log('#4693 own-account room proof, run ' + RUN + ', sandbox ' + SANDBOX);
  for (const [k, p] of Object.entries(BIN)) if (!fs.existsSync(p)) throw new Error('missing ' + k + ' binary at ' + p + ' (set FEDPROOF_BIN_DIR)');

  // 1. coordinator
  const coordPort = await freePort();
  REL.coordinator = 'http://127.0.0.1:' + coordPort;
  const coordData = path.join(SANDBOX, 'coordinator');
  fs.mkdirSync(coordData);
  coord = start('coordinator', BIN.coordinator, [], { env: Object.assign({}, process.env, {
    KOSMOS_DEV_MODE: '1', KOSMOS_REQUIRE_SECOND: '0', KOSMOS_FEDERATION_LIVE: '1',
    KOSMOS_LISTEN: '127.0.0.1:' + coordPort, KOSMOS_DATA_DIR: coordData, NO_COLOR: '1' }) });
  // Load-tolerant (a debug build on a busy Mac), but a coordinator that EXITED (a port taken
  // between the check and its bind) is reported at once rather than waited on.
  const meta = await waitFor(async () => {
    if (coord.child.exitCode !== null) return { exited: true };
    const r = await http(REL.coordinator, 'GET', '/v1/meta'); return r.status === 200 && r.json;
  }, 60000);
  if (meta && meta.exited) throw new Error('the coordinator exited at start:\n' + readLog(coord.log).slice(-2000));
  chk(meta && typeof meta.coordinator_pubkey === 'string', 'step 1: local coordinator answers /v1/meta', meta ? 'federation_live=' + meta.federation_live : 'no answer');
  if (!meta) throw new Error('coordinator did not come up:\n' + readLog(coord.log).slice(-2000));
  chk(meta.federation_live === true, 'step 1: coordinator reports federation_live');

  // 2. relay
  const tls = path.join(SANDBOX, 'relay-tls');
  execFileSync(BIN.relay, ['dev-cert', '--hosts', '127.0.0.1', '--out-dir', tls], { stdio: 'ignore' });
  const pinned = path.join(SANDBOX, 'relay-coordinator-key');
  fs.writeFileSync(pinned, meta.coordinator_pubkey + '\n');
  const pub = await freePort();
  const tun = await freePort();
  REL.tunnelAddr = '127.0.0.1:' + tun;
  REL.ca = path.join(tls, 'ca.pem');
  REL.args = ['serve', '--public-addr', '127.0.0.1:' + pub, '--tunnel-addr', REL.tunnelAddr,
    '--tunnel-cert', path.join(tls, 'cert.pem'), '--tunnel-key', path.join(tls, 'key.pem'), '--coordinator-key', pinned];
  const relayEnv = Object.assign({}, process.env, { NO_COLOR: '1', RUST_LOG: 'info' });
  const rl = start('relay', BIN.relay, REL.args, { env: relayEnv });
  REL.proc = rl; REL.log = rl.log;
  const relayUp = await waitFor(() => new Promise((res) => { const s = net.connect(tun, '127.0.0.1', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); }), 30000);
  chk(relayUp, 'step 2: local relay listens (tunnel ' + REL.tunnelAddr + '), pinned to the coordinator key');
  if (!relayUp) throw new Error('relay did not come up:\n' + readLog(rl.log).slice(-2000));

  // 3. boards A and B
  const A = await startBoard('A');
  const B = await startBoard('B');
  chk(true, 'step 3: boards A (' + A.port + ') and B (' + B.port + ') answer, each sandboxed with a fake agent');

  // 4. The account is made the way a person makes it: the web sign-up page (it carries
  // the terms version the person ticks; the board's own setup route refuses to create an
  // account without it, #4454). Then BOTH boards sign in to it through the board's own
  // Plus wizard routes, as a person's two computers do.
  const email = 'fedproof-' + RUN + '@example.com';
  chk(await webSignup(email), 'step 4: the Kosmos+ account is created through the web sign-up (terms accepted)');
  chk(await boardSignin(A, email, 'fedown-a-' + RUN), 'step 4: A signs in to the account (signin-start/verify/register)');
  chk(await boardSignin(B, email, 'fedown-b-' + RUN), 'step 4: B signs in with the same email, as a second computer (same account is asserted at the seats, step 6)');
  const macA = stateFile(A, 'mac_id');
  const macB = stateFile(B, 'mac_id');
  chk(macA && macB && macA !== macB, 'step 4: both enrolled with distinct mac_id', (macA || '-') + ' / ' + (macB || '-'));
  chk(remoteJson(A).standing === 'good' && remoteJson(B).standing === 'good', 'step 4: both hold standing good (Kosmos+)',
    remoteJson(A).standing + ' / ' + remoteJson(B).standing);

  // 5. A: a project with an agent, and its own code. B: verify + join with that code.
  let r = await http(A.base, 'POST', '/api/projects', { name: 'Shared ' + RUN });
  const pidA = r.json && r.json.project && r.json.project.id;
  chk(!!pidA, 'step 5: A creates the project', r.status + ' ' + (pidA || r.text.slice(0, 200)));
  await http(A.base, 'POST', '/api/project/' + encodeURIComponent(pidA) + '/agent/' + A.agent);
  r = await http(A.base, 'POST', '/api/federation/own-code', { project: pidA }, SCREEN);
  const own = r.json && r.json.code;
  chk(typeof own === 'string' && own.startsWith('kosmos-own:'), 'step 5: A makes the own code', r.status + ' ' + (own ? own.slice(0, 24) + '...' : r.text.slice(0, 200)));
  const ref = own ? JSON.parse(Buffer.from(own.slice('kosmos-own:'.length), 'base64url').toString('utf8')).ref : null;
  r = await http(B.base, 'POST', '/api/federation/verify', { code: own }, SCREEN);
  chk(r.status === 200 && r.json && r.json.edge_id === 'own:' + ref, 'step 5: B verifies the own code (edge own:<ref>)', r.status + ' ' + r.text.slice(0, 200));
  r = await http(B.base, 'POST', '/api/federation/join', { edge_id: 'own:' + ref, agents: [] }, SCREEN);
  const pidB = r.json && r.json.id;
  chk(r.status === 200 && !!pidB, 'step 5: B joins the shared project', r.status + ' ' + (pidB || r.text.slice(0, 200)));
  await http(B.base, 'POST', '/api/project/' + encodeURIComponent(pidB) + '/agent/' + B.agent);

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
  await sleep(1500);   // the board marks a seat connected when the connector prints its event, just after the relay's line

  const aText = 'from-A-' + RUN + '-' + crypto.randomBytes(3).toString('hex');
  r = await post(A, pidA, aText);
  chk(r.status === 200 && r.json && r.json.delivery && r.json.delivery.state !== 'could_not', 'step 6: A posts into the room', r.text.slice(0, 200));
  const gotA = await waitFor(() => hasExternal(B, pidB, aText), DELIVERY_MS);
  chk(!!gotA, 'step 6: A\'s post arrives on B as an external row');
  const bText = 'from-B-' + RUN + '-' + crypto.randomBytes(3).toString('hex');
  r = await post(B, pidB, bText);
  chk(r.status === 200 && r.json && r.json.delivery && r.json.delivery.state !== 'could_not', 'step 6: B posts into the room', r.text.slice(0, 200));
  const gotB = await waitFor(() => hasExternal(A, pidA, bText), DELIVERY_MS);
  chk(!!gotB, 'step 6: B\'s post arrives on A as an external row');
  const still = relayMembers().filter((s) => s.room === seats.room);
  chk(still.length >= 2 && new Set(still.map((s) => s.member)).size >= 2, 'step 6: after both posts, both computers still hold their own seat (no eviction)',
    still.map((s) => s.member).join(', '));
  // Inbound is a stored row, never typed into a pane. The instrument must be able to see
  // a typed line at all: B's OWN local post is typed into B's agent (positive control).
  const typedB = readLog(B.typed);
  chk(typedB.includes(bText), 'step 6 control: typed.log does record what Kosmos types (B\'s own post reached B\'s agent)');
  chk(!typedB.includes(aText), 'step 6: A\'s federated post was NOT typed into B\'s agent pane (inbound is a stored row)');
  chk(!readLog(A.typed).includes(bText), 'step 6: B\'s federated post was NOT typed into A\'s agent pane');

  // 7c. the harness's own detector reports absence for a string never posted.
  const never = 'never-posted-' + RUN;
  const falsePos = await waitFor(() => hasExternal(B, pidB, never), 2000);
  chk(!falsePos, 'step 7c: negative control, the detector reports FAIL for a string that was never posted');

  // 7a. a DIFFERENT account cannot use A's own code to reach A's room.
  const C = await startBoard('C');
  const emailC = 'fedproof-other-' + RUN + '@example.com';
  const cOk = (await webSignup(emailC)) && (await boardSignin(C, emailC, 'fedother-c-' + RUN));
  chk(cOk && remoteJson(C).standing === 'good' && stateFile(C, 'mac_id'), 'step 7a: board C signs in on a DIFFERENT Kosmos+ account (standing good)');
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
    await sleep(1500);
    const cText = 'from-C-' + RUN;
    await post(C, pidC, cText);
    const aText2 = 'from-A-again-' + RUN;
    await post(A, pidA, aText2);
    const leak = await waitFor(async () => (await hasExternal(A, pidA, cText)) || (await hasExternal(B, pidB, cText)) || (await hasExternal(C, pidC, aText2)), ABSENCE_MS);
    chk(!leak, 'step 7a: nothing crosses between C and A/B (watched ' + ABSENCE_MS / 1000 + ' s)');
    // The watch was live: A's second post DID reach B in the same window.
    chk(await hasExternal(B, pidB, aText2), 'step 7a control: in that window A\'s second post did reach B');
    const cNotes = (await roomText(C, pidC)).split('\n').filter((l) => l.includes('[kosmos]'));
    info('what C\'s room tells its person: ' + (cNotes.length ? cNotes.map((l) => l.trim()).join(' | ') : '(no Kosmos note)'));
  } else {
    chk(true, 'step 7a: C could not join with A\'s own code (refused at verify/join)');
  }

  // 7b. relay down: a post is not delivered, and A does not claim it was.
  await stopTree(REL.proc);
  const down = await waitFor(() => !alive(REL.proc.child.pid), 5000, 100);
  chk(!!down, 'step 7b: relay stopped');
  await sleep(3000);   // let each seat see the relay go
  const dText = 'while-relay-down-' + RUN;
  r = await post(A, pidA, dText);
  const delivered = await waitFor(() => hasExternal(B, pidB, dText), ABSENCE_MS);
  chk(!delivered, 'step 7b: with the relay down, A\'s post does not arrive on B (watched ' + ABSENCE_MS / 1000 + ' s)');
  const aRoom = await roomText(A, pidA);
  chk(/stayed on this computer/i.test(aRoom), 'step 7b: A says the post stayed on this computer (not claimed delivered)',
    (aRoom.split('\n').filter((l) => /stayed on this computer/i.test(l)).pop() || 'no such note').slice(0, 160));
}

(async () => {
  const dog = setTimeout(() => { console.log('FAIL  watchdog: the run took over ' + WATCHDOG_MS / 1000 + ' s'); results.push({ ok: false }); finish(1); }, WATCHDOG_MS);
  let crashed = null;
  try { await main(); } catch (err) { crashed = err; }
  clearTimeout(dog);
  if (crashed) chk(false, 'harness stopped early: ' + (crashed && crashed.message ? crashed.message.split('\n')[0] : crashed));
  const failed = results.filter((x) => !x.ok).length;
  if (failed || crashed) {
    if (crashed && crashed.message && crashed.message.includes('\n')) console.log(crashed.message);
    for (const e of started) { console.log('---- tail of ' + e.name + ' ----'); console.log(stripAnsi(readLog(e.log)).split('\n').slice(-25).join('\n')); }
  }
  await finish(failed ? 1 : 0);
})();
let finishing = false;
async function finish(code) {
  if (finishing) return;
  finishing = true;
  await cleanup();
  const failed = results.filter((x) => !x.ok).length;
  console.log('VERDICT ' + (code === 0 && !failed ? 'PASS' : 'FAIL') + '  (' + (results.length - failed) + '/' + results.length + ' checks, '
    + Math.round((Date.now() - T0) / 1000) + ' s)');
  process.exit(code === 0 && !failed ? 0 : 1);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('interrupted'); results.push({ ok: false }); finish(1); });
