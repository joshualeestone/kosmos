'use strict';
/**
 * kosmos#6587 (S-7a slice 2a): tools/lib/stage-service-keys.sh, which all three staging lists call, run for real against
 * a scratch repo: nothing to do without a set, a lone file refused, a set copied and then checked with the STAGED
 * verifier and recovery keys (off and verified pass, a set that does not verify stops the build).
 *
 *   node --test tools.stage-service-keys-6587.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIB = path.join(__dirname, 'tools', 'lib', 'stage-service-keys.sh');
const ROOT_PUB = 'MCowBQYDK2VwAyEA/RckOFqgx1tk+3jNYC+h2ZH96/drE8WO1wLqyDXp9hg=';
const VECTOR = '{\n  "type": "kosmos-service-keys",\n  "service_keys": [\n    {\n      "kid": "_oEsEvOrTOY",\n      "pub": "MCowBQYDK2VwAyEA6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=",\n      "role": "current"\n    },\n    {\n      "kid": "XCm3jxCjWkk",\n      "pub": "MCowBQYDK2VwAyEAE5j2LG0aRXxRumpLXz29L2n8qTIWIY3ImX5Ba9F9k8o=",\n      "role": "next"\n    }\n  ],\n  "seq": 1,\n  "issued": "2025-08-24"\n}\n';
const VECTOR_SIG = 'Z4eSzkTKtuFexVyEhVtfSo2kWevcWC8xvaCNfxJVxInx40cOLCm6LtjLiX7fJ7oKWcDK+ydIXv+FybM4H2M3Bg==';

/* A scratch repo holding the given engine files and the real check script, and a staged engine dir holding the real
   verifier and manifest-verify (with RECOVERY_KEYS as given, or as shipped). */
function world({ set, sig, recovery } = {}) {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-sk-'));
  const repo = path.join(top, 'repo'); const dest = path.join(top, 'stage', 'engine');
  fs.mkdirSync(path.join(repo, 'engine'), { recursive: true }); fs.mkdirSync(path.join(repo, 'tools'), { recursive: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'tools', 'check-service-keys.js'), path.join(repo, 'tools', 'check-service-keys.js'));
  if (set !== undefined) fs.writeFileSync(path.join(repo, 'engine', 'service-keys.json'), set);
  if (sig !== undefined) fs.writeFileSync(path.join(repo, 'engine', 'service-keys.json.sig'), sig);
  fs.copyFileSync(path.join(__dirname, 'engine', 'servicekeys.js'), path.join(dest, 'servicekeys.js'));
  let mv = fs.readFileSync(path.join(__dirname, 'engine', 'manifest-verify.js'), 'utf8');
  if (recovery) {
    const was = mv;
    mv = mv.replace('const RECOVERY_KEYS = Object.freeze([]);', 'const RECOVERY_KEYS = Object.freeze(' + JSON.stringify(recovery) + ');');
    assert.notEqual(mv, was, 'CONTROL: the RECOVERY_KEYS line moved; re-anchor this test');
  }
  fs.writeFileSync(path.join(dest, 'manifest-verify.js'), mv);
  return { repo, dest };
}
function stage({ repo, dest }) {
  const r = spawnSync('bash', ['-c', '. "$1" && kosmos_stage_service_keys "$2" "$3" "$4"', '_', LIB, repo, dest, process.execPath], { encoding: 'utf8' });
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', staged: ['service-keys.json', 'service-keys.json.sig'].filter((f) => fs.existsSync(path.join(dest, f))) };
}

test('no set in the repo: nothing staged, nothing refused (this version, today)', () => {
  const r = stage(world());
  assert.equal(r.rc, 0, r.out);
  assert.deepEqual(r.staged, []);
});

test('a set without its signature, or the reverse, stops the build', () => {
  for (const [name, w] of [['set only', world({ set: VECTOR })], ['sig only', world({ sig: VECTOR_SIG })]]) {
    const r = stage(w);
    assert.notEqual(r.rc, 0, name + ': ' + r.out);
    assert.match(r.out, /must ship together \(#6587\)/, name);
  }
});

test('both, with no recovery key pinned: staged, and the check says off', () => {
  const r = stage(world({ set: VECTOR, sig: VECTOR_SIG + '\n' }));
  assert.equal(r.rc, 0, r.out);
  assert.deepEqual(r.staged, ['service-keys.json', 'service-keys.json.sig']);
  assert.match(r.out, /service key set: off/);
});

test('both, with the recovery key pinned: verified; a set that does not verify stops the build (the control)', () => {
  const ok = stage(world({ set: VECTOR, sig: VECTOR_SIG + '\n', recovery: [ROOT_PUB] }));
  assert.equal(ok.rc, 0, ok.out);
  assert.match(ok.out, /service key set: verified, seq 1, 2 key\(s\)/);
  // Nothing on stdout: deploy/install-board.sh captures stage_app's stdout as the version (review 4).
  assert.equal(ok.stdout, '', 'the answer goes to stderr');
  const bad = stage(world({ set: VECTOR.replace('"seq": 1', '"seq": 2'), sig: VECTOR_SIG + '\n', recovery: [ROOT_PUB] }));
  assert.notEqual(bad.rc, 0, bad.out);
  assert.match(bad.out, /does not verify against the staged recovery keys \(#6587\)/);
});

test('all three staging lists call it, with their own staged engine dir', () => {
  const calls = {
    'tools/build-kosmos-bundle.sh': 'kosmos_stage_service_keys "$REPO" "$STAGE/app/engine" || exit 1',
    'tools/build-kosmos-windows.sh': 'kosmos_stage_service_keys "$REPO" "$STAGE/app/engine" || exit 1',
    'deploy/install-board.sh': 'kosmos_stage_service_keys "$REPO" "$_d/engine" "$NODE" || return 1',
  };
  for (const [file, call] of Object.entries(calls)) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(src.includes('/tools/lib/stage-service-keys.sh"'), file + ' does not source the staging function');
    assert.ok(src.includes(call), file + ' does not call it as: ' + call);
    assert.ok(src.indexOf(call) > src.indexOf('engine/*.js'), file + ': it runs after the engine is staged (the check needs the staged verifier)');
  }
});
