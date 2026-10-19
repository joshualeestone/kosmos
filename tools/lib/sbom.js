'use strict';
/* O05: a CycloneDX 1.5 bill of materials for one Mac release, derived from its SIGNED manifest and git history.
 *
 *   node tools/lib/sbom.js <manifest.json> --repo <kosmos checkout> --relay <kosmos-relay checkout> [--out <file>]
 *
 * Everything comes from records that already exist for the release, so the SBOM of any served release can be
 * rebuilt later, on any machine, without its build box:
 *   - the release itself, the Node runtime (version and download sha) and the connector's relay commit: the manifest;
 *   - tmux, libevent and ncurses (versions and source sha256): tools/build-tmux-from-source.sh at the app commit;
 *   - the connector's Rust crates: the relay's Cargo.lock at the connector commit, walked from kosmos-tunnel-client.
 * The app itself has no npm dependencies (package.json lists none), so nothing else is third-party code; the Mac app
 * (Swift) links Apple's frameworks only.
 *
 * LIMIT: the crate list is the lockfile closure over every platform, feature and dev-dependency, a superset of what
 * the macOS connector compiles (Windows-only and test-only crates appear: 227 against 189 for 0.7.59). It never
 * misses a crate the connector builds with. The relay's own workspace crates are listed as first-party, with no purl.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const CONNECTOR_CRATE = 'kosmos-tunnel-client';

function gitShow(repo, commit, file) {
  return execFileSync('git', ['-C', repo, 'show', `${commit}:${file}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
}

// Cargo.lock v3/v4: [[package]] tables of name, version, source, checksum, dependencies. A dependency names a package
// as "name", "name version" or "name version (source)" when the bare name is ambiguous.
function parseLock(text) {
  const pkgs = [];
  let cur = null, inDeps = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '[[package]]') { cur = { deps: [] }; pkgs.push(cur); inDeps = false; continue; }
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

function closure(pkgs, rootName) {
  const byName = new Map();
  for (const p of pkgs) { if (!byName.has(p.name)) byName.set(p.name, []); byName.get(p.name).push(p); }
  const resolve = (ref) => {
    const [name, version] = ref.split(' ');
    const cands = byName.get(name) || [];
    const hit = version ? cands.find((p) => p.version === version) : (cands.length === 1 ? cands[0] : null);
    if (!hit) throw new Error(`Cargo.lock: cannot resolve dependency "${ref}"`);
    return hit;
  };
  const root = (byName.get(rootName) || [])[0];
  if (!root) throw new Error(`Cargo.lock has no package ${rootName}`);
  const seen = new Set([root]);
  const todo = [root];
  while (todo.length) for (const ref of todo.pop().deps) { const p = resolve(ref); if (!seen.has(p)) { seen.add(p); todo.push(p); } }
  seen.delete(root);
  return { root, deps: [...seen] };
}

function tmuxPins(text) {
  const get = (name) => { const m = text.match(new RegExp(`^${name}="([^"]+)"`, 'm')); return m ? m[1] : null; };
  const pins = [
    { name: 'tmux', version: get('TMUX_VERSION'), sha: get('TMUX_SHA') },
    { name: 'libevent', version: get('LIBEVENT_VERSION'), sha: get('LIBEVENT_SHA') },
    { name: 'ncurses', version: get('NCURSES_VERSION'), sha: get('NCURSES_SHA') },
  ];
  for (const p of pins) if (!p.version) throw new Error(`build-tmux-from-source.sh: no ${p.name} version`);
  return pins;
}

function build(manifest, { repo, relay, show = gitShow }) {
  for (const k of ['version', 'app', 'node', 'connector']) if (!manifest[k]) throw new Error(`manifest has no ${k}`);
  const appCommit = manifest.app.commit, relayCommit = manifest.connector.commit;
  if (!appCommit || !relayCommit) throw new Error('manifest names no app or connector commit');
  const { root, deps } = closure(parseLock(show(relay, relayCommit, 'Cargo.lock')), CONNECTOR_CRATE);
  const hash = (sha) => (sha && /^[0-9a-f]{64}$/.test(sha) ? [{ alg: 'SHA-256', content: sha }] : undefined);
  const node = manifest.node.version.replace(/^v/, '');
  const components = [
    { type: 'framework', 'bom-ref': 'node', name: 'node', version: node, purl: `pkg:generic/nodejs/node@${node}`,
      hashes: hash(manifest.node.download_sha256), description: 'Node.js runtime (official darwin-arm64 tarball)' },
    ...tmuxPins(show(repo, appCommit, 'tools/build-tmux-from-source.sh')).map((p) => ({
      type: 'application', 'bom-ref': p.name, name: p.name, version: p.version, purl: `pkg:generic/${p.name}@${p.version}`,
      hashes: hash(p.sha), description: `${p.name} source tarball, built from source by the release` })),
    { type: 'application', 'bom-ref': 'connector', name: CONNECTOR_CRATE, version: root.version,
      hashes: hash(manifest.connector.signed_sha256), description: `the Plus connector, kosmos-relay ${relayCommit}` },
    ...deps.filter((p) => !p.source).sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({
      type: 'library', 'bom-ref': `first-party:${p.name}`, name: p.name, version: p.version,
      description: `kosmos-relay workspace crate, ${relayCommit}` })),
    ...deps.filter((p) => p.source && p.source.startsWith('registry+'))
      .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
      .map((p) => ({ type: 'library', 'bom-ref': `crate:${p.name}@${p.version}`, name: p.name, version: p.version,
        purl: `pkg:cargo/${p.name}@${p.version}`, hashes: hash(p.checksum) })),
  ];
  return {
    bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    serialNumber: `urn:uuid:${uuidFrom(manifest.sha256 || appCommit)}`,
    metadata: {
      timestamp: (manifest.built && manifest.built.at) || undefined,
      component: { type: 'application', 'bom-ref': 'kosmos', name: 'kosmos', version: manifest.version,
        hashes: hash(manifest.sha256), description: `Kosmos ${manifest.version} (${manifest.arch || 'arm64'}), app ${appCommit}` },
    },
    components,
    dependencies: [{ ref: 'kosmos', dependsOn: components.filter((c) => c.type !== 'library').map((c) => c['bom-ref']) },
      { ref: 'connector', dependsOn: components.filter((c) => c.type === 'library').map((c) => c['bom-ref']) }],
  };
}

// The same release always gets the same serial number, so a rebuilt SBOM is byte-identical.
function uuidFrom(seed) {
  const h = require('crypto').createHash('sha256').update(String(seed)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

module.exports = { parseLock, closure, tmuxPins, build };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const file = args[0], repo = opt('--repo'), relay = opt('--relay'), out = opt('--out');
  if (!file || !repo || !relay) { console.error('usage: sbom.js <manifest.json> --repo <kosmos> --relay <kosmos-relay> [--out <file>]'); process.exit(2); }
  try {
    const text = JSON.stringify(build(JSON.parse(fs.readFileSync(file, 'utf8')), { repo, relay }), null, 2) + '\n';
    if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
  } catch (e) { console.error(`sbom: ${e.message}`); process.exit(1); }
}
