'use strict';
/**
 * #4382: `kosmos update --if-newer`, the update look the Mac app runs on a computer that connects to
 * agents on another computer and so runs no board. Driven end to end: the real install/kosmos and the
 * real engine modules, copied into an installed layout (installedRoot() reads the layout, so the
 * repo itself would answer "not an installed copy"), against a file:// release host whose /setup is a
 * stand-in installer that records how it was run. The real installer, and a board staying stopped
 * through it, are tools/test-install.sh's arm for #4382.
 *
 *   node --test cli.update-ifnewer-4382.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const REPO = __dirname;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-update-ifnewer-'));
test.after(() => fs.rmSync(T, { recursive: true, force: true }));

const HOME = path.join(T, 'home');      // KOSMOS_HOME, an installed layout
const DATA = path.join(T, 'data');      // the data root (autoupdate.json, source-channel)
const DIST = path.join(T, 'dist');      // the release host's /dist
const RAN = path.join(T, 'ran.txt');    // what the stand-in installer saw
const RUNNING = '1.0.0';

function layout() {
  fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
  fs.mkdirSync(path.join(HOME, 'app', 'engine'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'app', 'package.json'), JSON.stringify({ version: RUNNING }) + '\n');
  fs.writeFileSync(path.join(HOME, 'app', 'server.js'), '');
  // Copied, not linked: node resolves a linked module to its real path, and installedRoot() would
  // then read the repo, which has no runtime/ beside it.
  for (const f of fs.readdirSync(path.join(REPO, 'engine'))) {
    if (f.endsWith('.js') && !f.endsWith('.test.js')) fs.copyFileSync(path.join(REPO, 'engine', f), path.join(HOME, 'app', 'engine', f));
  }
  fs.mkdirSync(path.join(HOME, 'bin'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'install', 'kosmos'), path.join(HOME, 'bin', 'kosmos'));
  fs.chmodSync(path.join(HOME, 'bin', 'kosmos'), 0o755);
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });
  // The only computer the verb serves: one set to connect elsewhere (the app writes this word).
  fs.writeFileSync(path.join(HOME, 'mode'), 'connect\n');
  // The stand-in installers: each records its own name and the three variables beginInstall hands it, then exits
  // as told. Two of them, because a box on the staging pointer runs /setup-staging, prod's /setup otherwise (#5032).
  for (const name of ['setup', 'setup-staging']) {
    fs.writeFileSync(path.join(T, name),
      'printf "installer=' + name + ' base=%s pointer=%s channel=%s\\n" "$KOSMOS_RELEASE_BASE" "$KOSMOS_UPDATE_CHANNEL" "$KOSMOS_SOURCE_CHANNEL" >> "' + RAN + '"\n'
      + 'echo "installer output"\nexit "${FAKE_SETUP_RC:-0}"\n');
  }
}
layout();

function reset({ prod, staging, consent, stamp } = {}) {
  for (const f of [RAN, path.join(HOME, 'logs', 'install.status'), path.join(HOME, 'logs', 'install.started'),
    path.join(DIST, 'latest.json'), path.join(DIST, 'latest-staging.json'), path.join(DATA, 'Kosmos', 'autoupdate.json'),
    path.join(DATA, 'Kosmos', 'source-channel')]) fs.rmSync(f, { force: true });
  if (prod !== undefined) fs.writeFileSync(path.join(DIST, 'latest.json'), JSON.stringify({ version: prod }));
  if (staging !== undefined) fs.writeFileSync(path.join(DIST, 'latest-staging.json'), JSON.stringify({ version: staging }));
  fs.mkdirSync(path.join(DATA, 'Kosmos'), { recursive: true });
  if (consent !== undefined) fs.writeFileSync(path.join(DATA, 'Kosmos', 'autoupdate.json'), consent);
  if (stamp !== undefined) fs.writeFileSync(path.join(DATA, 'Kosmos', 'source-channel'), stamp + '\n');
}

function run(args, extra = {}) {
  const env = { ...process.env, KOSMOS_HOME: HOME, AGENT_WORKFORCE_DATA: DATA, KOSMOS_RELEASE_BASE: 'file://' + DIST,
    KOSMOS_NO_LEGACY_MIGRATION: '1', ...extra };
  // The agent markers too: this suite is often run by an agent, and the verb refuses one.
  for (const k of ['AGENT_WORKFORCE_RELEASE_BASE', 'AGENT_WORKFORCE_UPDATE_CHANNEL', 'KOSMOS_UPDATE_CHANNEL', 'KOSMOS_SOURCE_CHANNEL',
    'KOSMOS_AGENT_SESSION', 'KOSMOS_AGENT_TOKEN', 'TMUX_PANE']) {
    if (!(k in extra)) delete env[k];
  }
  return new Promise((resolve, reject) => {
    execFile(path.join(HOME, 'bin', 'kosmos'), ['update', ...args], { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code (' + (err.signal || err.code) + ') ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '', last: (stdout || '').trim().split('\n').pop() });
    });
  });
}
const ran = () => (fs.existsSync(RAN) ? fs.readFileSync(RAN, 'utf8') : '');

test('#4382: nothing newer says current and runs nothing', async () => {
  reset({ prod: RUNNING });
  const r = await run(['--if-newer']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.last, 'current ' + RUNNING);
  assert.equal(ran(), '');
});

test('#4382: newer with no Updates file (consent on, as on a connect Mac) installs, with the board\'s three variables', async () => {
  reset({ prod: '1.2.0' });
  const r = await run(['--if-newer']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.last, 'updated 1.2.0');
  assert.equal(ran(), 'installer=setup base=file://' + DIST + ' pointer=prod channel=prod\n');
  // The record a board started later reads (update.js readStatusRecord): code 0, and no in-flight marker left.
  assert.match(fs.readFileSync(path.join(HOME, 'logs', 'install.status'), 'utf8'), /^0 \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n$/);
  assert.equal(fs.existsSync(path.join(HOME, 'logs', 'install.started')), false);
  assert.match(fs.readFileSync(path.join(HOME, 'logs', 'install.log'), 'utf8'), /installer output/);
});

test('#4382: Updates switched off offers and installs nothing; --install installs it', async () => {
  reset({ prod: '1.2.0', consent: '{"on":false}' });
  let r = await run(['--if-newer']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.last, 'newer 1.2.0');
  assert.equal(ran(), '', 'consent off must not run the installer');
  r = await run(['--if-newer', '--install']);
  assert.equal(r.last, 'updated 1.2.0');
  assert.equal(ran(), 'installer=setup base=file://' + DIST + ' pointer=prod channel=prod\n');
});

test('#4382: an Updates file that cannot be read is OFF, never consent (autoupdate.js)', async () => {
  reset({ prod: '1.2.0', consent: 'not json' });
  const r = await run(['--if-newer']);
  assert.equal(r.last, 'newer 1.2.0');
  assert.equal(ran(), '');
  // CONTROL: the same pointer with the switch on does install, so the line above is the consent's doing.
  reset({ prod: '1.2.0', consent: '{"on":true}' });
  assert.equal((await run(['--if-newer'])).last, 'updated 1.2.0');
});

test('#4382: a staging install follows its stamp, and takes a newer prod build while staying on staging (#2969)', async () => {
  reset({ prod: '1.1.0', staging: '1.3.0', stamp: 'staging' });
  let r = await run(['--if-newer']);
  assert.equal(r.last, 'updated 1.3.0');
  assert.equal(ran(), 'installer=setup-staging base=file://' + DIST + ' pointer=staging channel=staging\n');
  reset({ prod: '1.4.0', staging: '1.3.0', stamp: 'staging' });
  r = await run(['--if-newer']);
  assert.equal(r.last, 'updated 1.4.0');
  assert.equal(ran(), 'installer=setup base=file://' + DIST + ' pointer=prod channel=staging\n');
  // CONTROL: with no stamp the same files are prod's 1.1.0 vs 1.0.0, never staging's.
  reset({ prod: '1.1.0', staging: '1.3.0' });
  assert.equal((await run(['--if-newer'])).last, 'updated 1.1.0');
});

test('#4382: a failed installer is failed, exit 1, and its code is recorded', async () => {
  reset({ prod: '1.2.0' });
  const r = await run(['--if-newer'], { FAKE_SETUP_RC: '7' });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.equal(r.last, 'failed 1.2.0');
  assert.match(fs.readFileSync(path.join(HOME, 'logs', 'install.status'), 'utf8'), /^7 /);
  assert.equal(fs.existsSync(path.join(HOME, 'logs', 'install.started')), false);
});

test('#4382: a host with no pointer, or an unreadable one, is unknown, never current', async () => {
  reset({});
  let r = await run(['--if-newer']);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.last, /^unknown\t/);
  reset({ prod: 'garbage' });
  r = await run(['--if-newer']);
  assert.equal(r.code, 1);
  assert.match(r.last, /^unknown\t/);
  assert.equal(ran(), '');
});

test('#4382: a running board updates itself; the verb does nothing', async () => {
  reset({ prod: '1.2.0' });
  // A process whose command line carries app/server.js, as running_pid checks.
  const { spawn } = require('node:child_process');
  // exit code not read (#3628): a stand-in held open for its pid and command line; it is killed below.
  const fake = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)', path.join(HOME, 'app', 'server.js')], { stdio: 'ignore' });
  try {
    fs.writeFileSync(path.join(HOME, 'board.pid'), String(fake.pid));
    const r = await run(['--if-newer']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.last, 'board');
    assert.equal(ran(), '');
  } finally {
    fake.kill();
    fs.rmSync(path.join(HOME, 'board.pid'), { force: true });
  }
});

test('#4382: a wrong call is a usage line and exit 2; --help is help', async () => {
  for (const args of [[], ['--install'], ['--if-newer', '--bogus']]) {
    const r = await run(args);
    assert.equal(r.code, 2, args.join(' ') + ': ' + r.stdout + r.stderr);
    assert.match(r.stdout, /Usage: kosmos update --if-newer/);
  }
  reset({ prod: '1.2.0' });
  const h = await run(['--help']);
  assert.equal(h.code, 0);
  assert.match(h.stdout, /Usage: kosmos update --if-newer/);
  assert.equal(ran(), '', '--help must never install');
});

test('#4382: only a computer set to connect elsewhere, and only a person, may update this way', async () => {
  const MODE = path.join(HOME, 'mode');
  try {
    for (const [word, why] of [['run\n', 'run'], ['both\n', 'both'], ['connect-ish\n', 'not exactly connect'], [null, 'no mode file']]) {
      reset({ prod: '1.2.0' });
      if (word === null) fs.rmSync(MODE, { force: true }); else fs.writeFileSync(MODE, word);
      const r = await run(['--if-newer', '--install']);
      assert.equal(r.code, 3, why + ': ' + r.stdout + r.stderr);
      assert.match(r.last, /^refused\t/, why);
      assert.equal(ran(), '', why + ': nothing may be installed');
    }
    fs.writeFileSync(MODE, 'connect\n');
    reset({ prod: '1.2.0' });
    const a = await run(['--if-newer', '--install'], { KOSMOS_AGENT_SESSION: 'someone' });
    assert.equal(a.code, 3, a.stdout + a.stderr);
    assert.match(a.last, /^refused\tan agent/);
    assert.equal(ran(), '');
    // CONTROL: the same call, as a person on a connect computer, installs.
    reset({ prod: '1.2.0' });
    assert.equal((await run(['--if-newer', '--install'])).last, 'updated 1.2.0');
  } finally {
    fs.writeFileSync(MODE, 'connect\n');
  }
});

test('#4382: the look never starts the board\'s own install, even with Updates on', async () => {
  reset({ prod: '1.2.0' });   // no Updates file: consent on
  const BEGAN = path.join(T, 'began.txt');
  fs.rmSync(BEGAN, { force: true });
  // In the installed layout: the board's update.js with its install seam spying, then the look itself.
  const script = `
    const update = require(${JSON.stringify(path.join(HOME, 'app', 'engine', 'update.js'))});
    update.setInstallRunner(() => { require('fs').writeFileSync(${JSON.stringify(BEGAN)}, 'began'); return null; });
    require(${JSON.stringify(path.join(HOME, 'app', 'engine', 'update-ifnewer.js'))}).decide()
      .then((d) => { process.stdout.write(d.line.join(' ')); setTimeout(() => {}, 300); });`;
  const env = { ...process.env, KOSMOS_HOME: HOME, AGENT_WORKFORCE_DATA: DATA, KOSMOS_RELEASE_BASE: 'file://' + DIST };
  for (const k of ['AGENT_WORKFORCE_RELEASE_BASE', 'AGENT_WORKFORCE_UPDATE_CHANNEL', 'KOSMOS_UPDATE_CHANNEL', 'KOSMOS_SOURCE_CHANNEL']) delete env[k];
  const out = await new Promise((resolve, reject) => {
    // exit code not read (#3628): any failure, a non-zero exit included, rejects with the error and stderr.
    execFile(path.join(HOME, 'runtime', 'bin', 'node'), ['-e', script], { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(err) + stderr)); else resolve(stdout);
    });
  });
  assert.match(out, /^newer 1\.2\.0 on /, out);
  assert.equal(fs.existsSync(BEGAN), false, 'checkNow() reached beginInstall: the board\'s auto-install ran inside the look');
});

test('#4382: an install already under way here (a fresh logs/install.started) is not raced; an interrupted one is not in the way', async () => {
  const MARK = path.join(HOME, 'logs', 'install.started');
  reset({ prod: '1.2.0' });
  fs.mkdirSync(path.dirname(MARK), { recursive: true });
  fs.writeFileSync(MARK, '2026-10-02T15:00:00Z\n');
  const r = await run(['--if-newer', '--install']);
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.equal(r.last, 'refused\tan update is already being installed on this computer');
  assert.equal(ran(), '', 'a second installer ran beside the first');
  assert.equal(fs.existsSync(MARK), true, 'the other install\'s marker was taken away');
  // An interrupted install leaves its marker behind; 31 minutes old, it no longer holds anything off.
  reset({ prod: '1.2.0' });
  fs.writeFileSync(MARK, '2026-10-02T15:00:00Z\n');
  const old = new Date(Date.now() - 31 * 60 * 1000);
  fs.utimesSync(MARK, old, old);
  assert.equal((await run(['--if-newer', '--install'])).last, 'updated 1.2.0');
});
