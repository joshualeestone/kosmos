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
  assert.equal(r.status, 1);
  assert.match(r.stderr, /it is for 0\.6\.98, not 0\.6\.99/);
  assert.match(r.stderr, /KOSMOS_CUT_NO_WHATS_NEW=1/, 'the refusal does not say how to cut a hotfix');
});

test('#3955: a missing, broken or undrawable file is refused', () => {
  assert.equal(run('0.6.98', undefined).status, 1);
  assert.match(run('0.6.98', undefined).stderr, /missing/);
  assert.equal(run('0.6.98', '{ nope').status, 1);
  assert.equal(run('0.6.98', { ...GOOD, highlights: [{ icon: 'rocket', title: 'x', line: 'y' }] }).status, 1);
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
  const doc = fs.readFileSync(path.join(__dirname, 'docs', 'releasing.md'), 'utf8');
  assert.match(doc, /KOSMOS_CUT_NO_WHATS_NEW=1 yarn release/, 'docs/releasing.md does not say how to skip it');
});
