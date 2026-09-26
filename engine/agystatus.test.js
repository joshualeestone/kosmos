'use strict';
/* #3568: engine/agystatus.js, is Gemini on a Google subscription (agy) ready on this Mac. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const agystatus = require('./agystatus');

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
  let asked = null;
  agystatus.setRunnerForTests((b, done) => { asked = b; done(null, 'ok\n'); });
  const r = await agystatus.check();
  assert.deepEqual(r, { installed: true, signedIn: true });
  assert.equal(asked, bin, 'it must ask the agy the resolver found');
  assert.equal(agystatus.installed().installed, true);
}));

test('installed but no answer (signed out, offline, slow): could not confirm, never a confident signed-out', () => withFakeAgy(async () => {
  agystatus.setRunnerForTests((b, done) => done(Object.assign(new Error('timed out'), { killed: true }), ''));
  const r = await agystatus.check();
  assert.equal(r.installed, true);
  assert.equal(r.signedIn, null, 'a failure must read as unknown, not signed out');
  assert.match(r.because, /may need signing in/);
  // CONTROL: an answer that is not "ok" is not signed in either.
  agystatus.setRunnerForTests((b, done) => done(null, 'Please sign in to continue'));
  assert.equal((await agystatus.check()).signedIn, null);
}));

test('two asks at once share one check (it costs a prompt on the person\'s subscription)', () => withFakeAgy(async () => {
  let runs = 0;
  agystatus.setRunnerForTests((b, done) => { runs += 1; setTimeout(() => done(null, 'ok'), 20); });
  const [a, b] = await Promise.all([agystatus.check(), agystatus.check()]);
  assert.equal(runs, 1);
  assert.equal(a.signedIn, true);
  assert.equal(b.signedIn, true);
}));

test('opening agy for sign-in: runs open -a Terminal on the agy found, and refuses when it is missing', () => withFakeAgy(async (bin) => {
  if (process.platform !== 'darwin') return;
  let opened = null;
  agystatus.setOpenerForTests((b, done) => { opened = b; done(null); });
  assert.deepEqual(await agystatus.openForSignIn(), { ok: true });
  assert.equal(opened, bin);
  agystatus.setOpenerForTests((b, done) => done(new Error('no Terminal')));
  const r = await agystatus.openForSignIn();
  assert.equal(r.ok, false);
  assert.match(r.because, /type agy|typing agy/);
  // CONTROL: missing agy is refused before anything is opened.
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = bin + '-gone/agy';
  opened = null;
  agystatus.setOpenerForTests((b, done) => { opened = b; done(null); });
  assert.equal((await agystatus.openForSignIn()).ok, false);
  assert.equal(opened, null);
}));
