'use strict';
/**
 * #5713: `whats-new-pool.js build` first brings the pool up to what Mac PROD has shown, read from the site itself (the
 * prod pointer names the version and its manifest; the manifest names the app commit the build was cut from), so no
 * one has to run `shown` by hand after a promote. Prod is a local file:// pointer and manifest here, and the history is
 * a small git repo made for the test (no network). One test reads this repo's real 0.7.35 cut (ad8039770), as #5711's
 * real-history test does: it needs full history (CI checks out with fetch-depth 0).
 *
 *   node --test tools.whats-new-pool-sync-5713.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const tool = require('./tools/whats-new-pool');

const item = (title, rank, status, extra = {}) => Object.assign({ title, line: `What ${title} does, in one sentence.`, icon: 'tasks', rank, since: '0.7.31', status }, extra);
const quiet = (fn) => { const w = process.stdout.write, e = process.stderr.write; let said = ''; process.stdout.write = (x) => { said += x; return true; }; process.stderr.write = (x) => { said += x; return true; }; try { return { code: fn(), said }; } finally { process.stdout.write = w; process.stderr.write = e; } };

/* A git repo whose history has web/whats-new.json for 0.7.35 at one commit, then a later reword on "main". */
function history() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wnpool-sync-repo-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, 'web'));
  const write = (obj) => fs.writeFileSync(path.join(dir, 'web', 'whats-new.json'), JSON.stringify(obj));
  write({ version: '0.7.35', highlights: [{ icon: 'tasks', title: 'A', line: 'What A does, in one sentence.' }, { icon: 'tasks', title: 'B', line: 'What B does, in one sentence.' }] });
  git('add', '.'); git('commit', '-q', '-m', 'cut 0.7.35');
  const cut = git('rev-parse', 'HEAD');
  // After the freeze, main rewords 0.7.35's file: prod did not show this.
  write({ version: '0.7.35', highlights: [{ icon: 'tasks', title: 'A', line: 'x' }, { icon: 'tasks', title: 'C', line: 'x' }] });
  git('add', '.'); git('commit', '-q', '-m', 'reword after the freeze');
  return { dir, cut };
}
/* A prod pointer and manifest as files, as installkosmos.com serves them. */
function prod(version, commit, { manifest = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wnpool-sync-prod-'));
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ version, sha256: 'x', artifact: `kosmos-${version}-arm64.tar.gz`, manifest: `kosmos-${version}-arm64.manifest.json` }));
  if (manifest) fs.writeFileSync(path.join(dir, `kosmos-${version}-arm64.manifest.json`), JSON.stringify({ manifest: 1, version, app: { commit, dirty: false } }));
  return { dir, env: { KOSMOS_PROD_POINTER_URL: 'file://' + path.join(dir, 'latest.json') } };
}
function poolFile(pool) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wnpool-sync-pool-'));
  const file = path.join(dir, 'pool.json');
  fs.writeFileSync(file, JSON.stringify(pool));
  return { dir, file };
}
const cleanup = (...dirs) => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); };

test('#5713: prod newer than the pool records: what it showed AT ITS OWN COMMIT is marked shown, and lastProd moves', () => {
  const h = history();
  const p = prod('0.7.35', h.cut);
  const pf = poolFile({ lastProd: '0.7.34', items: [item('A', 1, 'pending'), item('B', 2, 'pending'), item('C', 3, 'pending')] });
  try {
    const pool = tool.readPool(pf.file);
    const r = tool.syncWithProd(pool, pf.file, p.env, h.dir);
    assert.equal(r.ok, true, r.because);
    const after = JSON.parse(fs.readFileSync(pf.file, 'utf8'));
    assert.equal(after.lastProd, '0.7.35');
    assert.deepEqual(after.items.map((i) => [i.title, i.status]), [['A', 'shown'], ['B', 'shown'], ['C', 'pending']],
      'C was reworded in AFTER the freeze, so prod never showed it: it must stay pending');
    // Again: nothing more to do, nothing changed.
    const again = tool.syncWithProd(tool.readPool(pf.file), pf.file, p.env, h.dir);
    assert.equal(again.ok, true);
    assert.match(again.note, /already records prod 0\.7\.35/);
  } finally { cleanup(h.dir, p.dir, pf.dir); }
});

test('#5713: CONTROL, prod no newer than the pool records: nothing is marked and the file is untouched', () => {
  const h = history();
  const p = prod('0.7.35', h.cut);
  const pf = poolFile({ lastProd: '0.7.35', items: [item('A', 1, 'pending')] });
  try {
    const before = fs.readFileSync(pf.file, 'utf8');
    const r = tool.syncWithProd(tool.readPool(pf.file), pf.file, p.env, h.dir);
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(pf.file, 'utf8'), before);
  } finally { cleanup(h.dir, p.dir, pf.dir); }
});

test('#5713: it refuses, writing nothing, when prod cannot be read, names no commit, or showed a title the pool lacks', () => {
  const h = history();
  const pf = poolFile({ lastProd: '0.7.34', items: [item('A', 1, 'pending')] });   // no B: a title prod showed is missing
  const missing = { KOSMOS_PROD_POINTER_URL: 'file:///nonexistent/latest.json' };
  const noManifest = prod('0.7.35', h.cut, { manifest: false });
  const good = prod('0.7.35', h.cut);
  try {
    const before = fs.readFileSync(pf.file, 'utf8');
    for (const [env, why] of [[missing, /could not read what prod serves/], [noManifest.env, /could not read prod's manifest/], [good.env, /not in the pool/]]) {
      const r = tool.syncWithProd(tool.readPool(pf.file), pf.file, env, h.dir);
      assert.equal(r.ok, false);
      assert.match(r.because, why);
      assert.equal(fs.readFileSync(pf.file, 'utf8'), before, 'a refused sync wrote the pool');
    }
  } finally { cleanup(h.dir, noManifest.dir, good.dir, pf.dir); }
});

test('#5713: build refuses when prod cannot be read, unless --offline, which says so', () => {
  const pf = poolFile({ lastProd: '0.7.35', items: [item('A', 1, 'pending')] });
  const out = path.join(pf.dir, 'whats-new.json');
  const saved = process.env.KOSMOS_PROD_POINTER_URL;
  process.env.KOSMOS_PROD_POINTER_URL = 'file:///nonexistent/latest.json';
  try {
    const refused = quiet(() => tool.main(['build', '0.7.36', `--pool=${pf.file}`, `--out=${out}`]));
    assert.equal(refused.code, 3);
    assert.match(refused.said, /could not read what prod serves.*nothing written/s);
    assert.equal(fs.existsSync(out), false);
    const offline = quiet(() => tool.main(['build', '0.7.36', '--offline', `--pool=${pf.file}`, `--out=${out}`]));
    assert.equal(offline.code, 0, offline.said);
    assert.match(offline.said, /Built --offline: the pool was not checked against what prod serves\./);
  } finally {
    if (saved === undefined) delete process.env.KOSMOS_PROD_POINTER_URL; else process.env.KOSMOS_PROD_POINTER_URL = saved;
    cleanup(pf.dir);
  }
});

test('#5713: the default prod pointer is the Mac prod pointer (never a staging or Windows one)', () => {
  assert.equal(tool.PROD_POINTER_URL, 'https://installkosmos.com/dist/latest.json');
});

test('#5713: the sync keeps #5711 review 9: a Windows-only highlight prod showed stays pending on a Mac promote', () => {
  const h = history();
  const p = prod('0.7.35', h.cut);
  const pf = poolFile({ lastProd: '0.7.34', items: [item('A', 1, 'pending'), item('B', 2, 'pending', { platforms: ['windows'] })] });
  try {
    const r = tool.syncWithProd(tool.readPool(pf.file), pf.file, p.env, h.dir);
    assert.equal(r.ok, true, r.because);
    const after = JSON.parse(fs.readFileSync(pf.file, 'utf8'));
    assert.deepEqual(after.items.map((i) => [i.title, i.status]), [['A', 'shown'], ['B', 'pending']]);
  } finally { cleanup(h.dir, p.dir, pf.dir); }
});

/* main() reads process.env for the prod pointer: set it for one call. */
function withProd(env, fn) {
  const saved = process.env.KOSMOS_PROD_POINTER_URL;
  process.env.KOSMOS_PROD_POINTER_URL = env.KOSMOS_PROD_POINTER_URL;
  try { return fn(); } finally { if (saved === undefined) delete process.env.KOSMOS_PROD_POINTER_URL; else process.env.KOSMOS_PROD_POINTER_URL = saved; }
}

test('#5713 review 1: prod-check (the cut\'s check) is 0 when the pool records prod, 3 when prod is newer, 4 when unreadable, and writes nothing', () => {
  const p = prod('0.7.35', 'a'.repeat(40));
  const recorded = poolFile({ lastProd: '0.7.35', items: [item('A', 1, 'pending')] });
  const behind = poolFile({ lastProd: '0.7.34', items: [item('A', 1, 'pending')] });
  try {
    const b0 = fs.readFileSync(behind.file, 'utf8');
    assert.equal(withProd(p.env, () => quiet(() => tool.main(['prod-check', `--pool=${recorded.file}`])).code), 0);
    const stale = withProd(p.env, () => quiet(() => tool.main(['prod-check', `--pool=${behind.file}`])));
    assert.equal(stale.code, 3);
    assert.match(stale.said, /prod serves 0\.7\.35 but the pool records 0\.7\.34/);
    assert.equal(fs.readFileSync(behind.file, 'utf8'), b0, 'prod-check wrote the pool');
    assert.equal(withProd({ KOSMOS_PROD_POINTER_URL: 'file:///nonexistent/latest.json' }, () => quiet(() => tool.main(['prod-check', `--pool=${recorded.file}`])).code), 4);
  } finally { cleanup(p.dir, recorded.dir, behind.dir); }
});

test('#5713 review 1: the sync names the skipped-version step, and a build that synced nothing claims no pool update', () => {
  const h = history();
  const p = prod('0.7.35', h.cut);
  // 0.7.35 is not newer than the prod the sync records, so the build refuses after syncing.
  const pf = poolFile({ lastProd: '0.7.33', items: [item('A', 1, 'pending'), item('B', 2, 'pending'), item('C', 3, 'pending')] });
  const out = path.join(pf.dir, 'whats-new.json');
  try {
    // The sync needs this test's history: run it directly, as build would, then the build sees the recorded prod.
    const r = tool.syncWithProd(tool.readPool(pf.file), pf.file, p.env, h.dir);
    assert.equal(r.ok, true, r.because);
    assert.equal(r.wrote, '0.7.35');
    assert.match(r.note, /If a version between 0\.7\.33 and 0\.7\.35 also reached prod, record it with: node tools\/whats-new-pool\.js shown/);
    // CONTROL: with nothing synced, a refusal carries no commit line.
    const refused = withProd(p.env, () => quiet(() => tool.main(['build', '0.7.35', `--pool=${pf.file}`, `--out=${out}`])));
    assert.equal(refused.code, 3);
    assert.doesNotMatch(refused.said, /already updated/, 'a build that synced nothing claimed it updated the pool');
  } finally { cleanup(h.dir, p.dir, pf.dir); }
});

test('#5713 review 1: through build, against this repo\'s real 0.7.35 cut: the sync writes, a later refusal says to commit the pool', (t) => {
  // As #5711's real-history test: a shallow checkout without that commit skips rather than fails (review 3).
  try { execFileSync('git', ['-C', __dirname, 'cat-file', '-e', 'ad8039770d4b50b9cd6665f421c7d1e2ff7fd07f^{commit}'], { stdio: 'ignore' }); }
  catch { t.skip('0.7.35\'s cut commit is not in this checkout (shallow clone)'); return; }
  // 0.7.35's frozen sha (as #5711's real-history test uses) and its one highlight.
  const p = prod('0.7.35', 'ad8039770d4b50b9cd6665f421c7d1e2ff7fd07f');
  const shownTitle = 'Agent cards show the last community post';
  const pf = poolFile({ lastProd: '0.7.34', items: [item(shownTitle, 1, 'pending'), item('Next thing', 2, 'pending')] });
  const out = path.join(pf.dir, 'whats-new.json');
  try {
    // Building 0.7.35 itself: the sync records prod 0.7.35, then the build refuses (not newer than prod).
    const r = withProd(p.env, () => quiet(() => tool.main(['build', '0.7.35', `--pool=${pf.file}`, `--out=${out}`])));
    assert.equal(r.code, 3, r.said);
    assert.match(r.said, /The pool was already updated to record prod 0\.7\.35: commit release\/whats-new-pool\.json to main\./, r.said);
    const after = JSON.parse(fs.readFileSync(pf.file, 'utf8'));
    assert.equal(after.lastProd, '0.7.35');
    assert.equal(after.items.find((i) => i.title === shownTitle).status, 'shown');
    // And a good build afterwards prints the sync's note and writes the file.
    const ok = withProd(p.env, () => quiet(() => tool.main(['build', '0.7.36', `--pool=${pf.file}`, `--out=${out}`])));
    assert.equal(ok.code, 0, ok.said);
    assert.match(ok.said, /Prod serves 0\.7\.35; the pool already records prod 0\.7\.35\./);
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')).highlights.map((h) => h.title), ['Next thing']);
  } finally { cleanup(p.dir, pf.dir); }
});

test('#5713 review 2: a prod version shipped with no What\'s New is recorded with --none, nothing marked; --none takes no source', () => {
  const pf = poolFile({ lastProd: '0.7.34', items: [item('A', 1, 'pending')] });
  try {
    assert.equal(quiet(() => tool.main(['shown', '0.7.35', '--promoted', '--none', `--pool=${pf.file}`])).code, 0);
    const after = JSON.parse(fs.readFileSync(pf.file, 'utf8'));
    assert.equal(after.lastProd, '0.7.35');
    assert.equal(after.items[0].status, 'pending');
    assert.equal(quiet(() => tool.main(['shown', '0.7.36', '--promoted', '--none', '--from-history', '--ref=abc1234', `--pool=${pf.file}`])).code, 2);
    // CONTROL: without --promoted, --none marks nothing either.
    assert.equal(quiet(() => tool.main(['shown', '0.7.36', '--none', `--pool=${pf.file}`])).code, 2);
    assert.equal(JSON.parse(fs.readFileSync(pf.file, 'utf8')).lastProd, '0.7.35');
  } finally { cleanup(pf.dir); }
});

test('#5713 review 3: prod-check reads only the pointer (a broken manifest cannot turn "prod newer" into a note)', () => {
  const p = prod('0.7.36', 'c'.repeat(40), { manifest: false });
  const pf = poolFile({ lastProd: '0.7.35', items: [item('A', 1, 'pending')] });
  try {
    const r = withProd(p.env, () => quiet(() => tool.main(['prod-check', `--pool=${pf.file}`])));
    assert.equal(r.code, 3, r.said);
  } finally { cleanup(p.dir, pf.dir); }
});

test('#5713 review 3: a release carried by another version\'s file ("also") counts as showing its highlights; a dirty build is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wnpool-sync-also-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'whats-new.json'), JSON.stringify({ version: '0.7.35', also: ['0.7.36'], highlights: [{ icon: 'tasks', title: 'A', line: 'x' }] }));
  git('add', '.'); git('commit', '-q', '-m', 'cut');
  const commit = git('rev-parse', 'HEAD');
  const p = prod('0.7.36', commit);
  const pf = poolFile({ lastProd: '0.7.35', items: [item('A', 1, 'pending'), item('B', 2, 'pending')] });
  try {
    const r = tool.syncWithProd(tool.readPool(pf.file), pf.file, p.env, dir);
    assert.equal(r.ok, true, r.because);
    assert.deepEqual(JSON.parse(fs.readFileSync(pf.file, 'utf8')).items.map((i) => i.status), ['shown', 'pending']);
    assert.doesNotMatch(r.note, /If a version between/, '0.7.35 -> 0.7.36 has nothing between them');
    // A dirty build's commit is not what shipped.
    fs.writeFileSync(path.join(p.dir, 'kosmos-0.7.36-arm64.manifest.json'), JSON.stringify({ version: '0.7.36', app: { commit, dirty: true } }));
    const d = tool.syncWithProd(tool.readPool(pf.file), pf.file, p.env, dir);
    assert.equal(d.ok, true, 'CONTROL: already recorded, so no read happens');
    const pf2 = poolFile({ lastProd: '0.7.35', items: [item('A', 1, 'pending')] });
    const d2 = tool.syncWithProd(tool.readPool(pf2.file), pf2.file, p.env, dir);
    assert.equal(d2.ok, false);
    assert.match(d2.because, /changed tree/);
    cleanup(pf2.dir);
  } finally { cleanup(dir, p.dir, pf.dir); }
});

test('#5713 review 3: each command takes only its own flags', () => {
  const pf = poolFile({ lastProd: '0.7.35', items: [item('A', 1, 'pending')] });
  try {
    assert.equal(quiet(() => tool.main(['build', '0.7.36', '--none', `--pool=${pf.file}`])).code, 2);
    assert.equal(quiet(() => tool.main(['shown', '0.7.36', '--promoted', '--none', '--offline', `--pool=${pf.file}`])).code, 2);
    assert.equal(JSON.parse(fs.readFileSync(pf.file, 'utf8')).lastProd, '0.7.35', 'a refused command wrote the pool');
  } finally { cleanup(pf.dir); }
});
