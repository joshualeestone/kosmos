'use strict';
/**
 * kosmos#8786 S2: the Cloud box's nightly update units (engine/linuxboard.js cloudUpdateNames, cloudUpdateUnitsFor, and
 * their place in installBoard and removeBoard), without touching real systemd. What the run decides is
 * engine/cloudnightly-8786.test.js; what the command does with it is engine/cloudnightly-cli-8786.test.js.
 *
 *   node --test engine/linuxboard.cloudupdate-8786.test.js
 */
const test = require('node:test');
{
  const sbx = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'aw-cloudupdate8786-'));
  process.env.AGENT_WORKFORCE_DATA = require('node:path').join(sbx, 'data');
  process.env.AGENT_WORKFORCE_WORKERS = require('node:path').join(sbx, 'workers');
  process.on('exit', () => { try { require('node:fs').rmSync(sbx, { recursive: true, force: true }); } catch { /* temp */ } });
}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const linuxboard = require('./linuxboard');

test.afterEach(() => {
  linuxboard.setRunnerForTests(null);
  linuxboard.setSystemdDirForTests(null);
  linuxboard.setCloudForTests(null);
});

function sandbox(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  linuxboard.setSystemdDirForTests(() => tmp);
  const home = path.join(tmp, 'kosmos-home');
  fs.mkdirSync(home, { recursive: true });
  return { tmp, home };
}
const record = (calls) => (cmd, args) => { calls.push(args.join(' ')); return { ok: true, stdout: '' }; };

test('the nightly units are named from the board unit, and never as a board unit or the pause check', () => {
  const def = path.join(os.homedir(), '.local', 'share', 'kosmos');
  assert.deepEqual(linuxboard.cloudUpdateNames(def), { service: 'kosmos-cloud-update.service', timer: 'kosmos-cloud-update.timer' });
  const other = '/srv/kosmos-other';
  const hash = linuxboard.boardUnitName(other).match(/^kosmos-board\.([0-9a-f]{8})\.service$/)[1];
  assert.deepEqual(linuxboard.cloudUpdateNames(other), {
    service: `kosmos-cloud-update.${hash}.service`,
    timer: `kosmos-cloud-update.${hash}.timer`,
  });
  assert.doesNotMatch(linuxboard.cloudUpdateNames(other).service, /^kosmos-(board|pause-check)/);
});

test('setup.sh derives the same nightly unit name as linuxboard (the uninstall removes what the install wrote)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'install', 'setup.sh'), 'utf8');
  assert.match(src, /_kosmos_linux_cloud_update_base\(\) \{\n {2}_kcu_base="\$\(_kosmos_linux_unit_name\)"; _kcu_base="kosmos-cloud-update\$\{_kcu_base#kosmos-board\}"/);
  assert.match(src, /_kosmos_linux_remove_pause_check\n {6}_kosmos_linux_remove_cloud_update\n/, 'the uninstall calls it beside the pause check');
});

test('the nightly service runs kosmos cloud-update once a night, outside the board, on this board\'s port', () => {
  const home = '/home/user/.local/share/kosmos-x';
  const { names, service, timer } = linuxboard.cloudUpdateUnitsFor(home, 17123);
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, new RegExp('^ExecStart=/bin/bash "' + home + '/bin/kosmos" cloud-update$', 'm'));
  assert.match(service, new RegExp('^Environment="KOSMOS_HOME=' + home + '"$', 'm'));
  assert.match(service, /^Environment="PORT=17123"$/m);
  assert.match(service, new RegExp('^ConditionPathExists=' + home + '/bin/kosmos$', 'm'));
  assert.doesNotMatch(service, /^Restart=/m);
  assert.doesNotMatch(service, /^\[Install\]/m, 'only the timer is enabled');
  assert.doesNotMatch(service, /PartOf=|BindsTo=|kosmos-board/, 'not tied to the board unit, whose stop must not end it');
  assert.match(timer, /^OnCalendar=\*-\*-\* 08:00:00 UTC$/m);
  assert.match(timer, /^RandomizedDelaySec=2h$/m);
  assert.match(timer, /^Persistent=false$/m);
  assert.match(timer, new RegExp('^Unit=' + names.service.replace(/\./g, '\\.') + '$', 'm'));
  assert.match(timer, /^WantedBy=timers\.target$/m);
});

test('a Kosmos folder that would add a directive is refused; a port that is not a number never reaches the unit', () => {
  assert.throws(() => linuxboard.cloudUpdateUnitsFor('/home/user/kos\nExecStartPre=/bin/false', 17000));
  // Number() of it is NaN, so the board's own port is used, as boardUnitFor does.
  const { service } = linuxboard.cloudUpdateUnitsFor('/home/user/kos', '17000\nExecStartPre=/bin/false');
  assert.doesNotMatch(service, /ExecStartPre/);
  assert.match(service, new RegExp('^Environment="PORT=' + require('./create').boardPort() + '"$', 'm'));
});

test('installBoard on a Cloud box writes the nightly units and enables the timer', () => {
  const calls = [];
  linuxboard.setRunnerForTests(record(calls));
  linuxboard.setCloudForTests(() => true);
  const { tmp, home } = sandbox('cloudupdate-install-');
  try {
    const r = linuxboard.installBoard(home, 17000);
    assert.equal(r.ok, true);
    assert.deepEqual(r.cloudUpdate, { ok: true });
    const names = linuxboard.cloudUpdateNames(home);
    const want = linuxboard.cloudUpdateUnitsFor(home, 17000);
    assert.equal(fs.readFileSync(path.join(tmp, names.service), 'utf8'), want.service);
    assert.equal(fs.readFileSync(path.join(tmp, names.timer), 'utf8'), want.timer);
    const board = calls.indexOf('--user enable ' + linuxboard.boardUnitName(home));
    const timer = calls.indexOf('--user enable --now ' + names.timer);
    assert.ok(board > 0 && timer > board, 'enabled after the board: ' + calls.join(' | '));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CONTROL: installBoard off a Cloud box (or when the latch cannot be read) writes no nightly unit', () => {
  for (const cloud of [() => false, () => { throw new Error('unreadable'); }]) {
    const calls = [];
    linuxboard.setRunnerForTests(record(calls));
    linuxboard.setCloudForTests(cloud);
    const { tmp, home } = sandbox('cloudupdate-notcloud-');
    try {
      const r = linuxboard.installBoard(home, 17000);
      assert.equal(r.ok, true);
      assert.equal(r.cloudUpdate, null);
      const names = linuxboard.cloudUpdateNames(home);
      assert.equal(fs.existsSync(path.join(tmp, names.service)), false);
      assert.equal(fs.existsSync(path.join(tmp, names.timer)), false);
      assert.equal(calls.some((c) => c.includes('kosmos-cloud-update')), false, calls.join(' | '));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test('a refused nightly timer does not fail the board install, and says why', () => {
  linuxboard.setRunnerForTests((cmd, args) => (args.join(' ').includes('--now kosmos-cloud-update')
    ? { ok: false, stdout: '', stderr: 'Failed to enable unit: no\n' }
    : { ok: true, stdout: '' }));
  linuxboard.setCloudForTests(() => true);
  const { tmp, home } = sandbox('cloudupdate-refused-');
  try {
    const r = linuxboard.installBoard(home, 17000);
    assert.equal(r.ok, true, 'the board is installed');
    assert.deepEqual(r.pauseCheck, { ok: true }, 'the pause check is unaffected');
    assert.equal(r.cloudUpdate.ok, false);
    assert.match(r.cloudUpdate.because, /kosmos-cloud-update\.[0-9a-f]{8}\.timer.*Failed to enable unit: no/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('removeBoard removes the nightly units even off a Cloud box, stopping the timer but never the service', () => {
  const calls = [];
  linuxboard.setRunnerForTests(record(calls));
  linuxboard.setCloudForTests(() => false);
  const { tmp, home } = sandbox('cloudupdate-remove-');
  try {
    const names = linuxboard.cloudUpdateNames(home);
    for (const f of [linuxboard.boardUnitName(home), names.service, names.timer]) fs.writeFileSync(path.join(tmp, f), 'x');
    fs.mkdirSync(path.join(tmp, 'timers.target.wants'));
    fs.symlinkSync(path.join(tmp, 'gone', names.timer), path.join(tmp, 'timers.target.wants', names.timer));
    const r = linuxboard.removeBoard(home);
    assert.equal(r.ok, true);
    for (const f of [names.service, names.timer]) assert.equal(fs.existsSync(path.join(tmp, f)), false, f + ' was left');
    assert.equal(fs.lstatSync(path.join(tmp, 'timers.target.wants', names.timer), { throwIfNoEntry: false }), undefined);
    const timer = calls.indexOf('--user disable --now ' + names.timer);
    const board = calls.indexOf('--user stop ' + linuxboard.boardUnitName(home));
    assert.ok(timer >= 0 && board > timer, 'the timer goes before the board stops: ' + calls.join(' | '));
    assert.equal(calls.some((c) => c.includes('stop ' + names.service)), false,
      'an install the nightly run started is that service\'s child, and setup.sh can come through here while it runs');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
