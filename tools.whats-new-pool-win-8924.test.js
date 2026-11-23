'use strict';
/**
 * kosmos#8924: a Windows-only highlight (tagged windows, not mac) is never shown by the Mac, so the Mac sync (#5713)
 * can never retire it; it used to be retired by hand. `build` now also reads what WINDOWS prod serves (latest-win.json,
 * the manifest named from its version and arch, and web/whats-new.json at that manifest's app commit) and marks that
 * window's Windows-only highlights shown, recording lastProdWin. `prod-check` refuses when Windows prod is newer.
 * Prod is local file:// pointers here, and the history is a small git repo made for the test (no network).
 *
 *   node --test tools.whats-new-pool-win-8924.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const tool = require('./tools/whats-new-pool');

const item = (title, rank, status, extra = {}) => Object.assign({ title, line: `What ${title} does, in one sentence.`, icon: 'tasks', rank, since: '0.8.10', status }, extra);
const quiet = (fn) => {
  const w = process.stdout.write, e = process.stderr.write;
  let said = '';
  process.stdout.write = (x) => { said += x; return true; };
  process.stderr.write = (x) => { said += x; return true; };
  try { return { code: fn(), said }; } finally { process.stdout.write = w; process.stderr.write = e; }
};
const cleanup = (...dirs) => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); };

/* A git repo with 0.8.16's window at one commit: a Windows-only line W, a Mac-only line M and an untagged line A. */
function history() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wnpool-win-repo-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'whats-new.json'), JSON.stringify({ version: '0.8.16', highlights: [
    { icon: 'tasks', title: 'W', line: 'x', platforms: ['windows'] },
    { icon: 'tasks', title: 'M', line: 'x', platforms: ['mac'] },
    { icon: 'tasks', title: 'A', line: 'x' },
  ] }));
  git('add', '.'); git('commit', '-q', '-m', 'cut 0.8.16');
  return { dir, cut: git('rev-parse', 'HEAD') };
}

/* Mac and Windows prod pointers and manifests as files, as installkosmos.com serves them. */
function prod({ mac = '0.8.16', win = '0.8.16', commit, winCommit = commit, winManifest = true, winDirty = false, winPointer = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wnpool-win-prod-'));
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ version: mac, manifest: `kosmos-${mac}-arm64.manifest.json` }));
  fs.writeFileSync(path.join(dir, `kosmos-${mac}-arm64.manifest.json`), JSON.stringify({ version: mac, app: { commit, dirty: false } }));
  if (winPointer) fs.writeFileSync(path.join(dir, 'latest-win.json'), JSON.stringify({ version: win, arch: 'x64', artifact: 'kosmos-win-x64.zip' }));
  if (winManifest) fs.writeFileSync(path.join(dir, `kosmos-${win}-win-x64.manifest.json`), JSON.stringify({ version: win, platform: 'win32', app: { commit: winCommit, dirty: winDirty } }));
  return { dir, env: { KOSMOS_PROD_POINTER_URL: 'file://' + path.join(dir, 'latest.json') } };
}
function poolFile(pool) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wnpool-win-pool-'));
  const file = path.join(dir, 'pool.json');
  fs.writeFileSync(file, JSON.stringify(pool));
  return { dir, file };
}
const statuses = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).items.map((i) => [i.title, i.status, i.shownIn || null]);

/* main() reads process.env for the prod pointers: set them for one call. */
function withEnv(env, fn) {
  const keys = ['KOSMOS_PROD_POINTER_URL', 'KOSMOS_PROD_WIN_POINTER_URL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return fn(); } finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

test('#8924: a Windows-only line Windows prod showed is retired by the sync, with shownIn the Windows version; Mac and untagged lines are left to the Mac sync', () => {
  const h = history();
  const p = prod({ commit: h.cut });
  const pf = poolFile({ lastProd: '0.8.16', items: [
    item('W', 1, 'pending', { platforms: ['windows'] }),
    item('M', 2, 'pending', { platforms: ['mac'] }),
    item('A', 3, 'pending'),
    item('W2', 4, 'pending', { platforms: ['windows'] }),   // Windows-only, but NOT in that window: stays pending
  ] });
  try {
    const r = tool.syncWithWinProd(tool.readPool(pf.file), pf.file, p.env, h.dir);
    assert.equal(r.ok, true, r.because);
    assert.equal(r.wrote, '0.8.16');
    assert.match(r.note, /1 Windows-only highlight\(s\) marked shown/);
    assert.deepEqual(statuses(pf.file), [['W', 'shown', '0.8.16'], ['M', 'pending', null], ['A', 'pending', null], ['W2', 'pending', null]]);
    assert.equal(JSON.parse(fs.readFileSync(pf.file, 'utf8')).lastProdWin, '0.8.16');
    assert.equal(JSON.parse(fs.readFileSync(pf.file, 'utf8')).lastProd, '0.8.16', 'the Windows sync moved the Mac record');
  } finally { cleanup(h.dir, p.dir, pf.dir); }
});

test('#8924: a pool that already records Windows prod writes nothing; CONTROL: one a version behind is synced', () => {
  const h = history();
  const p = prod({ commit: h.cut });
  const recorded = poolFile({ lastProd: '0.8.16', lastProdWin: '0.8.16', items: [item('W', 1, 'pending', { platforms: ['windows'] })] });
  const behind = poolFile({ lastProd: '0.8.16', lastProdWin: '0.8.15', items: [item('W', 1, 'pending', { platforms: ['windows'] })] });
  try {
    const before = fs.readFileSync(recorded.file, 'utf8');
    const r = tool.syncWithWinProd(tool.readPool(recorded.file), recorded.file, p.env, h.dir);
    assert.equal(r.ok, true, r.because);
    assert.equal(r.wrote, undefined);
    assert.equal(fs.readFileSync(recorded.file, 'utf8'), before, 'a recorded pool was rewritten');
    const c = tool.syncWithWinProd(tool.readPool(behind.file), behind.file, p.env, h.dir);
    assert.equal(c.ok, true, c.because);
    assert.deepEqual(statuses(behind.file), [['W', 'shown', '0.8.16']]);
  } finally { cleanup(h.dir, p.dir, recorded.dir, behind.dir); }
});

test('#8924: what cannot be read exactly refuses and writes nothing (no pointer, no manifest, a dirty build, no window at that commit, a reworded Windows-only title)', () => {
  const h = history();
  const pool = () => poolFile({ lastProd: '0.8.16', items: [item('W', 1, 'pending', { platforms: ['windows'] })] });
  const cases = [
    ['no Windows pointer', prod({ commit: h.cut, winPointer: false }), /could not read what Windows prod serves/],
    ['no Windows manifest', prod({ commit: h.cut, winManifest: false }), /could not read Windows prod's manifest/],
    ['a dirty Windows build', prod({ commit: h.cut, winDirty: true }), /made from a changed tree/],
    ['a commit this checkout lacks', prod({ commit: h.cut, winCommit: 'b'.repeat(40) }), /has no What's New for it at that commit/],
  ];
  const dirs = [h.dir];
  try {
    for (const [name, p, said] of cases) {
      dirs.push(p.dir);
      const pf = pool(); dirs.push(pf.dir);
      const before = fs.readFileSync(pf.file, 'utf8');
      const r = tool.syncWithWinProd(tool.readPool(pf.file), pf.file, p.env, h.dir);
      assert.equal(r.ok, false, name);
      assert.match(r.because, said, name + ': ' + r.because);
      assert.equal(fs.readFileSync(pf.file, 'utf8'), before, name + ': the pool was written');
    }
    // A Windows-only title the window has and the pool does not (reworded after the build): refused, as the Mac sync does.
    const p = prod({ commit: h.cut }); dirs.push(p.dir);
    const pf = poolFile({ lastProd: '0.8.16', items: [item('W reworded', 1, 'pending', { platforms: ['windows'] })] }); dirs.push(pf.dir);
    const r = tool.syncWithWinProd(tool.readPool(pf.file), pf.file, p.env, h.dir);
    assert.equal(r.ok, false);
    assert.match(r.because, /Windows-only highlights of 0\.8\.16 are not in the pool .*"W"/);
  } finally { cleanup(...dirs); }
});

test('#8924: with only the Mac pointer set, the Windows pointer is read from the same folder (a test never reaches the live site)', () => {
  assert.equal(tool.winPointerUrl({ KOSMOS_PROD_POINTER_URL: 'file:///tmp/x/latest.json' }), 'file:///tmp/x/latest-win.json');
  assert.equal(tool.winPointerUrl({ KOSMOS_PROD_POINTER_URL: 'file:///tmp/x/latest.json', KOSMOS_PROD_WIN_POINTER_URL: 'file:///y/w.json' }), 'file:///y/w.json');
  assert.equal(tool.winPointerUrl({}), tool.PROD_WIN_POINTER_URL);
  assert.equal(tool.PROD_WIN_POINTER_URL, 'https://installkosmos.com/dist/latest-win.json');
});

test('#8924: prod-check is 3 when Windows prod is newer than the pool records, 0 when recorded, 4 when the Windows pointer cannot be read', () => {
  const p = prod({ commit: 'a'.repeat(40) });
  const noPtr = prod({ commit: 'a'.repeat(40), winPointer: false });
  const recorded = poolFile({ lastProd: '0.8.16', lastProdWin: '0.8.16', items: [item('A', 1, 'pending')] });
  const behind = poolFile({ lastProd: '0.8.16', lastProdWin: '0.8.15', items: [item('A', 1, 'pending')] });
  const never = poolFile({ lastProd: '0.8.16', items: [item('A', 1, 'pending')] });
  try {
    assert.equal(withEnv(p.env, () => quiet(() => tool.main(['prod-check', `--pool=${recorded.file}`])).code), 0);
    const b = withEnv(p.env, () => quiet(() => tool.main(['prod-check', `--pool=${behind.file}`])));
    assert.equal(b.code, 3, b.said);
    assert.match(b.said, /Windows prod serves 0\.8\.16 but the pool records Windows prod 0\.8\.15/);
    const n = withEnv(p.env, () => quiet(() => tool.main(['prod-check', `--pool=${never.file}`])));
    assert.equal(n.code, 3, n.said);
    assert.match(n.said, /the pool records no Windows prod release/);
    assert.equal(withEnv(noPtr.env, () => quiet(() => tool.main(['prod-check', `--pool=${recorded.file}`])).code), 4);
  } finally { cleanup(p.dir, noPtr.dir, recorded.dir, behind.dir, never.dir); }
});

test('#8924: through build, the Windows sync runs after the Mac one and a refusal names what was already written', () => {
  const h = history();
  // build reads history from this repo (ROOT), not the test's: point both pointers at a commit this repo lacks so the
  // Windows sync refuses after the Mac sync had nothing to do, and the refusal says so.
  const p = prod({ commit: 'c'.repeat(40) });
  const pf = poolFile({ lastProd: '0.8.16', items: [item('A', 1, 'pending')] });
  const out = path.join(pf.dir, 'whats-new.json');
  try {
    const before = fs.readFileSync(pf.file, 'utf8');
    const r = withEnv(p.env, () => quiet(() => tool.main(['build', '0.8.17', `--pool=${pf.file}`, `--out=${out}`])));
    assert.equal(r.code, 3, r.said);
    assert.match(r.said, /Windows prod serves 0\.8\.16 \(built from c+\), but this checkout has no What's New for it at that commit/);
    assert.doesNotMatch(r.said, /already updated/, 'nothing was written, so nothing may be claimed');
    assert.equal(fs.readFileSync(pf.file, 'utf8'), before);
    assert.equal(fs.existsSync(out), false, 'a refused build wrote the window');
    // CONTROL: --offline skips both syncs and builds.
    const o = withEnv(p.env, () => quiet(() => tool.main(['build', '--offline', '0.8.17', `--pool=${pf.file}`, `--out=${out}`])));
    assert.equal(o.code, 0, o.said);
  } finally { cleanup(h.dir, p.dir, pf.dir); }
});
