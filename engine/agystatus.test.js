'use strict';
/* #3568: engine/agystatus.js, is Gemini on a Google subscription (agy) ready on this Mac. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
/* Sandbox the data root BEFORE anything reads it (repo convention 2, review round 8): the round-4
   test below checks the real-record guard, and with this a regressed guard would touch a temp
   folder, never the person's own Kosmos folder. */
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'agystatus-data-'));
const agystatus = require('./agystatus');
test.after(() => agystatus.resetForTests());   // no stub outlives this file

function withFakeAgy(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agystatus-test-'));
  const bin = path.join(dir, 'agy');   // the basename must be agy (runners.resolveBin)
  fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const was = process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN;
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = bin;
  const done = () => {
    if (was === undefined) delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN; else process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = was;
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return Promise.resolve().then(() => fn(bin)).finally(done);
}

test('not installed: says so, and never runs anything', async () => {
  const was = process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN;
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = path.join(os.tmpdir(), 'no-such-dir-' + process.pid, 'agy');
  let ran = 0;
  agystatus.setRunnerForTests((bin, done) => { ran += 1; done(null, 'ok'); });
  try {
    const r = await agystatus.check();
    assert.equal(r.installed, false);
    assert.equal(r.signedIn, false);
    assert.equal(ran, 0, 'a missing agy was asked a question');
  } finally {
    if (was === undefined) delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN; else process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = was;
  }
});

test('installed and answering "ok": signed in', () => withFakeAgy(async (bin) => {
  if (process.platform !== 'darwin') return;   // offered on a Mac only
  let asked = null;
  agystatus.setRunnerForTests((b, done) => { asked = b; done(null, 'ok\n'); });
  const r = await agystatus.check();
  assert.deepEqual(r, { installed: true, signedIn: true });
  assert.equal(asked, bin, 'it must ask the agy the resolver found');
  assert.equal(agystatus.installed().installed, true);
}));

test('installed but no answer (signed out, offline, slow): could not confirm, never a confident signed-out', () => withFakeAgy(async () => {
  if (process.platform !== 'darwin') return;   // offered on a Mac only
  agystatus.setRunnerForTests((b, done) => done(Object.assign(new Error('timed out'), { killed: true }), ''));
  const r = await agystatus.check();
  assert.equal(r.installed, true);
  assert.equal(r.signedIn, null, 'a failure must read as unknown, not signed out');
  assert.match(r.because, /may need signing in/);
  // CONTROL: an answer that is not "ok" is not signed in either.
  agystatus.setRunnerForTests((b, done) => done(null, 'Please sign in to continue'));
  assert.equal((await agystatus.check()).signedIn, null);
  // Only the whole answer "ok" is signed in (review round 7).
  for (const said of ['Not ok', 'Please sign in. Press OK', 'ok, but first sign in']) {
    agystatus.setRunnerForTests((b, done) => done(null, said));
    assert.equal((await agystatus.check()).signedIn, null, JSON.stringify(said) + ' read as signed in');
  }
  agystatus.setRunnerForTests((b, done) => done(null, '  OK.\n'));
  assert.equal((await agystatus.check()).signedIn, true, 'CONTROL: a bare OK is signed in');
}));

test('two asks at once share one check (it costs a prompt on the person\'s subscription)', () => withFakeAgy(async () => {
  if (process.platform !== 'darwin') return;   // offered on a Mac only
  let runs = 0;
  agystatus.setRunnerForTests((b, done) => { runs += 1; setTimeout(() => done(null, 'ok'), 20); });
  const [a, b] = await Promise.all([agystatus.check(), agystatus.check()]);
  assert.equal(runs, 1);
  assert.equal(a.signedIn, true);
  assert.equal(b.signedIn, true);
}));

test('install: runs Google\'s installer only when agy is missing, and trusts only finding agy afterwards', async () => {
  if (process.platform !== 'darwin') return;
  assert.equal(agystatus.INSTALL_URL, 'https://antigravity.google/cli/install.sh', 'the installer URL is fixed to Google\'s own');
  // Already installed: nothing is run.
  await withFakeAgy(async () => {
    let runs = 0;
    agystatus.setInstallerForTests((done) => { runs += 1; done(null); });
    assert.deepEqual(await agystatus.install(), { ok: true, installed: true });
    assert.equal(runs, 0, 'an installed agy was installed again');
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-install-'));
  const bin = path.join(dir, 'agy');
  const was = process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN;
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = bin;
  try {
    // A board pointed at another home refuses, and runs nothing (review round 3).
    let ran = 0;
    agystatus.setInstallerForTests((done) => { ran += 1; done(null); });
    const refused = await agystatus.install();
    assert.equal(refused.ok, false);
    assert.match(refused.because, /different home/);
    assert.equal(ran, 0, 'a sandboxed board ran the installer');
    agystatus.allowSandboxInstallForTests(true);   // the rest drives the installer in this sandbox
    // The installer "succeeds" but puts nothing there: not installed, and it says so.
    agystatus.setInstallerForTests((done) => done(null));
    const empty = await agystatus.install();
    assert.equal(empty.ok, false);
    assert.match(empty.because, /not found/);
    // The installer fails: nothing changed.
    agystatus.setInstallerForTests((done) => done(new Error('curl: (6)')));
    assert.match((await agystatus.install()).because, /did not finish/);
    // The installer puts agy in place: installed.
    agystatus.setInstallerForTests((done) => { fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 }); done(null); });
    assert.deepEqual(await agystatus.install(), { ok: true, installed: true });
  } finally {
    agystatus.allowSandboxInstallForTests(false);
    if (was === undefined) delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN; else process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = was;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('not offered (switched off, or not a Mac): the screen is told so, and the check runs nothing', async () => {
  const was = process.env.AGENT_WORKFORCE_ANTIGRAVITY;
  process.env.AGENT_WORKFORCE_ANTIGRAVITY = '0';
  let ran = 0;
  agystatus.setRunnerForTests((b, done) => { ran += 1; done(null, 'ok'); });
  try {
    const s = agystatus.installedForScreen();
    assert.equal(s.enabled, false);
    assert.equal(s.installed, false, 'a switched-off runner must not read as installed');
    const r = await agystatus.check();
    assert.equal(r.offered, false);
    assert.equal(ran, 0);
    assert.equal((await agystatus.install()).ok, false);
  } finally { if (was === undefined) delete process.env.AGENT_WORKFORCE_ANTIGRAVITY; else process.env.AGENT_WORKFORCE_ANTIGRAVITY = was; }
});

test('#3998: the last confident answer is remembered for the account row, and "could not confirm" never overwrites it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-last-'));
  agystatus.setLastFileForTests(() => path.join(dir, 'last.json'));
  try {
    assert.equal(agystatus.lastKnown(), null, 'CONTROL: nothing before any answer');
    agystatus.remember({ installed: true, signedIn: true });
    assert.equal(agystatus.lastKnown().signedIn, true);
    agystatus.remember({ installed: true, signedIn: null, because: 'may need signing in' });
    assert.equal(agystatus.lastKnown().signedIn, true, 'an unconfirmed check erased a known sign-in');
    agystatus.remember({ installed: false, signedIn: false });
    assert.equal(agystatus.lastKnown().signedIn, false, 'an uninstalled agy still read as signed in');
    agystatus.forget();
    assert.equal(agystatus.lastKnown(), null, 'forget left the row behind');
    agystatus.remember({ installed: false, signedIn: false, offered: false });
    assert.equal(agystatus.lastKnown(), null, '"not offered here" was remembered as a signed-out sign-in');
  } finally { agystatus.setLastFileForTests(null); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#3998 review round 4: a test process never reads or writes the real board\'s remembered sign-in', () => {
  const real = path.join(require('./store').ROOT, 'agy-signin', 'last.json');
  const before = fs.existsSync(real) ? fs.readFileSync(real, 'utf8') : null;
  agystatus.setLastFileForTests(null);
  agystatus.remember({ installed: true, signedIn: true });
  assert.equal(fs.existsSync(real) ? fs.readFileSync(real, 'utf8') : null, before, 'a test wrote the person\'s own record');
  assert.equal(agystatus.lastKnown(), null, 'a test read the person\'s own record');
  agystatus.forget();
  assert.equal(fs.existsSync(real) ? fs.readFileSync(real, 'utf8') : null, before, 'a test removed the person\'s own record');
});
