'use strict';
/* #6004: installing Muse Code from inside Kosmos. The real installer is never run here: the seam is replaced with a
   fake that writes (or does not write) the launcher where Kosmos looks, which is AGENT_WORKFORCE_MUSE_BIN in this
   sandbox. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-install-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
const BIN = path.join(SANDBOX, 'bin', 'muse');
process.env.AGENT_WORKFORCE_MUSE_BIN = BIN;
delete process.env.AGENT_WORKFORCE_MUSE;
const museinstall = require('./museinstall');
test.after(() => { museinstall.resetForTests(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const writeLauncher = () => { fs.mkdirSync(path.dirname(BIN), { recursive: true }); fs.writeFileSync(BIN, '#!/bin/sh\nexit 0\n', { mode: 0o755 }); };
function setup({ platform = 'darwin', sandboxOk = true } = {}) {
  fs.rmSync(path.dirname(BIN), { recursive: true, force: true });
  museinstall.resetForTests();
  museinstall.setPlatformForTests(platform);
  museinstall.allowSandboxInstallForTests(sandboxOk);
  const calls = { n: 0 };
  return calls;
}

test('#6004: a working installer puts Muse Code where Kosmos looks, and the answer says installed', async () => {
  const calls = setup();
  museinstall.setInstallerForTests((done) => { calls.n += 1; writeLauncher(); setImmediate(() => done(null)); });
  const r = await museinstall.install();
  assert.deepEqual(r, { ok: true, installed: true });
  assert.equal(calls.n, 1);
});

test('#6004: two presses at once share one run', async () => {
  const calls = setup();
  museinstall.setInstallerForTests((done) => { calls.n += 1; setTimeout(() => { writeLauncher(); done(null); }, 30); });
  const [a, b] = await Promise.all([museinstall.install(), museinstall.install()]);
  assert.deepEqual(a, { ok: true, installed: true });
  assert.deepEqual(b, { ok: true, installed: true });
  assert.equal(calls.n, 1, 'the installer ran twice for two presses at once');
});

test('#6004: already installed runs nothing', async () => {
  const calls = setup();
  writeLauncher();
  museinstall.setInstallerForTests((done) => { calls.n += 1; done(null); });
  assert.deepEqual(await museinstall.install(), { ok: true, installed: true });
  assert.equal(calls.n, 0, 'the installer ran with Muse Code already there');
});

test('#6004: an installer that fails, or finishes without the launcher, says which, and nothing is claimed', async () => {
  let calls = setup();
  museinstall.setInstallerForTests((done) => { calls.n += 1; done(new Error('exit 1')); });
  let r = await museinstall.install();
  assert.equal(r.ok, false);
  assert.equal(r.installed, false);
  assert.match(r.because, /did not finish/);
  calls = setup();
  museinstall.setInstallerForTests((done) => { calls.n += 1; done(null); });
  r = await museinstall.install();
  assert.equal(r.ok, false);
  assert.match(r.because, /not found where it installs/);
});

test('#6004: refused, with nothing run, off a Mac, when switched off, and on a board with a different home', async () => {
  const cases = [
    [{ platform: 'win32' }, null, /not available on this computer/],
    [{ platform: 'linux' }, null, /not available on this computer/],
    [{}, () => { process.env.AGENT_WORKFORCE_MUSE = '0'; }, /switched off/],
    [{ sandboxOk: false }, null, /different home/],
  ];
  for (const [opts, before, because] of cases) {
    const calls = setup(opts);
    if (before) before();
    museinstall.setInstallerForTests((done) => { calls.n += 1; writeLauncher(); done(null); });
    try {
      const r = await museinstall.install();
      assert.equal(r.ok, false, JSON.stringify(opts));
      assert.match(r.because, because);
      assert.equal(calls.n, 0, 'the installer ran though it was refused: ' + JSON.stringify(opts));
    } finally { delete process.env.AGENT_WORKFORCE_MUSE; }
  }
  // CONTROL: the same setup allowed runs the installer, so the refusals above are the guards, not a broken fake.
  const calls = setup();
  museinstall.setInstallerForTests((done) => { calls.n += 1; writeLauncher(); done(null); });
  assert.equal((await museinstall.install()).ok, true);
  assert.equal(calls.n, 1);
});

test('#6004: the installer gets only what an installer needs, stays out of shell profiles, and installs where Kosmos looks', () => {
  const env = museinstall.installerEnv({ PATH: '/usr/bin:/bin', HOME: '/Users/x', SHELL: '/bin/zsh', OPENAI_API_KEY: 'sk-secret',
    AGENT_WORKFORCE_TOKEN: 'tok', KOSMOS_PORT: '16180' });
  assert.equal(env.MUSE_NO_MODIFY_PATH, '1', 'Meta\'s installer would add a PATH line to the person\'s ~/.zshrc');
  assert.equal(env.MUSE_INSTALL_DIR, path.join(os.homedir(), '.local', 'bin'));
  assert.equal(env.PATH, '/usr/bin:/bin');
  for (const k of ['OPENAI_API_KEY', 'AGENT_WORKFORCE_TOKEN', 'KOSMOS_PORT']) assert.equal(env[k], undefined, k + ' reached Meta\'s installer');
  assert.equal(museinstall.INSTALL_URL, 'https://dev.meta.ai/install.sh');
});

test('#6004: the real run gives Meta\'s installer only installerEnv(), refuses http redirects, and runs the saved script with bash', async () => {
  setup();
  museinstall.resetForTests();
  museinstall.setPlatformForTests('darwin');
  museinstall.allowSandboxInstallForTests(true);
  const calls = [];
  museinstall.setExecForTests((cmd, args, opts, cb) => {
    calls.push({ cmd, args, env: opts.env });
    if (cmd === '/usr/bin/curl') { fs.writeFileSync(args[args.indexOf('-o') + 1], '#!/bin/sh\nexit 0\n'); setImmediate(() => cb(null)); return {}; }
    writeLauncher(); setImmediate(() => cb(null)); return { stdin: { end() {} } };
  });
  process.env.KOSMOS_SECRET_FOR_TEST = 'board-only';
  try {
    assert.deepEqual(await museinstall.install(), { ok: true, installed: true });
  } finally { delete process.env.KOSMOS_SECRET_FOR_TEST; museinstall.setExecForTests(null); }
  const curl = calls.find((c) => c.cmd === '/usr/bin/curl');
  const bash = calls.find((c) => c.cmd === '/bin/bash');
  assert.ok(curl && bash, 'the real run did not fetch and then run the installer: ' + JSON.stringify(calls.map((c) => c.cmd)));
  assert.ok(curl.args.includes('--proto-redir') && curl.args[curl.args.indexOf('--proto-redir') + 1] === '=https', 'an http redirect would be followed');
  assert.ok(curl.args.includes('--proto') && curl.args[curl.args.indexOf('--proto') + 1] === '=https', 'a plain http fetch would be allowed');
  assert.equal(curl.args[curl.args.length - 1], museinstall.INSTALL_URL);
  assert.equal(bash.env.MUSE_NO_MODIFY_PATH, '1', 'the installer was not kept out of shell profiles');
  assert.equal(bash.args[0], curl.args[curl.args.indexOf('-o') + 1], 'bash ran a different file from the one curl saved');
  assert.equal(bash.env.MUSE_INSTALL_DIR, path.join(os.homedir(), '.local', 'bin'), 'the installer was not told where Kosmos looks');
  assert.equal(bash.env.KOSMOS_SECRET_FOR_TEST, undefined, 'the board\'s own environment reached Meta\'s installer');
});

test('#6004: inside a test process, with the real seams, Meta\'s installer is never run', async () => {
  setup();
  museinstall.resetForTests();   // the real runInstall and exec, as a forgetful future test would leave them
  museinstall.setPlatformForTests('darwin');
  museinstall.allowSandboxInstallForTests(true);
  const r = await museinstall.install();
  assert.equal(r.ok, false);
  assert.match(r.because, /from a test/, 'a test process would have fetched and run Meta\'s real installer');
});
