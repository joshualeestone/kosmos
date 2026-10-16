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
 *   3-4  the parent signs up on the web (a browser session) and on P; the child's account signs up and signs in on K;
 *        P allows the parent's browser, as the console needs an allowed sign-in.
 *   5    the operator makes the family: org-create --kind family, the parent its admin.
 *   6    the parent makes a join code in the console (/v1/org/invites).
 *   7    K previews it: a family, with the family's own words (no company), and nothing joined (control).
 *   8    a join that does not say the words were shown is refused, org_family_words_unseen (the control for 9).
 *   9    with the words read and accepted on K, K joins; its board says family; the coordinator's audit row records
 *        the join with "words shown on the board's screen (the board's word)".
 *   10   the spent code, previewed again, is refused in words that name no company.
 *   11   K leaves the family.
 * Nothing here is production: every service and board runs under one mktemp sandbox on free high ports.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
// This Mac's external SSD; on any other machine FEDPROOF_BIN_DIR must be set.
// Absolute: the services run with cwd SANDBOX and the boards with cwd REPO, and the orphan
// sweep compares command lines against these exact paths.
const BIN_DIR = path.resolve(process.env.FEDPROOF_BIN_DIR || '/Volumes/BigLobsterStorage/targets/renet-4693/debug');
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
/* One started process and every descendant it has now (seats, tunnels), by exact pid. */
async function stopTree(entry) {
  let table = [];
  try { table = psTable(); } catch { table = []; }
  const own = ownedDescendants(entry, table);
  await stopPids(isLive(entry) ? [...own, entry.child.pid] : own);   // exited: never signal its own pid
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
  // editor, a grep) runs something else and is never matched.
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
    // #4253: three boards per run, each a fresh install id; never phone home, report, or post to the community.
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
  // Every call that is not one of the fake's reads is recorded with its arguments, and
  // load-buffer's text too (a file, or stdin via '-'), so a federated text that reached a pane
  // by ANY verb (set-buffer, paste-buffer, send-keys -l, load-buffer) is in typed.log.
  const fake = path.join(REPO, 'test-support', 'fake-tmux.sh');
  fs.writeFileSync(b.tmuxWrap, [
    '#!/bin/sh',
    'T="' + b.typed + '"',
    'case "$1" in',
    '  list-panes|list-sessions|capture-pane|display-message|has-session) ;;',
    '  load-buffer)',
    '    printf \'%s\\n\' "$*" >> "$T"',
    '    for a in "$@"; do last="$a"; done',
    '    if [ "$last" = - ]; then tee -a "$T" | "' + fake + '" "$@"; exit $?; fi',
    '    [ -f "$last" ] && cat "$last" >> "$T" ;;',
    '  *) printf \'%s\\n\' "$*" >> "$T" ;;',
    'esac',
    'exec "' + fake + '" "$@"',
    '',
  ].join('\n'), { mode: 0o755 });
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
// engine/fedseats.js farSide: "the external project" for another person's project, "the other computers in this
// project" for one shared between one person's own computers, the case this harness runs (the 10-06 02:54 run
// recorded 37 of these and the old pattern matched none).
const NOT_CONNECTED = /stayed on this computer: (the connection to (the external project|the other computers in this project) is not up right now|this project is not connected to your other computers right now)/;
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

/* kosmos#6239: the family join, end to end, as people do it. */
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

async function main() {
  console.log('#6239 family join proof, run ' + RUN + ', sandbox ' + SANDBOX);
  for (const [k, p] of Object.entries(BIN)) {
    if (!require(path.join(REPO, 'engine', 'runners')).isRunnable(p)) throw new Error('missing or not executable: ' + k + ' binary at ' + p + ' (set FEDPROOF_BIN_DIR)');
  }
  // 1. coordinator (as #4693: a loopback-only name, an allowlisted env, dev codes to its log)
  const coordAll = await require('node:dns').promises.lookup(FEDPROOF_COORD_HOST, { all: true }).catch((e) => ({ error: e }));
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
  if (!relayUp || relayUp.exited) throw new Error('the relay did not come up:\n' + fedproofReadLog(rl.log).slice(-2000));
  chk(true, 'step 2: local relay listens (tunnel ' + REL.tunnelAddr + ')');

  // 3. two boards: P, the parent's computer, and K, the child's.
  const P = await startBoard('P');
  const K = await startBoard('K');
  info('step 3: boards P (' + P.port + ') and K (' + K.port + ') answer');

  // 4. the parent signs up on the web (a browser session) and signs in on P; the child's account signs in on K.
  const parent = 'parent-' + RUN + '@example.com';
  const kid = 'kid-' + RUN + '@example.com';
  const webDevice = 'family-web-' + RUN;
  const sess = await webSignupSession(parent, webDevice);
  chk(!!sess, 'step 4: the parent\'s account is made through the web sign-up, with a browser session', sess ? 'device ' + sess.device_status : '-');
  chk(await boardSignin(P, parent, 'famp-' + RUN), 'step 4: P signs in as the parent');
  chk(await webSignupSession(kid, 'family-kidweb-' + RUN) !== null, 'step 4: the child\'s account is made through the web sign-up');
  chk(await boardSignin(K, kid, 'famk-' + RUN), 'step 4: K signs in as the child');

  // 4b. the parent's browser is allowed from P, as a person allows a new browser (the console needs an allowed sign-in).
  /* A browser is listed on a computer once it knocks there; this harness has no browser to knock, so P's Allow is sent
     with the code the sign-up answered (the four characters the person would match on screen), and the console's own
     answer below (an allowed sign-in, or session_not_allowed) is what shows the Allow took. */
  if (sess) {
    // CONTROL for step 6: before any Allow, the console refuses the parent's browser (not an allowed sign-in).
    const c = await http(REL.coordinator, 'POST', '/v1/org/invites', {}, bearer(sess.token));
    chk(c.status === 403 && /allow this sign-in on one of your computers first/.test(c.text), 'step 4b control: before the Allow, the console refuses the parent\'s browser', c.status + ' ' + c.text.slice(0, 160));
  }
  /* The coordinator names a session's device itself (kosmos#5422: an id the browser offers is replaced), so the row on
     P is found by the four characters the sign-up answered, as the person matches them on screen. */
  const listed = await waitFor(async () => {
    const p = await http(P.base, 'GET', '/api/remote/pending');
    const devs = p.json && Array.isArray(p.json.devices) ? p.json.devices : [];
    return devs.find((d) => d && sess && d.code === sess.match_code) || null;
  }, 60000, 1500);
  chk(!!listed, 'step 4b: P lists the parent\'s browser as waiting, with the code its sign-up showed', listed ? listed.device_id.slice(0, 8) + '... ' + listed.code : 'match code ' + (sess && sess.match_code));
  if (listed) {
    const r = await http(P.base, 'POST', '/api/remote/devices/allow', { device_id: listed.device_id, code: listed.code }, SCREEN);
    chk(r.status === 200, 'step 4b: P allows the parent\'s browser', r.status + ' ' + r.text.slice(0, 200));
  }

  // 5. the operator makes the family (orgs are operator-made: org-create --kind family).
  let orgId = '';
  try {
    orgId = execFileSync(BIN.coordinator, ['org-create', '--name', 'Rivera family', '--slug', 'rivera-' + RUN, '--admin', parent, '--kind', 'family'],
      { env: coordEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    orgId = ((orgId.match(/^([0-9a-f]{32})\s*$/m) || [])[1]) || orgId.trim().slice(-200);   // the id is its own line; logs go beside it
  } catch (e) { info('org-create: ' + String(e.stderr || e.message).slice(0, 300)); }
  chk(/^[0-9a-f]{32}$/.test(orgId), 'step 5: org-create --kind family makes the family, the parent its admin', orgId || '-');

  // 6. the parent makes a join code in the console, with the allowed browser session.
  let code = '';
  if (sess) {
    // The Allow reaches the coordinator through P's tunnel, so the console may refuse for a moment first.
    let r = null;
    await waitFor(async () => { r = await http(REL.coordinator, 'POST', '/v1/org/invites', {}, bearer(sess.token)); return r.status === 200; }, 45000, 1500);
    code = r.json && (r.json.code || r.json.invite_code) || '';
    chk(r.status === 200 && !!code, 'step 6: the parent makes a join code in the console', r.status + ' ' + r.text.slice(0, 160));
  }

  // 7. K previews the code: a family, with its own words, and nothing joined yet.
  let pv = null;
  if (code) {
    const r = await http(K.base, 'POST', '/api/org/preview', { code }, SCREEN);
    pv = r.json || {};
    chk(r.status === 200 && pv.ok === true && pv.org && pv.org.kind === 'family', 'step 7: K previews the code as a family', r.status + ' ' + r.text.slice(0, 200));
    const words = JSON.stringify(pv.consent || {});
    chk(/family/i.test(words) && !/company/i.test(words), 'step 7: the words K shows are the family\'s, naming no company', words.slice(0, 160));
    const st = await http(K.base, 'GET', '/api/org');
    chk(st.json && st.json.enrolled !== true, 'step 7 control: K is not joined after a preview');
  }

  // 8. a join that does not say the words were shown is refused, and the code is not spent (CONTROL for step 9).
  if (pv && pv.ticket) {
    const r = await http(K.base, 'POST', '/api/org/enroll', { code, accepted: true, ticket: pv.ticket }, SCREEN);
    chk(r.json && r.json.ok === false && r.json.code === 'org_family_words_unseen', 'step 8: a family join without the words screen is refused', r.status + ' ' + r.text.slice(0, 200));
  }

  // 9. the parent reads the words on K and accepts them there: K joins the family.
  if (pv && pv.ticket) {
    const r = await http(K.base, 'POST', '/api/org/enroll', { code, accepted: true, ticket: pv.ticket, wordsShown: true }, SCREEN);
    chk(r.json && r.json.ok === true, 'step 9: with the words read and accepted on K, K joins the family', r.status + ' ' + r.text.slice(0, 200));
    const st = await waitFor(async () => { const g = await http(K.base, 'GET', '/api/org', undefined, SCREEN); return g.json && g.json.enrolled === true ? g.json : null; }, 30000, 1000);
    // Read as the screen: any other caller learns only whether K is enrolled, never which org (#5531 review 12).
    chk(st && st.org && st.org.kind === 'family', 'step 9: K\'s board says it is in a family (kind family)', st ? JSON.stringify(st.org) : '-');
    // The join record says the screen showing the words is the board's word, not proof.
    const a = await http(REL.coordinator, 'GET', '/v1/org/audit', undefined, bearer(sess.token));
    const rows = a.json && Array.isArray(a.json.entries) ? a.json.entries : [];
    const joined = rows.find((e) => e && e.what === 'joined');
    chk(joined && /words shown on the board's screen \(the board's word\)/.test(joined.detail || ''), 'step 9: the family\'s audit row records the join with the words shown as the board\'s claim', joined ? joined.detail : a.status + ' ' + a.text.slice(0, 160));
  }

  // 10. the spent code, previewed again, is refused in words for anyone (no company).
  if (code) {
    const r = await http(K.base, 'POST', '/api/org/preview', { code }, SCREEN);
    const b = (r.json && r.json.because) || '';
    chk(r.json && r.json.ok === false && !/company/i.test(b), 'step 10: the used code is refused in words that name no company', b || r.text.slice(0, 160));
  }

  // 11. the child's computer leaves the family.
  {
    const r = await http(K.base, 'POST', '/api/org/leave', {}, SCREEN);
    chk(r.json && r.json.ok === true, 'step 11: K leaves the family', r.status + ' ' + r.text.slice(0, 200));
    const g = await http(K.base, 'GET', '/api/org');
    chk(g.json && g.json.enrolled !== true, 'step 11: K is no longer joined');
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
// A closed terminal (SIGHUP) makes stdout writes fail; that must not feed the error handler below.
for (const st of [process.stdout, process.stderr]) st.on('error', () => { /* terminal gone */ });
// Anything thrown outside main's own try (an event handler, a stray rejection) still tears down.
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (err) => {
  console.log('FAIL  harness error (' + ev + '): ' + (err && err.message ? err.message : err));
  results.push({ ok: false }); halted = true; fedproofFinish(1);
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) process.on(sig, () => { if (!halted) console.log('interrupted (' + sig + ')'); results.push({ ok: false }); halted = true; fedproofFinish(1); });
