'use strict';
/* #6466: the Windows release's signed manifest, the twin of the Mac's (#6468, tools/build-kosmos-bundle.sh writes
 * that one, tools/lib/manifest-sign.js signs it, engine/manifest-verify.js checks it on the installed copy).
 *
 * SAME FORMAT, SAME KEY, SAME SIGNING STEP. The file is the Mac manifest's shape (manifest: 1, version, arch,
 * artifact, sha256 of the download, pinned_keys, files: [{ path, sha256 }]) plus platform: "win32", published beside
 * the versioned zip as kosmos-<v>-win-x64.manifest.json, and signed by the unchanged
 *     node tools/lib/manifest-sign.js sign <kosmos-manifest-signing key> <manifest> <manifest>.sig
 * with the one ed25519 release key engine/manifest-verify.js pins. The installed Windows copy checks it in
 * engine/win32update.js (readSignedManifest, then the unpacked files) before anything from the download runs.
 *
 *   node tools/lib/win-release-manifest.js write <stage-dir> <zip> <version> <arch> <out.json>
 *       the build (tools/build-kosmos-windows.sh): every file under the stage (what the zip holds), with its sha256,
 *       the zip's sha256, and the build facts from the stage's own manifest.json.
 *   node tools/lib/win-release-manifest.js check <manifest.json> <manifest.json.sig> <zip> [<version>]
 *       the publish (tools/windows/publish-r2.ps1): the signature verifies under a pinned key, the manifest is this
 *       zip's (version, platform, arch, artifact, sha256), and every file inside the zip is exactly the manifest's.
 *       Exit 0 good, 1 refused, 2 could not check; one line on stdout says why.
 *   node tools/lib/win-release-manifest.js ships-checker <zip>
 *       exit 0 when the zip's app/engine/win32update.js checks signed manifests (it carries the capability line), so
 *       installs of that build refuse an update with none; 1 when it does not; 2 cannot tell.
 *
 * Nothing here holds or prints a key.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ENGINE = path.join(__dirname, '..', '..', 'engine');
const mv = require(path.join(ENGINE, 'manifest-verify.js'));
const win32zip = require(path.join(ENGINE, 'win32zip.js'));

/** The capability line engine/win32update.js carries once it checks signed manifests. Kept in one place. */
const CHECKER_MARK = 'win32update capabilities: signed-manifest';

/** The top-level names a Windows build holds: engine/win32update.js ENTRIES (tools.win-release-manifest-6466.test.js
    holds the two equal; this file does not require the updater, which pulls in the board's stores). */
const WIN_ENTRIES = Object.freeze(['Kosmos.exe', 'open-board.js', '! READ ME FIRST - Windows will warn you.txt', 'manifest.json', 'runtime', 'app', 'bin']);
const ZIP_LIMITS = Object.freeze({ allowedTopLevel: WIN_ENTRIES, maxEntries: 20000, maxEntryBytes: 512 * 1024 * 1024, maxTotalBytes: 2048 * 1024 * 1024 });

/** Unpack a Windows build zip into a fresh temp folder, run fn(dir), and remove the folder. */
function withUnpacked(zipBytes, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-winmanifest-'));
  try {
    win32zip.extractZip(zipBytes, path.join(dir, 'x'), ZIP_LIMITS);
    return fn(path.join(dir, 'x'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const manifestName = (version, arch) => `kosmos-${version}-win-${arch}.manifest.json`;
const versionedName = (version, arch) => `kosmos-${version}-win-${arch}.zip`;

/** Every top-level name in a build stage, sorted: what the zip holds. */
function topLevel(stage) { return fs.readdirSync(stage).sort(); }

/** The manifest object for a stage and its zip. Pure apart from reading the files. */
function buildManifest({ stage, zipBytes, version, arch, keys = mv.KEYS }) {
  if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(String(version || ''))) throw new Error(`not a version: ${version}`);
  if (!keys.length) throw new Error('engine/manifest-verify.js pins no key, so no install could check this manifest');
  let inner = {};
  try { inner = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8')); } catch { inner = {}; }
  if (inner.version !== undefined && inner.version !== version) throw new Error(`the stage's manifest.json is ${inner.version}, not ${version}`);
  const extra = topLevel(stage).filter((n) => !WIN_ENTRIES.includes(n));
  if (extra.length) throw new Error(`the stage holds ${extra.join(', ')}, which no Windows update may carry (engine/win32update.js ENTRIES)`);
  const files = mv.listFiles(stage, WIN_ENTRIES).map((rel) => ({ path: rel, sha256: sha256(fs.readFileSync(path.join(stage, rel))) }));
  return manifestObject({ files, zipBytes, version, arch, inner, keys });
}

/** The manifest object from its parts: `files` as [{ path, sha256 }] (paths with forward slashes), `inner` the zip's
    own manifest.json (build facts only). Pure. */
function manifestObject({ files, zipBytes, version, arch, inner = {}, keys = mv.KEYS }) {
  return {
    manifest: 1,
    platform: 'win32',
    version, arch,
    artifact: versionedName(version, arch),
    sha256: sha256(zipBytes),
    app: { commit: inner.source_sha || 'unknown', dirty: inner.source_dirty === true },
    node: inner.node || null,
    connector: inner.connector || null,
    webview2_loader: inner.webview2_loader || null,
    built: { at: new Date().toISOString(), host: os.hostname() },
    // As the Mac's: the keys installs of THIS build accept, so a later cut can check its key against what is served.
    pinned_keys: keys.slice(),
    files,
  };
}

/** Why the signed manifest does not describe this download, or null: the updater's own rule (engine/manifest-verify.js). */
const headerRefusal = mv.win32HeaderRefusal;

/** The publish's whole check of a zip against its signed manifest. Returns { code, why }. */
function checkZip({ manifestPath, sigPath, zipPath, version, keys = mv.KEYS }) {
  const bytes = fs.readFileSync(manifestPath);
  let sigText = '';
  try { sigText = fs.readFileSync(sigPath, 'utf8'); } catch { return { code: 1, why: `there is no signature at ${sigPath}` }; }
  let declared;
  try { declared = JSON.parse(bytes.toString('utf8')).version; } catch { declared = null; }
  const v = version || declared;
  // installedVersion = the version itself: the publish has no install, and "not older than itself" always holds.
  const r = mv.signedManifest({ bytes, sigText, version: v, installedVersion: v, keys });
  if (r.code !== 0) return { code: r.code === 3 ? 2 : 1, why: r.why };
  const zipBytes = fs.readFileSync(zipPath);
  const bad = headerRefusal(r.manifest, { version: v, arch: r.manifest.arch, sha: sha256(zipBytes) });
  if (bad) return { code: 1, why: bad };
  const filesBad = withUnpacked(zipBytes, (x) => mv.filesRefusal(r.manifest, x, WIN_ENTRIES));
  if (filesBad) return { code: 1, why: filesBad };
  return { code: 0, why: `${path.basename(zipPath)} matches the signed manifest for ${v}` };
}

/** The top-level names in a zip's central directory (no checks: win32zip makes them when it reads the zip). */
function topLevelNames(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const tops = new Set();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('a damaged central directory');
    const nameLen = buf.readUInt16LE(at + 28);
    const name = buf.toString('latin1', at + 46, at + 46 + nameLen);
    tops.add(name.replace(/\\/g, '/').split('/')[0]);
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return [...tops].filter(Boolean);
}

/** 0 the zip's updater checks signed manifests, 1 it does not, 2 cannot tell. */
function shipsChecker(zipPath) {
  let zipBytes;
  try { zipBytes = fs.readFileSync(zipPath); } catch { return 2; }
  try {
    /* Only app/ is read: a zip with other top-level names is still asked (the updater refuses those at its unpack). */
    const tops = topLevelNames(zipBytes);
    if (!tops.includes('app')) return 1;
    const limits = { ...ZIP_LIMITS, allowedTopLevel: tops };
    const listing = win32zip.readZipDirectory(zipBytes, limits);
    const entry = listing.find((e) => e.name === 'app/engine/win32update.js');
    if (!entry) return 1;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-winchecker-'));
    try {
      win32zip.extractZip(zipBytes, path.join(dir, 'x'), limits);
      return fs.readFileSync(path.join(dir, 'x', 'app', 'engine', 'win32update.js'), 'utf8').includes(CHECKER_MARK) ? 0 : 1;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch { return 2; }
}

function main(argv) {
  const [verb, ...a] = argv;
  if (verb === 'write') {
    const [stage, zip, version, arch, out] = a;
    if (!stage || !zip || !version || !arch || !out) { console.error('usage: win-release-manifest.js write <stage> <zip> <version> <arch> <out.json>'); return 2; }
    const m = buildManifest({ stage, zipBytes: fs.readFileSync(zip), version, arch });
    fs.writeFileSync(out, JSON.stringify(m, null, 1) + '\n');
    console.log(`==> signed-manifest input: ${path.basename(out)} (${m.files.length} files); sign it with tools/lib/manifest-sign.js`);
    return 0;
  }
  if (verb === 'check') {
    const [manifestPath, sigPath, zipPath, version] = a;
    if (!manifestPath || !sigPath || !zipPath) { console.error('usage: win-release-manifest.js check <manifest> <sig> <zip> [<version>]'); return 2; }
    let r;
    try { r = checkZip({ manifestPath, sigPath, zipPath, version }); } catch (e) { r = { code: 2, why: 'could not check the manifest (' + ((e && e.message) || e) + ')' }; }
    // On STDOUT either way: publish-r2.ps1 reads it, and native stderr can stop a 5.1 script under Stop.
    console.log(r.why);
    return r.code;
  }
  if (verb === 'ships-checker') return shipsChecker(a[0]);
  console.error('usage: win-release-manifest.js write|check|ships-checker ...');
  return 2;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error('win-release-manifest: ' + ((e && e.message) || e)); process.exit(2); }
}
module.exports = { WIN_ENTRIES, buildManifest, manifestObject, headerRefusal, checkZip, shipsChecker, manifestName, versionedName, CHECKER_MARK, main };
