'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

/* Sandbox EVERY root this module writes or reads before requiring it: the
   managed runners dir via its env seam, and the codex env override cleared
   so this machine's real state cannot leak into an assertion. The legacy
   Homebrew rung is machine state (this Mac genuinely has a codex there),
   so every call below pins it to a sandbox path via the legacyBin seam. */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-runners-'));
process.env.AGENT_WORKFORCE_RUNNERS_DIR = nodePath.join(SANDBOX, 'runners');
delete process.env.AGENT_WORKFORCE_CODEX_BIN;
const runners = require('./runners');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const LEGACY = nodePath.join(SANDBOX, 'legacy', 'codex'); // does not exist unless a test makes it
const MANAGED = nodePath.join(SANDBOX, 'runners', 'openai', 'codex');

const put = (p, body) => {
  fs.mkdirSync(nodePath.dirname(p), { recursive: true });
  fs.writeFileSync(p, body || '#!/bin/sh\nexit 0\n');
  fs.chmodSync(p, 0o755);
};

/* A real .tgz fixture with the npm layout (package/bin/<name>), built with
   the same /usr/bin/tar the module unpacks with, so the unpack step is
   exercised against genuine tar output rather than a synthetic stream. */
function fixtureTarball(binRel, body) {
  const dir = fs.mkdtempSync(nodePath.join(SANDBOX, 'fix-'));
  const binAbs = nodePath.join(dir, binRel);
  put(binAbs, body);
  const tgz = nodePath.join(dir, 'fixture.tgz');
  execFileSync('/usr/bin/tar', ['-czf', tgz, '-C', dir, binRel.split('/')[0]]);
  const integrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(tgz)).digest('base64');
  return { tgz, integrity };
}

/* The fixture download: copies known bytes into place and reports sizes the
   way the real one does. The REAL download function needs a live listener,
   which this sandbox forbids; the plan's live proof covers it. */
const downloadFrom = (src) => (url, file, job) => {
  const bytes = fs.readFileSync(src);
  job.totalBytes = bytes.length;
  job.receivedBytes = bytes.length;
  fs.writeFileSync(file, bytes);
  return Promise.resolve();
};

test('#979: resolution priority is env override, then managed, then legacy', () => {
  const envBin = nodePath.join(SANDBOX, 'env', 'codex');

  // Nothing anywhere: the answer is WHERE AN INSTALL WOULD LAND, absent.
  let r = runners.resolveBin('openai', { legacyBin: LEGACY });
  assert.equal(r.present, false);
  assert.equal(r.bin, MANAGED, 'absent resolution must name the managed path, never an empty string');

  // Legacy only.
  put(LEGACY);
  r = runners.resolveBin('openai', { legacyBin: LEGACY });
  assert.deepEqual({ bin: r.bin, present: r.present, managed: r.managed }, { bin: LEGACY, present: true, managed: false });

  // Managed beats legacy.
  put(MANAGED);
  r = runners.resolveBin('openai', { legacyBin: LEGACY });
  assert.deepEqual({ bin: r.bin, present: r.present, managed: r.managed }, { bin: MANAGED, present: true, managed: true });

  // Env override beats both.
  put(envBin);
  process.env.AGENT_WORKFORCE_CODEX_BIN = envBin;
  try {
    r = runners.resolveBin('openai', { legacyBin: LEGACY });
    assert.deepEqual({ bin: r.bin, present: r.present, managed: r.managed }, { bin: envBin, present: true, managed: false });
    // And it is AUTHORITATIVE, not a candidate: an override naming a
    // missing path answers that path as absent, never silently falling
    // through to a default the operator did not choose.
    process.env.AGENT_WORKFORCE_CODEX_BIN = nodePath.join(SANDBOX, 'env', 'no-such-codex');
    r = runners.resolveBin('openai', { legacyBin: LEGACY });
    assert.deepEqual({ bin: r.bin, present: r.present, managed: r.managed },
      { bin: nodePath.join(SANDBOX, 'env', 'no-such-codex'), present: false, managed: false });
  } finally {
    delete process.env.AGENT_WORKFORCE_CODEX_BIN;
    fs.rmSync(MANAGED, { force: true });
    fs.rmSync(LEGACY, { force: true });
  }
});

test('#979: a prototype-chain name from a URL is refused like any unknown provider', () => {
  const job = runners.install('constructor');
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /do not know/);
  const r = runners.resolveBin('constructor');
  assert.deepEqual(r, { bin: null, present: false, managed: false, overridden: false });
});

test('#979: an unknown provider resolves to nothing and installs to a refusal', () => {
  const r = runners.resolveBin('grok');
  assert.deepEqual(r, { bin: null, present: false, managed: false, overridden: false });
  const job = runners.install('grok');
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /do not know/);
});

test('#979: the happy path walks downloading, verifying, unpacking, proving, installed, and stages a runnable binary', async () => {
  const { tgz, integrity } = fixtureTarball('package/vendor/aarch64-apple-darwin/bin/codex', '#!/bin/sh\necho fake-codex 9.9.9\n');
  let provedBin = null;
  const job = runners.install('openai', {
    legacyBin: LEGACY,
    download: downloadFrom(tgz),
    integrity,
    prove: (bin, done) => { provedBin = bin; done(null, 'fake-codex 9.9.9\n'); },
  });
  await job.settled;
  assert.equal(job.phase, 'installed', job.because || '');
  assert.equal(job.proved, 'fake-codex 9.9.9');
  assert.equal(provedBin, MANAGED, 'the prove step must run the staged managed binary, not the archive member name');
  assert.ok(fs.existsSync(MANAGED), 'the binary lands at the managed path');
  assert.ok((fs.statSync(MANAGED).mode & 0o111) !== 0, 'and is executable');
  // The byte counts a progress bar reads were reported.
  assert.ok(job.receivedBytes > 0);
  assert.equal(job.receivedBytes, job.totalBytes);
  // And the resolver now sees it with no seams at all beyond the sandbox.
  const r = runners.resolveBin('openai', { legacyBin: LEGACY });
  assert.deepEqual({ bin: r.bin, present: r.present, managed: r.managed }, { bin: MANAGED, present: true, managed: true });
  fs.rmSync(MANAGED, { force: true });
});

test('#979: wrong bytes are refused by checksum, named, and the staging file is deleted', async () => {
  const { tgz } = fixtureTarball('package/vendor/aarch64-apple-darwin/bin/codex', '#!/bin/sh\necho tampered\n');
  const job = runners.install('openai', {
    legacyBin: LEGACY,
    download: downloadFrom(tgz),
    integrity: 'sha512-' + Buffer.alloc(64, 7).toString('base64'), // the RIGHT shape, the WRONG value
    prove: () => { throw new Error('prove must never run on refused bytes'); },
  });
  await job.settled;
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /did not match its published checksum/);
  assert.equal(fs.existsSync(MANAGED), false, 'nothing may be staged from refused bytes');
  const tmp = nodePath.join(SANDBOX, 'runners', '.tmp');
  assert.deepEqual(fs.existsSync(tmp) ? fs.readdirSync(tmp) : [], [], 'the staging file is gone');
});

test('#979: a runner that does not run is failed at the prove step, never reported installed', async () => {
  const { tgz, integrity } = fixtureTarball('package/vendor/aarch64-apple-darwin/bin/codex', 'not a program');
  const job = runners.install('openai', {
    legacyBin: LEGACY,
    download: downloadFrom(tgz),
    integrity,
    prove: (bin, done) => done(new Error('exec format error')),
  });
  await job.settled;
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /did not run/);
  assert.equal(fs.existsSync(MANAGED), false,
    'a failed prove must take the symlink down, or a broken runner reads as present');
});

test('#979: a download failure fails the job with the reason, not a hang or a lie', async () => {
  const job = runners.install('openai', {
    legacyBin: LEGACY,
    download: () => Promise.reject(new Error('the download answered 404')),
    prove: () => { throw new Error('prove must never run without bytes'); },
  });
  await job.settled;
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /404/);
});

test('#979: install is idempotent, a present runner answers installed without touching the network', () => {
  put(MANAGED);
  try {
    const job = runners.install('openai', {
      legacyBin: LEGACY,
      download: () => { throw new Error('a present runner must not download'); },
    });
    assert.equal(job.phase, 'installed');
  } finally {
    fs.rmSync(MANAGED, { force: true });
  }
});

test('#979: a second install request joins the running job instead of starting a rival download', async () => {
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const { tgz, integrity } = fixtureTarball('package/vendor/aarch64-apple-darwin/bin/codex', '#!/bin/sh\nexit 0\n');
  const first = runners.install('openai', {
    legacyBin: LEGACY,
    download: async (url, file, job) => { await gate; return downloadFrom(tgz)(url, file, job); },
    integrity,
    prove: (bin, done) => done(null, 'ok'),
  });
  const second = runners.install('openai', {
    legacyBin: LEGACY,
    download: () => { throw new Error('the second request must join, not download'); },
  });
  assert.equal(second, first, 'one job per provider while it runs');
  releaseFirst();
  await first.settled;
  assert.equal(first.phase, 'installed', first.because || '');
  fs.rmSync(MANAGED, { force: true });
});

test('#979: a truncated-but-clean download fails as truncation with byte counts, not as a tamper accusation', async () => {
  const job = runners.install('openai', {
    legacyBin: LEGACY,
    download: (url, file, j) => { j.totalBytes = 1000; j.receivedBytes = 400; fs.writeFileSync(file, 'short'); return Promise.resolve(); },
    prove: () => { throw new Error('prove must never run on a truncated download'); },
  });
  await job.settled;
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /ended early \(400 of 1000 bytes\)/);
  assert.doesNotMatch(job.because, /checksum/, 'a network fact must not be named as a tamper fact');
});

test('#979: an env override naming a missing path refuses install instead of staging bytes the resolver will never answer', () => {
  process.env.AGENT_WORKFORCE_CODEX_BIN = nodePath.join(SANDBOX, 'env', 'gone-codex');
  try {
    const job = runners.install('openai', {
      legacyBin: LEGACY,
      download: () => { throw new Error('no bytes may move behind a masking override'); },
    });
    assert.equal(job.phase, 'failed');
    assert.match(job.because, /operator override points the openai runner at .*gone-codex/);
  } finally {
    delete process.env.AGENT_WORKFORCE_CODEX_BIN;
  }
});

test('#979: the wrong CPU architecture is refused before a byte moves, naming the cause', () => {
  const job = runners.install('openai', {
    legacyBin: LEGACY,
    arch: 'x64',
    download: () => { throw new Error('no bytes may move for the wrong architecture'); },
  });
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /build is arm64 and this Mac is x64/);
  assert.match(job.because, /no download was attempted/);
});

test('#979: the real download function follows a redirect, and refuses non-200 and redirect storms', async () => {
  const { Readable } = require('node:stream');
  const { EventEmitter } = require('node:events');
  const fakeReq = () => { const r = new EventEmitter(); r.setTimeout = () => {}; r.destroy = () => {}; return r; };
  const respond = (cb, res) => { const q = fakeReq(); setImmediate(() => cb(res)); return q; };
  const body = (status, headers, chunks) => {
    const s = Readable.from(chunks || []);
    s.statusCode = status; s.headers = headers || {};
    s.resume = s.resume.bind(s);
    return s;
  };
  const dest = nodePath.join(SANDBOX, 'dl-out');

  // One redirect, then bytes: the file lands and counts are reported.
  let calls = 0;
  const job1 = { receivedBytes: 0, totalBytes: null };
  await runners.download('https://x.invalid/a', dest, job1, undefined, (url, cb) => {
    calls += 1;
    if (calls === 1) return respond(cb, body(302, { location: 'https://x.invalid/b' }));
    return respond(cb, body(200, { 'content-length': '5' }, [Buffer.from('hello')]));
  });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello');
  assert.equal(job1.receivedBytes, 5);
  assert.equal(job1.totalBytes, 5);

  // A non-200 terminal answer rejects with the status named.
  await assert.rejects(
    () => runners.download('https://x.invalid/nope', dest, { receivedBytes: 0 }, undefined, (url, cb) => respond(cb, body(404))),
    /the download answered 404/);

  // A redirect storm exhausts the valve and rejects rather than looping.
  await assert.rejects(
    () => runners.download('https://x.invalid/loop', dest, { receivedBytes: 0 }, undefined, (url, cb) => respond(cb, body(302, { location: 'https://x.invalid/loop' }))),
    /the download answered 302/);
});

test('#979: a manifest entry the resolver cannot answer is refused loudly, never downloaded invisibly', () => {
  // Injected through the opts.manifest seam: the shipped MANIFEST is
  // frozen (its url and integrity are trust anchors for bytes that get
  // executed), so a fixture entry rides beside it, never inside it.
  const job = runners.install('gemini', {
    manifest: { name: 'Gemini runner', version: '0.0.1', url: 'https://example.invalid/x.tgz', integrity: 'sha512-x', binInPackage: 'x', binName: 'gemini', downloadBytes: null },
    download: () => { throw new Error('no bytes may move for an unresolvable provider'); },
  });
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /no resolution rule yet/);
});

test('#979: the shipped manifest is frozen, its trust anchors cannot be repointed in-process', () => {
  assert.ok(Object.isFrozen(runners.MANIFEST));
  assert.ok(Object.isFrozen(runners.MANIFEST.openai));
  assert.throws(() => { runners.MANIFEST.openai.url = 'https://evil.example/x.tgz'; }, TypeError);
});

test('#979: a Confirm during the proving window joins the live job, never a synthetic installed', async () => {
  let releaseProve;
  const gate = new Promise((resolve) => { releaseProve = resolve; });
  const { tgz, integrity } = fixtureTarball('package/vendor/aarch64-apple-darwin/bin/codex', '#!/bin/sh\nexit 0\n');
  const first = runners.install('openai', {
    legacyBin: LEGACY,
    download: downloadFrom(tgz),
    integrity,
    prove: (bin, done) => { gate.then(() => done(null, 'ok')); },
  });
  // Wait until the symlink exists and the job is mid-prove: the exact
  // window where presence would lie. Break on failed so a regression
  // fails crisply instead of spinning to the runner timeout.
  while (first.phase !== 'proving' && first.phase !== 'failed') { await new Promise((r) => setTimeout(r, 5)); }
  assert.equal(first.phase, 'proving', first.because || '');
  assert.ok(fs.existsSync(MANAGED), 'the window is real: the symlink is up while prove is pending');
  const second = runners.install('openai', { legacyBin: LEGACY });
  assert.equal(second, first, 'mid-prove presence must not mint a synthetic installed');
  releaseProve();
  await first.settled;
  assert.equal(first.phase, 'installed', first.because || '');
  fs.rmSync(MANAGED, { force: true });
});

test('#979: the FIRST install on a fresh machine works, no directory pre-created by anything', async () => {
  /* The #979 target scenario exactly: a runners root nothing has ever
     touched (earlier tests in this file create runners/openai as a side
     effect, which once masked a fresh-machine ENOENT in the stray
     sweep). A dedicated pristine root keeps this path honest forever. */
  const FRESH = fs.mkdtempSync(nodePath.join(SANDBOX, 'fresh-root-'));
  process.env.AGENT_WORKFORCE_RUNNERS_DIR = nodePath.join(FRESH, 'runners');
  try {
    const { tgz, integrity } = fixtureTarball('package/vendor/aarch64-apple-darwin/bin/codex', '#!/bin/sh\necho fresh 1.0\n');
    const job = runners.install('openai', {
      legacyBin: LEGACY,
      download: downloadFrom(tgz),
      integrity,
      prove: (bin, done) => done(null, 'fresh 1.0'),
    });
    await job.settled;
    assert.equal(job.phase, 'installed', job.because || '');
    assert.ok(fs.existsSync(nodePath.join(FRESH, 'runners', 'openai', 'codex')));
  } finally {
    process.env.AGENT_WORKFORCE_RUNNERS_DIR = nodePath.join(SANDBOX, 'runners');
  }
});

test('#979: the already-present answer claims no version, nothing was downloaded or proved', () => {
  // This test is about a binary Kosmos did NOT install (hand-placed);
  // forget prior tests' job receipts so their truthful installed job
  // cannot stand in for it.
  runners.resetForTests();
  put(MANAGED);
  try {
    const job = runners.install('openai', { legacyBin: LEGACY });
    assert.equal(job.phase, 'installed');
    assert.equal(job.version, undefined, 'a present legacy binary may be any age; claiming the pin would be the status() overclaim again');
    assert.equal(job.receivedBytes, null);
  } finally {
    fs.rmSync(MANAGED, { force: true });
  }
});

test('#979: status reports the manifest facts and the honest null for an unmeasured size', () => {
  const s = runners.status();
  assert.ok(s.openai);
  assert.equal(s.openai.pinnedVersion, runners.MANIFEST.openai.version);
  assert.equal(s.openai.version, undefined, 'pinnedVersion, never a bare version claiming to describe the disk');
  // downloadBytes is either a measured number or null -- never undefined,
  // and never an invented value smuggled in as a default.
  assert.ok(s.openai.downloadBytes === null || typeof s.openai.downloadBytes === 'number');
  assert.equal(typeof s.openai.present, 'boolean');
});
