'use strict';
/*
 * #3955: release.sh step 1b-ii refuses a cut whose web/whats-new.json is not for the version being
 * cut (tools/whats-new-check.js), with the KOSMOS_CUT_NO_WHATS_NEW=1 hotfix opt-out.
 *
 *   node --test tools.whats-new-check-3955.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CHECK = path.join(__dirname, 'tools', 'whats-new-check.js');
const GOOD = { version: '0.6.98', highlights: [{ icon: 'spark', title: 'A thing', line: 'It does a thing.' }] };
function run(version, obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wncheck-'));
  const f = path.join(dir, 'whats-new.json');
  if (obj !== undefined) fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
  const args = [CHECK].concat(version === undefined ? [] : [version, f]);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

test('#3955: the matching file is accepted', () => {
  const r = run('0.6.98', GOOD);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 highlight\(s\) for 0\.6\.98/);
});

test('#3955: last release\'s file is refused, naming both versions', () => {
  const r = run('0.6.99', GOOD);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /it is for 0\.6\.98, not 0\.6\.99/);
  assert.match(r.stderr, /KOSMOS_CUT_NO_WHATS_NEW=1/, 'the refusal does not say how to cut a hotfix');
});

test('#3955: a missing, broken or undrawable file is refused', () => {
  assert.equal(run('0.6.98', undefined).status, 3);
  assert.match(run('0.6.98', undefined).stderr, /missing/);
  assert.equal(run('0.6.98', '{ nope').status, 3);
  assert.equal(run('0.6.98', { ...GOOD, highlights: [{ icon: 'rocket', title: 'x', line: 'y' }] }).status, 3);
});

test('#3955: a usage error is its own exit (2), not a verdict', () => {
  assert.equal(run(undefined).status, 2);
  assert.equal(spawnSync(process.execPath, [CHECK, 'latest'], { encoding: 'utf8' }).status, 2);
});

test('#3955: release.sh runs the check at 1b-ii, after the versions entry and before anything is bumped or built', () => {
  const sh = fs.readFileSync(path.join(__dirname, 'tools', 'release.sh'), 'utf8');
  const at = (s) => { const i = sh.indexOf(s); assert.notEqual(i, -1, s + ' is gone from release.sh'); return i; };
  const b = at('step "== 1b. the versions entry');
  const mine = at('step "== 1b-ii. the What\'s new highlights are for this version (#3955) =="');
  const bump = at('step "== 2. the version, in one place ==');
  assert.ok(b < mine && mine < bump, 'the check does not sit between the versions entry and the bump');
  const block = sh.slice(mine, sh.indexOf('step "== 1c.', mine));
  assert.match(block, /node "\$REPO\/tools\/whats-new-check\.js" "\$V" "\$REPO\/web\/whats-new\.json" \|\| exit 1/, 'a refusal does not stop the cut');
  assert.match(block, /if \[ "\$\{KOSMOS_CUT_NO_WHATS_NEW:-\}" = "1" \]; then/, 'no hotfix opt-out');
  /* Twice (round 6): at 1b-ii before the bump, and at 2b-ii on the frozen tree (the shared checkout can
     move between them). Counted over the whole file, so a respelled third call cannot slip in. Round 11
     adds one call that only informs (the opt-out's message says whether the window will show). */
  assert.equal((sh.match(/whats-new-check\.js[^\n]*\|\| exit 1/g) || []).length, 2, 'the cut checks the highlights some other number of times than twice');
  assert.equal((sh.match(/whats-new-check\.js/g) || []).length, 3, 'a call to the check appeared or went that is neither the two refusals nor the opt-out message');
  // The opt-out's one call informs and never refuses, and is said at both steps (round 12).
  assert.match(sh, /node "\$1\/tools\/whats-new-check\.js" "\$V" "\$1\/web\/whats-new\.json" >\/dev\/null 2>&1 \|\| rc=\$\?/, 'the opt-out message call can refuse');
  assert.equal((sh.match(/whats_new_optout_note "\$(REPO|BUILD)"/g) || []).length, 2, 'the opt-out is not said at both 1b-ii and 2b-ii');
  const frozen = at('node "$BUILD/tools/whats-new-check.js" "$V" "$BUILD/web/whats-new.json" || exit 1');
  const freeze = at('REPO="$BUILD"');
  const suite = at('step "== 3.');
  assert.ok(freeze < frozen && frozen < suite, 'the frozen-tree check does not sit between the freeze and the suite');
  assert.match(sh.slice(frozen - 130, frozen), /if \[ "\$\{KOSMOS_CUT_NO_WHATS_NEW:-\}" != "1" \]; then\n\s*$/, 'the frozen-tree check ignores the hotfix opt-out');
  assert.match(sh.slice(freeze, frozen), /step "== 2b-ii\./, 'the frozen-tree check has no step label (a refusal would be filed under 2b)');
  const doc = fs.readFileSync(path.join(__dirname, 'docs', 'releasing.md'), 'utf8');
  assert.match(doc, /KOSMOS_CUT_NO_WHATS_NEW=1 yarn release/, 'docs/releasing.md does not say how to skip it');
});

test('#3955 round 13: a check that cannot run is not "not ready": a broken engine module exits 2, never 3', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path2 = require('node:path');
  const dir = fs.mkdtempSync(path2.join(os.tmpdir(), 'wn-broken-'));
  try {
    fs.mkdirSync(path2.join(dir, 'tools')); fs.mkdirSync(path2.join(dir, 'engine'));
    fs.copyFileSync(CHECK, path2.join(dir, 'tools', 'whats-new-check.js'));
    fs.writeFileSync(path2.join(dir, 'engine', 'whatsnew.js'), 'this is not javascript {');
    const r = spawnSync(process.execPath, [path2.join(dir, 'tools', 'whats-new-check.js'), '0.6.98', path2.join(dir, 'x.json')], { encoding: 'utf8' });
    assert.equal(r.status, 2, 'a broken module read as not ready: ' + r.stderr);
    assert.match(r.stderr, /could not run/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
