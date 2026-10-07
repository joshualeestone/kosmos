'use strict';
/**
 * #5445 (Linux port B follow-ups): a stopped Linux agent stays on the board (its unit is listed as a plist is), the
 * board can read which units systemd switched off and which are running, a masked unit reads as masked, a test that
 * forgot its runner seam fails loudly, and the wording is true on Linux. Sandboxed: every root is a temp folder and
 * every systemctl call goes to a fake, so nothing reaches the host.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-parity5445-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(SANDBOX, 'systemd-user');
fs.mkdirSync(process.env.AGENT_WORKFORCE_SYSTEMD_DIR, { recursive: true });

const create = require('./create');
const linuxjob = require('./linuxjob');
const createdroster = require('./createdroster');
const launchidentity = require('./launchidentity');

// The real runner's shape: stdout on exit 0, a throw (status, stdout, stderr) otherwise.
let systemd = () => ({ ok: true, stdout: '' });
const fakeRunner = (file, args) => {
  if (file !== 'systemctl' && file !== 'loginctl') return { ok: true, stdout: '' };
  const r = systemd(file, args);
  if (r.ok) return { ok: true, stdout: r.stdout || '' };
  const err = new Error('Command failed: ' + file + ' ' + args.join(' '));
  err.status = r.code == null ? 1 : r.code; err.stdout = r.stdout || ''; err.stderr = r.stderr || '';
  throw err;
};
create.setRunner(fakeRunner);
create.setDryRun(false);

test.after(() => {
  create.setRunner(null);
  linuxjob.setRunnerForTests(null);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const unit = (name, world) => {
  const f = linuxjob.unitPath(name, world);
  fs.writeFileSync(f, linuxjob.unitFor(name, '/usr/bin/claude', '/usr/bin/tmux', null, null, 'claude'));
  return f;
};
const clearUnits = () => { for (const f of fs.readdirSync(process.env.AGENT_WORKFORCE_SYSTEMD_DIR)) fs.rmSync(path.join(process.env.AGENT_WORKFORCE_SYSTEMD_DIR, f), { force: true }); };
const myWorld = () => launchidentity.currentWorldId();

test('#5445 the created roster lists a stopped Linux agent from its unit, and only this Kosmos\'s', () => {
  clearUnits();
  unit('linus', myWorld());
  unit('other', 'elsewhere');                                   // another Kosmos's agent
  fs.mkdirSync(create.workerDir('linus'), { recursive: true });
  const harness = (platform) => createdroster.make({
    platform,
    remove: { removedNames: () => ({ ok: true, names: [] }) },
    status: { sandboxIsInconsistent: () => false },
    store: { safeKey: (n) => String(n).toLowerCase() },
    // readJob on the Linux arm reads the unit file through the injected platform
    create: Object.assign(Object.create(create), { readJob: (n) => create.readJob(n, undefined, platform) }),
  });
  assert.deepEqual(harness('linux')(), ['linus']);
  // CONTROL: the Mac arm reads the LaunchAgents folder, not the units: a plist for another agent is listed there, the
  // unit's agent is not (and the plist's agent is not listed on Linux, above).
  fs.mkdirSync(create.workerDir('macbot'), { recursive: true });
  const plist = create.plistPath('macbot');
  fs.writeFileSync(plist, '<plist/>');
  try {
    const mac = createdroster.make({
      platform: 'darwin',
      remove: { removedNames: () => ({ ok: true, names: [] }) },
      status: { sandboxIsInconsistent: () => false },
      store: { safeKey: (n) => String(n).toLowerCase() },
      create: Object.assign(Object.create(create), { readJob: (n) => (n === 'macbot' ? { runner: 'claude' } : null) }),
    });
    assert.deepEqual(mac(), ['macbot']);
  } finally { fs.rmSync(plist, { force: true }); }
});

test('#5445 the created roster fails closed when the unit folder cannot be read', () => {
  fs.mkdirSync(create.workerDir('listedbot'), { recursive: true });
  clearUnits();
  unit('listedbot', myWorld());
  const make = (listUnits) => createdroster.make({
    platform: 'linux',
    linuxjob: { listUnits },
    remove: { removedNames: () => ({ ok: true, names: [] }) },
    status: { sandboxIsInconsistent: () => false },
    store: { safeKey: (n) => String(n).toLowerCase() },
    create: Object.assign(Object.create(create), { readJob: (n) => create.readJob(n, undefined, 'linux') }),
  });
  // CONTROL: the injected listing is what the roster reads (so the empty answer below is the refusal, not a miss).
  assert.deepEqual(make(() => [{ name: 'listedbot', worldId: myWorld() }])(), ['listedbot']);
  assert.deepEqual(make(() => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; })(), []);
});

test('#5445 the stray sweep reads Linux units, not plists', () => {
  clearUnits();
  unit('strayunit', myWorld());
  const register = require('./register');
  const linux = register.survey({ platform: 'linux' });
  assert.equal(linux.ok, true, JSON.stringify(linux));
  assert.ok(linux.agents.some((a) => a.name === 'strayunit' && a.job === true && a.profile === false), JSON.stringify(linux.agents));
  assert.equal(linux.straySweepFailed, false);
  // CONTROL: the Mac sweep walks the LaunchAgents folder and does not see the unit.
  const mac = register.survey({ platform: 'darwin' });
  assert.ok(!mac.agents.some((a) => a.name === 'strayunit'), JSON.stringify(mac.agents));
});

test('#5445 disabledJobsResult on Linux: disabled and masked units are off, and a failed call is could-not-look', () => {
  const w = myWorld();
  const k = (n) => linuxjob.unitName(n, w);
  systemd = (cmd, args) => (args[1] === 'list-unit-files'
    ? { ok: true, stdout: [`${k('offbot')} disabled enabled`, `${k('maskbot')} masked enabled`, `${k('onbot')} enabled enabled`,
      `${linuxjob.unitName('far', 'elsewhere')} disabled enabled`, 'ssh-agent.service disabled enabled'].join('\n') + '\n' }
    : { ok: true, stdout: '' });
  const r = create.disabledJobsResult(undefined, 'linux');
  assert.equal(r.ok, true);
  assert.deepEqual([...r.jobs].sort(), ['maskbot', 'offbot'], 'only this Kosmos\'s switched-off agents (control: onbot, far, ssh-agent)');
  systemd = () => ({ ok: false, code: 1, stderr: 'Failed to connect to bus: No such file or directory' });
  assert.deepEqual(create.disabledJobsResult(undefined, 'linux'), { ok: false }, 'a failed look is not "none switched off"');
});

test('#5445 runningJobs on Linux reads the active agent units', () => {
  const w = myWorld();
  systemd = (cmd, args) => (args[1] === 'list-units'
    ? { ok: true, stdout: `${linuxjob.unitName('runbot', w)} loaded active running Kosmos agent runbot\nother.service loaded active running x\n` }
    : { ok: true, stdout: '' });
  assert.deepEqual([...create.runningJobs('linux')], ['runbot']);
  systemd = () => ({ ok: false, code: 1, stderr: 'bus' });
  assert.deepEqual([...create.runningJobs('linux')], [], 'fail-soft to empty, as the Mac arm');
});

test('#5445 a masked agent stays on the created roster (switched off, not gone)', () => {
  clearUnits();
  fs.mkdirSync(create.workerDir('maskrow'), { recursive: true });
  fs.symlinkSync('/dev/null', linuxjob.unitPath('maskrow', myWorld()));
  const src = createdroster.make({
    platform: 'linux',
    remove: { removedNames: () => ({ ok: true, names: [] }) },
    status: { sandboxIsInconsistent: () => false },
    store: { safeKey: (n) => String(n).toLowerCase() },
    create: Object.assign(Object.create(create), { readJob: (n) => create.readJob(n, undefined, 'linux') }),
  });
  assert.deepEqual(src(), ['maskrow']);
  assert.equal(create.readJob('maskrow', undefined, 'linux'), null, 'CONTROL: the masked unit itself reads as no job');
});

test('#5445 a masked unit reads as masked, not as a broken unit', () => {
  clearUnits();
  fs.symlinkSync('/dev/null', linuxjob.unitPath('maskedbot', myWorld()));
  const v = create.readJobVerdict('maskedbot', undefined, 'linux');
  assert.equal(v.job, null);
  assert.equal(v.masked, true);
  assert.match(v.because, /masked it in systemd.*systemctl --user unmask/);
  // CONTROL: an ordinary unit is read as a job.
  unit('plainbot', myWorld());
  assert.ok(create.readJobVerdict('plainbot', undefined, 'linux').job, 'the ordinary unit was not read');
});

test('#5445 linuxRun lets the live-execution refusal through as a throw; an ordinary failure stays a result', () => {
  create.setRunner(() => { const e = new Error('refused for real'); e.code = 'LIVE_EXECUTION_REFUSED'; throw e; });
  try {
    assert.throws(() => create.linuxRun(() => linuxjob.loaded('anybot')), /refused for real/);
  } finally { create.setRunner(fakeRunner); }
  systemd = () => ({ ok: false, code: 3, stdout: 'inactive\n' });
  assert.equal(create.linuxRun(() => linuxjob.loaded('anybot')), false, 'CONTROL: an ordinary non-zero exit is a result');
  // And the gate itself tags its refusal with that code.
  const liveExec = require('./live-execution');
  assert.throws(() => liveExec.refuseOrWarn('x', 'systemctl', ['--user']), (e) => e.code === 'LIVE_EXECUTION_REFUSED');
});

test('#5445 the self-starts sentence is true on Linux with linger off', () => {
  assert.equal(create.selfStarts('darwin', false), create.SELF_STARTS, 'the Mac ignores linger');
  assert.equal(create.selfStarts('linux', true), create.SELF_STARTS, 'linger on: it starts itself');
  assert.equal(create.selfStarts('linux', undefined), create.SELF_STARTS, 'unknown: the default sentence');
  assert.match(create.selfStarts('linux', false), /while you are logged in/);
});

test('#5445 "already loaded" says it stops at logout when linger is off', () => {
  fs.mkdirSync(create.workerDir('loadedbot'), { recursive: true });
  const lingerIs = (yes) => (cmd, args) => (cmd === 'loginctl' && args[0] === 'show-user'
    ? { ok: true, stdout: yes ? 'Linger=yes\n' : 'Linger=no\n' }
    : (cmd === 'systemctl' && args[1] === 'is-active') ? { ok: true, stdout: 'active\n' }
      : { ok: true, stdout: '' });
  const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo', platform: 'linux' };
  systemd = lingerIs(false);
  const off = create.installJob('loadedbot', BINS);
  assert.equal(off.alreadyRunning, true, 'RESULT ' + JSON.stringify(off));
  assert.match(off.because, /next restart\. It stops when you log out/);
  fs.mkdirSync(create.workerDir('loadedbot2'), { recursive: true });
  systemd = lingerIs(true);
  const on = create.installJob('loadedbot2', BINS);
  assert.equal(on.alreadyRunning, true, 'RESULT ' + JSON.stringify(on));
  assert.doesNotMatch(on.because, /log out/, 'CONTROL: linger on says nothing about logging out');
});

test('#5445 the Linux Trash is the desktop one, and a trashed folder gets its put-back record', () => {
  const dl = require('./delete-leftover');
  const savedTrash = process.env.AGENT_WORKFORCE_TRASH;
  delete process.env.AGENT_WORKFORCE_TRASH;
  try {
    assert.equal(dl.TRASH('linux'), path.join(SANDBOX, '.local', 'share', 'Trash', 'files'));
    assert.equal(dl.TRASH('darwin'), path.join(SANDBOX, '.Trash'), 'CONTROL: the Mac keeps ~/.Trash');
    // XDG_DATA_HOME is the person's real folder: a sandboxed home ignores it.
    process.env.XDG_DATA_HOME = '/nowhere-real';
    assert.equal(dl.TRASH('linux'), path.join(SANDBOX, '.local', 'share', 'Trash', 'files'));
    delete process.env.XDG_DATA_HOME;
    // The put-back record a Linux file manager needs: where it came from (URL-encoded) and when.
    const from = path.join(SANDBOX, 'workers', 'old bot');
    const to = path.join(dl.TRASH('linux'), 'old bot (Kosmos 2026-10-07T03-00-00)');
    dl.writeTrashInfo(from, to);
    const info = fs.readFileSync(path.join(SANDBOX, '.local', 'share', 'Trash', 'info', path.basename(to) + '.trashinfo'), 'utf8');
    assert.match(info, /^\[Trash Info\]\nPath=\/.*\/workers\/old%20bot\nDeletionDate=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\n$/);
  } finally {
    delete process.env.XDG_DATA_HOME;
    if (savedTrash !== undefined) process.env.AGENT_WORKFORCE_TRASH = savedTrash;
  }
});

/* A missing Trash (a fresh Linux desktop makes it on first use) must not turn a delete into delete-for-good. The other
   half of the fix, judging an XDG_DATA_HOME on another volume by its nearest existing folder, needs a second volume
   and a real XDG_DATA_HOME, which this sandbox cannot give; it is read, not tested. */
test('#5445 a missing Linux Trash still takes the folder (the move makes it)', () => {
  const dl = require('./delete-leftover');
  const savedTrash = process.env.AGENT_WORKFORCE_TRASH;
  delete process.env.AGENT_WORKFORCE_TRASH;
  fs.rmSync(path.join(SANDBOX, '.local'), { recursive: true, force: true });
  const folder = path.join(SANDBOX, 'workers', 'trashme');
  fs.mkdirSync(folder, { recursive: true });
  try {
    // No Trash yet: the folder and the home share a volume, so the Trash can take it (the move makes the Trash).
    const p = dl.plan('trashme', { platform: 'linux' });
    assert.equal(p.toTrash, true, JSON.stringify(p));
  } finally { if (savedTrash !== undefined) process.env.AGENT_WORKFORCE_TRASH = savedTrash; }
});

test('#5445 a board test can pin the fleet probes to the Mac arm on any runner', () => {
  const w = myWorld();
  systemd = (cmd, args) => (args[1] === 'list-units' ? { ok: true, stdout: `${linuxjob.unitName('pinbot', w)} loaded active running x\n` } : { ok: true, stdout: '' });
  try {
    create.setProbePlatformForTests('linux');
    assert.deepEqual([...create.runningJobs()], ['pinbot'], 'pinned to linux: the systemctl arm, with no platform passed');
    create.setProbePlatformForTests('darwin');
    assert.deepEqual([...create.runningJobs()], [], 'pinned to darwin: the launchctl arm (the fake answers launchctl with nothing)');
    assert.deepEqual([...create.runningJobs('linux')], ['pinbot'], 'a platform the caller names still wins');
  } finally { create.setProbePlatformForTests(null); }
});

test('#5445 the two fleet polls fail soft on a refused runner, as the Mac arm does; an act through linuxRun does not', () => {
  create.setRunner(() => { const e = new Error('refused for real'); e.code = 'LIVE_EXECUTION_REFUSED'; throw e; });
  try {
    assert.deepEqual(create.disabledJobsResult(undefined, 'linux'), { ok: false }, 'could-not-look, not a crash of the board poll');
    assert.deepEqual([...create.runningJobs('linux')], []);
    assert.throws(() => create.linuxRun(() => linuxjob.start('anybot')), /refused for real/, 'CONTROL: an act still fails loudly');
  } finally { create.setRunner(fakeRunner); }
});

test('#5445 the board says where a switched-off agent was switched off, per platform, and a masked one says masked', () => {
  clearUnits();
  const off = new Set(['offrow']);
  // Mac: unchanged, System Settings.
  assert.match(create.switchedOffSentence('offrow', off, 'darwin'), /System Settings under Login Items/);
  assert.equal(create.switchedOffSentence('onrow', off, 'darwin'), null, 'CONTROL: not switched off, no sentence');
  // Linux: systemd, never System Settings.
  const lin = create.switchedOffSentence('offrow', off, 'linux');
  assert.match(lin, /switched off \(or masked\) in systemd/);
  assert.doesNotMatch(lin, /System Settings/);
  assert.equal(create.switchedOffSentence('onrow', off, 'linux'), null);
  // A masked unit is read from the disk, so it is said even when systemctl gave no switched-off set.
  fs.symlinkSync('/dev/null', linuxjob.unitPath('maskrow2'));
  assert.match(create.switchedOffSentence('maskrow2', new Set(), 'linux'), /masked it in systemd.*unmask/);
  assert.equal(create.switchedOffSentence('maskrow2', new Set(), 'darwin'), null, 'CONTROL: the Mac never reads units');
});
