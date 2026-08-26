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
 * Claude rides here as a second manifest KIND (Josh's 2026-08-26 10:32
 * ruling: a provider like the others): 'vendor-installer', installed by
 * Anthropic's own script rather than a pinned tarball -- see
 * installVendor() for the phases and the die()-replacement contract. The
 * INSTALLER still pre-installs Claude today; removing that is the gated
 * branch B on #979, held until the in-flow path exists end to end so a
 * bare-Mac Claude pick can never dead-end the way OpenAI's used to.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');

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
    arch: 'arm64',
    url: 'https://registry.npmjs.org/@openai/codex/-/codex-0.149.1-darwin-arm64.tgz',
    integrity: 'sha512-6X84kTCbnTgPIJ2EdcPsrvwS0Wxsqpa+bCswGmRf4BjhcQ5nPMnBC6yCAaCMj+vrbXQHj+L6sa9FaR4QkmA1qw==',
    binInPackage: 'vendor/aarch64-apple-darwin/bin/codex',
    binName: 'codex',
    downloadBytes: 114152335,
  },
  claude: {
    name: 'Claude Code',
    // kind 'vendor-installer' (#979, Josh's 10:32 ruling: Claude is a
    // provider like the others): Anthropic's own installer script puts
    // the CLI at ~/.local/bin/claude -- the exact mechanism, path, and
    // AGENT_WORKFORCE_CLAUDE_INSTALL_URL override contract setup.sh's
    // preflight uses today. ⚠️ HONESTY COST, stated rather than papered:
    // the vendor script installs the vendor's LATEST, publishes no
    // checksum, and reports no byte counts -- so this kind has no
    // integrity pin, no pinnedVersion claim, and its job carries null
    // byte counts instead of invented ones. The prove step (the binary
    // must answer --version) is the same gate the tarball kind gets.
    kind: 'vendor-installer',
    installUrl: 'https://claude.ai/install.sh',
    installUrlEnv: 'AGENT_WORKFORCE_CLAUDE_INSTALL_URL',
    binName: 'claude',
    downloadBytes: null,
  },
});
// The url and integrity above are the trust anchors for bytes this module
// EXECUTES; frozen so nothing in-process can quietly repoint them. Tests
// inject fixture manifests through install()'s opts.manifest seam, the
// same way they replace download and prove.
for (const k of Object.keys(MANIFEST)) Object.freeze(MANIFEST[k]);
Object.freeze(MANIFEST);

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
 * Returns { bin, present, managed, overridden }. With the override set,
 * `bin` is the override, `present` is whether it exists, and `overridden`
 * is true. Otherwise `bin` is the first existing of managed-then-legacy,
 * or the managed path when nothing exists anywhere (so callers always
 * get the place an install would land, never '').
 */
/**
 * Present means RUNNABLE: a plain file with an exec bit. A directory or a
 * stripped file at a runner path reading as present is the exact
 * folder-sails-through trap setup.sh's check_claude_code documents from
 * #133 -- status would vouch for a runner that cannot start an agent.
 */
function isRunnable(p) {
  try {
    const st = fs.statSync(p); // follows symlinks, which is the point
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch { return false; }
}

function resolveBin(provider, opts) {
  if (provider === 'claude') {
    // Same authoritative-override contract as openai, with Claude's own
    // env var (the one every harness in this codebase already sets).
    // Claude's canonical home is the vendor's, ~/.local/bin/claude --
    // there is no Kosmos-managed location for a vendor-installer kind,
    // so `managed` is always false here.
    const envClaude = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    if (envClaude) return { bin: envClaude, present: isRunnable(envClaude), managed: false, overridden: true };
    // AGENT_WORKFORCE_HOME is the same sandbox seam openaiaccounts keys
    // its HOME on -- without it, every test on this fleet Mac would see
    // the real ~/.local/bin/claude and read present. Unset in production.
    const canonical = path.join(process.env.AGENT_WORKFORCE_HOME || HOME, '.local', 'bin', 'claude');
    return { bin: canonical, present: isRunnable(canonical), managed: false, overridden: false };
  }
  if (provider !== 'openai') return { bin: null, present: false, managed: false, overridden: false };
  // An operator-set override is AUTHORITATIVE, not a candidate: when the
  // env names a path, that path is the answer, present or not -- so every
  // downstream message names the path the operator actually set instead
  // of silently falling through to a default they never chose. (This is
  // also what makes the missing-runner route deterministically testable.)
  // `overridden` travels with the answer so install()'s masking guard
  // keys on the RESOLVER'S knowledge rather than re-deriving which env
  // var belongs to which provider.
  const envBin = process.env.AGENT_WORKFORCE_CODEX_BIN;
  if (envBin) return { bin: envBin, present: isRunnable(envBin), managed: false, overridden: true };
  const managed = path.join(managedRoot(), 'openai', MANIFEST.openai.binName);
  const candidates = [
    managed,
    // Testing seam for the last rung only: the real legacy path is
    // machine state a test cannot control (this Mac genuinely has a
    // hand-installed codex there).
    (opts && opts.legacyBin) || '/opt/homebrew/bin/codex',
  ];
  for (const c of candidates) {
    if (isRunnable(c)) return { bin: c, present: true, managed: c === managed, overridden: false };
  }
  return { bin: managed, present: false, managed: true, overridden: false };
}

/**
 * The one live job per provider. A second install request while one runs
 * gets the RUNNING job back (idempotent start), because two downloads of
 * the same artifact can only waste the second one's bytes.
 *
 * Job shape, readable at any moment via status():
 *   tarball kind:          phase 'downloading'|'verifying'|'unpacking'
 *   vendor-installer kind: phase 'installing'|'linking'
 *   both kinds:            -> 'proving' -> 'installed'|'failed'
 *   { phase, receivedBytes, totalBytes (null for vendor-installer: the
 *     script reports none), version (tarball only),
 *     because (failed only), proved (installed only: the runner's own
 *     --version line), log (vendor-installer: the installer's output
 *     file), linked (vendor-installer: the found path a link points at) }
 */
const jobs = Object.create(null);

function status() {
  const out = {};
  for (const provider of Object.keys(MANIFEST)) {
    const m = MANIFEST[provider];
    const r = resolveBin(provider);
    // A failed job beside a runner that has since become present (hand
    // install, env fixed) is a stale contradiction; presence retires it
    // so a polling screen never shows a failure banner over a working
    // runner.
    if (r.present && jobs[provider] && jobs[provider].phase === 'failed') delete jobs[provider];
    out[provider] = {
      name: m.name,
      // The screens branch on this: a tarball gets a byte progress bar, a
      // vendor-installer gets an indeterminate one (its script reports no
      // counts) -- stated rather than left to be inferred from nulls.
      kind: m.kind || 'tarball',
      // pinnedVersion, NOT a claim about the binary on disk: presence is
      // existence, and a legacy or older managed runner may answer any
      // version. The install job's `proved` line is the only field that
      // certifies what actually ran. (A manifest bump therefore does not
      // auto-reinstall an existing runner; that flow arrives with the
      // first real bump, on the card.)
      pinnedVersion: m.version,
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
function download(url, file, job, redirectsLeft, getter) {
  const left = redirectsLeft === undefined ? 5 : redirectsLeft;
  // `getter` is the transport seam (https.get-shaped): the redirect,
  // non-200, and cleanup branches are unit-tested through it with real
  // Readable streams, since the production https-only shape would demand
  // TLS fixtures for a live listener.
  const get = getter || https.get;
  return new Promise((resolve, reject) => {
    // Hoisted so EVERY failure path can close BOTH ends: a rejected
    // promise that strands an open write stream leaks one fd per failed
    // download, and a stranded socket dangles until the stall timer.
    let out = null;
    let reqRef = null;
    const bail = (err) => {
      if (out) { try { out.destroy(); } catch { /* already closed */ } }
      if (reqRef) { try { reqRef.destroy(); } catch { /* already closed */ } }
      reject(err);
    };
    const req = get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), file, job, left - 1, getter));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        // A 3xx landing here means the redirect valve is exhausted -- name
        // the cause, not just the status, for whoever reads the job.
        bail(new Error(res.statusCode >= 300 && res.statusCode < 400
          ? `the download redirected too many times (last answer ${res.statusCode})`
          : `the download answered ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length']) || null;
      if (total) job.totalBytes = total;
      out = fs.createWriteStream(file);
      res.on('data', (chunk) => { job.receivedBytes += chunk.length; });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      res.on('error', bail);
      out.on('error', bail);
    });
    // A wedged connection must FAIL the job, not park it in `downloading`
    // forever -- the idempotent join hands the same job back to every
    // Confirm, so with no timeout the only recovery would be a board
    // restart. 60s of socket SILENCE (not total time; a slow link that is
    // still moving bytes never trips this).
    reqRef = req;
    req.setTimeout(60000, () => req.destroy(new Error('the download stalled (no data for 60s)')));
    req.on('error', bail);
  });
}

/**
 * Install a provider's runner. Returns the job object immediately; the
 * work continues in the background and the job's `phase` tells the story.
 * When the runner is already present, returns { phase: 'installed' }
 * without touching the network -- "Add must never silently do nothing"
 * cuts both ways: an install that has nothing to do says so instantly.
 *
 * Temp state is bounded two ways: the staging tarball (runners/.tmp) and
 * the per-pid unpack trees (pkg.new- and pkg.old- prefixed) are both
 * REMOVED on every failure path this process sees, and both swept
 * age-gated at the start of every install -- so a crash or restart
 * strands at most one attempt's files, and only until the next install
 * passes by.
 *
 * `opts` is the test seam: { url, integrity, binInPackage, download,
 * legacyBin, prove } narrow the manifest and machinery for fixtures, and
 * prove(bin) replaces the real --version child. Production callers pass
 * nothing.
 */
function install(provider, opts) {
  const o = opts || {};
  // hasOwn, not truthiness: with a URL-supplied provider, a prototype-chain
  // hit ("constructor") must be the SAME refusal as any unknown name.
  // opts.manifest is the fixture seam (the shipped MANIFEST is frozen).
  const m = o.manifest || (Object.hasOwn(MANIFEST, provider) ? MANIFEST[provider] : null);
  if (!m) return { phase: 'failed', because: `we do not know how to install a runner for ${provider}` };
  // Join a LIVE job before consulting presence: during `proving` the
  // symlink already exists, and answering a synthetic `installed` for a
  // binary whose prove may still fail would briefly report a runner that
  // was never proven. The running job IS the truth of that moment.
  if (jobs[provider] && jobs[provider].phase !== 'failed' && jobs[provider].phase !== 'installed') {
    return jobs[provider];
  }
  const existing = resolveBin(provider, o);
  // The manifest and the resolver must AGREE before any bytes move: a
  // future manifest entry whose provider resolveBin cannot answer would
  // otherwise download forever (status would never see it as present).
  // Loud refusal here is what keeps that trap from shipping silently.
  if (!existing.bin) {
    return { phase: 'failed', because: `the ${provider} runner has a manifest entry but no resolution rule yet, so an install could never be seen; teach resolveBin about it first` };
  }
  if (existing.present) {
    // A completed job for THIS binary carries the truthful receipt
    // (`proved`, real byte counts) -- hand that back rather than a
    // synthetic. Otherwise: byte counts null, not zero, and NO version
    // field at all -- nothing was downloaded, nothing was proved, and a
    // present legacy binary may be any age; claiming the pinned version
    // would be the exact overclaim status() renamed its field to avoid.
    if (jobs[provider] && jobs[provider].phase === 'installed') return jobs[provider];
    if (jobs[provider] && jobs[provider].phase === 'failed') delete jobs[provider];
    return { phase: 'installed', receivedBytes: null, totalBytes: null };
  }
  // An authoritative override naming a MISSING path would mask the
  // managed location this install stages into: the job would end
  // `installed` while every status read still answers absent, an
  // unwinnable loop that re-downloads on each Confirm. Refuse with the
  // fix in hand instead -- keyed on the resolver's own `overridden`
  // flag, so the next provider's override is covered the day it exists.
  if (existing.overridden) {
    return { phase: 'failed', because: `an operator override points the ${provider} runner at ${existing.bin}, which does not exist; unset the override (or point it at a real runner) before installing` };
  }
  // Wrong hardware fails in seconds with the CAUSE, not in minutes at
  // the prove step with a symptom: the pinned artifact is arch-specific.
  // (A vendor-installer entry carries no arch: the vendor's script picks
  // its own artifact for this machine, so the guard naturally passes.)
  const arch = o.arch || process.arch;
  if (m.arch && arch !== m.arch) {
    return { phase: 'failed', because: `the pinned ${m.name} build is ${m.arch} and this Mac is ${arch}; no download was attempted` };
  }

  if (m.kind === 'vendor-installer') return installVendor(provider, m, o, existing);

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
  // Per-PROCESS staging name: the managed root is deliberately shared
  // between a from-source board and an installed board on one Mac, and
  // the in-memory one-job guard cannot see across processes. Distinct
  // staging files keep two concurrent installs from interleaving bytes
  // into one file; the pkg swap below keeps the final tree whole. A
  // lockfile would close the remaining swap-vs-swap window; accepted as
  // residual until two boards on one Mac is a real configuration.
  const staging = path.join(tmpDir, `${provider}-${m.version}-${process.pid}.tgz`);
  // Set when the unpack tree is created, so EVERY failure path can remove
  // it: a stranded pkg.new tree is a fully unpacked runner (~300MB), a
  // much bigger stray than a staging tarball.
  let pkgNewLive = null;
  const fail = (because) => {
    try { fs.rmSync(staging, { force: true }); } catch { /* the sweep gets it */ }
    if (pkgNewLive) { try { fs.rmSync(pkgNewLive, { recursive: true, force: true }); } catch { /* the sweep gets it */ } }
    job.phase = 'failed';
    job.because = because;
  };

  const run = (async () => {
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      // Sweep THIS PROVIDER'S STALE strays (an hour old or more: nothing
      // legitimate downloads that long). Scoped twice on purpose -- by
      // provider prefix so a sibling provider's in-flight bytes survive,
      // and by age so ANOTHER PROCESS'S live staging file (per-pid names)
      // survives too.
      for (const f of fs.readdirSync(tmpDir)) {
        if (!f.startsWith(provider + '-') || f === path.basename(staging)) continue;
        try {
          if (Date.now() - fs.statSync(path.join(tmpDir, f)).mtimeMs > 3600000) {
            fs.rmSync(path.join(tmpDir, f), { force: true });
          }
        } catch { /* best effort */ }
      }
      fs.rmSync(staging, { force: true });
      await doDownload(url, staging, job);

      // A size mismatch that closed cleanly is a network fact, not a
      // tamper fact -- name it as what it is (early OR over-delivery,
      // accurately) instead of letting the checksum refusal below accuse
      // the wrong culprit.
      if (job.totalBytes && job.receivedBytes !== job.totalBytes) {
        const how = job.receivedBytes < job.totalBytes ? 'ended early' : 'delivered more than promised';
        fail(`the download ${how} (${job.receivedBytes} of ${job.totalBytes} bytes), so it was discarded`);
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
      // Unpack into a per-process tree, then SWAP it in whole: the pkg/
      // tree is never half-written at its final name, so a concurrent
      // reader (or a second board's prove step) can never see a partial
      // vendor tree that still happens to answer --version. (On a
      // RE-install, the instant between the two renames can read as
      // absent through the symlink -- the safe direction; a partial tree
      // is the dangerous one, and that stays impossible.)
      const pkgDir = path.join(destDir, 'pkg');
      const pkgNew = path.join(destDir, `pkg.new-${process.pid}`);
      const pkgOld = path.join(destDir, `pkg.old-${process.pid}`);
      // destDir FIRST: on a fresh machine (the exact #979 scenario) nothing
      // has created it yet, and the sweep's readdir would ENOENT the whole
      // install before a byte of the runner ever staged.
      fs.mkdirSync(destDir, { recursive: true });
      // Sweep STALE per-pid trees from crashed or restarted attempts, the
      // same age-gated discipline as the .tmp sweep: a restarted board has
      // a new pid, so its old strays would otherwise sit forever, and each
      // one is a whole unpacked runner.
      for (const f of fs.readdirSync(destDir)) {
        if (!/^pkg\.(new|old)-/.test(f)) continue;
        const p = path.join(destDir, f);
        if (p === pkgNew || p === pkgOld) continue;
        try {
          if (Date.now() - fs.statSync(p).mtimeMs > 3600000) fs.rmSync(p, { recursive: true, force: true });
        } catch { /* best effort */ }
      }
      fs.rmSync(pkgNew, { recursive: true, force: true });
      fs.mkdirSync(pkgNew, { recursive: true });
      pkgNewLive = pkgNew;
      await new Promise((resolve, reject) => {
        // Timeboxed like its neighbors (download 60s stall, prove 30s): a
        // wedged tar would otherwise park the job in `unpacking` forever
        // behind the idempotent join.
        execFile('/usr/bin/tar', ['-xzf', staging, '-C', pkgNew, '--strip-components', '1'], { timeout: 120000 },
          (err, _stdout, stderr) => err ? reject(new Error(String(stderr || err.message).trim())) : resolve());
      });
      if (!fs.existsSync(path.join(pkgNew, binInPackage))) {
        fail(`the archive did not contain the runner at ${binInPackage}, so nothing was installed`);
        return;
      }
      // One deliberate chmod, on the one file the symlink's execution
      // depends on. The vendored siblings keep whatever modes the vendor
      // packed and tar preserved -- the live proof ran the real binary
      // through exactly that, so re-moding the whole tree would be
      // defending against a problem the artifact does not have.
      fs.chmodSync(path.join(pkgNew, binInPackage), 0o755);
      fs.rmSync(pkgOld, { recursive: true, force: true });
      if (fs.existsSync(pkgDir)) fs.renameSync(pkgDir, pkgOld);
      fs.renameSync(pkgNew, pkgDir);
      pkgNewLive = null; // swapped in; nothing at the per-pid name any more
      fs.rmSync(pkgOld, { recursive: true, force: true });
      const unpacked = path.join(pkgDir, binInPackage);
      // ONE stable path for every caller, whatever the package layout is:
      // a symlink beside the tree, RELATIVE so a moved or renamed
      // KOSMOS_HOME carries it intact. Rust binaries resolve
      // current_exe() through symlinks, so the runner still finds its
      // vendored siblings.
      const finalBin = path.join(destDir, m.binName);
      fs.rmSync(finalBin, { force: true });
      fs.symlinkSync(path.relative(destDir, unpacked), finalBin);

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

/**
 * The vendor-installer pipeline (#979, the Claude kind): the vendor's own
 * script installs its LATEST into its canonical path. Three phases:
 *
 *   linking     a runner already on this Mac but not at the canonical
 *               path gets a symlink, not a download -- setup.sh's
 *               near-miss handling carried in-flow ("nothing is
 *               installed; a link is named as a link")
 *   installing  the vendor script runs, output to a log file whose path
 *               rides in the job on failure (a log must be able to say
 *               what a run actually installed); no byte counts, because
 *               the script reports none and inventing them is worse
 *   proving     the binary must answer --version before `installed` is
 *               ever claimed -- the same gate the tarball kind gets
 *
 * ⚠️ THE die() REPLACEMENT: a failure here is a JOB ANSWER the screen
 * shows. Nothing exits, nothing kills an install, Kosmos keeps running --
 * the exact contract Josh's provider ruling demands where setup.sh's
 * preflight used to die.
 *
 * Seams (o.): findElsewhere() -> path|null replaces the PATH probe;
 * runInstaller(url, logFile, done) replaces the curl|sh child;
 * prove(bin, done) as everywhere.
 */
function installVendor(provider, m, o, existing) {
  const canonical = existing.bin;
  const url = o.url || (m.installUrlEnv && process.env[m.installUrlEnv]) || m.installUrl;
  const prove = o.prove || ((bin, done) => execFile(bin, ['--version'], { timeout: 30000 }, done));
  const findElsewhere = o.findElsewhere || (() => {
    // `which` under a launchd-started board sees the stock PATH, which
    // hides Homebrew and npm-global installs -- the very copies setup.sh's
    // `command -v` (a login shell) finds. So the known homes are probed
    // explicitly, and `which` is the tail rung for anything else.
    const candidates = [
      '/opt/homebrew/bin/' + m.binName,
      '/usr/local/bin/' + m.binName,
      path.join(HOME, '.npm-global', 'bin', m.binName),
    ];
    try {
      const found = String(execFileSync('/usr/bin/which', [m.binName], { timeout: 5000 })).trim();
      if (found) candidates.push(found);
    } catch { /* not on the server's PATH; the explicit rungs stand */ }
    for (const c of candidates) {
      if (c !== canonical && isRunnable(c)) return c;
    }
    return null;
  });
  const runInstaller = o.runInstaller || ((u, logFile, done) => {
    // setup.sh's mechanism, ported with two deliberate upgrades and one
    // accepted cost:
    //   - POSITIONAL ARGS, never string interpolation: a template literal
    //     inside sh -c would re-parse $(...) in an operator-set URL or a
    //     runners-dir path as live shell. "$1"/"$2"/"$3" expand inertly,
    //     which is what setup.sh's own "$_claude_install_url" does.
    //   - curl-to-file THEN sh, not curl|sh: a pipeline without pipefail
    //     reports curl's failure as sh's success over an empty script,
    //     and loses curl's stderr entirely. Sequenced, a network failure
    //     exits nonzero with curl's own words in the log -- "a log must
    //     be able to say what a run actually installed".
    //   - The 10-minute ceiling kills the /bin/sh wrapper; a child mid
    //     stage can outlive it briefly and exits with its own stage.
    //     Accepted: bounded, rare, and a process-group kill is machinery
    //     this path does not earn.
    const script = `${logFile}.script.sh`;
    execFile('/bin/sh', ['-c', 'curl -fsSL "$1" >"$3" 2>>"$2" && sh "$3" >>"$2" 2>&1', 'sh', u, logFile, script],
      { timeout: 600000 },
      (err) => { try { fs.rmSync(script, { force: true }); } catch { /* tmp sweep gets it */ } done(err); });
  });

  const job = { phase: 'installing', receivedBytes: null, totalBytes: null };
  jobs[provider] = job;
  const fail = (because) => { job.phase = 'failed'; job.because = because; };

  const run = (async () => {
    try {
      const elsewhere = findElsewhere();
      if (elsewhere) {
        job.phase = 'linking';
        fs.mkdirSync(path.dirname(canonical), { recursive: true });
        fs.rmSync(canonical, { force: true });
        fs.symlinkSync(elsewhere, canonical);
        job.linked = elsewhere;
      } else {
        const logDir = path.join(managedRoot(), '.tmp');
        fs.mkdirSync(logDir, { recursive: true });
        // The same age-gated, provider-prefixed sweep discipline as the
        // tarball path's staging files, for this kind's logs and script
        // temps -- the module's bounded-temp-state claim covers every kind.
        for (const f of fs.readdirSync(logDir)) {
          if (!f.startsWith(`${provider}-install-`)) continue;
          try {
            const p = path.join(logDir, f);
            if (Date.now() - fs.statSync(p).mtimeMs > 3600000) fs.rmSync(p, { force: true });
          } catch { /* best effort */ }
        }
        const logFile = path.join(logDir, `${provider}-install-${process.pid}.log`);
        await new Promise((resolve, reject) => {
          runInstaller(url, logFile, (err) => err
            ? reject(new Error(`the ${m.name} installer did not finish (its log is at ${logFile})`))
            : resolve());
        });
        if (!fs.existsSync(canonical)) {
          fail(`the ${m.name} installer finished but nothing landed at ${canonical} (its log is at ${logFile})`);
          return;
        }
        job.log = logFile;
      }
      job.phase = 'proving';
      await new Promise((resolve, reject) => {
        prove(canonical, (err, stdout) => {
          if (err) { reject(new Error(`the installed runner did not run: ${String(err.message || err).trim()}`)); return; }
          job.proved = String(stdout || '').trim();
          resolve();
        });
      });
      job.phase = 'installed';
    } catch (err) {
      // A failed prove after a LINK must take the link down, same as the
      // tarball kind's symlink teardown: a broken runner never reads as
      // present. A failed prove after a real install leaves the vendor's
      // file for diagnosis (removing a vendor-owned path is not ours).
      if (job.linked) { try { fs.rmSync(canonical, { force: true }); } catch { /* best effort */ } }
      fail(String((err && err.message) || err).trim() || 'the install failed');
    }
  })();
  Object.defineProperty(job, 'settled', { value: run });
  return job;
}

/** Test-only: forget every job receipt (the same shape connect.js ships). */
function resetForTests() { for (const k of Object.keys(jobs)) delete jobs[k]; }

module.exports = { MANIFEST, managedRoot, resolveBin, status, install, download, resetForTests };
