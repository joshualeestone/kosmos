'use strict';
/**
 * win32-installer-native: "Move Kosmos", the engine half (engine/win32relocate.js).
 *
 * Every folder is a scratch folder, the board probe and the engine pointer are stubs, and nothing
 * here starts a Kosmos. The launcher's half (where Kosmos is, the question, the relaunch) is in
 * tools.win-installer-native.test.js.
 *
 *   node --test engine/win32relocate.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const relocator = require('./win32relocate');
const { ENTRIES } = require('./win32update');

const NOBODY_ANSWERING = async () => ({ answering: false, identity: null, startedByTask: null });

function scratch() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-relocate-'));
  return { base, from: path.join(base, 'Downloads', 'kosmos-win-x64'), to: path.join(base, 'Local', 'Programs', 'Kosmos') };
}

/** A Kosmos build as the build script lays it out, plus a person's projects and a stray file. */
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
  return relocator.relocate({ from: s.from, to: s.to, port: 16180, probe: NOBODY_ANSWERING, readPointer: () => null, liveExecutionAllowed: () => true, ...extra });
}

const stagingLeftIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.includes(relocator.STAGING_INFIX)) : []);

test('a move copies exactly the updater\'s ENTRIES, never Projects or anything else, and leaves the old copy where it was', async () => {
  const s = scratch();
  try {
    withPersonsThings(build(s.from));
    const r = await move(s);
    assert.deepEqual(r, { ok: true, action: 'moved', target: s.to });
    assert.deepEqual(fs.readdirSync(s.to).sort(), [...ENTRIES].sort(), 'the new folder does not hold exactly the build\'s own entries');
    assert.ok(!fs.existsSync(path.join(s.to, 'Projects')), 'the person\'s projects were copied into the program folder');
    assert.equal(fs.readFileSync(path.join(s.to, 'runtime', 'node.exe'), 'utf8'), 'MZ node');
    assert.ok(fs.existsSync(path.join(s.from, 'Kosmos.exe')) && fs.existsSync(path.join(s.from, 'Projects', 'garden', 'notes.txt')), 'the old copy was changed');
    assert.deepEqual(stagingLeftIn(path.dirname(s.to)), [], 'a staging folder was left behind');
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

test('the same build already in place is not copied again', async () => {
  const s = scratch();
  try {
    build(s.from);
    build(s.to);
    fs.writeFileSync(path.join(s.to, 'app', 'server.js'), '// the copy already there');
    let copied = 0;
    const r = await move(s, { copy: () => { copied += 1; } });
    assert.deepEqual(r, { ok: true, action: 'already-there', target: s.to });
    assert.equal(copied, 0);
    assert.equal(fs.readFileSync(path.join(s.to, 'app', 'server.js'), 'utf8'), '// the copy already there');
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

test('an incomplete Kosmos, other files, or a file at the target are each refused', async () => {
  const s = scratch();
  try {
    build(s.from);
    build(s.to);
    fs.rmSync(path.join(s.to, 'runtime'), { recursive: true });
    assert.match((await move(s)).because, /because the Kosmos in .* is incomplete/);
    fs.rmSync(s.to, { recursive: true });
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
    assert.match(probeThrew.because, /running from this folder right now/, 'a probe that failed was read as nobody serving');
    const elsewhere = await move(s, { probe: answering, readPointer: () => path.join(s.base, 'Other', 'app', 'engine') });
    assert.equal(elsewhere.action, 'moved', JSON.stringify(elsewhere));
    const noPort = await move(s, { port: undefined });
    assert.match(noPort.because, /could not tell which port/);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
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

test('🛑 without the confirm nothing is copied, and the CLI is a dry run until --yes', async () => {
  const s = scratch();
  try {
    build(s.from);
    const r = await relocator.relocate({ from: s.from, to: s.to, port: 16180, probe: NOBODY_ANSWERING, readPointer: () => null });
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
    assert.equal(relocator.reportText({ ok: true, action: 'already-there', target: 'T' }), 'SAME T\r\n');
    assert.equal(relocator.reportText({ ok: false, because: 'a\nb' }), 'REFUSED a b\r\n');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});
