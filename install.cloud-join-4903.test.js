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
function box({ os: osName = 'Linux', tunnelRc = 0, setOnFails = false, failTimes = 0 } = {}) {
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
exports.setOn = (on) => {
  fs.writeFileSync(${JSON.stringify(path.join(root, 'seton'))}, String(on));
  return ${setOnFails} ? { ok: false, because: 'refused in the test' } : { ok: true };
};
`);
  const tunnel = path.join(home, 'app', 'bin', 'kosmos-tunnel');
  const tries = path.join(root, 'tunnel-tries');
  fs.writeFileSync(tunnel, `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(path.join(root, 'tunnel-args'))}
cat > ${JSON.stringify(path.join(root, 'tunnel-stdin'))}
printf 'x' >> ${JSON.stringify(tries)}
[ "$1 $2 $3" = "setup cloud --state-dir" ] || exit 9
n=$(wc -c < ${JSON.stringify(tries)} | tr -d ' ')
[ "$n" -le ${failTimes} ] && exit 7
[ ${tunnelRc} -eq 0 ] && printf 'mac-1\\n' > "$4/mac_id"
exit ${tunnelRc}
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'uname'), `#!/bin/sh\nprintf '%s\\n' ${osName}\n`, { mode: 0o755 });
  const env = path.join(user, '.kosmos-cloud', 'provision.env');
  fs.writeFileSync(env, `KOSMOS_TENANT_ID=acct\nKOSMOS_PROVISIONING_TOKEN=${TOKEN}\nKOSMOS_RELEASE_CHANNEL=stable\nKOSMOS_CLOUD=1\n`, { mode: 0o600 });
  return { root, home, user, state, bin, env };
}

function join(b, extraEnv = {}) {
  const script = `info() { printf '%s\\n' "$*"; }\n${BLOCK}\n_kosmos_cloud_join; echo "rc=$?"\n`;
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
  assert.equal(args, `setup\ncloud\n--state-dir\n${b.state}\n`);
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
