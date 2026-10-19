'use strict';
/* O05: a CycloneDX 1.5 bill of materials for one Mac release, derived from its SIGNED manifest, the tmux bundle it
 * shipped, and git history.
 *
 *   node tools/lib/sbom.js <manifest.json> --sig <manifest.json.sig> --tmux <tmux-arch.tar.gz>
 *                          --repo <kosmos checkout> --relay <kosmos-relay checkout> [--out <file>]
 *
 * What ships, and where each part of the SBOM is read from:
 *   - the release, the Node runtime (version and download sha) and the connector's relay commit: the manifest, whose
 *     signature must verify under a pinned release key;
 *   - tmux and the libraries it links: the TMUX BUNDLE the release copied in, which must hash to the manifest's signed
 *     tmux_sha256. Its VERSION file names what was built, and every library in its lib/ must be accounted for there.
 *     A release copies an already-built bundle and does not rebuild it, so the build script at the app commit is not
 *     a record of what shipped; it is read only for the NAMES of the libraries it fetches, each of which the bundle
 *     must name. The tmux parts carry no source download reference: a value read statically out of shell is not
 *     one this SBOM can vouch for;
 *   - the connector's Rust crates: the relay's Cargo.lock at the connector commit, walked from kosmos-tunnel-client,
 *     with each crate's direct dependencies. A crate with no source counts as first-party only when it is a member of
 *     the relay's workspace; any other crate from a source this does not know refuses the whole SBOM.
 * The app itself has no npm dependencies, and every file the manifest lists must sit in a first-party place (both are
 * checked, and refuse otherwise); the Mac app (Swift) links Apple's frameworks only. Node is one component: the libraries inside the official Node build (V8,
 * OpenSSL and so on) are Node's own and are matched through Node's version, not listed one by one; the Rust standard
 * library compiled into the connector is not listed either (the relay pins no toolchain, so no version is recorded).
 *
 * LIMIT: the connector's relay commit is the relay build's own record (its sidecar); this does not rebuild the
 * connector to check that the binary came from that commit's Cargo.lock.
 * LIMIT: a library linked statically into tmux with neither a VERSION line nor a licence file is invisible here; so is a
 * static C library brought into the Mac app by a bridging header or a linker flag rather than an import, and the
 * second native binary (Kosmos.app/Contents/MacOS/Kosmos, a re-signed copy of kosmos-app) is accepted by name only.
 * LIMIT: a vendored third-party crate made a member of the relay workspace passes as first-party.
 * Out of scope: the provider tools (Claude Code, Codex and so on) Kosmos downloads later, when a person asks.
 * LIMIT: the release tarball itself is not read: its hash comes from the manifest. The manifest's file list is
 * exhaustive by construction (the bundle build lists every file of the same stage it packs, and refuses anything
 * that is not a plain file). The shipped runtime/bin/node is not tied to the
 * nodejs.org download hash here (the bundle build verifies it against nodejs.org's SHASUMS256 before packing).
 * LIMIT: the crate list is the lockfile closure, a superset of what the macOS connector compiles. Measured for 0.7.59:
 * 229 crates (the connector and kosmos-relay-proto included) against cargo tree's 189 (which counts both); the extra are Windows-only and dev-only crates (26) and optional dependencies
 * of features the connector does not turn on (14). It never misses a crate the connector builds with. A scan of this
 * SBOM must treat an advisory on one of the extra crates as not shipped until it checks the macOS build graph.
 */
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CONNECTOR_CRATE = 'kosmos-tunnel-client';
const CRATES_IO = new Set(['registry+https://github.com/rust-lang/crates.io-index', 'sparse+https://index.crates.io/']);

function gitShow(repo, commit, file) {
  try {
    return execFileSync('git', ['-C', repo, 'show', `${commit}:${file}`],
      { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error(`${repo} has no ${file} at ${commit} (fetch it, or pass the right checkout)`);
  }
}

// Cargo.lock v3/v4: [[package]] tables of name, version, source, checksum, dependencies. A dependency names a package
// as "name", "name version" or "name version (source)" when the name alone is ambiguous. Any other table
// ([[patch.unused]], [metadata]) ends the current package, so its keys can never overwrite one.
function parseLock(text) {
  const v = text.match(/^version = (\d+)$/m);
  if (!v || !['3', '4'].includes(v[1])) throw new Error(`Cargo.lock: format version ${v ? v[1] : '(none)'}; only 3 and 4 are read (an older lock keeps checksums elsewhere)`);
  const pkgs = [];
  let cur = null, inDeps = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '[[package]]') { cur = { deps: [] }; pkgs.push(cur); inDeps = false; continue; }
    if (line.startsWith('[') && !inDeps) { cur = null; continue; }
    if (!cur) continue;
    if (inDeps) {
      if (line === ']') { inDeps = false; continue; }
      const m = line.match(/^"([^"]+)",?$/);
      if (!m) throw new Error(`Cargo.lock: a dependency line this SBOM cannot read: ${line}`);
      cur.deps.push(m[1]);
      continue;
    }
    const kv = line.match(/^(\w+) = (.*)$/);
    if (!kv) {
      if (line) throw new Error(`Cargo.lock: a package line this SBOM cannot read: ${line}`);
      continue;
    }
    if (kv[1] === 'dependencies') {
      if (kv[2] === '[') { inDeps = true; continue; }
      for (const d of kv[2].replace(/^\[|\]$/g, '').split(',')) { const s = d.trim().replace(/^"|"$/g, ''); if (s) cur.deps.push(s); }
      continue;
    }
    const str = kv[2].match(/^"(.*)"$/);
    if (str) cur[kv[1]] = str[1];
  }
  return pkgs;
}

function resolver(pkgs) {
  const byName = new Map();
  for (const p of pkgs) { if (!byName.has(p.name)) byName.set(p.name, []); byName.get(p.name).push(p); }
  return (ref) => {
    const m = ref.match(/^(\S+)(?: (\S+))?(?: \((.+)\))?$/);
    if (!m) throw new Error(`Cargo.lock: cannot read dependency "${ref}"`);
    const [, name, version, source] = m;
    const hits = (byName.get(name) || []).filter((p) => (!version || p.version === version) && (!source || p.source === source));
    if (hits.length !== 1) throw new Error(`Cargo.lock: cannot resolve dependency "${ref}"`);
    return hits[0];
  };
}

function closure(pkgs, rootName) {
  const resolve = resolver(pkgs);
  const roots = pkgs.filter((p) => p.name === rootName);
  if (roots.length !== 1) throw new Error(`Cargo.lock has no single package ${rootName}`);
  const root = roots[0];
  const edges = new Map();
  const seen = new Set([root]);
  const todo = [root];
  while (todo.length) {
    const p = todo.pop();
    edges.set(p, p.deps.map(resolve));
    for (const d of edges.get(p)) if (!seen.has(d)) { seen.add(d); todo.push(d); }
  }
  seen.delete(root);
  return { root, deps: [...seen], edges };
}

// The relay workspace's member crate names, from its Cargo.toml and each member's own. Literal member paths only.
function workspaceMembers(show, relay, commit) {
  const top = show(relay, commit, 'Cargo.toml').replace(/#.*$/gm, '');
  const section = (top.match(/^\[workspace\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m) || [])[1] || '';
  const m = section.match(/^members\s*=\s*\[([^\]]*)\]/m);
  if (!m) throw new Error('relay Cargo.toml: no [workspace] members');
  const dirs = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (!dirs.length || dirs.some((d) => /[*?[]/.test(d))) throw new Error('relay Cargo.toml: members must be literal paths');
  return new Map(dirs.map((d) => {
    const toml = show(relay, commit, `${d}/Cargo.toml`);
    const n = toml.match(/^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m);
    if (!n) throw new Error(`relay ${d}/Cargo.toml: no [package] name`);
    return [n[1], toml];
  }));
}

// The names of the libraries tools/build-tmux-from-source.sh fetches, so the bundle can be held to naming each one.
// Nothing else is taken from the script: it is read, not run, and five review rounds each found a way for a static
// reading of shell to be wrong about a value. The names come from `fetch <name> "$X_URL" "$X_SHA"` calls; a line that
// calls fetch in any other shape refuses, and so does an X_URL= line nothing fetches. Only whole-line comments are
// skipped, and only the function's own definition line is exempt.
function tmuxPins(text) {
  // The definition line is exempt only up to its own body: a call after it on the same line is still a call.
  const code = text.split('\n').filter((l) => !/^\s*#/.test(l))
    .map((l) => (/^\s*fetch\s*\(\)/.test(l) ? l.replace(/^\s*fetch\s*\(\)\s*\{[^}]*\}\s*;?\s*/, '') : l))
    .filter((l) => !/^\s*fetch\s*\(\)/.test(l) && l.trim());
  const pins = [];
  for (const line of code.filter((l) => /\bfetch(\s|\\|;|$)/.test(l))) {
    const m = line.match(/^\s*fetch\s+(\S+)\s+"\$([A-Z0-9_]+)_URL"\s+"\$([A-Z0-9_]+)_SHA"\s*$/);
    if (!m) throw new Error(`build-tmux-from-source.sh: a fetch line this SBOM cannot read: ${line.trim()}`);
    const [, name, u, s] = m;
    if (u !== s) throw new Error(`build-tmux-from-source.sh: ${name} is fetched with ${u}_URL but ${s}_SHA`);
    if (pins.some((x) => x.name === name)) throw new Error(`build-tmux-from-source.sh: ${name} is fetched twice`);
    pins.push({ name, urlVar: `${u}_URL` });
  }
  if (!pins.length) throw new Error('build-tmux-from-source.sh: no fetch lines');
  const fetched = new Set(pins.map((p) => p.urlVar));
  for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Z0-9_]+_URL)=/gm)) {
    if (!fetched.has(m[1])) throw new Error(`build-tmux-from-source.sh: ${m[1]} is set but never fetched`);
  }
  return pins;
}

// The shipped tmux bundle: its sha256, the versions its VERSION file names, and its contents. Every file in it must
// be one this SBOM accounts for (the VERSION file, the notices and licences, bin/tmux, and a dylib of a library the
// VERSION names); anything else refuses, since it would be code that ships unlisted. A VERSION key this does not know
// refuses too: a statically linked library would show up there and nowhere else.
const DYLIB_OWNER = { ncursesw: 'ncurses', ncurses: 'ncurses', event_core: 'libevent', event: 'libevent', utf8proc: 'utf8proc' };
const VERSION_KEYS = new Set(['tmux', 'source', 'built', 'floor', 'tmux-src', 'libevent', 'ncurses', 'utf8proc']);
function readTmuxBundle(file) {
  const bytes = fs.readFileSync(file);   // read once: the listing and the VERSION read are of the bytes hashed
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const tar = (args) => execFileSync('tar', args, { input: bytes, encoding: 'utf8', maxBuffer: 64 << 20 });
  const list = tar(['-tzf', '-']).split('\n').filter(Boolean);
  // Regular files and directories only: a symlink or hard link would name one file and ship another.
  for (const line of tar(['-tvzf', '-']).split('\n').filter(Boolean)) {
    if (!/^[-d]/.test(line)) throw new Error(`tmux bundle: an entry that is not a plain file or folder: ${line}`);
  }
  const vfiles = list.filter((p) => p.replace(/^\.\//, '') === 'VERSION');
  if (vfiles.length !== 1) throw new Error(`tmux bundle: ${vfiles.length} VERSION files, not one`);
  const parsed = parseTmuxVersion(tar(['-xzOf', '-', vfiles[0]]), list);
  // The VERSION file is text anyone could edit; each version it names must also be in the bytes of the binary or
  // library it describes, so a stale or edited VERSION refuses.
  for (const [name, version] of Object.entries(parsed.versions)) {
    const found = parsed.filesOf[name].some((f) => execFileSync('tar', ['-xzOf', '-', f], { input: bytes, maxBuffer: 64 << 20 }).includes(Buffer.from(version)));
    if (!found) throw new Error(`tmux bundle: VERSION says ${name} ${version}, but no file of it carries that version`);
  }
  return { sha, versions: parsed.versions };
}
function parseTmuxVersion(text, list) {
  const kv = {};
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    const m = raw.match(/^([a-z0-9-]+):[ \t]*(.*)$/);
    if (!m) throw new Error(`tmux bundle VERSION: a line this SBOM cannot read: ${raw}`);
    if (!VERSION_KEYS.has(m[1])) throw new Error(`tmux bundle VERSION: ${m[1]} is not a part this SBOM knows (a statically linked library?)`);
    if (m[1] in kv) throw new Error(`tmux bundle VERSION: ${m[1]} appears twice`);
    kv[m[1]] = m[2].trim().split(/[ \t]/)[0];
  }
  const versions = {};
  for (const [key, name] of [['tmux-src', 'tmux'], ['libevent', 'libevent'], ['ncurses', 'ncurses'], ['utf8proc', 'utf8proc']]) {
    if (!(key in kv)) continue;
    if (!/^[0-9][0-9A-Za-z.+_-]*$/.test(kv[key])) throw new Error(`tmux bundle VERSION: ${key} has no version`);
    versions[name] = kv[key];
  }
  if (!versions.tmux) throw new Error('tmux bundle VERSION: no tmux-src line');
  const self = (text.match(/^tmux:[ \t]+tmux[ \t]+(\S+)/m) || [])[1];
  if (self !== versions.tmux) throw new Error(`tmux bundle VERSION: the binary reports tmux ${self}, the source is ${versions.tmux}`);
  const owned = new Set();
  const licensed = new Set();
  const filesOf = {};
  const names = list.map((x) => x.replace(/^\.\//, '').replace(/\/$/, ''));
  if (new Set(names).size !== names.length) throw new Error('tmux bundle: a path appears twice');
  let seenTmux = false;
  for (const raw of list) {
    const p = raw.replace(/^\.\//, '');
    if (p === 'bin/tmux') { seenTmux = true; filesOf.tmux = [raw]; }
    if (p === '' || p.endsWith('/') || ['VERSION', 'THIRD-PARTY-NOTICES.txt', 'bin/tmux'].includes(p)) continue;
    // One licence file per library the bundle was built from, named <name>-<version>.txt: a record of what is
    // linked in, so each must be a part VERSION names, at its version, and each part must have one.
    const lic = p.match(/^licenses\/(.+)\.txt$/);
    if (lic) {
      const part = Object.keys(versions).find((n) => lic[1] === `${n}-${versions[n]}`);
      if (!part) throw new Error(`tmux bundle: ${p} is the licence of a library its VERSION does not name at that version`);
      licensed.add(part);
      continue;
    }
    const m = p.match(/^lib\/lib(.+?)(?:[-.][0-9]+(?:\.[0-9]+)*)?\.dylib$/);
    const owner = m && DYLIB_OWNER[m[1]];
    if (!owner || !versions[owner]) throw new Error(`tmux bundle: ${p} is not a file this SBOM accounts for`);
    owned.add(owner);
    (filesOf[owner] = filesOf[owner] || []).push(raw);
  }
  for (const lib of Object.keys(versions)) if (lib !== 'tmux' && !owned.has(lib)) throw new Error(`tmux bundle: VERSION names ${lib}, but no library of it is in lib/`);
  if (!seenTmux) throw new Error('tmux bundle: no bin/tmux');
  for (const part of Object.keys(versions)) if (!licensed.has(part)) throw new Error(`tmux bundle: no licence file for ${part} ${versions[part]}`);
  return { versions, filesOf };
}

// The manifest bytes, only when their signature verifies under one of the pinned release keys (engine/manifest-verify.js):
// the SBOM is only as true as its inputs, and the manifest is the one that names everything else.
function readSignedManifest(file, sigFile, keys = require('../../engine/manifest-verify.js').KEYS) {
  const bytes = fs.readFileSync(file);
  let sig;
  try { sig = Buffer.from(fs.readFileSync(sigFile, 'utf8').trim(), 'base64'); } catch { sig = Buffer.alloc(0); }
  const ok = sig.length === 64 && keys.some((k) => {
    try { return crypto.verify(null, bytes, crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }), sig); } catch { return false; }
  });
  if (!ok) throw new Error('the manifest is not signed by a pinned Kosmos release key');
  return JSON.parse(bytes.toString('utf8'));
}

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hashOf = (sha) => (sha && /^[0-9a-f]{64}$/.test(sha) ? [{ alg: 'SHA-256', content: sha }] : undefined);
const download = (url, sha) => [{ type: 'distribution', url, hashes: hashOf(sha) }];
// Common Platform Enumeration names, so a scan that does not read purls (NVD) can match these.
// Only names NVD actually has (checked 2026-10-19; it has none for utf8proc), and the version as NVD writes it
// (libevent's "-stable" suffix is not part of it).
const CPE = { node: 'nodejs:node.js', tmux: 'tmux_project:tmux', libevent: 'libevent_project:libevent', ncurses: 'gnu:ncurses' };
const cpe = (name, version) => (CPE[name] ? `cpe:2.3:a:${CPE[name]}:${version.replace(/-stable$/, '')}:*:*:*:*:*:*:*` : undefined);
const SHA256 = /^[0-9a-f]{64}$/;

// A crate's reference is name@version, unless two reached crates share both (Cargo allows one from crates.io and one
// from git): then each also names its source, so no two components share a bom-ref.
function crateRefs(root, crates) {
  const n = new Map();
  for (const p of crates) n.set(`${p.name}@${p.version}`, (n.get(`${p.name}@${p.version}`) || 0) + 1);
  return (p) => (p === root ? 'connector' : !p.source ? `first-party:${p.name}`
    : `crate:${p.name}@${p.version}${n.get(`${p.name}@${p.version}`) > 1 ? `?source=${encodeURIComponent(p.source)}` : ''}`);
}
function crateComponent(p, relayCommit, crateRef, members) {
  const base = { type: 'library', 'bom-ref': crateRef(p), name: p.name, version: p.version };
  if (!p.source) {
    if (!members.has(p.name)) throw new Error(`Cargo.lock: ${p.name} ${p.version} has no source and is not a relay workspace member (a vendored crate?)`);
    return { ...base, description: `kosmos-relay workspace crate, ${relayCommit}` };
  }
  if (CRATES_IO.has(p.source)) {
    if (!SHA256.test(p.checksum || '')) throw new Error(`Cargo.lock: ${p.name} ${p.version} from crates.io has no checksum`);
    return { ...base, purl: `pkg:cargo/${p.name}@${encodeURIComponent(p.version)}`, hashes: hashOf(p.checksum) };
  }
  const git = p.source.match(/^git\+([^?#]+)(?:\?[^#]*)?#([0-9a-f]{7,40})$/);
  if (git) {
    // purl's vcs_url form: git+<url>@<commit>, the commit Cargo.lock pinned after its #.
    return { ...base, purl: `pkg:cargo/${p.name}@${encodeURIComponent(p.version)}?vcs_url=${encodeURIComponent(`git+${git[1]}@${git[2]}`)}` };
  }
  throw new Error(`Cargo.lock: ${p.name} ${p.version} comes from a source this SBOM does not know: ${p.source}`);
}

// The release's own files, from the signed manifest's list. Anything outside these places, or any node_modules, would
// be code this SBOM does not list, so it refuses; so does an npm dependency in package.json at the app commit.
// Native code is where a third-party addition would most likely land, so app/bin/ and the Mac app are exact: scripts
// by extension, and the two binaries by name; inside Kosmos.app only its own executable, plist, icon and signature.
const FIRST_PARTY_FILES = new Set(['VERSION', 'bin/kosmos', 'runtime/bin/node', 'runtime/LICENSE', 'app/server.js', 'app/package.json',
  'app/bin/kosmos-app', 'app/bin/kosmos-tunnel', 'app/Kosmos.app/Contents/Info.plist', 'app/Kosmos.app/Contents/CodeResources',
  'app/Kosmos.app/Contents/MacOS/Kosmos', 'app/Kosmos.app/Contents/_CodeSignature/CodeResources']);
const FIRST_PARTY_DIRS = ['app/engine/', 'app/web/', 'app/assets/'];
// Inside those, text and image files only: a prebuilt addon (.node), a library or a binary with no extension refuses.
const FIRST_PARTY_EXT = /\.(js|mjs|cjs|json|html|css|svg|png|jpg|jpeg|gif|webp|ico|icns|webmanifest|md|txt)$/;
const FIRST_PARTY_PATTERNS = [/^app\/bin\/[A-Za-z0-9_.-]+\.(sh|js)$/, /^app\/Kosmos\.app\/Contents\/Resources\/[A-Za-z0-9_.-]+\.icns$/];
function checkFirstParty(manifest, packageJson) {
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('manifest lists no files');
  for (const f of manifest.files) {
    const p = f && f.path;
    if (typeof p !== 'string' || /(^|\/)node_modules(\/|$)/.test(p) || p.split('/').includes('..')
      || !(FIRST_PARTY_FILES.has(p) || (FIRST_PARTY_DIRS.some((d) => p.startsWith(d)) && FIRST_PARTY_EXT.test(p))
        || FIRST_PARTY_PATTERNS.some((r) => r.test(p)))) {
      throw new Error(`manifest ships ${p}, which is not a first-party place this SBOM accounts for`);
    }
  }
  const shipped = new Map(manifest.files.map((f) => [f.path, f.sha256]));
  if (shipped.size !== manifest.files.length) throw new Error('manifest lists a file twice');
  if (crypto.createHash('sha256').update(packageJson, 'utf8').digest('hex') !== shipped.get('app/package.json')) {
    throw new Error('package.json at the app commit is not the app/package.json the release shipped');
  }
  if (shipped.get('app/bin/kosmos-tunnel') !== manifest.connector.signed_sha256) throw new Error('the manifest\'s app/bin/kosmos-tunnel is not the connector it names');
  if (!shipped.has('runtime/bin/node')) throw new Error('the manifest ships no runtime/bin/node');
  let pkg;
  try { pkg = JSON.parse(packageJson); } catch { throw new Error('package.json at the app commit is not readable'); }
  for (const k of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) {
    const v = pkg[k];
    if (v && (Array.isArray(v) ? v.length : Object.keys(v).length)) throw new Error(`package.json at the app commit has ${k}: this SBOM lists no npm packages`);
  }
}

// The Mac app is one Swift file (native-app/main.swift); its shipped binary is the one the manifest signed, and it may
// import Apple's frameworks only. A Swift package, or another module, would be third-party code this does not list.
const APPLE_MODULES = new Set(['Foundation', 'Cocoa', 'AppKit', 'WebKit', 'Network', 'ApplicationServices', 'AVFoundation', 'Speech',
  'UserNotifications', 'Security', 'CoreGraphics', 'CoreFoundation', 'CoreServices', 'Darwin', 'os', 'ServiceManagement',
  'SwiftUI', 'Combine', 'IOKit', 'SystemConfiguration', 'UniformTypeIdentifiers', 'QuartzCore', 'CoreAudio']);
// Swift source with its comments (// and /* */, which nest in Swift) blanked and its string literals emptied, so what
// is left is code. Quotes are tracked, so a // inside a string is not a comment.
function swiftCode(src) {
  let out = '', i = 0, depth = 0;
  while (i < src.length) {
    const c = src[i], two = src.slice(i, i + 2);
    if (depth) { if (two === '/*') { depth++; i += 2; } else if (two === '*/') { depth--; i += 2; } else { out += c === '\n' ? '\n' : ' '; i++; } continue; }
    if (two === '/*') { depth = 1; i += 2; continue; }
    if (two === '//') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"') {
      const triple = src.slice(i, i + 3) === '"""';
      const end = triple ? '"""' : '"';
      i += end.length;
      while (i < src.length && src.slice(i, i + end.length) !== end) { if (src[i] === '\\') i++; if (src[i] === '\n') out += '\n'; i++; }
      i += end.length; out += '""';
      continue;
    }
    out += c; i++;
  }
  return out;
}

function checkNativeApp(manifest, swift) {
  const shipped = manifest.files.find((f) => f.path === 'app/bin/kosmos-app');
  if (!manifest.native_app || !SHA256.test(manifest.native_app.signed_sha256 || '') || !shipped || shipped.sha256 !== manifest.native_app.signed_sha256) {
    throw new Error('the manifest\'s app/bin/kosmos-app is not the Mac app it signed (native_app.signed_sha256)');
  }
  // Every statement that mentions import, once comments are gone, must be one import in the plain shape; anything
  // else (an access level, an attribute with arguments, a form this does not know) refuses rather than going unread.
  for (const stmt of swiftCode(swift).split(/[\n;]/)) {
    if (!/\bimport\b/.test(stmt)) continue;
    const m = stmt.match(/^\s*(?:@(?:preconcurrency|testable)\s+)?import\s+(?:(?:class|struct|enum|func|protocol|typealias|var|let)\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)*\s*$/);
    if (!m) throw new Error(`native-app/main.swift: an import this SBOM cannot read: ${stmt.trim()}`);
    if (!APPLE_MODULES.has(m[1])) throw new Error(`native-app/main.swift imports ${m[1]}, which is not an Apple framework this SBOM knows`);
  }
}

const MANIFEST_KEYS = new Set(['manifest', 'version', 'arch', 'artifact', 'sha256', 'app', 'node', 'connector', 'native_app', 'built',
  'pinned_keys', 'setup_sha256', 'tmux_sha256', 'files']);
const SEMVER = /^\d+\.\d+\.\d+$/;
// The format of this SBOM's output; part of the serial number, so a changed generator never reuses a document id.
const FORMAT = 'kosmos-sbom-1';

function build(manifest, { repo, relay, tmux, show = gitShow }) {
  if (manifest.manifest !== 1) throw new Error(`manifest format ${manifest.manifest}: this SBOM reads format 1`);
  for (const k of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(k)) throw new Error(`manifest has ${k}, a part this SBOM does not know (it would be left out)`);
  }
  for (const k of ['version', 'app', 'node', 'connector']) if (!manifest[k]) throw new Error(`manifest has no ${k}`);
  if (!manifest.node.version) throw new Error('manifest has no node version');
  if (!SEMVER.test(manifest.version)) throw new Error(`manifest version ${manifest.version} is not a release version`);
  if (!SEMVER.test(manifest.node.version.replace(/^v/, ''))) throw new Error(`manifest node version ${manifest.node.version} is not a version`);
  const appCommit = manifest.app.commit, relayCommit = manifest.connector.commit;
  if (!appCommit || !relayCommit) throw new Error('manifest names no app or connector commit');
  if (!/^[0-9a-f]{40}$/.test(appCommit) || !/^[0-9a-f]{40}$/.test(relayCommit)) throw new Error('manifest app and connector commits must be full shas');
  if (manifest.app.dirty !== false) throw new Error('manifest does not say the app was built from a clean tree: its commit may not be what shipped');
  if (manifest.arch !== 'arm64') throw new Error(`manifest arch ${manifest.arch}: this SBOM knows the arm64 Mac release only`);
  if (!tmux || !manifest.tmux_sha256) throw new Error('a tmux bundle and the manifest\'s tmux_sha256 are both required');
  for (const [what, v] of [['sha256', manifest.sha256], ['node.download_sha256', manifest.node.download_sha256],
    ['connector.signed_sha256', manifest.connector.signed_sha256], ['tmux_sha256', manifest.tmux_sha256]]) {
    if (!SHA256.test(v || '')) throw new Error(`manifest ${what} is not a sha256 (${v}): the SBOM cannot vouch for that input`);
  }
  if (tmux.sha !== manifest.tmux_sha256) throw new Error(`the tmux bundle (${tmux.sha.slice(0, 12)}) is not the one this release signed (${manifest.tmux_sha256.slice(0, 12)})`);
  checkFirstParty(manifest, show(repo, appCommit, 'package.json'));
  const arch = manifest.arch;
  const { root, deps, edges } = closure(parseLock(show(relay, relayCommit, 'Cargo.lock')), CONNECTOR_CRATE);
  const members = workspaceMembers(show, relay, relayCommit);
  // The shipped app/bin/kosmos-tunnel must be that crate's binary, or its closure is not the connector's.
  const tunnelToml = members.get(CONNECTOR_CRATE) || '';
  if (!/^\[\[bin\]\]\s*\nname\s*=\s*"kosmos-tunnel"/m.test(tunnelToml)) throw new Error(`relay: ${CONNECTOR_CRATE} does not build the kosmos-tunnel binary`);
  checkNativeApp(manifest, show(repo, appCommit, 'native-app/main.swift'));
  const pins = tmuxPins(show(repo, appCommit, 'tools/build-tmux-from-source.sh')).map((p) => p.name);
  for (const name of pins) {
    if (!tmux.versions[name]) throw new Error(`the build script fetches ${name}, but the tmux bundle's VERSION does not name it (linked statically and unrecorded?)`);
  }
  const node = manifest.node.version.replace(/^v/, '');
  const crateRef = crateRefs(root, [root, ...deps]);
  const crates = deps.slice().sort((a, b) => byCodePoint(crateRef(a), crateRef(b)));
  const libs = Object.keys(tmux.versions).filter((n) => n !== 'tmux');
  const tmuxPart = (name) => {
    const version = tmux.versions[name];
    return { type: name === 'tmux' ? 'application' : 'library', 'bom-ref': `tmux-part:${name}`, name, version,
      purl: `pkg:generic/${name}@${encodeURIComponent(version)}`, cpe: cpe(name, version),
      description: `${name}, in the shipped tmux bundle` };
  };
  const components = [
    { type: 'framework', 'bom-ref': 'node', name: 'node', version: node, purl: `pkg:generic/nodejs/node@${encodeURIComponent(node)}`,
      cpe: cpe('node', node), description: `Node.js runtime, the official darwin-${arch} tarball`,
      externalReferences: download(`https://nodejs.org/dist/v${node}/node-v${node}-darwin-${arch}.tar.gz`, manifest.node.download_sha256) },
    { type: 'application', 'bom-ref': 'tmux-bundle', name: `tmux-${arch}`, version: tmux.versions.tmux,
      hashes: hashOf(manifest.tmux_sha256), description: 'the tmux bundle the release ships (tmux and the libraries it links)' },
    tmuxPart('tmux'), ...libs.map(tmuxPart),
    { type: 'application', 'bom-ref': 'connector', name: CONNECTOR_CRATE, version: root.version,
      hashes: hashOf(manifest.connector.signed_sha256), description: `the Plus connector, kosmos-relay ${relayCommit}` },
    ...crates.map((p) => crateComponent(p, relayCommit, crateRef, members)),
  ];
  return {
    bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    serialNumber: `urn:uuid:${uuidFrom(`${FORMAT}:${manifest.sha256}`)}`,
    metadata: {
      timestamp: builtAt(manifest),
      tools: { components: [{ type: 'application', name: 'kosmos tools/lib/sbom.js', version: FORMAT }] },
      // Said in the SBOM itself, not only here, so a scanner reading the JSON is told.
      properties: [{ name: 'kosmos:cargo-closure', value: 'the connector crates are its Cargo.lock closure, a superset of the macOS build: an advisory on a crate that cargo tree --target aarch64-apple-darwin does not list is not shipped' }],
      component: { type: 'application', 'bom-ref': 'kosmos', name: 'kosmos', version: manifest.version,
        hashes: hashOf(manifest.sha256), description: `Kosmos ${manifest.version} (${arch}), app ${appCommit}` },
    },
    components,
    dependencies: [
      { ref: 'kosmos', dependsOn: ['connector', 'node', 'tmux-bundle'] },
      { ref: 'node', dependsOn: [] },
      { ref: 'tmux-bundle', dependsOn: ['tmux-part:tmux'] },
      { ref: 'tmux-part:tmux', dependsOn: libs.map((n) => `tmux-part:${n}`).sort(byCodePoint) },
      ...libs.map((n) => ({ ref: `tmux-part:${n}`, dependsOn: [] })),
      { ref: 'connector', dependsOn: [...new Set(edges.get(root).map(crateRef))].sort(byCodePoint) },
      ...crates.map((p) => ({ ref: crateRef(p), dependsOn: [...new Set(edges.get(p).map(crateRef))].sort(byCodePoint) })),
    ],
  };
}

function builtAt(manifest) {
  const at = manifest.built && manifest.built.at;
  if (at === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at)) throw new Error(`manifest built.at is not a UTC time: ${at}`);
  return at;
}

// The same release always gets the same serial number, so a rebuilt SBOM is byte-identical. RFC 9562 version 8 is
// the custom-hash version: 122 bits of sha256(seed).
function uuidFrom(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

module.exports = { parseLock, closure, tmuxPins, parseTmuxVersion, readTmuxBundle, readSignedManifest, build };

// A path as the file system resolves it (following a symlink), or as written when it does not exist yet.
function realish(p) { try { return fs.realpathSync(p); } catch { return require('path').resolve(p); } }

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); const v = i >= 0 ? args[i + 1] : null; return v && !v.startsWith('--') ? v : null; };
  const file = args[0], sig = opt('--sig'), repo = opt('--repo'), relay = opt('--relay'), tmuxFile = opt('--tmux'), out = opt('--out');
  const known = new Set(['--sig', '--repo', '--relay', '--tmux', '--out']);
  const badFlag = args.slice(1).some((a, i, xs) => a.startsWith('--') ? !known.has(a) || xs.indexOf(a) !== i : !(i > 0 && known.has(xs[i - 1])))
    || (out && [file, sig, tmuxFile].filter(Boolean).map(realish).includes(realish(out)));
  if (!file || file.startsWith('--') || !sig || !repo || !relay || !tmuxFile || badFlag || (args.includes('--out') && !out)) {
    console.error('usage: sbom.js <manifest.json> --sig <manifest.json.sig> --tmux <tmux-arch.tar.gz> --repo <kosmos> --relay <kosmos-relay> [--out <file>]');
    process.exit(2);
  }
  try {
    const text = JSON.stringify(build(readSignedManifest(file, sig), { repo, relay, tmux: readTmuxBundle(tmuxFile) }), null, 2) + '\n';
    if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
  } catch (e) { console.error(`sbom: ${e.message}`); process.exit(1); }
}
