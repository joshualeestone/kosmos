'use strict';
/**
 * win32-installer-native: `Kosmos.exe --uninstall`, the engine half (engine/win32uninstall.js).
 *
 * 🛑 NOTHING REAL IS TOUCHED. Every schtasks call goes to a stub runner (win32job.setRunner,
 * win32board.setRunner), the board's port is asked through a stub probe, every folder is under a
 * scratch base, and the platform, the environment, the home folder and the projects root are passed
 * in, never read from this machine. The live fleet's `\Kosmos\*` tasks, its board on 16180 and its
 * `%LOCALAPPDATA%\Kosmos` / `%APPDATA%\Kosmos` are out of reach.
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
const http = require('node:http');
const net = require('node:net');

const handoff = require('./win32handoff');
const win32job = require('./win32job');
const win32board = require('./win32board');
const store = require('./store');
const worlds = require('./worlds');
const uninstaller = require('./win32uninstall');

const WINDOWS_FOLDERS = { skip: process.platform !== 'win32' && 'the folder arms delete Windows-joined paths, which are only real folders on Windows' };
const NOT_FOUND = { ok: false, out: 'ERROR: The system cannot find the file specified.' };
const PORT = 16180;
/* A refused connection: the only answer that proves no board is there (round 3, finding 1). */
const NOBODY = { answering: false, outcome: 'refused', identity: null, startedByTask: null };
const NOBODY_ANSWERING = async () => NOBODY;
const TIMED_OUT = { answering: false, outcome: 'timed-out', identity: null, startedByTask: null };
const LOOK_FAILED = { answering: false, outcome: 'error', identity: null, startedByTask: null };
const TASK_BOARD = { answering: true, identity: '0.6.60+abc@default', startedByTask: true };
const HAND_STARTED_BOARD = { answering: true, identity: '0.6.60+abc@default', startedByTask: false };

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

const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text || 'x'); };

/* The machine's whole task list, as `schtasks /Query /FO CSV /NH` prints it: unlabelled rows,
   path first, always with the Microsoft tasks every Windows has. */
const row = (taskPath) => '"\\' + taskPath + '","N/A","Ready"';
const listing = (paths) => ({ ok: true, out: [row('Microsoft\\Windows\\Defrag\\ScheduledDefrag'), ...paths.map(row)].join('\r\n') + '\r\n' });

/* The board task's own definition, as `/Query /XML` prints it: enabled has no <Enabled> in <Settings>. */
const boardDefinition = (enabled) => ({ ok: true, out: '<?xml version="1.0"?><Task><Settings>' + (enabled ? '' : '<Enabled>false</Enabled>') + '</Settings></Task>' });

/* The board task's verbose row with Last Result 267009 (SCHED_S_TASK_RUNNING), the column
   win32board.taskRunning reads, so status() says running: true. */
const RUNNING_BOARD_ROW = '"BOX","\\Kosmos\\board","N/A","Running","Interactive only","9/13/2026 1:00:00 PM","267009"\r\n';

/**
 * One recorder for both command seams, so a test can assert the ORDER across agents and the
 * board. `lists` answers the whole-list query in turn (the read before, the read after);
 * `boardXml` answers the board task's definition; `fail` maps a joined command to its answer.
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

/** A probe that answers from `answers` in turn, repeating the last one. */
function probeSequence(...answers) {
  let at = 0;
  const probe = async () => { const a = answers[Math.min(at, answers.length - 1)]; at += 1; return a; };
  probe.count = () => at;
  return probe;
}

function run(s, extra) {
  return uninstaller.uninstall({
    platform: 'win32', env: s.env, home: s.home, projectsRoot: s.projectsRoot, port: PORT, probe: NOBODY_ANSWERING,
    removeFolder: (dir) => fs.rmSync(dir, { recursive: true, force: true }), sleep: async () => {},
    liveExecutionAllowed: () => true,
    ...extra,
  });
}

test.afterEach(() => { win32job.setRunner(null); win32board.setRunner(null); });

test('the board is switched off and ended first, every agent task of every Kosmos goes, the board task last, and the list is READ again', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava', 'Kosmos\\agent-bo+qa']), listing([])], boardXml: boardDefinition(true) });
    const r = await run(s);
    assert.deepEqual(calls, [
      'job /Query /FO CSV /NH',
      'board /Query /TN Kosmos\\board /XML',
      'board /Query /TN Kosmos\\board /FO CSV /V /NH',
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
      'job /Query /FO CSV /NH',
    ], 'the order, ending with the read after the removal and the read after the settle wait');
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.runtimeDir), '%LOCALAPPDATA%\\Kosmos is still there');
    assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'the chats were deleted without a yes');
    assert.ok(fs.existsSync(path.join(s.projectsRoot, 'garden', 'notes.txt')), 'the projects were touched');
    assert.ok(r.notes.includes('Your agents\' chats and settings were kept in ' + s.dataDir + '.'), JSON.stringify(r.notes));
    assert.ok(r.notes.includes('Your projects were kept in ' + s.projectsRoot + '.'), JSON.stringify(r.notes));
    assert.ok(r.done.some((d) => d.includes('"bo" in the Kosmos "qa"')), 'a named world\'s agent is not named by its world: ' + JSON.stringify(r.done));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 round 2 finding 2: a Kosmos board its task did not start is open, so NOTHING is read, changed or deleted', WINDOWS_FOLDERS, async () => {
  for (const [label, answer, boardXml] of [
    ['a board that says the task did not start it', HAND_STARTED_BOARD, null],
    ['a board too old to say, whose task Task Scheduler does not show running', { answering: true, identity: '0.6.50', startedByTask: null }, boardDefinition(true)],
  ]) {
    const s = sandbox();
    try {
      const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml });
      const r = await run(s, { deleteData: true, probe: async () => answer });
      assert.equal(r.stillOpen, true, label);
      assert.deepEqual(r.left, [uninstaller.KOSMOS_STILL_OPEN], label);
      assert.equal(uninstaller.KOSMOS_STILL_OPEN, 'Kosmos is still open. Close Kosmos, then remove it again.');
      assert.ok(!calls.some((c) => /\/(Change|End|Delete)/.test(c)), label + ': a task was changed while Kosmos was open: ' + calls.join(' | '));
      assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), label + ': a folder went while Kosmos was open');
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

test('something on the port that is not a Kosmos board does not stop the removal', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const r = await run(s, { probe: async () => ({ answering: true, identity: null, startedByTask: null }) });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.runtimeDir));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 the task\'s board that still answers after /End: no agent task removed, no folder deleted, and its switch put back', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml: boardDefinition(true) });
    const probe = probeSequence(TASK_BOARD);
    const r = await run(s, { deleteData: true, probe });
    assert.equal(r.stillOpen, true);
    assert.deepEqual(r.left, [uninstaller.KOSMOS_STILL_OPEN]);
    assert.deepEqual(r.notes, ['Its startup job was switched back on, as it was.']);
    assert.ok(calls.includes('board /End /TN Kosmos\\board'), 'the task\'s board was never ended');
    assert.ok(!calls.some((c) => c.startsWith('job /') && !c.startsWith('job /Query')), 'an agent task was touched while the board still answered: ' + calls.join(' | '));
    assert.equal(calls[calls.length - 1], 'board /Change /TN Kosmos\\board /ENABLE', 'the board task was left switched off after the removal stopped');
    assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'a folder went while the board still answered');
    assert.ok(probe.count() > uninstaller.BOARD_GONE_WAIT_MS / uninstaller.FOLDER_DELETE_WAIT_MS, 'it did not wait the whole bounded time for the board to go');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a board task switched off before the removal stays off when the removal stops, and one that cannot be switched back is named', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board'])], boardXml: boardDefinition(false) });
    const r = await run(s, { probe: async () => TASK_BOARD });
    assert.deepEqual(r.left, [uninstaller.KOSMOS_STILL_OPEN]);
    assert.ok(!calls.some((c) => c.includes('/ENABLE')), 'a task the person had switched off was switched on');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  const t = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board'])], boardXml: boardDefinition(true), fail: { '/Change /TN Kosmos\\board /ENABLE': { ok: false, out: 'ERROR: Access is denied.' } } });
    const r = await run(t, { probe: async () => TASK_BOARD });
    assert.equal(r.left[0], uninstaller.KOSMOS_STILL_OPEN);
    assert.ok(r.left[1].startsWith('the startup job for the Kosmos board, which is switched off now'), JSON.stringify(r.left));
    assert.ok(r.left[1].endsWith('Turn "Start Kosmos when I sign in to Windows" back on in Settings'), 'the switch left off does not say where to turn it back on: ' + JSON.stringify(r.left));
  } finally { fs.rmSync(t.base, { recursive: true, force: true }); }
});

test('the task\'s board that goes after /End lets the removal carry on', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml: boardDefinition(true) });
    const r = await run(s, { probe: probeSequence(TASK_BOARD, TASK_BOARD, TASK_BOARD, NOBODY) });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(calls.includes('job /Delete /F /TN Kosmos\\agent-ava'));
    assert.ok(!fs.existsSync(s.runtimeDir));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 a board answering when the folders would go keeps every folder', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const r = await run(s, { deleteData: true, probe: probeSequence(NOBODY, HAND_STARTED_BOARD) });
    assert.ok(r.left.includes(uninstaller.KOSMOS_STILL_OPEN), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'a folder went while a board answered');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('without a port nothing is asked or removed', async () => {
  const calls = stubSchedulers({ lists: [listing(['Kosmos\\board'])] });
  const r = await uninstaller.uninstall({ platform: 'win32', env: { APPDATA: 'C:\\nowhere\\Roaming', LOCALAPPDATA: 'C:\\nowhere\\Local' }, home: 'C:\\nowhere', projectsRoot: 'C:\\nowhere\\P', liveExecutionAllowed: () => true });
  assert.equal(r.refused, true);
  assert.match(r.left[0], /could not tell which port Kosmos uses/);
  assert.deepEqual(calls, []);
});

test('the chats and settings are deleted only when the person said yes', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board']), listing([])], boardXml: boardDefinition(true) });
    const r = await run(s, { deleteData: true });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.dataDir), '%APPDATA%\\Kosmos survived a yes');
    assert.ok(!fs.existsSync(s.runtimeDir));
    assert.ok(fs.existsSync(path.join(s.projectsRoot, 'garden', 'notes.txt')), 'the projects were touched');
    assert.ok(!r.notes.some((n) => /chats and settings were kept/.test(n)), 'it says the chats were kept after deleting them');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 the second yes keeps every Kosmos\'s projects and working folders, named and orphaned, and names each one', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    worlds.writeRegistry(s.dataDir, { version: 1, activeWorldId: 'default', worlds: [worlds.defaultWorld(), { id: 'qa', name: 'QA', createdAt: null, base: null }] });
    const qa = worlds.envOverridesFor(s.dataDir, { id: 'qa' });
    const orphan = worlds.envOverridesFor(s.dataDir, { id: 'old' });
    for (const [dir, file] of [[qa.AGENT_WORKFORCE_PROJECTS, 'plan.md'], [qa.AGENT_WORKFORCE_WORKERS, 'ava/CLAUDE.md'], [orphan.AGENT_WORKFORCE_PROJECTS, 'kept.txt']]) {
      put(path.join(dir, file), 'work');
    }
    const qaStore = store.dataRootFor('win32', s.home, { AGENT_WORKFORCE_DATA: qa.AGENT_WORKFORCE_DATA });
    put(path.join(qaStore, 'chats', 'bo.jsonl'), 'hello');

    const r = await run(s, { deleteData: true });
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

test('🛑 fail closed: a list of Kosmoses that cannot be read, or names one it cannot use, leaves the data folder whole', WINDOWS_FOLDERS, async () => {
  for (const [label, registry] of [['unparseable', '{"worlds": [ {"id": "qa"'], ['unsafe id', JSON.stringify({ version: 1, worlds: [{ id: 'default' }, { id: '../../evil' }] })], ['wrong shape', '{"worlds": "qa"}']]) {
    const s = sandbox();
    try {
      stubSchedulers({ lists: [listing([]), listing([])] });
      fs.writeFileSync(worlds.registryPath(s.dataDir), registry);
      const r = await run(s, { deleteData: true });
      assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), label + ': the data folder was deleted without knowing whose work is in it');
      assert.equal(r.ok, false, label);
      assert.ok(r.left.some((l) => l.startsWith('your agents\' chats and settings (' + s.dataDir + '), kept because the list of your Kosmoses')), label + ': ' + JSON.stringify(r.left));
      assert.ok(!fs.existsSync(s.runtimeDir), label + ': the runtime folder, which holds no Kosmos\'s work, should still go');
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

test('🛑 round 2 finding 6: a stray FILE in the worlds folder is not a reason to stop, a stray folder with an unsafe name still is', WINDOWS_FOLDERS, async () => {
  for (const [name, isFile, goes] of [['desktop.ini', true, true], ['QA', false, false], ['.qa.tmp-1', false, false]]) {
    const s = sandbox();
    try {
      stubSchedulers({ lists: [listing([]), listing([])] });
      const at = path.join(s.dataDir, 'worlds', name);
      if (isFile) put(at, '[.ShellClassInfo]'); else fs.mkdirSync(at, { recursive: true });
      const r = await run(s, { deleteData: true });
      assert.equal(!fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), goes, name + ': ' + JSON.stringify(r.left));
      assert.equal(r.ok, goes, name + ': ' + JSON.stringify(r.left));
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

test('🛑 round 2 finding 5: a kept folder that IS the data folder, or holds it, keeps the data folder whole', WINDOWS_FOLDERS, async () => {
  for (const which of ['equal', 'equal, another case and a trailing separator', 'its parent']) {
    const s = sandbox();
    try {
      stubSchedulers({ lists: [listing([]), listing([])] });
      put(path.join(s.dataDir, 'my-project', 'code.js'), 'work');
      const projectsRoot = which === 'its parent' ? s.env.APPDATA : which === 'equal' ? s.dataDir : s.dataDir.toUpperCase() + '\\';
      const r = await run(s, { deleteData: true, projectsRoot });
      assert.ok(fs.existsSync(path.join(s.dataDir, 'my-project', 'code.js')), which + ': a project was deleted with the data folder');
      assert.ok(r.left.some((l) => l.startsWith('your agents\' chats and settings (' + s.dataDir + '), kept because it is one of your projects or working folders, or inside one')), which + ': ' + JSON.stringify(r.left));
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

test('🛑 round 2 finding 7: every file that would not delete is named, the folders above later ones are still tidied, and a long list is counted', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    worlds.writeRegistry(s.dataDir, { version: 1, activeWorldId: 'default', worlds: [worlds.defaultWorld(), { id: 'zz', name: 'ZZ' }] });
    const lockedA = path.join(s.dataDir, 'aaa', 'locked.log');
    const lockedB = path.join(s.dataDir, 'bbb', 'also-locked.log');
    put(lockedA, 'held');
    put(lockedB, 'held');
    put(path.join(s.dataDir, 'worlds', 'zz', 'Kosmos', 'chats', 'c.jsonl'), 'c');
    const locked = new Set([path.join(s.dataDir, 'aaa'), path.join(s.dataDir, 'bbb')].map((p) => p.toLowerCase()));
    const r = await run(s, { deleteData: true, removeFolder: (dir) => { if (locked.has(dir.toLowerCase())) throw new Error('EBUSY: resource busy or locked'); fs.rmSync(dir, { recursive: true, force: true }); } });
    const sentence = r.left.find((l) => l.startsWith('your agents\' chats and settings in ' + s.dataDir));
    assert.ok(sentence, JSON.stringify(r.left));
    assert.ok(sentence.includes(path.join(s.dataDir, 'aaa')) && sentence.includes(path.join(s.dataDir, 'bbb')), 'a later leftover was hidden behind the first: ' + sentence);
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'worlds', 'zz', 'Kosmos')), 'a folder after the first failure was not tidied');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'worlds', 'zz')), 'a folder above a later, successful delete was left behind, unnamed, after an earlier failure');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'chats')));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }

  const t = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    for (let i = 0; i < uninstaller.MAX_NAMED_LEFTOVERS + 2; i += 1) put(path.join(t.dataDir, 'held-' + String(i).padStart(2, '0') + '.log'), 'held');
    const r = await run(t, { deleteData: true, removeFolder: (dir) => { if (/held-\d+\.log$/.test(dir)) throw new Error('EBUSY'); fs.rmSync(dir, { recursive: true, force: true }); } });
    const sentence = r.left.find((l) => l.includes(' of which could not be deleted'));
    assert.ok(sentence && sentence.includes((uninstaller.MAX_NAMED_LEFTOVERS + 2) + ' of which could not be deleted') && sentence.endsWith('; and 2 more'), JSON.stringify(r.left));
  } finally { fs.rmSync(t.base, { recursive: true, force: true }); }
});

test('🛑 Projects inside the data folder is kept on the second yes, with the folders above it, and everything else goes', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const inside = path.join(s.dataDir, 'nested', 'Projects');
    put(path.join(inside, 'garden', 'notes.txt'), "a person's own work");
    fs.writeFileSync(path.join(s.dataDir, 'nested', 'settings.json'), '{}');
    const r = await run(s, { deleteData: true, projectsRoot: inside.toUpperCase().replace(/\\/g, '/') + '/' });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(fs.existsSync(path.join(inside, 'garden', 'notes.txt')), 'a project was deleted');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'nested', 'settings.json')), 'a file beside the projects survived');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'chats')), 'the chats survived the yes');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 AGENT_WORKFORCE_DATA makes the runtime and data folders one folder: a No keeps the chats', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const env = { ...s.env, AGENT_WORKFORCE_DATA: path.join(s.base, 'D') };
    const dataDir = store.dataRootFor('win32', s.home, env);
    put(path.join(dataDir, 'chats', 'ava.jsonl'), 'hello');
    const r = await run(s, { env, deleteData: false });
    assert.ok(fs.existsSync(path.join(dataDir, 'chats', 'ava.jsonl')), 'a No to the second question deleted the chats');
    assert.ok(r.left.some((l) => l.startsWith('Kosmos\'s runtime folder (' + dataDir + '), kept because')), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir), 'the plain runtime folder, which was not the one derived, was deleted');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 a runtime folder that is not the plain <LOCALAPPDATA>\\Kosmos is kept and named, even when it overlaps nothing', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const env = { ...s.env, AGENT_WORKFORCE_HOME: s.home };
    const moved = path.join(s.home, 'AppData', 'Local', 'Kosmos');
    put(path.join(moved, 'something-else.txt'), 'not ours to judge');
    const r = await run(s, { env });
    assert.ok(fs.existsSync(path.join(moved, 'something-else.txt')), 'a runtime folder that was not the plain one was deleted');
    assert.ok(r.left.some((l) => l.startsWith('Kosmos\'s runtime folder (' + moved + '), kept because it is not the usual ')), JSON.stringify(r.left));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 a runtime folder that IS the data folder (LOCALAPPDATA and APPDATA the same) is kept on a No', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const r = await run(s, { env: { ...s.env, LOCALAPPDATA: s.env.APPDATA }, deleteData: false });
    assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'a No deleted the chats through the runtime folder');
    assert.ok(r.left.some((l) => l.includes('kept because your agents\' chats and settings are in the same place')), JSON.stringify(r.left));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 links are never followed: a junction inside the runtime folder goes as a link, and a runtime folder that is a junction is kept', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const precious = path.join(s.base, 'precious');
    put(path.join(precious, 'keep.txt'), 'keep');
    fs.symlinkSync(precious, path.join(s.runtimeDir, 'runtime', 'link'), 'junction');
    const r = await run(s, { removeFolder: undefined });
    assert.ok(fs.existsSync(path.join(precious, 'keep.txt')), 'the folder a junction pointed at was emptied');
    assert.ok(!fs.existsSync(s.runtimeDir), JSON.stringify(r.left));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }

  const t = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const elsewhere = path.join(t.base, 'Projects-elsewhere');
    put(path.join(elsewhere, 'keep.txt'), 'keep');
    fs.rmSync(t.runtimeDir, { recursive: true, force: true });
    fs.symlinkSync(elsewhere, t.runtimeDir, 'junction');
    const r = await run(t, { removeFolder: undefined, projectsRoot: path.join(elsewhere, 'x') });
    assert.ok(fs.existsSync(path.join(elsewhere, 'keep.txt')), 'the folder the runtime junction pointed at was emptied');
    assert.ok(r.left.some((l) => l.startsWith('Kosmos\'s runtime folder (' + t.runtimeDir + '), kept because')), JSON.stringify(r.left));
  } finally { fs.rmSync(t.base, { recursive: true, force: true }); }
});

test('an empty Kosmos folder in Task Scheduler is a clean removal', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing([]), listing([])] });
    const r = await run(s, { deleteData: true });
    assert.deepEqual(calls, ['job /Query /FO CSV /NH', 'job /Query /FO CSV /NH', 'job /Query /FO CSV /NH']);
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.runtimeDir) && !fs.existsSync(s.dataDir));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a task Kosmos does not recognise is named and left in place, and both folders are kept for the tasks still there', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\agent-ava', 'Kosmos\\somebody-elses-task']), listing(['Kosmos\\somebody-elses-task'])] });
    const r = await run(s, { deleteData: true });
    assert.ok(!calls.some((c) => c.includes('somebody-elses-task')), 'a task Kosmos does not recognise was acted on: ' + calls.join(' | '));
    assert.equal(r.ok, false);
    assert.ok(r.left.some((l) => l.includes('Kosmos\\somebody-elses-task') && /does not recognise/.test(l)), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir), 'the runtime was deleted while a task is still registered');
    assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'the chats were deleted while a task is still registered');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 gone is READ, not inferred: an agent registered while the removal ran keeps both folders and is named', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing(['Kosmos\\agent-zed'])], boardXml: boardDefinition(true) });
    const r = await run(s, { deleteData: true });
    assert.equal(r.ok, false);
    assert.ok(r.left.some((l) => l.startsWith('the startup job for the agent "zed" (Kosmos\\agent-zed), which is still in Task Scheduler')), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir), 'the runtime went while an agent task is registered');
    assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'the chats went while an agent task is registered');
    assert.ok(r.done.includes('removed the startup job for the agent "ava" (Kosmos\\agent-ava)'), JSON.stringify(r.done));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a task that would not go is named with what Windows said, and a list that cannot be read again keeps everything', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({
      lists: [listing(['Kosmos\\agent-ava', 'Kosmos\\board']), listing(['Kosmos\\agent-ava'])],
      boardXml: boardDefinition(true),
      fail: { '/Delete /F /TN Kosmos\\agent-ava': { ok: false, out: 'ERROR: Access is denied.' } },
    });
    const r = await run(s);
    assert.ok(r.left.includes('the startup job for the agent "ava" (Kosmos\\agent-ava), which is still in Task Scheduler (we could not remove the startup job (ERROR: Access is denied.))'), JSON.stringify(r.left));
    assert.ok(r.done.includes('removed the startup job for the Kosmos board (Kosmos\\board)'));
    assert.ok(fs.existsSync(s.runtimeDir));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }

  const t = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board']), { ok: false, out: 'ERROR: The RPC server is unavailable.' }], boardXml: boardDefinition(true) });
    const r = await run(t, { deleteData: true });
    assert.ok(r.left.some((l) => l.includes('which we could not read again to see they were gone (ERROR: The RPC server is unavailable.)')), JSON.stringify(r.left));
    assert.ok(fs.existsSync(t.runtimeDir) && fs.existsSync(t.dataDir), 'a folder went on a list that could not be read again');
  } finally { fs.rmSync(t.base, { recursive: true, force: true }); }
});

test('🛑 a non-English Windows: what /End printed decides nothing, and a list with no Kosmos tasks is a clean removal', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    const FEHLER = { ok: false, out: 'FEHLER: Die Aufgabe wird derzeit nicht ausgeführt.' };
    stubSchedulers({
      lists: [listing(['Kosmos\\agent-bo', 'Kosmos\\board']), listing([])],
      boardXml: boardDefinition(true),
      fail: { '/End /TN Kosmos\\agent-bo': FEHLER, '/End /TN Kosmos\\board': FEHLER },
    });
    const r = await run(s);
    assert.equal(r.ok, true, 'a translated "not running" was read as a failure: ' + JSON.stringify(r.left));
    assert.ok(!fs.existsSync(s.runtimeDir));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a Task Scheduler list that cannot be read, or lists nothing at all, changes nothing and says so', async () => {
  for (const answer of [{ ok: false, out: 'ERROR: Access is denied.' }, { ok: true, out: '\r\n' }]) {
    const calls = stubSchedulers({ lists: [answer] });
    const r = await uninstaller.uninstall({ platform: 'win32', env: { APPDATA: 'C:\\nowhere\\Roaming', LOCALAPPDATA: 'C:\\nowhere\\Local' }, home: 'C:\\nowhere', projectsRoot: 'C:\\nowhere\\P',
      port: PORT, probe: NOBODY_ANSWERING, removeFolder: () => { throw new Error('nothing may be deleted'); }, liveExecutionAllowed: () => true, deleteData: true });
    assert.deepEqual(calls, ['job /Query /FO CSV /NH'], 'something was changed on a list that could not be read');
    assert.equal(r.ok, false);
    assert.ok(r.left[0].startsWith('the startup jobs in Task Scheduler\'s Kosmos folder, which we could not read ('), JSON.stringify(r.left));
    assert.ok(!r.left.some((l) => /nothing may be deleted/.test(l)));
  }
});

test('the Kosmos folder this removal runs from is never deleted from here', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const bundle = path.join(s.runtimeDir, 'Programs', 'Kosmos');
    fs.mkdirSync(bundle, { recursive: true });
    const r = await run(s, { bundleRoot: bundle });
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

test('🛑 without the confirm (liveExecutionAllowed) nothing is asked, ended or deleted', async () => {
  const calls = stubSchedulers({ lists: [listing(['Kosmos\\board'])] });
  const env = { APPDATA: 'C:\\nowhere\\Roaming', LOCALAPPDATA: 'C:\\nowhere\\Local' };
  const r = await uninstaller.uninstall({ platform: 'win32', env, home: 'C:\\nowhere', projectsRoot: 'C:\\nowhere\\P', port: PORT, probe: NOBODY_ANSWERING, deleteData: true });
  assert.equal(r.refused, true);
  assert.deepEqual(calls, [], 'a scheduler was asked before the removal was confirmed');
  const denied = await uninstaller.uninstall({ platform: 'win32', env, home: 'C:\\nowhere', port: PORT, probe: NOBODY_ANSWERING, liveExecutionAllowed: () => false, deleteData: true });
  assert.equal(denied.refused, true);
  assert.deepEqual(calls, []);
  const mac = await uninstaller.uninstall({ platform: 'darwin', env, home: 'C:\\nowhere', port: PORT, probe: NOBODY_ANSWERING, liveExecutionAllowed: () => true });
  assert.equal(mac.refused, true, 'a Mac ran the Windows removal');
});

test('the CLI is a dry run without --yes, and --yes arms it, passes the port on and writes the report the launcher reads', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-uninstall-cli-'));
  try {
    let asked = null;
    const said = [];
    const fake = async (opts) => { asked = opts; return { ok: false, done: ['removed x'], left: ['the thing\nthat stayed'], notes: ['Your projects were kept in P.'] }; };
    assert.equal(await uninstaller.cliMain(['--uninstall', '--delete-data', '--port', '16180'], { uninstall: fake, write: (t) => said.push(t) }), 2);
    assert.equal(asked, null, 'the removal ran without --yes');
    assert.match(said.join(''), /nothing was changed: add --yes/);
    assert.equal(await uninstaller.cliMain(['--yes'], { uninstall: fake, write: () => {} }), 64, 'a --yes with no --uninstall was accepted');
    assert.equal(asked, null);

    const report = path.join(base, 'report.txt');
    const code = await uninstaller.cliMain(['--uninstall', '--delete-data', '--root', 'C:\\Kosmos', '--port', '16180', '--report', report, '--yes'], { uninstall: fake, write: () => {} });
    assert.equal(code, 1);
    assert.equal(asked.deleteData, true);
    assert.equal(asked.bundleRoot, 'C:\\Kosmos');
    assert.equal(asked.port, '16180');
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

test('🛑 round 3 finding 1, real listeners: a board that never answers, or a hand-started board slower than the probe, stops the removal with nothing asked or changed; only a refused port lets it run', WINDOWS_FOLDERS, async () => {
  const listeners = await boardListeners();
  try {
    for (const [label, port] of [['a listener that never answers', listeners.ports.hung], ['a hand-started board that answers after 2.5s', listeners.ports.slow]]) {
      const s = sandbox();
      try {
        const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml: boardDefinition(true) });
        const r = await run(s, { deleteData: true, port, probe: undefined });
        assert.equal(r.stillOpen, true, label + ': ' + JSON.stringify(r));
        assert.deepEqual(r.left, [uninstaller.KOSMOS_STILL_OPEN], label);
        /* Round 4, finding 3: the board task's state is READ (it is not running here); nothing is changed. */
        assert.ok(!calls.some((c) => /\/(Change|End|Delete)/.test(c)), label + ': Task Scheduler was changed while a board may be open: ' + calls.join(' | '));
        assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), label + ': a folder went while a board may be open');
      } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
    }
    const s = sandbox();
    try {
      stubSchedulers({ lists: [listing(['Kosmos\\agent-ava']), listing([])] });
      const r = await run(s, { port: listeners.ports.refused, probe: undefined });
      assert.equal(r.ok, true, 'a port nothing listens on stopped the removal: ' + JSON.stringify(r.left));
      assert.ok(!fs.existsSync(s.runtimeDir));
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  } finally { await listeners.close(); }
});

test('🛑 round 3 finding 1: after /End, a board that stops answering IN TIME, or a look that fails, is waited through to the end of the budget and counts as still open', WINDOWS_FOLDERS, async () => {
  for (const [label, unanswered] of [['timed out', TIMED_OUT], ['the look failed', LOOK_FAILED], ['no reason given', { answering: false }]]) {
    const s = sandbox();
    try {
      const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml: boardDefinition(true) });
      const probe = probeSequence(TASK_BOARD, unanswered);
      const r = await run(s, { deleteData: true, probe });
      assert.equal(r.stillOpen, true, label + ': a board that did not answer in time was taken as gone: ' + JSON.stringify(r));
      assert.ok(probe.count() > uninstaller.BOARD_GONE_WAIT_MS / uninstaller.FOLDER_DELETE_WAIT_MS, label + ': it stopped waiting before the budget');
      assert.ok(!calls.some((c) => /^job \/(Change|End|Delete)/.test(c)), label + ': an agent task was touched: ' + calls.join(' | '));
      assert.equal(calls[calls.length - 1], 'board /Change /TN Kosmos\\board /ENABLE', label + ': the switch was not put back');
      assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), label + ': a folder went');
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

test('round 3 finding 1: the wait for the board to go is bounded by the clock too, since each probe that times out spends its own 2s', WINDOWS_FOLDERS, async () => {
  const PROBE_SPENDS_MS = 2000;
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board']), listing([])], boardXml: boardDefinition(false) });
    let clock = 0;
    const answers = probeSequence(TASK_BOARD, TIMED_OUT);
    const r = await run(s, {
      probe: async (port) => { clock += PROBE_SPENDS_MS; return answers(port); },
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
    });
    assert.equal(r.stillOpen, true, JSON.stringify(r));
    assert.ok(answers.count() <= 2 + Math.ceil(uninstaller.BOARD_GONE_CLOCK_MS / (PROBE_SPENDS_MS + uninstaller.FOLDER_DELETE_WAIT_MS)),
      'the wait asked ' + answers.count() + ' times, far past its budget in real time');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 round 3 finding 1: a board that does not answer in time when the folders would go keeps every folder', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const r = await run(s, { deleteData: true, probe: probeSequence(NOBODY, TIMED_OUT) });
    assert.ok(r.left.includes(uninstaller.KOSMOS_STILL_OPEN), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'a folder went while a board may be open');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 round 3 finding 2: a startup switch that cannot be read, or a read that throws, stops the removal before anything changes, and says so plainly', WINDOWS_FOLDERS, async () => {
  const realStatus = win32board.status;
  for (const [label, script, status] of [
    ['the board task\'s definition cannot be read', { boardXml: { ok: false, out: 'ERROR: The operation timed out.' } }, null],
    ['the read throws', { boardXml: boardDefinition(true) }, () => { throw new Error('schtasks exploded'); }],
  ]) {
    const s = sandbox();
    try {
      const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], ...script });
      if (status) win32board.status = status;
      const r = await run(s, { deleteData: true, probe: async () => TASK_BOARD });
      assert.equal(r.ok, false, label);
      assert.deepEqual(r.left, [uninstaller.STARTUP_UNREADABLE], label + ': ' + JSON.stringify(r.left));
      assert.ok(!calls.some((c) => /\/(Change|End|Delete)/.test(c)), label + ': a task was changed on a switch that could not be read: ' + calls.join(' | '));
      assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), label + ': a folder went');
    } finally {
      win32board.status = realStatus;
      fs.rmSync(s.base, { recursive: true, force: true });
    }
  }
  assert.equal(uninstaller.STARTUP_UNREADABLE, 'Kosmos could not check whether it starts when you sign in. Nothing was removed. Try again in a minute.');
});

test('🛑 round 3 finding 2: a board startup job that will not switch off stops the removal with nothing else changed', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    const calls = stubSchedulers({
      lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml: boardDefinition(true),
      fail: { '/Change /TN Kosmos\\board /DISABLE': { ok: false, out: 'ERROR: Access is denied.' } },
    });
    const r = await run(s, { deleteData: true });
    assert.equal(r.ok, false);
    assert.equal(r.left.length, 1, JSON.stringify(r.left));
    assert.ok(r.left[0].startsWith(uninstaller.STARTUP_WOULD_NOT_SWITCH_OFF) && r.left[0].includes('Access is denied'), JSON.stringify(r.left));
    assert.deepEqual(calls.filter((c) => /\/(Change|End|Delete)/.test(c)), ['board /Change /TN Kosmos\\board /DISABLE'],
      'something else was changed after the switch would not go off');
    assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('🛑 round 3 finding 2: a board startup job the removal leaves behind is switched back on as it was, and one that cannot be is named with where to turn it on', WINDOWS_FOLDERS, async () => {
  const REMOVE_DENIED = { '/Delete /F /TN Kosmos\\board': { ok: false, out: 'ERROR: Access is denied.' } };
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board']), listing(['Kosmos\\board'])], boardXml: boardDefinition(true), fail: REMOVE_DENIED });
    const r = await run(s);
    assert.equal(r.ok, false);
    assert.ok(calls.includes('board /Change /TN Kosmos\\board /ENABLE'), 'the board job left behind stays switched off: ' + calls.join(' | '));
    assert.ok(r.notes.includes('Its startup job was switched back on, as it was.'), JSON.stringify(r.notes));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }

  const t = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board']), listing(['Kosmos\\board'])], boardXml: boardDefinition(true),
      fail: { ...REMOVE_DENIED, '/Change /TN Kosmos\\board /ENABLE': { ok: false, out: 'ERROR: Access is denied.' } } });
    const r = await run(t);
    const sentence = r.left.find((l) => l.startsWith('the startup job for the Kosmos board (Kosmos\\board), which is still in Task Scheduler'));
    assert.ok(sentence && sentence.includes('It is switched off now') && sentence.endsWith('Turn "Start Kosmos when I sign in to Windows" back on in Settings'), JSON.stringify(r.left));
  } finally { fs.rmSync(t.base, { recursive: true, force: true }); }

  const u = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board']), listing(['Kosmos\\board'])], boardXml: boardDefinition(false), fail: REMOVE_DENIED });
    await run(u);
    assert.ok(!calls.some((c) => c.includes('/ENABLE')), 'a job the person had switched off was switched on');
  } finally { fs.rmSync(u.base, { recursive: true, force: true }); }
});

test('🛑 round 3 finding 3: once everything went, it waits REREGISTER_SETTLE_MS and looks again; a task registered again, or a board come up, is named and the removal is not ok', WINDOWS_FOLDERS, async () => {
  const CASES = [
    ['the board task registered again', [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([]), listing(['Kosmos\\board'])], probeSequence(NOBODY),
      'the startup job for the Kosmos board (Kosmos\\board), which was registered again while Kosmos was being removed. Remove Kosmos again'],
    ['an agent task registered again', [listing(['Kosmos\\agent-ava']), listing([]), listing(['Kosmos\\agent-ava'])], probeSequence(NOBODY),
      'the startup job for the agent "ava" (Kosmos\\agent-ava), which was registered again while Kosmos was being removed. Remove Kosmos again'],
    ['a board came up', [listing([]), listing([])], probeSequence(NOBODY, NOBODY, HAND_STARTED_BOARD), uninstaller.KOSMOS_STILL_OPEN],
    ['a board that does not answer in time came up', [listing([]), listing([])], probeSequence(NOBODY, NOBODY, TIMED_OUT), uninstaller.KOSMOS_STILL_OPEN],
  ];
  for (const [label, lists, probe, expected] of CASES) {
    const s = sandbox();
    try {
      stubSchedulers({ lists, boardXml: boardDefinition(true) });
      const slept = [];
      const r = await run(s, { probe, sleep: async (ms) => { slept.push(ms); } });
      assert.equal(r.ok, false, label + ': ' + JSON.stringify(r));
      assert.deepEqual(slept, [uninstaller.REREGISTER_SETTLE_MS], label + ': no settle wait before the last look');
      assert.ok(r.left.includes(expected), label + ': ' + JSON.stringify(r.left));
      assert.ok(uninstaller.reportText(r).includes('LEFT ' + expected),
        label + ': the launcher would not see it, and would take away the Start menu and Apps entries');
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
  assert.equal(uninstaller.REREGISTER_SETTLE_MS, 3000);
});

/* ---- the round 4 review, fixed in round 5 ------------------------------------ */

const PORT_IN_USE = (port) => 'Another program is using port ' + port + ', so Kosmos cannot tell whether it is still open. Restart your computer, then remove Kosmos again.';

/**
 * A real listener on one address: a hand-started Kosmos board ('board'), a program that answers in
 * something other than HTTP ('not-http', the reviewer's VNC greeting), or one that never answers
 * ('hung'). Null when this machine cannot listen there.
 */
async function listenerOn(host, kind, options) {
  const o = options || {};
  const sockets = new Set();
  const server = kind === 'board'
    ? http.createServer((req, res) => {
      res.writeHead(200, { [handoff.BOARD_IDENTITY_HEADER]: '0.6.61+abc@default', [handoff.BOARD_STARTED_BY_TASK_HEADER]: o.startedByTask || '0' });
      res.end('board');
    })
    : net.createServer((socket) => { if (kind === 'not-http') socket.end('RFB 003.008\n'); });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const listening = await new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(o.port || 0, host, () => resolve(true));
  });
  if (!listening) return null;
  let closing = null;
  const close = () => {
    if (!closing) closing = new Promise((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); });
    return closing;
  };
  return { port: server.address().port, close };
}

test('🛑 round 4 finding 1, real listeners: a hand-started board on ::1 only, on 127.0.0.1 only, or on the KOSMOS_BIND_HOST address, stops the removal with nothing changed', WINDOWS_FOLDERS, async (t) => {
  for (const [label, host, extraEnv] of [
    ['::1 only', '::1', {}], ['127.0.0.1 only', '127.0.0.1', {}], ['KOSMOS_BIND_HOST=127.0.0.2', '127.0.0.2', { KOSMOS_BIND_HOST: '127.0.0.2' }],
    /* Round 5, finding 1: a name is resolved now, and localhost still reaches a board on ::1. */
    ['KOSMOS_BIND_HOST=localhost, the board on ::1', '::1', { KOSMOS_BIND_HOST: 'localhost' }],
  ]) {
    const board = await listenerOn(host, 'board');
    if (!board) { t.diagnostic('ARM NOT RUN: ' + label + ', this machine cannot listen on ' + host); continue; }
    const s = sandbox();
    try {
      const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml: boardDefinition(true) });
      const r = await run(s, { deleteData: true, port: board.port, probe: undefined, env: { ...s.env, ...extraEnv } });
      assert.equal(r.stillOpen, true, label + ': the removal ran under a board it could not see: ' + JSON.stringify(r));
      assert.ok(!calls.some((c) => /\/(Change|End|Delete)/.test(c)), label + ': a task was changed: ' + calls.join(' | '));
      assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), label + ': a folder went, chats included');
    } finally {
      await board.close();
      fs.rmSync(s.base, { recursive: true, force: true });
    }
  }

  /* The control: the same board on 127.0.0.2 with KOSMOS_BIND_HOST unset is not looked for, so it was
     the bind host's probe that stopped the removal above. */
  const board = await listenerOn('127.0.0.2', 'board');
  if (!board) return;
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing([]), listing([])] });
    const r = await run(s, { port: board.port, probe: undefined });
    assert.equal(r.ok, true, 'CONTROL: a board on 127.0.0.2 was seen without KOSMOS_BIND_HOST naming it: ' + JSON.stringify(r.left));
  } finally {
    await board.close();
    fs.rmSync(s.base, { recursive: true, force: true });
  }
});

test('🛑 round 4 finding 2: when the board job would not go and the list cannot be read again, its switch is put back on, or the report says it is off', WINDOWS_FOLDERS, async () => {
  const UNREADABLE = { ok: false, out: 'ERROR: The RPC server is unavailable.' };
  const DELETE_DENIED = { '/Delete /F /TN Kosmos\\board': { ok: false, out: 'ERROR: Access is denied.' } };
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board']), UNREADABLE], boardXml: boardDefinition(true), fail: DELETE_DENIED });
    const r = await run(s);
    assert.equal(r.ok, false);
    assert.ok(calls.includes('board /Change /TN Kosmos\\board /DISABLE'));
    assert.ok(calls.includes('board /Change /TN Kosmos\\board /ENABLE'), 'the board job left behind stays switched off: ' + calls.join(' | '));
    assert.ok(r.notes.includes('Its startup job was switched back on, as it was.'), JSON.stringify(r.notes));
    assert.ok(r.left.some((l) => l.startsWith('the startup job for the Kosmos board (Kosmos\\board), which Windows would not remove (')), JSON.stringify(r.left));
    assert.ok(fs.existsSync(s.runtimeDir));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }

  const t = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board']), UNREADABLE], boardXml: boardDefinition(true),
      fail: { ...DELETE_DENIED, '/Change /TN Kosmos\\board /ENABLE': { ok: false, out: 'ERROR: Access is denied.' } } });
    const r = await run(t);
    const sentence = r.left.find((l) => l.startsWith('the startup job for the Kosmos board (Kosmos\\board), which Windows would not remove ('));
    assert.ok(sentence && sentence.includes('It is switched off now') && sentence.endsWith('Turn "Start Kosmos when I sign in to Windows" back on in Settings'), JSON.stringify(r.left));
  } finally { fs.rmSync(t.base, { recursive: true, force: true }); }
});

test('🛑 round 4 finding 3, real listeners: with the board task RUNNING, a first look that times out or fails is its busy board: switched off, ended and waited for; one that goes lets the removal run, one that stays changes nothing more and puts the switch back', WINDOWS_FOLDERS, async () => {
  for (const kind of ['not-http', 'hung']) {
    const stays = await listenerOn('127.0.0.1', kind);
    const s = sandbox();
    let clock = 0;
    try {
      const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml: boardDefinition(true), running: true });
      /* The clock jumps so the wait for the board ends after a couple of real 2s probes. */
      const r = await run(s, { deleteData: true, port: stays.port, probe: undefined, now: () => { clock += 6000; return clock; } });
      assert.equal(r.stillOpen, true, kind + ': ' + JSON.stringify(r));
      for (const c of ['board /Change /TN Kosmos\\board /DISABLE', 'board /End /TN Kosmos\\board']) assert.ok(calls.includes(c), kind + ': "' + c + '" was not issued: ' + calls.join(' | '));
      assert.equal(calls[calls.length - 1], 'board /Change /TN Kosmos\\board /ENABLE', kind + ': the switch was not put back');
      assert.ok(!calls.some((c) => /^job \/(Change|End|Delete)/.test(c)), kind + ': an agent task was touched');
      assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), kind + ': a folder went');
    } finally {
      await stays.close();
      fs.rmSync(s.base, { recursive: true, force: true });
    }

    const goes = await listenerOn('127.0.0.1', kind);
    const g = sandbox();
    try {
      const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml: boardDefinition(true), running: true, onBoardEnd: () => { goes.close(); } });
      const r = await run(g, { port: goes.port, probe: undefined });
      assert.equal(r.ok, true, kind + ': the busy board its task started, ended, did not let the removal run: ' + JSON.stringify(r));
      assert.ok(calls.includes('job /Delete /F /TN Kosmos\\agent-ava'));
      assert.ok(!fs.existsSync(g.runtimeDir));
    } finally {
      await goes.close();
      fs.rmSync(g.base, { recursive: true, force: true });
    }
  }
});

const COULD_NOT_TELL = 'Kosmos could not tell whether it is still open. Restart your computer, then remove Kosmos again.';

test('🛑 round 4 finding 3, real listeners: with the board task NOT proven running, a program that is not HTTP stops the removal with a sentence that names another program only when no board task is registered, one that never answers is still open, and an unreadable task keeps round 3\'s stop', WINDOWS_FOLDERS, async () => {
  const notHttp = await listenerOn('127.0.0.1', 'not-http');
  const hung = await listenerOn('127.0.0.1', 'hung');
  try {
    for (const [label, listener, boardXml, expected] of [
      /* Round 5, finding 5: no boardXml is the English not-found answer, a task known not to be registered. */
      ['a program that is not HTTP, no board task registered', notHttp, null, PORT_IN_USE(notHttp.port)],
      ['a program that is not HTTP, the board task registered and not proven running', notHttp, boardDefinition(true), COULD_NOT_TELL],
      ['a listener that never answers', hung, boardDefinition(true), uninstaller.KOSMOS_STILL_OPEN],
      ['a program that is not HTTP, the board task unreadable', notHttp, { ok: false, out: 'ERROR: The operation timed out.' }, uninstaller.KOSMOS_STILL_OPEN],
    ]) {
      const s = sandbox();
      try {
        const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml });
        const r = await run(s, { deleteData: true, port: listener.port, probe: undefined });
        assert.deepEqual(r.left, [expected], label + ': ' + JSON.stringify(r.left));
        assert.equal(r.ok, false, label);
        assert.ok(!calls.some((c) => /\/(Change|End|Delete)/.test(c)), label + ': a task was changed: ' + calls.join(' | '));
        assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), label + ': a folder went');
      } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
    }
    assert.ok(PORT_IN_USE(1).startsWith(handoff.cannotTellIfOpenSentence(1, { known: true, registered: false })), 'the uninstall words its port sentence apart from the move');
    assert.ok(COULD_NOT_TELL.startsWith(handoff.cannotTellIfOpenSentence(1, { known: true, registered: true, running: null })), 'the uninstall words its could-not-tell sentence apart from the move');
  } finally {
    await notHttp.close();
    await hung.close();
  }
});

/* ---- the round 5 review, fixed in round 6 ------------------------------------ */

test('🛑 round 5 finding 2, real listeners: the task\'s board on 127.0.0.1 does not hide a hand-started board on ::1 on the same port, so nothing is asked or changed (case C); the hand-started board alone stops it too (C2)', WINDOWS_FOLDERS, async (t) => {
  const taskBoard = await listenerOn('127.0.0.1', 'board', { startedByTask: '1' });
  const handBoard = taskBoard && await listenerOn('::1', 'board', { port: taskBoard.port });
  if (!taskBoard || !handBoard) {
    if (taskBoard) await taskBoard.close();
    t.skip('this machine cannot listen on 127.0.0.1 and ::1 on one port');
    return;
  }
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board']), listing([])], boardXml: boardDefinition(true), running: true, onBoardEnd: () => { taskBoard.close(); } });
    const r = await run(s, { deleteData: true, port: taskBoard.port, probe: undefined });
    assert.equal(r.stillOpen, true, JSON.stringify(r));
    assert.deepEqual(r.left, [uninstaller.KOSMOS_STILL_OPEN]);
    assert.deepEqual(calls, [], 'the task\'s board was switched off and ended while a board no task command can stop was open: ' + calls.join(' | '));
    assert.ok(fs.existsSync(s.runtimeDir) && fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')));
  } finally {
    await taskBoard.close();
    fs.rmSync(s.base, { recursive: true, force: true });
  }

  const c2 = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board']), listing([])], boardXml: boardDefinition(true), running: true });
    const r = await run(c2, { deleteData: true, port: handBoard.port, probe: undefined });
    assert.equal(r.stillOpen, true, 'C2: ' + JSON.stringify(r));
    assert.deepEqual(calls, [], 'C2: something was asked or changed');
  } finally {
    await handBoard.close();
    fs.rmSync(c2.base, { recursive: true, force: true });
  }
});

/** A link-local IPv6 address of this machine, zoned, that a board can listen on and be reached on, or null. */
async function reachableZonedLinkLocalBoard() {
  const candidates = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || [])
    .filter((i) => i.family === 'IPv6' && /^fe80:/i.test(i.address) && !i.internal)
    .map((i) => ({ name, address: i.address, zoned: i.address + '%' + i.scopeid })));
  for (const candidate of candidates) {
    const board = await listenerOn(candidate.zoned, 'board');
    if (!board) continue;
    /* Measured on this box: the Tailscale adapter's own link-local address times out even to itself. */
    if ((await handoff.probeBoard(board.port, candidate.zoned)).answering) return { ...candidate, board };
    await board.close();
  }
  return null;
}

test('🛑 round 5 finding 1, real listeners: a hand-started board on a ZONED link-local bind host stops the removal, chats kept (case E); the same board unzoned does too (E2)', WINDOWS_FOLDERS, async (t) => {
  const found = await reachableZonedLinkLocalBoard();
  if (!found) { t.skip('no link-local IPv6 address on this machine takes a connection from itself'); return; }
  try {
    const unzonedBoard = await listenerOn(found.address, 'board');
    const arms = [['zoned, ' + found.zoned, found.zoned, found.board]];
    if (unzonedBoard) arms.push(['unzoned (E2), ' + found.address, found.address, unzonedBoard]);
    else t.diagnostic('ARM NOT RUN: E2, this machine cannot listen on ' + found.address + ' without a zone');
    try {
      for (const [label, bindHost, board] of arms) {
        const s = sandbox();
        try {
          const calls = stubSchedulers({ lists: [listing([]), listing([]), listing([])] });
          const r = await run(s, { deleteData: true, port: board.port, probe: undefined, env: { ...s.env, KOSMOS_BIND_HOST: bindHost } });
          assert.equal(r.stillOpen, true, label + ': the removal ran under a board on the bind host: ' + JSON.stringify(r));
          assert.ok(fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), label + ': the chats were deleted');
          assert.ok(!calls.some((c) => /\/(Change|End|Delete)/.test(c)), label + ': a task was changed');
        } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
      }
    } finally {
      if (unzonedBoard) await unzonedBoard.close();
    }
  } finally {
    await found.board.close();
  }
});

test('🛑 round 5 finding 3: a bind host name that does not resolve, resolves elsewhere, or whose lookup fails adds nothing, so it does not block the removal (case F)', WINDOWS_FOLDERS, async () => {
  const gone = await listenerOn('127.0.0.1', 'hung');
  const closedPort = gone.port;
  await gone.close();
  for (const [label, bindHost, lookup] of [
    ['a name that does not resolve (real DNS)', 'kosmos-no-such-host.invalid', undefined],
    ['a name that resolves to another machine', 'board.example', async () => [{ address: '192.0.2.10', family: 4 }]],
    ['a name whose lookup fails', 'board.example', async () => { throw Object.assign(new Error('temporary failure in name resolution'), { code: 'EAI_AGAIN' }); }],
  ]) {
    const s = sandbox();
    try {
      stubSchedulers({ lists: [listing([]), listing([]), listing([])] });
      const r = await run(s, { port: closedPort, probe: undefined, lookup, env: { ...s.env, KOSMOS_BIND_HOST: bindHost } });
      assert.equal(r.ok, true, label + ': the removal was blocked by a bind host nothing can listen on: ' + JSON.stringify(r.left));
      assert.ok(!fs.existsSync(s.runtimeDir), label);
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

/* ---- the round 6 review, fixed in round 7 ------------------------------------ */

/**
 * One of this PC's own NON-loopback addresses (LAN, VPN, or link-local with its zone) that a board can listen
 * on and be reached on through the every-address look, and where a closed port is refused within the
 * look's connect limit. IPv4 first. Null when there is none. Measured on this PC: those refusals take about
 * 2 s, where loopback's take 1-2 ms.
 */
let ownNonLoopbackAddressFound;
function ownNonLoopbackAddress() {
  if (!ownNonLoopbackAddressFound) {
    ownNonLoopbackAddressFound = (async () => {
      const candidates = Object.values(os.networkInterfaces()).flat()
        .filter((i) => i && !i.internal)
        .sort((a, b) => (a.family === b.family ? 0 : a.family === 'IPv4' ? -1 : 1))
        .map((i) => (i.family === 'IPv6' && /^fe80:/i.test(i.address) ? i.address + '%' + i.scopeid : i.address));
      /* The helper's own looks, with an explicit 5 s connect limit and a port closed without ever being probed,
         so a control that changes the every-address look cannot make the helper find nothing (and the test
         skip) instead of the test going red. */
      const LOOK = { connectTimeoutMs: 5000 };
      for (const address of candidates) {
        const board = await listenerOn(address, 'board');
        if (!board) continue;
        const reached = await handoff.probeBoard(board.port, address, LOOK);
        await board.close();
        if (!reached.answering) continue;
        const gone = await listenerOn(address, 'hung');
        const closedPort = gone.port;
        await gone.close();
        const startedAt = Date.now();
        const closed = await handoff.probeBoard(closedPort, address, LOOK);
        if (closed.outcome === handoff.PROBE_OUTCOMES.REFUSED) return { address, refusedAfterMs: Date.now() - startedAt };
      }
      return null;
    })();
  }
  return ownNonLoopbackAddressFound;
}

test('🛑 round 6 finding 1, real listeners: KOSMOS_BIND_HOST set to this PC\'s own non-loopback address. Nothing listening lets the removal run (A); the task\'s board serving there, gone on /End, lets it run (B); a listener there that never answers still stops it', WINDOWS_FOLDERS, async (t) => {
  const own = await ownNonLoopbackAddress();
  if (!own) { t.skip('this PC has no non-loopback address that takes its own connections and refuses a closed port within the connect limit'); return; }
  t.diagnostic('using ' + own.address + ': a closed port there was refused after ' + own.refusedAfterMs + ' ms');
  const bindHostEnv = (s) => ({ ...s.env, KOSMOS_BIND_HOST: own.address });

  const gone = await listenerOn(own.address, 'hung');
  const closedPort = gone.port;
  await gone.close();
  const a = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([]), listing([])], boardXml: boardDefinition(true) });
    const r = await run(a, { port: closedPort, probe: undefined, env: bindHostEnv(a) });
    assert.equal(r.ok, true, 'A: nothing listening on this PC\'s own address read as Kosmos still open: ' + JSON.stringify(r.left));
    assert.ok(!fs.existsSync(a.runtimeDir), 'A');
  } finally { fs.rmSync(a.base, { recursive: true, force: true }); }

  /* A, by host name: every address the name resolves to that is this PC's own is looked on. Run only when each
     of them refuses a closed port in time; an adapter that does not take its own connections (measured: the
     Tailscale adapter's link-local address) still reads as possibly open, which is fail closed. */
  const byName = await handoff.probeBoardOnEveryAddress(closedPort, { KOSMOS_BIND_HOST: os.hostname() });
  if (byName.outcome !== handoff.PROBE_OUTCOMES.REFUSED) {
    t.diagnostic('ARM NOT RUN: A by host name, ' + os.hostname() + ' resolves to ' + byName.host + ', which gave ' + byName.outcome);
  } else {
    const n = sandbox();
    try {
      stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([]), listing([])], boardXml: boardDefinition(true) });
      const r = await run(n, { port: closedPort, probe: undefined, env: { ...n.env, KOSMOS_BIND_HOST: os.hostname() } });
      assert.equal(r.ok, true, 'A by host name: nothing listening read as Kosmos still open: ' + JSON.stringify(r.left));
    } finally { fs.rmSync(n.base, { recursive: true, force: true }); }
  }

  const taskBoard = await listenerOn(own.address, 'board', { startedByTask: '1' });
  const b = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([]), listing([])], boardXml: boardDefinition(true), running: true, onBoardEnd: () => { taskBoard.close(); } });
    const r = await run(b, { port: taskBoard.port, probe: undefined, env: bindHostEnv(b) });
    assert.equal(r.ok, true, 'B: the task\'s board that went on /End kept reading open: ' + JSON.stringify(r));
    for (const c of ['board /Change /TN Kosmos\\board /DISABLE', 'board /End /TN Kosmos\\board', 'job /Delete /F /TN Kosmos\\agent-ava']) assert.ok(calls.includes(c), 'B: "' + c + '" was not issued');
    assert.ok(!calls.includes('board /Change /TN Kosmos\\board /ENABLE'), 'B: the switch was put back, so the removal stopped');
  } finally {
    await taskBoard.close();
    fs.rmSync(b.base, { recursive: true, force: true });
  }

  const hung = await listenerOn(own.address, 'hung');
  const h = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml: boardDefinition(true) });
    const r = await run(h, { deleteData: true, port: hung.port, probe: undefined, env: bindHostEnv(h) });
    assert.deepEqual(r.left, [uninstaller.KOSMOS_STILL_OPEN], 'a listener there that never answers: ' + JSON.stringify(r.left));
    assert.ok(!calls.some((c) => /\/(Change|End|Delete)/.test(c)), 'a task was changed');
    assert.ok(fs.existsSync(h.runtimeDir) && fs.existsSync(path.join(h.dataDir, 'chats', 'ava.jsonl')), 'a folder went');
  } finally {
    await hung.close();
    fs.rmSync(h.base, { recursive: true, force: true });
  }
});

test('🛑 round 6 finding 1: a connection not made in time counts as unanswered, like a timeout: still open at the first look, and waited through after /End', WINDOWS_FOLDERS, async () => {
  const CONNECT_TIMED_OUT = { answering: false, outcome: handoff.PROBE_OUTCOMES.CONNECT_TIMED_OUT, identity: null, startedByTask: null };
  const s = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml: boardDefinition(true) });
    const r = await run(s, { deleteData: true, probe: async () => CONNECT_TIMED_OUT });
    assert.deepEqual(r.left, [uninstaller.KOSMOS_STILL_OPEN], JSON.stringify(r.left));
    assert.ok(!calls.some((c) => /\/(Change|End|Delete)/.test(c)));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }

  const w = sandbox();
  try {
    const calls = stubSchedulers({ lists: [listing(['Kosmos\\board', 'Kosmos\\agent-ava']), listing([])], boardXml: boardDefinition(true) });
    const r = await run(w, { deleteData: true, probe: probeSequence(TASK_BOARD, CONNECT_TIMED_OUT) });
    assert.equal(r.stillOpen, true, JSON.stringify(r));
    assert.equal(calls[calls.length - 1], 'board /Change /TN Kosmos\\board /ENABLE');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('🛑 round 6 finding 1: the wait for an ended board allows at least two whole looks when every look takes the longest it can', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    stubSchedulers({ lists: [listing(['Kosmos\\board']), listing([])], boardXml: boardDefinition(false) });
    let clock = 0;
    const answers = probeSequence(TASK_BOARD, TIMED_OUT);
    const r = await run(s, {
      probe: async (port) => { clock += handoff.EVERY_ADDRESS_LOOK_WORST_MS; return answers(port); },
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
    });
    assert.equal(r.stillOpen, true, JSON.stringify(r));
    assert.ok(answers.count() >= 1 + 2, 'the wait gave up after ' + (answers.count() - 1) + ' look(s) of ' + handoff.EVERY_ADDRESS_LOOK_WORST_MS + ' ms each');
    assert.equal(uninstaller.BOARD_GONE_CLOCK_MS, Math.max(uninstaller.BOARD_GONE_WAIT_MS, 2 * (handoff.EVERY_ADDRESS_LOOK_WORST_MS + uninstaller.FOLDER_DELETE_WAIT_MS)));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});
