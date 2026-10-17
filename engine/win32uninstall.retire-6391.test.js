'use strict';
/**
 * #6391: uninstalling a paired Windows PC with "also delete data" used to delete the Kosmos+ key
 * in `<dataDir>\remote` WITHOUT first retiring the computer at the coordinator, so its address
 * stayed on the account with no key left to sign the retire. engine/win32uninstall.js now runs the
 * connector's `retire` verb first, best-effort, like the Mac uninstall (install/setup.sh, #793).
 *
 * TWO LAYERS of test here, and they run in different places:
 *
 *  1. retirePc() unit tests — PORTABLE. They inject spawnSync/existsSync, touch no folder, and run
 *     on every platform (Mac CI included). They are where "retired / timed out / failed / no
 *     connector" is actually EXERCISED with executing assertions.
 *
 *  2. uninstall() integration tests — WINDOWS-ONLY (the `WINDOWS_FOLDERS` gate), exactly like every
 *     other folder arm in win32uninstall.test.js: uninstall joins its data folder with Windows'
 *     rules (`store.dataRootFor('win32', ...)`), so the folder only exists as a nested dir on
 *     Windows. These prove the WIRING (retire runs before the delete, the right sentence, no key =
 *     silence, keeping data = no retire). On a Mac they are reported skipped, not failed.
 *
 *   node --test engine/win32uninstall.retire-6391.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const win32job = require('./win32job');
const win32board = require('./win32board');
const worlds = require('./worlds');
const uninstaller = require('./win32uninstall');

// ---- 1. retirePc() — portable, runs everywhere -----------------------------------------------

test('#6391 retirePc: exit 0 means told, and the connector is asked with retire + state-dir + coordinator', () => {
  const calls = [];
  const spawnSync = (bin, args, opts) => { calls.push({ bin, args, opts }); return { status: 0, error: null, signal: null }; };
  const out = uninstaller.retirePc({
    remoteDir: 'D:\\data\\remote', coordinator: 'https://coord.example',
    tunnelBin: 'C:\\app\\bin\\kosmos-tunnel.exe', existsSync: () => true, spawnSync,
  });
  assert.deepEqual(out, { told: true });
  assert.equal(calls.length, 1, 'the connector was not asked exactly once');
  assert.equal(calls[0].bin, 'C:\\app\\bin\\kosmos-tunnel.exe');
  assert.deepEqual(calls[0].args, ['retire', '--state-dir', 'D:\\data\\remote', '--coordinator', 'https://coord.example']);
  assert.equal(calls[0].opts.windowsHide, true, 'the console child must be hidden (no black window flash)');
  assert.equal(calls[0].opts.shell, undefined, 'no shell: argv must reach CreateProcess unparsed');
  assert.ok(Number.isFinite(calls[0].opts.timeout) && calls[0].opts.timeout > 0, 'a short timeout must be set');
});

test('#6391 retirePc: a timeout (ETIMEDOUT + a kill signal) is NOT told', () => {
  const spawnSync = () => ({ status: null, signal: 'SIGTERM', error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) });
  assert.deepEqual(uninstaller.retirePc({ remoteDir: 'r', coordinator: 'c', tunnelBin: 't', existsSync: () => true, spawnSync }), { told: false });
});

test('#6391 retirePc: a non-zero exit is NOT told', () => {
  const spawnSync = () => ({ status: 1, signal: null, error: null });
  assert.deepEqual(uninstaller.retirePc({ remoteDir: 'r', coordinator: 'c', tunnelBin: 't', existsSync: () => true, spawnSync }), { told: false });
});

test('#6391 retirePc: with no connector on disk, nothing is spawned and it is NOT told', () => {
  let spawned = false;
  const out = uninstaller.retirePc({ remoteDir: 'r', coordinator: 'c', tunnelBin: 't', existsSync: () => false, spawnSync: () => { spawned = true; return { status: 0 }; } });
  assert.deepEqual(out, { told: false });
  assert.equal(spawned, false, 'the connector was spawned although it is not on disk');
});

test('#6391 retirePc: a spawn that throws is swallowed into NOT told (never propagates out of an uninstall)', () => {
  const spawnSync = () => { throw new Error('EACCES'); };
  assert.deepEqual(uninstaller.retirePc({ remoteDir: 'r', coordinator: 'c', tunnelBin: 't', existsSync: () => true, spawnSync }), { told: false });
});

// ---- 2. uninstall() wiring — Windows-only (folder arms), like win32uninstall.test.js ----------

const WINDOWS_FOLDERS = { skip: process.platform !== 'win32' && 'the data folder is a Windows-joined path, a nested folder only on Windows' };
const PORT = 9;
const NOBODY_ANSWERING = async () => ({ answering: false, outcome: 'refused', identity: null, startedByTask: null });

const row = (taskPath) => '"\\' + taskPath + '","N/A","Ready"';
const listing = (paths) => ({ ok: true, out: [row('Microsoft\\Windows\\Defrag\\ScheduledDefrag'), ...paths.map(row)].join('\r\n') + '\r\n' });
const NOT_FOUND = { ok: false, out: 'ERROR: The system cannot find the file specified.' };

/* No Kosmos tasks and no board task: everyTaskGone and boardGone are both true, so the data arm runs. */
function noTasks() {
  const lists = [listing([]), listing([])];
  let listed = 0;
  const answer = (args) => {
    if (args[0] === '/Query' && !args.includes('/TN')) { const l = lists[Math.min(listed, lists.length - 1)]; listed += 1; return l; }
    if (args[0] === '/Query') return NOT_FOUND;
    return { ok: true, out: 'SUCCESS' };
  };
  win32job.setRunner((args) => answer(args));
  win32board.setRunner((args) => answer(args));
}

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-retire-'));
  const s = {
    base, home: path.join(base, 'Users', 'someone'),
    env: { APPDATA: path.join(base, 'Roaming'), LOCALAPPDATA: path.join(base, 'Local'), USERNAME: 'someone', USERDOMAIN: 'BOX' },
  };
  s.runtimeDir = path.join(s.env.LOCALAPPDATA, 'Kosmos');
  s.dataDir = path.join(s.env.APPDATA, 'Kosmos');
  s.remoteDir = path.join(s.dataDir, 'remote');
  s.projectsRoot = path.join(s.home, 'Kosmos', 'Projects');
  fs.mkdirSync(path.join(s.runtimeDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(s.runtimeDir, 'runtime', 'engine-path'), 'C:\\somewhere\\app\\engine');
  fs.mkdirSync(path.join(s.dataDir, 'chats'), { recursive: true });
  fs.writeFileSync(path.join(s.dataDir, 'chats', 'ava.jsonl'), '{"said":"hello"}\n');
  return s;
}
/* The Plus key: holdsKey() reads mac_id + mac_key, so both must be present to count as "held". */
function withKey(s, which) {
  fs.mkdirSync(s.remoteDir, { recursive: true });
  for (const f of which || ['mac_id', 'mac_key', 'coordinator_pubkey']) fs.writeFileSync(path.join(s.remoteDir, f), 'fake');
}

function run(s, extra) {
  return uninstaller.uninstall({
    platform: 'win32', env: s.env, home: s.home, projectsRoot: s.projectsRoot, port: PORT, probe: NOBODY_ANSWERING,
    removeFolder: (dir) => fs.rmSync(dir, { recursive: true, force: true }), sleep: async () => {},
    liveExecutionAllowed: () => true, coordinator: 'https://coord.example',
    ...extra,
  });
}

test('#6391 a paired PC is retired at the coordinator BEFORE its key is deleted, and the summary names Kosmos+', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    noTasks(); withKey(s);
    const seen = [];
    const retirePc = (o) => {
      seen.push({ remoteDir: o.remoteDir, coordinator: o.coordinator, keyStillThere: fs.existsSync(path.join(o.remoteDir, 'mac_key')) });
      return { told: true };
    };
    const r = await run(s, { deleteData: true, retirePc });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.equal(seen.length, 1, 'retire was not attempted exactly once');
    assert.equal(seen[0].remoteDir, s.remoteDir, 'retire was pointed at the wrong state dir');
    assert.equal(seen[0].coordinator, 'https://coord.example');
    assert.equal(seen[0].keyStillThere, true, 'ORDERING: retire ran after the key was already deleted');
    assert.ok(r.done.some((d) => /Kosmos\+ address is retired/.test(d)), JSON.stringify(r.done));
    assert.ok(!fs.existsSync(s.remoteDir), 'the Plus key was not deleted after the retire');
    assert.ok(!r.notes.some((n) => /could not tell/.test(n)));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#6391 when the coordinator cannot be told, the summary says the Kosmos+ address may still show, and the data is STILL deleted', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    noTasks(); withKey(s);
    const r = await run(s, { deleteData: true, retirePc: () => ({ told: false }) });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.ok(r.notes.some((n) => /could not tell the Kosmos\+ service.*account page/.test(n)), JSON.stringify(r.notes));
    assert.ok(!r.done.some((d) => /retired/.test(d)), 'it claimed a retire that did not happen');
    assert.ok(!fs.existsSync(s.remoteDir), 'the data folder must still be deleted even when retire failed');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#6391 a PC that never held a Kosmos+ key is not retired and the summary never mentions Kosmos+', WINDOWS_FOLDERS, async () => {
  for (const held of [null, ['mac_id'], ['mac_key']]) {   // none, or only half the pair: not "held"
    const s = sandbox();
    try {
      noTasks();
      if (held) withKey(s, held);
      let called = false;
      const r = await run(s, { deleteData: true, retirePc: () => { called = true; return { told: true }; } });
      assert.equal(r.ok, true, JSON.stringify(r.left));
      assert.equal(called, false, 'retire was attempted with no full key present (' + JSON.stringify(held) + ')');
      assert.ok(!fs.existsSync(path.join(s.dataDir, 'chats', 'ava.jsonl')), 'the data was not deleted');
      const allText = [...r.done, ...r.notes, ...r.left].join('\n');
      assert.ok(!/Kosmos\+/.test(allText), 'Kosmos+ was named with no key (' + JSON.stringify(held) + '): ' + allText);
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

test('#6391 keeping the data (no second yes) keeps the Kosmos+ key and does NOT retire', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    noTasks(); withKey(s);
    let called = false;
    await run(s, { deleteData: false, retirePc: () => { called = true; return { told: true }; } });
    assert.equal(called, false, 'retire was attempted while keeping the data');
    assert.ok(fs.existsSync(path.join(s.remoteDir, 'mac_key')), 'the Plus key was deleted while keeping the data');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#6391 when the data delete is refused, the key is kept and the PC is NOT retired (never strand a key that survives)', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    noTasks(); withKey(s);
    fs.writeFileSync(worlds.registryPath(s.dataDir), 'not valid json');   // kept.known === false -> delete refused
    let called = false;
    const r = await run(s, { deleteData: true, retirePc: () => { called = true; return { told: true }; } });
    assert.equal(called, false, 'retire was attempted even though the delete was refused');
    assert.ok(r.left.some((l) => /kept because the list of your Kosmoses/.test(l)), JSON.stringify(r.left));
    assert.ok(fs.existsSync(path.join(s.remoteDir, 'mac_key')), 'the key was taken although the delete was refused');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});
