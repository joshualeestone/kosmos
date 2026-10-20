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
 * LIMIT: crate checksums are held by Cargo against this machine's cached index (CARGO_HOME), not compared here;
 * and CARGO_HOME's own config can name the rustc or wrapper Cargo runs.
 * LIMIT: the build machine's own ~/.cargo/config and CARGO_* settings, which can redirect a crate, are not visible
 * here (a .cargo/config in the relay itself refuses).
 * LIMIT: the connector's relay commit is the relay build's own record (its sidecar); this does not rebuild the
 * connector to check that the binary came from that commit's Cargo.lock.
 * LIMIT: a library linked statically into tmux with neither a VERSION line nor a licence file is invisible here; so is a
 * static C library brought into the Mac app by a bridging header or a linker flag rather than an import, and the
 * second native binary (Kosmos.app/Contents/MacOS/Kosmos, a re-signed copy of kosmos-app) is accepted by name only.
 * The Swift imports are read for the release's target, and any `#if` in the file refuses.
 * LIMIT: the Mac app's shipped binary is not tied to native-app/main.swift at the app commit: the manifest's
 * native_app hash and its files entry for app/bin/kosmos-app are taken from the same file, so the Apple-only import
 * check vouches for the source, not the binary (the same gap as the connector's commit).
 * LIMIT: a vendored third-party crate made a member of the relay workspace passes as first-party.
 * Out of scope, and not listed: what Kosmos downloads later, each pinned by its own hash in engine/: the provider
 * tools (Claude Code, Codex, Gemini CLI, Grok and so on) when a person connects one, and the agent browser (Playwright
 * MCP and Chrome headless shell) the first time an agent uses it.
 * LIMIT: the release tarball itself is not read: its hash comes from the manifest. The manifest's file list is
 * exhaustive by construction (the bundle build lists every file of the same stage it packs, and refuses anything
 * that is not a plain file). The shipped runtime/bin/node is not tied to the
 * nodejs.org download hash here (the bundle build verifies it against nodejs.org's SHASUMS256 before packing).
 * LIMIT: the crate list is the lockfile closure, a superset of what the macOS connector compiles. Measured for 0.7.59:
 * 229 crates (the connector and kosmos-relay-proto included) against cargo tree's 190 across the universal binary's two
 * targets (189 for aarch64; x86_64 adds curve25519-dalek-derive; review 39); the extra are Windows-only and dev-only crates (26) and optional dependencies
 * of features the connector does not turn on (14). It never misses a crate the connector builds with. A scan of this
 * SBOM must treat an advisory on one of the extra crates as not shipped until it checks the macOS build graph of BOTH targets.
 */
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CONNECTOR_CRATE = 'kosmos-tunnel-client';
const CRATES_IO = new Set(['registry+https://github.com/rust-lang/crates.io-index', 'sparse+https://index.crates.io/']);

// Every git call reads the OBJECTS a commit names and nothing a local setting puts in front of them (review 28: with
// a `git replace` ref in the checkout, git show of a signed commit returned another commit's file): no replace
// objects, and none of this shell's GIT_* settings (another repo, index, object store or alternates).
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/.test(k))), GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' };   // review 30: a partial clone would fetch over the network
const LIMITS = { git: 300000, cargo: 120000, tool: 120000 };   // ms; a stuck tool fails the run instead of holding it

// The mode of a path in a commit ('100644', '120000' for a symlink, '040000' for a folder...), or null when it is not
// there. Only a git answer of "nothing at that path" is null; any other failure throws.
function gitEntry(repo, commit, file) {
  let out;
  try {
    out = execFileSync('git', ['-C', repo, 'ls-tree', '--full-tree', commit, '--', file], { encoding: 'utf8', env: GIT_ENV, timeout: LIMITS.git, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`${repo}: git could not list ${file} at ${commit}: ${String(e.stderr || e.message).split('\n')[0]}`);
  }
  const line = out.split('\n').find((l) => l.endsWith(`\t${file}`));
  return line ? line.split(' ')[0] : null;
}

// Reviews 24 to 27 each beat a hand-written reader of the relay's Cargo files, so CARGO decides: the Cargo.lock is
// trusted only if `cargo metadata --locked --offline` agrees it is the resolution of the Cargo.toml files at that
// commit (the connector is built without --locked, so a [patch], a git or path dependency, or a dependency missing
// from the lock would re-resolve the build while the lock names other crates), and the workspace's members and
// their binaries are the ones Cargo reports, not ones read from the toml text (review 27: a [workspace] inside a
// TOML string fooled the hand-written reader).
// The tree Cargo reads is written HERE, blob by blob from git cat-file (review 26: no filter or attribute of the
// checkout can change a byte), and BEFORE anything is written every path is checked (review 27, which wrote a file
// outside the tree through a symlink and a name a Mac folds to the same one, and ran a program through a committed
// .cargo/config.toml): plain files only (no symlink, no submodule), printable ASCII names only (so case is the
// only folding, and it is checked across the whole commit), no .cargo anywhere, no Cargo.toml or Cargo.lock in
// another case, no file written twice.
function cargoWorkspace(relay, commit) {
  const os = require('os'), p = require('path');
  const git = (args, input) => {
    try {
      return execFileSync('git', ['-C', relay, ...args], { input, env: GIT_ENV, timeout: LIMITS.git, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      throw new Error(`${relay}: git ${args[0]} failed at ${commit}: ${String(e.stderr || e.message).split('\n')[0]}`);
    }
  };
  const entries = git(['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8').split('\0').filter(Boolean).map((l) => {
    const [meta, file] = [l.slice(0, l.indexOf('\t')), l.slice(l.indexOf('\t') + 1)];
    const [mode, type, sha] = meta.split(' ');
    return { mode, type, sha, file };
  });
  if (!entries.length) throw new Error(`${relay}: the tree of ${commit} is empty`);
  const refuse = (why) => { throw new Error(`relay at ${commit}: ${why}; this SBOM cannot vouch for what Cargo reads`); };
  const folded = new Map();
  for (const { mode, type, file } of entries) {
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) refuse(`${file} is not a plain file (mode ${mode})`);
    if (!/^[ -~]+$/.test(file)) refuse(`${JSON.stringify(file)} is not a plain ASCII path`);
    const parts = file.split('/');
    for (let k = 0; k < parts.length; k++) {
      const seg = parts[k], low = seg.toLowerCase();
      if (seg === '' || seg === '.' || seg === '..') refuse(`${file} has an empty, . or .. part`);
      if (low === '.cargo') refuse(`${file} is Cargo configuration, which can change what the connector builds`);
      // Review 28: rustup reads a toolchain file in the tree Cargo runs in and DOWNLOADS and runs that toolchain.
      if (low === 'rust-toolchain' || low === 'rust-toolchain.toml') refuse(`${file} names a Rust toolchain, which rustup would fetch and run here`);
      if (low === '.git') refuse(`${file} is inside a .git folder`);
      if ((low === 'cargo.toml' && seg !== 'Cargo.toml') || (low === 'cargo.lock' && seg !== 'Cargo.lock')) refuse(`${file} is a Cargo file in another case`);
      const real = parts.slice(0, k + 1).join('/'), key = real.toLowerCase();
      const seen = folded.get(key);
      if (seen !== undefined && seen !== real) refuse(`${seen} and ${real} are one path on a case-insensitive disk`);
      folded.set(key, real);
    }
  }
  const dir = fs.mkdtempSync(p.join(os.tmpdir(), 'kosmos-sbom-cargo-'));
  try {
    const tree = p.join(dir, 'tree');
    const out = git(['cat-file', '--batch'], entries.map((e) => e.sha).join('\n') + '\n');
    let at = 0;
    for (const e of entries) {
      const nl = out.indexOf(10, at);
      const [sha, type, size] = out.slice(at, nl).toString('utf8').split(' ');
      if (sha !== e.sha || type !== 'blob' || !/^[0-9]+$/.test(size || '')) refuse(`git cat-file answered "${out.slice(at, nl)}" for ${e.file}`);
      const end = nl + 1 + Number(size);
      if (out[end] !== 10) refuse(`git cat-file's answer for ${e.file} does not end where its size says`);
      fs.mkdirSync(p.dirname(p.join(tree, e.file)), { recursive: true });
      fs.writeFileSync(p.join(tree, e.file), out.subarray(nl + 1, end), { flag: 'wx', mode: e.mode === '100755' ? 0o755 : 0o644 });
      at = end + 1;
    }
    if (at !== out.length) refuse('git cat-file answered more than was asked');
    // Cargo with the build's own cache (CARGO_HOME) and nothing else of this shell's Cargo, Rust or git settings (a
    // RUSTC or RUSTC_WRAPPER names a program Cargo runs; Cargo runs git too), and rustup told not to install anything.
    // Review 35: an ALLOWLIST, not a denylist (a __CARGO_* variable the denylist missed let a stable Cargo accept a
    // commit's unstable features). Only what Cargo needs to find itself and its cache.
    const env = { ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'CARGO_HOME', 'RUSTUP_HOME']
      .filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), RUSTUP_AUTO_INSTALL: '0' };
    let meta;
    try {
      meta = execFileSync('cargo', ['metadata', '--locked', '--offline', '--format-version', '1', '--manifest-path', p.join(tree, 'Cargo.toml')],
        // cwd is / (review 33): Cargo and rustup read config and toolchain files in every folder above their working
        // folder, and one above the temp folder could name the rustc Cargo runs. The manifest path is absolute.
        { cwd: '/', env, timeout: LIMITS.cargo, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const why = String(e.stderr || e.message).split('\n').find((l) => /error/.test(l)) || String(e.message).split('\n')[0];
      // Review 30: offline, a crate missing from THIS machine's Cargo cache reads like a disagreement; say which.
      // Review 37: when Cargo says a crate could not be fetched offline, that is the likely cause, so it is said first.
      if (/no matching package|failed to download|not downloaded/i.test(String(e.stderr || ''))) {
        throw new Error(`relay at ${commit}: crates are missing from CARGO_HOME (Cargo runs offline): ${why.trim()}. Run \`cargo fetch --locked\` in the relay at this commit, then again; if that does not help, the Cargo.lock and the Cargo.toml files may disagree`);
      }
      throw new Error(`relay at ${commit}: Cargo does not agree the Cargo.lock is what the Cargo.toml files resolve to (cargo is needed): ${why.trim()}`);
    }
    let m;
    try { m = JSON.parse(meta.toString('utf8')); } catch (e) { refuse(`cargo metadata did not answer JSON (${e.message})`); }
    const ids = new Set(m.workspace_members || []);
    const members = new Map();
    for (const pkg of m.packages || []) {
      if (!ids.has(pkg.id)) continue;
      if (members.has(pkg.name)) refuse(`two workspace members are named ${pkg.name}`);
      members.set(pkg.name, { version: pkg.version, bins: (pkg.targets || []).filter((t) => (t.kind || []).includes('bin')).map((t) => t.name) });
    }
    if (members.size !== ids.size || !members.size) refuse(`cargo metadata named ${ids.size} workspace members and described ${members.size}`);
    // And Cargo's resolve graph, every package with its dependencies, for the lock reader to be held against.
    const byId = new Map((m.packages || []).map((pkg) => [pkg.id, pkg]));
    if (!m.resolve || !Array.isArray(m.resolve.nodes)) refuse('cargo metadata gave no resolve graph');
    const packages = m.resolve.nodes.map((node) => {
      const pkg = byId.get(node.id);
      if (!pkg) refuse(`cargo metadata resolved ${node.id}, which it does not describe`);
      return { name: pkg.name, version: pkg.version, source: pkg.source || '', deps: (node.dependencies || []).map((id) => {
        const d = byId.get(id);
        if (!d) refuse(`cargo metadata resolved a dependency ${id} it does not describe`);
        return pkgKey(d);
      }) };
    });
    return { members, packages };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A file's text at a commit, only when it is a plain file there: git show of a symlink returns its target PATH as
// text, which every check below would then read as the file (review 23: a symlinked main.swift passed as importing
// nothing).
function gitShow(repo, commit, file) {
  const mode = gitEntry(repo, commit, file);
  if (mode === null) {
    const err = new Error(`${repo} has no ${file} at ${commit} (fetch it, or pass the right checkout)`);
    err.notFound = true;
    throw err;
  }
  if (mode !== '100644' && mode !== '100755') throw new Error(`${repo} ${file} at ${commit} is not a plain file (mode ${mode}); this SBOM reads plain files only`);
  return execFileSync('git', ['-C', repo, 'show', `${commit}:${file}`], { encoding: 'utf8', env: GIT_ENV, timeout: LIMITS.git, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Cargo.lock v3/v4: [[package]] tables of name, version, source, checksum, dependencies. A dependency names a package
// as "name", "name version" or "name version (source)" when the name alone is ambiguous. Any other table
// ([[patch.unused]], [metadata]) ends the current package, so its keys can never overwrite one.
const LOCK_KEYS = new Set(['name', 'version', 'source', 'checksum', 'dependencies']);
function parseLock(text) {
  const v = text.match(/^version = (\d+)$/m);
  if (!v || !['3', '4'].includes(v[1])) throw new Error(`Cargo.lock: format version ${v ? v[1] : '(none)'}; only 3 and 4 are read (an older lock keeps checksums elsewhere)`);
  const pkgs = [];
  let cur = null, inDeps = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '[[package]]') { cur = { deps: [] }; pkgs.push(cur); inDeps = false; continue; }
    // Review 31: only the two table headers Cargo writes in a v3/v4 lock, exactly. A header with a trailing comment
    // hid a real package from this reader while Cargo read it, and a [metadata] string held a fake one.
    if (line === '[[patch.unused]]' && !inDeps) { cur = { deps: [] }; inDeps = false; continue; }   // read, never listed
    if (line.startsWith('[') && !inDeps) throw new Error(`Cargo.lock: a table this SBOM does not read: ${line}`);
    if (!cur) {
      if (line && !line.startsWith('#') && !/^version = \d+$/.test(line)) throw new Error(`Cargo.lock: a top-level line this SBOM cannot read: ${line}`);
      continue;
    }
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
    // The keys Cargo writes for a crate that builds as itself. Any other (`replace`, which points the build at a
    // different crate) would make this list a crate that does not ship, so it refuses.
    if (!LOCK_KEYS.has(kv[1])) throw new Error(`Cargo.lock: ${cur.name || 'a package'} has ${kv[1]}, a key this SBOM does not read`);
    // A plain double-quoted value only: a literal string or a trailing comment would otherwise drop the value.
    const str = kv[2].match(/^"([^"\\]*)"$/);
    if (!str) throw new Error(`Cargo.lock: ${cur.name || 'a package'} ${kv[1]} is not a plain quoted value: ${kv[2]}`);
    cur[kv[1]] = str[1];
  }
  for (const p of pkgs) if (!p.name || !p.version) throw new Error(`Cargo.lock: a package with no ${p.name ? 'version' : 'name'}`);
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

// Review 31: the lockfile as read here must be, package for package and edge for edge, the resolve graph Cargo
// itself reports for that commit (cargo --locked compares the lock's MEANING, so a lock Cargo accepts can still read
// differently to a line reader). Keys are name@version#source, the source empty for a workspace crate.
const pkgKey = (p) => `${p.name}@${p.version}#${p.source || ''}`;
function lockMatchesCargo(pkgs, cargoPkgs) {
  const resolve = resolver(pkgs);
  const ours = new Map(pkgs.map((p) => [pkgKey(p), [...new Set(p.deps.map((d) => pkgKey(resolve(d))))].sort(byCodePoint)]));
  const theirs = new Map(cargoPkgs.map((p) => [pkgKey(p), [...new Set(p.deps)].sort(byCodePoint)]));
  const only = (a, b) => [...a.keys()].filter((k) => !b.has(k)).sort(byCodePoint);
  const extra = only(ours, theirs), missing = only(theirs, ours);
  if (extra.length || missing.length) {
    throw new Error(`Cargo.lock as read here is not what Cargo resolves: read but not Cargo's ${JSON.stringify(extra.slice(0, 3))}, Cargo's but not read ${JSON.stringify(missing.slice(0, 3))}`);
  }
  for (const [k, deps] of ours) {
    if (deps.join(' ') !== theirs.get(k).join(' ')) throw new Error(`Cargo.lock as read here gives ${k} other dependencies than Cargo does`);
  }
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
function readTmuxBundle(file, expectSha) {
  const bytes = fs.readFileSync(file);   // read once: the listing and the VERSION read are of the bytes hashed
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  // Review 33: given the signed hash, a bundle that is not the release's refuses BEFORE tar reads any of it.
  if (expectSha !== undefined && sha !== expectSha) throw new Error(`the tmux bundle (${sha.slice(0, 12)}) is not the one this release signed (${String(expectSha).slice(0, 12)})`);
  const tar = (args) => execFileSync('/usr/bin/tar', args, { input: bytes, encoding: 'utf8', timeout: LIMITS.tool, maxBuffer: 64 << 20 });
  const list = tar(['-tzf', '-']).split('\n').filter(Boolean);
  // tar escapes an odd byte in a listed name (bsdtar writes a newline as \n), so a backslash is refused as well as a
  // raw control character: either way the listed name is not the stored one.
  if (list.some((n) => /[\x00-\x1f\x7f\\]/.test(n))) throw new Error('tmux bundle: an entry name holds a control character or an escape');
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
    const found = parsed.filesOf[name].every((f) => execFileSync('/usr/bin/tar', ['-xzOf', '-', f], { input: bytes, timeout: LIMITS.tool, maxBuffer: 64 << 20 }).includes(Buffer.from(version)));
    if (!found) throw new Error(`tmux bundle: VERSION says ${name} ${version}, but a file of it does not carry that version`);
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
// CPE 2.3 escapes any character other than letters, digits, '.', '_' and '-' with a backslash (review 25: a '+').
const cpe = (name, version) => (CPE[name] ? `cpe:2.3:a:${CPE[name]}:${version.replace(/-stable$/, '').replace(/[^A-Za-z0-9._-]/g, '\\$&')}:*:*:*:*:*:*:*` : undefined);
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
    // Review 39: an entry is exactly a path and a sha256; a key a future manifest adds would otherwise go unread.
    if (!f || typeof f !== 'object' || Object.keys(f).sort().join(',') !== 'path,sha256' || !SHA256.test(f.sha256 || '')) {
      throw new Error(`manifest file entry ${JSON.stringify(f)} is not exactly a path and a sha256`);
    }
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
  'SwiftUI', 'Combine', 'IOKit', 'SystemConfiguration', 'UniformTypeIdentifiers', 'QuartzCore', 'CoreAudio', 'Dispatch']);
// The modules a Swift file imports, as the Swift compiler reads them (-emit-imported-modules). Reviews 15 to 17 each
// found a way for a hand-written reading of Swift to miss an import (an access level, a lost quote in a raw string, a
// comment before the import); the compiler is the one reader that cannot disagree with the compiler.
// target: the release's own (-target arm64-apple-macos<floor>, as the bundle build compiles it), so `#if arch(...)`
// and `#if os(...)` read as they do in the build, not as they do on the machine running this.
function swiftcImports(swift, target) {
  if (!/^arm64-apple-macos[0-9]+(\.[0-9]+)*$/.test(target || '')) throw new Error(`no Swift target to read the imports for (${target})`);
  const dir = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'kosmos-sbom-swift-'));
  try {
    const src = require('path').join(dir, 'main.swift'), out = require('path').join(dir, 'imports');
    fs.writeFileSync(src, swift);
    try {
      execFileSync('xcrun', ['swiftc', '-frontend', '-emit-imported-modules', '-target', target, src, '-o', out], { timeout: LIMITS.tool, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      throw new Error(`the Swift compiler could not read native-app/main.swift (xcrun swiftc is needed): ${String(e.stderr || e.message).split('\n')[0]}`);
    }
    return fs.readFileSync(out, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function checkNativeApp(manifest, swift, target, readImports = swiftcImports) {
  const shipped = manifest.files.find((f) => f.path === 'app/bin/kosmos-app');
  if (!manifest.native_app || !SHA256.test(manifest.native_app.signed_sha256 || '') || !shipped || shipped.sha256 !== manifest.native_app.signed_sha256) {
    throw new Error('the manifest\'s app/bin/kosmos-app is not the Mac app it signed (native_app.signed_sha256)');
  }
  // Any #if refuses (review 20): several conditions (canImport, swift, compiler, hasFeature, hasAttribute...) follow
  // the machine running this rather than the build, a list of them keeps missing one, and the real file has none.
  // Anywhere, not only at a line start: Swift accepts a directive after a comment or code on the same line.
  const cond = swift.match(/#\s*(if|elseif)\b[^\n]*/);
  if (cond) throw new Error(`native-app/main.swift has a conditional (${cond[0].trim()}), which this SBOM cannot read for the build machine`);
  for (const mod of readImports(swift, target)) {
    if (!APPLE_MODULES.has(mod)) throw new Error(`native-app/main.swift imports ${mod}, which is not an Apple framework this SBOM knows`);
  }
}

const MANIFEST_KEYS = new Set(['manifest', 'version', 'arch', 'artifact', 'sha256', 'app', 'node', 'connector', 'native_app', 'built',
  'pinned_keys', 'setup_sha256', 'tmux_sha256', 'files']);
const MANIFEST_PART_KEYS = { app: new Set(['commit', 'dirty']), node: new Set(['version', 'download_sha256']),
  connector: new Set(['signed_sha256', 'input_sha256', 'commit']), native_app: new Set(['signed_sha256']),
  built: new Set(['at', 'host', 'macos']) };
const SEMVER = /^\d+\.\d+\.\d+$/;
// The format of this SBOM's output; part of the serial number, so a changed generator never reuses a document id.
const FORMAT = 'kosmos-sbom-1';
// And this file's own bytes, so a change to the generator changes the id even if FORMAT was not bumped.
const SELF_SHA = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex').slice(0, 16);

function build(manifest, { repo, relay, tmux, show = gitShow, workspace = cargoWorkspace, readImports = swiftcImports }) {
  if (manifest.manifest !== 1) throw new Error(`manifest format ${manifest.manifest}: this SBOM reads format 1`);
  for (const k of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(k)) throw new Error(`manifest has ${k}, a part this SBOM does not know (it would be left out)`);
  }
  for (const k of ['version', 'app', 'node', 'connector']) if (!manifest[k]) throw new Error(`manifest has no ${k}`);
  for (const [part, keys] of Object.entries(MANIFEST_PART_KEYS)) {
    const v = manifest[part];
    if (v === undefined) continue;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`manifest ${part} is not an object`);
    for (const k of Object.keys(v)) if (!keys.has(k)) throw new Error(`manifest ${part}.${k} is a part this SBOM does not know (it would be left out)`);
  }
  if (!manifest.node.version) throw new Error('manifest has no node version');
  if (!SEMVER.test(manifest.version)) throw new Error(`manifest version ${manifest.version} is not a release version`);
  if (!SEMVER.test(manifest.node.version.replace(/^v/, ''))) throw new Error(`manifest node version ${manifest.node.version} is not a version`);
  const appCommit = manifest.app.commit, relayCommit = manifest.connector.commit;
  if (!appCommit || !relayCommit) throw new Error('manifest names no app or connector commit');
  if (!/^[0-9a-f]{40}$/.test(appCommit) || !/^[0-9a-f]{40}$/.test(relayCommit)) throw new Error('manifest app and connector commits must be full shas');
  if (manifest.app.dirty !== false) throw new Error('manifest does not say the app was built from a clean tree: its commit may not be what shipped');
  if (manifest.arch !== 'arm64') throw new Error(`manifest arch ${manifest.arch}: this SBOM knows the arm64 Mac release only`);
  if (!tmux || !manifest.tmux_sha256) throw new Error('a tmux bundle and the manifest\'s tmux_sha256 are both required');
  for (const [what, v] of [['sha256', manifest.sha256], ['setup_sha256', manifest.setup_sha256], ['node.download_sha256', manifest.node.download_sha256],
    ['connector.signed_sha256', manifest.connector.signed_sha256], ['tmux_sha256', manifest.tmux_sha256]]) {
    if (!SHA256.test(v || '')) throw new Error(`manifest ${what} is not a sha256 (${v}): the SBOM cannot vouch for that input`);
  }
  if (tmux.sha !== manifest.tmux_sha256) throw new Error(`the tmux bundle (${tmux.sha.slice(0, 12)}) is not the one this release signed (${manifest.tmux_sha256.slice(0, 12)})`);
  checkFirstParty(manifest, show(repo, appCommit, 'package.json'));
  // Review 39: the installer is called first-party, so it is tied to its source the way package.json is.
  const setupSha = crypto.createHash('sha256').update(show(repo, appCommit, 'install/setup.sh'), 'utf8').digest('hex');
  if (setupSha !== manifest.setup_sha256) throw new Error(`install/setup.sh at the app commit (${setupSha.slice(0, 12)}) is not the installer this release signed (${manifest.setup_sha256.slice(0, 12)})`);
  const arch = manifest.arch;
  const { root, deps, edges } = closure(parseLock(show(relay, relayCommit, 'Cargo.lock')), CONNECTOR_CRATE);
  const ws = workspace(relay, relayCommit);
  const members = ws.members;
  lockMatchesCargo(parseLock(show(relay, relayCommit, 'Cargo.lock')), ws.packages);
  // A crate with no source is first-party only when it IS the member, at the member's version (a path dependency
  // outside the workspace can share a member's name). Two sourceless packages of one name and version cannot reach
  // here: the closure's resolver already refuses that as ambiguous.
  for (const p of [root, ...deps]) {
    if (p.source) continue;
    const mem = members.get(p.name);
    if (!mem || mem.version !== p.version) {
      throw new Error(`Cargo.lock: ${p.name} ${p.version} has no source and is not the relay workspace member of that name${mem ? ` (${mem.version})` : ''}`);
    }
  }
  // The shipped app/bin/kosmos-tunnel must be that crate's binary, or its closure is not the connector's.
  if (!((members.get(CONNECTOR_CRATE) || {}).bins || []).includes('kosmos-tunnel')) throw new Error(`relay: ${CONNECTOR_CRATE} does not build the kosmos-tunnel binary`);
  const floor = show(repo, appCommit, 'tools/macos-floor').trim();
  if (!/^[0-9]+(\.[0-9]+)*$/.test(floor)) throw new Error(`tools/macos-floor at the app commit is not a macOS version (${floor})`);
  checkNativeApp(manifest, show(repo, appCommit, 'native-app/main.swift'), `arm64-apple-macos${floor}`, readImports);
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
    { type: 'file', 'bom-ref': 'tmux-bundle', name: `tmux-${arch}.tar.gz`,
      hashes: hashOf(manifest.tmux_sha256), description: 'the tmux bundle the release ships (tmux and the libraries it links, listed as its parts)' },
    tmuxPart('tmux'), ...libs.map(tmuxPart),
    { type: 'file', 'bom-ref': 'setup', name: 'setup', hashes: hashOf(manifest.setup_sha256),
      description: 'the installer script the release serves (first-party: install/setup.sh at the app commit, which hashes to the signed setup_sha256)' },
    { type: 'application', 'bom-ref': 'connector', name: CONNECTOR_CRATE, version: root.version,
      hashes: hashOf(manifest.connector.signed_sha256), description: `the Plus connector, kosmos-relay ${relayCommit}` },
    ...crates.map((p) => crateComponent(p, relayCommit, crateRef, members)),
  ];
  return {
    bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    // Review 37: from the WHOLE signed manifest, not only the tarball's hash: the installer and the tmux bundle are
    // separate downloads, so a manifest differing only there must give a different serial.
    serialNumber: `urn:uuid:${uuidFrom(`${FORMAT}:${SELF_SHA}:${crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`)}`,
    metadata: {
      timestamp: builtAt(manifest),
      tools: { components: [{ type: 'application', name: 'kosmos tools/lib/sbom.js', version: FORMAT }] },
      // Said in the SBOM itself, not only here, so a scanner reading the JSON is told.
      properties: [
        // Review 38: the other two limits, said in the JSON too, so a scanner is not left believing both are vouched.
        { name: 'kosmos:connector-binary', value: 'the connector binary is listed by its signed hash; it is not rebuilt from the Cargo.lock here, so the crate list is what that lock resolves, not a reproduction of the binary' },
        { name: 'kosmos:node-binary', value: 'runtime/bin/node is listed by the version and nodejs.org download the build names; the shipped binary is not compared with that download here' },
        { name: 'kosmos:cargo-closure', value: 'the connector crates are its Cargo.lock closure, a superset of the macOS build. The connector is a universal binary (aarch64-apple-darwin and x86_64-apple-darwin joined with lipo), so an advisory on a crate is not shipped only when `cargo tree --locked -p kosmos-tunnel-client -e normal,build` lists it for NEITHER target, run at the relay commit' }],
      component: { type: 'application', 'bom-ref': 'kosmos', name: 'kosmos', version: manifest.version,
        hashes: hashOf(manifest.sha256), description: `Kosmos ${manifest.version} (${arch}), app ${appCommit}` },
    },
    components,
    dependencies: [
      { ref: 'kosmos', dependsOn: ['connector', 'node', 'setup', 'tmux-bundle'] },
      { ref: 'setup', dependsOn: [] },
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

module.exports = { SELF_SHA, gitShow, gitEntry, cargoWorkspace, lockMatchesCargo, tmuxCpeFor: cpe, parseLock, closure, tmuxPins, parseTmuxVersion, readTmuxBundle, readSignedManifest, swiftcImports, build };

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
    if (out) fs.rmSync(out, { force: true });
    const manifest = readSignedManifest(file, sig);
    const text = JSON.stringify(build(manifest, { repo, relay, tmux: readTmuxBundle(tmuxFile, manifest.tmux_sha256) }), null, 2) + '\n';
    // Written beside the target and renamed into place, so a failed run never leaves an older SBOM under that name.
    // The partial file is removed and then created exclusively (review 31: a link planted at that name was followed,
    // and the SBOM written over the file it pointed at).
    if (out) { fs.rmSync(`${out}.partial`, { force: true }); fs.writeFileSync(`${out}.partial`, text, { flag: 'wx' }); fs.renameSync(`${out}.partial`, out); } else process.stdout.write(text);
  } catch (e) { console.error(`sbom: ${e.message}`); process.exit(1); }
}
