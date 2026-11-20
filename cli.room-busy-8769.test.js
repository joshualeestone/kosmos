'use strict';
require('./test-support/tmpscope');

/**
 * kosmos#8769 item 4: `kosmos room <project>` on a board too busy to answer shows the last copy this reader got of that
 * room, headed with its age and the time reads began failing, and exits 1 (the read did not happen). With no copy
 * held it refuses as before, plus the failing-since time. Only a plain read keeps a copy; a good read replaces it and
 * ends the failing spell. Spawns the real install/kosmos against a stub board whose room route answers or stalls.
 * KOSMOS_HOME is a temp folder, so no copy is written anywhere real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-room-busy-8769-'));
const DATA = path.join(ROOT, 'data');
const HOME = path.join(ROOT, 'home');
fs.mkdirSync(DATA); fs.mkdirSync(HOME);
process.on('exit', () => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code: ' + (err.signal || err.code))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || ''), stdout: stdout || '' });
    });
    child.stdin.end('');
  });
}

/* The room route answers `room.text` while `room.stall` is false; while true it never answers (a busy board). */
function withBoard(fn) {
  /* Baron's #8776 follow-ups: `health` stalls the health route too (the board busy before the read), and `status`
     answers the room with that HTTP status (a refusal). */
  const room = { text: 'm1 leo: first look\n', stall: false, hits: 0, health: false, status: 200 };
  const server = http.createServer((req, res) => {
    if (room.health && req.url.startsWith('/api/health')) return;   // never answered: the health check reads busy
    if (req.url.startsWith('/api/project/') && req.url.includes('/room')) {
      room.hits += 1;
      if (room.stall) return;   // never answered: the CLI's own time limit ends the read
      if (room.status !== 200) { res.writeHead(room.status, { 'content-type': 'text/plain' }); res.end('refused\n'); return; }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(room.text);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, room); } catch (e) { failure = e; }
      server.closeAllConnections();
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

/* An installed layout: copies are kept only where $KOSMOS_HOME/app exists (review 5). */
const mkHome = (prefix) => { const h = fs.mkdtempSync(path.join(HOME, prefix)); fs.mkdirSync(path.join(h, 'app')); return h; };
const envFor = (port, home) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), KOSMOS_HOME: home,
  KOSMOS_ROOM_TIMEOUT_S: '1', KOSMOS_AGENT_TOKEN: 'abc123', TMUX_PANE: '%42' });

test('kosmos#8769 item 4: busy with a copy held prints that copy, headed NOT the room now, its age and since when, exit 1', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('a-');
  const good = await runCli(['room', 'proj'], envFor(port, home));
  assert.equal(good.code, 0, good.out);
  assert.match(good.out, /first look/);
  room.text = 'm2 mara: something newer\n';
  room.stall = true;
  const busy = await runCli(['room', 'proj'], envFor(port, home));
  assert.equal(busy.code, 1, busy.out);
  assert.match(busy.out, /this is NOT the room now: it is the last copy this computer read, 0 minute\(s\) ago/);
  assert.match(busy.out, /Kosmos has not answered a read of this room here since \d\d:\d\d/);
  assert.match(busy.out, /first look/, 'the kept copy is shown');
  assert.doesNotMatch(busy.out, /something newer/, 'sanity: the stalled board sent nothing new');
  assert.ok(busy.out.indexOf('NOT the room now') < busy.out.indexOf('first look'), 'the warning comes before the copy');
  assert.match(busy.out, /^\s*Kosmos is running but did not answer in time, so this is NOT the room now/, 'review 4: the header is the very first thing');
  const copies = fs.readdirSync(path.join(home, 'state', 'room-copies')).filter((f) => f.endsWith('.txt'));
  assert.equal(copies.length, 1);
  assert.equal(fs.statSync(path.join(home, 'state', 'room-copies', copies[0])).mode & 0o777, 0o600, 'the copy is private');
  assert.ok(!fs.readFileSync(path.join(home, 'state', 'room-copies', copies[0]), 'utf8').includes('abc123'), 'no token kept');
}));

test('kosmos#8769 item 4: busy with NO copy held refuses as before, and says since when', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('b-');
  room.stall = true;
  const busy = await runCli(['room', 'proj'], envFor(port, home));
  assert.equal(busy.code, 1, busy.out);
  assert.match(busy.out, /Kosmos is running but did not answer in time, so we could not read that room/);
  assert.match(busy.out, /no earlier copy of this room to show/);
  assert.doesNotMatch(busy.out, /NOT the room now/);
  assert.doesNotMatch(busy.out, /No such file|line \d+:/, 'review 4: no shell error leaks into what the reader sees');
}));

test('kosmos#8769 item 4: a good read after a busy one replaces the copy and ends the failing spell', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('c-');
  await runCli(['room', 'proj'], envFor(port, home));
  room.stall = true;
  await runCli(['room', 'proj'], envFor(port, home));
  assert.equal(fs.readdirSync(path.join(home, 'state', 'room-copies')).filter((f) => f.endsWith('.busy-since')).length, 1, 'presence first: the busy read left its mark');
  room.stall = false; room.text = 'm3 leo: after the spell\n';
  const back = await runCli(['room', 'proj'], envFor(port, home));
  assert.equal(back.code, 0, back.out);
  const dir = path.join(home, 'state', 'room-copies');
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.busy-since')).length, 0, 'the failing mark is gone');
  room.stall = true;
  const again = await runCli(['room', 'proj'], envFor(port, home));
  assert.match(again.out, /after the spell/, 'the newer copy replaced the old one');
}));

test('kosmos#8769 item 4: a filtered read (-n) neither keeps a copy nor shows one', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('d-');
  const filtered = await runCli(['room', 'proj', '-n', '5'], envFor(port, home));
  assert.equal(filtered.code, 0, filtered.out);
  assert.ok(!fs.existsSync(path.join(home, 'state', 'room-copies')) || fs.readdirSync(path.join(home, 'state', 'room-copies')).filter((f) => f.endsWith('.txt')).length === 0, 'no copy from a filtered read');
  await runCli(['room', 'proj'], envFor(port, home));   // a plain read keeps one
  room.stall = true;
  const busyFiltered = await runCli(['room', 'proj', '-n', '5'], envFor(port, home));
  assert.equal(busyFiltered.code, 1);
  assert.doesNotMatch(busyFiltered.out, /NOT the room now/, 'a filtered read is not answered with the plain copy');
}));

test('kosmos#8769 item 4: one reader never sees another reader\'s copy of the same room', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('e-');
  room.text = 'm1 seen-by-reader-a\n';
  const a = await runCli(['room', 'proj'], { ...envFor(port, home), KOSMOS_AGENT_TOKEN: 'aaaa1111' });
  assert.equal(a.code, 0, a.out);
  room.stall = true;
  const b = await runCli(['room', 'proj'], { ...envFor(port, home), KOSMOS_AGENT_TOKEN: 'bbbb2222' });
  assert.equal(b.code, 1);
  assert.doesNotMatch(b.out, /seen-by-reader-a/, 'reader B is not shown reader A\'s view');
  assert.match(b.out, /no earlier copy of this room to show/);
  const a2 = await runCli(['room', 'proj'], { ...envFor(port, home), KOSMOS_AGENT_TOKEN: 'aaaa1111' });
  assert.match(a2.out, /seen-by-reader-a/, 'CONTROL: reader A still gets its own copy');
}));

test('kosmos#8769 item 4: a state folder that cannot be written still says the board is busy, with no since clause', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('j-');   // an installed layout, so the feature is ON (review 7: it must reach the write path)
  fs.writeFileSync(path.join(home, 'state'), 'a file where the state folder would be');
  room.stall = true;
  const busy = await runCli(['room', 'proj'], envFor(port, home));
  assert.equal(busy.code, 1, busy.out);
  assert.match(busy.out, /Kosmos is running but did not answer in time, so we could not read that room/);
  assert.doesNotMatch(busy.out, /has not answered a read of this room here since/, 'no mark could be written, so no since claim');
  assert.doesNotMatch(busy.out, /No such file|Not a directory|line \d+:/, 'no shell error leaks');
}));

test('kosmos#8769 item 4: a good FILTERED read also ends the failing spell (the since line stays true)', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('f-');
  await runCli(['room', 'proj'], envFor(port, home));
  room.stall = true;
  await runCli(['room', 'proj'], envFor(port, home));
  const dir = path.join(home, 'state', 'room-copies');
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.busy-since')).length, 1, 'presence first: the mark is there');
  room.stall = false;
  const filtered = await runCli(['room', 'proj', '-n', '5'], envFor(port, home));
  assert.equal(filtered.code, 0, filtered.out);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.busy-since')).length, 0, 'the answered filtered read cleared it');
}));

test('kosmos#8769 item 4: a spell whose last failed read is over 30 minutes old starts again (no false "stuck since")', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('g-');
  await runCli(['room', 'proj'], envFor(port, home));
  room.stall = true;
  await runCli(['room', 'proj'], envFor(port, home));
  const dir = path.join(home, 'state', 'room-copies');
  const mark = path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.busy-since')));
  const old = Math.floor(Date.now() / 1000) - 7200;
  fs.writeFileSync(mark, old + ' ' + (old + 60) + '\n');
  await runCli(['room', 'proj'], envFor(port, home));
  const first = Number(fs.readFileSync(mark, 'utf8').trim().split(/\s+/)[0]);
  assert.ok(first > old + 3600, 'the old spell was not carried on: ' + first + ' vs ' + old);
  fs.writeFileSync(mark, (old + 7000) + ' ' + Math.floor(Date.now() / 1000) + '\n');
  await runCli(['room', 'proj'], envFor(port, home));
  assert.equal(Number(fs.readFileSync(mark, 'utf8').trim().split(/\s+/)[0]), old + 7000, 'CONTROL: a recent last failure keeps the spell');
}));

test('kosmos#8769 item 4: outside an installed Kosmos (no app folder) no copy is kept, so a checkout or a test is never written to', { skip: SKIP }, () => withBoard(async (port) => {
  const home = fs.mkdtempSync(path.join(HOME, 'h-'));
  const good = await runCli(['room', 'proj'], envFor(port, home));
  assert.equal(good.code, 0, good.out);
  assert.ok(!fs.existsSync(path.join(home, 'state')), 'nothing written without app/');
}));

test('kosmos#8769 item 4: the age is said in hours past two hours, and a copy not refreshed for 7 days is pruned', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('i-');
  await runCli(['room', 'proj'], envFor(port, home));
  const dir = path.join(home, 'state', 'room-copies');
  const copy = path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.txt')));
  const threeH = (Date.now() - 3 * 3600000) / 1000; fs.utimesSync(copy, threeH, threeH);
  room.stall = true;
  const busy = await runCli(['room', 'proj'], envFor(port, home));
  assert.match(busy.out, /last copy this computer read, 3 hour\(s\) ago/);
  const stale = path.join(dir, 'stale-from-a-deleted-room.txt'); fs.writeFileSync(stale, 'x');
  const old = (Date.now() - 7.5 * 86400000) / 1000; fs.utimesSync(stale, old, old);   // 7.5 days: past 7, under 8
  room.stall = false;
  await runCli(['room', 'proj'], envFor(port, home));
  assert.ok(!fs.existsSync(stale), 'a copy not refreshed for 7 days is pruned');
  assert.ok(fs.existsSync(copy), 'CONTROL: the fresh copy stays');
}));

/* Baron's #8776 follow-up 1: the health check finding the board busy is the same busy board, so the copy shows there too.
   A real busy reading needs a Kosmos server.js listening (_health_no_answer reads anything else as a stranger), so the
   check's answer is stubbed by sourcing the CLI, as cli.busy-health-4466.test.js does; the room route stays the stub's. */
function cmdRoomWithHealth(state, project, env) {
  return new Promise((resolve, reject) => {
    // Through the environment, not $1..$3: sourcing the CLI resets the positional arguments.
    const script = 'source "$T_CLI"; healthy() { HEALTH_STATE="$T_STATE"; return 1; }; cmd_room "$T_PROJECT"';
    execFile('/bin/bash', ['-c', script], { env: { ...env, T_CLI: CLI, T_STATE: state, T_PROJECT: project }, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code: ' + (err.signal || err.code))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || ''), stdout: stdout || '' });
    });
  });
}

test('#8776 follow-up 1: a board the HEALTH CHECK finds busy shows the kept copy (on stderr), exit 1', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('k-');
  const good = await runCli(['room', 'proj'], envFor(port, home));
  assert.equal(good.code, 0, good.out);
  const hits = room.hits;
  const busy = await cmdRoomWithHealth('busy', 'proj', envFor(port, home));
  assert.equal(busy.code, 1, busy.out);
  assert.equal(room.hits, hits, 'presence first: the room route was never asked (the health check refused)');
  assert.match(busy.out, /this is NOT the room now: it is the last copy this computer read/);
  assert.match(busy.out, /first look/);
  assert.equal(busy.stdout, '', 'follow-up 2 here too: nothing on stdout');
  const none = await cmdRoomWithHealth('busy', 'other', envFor(port, home));
  assert.equal(none.code, 1, none.out);
  assert.match(none.out, /too busy to answer/, 'CONTROL: no copy of that room, so the health refusal as before');
  assert.match(none.out, /no earlier copy of this room to show/);
  assert.doesNotMatch(none.out, /NOT the room now/);
}));

test('#8776 follow-up 1: a board NOT RUNNING or UNREACHABLE shows no copy (nothing is busy), and leaves no mark', { skip: SKIP }, () => withBoard(async (port) => {
  const home = mkHome('l-');
  assert.equal((await runCli(['room', 'proj'], envFor(port, home))).code, 0);
  for (const state of ['down', 'unreachable', 'stranger']) {
    const r = await cmdRoomWithHealth(state, 'proj', envFor(port, home));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the room cannot be read/, state + ': presence first, its refusal was said');
    assert.doesNotMatch(r.out, /NOT the room now|first look|has not answered a read/, state);
  }
  const dir = path.join(home, 'state', 'room-copies');
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.busy-since')).length, 0, 'no failing mark for a board that is not busy');
}));

/* Baron's #8776 follow-up 2: the header and the copy on stderr, so a script reading stdout takes nothing for the room. */
test('#8776 follow-up 2: the kept copy is on stderr, and stdout is empty', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('m-');
  const good = await runCli(['room', 'proj'], envFor(port, home));
  assert.match(good.stdout, /first look/, 'CONTROL: a good read is on stdout');
  room.stall = true;
  const busy = await runCli(['room', 'proj'], envFor(port, home));
  assert.match(busy.out, /first look/, 'presence first: the copy was shown');
  assert.equal(busy.stdout, '', 'nothing on stdout');
}));

/* Baron's #8776 follow-up 3: a refused read drops the copy; the board failing (5xx) keeps it. */
test('#8776 follow-up 3: a 401, 403 or 404 drops the kept copy (a filtered read too); a 503 keeps it', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = mkHome('n-');
  const dir = path.join(home, 'state', 'room-copies');
  const copies = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.txt')) : []);
  await runCli(['room', 'proj'], envFor(port, home));
  room.status = 503;
  assert.equal((await runCli(['room', 'proj'], envFor(port, home))).code, 1);
  assert.equal(copies().length, 1, 'CONTROL: a 503 is the board, not the reader: the copy stays');
  for (const status of [401, 403, 404]) {
    room.status = 200; room.stall = false;
    await runCli(['room', 'proj'], envFor(port, home));
    assert.equal(copies().length, 1, 'presence first: a copy is held');
    room.status = status;
    assert.equal((await runCli(['room', 'proj', '-n', '5'], envFor(port, home))).code, 1);
    assert.equal(copies().length, 0, status + ' dropped the copy');
    room.stall = true;
    const busy = await runCli(['room', 'proj'], envFor(port, home));
    assert.doesNotMatch(busy.out, /NOT the room now|first look/, status + ': a later busy read shows no copy');
  }
  /* Review 1: a 404 to --post is a post id the room lacks, not the room refused: the copy stays (control: a 403 to
     the same read drops it). */
  room.status = 200; room.stall = false;
  await runCli(['room', 'proj'], envFor(port, home));
  room.status = 404;
  assert.equal((await runCli(['room', 'proj', '--post', 'm999'], envFor(port, home))).code, 1);
  assert.equal(copies().length, 1, 'a by-id 404 keeps the copy');
  room.status = 403;
  await runCli(['room', 'proj', '--post', 'm999'], envFor(port, home));
  assert.equal(copies().length, 0, 'CONTROL: a by-id 403 drops it');
}));
