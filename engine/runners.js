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
const zlib = require('zlib');
const { execFile } = require('child_process');
const platformGate = require('./platform');


/**
 * The artifacts, one per provider this machinery knows about.
 *
 * ⚠️ NOT ALL OF THEM ARE PINNED, and this heading used to say they were.
 * The tarball kind (openai) has a frozen url + integrity, and everything
 * below about npm integrity describes it. The vendor-external kind (claude)
 * has NEITHER: its version and checksum are the vendor's, discovered at run
 * time, and on this branch it is not downloaded at all. Read the per-entry
 * comments for which is which rather than this heading.
 *
 * On the tarball kind: npm's registry publishes a sha512 integrity for every tarball
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
    /* ⚠️ THE NAME A PERSON READS, and it flows into six sentences below via
       `${m.name}`. It said "OpenAI runner". "Runner" is OUR word: it appears
       nowhere OpenAI publishes, so somebody who searches it finds nothing.
       That is precisely the noun that put "tmux" on a screen, which this
       codebase has two rulings against.
       📌 "OpenAI's Codex" keeps the parallel with "Claude Code" (vendor named
       alongside product) and is accurate to what is actually downloaded.
       Mona Lisa's call, 2026-08-26, and the copy on the Connect screens uses
       the same three names: the provider is OpenAI, the row says GPT, the
       thing installed is OpenAI's Codex. */
    name: "OpenAI's Codex",
    version: '0.149.1',
    arch: 'arm64',
    url: 'https://registry.npmjs.org/@openai/codex/-/codex-0.149.1-darwin-arm64.tgz',
    integrity: 'sha512-6X84kTCbnTgPIJ2EdcPsrvwS0Wxsqpa+bCswGmRf4BjhcQ5nPMnBC6yCAaCMj+vrbXQHj+L6sa9FaR4QkmA1qw==',
    binInPackage: 'vendor/aarch64-apple-darwin/bin/codex',
    binName: 'codex',
    downloadBytes: 114152335,
  },
  /* #3713: Google's Gemini CLI, which Kosmos's Gemini runner (#3296) drives. Same trust
     anchor as the codex entry: the npm registry's own sha512 for this exact tarball, fetched
     with no npm client. 0.61.0 is the version #3296 was built and measured against on the
     fleet Mac, and npm's latest on 2026-09-25.
     ⚠️ IT IS A NODE PROGRAM, NOT A BINARY. The tarball is a self-contained `bundle/` (449
     files, no node_modules; listed 2026-09-25) whose entry starts `#!/usr/bin/env node`, and a
     fresh Mac has no `node` on its PATH. So the one stable path is not a symlink to the bundle
     but a small launcher (`launcher: 'node'`) that runs it with the node this board runs on,
     which on an installed Kosmos is its own shipped runtime. The tarball is the same for every
     CPU, so there is no `arch`. */
  gemini: {
    name: "Google's Gemini CLI",
    version: '0.61.0',
    url: 'https://registry.npmjs.org/@google/gemini-cli/-/gemini-cli-0.61.0.tgz',
    integrity: 'sha512-dbQ9A0qBtFJNi6XBkHvfZ6Azpn6PNgH/P8h2MZ67RLlX8hSAVjup39CRWqdRxZv7YXIuhrFaytr8y0jKnkoxnQ==',
    binInPackage: 'bundle/gemini.js',
    binName: 'gemini',
    launcher: 'node',
    downloadBytes: 20772697,
  },
  /* #3713: xAI's Grok CLI (Grok Build), which Kosmos's Grok runner (#3391) drives. The
     npm package @xai-official/grok is a wrapper; the program is a per-CPU package
     (@xai-official/grok-darwin-arm64, -darwin-x64) holding ONE brotli-compressed native
     binary, `bin/grok.br`, which the vendor's postinstall decompresses (read 2026-09-25:
     brotli-decompress, chmod 755, nothing else). Kosmos runs no npm scripts, so the install
     does that step itself (`brotliFrom`) after the tarball's checksum has passed. 1.0.41 is
     npm's latest and the version this Mac ran #3391 on. The Intel build is GROK_DARWIN.x64
     below. */
  grok: {
    name: "xAI's Grok CLI",
    version: '1.0.41',
    arch: 'arm64',
    url: 'https://registry.npmjs.org/@xai-official/grok-darwin-arm64/-/grok-darwin-arm64-1.0.41.tgz',
    integrity: 'sha512-EVyCWTOe1ZDdURiK8EvRUw9Q8BPU2Upnc6o+ECwXYXSCtRmlR9/MxqNt6beZtOujjyAsAWE7VRBvjZrtyCTFWw==',
    brotliFrom: 'bin/grok.br',
    binInPackage: 'bin/grok-native',
    binName: 'grok',
    downloadBytes: 42511097,
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
 * The WINDOWS builds of the same pinned Codex version, keyed by process.arch.
 *
 * 📌 Same source and same trust anchor as the darwin entry above: the npm registry
 * publishes each platform build as a version of @openai/codex itself
 * (`0.149.1-win32-x64`, `0.149.1-win32-arm64`), and each version document carries a
 * vendor-published `dist.integrity`. MEASURED on a Windows 11 box, 2026-09-19: both
 * tarballs downloaded, their sha512 matched the registry integrity pinned here, the
 * byte counts below are the real file sizes, and the x64 tree unpacked with the
 * Windows-shipped tar.exe and `codex.exe --version` answered `codex-cli 0.149.1`.
 *
 * ⚠️ THE LAYOUT DIFFERS FROM THE MAC ONE IN ONE WAY THAT MATTERS: the binary is
 * `codex.exe` beside vendored siblings (codex-path/rg.exe, codex-resources/
 * codex-command-runner.exe, codex-windows-sandbox-setup.exe) that it resolves
 * relative to ITSELF. The Mac install exposes one stable path through a symlink,
 * and a symlink on Windows needs Developer Mode or elevation, which a clean laptop
 * has neither of. So on win32 the stable path IS the binary inside the unpacked
 * tree (see managedBin); the tree is swapped in whole, so that path never names a
 * half-written tree.
 */
const CODEX_WIN32 = Object.freeze(Object.assign(Object.create(null), {
  x64: Object.freeze({
    arch: 'x64',
    url: 'https://registry.npmjs.org/@openai/codex/-/codex-0.149.1-win32-x64.tgz',
    integrity: 'sha512-G3QXGAg7nyyhqOeooAMUekBCeHd8a1QByhKcVAFyzNBaI06t6Ft7nsF+1SzFS0spuIdU4YyMi5YD26ukADBQUQ==',
    binInPackage: 'vendor/x86_64-pc-windows-msvc/bin/codex.exe',
    downloadBytes: 139929729,
  }),
  arm64: Object.freeze({
    arch: 'arm64',
    url: 'https://registry.npmjs.org/@openai/codex/-/codex-0.149.1-win32-arm64.tgz',
    integrity: 'sha512-5K0DmOKGK9Bos627p8sK8ATHjovPK0sDyT6h9Cb+4v+5CW5SGw1HLgjGxoLfJ8g3cg6mtg/pRCXXo2L/j71UVA==',
    binInPackage: 'vendor/aarch64-pc-windows-msvc/bin/codex.exe',
    downloadBytes: 130863958,
  }),
}));

/**
 * #3713: the Intel Mac build of the same pinned Grok CLI. Same source and trust anchor as
 * the arm64 entry (its own registry sha512; the tarball downloaded, matched it, and was
 * measured at this size, 2026-09-25) and the same layout, one `bin/grok.br`.
 */
const GROK_DARWIN = Object.freeze(Object.assign(Object.create(null), {
  x64: Object.freeze({
    arch: 'x64',
    url: 'https://registry.npmjs.org/@xai-official/grok-darwin-x64/-/grok-darwin-x64-1.0.41.tgz',
    integrity: 'sha512-f7BK6JwObPuDwkV6T5H7HuH46Txa522k1F+mKIxdcgu9C+mPGTiSZSzcGXFShifJ4IZuh4Tq7vqOQacQNEEWWA==',
    downloadBytes: 49619881,
  }),
}));

/**
 * The manifest entry for `provider` ON A GIVEN PLATFORM AND CPU. Everything that
 * installs or resolves a runner asks this rather than reading MANIFEST directly,
 * so the Mac and Windows answers can never drift into two resolvers again.
 *
 * On win32 the openai entry is the darwin one with the Windows build's url,
 * integrity, binary path and size laid over it (version and name are shared: it is
 * the same pinned release). A Windows CPU with no published build (ia32) gets the
 * x64 entry, so install()'s arch guard refuses it BY NAME before a byte moves,
 * exactly as an Intel Mac is refused against the arm64 pin.
 * `platform`/`arch` default to this process; they are parameters so the win32
 * answer is assertable from the Mac CI runs on.
 */
function manifestFor(provider, platform = process.platform, arch = process.arch) {
  if (!Object.hasOwn(MANIFEST, provider)) return null;
  const base = MANIFEST[provider];
  if (provider === 'openai' && platform === 'win32') {
    const build = CODEX_WIN32[arch] || CODEX_WIN32.x64;
    return Object.freeze({ ...base, ...build, binName: 'codex.exe' });
  }
  if (provider === 'grok' && platform === 'darwin' && GROK_DARWIN[arch]) {
    return Object.freeze({ ...base, ...GROK_DARWIN[arch] });
  }
  return base;
}

/**
 * The one stable path a managed tarball runner is reached by, for a manifest entry
 * from manifestFor(). Mac: the `codex` symlink beside the tree. Windows: the binary
 * inside the tree itself (no symlink; see CODEX_WIN32). `platform` picks the path
 * FLAVOUR too, for the same reason pathextCandidates does.
 */
/**
 * The Windows "this build ran" marker: written ONLY after `codex.exe --version`
 * succeeded, removed before any new tree is swapped in, and naming the build it
 * vouches for (version + binary path) so an older marker cannot vouch for a newer
 * tree. resolveBin's win32 managed rung requires it; see the comment there.
 */
function verifiedMarker(platform = process.platform) {
  const flavour = platform === 'win32' ? path.win32 : path;
  return flavour.join(managedRoot(), 'openai', '.verified');
}
const verifiedStamp = (m) => `${m.version} ${m.binInPackage}`;
function isVerified(m, platform = process.platform) {
  try { return fs.readFileSync(verifiedMarker(platform), 'utf8').trim() === verifiedStamp(m); } catch { return false; }
}

function managedBin(m, platform = process.platform, provider = 'openai') {
  const flavour = platform === 'win32' ? path.win32 : path;
  /* #3713: each managed runner has its own folder under managedRoot(), named for its
     provider, which is where install() stages it (`destDir`). This defaulted to 'openai'
     when that was the only one; the default keeps every existing caller's answer. */
  const dest = flavour.join(managedRoot(), provider);
  if (platform === 'win32') return flavour.join(dest, 'pkg', ...m.binInPackage.split('/'));
  return flavour.join(dest, m.binName);
}

/**
 * Where managed runners live. An installed Kosmos keeps them inside
 * KOSMOS_HOME beside app/ and runtime/ (this file runs from app/engine,
 * same derivation as update.js's installedRoot); a from-source checkout
 * falls back to the well-known install home so a dev board and an
 * installed board resolve the same managed runner rather than each
 * installing their own.
 */
/* ⚠️ Keys on `os.homedir()` DIRECTLY, NOT homeDir(). Deliberate and worth
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
  const base = installed ? home : path.join(os.homedir(), '.local', 'share', 'kosmos');
  return path.join(base, 'runners');
}

/**
 * The names win32 will actually launch for a path written WITHOUT a suffix.
 *
 * 🛑 WHY THIS EXISTS (#570). Claude's canonical rung is `<home>/.local/bin/claude`
 * -- no `.exe`, because the vendor's POSIX install has none. On Windows the file
 * on disk is `claude.exe`, so `statSync` on the canonical string throws and
 * `isRunnable` said FALSE for a runner that is present and demonstrably
 * launchable. Measured on the Windows box: `resolveBin('claude').present` read
 * false while `spawnSync` ON THAT EXACT STRING ran Claude and printed its
 * version -- because win32 appends a PATHEXT suffix when it resolves an image,
 * for an absolute path and not only for a bare PATH name. So the SPAWN was never
 * broken; the presence GATE in front of it was, and creation refused with "we
 * could not find Claude Code on this computer" while Claude Code sat right there.
 * ⚠️ A FALSE NEGATIVE, WHICH IS THE SAFE DIRECTION AND STILL WRONG. It refused a
 * good machine rather than vouching for a bad one, which is why it never showed
 * up as a crash -- it showed up as Windows simply never being able to make an
 * agent.
 * ⚠️ THE SUFFIX IS ONLY EVER ADDED, NEVER SUBSTITUTED, and only when the path
 * carries no extension of its own: an operator who points
 * AGENT_WORKFORCE_CLAUDE_BIN at a specific file gets that file's answer, not a
 * sibling's.
 */
function pathextCandidates(p, platform = process.platform, env = process.env) {
  if (platform !== 'win32') return [p];
  /* 🛑 path.win32.extname, NOT path.extname -- this function committed, inside
     itself, the very bug it exists to fix. Bare `path.extname` is the HOST's
     flavour: on a Mac it is the POSIX one, which does not treat a backslash as a
     separator, so it reads `C:\Users\a\.local\bin\claude` as a single basename
     and returns ".local\bin\claude". Non-empty, so the win32 branch concluded the
     path already carried a suffix and offered no candidates -- correct on
     Windows, inert everywhere else, and therefore invisible to me while every
     measurement I ran was on Windows. CI on the Mac caught it, which is the
     machine whose blind spot the injected platform exists to remove.
     ⇒ The path FLAVOUR must be chosen by the platform being REASONED ABOUT,
     never by the one doing the reasoning. */
  if (path.win32.extname(p)) return [p];
  /* The machine's own list, because it is the list the loader will use; the
     literal is the documented Windows default for the case where the variable
     is missing from a stripped environment. */
  const exts = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';').map((e) => e.trim()).filter(Boolean);
  return [p, ...exts.map((e) => p + e)];
}

/**
 * Present means RUNNABLE: a plain file with an exec bit. A directory or a
 * stripped file at a runner path reading as present is the exact
 * folder-sails-through trap setup.sh's check_claude_code documents from
 * #133 -- status would vouch for a runner that cannot start an agent.
 *
 * ⚠️ #570: on win32 the SUFFIXED names are tried too (see pathextCandidates),
 * because that is what the platform will actually launch. Every candidate still
 * has to clear the SAME isFile + X_OK assertions -- the #133 trap is not widened
 * by looking in one more place for the file, only by lowering the bar for what
 * counts as one, which this does not do.
 */
function isRunnable(p) {
  return runnableCandidate(p) !== null;
}

/**
 * The file the platform would actually launch for `p` (the first of pathextCandidates that
 * clears runnableExactly), or null. isRunnable is this answer as a yes/no, so a caller that
 * needs the FILE (the Windows sign-in line names it) asks the same question in the same spelling.
 *
 * `platform`/`env` are injectable (default the host's) so a caller REASONING ABOUT win32 from a
 * POSIX host gets the win32 answer -- the same seam pathextCandidates and runnableExactly carry,
 * and the reason win32launch.binFor (#3323) can ask "would Windows launch this path" off the box.
 */
function runnableCandidate(p, platform = process.platform, env = process.env) {
  for (const candidate of pathextCandidates(p, platform, env)) {
    if (runnableExactly(candidate, platform, env)) return candidate;
  }
  return null;
}

/**
 * On win32 executability is the EXTENSION, not a mode bit: the loader launches a
 * file only if its suffix is in PATHEXT (.COM/.EXE/.BAT/.CMD/...). #2183's
 * pathextCandidates already encodes this; this is the same list, asked as a
 * yes/no about a specific path. Uses `path.win32.extname` so the answer is
 * correct when the platform is REASONED ABOUT from a POSIX host (the
 * pathextCandidates lesson), and matches case-insensitively because Windows
 * does. Empty extension -> not runnable (the #2270 case: a plain `claude`).
 */
function hasExecutableExt(p, env = process.env) {
  const ext = path.win32.extname(String(p)).toUpperCase();
  if (!ext) return false;
  const exts = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';').map((e) => e.trim().toUpperCase()).filter(Boolean);
  return exts.includes(ext);
}

/* `platform`/`env` are injectable (default the host's) so the win32 branch is
   testable from the POSIX box CI runs on -- the same seam pathextCandidates
   carries. NOT threaded through `isRunnable`, which is used as an Array
   callback (element, index, array) and must stay single-argument (see
   engine.runnable-not-directory.test.js). isRunnable calls this with the host
   platform, which is correct on the machine it actually runs on. */
function runnableExactly(p, platform = process.platform, env = process.env) {
  try {
    const st = fs.statSync(p); // follows symlinks, which is the point
    if (!st.isFile()) return false;
    /* 🛑 X_OK IS A NO-OP ON WIN32 (#2270). Node documents an X_OK access check
       as behaving like F_OK on Windows, and chmod there only toggles the
       read-only bit, so BOTH halves of the POSIX check are inert: a plain,
       extensionless `claude` reads as runnable and Kosmos reports a runner it
       cannot launch. On win32 the real question is the extension, ask THAT. */
    if (platform === 'win32') return hasExecutableExt(p, env);
    // POSIX: X_OK, not `mode & 0o111`: the mode bits answer "can SOMEBODY
    // execute this", and a root-owned 0o700 binary passes that while failing at
    // launch for us. accessSync asks the only question that matters -- can THIS
    // process run it.
    //
    // 📌 The count of who calls this is held by the sweep in
    // engine.runnable-not-directory.test.js, not by a census in this comment.
    // Two earlier drafts of that census were stale; both are in the plan.
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
  /* 🛑 `os.homedir()` DIRECTLY, not a module-level const (#1432). This
     function was already lazy about the env var and fell back to a HOME
     frozen at require time, so the sandbox seam worked and the fallback
     did not. Half a lazy resolver reads as a whole one. */
  return process.env.AGENT_WORKFORCE_HOME || os.homedir();
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
 * managedRoot(), which keys on os.homedir() directly and has its own sandbox
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
    // `envName` travels with the answer for the same reason `overridden`
    // does: install()'s refusal names the variable a person must unset, and
    // re-deriving that name from the provider there would confidently tell
    // the third provider's operator to unset AGENT_WORKFORCE_CODEX_BIN.
    if (envClaude) return { bin: envClaude, present: isRunnable(envClaude), managed: false, overridden: true, envName: 'AGENT_WORKFORCE_CLAUDE_BIN' };
    // AGENT_WORKFORCE_HOME is the same sandbox seam openaiaccounts keys
    // its homeDir() on -- without it, every test on this fleet Mac would see
    // the real ~/.local/bin/claude and read present. Unset in production.
    // MANIFEST.claude.binName, not a literal: findElsewhere already reads it
    // from there, and two spellings of one name is how they drift apart.
    const canonical = path.join(homeDir(), '.local', 'bin', MANIFEST.claude.binName);
    return { bin: canonical, present: isRunnable(canonical), managed: false, overridden: false };
  }
  /* #3296: the Gemini runner. Like the claude branch, this is a LEGACY-rung
     resolution today, not a managed tarball install: the gemini CLI is a
     node-script package whose `gemini` bin is a `#!/usr/bin/env node` shebang
     script (with the exec bit, so it clears isRunnable's X_OK exactly like
     codex's symlink). A managed MANIFEST.gemini install is a later hardening;
     until then the runner is the vendor's npm-global `gemini`, resolved the same
     way codex resolves its legacy `/opt/homebrew/bin/codex` rung on this box.

     Rungs: the env override (the harness/self-host contract every bin path
     honours), then the legacy npm-global path. `managed` is always false (no
     Kosmos-managed location yet), matching the vendor-external shape of the
     claude branch. `envName` travels with the answer for the same reason it does
     on the other branches: a refusal that names a variable must name the RIGHT
     one. */
  if (provider === 'gemini') {
    const envGemini = process.env.AGENT_WORKFORCE_GEMINI_BIN;
    if (envGemini) return { bin: envGemini, present: isRunnable(envGemini), managed: false, overridden: true, envName: 'AGENT_WORKFORCE_GEMINI_BIN' };
    /* #3713: the copy Kosmos installed comes first, then the vendor's npm-global one this
       Mac already had. Absent both, the answer names the managed path, so an install is
       seen the moment it lands and a refusal names where it would go (as openai's does). */
    const plat = (opts && opts.platform) || process.platform;
    const managed = managedBin(manifestFor('gemini', plat, (opts && opts.arch) || process.arch), plat, 'gemini');
    if (isRunnable(managed)) return { bin: managed, present: true, managed: true, overridden: false };
    const legacy = (opts && opts.legacyBin) || '/opt/homebrew/bin/gemini';
    if (isRunnable(legacy)) return { bin: legacy, present: true, managed: false, overridden: false };
    return { bin: managed, present: false, managed: true, overridden: false };
  }
  /* #3391: the Grok runner. Same LEGACY-rung shape as gemini, and for the same
     reason it is not a managed tarball install yet: the grok CLI is the
     @xai-official/grok npm package whose `grok` bin is a NATIVE binary
     (/opt/homebrew/bin/grok -> node_modules/@xai-official/grok/bin/grok-native,
     with the exec bit, so it clears isRunnable's X_OK exactly like codex's
     symlink). A managed MANIFEST.grok install is a later hardening; until then the
     runner is the vendor's npm-global `grok`, resolved the same way codex resolves
     its legacy /opt/homebrew/bin/codex rung on this box.

     Rungs: the env override (the harness/self-host contract every bin path
     honours), then the legacy npm-global path. `managed` is always false (no
     Kosmos-managed location yet), matching the vendor-external shape of the claude
     and gemini branches. `envName` travels with the answer so a refusal names the
     RIGHT variable. */
  if (provider === 'grok') {
    const envGrok = process.env.AGENT_WORKFORCE_GROK_BIN;
    if (envGrok) return { bin: envGrok, present: isRunnable(envGrok), managed: false, overridden: true, envName: 'AGENT_WORKFORCE_GROK_BIN' };
    /* #3713: the copy Kosmos installed comes first, then the vendor's npm-global one this
       Mac already had. Absent both, the answer names the managed path, so an install is
       seen the moment it lands and a refusal names where it would go (as openai's does). */
    const plat = (opts && opts.platform) || process.platform;
    const managed = managedBin(manifestFor('grok', plat, (opts && opts.arch) || process.arch), plat, 'grok');
    if (isRunnable(managed)) return { bin: managed, present: true, managed: true, overridden: false };
    const legacy = (opts && opts.legacyBin) || '/opt/homebrew/bin/grok';
    if (isRunnable(legacy)) return { bin: legacy, present: true, managed: false, overridden: false };
    return { bin: managed, present: false, managed: true, overridden: false };
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
  if (envBin) return { bin: envBin, present: isRunnable(envBin), managed: false, overridden: true, envName: 'AGENT_WORKFORCE_CODEX_BIN' };
  // The platform/arch seams ride on the same opts install() passes through, so a
  // test that installs "as win32" also resolves as win32.
  const plat = (opts && opts.platform) || process.platform;
  const mf = manifestFor('openai', plat, (opts && opts.arch) || process.arch);
  const managed = managedBin(mf, plat);
  /* 🛑 ON WINDOWS, EXISTING IS NOT INSTALLED. The Mac's managed runner is a symlink
     the installer only leaves up after --version passed; on Windows the runner is
     codex.exe inside the unpacked tree, and a tree that failed its --version (or
     whose cleanup antivirus blocked) still has a codex.exe in it. So the managed
     rung counts on win32 only when the VERIFIED marker for this exact build is
     there, and that marker is written after --version succeeds and removed before
     any new tree is swapped in. */
  if (plat === 'win32' && isRunnable(managed) && !isVerified(mf, plat)) {
    const legacy = (opts && opts.legacyBin) || '/opt/homebrew/bin/codex';
    if (isRunnable(legacy)) return { bin: legacy, present: true, managed: false, overridden: false };
    return { bin: managed, present: false, managed: true, overridden: false };
  }
  const candidates = [
    managed,
    // Testing seam for the last rung only: the real legacy path is
    // machine state a test cannot control (this computer genuinely has a
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
 *   vendor-external kind: phase 'linking'   (its only pre-prove phase until
 *                        #997 gives it a real install; it fetches nothing)
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
 * 📌 IT IS NOW EXACTLY THAT RULE, and this paragraph used to say the opposite.
 * It claimed the tarball job has no `linked` and the synthetic no `version`,
 * as deliberate exceptions. Both were true of `main` and neither survived the
 * fix below: `blankJob()` is spread into every shape, so the tarball job DOES
 * carry `linked: null` and the synthetic DOES carry `version: null` -- and
 * this branch's own test asserts that second one. A screen author reading the
 * retired wording would have used `'linked' in job` to tell the kinds apart
 * and been wrong on every arm.
 *
 * ⚠️ TELL THE KINDS APART BY `kind`, WHICH IS PUBLISHED FOR EXACTLY THAT, not
 * by which fields happen to be present.
 */
const jobs = Object.create(null);

/**
 * The fields whose ABSENCE IS A FACT ABOUT THE ARM, all spelled `null`.
 *
 * ⚠️ Not literally every field a job carries: `because` (failed only) and
 * `proved` (installed only) belong to the arm that has something to say. The
 * heading used to claim all of them, which is the kind of small overstatement
 * that makes a reader distrust the rest of the block.
 *
 * 🛑 IT EXISTS BECAUSE THE ABSENCES HAD FOUR SPELLINGS. `receivedBytes` was
 * missing from the refusal arms while every real job spelled it `null`;
 * `version` and `linked` were missing from the refusal AND the
 * already-present synthetic while the linking job spelled them `null`. All of
 * those cross the wire as `{ job }` from the same route, so one screen field
 * read `undefined` from one arm and `null` from another for the SAME
 * provider. An earlier version of the docblock above carved out an exception
 * for exactly this -- but that carve-out would equally have justified leaving
 * `receivedBytes` alone, and it was already agreed that one was a defect. The
 * rule cannot hold for one field and not its neighbours, so it holds for all
 * of them and this is the one place that decides what "all" means.
 *
 * ⚠️ `null` IS NOT A CLAIM. The synthetic's own comment argues against
 * carrying a `version` for a present binary of unknown age, and it is right:
 * what it argues against is asserting the PINNED version as if it had been
 * proved. `null` asserts nothing -- it says the question has no answer here,
 * which is exactly the fact.
 */
const blankJob = () => ({
  receivedBytes: null, totalBytes: null, version: null, linked: null,
  // ⚠️ `proved` TOO, and it was the surviving fifth spelling. Two arms answer
  // phase 'installed' through the same `{ job }` response: a real install sets
  // this to the runner's own --version line, and the already-present synthetic
  // omitted the key, so JSON.stringify dropped it and a screen read `undefined`
  // from one arm and a string from the other, for the same field. Four
  // spellings were fixed and this one survived because it is set LATER rather
  // than never, which is exactly how it stayed invisible.
  proved: null,
});

function status() {
  const out = {};
  for (const provider of Object.keys(MANIFEST)) {
    // This machine's build (on Windows, the win32 size and pin), so the "x of y"
    // a progress bar draws is the file this computer would actually fetch.
    const m = manifestFor(provider);
    const r = resolveBin(provider);
    // A failed job beside a runner that has since become present (hand
    // install, env fixed) is a stale contradiction; presence retires it
    // so a polling screen never shows a failure banner over a working
    // runner.
    if (r.present && jobs[provider] && jobs[provider].phase === 'failed') delete jobs[provider];
    /* ⚠️ NOT PRESENT WHILE AN INSTALL IS RUNNING. During `proving` the Mac symlink
       is already up, so presence read true while --version could still fail, and
       both screens poll `present` to move on to the key step. A live job is the
       truth of that moment; install() and the add-key route already treat it so. */
    const live = jobs[provider] && jobs[provider].phase !== 'installed' && jobs[provider].phase !== 'failed';
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
      // `?? null` for the same reason pinnedVersion has it: the next kind
      // that omits the key would otherwise drop the field off the wire.
      downloadBytes: m.downloadBytes ?? null,
      present: r.present && !live,
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
 * The tar that unpacks a runner tarball. The Mac's is /usr/bin/tar. Windows 10
 * (1803) and later ship bsdtar as %SystemRoot%\System32\tar.exe, which reads .tgz
 * natively and takes the same flags; there is no /usr/bin on Windows, and a clean
 * laptop has no Git or MSYS tar to fall back on, so the system copy is named by its
 * full path rather than found on PATH (where a stray GNU tar could shadow it and
 * misread `C:\` as a remote host).
 */
function tarBin(platform = process.platform, env = process.env) {
  if (platform !== 'win32') return '/usr/bin/tar';
  return path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'tar.exe');
}

/**
 * renameSync, retried briefly on win32 only. Windows refuses to rename a folder
 * while anything holds a file inside it open, and antivirus scanning a freshly
 * unpacked .exe is exactly that, for a moment. A few short retries ride that out;
 * a rename that is STILL refused after them is a real failure and is thrown.
 */
async function renameRetrying(from, to, platform = process.platform) {
  const tries = platform === 'win32' ? 8 : 1;
  for (let i = 1; ; i++) {
    try { fs.renameSync(from, to); return; } catch (err) {
      if (i >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(err && err.code)) throw err;
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
}

/** rmSync, retried like renameRetrying on win32; best-effort (never throws). */
async function rmRetrying(target, platform = process.platform) {
  const tries = platform === 'win32' ? 8 : 1;
  for (let i = 1; i <= tries; i++) {
    try { fs.rmSync(target, { recursive: true, force: true }); return true; } catch (err) {
      if (i === tries) { console.warn(`[runners] could not remove ${target}: ${err && err.code}`); return false; }
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
  return false;
}

/**
 * The sentence a person reads when the install pipeline THREW rather than failing
 * by name. Before this, the catch-all put `err.message` on the screen as-is, which
 * could be `getaddrinfo ENOTFOUND registry.npmjs.org` or a tar diagnostic: true, and
 * useless to the person who has to act on it. Each arm says what happened in plain
 * words and what they can do. The raw error still goes to the board's log.
 */
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN']);
function plainFailure(err, m, stage) {
  const raw = String((err && err.message) || err || '').trim();
  if (err && err.plain) return raw;
  const name = (m && m.name) || 'the runner';
  // The raw text (which can carry C:\Users\... paths) goes to the log ONLY.
  console.warn(`[runners] ${name} install failed at ${stage}: ${raw}`);
  const code = err && err.code;
  // Disk and permission problems can happen at any step, and "check you are
  // online" would send the person the wrong way for either.
  if (code === 'ENOSPC') {
    return `there is not enough free disk space to install ${name}, so nothing was installed. Free up some space, then try again`;
  }
  if (code === 'EACCES' || (code === 'EPERM' && stage !== 'swap')) {
    return `this computer would not let us write the files for ${name}, so nothing was installed. Try again, and if it keeps happening, check your security software is not blocking Kosmos`;
  }
  if (stage === 'download') {
    if (NETWORK_CODES.has(code) || /stalled/.test(raw)) {
      return `we could not reach the download server for ${name}. Check this computer is online, then try again`;
    }
    const status = (raw.match(/answered (\d{3})/) || [])[1];
    if (status) {
      // The status number is not a path or a secret and it is what a support
      // conversation needs, so it stays; the rest of the raw text does not.
      return `the download server did not hand over ${name} (it answered ${status}), so nothing was installed. Try again later`;
    }
    return `the download of ${name} did not finish, so nothing was installed. Check this computer is online, then try again`;
  }
  if (stage === 'unpack') {
    return `we downloaded ${name} but could not unpack it on this computer, so nothing was installed. Check there is free disk space, then try again`;
  }
  if (stage === 'swap') {
    return `we unpacked ${name} but could not move it into place, possibly because security software was still checking it. Wait a moment, then try again`;
  }
  return `we could not finish installing ${name}, so nothing was installed. You can try again`;
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
/**
 * #3713: the shell launcher for a node-program runner. Both paths are absolute and single-
 * quoted (a quote inside a path is closed, escaped and reopened), so a home folder with a
 * space or a quote in it cannot split or run anything. `exec` hands the process over, so
 * signals and the exit status are the program's own.
 */
function nodeLauncher(nodeBin, script) {
  const q = (p) => "'" + String(p).replace(/'/g, "'\\''") + "'";
  return '#!/bin/sh\n'
    + '# Written by Kosmos (#3713): runs this runner with the node Kosmos runs on.\n'
    + 'exec ' + q(nodeBin) + ' ' + q(script) + ' "$@"\n';
}

function install(provider, opts) {
  const o = opts || {};
  // hasOwn, not truthiness: with a URL-supplied provider, a prototype-chain
  // hit ("constructor") must be the SAME refusal as any unknown name.
  // opts.manifest is the fixture seam (the shipped MANIFEST is frozen).
  const plat = o.platform || process.platform;
  const arch = o.arch || process.arch;
  // manifestFor, not MANIFEST[provider]: on Windows the openai entry is the
  // win32 build for this CPU, not the darwin tarball.
  const m = o.manifest || manifestFor(provider, plat, arch);
  /**
   * A refusal that happens BEFORE any job starts, in the shape a job has.
   *
   * ⚠️ THESE CROSS THE WIRE. `server.js` answers `{ job }` for both the
   * refusal arms below and a real job, so a screen polling `job.receivedBytes`
   * used to get `undefined` from a refusal and `null` from a job -- two
   * spellings for one absence, which is the thing this module's job-shape
   * docblock exists to prevent, on the one path a person actually sees. Found
   * by the route test, which asserted null and got undefined.
   */
  const refuse = (because) => ({ ...blankJob(), phase: 'failed', because });

  /* kosmos macOS-only gate (Option A, extended to the provider-binary download at
     Splinter's ruling 2026-09-01): the pinned runners are darwin builds (e.g.
     codex-...-darwin-arm64.tgz), so on any other OS an install would download a Mac
     binary that cannot run. Refuse BEFORE any bytes move, in the job shape the
     screen already reads. This is the gate (refuse), NOT the Option C fix -- it
     fetches no Windows build, so no part of Windows is made to look functional.
     `o.platform` is the test seam (defaults to process.platform); the polished
     user-facing wording is the operator's to refine (see engine/platform.js). */
  /* 📌 openai reads its OWN list (canDownloadCodex: darwin + win32), because OpenAI
     publishes a Windows Codex build and it is pinned above. Every other arm keeps the
     darwin-only canDownloadRunner, including Claude's Mac-shaped link path. The
     sentence is for a person: it names the thing and says nothing moved. */
  const allowed = provider === 'openai'
    ? platformGate.canDownloadCodex(plat)
    : platformGate.canDownloadRunner(plat);
  if (!allowed) {
    const what = m ? m.name : provider;
    return refuse(`installing ${what} from here is not supported on this kind of computer (${plat}), so nothing was downloaded`);
  }

  if (!m) return refuse(`we do not know how to install a runner for ${provider}`);
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
    return refuse(`the ${provider} runner has a manifest entry but no resolution rule yet, so an install could never be seen; teach resolveBin about it first`);
  }
  if (existing.present) {
    // A completed job for THIS binary carries the truthful receipt
    // (`proved`, real byte counts) -- hand that back rather than a
    // synthetic. Otherwise: byte counts null, not zero, and `version` NULL
    // rather than absent -- nothing was downloaded, nothing was proved, and a
    // present legacy binary may be any age, so claiming the PINNED version
    // would be the exact overclaim status() renamed its field to avoid.
    // ⚠️ This said "NO version field at all", which was true of main and was
    // falsified by the blankJob() spread on this branch -- three lines from a
    // test asserting the null. The guard is against claiming a VALUE, and
    // `null` claims nothing.
    if (jobs[provider] && jobs[provider].phase === 'installed') return jobs[provider];
    if (jobs[provider] && jobs[provider].phase === 'failed') delete jobs[provider];
    return { ...blankJob(), phase: 'installed' };
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
    // From the RESOLVER, not re-derived here: see its comment. A person
    // cannot unset an override we will not name, and naming the wrong one is
    // worse than naming none, because it looks actionable.
    const envName = existing.envName || 'the override';
    return refuse(`${envName} points the ${provider} runner at ${existing.bin}, which is not something we can run; unset it (or point it at a real runner) before installing`);
  }
  // Wrong hardware fails in seconds with the CAUSE, not in minutes at
  // the prove step with a symptom: the pinned artifact is arch-specific.
  // (A vendor-external entry carries no arch: the vendor's manifest picks
  // its own per-platform artifact, so the guard naturally passes.)
  if (m.arch && arch !== m.arch) {
    return refuse(`the pinned ${m.name} build is ${m.arch} and this computer is ${arch}; no download was attempted`);
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

  const job = { ...blankJob(), phase: 'downloading', receivedBytes: 0, totalBytes: m.downloadBytes, version: m.version };
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
  // Which step a thrown error came from, so the catch-all can say it in words.
  let stage = 'prepare';
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
      stage = 'download';
      await doDownload(url, staging, job);
      stage = 'prepare';

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
      stage = 'unpack';
      await new Promise((resolve, reject) => {
        // Timeboxed like its neighbors (download 60s stall, prove 30s): a
        // wedged tar would otherwise park the job in `unpacking` forever
        // behind the idempotent join.
        execFile(tarBin(plat), ['-xzf', staging, '-C', pkgNew, '--strip-components', '1'], { timeout: 120000 },
          (err, _stdout, stderr) => err ? reject(new Error(String(stderr || err.message).trim())) : resolve());
      });
      /* #3713: a compressed vendor binary (Grok's bin/grok.br) is expanded here, after the
         checksum passed and before the layout check, the one step its own postinstall does. */
      if (m.brotliFrom) {
        const from = path.join(pkgNew, m.brotliFrom);
        if (fs.existsSync(from)) {
          await new Promise((resolve, reject) => {
            const out = fs.createWriteStream(path.join(pkgNew, binInPackage));
            out.on('error', reject);
            out.on('finish', resolve);
            fs.createReadStream(from).on('error', reject)
              .pipe(zlib.createBrotliDecompress()).on('error', reject)
              .pipe(out);
          });
          fs.rmSync(from, { force: true });
        }
      }
      if (!fs.existsSync(path.join(pkgNew, binInPackage))) {
        console.warn(`[runners] ${provider} archive has no ${binInPackage}`);
        fail(`the download of ${m.name || 'the runner'} was not laid out the way we expected, so nothing was installed. Try again later`);
        return;
      }
      // One deliberate chmod, on the one file the symlink's execution
      // depends on. The vendored siblings keep whatever modes the vendor
      // packed and tar preserved -- the live proof ran the real binary
      // through exactly that, so re-moding the whole tree would be
      // defending against a problem the artifact does not have.
      // (A no-op on win32, where executability is the .exe suffix.)
      fs.chmodSync(path.join(pkgNew, binInPackage), 0o755);
      try { fs.rmSync(pkgOld, { recursive: true, force: true }); } catch { /* the sweep gets it */ }
      stage = 'swap';
      // The verified marker comes down BEFORE a new tree goes in: from here until
      // --version passes, nothing on disk may vouch for what is at the stable path.
      if (plat === 'win32' && !(await rmRetrying(verifiedMarker(plat), plat))) {
        throw Object.assign(new Error('the verified marker could not be removed'), { code: 'EPERM' });
      }
      if (fs.existsSync(pkgDir)) await renameRetrying(pkgDir, pkgOld, plat);
      await renameRetrying(pkgNew, pkgDir, plat);
      pkgNewLive = null; // swapped in; nothing at the per-pid name any more
      // Best-effort, like the sweeps: a locked OLD tree (antivirus still reading
      // it) must not fail an install whose new tree is already in place. The
      // age-gated sweep at the next install removes it.
      try { fs.rmSync(pkgOld, { recursive: true, force: true }); } catch (e) {
        console.warn(`[runners] ${provider} could not remove the previous tree yet: ${e && e.code}`);
      }
      const unpacked = path.join(pkgDir, binInPackage);
      let finalBin;
      if (plat === 'win32') {
        // 📌 NO SYMLINK ON WINDOWS: creating one needs Developer Mode or
        // elevation, neither of which a clean laptop has. The stable path is
        // the binary inside the tree, which is exactly what resolveBin names
        // on win32 (managedBin), and codex.exe finds its vendored siblings
        // relative to itself there without any link.
        finalBin = unpacked;
      } else if (m.launcher === 'node') {
        /* #3713: a node program (Gemini's bundle) cannot be reached through a symlink on a
           Mac with no `node` on its PATH, so the stable path is a launcher that runs it with
           the node this board runs on: on an installed Kosmos, its own shipped runtime. The
           prove step below runs this very launcher, so a launcher that cannot start is never
           left installed. */
        finalBin = path.join(destDir, m.binName);
        fs.rmSync(finalBin, { force: true });
        fs.writeFileSync(finalBin, nodeLauncher(o.nodeBin || process.execPath, unpacked), { mode: 0o755 });
        fs.chmodSync(finalBin, 0o755);
      } else {
        // ONE stable path for every caller, whatever the package layout is:
        // a symlink beside the tree, RELATIVE so a moved or renamed
        // KOSMOS_HOME carries it intact. Rust binaries resolve
        // current_exe() through symlinks, so the runner still finds its
        // vendored siblings.
        finalBin = path.join(destDir, m.binName);
        fs.rmSync(finalBin, { force: true });
        fs.symlinkSync(path.relative(destDir, unpacked), finalBin);
      }

      stage = 'prove';
      job.phase = 'proving';
      // Installed is a CLAIM until the binary itself answers. --version is
      // local (no network, no account), so a pass means the Mach-O loads
      // and runs on this computer -- the same prove-it-runs step the bundle
      // build applies to the app binary.
      try {
        await new Promise((resolve, reject) => {
          prove(finalBin, (err, stdout) => {
            if (err) {
              // The raw child error (a path, an errno, "Command failed") goes to
              // the board's log for whoever diagnoses it, never to the screen.
              console.warn(`[runners] ${provider} prove failed: ${String(err.message || err).trim()}`);
              reject(new Error(`${m.name || 'the runner'} was downloaded but did not run on this computer, so it was not installed; you can try again`));
              return;
            }
            job.proved = String(stdout || '').trim();
            resolve();
          });
        });
      } catch (err) {
        // A failed prove must not leave a present-looking runner. On the Mac
        // the symlink comes down (resolveBin keys on it) and the pkg/ tree
        // stays for diagnosis; on Windows the binary INSIDE the tree is what
        // resolveBin keys on, so the tree itself has to go.
        // On Windows the tree removal is RETRIED (antivirus holds a fresh .exe),
        // but it is no longer what keeps the runner from reading present: the
        // verified marker was never written, so resolveBin reads absent even if
        // a locked codex.exe survives every retry.
        if (plat === 'win32') await rmRetrying(pkgDir, plat);
        else { try { fs.rmSync(finalBin, { recursive: true, force: true }); } catch { /* best effort */ } }
        err.plain = true;
        throw err;
      }
      // Only now, after the binary itself answered, may anything vouch for it.
      if (plat === 'win32') fs.writeFileSync(verifiedMarker(plat), verifiedStamp(m) + '\n');

      try { fs.rmSync(staging, { force: true }); } catch { /* the sweep gets it */ }
      job.phase = 'installed';
    } catch (err) {
      fail(plainFailure(err, m, stage));
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
    // ⚠️ os.homedir() DIRECTLY, not homeDir(): this probe and resolveBin's canonical rung
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
  const job = { ...blankJob(), phase: 'linking' };
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
  const clearForLink = (elsewhere) => {
    let st;
    try { st = fs.lstatSync(canonical); } catch { return null; } // nothing there: nothing to clear
    // ⚠️ "REPLACEABLE", NOT "OURS". connect.js's vendor install writes a
    // launcher at this same canonical path, so a symlink here is not provably
    // something Kosmos put down. Replacing a symlink is still the right call
    // -- it is a pointer, not content -- but the comment must not claim a
    // certainty the code cannot have.
    if (st.isSymbolicLink()) {
      // ⚠️ NO ERRNO, AND THE FINDING SURVIVES THE FAILURE. Its two siblings
      // below are deliberately errno-free and each has a test asserting so;
      // this arm was not, and returned `EACCES: permission denied, unlink
      // '/...'` to a person. It also said nothing about where Claude WAS
      // found, so the useful half of the answer was lost with the failure.
      try { fs.unlinkSync(canonical); return null; } catch {
        return `we found ${m.name} at ${elsewhere}, but a link at ${canonical} is in the way and could not be replaced; check that folder's permissions`;
      }
    }
    return st.isDirectory()
      ? `we found ${m.name} at ${elsewhere}, but ${canonical} is a folder rather than a program, so nothing was changed; move it aside and try again`
      : `we found ${m.name} at ${elsewhere}, but ${canonical} already exists and is not something we put there, so nothing was changed; move it aside and try again`;
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
       *
       * 📌 MEASURED, AND THE PRECISE PROPERTY IS NARROWER THAN "IT YIELDS
       * FIRST": `findElsewhere()` is still CALLED synchronously here -- the
       * body runs to the first await, and that await is on its result. What
       * changed is that the default's expensive step (`which`) is now async,
       * ⚠️ AND THE SYNCHRONOUS REMAINDER IS THE SPAWN, NOT THE stat()s. An
       * earlier version of this line said "three statSync calls", which was
       * wrong twice over: those run in the loop on the FAR SIDE of the await,
       * and the cost that remains synchronous is `execFile`'s fork/exec.
       * ⚠️ NO FIGURES QUOTED HERE, DELIBERATELY. An earlier version gave three
       * from separate runs, and one pair was impossible on this call path: it
       * reported the spawn costing MORE than install()'s whole synchronous
       * return, when the Promise executor runs synchronously and so the spawn
       * is INSIDE that return rather than beside it. A number that cannot be
       * true tells the reader the comment was not checked, in the one comment
       * whose job is to stop the next person reintroducing a block. What
       * survives measurement is the ordering: milliseconds rather than the
       * seconds a synchronous `which` can cost, and the spawn dominating the
       * stat()s. ⚠️ THE GUARANTEE
       * THEREFORE LIVES IN THE PROBE, NOT AT THIS CALL SITE: a seam, or a
       * future default, that did slow synchronous work would block the board
       * again and nothing here would stop it. If that ever needs enforcing,
       * enforce it in the probe rather than by adding another await here --
       * an await at this call site is what did not work last time.
       */
      const elsewhere = await findElsewhere();
      if (elsewhere) {
        try {
          fs.mkdirSync(path.dirname(canonical), { recursive: true });
        } catch (err) {
          fail(`we found ${m.name} at ${elsewhere} but could not create ${path.dirname(canonical)} to link it into; check that folder's permissions`);
          return;
        }
        const blocked = clearForLink(elsewhere);
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
        /* ⚠️ THE SENTENCE MUST NOT LIE ABOUT THE PRODUCT. An earlier version
           said "Kosmos ... cannot download one yet", which is true of THIS
           code path and false of Kosmos: engine/connect.js's sign-in flow
           downloads Claude Code from the vendor, verifies its published
           SHA256 and runs its installer, whenever the binary is absent. The
           reader's subject is the product, not the module -- and the old
           wording also handed them the worse of the two remedies. */
        fail(`We could not find ${m.name} on this computer. Connecting a Claude account will download and set it up for you; Kosmos can only link a copy that is already on this computer.`);
        return;
      }
      job.phase = 'proving';
      await new Promise((resolve, reject) => {
        prove(canonical, (err, stdout) => {
          if (err) {
            /* ⚠️ NO RAW err.message. The production prove is
               `execFile(bin, ['--version'])`, whose message is
               `Command failed: <path> --version\n<stderr>` or `spawn EACCES`.
               Its three sibling arms in this function are deliberately
               errno-free and each has a test asserting so; this one had
               neither, because EVERY test injects `prove`, so nothing
               exercised the real string. engine/subscription.js states the
               rule: a raw subprocess error can carry anything.
               📌 "linked", not "installed": nothing was installed on this
               branch, a copy already on the Mac was linked, and naming the
               wrong act sends a person looking in the wrong place. */
            reject(new Error(`we linked ${m.name} at ${canonical} but it did not run when we tried it; the copy it points at may be broken`));
            return;
          }
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

/* pathextCandidates is exported for the SAME reason create.unusablePath is: its
   win32 branch cannot be asserted from the Mac the suite runs on unless the
   platform is injectable from a test. */
module.exports = { MANIFEST, CODEX_WIN32, GROK_DARWIN, nodeLauncher, manifestFor, managedBin, verifiedMarker, tarBin, fileIntegrity, plainFailure, managedRoot, resolveBin, homeDir, status, install, download, isRunnable, runnableCandidate, pathextCandidates, runnableExactly, resetForTests };
