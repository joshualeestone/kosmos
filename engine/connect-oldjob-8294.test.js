'use strict';
/* kosmos#8294: connect refuses while another launchd job would start a second copy in the same folder. */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect8294-')));
process.env.HOME = path.join(SB, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
const LAUNCH = path.join(SB, 'launch');
process.env.AGENT_WORKFORCE_LAUNCH = LAUNCH;
fs.mkdirSync(path.join(process.env.HOME, '.claude', 'projects'), { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
fs.mkdirSync(LAUNCH, { recursive: true });

const create = require('./create');
create.setDryRun(true);
const discover = require('./discover');
const status = require('./status');
const store = require('./store');

let installs = 0;
const realInstall = create.installJob;
test.beforeEach(() => {
  status.setPaneSource(() => '');
  installs = 0;
  create.installJob = () => { installs += 1; return { ok: true, started: true }; };
  for (const f of fs.readdirSync(LAUNCH)) fs.rmSync(path.join(LAUNCH, f));
});
test.afterEach(() => { status.setPaneSource(null); create.installJob = realInstall; });
test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

function agent(name) {
  const dir = path.join(SB, 'theirs', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# You are ${name[0].toUpperCase()}${name.slice(1)}\n`);
  return dir;
}
function plist(label, { dir, args = ['/bin/bash'], tail = '<key>KeepAlive</key><true/><key>RunAtLoad</key><true/>' } = {}) {
  const wd = dir ? `<key>WorkingDirectory</key><string>${dir}</string>` : '';
  const a = args.map((x) => `<string>${x}</string>`).join('');
  fs.writeFileSync(path.join(LAUNCH, `${label}.plist`),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${label}</string>${wd}<key>ProgramArguments</key><array>${a}</array>${tail}</dict></plist>`);
}
function script(name, body) {
  const f = path.join(SB, name);
  fs.writeFileSync(f, body);
  return f;
}

test('a keep-alive job working in the folder refuses, names the job, and writes nothing', () => {
  const dir = agent('oldwd');
  plist('com.oldwd.discord', { dir });
  const out = discover.connect(dir, {});
  assert.equal(out.ok, false);
  assert.match(out.because, /com\.oldwd\.discord/);
  assert.match(out.because, /two copies/);
  assert.equal(installs, 0);
  assert.equal((store.readProfile('oldwd') || {}).dir, undefined);
});

test('a job that points at a launch script naming the folder refuses (the fleet shape)', () => {
  const dir = agent('oldscript');
  const f = script('launch-oldscript.sh', `WORK_DIR="${dir}"\ntmux new-session -c "$WORK_DIR" "claude --model x"\n`);
  plist('com.oldscript.discord', { args: ['/bin/bash', f] });
  const out = discover.connect(dir, {});
  assert.equal(out.ok, false);
  assert.match(out.because, /com\.oldscript\.discord/);
});

test('CONTROL: with no other job the same folder connects', () => {
  const dir = agent('free');
  const out = discover.connect(dir, {});
  assert.equal(out.ok, true, out.because);
  assert.equal(installs, 1);
});

test('a scheduled job in the folder does not block it', () => {
  const dir = agent('sched');
  plist('com.sched.tidy', { dir, tail: '<key>StartInterval</key><integer>600</integer>' });
  assert.equal(discover.connect(dir, {}).ok, true);
});

test('a disabled job does not block it', () => {
  const dir = agent('disabled');
  plist('com.disabled.discord', { dir, tail: '<key>Disabled</key><true/><key>RunAtLoad</key><true/>' });
  assert.equal(discover.connect(dir, {}).ok, true);
});

test('Kosmos\'s own job name is not "another job"', () => {
  const dir = agent('ours');
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
  plist('com.kosmos.agent.ours', { dir });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('a script that does not start Claude does not count', () => {
  const dir = agent('notclaude');
  const f = script('backup.sh', `rsync "${dir}" /backup\n`);
  plist('com.notclaude.backup', { args: ['/bin/bash', f] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('a longer folder name in a script is not this folder', () => {
  const dir = agent('baron');
  const f = script('launch-other.sh', `WORK_DIR="${dir}-two"\nclaude\n`);
  plist('com.barontwo.discord', { args: ['/bin/bash', f] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('a linked spelling of the folder is the same folder', () => {
  const dir = agent('linked');
  const link = path.join(SB, 'linkalias');
  fs.symlinkSync(dir, link);
  plist('com.linked.discord', { dir: link });
  assert.equal(discover.otherJobFor(dir, LAUNCH).label, 'com.linked.discord');
});

test('no job folder at all answers none', () => {
  assert.equal(discover.otherJobFor(agent('nodir'), path.join(SB, 'absent')), null);
});
