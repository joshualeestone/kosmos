'use strict';
/**
 * win32-installer-native round 8 (the round 7 review's finding 1): the uninstall and the move against the REAL
 * board request handler (server.js), listening on one of this PC's own non-loopback addresses that
 * KOSMOS_BIND_HOST names, the documented #1112 setup.
 *
 * There the real board answers a look BEFORE routing it: a 400 from pathOf (a Host it does not route) or a 403
 * from remoteWriteGuard, and neither carries the board's identity header. Before the fix the every-address look
 * read that as "not Kosmos", and the uninstall deleted the runtime folder and the chats under a live board.
 *
 * 🛑 NOTHING REAL IS TOUCHED. Every root the board reads is a scratch folder, set before server.js is required
 * (convention 2); every schtasks call goes to a stub runner; the board listens on an ephemeral port of this PC's
 * own address; every folder is a scratch folder; and no connection to 16180, the live board's port, is allowed.
 *
 *   node --test engine/win32uninstall.realboard.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

/* Round 7, finding 4: nothing in this suite may connect to the live board's port. */
const LIVE_BOARD_PORT = 16180;
function refuseTheLiveBoardPort(connectArgs) {
  let options = connectArgs[0];
  if (Array.isArray(options)) options = options[0];
  const port = options && typeof options === 'object' ? options.port : options;
  if (Number(port) === LIVE_BOARD_PORT) throw new Error('this suite tried to connect to port 16180, the live board');
}
{
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connectAnywhereButTheLiveBoard(...args) {
    refuseTheLiveBoardPort(args);
    return connect.apply(this, args);
  };
}

/* Convention 2: every root the board reads is a scratch folder BEFORE server.js, or the store, is required. */
const FAKE = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-realboard-'));
process.env.HOME = FAKE;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, '..', 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
for (const k of ['DATA', 'PROJECTS', 'WORKERS', 'LAUNCH']) process.env['AGENT_WORKFORCE_' + k] = fs.mkdtempSync(path.join(FAKE, k.toLowerCase() + '-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FAKE, 'claude.json');
/* The documented second opt-in of #1112, naming the host remote agents use (not the address the look connects to). */
process.env.AGENT_WORKFORCE_ALLOWED_HOSTS = 'kosmos-remote.example';
delete process.env.KOSMOS_BIND_HOST;

const handoff = require('./win32handoff');
const win32job = require('./win32job');
const win32board = require('./win32board');
const uninstaller = require('./win32uninstall');
const relocator = require('./win32relocate');
const { ENTRIES } = require('./win32update');
const { server } = require('../server');

const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'the slow refusal and the own-address looks this relies on were measured on Windows' };
const NOT_FOUND = { ok: false, out: 'ERROR: The system cannot find the file specified.' };
const row = (taskPath) => '"\\' + taskPath + '","N/A","Ready"';
const listing = (paths) => ({ ok: true, out: [row('Microsoft\\Windows\\Defrag\\ScheduledDefrag'), ...paths.map(row)].join('\r\n') + '\r\n' });
const boardDefinition = (enabled) => ({ ok: true, out: '<?xml version="1.0"?><Task><Settings>' + (enabled ? '' : '<Enabled>false</Enabled>') + '</Settings></Task>' });
const RUNNING_BOARD_ROW = '"BOX","\\Kosmos\\board","N/A","Running","Interactive only","9/13/2026 1:00:00 PM","267009"\r\n';
const COULD_NOT_TELL_REMOVE = 'Kosmos could not tell whether it is still open. Restart your computer, then remove Kosmos again.';
const COULD_NOT_TELL_MOVE = 'Kosmos could not tell whether it is still open. Restart your computer, then open Kosmos again.';

function stubSchedulers(script) {
  const calls = [];
  let listed = 0;
  const answer = (who, args) => {
    calls.push(who + ' ' + args.join(' '));
    if (args[0] === '/Query' && !args.includes('/TN')) {
      const l = script.lists[Math.min(listed, script.lists.length - 1)];
      listed += 1;
      return l;
    }
    if (args[0] === '/Query' && args.includes('/XML') && script.boardXml) return script.boardXml;
    if (args[0] === '/Query' && args.includes('/V') && script.running) return { ok: true, out: RUNNING_BOARD_ROW };
    if (args[0] === '/Query') return NOT_FOUND;
    if (args[0] === '/End' && who === 'board' && typeof script.onBoardEnd === 'function') script.onBoardEnd();
    return { ok: true, out: 'SUCCESS' };
  };
  win32job.setRunner((args) => answer('job', args));
  win32board.setRunner((args) => answer('board', args));
  return calls;
}

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-realboard-case-'));
  const s = { base, home: path.join(base, 'Users', 'someone'), env: { APPDATA: path.join(base, 'Roaming'), LOCALAPPDATA: path.join(base, 'Local'), USERNAME: 'someone', USERDOMAIN: 'BOX' } };
  s.runtimeDir = path.join(s.env.LOCALAPPDATA, 'Kosmos');
  s.dataDir = path.join(s.env.APPDATA, 'Kosmos');
  s.projectsRoot = path.join(s.home, 'Kosmos', 'Projects');
  fs.mkdirSync(path.join(s.runtimeDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(s.runtimeDir, 'runtime', 'engine-path'), 'C:\\somewhere\\app\\engine');
  fs.mkdirSync(path.join(s.dataDir, 'chats'), { recursive: true });
  fs.writeFileSync(path.join(s.dataDir, 'chats', 'ava.jsonl'), '{"said":"hello"}\n');
  fs.mkdirSync(s.projectsRoot, { recursive: true });
  return s;
}

const removal = (s, extra) => uninstaller.uninstall({
  platform: 'win32', env: s.env, home: s.home, projectsRoot: s.projectsRoot,
  removeFolder: (dir) => fs.rmSync(dir, { recursive: true, force: true }), sleep: async () => {},
  liveExecutionAllowed: () => true, ...extra,
});

async function listenOn(address) {
  return new Promise((resolve) => {
    const failed = () => resolve(false);
    server.once('error', failed);
    server.listen(0, address, () => { server.removeListener('error', failed); resolve(true); });
  });
}

async function closeTheBoard() {
  if (!server.listening) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
}

/**
 * One of this PC's own non-loopback addresses the real board can listen on and be reached on, where a closed port
 * is then refused within the look's connect limit. IPv4 first. Chosen with its own looks (probeBoard with an
 * explicit 5 s connect limit), so a control on the every-address look cannot make this find nothing.
 */
let chosenAddress;
function ownAddress() {
  if (!chosenAddress) {
    chosenAddress = (async () => {
      const LOOK = { connectTimeoutMs: 5000 };
      const candidates = Object.values(os.networkInterfaces()).flat()
        .filter((i) => i && !i.internal)
        .sort((a, b) => (a.family === b.family ? 0 : a.family === 'IPv4' ? -1 : 1))
        .map((i) => (i.family === 'IPv6' && /^fe[89ab][0-9a-f]:/i.test(i.address) ? i.address + '%' + i.scopeid : i.address));
      for (const address of candidates) {
        if (!(await listenOn(address))) continue;
        const port = server.address().port;
        const reached = await handoff.probeBoard(port, address, LOOK);
        await closeTheBoard();
        if (!reached.answering) continue;
        if ((await handoff.probeBoard(port, address, LOOK)).outcome === handoff.PROBE_OUTCOMES.REFUSED) return address;
      }
      return null;
    })();
  }
  return chosenAddress;
}

test.afterEach(() => { win32job.setRunner(null); win32board.setRunner(null); });
test.after(async () => {
  await closeTheBoard();
  fs.rmSync(FAKE, { recursive: true, force: true });
});

test('🛑 round 7 finding 1, the REAL board handler on this PC\'s own address: a hand-started board answers a look there without naming itself, so the removal stops with nothing changed and the move refuses', WINDOWS_ONLY, async (t) => {
  const address = await ownAddress();
  if (!address) { t.skip('this PC has no non-loopback address the board can be reached on and that refuses a closed port within the connect limit'); return; }
  assert.ok(await listenOn(address), 'the real board would not listen on ' + address);
  const port = server.address().port;
  t.diagnostic('the real board listens on ' + address + ':' + port);
  try {
    const look = await handoff.probeBoardOnEveryAddress(port, { KOSMOS_BIND_HOST: address });
    assert.equal(look.outcome, handoff.PROBE_OUTCOMES.UNIDENTIFIED, 'the every-address look: ' + JSON.stringify(look));
    assert.equal(handoff.boardMayBeOpen(look), true);

    const s = sandbox();
    try {
      const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([]), listing([])], boardXml: boardDefinition(true) });
      const r = await removal(s, { deleteData: true, port, env: { ...s.env, KOSMOS_BIND_HOST: address } });
      assert.deepEqual(r.left, [COULD_NOT_TELL_REMOVE], 'the removal under a real board on ' + address + ': ' + JSON.stringify(r));
      assert.ok(!calls.some((c) => /\/(Change|End|Delete)/.test(c)), 'a task was changed: ' + calls.join(' | '));
      assert.ok(fs.existsSync(s.runtimeDir), 'the runtime folder was deleted under a live board');
      assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'the chats were deleted under a live board');
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }

    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-realboard-move-'));
    try {
      const from = path.join(base, 'Downloads', 'kosmos-win-x64');
      const to = path.join(base, 'Local', 'Programs', 'Kosmos');
      for (const entry of ENTRIES) {
        const at = path.join(from, entry);
        if (/\.[A-Za-z]+$/.test(entry)) { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.writeFileSync(at, 'x'); } else fs.mkdirSync(at, { recursive: true });
      }
      fs.writeFileSync(path.join(from, 'manifest.json'), JSON.stringify({ product: 'kosmos', platform: 'win32', version: '0.6.61', source_sha: 'abcdef1' }));
      stubSchedulers({ lists: [listing(['Kosmos\\board'])], boardXml: boardDefinition(true) });
      const moved = await relocator.relocate({ from, to, port, env: { ...process.env, KOSMOS_BIND_HOST: address },
        readPointer: () => null, anchor: () => ({ ok: true }), pidState: () => 'alive', liveExecutionAllowed: () => true });
      assert.equal(moved.because, COULD_NOT_TELL_MOVE, 'the move under a real board on ' + address + ': ' + JSON.stringify(moved));
      assert.ok(!fs.existsSync(to), 'something was copied under a live board');
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } finally {
    await closeTheBoard();
  }
});

test('🛑 round 7 finding 1, the REAL board handler on this PC\'s own address: with the board task running, the removal switches it off, ends it, and runs once the board goes', WINDOWS_ONLY, async (t) => {
  const address = await ownAddress();
  if (!address) { t.skip('this PC has no non-loopback address the board can be reached on and that refuses a closed port within the connect limit'); return; }
  assert.ok(await listenOn(address), 'the real board would not listen on ' + address);
  const port = server.address().port;
  const s = sandbox();
  try {
    const calls = stubSchedulers({
      lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([]), listing([])], boardXml: boardDefinition(true), running: true,
      onBoardEnd: () => { closeTheBoard(); },
    });
    const r = await removal(s, { port, env: { ...s.env, KOSMOS_BIND_HOST: address } });
    assert.equal(r.ok, true, 'the board its task started, ended, did not let the removal run: ' + JSON.stringify(r));
    for (const c of ['board /Change /TN Kosmos\\board /DISABLE', 'board /End /TN Kosmos\\board', 'job /Delete /F /TN Kosmos\\agent-ava']) {
      assert.ok(calls.includes(c), '"' + c + '" was not issued: ' + calls.join(' | '));
    }
    assert.ok(!calls.includes('board /Change /TN Kosmos\\board /ENABLE'), 'the switch was put back, so the removal stopped');
    assert.ok(!fs.existsSync(s.runtimeDir));
  } finally {
    await closeTheBoard();
    fs.rmSync(s.base, { recursive: true, force: true });
  }
});

test('🛑 round 7 finding 4: no test in this suite can connect to 16180, the live board\'s port', () => {
  /* The check itself, never a socket: even with the check removed, this test cannot send anything to 16180. */
  assert.throws(() => refuseTheLiveBoardPort([{ host: '127.0.0.1', port: LIVE_BOARD_PORT }]), /16180/);
  assert.throws(() => refuseTheLiveBoardPort([[{ host: '127.0.0.1', port: LIVE_BOARD_PORT }, null]]), /16180/);
  assert.throws(() => refuseTheLiveBoardPort([LIVE_BOARD_PORT, '127.0.0.1']), /16180/);
  assert.doesNotThrow(() => refuseTheLiveBoardPort([{ host: '127.0.0.1', port: 9 }]));
  assert.equal(net.Socket.prototype.connect.name, 'connectAnywhereButTheLiveBoard', 'the check is not on every connection');
});
