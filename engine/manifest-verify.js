'use strict';
/* #6468 ask 2: check a downloaded update against its SIGNED release manifest, before anything in it runs.
 *
 * Run by install/setup.sh with the INSTALLED copy's own node and this INSTALLED file, never the new build's, so the
 * build already on the computer is what decides whether to trust the new one:
 *
 *   <installed node> <installed app>/engine/manifest-verify.js <manifest> <sig> <tarball> <stage|-> <version> <installed-home>
 *
 * Called twice: with stage "-" BEFORE the tarball is unpacked (signature, version and tarball sha, so a hostile archive
 * never reaches tar), then with the unpacked stage (every file). The installed version is read from
 * <installed-home>/app/package.json; an install whose version cannot be read is refused, not waved through.
 *
 * The manifest (tools/build-kosmos-bundle.sh, #776) names the tarball's sha256 and every file's sha256. The release
 * signs its exact bytes with an ed25519 key kept on the release Mac (tools/release.sh); the public keys it may be
 * signed with are pinned below. Checks, all of them required:
 *   - the signature verifies under one of the pinned keys;
 *   - the manifest is for the version this run set out to install, and not older than the installed one (an old
 *     signed release replayed by a download host is refused);
 *   - the tarball's sha256 is the manifest's;
 *   - the unpacked bin, app, runtime and VERSION hold exactly the manifest's files, each with its sha256, and no
 *     symlink or other non-file anywhere in them.
 * Exit 0: trusted. Exit 1: refused, with one line saying why. Exit 3: no key is pinned (a build from before signing,
 * or a local build), so there is nothing to check against; the caller says so and carries on.
 *
 * KEYS: a list so a later key can be added by a signed release before an old one is retired. Losing every private key
 * on the list means updates are refused until Kosmos is installed afresh, so the key needs a copy off the release Mac.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS = [
  'MCowBQYDK2VwAyEAk4/bWISGCvRqop3v6KPAhqgszMbtHHZEldo8q/a5a1g=',
];
const PARTS = ['bin', 'app', 'runtime', 'VERSION'];

/** a.b.c compared numerically; anything else is not a version. */
function parseVersion(v) {
  const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(v || ''));
  return m ? m.slice(1).map(Number) : null;
}
function older(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/** Every regular file under the stage's parts, relative to the stage; throws on a symlink or other non-file.
    #6466: `parts` names the top-level entries to walk (the Windows build's are not the Mac's PARTS). */
function listFiles(stage, parts = PARTS) {
  const out = [];
  const walk = (rel) => {
    const st = fs.lstatSync(path.join(stage, rel));
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(path.join(stage, rel))) walk(rel + '/' + name);
    } else if (st.isFile()) {
      out.push(rel);
    } else {
      throw new Error(rel + ' is not a plain file');
    }
  };
  for (const part of parts) {
    if (fs.existsSync(path.join(stage, part)) || isLink(path.join(stage, part))) walk(part);
  }
  return out.sort();
}
function isLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/* #6466: the two halves of verify(), shared with the Windows updater (engine/win32update.js), which holds the
 * manifest's bytes in memory rather than in a file, and walks the Windows build's own top-level entries.
 * signedManifest: the signature (over these exact bytes) under a pinned key, then the version rules. Returns
 * { code, why, manifest }: 0 genuine, 1 refused, 3 no key pinned. */
function signedManifest({ bytes, sigText, version, installedVersion, keys = KEYS }) {
  if (!keys.length) return { code: 3, why: 'no release signing key is pinned in this install' };
  let signature;
  try { signature = Buffer.from(String(sigText).trim(), 'base64'); } catch { signature = Buffer.alloc(0); }
  const signed = Buffer.isBuffer(bytes) && signature.length === 64 && keys.some((k) => {
    try {
      const key = crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' });
      return crypto.verify(null, bytes, key, signature);
    } catch { return false; }
  });
  if (!signed) return { code: 1, why: 'the release manifest is not signed by the Kosmos release key' };
  let m;
  try { m = JSON.parse(bytes.toString('utf8')); } catch { return { code: 1, why: 'the signed manifest is not readable' }; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { code: 1, why: 'the signed manifest is not readable' };
  const want = parseVersion(version);
  if (!want || m.version !== version) return { code: 1, why: `the signed manifest is for ${m.version}, not ${version}` };
  const have = parseVersion(installedVersion);
  if (!have) return { code: 1, why: 'the installed version could not be read, so the update could not be checked' };
  if (older(want, have)) return { code: 1, why: `the update is ${version}, older than the installed ${installedVersion}` };
  return { code: 0, why: `the signed manifest for ${version} is genuine`, manifest: m };
}

/* filesRefusal: the stage's `parts` hold exactly the manifest's files, each with its sha256, and nothing that is
 * not a plain file. Returns the sentence to refuse with, or null. */
function filesRefusal(m, stage, parts = PARTS) {
  if (!m || !Array.isArray(m.files)) return 'the signed manifest lists no files';
  const listed = new Map(m.files.map((f) => [f && f.path, f && f.sha256]));
  let found;
  try { found = listFiles(stage, parts); } catch (e) { return 'the update holds something that is not a plain file (' + e.message + ')'; }
  if (found.length !== listed.size) return `the update holds ${found.length} files, its signed manifest ${listed.size}`;
  for (const rel of found) {
    if (!listed.has(rel)) return rel + ' is not in the signed manifest';
    if (sha256File(path.join(stage, rel)) !== listed.get(rel)) return rel + ' does not match the signed manifest';
  }
  return null;
}

/* #6466: a signed WINDOWS manifest (tools/lib/win-release-manifest.js writes it) is for the download the update
 * pointer named: the platform, the arch, the versioned zip's name, the zip's sha256 (which the download is then held
 * to), and a file list. Returns the sentence to refuse with, or null. */
function win32HeaderRefusal(m, { version, arch, sha }) {
  const artifact = `kosmos-${version}-win-${arch}.zip`;
  if (!m || m.platform !== 'win32') return `the signed manifest is for ${JSON.stringify(m && m.platform)}, not Windows`;
  if (m.arch !== arch) return `the signed manifest is for ${JSON.stringify(m.arch)}, not ${arch}`;
  if (m.artifact !== artifact) return `the signed manifest names ${JSON.stringify(m.artifact)}, not ${artifact}`;
  if (typeof m.sha256 !== 'string' || m.sha256 !== sha) return 'the download does not match its signed manifest';
  if (!Array.isArray(m.files) || !m.files.length) return 'the signed manifest lists no files';
  return null;
}

/* kosmos#7281: one key signs every family, so a host could serve another family's genuine manifest and tarball at
 * this family's address. A manifest that NAMES another platform is refused: on a Mac anything but darwin (the Mac's
 * own manifest names none), on Linux anything but linux (tools/build-kosmos-linux.sh writes "linux"). A manifest
 * naming none is still taken on Linux: the portable bundle's is the Mac one, the shell suites verify Mac-shaped
 * manifests on Linux runners, and a Mac bundle on Linux cannot pass setup.sh's run probe of its own node anyway.
 * The installer check alone (skipTarball) is not held to it: both families of a cut carry the same setup.sh bytes.
 * Windows has its own header check (win32HeaderRefusal). Returns the sentence to refuse with, or null. */
function platformRefusal(m, platform, ownLinux = false) {
  const said = m && m.platform;
  // Review 1 (W4): a copy that already runs the Linux family (its own node) takes only a manifest that says linux, so a
  // host cannot hand it the Mac build under the Linux name; unnamed stays acceptable on a portable copy (above).
  if (platform === 'linux' && ownLinux && said !== 'linux') return `the signed manifest is for ${JSON.stringify(said === undefined ? 'macOS' : said)}, not Linux`;
  if (said === undefined) return null;
  if (platform === 'darwin' && said !== 'darwin') return `the signed manifest is for ${JSON.stringify(said)}, not macOS`;
  if (platform === 'linux' && said !== 'linux') return `the signed manifest is for ${JSON.stringify(said)}, not Linux`;
  return null;
}

/* kosmos#7281: the installed copy runs the Linux family: a Linux x86_64 home whose runtime/bin/node is its own regular
 * file (the portable bundle links in a system node). One rule for verify and run-setup. */
function ownsLinuxNode(home, { platform = process.platform, arch = process.arch } = {}) {
  if (!home || platform !== 'linux' || arch !== 'x64') return false;
  try { return fs.lstatSync(path.join(home, 'runtime', 'bin', 'node')).isFile(); } catch { return false; }
}

function verify({ manifest, sig, tarball, stage, version, installedVersion, keys = KEYS, skipTarball = false, platform = process.platform, ownLinux = false }) {
  if (!keys.length) return { code: 3, why: 'no release signing key is pinned in this install' };
  const bytes = fs.readFileSync(manifest);
  let sigText;
  try { sigText = fs.readFileSync(sig, 'utf8'); } catch { sigText = ''; }
  const r = signedManifest({ bytes, sigText, version, installedVersion, keys });
  if (r.code !== 0) return r;
  const m = r.manifest;
  if (skipTarball) return { code: 0, why: `the signed manifest for ${version} is genuine`, manifest: m };
  const wrong = platformRefusal(m, platform, ownLinux);
  if (wrong) return { code: 1, why: wrong };
  if (typeof m.sha256 !== 'string' || sha256File(tarball) !== m.sha256) return { code: 1, why: 'the download does not match its signed manifest' };
  if (stage === '-') return { code: 0, why: `the download matches the signed manifest for ${version}` };
  const bad = filesRefusal(m, stage);
  if (bad) return { code: 1, why: bad };
  return { code: 0, why: `the update matches the signed manifest for ${version}` };
}

/* #6468 ask 3: check the installer script against the SIGNED manifest of the version being installed, before it runs.
 * The build records setup_sha256 (install/setup.sh, the bytes the cut publishes as /setup and /setup-staging; the site
 * deploy refuses to serve any other, #5032). Exit 0: it matches. 1: refused. 3: no key is pinned, or the manifest
 * records no installer; run-setup refuses on 3 as on 1. */
function verifySetup({ manifest, sig, setup, version, installedVersion, keys = KEYS }) {
  const r = verify({ manifest, sig, tarball: null, stage: '-', version, installedVersion, keys, skipTarball: true });
  if (r.code !== 0) return r;
  const m = r.manifest;   // the bytes the signature covered, parsed once (a second read could see a swapped file)
  if (typeof m.setup_sha256 !== 'string') return { code: 3, why: `the signed manifest for ${version} records no installer` };
  if (sha256File(setup) !== m.setup_sha256) return { code: 1, why: 'the installer does not match its signed release' };
  return { code: 0, why: `the installer matches the signed manifest for ${version}` };
}

/* ---- kosmos#6620 (O04-5): the fleet's update pause, the board half. Here, not in a module of its own, because
 * run-setup is called by .pkg files already downloaded and by fixtures that carry this one file. ---- */
/**
 * During a release incident the operator turns the pause on at the coordinator (kosmos-relay
 * `deploy/updates-pause.sh on`), and its public `/v1/meta` answers `"updates_paused": true`. Before this Kosmos
 * installs (engine/manifest-verify.js runSetup on a Mac, any version it is asked for, a same-version reinstall too;
 * engine/win32update.js begin on Windows, a new install), it asks, and holds back while the answer is true. Rolling
 * back is not asked: it installs no new code. A Kosmos older than this code is held too, by the installer it downloads
 * (install/setup.sh update_paused, #6781), but its board reports the hold as a failed install: the installer's 96
 * reaches it as a plain failure (see runSetup), and only this code knows the word "paused".
 *
 * Why the coordinator: the release site, its pointer and its signing key are the suspect part in that incident, so a
 * pause carried there could be removed by whoever holds them.
 *
 * It fails OPEN. No answer, a slow answer, an answer that is not JSON, or one without the field all read as "not
 * paused": a fleet that holds every update whenever the coordinator blinks cannot take a security fix. So the pause
 * covers the computers that can reach the coordinator; for the rest the signed manifest is the only defence.
 *
 * The reverse also holds: whoever controls that answer can hold every update, a security fix included, until the
 * pause is turned off; the only way past it on one computer is the override below.
 *
 * Under `node --test` (NODE_TEST_CONTEXT, in the env given or this process's own) it asks nothing unless a test names
 * the address with KOSMOS_UPDATE_PAUSE_URL; tools/run-tests.sh points that at a dead local port for every suite.
 * Two overrides, both needing control of this computer's env: KOSMOS_UPDATE_IGNORE_PAUSE=1 skips the question (for an
 * operator who must install during a pause), and KOSMOS_UPDATE_PAUSE_URL asks another address. Neither, nor
 * AGENT_WORKFORCE_TUNNEL_COORDINATOR, is required to be https: one set to http lets a network in between hold updates,
 * the same reach as whoever controls the answer above, and setting it already takes control of this computer's env.
 *
 * The installer asks the same question itself when it updates in place (install/setup.sh update_paused, #6781), so a
 * pasted install line and a .pkg on its pinned path are held too; runSetup tells the installer it has already asked.
 *
 * A second reader of /v1/meta beside engine/remote.js fetchMetaFlag, on purpose: run-setup is the installed copy of
 * this file run on its own (also by .pkg files already downloaded), so it requires nothing of the board's modules, and
 * it needs a synchronous form (curl) that fetchMetaFlag cannot give. Both refuse redirects and read only a boolean.
 */
const PAUSE_DEFAULT_COORDINATOR = 'https://login.kosmosplus.com';
const PAUSE_TIMEOUT_SECS = 5;

/** The /v1/meta address to ask, or null when nothing should be asked (an override, or a test that named none). */
function pauseUrl(env = process.env) {
  if (env.KOSMOS_UPDATE_IGNORE_PAUSE === '1') return null;
  if (env.KOSMOS_UPDATE_PAUSE_URL) return String(env.KOSMOS_UPDATE_PAUSE_URL);
  // This process's own env too: a test may hand in an env of its own without NODE_TEST_CONTEXT (review 1).
  if (env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT) return null;
  const base = String(env.AGENT_WORKFORCE_TUNNEL_COORDINATOR || PAUSE_DEFAULT_COORDINATOR).replace(/\/+$/, '');
  return base + '/v1/meta';
}

/** True only for a JSON object whose `updates_paused` is exactly true; anything else is "not paused". */
function pausedIn(body) {
  try {
    const v = JSON.parse(String(body));
    return Boolean(v && typeof v === 'object' && v.updates_paused === true);
  } catch {
    return false;
  }
}

/** The Mac form, for runSetup (which is synchronous): curl, as runSetup fetches everything else. */
function pausedSync({ env = process.env, spawnSync = require('child_process').spawnSync } = {}) {
  const url = pauseUrl(env);
  if (!url) return false;
  try {
    const r = spawnSync('curl', ['-q', '-fsS', '--max-time', String(PAUSE_TIMEOUT_SECS), url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return r && r.status === 0 ? pausedIn(r.stdout) : false;
  } catch {
    return false;
  }
}

/** The Windows form, for win32update.begin (async). */
async function pausedAsync({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const url = pauseUrl(env);
  if (!url || typeof fetchImpl !== 'function') return false;
  try {
    const res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(PAUSE_TIMEOUT_SECS * 1000) });
    if (!res || !res.ok) return false;
    return pausedIn(await res.text());
  } catch {
    return false;
  }
}

/** The one sentence a held install says, on either platform. */
const PAUSED_SENTENCE = 'updates are paused while Kosmos checks a problem with a release, so this update waits until the pause is lifted';

/* 🛑 A FROZEN INTERFACE. `run-setup <setup-url> <release-base> <version> <installed-home>` and its exit codes (0 or
 * the installer's own, 96 not fetched, 97 refused) are also called by .pkg files already downloaded (#6474), which
 * run against whatever NEWER copy of this file is installed. Add forms; never reorder or remove these.
 * run-setup: what the in-app update (engine/update.js) and `kosmos update` (install/kosmos) run instead of
 * `curl <setup> | sh`. Downloads the installer and the target version's manifest and .sig into a private folder,
 * checks them with THIS (installed) copy, and only then runs the installer with sh, passing stdio and the environment
 * through. Returns the installer's exit code, or 97 (a sentence on stderr) when it was not run. */
const NOT_RUN = 97;      // refused: the installer or its manifest did not check out (a retry gives the same answer)
const NOT_FETCHED = 96;  // a download failed (a retry can succeed: a half-published deploy, the network)
/* #6659 (review 1): setup.sh tells the default copy from a sandboxed one by the path STRING, so a home that resolves to
   the default copy is handed over as the default string itself (a ~/.local reached through a link resolves elsewhere). */
function asTheInstallerNamesIt(home) {
  const dflt = path.join(require('os').homedir(), '.local', 'share', 'kosmos');
  try { if (fs.realpathSync(home) === fs.realpathSync(dflt)) return dflt; } catch { /* either gone: as handed */ }
  return home;
}
/* kosmos#7281: the manifest a run-setup reads: the Linux family's (kosmos-<v>-linux-x64.manifest.json) on a Linux
 * x86_64 copy that runs its OWN node (a regular file; the portable bundle links in a system node), else the Mac one,
 * arm64 only, as setup.sh's ARCH is on a Mac (an Intel Mac is refused before any update is offered). A portable
 * Linux copy keeps the Mac one: release.sh cuts both families at one version, so it exists for any version offered. */
function setupManifestName(version, home, { platform = process.platform, arch = process.arch } = {}) {
  return ownsLinuxNode(home, { platform, arch }) ? `kosmos-${version}-linux-x64.manifest.json` : `kosmos-${version}-arm64.manifest.json`;
}
function runSetup({ setupUrl, base, version, home, spawnSync = require('child_process').spawnSync }) {
  const say = (why) => { process.stderr.write('Kosmos: ' + why + ', so the installer was not run.\n'); return NOT_RUN; };
  const sayFetch = (why) => { process.stderr.write('Kosmos: ' + why + ', so the installer was not run.\n'); return NOT_FETCHED; };
  if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(String(version || ''))) return say('the version to install is not known');
  if (!home) return say('the installed copy could not be found');
  // kosmos#6620: held during the fleet's update pause (any version run-setup is asked for, a reinstall of the same one
  // too), as NOT_FETCHED: a retry, once the pause is off, succeeds.
  // Its own curl, not the injected spawnSync: a test that counts runSetup's downloads must see only those.
  if (pausedSync()) { process.stderr.write('Kosmos: ' + PAUSED_SENTENCE + '; the installer was not run.\n'); return NOT_FETCHED; }
  let dir;
  try { dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kosmos-setup-')); } catch { return say('there was no private folder to check the installer in'); }
  try {
    const get = (url, out) => spawnSync('curl', ['-fsSL', '--connect-timeout', '30', '--speed-limit', '1024', '--speed-time', '60', url, '-o', out], { stdio: ['ignore', 'ignore', 'inherit'] }).status === 0;
    const files = { setup: path.join(dir, 'setup'), manifest: path.join(dir, 'manifest.json'), sig: path.join(dir, 'manifest.sig') };
    const b = String(base || '').replace(/\/+$/, '');
    /* #6609 phase 2a: with a recovery key pinned, the release key list comes FIRST: fetched from the release base and
       taken (trustedKeys keeps this copy's record, so an older list cannot come back), and the installer's manifest is
       checked with the list's keys, not the built-in ones. No list, no update: a site that withholds it must not leave
       a revoked key trusted. Off (RECOVERY_KEYS empty), nothing more is fetched and KEYS decide exactly as before. */
    let keys = KEYS;
    if (RECOVERY_KEYS.length) {
      const list = { bytes: path.join(dir, 'release-keys.json'), sig: path.join(dir, 'release-keys.json.sig') };
      /* One address for every list, fetched as two files: a cache (or a publish in progress) can hand back a list and
         a signature from different lists. One fresh query per attempt, shared by both, so a retry is not answered
         from the same stale entry. Not on file:// (curl would read it as part of the path). */
      const bust = /^https?:/i.test(b) ? '?r=' + crypto.randomBytes(8).toString('hex') : '';
      if (!get(`${b}/release-keys.json${bust}`, list.bytes) || !get(`${b}/release-keys.json.sig${bust}`, list.sig)) {
        return sayFetch('the release key list could not be downloaded');
      }
      let listBytes, listSig;
      try { listBytes = fs.readFileSync(list.bytes); listSig = fs.readFileSync(list.sig, 'utf8'); }
      catch { return sayFetch('the release key list could not be read'); }
      /* A list that does not verify is retried (96), not refused (97): a torn or half-published pair looks exactly like
         this, and a retry gets the matching pair. A list that verifies but is refused (older than this copy's record,
         or another set of keys at a seq already taken) is 97: a retry gives the same answer. */
      const v = verifyKeyList({ bytes: listBytes, sig: listSig });
      if (!v.ok) return sayFetch(v.why + ' (it may be mid-publish)');
      const t = trustedKeys({ listBytes, listSig, home });
      if (!t.ok) return t.retry ? sayFetch(t.why) : say(t.why);
      keys = t.keys;
    }
    if (!get(setupUrl, files.setup)) return sayFetch('the installer could not be downloaded');
    const mname = setupManifestName(version, home);
    if (!get(`${b}/${mname}`, files.manifest) || !get(`${b}/${mname}.sig`, files.sig)) {
      return sayFetch(`the signed manifest for ${version} could not be downloaded`);
    }
    let installedVersion = '';
    try { installedVersion = JSON.parse(fs.readFileSync(path.join(home, 'app', 'package.json'), 'utf8')).version; } catch { installedVersion = ''; }
    const r = verifySetup({ manifest: files.manifest, sig: files.sig, setup: files.setup, version, installedVersion, keys });
    // Exit 3 (no key pinned, or a manifest that records no installer) is NOT a pass here (review 1): every release this
    // code can update to is cut with setup_sha256, so a signed manifest without it is a cut gone wrong, and a site that
    // could serve one would run any installer it liked.
    if (r.code !== 0) return say(r.why);
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    /* #6659: the installer updates THIS copy, the home it was handed. The board runs with no KOSMOS_HOME exported
       (install/kosmos sets it unexported), so without this the installer took its default, ~/.local/share/kosmos: a
       board installed anywhere else (a test board, a home of the person's choosing) updated the default copy instead,
       stopping and replacing the person's own Kosmos. */
    env.KOSMOS_HOME = asTheInstallerNamesIt(home);
    // #6781: the installer asks the update pause itself (for a pasted line or a pinned .pkg); this run already asked.
    env.KOSMOS_UPDATE_PAUSE_ASKED = '1';
    // stdin is not handed on: under curl | sh the installer's stdin was its own bytes, so it never read one.
    const run = spawnSync('/bin/sh', [files.setup], { stdio: ['ignore', 'inherit', 'inherit'], env });
    // 96 and 97 are reserved for "not run": an installer that exits either itself is reported as a plain failure.
    if (run.status === NOT_RUN || run.status === NOT_FETCHED) return 1;
    return typeof run.status === 'number' ? run.status : 1;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/* #6473: the tmux bundle the installer fetches is held to the tmux_sha256 the same signed manifest records (the build
 * copies the served tmux pair in before it writes the manifest). Exit 0 matches, 1 refused (a mismatch, or a manifest
 * that records no tmux: every release this code updates to records it), 3 no key pinned. */
function verifyTmux({ manifest, sig, tmux, version, installedVersion, keys = KEYS }) {
  const r = verify({ manifest, sig, tarball: null, stage: '-', version, installedVersion, keys, skipTarball: true });
  if (r.code !== 0) return r;
  const m = r.manifest;   // the bytes the signature covered
  if (typeof m.tmux_sha256 !== 'string') return { code: 1, why: `the signed manifest for ${version} records no tmux bundle` };
  if (sha256File(tmux) !== m.tmux_sha256) return { code: 1, why: 'the terminal manager download does not match its signed release' };
  return { code: 0, why: `the terminal manager matches the signed manifest for ${version}` };
}

/* #6609: the release RECOVERY key. An installed copy trusts the release keys built into this file, and every release
 * ships its own copy of this file, so whoever holds a release key could ship a release that trusts another key, and
 * nothing could take a stolen key back. A recovery key, held offline by one person, narrows that: once its public half
 * is in RECOVERY_KEYS, the release keys a copy trusts come from a KEY LIST that a recovery key signed, not from KEYS.
 * What it gives, exactly: a copy that has taken a list without a revoked key refuses every release signed by that key
 * from then on, and the release key alone cannot sign a list. What it cannot do: a release signed with a stolen key
 * that a copy installs BEFORE taking the revocation replaces this file, RECOVERY_KEYS included, so that copy leaves the
 * scheme and is not recovered by it. Revocation protects only copies that take the new list first, which is why every
 * update path must fetch and check the list before it checks the release (#6609 phase 2).
 *
 *   dist/release-keys.json      {"type": "kosmos-release-keys", "release_keys": ["<spki base64>", ...], "seq": <n>, "issued": "<date>"}
 *   dist/release-keys.json.sig  the recovery key's Ed25519 signature over that file's exact bytes, base64
 *
 * A list is taken only when it verifies under a recovery key and its seq is not below the highest this copy has
 * stored (KEY_LIST_STATE in the install home), so an older list served again cannot bring a revoked key back; a newer
 * one is recorded above it. A seq is never reused: a list with the stored seq but other keys is refused (except when
 * the record at that seq is damaged and cannot be compared; the recovery key never signs two lists with one seq). Revoking a
 * stolen release key is a new list without it, seq + 1, signed with the recovery key (tools/lib/release-keys-sign.js),
 * and the next release raises MIN_KEY_LIST_SEQ to it. Empty RECOVERY_KEYS: off, and KEYS decide exactly as before. */
const RECOVERY_KEYS = Object.freeze([]);   // frozen: nothing in the process can turn the feature on by adding one
/* 🛑 #6609: NOT filled in until the whole chain takes the list. Done: run-setup (2a), setup.sh's checks (2b), the
   Windows updater (engine/win32update.js releaseKeys, #6692), and the .pkg installer's pinned path (kosmos-pkg-verify,
   #6576; its recoveryKeys must match these; that whole path is itself off while install/pkg-verify/floor reads "off").
   NOT done: serving the list from the site (2c). Filled in before the site serves a list, every update fails, and so
   does every .pkg install with its check on (.claude/plans/recoverykey3-6609.md). */
const KEY_LIST_STATE = 'release-keys.state';   // a folder: one seq-<n>.json per list taken
// The lowest list seq this build accepts, even with no state stored (a fresh install): raised in the release after a
// revocation, so a copy without a record still refuses the list from before it.
const MIN_KEY_LIST_SEQ = 1;
const MAX_SEQ = 2147483647;
// The list names what it is, so a recovery signature over it can never be taken for one over anything else.
const KEY_LIST_TYPE = 'kosmos-release-keys';
const sameKeys = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// The Ed25519 points of small order (dividing 8), as their 32-byte encodings with the sign bit cleared, the
// non-canonical spellings of 0 and 1 included (the list libsodium refuses). Some verifiers accept a forged signature
// under such a key (Apple's CryptoKit does, for the identity point), so none is ever a key here; the same list is in
// install/pkg-verify/main.swift (install.pkg-verify-keylist-6609.test.js checks both, and checks the points).
const SMALL_ORDER = new Set([
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
]);

/** An Ed25519 public key from its SubjectPublicKeyInfo base64, or null for anything else. Only the canonical
 * spelling is a key (the bytes re-encoded must be the same string), so comparing strings compares keys. */
function ed25519Key(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]{59}=$/.test(b64)) return null;
  const der = Buffer.from(b64, 'base64');
  if (der.length !== 44 || der.toString('base64') !== b64) return null;
  if (!der.subarray(0, 12).equals(Buffer.from('302a300506032b6570032100', 'hex'))) return null;
  const point = Buffer.from(der.subarray(12)); point[31] &= 0x7f;
  if (SMALL_ORDER.has(point.toString('hex'))) return null;
  try { return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }); } catch { return null; }
}

/** Checks a key list's bytes and signature against the recovery keys. { ok, why, seq, keys }. */
function verifyKeyList({ bytes, sig, recoveryKeys = RECOVERY_KEYS }) {
  let signature;
  try { signature = Buffer.from(String(sig || '').trim(), 'base64'); } catch { signature = Buffer.alloc(0); }
  const signed = signature.length === 64 && recoveryKeys.some((k) => {
    const key = ed25519Key(k);
    try { return !!key && crypto.verify(null, bytes, key, signature); } catch { return false; }
  });
  if (!signed) return { ok: false, why: 'the release key list is not signed by the Kosmos recovery key' };
  let list;
  try { list = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { return { ok: false, why: 'the signed release key list is not readable' }; }
  if (!list || list.type !== KEY_LIST_TYPE) return { ok: false, why: 'the signed file is not a release key list' };
  const keys = list && list.release_keys;
  if (!Array.isArray(keys) || !keys.length) return { ok: false, why: 'the signed release key list names no release key' };
  if (new Set(keys).size !== keys.length || !keys.every((k) => ed25519Key(k))) return { ok: false, why: 'the signed release key list holds a key that is not one' };
  if (!Number.isInteger(list.seq) || list.seq < 1 || list.seq > MAX_SEQ) return { ok: false, why: 'the signed release key list has no sequence number' };
  // The recovery key is never also a release key: whoever held the release key could then sign key lists.
  if (keys.some((k) => recoveryKeys.includes(k))) return { ok: false, why: 'the signed release key list names a recovery key as a release key' };
  return { ok: true, why: `release key list ${list.seq}`, seq: list.seq, keys: keys.slice() };
}

/* This install's record of the key lists it has taken: a folder (KEY_LIST_STATE in the install home) holding one file
 * per list, seq-<n>.json. The highest file present is the floor for the next list. Its limits are in
 * .claude/plans/recoverykey-6609.md. */
// A canonical number only (no leading zero), within MAX_SEQ: the same seq one name, as a list can carry.
const SEQ_FILE = /^seq-([1-9]\d{0,9})\.json$/;

/** { seq, keys } of the highest list recorded (seq never below minSeq; keys null when nothing at or above it is
 * recorded); { seq, keys: null, damaged: true } when that top file is damaged (its seq still holds as the floor);
 * null when the record folder cannot be read at all. */
function storedKeyList(home, minSeq = MIN_KEY_LIST_SEQ) {
  const dir = path.join(home, KEY_LIST_STATE);
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return e && e.code === 'ENOENT' ? { seq: minSeq, keys: null } : null; }
  let top = 0;
  for (const n of names) { const m = SEQ_FILE.exec(n); if (m && Number(m[1]) <= MAX_SEQ && Number(m[1]) > top) top = Number(m[1]); }
  if (!top || top < minSeq) return { seq: minSeq, keys: null };
  // A damaged top file still tells its seq by its name: the floor stays there, and only a list at or above it can
  // repair the record (trustedKeys writes it afresh).
  const damaged = { seq: top, keys: null, damaged: true };
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, `seq-${top}.json`), 'utf8'));
    if (r.seq !== top || !Array.isArray(r.release_keys) || !r.release_keys.length || !r.release_keys.every((k) => ed25519Key(k))) return damaged;
    return { seq: top, keys: r.release_keys };
  } catch { return damaged; }
}

/** Can the drive holding `file` make a hard link at all? Asked only after a link failed, with a fresh name nothing
 * else can be using, so the drive is blamed only when that fails too. */
function canHardLink(file) {
  const probe = `${file}.${crypto.randomBytes(4).toString('hex')}.probe`;
  // Only the answers a drive without links can give (EPERM, EXDEV, ENOTSUP or EISDIR, by driver and platform): a file
  // held open by a scanner (EBUSY) is not the drive's fault. EPERM can also be a plain denial, hence "may" below.
  try { fs.linkSync(file, probe); } catch (e) { return !['EPERM', 'EXDEV', 'ENOTSUP', 'ENOSYS', 'EISDIR'].includes(e && e.code); }
  try { fs.rmSync(probe, { force: true }); } catch { /* best effort */ }
  return true;
}

/** The release keys to check a manifest with. Off (no recovery key): the built-in KEYS. On: a key list that verifies
 * and is not older than this copy's record, recorded when not yet there. { ok, why, keys }. */
function trustedKeys({ listBytes, listSig, home, recoveryKeys = RECOVERY_KEYS, builtIn = KEYS, minSeq = MIN_KEY_LIST_SEQ }) {
  if (!recoveryKeys.length) return { ok: true, why: 'no recovery key is set, so the built-in release keys apply', keys: builtIn };
  if (!listBytes) return { ok: false, why: 'the release key list could not be read' };
  const v = verifyKeyList({ bytes: listBytes, sig: listSig, recoveryKeys });
  if (!v.ok) return v;
  // On, the record is what stops an older list coming back, so a check with no install home to keep it in is refused.
  // And the home must already exist: a mistyped one must not quietly start a fresh record with the floor reset.
  let homeOk = false;
  try { homeOk = !!home && fs.statSync(home).isDirectory(); } catch { homeOk = false; }
  if (!homeOk) return { ok: false, why: 'the release key list cannot be checked without this copy\'s record' };
  const stored = storedKeyList(home, minSeq);
  if (!stored) return { ok: false, why: 'this copy\'s record of the release key list cannot be read, so no list can be taken' };
  if (v.seq < stored.seq) return { ok: false, why: `the release key list is ${v.seq}, older than the ${stored.seq} this copy has taken` };
  // Already recorded: no write, so no re-read. A newer list recorded in the instant since is found by the next check;
  // the caller checks the release straight away with these keys.
  if (v.seq === stored.seq && stored.keys && !stored.damaged) {
    if (!sameKeys(stored.keys, v.keys)) return { ok: false, why: `the release key list ${v.seq} names other keys than the list ${v.seq} this copy took` };
    return { ok: true, why: v.why, keys: v.keys };
  }
  // Not recorded yet: add seq-<n>.json. The keys are a record only: what is trusted always comes from a list that
  // verified just now.
  const dir = path.join(home, KEY_LIST_STATE);
  const file = path.join(dir, `seq-${v.seq}.json`);
  const tmp = path.join(dir, `.seq-${v.seq}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  let noHardLinks = false;
  try {
    try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (!e || e.code !== 'EEXIST') throw e; }
    // Synced before it is linked in, and the folder after, so a crash should leave the record whole or absent. fsync on
    // macOS is not a full barrier (F_FULLFSYNC), so after a power loss the top file can still be empty: it is read as
    // damaged at its seq, and the next list at or above that seq writes it afresh (nothing to remove by hand).
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeSync(fd, JSON.stringify({ seq: v.seq, release_keys: v.keys }) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // A damaged record at this seq (a power loss) is replaced by this list, which verified and is not below it.
    if (stored.damaged && v.seq === stored.seq) fs.renameSync(tmp, file);
    else try { fs.linkSync(tmp, file); } catch (e) {
      if (!e || e.code !== 'EEXIST') { noHardLinks = !canHardLink(tmp); throw e; }
      // Another check recorded this seq first: it must name the same keys.
      const other = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(other.release_keys) || !sameKeys(other.release_keys, v.keys)) {
        return { ok: false, why: `the release key list ${v.seq} names other keys than the list ${v.seq} this copy took` };
      }
    }
    try { const dfd = fs.openSync(dir, 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch { /* a folder fsync is best effort */ }
  } catch {
    // #6692: a drive without hard links (FAT32, exFAT, some network drives) can never keep the record, so say so.
    if (noHardLinks) return { ok: false, why: `this copy's record of the release key list could not be written: the drive holding ${home} may not be able to make hard links (FAT32 and exFAT drives cannot)` };
    return { ok: false, why: 'this copy\'s record of the release key list could not be written' };
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
  // A newer list recorded meanwhile wins: this one may hold a key that one dropped.
  const now = storedKeyList(home, minSeq);
  if (!now || now.seq > v.seq) return { ok: false, retry: true, why: 'a newer release key list was taken meanwhile; check again' };
  return { ok: true, why: v.why, keys: v.keys };
}

module.exports = { verify, verifySetup, verifyTmux, runSetup, NOT_RUN, NOT_FETCHED, pauseUrl, pausedIn, pausedSync, pausedAsync, PAUSED_SENTENCE, PAUSE_DEFAULT_COORDINATOR, KEYS, listFiles, signedManifest, filesRefusal, win32HeaderRefusal, PARTS, setupManifestName /* kosmos#7281 */,
  RECOVERY_KEYS, KEY_LIST_STATE, KEY_LIST_TYPE, MIN_KEY_LIST_SEQ, MAX_SEQ, ed25519Key, verifyKeyList, storedKeyList, trustedKeys };

/* The installer (install/setup.sh) runs THIS installed copy, which may be older than the installer, so it asks before
 * using a call form: it greps the next line, which lists every form this copy understands beyond the original
 * <manifest> <sig> <tarball> <stage> <version> <home>. Keep it one line, and add to it when adding a form.
 * manifest-verify capabilities: run-setup early tmux keylist paused */
/* #6609 phase 2b: the keys the plain and tmux forms check with. Off: the built-in KEYS. On: the release key list setup.sh
   fetched beside the manifest, named by KOSMOS_KEY_LIST and KOSMOS_KEY_LIST_SIG, taken through trustedKeys (this copy's
   record, so an older list cannot come back). On with no list given is a refusal: an installer that does not fetch it
   must not install past a revocation. { code, why, keys }. */
function cliKeys(home) {
  if (!RECOVERY_KEYS.length) return { code: 0, keys: KEYS };
  const listFile = process.env.KOSMOS_KEY_LIST, sigFile = process.env.KOSMOS_KEY_LIST_SIG;
  if (!listFile || !sigFile) return { code: 1, why: 'the release key list was not given, so the update could not be checked' };
  let listBytes, listSig;
  try { listBytes = fs.readFileSync(listFile); listSig = fs.readFileSync(sigFile, 'utf8'); }
  catch { return { code: 1, why: 'the release key list could not be read, so the update could not be checked' }; }
  // A list that does not verify may be one caught mid-publish (its file from one list, its signature from another): said so.
  const v = verifyKeyList({ bytes: listBytes, sig: listSig });
  if (!v.ok) return { code: 1, why: v.why + ' (it may be mid-publish; try again in a minute)' };
  const t = trustedKeys({ listBytes, listSig, home });
  return t.ok ? { code: 0, keys: t.keys } : { code: 1, why: t.why };
}
// needs-key-list: exit 0 when this copy checks updates with the release key list (a recovery key is pinned), 1 when not.
// setup.sh asks before fetching the list, so nothing more is downloaded while the feature is off.
if (require.main === module && process.argv[2] === 'needs-key-list') {
  process.exit(RECOVERY_KEYS.length ? 0 : 1);
} else if (require.main === module && process.argv[2] === 'run-setup') {
  // <installed node> manifest-verify.js run-setup <setup-url> <release-base> <version> <installed-home>
  const [setupUrl, base, version, home] = process.argv.slice(3);
  let code;
  try { code = runSetup({ setupUrl, base, version, home }); } catch (e) { process.stderr.write('Kosmos: the installer could not be checked (' + (e && e.code || 'error') + '), so it was not run.\n'); code = NOT_RUN; }
  process.exit(code);
} else if (require.main === module && process.argv[2] === 'paused') {
  // #6781: <installed node> manifest-verify.js paused: exit 0 when the fleet's updates are paused, 1 when not (or no
  // answer). `kosmos update --if-newer` asks it so a connect computer's app can say "paused", not "failed".
  let p = false;
  try { p = pausedSync(); } catch { p = false; }
  process.exit(p ? 0 : 1);
} else if (require.main === module && process.argv[2] === 'tmux') {
  // <installed node> manifest-verify.js tmux <manifest> <sig> <tmux.tar.gz> <version> <installed-home>
  const [manifest, sig, tmux, version, home] = process.argv.slice(3);
  let r;
  try {
    let installedVersion = '';
    try { installedVersion = JSON.parse(fs.readFileSync(path.join(home, 'app', 'package.json'), 'utf8')).version; } catch { installedVersion = ''; }
    const k = cliKeys(home);
    r = k.code === 0 ? verifyTmux({ manifest, sig, tmux, version, installedVersion, keys: k.keys }) : k;
  } catch (e) { r = { code: 1, why: 'the terminal manager could not be checked (' + (e && e.code || 'error') + ')' }; }
  process.stdout.write(r.why + '\n');
  process.exit(r.code);
} else if (require.main === module) {
  const [manifest, sig, tarball, stage, version, home] = process.argv.slice(2);
  let r;
  try {
    let installedVersion = '';
    try { installedVersion = JSON.parse(fs.readFileSync(path.join(home, 'app', 'package.json'), 'utf8')).version; } catch { installedVersion = ''; }
    const k = cliKeys(home);
    r = k.code === 0 ? verify({ manifest, sig, tarball, stage, version, installedVersion, skipTarball: tarball === '-', keys: k.keys, ownLinux: ownsLinuxNode(home) }) : k;
  } catch (e) {
    r = { code: 1, why: 'the update could not be checked (' + (e && e.code || 'error') + ')' };
  }
  process.stdout.write(r.why + '\n');
  process.exit(r.code);
}
