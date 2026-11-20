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
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
    child.stdin.end('');
  });
}

/* The room route answers `room.text` while `room.stall` is false; while true it never answers (a busy board). */
function withBoard(fn) {
  const room = { text: 'm1 leo: first look\n', stall: false, hits: 0 };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/project/') && req.url.includes('/room')) {
      room.hits += 1;
      if (room.stall) return;   // never answered: the CLI's own time limit ends the read
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

const envFor = (port, home) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), KOSMOS_HOME: home,
  KOSMOS_ROOM_TIMEOUT_S: '1', KOSMOS_AGENT_TOKEN: 'abc123', TMUX_PANE: '%42' });

test('kosmos#8769 item 4: busy with a copy held prints that copy, headed NOT the room now, its age and since when, exit 1', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = fs.mkdtempSync(path.join(HOME, 'a-'));
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
  const home = fs.mkdtempSync(path.join(HOME, 'b-'));
  room.stall = true;
  const busy = await runCli(['room', 'proj'], envFor(port, home));
  assert.equal(busy.code, 1, busy.out);
  assert.match(busy.out, /Kosmos is running but did not answer in time, so we could not read that room/);
  assert.match(busy.out, /no earlier copy of this room to show/);
  assert.doesNotMatch(busy.out, /NOT the room now/);
  assert.doesNotMatch(busy.out, /No such file|line \d+:/, 'review 4: no shell error leaks into what the reader sees');
}));

test('kosmos#8769 item 4: a good read after a busy one replaces the copy and ends the failing spell', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = fs.mkdtempSync(path.join(HOME, 'c-'));
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
  const home = fs.mkdtempSync(path.join(HOME, 'd-'));
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
  const home = fs.mkdtempSync(path.join(HOME, 'e-'));
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

test('kosmos#8769 item 4: a state folder that cannot be written still says the board is busy', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = path.join(HOME, 'not-a-folder');
  fs.writeFileSync(home, 'a file where the home folder would be');
  room.stall = true;
  const busy = await runCli(['room', 'proj'], envFor(port, home));
  assert.equal(busy.code, 1, busy.out);
  assert.match(busy.out, /Kosmos is running but did not answer in time, so we could not read that room/);
}));

test('kosmos#8769 item 4: a good FILTERED read also ends the failing spell (the since line stays true)', { skip: SKIP }, () => withBoard(async (port, room) => {
  const home = fs.mkdtempSync(path.join(HOME, 'f-'));
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
  const home = fs.mkdtempSync(path.join(HOME, 'g-'));
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
