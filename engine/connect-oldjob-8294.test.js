'use strict';
/* kosmos#8294: connect warns once, naming the job, when another login job looks like it starts this agent here. */
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
const register = require('./register');
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
  fs.writeFileSync(f, body, { mode: 0o755 });
  return f;
}

test('a job in the folder warns, names it and its file, and writes nothing', () => {
  const dir = agent('oldwd');
  plist('com.oldwd.discord', { dir });
  const out = discover.connect(dir, {});
  assert.equal(out.ok, false);
  assert.equal(out.otherJob, true);
  assert.match(out.because, /com\.oldwd\.discord/);
  assert.match(out.because, /two copies/);
  assert.match(out.because, /com\.oldwd\.discord\.plist/);
  assert.match(out.because, /press Add again/);
  assert.equal(installs, 0);
  assert.equal((store.readProfile('oldwd') || {}).dir, undefined);
});

test('pressing Add again goes ahead', () => {
  const dir = agent('anyway');
  plist('com.anyway.discord', { dir });
  const out = discover.connect(dir, { anyway: true });
  assert.equal(out.ok, true, out.because);
  assert.equal(installs, 1);
});

test('the route carries the second press, and the page sends it after the warning', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /anyway: body\.anyway === true/);
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.match(page, /row\.dataset\.otherJob \? \{ anyway: true \}/);
  assert.match(page, /if \(out && out\.otherJob\) row\.dataset\.otherJob = '1'; else delete row\.dataset\.otherJob;/);
});

test('a launch script naming the folder warns (the fleet shape)', () => {
  const dir = agent('oldscript');
  const f = script('launch-oldscript.sh', `WORK_DIR="${dir}"\ntmux new-session -c "$WORK_DIR" "claude --model x"\n`);
  plist('com.oldscript.discord', { args: ['/bin/bash', f] });
  assert.equal(register.foreignStarter(dir).label, 'com.oldscript.discord');
});

test('CONTROL: with no other job the folder connects', () => {
  const dir = agent('free');
  assert.equal(discover.connect(dir, {}).ok, true);
  assert.equal(installs, 1);
});

test('none: a job that does not name the program', () => {
  const dir = agent('webserver');
  plist('com.webserver.site', { dir, args: ['/usr/local/bin/node', 'server.js'] });
  assert.equal(register.foreignStarter(dir), null);
});

test('none: a backup that mentions ~/.claude, and a comment naming the program', () => {
  const dir = agent('backup');
  plist('com.backup.n', { args: ['/bin/bash', script('back.sh', `cd "${dir}"\nrsync -a ~/.claude /b\n# not claude\n`)] });
  assert.equal(register.foreignStarter(dir), null);
});

test('none: a scheduled job and a disabled job', () => {
  const dir = agent('sched');
  plist('com.sched.t', { args: ['/bin/bash', script('s.sh', `cd "${dir}"\nclaude\n`)], tail: '<key>StartInterval</key><integer>600</integer>' });
  plist('com.sched.d', { dir, tail: '<key>Disabled</key><true/><key>RunAtLoad</key><true/>' });
  assert.equal(register.foreignStarter(dir), null);
});

test('none: Kosmos\'s own job, a longer folder name, and a folder named after the program', () => {
  const dir = agent('baron');
  plist('com.kosmos.agent.baron', { dir });
  plist('com.two.a', { args: ['/bin/bash', script('two.sh', `cd "${dir}-two"\nclaude\n`)] });
  assert.equal(register.foreignStarter(dir), null);
  const named = agent('claude');
  plist('com.named.a', { args: ['/bin/bash', script('n.sh', `cd "${named}"\nnode s.js\n`)] });
  assert.equal(register.foreignStarter(named), null);
});

test('RunAtLoad only, KeepAlive only and KeepAlive as a dict each count', () => {
  for (const [name, tail] of [['ral', '<key>RunAtLoad</key><true/>'], ['ka', '<key>KeepAlive</key><true/>'], ['kad', '<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>']]) {
    const dir = agent(name);
    plist('com.' + name + '.x', { dir, tail });
    assert.equal(register.foreignStarter(dir).label, 'com.' + name + '.x', name);
  }
});

test('a linked folder, tmux -c in the arguments, and the runner\'s own program', () => {
  const dir = agent('linked');
  const link = path.join(SB, 'linkalias');
  fs.symlinkSync(dir, link);
  plist('com.linked.a', { dir: link });
  assert.equal(register.foreignStarter(dir).label, 'com.linked.a');
  fs.rmSync(path.join(LAUNCH, 'com.linked.a.plist'));
  const t = agent('tmuxargs');
  plist('com.tmuxargs.a', { args: ['/opt/homebrew/bin/tmux', 'new-session', '-c', t, 'claude'] });
  assert.equal(register.foreignStarter(t).label, 'com.tmuxargs.a');
  fs.rmSync(path.join(LAUNCH, 'com.tmuxargs.a.plist'));
  const c = agent('runnerword');
  plist('com.runnerword.a', { dir: c, args: ['/usr/local/bin/codex'] });
  assert.equal(register.foreignStarter(c), null);
  assert.equal(register.foreignStarter(c, 'codex').label, 'com.runnerword.a');
});

// kosmos#8378: folderSpellings adds the "$HOME/..." spelling only for a folder under HOME + '/', a POSIX separator,
// so on a Windows host (backslashes) the script's "$HOME/agents/homey" is never matched.
test('a home spelling', { skip: require('../test-support/skip-on-win32').skipOnWin32('it reads a launchd login job in ~/Library/LaunchAgents, which Windows does not have; the "$HOME/..." spelling is made only for a folder under HOME and a forward slash, which a Windows path never has') }, () => {
  const inHome = path.join(process.env.HOME, 'agents', 'homey');
  fs.mkdirSync(inHome, { recursive: true });
  plist('com.homey.a', { args: ['/bin/bash', script('homey.sh', 'cd "$HOME/agents/homey"\nclaude\n')] });
  assert.equal(register.foreignStarter(inHome).label, 'com.homey.a');
  fs.rmSync(path.join(LAUNCH, 'com.homey.a.plist'));
});

test('CONTROL: a session still up with no job is refused by the running check', () => {
  const dir = agent('stillup');
  status.setPaneSource(() => fleet.line({ session: 'stillup-discord', title: 'idle' }));
  assert.match(discover.connect(dir, {}).because, /already running under that name/);
  assert.equal(installs, 0);
});

test('the job is named even while the agent it started is up', () => {
  const dir = agent('upandjob');
  plist('com.upandjob.discord', { dir });
  status.setPaneSource(() => fleet.line({ session: 'upandjob-discord', title: 'idle' }));
  assert.match(discover.connect(dir, {}).because, /com\.upandjob\.discord/);
});
