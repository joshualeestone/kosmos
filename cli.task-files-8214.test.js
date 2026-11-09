'use strict';

/**
 * kosmos#8214 (feedback: an agent used `task built --file` to catch a file rebuilt without the task being marked again,
 * and asked for it as a sweep): `task built --file` now sends the file's absolute path with its fingerprint, the board
 * keeps it beside the fingerprint (engine/tasks.js builtFilePath, kept and dropped with it), and
 * `kosmos task files <project-id|--all>` fingerprints each built task's file again on THIS computer and says whether it
 * matches, changed, or is missing. Both commands print it through engine/tasklist.js filesLines.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-files-8214.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskfiles-cli-')));
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
const cli = require('./tools/windows/kosmos-cli');

const sha = (text) => 'sha256:' + crypto.createHash('sha256').update(text).digest('hex');
const OUT = path.join(SANDBOX, 'out');
fs.mkdirSync(OUT, { recursive: true });
// A stand-in automount folder, and a link elsewhere that points into it (as /home points into /System/Volumes/Data/home).
const AUTO = path.join(SANDBOX, 'automount');
fs.mkdirSync(AUTO);
const VIA = path.join(SANDBOX, 'via');
fs.symlinkSync(AUTO, VIA);

let base;
let projectId;
let otherId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install(['mona', 'zed'].map((a) => fleet.agent(a, { state: 'idle' }))).agents;
  projectId = projects.create({ name: 'Files' }).id;
  otherId = projects.create({ name: 'Other files' }).id;
  for (const p of [projectId, otherId]) for (const a of ['mona', 'zed']) projects.addAgent(p, a, roster);
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const stored = (pid, n) => tasks.byNumber(projects.readAll().find((x) => x.id === pid), n);
const tokenOf = (name) => { const m = sendertoken.mint(name); assert.equal(m.ok, true, m.because); return m.token; };

// ── engine ──────────────────────────────────────────────────────────────────
test('#8214 engine: the path is kept with its fingerprint, kept by a checker, dropped with it, and refused alone or relative', () => {
  const n = tasks.create(projectId, { sentence: 'Engine path', who: 'mona' }).number;
  const P = path.join(OUT, 'engine.txt');
  const A = sha('a');
  const ok = tasks.setBuilt(projectId, n, { by: 'mona', fingerprint: A, filePath: P });
  assert.equal(ok.ok, true, ok.because);
  assert.equal(stored(projectId, n).builtFilePath, P);
  // The same mark again changes nothing; the same fingerprint at another path is a change.
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', fingerprint: A, filePath: P }).changed, false);
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', fingerprint: A, filePath: P + '2' }).changed, true);
  assert.equal(stored(projectId, n).builtFilePath, P + '2');
  // A checker's mark without a file keeps both (it did not change the file); the person's too.
  assert.equal(tasks.setBuilt(projectId, n, { by: 'zed', note: 'checked' }).ok, true);
  assert.equal(stored(projectId, n).builtFilePath, P + '2');
  assert.equal(tasks.setBuilt(projectId, n, { person: true, note: 'seen' }).ok, true);
  assert.equal(stored(projectId, n).builtFilePath, P + '2');
  // A fingerprint from an older CLI (no path) replaces the path with none, never the old one beside a new print.
  assert.equal(tasks.setBuilt(projectId, n, { by: 'zed', fingerprint: sha('b') }).ok, true);
  assert.equal(stored(projectId, n).builtFingerprint, sha('b'));
  assert.equal('builtFilePath' in stored(projectId, n), false, 'a new fingerprint kept an old path');
  // The sender's own mark without a file drops both.
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', fingerprint: A, filePath: P }).ok, true);
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'again' }).ok, true);
  assert.equal('builtFilePath' in stored(projectId, n), false, 'the sender\'s own mark without a file kept the path');
  // Refused: a path without a fingerprint, a relative path, control characters, too long. Nothing is written.
  const before = JSON.stringify(stored(projectId, n));
  for (const bad of [{ filePath: P }, { fingerprint: A, filePath: 'out/x.txt' }, { fingerprint: A, filePath: P + '\n' },
    { fingerprint: A, filePath: '/' + 'x'.repeat(1024) }, { fingerprint: A, filePath: ['/x'] },
    // Review 1: a network path, in either spelling, would make `task files` connect to a host the marker chose.
    { fingerprint: A, filePath: '//attacker.example/share/x' }, { fingerprint: A, filePath: '\\\\attacker\\share\\x' },
    { fingerprint: A, filePath: '\\\\?\\C:\\x' },
    // Review 3: macOS mounts /net/<host> from that host when it is looked up; APFS is case-blind.
    { fingerprint: A, filePath: '/net/attacker.example/share/x' }, { fingerprint: A, filePath: '/NET/attacker/x' },
    { fingerprint: A, filePath: '/Network/Servers/attacker/x' },
    // Review 5: a dot segment walks round a check of the start; a C1 control is a control too.
    { fingerprint: A, filePath: '/tmp/../net/attacker/x' }, { fingerprint: A, filePath: '/./net/attacker/x' },
    { fingerprint: A, filePath: '/a//b' }, { fingerprint: A, filePath: '/a/./b' }, { fingerprint: A, filePath: '/x\u009b' }]) {
    const r = tasks.setBuilt(projectId, n, { by: 'mona', ...bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.because, /file path/);
  }
  assert.equal(JSON.stringify(stored(projectId, n)), before, 'a refused path changed the task');
  // A Windows path is absolute too; a clear drops it.
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', fingerprint: A, filePath: 'C:\\out\\x.txt' }).ok, true);
  assert.equal(stored(projectId, n).builtFilePath, 'C:\\out\\x.txt');
  assert.equal(tasks.clearBuilt(projectId, n, { by: 'mona' }).ok, true);
  assert.equal('builtFilePath' in stored(projectId, n), false);
});

test('#8214 board: the built route stores file_path, refuses a bad one, and the Tasks view leaves it out', async () => {
  const n = tasks.create(projectId, { sentence: 'Route path', who: 'mona' }).number;
  const post = (body) => fetch(base + `/api/project/${projectId}/task/${n}/built`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tokenOf('mona') }, body: JSON.stringify(body) });
  const bad = await post({ note: '', fingerprint: sha('r'), file_path: 'relative.txt' });
  assert.equal(bad.status, 400);
  assert.equal(stored(projectId, n).builtAt, undefined);
  const ok = await post({ note: '', fingerprint: sha('r'), file_path: '/srv/route.txt' });
  assert.equal(ok.status, 200, await ok.text());
  assert.equal(stored(projectId, n).builtFilePath, '/srv/route.txt');
  const listed = await (await fetch(base + `/api/tasks?project=${projectId}&state=built`)).json();
  assert.equal(listed.tasks.find((t) => t.number === n).builtFilePath, '/srv/route.txt', 'the list the CLIs read lost the path');
  const view = await (await fetch(base + `/api/tasks?project=${projectId}&view=tasks`)).json();
  const row = view.tasks.find((t) => t.number === n);
  assert.ok(row && row.builtFingerprint === sha('r'), 'CONTROL: the Tasks view no longer carries the row, so this cannot see the path');
  assert.equal('builtFilePath' in row, false, 'the page was sent a path on the agent\'s computer');
});

// ── the shared renderer ─────────────────────────────────────────────────────
test('#8214 filesLines: each verdict, the tally, an older board, and words that cannot forge a line', () => {
  const FP = sha('x');
  const verdicts = { '/m': { ok: true, match: true }, '/m\u202e': { ok: true, match: true }, '/c': { ok: true, match: false }, '/gone': { ok: false, words: 'missing (no such file)' },
    '/locked': { ok: false, words: 'unreadable (permission denied)' } };
  const asked = [];
  const compare = (p, want) => { asked.push([p, want]); return verdicts[p]; };
  const row = (number, extra) => ({ number, sentence: 'Task ' + number, builtAt: 'x', builtFingerprint: FP, ...extra });
  const body = { listState: 'built', tasks: [row(1, { builtFilePath: '/m' }), row(2, { builtFilePath: '/c' }), row(3, { builtFilePath: '/gone' }),
    row(4, { builtFilePath: '/locked' }), row(5, {}), { number: 6, sentence: 'No file', builtAt: 'x' },
    row(7, { sentence: 'Two\n    matches  /forged', builtFilePath: '/m' }),
    // Review 1: a network or relative path in the store (an older board, an edited file) is never opened.
    row(8, { builtFilePath: '//attacker.example/share/x' }), row(9, { builtFilePath: '\\\\attacker\\share\\x' }), row(10, { builtFilePath: 'rel/x' }),
    // Review 2: a Windows path is not absolute on a Mac, so it is never resolved against the folder the command runs in.
    row(11, { builtFilePath: 'C:\\out\\x.txt' }), row(12, { builtFilePath: '/Net/attacker/x' }),
    // Review 4: a format character is printed without it, and the line says so; the file opened is the path as stored.
    row(13, { builtFilePath: '/m\u202e' }),
    // Review 5: a dot segment reaching /net, and /home, which is an automount root on a Mac reader.
    row(14, { builtFilePath: '/tmp/../net/attacker/x' }),
    // Review 6: an automount folder from this computer's table (here a stand-in), reached directly and through a link.
    row(15, { builtFilePath: AUTO + '/x' }), row(16, { builtFilePath: VIA + '/x' })] };
  const out = tasklist.filesLines(body, { project: 'files', compare, platform: 'darwin', automounts: new Set([AUTO]) });
  assert.equal(out.rc, 0);
  assert.deepEqual(out.lines, [
    '#1  Task 1', '    matches  /m',
    '#2  Task 2', '    CHANGED since it was marked  /c',
    '#3  Task 3', '    MISSING at /gone',
    '#4  Task 4', '    CANNOT READ /locked: unreadable (permission denied)',
    '#5  Task 5', '    no path recorded (an older Kosmos, or a path Kosmos does not keep): kosmos fingerprint <file> ' + FP,
    '#7  Two matches /forged', '    matches  /m',
    '#8  Task 8', '    NOT CHECKED //attacker.example/share/x: not a local absolute path, so Kosmos does not open it',
    '#9  Task 9', '    NOT CHECKED \\\\attacker\\share\\x: not a local absolute path, so Kosmos does not open it',
    '#10  Task 10', '    NOT CHECKED rel/x: not a local absolute path, so Kosmos does not open it',
    '#11  Task 11', '    NOT CHECKED C:\\out\\x.txt: marked on a Windows computer, so it is not on this one',
    '#12  Task 12', '    NOT CHECKED /Net/attacker/x: not a local absolute path, so Kosmos does not open it',
    '#13  Task 13', '    matches  /m (printed without characters it cannot show)',
    '#14  Task 14', '    NOT CHECKED /tmp/../net/attacker/x: not a local absolute path, so Kosmos does not open it',
    '#15  Task 15', '    NOT CHECKED ' + AUTO + '/x: it reaches an automount folder (which would mount it from elsewhere), or loops through links',
    '#16  Task 16', '    NOT CHECKED ' + VIA + '/x: it reaches an automount folder (which would mount it from elsewhere), or loops through links',
    '15 built tasks with a delivered file in files: 3 match, 1 changed, 1 missing, 1 cannot be read, 1 with no path recorded, 1 marked on another kind of computer, 7 not opened (see each line for why). 1 more built without --file.',
    'A file changed or missing since the mark: send it again with kosmos task built <project-id> <task-number> --file <path>, or say why it changed.',
    'Checked on this computer: a mark made on another computer can read missing here.',
  ]);
  // The recorded fingerprint is what each file is compared with, and a task with no path is never compared.
  assert.deepEqual(asked.map((a) => a[0]), ['/m', '/c', '/gone', '/locked', '/m', '/m\u202e']);
  assert.ok(asked.every((a) => a[1] === FP));
  // On Linux /home is where homes are, so it is opened; a reader's error words are cleaned as a path is.
  const onLinux = tasklist.filesLines({ listState: 'built', tasks: [row(1, { builtFilePath: '/home/u/x' })] },
    { project: 'files', compare: () => ({ ok: false, words: 'could not be read (bad \u001b[2J\r/home/u/x)' }), platform: 'linux', automounts: new Set() });
  assert.equal(onLinux.lines[1], '    CANNOT READ /home/u/x: could not be read (bad [2J /home/u/x)', onLinux.lines.join('\n'));
  // A mount table that cannot be read opens nothing, and says why.
  const blind = tasklist.filesLines({ listState: 'built', tasks: [row(1, { builtFilePath: '/m' })] }, { project: 'files', compare, platform: 'darwin', automounts: null });
  assert.equal(blind.lines[1], '    NOT CHECKED /m: Kosmos could not read this computer\'s automount table, so it opens no path');
  // The walk never looks a name up inside the automount folder: a recording lstat sees nothing below it.
  const seen = [];
  const spy = { lstatSync: (q) => { seen.push(q); return fs.lstatSync(q); }, readlinkSync: (q) => fs.readlinkSync(q) };
  assert.equal(tasklist.reachesAutomount(VIA + '/deep/er', new Set([AUTO]), spy), true);
  assert.ok(seen.length > 0 && seen.every((q) => !q.startsWith(AUTO + '/')), 'a name inside the automount folder was looked up: ' + seen.join(', '));
  assert.equal(tasklist.reachesAutomount(OUT + '/x', new Set([AUTO])), false, 'CONTROL: a plain folder read as an automount');
  // Review 7: the folder named in another case (APFS ignores case) is the same folder, on any host: a stand-in disk
  // where every name is a folder.
  const anyFolder = { lstatSync: () => ({ isSymbolicLink: () => false }), readlinkSync: () => { throw new Error('no links'); } };
  assert.equal(tasklist.reachesAutomount('/system/volumes/data/home/u/x', new Set(['/System/Volumes/Data/home']), anyFolder), true, 'another case walked into the automount folder');
  assert.equal(tasklist.reachesAutomount('/system/volumes/data/homes/u', new Set(['/System/Volumes/Data/home']), anyFolder), false, 'CONTROL: a neighbour read as the automount folder');
  // On Windows the rule turns round: a drive path is opened, a Mac path is another computer's, a network path never.
  asked.length = 0;
  const onWin = tasklist.filesLines({ listState: 'built', tasks: [row(1, { builtFilePath: 'C:\\m' }), row(2, { builtFilePath: '/m' }), row(3, { builtFilePath: '\\\\h\\s\\x' })] },
    { project: 'files', compare: (p) => { asked.push(p); return { ok: true, match: true }; }, platform: 'win32', driveInfo: () => ({ kind: 'local', share: null }), fs: anyFolder });   // #8232: the link walk reads this, never the host's disk
  assert.deepEqual(onWin.lines.slice(0, 6), ['#1  Task 1', '    matches  C:\\m', '#2  Task 2', '    NOT CHECKED /m: marked on a Mac or Linux computer, so it is not on this one',
    '#3  Task 3', '    NOT CHECKED \\\\h\\s\\x: not a local absolute path, so Kosmos does not open it']);
  assert.deepEqual(asked, ['C:\\m'], 'a path that is not this computer\'s kind was opened');
  // --all names each project; an older board that ignored all=1 or state=built is never passed off.
  const all = tasklist.filesLines({ listState: 'built', all: true, tasks: [row(1, { projectId: 'p1', builtFilePath: '/m' })] }, { compare, platform: 'darwin', automounts: new Set() });
  assert.deepEqual(all.lines.slice(0, 2), ['p1  #1  Task 1', '    matches  /m']);
  assert.match(all.lines[2], /^1 built task with a delivered file across your projects: 1 match, 0 changed, 0 missing\.$/);
  assert.equal(tasklist.filesLines({ listState: 'built', tasks: [] }, { compare }).rc, 1, 'an answer without all: true was read as every project');
  assert.equal(tasklist.filesLines({ tasks: [row(1, { builtFilePath: '/m' })] }, { project: 'files', compare }).rc, 1, 'an unfiltered list was read as the built one');
  assert.equal(tasklist.filesLines(null, { project: 'files', compare }).rc, 1);
  // Nothing built, and built with no file.
  assert.deepEqual(tasklist.filesLines({ listState: 'built', tasks: [] }, { project: 'files', compare }).lines, ['No built tasks in files.']);
  assert.deepEqual(tasklist.filesLines({ listState: 'built', tasks: [{ number: 1, builtAt: 'x' }] }, { project: 'files', compare }).lines,
    ['No built task in files names a delivered file (1 built without --file).']);
});

// ── Windows: tools/windows/kosmos-cli.js ────────────────────────────────────
async function win(argv, { token = null, cwd } = {}) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base, ...(cwd ? { cwd: () => cwd } : {}),
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => token },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('#8214 Windows: built --file sends the absolute path; task files says matches, then CHANGED, then MISSING', async () => {
  const n = tasks.create(otherId, { sentence: 'Windows deliverable', who: 'mona' }).number;
  const file = path.join(OUT, 'win.txt');
  fs.writeFileSync(file, 'version one');
  const tok = tokenOf('mona');
  // Named relative to the folder it runs in: the path kept is the whole one.
  const r = await win(['task', 'built', otherId, String(n), 'done', '--file', 'win.txt'], { token: tok, cwd: OUT });
  assert.equal(r.code, 0, r.err);
  assert.equal(stored(otherId, n).builtFingerprint, sha('version one'));
  assert.equal(stored(otherId, n).builtFilePath, file);
  const head = ['#' + n + '  Windows deliverable'];
  const ok = await win(['task', 'files', otherId], { token: tok });
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(ok.out.split('\n').slice(0, 2), [...head, '    matches  ' + file], ok.out);
  fs.writeFileSync(file, 'version two');
  const changed = await win(['task', 'files', otherId], { token: tok });
  assert.deepEqual(changed.out.split('\n').slice(0, 2), [...head, '    CHANGED since it was marked  ' + file], changed.out);
  fs.rmSync(file);
  const gone = await win(['task', 'files', otherId], { token: tok });
  assert.deepEqual(gone.out.split('\n').slice(0, 2), [...head, '    MISSING at ' + file], gone.out);
  // It wrote nothing: the mark is as it was.
  assert.equal(stored(otherId, n).builtFingerprint, sha('version one'));
  // --all names the project.
  const all = await win(['task', 'files', '--all'], { token: tok });
  assert.equal(all.code, 0, all.err);
  assert.ok(all.out.split('\n').includes(otherId + '  #' + n + '  Windows deliverable'), all.out);
  // task show prints the kept path, indented under its own heading.
  const show = await win(['task', 'show', otherId, String(n)], { token: tok });
  assert.match(show.out, new RegExp('^Delivered file: ' + sha('version one') + ', sent by mona \\(check it again: kosmos task files ' + otherId + '\\)\nDelivered file path, on the computer that marked it:\n {4}' + file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm'), show.out);
});

test('#8214 Windows (review 3): a path the board would refuse is dropped, said, and the mark still goes', async () => {
  const name = 'win\nodd.txt';
  fs.writeFileSync(path.join(OUT, name), 'win odd');
  const n = tasks.create(otherId, { sentence: 'Windows odd name', who: 'mona' }).number;
  const r = await win(['task', 'built', otherId, String(n), 'done', '--file', name], { token: tokenOf('mona'), cwd: OUT });
  assert.equal(r.code, 0, r.err);
  assert.equal(stored(otherId, n).builtFingerprint, sha('win odd'));
  assert.equal('builtFilePath' in stored(otherId, n), false);
  assert.match(r.out, /Its path was not sent \(Kosmos keeps only a plain local path/, r.out);
});

test('#8214 Windows: refusals and usage', async () => {
  const none = await win(['task', 'files']);
  assert.equal(none.code, 2);
  assert.match(none.err, /Usage: kosmos task files <project-id\|--all>/);
  assert.equal((await win(['task', 'files', '--mine'])).code, 2);
  assert.equal((await win(['task', 'files', projectId, 'more'])).code, 2);
  const odd = await win(['task', 'files', projectId + ' x']);
  assert.equal(odd.code, 1);
  assert.equal(odd.err, 'there is no project by that name');
  const help = await win(['task']);
  assert.match(help.out + help.err, /kosmos task files <project-id\|--all>/);
});

// ── Mac: install/kosmos (bash 3.2) ─────────────────────────────────────────
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(MAC_HOME, 'engine'));
function mac(args, { token = '', cwd, home = MAC_HOME } = {}) {
  const env = { ...process.env, KOSMOS_HOME: home, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: token };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000, cwd }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: stdout || '', err: stderr || '' });
    });
  });
}

test('#8214 Mac: built --file sends the absolute path, and task files prints what Windows prints', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  const n = tasks.create(projectId, { sentence: 'Mac deliverable', who: 'mona' }).number;
  // A space, a quote and a backslash in the name: the hand-built JSON must carry them whole.
  const name = 'mac "one" \\ file.txt';
  const file = path.join(OUT, name);
  fs.writeFileSync(file, 'mac one');
  const tok = tokenOf('mona');
  const r = await mac(['task', 'built', projectId, String(n), 'done', '--file', name], { token: tok, cwd: OUT });
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(stored(projectId, n).builtFilePath, file, r.out);
  fs.writeFileSync(file, 'mac two');
  const m = await mac(['task', 'files', projectId], { token: tok });
  const w = await win(['task', 'files', projectId], { token: tok });
  assert.equal(m.code, 0, m.err);
  assert.deepEqual(m.out.trimEnd().split('\n'), w.out.split('\n'), 'the two commands printed it differently');
  assert.ok(m.out.includes('#' + n + '  Mac deliverable\n    CHANGED since it was marked  ' + file + '\n'), m.out);
  const all = await mac(['task', 'files', '--all'], { token: tok });
  const wall = await win(['task', 'files', '--all'], { token: tok });
  assert.equal(all.code, 0, all.err);
  assert.deepEqual(all.out.trimEnd().split('\n'), wall.out.split('\n'));
});

test('#8214 Mac (review 1): link/.. is hashed and recorded as the same file; a path with a control character goes as none', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  const tok = tokenOf('mona');
  // real/inner/ holds the file the kernel reaches through link/..; a lexical resolve would name OUT/x.txt instead.
  const real = path.join(OUT, 'real');
  fs.mkdirSync(path.join(real, 'inner'), { recursive: true });
  fs.writeFileSync(path.join(real, 'x.txt'), 'through the link');
  fs.writeFileSync(path.join(OUT, 'x.txt'), 'the lexical decoy');
  fs.symlinkSync(path.join(real, 'inner'), path.join(OUT, 'link'));
  const n = tasks.create(projectId, { sentence: 'Through a link', who: 'mona' }).number;
  const r = await mac(['task', 'built', projectId, String(n), 'done', '--file', 'link/../x.txt'], { token: tok, cwd: OUT });
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(stored(projectId, n).builtFingerprint, sha('through the link'), 'CONTROL: the kernel did not follow the link, so this cannot tell the two resolves apart');
  assert.equal(stored(projectId, n).builtFilePath, path.join(real, 'x.txt'), 'the path recorded names another file than the one hashed');
  // A newline in the name: the mark goes, with its fingerprint and no path.
  const odd = 'odd\nname.txt';
  fs.writeFileSync(path.join(OUT, odd), 'odd');
  const m = tasks.create(projectId, { sentence: 'Odd name', who: 'mona' }).number;
  const o = await mac(['task', 'built', projectId, String(m), 'done', '--file', odd], { token: tok, cwd: OUT });
  assert.equal(o.code, 0, o.out + o.err);
  assert.equal(stored(projectId, m).builtFingerprint, sha('odd'));
  assert.equal('builtFilePath' in stored(projectId, m), false);
  assert.match(o.out, /Its path was not sent \(Kosmos keeps only a plain local path: absolute, with no \. or \.\. in it, no control characters, not a network path, and 1024 characters at most\), so kosmos task files cannot check this mark\./, 'a dropped path was silent: ' + o.out);
  assert.doesNotMatch(r.out, /Its path was not sent/, 'a path that was sent was said to be dropped');
  // Review 5: a C1 control (U+009B, the 8-bit CSI) in a name: the board's rule refuses the path, so none is sent.
  fs.writeFileSync(path.join(OUT, 'c1\u009b.txt'), 'c1');
  const c1 = tasks.create(projectId, { sentence: 'C1 name', who: 'mona' }).number;
  const cr = await mac(['task', 'built', projectId, String(c1), 'done', '--file', 'c1\u009b.txt'], { token: tok, cwd: OUT });
  assert.equal(cr.code, 0, cr.out + cr.err);
  assert.equal(stored(projectId, c1).builtFingerprint, sha('c1'));
  assert.equal('builtFilePath' in stored(projectId, c1), false, 'a path the board refuses was sent, or the mark failed');
  // Review 3: a trailing newline, which $( ) strips: the file named is hashed, never its newline-less neighbour.
  fs.writeFileSync(path.join(OUT, 'trail\n'), 'with the newline');
  fs.writeFileSync(path.join(OUT, 'trail'), 'the neighbour');
  const t = tasks.create(projectId, { sentence: 'Trailing newline', who: 'mona' }).number;
  const tr = await mac(['task', 'built', projectId, String(t), 'done', '--file', 'trail\n'], { token: tok, cwd: OUT });
  assert.equal(tr.code, 0, tr.out + tr.err);
  assert.equal(stored(projectId, t).builtFingerprint, sha('with the newline'), 'the neighbour was hashed');
  assert.equal('builtFilePath' in stored(projectId, t), false, 'a path naming the neighbour was recorded');
});

test('#8214 Mac (review 5): a path the board\'s rule refuses is asked of that rule, and goes as none', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  // A home whose engine/fileprint.js is the real one with keptPath refusing every path: the CLI must ask it, and send
  // the mark with its fingerprint and no path (on this Mac no real path reaches that refusal, so it stands in).
  const home = path.join(SANDBOX, 'rule-home');
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.mkdirSync(path.join(home, 'engine'));
  fs.writeFileSync(path.join(home, 'engine', 'fileprint.js'), fs.readFileSync(path.join(__dirname, 'engine', 'fileprint.js'), 'utf8') + '\nmodule.exports.keptPath = () => false;\n');
  fs.writeFileSync(path.join(OUT, 'ruled.txt'), 'ruled');
  const n = tasks.create(projectId, { sentence: 'Ruled out', who: 'mona' }).number;
  const r = await mac(['task', 'built', projectId, String(n), 'done', '--file', 'ruled.txt'], { token: tokenOf('mona'), cwd: OUT, home });
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(stored(projectId, n).builtFingerprint, sha('ruled'), 'CONTROL: the stand-in home did not fingerprint');
  assert.equal('builtFilePath' in stored(projectId, n), false, 'the CLI sent a path its rule refuses');
  assert.match(r.out, /Its path was not sent/);
});

test('#8214 Mac: refusals and usage', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  const none = await mac(['task', 'files']);
  assert.equal(none.code, 2);
  assert.match(none.out + none.err, /Usage: kosmos task files <project-id\|--all>/);
  assert.equal((await mac(['task', 'files', '--mine'])).code, 2);
  assert.equal((await mac(['task', 'files', projectId, 'more'])).code, 2);
  assert.notEqual((await mac(['task', 'files', 'no such project'])).code, 0, 'an id outside the slug set was read');
  const help = await mac(['task']);
  assert.match(help.out + help.err, /kosmos task files <project-id\|--all>/);
  const unknown = await mac(['task', 'reassign']);
  assert.match(unknown.out + unknown.err, /\| show \| files \| built \|/);
});

// ── kosmos#8227: the review leftovers ─────────────────────────────────────

test('#8227 item 5: an unreadable automount table is said in full once, then named, with a verdict line per task', () => {
  const FP = sha('m5');
  const row = (number, at) => ({ number, sentence: 'Task ' + number, builtAt: 'x', builtFingerprint: FP, builtFilePath: at });
  let opened = 0;
  const got = tasklist.filesLines({ listState: 'built', tasks: [row(1, '/a'), row(2, '/b'), row(3, '/c')] },
    { project: 'files', platform: 'darwin', automounts: null, compare: () => { opened += 1; return { ok: true, match: true }; } });
  const verdicts = got.lines.filter((l) => l.startsWith('    NOT CHECKED '));
  assert.equal(verdicts.length, 3, 'a task lost its own verdict line:\n' + got.lines.join('\n'));
  assert.equal(got.lines.filter((l) => l.includes('could not read this computer\'s automount table')).length, 1, got.lines.join('\n'));
  assert.equal(verdicts[0], '    NOT CHECKED /a: Kosmos could not read this computer\'s automount table, so it opens no path');
  assert.equal(verdicts[1], '    NOT CHECKED /b: the automount table again (above)');
  assert.equal(verdicts[2], '    NOT CHECKED /c: the automount table again (above)');
  assert.equal(opened, 0, 'a path was opened with no automount table');
  assert.match(got.lines[got.lines.length - 2], /3 not opened \(see each line for why\)/);
  // CONTROL: a readable table opens them, so the lines above came from the unreadable one.
  const ok = tasklist.filesLines({ listState: 'built', tasks: [row(1, '/a')] }, { project: 'files', platform: 'darwin', automounts: [], compare: () => ({ ok: true, match: true }) });
  assert.ok(ok.lines.some((l) => l === '    matches  /a'), ok.lines.join('\n'));
});

test('#8227 item 2: the project list never carries a delivered file\'s path or a commit\'s repository; the CLI\'s list still does', async () => {
  const n = tasks.create(projectId, { sentence: 'Paths stay home', who: 'mona' }).number;
  projects.mutate(projectId, (p) => ({ ...p, tasks: p.tasks.map((x) => (x.number === n ? { ...x, builtAt: '2026-11-07T12:00:00.000Z', builtBy: 'mona',
    builtFingerprint: sha('p2'), builtFingerprintBy: 'mona', builtFilePath: '/Users/someone/deliver.txt',
    landedCommit: '0123456789abcdef0123456789abcdef01234567', landedRepo: '/Users/someone/repo', landedOnRemote: true } : x)) }));
  assert.equal(stored(projectId, n).builtFilePath, '/Users/someone/deliver.txt', 'CONTROL: the store must hold the path');
  const rowsIn = (body) => {
    const p = (body.projects || [body.project || body]).find((x) => x && x.id === projectId) || body.project || body;
    return (p && Array.isArray(p.tasks) ? p.tasks : []);
  };
  for (const [route, headers] of [['/api/projects', {}], ['/api/projects/overview', { 'x-kosmos-agent-token': tokenOf('mona') }],
    ['/api/project/' + projectId, { 'x-kosmos-agent-token': tokenOf('mona') }]]) {
    const res = await fetch(base + route, { headers });
    assert.equal(res.status, 200, route + ' ' + res.status);
    const text = await res.text();
    assert.equal(text.includes('/Users/someone/'), false, route + ' sent a path on this computer');
    const row = rowsIn(JSON.parse(text)).find((t) => t && t.number === n);
    if (row) {
      assert.equal(row.builtFingerprint, sha('p2'), route + ': CONTROL, the row lost its fingerprint');
      assert.equal('builtFilePath' in row || 'landedRepo' in row, false, route);
    }
  }
  const page = rowsIn(await (await fetch(base + '/api/projects')).json()).find((t) => t && t.number === n);
  assert.ok(page && page.landedCommit, 'CONTROL: the page list no longer carries the row, so this cannot see the paths');
  const cli = await (await fetch(base + `/api/tasks?project=${projectId}&state=built`)).json();
  const mine = cli.tasks.find((t) => t.number === n);
  assert.equal(mine.builtFilePath, '/Users/someone/deliver.txt', 'the list the CLIs read lost the path');
  assert.equal(mine.landedRepo, '/Users/someone/repo', 'the list the CLIs read lost the repository');
});
