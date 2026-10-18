'use strict';
/* #6468 ask 2: check a downloaded update against its SIGNED release manifest, before anything in it runs.
 *
 * Run by install/setup.sh with the INSTALLED copy's own node and this INSTALLED file, never the new build's, so the
 * build already on the computer is what decides whether to trust the new one:
 *
 *   <installed node> <installed app>/engine/manifest-verify.js <manifest> <sig> <tarball> <stage> <version> <installed-version>
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

/** Every regular file under the stage's parts, relative to the stage; throws on a symlink or other non-file. */
function listFiles(stage) {
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
  for (const part of PARTS) {
    if (fs.existsSync(path.join(stage, part)) || isLink(path.join(stage, part))) walk(part);
  }
  return out.sort();
}
function isLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

function verify({ manifest, sig, tarball, stage, version, installedVersion, keys = KEYS }) {
  if (!keys.length) return { code: 3, why: 'no release signing key is pinned in this install' };
  const bytes = fs.readFileSync(manifest);
  let signature;
  try { signature = Buffer.from(fs.readFileSync(sig, 'utf8').trim(), 'base64'); } catch { signature = Buffer.alloc(0); }
  const signed = signature.length === 64 && keys.some((k) => {
    try {
      const key = crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' });
      return crypto.verify(null, bytes, key, signature);
    } catch { return false; }
  });
  if (!signed) return { code: 1, why: 'the release manifest is not signed by the Kosmos release key' };
  let m;
  try { m = JSON.parse(bytes.toString('utf8')); } catch { return { code: 1, why: 'the signed manifest is not readable' }; }
  const want = parseVersion(version);
  if (!want || m.version !== version) return { code: 1, why: `the signed manifest is for ${m.version}, not ${version}` };
  const have = parseVersion(installedVersion);
  if (have && older(want, have)) return { code: 1, why: `the update is ${version}, older than the installed ${installedVersion}` };
  if (typeof m.sha256 !== 'string' || sha256File(tarball) !== m.sha256) return { code: 1, why: 'the download does not match its signed manifest' };
  if (!Array.isArray(m.files)) return { code: 1, why: 'the signed manifest lists no files' };
  const listed = new Map(m.files.map((f) => [f.path, f.sha256]));
  let found;
  try { found = listFiles(stage); } catch (e) { return { code: 1, why: 'the update holds something that is not a plain file (' + e.message + ')' }; }
  if (found.length !== listed.size) return { code: 1, why: `the update holds ${found.length} files, its signed manifest ${listed.size}` };
  for (const rel of found) {
    if (!listed.has(rel)) return { code: 1, why: rel + ' is not in the signed manifest' };
    if (sha256File(path.join(stage, rel)) !== listed.get(rel)) return { code: 1, why: rel + ' does not match the signed manifest' };
  }
  return { code: 0, why: `the update matches the signed manifest for ${version}` };
}

module.exports = { verify, KEYS, listFiles };

if (require.main === module) {
  const [manifest, sig, tarball, stage, version, installedVersion] = process.argv.slice(2);
  let r;
  try {
    r = verify({ manifest, sig, tarball, stage, version, installedVersion });
  } catch (e) {
    r = { code: 1, why: 'the update could not be checked (' + (e && e.code || 'error') + ')' };
  }
  process.stdout.write(r.why + '\n');
  process.exit(r.code);
}
