'use strict';
/**
 * win32-installer-native: "Move Kosmos" and "which Kosmos runs", the engine half
 * (engine/win32relocate.js).
 *
 * Every folder is a scratch folder, the board probe, the engine pointer, the anchor and the pid
 * check are stubs, and nothing here starts a Kosmos. The launcher's half (where Kosmos is, the
 * question, the hand-off and the relaunch) is in tools.win-installer-native.test.js.
 *
 *   node --test engine/win32relocate.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

const handoff = require('./win32handoff');
const relocator = require('./win32relocate');
const { ENTRIES } = require('./win32update');

/* A refused connection: the only answer that proves no board is there (round 3, finding 1). */
const NOBODY_ANSWERING = async () => ({ answering: false, outcome: 'refused', identity: null, startedByTask: null });

/* Round 7, finding 4: the helpers use port 9 (discard), never a Kosmos board's. And nothing in this suite may
   connect to 16180, the live board's port: a test that tries goes red instead of reaching it. */
const PORT = 9;
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

function scratch() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-relocate-'));
  return { base, from: path.join(base, 'Downloads', 'kosmos-win-x64'), to: path.join(base, 'Local', 'Programs', 'Kosmos') };
}

/** A Kosmos build as the build script lays it out. */
function build(root, manifest) {
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Kosmos.exe'), 'MZ launcher');
  fs.writeFileSync(path.join(root, 'open-board.js'), '// opener');
  fs.writeFileSync(path.join(root, '! READ ME FIRST - Windows will warn you.txt'), 'read me');
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ product: 'kosmos', platform: 'win32', version: '0.6.60', source_sha: 'abc1234def56', node: { version: 'v26.0.0' }, ...manifest }));
  fs.writeFileSync(path.join(root, 'app', 'server.js'), '// board');
  fs.writeFileSync(path.join(root, 'bin', 'kosmos-cli.js'), '// cli');
  fs.writeFileSync(path.join(root, 'runtime', 'node.exe'), 'MZ node');
  return root;
}

function withPersonsThings(root) {
  fs.mkdirSync(path.join(root, 'Projects', 'garden'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Projects', 'garden', 'notes.txt'), "a person's own work");
  fs.writeFileSync(path.join(root, 'stray.txt'), 'not part of Kosmos');
  return root;
}

function move(s, extra) {
  const anchored = [];
  const p = relocator.relocate({
    from: s.from, to: s.to, port: PORT, probe: NOBODY_ANSWERING, readPointer: () => null,
    anchor: (spec) => { anchored.push(spec); return { ok: true }; }, pidState: () => 'alive',
    liveExecutionAllowed: () => true, ...extra,
  });
  p.anchored = anchored;
  return p.then((r) => Object.assign(r, { anchorCalls: anchored }));
}
const shape = (r) => { const { anchorCalls, ...rest } = r; return rest; };

const stagingLeftIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.includes(relocator.STAGING_INFIX)) : []);

test('a move copies exactly the updater\'s ENTRIES, never Projects or anything else, leaves the old copy, and anchors the new folder', async () => {
  const s = scratch();
  try {
    withPersonsThings(build(s.from));
    const r = await move(s);
    assert.deepEqual(shape(r), { ok: true, action: 'moved', target: s.to, boardEnded: false, anchored: true });
    assert.deepEqual(fs.readdirSync(s.to).sort(), [...ENTRIES].sort(), 'the new folder does not hold exactly the build\'s own entries');
    assert.ok(!fs.existsSync(path.join(s.to, 'Projects')), 'the person\'s projects were copied into the program folder');
    assert.equal(fs.readFileSync(path.join(s.to, 'runtime', 'node.exe'), 'utf8'), 'MZ node');
    assert.ok(fs.existsSync(path.join(s.from, 'Kosmos.exe')) && fs.existsSync(path.join(s.from, 'Projects', 'garden', 'notes.txt')), 'the old copy was changed');
    assert.deepEqual(stagingLeftIn(path.dirname(s.to)), [], 'a staging folder was left behind');
    assert.equal(r.anchorCalls.length, 1, 'the new folder was not anchored');
    assert.equal(r.anchorCalls[0].node, path.join(s.to, 'runtime', 'node.exe'));
    assert.equal(r.anchorCalls[0].engineDir, path.join(s.to, 'app', 'engine'), 'the pointer was anchored somewhere other than the moved engine');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a move whose anchor fails still moved, and says the anchor did not happen', async () => {
  const s = scratch();
  try {
    build(s.from);
    const r = await move(s, { anchor: () => ({ ok: false, because: 'disk full' }) });
    assert.deepEqual(shape(r), { ok: true, action: 'moved', target: s.to, boardEnded: false, anchored: false, anchorProblem: 'disk full' });
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 in a test process the real anchor is never reached: a move without an anchor seam refuses to run', async () => {
  const s = scratch();
  try {
    build(s.from);
    await assert.rejects(relocator.relocate({ from: s.from, to: s.to, port: PORT, probe: NOBODY_ANSWERING, readPointer: () => null, pidState: () => 'alive', liveExecutionAllowed: () => true }),
      /a test must pass an anchor seam/);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('an empty folder already at the target is moved into', async () => {
  const s = scratch();
  try {
    build(s.from);
    fs.mkdirSync(s.to, { recursive: true });
    const r = await move(s);
    assert.equal(r.action, 'moved', JSON.stringify(r));
    assert.ok(fs.existsSync(path.join(s.to, 'app', 'server.js')));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('the same build already in place, complete, is not copied again', async () => {
  const s = scratch();
  try {
    build(s.from);
    build(s.to);
    fs.writeFileSync(path.join(s.to, 'app', 'server.js'), '// the copy already there');
    let copied = 0;
    const r = await move(s, { copy: () => { copied += 1; } });
    assert.deepEqual(shape(r), { ok: true, action: 'already-there', target: s.to, boardEnded: false, anchored: true });
    assert.equal(copied, 0);
    assert.equal(fs.readFileSync(path.join(s.to, 'app', 'server.js'), 'utf8'), '// the copy already there');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 a target missing any ENTRIES item (bin, open-board.js) is incomplete, named, and never "already there"', async () => {
  const s = scratch();
  try {
    build(s.from);
    build(s.to);
    fs.rmSync(path.join(s.to, 'bin'), { recursive: true });
    fs.rmSync(path.join(s.to, 'open-board.js'));
    const r = await move(s);
    assert.equal(r.ok, false, 'an incomplete target was taken as the same build, already there: ' + JSON.stringify(r));
    assert.equal(r.because, 'Kosmos was not moved, because the Kosmos in ' + s.to + ' is incomplete (it is missing open-board.js, bin). Kosmos keeps working from here.');
    assert.equal(r.anchorCalls.length, 0, 'an incomplete target was anchored');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a different Kosmos at the target is refused with a sentence, and left exactly as it was', async () => {
  const s = scratch();
  try {
    build(s.from);
    build(s.to, { version: '0.6.51', source_sha: '0000000aaaaa' });
    const r = await move(s);
    assert.equal(r.ok, false);
    assert.equal(r.because, 'There is already a different Kosmos (version 0.6.51) in ' + s.to + ', so this one was not moved there. Kosmos keeps working from here.');
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.to, 'manifest.json'), 'utf8')).version, '0.6.51');
    const sameVersionOtherCommit = scratch();
    try {
      build(sameVersionOtherCommit.from);
      build(sameVersionOtherCommit.to, { source_sha: 'fff1234def56' });
      assert.match((await move(sameVersionOtherCommit)).because, /different Kosmos/, 'two builds of one version from different commits were taken for the same');
    } finally { fs.rmSync(sameVersionOtherCommit.base, { recursive: true, force: true }); }
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('other files, or a file at the target, are each refused', async () => {
  const s = scratch();
  try {
    build(s.from);
    fs.mkdirSync(s.to, { recursive: true });
    fs.writeFileSync(path.join(s.to, 'holiday.jpg'), 'photo');
    assert.match((await move(s)).because, /already holds other files/);
    assert.ok(fs.existsSync(path.join(s.to, 'holiday.jpg')));
    fs.rmSync(s.to, { recursive: true });
    fs.writeFileSync(s.to, 'a file');
    assert.match((await move(s)).because, /is a file, not a folder/);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 never while a board from THIS folder is serving; a board serving from elsewhere does not stop a move', async () => {
  const s = scratch();
  try {
    build(s.from);
    const answering = async () => ({ answering: true, identity: '0.6.60+abc1234def56@default', startedByTask: true });
    const fromHere = await move(s, { probe: answering, readPointer: () => path.join(s.from, 'app', 'engine') });
    assert.equal(fromHere.because, 'Kosmos is running from this folder right now, so it was not moved. Kosmos keeps working from here.');
    assert.ok(!fs.existsSync(s.to), 'something was copied while Kosmos ran from this folder');
    const unreadable = await move(s, { probe: answering, readPointer: () => null });
    assert.match(unreadable.because, /Kosmos may be running and it could not tell from which folder/);
    const probeThrew = await move(s, { probe: async () => { throw new Error('boom'); }, readPointer: () => path.join(s.from, 'app', 'engine') });
    assert.match(probeThrew.because, /Kosmos may be running and it could not tell from which folder/, 'a probe that failed was read as nobody serving');
    const elsewhere = await move(s, { probe: answering, readPointer: () => path.join(s.base, 'Other', 'app', 'engine') });
    assert.equal(elsewhere.action, 'moved', JSON.stringify(elsewhere));
    const noPort = await move(s, { port: undefined });
    assert.match(noPort.because, /could not tell which port/);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 #3286 --end-board: a board its logon task started, serving from THIS folder, is ended first and the port waited for; then Kosmos moves', async () => {
  const s = scratch();
  try {
    build(s.from);
    const events = [];
    let stopped = false;
    const probe = async () => {
      events.push(stopped ? 'probe:free' : 'probe:serving');
      return stopped ? { answering: false, outcome: 'refused', identity: null, startedByTask: null }
        : { answering: true, identity: '0.6.60+abc1234def56@default', startedByTask: true };
    };
    const copy = (src, dst) => { events.push('copy'); fs.cpSync(src, dst, { recursive: true }); };
    const r = await move(s, {
      probe, copy, readPointer: () => path.join(s.from, 'app', 'engine'), endBoardServingHere: true,
      endBoard: () => { events.push('end'); stopped = true; return { ok: true }; }, sleep: async () => {},
    });
    assert.equal(r.action, 'moved', JSON.stringify(shape(r)));
    assert.equal(r.boardEnded, true);
    assert.equal(r.anchorCalls.length, 1, 'the pointer was not moved to the new folder');
    assert.equal(r.anchorCalls[0].engineDir, path.join(s.to, 'app', 'engine'));
    /* The board is ended before anything is copied, and the copy waits for its port to be free. */
    assert.deepEqual(events.slice(0, 3), ['probe:serving', 'end', 'probe:free']);
    assert.ok(events.indexOf('copy') > events.indexOf('probe:free'), 'files were copied before the board let go of its port');
    assert.ok(fs.existsSync(path.join(s.from, 'Kosmos.exe')), 'the folder installed from was not left as it was');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 #3286 --end-board never ends a board in a window of its own, one that will not stop, or one that keeps its port', async () => {
  const s = scratch();
  try {
    build(s.from);
    const pointer = () => path.join(s.from, 'app', 'engine');
    let ended = 0;
    const endBoard = () => { ended += 1; return { ok: true }; };
    /* startedByTask false or unknown: the hand-off's own rule, only a board PROVEN to be the task's is ended. */
    for (const startedByTask of [false, null]) {
      const r = await move(s, { probe: async () => ({ answering: true, identity: 'x', startedByTask }), readPointer: pointer, endBoardServingHere: true, endBoard });
      assert.match(r.because, /running from this folder right now, in a window of its own, so it was not moved/);
    }
    assert.equal(ended, 0, 'a board its logon task did not start was ended');
    const serving = async () => ({ answering: true, identity: 'x', startedByTask: true });
    const wouldNot = await move(s, { probe: serving, readPointer: pointer, endBoardServingHere: true, endBoard: () => ({ ok: false, because: 'access is denied' }) });
    assert.match(wouldNot.because, /could not be stopped to move it \(access is denied\)/);
    let clock = 0;
    const keepsPort = await move(s, {
      probe: serving, readPointer: pointer, endBoardServingHere: true, endBoard, portReleaseWaitMs: 1000,
      now: () => clock, sleep: async (ms) => { clock += ms; },
    });
    assert.match(keepsPort.because, /could not be stopped to move it \(it still answered on port 9 after it was asked to stop\)/);
    assert.ok(!fs.existsSync(s.to), 'something was copied while the board still answered');
    /* Without --end-board the old rule stands. */
    const plain = await move(s, { probe: serving, readPointer: pointer, endBoard });
    assert.equal(plain.because, 'Kosmos is running from this folder right now, so it was not moved. Kosmos keeps working from here.');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 #3286: in a test process the real board is never ended: --end-board without an endBoard seam refuses to run', async () => {
  const s = scratch();
  try {
    build(s.from);
    await assert.rejects(move(s, {
      probe: async () => ({ answering: true, identity: 'x', startedByTask: true }), readPointer: () => path.join(s.from, 'app', 'engine'), endBoardServingHere: true,
    }), /a test must pass an endBoard seam/);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 #3286 --replace-older: an older, idle install is replaced and KEPT whole as the updater\'s previous build', async () => {
  const s = scratch();
  try {
    build(s.from, { version: '0.6.60' });
    build(s.to, { version: '0.6.50' });
    fs.mkdirSync(path.join(s.to, '.kosmos-update', 'previous-0.6.40'), { recursive: true });
    fs.writeFileSync(path.join(s.to, 'app', 'server.js'), '// the 0.6.50 board');
    const r = await move(s, { replaceOlder: true, readPointer: () => path.join(s.from, 'app', 'engine') });
    const kept = path.join(s.to, '.kosmos-update', 'previous-0.6.50');
    assert.deepEqual(shape(r), { ok: true, action: 'replaced', target: s.to, replaced: '0.6.50', kept, boardEnded: false, anchored: true });
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.to, 'manifest.json'), 'utf8')).version, '0.6.60', 'the new build is not in place');
    assert.equal(fs.readFileSync(path.join(kept, 'app', 'server.js'), 'utf8'), '// the 0.6.50 board', 'the replaced build was not kept whole');
    assert.ok(fs.existsSync(path.join(kept, '.kosmos-update', 'previous-0.6.40')), 'what the old install kept was lost');
    assert.deepEqual(fs.readdirSync(s.to).sort(), [...ENTRIES, '.kosmos-update'].sort());
    assert.deepEqual(stagingLeftIn(path.dirname(s.to)), []);
    assert.equal(r.anchorCalls[0].engineDir, path.join(s.to, 'app', 'engine'), 'Kosmos was not pointed at the installed copy');
    assert.equal(relocator.reportText(r), 'MOVED ' + s.to + '\r\n', 'the launcher would not read a replace as done');
    assert.equal(require('./win32apply').PREVIOUS_PREFIX, 'previous-', 'the kept build is not where the updater looks for it');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 #3286 --replace-older never replaces the install Kosmos starts from, a newer one, one holding other files, or without the flag', async () => {
  const cases = [
    [{ replaceOlder: true, readPointer: (s) => path.join(s.to, 'app', 'engine') }, '0.6.50', /is the one that starts when you sign in, so Kosmos updates it itself rather than replacing it/],
    [{ replaceOlder: true, readPointer: () => null }, '0.6.50', /could not tell which Kosmos starts when you sign in/],
    [{ replaceOlder: true, readPointer: (s) => path.join(s.from, 'app', 'engine') }, '0.6.70', /There is already a different Kosmos \(version 0\.6\.70\)/],
    [{ readPointer: (s) => path.join(s.from, 'app', 'engine') }, '0.6.50', /There is already a different Kosmos \(version 0\.6\.50\)/],
  ];
  for (const [over, installed, pattern] of cases) {
    const s = scratch();
    try {
      build(s.from, { version: '0.6.60' });
      build(s.to, { version: installed });
      const r = await move(s, { ...over, readPointer: () => over.readPointer(s) });
      assert.match(r.because, pattern);
      assert.equal(JSON.parse(fs.readFileSync(path.join(s.to, 'manifest.json'), 'utf8')).version, installed, 'the install was touched');
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
  const s = scratch();
  try {
    build(s.from, { version: '0.6.60' });
    withPersonsThings(build(s.to, { version: '0.6.50' }));
    const r = await move(s, { replaceOlder: true, readPointer: () => path.join(s.from, 'app', 'engine') });
    assert.match(r.because, /also holds Projects, stray\.txt/);
    assert.ok(fs.existsSync(path.join(s.to, 'Projects', 'garden', 'notes.txt')));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 #3286 --replace-older: a replace that fails at the last step puts the old install back; one that fails copying never touches it', async () => {
  const s = scratch();
  const realRename = fs.renameSync;
  try {
    build(s.from, { version: '0.6.60' });
    build(s.to, { version: '0.6.50' });
    const eperm = () => Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    /* Both the last step AND the put-back fail: the old install is named where it is kept, never deleted. */
    fs.renameSync = function failBoth(src, dst) {
      if (String(src).includes(relocator.STAGING_INFIX) && path.resolve(String(dst)) === path.resolve(s.to)) throw eperm();
      return realRename.apply(this, arguments);
    };
    const both = await move(s, { replaceOlder: true, readPointer: () => path.join(s.from, 'app', 'engine') });
    fs.renameSync = realRename;
    const keptAt = both.because.match(/The Kosmos that was there is kept in (.*previous-0\.6\.50)\. Kosmos keeps working from here\.$/);
    assert.ok(keptAt, both.because);
    assert.equal(JSON.parse(fs.readFileSync(path.join(keptAt[1], 'manifest.json'), 'utf8')).version, '0.6.50', 'the old install was deleted');
    realRename(keptAt[1], s.to);
    fs.rmSync(path.dirname(path.dirname(keptAt[1])), { recursive: true, force: true });
    /* Only the last step fails: the old install goes back where it was. */
    fs.renameSync = function failTheLastStep(src, dst) {
      if (path.basename(String(src)).includes(relocator.STAGING_INFIX) && path.resolve(String(dst)) === path.resolve(s.to)) throw eperm();
      return realRename.apply(this, arguments);
    };
    const r = await move(s, { replaceOlder: true, readPointer: () => path.join(s.from, 'app', 'engine') });
    fs.renameSync = realRename;
    assert.match(r.because, /could not be copied to .* \(EPERM: operation not permitted\), so it was not moved/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.to, 'manifest.json'), 'utf8')).version, '0.6.50', 'the old install was not put back');
    assert.deepEqual(stagingLeftIn(path.dirname(s.to)), []);
    assert.equal(r.anchorCalls.length, 0, 'Kosmos was pointed at a folder the replace did not finish');
    const failedCopy = await move(s, { replaceOlder: true, readPointer: () => path.join(s.from, 'app', 'engine'), copy: () => { throw new Error('disk full'); } });
    assert.match(failedCopy.because, /\(disk full\)/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.to, 'manifest.json'), 'utf8')).version, '0.6.50');
  } finally { fs.renameSync = realRename; fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#3286: the move CLI passes --end-board through, and takes it only with --move', async () => {
  let seen = null;
  const code = await relocator.cliMain(['--move', '--from', 'C:\\A', '--to', 'C:\\B', '--port', '16180', '--end-board', '--yes'],
    { relocate: async (o) => { seen = o; return { ok: false, action: 'refused', because: 'x' }; }, write: () => {} });
  assert.equal(code, 1);
  assert.equal(seen.endBoardServingHere, true);
  const without = await relocator.cliMain(['--move', '--from', 'C:\\A', '--to', 'C:\\B', '--port', '16180', '--yes'],
    { relocate: async (o) => { seen = o; return { ok: false, action: 'refused', because: 'x' }; }, write: () => {} });
  assert.equal(without, 1);
  assert.equal(seen.endBoardServingHere, false);
  assert.equal(await relocator.cliMain(['--compare', '--from', 'C:\\A', '--to', 'C:\\B', '--end-board'], { write: () => {} }), 64);
});

test('a copy that fails part way leaves no target and no staging folder', async () => {
  const s = scratch();
  try {
    build(s.from);
    let n = 0;
    const r = await move(s, { copy: (src, dst) => { n += 1; if (n === 3) throw new Error('disk full'); fs.cpSync(src, dst, { recursive: true }); } });
    assert.equal(r.ok, false);
    assert.equal(r.because, 'Kosmos could not be copied to ' + s.to + ' (disk full), so it was not moved. Kosmos keeps working from here.');
    assert.ok(!fs.existsSync(s.to), 'a half-copied Kosmos was left at the target');
    assert.deepEqual(stagingLeftIn(path.dirname(s.to)), []);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 an interrupted move\'s staging folder is swept only when its process is gone, and a link is removed without being followed', async () => {
  const s = scratch();
  try {
    build(s.from);
    const parent = path.dirname(s.to);
    fs.mkdirSync(parent, { recursive: true });
    const dead = s.to + relocator.STAGING_INFIX + '999999';
    const live = s.to + relocator.STAGING_INFIX + '4242';
    const linked = s.to + relocator.STAGING_INFIX + '5151';
    const precious = path.join(s.base, 'precious');
    for (const dir of [dead, live, precious]) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'x.txt'), 'x'); }
    fs.symlinkSync(precious, linked, 'junction');
    const asked = [];
    const r = await move(s, { pidState: (pid) => { asked.push(pid); return pid === 999999 ? 'gone' : 'alive'; } });
    assert.equal(r.action, 'moved', JSON.stringify(r));
    assert.ok(!fs.existsSync(dead), 'the staging folder of a process that is gone was left');
    assert.ok(fs.existsSync(path.join(live, 'x.txt')), 'the staging folder of a move still running was deleted');
    assert.ok(!fs.existsSync(linked), 'a link with a staging name was left');
    assert.ok(fs.existsSync(path.join(precious, 'x.txt')), 'the folder a staging-named link pointed at was emptied');
    assert.ok(!asked.includes(5151), 'a link was judged by a process id rather than removed as a link');
    assert.deepEqual(relocator.sweepInterruptedMoves(s.to, () => 'unknown'), [], 'a folder whose process cannot be checked was swept');
    assert.ok(fs.existsSync(live));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a folder that is not a complete Kosmos, or folders that overlap, are refused', async () => {
  const s = scratch();
  try {
    build(s.from);
    fs.rmSync(path.join(s.from, 'bin'), { recursive: true });
    assert.match((await move(s)).because, /this Kosmos folder is missing bin/);
    const t = scratch();
    try {
      build(t.from);
      assert.match((await move(t, { to: path.join(t.from, 'Kosmos') })).because, /overlap/);
      fs.writeFileSync(path.join(t.from, 'manifest.json'), '{"product":"something-else"}');
      assert.match((await move(t)).because, /not a complete Kosmos/);
    } finally { fs.rmSync(t.base, { recursive: true, force: true }); }
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 which Kosmos runs: same or older than the installed one hands off, newer runs from here, no complete install is the ordinary offer', () => {
  const s = scratch();
  try {
    build(s.to, { version: '0.6.60' });
    const verdictFor = (version) => {
      fs.rmSync(s.from, { recursive: true, force: true });
      build(s.from, { version });
      return relocator.compare({ from: s.from, to: s.to }).verdict;
    };
    assert.equal(verdictFor('0.6.59'), 'handoff', 'a stale older copy would re-point the Start menu, the Apps entry and the pointer');
    assert.equal(verdictFor('0.6.60'), 'handoff');
    assert.equal(verdictFor('0.6.61'), 'newer', 'a newer downloaded zip no longer runs as a by-hand update');
    assert.equal(verdictFor('0.6.x'), 'handoff', 'an unparseable version was taken as newer');
    fs.writeFileSync(path.join(s.to, 'manifest.json'), JSON.stringify({ product: 'kosmos', platform: 'win32', version: 'garbage' }));
    assert.equal(verdictFor('0.6.61'), 'handoff', 'an installed version that cannot be read was taken as older');
    build(s.to, { version: '0.6.60' });
    fs.rmSync(path.join(s.to, 'bin'), { recursive: true });
    assert.equal(verdictFor('0.6.59'), 'none', 'an incomplete install was handed off to');
    fs.rmSync(s.to, { recursive: true, force: true });
    assert.equal(verdictFor('0.6.59'), 'none');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('the build verdict uses the updater\'s own newer(), one derivation', () => {
  const seen = [];
  assert.equal(relocator.buildVerdict({ version: '1.0.0', source_sha: 'a' }, { version: '2.0.0', source_sha: 'b' }, (a, b) => { seen.push([a, b]); return true; }), 'installed-newer');
  assert.deepEqual(seen, [['2.0.0', '1.0.0']]);
  assert.equal(fs.readFileSync(path.join(__dirname, 'win32relocate.js'), 'utf8').includes("require('./update').newer"), true, 'the verdict no longer defaults to update.newer');
});

test('🛑 round 2 finding 3: compare and relocate read ONE build verdict, so they agree on every pair', async () => {
  const CASES = [
    /* this copy, the installed one, the verdict, compare's answer, relocate's answer */
    ['same build', { version: '0.6.61', source_sha: 'aaaa' }, { version: '0.6.61', source_sha: 'aaaa' }, 'same', 'handoff', 'already-there'],
    ['installed is newer', { version: '0.6.60', source_sha: 'bbbb' }, { version: '0.6.61', source_sha: 'aaaa' }, 'installed-newer', 'handoff', 'refused'],
    ['this copy is newer', { version: '0.6.62', source_sha: 'bbbb' }, { version: '0.6.61', source_sha: 'aaaa' }, 'this-newer', 'newer', 'refused'],
    ['same version rebuilt from another commit', { version: '0.6.61', source_sha: 'bbbb' }, { version: '0.6.61', source_sha: 'aaaa' }, 'rebuilt', 'newer', 'refused'],
    ['unreadable version', { version: 'garbage', source_sha: 'bbbb' }, { version: '0.6.61', source_sha: 'aaaa' }, 'unreadable', 'handoff', 'refused'],
    ['a prerelease update.newer cannot read', { version: '0.6.62-rc.1', source_sha: 'bbbb' }, { version: '0.6.61', source_sha: 'aaaa' }, 'unreadable', 'handoff', 'refused'],
    ['the same unreadable version from another commit', { version: 'garbage', source_sha: 'bbbb' }, { version: 'garbage', source_sha: 'aaaa' }, 'unreadable', 'handoff', 'refused'],
  ];
  for (const [label, mine, theirs, verdict, compared, moved] of CASES) {
    const s = scratch();
    try {
      build(s.from, mine);
      build(s.to, theirs);
      assert.equal(relocator.buildVerdict(mine, theirs), verdict, label);
      assert.equal(relocator.compare({ from: s.from, to: s.to }).verdict, compared, label + ': compare');
      const r = await move(s, { copy: () => { throw new Error('nothing may be copied over an installed Kosmos'); } });
      assert.equal(r.action, moved, label + ': relocate ' + JSON.stringify(shape(r)));
      /* The agreement itself: relocate calls it the same build exactly when compare's verdict is 'same'. */
      assert.equal(r.action === 'already-there', relocator.compare({ from: s.from, to: s.to }).build === 'same', label + ': compare and relocate disagree about the same build');
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

test('🛑 without the confirm nothing is copied; the move CLI is a dry run until --yes; --compare only reads', async () => {
  const s = scratch();
  try {
    build(s.from);
    const r = await relocator.relocate({ from: s.from, to: s.to, port: PORT, probe: NOBODY_ANSWERING, readPointer: () => null, anchor: () => ({ ok: true }) });
    assert.equal(r.ok, false);
    assert.match(r.because, /moving it was not confirmed/);
    assert.ok(!fs.existsSync(s.to));

    let asked = null;
    const fake = async (opts) => { asked = opts; return { ok: true, action: 'moved', target: s.to }; };
    assert.equal(await relocator.cliMain(['--move', '--from', s.from, '--to', s.to, '--port', '16180'], { relocate: fake, write: () => {} }), 2);
    assert.equal(asked, null, 'the move ran without --yes');
    const report = path.join(s.base, 'report.txt');
    assert.equal(await relocator.cliMain(['--move', '--from', s.from, '--to', s.to, '--port', '16180', '--report', report, '--yes'], { relocate: fake, write: () => {} }), 0);
    assert.equal(asked.liveExecutionAllowed(), true);
    assert.equal(asked.port, '16180');
    assert.equal(fs.readFileSync(report, 'utf8'), 'MOVED ' + s.to + '\r\n');
    assert.equal(await relocator.cliMain(['--compare', '--from', s.from, '--to', s.to, '--report', report], { compare: () => ({ verdict: 'handoff', target: s.to }), write: () => {} }), 0);
    assert.equal(fs.readFileSync(report, 'utf8'), 'HANDOFF ' + s.to + '\r\n');
    assert.equal(await relocator.cliMain(['--move', '--compare', '--from', s.from, '--to', s.to], { write: () => {} }), 64, 'a move and a compare at once was accepted');
    assert.equal(relocator.reportText({ ok: true, action: 'already-there', target: 'T' }), 'SAME T\r\n');
    assert.equal(relocator.reportText({ verdict: 'newer', target: 'T' }), 'NEWER T\r\n');
    assert.equal(relocator.reportText({ verdict: 'none', target: 'T' }), 'NONE T\r\n');
    assert.equal(relocator.reportText({ ok: false, because: 'a\nb' }), 'REFUSED a b\r\n');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

/* ---- the round 3 review, fixed in round 4 ------------------------------------ */

/* The reviewer's measured case: a hand-started board busy enough to answer after the probe's 2s. */
const SLOW_BOARD_ANSWERS_AFTER_MS = 2500;

/**
 * Real listeners on loopback: one that accepts and never answers, a hand-started Kosmos board that
 * answers after SLOW_BOARD_ANSWERS_AFTER_MS, and a port nothing listens on (bound, then closed).
 */
async function boardListeners() {
  const sockets = new Set();
  const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const hung = net.createServer((socket) => sockets.add(socket));
  const slow = http.createServer((req, res) => {
    const timer = setTimeout(() => {
      res.writeHead(200, { [handoff.BOARD_IDENTITY_HEADER]: '0.6.61@default', [handoff.BOARD_STARTED_BY_TASK_HEADER]: '0' });
      res.end('ok');
    }, SLOW_BOARD_ANSWERS_AFTER_MS);
    res.on('close', () => clearTimeout(timer));
  });
  slow.on('connection', (socket) => sockets.add(socket));
  const closed = net.createServer();
  const refused = await listen(closed);
  await new Promise((resolve) => closed.close(resolve));
  const ports = { hung: await listen(hung), slow: await listen(slow), refused };
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all([hung, slow].map((server) => new Promise((resolve) => server.close(resolve))));
  };
  return { ports, close };
}

test('🛑 round 3 finding 1, real listeners: a board that never answers, or a hand-started board slower than the probe, stops a move; only a refused port lets it copy', async () => {
  const listeners = await boardListeners();
  try {
    for (const [label, port] of [['a listener that never answers', listeners.ports.hung], ['a hand-started board that answers after 2.5s', listeners.ports.slow]]) {
      const s = scratch();
      try {
        build(s.from);
        const r = await move(s, { port, probe: undefined, readPointer: () => path.join(s.base, 'Other', 'app', 'engine') });
        assert.equal(r.because, 'Kosmos was not moved, because Kosmos may be running and did not answer in time. Kosmos keeps working from here.', label + ': ' + JSON.stringify(shape(r)));
        assert.ok(!fs.existsSync(s.to), label + ': something was copied while a board may be open');
      } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
    }
    const s = scratch();
    try {
      build(s.from);
      const r = await move(s, { port: listeners.ports.refused, probe: undefined });
      assert.equal(r.action, 'moved', 'a port nothing listens on stopped the move: ' + JSON.stringify(shape(r)));
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  } finally { await listeners.close(); }

  for (const [label, answer, expected] of [
    ['timed out', { answering: false, outcome: 'timed-out' }, /may be running and did not answer in time/],
    /* Round 4, finding 3: only an actual timeout says "did not answer in time". A test process cannot
       read the board task, so a failed look says it could not tell. */
    ['the look failed', { answering: false, outcome: 'error' }, /may be running and it could not tell from which folder/],
    ['no reason given', { answering: false }, /may be running and it could not tell from which folder/],
  ]) {
    const s = scratch();
    try {
      build(s.from);
      const r = await move(s, { probe: async () => answer });
      assert.match(String(r.because), expected, label + ': ' + JSON.stringify(shape(r)));
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

test('🛑 round 3 finding 6: the installed copy compares itself with the copy the engine pointer names, and never moves the pointer back to an older build', () => {
  const s = scratch();
  try {
    build(s.to, { version: '0.6.60', source_sha: 'aaaa' });
    const pointed = path.join(s.base, 'Downloads', 'kosmos-win-x64-new');
    const ask = (extra) => relocator.compareWithPointer({ from: s.to, readPointer: () => path.join(pointed, 'app', 'engine'), ...extra });
    const rebuild = (manifest) => { fs.rmSync(pointed, { recursive: true, force: true }); build(pointed, manifest); };

    rebuild({ version: '0.6.61', source_sha: 'bbbb' });
    assert.deepEqual(ask(), { verdict: 'handoff', target: pointed, build: 'this-newer' }, 'a newer copy the pointer names was not handed off to');
    rebuild({ version: '0.6.60', source_sha: 'bbbb' });
    assert.deepEqual(ask(), { verdict: 'handoff', target: pointed, build: 'rebuilt' }, 'the same version rebuilt from another commit was not handed off to');

    rebuild({ version: '0.6.59', source_sha: 'bbbb' });
    assert.equal(ask().verdict, 'none', 'an OLDER copy the pointer names was handed off to');
    rebuild({ version: '0.6.60', source_sha: 'aaaa' });
    assert.equal(ask().verdict, 'none', 'the same build');
    rebuild({ version: 'garbage', source_sha: 'bbbb' });
    assert.equal(ask().verdict, 'none', 'a copy whose version cannot be read was handed off to');
    rebuild({ version: '0.6.61', source_sha: 'bbbb' });
    fs.rmSync(path.join(pointed, 'bin'), { recursive: true });
    assert.equal(ask().verdict, 'none', 'an incomplete copy was handed off to');
    fs.rmSync(pointed, { recursive: true, force: true });
    assert.equal(ask().verdict, 'none', 'a copy that is not there was handed off to');

    assert.deepEqual(relocator.compareWithPointer({ from: s.to, readPointer: () => path.join(s.to, 'app', 'engine') }),
      { verdict: 'none', target: s.to, because: 'the pointer names this copy' });
    assert.equal(relocator.compareWithPointer({ from: s.to, readPointer: () => null }).verdict, 'none');
    assert.equal(relocator.compareWithPointer({ from: s.to, readPointer: () => { throw new Error('unreadable'); } }).verdict, 'none');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('round 3 finding 6: --compare --pointer writes the verdict the launcher reads, and takes no --to', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-relocate-cli-'));
  try {
    const report = path.join(base, 'report.txt');
    let asked = null;
    const fake = (opts) => { asked = opts; return { verdict: 'handoff', target: 'C:\\Downloads\\K' }; };
    assert.equal(await relocator.cliMain(['--compare', '--from', 'C:\\P\\Kosmos', '--pointer', '--report', report], { compareWithPointer: fake, write: () => {} }), 0);
    assert.deepEqual(asked, { from: 'C:\\P\\Kosmos' });
    assert.equal(fs.readFileSync(report, 'utf8'), 'HANDOFF C:\\Downloads\\K\r\n');
    assert.equal(await relocator.cliMain(['--compare', '--from', 'C:\\P', '--pointer', '--to', 'C:\\Q'], { compareWithPointer: fake, write: () => {} }), 64);
    assert.equal(await relocator.cliMain(['--move', '--from', 'C:\\P', '--to', 'C:\\Q', '--pointer', '--yes'], { relocate: async () => ({ ok: true }), write: () => {} }), 64);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

/* ---- the round 4 review, fixed in round 5 ------------------------------------ */

/**
 * A real listener on one address: a hand-started Kosmos board ('board'), a program that answers in
 * something other than HTTP ('not-http'), or one that never answers ('hung'). Null when this machine
 * cannot listen there.
 */
async function listenerOn(host, kind) {
  const sockets = new Set();
  const server = kind === 'board'
    ? http.createServer((req, res) => {
      res.writeHead(200, { [handoff.BOARD_IDENTITY_HEADER]: '0.6.61+abc@default', [handoff.BOARD_STARTED_BY_TASK_HEADER]: '0' });
      res.end('board');
    })
    : net.createServer((socket) => { if (kind === 'not-http') socket.end('RFB 003.008\n'); });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const listening = await new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(0, host, () => resolve(true));
  });
  if (!listening) return null;
  return { port: server.address().port, close: () => new Promise((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }) };
}

test('🛑 round 4 finding 1, real listeners: a board from this folder on ::1 only, on 127.0.0.1 only, or on the KOSMOS_BIND_HOST address stops a move', async (t) => {
  for (const [label, host, extraEnv] of [['::1 only', '::1', {}], ['127.0.0.1 only', '127.0.0.1', {}], ['KOSMOS_BIND_HOST=127.0.0.2', '127.0.0.2', { KOSMOS_BIND_HOST: '127.0.0.2' }]]) {
    const board = await listenerOn(host, 'board');
    if (!board) { t.diagnostic('ARM NOT RUN: ' + label + ', this machine cannot listen on ' + host); continue; }
    const s = scratch();
    try {
      build(s.from);
      const r = await move(s, { port: board.port, probe: undefined, env: { ...process.env, ...extraEnv }, readPointer: () => path.join(s.from, 'app', 'engine') });
      assert.equal(r.because, 'Kosmos is running from this folder right now, so it was not moved. Kosmos keeps working from here.', label + ': ' + JSON.stringify(shape(r)));
      assert.ok(!fs.existsSync(s.to), label + ': something was copied');
    } finally {
      await board.close();
      fs.rmSync(s.base, { recursive: true, force: true });
    }
  }
});

test('🛑 round 4 finding 3, real listeners: a move over a port that times out, holds another program, or fails while the board task runs, says which', async () => {
  const win32board = require('./win32board');
  const RUNNING_ROW = '"BOX","\\Kosmos\\board","N/A","Running","Interactive only","9/13/2026 1:00:00 PM","267009"\r\n';
  const boardTask = (state) => win32board.setRunner((args) => {
    if (state === 'unreadable') return { ok: false, out: 'ERROR: The operation timed out.' };
    if (state === 'unregistered' && args.includes('/XML')) return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
    if (args.includes('/XML')) return { ok: true, out: '<?xml version="1.0"?><Task><Settings></Settings></Task>' };
    if (args.includes('/V')) return state === 'running' ? { ok: true, out: RUNNING_ROW } : { ok: false, out: 'ERROR: The system cannot find the file specified.' };
    return { ok: true, out: 'SUCCESS' };
  });
  const notHttp = await listenerOn('127.0.0.1', 'not-http');
  const hung = await listenerOn('127.0.0.1', 'hung');
  try {
    for (const [label, listener, state, expected] of [
      ['a listener that never answers', hung, 'not running', 'Kosmos was not moved, because Kosmos may be running and did not answer in time. Kosmos keeps working from here.'],
      /* Round 5, finding 5: "another program" only for a board task known not to be registered. */
      ['a program that is not HTTP, no board task registered', notHttp, 'unregistered',
        'Another program is using port ' + notHttp.port + ', so Kosmos cannot tell whether it is still open. Restart your computer, then open Kosmos again.'],
      ['a program that is not HTTP, the board task registered and not proven running', notHttp, 'not running',
        'Kosmos could not tell whether it is still open. Restart your computer, then open Kosmos again.'],
      ['a program that is not HTTP, the board task running', notHttp, 'running', 'Kosmos was not moved, because Kosmos may be running and it could not tell from which folder. Kosmos keeps working from here.'],
      ['a program that is not HTTP, the board task unreadable', notHttp, 'unreadable', 'Kosmos was not moved, because Kosmos may be running and it could not tell from which folder. Kosmos keeps working from here.'],
    ]) {
      const s = scratch();
      try {
        build(s.from);
        boardTask(state);
        const r = await move(s, { port: listener.port, probe: undefined });
        assert.equal(r.because, expected, label + ': ' + JSON.stringify(shape(r)));
        assert.ok(!fs.existsSync(s.to), label + ': something was copied');
      } finally {
        win32board.setRunner(null);
        fs.rmSync(s.base, { recursive: true, force: true });
      }
    }
  } finally {
    await notHttp.close();
    await hung.close();
  }
});

/* ---- the round 6 review, fixed in round 7 ------------------------------------ */

test('🛑 round 6 finding 1, real listener: with KOSMOS_BIND_HOST set to this PC\'s own non-loopback address and nothing listening, Kosmos moves (C); a connection not made in time says "did not answer in time"', async (t) => {
  const connectTimedOut = await move((() => { const s = scratch(); build(s.from); return s; })(), { probe: async () => ({ answering: false, outcome: handoff.PROBE_OUTCOMES.CONNECT_TIMED_OUT }) });
  assert.match(String(connectTimedOut.because), /may be running and did not answer in time/, JSON.stringify(shape(connectTimedOut)));

  if (process.platform !== 'win32') { t.diagnostic('ARM NOT RUN: C, the slow refusal on a PC\'s own addresses was measured on Windows'); return; }
  const candidates = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && !i.internal)
    .sort((a, b) => (a.family === b.family ? 0 : a.family === 'IPv4' ? -1 : 1))
    .map((i) => (i.family === 'IPv6' && /^fe80:/i.test(i.address) ? i.address + '%' + i.scopeid : i.address));
  /* The choice uses its own looks (an explicit 5 s connect limit, a port closed without ever being probed), so a
     control that changes the every-address look cannot make this skip instead of going red. */
  const LOOK = { connectTimeoutMs: 5000 };
  let chosen = null;
  for (const address of candidates) {
    const board = await listenerOn(address, 'board');
    if (!board) continue;
    const reached = await handoff.probeBoard(board.port, address, LOOK);
    await board.close();
    if (!reached.answering) continue;
    const gone = await listenerOn(address, 'hung');
    const closedPort = gone.port;
    await gone.close();
    if ((await handoff.probeBoard(closedPort, address, LOOK)).outcome === handoff.PROBE_OUTCOMES.REFUSED) { chosen = { address, port: closedPort }; break; }
  }
  if (!chosen) { t.skip('this PC has no non-loopback address that takes its own connections and refuses a closed port within the connect limit'); return; }
  const s = scratch();
  try {
    build(s.from);
    const r = await move(s, { port: chosen.port, probe: undefined, env: { ...process.env, KOSMOS_BIND_HOST: chosen.address } });
    assert.equal(r.action, 'moved', 'C: nothing listening on ' + chosen.address + ' refused the move: ' + JSON.stringify(shape(r)));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 round 7 finding 4: no test in this suite can connect to 16180, the live board\'s port', () => {
  /* The check itself, never a socket: even with the check removed, this test cannot send anything to 16180. */
  assert.throws(() => refuseTheLiveBoardPort([{ host: '127.0.0.1', port: LIVE_BOARD_PORT }]), /16180/);
  assert.throws(() => refuseTheLiveBoardPort([[{ host: '127.0.0.1', port: LIVE_BOARD_PORT }, null]]), /16180/);
  assert.throws(() => refuseTheLiveBoardPort([LIVE_BOARD_PORT, '127.0.0.1']), /16180/);
  assert.doesNotThrow(() => refuseTheLiveBoardPort([{ host: '127.0.0.1', port: 9 }]));
  assert.equal(net.Socket.prototype.connect.name, 'connectAnywhereButTheLiveBoard', 'the check is not on every connection');
});
