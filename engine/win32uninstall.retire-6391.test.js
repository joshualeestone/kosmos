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
  assert.deepEqual(calls[0].args, ['retire', '--coordinator', 'https://coord.example', '--state-dir', 'D:\\data\\remote']);
  assert.equal(calls[0].opts.windowsHide, true, 'the console child must be hidden (no black window flash)');
  assert.equal(calls[0].opts.shell, undefined, 'no shell: argv must reach CreateProcess unparsed');
  assert.ok(Number.isFinite(calls[0].opts.timeout) && calls[0].opts.timeout > 0, 'a positive timeout must be set');
});

// The told:false condition ORs r.error / r.signal / r.status!==0, so each branch is isolated
// here: a fixture that set all three at once could pass even if the code checked only one.
test('#6391 retirePc: a spawn error alone (r.error, no signal, no status) is NOT told', () => {
  const spawnSync = () => ({ status: null, signal: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) });
  assert.deepEqual(uninstaller.retirePc({ remoteDir: 'r', coordinator: 'c', tunnelBin: 't', existsSync: () => true, spawnSync }), { told: false });
});

test('#6391 retirePc: a kill signal alone (r.signal, no error, no status) is NOT told', () => {
  const spawnSync = () => ({ status: null, signal: 'SIGTERM', error: null });
  assert.deepEqual(uninstaller.retirePc({ remoteDir: 'r', coordinator: 'c', tunnelBin: 't', existsSync: () => true, spawnSync }), { told: false });
});

test('#6391 retirePc: a null status with neither error nor signal is NOT told (status !== 0)', () => {
  const spawnSync = () => ({ status: null, signal: null, error: null });
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

test('#6391 retirePc: the default timeout is the generous RETIRE_TIMEOUT_MS, and o.timeoutMs overrides it', () => {
  // Regression guard for the 8s-too-short finding: the bound must stay in the product's range
  // (remote.js retires the same verb at 60s), never back down near 8s.
  assert.ok(uninstaller.RETIRE_TIMEOUT_MS >= 30000, 'RETIRE_TIMEOUT_MS regressed below 30s: ' + uninstaller.RETIRE_TIMEOUT_MS);
  let seenTimeout;
  const spawnSync = (_bin, _args, opts) => { seenTimeout = opts.timeout; return { status: 0 }; };
  uninstaller.retirePc({ remoteDir: 'r', coordinator: 'c', tunnelBin: 't', existsSync: () => true, spawnSync });
  assert.equal(seenTimeout, uninstaller.RETIRE_TIMEOUT_MS, 'default timeout not wired to RETIRE_TIMEOUT_MS');
  uninstaller.retirePc({ remoteDir: 'r', coordinator: 'c', tunnelBin: 't', timeoutMs: 1234, existsSync: () => true, spawnSync });
  assert.equal(seenTimeout, 1234, 'o.timeoutMs did not override the default');
});

test('#6391 pin (convention 5): win32uninstall defaults equal remote.js, so neither drifts silently', () => {
  // Production inlines these constants to avoid loading remote.js's exit/signal handlers into the
  // short-lived uninstaller; this pin is what keeps the inline honest. remote.js owns the canonical
  // values, and a change there without a matching change here fails this test. (A test may freely
  // require remote.js — the side-effect concern is only about the production uninstaller process.)
  const remote = require('./remote');
  assert.equal(uninstaller.DEFAULT_COORDINATOR, remote.DEFAULT_COORDINATOR, 'coordinator default drifted from remote.js');
  assert.equal(uninstaller.CONNECTOR_EXE, remote.connectorFile('win32'), 'connector filename drifted from remote.js connectorFile(win32)');
});

test('#6391 defaultTunnelBin resolves <app>/bin/<connector> (the default connector path)', () => {
  const p = uninstaller.defaultTunnelBin();
  assert.equal(path.basename(p), uninstaller.CONNECTOR_EXE);
  assert.equal(path.basename(path.dirname(p)), 'bin', 'connector is not under <app>\\bin');
});

test('#6391 source order: the retire call precedes deleteAllExcept in uninstall() (portable backstop)', () => {
  // The Windows-only wiring tests below prove ordering by execution, but they skip on Mac CI, so a
  // mistaken move of the retire block BELOW the delete would stay green everywhere else. This static
  // guard is a best-effort portable backstop for exactly that: it catches a wholesale move of the
  // retire call below the delete, or a rename of either anchor (both fail the test). It is a
  // heuristic, not a proof — it would not catch a retire planted inside a dead branch, or the same
  // text duplicated in a comment above the real call; the Windows wiring tests cover live behaviour.
  const src = fs.readFileSync(require.resolve('./win32uninstall.js'), 'utf8');
  // Anchor on the retire INVOCATION itself (robust to call-site wrapping like `(retire(...) || {})`),
  // and on the delete call. If either is renamed, update both.
  const retireAt = src.indexOf('retire({ remoteDir, coordinator, tunnelBin');
  const deleteAt = src.indexOf('const failures = deleteAllExcept(dataDir, keptDirs, rm)');
  assert.ok(retireAt !== -1, 'retire call site not found (renamed?) — update this guard');
  assert.ok(deleteAt !== -1, 'deleteAllExcept call site not found (renamed?) — update this guard');
  assert.ok(retireAt < deleteAt, 'the retire call moved BELOW deleteAllExcept — the key would be deleted before it is retired');
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

test('#6391 the env overrides (TUNNEL_BIN, RETIRE_TIMEOUT_MS) reach the retire', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    noTasks(); withKey(s);
    s.env.AGENT_WORKFORCE_TUNNEL_BIN = 'C:\\custom\\kosmos-tunnel.exe';
    s.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '45000';
    let seen = null;
    const r = await run(s, { deleteData: true, retirePc: (o) => { seen = { tunnelBin: o.tunnelBin, timeoutMs: o.timeoutMs }; return { told: true }; } });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.equal(seen.tunnelBin, 'C:\\custom\\kosmos-tunnel.exe', 'AGENT_WORKFORCE_TUNNEL_BIN was ignored');
    assert.equal(seen.timeoutMs, 45000, 'AGENT_WORKFORCE_RETIRE_TIMEOUT_MS was ignored');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#6391 with no coordinator/tunnelBin injected and no env override, uninstall() passes the inline defaults to the retire', WINDOWS_FOLDERS, async () => {
  const s = sandbox();
  try {
    noTasks(); withKey(s);
    delete s.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;
    delete s.env.AGENT_WORKFORCE_TUNNEL_BIN;
    let seen = null;
    // Call uninstall() directly so coordinator/tunnelBin are genuinely absent (run() injects coordinator).
    const r = await uninstaller.uninstall({
      platform: 'win32', env: s.env, home: s.home, projectsRoot: s.projectsRoot, port: PORT, probe: NOBODY_ANSWERING,
      removeFolder: (dir) => fs.rmSync(dir, { recursive: true, force: true }), sleep: async () => {},
      liveExecutionAllowed: () => true, deleteData: true,
      retirePc: (o) => { seen = { coordinator: o.coordinator, tunnelBin: o.tunnelBin }; return { told: true }; },
    });
    assert.equal(r.ok, true, JSON.stringify(r.left));
    assert.equal(seen.coordinator, uninstaller.DEFAULT_COORDINATOR, 'default coordinator not used');
    assert.equal(seen.tunnelBin, uninstaller.defaultTunnelBin(), 'default tunnelBin not used');
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
