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
 *     A release copies an already-built bundle and does not rebuild it, so the build script at the app commit can
 *     disagree with what shipped; the script is read only for each input's download url and source sha256, and only
 *     where its version equals the bundle's (otherwise the component says so and carries no source reference);
 *   - the connector's Rust crates: the relay's Cargo.lock at the connector commit, walked from kosmos-tunnel-client,
 *     with each crate's direct dependencies. A crate with no source counts as first-party only when it is a member of
 *     the relay's workspace; any other crate from a source this does not know refuses the whole SBOM.
 * The app itself has no npm dependencies (package.json lists none), so nothing else is third-party code; the Mac app
 * (Swift) links Apple's frameworks only. Node is one component: the libraries inside the official Node build (V8,
 * OpenSSL and so on) are Node's own and are matched through Node's version, not listed one by one; the Rust standard
 * library compiled into the connector is not listed either (the relay pins no toolchain, so no version is recorded).
 *
 * LIMIT: the crate list is the lockfile closure, a superset of what the macOS connector compiles. Measured for 0.7.59:
 * 227 crates against cargo tree's 189; the extra are Windows-only and dev-only crates (26) and optional dependencies
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
    if (!kv) continue;
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
  const m = top.match(/^\[workspace\][\s\S]*?^members\s*=\s*\[([^\]]*)\]/m);
  if (!m) throw new Error('relay Cargo.toml: no [workspace] members');
  const dirs = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (!dirs.length || dirs.some((d) => /[*?[]/.test(d))) throw new Error('relay Cargo.toml: members must be literal paths');
  return new Set(dirs.map((d) => {
    const n = show(relay, commit, `${d}/Cargo.toml`).match(/^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m);
    if (!n) throw new Error(`relay ${d}/Cargo.toml: no [package] name`);
    return n[1];
  }));
}

// Every `fetch <name> "$X_URL" "$X_SHA"` call, with X_VERSION, X_URL and X_SHA read from the same script. A fetch
// call in any other shape, anywhere on a line, refuses, and so does a *_URL nobody fetches: skipping either silently
// is how a build input goes missing.
function tmuxPins(text) {
  const vars = {};
  for (const m of text.matchAll(/^([A-Z0-9_]+)="([^"]*)"/gm)) vars[m[1]] = m[2];
  const expand = (s) => {
    for (let i = 0; i < 5 && /\$\{[A-Z0-9_]+\}/.test(s); i++) s = s.replace(/\$\{([A-Z0-9_]+)\}/g, (_, v) => (v in vars ? vars[v] : `\${${v}}`));
    return s;
  };
  const code = text.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).filter((l) => !/^\s*fetch\s*\(\)/.test(l));
  const pins = [];
  for (const line of code.filter((l) => /(^|[\s;&|(])fetch\s/.test(l))) {
    const m = line.match(/^\s*fetch\s+(\S+)\s+"\$([A-Z0-9_]+)_URL"\s+"\$([A-Z0-9_]+)_SHA"\s*$/);
    if (!m) throw new Error(`build-tmux-from-source.sh: a fetch line this SBOM cannot read: ${line.trim()}`);
    const [, name, u, s] = m;
    const version = vars[`${u}_VERSION`], url = vars[`${u}_URL`] && expand(vars[`${u}_URL`]), sha = vars[`${s}_SHA`];
    if (!version || !url) throw new Error(`build-tmux-from-source.sh: no version or url for ${name}`);
    if (/\$/.test(url) || /\$/.test(version)) throw new Error(`build-tmux-from-source.sh: ${name}'s version or url names a variable this SBOM cannot expand`);
    if (!/^[0-9a-f]{64}$/.test(sha || '')) throw new Error(`build-tmux-from-source.sh: no recorded sha256 for ${name}`);
    pins.push({ name, url, version, sha, urlVar: `${u}_URL` });
  }
  if (!pins.length) throw new Error('build-tmux-from-source.sh: no fetch lines');
  const fetched = new Set(pins.map((p) => p.urlVar));
  for (const v of Object.keys(vars)) if (/_URL$/.test(v) && !fetched.has(v)) throw new Error(`build-tmux-from-source.sh: ${v} is set but never fetched`);
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
  const vfiles = list.filter((p) => p.replace(/^\.\//, '') === 'VERSION');
  if (vfiles.length !== 1) throw new Error(`tmux bundle: ${vfiles.length} VERSION files, not one`);
  return { sha, ...parseTmuxVersion(tar(['-xzOf', '-', vfiles[0]]), list) };
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
  for (const raw of list) {
    const p = raw.replace(/^\.\//, '');
    if (p.endsWith('/') || ['VERSION', 'THIRD-PARTY-NOTICES.txt', 'bin/tmux'].includes(p) || /^licenses\/[^/]+\.txt$/.test(p)) continue;
    const m = p.match(/^lib\/lib(.+?)(?:[-.][0-9][^/]*)?\.dylib$/);
    const owner = m && DYLIB_OWNER[m[1]];
    if (!owner || !versions[owner]) throw new Error(`tmux bundle: ${p} is not a file this SBOM accounts for`);
  }
  return { versions };
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
  if (CRATES_IO.has(p.source)) return { ...base, purl: `pkg:cargo/${p.name}@${encodeURIComponent(p.version)}`, hashes: hashOf(p.checksum) };
  const git = p.source.match(/^git\+([^?#]+)(?:\?[^#]*)?#([0-9a-f]{7,40})$/);
  if (git) {
    // purl's vcs_url form: git+<url>@<commit>, the commit Cargo.lock pinned after its #.
    return { ...base, purl: `pkg:cargo/${p.name}@${encodeURIComponent(p.version)}?vcs_url=${encodeURIComponent(`git+${git[1]}@${git[2]}`)}` };
  }
  throw new Error(`Cargo.lock: ${p.name} ${p.version} comes from a source this SBOM does not know: ${p.source}`);
}

function build(manifest, { repo, relay, tmux, show = gitShow }) {
  for (const k of ['version', 'app', 'node', 'connector']) if (!manifest[k]) throw new Error(`manifest has no ${k}`);
  if (!manifest.node.version) throw new Error('manifest has no node version');
  const appCommit = manifest.app.commit, relayCommit = manifest.connector.commit;
  if (!appCommit || !relayCommit) throw new Error('manifest names no app or connector commit');
  if (manifest.app.dirty) throw new Error('manifest says the app was built from a dirty tree: its commit is not what shipped');
  if (!tmux || !manifest.tmux_sha256) throw new Error('a tmux bundle and the manifest\'s tmux_sha256 are both required');
  for (const [what, v] of [['sha256', manifest.sha256], ['node.download_sha256', manifest.node.download_sha256],
    ['connector.signed_sha256', manifest.connector.signed_sha256], ['tmux_sha256', manifest.tmux_sha256]]) {
    if (!SHA256.test(v || '')) throw new Error(`manifest ${what} is not a sha256 (${v}): the SBOM cannot vouch for that input`);
  }
  if (tmux.sha !== manifest.tmux_sha256) throw new Error(`the tmux bundle (${tmux.sha.slice(0, 12)}) is not the one this release signed (${manifest.tmux_sha256.slice(0, 12)})`);
  const arch = manifest.arch || 'arm64';
  const { root, deps, edges } = closure(parseLock(show(relay, relayCommit, 'Cargo.lock')), CONNECTOR_CRATE);
  const members = workspaceMembers(show, relay, relayCommit);
  const pins = new Map(tmuxPins(show(repo, appCommit, 'tools/build-tmux-from-source.sh')).map((p) => [p.name, p]));
  for (const name of pins.keys()) {
    if (!tmux.versions[name]) throw new Error(`the build script fetches ${name}, but the tmux bundle's VERSION does not name it (linked statically and unrecorded?)`);
  }
  const node = manifest.node.version.replace(/^v/, '');
  const crateRef = crateRefs(root, [root, ...deps]);
  const crates = deps.slice().sort((a, b) => byCodePoint(crateRef(a), crateRef(b)));
  const libs = Object.keys(tmux.versions).filter((n) => n !== 'tmux');
  const tmuxPart = (name) => {
    const version = tmux.versions[name], pin = pins.get(name);
    const c = { type: name === 'tmux' ? 'application' : 'library', 'bom-ref': `tmux-part:${name}`, name, version,
      purl: `pkg:generic/${name}@${encodeURIComponent(version)}`, cpe: cpe(name, version),
      description: `${name}, in the shipped tmux bundle` };
    if (pin && pin.version === version) c.externalReferences = download(pin.url, pin.sha);
    else c.properties = [{ name: 'kosmos:source-pin', value: pin ? `the build script pins ${pin.version}, the bundle has ${version}` : 'the build script has no fetch line for it' }];
    return c;
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
    serialNumber: `urn:uuid:${uuidFrom(manifest.sha256 || appCommit)}`,
    metadata: {
      timestamp: (manifest.built && manifest.built.at) || undefined,
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
      { ref: 'connector', dependsOn: edges.get(root).map(crateRef).sort(byCodePoint) },
      ...crates.map((p) => ({ ref: crateRef(p), dependsOn: [...new Set(edges.get(p).map(crateRef))].sort(byCodePoint) })),
    ],
  };
}

// The same release always gets the same serial number, so a rebuilt SBOM is byte-identical. RFC 9562 version 8 is
// the custom-hash version: 122 bits of sha256(seed).
function uuidFrom(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

module.exports = { parseLock, closure, tmuxPins, parseTmuxVersion, readTmuxBundle, readSignedManifest, build };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const file = args[0], sig = opt('--sig'), repo = opt('--repo'), relay = opt('--relay'), tmuxFile = opt('--tmux'), out = opt('--out');
  if (!file || file.startsWith('--') || !sig || !repo || !relay || !tmuxFile) {
    console.error('usage: sbom.js <manifest.json> --sig <manifest.json.sig> --tmux <tmux-arch.tar.gz> --repo <kosmos> --relay <kosmos-relay> [--out <file>]');
    process.exit(2);
  }
  try {
    const text = JSON.stringify(build(readSignedManifest(file, sig), { repo, relay, tmux: readTmuxBundle(tmuxFile) }), null, 2) + '\n';
    if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
  } catch (e) { console.error(`sbom: ${e.message}`); process.exit(1); }
}
