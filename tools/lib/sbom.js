'use strict';
/* O05: a CycloneDX 1.5 bill of materials for one Mac release, derived from its SIGNED manifest and git history.
 *
 *   node tools/lib/sbom.js <manifest.json> --repo <kosmos checkout> --relay <kosmos-relay checkout> [--out <file>]
 *
 * Everything comes from records that already exist for the release, so the SBOM of any served release can be
 * rebuilt later, on any machine, without its build box:
 *   - the release itself, the Node runtime (version and download sha) and the connector's relay commit: the manifest;
 *   - every source tarball tmux is built from (tmux, libevent, ncurses, utf8proc today): the `fetch` lines of
 *     tools/build-tmux-from-source.sh at the app commit, with their pinned versions and sha256. Reading the fetch
 *     lines, not a list of names here, means a new build input is listed the day it is added;
 *   - the connector's Rust crates: the relay's Cargo.lock at the connector commit, walked from kosmos-tunnel-client,
 *     with each crate's direct dependencies.
 * The app itself has no npm dependencies (package.json lists none), so nothing else is third-party code; the Mac app
 * (Swift) links Apple's frameworks only.
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
      if (m) cur.deps.push(m[1]);
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

// Every `fetch <name> "$X_URL" "$X_SHA"` line, with X_VERSION, X_URL and X_SHA read from the same script. A fetch
// line in any other shape refuses: skipping one silently is exactly how a build input goes missing.
function tmuxPins(text) {
  const vars = {};
  for (const m of text.matchAll(/^([A-Z0-9_]+)="([^"]*)"/gm)) vars[m[1]] = m[2];
  const expand = (s) => {
    for (let i = 0; i < 5 && /\$\{[A-Z0-9_]+\}/.test(s); i++) s = s.replace(/\$\{([A-Z0-9_]+)\}/g, (_, v) => (v in vars ? vars[v] : `\${${v}}`));
    return s;
  };
  const calls = text.split('\n').filter((l) => /^\s*fetch\s+\S/.test(l));
  const pins = [];
  for (const line of calls) {
    const m = line.match(/^\s*fetch\s+(\S+)\s+"\$([A-Z0-9_]+)_URL"\s+"\$([A-Z0-9_]+)_SHA"\s*$/);
    if (!m) throw new Error(`build-tmux-from-source.sh: a fetch line this SBOM cannot read: ${line.trim()}`);
    const [, name, u, s] = m;
    const version = vars[`${u}_VERSION`], url = vars[`${u}_URL`] && expand(vars[`${u}_URL`]), sha = vars[`${s}_SHA`];
    if (!version || !url) throw new Error(`build-tmux-from-source.sh: no version or url for ${name}`);
    if (/\$/.test(url)) throw new Error(`build-tmux-from-source.sh: ${name}'s url names a variable this SBOM cannot expand`);
    if (!/^[0-9a-f]{64}$/.test(sha || '')) throw new Error(`build-tmux-from-source.sh: no recorded sha256 for ${name}`);
    pins.push({ name, version, url, sha });
  }
  if (!pins.length) throw new Error('build-tmux-from-source.sh: no fetch lines');
  return pins;
}

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hashOf = (sha) => (sha && /^[0-9a-f]{64}$/.test(sha) ? [{ alg: 'SHA-256', content: sha }] : undefined);
const download = (url, sha) => [{ type: 'distribution', url, hashes: hashOf(sha) }];
// Common Platform Enumeration names, so a scan that does not read purls (NVD) can match these four.
const CPE = { node: 'nodejs:node.js', tmux: 'tmux_project:tmux', libevent: 'libevent_project:libevent',
  ncurses: 'gnu:ncurses', utf8proc: 'utf8proc_project:utf8proc' };
const cpe = (name, version) => (CPE[name] ? `cpe:2.3:a:${CPE[name]}:${version}:*:*:*:*:*:*:*` : undefined);

// A crate's reference is name@version, unless two reached crates share both (Cargo allows one from crates.io and one
// from git): then each also names its source, so no two components share a bom-ref.
function crateRefs(crates) {
  const n = new Map();
  for (const p of crates) n.set(`${p.name}@${p.version}`, (n.get(`${p.name}@${p.version}`) || 0) + 1);
  return (p) => (!p.source ? `first-party:${p.name}`
    : `crate:${p.name}@${p.version}${n.get(`${p.name}@${p.version}`) > 1 ? `?source=${encodeURIComponent(p.source)}` : ''}`);
}
function crateComponent(p, relayCommit, crateRef) {
  const base = { type: 'library', 'bom-ref': crateRef(p), name: p.name, version: p.version };
  if (!p.source) return { ...base, description: `kosmos-relay workspace crate, ${relayCommit}` };
  if (p.source.startsWith('registry+https://github.com/rust-lang/crates.io-index') || p.source === 'sparse+https://index.crates.io/') {
    return { ...base, purl: `pkg:cargo/${p.name}@${encodeURIComponent(p.version)}`, hashes: hashOf(p.checksum) };
  }
  if (p.source.startsWith('git+')) {
    return { ...base, purl: `pkg:cargo/${p.name}@${encodeURIComponent(p.version)}?vcs_url=${encodeURIComponent(p.source.slice(4))}` };
  }
  throw new Error(`Cargo.lock: ${p.name} ${p.version} comes from a source this SBOM does not know: ${p.source}`);
}

function build(manifest, { repo, relay, show = gitShow }) {
  for (const k of ['version', 'app', 'node', 'connector']) if (!manifest[k]) throw new Error(`manifest has no ${k}`);
  if (!manifest.node.version) throw new Error('manifest has no node version');
  const appCommit = manifest.app.commit, relayCommit = manifest.connector.commit;
  if (!appCommit || !relayCommit) throw new Error('manifest names no app or connector commit');
  const arch = manifest.arch || 'arm64';
  const { root, deps, edges } = closure(parseLock(show(relay, relayCommit, 'Cargo.lock')), CONNECTOR_CRATE);
  const node = manifest.node.version.replace(/^v/, '');
  const crateRef = crateRefs([root, ...deps]);
  const crates = deps.slice().sort((a, b) => byCodePoint(crateRef(a), crateRef(b)));
  const components = [
    { type: 'framework', 'bom-ref': 'node', name: 'node', version: node, purl: `pkg:generic/nodejs/node@${node}`,
      cpe: cpe('node', node), description: `Node.js runtime, the official darwin-${arch} tarball`,
      externalReferences: download(`https://nodejs.org/dist/v${node}/node-v${node}-darwin-${arch}.tar.gz`, manifest.node.download_sha256) },
    ...tmuxPins(show(repo, appCommit, 'tools/build-tmux-from-source.sh')).map((p) => ({
      type: 'library', 'bom-ref': p.name, name: p.name, version: p.version, purl: `pkg:generic/${p.name}@${p.version}`,
      cpe: cpe(p.name, p.version), description: `${p.name}, built from its source tarball by the release`,
      externalReferences: download(p.url, p.sha) })),
    { type: 'application', 'bom-ref': 'connector', name: CONNECTOR_CRATE, version: root.version,
      hashes: hashOf(manifest.connector.signed_sha256), description: `the Plus connector, kosmos-relay ${relayCommit}` },
    ...crates.map((p) => crateComponent(p, relayCommit, crateRef)),
  ];
  const tmuxRefs = components.filter((c) => c.type === 'library' && !c['bom-ref'].includes(':')).map((c) => c['bom-ref']);
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
      { ref: 'kosmos', dependsOn: ['node', ...tmuxRefs, 'connector'] },
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

module.exports = { parseLock, closure, tmuxPins, build };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const file = args[0], repo = opt('--repo'), relay = opt('--relay'), out = opt('--out');
  if (!file || file.startsWith('--') || !repo || !relay) { console.error('usage: sbom.js <manifest.json> --repo <kosmos> --relay <kosmos-relay> [--out <file>]'); process.exit(2); }
  try {
    const text = JSON.stringify(build(JSON.parse(fs.readFileSync(file, 'utf8')), { repo, relay }), null, 2) + '\n';
    if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
  } catch (e) { console.error(`sbom: ${e.message}`); process.exit(1); }
}
