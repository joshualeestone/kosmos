'use strict';
/**
 * win32-installer-native: `Kosmos.exe --uninstall`, the engine half (engine/win32uninstall.js).
 *
 * 🛑 NOTHING REAL IS TOUCHED. Every schtasks call goes to a stub runner (win32job.setRunner,
 * win32board.setRunner), every folder is under a scratch base, and the platform, the environment,
 * the home folder and the projects root are passed in, never read from this machine. The live
 * fleet's `\Kosmos\*` tasks and its `%LOCALAPPDATA%\Kosmos` / `%APPDATA%\Kosmos` are out of reach.
 *
 * ⚠️ THE FOLDER ARMS ARE WINDOWS-ONLY. The removal joins its folders with Windows' rules
 * (`win32anchor.anchorDir('win32', ...)`) and then deletes them on the host's disk, which only
 * means the same folder on Windows. The arms that touch no folder run everywhere.
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
const store = require('./store');
const worlds = require('./worlds');
const uninstaller = require('./win32uninstall');

const WINDOWS_FOLDERS = { skip: process.platform !== 'win32' && 'the folder arms delete Windows-joined paths, which are only real folders on Windows' };
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

/* The machine's whole task list, as `schtasks /Query /FO CSV /NH` prints it: unlabelled rows,
   path first, always with the Microsoft tasks every Windows has. */
const row = (taskPath) => '"\\' + taskPath + '","N/A","Ready"';
const listing = (paths) => ({ ok: true, out: [row('Microsoft\\Windows\\Defrag\\ScheduledDefrag'), ...paths.map(row)].join('\r\n') + '\r\n' });

/**
 * One recorder for both command seams, so a test can assert the ORDER across agents and the
 * board. `lists` answers the whole-list query in turn (the read before, the read after);
 * `fail` maps a joined command to its answer.
 */
function stubSchedulers(script) {
  const calls = [];
  let listed = 0;
  const answer = (who, args) => {
    const joined = args.join(' ');
    calls.push(who + ' ' + joined);
    if (script.fail && script.fail[joined]) return script.fail[joined];
    if (args[0] === '/Query' && !args.includes('/TN')) {
      const l = script.lists[Math.min(listed, script.lists.length - 1)];
      listed += 1;
      return l;
    }
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

test('the board is switched off and ended first, every agent task of every Kosmos goes, the board task last, and the list is READ again', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava', 'Kosmos\\agent-bo+qa']), listing([])] });
    const r = run(s);
    assert.deepEqual(calls, [
      'job /Query /FO CSV /NH',
      'board /Change /TN Kosmos\\board /DISABLE',
      'board /End /TN Kosmos\\board',
      'job /Change /TN Kosmos\\agent-ava /DISABLE',
      'job /End /TN Kosmos\\agent-ava',
      'job /Delete /F /TN Kosmos\\agent-ava',
      'job /Change /TN Kosmos\\agent-bo+qa /DISABLE',
      'job /End /TN Kosmos\\agent-bo+qa',
      'job /Delete /F /TN Kosmos\\agent-bo+qa',
      'board /Delete /F /TN Kosmos\\board',
      'job /Query /FO CSV /NH',
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.runtimeDir), '%LOCALAPPDATA%\\Kosmos is still there');
    assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'the chats were deleted without a yes');
    assert.ok(fs.existsSync(path.join(s.projectsRoot, 'garden', 'notes.txt')), 'the projects were touched');
    assert.ok(r.notes.includes('Your agents\' chats and settings were kept in ' + s.dataDir + '.'), JSON.stringify(r.notes));
    assert.ok(r.notes.includes('Your projects were kept in ' + s.projectsRoot + '.'), JSON.stringify(r.notes));
    assert.ok(r.done.some((d) => d.includes('"bo" in the Kosmos "qa"')), 'a named world\'s agent is not named by its world: ' + JSON.stringify(r.done));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('the chats and settings are deleted only when the person said yes', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board']), listing([])] });
    const r = run(s, { deleteData: true });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.dataDir), '%APPDATA%\\Kosmos survived a yes');
    assert.ok(!fs.existsSync(s.runtimeDir));
    assert.ok(fs.existsSync(path.join(s.projectsRoot, 'garden', 'notes.txt')), 'the projects were touched');
    assert.ok(!r.notes.some((n) => /chats and settings were kept/.test(n)), 'it says the chats were kept after deleting them');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 the second yes keeps every Kosmos\'s projects and working folders, named and orphaned, and names each one', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    worlds.writeRegistry(s.dataDir, { version: 1, activeWorldId: 'default', worlds: [worlds.defaultWorld(), { id: 'qa', name: 'QA', createdAt: null, base: null }] });
    const qa = worlds.envOverridesFor(s.dataDir, { id: 'qa' });
    const orphan = worlds.envOverridesFor(s.dataDir, { id: 'old' });
    for (const [dir, file] of [[qa.AGENT_WORKFORCE_PROJECTS, 'plan.md'], [qa.AGENT_WORKFORCE_WORKERS, 'ava/CLAUDE.md'], [orphan.AGENT_WORKFORCE_PROJECTS, 'kept.txt']]) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), 'work');
    }
    const qaStore = store.dataRootFor('win32', s.home, { AGENT_WORKFORCE_DATA: qa.AGENT_WORKFORCE_DATA });
    fs.mkdirSync(path.join(qaStore, 'chats'), { recursive: true });
    fs.writeFileSync(path.join(qaStore, 'chats', 'bo.jsonl'), 'hello');

    const r = run(s, { deleteData: true });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(fs.existsSync(path.join(qa.AGENT_WORKFORCE_PROJECTS, 'plan.md')), 'a named Kosmos\'s project was deleted');
    assert.ok(fs.existsSync(path.join(qa.AGENT_WORKFORCE_WORKERS, 'ava', 'CLAUDE.md')), 'a named Kosmos\'s working folder was deleted');
    assert.ok(fs.existsSync(path.join(orphan.AGENT_WORKFORCE_PROJECTS, 'kept.txt')), 'the projects of a Kosmos the list no longer names were deleted');
    assert.ok(!fs.existsSync(path.join(qaStore, 'chats', 'bo.jsonl')), 'a named Kosmos\'s chats survived the yes');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'chats')), 'the chats survived the yes');
    assert.ok(!fs.existsSync(worlds.registryPath(s.dataDir)), 'the settings survived the yes');
    assert.ok(r.notes.includes('Your projects for the Kosmos "QA" were kept in ' + qa.AGENT_WORKFORCE_PROJECTS + '.'), JSON.stringify(r.notes));
    assert.ok(r.notes.includes('Your agents\' working folders for the Kosmos "QA" were kept in ' + qa.AGENT_WORKFORCE_WORKERS + '.'), JSON.stringify(r.notes));
    assert.ok(r.notes.includes('Your projects for the Kosmos "old" were kept in ' + orphan.AGENT_WORKFORCE_PROJECTS + '.'), JSON.stringify(r.notes));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 fail closed: a list of Kosmoses that cannot be read, or names one it cannot use, leaves the data folder whole', WINDOWS_FOLDERS, () => {
  for (const [label, registry] of [['unparseable', '{"worlds": [ {"id": "qa"'], ['unsafe id', JSON.stringify({ version: 1, worlds: [{ id: 'default' }, { id: '../../evil' }] })], ['wrong shape', '{"worlds": "qa"}']]) {
    const s = sandbox();
    try {
      stubSchedulers({ lists: [listing([]), listing([])] });
      fs.writeFileSync(worlds.registryPath(s.dataDir), registry);
      const r = run(s, { deleteData: true });
      assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), label + ': the data folder was deleted without knowing whose work is in it');
      assert.equal(r.ok, false, label);
      assert.ok(r.left.some((l) => l.startsWith('your agents\' chats and settings (' + s.dataDir + '), kept because the list of your Kosmoses')), label + ': ' + JSON.stringify(r.left));
      assert.ok(!fs.existsSync(s.runtimeDir), label + ': the runtime folder, which holds no Kosmos\'s work, should still go');
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

test('🛑 Projects inside the data folder is kept on the second yes, with the folders above it, and everything else goes', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const inside = path.join(s.dataDir, 'nested', 'Projects');
    fs.mkdirSync(path.join(inside, 'garden'), { recursive: true });
    fs.writeFileSync(path.join(inside, 'garden', 'notes.txt'), "a person's own work");
    fs.writeFileSync(path.join(s.dataDir, 'nested', 'settings.json'), '{}');
    const r = run(s, { deleteData: true, projectsRoot: inside });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(fs.existsSync(path.join(inside, 'garden', 'notes.txt')), 'a project was deleted');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'nested', 'settings.json')), 'a file beside the projects survived');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'chats')), 'the chats survived the yes');
    assert.ok(r.notes.includes('Your projects were kept in ' + inside + '.'), JSON.stringify(r.notes));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 AGENT_WORKFORCE_DATA makes the runtime and data folders one folder: a No keeps the chats', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const env = { ...s.env, AGENT_WORKFORCE_DATA: path.join(s.base, 'D') };
    const dataDir = store.dataRootFor('win32', s.home, env);
    fs.mkdirSync(path.join(dataDir, 'chats'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'chats', 'ava.jsonl'), 'hello');
    const r = run(s, { env, deleteData: false });
    assert.ok(fs.existsSync(path.join(dataDir, 'chats', 'ava.jsonl')), 'a No to the second question deleted the chats');
    assert.ok(r.left.some((l) => l.startsWith('Kosmos\'s runtime folder (' + dataDir + '), kept because')), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir), 'the plain runtime folder, which was not the one derived, was deleted');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 a runtime folder that is not the plain <LOCALAPPDATA>\\Kosmos is kept and named, even when it overlaps nothing', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    /* AGENT_WORKFORCE_HOME moves the anchor under the home folder; LOCALAPPDATA still names the plain one. */
    const env = { ...s.env, AGENT_WORKFORCE_HOME: s.home };
    const moved = path.join(s.home, 'AppData', 'Local', 'Kosmos');
    fs.mkdirSync(path.join(moved, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(moved, 'something-else.txt'), 'not ours to judge');
    const r = run(s, { env });
    assert.ok(fs.existsSync(path.join(moved, 'something-else.txt')), 'a runtime folder that was not the plain one was deleted');
    assert.ok(r.left.some((l) => l.startsWith('Kosmos\'s runtime folder (' + moved + '), kept because it is not the usual ')), JSON.stringify(r.left));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 a runtime folder that IS the data folder (LOCALAPPDATA and APPDATA the same) is kept on a No', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const env = { ...s.env, LOCALAPPDATA: s.env.APPDATA };
    const r = run(s, { env, deleteData: false });
    assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'a No deleted the chats through the runtime folder');
    assert.ok(r.left.some((l) => l.includes('kept because your agents\' chats and settings are in the same place')), JSON.stringify(r.left));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 links are never followed: a junction inside the runtime folder goes as a link, and a runtime folder that is a junction is kept', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const precious = path.join(s.base, 'precious');
    fs.mkdirSync(precious, { recursive: true });
    fs.writeFileSync(path.join(precious, 'keep.txt'), 'keep');
    fs.symlinkSync(precious, path.join(s.runtimeDir, 'runtime', 'link'), 'junction');
    const r = uninstaller.uninstall({ platform: 'win32', env: s.env, home: s.home, projectsRoot: s.projectsRoot, liveExecutionAllowed: () => true });
    assert.ok(fs.existsSync(path.join(precious, 'keep.txt')), 'the folder a junction pointed at was emptied');
    assert.ok(!fs.existsSync(s.runtimeDir), JSON.stringify(r.left));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }

  const t = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const elsewhere = path.join(t.base, 'Projects-elsewhere');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'keep.txt'), 'keep');
    fs.rmSync(t.runtimeDir, { recursive: true, force: true });
    fs.symlinkSync(elsewhere, t.runtimeDir, 'junction');
    const r = uninstaller.uninstall({ platform: 'win32', env: t.env, home: t.home, projectsRoot: path.join(elsewhere, 'x'), liveExecutionAllowed: () => true });
    assert.ok(fs.existsSync(path.join(elsewhere, 'keep.txt')), 'the folder the runtime junction pointed at was emptied');
    assert.ok(r.left.some((l) => l.startsWith('Kosmos\'s runtime folder (' + t.runtimeDir + '), kept because')), JSON.stringify(r.left));
  } finally { fs.rmSync(t.base, { recursive: true, force: true }); }
});

test('an empty Kosmos folder in Task Scheduler is a clean removal', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing([]), listing([])] });
    const r = run(s, { deleteData: true });
    assert.deepEqual(calls, ['job /Query /FO CSV /NH', 'job /Query /FO CSV /NH']);
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.runtimeDir) && !fs.existsSync(s.dataDir));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a task Kosmos does not recognise is named and left in place, and both folders are kept for the tasks still there', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\agent-ava', 'Kosmos\\somebody-elses-task']), listing(['Kosmos\\somebody-elses-task'])] });
    const r = run(s, { deleteData: true });
    assert.ok(!calls.some((c) => c.includes('somebody-elses-task')), 'a task Kosmos does not recognise was acted on: ' + calls.join(' | '));
    assert.equal(r.ok, false);
    assert.ok(r.left.some((l) => l.includes('Kosmos\\somebody-elses-task') && /does not recognise/.test(l)), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir), 'the runtime was deleted while a task is still registered');
    assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'the chats were deleted while a task is still registered');
    assert.ok(r.left.some((l) => l.startsWith('Kosmos\'s runtime folder (' + s.runtimeDir + '), kept because')), JSON.stringify(r.left));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 gone is READ, not inferred: an agent registered while the removal ran keeps both folders and is named', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing(['Kosmos\\agent-zed'])] });
    const r = run(s, { deleteData: true });
    assert.equal(r.ok, false);
    assert.ok(r.left.some((l) => l.startsWith('the startup job for the agent "zed" (Kosmos\\agent-zed), which is still in Task Scheduler')), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir), 'the runtime went while an agent task is registered');
    assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'the chats went while an agent task is registered');
    assert.ok(r.done.includes('removed the startup job for the agent "ava" (Kosmos\\agent-ava)'), JSON.stringify(r.done));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a task that would not go is named with what Windows said, and a list that cannot be read again keeps everything', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    stubSchedulers({
      lists: [listing(['Kosmos\\agent-ava', 'Kosmos\\board']), listing(['Kosmos\\agent-ava'])],
      fail: { '/Delete /F /TN Kosmos\\agent-ava': { ok: false, out: 'ERROR: Access is denied.' } },
    });
    const r = run(s);
    assert.ok(r.left.includes('the startup job for the agent "ava" (Kosmos\\agent-ava), which is still in Task Scheduler (we could not remove the startup job (ERROR: Access is denied.))'), JSON.stringify(r.left));
    assert.ok(r.done.includes('removed the startup job for the Kosmos board (Kosmos\\board)'));
    assert.ok(fs.existsSync(s.runtimeDir));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }

  const t = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board']), { ok: false, out: 'ERROR: The RPC server is unavailable.' }] });
    const r = run(t, { deleteData: true });
    assert.ok(r.left.some((l) => l.includes('which we could not read again to see they were gone (ERROR: The RPC server is unavailable.)')), JSON.stringify(r.left));
    assert.ok(fs.existsSync(t.runtimeDir) && fs.existsSync(t.dataDir), 'a folder went on a list that could not be read again');
  } finally { fs.rmSync(t.base, { recursive: true, force: true }); }
});

test('🛑 a non-English Windows: what /End printed decides nothing, and a list with no Kosmos tasks is a clean removal', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    const FEHLER = { ok: false, out: 'FEHLER: Die Aufgabe wird derzeit nicht ausgeführt.' };
    stubSchedulers({
      lists: [listing(['Kosmos\\agent-bo', 'Kosmos\\board']), listing([])],
      fail: { '/End /TN Kosmos\\agent-bo': FEHLER, '/End /TN Kosmos\\board': FEHLER },
    });
    const r = run(s);
    assert.equal(r.ok, true, 'a translated "not running" was read as a failure: ' + JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.runtimeDir));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a Task Scheduler list that cannot be read, or lists nothing at all, changes nothing and says so', () => {
  for (const answer of [{ ok: false, out: 'ERROR: Access is denied.' }, { ok: true, out: '\r\n' }]) {
    const calls = stubSchedulers({ lists: [answer] });
    const r = uninstaller.uninstall({ platform: 'win32', env: { APPDATA: 'C:\\nowhere\\Roaming', LOCALAPPDATA: 'C:\\nowhere\\Local' }, home: 'C:\\nowhere', projectsRoot: 'C:\\nowhere\\P',
      removeFolder: () => { throw new Error('nothing may be deleted'); }, liveExecutionAllowed: () => true, deleteData: true });
    assert.deepEqual(calls, ['job /Query /FO CSV /NH'], 'something was changed on a list that could not be read');
    assert.equal(r.ok, false);
    assert.ok(r.left[0].startsWith('the startup jobs in Task Scheduler\'s Kosmos folder, which we could not read ('), JSON.stringify(r.left));
    assert.ok(!r.left.some((l) => /nothing may be deleted/.test(l)));
  }
});

test('the Kosmos folder this removal runs from is never deleted from here', WINDOWS_FOLDERS, () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const bundle = path.join(s.runtimeDir, 'Programs', 'Kosmos');
    fs.mkdirSync(bundle, { recursive: true });
    const r = run(s, { bundleRoot: bundle });
    assert.ok(fs.existsSync(bundle), 'the running Kosmos folder was deleted');
    assert.ok(r.left.some((l) => l.includes('kept because Kosmos is running from inside it')), JSON.stringify(r.left));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('folderRefusal: only an absolute folder named Kosmos that holds no user folder and no running Kosmos', () => {
  const g = { platform: 'win32', leaf: 'Kosmos', home: 'C:\\Users\\me', bundleRoot: 'C:\\Users\\me\\AppData\\Local\\Programs\\Kosmos' };
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\AppData\\Local\\Kosmos', g), null);
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\AppData\\Local\\kosmos', g), null, 'Windows names are not case-sensitive');
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\AppData\\Local\\Other', g), 'it is not a folder named Kosmos');
  assert.equal(uninstaller.folderRefusal('Kosmos', g), 'we could not work out where it is');
  assert.equal(uninstaller.folderRefusal('C:\\Kosmos', { ...g, home: 'C:\\Kosmos\\me' }), 'your user folder is inside it');
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\AppData\\Local\\Programs\\Kosmos', { ...g, bundleRoot: 'C:\\Users\\me\\AppData\\Local\\Programs\\Kosmos\\x' }),
    'Kosmos is running from inside it (C:\\Users\\me\\AppData\\Local\\Programs\\Kosmos\\x)');
  assert.equal(uninstaller.folderRefusal('C:\\Users\\me\\Kosmosity', g), 'it is not a folder named Kosmos');
});

test('🛑 without the confirm (liveExecutionAllowed) nothing is asked, ended or deleted', () => {
  const calls = stubSchedulers({ lists: [listing(['Kosmos\\board'])] });
  const env = { APPDATA: 'C:\\nowhere\\Roaming', LOCALAPPDATA: 'C:\\nowhere\\Local' };
  const r = uninstaller.uninstall({ platform: 'win32', env, home: 'C:\\nowhere', projectsRoot: 'C:\\nowhere\\P', deleteData: true });
  assert.equal(r.refused, true);
  assert.deepEqual(calls, [], 'a scheduler was asked before the removal was confirmed');
  const denied = uninstaller.uninstall({ platform: 'win32', env, home: 'C:\\nowhere', liveExecutionAllowed: () => false, deleteData: true });
  assert.equal(denied.refused, true);
  assert.deepEqual(calls, []);
  const mac = uninstaller.uninstall({ platform: 'darwin', env, home: 'C:\\nowhere', liveExecutionAllowed: () => true });
  assert.equal(mac.refused, true, 'a Mac ran the Windows removal');
});

test('the CLI is a dry run without --yes, and --yes arms it and writes the report the launcher reads', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-uninstall-cli-'));
  try {
    let asked = null;
    const said = [];
    const fake = (opts) => { asked = opts; return { ok: false, done: ['removed x'], left: ['the thing\nthat stayed'], notes: ['Your projects were kept in P.'] }; };
    assert.equal(uninstaller.cliMain(['--uninstall', '--delete-data'], { uninstall: fake, write: (t) => said.push(t) }), 2);
    assert.equal(asked, null, 'the removal ran without --yes');
    assert.match(said.join(''), /nothing was changed: add --yes/);
    assert.equal(uninstaller.cliMain(['--yes'], { uninstall: fake, write: () => {} }), 64, 'a --yes with no --uninstall was accepted');
    assert.equal(asked, null);

    const report = path.join(base, 'report.txt');
    const code = uninstaller.cliMain(['--uninstall', '--delete-data', '--root', 'C:\\Kosmos', '--report', report, '--yes'], { uninstall: fake, write: () => {} });
    assert.equal(code, 1);
    assert.equal(asked.deleteData, true);
    assert.equal(asked.bundleRoot, 'C:\\Kosmos');
    assert.equal(asked.liveExecutionAllowed(), true);
    assert.deepEqual(fs.readFileSync(report, 'utf8').split('\r\n'),
      ['DONE removed x', 'LEFT the thing that stayed', 'NOTE Your projects were kept in P.', ''],
      'a sentence with a line break became two report lines');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('win32job.kosmosFolderTasks reads the whole task list, every Kosmos; an unreadable or empty list is unknown; list() is unchanged', () => {
  win32job.setRunner((args) => (args.includes('/TN')
    ? { ok: true, out: [row('Kosmos\\board'), row('Kosmos\\agent-ava'), row('Kosmos\\agent-bo+qa')].join('\r\n') }
    : listing(['Kosmos\\board', 'Kosmos\\agent-ava', 'Kosmos\\agent-ava', 'Kosmos\\agent-bo+qa', 'KosmosOther\\x'])));
  assert.deepEqual(win32job.kosmosFolderTasks(), { known: true, paths: ['Kosmos\\board', 'Kosmos\\agent-ava', 'Kosmos\\agent-bo+qa'] });
  /* list() keeps its own folder query and only THIS world's agents, as on main. */
  assert.deepEqual([...win32job.list().names], ['ava']);
  win32job.setRunner(() => ({ ok: true, out: '\r\n' }));
  assert.equal(win32job.kosmosFolderTasks().known, false, 'an empty list was taken for "no Kosmos tasks"');
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
