'use strict';
/**
 * win32-installer-native: `Kosmos.exe --uninstall`, the engine half (engine/win32uninstall.js).
 *
 * 🛑 NOTHING REAL IS TOUCHED. Every schtasks call goes to a stub runner (win32job.setRunner,
 * win32board.setRunner), every folder is under a scratch base, and the platform, the environment,
 * the home folder and the projects root are passed in, never read from this machine. The live
 * fleet's `\Kosmos\*` tasks and its `%LOCALAPPDATA%\Kosmos` / `%APPDATA%\Kosmos` are out of reach.
 *
 *   node --test engine/win32uninstall.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const win32job = require('./win32job');
const win32board = require('./win32board');
const uninstaller = require('./win32uninstall');

const NOT_FOUND = { ok: false, out: 'ERROR: The system cannot find the file specified.' };

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-uninstall-'));
  const s = {
    base,
    home: path.join(base, 'Users', 'someone'),
    env: { APPDATA: path.join(base, 'Roaming'), LOCALAPPDATA: path.join(base, 'Local'), USERNAME: 'someone', USERDOMAIN: 'BOX' },
  };
  s.runtimeDir = path.join(s.env.LOCALAPPDATA, 'Kosmos');
  s.dataDir = path.join(s.env.APPDATA, 'Kosmos');
  s.projectsRoot = path.join(s.home, 'Kosmos', 'Projects');
  fs.mkdirSync(path.join(s.runtimeDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(s.runtimeDir, 'runtime', 'engine-path'), 'C:\\somewhere\\app\\engine');
  fs.mkdirSync(path.join(s.dataDir, 'chats'), { recursive: true });
  fs.writeFileSync(path.join(s.dataDir, 'chats', 'ava.jsonl'), '{"said":"hello"}\n');
  fs.mkdirSync(path.join(s.projectsRoot, 'garden'), { recursive: true });
  fs.writeFileSync(path.join(s.projectsRoot, 'garden', 'notes.txt'), "a person's own work");
  return s;
}

/* The CSV row schtasks prints for one task, unlabelled, path first. */
const row = (taskPath) => '"\\' + taskPath + '","N/A","Ready"';

/**
 * One recorder for both command seams, so a test can assert the ORDER across agents and the
 * board. `script.folder` answers the folder query; `script.fail` maps a joined command to a
 * failing answer.
 */
function stubSchedulers(script) {
  const calls = [];
  const answer = (who, args) => {
    const joined = args.join(' ');
    calls.push(who + ' ' + joined);
    if (script.fail && script.fail[joined]) return script.fail[joined];
    if (args[0] === '/Query' && args[2] === 'Kosmos\\') return script.folder;
    if (args[0] === '/Query') return NOT_FOUND;
    return { ok: true, out: 'SUCCESS' };
  };
  win32job.setRunner((args) => answer('job', args));
  win32board.setRunner((args) => answer('board', args));
  return calls;
}

function run(s, extra) {
  return uninstaller.uninstall({
    platform: 'win32', env: s.env, home: s.home, projectsRoot: s.projectsRoot,
    removeFolder: (dir) => fs.rmSync(dir, { recursive: true, force: true }),
    liveExecutionAllowed: () => true,
    ...extra,
  });
}

test.afterEach(() => { win32job.setRunner(null); win32board.setRunner(null); });

test('every agent task, of every Kosmos, is switched off, ended and removed, the board last; the runtime goes and the chats stay', () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ folder: { ok: true, out: [row('Kosmos\\board'), row('Kosmos\\agent-ava'), row('Kosmos\\agent-bo+qa')].join('\r\n') + '\r\n' } });
    const r = run(s);
    assert.deepEqual(calls, [
      'job /Query /TN Kosmos\\ /FO CSV /NH',
      'job /Change /TN Kosmos\\agent-ava /DISABLE',
      'job /End /TN Kosmos\\agent-ava',
      'job /Delete /F /TN Kosmos\\agent-ava',
      'job /Change /TN Kosmos\\agent-bo+qa /DISABLE',
      'job /End /TN Kosmos\\agent-bo+qa',
      'job /Delete /F /TN Kosmos\\agent-bo+qa',
      'board /End /TN Kosmos\\board',
      'board /Delete /F /TN Kosmos\\board',
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.deepEqual(r.left, []);
    assert.ok(!fs.existsSync(s.runtimeDir), '%LOCALAPPDATA%\\Kosmos is still there');
    assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'the chats were deleted without a yes');
    assert.ok(fs.existsSync(path.join(s.projectsRoot, 'garden', 'notes.txt')), 'the projects were touched');
    assert.ok(r.notes.includes('Your agents\' chats and settings were kept in ' + s.dataDir + '.'), JSON.stringify(r.notes));
    assert.ok(r.notes.includes('Your projects in ' + s.projectsRoot + ' were not touched.'), JSON.stringify(r.notes));
    assert.ok(r.done.some((d) => d.includes('"bo" in the Kosmos "qa"')), 'a named world\'s agent is not named by its world: ' + JSON.stringify(r.done));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('the chats and settings are deleted only when the person said yes', () => {
  const s = sandbox();
  try {
    stubSchedulers({ folder: { ok: true, out: row('Kosmos\\board') + '\r\n' } });
    const r = run(s, { deleteData: true });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.dataDir), '%APPDATA%\\Kosmos survived a yes');
    assert.ok(!fs.existsSync(s.runtimeDir));
    assert.ok(fs.existsSync(path.join(s.projectsRoot, 'garden', 'notes.txt')), 'the projects were touched');
    assert.ok(!r.notes.some((n) => /were kept in/.test(n)), 'it says the chats were kept after deleting them');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('an empty Kosmos folder in Task Scheduler is a clean removal', () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ folder: NOT_FOUND });
    const r = run(s, { deleteData: true });
    assert.deepEqual(calls, ['job /Query /TN Kosmos\\ /FO CSV /NH']);
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.runtimeDir) && !fs.existsSync(s.dataDir));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a task Kosmos does not recognise is named and left in place, and both folders are kept for the tasks still there', () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ folder: { ok: true, out: [row('Kosmos\\agent-ava'), row('Kosmos\\somebody-elses-task')].join('\r\n') } });
    const r = run(s, { deleteData: true });
    assert.ok(!calls.some((c) => c.includes('somebody-elses-task')), 'a task Kosmos does not recognise was acted on: ' + calls.join(' | '));
    assert.equal(r.ok, false);
    assert.ok(r.left.some((l) => l.includes('Kosmos\\somebody-elses-task') && /does not recognise/.test(l)), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir), 'the runtime was deleted while a task is still registered');
    assert.ok(fs.existsSync(s.dataDir), 'the chats were deleted while a task is still registered');
    assert.ok(r.left.some((l) => l.startsWith('Kosmos\'s runtime folder (' + s.runtimeDir + '), kept because')), JSON.stringify(r.left));
    assert.ok(r.left.some((l) => l.startsWith('your agents\' chats and settings (' + s.dataDir + '), kept because')), JSON.stringify(r.left));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a Task Scheduler folder that cannot be read changes nothing and says so', () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ folder: { ok: false, out: 'ERROR: Access is denied.' } });
    const r = run(s, { deleteData: true });
    assert.deepEqual(calls, ['job /Query /TN Kosmos\\ /FO CSV /NH'], 'something was changed on a folder that could not be read');
    assert.equal(r.ok, false);
    assert.ok(r.left[0].includes('could not read (ERROR: Access is denied.)'), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(s.dataDir), 'a folder went while the tasks were unknown');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('each failure is named: a task that would not go, an agent that would not end, a board that would not go', () => {
  const s = sandbox();
  try {
    stubSchedulers({
      folder: { ok: true, out: [row('Kosmos\\agent-ava'), row('Kosmos\\agent-bo'), row('Kosmos\\board')].join('\r\n') },
      fail: {
        '/Delete /F /TN Kosmos\\agent-ava': { ok: false, out: 'ERROR: Access is denied.' },
        /* Not a "not running" sentence: win32job.end rightly reads that one as already stopped. */
        '/End /TN Kosmos\\agent-bo': { ok: false, out: 'ERROR: Access is denied.' },
        '/Delete /F /TN Kosmos\\board': { ok: false, out: 'ERROR: Access is denied.' },
      },
    });
    const r = run(s);
    assert.equal(r.ok, false);
    assert.ok(r.left.some((l) => l.startsWith('the startup job for the agent "ava" (Kosmos\\agent-ava), which is still in Task Scheduler (we could not remove the startup job (ERROR: Access is denied.))')), JSON.stringify(r.left));
    assert.ok(r.left.some((l) => l.startsWith('the agent "bo", which may keep running until you sign out')), JSON.stringify(r.left));
    assert.ok(r.left.some((l) => l.startsWith('the startup job for the Kosmos board (Kosmos\\board), which is still in Task Scheduler')), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir), 'the runtime went while a task is still registered');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 Projects is never deleted: a Kosmos folder that holds the projects is refused, and says why', () => {
  const s = sandbox();
  try {
    stubSchedulers({ folder: NOT_FOUND });
    const inside = path.join(s.dataDir, 'Projects');
    fs.mkdirSync(path.join(inside, 'garden'), { recursive: true });
    fs.writeFileSync(path.join(inside, 'garden', 'notes.txt'), "a person's own work");
    const r = run(s, { deleteData: true, projectsRoot: inside });
    assert.ok(fs.existsSync(path.join(inside, 'garden', 'notes.txt')), 'a project was deleted');
    assert.equal(r.ok, false);
    assert.ok(r.left.includes('your agents\' chats and settings (' + s.dataDir + '), kept because your projects are inside it (' + inside + ')'), JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.runtimeDir), 'the runtime folder, which holds no projects, should still go');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('the Kosmos folder this removal runs from is never deleted from here', () => {
  const s = sandbox();
  try {
    stubSchedulers({ folder: NOT_FOUND });
    const bundle = path.join(s.runtimeDir, 'Programs', 'Kosmos');
    fs.mkdirSync(bundle, { recursive: true });
    const r = run(s, { bundleRoot: bundle });
    assert.ok(fs.existsSync(bundle), 'the running Kosmos folder was deleted');
    assert.ok(r.left.some((l) => l.includes('kept because Kosmos is running from inside it')), JSON.stringify(r.left));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('folderRefusal: only an absolute folder named Kosmos that holds no projects, no user folder and no running Kosmos', () => {
  const g = { platform: 'win32', leaf: 'Kosmos', projectsRoot: 'C:\\Users\\me\\Kosmos\\Projects', home: 'C:\\Users\\me', bundleRoot: 'C:\\Users\\me\\AppData\\Local\\Programs\\Kosmos' };
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\AppData\\Local\\Kosmos', g), null);
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\AppData\\Local\\kosmos', g), null, 'Windows names are not case-sensitive');
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\AppData\\Local\\Other', g), 'it is not a folder named Kosmos');
  assert.equal(uninstaller.folderRefusal('Kosmos', g), 'we could not work out where it is');
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\Kosmos', g), 'your projects are inside it (C:\\Users\\me\\Kosmos\\Projects)');
  assert.equal(uninstaller.folderRefusal('C:\\Users\\ME\\KOSMOS', g), 'your projects are inside it (C:\\Users\\me\\Kosmos\\Projects)', 'a projects root in another case slipped past');
  assert.equal(uninstaller.folderRefusal('C:\\Kosmos', { ...g, home: 'C:\\Kosmos\\me', projectsRoot: 'D:\\P' }), 'your user folder is inside it');
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\AppData\\Local\\Programs\\Kosmos', { ...g, bundleRoot: 'C:\\Users\\me\\AppData\\Local\\Programs\\Kosmos\\x' }),
    'Kosmos is running from inside it (C:\\Users\\me\\AppData\\Local\\Programs\\Kosmos\\x)');
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\Kosmosity', { ...g, leaf: 'Kosmos' }), 'it is not a folder named Kosmos');
  /* A sibling whose name merely starts with the projects' folder does not hold them. */
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\AppData\\Kosmos', { ...g, projectsRoot: 'C:\\Users\\me\\AppData\\KosmosProjects' }), null);
});

test('🛑 without the confirm (liveExecutionAllowed) nothing is asked, ended or deleted', () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ folder: { ok: true, out: row('Kosmos\\board') } });
    const r = uninstaller.uninstall({ platform: 'win32', env: s.env, home: s.home, projectsRoot: s.projectsRoot, deleteData: true });
    assert.equal(r.refused, true);
    assert.deepEqual(calls, [], 'a scheduler was asked before the removal was confirmed');
    assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(s.dataDir));
    const denied = uninstaller.uninstall({ platform: 'win32', env: s.env, home: s.home, liveExecutionAllowed: () => false, deleteData: true });
    assert.equal(denied.refused, true);
    assert.deepEqual(calls, []);
    const mac = uninstaller.uninstall({ platform: 'darwin', env: s.env, home: s.home, liveExecutionAllowed: () => true });
    assert.equal(mac.refused, true, 'a Mac ran the Windows removal');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('the CLI is a dry run without --yes, and --yes arms it and writes the report the launcher reads', () => {
  const s = sandbox();
  try {
    let asked = null;
    const said = [];
    const fake = (opts) => { asked = opts; return { ok: false, done: ['removed x'], left: ['the thing\nthat stayed'], notes: ['Your projects in P were not touched.'] }; };
    assert.equal(uninstaller.cliMain(['--uninstall', '--delete-data'], { uninstall: fake, write: (t) => said.push(t) }), 2);
    assert.equal(asked, null, 'the removal ran without --yes');
    assert.match(said.join(''), /nothing was changed: add --yes/);
    assert.equal(uninstaller.cliMain(['--yes'], { uninstall: fake, write: () => {} }), 64, 'a --yes with no --uninstall was accepted');
    assert.equal(asked, null);

    const report = path.join(s.base, 'report.txt');
    const code = uninstaller.cliMain(['--uninstall', '--delete-data', '--root', 'C:\\Kosmos', '--report', report, '--yes'], { uninstall: fake, write: () => {} });
    assert.equal(code, 1);
    assert.equal(asked.deleteData, true);
    assert.equal(asked.bundleRoot, 'C:\\Kosmos');
    assert.equal(asked.liveExecutionAllowed(), true);
    assert.deepEqual(fs.readFileSync(report, 'utf8').split('\r\n'),
      ['DONE removed x', 'LEFT the thing that stayed', 'NOTE Your projects in P were not touched.', ''],
      'a sentence with a line break became two report lines');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('win32job.kosmosFolderTasks: every path in the folder, every Kosmos; not found is empty; anything else is unknown', () => {
  win32job.setRunner(() => ({ ok: true, out: [row('Kosmos\\board'), row('Kosmos\\agent-ava'), row('Kosmos\\agent-ava'), row('Kosmos\\agent-bo+qa'), 'INFO: something', ''].join('\r\n') }));
  assert.deepEqual(win32job.kosmosFolderTasks(), { known: true, paths: ['Kosmos\\board', 'Kosmos\\agent-ava', 'Kosmos\\agent-bo+qa'] });
  /* list() reads the same query and keeps only THIS world's agents, as before. */
  assert.deepEqual([...win32job.list().names], ['ava']);
  win32job.setRunner(() => NOT_FOUND);
  assert.deepEqual(win32job.kosmosFolderTasks(), { known: true, paths: [] });
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: Access is denied.' }));
  assert.deepEqual(win32job.kosmosFolderTasks(), { known: false, paths: [], because: 'ERROR: Access is denied.' });
  assert.equal(win32job.list().known, false);
});

test('classifyTask: the board by its name, agents by the prefix and their world, anything else is not guessed at', () => {
  assert.deepEqual(uninstaller.classifyTask('Kosmos\\board'), { kind: 'board', path: 'Kosmos\\board' });
  assert.deepEqual(uninstaller.classifyTask('Kosmos\\agent-ava+qa'), { kind: 'agent', path: 'Kosmos\\agent-ava+qa', name: 'ava', worldId: 'qa' });
  assert.equal(uninstaller.classifyTask('Kosmos\\agent-').kind, 'other');
  assert.equal(uninstaller.classifyTask('Kosmos\\Agent-ava').kind, 'other', 'a prefix in another case is not win32job\'s');
  assert.equal(uninstaller.classifyTask('Kosmos\\boardroom').kind, 'other');
});
