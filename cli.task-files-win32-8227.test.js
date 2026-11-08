'use strict';

/**
 * kosmos#8227 items 1 and 4, the Windows half of the #8214 review leftovers.
 *
 * Item 1: a drive letter mapped to a network share reads as local by its name (Z:\share\x), so `kosmos task files`
 * opened it, at a path a marker chose. Now each drive letter's kind is read once a run (engine/tasklist.js
 * driveTypesHere) and a network drive, or one whose kind cannot be read, is NOT CHECKED, as UNC is. The Windows CLI's
 * `task built --file` does not keep such a path either. The rules run on any host through the driveTypes seam; the
 * record side and the real read need Windows.
 *
 * Item 4: the Windows CLI's own seam, `ctx.pathRules.resolve` then `keptPath`, under path.win32 on a real Windows
 * host, for a drive path, a UNC path and a path through a folder link (a junction: a symlink needs Developer Mode or
 * an admin, a junction needs neither). A Mac cannot read a C:\ file, so these run only on Windows; "win32" in this
 * file's name is what puts it in tools/windows-tests.js.
 *
 * Measured by hand on a Windows 11 box (11-08), not in this file: a drive mapped with `net use X: http://...` to a
 * local WebDAV server reads DriveType 4; the old filesLines opened X:\report.txt (the server logged PROPFIND + GET)
 * and the new one sent the server nothing and said NOT CHECKED. Reading the kinds took about 200 ms, once a run.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskfiles-win-')));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const tasklist = require('./engine/tasklist');
const fileprint = require('./engine/fileprint');
const cli = require('./tools/windows/kosmos-cli');

const WINDOWS = process.platform === 'win32';
const ON_WINDOWS = !WINDOWS && 'needs a real Windows host (a Mac cannot read a C:\\ file)';
const sha = (text) => 'sha256:' + crypto.createHash('sha256').update(text).digest('hex');
const OUT = path.join(SANDBOX, 'out');
fs.mkdirSync(OUT, { recursive: true });

let base;
let projectId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install(['mona'].map((a) => fleet.agent(a, { state: 'idle' }))).agents;
  projectId = projects.create({ name: 'Win files' }).id;
  projects.addAgent(projectId, 'mona', roster);
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const stored = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
const tokenOf = (name) => { const m = sendertoken.mint(name); assert.equal(m.ok, true, m.because); return m.token; };
async function win(argv, { token = null, cwd, driveTypes } = {}) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base, ...(cwd ? { cwd: () => cwd } : {}), ...(driveTypes !== undefined ? { driveTypes } : {}),
    pathRules: path.win32,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => token },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

// ── item 1: the rules, on any host ──────────────────────────────────────────
test('#8227 item 1: driveTypesHere reads the letters as numbers, and anything it cannot read is null', () => {
  const asked = [];
  const run = (exe, args) => { asked.push([exe, args]); return 'C3\r\nD2\r\nz4\r\nE5\r\n  F6  \r\nG0\r\nnoise\r\nH9\r\n'; };
  const got = tasklist.driveTypesHere('win32', run);
  assert.deepEqual([...got], [['C', 3], ['D', 2], ['Z', 4], ['E', 5], ['F', 6], ['G', 0]], 'a letter was misread (H9 is no DriveType)');
  assert.equal(asked.length, 1, 'the kinds were asked more than once');
  assert.match(asked[0][1].join(' '), /\[int\]\$_\.DriveType/, 'asked for words, not numbers (words change with the language)');
  assert.equal(tasklist.driveTypesHere('win32', () => { throw new Error('no powershell'); }), null, 'a failed read passed as no drives');
  assert.equal(tasklist.driveTypesHere('win32', () => ''), null, 'an empty answer passed as no drives');
  assert.equal(tasklist.driveTypesHere('win32', () => 'Mount point\r\n'), null, 'an answer with no letter passed as no drives');
  // Off Windows there are no drive letters to ask about, and nothing is run.
  assert.deepEqual([...tasklist.driveTypesHere('darwin', () => { throw new Error('ran off Windows'); })], []);
});

test('#8227 item 1: driveRefusal opens this computer\'s own drives only', () => {
  const types = new Map([['C', 3], ['D', 2], ['E', 5], ['R', 6], ['Z', 4], ['U', 0], ['N', 1]]);
  for (const ok of ['C:\\x', 'c:/x', 'D:\\x', 'E:\\x', 'R:\\x', 'N:\\x', 'Q:\\x']) assert.equal(tasklist.driveRefusal(ok, types), null, ok + ' was refused');
  assert.equal(tasklist.driveRefusal('Z:\\share\\x', types), 'a network drive, so Kosmos does not open it');
  assert.equal(tasklist.driveRefusal('z:\\share\\x', types), 'a network drive, so Kosmos does not open it', 'a lower-case letter passed');
  assert.equal(tasklist.driveRefusal('U:\\x', types), 'Kosmos could not tell what kind of drive U: is, so it does not open it');
});

test('#8227 item 1: task files on Windows never opens a network drive, and says an unreadable table once', () => {
  const FP = sha('drives');
  const row = (number, at) => ({ number, sentence: 'Task ' + number, builtAt: 'x', builtFingerprint: FP, builtFilePath: at });
  const opened = [];
  const compare = (p) => { opened.push(p); return { ok: true, match: true }; };
  const body = { listState: 'built', tasks: [row(1, 'C:\\a.txt'), row(2, 'Z:\\share\\b.txt'), row(3, 'U:\\c.txt'), row(4, 'Q:\\d.txt')] };
  const got = tasklist.filesLines(body, { project: 'p', platform: 'win32', compare, driveTypes: new Map([['C', 3], ['Z', 4], ['U', 0]]) });
  assert.deepEqual(got.lines.slice(0, 8), [
    '#1  Task 1', '    matches  C:\\a.txt',
    '#2  Task 2', '    NOT CHECKED Z:\\share\\b.txt: a network drive, so Kosmos does not open it',
    '#3  Task 3', '    NOT CHECKED U:\\c.txt: Kosmos could not tell what kind of drive U: is, so it does not open it',
    '#4  Task 4', '    matches  Q:\\d.txt'], got.lines.join('\n'));
  assert.deepEqual(opened, ['C:\\a.txt', 'Q:\\d.txt'], 'a network or unknown drive was opened');
  assert.match(got.lines[got.lines.length - 2], /2 match, .*2 not opened/);
  // No table: nothing is opened, the reason in full once, then named, one verdict line per task.
  opened.length = 0;
  const blind = tasklist.filesLines({ listState: 'built', tasks: [row(1, 'C:\\a.txt'), row(2, 'D:\\b.txt')] }, { project: 'p', platform: 'win32', compare, driveTypes: null });
  assert.deepEqual(blind.lines.filter((l) => l.startsWith('    ')), [
    '    NOT CHECKED C:\\a.txt: Kosmos could not read what kind of drive each letter is on this computer, so it opens no path',
    '    NOT CHECKED D:\\b.txt: the drive types again (above)'], blind.lines.join('\n'));
  assert.deepEqual(opened, [], 'a path was opened with no drive types');
  // CONTROL: the same paths off Windows are another computer's, so the drive rule is never what said no there.
  const mac = tasklist.filesLines({ listState: 'built', tasks: [row(1, 'Z:\\share\\b.txt')] }, { project: 'p', platform: 'darwin', compare, automounts: new Set(), driveTypes: null });
  assert.equal(mac.lines[1], '    NOT CHECKED Z:\\share\\b.txt: marked on a Windows computer, so it is not on this one');
});

// ── item 1: the record side and the real read, on Windows ───────────────────
test('#8227 item 1 Windows: built --file keeps a local drive path, and never one on a network drive', { skip: ON_WINDOWS }, async () => {
  const file = path.join(OUT, 'drive.txt');
  fs.writeFileSync(file, 'on a drive');
  const letter = file.charAt(0).toUpperCase();
  const tok = tokenOf('mona');
  // The real kinds: this test's own drive is a local one, so its path is kept.
  const real = tasklist.driveTypesHere('win32');
  assert.ok(real && real.has(letter), 'Windows did not list the drive this test runs on: ' + JSON.stringify(real && [...real]));
  const n = tasks.create(projectId, { sentence: 'Kept', who: 'mona' }).number;
  const kept = await win(['task', 'built', projectId, String(n), 'done', '--file', 'drive.txt'], { token: tok, cwd: OUT });
  assert.equal(kept.code, 0, kept.err);
  assert.equal(stored(n).builtFilePath, file, 'a local drive path was not kept');
  // The same file, with its drive said to be a network one: the fingerprint goes, the path does not, and it says so.
  const m = tasks.create(projectId, { sentence: 'Not kept', who: 'mona' }).number;
  const net = await win(['task', 'built', projectId, String(m), 'done', '--file', 'drive.txt'], { token: tok, cwd: OUT, driveTypes: new Map([[letter, 4]]) });
  assert.equal(net.code, 0, net.err);
  assert.equal(stored(m).builtFingerprint, sha('on a drive'));
  assert.equal('builtFilePath' in stored(m), false, 'a network drive path was kept');
  assert.match(net.out, /Its path was not sent/, net.out);
  // A drive whose kinds could not be read: not kept either (fail closed).
  const u = tasks.create(projectId, { sentence: 'Unknown', who: 'mona' }).number;
  const blind = await win(['task', 'built', projectId, String(u), 'done', '--file', 'drive.txt'], { token: tok, cwd: OUT, driveTypes: null });
  assert.equal(blind.code, 0, blind.err);
  assert.equal('builtFilePath' in stored(u), false, 'a path was kept with no drive types');
  // And task files, through the CLI: the kept one matches with the real kinds, and is not opened when its drive reads as network.
  const files = await win(['task', 'files', projectId], { token: tok });
  assert.ok(files.out.split('\n').includes('    matches  ' + file), files.out);
  const netFiles = await win(['task', 'files', projectId], { token: tok, driveTypes: new Map([[letter, 4]]) });
  assert.ok(netFiles.out.split('\n').includes('    NOT CHECKED ' + file + ': a network drive, so Kosmos does not open it'), netFiles.out);
});

// ── item 4: the CLI seam under Windows rules, on Windows ────────────────────
test('#8227 item 4 Windows: pathRules.resolve then keptPath, for a drive path, a UNC path and a folder link', { skip: ON_WINDOWS }, async () => {
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
  const n = tasks.create(projectId, { sentence: 'Through a link', who: 'mona' }).number;
  const r = await win(['task', 'built', projectId, String(n), 'done', '--file', 'jn\\f.txt'], { token: tokenOf('mona'), cwd: OUT });
  assert.equal(r.code, 0, r.err);
  assert.equal(stored(n).builtFilePath, through, 'the kept path was not the one named through the link');
  assert.equal(stored(n).builtFingerprint, sha('through a link'));
  const files = await win(['task', 'files', projectId], { token: tokenOf('mona') });
  assert.ok(files.out.split('\n').includes('    matches  ' + through), files.out);
});
