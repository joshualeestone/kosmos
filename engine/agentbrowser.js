'use strict';
/**
 * Every agent's own private web browser (Windows #3629, Mac #3633).
 *
 * 🛑 WHY THIS EXISTS. People asked agents to look things up on sites that draw
 * their content with JavaScript -- Google Flights, Kayak, most shops -- and the
 * agent came back empty-handed: "I can't see that website". It was telling the
 * truth. WebFetch reads the HTML the server sends, and on those sites that HTML
 * is an empty shell the page's own scripts fill in later. Only a real browser
 * runs those scripts.
 *
 * 🔑 THE AGENT GETS ITS OWN BROWSER, NEVER THE PERSON'S. The operator's ruling:
 * not Claude in Chrome, not the person's Chrome with their sign-ins. So this is
 * Microsoft's Playwright MCP server, `--headless` so no window appears, and
 * `--isolated` so the profile lives in memory and dies with the run. On Windows
 * it drives the Edge that Windows 11 ships (`--browser msedge`); on a Mac, see
 * the Mac half below.
 *
 * 📌 INSTALLED ONCE, NEVER FETCHED AT LAUNCH. The server is three pinned npm
 * tarballs, fetched straight from the registry with no npm client (the Windows
 * build ships only `node`) and checked against the registry's own sha512 -- the
 * same trust anchor and the same download/tar machinery `engine/runners.js`
 * uses for Codex. It is unpacked once under the managed runners folder and run
 * with Kosmos's own node, so an agent launch never waits on the network.
 *
 * ⚠️ FAILURE IS SILENT BY DESIGN, and only in one direction. Claude Code starts
 * normally when a configured MCP server fails to start (measured on the box: a
 * server whose script is missing, and the agent still answered). But a MISSING
 * or INVALID `--mcp-config` FILE is fatal: claude refuses to start at all. So the
 * flag is only ever handed out for a file this module has just confirmed holds
 * exactly the JSON it should. No browser is an agent without a browser, never an
 * agent that does not start.
 *
 * 🍎 THE MAC HALF (#3633). A Mac has no Edge, and Playwright cannot drive Safari,
 * so on a Mac the same pinned server drives Playwright's own
 * `chrome-headless-shell`, which Kosmos downloads once into this same managed
 * folder and checks against a sha256 pinned below. It never uses the person's
 * installed Chrome. The download is about 100 MB, so it is a separate step from
 * the 4 MB server tree: `ensureShell`, started by `kickInstall` after the tree.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const runners = require('./runners');

/**
 * The pin. `@playwright/mcp`'s own dependency list names exactly `playwright` and
 * `playwright-core` at one exact version, and neither of those has dependencies
 * of its own, so these three ARE the whole tree npm would install. Integrity
 * values are the registry's `dist.integrity`, and MEASURED on the box 2026-09-24:
 * each downloaded tarball's sha512 matched. PINNED, not latest, for the same
 * reason the bundled node is: the bytes must not change because a release day
 * happened.
 */
const PIN = Object.freeze({
  version: '0.0.82',
  packages: Object.freeze([
    Object.freeze({
      name: '@playwright/mcp',
      url: 'https://registry.npmjs.org/@playwright/mcp/-/mcp-0.0.82.tgz',
      integrity: 'sha512-OCqftfb8H4dnqm/njbTBRk3seUvUPttOlJUxCtEzXGETYOlRH5Qt3bbXIjmZIuWAxD9RF+yg1ASrPeXvm0y5cA==',
    }),
    Object.freeze({
      name: 'playwright',
      url: 'https://registry.npmjs.org/playwright/-/playwright-1.64.0-alpha-1789764292000.tgz',
      integrity: 'sha512-3Ngs4ERGdC912uW3srEDtNVey4u1wSaQ/EFcKhxMpz0by0K6nidaJgM087pLpJc1osytiVnL7ack5gvgPArPNw==',
    }),
    Object.freeze({
      name: 'playwright-core',
      url: 'https://registry.npmjs.org/playwright-core/-/playwright-core-1.64.0-alpha-1789764292000.tgz',
      integrity: 'sha512-ZgRaybFv4rRy7QMGnYprEGFdNJnvapNqcaER2w96bDQA+40BWIle1el1Yh9KHD3E6XYmieMB+r+UxFTCauTGGQ==',
    }),
  ]),
});

/**
 * The Mac browser pin: the `chrome-headless-shell` build the pinned playwright-core
 * asks for (its `install --dry-run` names 154.0.8037.0), one zip per Mac CPU. The
 * sha256 values were measured on 2026-09-24 by downloading each zip. PINNED for the
 * same reason as the server: the bytes must not change because a release happened.
 */
const SHELL = Object.freeze({
  version: '154.0.8037.0',
  builds: Object.freeze({
    arm64: Object.freeze({
      url: 'https://cdn.playwright.dev/builds/cft/154.0.8037.0/mac-arm64/chrome-headless-shell-mac-arm64.zip',
      sha256: '9d4790010e56a034593b77c9e5994353885bc2dff688fe88ca71aced9b288bd7',
      folder: 'chrome-headless-shell-mac-arm64',
    }),
    x64: Object.freeze({
      url: 'https://cdn.playwright.dev/builds/cft/154.0.8037.0/mac-x64/chrome-headless-shell-mac-x64.zip',
      sha256: 'b59c4af2ee92b5cea39b0cad62e40d52ce03465a5f55922b55a8a5737f3f5387',
      folder: 'chrome-headless-shell-mac-x64',
    }),
  }),
});

/* The server's name as the agent sees it: its tools arrive as
   `mcp__kosmos-browser__browser_navigate` and so on. Prefixed so it cannot
   collide with a `browser` server the person configured themselves -- their
   connectors stay theirs, this sits beside them. */
const SERVER_NAME = 'kosmos-browser';

/* The whole on-disk shape, derived from one root so a test's
   AGENT_WORKFORCE_RUNNERS_DIR sandbox moves all of it. */
function homeDir() { return path.join(runners.managedRoot(), 'playwright-mcp'); }
function treeDir() { return path.join(homeDir(), PIN.version); }
function cliPath() { return path.join(treeDir(), 'node_modules', '@playwright', 'mcp', 'cli.js'); }
function markerPath() { return path.join(treeDir(), '.verified'); }
function configPath() { return path.join(homeDir(), 'mcp-config.json'); }
/* Where the server drops auto-named files (page snapshots, console logs). Its
   default is `.playwright-mcp` inside the agent's working folder, which on this
   platform can be a person's own project folder -- so they go to temp instead. */
function outputDir() { return path.join(os.tmpdir(), 'kosmos-agent-browser'); }
/* The Mac browser, per CPU, beside the server tree. */
function shellBuild(arch) { return SHELL.builds[arch || process.arch] || null; }
/* One folder per version AND per CPU, so installing one CPU's shell can never
   replace or delete another's. */
function shellsDir() { return path.join(homeDir(), 'chrome-headless-shell'); }
function shellDir(arch) { return path.join(shellsDir(), SHELL.version, arch || process.arch); }
function shellExe(arch) {
  const b = shellBuild(arch);
  return b ? path.join(shellDir(arch), b.folder, 'chrome-headless-shell') : null;
}
function shellMarkerPath(arch) { return path.join(shellDir(arch), '.verified'); }
const shellStamp = (arch) => SHELL.version + ' ' + (arch || process.arch) + ' ' + (shellBuild(arch) || {}).sha256;

/* What the marker vouches for: every package at its pinned version, so a marker
   left by another pin can never vouch for this tree. */
const stamp = () => PIN.packages.map((p) => p.name + '@' + p.url.split('/').pop()).join(' ');

/** True when the pinned tree is unpacked AND its server answered `--version`. */
function isInstalled() {
  try {
    return fs.readFileSync(markerPath(), 'utf8').trim() === stamp() && fs.existsSync(cliPath());
  } catch { return false; }
}

/** True when this CPU's shell is unpacked AND answered `--version`. */
function shellInstalled(arch) {
  try {
    const exe = shellExe(arch);
    return !!exe && fs.readFileSync(shellMarkerPath(arch), 'utf8').trim() === shellStamp(arch) && fs.existsSync(exe);
  } catch { return false; }
}

/* The opt-out, for an operator who does not want agents browsing at all: the
   environment variable, or a file named `off` in the managed folder. The file is
   the one a Mac can use, because a launchd-started supervisor does not inherit
   the operator's shell environment. */
function optOutPath() { return path.join(homeDir(), 'off'); }
function disabled(env) {
  const v = String((env || process.env).KOSMOS_AGENT_BROWSER || '').toLowerCase();
  if (v === 'off' || v === '0' || v === 'false') return true;
  try { return fs.existsSync(optOutPath()); } catch { return false; }
}

/**
 * The `--mcp-config` document. PURE, so its exact content is assertable from a
 * Mac. `node` is the node that runs the server (Kosmos's own, in production the
 * runtime's node.exe the supervisor itself runs under).
 */
function configFor(o) {
  const x = o || {};
  /* With an executablePath (the Mac): Playwright's own shell. `--browser chromium`
     alone would ask for the full "Chrome for Testing", which is not installed. */
  const browser = x.executablePath
    ? ['--browser', 'chromium', '--executable-path', String(x.executablePath)]
    : ['--browser', 'msedge'];
  return {
    mcpServers: {
      [SERVER_NAME]: {
        type: 'stdio',
        command: String(x.node),
        args: [String(x.cli), ...browser, '--headless', '--isolated', '--output-dir', String(x.outputDir)],
      },
    },
  };
}

/**
 * Write the config if it is not already exactly right. Returns true only when the
 * file on disk now holds `text` -- which is the only condition under which the
 * flag may be handed out (a bad file stops claude from starting at all).
 *
 * ⚠️ WRITE-IF-DIFFERENT, THEN RENAME. Every agent's supervisor asks at every
 * launch, and at logon a dozen ask at once. Once the file is right nobody writes
 * it again; while it is being written nobody can read half of it.
 */
function writeConfigIfNeeded(file, text) {
  const same = () => { try { return fs.readFileSync(file, 'utf8') === text; } catch { return false; } };
  if (same()) return true;
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
  /* A rename refused because a sibling supervisor won the race is fine, as long as
     what it wrote is what we would have. */
  return same();
}

/**
 * The config path for ONE agent launch, or null. Sync and NEVER throws: it sits
 * in the launch path, and no answer here may cost an agent its start.
 *
 * 🔑 NOT INSTALLED YET IS NOT A FAILURE. It starts the one-time install in the
 * background and answers null, so this launch goes ahead without a browser and
 * the agent's next (re)launch picks it up. The board starts the same install at
 * boot, so on a normal machine it is long done before the first agent is made.
 */
function launchConfig(opts) {
  const o = opts || {};
  try {
    const platform = o.platform || process.platform;
    if (platform !== 'win32' && platform !== 'darwin') return null;
    if (disabled(o.env)) return null;
    const mac = platform === 'darwin';
    if (!isInstalled() || (mac && !shellInstalled(o.arch))) {
      if (o.install !== false) kickInstall({ platform, arch: o.arch });
      return null;
    }
    const text = JSON.stringify(configFor({
      node: o.node || process.execPath, cli: cliPath(), outputDir: outputDir(),
      executablePath: mac ? shellExe(o.arch) : undefined,
    }), null, 2) + '\n';
    return writeConfigIfNeeded(configPath(), text) ? configPath() : null;
  } catch { return null; }
}

let inflight = null;
/** Start the install if it is not running; never throws, never rejects. Skipped
    under `node --test`, so no suite ever downloads anything by accident. */
function kickInstall(opts) {
  if (process.env.NODE_TEST_CONTEXT && !(opts && opts.force)) return null;
  if (!inflight) {
    const o = opts || {};
    const mac = (o.platform || process.platform) === 'darwin';
    inflight = ensureInstalled(o)
      .then((r) => (mac && r.ok ? ensureShell(o) : r))
      .catch((e) => ({ ok: false, because: String((e && e.message) || e) }))
      .finally(() => { inflight = null; });
  }
  return inflight;
}

const execP = (file, args, o) => new Promise((resolve, reject) => {
  execFile(file, args, o, (err, stdout) => (err ? reject(err) : resolve(String(stdout || ''))));
});

/**
 * Install the pinned tree once. Resolves { ok, already?, because? }; never throws.
 *
 * Download -> verify sha512 -> unpack each package into a private staging tree ->
 * PROVE (the server answers `--version` with the pinned version) -> write the
 * marker -> swap the finished tree in whole. The marker is written BEFORE the
 * swap, so a tree that exists under its final name is always a complete, proven
 * one; a crash anywhere earlier leaves only a staging folder.
 *
 * 📌 PER-PROCESS STAGING, the same rule runners.install states: every supervisor
 * at logon may try this at once, and the in-memory guard cannot see across
 * processes. The first swap wins; a loser finds a proven tree and throws its own
 * copy away.
 */
async function ensureInstalled(opts) {
  const o = opts || {};
  if (isInstalled()) return { ok: true, already: true };
  const doDownload = o.download || ((url, file) => runners.download(url, file, { receivedBytes: 0 }));
  const integrityOf = o.integrityOf || runners.fileIntegrity;
  const unpack = o.unpack || ((tgz, dest) => execP(runners.tarBin(), ['-xzf', tgz, '--strip-components', '1', '-C', dest], { timeout: 120000 }));
  const prove = o.prove || ((cli) => execP(o.node || process.execPath, [cli, '--version'], { timeout: 60000, windowsHide: true }));

  const home = homeDir();
  const staging = path.join(home, '.staging-' + process.pid + '-' + Date.now());
  try {
    fs.mkdirSync(staging, { recursive: true });
    for (const p of PIN.packages) {
      const tgz = path.join(staging, p.url.split('/').pop());
      await doDownload(p.url, tgz);
      const got = await integrityOf(tgz);
      if (got !== p.integrity) throw new Error(p.name + ' did not match its pinned checksum, so it was not used');
      const dest = path.join(staging, 'tree', 'node_modules', ...p.name.split('/'));
      fs.mkdirSync(dest, { recursive: true });
      await unpack(tgz, dest);
      fs.rmSync(tgz, { force: true });
    }
    const stagedCli = path.join(staging, 'tree', 'node_modules', '@playwright', 'mcp', 'cli.js');
    const said = await prove(stagedCli);
    if (!said.includes(PIN.version)) throw new Error('the browser server did not answer with its version');
    fs.writeFileSync(path.join(staging, 'tree', '.verified'), stamp() + '\n');
    if (isInstalled()) return { ok: true, already: true };   // another process won
    fs.rmSync(treeDir(), { recursive: true, force: true });  // an unproven leftover, never a live tree
    fs.renameSync(path.join(staging, 'tree'), treeDir());
    return { ok: isInstalled() };
  } catch (e) {
    if (isInstalled()) return { ok: true, already: true };
    return { ok: false, because: String((e && e.message) || e) };
  } finally {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/* One Mac browser install at a time, across processes: a lock file holding the
   owner's pid, which the owner touches every LOCK_BEAT_MS while it works. The
   lock is taken over only when its owner is gone OR its heartbeat stopped for
   LOCK_STALE_MS. A slow but live download keeps beating and keeps the lock; a
   dead owner whose pid was reused by another process stops beating, so its lock
   cannot stay stuck forever. */
const LOCK_BEAT_MS = 60 * 1000;
const LOCK_STALE_MS = 5 * 60 * 1000;
function lockPath() { return path.join(homeDir(), '.shell-install.lock'); }
function pidAlive(pid) {
  if (!(pid > 0)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
}
let beat = null;
function takeLock() {
  fs.mkdirSync(homeDir(), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath(), 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      beat = setInterval(() => { try { const t = new Date(); fs.utimesSync(lockPath(), t, t); } catch { /* gone */ } }, LOCK_BEAT_MS);
      if (beat.unref) beat.unref();
      return true;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return false;
      let owner = 0; let quiet = 0;
      try { owner = parseInt(fs.readFileSync(lockPath(), 'utf8'), 10); quiet = Date.now() - fs.statSync(lockPath()).mtimeMs; } catch { /* raced away */ }
      if (pidAlive(owner) && quiet < LOCK_STALE_MS) return false;
      try { fs.rmSync(lockPath(), { force: true }); } catch { return false; }
    }
  }
  return false;
}
function dropLock() {
  if (beat) { clearInterval(beat); beat = null; }
  try { if (parseInt(fs.readFileSync(lockPath(), 'utf8'), 10) === process.pid) fs.rmSync(lockPath(), { force: true }); } catch { /* not ours or gone */ }
}

/* Remove what an interrupted install left: staging folders whose owner pid is
   gone (named `.staging-<pid>-<ms>` and `.shell-staging-<pid>-<ms>`). Old shell
   versions are pruned to the pinned one plus the newest other, so an agent
   still running under the previous release keeps the browser its config names. */
function sweepLeftovers() {
  const home = homeDir();
  let names = [];
  try { names = fs.readdirSync(home); } catch { return; }
  for (const n of names) {
    const m = /^\.(?:shell-)?staging-(\d+)-\d+$/.exec(n);
    if (m && Number(m[1]) !== process.pid && !pidAlive(Number(m[1]))) {
      try { fs.rmSync(path.join(home, n), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
  const shells = shellsDir();
  try {
    const others = fs.readdirSync(shells).filter((v) => v !== SHELL.version)
      .map((v) => ({ v, t: fs.statSync(path.join(shells, v)).mtimeMs }))
      .sort((x, y) => y.t - x.t);
    for (const { v } of others.slice(1)) {
      try { fs.rmSync(path.join(shells, v), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  } catch { /* none yet */ }
}

const sha256Of = (file) => new Promise((resolve, reject) => {
  const h = require('node:crypto').createHash('sha256');
  fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

/**
 * Install this Mac's pinned `chrome-headless-shell` once. Resolves { ok, already?,
 * because? }; never throws. The same order as ensureInstalled: download -> check
 * the pinned sha256 -> unpack into private staging (`ditto`, which keeps the
 * bundle's symlinks and modes) -> PROVE (the shell answers `--version` with the
 * pinned version) -> marker -> swap in whole.
 */
async function ensureShell(opts) {
  const o = opts || {};
  const arch = o.arch || process.arch;
  const build = shellBuild(arch);
  if (!build) return { ok: false, because: 'no pinned browser for this Mac CPU (' + arch + ')' };
  if (shellInstalled(arch)) return { ok: true, already: true };
  if (!takeLock()) return { ok: false, because: 'another browser install is already running' };
  sweepLeftovers();
  const doDownload = o.download || ((url, file) => runners.download(url, file, { receivedBytes: 0 }));
  const hashOf = o.sha256Of || sha256Of;
  const unzip = o.unzip || ((zip, dest) => execP('/usr/bin/ditto', ['-x', '-k', zip, dest], { timeout: 300000 }));
  const prove = o.proveShell || ((exe) => execP(exe, ['--version'], { timeout: 60000 }));

  const staging = path.join(homeDir(), '.shell-staging-' + process.pid + '-' + Date.now());
  try {
    fs.mkdirSync(staging, { recursive: true });
    const zip = path.join(staging, build.url.split('/').pop());
    await doDownload(build.url, zip);
    if ((await hashOf(zip)) !== build.sha256) throw new Error('the browser download did not match its pinned checksum, so it was not used');
    const tree = path.join(staging, 'tree');
    fs.mkdirSync(tree, { recursive: true });
    await unzip(zip, tree);
    fs.rmSync(zip, { force: true });
    const said = await prove(path.join(tree, build.folder, 'chrome-headless-shell'));
    if (!said.includes(SHELL.version)) throw new Error('the browser did not answer with its version');
    fs.writeFileSync(path.join(tree, '.verified'), shellStamp(arch) + '\n');
    fs.mkdirSync(path.dirname(shellDir(arch)), { recursive: true });
    /* Under the lock no other install is running, so anything at this CPU's
       folder now is a leftover that never got its marker. */
    fs.rmSync(shellDir(arch), { recursive: true, force: true });
    fs.renameSync(tree, shellDir(arch));
    return { ok: shellInstalled(arch) };
  } catch (e) {
    if (shellInstalled(arch)) return { ok: true, already: true };
    return { ok: false, because: String((e && e.message) || e) };
  } finally {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
    dropLock();
  }
}

/**
 * The board's Mac install: kick it, and if it fails, say why and try again later,
 * backing off from RETRY_FIRST_MS to RETRY_MAX_MS, until it is installed or the
 * operator opts out. A login-time download that meets no network would otherwise
 * leave every agent without a browser until the next board start. Timers are
 * unref'd, so this never keeps a process alive. Returns a stop function.
 */
const RETRY_FIRST_MS = 60 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;
function installWithRetry(opts) {
  const o = opts || {};
  const log = o.log || ((line) => console.log(line));
  const kick = o.kick || kickInstall;
  let delay = o.firstDelayMs || RETRY_FIRST_MS;
  let timer = null; let stopped = false;
  const attempt = () => {
    if (stopped || disabled(o.env)) return;
    const p = kick({ platform: o.platform, arch: o.arch });
    if (!p) return;
    p.then((r) => {
      if (stopped || (r && r.ok)) return;
      log('agent browser: install did not finish (' + ((r && r.because) || 'unknown') + '); trying again in ' + Math.round(delay / 1000) + 's');
      timer = setTimeout(attempt, delay);
      if (timer.unref) timer.unref();
      delay = Math.min(delay * 2, o.maxDelayMs || RETRY_MAX_MS);
    });
  };
  attempt();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = {
  PIN, SHELL, SERVER_NAME, configFor, launchConfig, ensureInstalled, ensureShell, kickInstall, isInstalled,
  installWithRetry, shellInstalled, shellExe, shellDir, homeDir, treeDir, cliPath, configPath, outputDir,
  optOutPath, lockPath, disabled,
};
