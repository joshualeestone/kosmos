'use strict';
/**
 * Every Windows agent's own private web browser.
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
 * Microsoft's Playwright MCP server driving the Microsoft Edge every Windows 11
 * already ships (`--browser msedge`: nothing to download), `--headless` so no
 * window appears, and `--isolated` so the profile lives in memory and dies with
 * the run -- it never opens, reads or writes the person's own Edge profile,
 * cookies or logins.
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
 * 📌 WINDOWS ONLY, for now. The Mac fleet ports it; until then nothing here runs
 * on a Mac and Mac argv is byte-identical.
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

/* What the marker vouches for: every package at its pinned version, so a marker
   left by another pin can never vouch for this tree. */
const stamp = () => PIN.packages.map((p) => p.name + '@' + p.url.split('/').pop()).join(' ');

/** True when the pinned tree is unpacked AND its server answered `--version`. */
function isInstalled() {
  try {
    return fs.readFileSync(markerPath(), 'utf8').trim() === stamp() && fs.existsSync(cliPath());
  } catch { return false; }
}

/* The opt-out, for an operator who does not want agents browsing at all. */
function disabled(env) {
  const v = String((env || process.env).KOSMOS_AGENT_BROWSER || '').toLowerCase();
  return v === 'off' || v === '0' || v === 'false';
}

/**
 * The `--mcp-config` document. PURE, so its exact content is assertable from a
 * Mac. `node` is the node that runs the server (Kosmos's own, in production the
 * runtime's node.exe the supervisor itself runs under).
 */
function configFor(o) {
  const x = o || {};
  return {
    mcpServers: {
      [SERVER_NAME]: {
        type: 'stdio',
        command: String(x.node),
        args: [String(x.cli), '--browser', 'msedge', '--headless', '--isolated', '--output-dir', String(x.outputDir)],
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
    if ((o.platform || process.platform) !== 'win32') return null;
    if (disabled(o.env)) return null;
    if (!isInstalled()) {
      if (o.install !== false) kickInstall();
      return null;
    }
    const text = JSON.stringify(configFor({ node: o.node || process.execPath, cli: cliPath(), outputDir: outputDir() }), null, 2) + '\n';
    return writeConfigIfNeeded(configPath(), text) ? configPath() : null;
  } catch { return null; }
}

let inflight = null;
/** Start the install if it is not running; never throws, never rejects. Skipped
    under `node --test`, so no suite ever downloads anything by accident. */
function kickInstall(opts) {
  if (process.env.NODE_TEST_CONTEXT && !(opts && opts.force)) return null;
  if (!inflight) {
    inflight = ensureInstalled(opts).catch((e) => ({ ok: false, because: String((e && e.message) || e) }))
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

module.exports = {
  PIN, SERVER_NAME, configFor, launchConfig, ensureInstalled, kickInstall, isInstalled,
  homeDir, treeDir, cliPath, configPath, outputDir, disabled,
};
