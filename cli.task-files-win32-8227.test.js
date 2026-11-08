'use strict';

/**
 * kosmos#8227 items 1 and 4, the Windows half of the #8214 review leftovers.
 *
 * Item 1: a drive letter mapped to a network share reads as local by its name (Z:\share\x), so `kosmos task files`
 * opened it, at a path a marker chose. Now each drive letter's kind is asked of engine/windrives.js (#7232, which
 * also knows a remembered mapping whose server is gone), and a network drive, a letter with no drive, or one whose kind
 * cannot be read, is NOT CHECKED, as UNC is. The Windows CLI's `task built --file` does not keep such a path either,
 * and says why. The rules run on any host through the driveInfo seam; the real table and real files need Windows.
 *
 * Item 4: the Windows CLI's own seam, `ctx.pathRules.resolve` then `keptPath`, under path.win32 on a real Windows
 * host, for a drive path, a UNC path and a path through a folder link (a junction: a symlink needs Developer Mode or
 * an admin, a junction needs neither). A Mac cannot read a C:\ file, so these run only on Windows; "win32" in this
 * file's name is what puts it in tools/windows-tests.js.
 *
 * No board is booted (the Windows runner boots none, see tools/windows-tests.js): the CLI is driven in-process against
 * a scripted board, as tools.windows-kosmos-cli-570.test.js does, so what it SENDS and what it PRINTS are what is tested.
 *
 * Measured by hand on a Windows 11 box (11-08), not in this file: a drive mapped with `net use X: http://...` to a
 * local WebDAV server reads as a network drive; the old filesLines opened X:\report.txt (the server logged PROPFIND +
 * GET) and the new one sent the server nothing and said NOT CHECKED. A whole `task files` run took about 0.4 s. A
 * worktree board with the real table kept a C: path and kept no X: path.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const tasklist = require('./engine/tasklist');
const fileprint = require('./engine/fileprint');
const windrives = require('./engine/windrives');
const cli = require('./tools/windows/kosmos-cli');

const NEEDS_WINDOWS = process.platform !== 'win32' && 'needs a real Windows host (a Mac cannot read a C:\\ file)';
const sha = (text) => 'sha256:' + crypto.createHash('sha256').update(text).digest('hex');
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskfiles-win-')));
const OUT = path.join(SANDBOX, 'out');
fs.mkdirSync(OUT, { recursive: true });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const LOCAL = { kind: 'local', share: null };
const REMOTE = { kind: 'remote', share: '\\\\srv\\share' };
const ABSENT = { kind: 'absent', share: null };
const kinds = (byLetter) => (letter) => (Object.prototype.hasOwnProperty.call(byLetter, letter.toUpperCase()) ? byLetter[letter.toUpperCase()] : null);

/* The Windows CLI, in-process, against a scripted board: every request is recorded; a mark is answered as changed,
   and `task files` gets `built` as its built list. */
async function win(argv, { cwd, driveInfo, engine, built = [] } = {}) {
  const calls = []; const out = []; const err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: 'a'.repeat(32) },
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => null, agentToken: () => 'a'.repeat(32) },
    pathRules: path.win32,
    ...(cwd ? { cwd: () => cwd } : {}), ...(driveInfo !== undefined ? { driveInfo } : {}), ...(engine ? { engine } : {}),
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      const route = url.replace('http://127.0.0.1:1', '');
      const body = init.body === undefined ? undefined : JSON.parse(init.body);
      calls.push({ route, method: init.method, body });
      const json = route.startsWith('/api/tasks') ? { listState: 'built', tasks: built } : { task: { number: 1 }, changed: true };
      return { status: 200, text: async () => JSON.stringify(json) };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}
const sentMark = (r) => { const b = r.calls.find((c) => /\/built$/.test(c.route)); assert.ok(b, 'no mark reached the board: ' + r.err); return b.body; };
const builtRow = (at, print) => ({ number: 1, sentence: 'Deliverable', builtAt: 'x', builtFingerprint: print, builtFilePath: at });

// ── item 1: the rules, on any host ──────────────────────────────────────────
test('#8227 item 1: driveKind is the one verdict both sides read', () => {
  assert.equal(tasklist.driveKind(LOCAL), 'local');
  assert.equal(tasklist.driveKind(REMOTE), 'network');
  assert.equal(tasklist.driveKind(ABSENT), 'absent');
  assert.equal(tasklist.driveKind(tasklist.DRIVE_KINDS_OLD), 'old');
  for (const odd of [null, undefined, {}, { kind: 'something new' }]) assert.equal(tasklist.driveKind(odd), 'unknown', JSON.stringify(odd));
});

test('#8227 item 1: driveRefusal opens this computer\'s own drives only', () => {
  assert.equal(tasklist.driveRefusal('C:\\x', LOCAL), null);
  assert.equal(tasklist.driveRefusal('Z:\\share\\x', REMOTE), 'a network drive, so Kosmos does not open it');
  // A remembered mapping whose server is gone is 'remote' in engine/windrives.js too (named by the redirector).
  assert.equal(tasklist.driveRefusal('y:\\x', { kind: 'remote', share: null }), 'a network drive, so Kosmos does not open it', 'an unnamed share passed');
  assert.equal(tasklist.driveRefusal('Q:\\x', ABSENT), 'there is no drive Q: on this computer now, so Kosmos does not open it');
  assert.equal(tasklist.driveRefusal('u:\\x', null), 'Kosmos could not tell what kind of drive U: is, so it does not open it');
  assert.equal(tasklist.driveRefusal('U:\\x', { kind: 'something new' }), 'Kosmos could not tell what kind of drive U: is, so it does not open it', 'an unknown kind was opened');
});

test('#8227 review 2: windrives.infoOf learns once, with the one-shot bound, and never starts a background learn', () => {
  const runs = []; let later = 0;
  try {
    windrives.setLearnForTests({ now: () => 1e6, run: (o) => { runs.push(o); return 'C\t3\t\nZ\t4\t\\\\srv\\share\n'; }, runLater: () => { later += 1; } });
    assert.deepEqual(windrives.infoOf('c'), LOCAL);
    assert.deepEqual(windrives.infoOf('Z'), REMOTE);
    assert.deepEqual(windrives.infoOf('Q'), ABSENT, 'a letter no drive has');
    assert.equal(runs.length, 1, 'the table was learned more than once');
    assert.equal(runs[0].timeoutMs, windrives.ONE_SHOT_TIMEOUT_MS, 'the one-shot read did not take its own bound');
    assert.ok(windrives.ONE_SHOT_TIMEOUT_MS > 3000, 'the one-shot bound is no longer than the board\'s 3 s');
    assert.equal(later, 0, 'a background learn was started (a one-shot process would wait for it)');
    assert.equal(windrives.infoOf('1'), null);
    // A caller's own bound is passed through, and a learn that fails is no table.
    windrives.setLearnForTests({ now: () => 2e6, run: (o) => { runs.push(o); throw new Error('powershell timed out'); }, runLater: () => { later += 1; } });
    assert.equal(windrives.infoOf('C', { timeoutMs: 1234 }), null, 'a failed learn passed as a table');
    assert.equal(runs[1].timeoutMs, 1234);
    assert.equal(later, 0);
  } finally {
    windrives.setLearnForTests(null);
  }
});

test('#8227 item 1: task files on Windows never opens a network or missing drive, and says unknown kinds once', () => {
  const FP = sha('drives');
  const row = (number, at) => ({ number, sentence: 'Task ' + number, builtAt: 'x', builtFingerprint: FP, builtFilePath: at });
  const opened = [];
  const compare = (p) => { opened.push(p); return { ok: true, match: true }; };
  const asked = [];
  const info = (letter) => { asked.push(letter); return kinds({ C: LOCAL, Z: REMOTE, Q: ABSENT, D: LOCAL })(letter); };
  const body = { listState: 'built', tasks: [row(1, 'C:\\a.txt'), row(2, 'Z:\\share\\b.txt'), row(3, 'q:\\c.txt'), row(4, 'D:\\d.txt'), row(5, '\\\\srv\\share\\e.txt')] };
  const got = tasklist.filesLines(body, { project: 'p', platform: 'win32', compare, driveInfo: info });
  assert.deepEqual(got.lines.slice(0, 10), [
    '#1  Task 1', '    matches  C:\\a.txt',
    '#2  Task 2', '    NOT CHECKED Z:\\share\\b.txt: a network drive, so Kosmos does not open it',
    '#3  Task 3', '    NOT CHECKED q:\\c.txt: there is no drive Q: on this computer now, so Kosmos does not open it',
    '#4  Task 4', '    matches  D:\\d.txt',
    '#5  Task 5', '    NOT CHECKED \\\\srv\\share\\e.txt: not a local absolute path, so Kosmos does not open it'], got.lines.join('\n'));
  assert.deepEqual(opened, ['C:\\a.txt', 'D:\\d.txt'], 'a network or missing drive was opened');
  assert.deepEqual(asked.map((l) => l.toUpperCase()), ['C', 'Z', 'Q', 'D'], 'the kind was not asked for each drive path (or was asked for UNC)');
  assert.match(got.lines[got.lines.length - 2], /2 match, .*3 not opened/);
  // Kinds that could not be learned, or a reader that throws: nothing is opened, the reason in full once, then named.
  for (const blindInfo of [() => null, () => { throw new Error('reader broke'); }]) {
    opened.length = 0;
    const blind = tasklist.filesLines({ listState: 'built', tasks: [row(1, 'C:\\a.txt'), row(2, 'D:\\b.txt')] }, { project: 'p', platform: 'win32', compare, driveInfo: blindInfo });
    assert.deepEqual(blind.lines.filter((l) => l.startsWith('    ')), [
      '    NOT CHECKED C:\\a.txt: Kosmos could not read what kind of drive each letter is on this computer, so it opens no path',
      '    NOT CHECKED D:\\b.txt: the drive types again (above)'], blind.lines.join('\n'));
    assert.deepEqual(opened, [], 'a path was opened with no drive kinds');
  }
  // CONTROL: off Windows a drive path is another computer's, and the kinds are never asked.
  asked.length = 0;
  const mac = tasklist.filesLines({ listState: 'built', tasks: [row(1, 'Z:\\share\\b.txt')] }, { project: 'p', platform: 'darwin', compare, automounts: new Set(), driveInfo: info });
  assert.equal(mac.lines[1], '    NOT CHECKED Z:\\share\\b.txt: marked on a Windows computer, so it is not on this one');
  assert.deepEqual(asked, [], 'the drive kinds were asked off Windows');
});

test('#8227 item 1: with no seam, task files asks engine/windrives.js (the #7232 table)', () => {
  const FP = sha('wired');
  const row = (number, at) => ({ number, sentence: 'Task ' + number, builtAt: 'x', builtFingerprint: FP, builtFilePath: at });
  const compare = () => ({ ok: true, match: true });
  try {
    windrives.setTableForTests({ C: LOCAL, Z: REMOTE });
    const got = tasklist.filesLines({ listState: 'built', tasks: [row(1, 'C:\\a.txt'), row(2, 'Z:\\b.txt')] }, { project: 'p', platform: 'win32', compare });
    assert.deepEqual(got.lines.filter((l) => l.startsWith('    ')), ['    matches  C:\\a.txt', '    NOT CHECKED Z:\\b.txt: a network drive, so Kosmos does not open it'], got.lines.join('\n'));
    windrives.setTableForTests(false);   // a table that could not be learned
    const blind = tasklist.filesLines({ listState: 'built', tasks: [row(1, 'C:\\a.txt')] }, { project: 'p', platform: 'win32', compare });
    assert.match(blind.lines[1], /could not read what kind of drive each letter is/, blind.lines.join('\n'));
  } finally {
    windrives.setTableForTests(null);
  }
});

// ── item 1: the record side and the real table, on Windows ──────────────────
test('#8227 item 1 Windows: built --file sends a local drive path, and never one on a network drive', { skip: NEEDS_WINDOWS }, async () => {
  const file = path.join(OUT, 'drive.txt');
  fs.writeFileSync(file, 'on a drive');
  const FP = sha('on a drive');
  const letter = file.charAt(0).toUpperCase();
  // The real table (engine/windrives.js, no seam, its own one-shot bound): this test's own drive is a local one.
  assert.deepEqual(windrives.infoOf(letter), LOCAL, 'Windows did not read the drive this test runs on as local');
  const kept = await win(['task', 'built', 'proj-1', '1', 'done', '--file', 'drive.txt'], { cwd: OUT });
  assert.equal(kept.code, 0, kept.err);
  assert.equal(sentMark(kept).file_path, file, 'a local drive path was not sent');
  assert.equal(sentMark(kept).fingerprint, FP);
  assert.doesNotMatch(kept.out, /Its path was not sent/, kept.out);
  // Each kind that is not local: the fingerprint goes, the path does not, and the line says why.
  const said = (why) => 'Its path was not sent (' + why + '), so kosmos task files cannot check this mark.';
  for (const [opts, why] of [
    [{ driveInfo: () => REMOTE }, letter + ': is a network drive, and kosmos task files never opens one'],
    [{ driveInfo: () => ABSENT }, 'drive ' + letter + ': did not show up as one of this computer\'s drives'],
    [{ driveInfo: () => null }, 'Kosmos could not read what kind of drive ' + letter + ': is'],
    [{ driveInfo: () => { throw new Error('reader broke'); } }, 'Kosmos could not read what kind of drive ' + letter + ': is'],
    [{ engine: { windrives: {} } }, 'this install of Kosmos cannot tell a network drive from a local one yet; update Kosmos'],
    [{ engine: { tasklist: { ...tasklist, driveKind: undefined } } }, 'this install of Kosmos cannot tell a network drive from a local one yet; update Kosmos'],
  ]) {
    const r = await win(['task', 'built', 'proj-1', '1', 'done', '--file', 'drive.txt'], { cwd: OUT, ...opts });
    assert.equal(r.code, 0, r.err);
    const sent = sentMark(r);
    assert.equal(sent.fingerprint, FP, why + ': the fingerprint did not go');
    assert.equal('file_path' in sent, false, why + ': the path was sent');
    assert.ok(r.out.split('\n').includes(said(why)), r.out);
  }
  // task files through the CLI: the real table opens the local file; a drive read as network is not opened.
  const files = await win(['task', 'files', 'proj-1'], { built: [builtRow(file, FP)] });
  assert.ok(files.out.split('\n').includes('    matches  ' + file), files.out + files.err);
  const netFiles = await win(['task', 'files', 'proj-1'], { built: [builtRow(file, FP)], driveInfo: () => REMOTE });
  assert.ok(netFiles.out.split('\n').includes('    NOT CHECKED ' + file + ': a network drive, so Kosmos does not open it'), netFiles.out);
  // An install whose windrives cannot tell: task files says to update, as task built --file does (review 5).
  const oldFiles = await win(['task', 'files', 'proj-1'], { built: [builtRow(file, FP)], engine: { windrives: {} } });
  assert.ok(oldFiles.out.split('\n').includes('    NOT CHECKED ' + file + ': this install of Kosmos cannot tell a network drive from a local one yet, so it does not open it; update Kosmos'), oldFiles.out);
  // o.engine.windrives reaches task files too (one seam for both verbs).
  const engFiles = await win(['task', 'files', 'proj-1'], { built: [builtRow(file, FP)], engine: { windrives: { infoOf: () => REMOTE } } });
  assert.ok(engFiles.out.split('\n').includes('    NOT CHECKED ' + file + ': a network drive, so Kosmos does not open it'), engFiles.out);
});

// ── item 4: the CLI seam under Windows rules, on Windows ────────────────────
test('#8227 item 4 Windows: pathRules.resolve then keptPath, for a drive path, a UNC path and a folder link', { skip: NEEDS_WINDOWS }, async () => {
  const w = path.win32;
  // A drive path: resolved against the folder it runs in, kept whole.
  const drive = w.resolve(OUT, 'sub\\..\\x.txt');
  assert.equal(drive, w.join(OUT, 'x.txt'), 'a drive path did not resolve lexically');
  assert.equal(fileprint.keptPath(drive), true);
  // A UNC path: absolute by itself, and never kept, however it is spelled.
  for (const unc of ['\\\\host\\share\\x.txt', '//host/share/x.txt', '\\\\?\\UNC\\host\\share\\x.txt']) {
    const r = w.resolve(OUT, unc);
    assert.equal(fileprint.keptPath(r), false, unc + ' resolved to ' + r + ', which was kept');
  }
  // A folder link: a junction to a real folder. Windows resolves .. by name (as its kernel does), so the kept path
  // names the link, and the fingerprint read through it is the real file's.
  const real = path.join(OUT, 'real');
  const link = path.join(OUT, 'jn');
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(real, 'f.txt'), 'through a link');
  fs.symlinkSync(real, link, 'junction');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'CONTROL: the junction was not made');
  const through = w.resolve(OUT, 'jn\\f.txt');
  assert.equal(through, w.join(OUT, 'jn', 'f.txt'));
  assert.equal(fileprint.keptPath(through), true);
  const r = await win(['task', 'built', 'proj-1', '1', 'done', '--file', 'jn\\f.txt'], { cwd: OUT });
  assert.equal(r.code, 0, r.err);
  assert.equal(sentMark(r).file_path, through, 'the path sent was not the one named through the link');
  assert.equal(sentMark(r).fingerprint, sha('through a link'));
  const files = await win(['task', 'files', 'proj-1'], { built: [builtRow(through, sha('through a link'))] });
  assert.ok(files.out.split('\n').includes('    matches  ' + through), files.out + files.err);
});
