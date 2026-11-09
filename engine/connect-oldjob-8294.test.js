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
const fleet = require('../test-support/fleet');

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
function plist(label, { dir, args = ['/usr/local/bin/claude'], tail = '<key>KeepAlive</key><true/><key>RunAtLoad</key><true/>' } = {}) {
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
  assert.match(out.because, /remove its file/);
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

test('a keep-alive job working in the folder that does not start the agent does not block it', () => {
  const dir = agent('webserver');
  plist('com.webserver.site', { dir, args: ['/usr/local/bin/node', 'server.js'] });
  assert.equal(discover.connect(dir, {}).ok, true);
});

test('a path argument to some other program does not block it', () => {
  const dir = agent('watcher');
  plist('com.watcher.fs', { args: ['/opt/homebrew/bin/fswatch', dir] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('a backup script that mentions ~/.claude is not a start of Claude', () => {
  const dir = agent('backup');
  const f = script('back.sh', `cd "${dir}"\nrsync -a . /b\nrsync -a ~/.claude /b\n`);
  plist('com.backup.nightly', { args: ['/bin/bash', f] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('RunAtLoad only, KeepAlive only and KeepAlive as a dict each count', () => {
  for (const [name, tail] of [['ral', '<key>RunAtLoad</key><true/>'], ['ka', '<key>KeepAlive</key><true/>'], ['kad', '<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>']]) {
    const dir = agent(name);
    plist('com.' + name + '.x', { dir, tail });
    assert.equal(discover.otherJobFor(dir, LAUNCH).label, 'com.' + name + '.x', name);
  }
});

test('the common launcher shapes are found', () => {
  const dir = agent('shapes');
  for (const body of [`cd ${dir}; claude`, `cd ${dir}&&claude`]) {
    const f = script('sh-shape.sh', body + '\n');
    plist('com.shapes.a', { args: ['/bin/bash', f] });
    assert.equal(discover.otherJobFor(dir, LAUNCH).label, 'com.shapes.a', body);
  }
  plist('com.shapes.a', { args: ['/bin/bash', '-lc', `cd ${dir} && claude`] });
  assert.equal(discover.otherJobFor(dir, LAUNCH).label, 'com.shapes.a', 'inline');
  const home = process.env.HOME;
  const inHome = path.join(home, 'agents', 'homey');
  fs.mkdirSync(inHome, { recursive: true });
  const f = script('homey.sh', 'cd "$HOME/agents/homey"\nclaude\n');
  plist('com.homey.a', { args: ['/bin/bash', f] });
  assert.equal(discover.otherJobFor(inHome, LAUNCH).label, 'com.homey.a', 'home spelling');
});

test('a Codex job is judged by codex, a Claude job by claude', () => {
  const dir = agent('runnerword');
  plist('com.runnerword.a', { dir, args: ['/usr/local/bin/codex'] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
  assert.equal(discover.otherJobFor(dir, LAUNCH, 'codex').label, 'com.runnerword.a');
});

test('a named pipe as an argument does not hang the check', { skip: process.platform === 'win32' }, () => {
  const dir = agent('pipe');
  const fifo = path.join(SB, 'a.fifo');
  require('node:child_process').execFileSync('mkfifo', [fifo]);
  plist('com.pipe.a', { dir, args: ['/bin/cat', fifo] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('a commented-out key and a WorkingDirectory inside the environment do not count', () => {
  const dir = agent('comment');
  fs.writeFileSync(path.join(LAUNCH, 'com.comment.a.plist'),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.comment.a</string><key>EnvironmentVariables</key><dict><key>WorkingDirectory</key><string>${dir}</string></dict><key>ProgramArguments</key><array><string>/usr/local/bin/claude</string></array><key>RunAtLoad</key><true/></dict></plist>`);
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
  fs.writeFileSync(path.join(LAUNCH, 'com.comment.a.plist'),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>WorkingDirectory</key><string>${dir}</string><key>ProgramArguments</key><array><string>/usr/local/bin/claude</string></array><!-- <key>RunAtLoad</key><true/> --></dict></plist>`);
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('a comment naming Claude does not start it', () => {
  const dir = agent('commented');
  const f = script('tidy.sh', `# not claude related\ncd "${dir}"\nrsync . /b\n`);
  plist('com.commented.a', { args: ['/bin/bash', f] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('the Program key and the tilde spelling are read', () => {
  const inHome = path.join(process.env.HOME, 'agents', 'tilde');
  fs.mkdirSync(inHome, { recursive: true });
  const f = script('tilde.sh', 'cd ~/agents/tilde\nclaude\n');
  fs.writeFileSync(path.join(LAUNCH, 'com.tilde.a.plist'),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>Program</key><string>${f}</string><key>RunAtLoad</key><true/></dict></plist>`);
  assert.equal(discover.otherJobFor(inHome, LAUNCH).label, 'com.tilde.a');
});

test('another agent that only names this folder does not block it', () => {
  const dir = agent('named');
  plist('com.other.add', { dir: agent('otherhome'), args: ['/usr/local/bin/claude', '--add-dir', dir] });
  const copy = script('copy.sh', `cp -r "${dir}" /tmp/x\ncd /some/where\nclaude\n`);
  plist('com.other.copy', { args: ['/bin/bash', copy] });
  plist('com.other.mon', { args: ['/bin/bash', '-lc', `pgrep claude; du -sh ${dir}`] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('a folder named after the program is not a start of it', () => {
  const dir = agent('claude');
  const f = script('srv.sh', `cd "${dir}"\nnode server.js\n`);
  plist('com.claudefolder.srv', { args: ['/bin/bash', f] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('a named pipe called .plist does not hang the check', { skip: process.platform === 'win32' }, () => {
  const dir = agent('pipeplist');
  require('node:child_process').execFileSync('mkfifo', [path.join(LAUNCH, 'com.fifo.plist')]);
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('CONTROL: a session still up from the old launcher is already refused by the running check', () => {
  const dir = agent('stillup');
  status.setPaneSource(() => fleet.line({ session: 'stillup-discord', title: 'idle' }));
  const out = discover.connect(dir, {});
  assert.equal(out.ok, false, 'pane: ' + JSON.stringify(status.paneRoster()));
  assert.match(out.because, /already running under that name/);
  assert.equal(installs, 0);
});

test('a stopped job whose file is still there stays refused: it would load at the next login', () => {
  const dir = agent('stoppedfile');
  plist('com.stoppedfile.discord', { dir });
  assert.equal(discover.connect(dir, {}).ok, false);
  fs.rmSync(path.join(LAUNCH, 'com.stoppedfile.discord.plist'));
  assert.equal(discover.connect(dir, {}).ok, true);
});

test('--add-dir=, a backup variable, a cd elsewhere and a process check do not tie it here', () => {
  const dir = agent('tied');
  plist('com.a.one', { dir: agent('elsehome'), args: ['/usr/local/bin/claude', `--add-dir=${dir}`] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null, 'add-dir');
  fs.rmSync(path.join(LAUNCH, 'com.a.one.plist'));
  for (const [i, body] of [`BACKUP_DIR="${dir}"\ncd /else\nclaude\n`, `cd "${dir}"\ngit pull\ncd /else\nclaude\n`, `cd "${dir}"\npgrep -x claude || say down\n`].entries()) {
    const f = script('t' + i + '.sh', body);
    plist('com.a.two', { args: ['/bin/bash', f] });
    assert.equal(discover.otherJobFor(dir, LAUNCH), null, body);
  }
});

test('tmux -c spelled in the arguments is found', () => {
  const dir = agent('tmuxargs');
  plist('com.tmuxargs.a', { args: ['/opt/homebrew/bin/tmux', 'new-session', '-d', '-s', 'x', '-c', dir, 'claude'] });
  assert.equal(discover.otherJobFor(dir, LAUNCH).label, 'com.tmuxargs.a');
});

test('a script under a guarded folder is not opened', () => {
  const dir = agent('guarded');
  const docs = path.join(process.env.HOME, 'Documents');
  fs.mkdirSync(docs, { recursive: true });
  const f = path.join(docs, 'run.sh');
  fs.writeFileSync(f, `cd "${dir}"\nclaude\n`);
  plist('com.guarded.a', { args: ['/bin/bash', f] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('the job is named even while the agent it started is up', () => {
  const dir = agent('upandjob');
  plist('com.upandjob.discord', { dir });
  status.setPaneSource(() => fleet.line({ session: 'upandjob-discord', title: 'idle' }));
  assert.match(discover.connect(dir, {}).because, /com\.upandjob\.discord/);
});

test('a health check that says the word is not a start', () => {
  const dir = agent('health');
  const f = script('health.sh', 'echo claude is up\n');
  plist('com.health.a', { dir, args: ['/bin/bash', f] });
  assert.equal(discover.otherJobFor(dir, LAUNCH), null);
});

test('no job folder at all answers none', () => {
  assert.equal(discover.otherJobFor(agent('nodir'), path.join(SB, 'absent')), null);
});
