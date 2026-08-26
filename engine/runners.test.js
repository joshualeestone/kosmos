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
    /redirected too many times/);
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

/* ---- the Claude (vendor-verified) kind, #979 branch A ---------------- */

const CLAUDE_HOME = nodePath.join(SANDBOX, 'claude-home');
const CANONICAL = nodePath.join(CLAUDE_HOME, '.local', 'bin', 'claude');

test('#979: claude resolution is env-authoritative, then the vendor canonical path, sandboxed via AGENT_WORKFORCE_HOME', () => {
  // Save-and-restore, like every other Claude test in this file. This one is
  // the FIRST to run, which is exactly the case the shared helper's comment
  // was written to survive: a delete here would silently clear a value a
  // future preamble sets, and nothing would fail to say so.
  const prevHome = process.env.AGENT_WORKFORCE_HOME;
  const prevBin = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_HOME = CLAUDE_HOME;
  try {
    // Nothing anywhere: the canonical path is named, absent.
    let r = runners.resolveBin('claude');
    assert.deepEqual(r, { bin: CANONICAL, present: false, managed: false, overridden: false });
    // Canonical present.
    put(CANONICAL);
    r = runners.resolveBin('claude');
    assert.deepEqual(r, { bin: CANONICAL, present: true, managed: false, overridden: false });
    // Env override is authoritative, present or not.
    const envClaude = nodePath.join(SANDBOX, 'env', 'claude');
    process.env.AGENT_WORKFORCE_CLAUDE_BIN = envClaude;
    r = runners.resolveBin('claude');
    assert.deepEqual(r, { bin: envClaude, present: false, managed: false, overridden: true });
    put(envClaude);
    r = runners.resolveBin('claude');
    assert.deepEqual(r, { bin: envClaude, present: true, managed: false, overridden: true });
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = prevHome;
    if (prevBin === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    else process.env.AGENT_WORKFORCE_CLAUDE_BIN = prevBin;
    fs.rmSync(CANONICAL, { force: true });
  }
});

/* ── the vendor-verified install ──────────────────────────────────────────
   ⚠️ THESE TESTS REPLACED A SET THAT DROVE A `curl | sh` INSTALLER. That
   mechanism was removed in review: engine/connect.js already installs
   Claude Code against a published per-platform SHA256, so a second
   unverified path for the same product had no right to exist. What is
   seamed here is the DELEGATION to that verified fetch, not a re-implementation
   of it -- connect.js owns and tests the checksum and redirect refusals.

   Every test save-and-restores AGENT_WORKFORCE_HOME rather than deleting it,
   so a future preamble that sets it is not silently cleared by the first
   Claude test to run. */

const withClaudeHome = async (fn) => {
  const prevHome = process.env.AGENT_WORKFORCE_HOME;
  const prevBin = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_HOME = CLAUDE_HOME;
  runners.resetForTests();
  try {
    return await fn();
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = prevHome;
    if (prevBin === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    else process.env.AGENT_WORKFORCE_CLAUDE_BIN = prevBin;
    fs.rmSync(CANONICAL, { recursive: true, force: true });
  }
};

test('#979: with no claude anywhere, the install REFUSES in words and never claims installed', async () => {
  await withClaudeHome(async () => {
    const job = runners.install('claude', {
      findElsewhere: () => null,
      prove: () => { throw new Error('prove must never run when nothing was installed'); },
    });
    await job.settled;
    assert.equal(job.phase, 'failed');
    // The refusal has to be usable by a person, not just non-crashing: it
    // says what Kosmos can do and what they can do. A dead end that does
    // not explain itself is the thing the provider ruling exists to kill.
    // Leads with what happened, not with a tautology: the house rule on
    // writing to a person is to say what happened and what it means for them.
    assert.match(job.because, /^We could not find Claude Code on this Mac\./);
    assert.match(job.because, /cannot download one yet/);
    assert.match(job.because, /Install Claude Code yourself/);
    assert.equal(job.receivedBytes, null, 'nothing was downloaded, so no count is invented');
  });
});

test('#979: the refusal path reaches no NETWORK -- connect.download is never called', async () => {
  /* The guard against #997 being half-reintroduced by accident. Two earlier
     versions of this branch reached the network here: one curl|sh, one a
     borrowed download that shared a directory with the sign-in flow. If a
     future edit puts either back without the shared-install work, this fails.

     ⚠️ ITS NAME USED TO SAY "spawns NOTHING -- no fetch, no child, no shell",
     AND THAT WAS FALSE TWICE OVER. The production refusal path DOES spawn a
     child: the default findElsewhere runs `/usr/bin/which`. And seaming
     findElsewhere out -- as this test must, to stay off the operator's real
     machine -- removes the only child there is, so the fixture was supplying
     the very premise the title claimed to verify. It is named for what it
     actually pins now. The no-child claim is not made anywhere, because it is
     not true. */
  await withClaudeHome(async () => {
    const connect = require('./connect');
    const realDownload = connect.download;
    let touched = 0;
    connect.download = () => { touched += 1; throw new Error('must not download on this branch'); };
    try {
      const job = runners.install('claude', { findElsewhere: () => null });
      await job.settled;
      assert.equal(job.phase, 'failed');
      assert.equal(touched, 0, 'the refusal path must not reach connect.download()');
    } finally {
      connect.download = realDownload;
    }
  });
});

test('#979: a claude found elsewhere is LINKED, not downloaded, and a failed prove takes the link down', async () => {
  const elsewhere = nodePath.join(SANDBOX, 'elsewhere', 'claude');
  put(elsewhere, '#!/bin/sh\necho claude 8.8\n');
  await withClaudeHome(async () => {
    const job = runners.install('claude', {
      findElsewhere: () => elsewhere,
      prove: (bin, done) => done(null, 'claude 8.8'),
    });
    await job.settled;
    assert.equal(job.phase, 'installed', job.because || '');
    assert.equal(job.linked, elsewhere);
    assert.equal(fs.readlinkSync(CANONICAL), elsewhere, 'the canonical path is a link to the found install');

    // And the teardown: a link whose prove fails must come down. Asserted
    // present first, so "it is gone" is proof of a teardown rather than of
    // a link that was never made.
    runners.resetForTests();
    assert.equal(fs.existsSync(CANONICAL), true, 'the link is there before the teardown case runs');
    fs.rmSync(CANONICAL, { force: true });
    const bad = runners.install('claude', {
      findElsewhere: () => elsewhere,
      prove: (bin, done) => done(new Error('exec format error')),
    });
    await bad.settled;
    assert.equal(bad.phase, 'failed');
    // ⚠️ PIN THE FAILURE TO THE PROVE STEP. Without these two, the assertion
    // below passes just as well when the link was never made at all (a
    // clearForLink refusal, say) -- "it is gone" would then be true of
    // something that was never there, which proves no teardown ran.
    assert.equal(bad.linked, null, 'the linked field comes down with the link it names');
    assert.match(bad.because, /did not run/, 'it failed at prove, which is the branch under test');
    assert.equal(fs.existsSync(CANONICAL), false, 'a broken link must not read as present');
  });
});

test('#979: the link step REFUSES a canonical path it does not own, by name, instead of deleting it', async () => {
  const elsewhere = nodePath.join(SANDBOX, 'elsewhere', 'claude');
  put(elsewhere);
  // A real file at the canonical path -- e.g. the truncated launcher a
  // crashed connect.js install leaves behind. The version this replaces
  // did rmSync(force) here and destroyed it.
  await withClaudeHome(async () => {
    fs.mkdirSync(nodePath.dirname(CANONICAL), { recursive: true });
    fs.writeFileSync(CANONICAL, 'a real vendor file');
    fs.chmodSync(CANONICAL, 0o644); // not runnable, which is how we reach the link branch
    const job = runners.install('claude', {
      findElsewhere: () => elsewhere,
      prove: () => { throw new Error('prove must never run after a refusal'); },
    });
    await job.settled;
    assert.equal(job.phase, 'failed');
    assert.match(job.because, /already exists and is not something we put there/);
    assert.equal(fs.readFileSync(CANONICAL, 'utf8'), 'a real vendor file',
      'the file we did not put there is still on disk');
  });
});

test('#979: a DIRECTORY at the canonical path is refused in words, not as a raw errno', async () => {
  const elsewhere = nodePath.join(SANDBOX, 'elsewhere', 'claude');
  put(elsewhere);
  await withClaudeHome(async () => {
    fs.mkdirSync(CANONICAL, { recursive: true });
    const job = runners.install('claude', {
      findElsewhere: () => elsewhere,
      prove: () => { throw new Error('prove must never run after a refusal'); },
    });
    await job.settled;
    assert.equal(job.phase, 'failed');
    assert.match(job.because, /is a folder, not a runner/);
    assert.doesNotMatch(job.because, /EISDIR|ERR_FS/, 'a person must not be shown an errno');
  });
});

test('#979: the arch guard does not apply to the vendor-external kind', async () => {
  await withClaudeHome(async () => {
    const job = runners.install('claude', {
      arch: 'x64', // would refuse the tarball kind; the vendor manifest is per-platform
      findElsewhere: () => null,
    });
    await job.settled;
    assert.equal(job.phase, 'failed');
    assert.doesNotMatch(job.because, /arm64|x64/, 'the refusal must not be an arch refusal');
    assert.match(job.because, /could not find Claude Code/, 'it reaches the kind\'s own refusal, not the arch guard');
  });
});

test('#979: present means RUNNABLE, a directory or stripped file at a runner path reads absent (#133 trap)', () => {
  const prevHome = process.env.AGENT_WORKFORCE_HOME;
  const prevBin = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_HOME = CLAUDE_HOME;
  try {
    fs.mkdirSync(CANONICAL, { recursive: true }); // a DIRECTORY at the runner path
    let r = runners.resolveBin('claude');
    assert.equal(r.present, false, 'a directory must not read as a runnable runner');
    fs.rmSync(CANONICAL, { recursive: true, force: true });
    put(CANONICAL); fs.chmodSync(CANONICAL, 0o644); // a file with no exec bit
    r = runners.resolveBin('claude');
    assert.equal(r.present, false, 'a stripped file must not read as a runnable runner');
    // And the positive control, so "absent" above is a real verdict rather
    // than a path that could never read present.
    fs.chmodSync(CANONICAL, 0o755);
    assert.equal(runners.resolveBin('claude').present, true, 'a runnable file at the same path DOES read present');
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = prevHome;
    if (prevBin === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    else process.env.AGENT_WORKFORCE_CLAUDE_BIN = prevBin;
    fs.rmSync(CANONICAL, { recursive: true, force: true });
  }
});

test('#979: create.binPaths().claudeBin IS the resolver, so the two cannot drift', () => {
  const prevHome = process.env.AGENT_WORKFORCE_HOME;
  const prevBin = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_HOME = CLAUDE_HOME;
  try {
    // The consolidation's whole point. The create.js suites all pass
    // claudeBin explicitly, so nothing there exercises the default arm
    // this branch changed; this is the assertion that does.
    assert.equal(require('./create').binPaths().claudeBin, runners.resolveBin('claude').bin);
    // And it honours the sandbox seam on both sides, not just one.
    assert.equal(require('./create').binPaths().claudeBin, CANONICAL);
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = prevHome;
    if (prevBin === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    else process.env.AGENT_WORKFORCE_CLAUDE_BIN = prevBin;
  }
});

test('#979/#133: a codex binary that is not executable BY US reads absent, on every rung', () => {
  /* isRunnable replaced existsSync on the OpenAI rungs too, which is a live
     behavior change on a path this branch is otherwise not about: a
     partially-extracted managed runner, or a root-owned 0o700 codex, used to
     read present and then fail at launch. Asserted here because the #133
     test above only covers the claude rung, and an untested behavior change
     is how a fix becomes a regression. */
  const prevBin = process.env.AGENT_WORKFORCE_CODEX_BIN;
  const spot = nodePath.join(SANDBOX, 'codexmode', 'codex');
  try {
    put(spot);
    process.env.AGENT_WORKFORCE_CODEX_BIN = spot;
    // Positive control FIRST, so "absent" below is a verdict about the mode
    // bits rather than about a path that could never read present.
    assert.equal(runners.resolveBin('openai').present, true, 'a runnable codex reads present');
    fs.chmodSync(spot, 0o644);
    assert.equal(runners.resolveBin('openai').present, false, 'a non-executable codex reads absent');
    fs.rmSync(spot, { force: true });
    fs.mkdirSync(spot, { recursive: true });
    assert.equal(runners.resolveBin('openai').present, false, 'a directory at the codex path reads absent');
  } finally {
    if (prevBin === undefined) delete process.env.AGENT_WORKFORCE_CODEX_BIN;
    else process.env.AGENT_WORKFORCE_CODEX_BIN = prevBin;
    fs.rmSync(spot, { recursive: true, force: true });
  }
});
