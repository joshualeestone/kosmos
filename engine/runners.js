'use strict';

/**
 * Provider runners (#979): the machinery that puts a provider's terminal
 * agent onto this Mac, with a flow a person can watch.
 *
 * Josh, live on his fresh Mac Mini (2026-08-26): picked OpenAI, pasted a
 * key, hit Add, and nothing visibly happened -- because addWithKey()
 * hard-refuses when codex is missing, install/setup.sh never provisions
 * it, and the only probe path assumed Homebrew. A fresh Mac could not
 * connect OpenAI at all. His ruling on the fix (recorded on #979): no
 * giant downloads or blocking connections in the normal flow -- announce
 * what needs installing, confirm, show progress, say "done", THEN ask for
 * the credential.
 *
 * This module owns three things, and the wizard's screens bind to them:
 *
 *   1. RESOLUTION -- resolveBin(): ONE priority list for where a runner
 *      lives. It used to exist twice (server.js's add route and
 *      create.js's binPaths), each hardcoding its own default, which is
 *      half of how the dead end shipped.
 *   2. A PINNED MANIFEST -- what exactly we install, from where, with the
 *      vendor's own published integrity value. Same doctrine as the
 *      bundled Node ("PINNED, not latest: the bundle must not change
 *      under us because a release day happened").
 *   3. AN INSTALL JOB with observable state -- download, verify, unpack,
 *      PROVE, each step readable at any time, so the screen can show a
 *      real progress bar and a real "done" instead of a spinner over a
 *      mystery.
 *
 * ⚠️ The Claude question is deliberately NOT answered here. Whether
 * Claude Code joins this provider shape or stays a platform install is an
 * open ruling of Josh's (asked 2026-08-26 09:48, both branches held on
 * #979). The manifest is shaped so either answer is an entry, not a
 * rewrite.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

const HOME = os.homedir();

/**
 * The pinned artifacts, one per provider this machinery knows how to
 * install. npm's registry publishes a sha512 integrity for every tarball
 * it serves, which makes it the one codex channel with a VENDOR-published
 * checksum (the GitHub release assets for darwin carry none) -- so the
 * npm platform tarball is the source, fetched directly with no npm client
 * involved (the shipped runtime deliberately carries only `node`).
 *
 * The darwin-arm64 build is published as a VERSION of @openai/codex
 * itself (0.149.1-darwin-arm64), not as a real sub-package -- the
 * @openai/codex-darwin-arm64 name in its optionalDependencies is an npm
 * alias. Verified against the live registry 2026-08-26; the version
 * document's dist.integrity is what is pinned below.
 *
 * ⚠️ THE WHOLE PACKAGE IS STAGED, NOT ONE FILE. The tarball was opened
 * and read (2026-08-26) before this shape was chosen: the binary lives at
 * package/vendor/aarch64-apple-darwin/bin/codex WITH vendored siblings it
 * resolves relative to itself (codex-path/rg, codex-resources/zsh,
 * bin/codex-code-mode-host). Extracting the one binary would strand it
 * from its own tools, so the install unpacks the package tree and exposes
 * ONE stable path -- a `codex` symlink beside it -- which is what the
 * resolver, create.js, and addWithKey all use. `binInPackage` names the
 * executable inside the unpacked tree; `downloadBytes` is the MEASURED
 * compressed size of that exact tarball (114,152,335 bytes, curl,
 * 2026-08-26), for the screen's "x of y".
 */
// Null prototype: `provider` arrives from a URL path, and a plain literal
// would answer the prototype chain for names like "constructor" -- a
// lookup that passes a truthiness guard with a value that is not a
// manifest entry at all. The jobs map below is null-prototyped for the
// same reason.
const MANIFEST = Object.assign(Object.create(null), {
  openai: {
    name: 'OpenAI runner',
    version: '0.149.1',
    url: 'https://registry.npmjs.org/@openai/codex/-/codex-0.149.1-darwin-arm64.tgz',
    integrity: 'sha512-6X84kTCbnTgPIJ2EdcPsrvwS0Wxsqpa+bCswGmRf4BjhcQ5nPMnBC6yCAaCMj+vrbXQHj+L6sa9FaR4QkmA1qw==',
    binInPackage: 'vendor/aarch64-apple-darwin/bin/codex',
    binName: 'codex',
    downloadBytes: 114152335,
  },
});

/**
 * Where managed runners live. An installed Kosmos keeps them inside
 * KOSMOS_HOME beside app/ and runtime/ (this file runs from app/engine,
 * same derivation as update.js's installedRoot); a from-source checkout
 * falls back to the well-known install home so a dev board and an
 * installed board resolve the same managed runner rather than each
 * installing their own.
 */
function managedRoot() {
  // Testing / self-host seam, same contract as the other AGENT_WORKFORCE_*
  // path overrides: a harness points this at a sandbox so no test ever
  // touches a real install's runners.
  if (process.env.AGENT_WORKFORCE_RUNNERS_DIR) return process.env.AGENT_WORKFORCE_RUNNERS_DIR;
  const home = path.resolve(__dirname, '..', '..');
  const installed = fs.existsSync(path.join(home, 'runtime', 'bin', 'node'))
                 && fs.existsSync(path.join(home, 'app', 'server.js'));
  const base = installed ? home : path.join(HOME, '.local', 'share', 'kosmos');
  return path.join(base, 'runners');
}

/**
 * ONE priority list for where a provider's runner binary lives:
 *
 *   1. the env override (AGENT_WORKFORCE_CODEX_BIN), the test-and-harness
 *      contract every other bin path in this codebase honors
 *   2. the managed location this module installs into
 *   3. the legacy Homebrew path, for the Macs that hand-installed codex
 *      before this machinery existed
 *
 * Returns { bin, present, managed }: `bin` is the FIRST EXISTING path, or
 * the managed path when nothing exists anywhere (so callers always get
 * the place an install would land, never '').
 */
function resolveBin(provider, opts) {
  if (provider !== 'openai') return { bin: null, present: false, managed: false };
  // An operator-set override is AUTHORITATIVE, not a candidate: when the
  // env names a path, that path is the answer, present or not -- so every
  // downstream message names the path the operator actually set instead
  // of silently falling through to a default they never chose. (This is
  // also what makes the missing-runner route deterministically testable.)
  const envBin = process.env.AGENT_WORKFORCE_CODEX_BIN;
  if (envBin) return { bin: envBin, present: fs.existsSync(envBin), managed: false };
  const managed = path.join(managedRoot(), 'openai', MANIFEST.openai.binName);
  const candidates = [
    managed,
    // Testing seam for the last rung only: the real legacy path is
    // machine state a test cannot control (this Mac genuinely has a
    // hand-installed codex there).
    (opts && opts.legacyBin) || '/opt/homebrew/bin/codex',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { bin: c, present: true, managed: c === managed };
  }
  return { bin: managed, present: false, managed: true };
}

/**
 * The one live job per provider. A second install request while one runs
 * gets the RUNNING job back (idempotent start), because two downloads of
 * the same artifact can only waste the second one's bytes.
 *
 * Job shape, readable at any moment via status():
 *   { phase: 'downloading'|'verifying'|'unpacking'|'proving'|'installed'|'failed',
 *     receivedBytes, totalBytes, version,
 *     because (failed only), proved (installed only: the runner's own
 *     --version line, the receipt that it actually ran) }
 */
const jobs = Object.create(null);

function status() {
  const out = {};
  for (const provider of Object.keys(MANIFEST)) {
    const m = MANIFEST[provider];
    const r = resolveBin(provider);
    out[provider] = {
      name: m.name,
      version: m.version,
      downloadBytes: m.downloadBytes,
      present: r.present,
      bin: r.bin,
      managed: r.managed,
      job: jobs[provider] || null,
    };
  }
  return out;
}

/** sha512 of a file, base64, in npm's integrity format ("sha512-<b64>").
    Streamed, not readFileSync: the real artifact is ~114MB, and buffering
    it whole is a needless memory spike on a small Mac. */
function fileIntegrity(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    const s = fs.createReadStream(file);
    s.on('data', (chunk) => h.update(chunk));
    s.on('end', () => resolve('sha512-' + h.digest('base64')));
    s.on('error', reject);
  });
}

/**
 * Download url to file, following redirects, reporting byte counts into
 * `job` as they arrive. Small enough to own rather than depend on:
 * node:https only, resolves on completion, rejects on any error or any
 * non-200 terminal status.
 */
function download(url, file, job, redirectsLeft) {
  const left = redirectsLeft === undefined ? 5 : redirectsLeft;
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), file, job, left - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`the download answered ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length']) || null;
      if (total) job.totalBytes = total;
      const out = fs.createWriteStream(file);
      res.on('data', (chunk) => { job.receivedBytes += chunk.length; });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      res.on('error', reject);
      out.on('error', reject);
    });
    // A wedged connection must FAIL the job, not park it in `downloading`
    // forever -- the idempotent join hands the same job back to every
    // Confirm, so with no timeout the only recovery would be a board
    // restart. 60s of socket SILENCE (not total time; a slow link that is
    // still moving bytes never trips this).
    req.setTimeout(60000, () => req.destroy(new Error('the download stalled (no data for 60s)')));
    req.on('error', reject);
  });
}

/**
 * Install a provider's runner. Returns the job object immediately; the
 * work continues in the background and the job's `phase` tells the story.
 * When the runner is already present, returns { phase: 'installed' }
 * without touching the network -- "Add must never silently do nothing"
 * cuts both ways: an install that has nothing to do says so instantly.
 *
 * The staging file lives under runners/.tmp and is REMOVED on every
 * failure path, and swept at the start of every install, so a board
 * restart mid-download can strand at most one partial file for exactly
 * one attempt.
 *
 * `opts` is the test seam: { url, integrity, binInArchive, prove } narrow
 * the manifest for a fixture server, and prove(bin) replaces the real
 * --version child. Production callers pass nothing.
 */
function install(provider, opts) {
  // hasOwn, not truthiness: with a URL-supplied provider, a prototype-chain
  // hit ("constructor") must be the SAME refusal as any unknown name.
  const m = Object.hasOwn(MANIFEST, provider) ? MANIFEST[provider] : null;
  if (!m) return { phase: 'failed', because: `we do not know how to install a runner for ${provider}` };
  const o = opts || {};
  const existing = resolveBin(provider, o);
  if (existing.present) return { phase: 'installed', version: m.version, receivedBytes: 0, totalBytes: 0 };
  if (jobs[provider] && jobs[provider].phase !== 'failed' && jobs[provider].phase !== 'installed') {
    return jobs[provider];
  }

  const url = o.url || m.url;
  const integrity = o.integrity || m.integrity;
  const binInPackage = o.binInPackage || m.binInPackage;
  const prove = o.prove || ((bin, done) => execFile(bin, ['--version'], { timeout: 30000 }, done));
  // Testing seam: the real download needs a live listener, which the test
  // sandbox forbids; a fixture download writes known bytes instead. The
  // REAL download function is exercised by the plan's one live proof.
  const doDownload = o.download || download;

  const job = { phase: 'downloading', receivedBytes: 0, totalBytes: m.downloadBytes, version: m.version };
  jobs[provider] = job;

  const destDir = path.join(managedRoot(), provider);
  const tmpDir = path.join(managedRoot(), '.tmp');
  const staging = path.join(tmpDir, `${provider}-${m.version}.tgz`);
  const fail = (because) => {
    try { fs.rmSync(staging, { force: true }); } catch { /* the sweep gets it */ }
    job.phase = 'failed';
    job.because = because;
  };

  const run = (async () => {
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      // Sweep THIS PROVIDER'S strays from any earlier interrupted attempt.
      // Prefix-scoped on purpose: a sweep of the whole shared .tmp would
      // delete a concurrent sibling provider's in-flight download the
      // moment a second manifest entry exists.
      for (const f of fs.readdirSync(tmpDir)) {
        if (f.startsWith(provider + '-') && f !== path.basename(staging)) {
          try { fs.rmSync(path.join(tmpDir, f), { force: true }); } catch { /* best effort */ }
        }
      }
      fs.rmSync(staging, { force: true });
      await doDownload(url, staging, job);

      // A short read that closed cleanly is a network fact, not a tamper
      // fact -- name it as what it is instead of letting the checksum
      // refusal below accuse the wrong culprit.
      if (job.totalBytes && job.receivedBytes !== job.totalBytes) {
        fail(`the download ended early (${job.receivedBytes} of ${job.totalBytes} bytes), so it was discarded`);
        return;
      }

      job.phase = 'verifying';
      const got = await fileIntegrity(staging);
      if (got !== integrity) {
        // The wrong bytes are DELETED, named, and never unpacked. A CDN
        // hiccup retries clean; a tampered artifact never reaches disk in
        // executable form.
        fail('the downloaded runner did not match its published checksum, so it was discarded');
        return;
      }

      job.phase = 'unpacking';
      // The verified archive's WHOLE package tree lands under pkg/ (the
      // binary resolves vendored siblings -- rg, zsh, code-mode-host --
      // relative to itself, so one extracted file would be a runner
      // stranded from its own tools). /usr/bin/tar ships on every Mac and
      // reads .tgz natively; --strip-components 1 drops the npm "package/"
      // root. A previous version's pkg/ is replaced whole, never merged.
      const pkgDir = path.join(destDir, 'pkg');
      fs.rmSync(pkgDir, { recursive: true, force: true });
      fs.mkdirSync(pkgDir, { recursive: true });
      await new Promise((resolve, reject) => {
        execFile('/usr/bin/tar', ['-xzf', staging, '-C', pkgDir, '--strip-components', '1'],
          (err, _stdout, stderr) => err ? reject(new Error(String(stderr || err.message).trim())) : resolve());
      });
      const unpacked = path.join(pkgDir, binInPackage);
      if (!fs.existsSync(unpacked)) {
        fail(`the archive did not contain the runner at ${binInPackage}, so nothing was installed`);
        return;
      }
      fs.chmodSync(unpacked, 0o755);
      // ONE stable path for every caller, whatever the package layout is:
      // a symlink beside the tree. Rust binaries resolve current_exe()
      // through symlinks, so the runner still finds its siblings.
      const finalBin = path.join(destDir, m.binName);
      fs.rmSync(finalBin, { force: true });
      fs.symlinkSync(unpacked, finalBin);

      job.phase = 'proving';
      // Installed is a CLAIM until the binary itself answers. --version is
      // local (no network, no account), so a pass means the Mach-O loads
      // and runs on this Mac -- the same prove-it-runs step the bundle
      // build applies to the app binary.
      try {
        await new Promise((resolve, reject) => {
          prove(finalBin, (err, stdout) => {
            if (err) { reject(new Error('the installed runner did not run: ' + String(err.message || err).trim())); return; }
            job.proved = String(stdout || '').trim();
            resolve();
          });
        });
      } catch (err) {
        // A failed prove must not leave a present-looking runner: the
        // symlink comes down (resolveBin keys on it), the pkg/ tree stays
        // for diagnosis.
        try { fs.rmSync(finalBin, { force: true }); } catch { /* best effort */ }
        throw err;
      }

      try { fs.rmSync(staging, { force: true }); } catch { /* the sweep gets it */ }
      job.phase = 'installed';
    } catch (err) {
      fail(String((err && err.message) || err).trim() || 'the install failed');
    }
  })();
  // Awaitable completion for harnesses; non-enumerable so the job's JSON
  // shape over the API stays exactly the documented fields.
  Object.defineProperty(job, 'settled', { value: run });

  return job;
}

module.exports = { MANIFEST, managedRoot, resolveBin, status, install };
