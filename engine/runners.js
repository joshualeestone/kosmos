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
 * ruling: a provider like the others): kind 'vendor-external', meaning the
 * VENDOR owns the binary and its location, not Kosmos's managed dir. On this
 * branch that kind LINKS a Claude Code already on the Mac and refuses in
 * words when there is none; downloading it is #997. See installVendor() for
 * the phases and the die()-replacement contract. The
 * INSTALLER still pre-installs Claude today; removing that is the gated
 * branch B on #979, held until the in-flow path exists end to end so a
 * bare-Mac Claude pick can never dead-end the way OpenAI's used to.
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
    arch: 'arm64',
    url: 'https://registry.npmjs.org/@openai/codex/-/codex-0.149.1-darwin-arm64.tgz',
    integrity: 'sha512-6X84kTCbnTgPIJ2EdcPsrvwS0Wxsqpa+bCswGmRf4BjhcQ5nPMnBC6yCAaCMj+vrbXQHj+L6sa9FaR4QkmA1qw==',
    binInPackage: 'vendor/aarch64-apple-darwin/bin/codex',
    binName: 'codex',
    downloadBytes: 114152335,
  },
  claude: {
    name: 'Claude Code',
    /**
     * kind 'vendor-external' (#979, Josh's 10:32 ruling: Claude is a
     * provider like the others). "External" = the VENDOR owns this binary
     * and where it lives; Kosmos does not manage it the way it manages the
     * pinned tarball runner.
     *
     * ⚠️ IT WAS BRIEFLY CALLED 'vendor-verified', AND THAT NAME WAS A LIE ON
     * THIS BRANCH. The string is published on the API as `status().<p>.kind`,
     * so a screen branching on it would have been told a trust property this
     * path does not deliver: nothing here downloads, so nothing here verifies.
     * The name has to stay true both before and after #997.
     *
     * 🛑 THE FIRST VERSION OF THIS ENTRY WAS `curl -fsSL https://claude.ai/
     * install.sh | sh`, ported from setup.sh's preflight, and its comment
     * claimed the vendor "publishes no checksum". THAT CLAIM WAS FALSE, and
     * this repo falsified it three files over: `engine/connect.js` has
     * installed Claude Code since 2026-08-12 by reading a per-platform
     * SHA256 out of `<base>/<version>/manifest.json` and REFUSING a binary
     * that does not match it, plus refusing any https->http redirect on the
     * way. Shipping the script version would have added a second, strictly
     * weaker install path for the same product beside a verified one.
     *
     * So this kind does not install anything itself, and on this branch it
     * does not download either: it LINKS a Claude Code that is already on
     * the Mac, and refuses in words when there is none. The download half
     * is #997, where connect.js's verified download+install is extracted
     * into one function both callers share. Reassembling it here is what
     * the second wrong version did; see installVendor().
     *
     * ⚠️ WHAT IS HONESTLY ABSENT: there is no `url`/`integrity` pin HERE,
     * because the version and its checksum are discovered at run time from
     * the vendor's own manifest rather than frozen into this file. So
     * `pinnedVersion` is null for this kind and says so, and `downloadBytes`
     * is null because nothing on this branch downloads.
     */
    kind: 'vendor-external',
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
/* ⚠️ Keys on the bare module `HOME`, NOT homeDir(). Deliberate and worth
   naming, because the asymmetry with resolveBin's claude rung is exactly
   the shape homeDir()'s own comment argues against: this path has its own
   sandbox seam (AGENT_WORKFORCE_RUNNERS_DIR) that the tests use, so adding
   a second one here would give one directory two ways to be redirected. */
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
 * Present means RUNNABLE: a plain file with an exec bit. A directory or a
 * stripped file at a runner path reading as present is the exact
 * folder-sails-through trap setup.sh's check_claude_code documents from
 * #133 -- status would vouch for a runner that cannot start an agent.
 */
function isRunnable(p) {
  try {
    const st = fs.statSync(p); // follows symlinks, which is the point
    if (!st.isFile()) return false;
    // X_OK, not `mode & 0o111`: the mode bits answer "can SOMEBODY execute
    // this", and a root-owned 0o700 binary passes that while failing at
    // launch for us. accessSync asks the only question that matters -- can
    // THIS process run it -- which is the same question engine/connect.js
    // already asks of the same binary at its two launch sites.
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

/**
 * The home every rung of this module keys on.
 *
 * ⚠️ ONE derivation, because the two halves of an install used to disagree:
 * `resolveBin`'s canonical rung honoured AGENT_WORKFORCE_HOME while the
 * find-it-elsewhere probe read the real machine, so a harness that sandboxed
 * the first would symlink the sandbox's canonical path at the operator's live
 * `claude`. A sandbox that reaches the real machine is not a sandbox.
 */
function homeDir() {
  return process.env.AGENT_WORKFORCE_HOME || HOME;
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
 *
 * ⚠️ THE THREE RUNGS ABOVE ARE THE OPENAI ONES. This function answers for BOTH
 * providers and the claude branch is different in kind: its rungs are the env
 * override then the VENDOR's canonical `~/.local/bin/claude`, with `managed`
 * always false, because a vendor-external kind has no Kosmos-managed location
 * to install into.
 *
 * ⚠️ ONLY THE CLAUDE BRANCH KEYS ON homeDir(). The openai rungs go through
 * managedRoot(), which keys on the bare module HOME and has its own sandbox
 * seam (AGENT_WORKFORCE_RUNNERS_DIR) -- see its comment. Both branches DO
 * share isRunnable(). An earlier version of this line claimed both shared
 * both, which contradicted managedRoot's own comment sixty lines up.
 *
 * 📌 This block was stranded for one iteration -- it sat above isRunnable() and
 * homeDir() rather than above the function it documents, so it described the
 * wrong thing to any reader who trusted its position.
 */
function resolveBin(provider, opts) {
  if (provider === 'claude') {
    // Same authoritative-override contract as openai, with Claude's own
    // env var (the one every harness in this codebase already sets).
    // Claude's canonical home is the vendor's, ~/.local/bin/claude --
    // there is no Kosmos-managed location for a vendor-external kind,
    // so `managed` is always false here.
    const envClaude = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    if (envClaude) return { bin: envClaude, present: isRunnable(envClaude), managed: false, overridden: true };
    // AGENT_WORKFORCE_HOME is the same sandbox seam openaiaccounts keys
    // its HOME on -- without it, every test on this fleet Mac would see
    // the real ~/.local/bin/claude and read present. Unset in production.
    const canonical = path.join(homeDir(), '.local', 'bin', 'claude');
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
 *   tarball kind:         phase 'downloading'|'verifying'|'unpacking'
 *   vendor-external kind: phase 'linking'   (the only fetching phase it
 *                        has until #997 gives it a real install)
 *   both kinds:           -> 'proving' -> 'installed'|'failed'
 *   { phase, receivedBytes, totalBytes (real numbers for the tarball kind;
 *     null for vendor-external, which moves no bytes -- a link is not a
 *     download and must not draw a bar), version (tarball: the pinned one;
 *     vendor-external: null), because (failed only), proved (installed
 *     only: the runner's own --version line), linked (vendor-external only:
 *     the found path a link points at, null when it did not link) }
 *
 * ⚠️ THE `null`-NOT-MISSING RULE, AND ITS HONEST SCOPE. An absent field is
 * dropped by JSON.stringify, which makes "this kind has no version"
 * indistinguishable on the wire from "the field was never added". So a field
 * whose ABSENCE IS A FACT ABOUT THE KIND is initialised to null and stays in
 * the payload: `version`, `linked`, `receivedBytes`, `totalBytes` on the
 * vendor-external job, and `pinnedVersion`/`downloadBytes` on status().
 *
 * 📌 It is NOT a rule that every job carries every field. The tarball job has
 * no `linked` and the already-present synthetic has no `version` -- both
 * deliberate, and the second is defended in its own comment. Those absences
 * say "this shape has no such concept", which is a different statement from
 * "this kind cannot answer that question", and flattening the two into one
 * spelling would lose it. Stated because an earlier version of this block
 * claimed the stronger rule and two shapes in this file already broke it.
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
      // What the screens WILL branch on: a tarball gets a real byte progress
      // bar, a vendor-external kind gets no bar at all, because until #997 its
      // only fetching phase is `linking` and a link moves no bytes. Stated
      // rather than left to be inferred from nulls.
      // 📌 Future tense on purpose: nothing in web/ or native-app/ reads
      // /api/runners yet. Publishing the field ahead of its consumer is fine;
      // claiming it HAS one is the kind of comment that reads as verified.
      kind: m.kind || 'tarball',
      // pinnedVersion, NOT a claim about the binary on disk: presence is
      // existence, and a legacy or older managed runner may answer any
      // version. The install job's `proved` line is the only field that
      // certifies what actually ran. (A manifest bump therefore does not
      // auto-reinstall an existing runner; that flow arrives with the
      // first real bump, on the card.)
      // `|| null`, so an absent pin SERIALIZES. `undefined` is dropped
      // entirely by JSON.stringify, which makes "this kind cannot pin a
      // version" indistinguishable on the wire from "the field was never
      // added" -- while the sibling honest-absence field, downloadBytes,
      // already travels as null. Two absences, one spelling.
      pinnedVersion: m.version || null,
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
    // "is not something we can run", NOT "does not exist": `present` means
    // RUNNABLE now, so this arm is also reached by a real file with no exec
    // bit and by a directory. Telling an operator the file is missing sends
    // them looking for the wrong problem.
    return { phase: 'failed', because: `an operator override points the ${provider} runner at ${existing.bin}, which is not something we can run; unset the override (or point it at a real runner) before installing` };
  }
  // Wrong hardware fails in seconds with the CAUSE, not in minutes at
  // the prove step with a symptom: the pinned artifact is arch-specific.
  // (A vendor-external entry carries no arch: the vendor's manifest picks
  // its own per-platform artifact, so the guard naturally passes.)
  const arch = o.arch || process.arch;
  if (m.arch && arch !== m.arch) {
    return { phase: 'failed', because: `the pinned ${m.name} build is ${m.arch} and this Mac is ${arch}; no download was attempted` };
  }

  if (m.kind === 'vendor-external') return installVendor(provider, m, o, existing);

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
 * The vendor-external pipeline (#979, the Claude kind).
 *
 * 🛑 READ THE MANIFEST ENTRY'S COMMENT BEFORE CHANGING THIS. The first
 * version of this function curl-and-shelled `https://claude.ai/install.sh`
 * with no integrity check, beside an `engine/connect.js` that has verified
 * the same product against a published SHA256 since 2026-08-12. It never
 * shipped; it was caught in review. Do not reintroduce a second, weaker
 * install path for a product this process already installs safely.
 *
 * Phases:
 *
 *   linking      a runner already on this Mac but not at the canonical
 *                path gets a symlink, not a download -- setup.sh's
 *                near-miss handling carried in-flow ("nothing is
 *                installed; a link is named as a link")
 *   proving      the linked binary must answer --version before `installed`
 *                is ever claimed -- the same gate the tarball kind gets
 *
 * ⚠️ THERE IS NO `downloading` OR `installing` PHASE, AND NO fetchVendor /
 * runVendorInstall SEAM. An earlier version of this docblock documented both,
 * and kept documenting them after iteration 3 removed the code -- which is
 * worse than no comment, because the next reader trusts this block over the
 * function. Byte counts are hard-null here for the same reason: nothing on
 * this branch fetches anything.
 *
 * ⚠️ THE die() REPLACEMENT: a failure here is a JOB ANSWER the screen
 * shows. Nothing exits, nothing kills an install, Kosmos keeps running --
 * the exact contract Josh's provider ruling demands where setup.sh's
 * preflight used to die.
 *
 * Seams (o.): findElsewhere() -> path|null replaces the PATH probe;
 * prove(bin, done) as everywhere. Those are the only two.
 */
function installVendor(provider, m, o, existing) {
  const canonical = existing.bin;
  const prove = o.prove || ((bin, done) => execFile(bin, ['--version'], { timeout: 30000 }, done));
  const findElsewhere = o.findElsewhere || (async () => {
    // `which` under a launchd-started board sees the stock PATH, which
    // hides Homebrew and npm-global installs -- the very copies setup.sh's
    // `command -v` (a login shell) finds. So the known homes are probed
    // explicitly, and `which` is the tail rung for anything else.
    //
    // ⚠️ homeDir(), not HOME: this probe and resolveBin's canonical rung
    // are two halves of ONE flow and must agree about which machine they
    // are looking at, or a sandboxed test links its canonical path at the
    // operator's real binary. See homeDir().
    const candidates = [
      '/opt/homebrew/bin/' + m.binName,
      '/usr/local/bin/' + m.binName,
      path.join(homeDir(), '.npm-global', 'bin', m.binName),
    ];
    // ASYNC, not execFileSync: see the comment at the call site. A routine
    // "not found" from `which` is an ANSWER here, not an incident, so a
    // non-zero exit resolves to no extra candidate rather than rejecting, and
    // stderr is discarded rather than written into the board's own log on
    // every miss.
    const found = await new Promise((resolve) => {
      execFile('/usr/bin/which', [m.binName], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? '' : String(stdout || '').trim());
      });
    });
    if (found) candidates.push(found);
    for (const c of candidates) {
      if (c !== canonical && isRunnable(c)) return c;
    }
    return null;
  });
  // `linking` from the start, and for this kind that is the ONLY fetching
  // phase there is until #997 lands. Byte counts are null and stay null:
  // a link moves no bytes, and inventing a count would be the same lie the
  // tarball kind's real numbers exist to avoid.
  const job = { phase: 'linking', receivedBytes: null, totalBytes: null, version: null, linked: null };
  jobs[provider] = job;
  const fail = (because) => { job.phase = 'failed'; job.because = because; };

  /**
   * Clear the canonical path so a symlink can take it.
   *
   * ⚠️ NARROW ON PURPOSE. The unconditional `rmSync(canonical, {force:true})`
   * this replaces ran in exactly the case where canonical EXISTS but is not
   * runnable -- which includes a real vendor-owned file (a truncated
   * launcher a crashed connect.js install left behind), and this module's
   * own catch block says removing a vendor-owned path is not ours. It also
   * threw a raw ERR_FS_EISDIR into the person-facing `because` when
   * canonical was a directory, the other #133 shape.
   *
   * So: a symlink is ours to replace (that is what we write here). Anything
   * else that exists is refused BY NAME, with the path, so a person can see
   * what is in the way instead of reading an errno.
   */
  const clearForLink = () => {
    let st;
    try { st = fs.lstatSync(canonical); } catch { return null; } // nothing there: nothing to clear
    // ⚠️ "REPLACEABLE", NOT "OURS". connect.js's vendor install writes a
    // launcher at this same canonical path, so a symlink here is not provably
    // something Kosmos put down. Replacing a symlink is still the right call
    // -- it is a pointer, not content -- but the comment must not claim a
    // certainty the code cannot have.
    if (st.isSymbolicLink()) {
      try { fs.unlinkSync(canonical); return null; } catch (err) {
        return `something is already at ${canonical} and it could not be replaced: ${String((err && err.message) || err).trim()}`;
      }
    }
    return st.isDirectory()
      ? `${canonical} is a folder, not a runner, so nothing was changed; move it aside and try again`
      : `${canonical} already exists and is not something we put there, so nothing was changed; move it aside and try again`;
  };

  const run = (async () => {
    try {
      /**
       * ⚠️ THE PROBE IS ASYNC, AND A MICROTASK IS NOT ENOUGH.
       *
       * `server.js` calls `runners.install()` straight from the HTTP handler,
       * and an async function body runs SYNCHRONOUSLY up to its first await --
       * so a synchronous `which` here blocks the single-threaded board for up
       * to its 5s timeout: the UI poll, agent supervision, every other
       * request, frozen, on the one call that was meant to be a background
       * job.
       *
       * 🛑 AN EARLIER FIX FOR THIS WAS `await Promise.resolve()` AND IT FIXED
       * NOTHING. That queues a MICROTASK, which the runtime drains at the end
       * of the current tick, BEFORE returning to the event loop -- so the
       * board was frozen for exactly as long, just after the response had been
       * handed to the socket instead of before. The comment claimed the
       * opposite. The only real fix is for the probe itself not to block.
       */
      const elsewhere = await findElsewhere();
      if (elsewhere) {
        try {
          fs.mkdirSync(path.dirname(canonical), { recursive: true });
        } catch (err) {
          fail(`we found ${m.name} at ${elsewhere} but could not create ${path.dirname(canonical)} to link it into; check that folder's permissions`);
          return;
        }
        const blocked = clearForLink();
        if (blocked) { fail(blocked); return; }
        try {
          fs.symlinkSync(elsewhere, canonical);
        } catch (err) {
          // Named, not an errno. The directory case beside this one is
          // deliberately errno-free and has a test asserting so; a write that
          // fails for permissions or a full disk deserves the same treatment
          // rather than `EACCES: permission denied, symlink '...' -> '...'`.
          fail(`we found ${m.name} at ${elsewhere} but could not put a link to it at ${canonical}; check that folder's permissions`);
          return;
        }
        job.linked = elsewhere;
      } else {
        /**
         * 🛑 THE DOWNLOAD-AND-INSTALL BRANCH IS DELIBERATELY NOT HERE, and
         * this refusal is the honest placeholder for it (#997).
         *
         * Two earlier versions of it lived here and both were wrong in the
         * same way, one level apart. The first curl-and-shelled the vendor's
         * script with no integrity check, beside an `engine/connect.js` that
         * has verified the same product against a published SHA256 since
         * 2026-08-12. The second fixed that by borrowing connect.js's
         * verified DOWNLOAD and hand-writing the rest of the install next to
         * it -- which reintroduced, from the other side, three defects
         * connect.js had already found and fixed for itself:
         *
         *   - the two paths share `store.ROOT/downloads` with no mutual
         *     exclusion, so on a bare Mac (the only machine either path runs
         *     on) a sign-in flow and a runner install can stream into the
         *     SAME .part, or sweep each other's verified binary away between
         *     the download and the install;
         *   - connect.js's `cancel()` destroys a module-global "active
         *     request", so cancelling a sign-in aborts a runner download it
         *     knows nothing about, and vice versa;
         *   - the ~281MB download was left on disk, where connect.js unlinks
         *     it on every exit for a stated reason.
         *
         * ⭐ The fix is NOT to patch those here. It is that ONE function owns
         * downloading, installing, verifying and cleaning up Claude Code, and
         * both callers use it -- which means extracting that block out of
         * `runFlow`, where it is currently woven into the sign-in state
         * machine. That is a real change to the most delicate shipped path in
         * Kosmos and it gets its own branch and its own review (#997), rather
         * than riding along with a consolidation.
         *
         * ⚠️ SO WHAT THIS KIND CAN DO TODAY IS LINK, NOT INSTALL, and the
         * refusal says so in the words a person would need. It is never a
         * silent no-op and never a false `installed`: the thing Josh's whole
         * provider ruling exists to prevent is a dead end that does not
         * explain itself.
         */
        fail(`We could not find ${m.name} on this Mac. Kosmos can use a copy that is already installed, but it cannot download one yet. Install ${m.name} yourself and Kosmos will find it.`);
        return;
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
      if (job.linked) {
        try { fs.rmSync(canonical, { force: true }); } catch { /* best effort */ }
        // ⚠️ AND THE FIELD GOES WITH IT. `linked` is documented as "the found
        // path a link points at", so leaving it set after the teardown serves
        // a screen a link that no longer exists -- this module's own
        // asserting-a-state-nobody-is-producing shape.
        job.linked = null;
      }
      fail(String((err && err.message) || err).trim() || 'the install failed');
    }
  })();
  Object.defineProperty(job, 'settled', { value: run });
  return job;
}

/** Test-only: forget every job receipt (the same shape connect.js ships). */
function resetForTests() { for (const k of Object.keys(jobs)) delete jobs[k]; }

module.exports = { MANIFEST, managedRoot, resolveBin, homeDir, status, install, download, resetForTests };
