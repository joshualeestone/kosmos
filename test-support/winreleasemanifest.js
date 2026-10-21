'use strict';
/**
 * #6466: a signed Windows release manifest for a zip built in a test, made by the release's own builder
 * (tools/lib/win-release-manifest.js manifestObject) and signed with a key made here, never the release key. The
 * suites hand TEST_KEYS to prepare() (its manifestKeys seam) and serve these bytes beside the zip, so every
 * download they stage goes through the same signed-manifest check a real update does.
 */
const crypto = require('node:crypto');

const win32zip = require('../engine/win32zip');
const zlib = require('node:zlib');
const { manifestObject, WIN_ENTRIES } = require('../tools/lib/win-release-manifest');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const TEST_KEYS = Object.freeze([publicKey.export({ type: 'spki', format: 'der' }).toString('base64')]);

/** A second key no install pins: a manifest it signs must be refused. */
const STRANGER = crypto.generateKeyPairSync('ed25519').privateKey;

function sign(bytes, key) { return crypto.sign(null, bytes, key || privateKey).toString('base64') + '\n'; }

/** Every file in a zip, read in memory (no file is written: some suites record every write a run makes). */
function zipFiles(zip) {
  const entries = win32zip.readZipDirectory(zip, { allowedTopLevel: WIN_ENTRIES, maxEntries: 20000, maxEntryBytes: 1 << 30, maxTotalBytes: 1 << 30 });
  return entries.filter((e) => !e.isDirectory).map((e) => {
    const raw = zip.subarray(e.dataStart, e.dataStart + e.compressedSize);
    const data = e.method === 0 ? raw : zlib.inflateRawSync(raw);
    return { path: e.segments.join('/'), sha256: crypto.createHash('sha256').update(data).digest('hex') };
  }).sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

/**
 * The manifest object for `zip` (a Buffer), as the build's own manifestObject makes it. `over` replaces fields
 * after it is built (to make a manifest that disagrees with its download).
 */
function manifestFor(zip, { version, arch = 'x64', over } = {}) {
  let files;
  try { files = zipFiles(zip); } catch {
    /* A zip the suites build to be refused at the unpack (a hostile name, a damaged entry) cannot be read here
       either. Its release still signs a manifest for it, so the case reaches the unpack it is about. */
    files = [{ path: 'unreadable', sha256: '0'.repeat(64) }];
  }
  return { ...manifestObject({ files, zipBytes: zip, version, arch, keys: TEST_KEYS }), ...(over || {}) };
}

/** `{ bytes, sig }`: the manifest's exact bytes and its base64 signature (by `key`, the test key by default). */
function signedRelease(zip, o = {}) {
  const bytes = Buffer.from(JSON.stringify(manifestFor(zip, o), null, 1) + '\n');
  return { bytes, sig: sign(bytes, o.key) };
}

module.exports = { TEST_KEYS, STRANGER, sign, manifestFor, signedRelease };
