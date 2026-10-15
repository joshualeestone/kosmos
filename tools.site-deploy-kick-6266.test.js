'use strict';
/* kosmos#6266: tools/site-deploy-kick.sh, the 15-minute trigger launchd runs on Mortals because GitHub's own schedule
   fired the site deploy only six times on 2026-10-15. A fake `gh` records every call; the state folder is a sandbox. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = __dirname;
const KICK = path.join(ROOT, 'tools', 'site-deploy-kick.sh');
const INSTALL = path.join(ROOT, 'tools', 'install-site-deploy-kick.sh');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sitekick-6266-'));
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const MAIN = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const FAKE_GH = path.join(SANDBOX, 'gh');
fs.writeFileSync(FAKE_GH, `#!/bin/bash
printf '%s\\n' "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "api repos/"*) [ -n "\${FAKE_API_FAIL:-}" ] && exit 1; printf '%s\\n' "$FAKE_MAIN" ;;
  "run list") [ -n "\${FAKE_LIST_FAIL:-}" ] && exit 1; printf '%s\\n' "\${FAKE_ACTIVE:-0}" ;;
  "workflow run") [ -n "\${FAKE_DISPATCH_FAIL:-}" ] && exit 1; exit 0 ;;
  *) exit 3 ;;
esac
`, { mode: 0o755 });

function kick(state, env = {}) {
  const log = path.join(SANDBOX, 'gh-' + Math.random().toString(36).slice(2) + '.log');
  fs.writeFileSync(log, '');
  const r = spawnSync('/bin/bash', [KICK], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', KOSMOS_GH: FAKE_GH, KOSMOS_AUTODEPLOY_STATE: state, KOSMOS_SITE_REPO: 'owner/site', FAKE_LOG: log, FAKE_MAIN: MAIN, ...env },
  });
  const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { status: r.status, out: r.stdout + r.stderr, calls, dispatched: calls.filter((c) => c.startsWith('workflow run')).length };
}
function state(files = {}) {
  const d = fs.mkdtempSync(path.join(SANDBOX, 'state-'));
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(d, k), v);
  return d;
}

test('#6266: site main ahead of the last deploy and nothing running: one dispatch of the workflow on main, said once', () => {
  const r = kick(state({ 'last-deployed': OLD + '\n' }));
  assert.equal(r.status, 0, r.out);
  assert.equal(r.dispatched, 1);
  assert.ok(r.calls.includes('workflow run site-deploy.yml --repo owner/site --ref main'), r.calls.join('\n'));
  assert.match(r.out, /asked for a site deploy: main aaaaaaaaa, last deployed bbbbbbbbb/);
});

test('#6266: nothing is asked when main is already deployed, parked, paused, or a run is queued or running', () => {
  for (const [why, files, env] of [
    ['deployed', { 'last-deployed': MAIN + '\n' }, {}],
    ['parked', { 'last-deployed': OLD, parked: MAIN + '\n' }, {}],
    ['paused', { 'last-deployed': OLD, paused: '' }, {}],
    ['a run active', { 'last-deployed': OLD }, { FAKE_ACTIVE: '1' }],
  ]) {
    const r = kick(state(files), env);
    assert.equal(r.status, 0, why + ': ' + r.out);
    assert.equal(r.dispatched, 0, why);
    assert.equal(r.out, '', why + ': a quiet tick prints nothing');
  }
  // A first run (no state yet) is ahead by definition.
  const first = kick(state());
  assert.equal(first.dispatched, 1, 'CONTROL: with no last-deployed, it asks');
  assert.doesNotMatch(first.out, /No such file/, 'a missing state file is not an error');
});

test('#6266: anything it cannot read asks nothing and exits 1 with a line saying what', () => {
  for (const [why, env, re] of [
    ['api fails', { FAKE_API_FAIL: '1' }, /could not read site main/],
    ['main not a sha', { FAKE_MAIN: 'not found' }, /not a sha/],
    ['main a short sha', { FAKE_MAIN: 'abc123' }, /not a full sha/],
    ['run list fails', { FAKE_LIST_FAIL: '1' }, /could not list site deploy runs/],
    ['run count garbled', { FAKE_ACTIVE: 'x' }, /site deploy runs read as/],
  ]) {
    const r = kick(state({ 'last-deployed': OLD }), env);
    assert.equal(r.status, 1, why);
    assert.equal(r.dispatched, 0, why);
    assert.match(r.out, re, why);
  }
  const r = kick(state({ 'last-deployed': OLD }), { FAKE_DISPATCH_FAIL: '1' });
  assert.equal(r.status, 1);
  assert.match(r.out, /could not dispatch the site deploy for main aaaaaaaaa/);
});

test('#6266: the installer copies the script, writes a 15-minute launchd job running it with /bin/bash, and removes both', () => {
  const home = fs.mkdtempSync(path.join(SANDBOX, 'home-'));
  const lc = path.join(SANDBOX, 'launchctl.log');
  const fakeLc = path.join(SANDBOX, 'launchctl');
  fs.writeFileSync(fakeLc, `#!/bin/bash\nprintf '%s\\n' "$*" >> "${lc}"\n`, { mode: 0o755 });
  const env = { PATH: '/usr/bin:/bin', KOSMOS_KICK_HOME: home, KOSMOS_LAUNCHCTL: fakeLc };
  const r = spawnSync('/bin/bash', [INSTALL], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dir = path.join(home, '.local', 'libexec', 'kosmos-site-deploy-kick');
  const plist = path.join(home, 'Library', 'LaunchAgents', 'com.stonesyndicate.kosmos-site-deploy-kick.plist');
  assert.equal(fs.readFileSync(path.join(dir, 'kick.sh'), 'utf8'), fs.readFileSync(KICK, 'utf8'), 'the installed script is the repo copy');
  if (fs.existsSync('/usr/bin/plutil')) {   // macOS only (CI may run this on Linux); the content checks below run everywhere
    const lint = spawnSync('/usr/bin/plutil', ['-lint', plist], { encoding: 'utf8' });
    assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  }
  const xml = fs.readFileSync(plist, 'utf8');
  assert.match(xml, /<key>StartInterval<\/key><integer>900<\/integer>/);
  assert.match(xml, new RegExp('<string>/bin/bash</string><string>' + dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/kick.sh</string>'));
  assert.match(fs.readFileSync(lc, 'utf8'), /^bootstrap gui\/\d+ .*kosmos-site-deploy-kick\.plist$/m);
  const u = spawnSync('/bin/bash', [INSTALL, '--uninstall'], { encoding: 'utf8', env });
  assert.equal(u.status, 0);
  assert.equal(fs.existsSync(plist), false);
  assert.equal(fs.existsSync(dir), false);
  assert.match(fs.readFileSync(lc, 'utf8'), /bootout gui\/\d+\/com\.stonesyndicate\.kosmos-site-deploy-kick/);
});
