'use strict';
/*
 * kosmos#4903 S3: a Kosmos Cloud box joins its Kosmos+ account before its board first starts. These tests run
 * setup.sh's own kosmos-cloud-join block (cut from the shipped file, between its BEGIN and END lines) under /bin/sh,
 * as setup.sh runs, against a stand-in kosmos-tunnel, a stand-in engine/remote.js and a uname that answers Linux or
 * Darwin, so nothing real is registered, switched on or written outside a temp folder.
 *
 *   node --test install.cloud-join-4903.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
const BLOCK = (() => {
  const m = SETUP.match(/\n# BEGIN kosmos-cloud-join[^\n]*\n([\s\S]*?)\n# END kosmos-cloud-join\n/);
  return m ? m[1] : null;
})();
const TOKEN = 'tok_' + 'A'.repeat(39);

/* One box: a KOSMOS_HOME with stand-ins, a state dir, a HOME holding provision.env, and a PATH whose uname answers
   `os`. `tunnelRc` is the stand-in tunnel's exit code; `setOnFails` makes remote.setOn refuse. */
function box({ os: osName = 'Linux', tunnelRc = 0, setOnFails = false, failTimes = 0, keys = null, setupEnvThrows = false, setOnLingers = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cloudjoin-4903-'));
  const home = path.join(root, 'kosmos');
  const user = path.join(root, 'user');
  const state = path.join(root, 'data', 'remote');
  const bin = path.join(root, 'fakebin');
  for (const d of [path.join(home, 'runtime', 'bin'), path.join(home, 'app', 'engine'), path.join(home, 'app', 'bin'),
    path.join(user, '.kosmos-cloud'), bin]) fs.mkdirSync(d, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'app', 'engine', 'remote.js'), `
const fs = require('fs');
exports.stateDir = () => ${JSON.stringify(state)};
exports.coordinator = () => 'https://coordinator.example';
exports.setupEnv = () => {
  if (${setupEnvThrows}) throw new Error('no key set in the test');
  return ${JSON.stringify(keys)} === null ? null : { ...process.env, KOSMOS_EXPECT_COORDINATOR_KEYS: ${JSON.stringify(keys)} };
};
exports.setOn = (on) => {
  fs.writeFileSync(${JSON.stringify(path.join(root, 'seton'))}, String(on));
  // As the real setOn's standing refresh (askAfterFlip): work left running that would hold node open (kosmos#7550).
  if (${setOnLingers}) setTimeout(() => {}, 60000);
  return ${setOnFails} ? { ok: false, because: 'refused in the test' } : { ok: true };
};
`);
  const tunnel = path.join(home, 'app', 'bin', 'kosmos-tunnel');
  const tries = path.join(root, 'tunnel-tries');
  fs.writeFileSync(tunnel, `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(path.join(root, 'tunnel-args'))}
cat > ${JSON.stringify(path.join(root, 'tunnel-stdin'))}
printf '%s' "\${KOSMOS_EXPECT_COORDINATOR_KEYS-<unset>}" > ${JSON.stringify(path.join(root, 'tunnel-keys'))}
printf 'x' >> ${JSON.stringify(tries)}
# As the real parser (kosmos-relay crates/tunnel main.rs SetupCommand::Cloud): --coordinator and --state-dir are
# REQUIRED, in any order; a missing one, or anything else, is a usage error (exit 2) before any request is made.
[ "$1 $2" = "setup cloud" ] || exit 2
shift 2
coord=; dir=
while [ $# -gt 0 ]; do
  case "$1" in
    --coordinator) coord=$2; shift 2 ;;
    --state-dir) dir=$2; shift 2 ;;
    --json) shift ;;
    *) exit 2 ;;
  esac
done
[ -n "$coord" ] && [ -n "$dir" ] || exit 2
n=$(wc -c < ${JSON.stringify(tries)} | tr -d ' ')
[ "$n" -le ${failTimes} ] && exit 7
[ ${tunnelRc} -eq 0 ] && printf 'mac-1\\n' > "$dir/mac_id"
exit ${tunnelRc}
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'uname'), `#!/bin/sh\nprintf '%s\\n' ${osName}\n`, { mode: 0o755 });
  const env = path.join(user, '.kosmos-cloud', 'provision.env');
  fs.writeFileSync(env, `KOSMOS_TENANT_ID=acct\nKOSMOS_PROVISIONING_TOKEN=${TOKEN}\nKOSMOS_RELEASE_CHANNEL=stable\nKOSMOS_CLOUD=1\n`, { mode: 0o600 });
  return { root, home, user, state, bin, env };
}

function join(b, extraEnv = {}) {
  // Under set -eu, as setup.sh runs it (review 3); the call is guarded so its own rc is printed.
  const script = `set -eu\ninfo() { printf '%s\\n' "$*"; }\n${BLOCK}\nrc=0; _kosmos_cloud_join || rc=$?; echo "rc=$rc"\n`;
  return spawnSync('/bin/sh', ['-c', script], {
    encoding: 'utf8',
    env: { PATH: `${b.bin}:/usr/bin:/bin`, HOME: b.user, KOSMOS_HOME: b.home, KOSMOS_CLOUD: '1',
      KOSMOS_PROVISIONING_TOKEN: TOKEN, KOSMOS_CLOUD_JOIN_RETRY_SECS: '0', ...extraEnv },
  });
}
const rcOf = (r) => (r.stdout.match(/rc=(\d+)\s*$/) || [])[1];
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

test('#4903 setup.sh carries the cloud-join block, called before the board starts', () => {
  assert.ok(BLOCK, 'no kosmos-cloud-join block in setup.sh');
  const call = SETUP.indexOf('_kosmos_cloud_join || die');
  const start = SETUP.indexOf('step "Starting Kosmos."');
  assert.ok(call > 0 && start > 0 && call < start, 'the join must run before the board first starts');
});

test('#4903 a cloud box joins: token on stdin, latch written, remote on, token removed from provision.env', () => {
  const b = box();
  const r = join(b);
  assert.equal(rcOf(r), '0', r.stdout + r.stderr);
  assert.equal(read(path.join(b.root, 'tunnel-stdin')), TOKEN, 'the token did not reach the tunnel on stdin');
  const args = read(path.join(b.root, 'tunnel-args'));
  assert.equal(args, `setup\ncloud\n--coordinator\nhttps://coordinator.example\n--state-dir\n${b.state}\n`);
  assert.ok(!args.includes(TOKEN), 'the token is in argv');
  const latch = path.join(b.state, 'hosted');
  const st = fs.lstatSync(latch);
  assert.ok(st.isFile(), 'the latch is not a regular file');
  assert.equal(st.size, 0, 'the latch is not empty');
  assert.equal(st.mode & 0o777, 0o600, 'the latch is not 0600');
  assert.equal(fs.statSync(b.state).mode & 0o777, 0o700);
  assert.equal(read(path.join(b.root, 'seton')), 'true', 'remote access was not switched on');
  const env = read(b.env);
  assert.ok(!env.includes('KOSMOS_PROVISIONING_TOKEN'), 'the spent token stayed in provision.env');
  assert.ok(env.includes('KOSMOS_TENANT_ID=acct') && env.includes('KOSMOS_CLOUD=1'), 'provision.env lost its other lines');
  assert.equal(fs.statSync(b.env).mode & 0o777, 0o600);
  // A rerun on a box that has joined changes nothing and asks the tunnel nothing.
  fs.rmSync(path.join(b.root, 'tunnel-args'));
  const again = join(b, { KOSMOS_PROVISIONING_TOKEN: '' });
  assert.equal(rcOf(again), '0', again.stdout);
  assert.equal(read(path.join(b.root, 'tunnel-args')), null, 'a joined box asked the tunnel again');
});

test('#4903 anywhere but a Linux cloud box, the block does nothing', () => {
  for (const [label, b, env] of [
    ['a Mac with the cloud flag', box({ os: 'Darwin' }), {}],
    ['Linux without the cloud flag', box(), { KOSMOS_CLOUD: '' }],
    ['Linux with another value', box(), { KOSMOS_CLOUD: 'yes' }],
  ]) {
    const r = join(b, env);
    assert.equal(rcOf(r), '0', label + ': ' + r.stdout);
    assert.equal(read(path.join(b.root, 'tunnel-args')), null, label + ': the tunnel was asked');
    assert.ok(!fs.existsSync(path.join(b.state, 'hosted')), label + ': a latch was written');
    assert.equal(read(path.join(b.root, 'seton')), null, label + ': remote was switched on');
  }
});

test('#4903 a lost answer is retried: one failure then success joins, with the same token each time', () => {
  const b = box({ failTimes: 1 });
  const r = join(b);
  assert.equal(rcOf(r), '0', r.stdout + r.stderr);
  assert.equal(read(path.join(b.root, 'tunnel-tries')), 'xx', 'expected exactly two tries');
  assert.equal(read(path.join(b.root, 'tunnel-stdin')), TOKEN, 'the retry did not carry the token on stdin');
  assert.ok(fs.existsSync(path.join(b.state, 'hosted')));
});

test('#4903 a failed join writes no latch, leaves remote off, and says where to look', () => {
  const b = box({ tunnelRc: 3 });
  const r = join(b);
  assert.equal(rcOf(r), '1', r.stdout);
  assert.equal(read(path.join(b.root, 'tunnel-tries')), 'xxx', 'a join that always fails stops after three tries');
  assert.match(r.stdout, /could not join its Kosmos\+ account.*cloud-join\.log/);
  assert.ok(!fs.existsSync(path.join(b.state, 'hosted')), 'a latch after a failed join');
  assert.equal(read(path.join(b.root, 'seton')), null, 'remote switched on after a failed join');
  assert.ok(read(b.env).includes('KOSMOS_PROVISIONING_TOKEN'), 'a token that did not work was thrown away');
});

test('#4903 no token, a refused switch, or a link where the latch goes: each refuses with a sentence', () => {
  let b = box();
  let r = join(b, { KOSMOS_PROVISIONING_TOKEN: '' });
  assert.equal(rcOf(r), '1');
  assert.match(r.stdout, /no setup token/);
  assert.equal(read(path.join(b.root, 'tunnel-args')), null);

  b = box({ setOnFails: true });
  r = join(b);
  assert.equal(rcOf(r), '1');
  assert.match(r.stdout, /could not turn on Kosmos\+ remote access/);

  b = box();
  fs.mkdirSync(b.state, { recursive: true });
  fs.symlinkSync(path.join(b.root, 'elsewhere'), path.join(b.state, 'hosted'));
  r = join(b);
  assert.equal(rcOf(r), '1', r.stdout);
  assert.match(r.stdout, /holds a link or a folder/);
  assert.equal(read(path.join(b.root, 'tunnel-args')), null, 'the tunnel was asked beside a planted link');
  // CONTROL: the same box with the link removed joins, so the refusal above was the link.
  fs.rmSync(path.join(b.state, 'hosted'));
  r = join(b);
  assert.equal(rcOf(r), '0', r.stdout);
});

test('#4903 a usage error from the tunnel is not retried: it would fail the same way', () => {
  const b = box({ tunnelRc: 2 });
  const r = join(b);
  assert.equal(rcOf(r), '1', r.stdout + r.stderr);
  assert.equal(read(path.join(b.root, 'tunnel-tries')), 'x', 'a usage error was tried more than once');
  assert.ok(!fs.existsSync(path.join(b.state, 'hosted')), 'a failed join wrote the latch');
  // CONTROL: a failure that is not a usage error is retried (up to three tries).
  const c = box({ tunnelRc: 7 });
  assert.equal(rcOf(join(c)), '1');
  assert.equal(read(path.join(c.root, 'tunnel-tries')), 'xxx');
});

test('#4903 a rerun on a box that joined but never switched remote on switches it on', () => {
  const b = box();
  fs.mkdirSync(b.state, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(b.state, 'mac_id'), 'mac-1\n');
  fs.writeFileSync(path.join(b.state, 'hosted'), '', { mode: 0o600 });
  const r = join(b);
  assert.equal(rcOf(r), '0', r.stdout + r.stderr);
  assert.equal(read(path.join(b.root, 'seton')), 'true', 'the rerun did not switch remote access on');
  assert.equal(read(path.join(b.root, 'tunnel-args')), null, 'a joined box asked the tunnel again');
});

test('#4903 a box registered by a run that stopped before its latch is not registered again', () => {
  const b = box();
  fs.mkdirSync(b.state, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(b.state, 'mac_id'), 'mac-1\n');   // registered; no latch; the spent token still in env
  const r = join(b);
  assert.equal(rcOf(r), '0', r.stdout + r.stderr);
  assert.equal(read(path.join(b.root, 'tunnel-args')), null, 'the spent token was sent to the tunnel again');
  assert.ok(fs.lstatSync(path.join(b.state, 'hosted')).isFile(), 'the latch was not written');
  assert.equal(read(path.join(b.root, 'seton')), 'true', 'remote access was not switched on');
  assert.ok(!read(b.env).includes('KOSMOS_PROVISIONING_TOKEN'), 'the spent token stayed in provision.env');
  // CONTROL: the same box without mac_id is registered through the tunnel.
  const c = box();
  assert.equal(rcOf(join(c)), '0');
  assert.ok(read(path.join(c.root, 'tunnel-args')), 'an unregistered box did not ask the tunnel');
});

test('#4903 a box whose registration is still pending (its pending key kept) is asked to finish it', () => {
  const b = box();
  fs.mkdirSync(b.state, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(b.state, 'mac_id'), 'mac-1\n');
  fs.writeFileSync(path.join(b.state, 'cloud_pending_key'), 'k');   // the tunnel keeps it until registration completes
  const r = join(b);
  assert.equal(rcOf(r), '0', r.stdout + r.stderr);
  assert.ok(read(path.join(b.root, 'tunnel-args')), 'an unfinished registration was taken as done');
  assert.equal(read(path.join(b.root, 'tunnel-stdin')), TOKEN, 'the retry did not carry the same token');
});

test('#7550 the join pins the coordinator keys the board pins, for the tunnel only', () => {
  const b = box({ keys: 'k1,k2' });
  const r = join(b);
  assert.equal(rcOf(r), '0', r.stdout + r.stderr);
  assert.equal(read(path.join(b.root, 'tunnel-keys')), 'k1,k2', 'the tunnel was not handed the board\'s keys');
});

test('#7550 with no pin from the board, an inherited KOSMOS_EXPECT_COORDINATOR_KEYS is removed, as setupEnv does', () => {
  const b = box({ keys: null });
  const r = join(b, { KOSMOS_EXPECT_COORDINATOR_KEYS: 'stale-from-the-caller' });
  assert.equal(rcOf(r), '0', r.stdout + r.stderr);
  assert.equal(read(path.join(b.root, 'tunnel-keys')), '<unset>');
});

test('#7550 an engine that cannot say which keys to trust stops the join before the token is sent', () => {
  const b = box({ setupEnvThrows: true });
  const r = join(b);
  assert.equal(rcOf(r), '1', r.stdout + r.stderr);
  assert.match(r.stdout, /could not find which Kosmos\+ keys to trust/);
  assert.equal(read(path.join(b.root, 'tunnel-stdin')), null, 'the tunnel ran anyway');
});

test('#7550 work setOn leaves running does not hold the installer open', () => {
  for (const pre of [false, true]) {
    const b = box({ setOnLingers: true });
    if (pre) { fs.mkdirSync(b.state, { recursive: true }); fs.writeFileSync(path.join(b.state, 'mac_id'), 'mac-1\n'); fs.writeFileSync(path.join(b.state, 'hosted'), '', { mode: 0o600 }); }
    const t0 = Date.now();
    const r = spawnSyncTimed(b);
    assert.equal(rcOf(r), '0', `${pre ? 'rerun' : 'first'} join: ` + r.stdout + r.stderr + (r.error ? String(r.error) : ''));
    assert.ok(Date.now() - t0 < 20000, `the ${pre ? 'rerun' : 'first'} join waited on setOn's leftover work`);
  }
});
function spawnSyncTimed(b) {
  const script = `set -eu\ninfo() { printf '%s\\n' "$*"; }\n${BLOCK}\nrc=0; _kosmos_cloud_join || rc=$?; echo "rc=$rc"\n`;
  return spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8', timeout: 20000, env: { PATH: `${b.bin}:/usr/bin:/bin`,
    HOME: b.user, KOSMOS_HOME: b.home, KOSMOS_CLOUD: '1', KOSMOS_PROVISIONING_TOKEN: TOKEN, KOSMOS_CLOUD_JOIN_RETRY_SECS: '0' } });
}
