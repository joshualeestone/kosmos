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

const relocator = require('./win32relocate');
const { ENTRIES } = require('./win32update');

const NOBODY_ANSWERING = async () => ({ answering: false, identity: null, startedByTask: null });

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
    from: s.from, to: s.to, port: 16180, probe: NOBODY_ANSWERING, readPointer: () => null,
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
    assert.deepEqual(shape(r), { ok: true, action: 'moved', target: s.to, anchored: true });
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
    assert.deepEqual(shape(r), { ok: true, action: 'moved', target: s.to, anchored: false, anchorProblem: 'disk full' });
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 in a test process the real anchor is never reached: a move without an anchor seam refuses to run', async () => {
  const s = scratch();
  try {
    build(s.from);
    await assert.rejects(relocator.relocate({ from: s.from, to: s.to, port: 16180, probe: NOBODY_ANSWERING, readPointer: () => null, pidState: () => 'alive', liveExecutionAllowed: () => true }),
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
    assert.deepEqual(shape(r), { ok: true, action: 'already-there', target: s.to, anchored: true });
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

test('compare uses the updater\'s own newer(), one derivation', () => {
  const s = scratch();
  try {
    build(s.from, { version: '1.0.0' });
    build(s.to, { version: '2.0.0' });
    const seen = [];
    relocator.compare({ from: s.from, to: s.to, newer: (a, b) => { seen.push([a, b]); return true; } });
    assert.deepEqual(seen, [['1.0.0', '2.0.0']]);
    assert.equal(fs.readFileSync(path.join(__dirname, 'win32relocate.js'), 'utf8').includes("require('./update').newer"), true, 'compare no longer defaults to update.newer');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 without the confirm nothing is copied; the move CLI is a dry run until --yes; --compare only reads', async () => {
  const s = scratch();
  try {
    build(s.from);
    const r = await relocator.relocate({ from: s.from, to: s.to, port: 16180, probe: NOBODY_ANSWERING, readPointer: () => null, anchor: () => ({ ok: true }) });
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
