'use strict';
/**
 * #4382, the Windows half: a computer that connects to agents on another computer updates, and rolls
 * back, with no board (engine/win32connectupdate.js).
 *
 *   node --test engine/win32connectupdate.test.js
 *
 * Each case is a sandboxed Kosmos folder at the running version whose board is stopped (the connect computer's state
 * after #4381's stop), a release host served by an injected fetch, and Task Scheduler played by a stub
 * (win32board.setRunner). The parts under test are the real ones end to end: update-ifnewer's look and
 * consent, win32update.begin()/rollbackToPrevious() with their B0, download, checks and journal, the
 * helper (win32apply.applyJournal, run in this process where production spawns it detached) with its
 * OWN mode reader, and waitForOutcome reading the status the helper wrote. The mode file is the sandbox's
 * %LOCALAPPDATA%\Kosmos\mode, read by the real readers.
 *
 * Windows only: the mode file's path is a win32 path (win32apply.computerModePath), which on macOS is one
 * relative file name in the cwd (#4695). tools/windows-tests.js runs this file on the Windows job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-w32connectupd-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.APPDATA = path.join(SANDBOX, 'appdata');
/* The mode file, for every reader that defaults to process.env (the helper's mayStartBoard). */
process.env.LOCALAPPDATA = path.join(SANDBOX, 'localappdata');
delete process.env.KOSMOS_AGENT_SESSION;
delete process.env.KOSMOS_AGENT_TOKEN;

const update = require('./update');
const autoupdate = require('./autoupdate');
const win32anchor = require('./win32anchor');
const win32apply = require('./win32apply');
const win32board = require('./win32board');
const win32update = require('./win32update');
const connectUpdate = require('./win32connectupdate');
const { buildZip } = require('../test-support/zipfixture');
const { SIGNED_KOSMOS } = require('../test-support/signedkosmos');
const { TEST_KEYS, signedRelease } = require('../test-support/winreleasemanifest');

test.after(() => {
  win32board.setRunner(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
});

const ON_WINDOWS = process.platform === 'win32';
const T = { timeout: 30000, skip: !ON_WINDOWS && 'the mode file is a Windows path (#4695); the Windows job runs this file' };
const T_ANY = { timeout: 30000 };
const ARCH = 'x64';
/* The look compares with the version this engine runs as (update.RUNNING, its own package.json), as it does in a
   real bundle, where that IS the installed build: so the sandboxed Kosmos is at that version. */
const INSTALLED = update.RUNNING;
const NEXT = INSTALLED.split('.').map((p, i) => (i === 2 ? String(Number(p) + 5) : p)).join('.');
const NODE_VERSION = 'v24.19.0';
const BASE = 'https://updates.example.test/dist';
const README = '! READ ME FIRST - Windows will warn you.txt';
const PORT = 16180;
const MODE_FILE = path.join(process.env.LOCALAPPDATA, 'Kosmos', 'mode');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const versionIn = (dir) => readJson(path.join(dir, 'app', 'package.json')).version;

function setMode(bytes) {
  fs.rmSync(MODE_FILE, { force: true });
  if (bytes === null) return;
  fs.mkdirSync(path.dirname(MODE_FILE), { recursive: true });
  fs.writeFileSync(MODE_FILE, bytes);
}
function setConsent(on) {
  if (on === null) { fs.rmSync(autoupdate.FILE, { force: true }); return; }
  fs.mkdirSync(path.dirname(autoupdate.FILE), { recursive: true });
  fs.writeFileSync(autoupdate.FILE, JSON.stringify({ on }) + '\n');
}

/** The files of a Kosmos build, in the shape tools/build-kosmos-windows.sh stages (win32update's REQUIRED_ENTRIES). */
function bundleFiles(version, o = {}) {
  return {
    'Kosmos.exe': `MZ the launcher of ${version}`,
    'open-board.js': '// the browser opener',
    [README]: 'Windows will warn you',
    'manifest.json': JSON.stringify({
      product: 'kosmos', platform: 'win32', arch: ARCH, version, source_sha: 'abcdef0123456789abcdef0123456789abcdef01', source_dirty: false,
      signed: false, node: { version: NODE_VERSION, download_sha256: '0'.repeat(64) }, agents_supported: true,
    }),
    'runtime/node.exe': `the node.exe of ${version}`,
    'app/server.js': '// the server\n'.repeat(40),
    'app/package.json': JSON.stringify({ name: 'agent-workforce', version }),
    'app/web/index.html': '<!doctype html><title>Kosmos</title>\n'.repeat(40),
    'app/engine/kosmos-report-hook.js': '// the report hook',
    'app/engine/win32apply.js': '// the updater',
    'app/engine/win32update.js': '// the updater entry',
    ...(o.connectReady === false ? {} : { 'app/engine/win32connectupdate.js': '// the connect computer update (4382)' }),
    'bin/kosmos-cli.js': '// the kosmos command',
    'bin/kosmos.ps1': '# the PowerShell shim',
    'bin/kosmos': '#!/bin/sh',
  };
}
function writeTree(dir, files) {
  for (const [name, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
  }
}
function bundleZip(version) {
  const entries = [{ name: 'app/' }, { name: 'app/engine/' }, { name: 'bin/' }, { name: 'runtime/' }];
  for (const [name, data] of Object.entries(bundleFiles(version))) entries.push({ name, data, method: 8 });
  return buildZip(entries);
}

let caseCount = 0;
/** A whole Kosmos at INSTALLED, its anchor pointing at it, a person's project inside it, and its board STOPPED. */
function freshCase(o = {}) {
  caseCount += 1;
  const dir = path.join(SANDBOX, 'cases', String(caseCount));
  const root = path.join(dir, 'Kosmos');
  const env = { AGENT_WORKFORCE_DATA: path.join(dir, 'machine'), LOCALAPPDATA: process.env.LOCALAPPDATA };
  writeTree(root, bundleFiles(INSTALLED, o));
  writeTree(root, { 'Projects/garden/notes.txt': "a person's own work" });
  const anchor = win32anchor.anchorDir(process.platform, os.homedir(), env);
  fs.mkdirSync(anchor, { recursive: true });
  fs.writeFileSync(path.join(anchor, win32anchor.NODE_NAME), `the node.exe of ${INSTALLED}`);
  fs.writeFileSync(path.join(anchor, win32anchor.POINTER_NAME), path.join(root, 'app', 'engine'));
  return { dir, root, env, anchor, log: [], spawned: [] };
}

/** The release host. Records every URL asked for. */
function site(version) {
  const zip = bundleZip(version);
  const versioned = `kosmos-${version}-win-${ARCH}.zip`;
  const pointer = { version, sha256: sha256(zip), artifact: `kosmos-win-${ARCH}.zip`, versioned, arch: ARCH };
  const urls = [];
  /* #6466: the release's signed manifest beside the zip, signed with the suites' key. */
  const release = signedRelease(zip, { version, arch: ARCH });
  const manifestFile = versioned.replace(/\.zip$/, '.manifest.json');
  const fetch = async (url) => {
    urls.push(String(url));
    const file = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if (file === manifestFile) return new Response(release.bytes);
    if (file === manifestFile + '.sig') return new Response(release.sig);
    if (file === 'latest-win.json') return new Response(JSON.stringify(pointer));
    if (file === `${versioned}.sha256`) return new Response(`${pointer.sha256}  ${versioned}\n`);
    if (file === versioned) return new Response(zip, { headers: { 'content-length': String(zip.length) } });
    return new Response('not here', { status: 404 });
  };
  return { fetch, urls };
}

/**
 * Task Scheduler and the port on a connect computer: the board is stopped, its task switched off. A /Run
 * would start it (the controls prove the stub can), so "the board stays stopped" is measured, not assumed.
 */
function stoppedBoard(c) {
  const sim = { running: false, calls: [] };
  win32board.setRunner((args) => {
    sim.calls.push(args.join(' '));
    if (args[0] === '/End') { sim.running = false; return { ok: true, out: 'SUCCESS: The scheduled task was terminated.' }; }
    if (args[0] === '/Run') { sim.running = true; return { ok: true, out: 'SUCCESS: Attempted to run the scheduled task.' }; }
    return { ok: false, out: 'the stub scheduler does not know ' + args[0] };
  });
  let clock = 1_000_000;
  sim.probe = async () => (sim.running ? { answering: true, identity: `${versionIn(c.root)}@default`, startedByTask: true } : { answering: false, identity: null });
  sim.deps = () => ({
    probe: sim.probe,
    portFree: async () => !sim.running,
    pidGone: () => true,
    sleep: async (ms) => { clock += ms; },
    sleepSync: (ms) => { clock += ms; },
    now: () => clock,
    log: (line) => c.log.push(line),
  });
  return sim;
}

/**
 * The run's seams: the real look (update.js on win32 with this case's bundle root and release host), the
 * real begin()/rollbackToPrevious() with this case's sandbox, and a spawn that runs the real helper here.
 */
function seamsFor(c, s, sim) {
  update.resetCache();
  update.setPlatform('win32');
  update.setBase(BASE);
  update.setWindowsBundleRoot(() => c.root);
  update.setFetcher(s ? s.fetch : async () => { throw new Error('this case must not reach the network'); });
  let pending = null;
  return {
    port: PORT,
    /* The opt-in cliMain's --yes gives; run() itself defaults to the live-execution gate. */
    liveExecutionAllowed: () => true,
    env: c.env,
    probe: sim.probe,
    helperOptions: {
      platform: 'win32', arch: ARCH, base: BASE, channel: 'prod', world: 'default',
      fetch: s ? s.fetch : async () => { throw new Error('this case must not reach the network'); },
      freeBytes: () => 64 * 1024 * 1024 * 1024,
      runStagedNode: () => NODE_VERSION + '\n',
      /* #1765: the staged Kosmos.exe here is a stub; Windows' answer for a published build stands in for it. */
      checkSignature: () => SIGNED_KOSMOS,
      /* #6466: the suites' release key, which site() signs with. */
      manifestKeys: TEST_KEYS,
      log: (line) => c.log.push(line),
      /* Production starts the helper detached with the anchored node.exe; here it runs in this process, with
         no mayStartBoard seam, so the helper's own mode reader decides whether a board is started. */
      spawn: (file, args) => {
        c.spawned.push({ file, args });
        pending = win32apply.applyJournal(args[2], sim.deps());
        return { pid: 4242, on() {}, unref() {} };
      },
    },
    wait: { sleep: async () => { await pending; }, waitMs: 60000 },
  };
}

test.beforeEach(() => { setMode(null); setConsent(null); });

test('#4382: updates off: a connect computer with no board is OFFERED the newer build, and nothing is downloaded, staged or started', T, async () => {
  setMode('connect\n');
  setConsent(false);
  const c = freshCase();
  const s = site(NEXT);
  const sim = stoppedBoard(c);
  const r = await connectUpdate.run('look', seamsFor(c, s, sim));
  assert.deepEqual(r.answer, ['newer', NEXT], c.log.join('\n'));
  assert.deepEqual(s.urls, [`${BASE}/latest-win.json`], 'only the pointer was read');
  assert.equal(fs.existsSync(path.join(c.root, win32update.WORK_DIRNAME)), false, 'nothing was staged');
  assert.deepEqual(c.spawned, [], 'no helper was started');
  assert.deepEqual(sim.calls, [], 'Task Scheduler was never asked');
  assert.equal(versionIn(c.root), INSTALLED);
});

test('#4382: updates on: a connect computer with no board installs the newer build, and its board stays stopped', T, async () => {
  setMode('connect\n');
  setConsent(true);
  const c = freshCase();
  const sim = stoppedBoard(c);
  const r = await connectUpdate.run('look', seamsFor(c, site(NEXT), sim));
  assert.deepEqual(r.answer, ['updated', NEXT], c.log.join('\n'));
  assert.equal(c.spawned.length, 1, 'the one helper the board\'s Update button starts');
  assert.equal(path.basename(c.spawned[0].file), win32anchor.NODE_NAME);
  assert.equal(versionIn(c.root), NEXT, 'ROOT holds the new build');
  assert.equal(fs.readFileSync(path.join(c.root, 'Projects', 'garden', 'notes.txt'), 'utf8'), "a person's own work");
  assert.deepEqual(sim.calls, [], 'with no board to stop, Task Scheduler is never asked: no /End (its "not running" is read only in English) and never /Run');
  assert.equal(sim.running, false, 'no board runs after the update');
  const j = readJson(win32apply.journalPathFor(c.anchor));
  assert.equal(j.outcome, 'updated');
  assert.equal(j.board.pid, null, 'no board was named to stop');
  assert.ok(j.steps.some((st) => st.step === 'H7' && st.state === 'not-started' && st.because === 'connect'), 'the journal says why H7 started nothing');
  assert.equal(fs.readFileSync(MODE_FILE, 'utf8'), 'connect\n', 'the choice is untouched');
  assert.equal(r.rollback, INSTALLED, 'the build the update replaced is offered for rollback, as the board offers it');
});

test('#4382: the person picks Update with updates off: it installs, and the board stays stopped', T, async () => {
  setMode('connect\n');
  setConsent(false);
  const c = freshCase();
  const sim = stoppedBoard(c);
  /* The person picked "Update Kosmos to" a version that is no longer the newest: offered, not installed unseen. */
  const moved = await connectUpdate.run('install', { ...seamsFor(c, site(NEXT), sim), expect: INSTALLED });
  assert.deepEqual(moved.answer, ['newer', NEXT]);
  assert.match(moved.note, /not the .* that was picked/);
  assert.equal(versionIn(c.root), INSTALLED);
  const r = await connectUpdate.run('install', { ...seamsFor(c, site(NEXT), sim), expect: NEXT });
  assert.deepEqual(r.answer, ['updated', NEXT], c.log.join('\n'));
  assert.equal(versionIn(c.root), NEXT);
  assert.equal(sim.calls.some((call) => call.startsWith('/Run')), false);
  assert.equal(sim.running, false);
});

test('#4382: rollback is reachable with no board: the kept build comes back, and the board stays stopped', T, async () => {
  setMode('connect\n');
  setConsent(true);
  const c = freshCase();
  const sim = stoppedBoard(c);
  const up = await connectUpdate.run('look', seamsFor(c, site(NEXT), sim));
  assert.deepEqual(up.answer, ['updated', NEXT], c.log.join('\n'));
  assert.equal(up.rollback, INSTALLED);
  sim.calls.length = 0;
  /* The person agreed to one version; a different kept build is refused, and nothing moves. */
  const other = await connectUpdate.run('rollback', { ...seamsFor(c, null, sim), expect: '0.0.1' });
  assert.equal(other.answer[0], 'refused');
  assert.match(other.answer[1], /not the 0\.0\.1 you chose/);
  assert.equal(versionIn(c.root), NEXT);
  const back = await connectUpdate.run('rollback', { ...seamsFor(c, null, sim), expect: INSTALLED });
  assert.deepEqual(back.answer, ['rolledback', INSTALLED], c.log.join('\n'));
  assert.equal(versionIn(c.root), INSTALLED, 'ROOT holds the kept build again');
  assert.deepEqual(sim.calls, [], 'no /End and never /Run');
  assert.equal(sim.running, false);
  assert.equal(readJson(win32apply.journalPathFor(c.anchor)).rollback, true, 'the rollback journal, the same helper the Roll back button uses');
  /* With updates on (the default), the window's next look does not put back the version the person just
     rolled back from: it offers it. Picking Update installs it, and lets the hold go. */
  const after = await connectUpdate.run('look', seamsFor(c, site(NEXT), sim));
  assert.deepEqual(after.answer, ['newer', NEXT], 'the rollback was undone by the next automatic look');
  assert.match(after.note, /rolled back from on this computer/);
  assert.equal(versionIn(c.root), INSTALLED);
  const picked = await connectUpdate.run('install', seamsFor(c, site(NEXT), sim));
  assert.deepEqual(picked.answer, ['updated', NEXT], c.log.join('\n'));
  assert.equal(fs.existsSync(path.join(c.anchor, 'update-held.json')), false, 'an install the person picked lets the hold go');
});

test('#4382: the control: the same update held to the board-task rule is refused, which is what kept a connect computer from updating', T, async () => {
  setMode('connect\n');
  const c = freshCase();
  const sim = stoppedBoard(c);
  const seams = seamsFor(c, site(NEXT), sim);
  const r = await win32update.begin({
    ...seams.helperOptions, root: c.root, env: c.env, port: PORT, liveExecutionAllowed: () => true,
    boardTask: { startedByTask: () => false, status: () => ({ known: true, registered: true, enabled: false }) },
  });
  assert.equal(r.ok, false);
  assert.match(r.because, /was not started by its Windows logon job/);
  assert.deepEqual(c.spawned, []);
});

test('kosmos#6620: a new install waits out the fleet update pause, before anything is staged; CONTROL: not paused, it goes on', T, async () => {
  setMode('connect\n');
  const { PAUSED_SENTENCE } = require('./manifest-verify');
  const answer = (paused) => async () => ({ ok: true, text: async () => JSON.stringify({ updates_paused: paused }) });
  const c = freshCase();
  const sim = stoppedBoard(c);
  const seams = seamsFor(c, site(NEXT), sim);
  const env = { ...c.env, KOSMOS_UPDATE_PAUSE_URL: 'https://pause.invalid/v1/meta' };
  const held = await win32update.begin({ ...seams.helperOptions, root: c.root, env, port: PORT, liveExecutionAllowed: () => true, fetchImpl: answer(true) });
  assert.equal(held.ok, false);
  assert.equal(held.because, PAUSED_SENTENCE);
  assert.deepEqual(c.spawned, [], 'nothing was started during a pause');
  /* CONTROL: not paused, begin goes past the pause and on to the next check, the board-task rule, which this stub
     refuses (as the #4382 control above does), so nothing real is queried and the refusal proves the pause let it by. */
  const control = await win32update.begin({ ...seams.helperOptions, root: c.root, env, port: PORT, liveExecutionAllowed: () => true, fetchImpl: answer(false),
    boardTask: { startedByTask: () => false, status: () => ({ known: true, registered: true, enabled: false }) } });
  assert.equal(control.ok, false);
  assert.match(control.because, /was not started by its Windows logon job/, 'CONTROL: not paused, begin did not reach the next check');
  assert.deepEqual(c.spawned, []);
});

test('#4382: nothing is done on a computer that does not connect, while a board answers, or for an agent', T, async () => {
  setConsent(true);
  for (const [label, bytes] of [['no choice', null], ['run', 'run\n'], ['both', 'both\n'], ['a CRLF ending', 'connect\r\n'], ['a byte order mark', Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('connect')])]]) {
    setMode(bytes);
    const c = freshCase();
    const s = site(NEXT);
    const sim = stoppedBoard(c);
    const r = await connectUpdate.run('look', seamsFor(c, s, sim));
    assert.equal(r.answer[0], 'refused', label);
    assert.match(r.answer[1], /not set to connect/, label);
    assert.deepEqual(s.urls, [], `${label}: the release host was not asked`);
    assert.equal(versionIn(c.root), INSTALLED, label);
  }
  setMode('connect\n');
  {
    const c = freshCase();
    const s = site(NEXT);
    const sim = stoppedBoard(c);
    sim.running = true;
    const r = await connectUpdate.run('install', seamsFor(c, s, sim));
    assert.deepEqual(r.answer, ['board'], 'a running board updates itself');
    assert.deepEqual(s.urls, []);
    assert.deepEqual(c.spawned, []);
  }
  {
    const c = freshCase();
    const s = site(NEXT);
    const sim = stoppedBoard(c);
    const r = await connectUpdate.run('install', { ...seamsFor(c, s, sim), env: { ...c.env, KOSMOS_AGENT_SESSION: 'x' } });
    assert.equal(r.answer[0], 'refused');
    assert.match(r.answer[1], /an agent may not update Kosmos/);
    assert.deepEqual(s.urls, []);
  }
});

test('#4382: a newer download run on a connect computer (#3286, setup.ps1) is held to the connect rule, not the board task\'s', T, async () => {
  setMode('connect\n');
  const c = freshCase();
  const sim = stoppedBoard(c);
  const seams = seamsFor(c, site(NEXT), sim);
  const begun = [];
  const out = [];
  const code = await win32update.cliMain(['--apply', '--root', c.root, '--port', String(PORT), '--yes'], (t) => out.push(t), {
    probe: sim.probe,
    boardStatus: () => ({ known: true, registered: true, enabled: false }),
    readsConnect: () => win32apply.readsConnect(c.env),
    begin: { ...seams.helperOptions, env: c.env, home: os.homedir(), spawn: (file, args) => { begun.push(args); return { pid: 1, on() {}, unref() {} }; } },
  });
  assert.equal(code, 0, out.join(''));
  assert.equal(begun.length, 1, 'the helper was started');
  /* The control: the same run on a computer that does not connect meets the board-task rule. */
  setMode('run\n');
  const c2 = freshCase();
  const sim2 = stoppedBoard(c2);
  const out2 = [];
  const code2 = await win32update.cliMain(['--apply', '--root', c2.root, '--port', String(PORT), '--yes'], (t) => out2.push(t), {
    probe: sim2.probe,
    boardStatus: () => ({ known: true, registered: true, enabled: true }),
    readsConnect: () => win32apply.readsConnect(c2.env),
    begin: { ...seamsFor(c2, site(NEXT), sim2).helperOptions, env: c2.env, spawn: () => { throw new Error('must not start'); } },
  });
  assert.equal(code2, 1);
  assert.match(out2.join(''), /was not started by its Windows logon job/);
});

test('#4382: the report Kosmos.exe reads: the answer first, then the rollback offer; --yes is required', T_ANY, async () => {
  assert.deepEqual(connectUpdate.reportLines({ answer: ['updated', NEXT], rollback: INSTALLED }), [`updated ${NEXT}`, `rollback ${INSTALLED}`]);
  assert.deepEqual(connectUpdate.reportLines({ answer: ['board'], rollback: null }), ['board']);
  assert.deepEqual(connectUpdate.reportLines({ answer: ['failed', NEXT, 'it did not take'], rollback: null }), [`failed ${NEXT} it did not take`],
    'a failure leads with the version it was for, so Kosmos.exe can offer it again');
  assert.deepEqual(connectUpdate.reportLines({ answer: ['failed', 'a\tb\r\nc'], rollback: null }), ['failed a b c'], 'one line, whatever the reason holds');
  const said = [];
  assert.equal(await connectUpdate.cliMain(['--look'], (t) => said.push(t)), 2);
  assert.match(said.join(''), /add --yes/);
  assert.equal(await connectUpdate.cliMain(['--look', '--install', '--yes'], () => {}), 2, 'one action at a time');
  assert.deepEqual(connectUpdate.EXIT, { current: 0, newer: 0, updated: 0, rolledback: 0, board: 0, failed: 1, pending: 1, unknown: 1, refused: 3 });
});

test('#4382: a status record that was never written does not turn an update that went in into a failure, on a computer with no board', T, async () => {
  setMode('connect\n');
  setConsent(true);
  const c = freshCase();
  const sim = stoppedBoard(c);
  const r = await connectUpdate.run('look', seamsFor(c, site(NEXT), sim));
  assert.deepEqual(r.answer, ['updated', NEXT], c.log.join('\n'));
  const journalAt = win32apply.journalPathFor(c.anchor);
  const token = readJson(journalAt).token;
  /* As if finishUpdated's writeStatus had thrown (it only logs that): the journal says updated, no status says anything. */
  fs.rmSync(path.join(c.anchor, win32anchor.UPDATE_STATUS_NAME), { force: true });
  let clock = 0;
  const wait = { probe: sim.probe, now: () => clock, sleep: async (ms) => { clock += ms; }, waitMs: 5000 };
  const withNoBoard = await win32update.waitForOutcome(journalAt, token, { ...wait, noBoard: true });
  assert.equal(withNoBoard.outcome, 'updated', 'with no board the journal record counts');
  assert.equal(withNoBoard.to, NEXT);
  assert.equal(clock, 0, 'at once, not at the limit');
  /* The control: the board's rule waits for a board that never answers, and gives up. */
  const asOnABoard = await win32update.waitForOutcome(journalAt, token, wait);
  assert.equal(asOnABoard.outcome, null);
  /* A journal still at confirmed (H7 stood, the finish not yet recorded) counts only when the wait runs out: a
     helper still cleaning up is given its time before the window relaunches over it. */
  const j = readJson(journalAt);
  fs.writeFileSync(journalAt, JSON.stringify({ ...j, finished: false, outcome: null, phase: 'confirmed' }, null, 2) + '\n');
  clock = 0;
  const confirmed = await win32update.waitForOutcome(journalAt, token, { ...wait, noBoard: true });
  assert.equal(confirmed.outcome, 'updated');
  assert.ok(clock >= 5000, 'only at the end of the wait, not at once');
  assert.match(asOnABoard.because, /no outcome was recorded/);
});

test('#4382: a kept build too old for a connect computer is never offered or restored: it would start a board and could not update again', T, async () => {
  setMode('connect\n');
  setConsent(true);
  const c = freshCase({ connectReady: false });
  const sim = stoppedBoard(c);
  const up = await connectUpdate.run('look', seamsFor(c, site(NEXT), sim));
  assert.deepEqual(up.answer, ['updated', NEXT], c.log.join('\n'));
  assert.equal(up.rollback, null, 'the kept build has no win32connectupdate.js, so no rollback is offered');
  const back = await connectUpdate.run('rollback', seamsFor(c, null, sim));
  assert.equal(back.answer[0], 'refused');
  assert.match(back.answer[1], /too old for a computer that connects to agents on another computer/);
  assert.equal(versionIn(c.root), NEXT, 'nothing was rolled back');
  assert.equal(c.spawned.length, 1, 'only the update helper ever started');
});

test('#4382: something other than a Kosmos board answering on the port is not a board, and nothing is started', T, async () => {
  setMode('connect\n');
  setConsent(true);
  const c = freshCase();
  const s = site(NEXT);
  const sim = stoppedBoard(c);
  const seams = { ...seamsFor(c, s, sim), probe: async () => ({ answering: true, identity: null }) };
  const r = await connectUpdate.run('look', seams);
  assert.equal(r.answer[0], 'refused');
  assert.match(r.answer[1], /another program answers on port/);
  assert.deepEqual(s.urls, []);
  assert.deepEqual(c.spawned, []);
});

test('#4382: updates on, but the update would not start: the newer build is still offered, and the reason waits for the person to pick it', T, async () => {
  setMode('connect\n');
  setConsent(true);
  const c = freshCase();
  const sim = stoppedBoard(c);
  const refusing = { ...seamsFor(c, site(NEXT), sim), log: (line) => c.log.push(line), begin: async () => ({ ok: false, because: 'the Kosmos folder is inside OneDrive' }) };
  const look = await connectUpdate.run('look', refusing);
  assert.deepEqual(look.answer, ['newer', NEXT], 'the look hides a newer build it could not install');
  assert.ok(c.log.some((l) => /the automatic update to .* was not started: the Kosmos folder is inside OneDrive/.test(l)));
  assert.match(connectUpdate.reportLines(look).join('\n'), /\nnote the automatic update to .* was not started: the Kosmos folder is inside OneDrive$/,
    'the reason is in the report, where it can be found');
  const picked = await connectUpdate.run('install', refusing);
  assert.deepEqual(picked.answer, ['refused', 'the Kosmos folder is inside OneDrive'], 'the person who picked Update hears why');
});

test('#4382: a newer download run on a connect computer with --wait reports the update as done even when its status was not written', T, async () => {
  setMode('connect\n');
  const c = freshCase();
  const sim = stoppedBoard(c);
  const seams = seamsFor(c, site(NEXT), sim);
  const report = path.join(c.dir, 'report.txt');
  let pending = null;
  let clock = 0;
  const statusAt = path.join(c.anchor, win32anchor.UPDATE_STATUS_NAME);
  const code = await win32update.cliMain(['--apply', '--root', c.root, '--port', String(PORT), '--wait', '--report', report, '--yes'], () => {}, {
    probe: sim.probe,
    boardStatus: () => ({ known: true, registered: true, enabled: false }),
    readsConnect: () => win32apply.readsConnect(c.env),
    begin: { ...seams.helperOptions, env: c.env, home: os.homedir(), spawn: (file, args) => { pending = win32apply.applyJournal(args[2], sim.deps()); return { pid: 1, on() {}, unref() {} }; } },
    /* As if finishUpdated's writeStatus had thrown: the helper finishes, then its status is gone. */
    wait: { now: () => clock, sleep: async (ms) => { clock += ms; await pending; fs.rmSync(statusAt, { force: true }); }, waitMs: 5000 },
  });
  assert.equal(fs.readFileSync(report, 'utf8'), `UPDATED ${c.root}\r\n`, 'the update went in, and the report says so');
  assert.equal(code, 0);
  assert.equal(versionIn(c.root), NEXT);
  assert.deepEqual(sim.calls, []);
});

test('#4382: run() itself keeps the live-execution gate; only cliMain, with the person\'s --yes, opens it', T, async () => {
  setMode('connect\n');
  setConsent(true);
  const c = freshCase();
  const sim = stoppedBoard(c);
  const seams = seamsFor(c, site(NEXT), sim);
  delete seams.liveExecutionAllowed;
  await assert.rejects(connectUpdate.run('install', seams), /for real inside a test process/);
  assert.deepEqual(c.spawned, []);
  assert.equal(versionIn(c.root), INSTALLED);
});

test('#4382: an update left unfinished (a crash, a helper killed) is handed to its resumer on the next run, and nothing new is installed', T, async () => {
  setMode('connect\n');
  setConsent(true);
  const c = freshCase();
  const sim = stoppedBoard(c);
  let clock = 0;
  /* The helper is started and dies before it does anything: the journal stays staged, unfinished. */
  const dying = seamsFor(c, site(NEXT), sim);
  dying.helperOptions = { ...dying.helperOptions, spawn: (file, args) => { c.spawned.push({ file, args }); return { pid: 4242, on() {}, unref() {} }; } };
  dying.wait = { now: () => clock, sleep: async (ms) => { clock += ms; }, waitMs: 1000 };
  const first = await connectUpdate.run('look', dying);
  assert.equal(first.answer[0], 'pending', JSON.stringify(first));
  assert.equal(win32apply.readJournal(win32apply.journalPathFor(c.anchor)).state, 'unfinished');
  /* An hour on, the next look finds it. */
  const s = site(NEXT);
  const later = seamsFor(c, s, sim);
  later.helperOptions = { ...dying.helperOptions, now: () => Date.now() + 60 * 60 * 1000 };
  const next = await connectUpdate.run('look', later);
  assert.equal(next.answer[0], 'refused');
  assert.match(next.note, /an earlier update had not finished/);
  assert.equal(c.spawned.length, 2);
  assert.equal(c.spawned[1].args[1], win32update.RECOVER_FLAG, 'the resumer, from the old build\'s code');
  assert.deepEqual(s.urls, [], 'no look at the release host, and no new download');
  assert.equal(versionIn(c.root), INSTALLED);
});

test('#4382: a version strictly newer than the one rolled back from installs by itself as usual; the held one is only offered', T, async () => {
  setMode('connect\n');
  setConsent(true);
  for (const [held, want] of [[INSTALLED, 'updated'], [NEXT, 'newer']]) {
    const c = freshCase();
    const sim = stoppedBoard(c);
    fs.writeFileSync(path.join(c.anchor, win32anchor.UPDATE_HELD_NAME), JSON.stringify({ version: held }) + '\n');
    const r = await connectUpdate.run('look', seamsFor(c, site(NEXT), sim));
    assert.equal(r.answer[0], want, `held ${held}: ${c.log.join('\n')}`);
    assert.equal(versionIn(c.root), want === 'updated' ? NEXT : INSTALLED);
    if (want === 'updated') assert.equal(fs.existsSync(path.join(c.anchor, win32anchor.UPDATE_HELD_NAME)), false, 'the finished update let the hold go');
  }
});

test('#4382: a roll back whose outcome is not seen in time is not called finished or undone, and its hold is already written', T, async () => {
  setMode('connect\n');
  setConsent(true);
  const c = freshCase();
  const sim = stoppedBoard(c);
  const up = await connectUpdate.run('look', seamsFor(c, site(NEXT), sim));
  assert.deepEqual(up.answer, ['updated', NEXT], c.log.join('\n'));
  let clock = 0;
  const slow = seamsFor(c, null, sim);
  slow.helperOptions = { ...slow.helperOptions, spawn: (file, args) => { c.spawned.push({ file, args }); return { pid: 4242, on() {}, unref() {} }; } };
  slow.wait = { now: () => clock, sleep: async (ms) => { clock += ms; }, waitMs: 1000 };
  const back = await connectUpdate.run('rollback', slow);
  assert.deepEqual(back.answer, ['pending', `the roll back to ${INSTALLED} has not been seen to finish yet`], 'pending, so the window starts nothing more until it is opened again');
  assert.equal(readJson(path.join(c.anchor, win32anchor.UPDATE_HELD_NAME)).version, NEXT, 'the next automatic look will not put it back');
});

test('#4382: an install whose outcome is not seen in time is pending, not offered for a retry, and no file paths reach the person', T, async () => {
  setMode('connect\n');
  setConsent(true);
  const c = freshCase();
  const sim = stoppedBoard(c);
  let clock = 0;
  const slow = seamsFor(c, site(NEXT), sim);
  slow.helperOptions = { ...slow.helperOptions, spawn: (file, args) => { c.spawned.push({ file, args }); return { pid: 4242, on() {}, unref() {} }; } };
  slow.wait = { now: () => clock, sleep: async (ms) => { clock += ms; }, waitMs: 1000 };
  const r = await connectUpdate.run('look', slow);
  assert.deepEqual(r.answer, ['pending', `the update to ${NEXT} has not been seen to finish yet`], 'pending: the window may now run from the copy the update moved aside');
  assert.doesNotMatch(r.answer[1], /\.json|[A-Z]:\\/, 'no file paths');
  assert.equal(connectUpdate.EXIT.pending, 1);
});

test('#4382: a board that starts while the look runs is asked about again right before anything is started', T, async () => {
  setMode('connect\n');
  setConsent(true);
  const c = freshCase();
  const sim = stoppedBoard(c);
  let asked = 0;
  const seams = { ...seamsFor(c, site(NEXT), sim), probe: async () => { asked += 1; return asked === 1 ? { answering: false } : { answering: true, identity: `${INSTALLED}@default` }; } };
  const r = await connectUpdate.run('look', seams);
  assert.deepEqual(r.answer, ['board']);
  assert.equal(asked, 2);
  assert.deepEqual(c.spawned, []);
  assert.equal(versionIn(c.root), INSTALLED);
});
