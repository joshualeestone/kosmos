/**
 * #5711: tools/whats-new-pool.js makes ONE cumulative What's New: the top highlights by rank across everything since the
 * last PROD release, never a held feature and never one prod already showed. Each test has an arm that can fail.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tool = require('./tools/whats-new-pool');
const whatsnew = require('./engine/whatsnew');

const item = (title, rank, status, extra = {}) => Object.assign({ title, line: `What ${title} does, in one sentence.`, icon: 'tasks', rank, since: '0.7.31', status }, extra);

function tmp(pool) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wnpool-'));
  const file = path.join(dir, 'pool.json');
  fs.writeFileSync(file, JSON.stringify(pool));
  return { dir, file, out: path.join(dir, 'whats-new.json') };
}
const quiet = (fn) => { const w = process.stdout.write, e = process.stderr.write; process.stdout.write = () => true; process.stderr.write = () => true; try { return fn(); } finally { process.stdout.write = w; process.stderr.write = e; } };

test('#5711: the top highlights by rank; a held one and one prod already showed never appear, whatever their rank', () => {
  const t = tmp({ lastProd: '0.7.35', items: [
    item('Held feature', 0, 'held'), item('Already shown', 0, 'shown', { shownIn: '0.7.35' }),
    item('Third', 3, 'pending'), item('First', 1, 'pending'), item('Second', 2, 'pending'),
    item('Sixth', 6, 'pending'), item('Fourth', 4, 'pending'), item('Fifth', 5, 'pending'),
  ] });
  try {
    assert.equal(quiet(() => tool.main(['build', '0.7.36', `--pool=${t.file}`, `--out=${t.out}`])), 0);
    const got = JSON.parse(fs.readFileSync(t.out, 'utf8'));
    assert.equal(got.version, '0.7.36');
    assert.deepEqual(got.highlights.map((h) => h.title), ['First', 'Second', 'Third', 'Fourth', 'Fifth'], 'rank order, at most 5');
    assert.deepEqual(whatsnew.problems(got, '0.7.36'), [], 'the window accepts it');
    // --max narrows it.
    assert.equal(quiet(() => tool.main(['build', '0.7.36', `--pool=${t.file}`, `--out=${t.out}`, '--max=4'])), 0);
    assert.equal(JSON.parse(fs.readFileSync(t.out, 'utf8')).highlights.length, 4);
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('#5711: a tie in rank goes to the newer version', () => {
  // Titles opposed to the version order, so the title fallback alone would pick the older one.
  const t = tmp({ items: [item('A older', 1, 'pending', { since: '0.7.31' }), item('B newer', 1, 'pending', { since: '0.7.34' })] });
  try {
    assert.equal(quiet(() => tool.main(['build', '0.7.36', `--pool=${t.file}`, `--out=${t.out}`, '--max=1'])), 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(t.out, 'utf8')).highlights.map((h) => h.title), ['B newer']);
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('#5711: with nothing eligible (all held or shown) the build refuses rather than writing an empty window', () => {
  const t = tmp({ items: [item('Held', 1, 'held'), item('Shown', 2, 'shown')] });
  try {
    assert.equal(quiet(() => tool.main(['build', '0.7.36', `--pool=${t.file}`, `--out=${t.out}`])), 3);
    assert.equal(fs.existsSync(t.out), false, 'nothing written');
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('#5711: after a PROD promote, exactly the titles that version showed become shown, and lastProd moves', () => {
  const t = tmp({ lastProd: '0.7.35', items: [item('A', 1, 'pending'), item('B', 2, 'pending'), item('C', 3, 'pending'), item('H', 4, 'held')] });
  try {
    const shown = path.join(t.dir, 'shown.json');
    fs.writeFileSync(shown, JSON.stringify({ version: '0.7.36', highlights: [{ icon: 'tasks', title: 'A', line: 'x' }, { icon: 'tasks', title: 'H', line: 'x' }] }));
    assert.equal(quiet(() => tool.main(['shown', '0.7.36', `--pool=${t.file}`, `--from=${shown}`, '--promoted'])), 0);
    const pool = JSON.parse(fs.readFileSync(t.file, 'utf8'));
    const by = Object.fromEntries(pool.items.map((i) => [i.title, i]));
    assert.equal(by.A.status, 'shown'); assert.equal(by.A.shownIn, '0.7.36');
    assert.equal(by.B.status, 'pending'); assert.equal(by.C.status, 'pending');
    assert.equal(by.H.status, 'held', 'a held item stays held even if it was named');
    assert.equal(pool.lastProd, '0.7.36');
    // The next build no longer shows A.
    assert.equal(quiet(() => tool.main(['build', '0.7.37', `--pool=${t.file}`, `--out=${t.out}`])), 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(t.out, 'utf8')).highlights.map((h) => h.title), ['B', 'C']);
    // A What's New of ANOTHER version marks nothing.
    assert.equal(quiet(() => tool.main(['shown', '0.7.37', `--pool=${t.file}`, `--from=${shown}`, '--promoted'])), 3);
    // Review 1: a highlight reworded after the build is not in the pool: refused, nothing marked.
    fs.writeFileSync(shown, JSON.stringify({ version: '0.7.37', highlights: [{ icon: 'tasks', title: 'B, reworded', line: 'x' }] }));
    assert.equal(quiet(() => tool.main(['shown', '0.7.37', `--pool=${t.file}`, `--from=${shown}`, '--promoted'])), 3);
    assert.equal(JSON.parse(fs.readFileSync(t.file, 'utf8')).items.find((i) => i.title === 'B').status, 'pending');
    assert.equal(JSON.parse(fs.readFileSync(t.file, 'utf8')).lastProd, '0.7.36', 'lastProd did not move');
    // Review 1: an OLDER version than the recorded prod is refused.
    fs.writeFileSync(shown, JSON.stringify({ version: '0.7.35', highlights: [{ icon: 'tasks', title: 'B', line: 'x' }] }));
    assert.equal(quiet(() => tool.main(['shown', '0.7.35', `--pool=${t.file}`, `--from=${shown}`, '--promoted'])), 3);
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('#5711: the real pool builds a window the cut accepts, without the held conversation mode', () => {
  const pool = tool.readPool(path.join(__dirname, 'release', 'whats-new-pool.json'));
  const chosen = tool.choose(pool, 5);
  // Live data: as many as are pending, at most 5 (a promote can leave fewer).
  // Zero pending is legal (a promote can show the last one), so only a non-empty choice is checked by the window.
  assert.equal(chosen.length, Math.min(5, pool.items.filter((i) => i.status === 'pending').length));
  if (chosen.length) assert.deepEqual(whatsnew.problems({ version: '0.7.36', highlights: chosen }, '0.7.36'), []);
  assert.ok(!chosen.some((h) => /aloud|conversation mode/i.test(h.title + h.line)), 'the held mode never resurfaces');
  assert.ok(pool.items.some((i) => i.status === 'held' && /aloud/i.test(i.title)), 'CONTROL: the held item is in the pool');
});

test('#5711 review 1: a top 5 that leaves a platform with no highlight is refused, as the cut would refuse it', () => {
  const t = tmp({ items: [item('Mac one', 1, 'pending', { platforms: ['mac'] }), item('Mac two', 2, 'pending', { platforms: ['mac'] })] });
  try {
    assert.equal(quiet(() => tool.main(['build', '0.7.36', `--pool=${t.file}`, `--out=${t.out}`])), 3);
    assert.equal(fs.existsSync(t.out), false);
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('#5711 review 1: a pool with one title twice is refused', () => {
  const t = tmp({ items: [item('Same', 1, 'pending'), item('Same', 2, 'pending')] });
  try { assert.throws(() => tool.main(['build', '0.7.36', `--pool=${t.file}`, `--out=${t.out}`]), /appears twice/); }
  finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('#5711 review 2: a build for a version not newer than the last PROD release is refused', () => {
  const t = tmp({ lastProd: '0.7.35', items: [item('A', 1, 'pending')] });
  try {
    for (const v of ['0.7.35', '0.7.34']) {
      assert.equal(quiet(() => tool.main(['build', v, `--pool=${t.file}`, `--out=${t.out}`])), 3, v);
      assert.equal(fs.existsSync(t.out), false);
    }
    assert.equal(quiet(() => tool.main(['build', '0.7.36', `--pool=${t.file}`, `--out=${t.out}`])), 0, 'CONTROL: the next version builds');
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('#5711 review 3: an unknown or malformed option is refused, never silently ignored', () => {
  const t = tmp({ items: [item('A', 1, 'pending')] });
  try {
    assert.equal(quiet(() => tool.main(['build', '0.7.36', `--pool=${t.file}`, `--out=${t.out}`, '--max', '4'])), 2);
    assert.equal(quiet(() => tool.main(['build', '0.7.36', `--pool=${t.file}`, `--outt=${t.out}`])), 2);
    assert.equal(fs.existsSync(t.out), false);
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('#5711 review 3: a malformed pending item anywhere in the pool is refused at once, not when it reaches the top 5', () => {
  const t = tmp({ items: [item('Good', 1, 'pending'), item('Bad icon far down', 40, 'pending', { icon: 'rocket' })] });
  try {
    assert.equal(quiet(() => tool.main(['build', '0.7.36', `--pool=${t.file}`, `--out=${t.out}`, '--max=1'])), 3);
    assert.equal(fs.existsSync(t.out), false);
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('#5711 review 4: shown refuses without --promoted, and marks nothing', () => {
  const t = tmp({ lastProd: '0.7.35', items: [item('A', 1, 'pending')] });
  try {
    const shown = path.join(t.dir, 'shown.json');
    fs.writeFileSync(shown, JSON.stringify({ version: '0.7.36', highlights: [{ icon: 'tasks', title: 'A', line: 'x' }] }));
    assert.equal(quiet(() => tool.main(['shown', '0.7.36', `--pool=${t.file}`, `--from=${shown}`])), 2);
    assert.equal(JSON.parse(fs.readFileSync(t.file, 'utf8')).items[0].status, 'pending');
    assert.equal(quiet(() => tool.main(['shown', '0.7.36', `--pool=${t.file}`, `--from=${shown}`, '--promoted'])), 0, 'CONTROL');
    assert.equal(JSON.parse(fs.readFileSync(t.file, 'utf8')).items[0].status, 'shown');
    assert.deepEqual(fs.readdirSync(t.dir).filter((f) => f.includes('.tmp-')), [], 'no temp file left behind');
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('#5711 review 4: a malformed pending item does not stop shown recording what prod showed', () => {
  const t = tmp({ lastProd: '0.7.35', items: [item('A', 1, 'pending'), item('Bad', 9, 'pending', { icon: 'rocket' })] });
  try {
    const shown = path.join(t.dir, 'shown.json');
    fs.writeFileSync(shown, JSON.stringify({ version: '0.7.36', highlights: [{ icon: 'tasks', title: 'A', line: 'x' }] }));
    assert.equal(quiet(() => tool.main(['shown', '0.7.36', `--pool=${t.file}`, `--from=${shown}`, '--promoted'])), 0);
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('#5711 review 4: versions compare as numbers (0.7.10 is newer than 0.7.9)', () => {
  assert.ok(tool.newerFirst('0.7.9', '0.7.10') > 0);
  assert.ok(tool.newerFirst('0.7.10', '0.7.9') < 0);
  assert.equal(tool.newerFirst('0.7.10', '0.7.10'), 0);
  const t = tmp({ lastProd: '0.7.9', items: [item('A', 1, 'pending')] });
  try { assert.equal(quiet(() => tool.main(['build', '0.7.10', `--pool=${t.file}`, `--out=${t.out}`])), 0); }
  finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});
