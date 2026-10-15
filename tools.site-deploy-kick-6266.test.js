'use strict';
/* kosmos#6266: tools/site-deploy-kick.sh, the 15-minute backstop launchd runs on Mortals because GitHub's own schedule
   fired the site deploy only six times on 2026-10-15. A fake `gh` checks each call's exact arguments and applies the
   script's own --jq filter to sample runs with jq (review 1: a fake that ignored the filter could not see it wrong).
   The state folder and heartbeat are in a sandbox. */
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
const JQ = ['/usr/bin/jq', '/opt/homebrew/bin/jq', '/usr/local/bin/jq'].find((p) => fs.existsSync(p));

const MAIN = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = Date.parse('2026-10-15T22:00:00Z') / 1000;
const iso = (secsAgo) => new Date((NOW - secsAgo) * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
const FAKE_GH = path.join(SANDBOX, 'gh');
/* Exact argv per call; anything else exits 3 so a changed query fails the test. The run list's --jq is applied by jq. */
fs.writeFileSync(FAKE_GH, `#!/bin/bash
printf '%s\\n' "$*" >> "$FAKE_LOG"
if [ "$*" = "api repos/owner/site/commits/main --jq .sha" ]; then
  [ -n "\${FAKE_API_FAIL:-}" ] && exit 1; printf '%s\\n' "$FAKE_MAIN"; exit 0
fi
if [ $# -eq 14 ] && [ "$1 $2 $3 $4 $5 $6 $7 $8 $9 \${10} \${11} \${12} \${13}" = "run list --repo owner/site --workflow site-deploy.yml --branch main --limit 20 --json status,createdAt --jq" ]; then
  [ -n "\${FAKE_LIST_FAIL:-}" ] && exit 1
  printf '%s' "\${FAKE_RUNS:-[]}" | "$FAKE_JQ" -r "\${14}"; exit $?
fi
if [ "$*" = "workflow run site-deploy.yml --repo owner/site --ref main" ]; then
  [ -n "\${FAKE_DISPATCH_FAIL:-}" ] && exit 1; exit 0
fi
exit 3
`, { mode: 0o755 });

function kick(stateDir, env = {}, args = []) {
  const log = path.join(SANDBOX, 'gh-' + Math.random().toString(36).slice(2) + '.log');
  fs.writeFileSync(log, '');
  const beat = path.join(SANDBOX, 'beat-' + Math.random().toString(36).slice(2), 'last-tick');
  const r = spawnSync('/bin/bash', [KICK, ...args], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', KOSMOS_GH: FAKE_GH, KOSMOS_AUTODEPLOY_STATE: stateDir, KOSMOS_SITE_REPO: 'owner/site', KOSMOS_KICK_HEARTBEAT: beat,
      KOSMOS_KICK_NOW: String(NOW), FAKE_LOG: log, FAKE_JQ: JQ || '/nonexistent-jq', FAKE_MAIN: MAIN, ...env },
  });
  const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { status: r.status, out: r.stdout + r.stderr, calls, beat, dispatched: calls.filter((c) => c.startsWith('workflow run')).length };
}
function state(files = {}) {
  const d = fs.mkdtempSync(path.join(SANDBOX, 'state-'));
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(d, k), v);
  return d;
}
const runs = (list) => JSON.stringify(list.map(([status, ago]) => ({ status, createdAt: iso(ago) })));
const needJq = { skip: JQ ? false : 'jq is not installed here' };

test('#6266: site main ahead, the last run over 14 minutes ago and finished: one dispatch on main, said once; heartbeat written', needJq, () => {
  const r = kick(state({ 'last-deployed': OLD + '\n' }), { FAKE_RUNS: runs([['completed', 3600]]) });
  assert.equal(r.status, 0, r.out);
  assert.equal(r.dispatched, 1, r.calls.join('\n'));
  assert.match(r.out, /asked for a site deploy: main aaaaaaaaa, last deployed bbbbbbbbb/);
  assert.ok(fs.existsSync(r.beat), 'no heartbeat: a quiet log could not be told from a job that never ran');
});

test('#6266: nothing is asked when deployed, parked, paused, a run is active in any state, or a run began under 14 minutes ago', needJq, () => {
  for (const [why, files, env] of [
    ['deployed', { 'last-deployed': MAIN + '\n' }, {}],
    ['parked', { 'last-deployed': OLD, parked: MAIN + '\n' }, {}],
    ['paused', { 'last-deployed': OLD, paused: '' }, {}],
    ['queued', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['queued', 60]]) }],
    ['in_progress', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['in_progress', 60]]) }],
    ['waiting', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['waiting', 60]]) }],
    ['requested', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['requested', 60]]) }],
    ['pending', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['pending', 60]]) }],
    ['a failed run 5 min ago (its retry is the next tick, not now)', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['completed', 300], ['completed', 4000]]) }],
  ]) {
    const r = kick(state(files), env);
    assert.equal(r.status, 0, why + ': ' + r.out);
    assert.equal(r.dispatched, 0, why);
    assert.equal(r.out, '', why + ': a quiet tick prints nothing');
  }
  // CONTROLs: no runs at all, or the newest finished 15 minutes ago, are asked for.
  const first = kick(state());
  assert.equal(first.dispatched, 1, 'with no last-deployed and no runs, it asks');
  assert.doesNotMatch(first.out, /No such file/, 'a missing state file is not an error');
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 900]]) }).dispatched, 1);
});

test('#6266: a run stuck queued or running over 45 minutes is said each tick, and still asks nothing', needJq, () => {
  const r = kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['queued', 3000]]) });
  assert.equal(r.dispatched, 0);
  assert.match(r.out, /a site deploy run has been queued since .* \(over 45 minutes\)/);
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['queued', 2000]]) }).out, '', 'CONTROL: 33 minutes is not stuck');
});

test('#6266: anything it cannot read asks nothing and exits 1 with a line saying what', needJq, () => {
  for (const [why, env, re] of [
    ['api fails', { FAKE_API_FAIL: '1' }, /could not read site main/],
    ['main not a sha', { FAKE_MAIN: 'not found' }, /not a sha/],
    ['main a short sha', { FAKE_MAIN: 'abc123' }, /not a full sha/],
    ['run list fails', { FAKE_LIST_FAIL: '1' }, /could not list site deploy runs/],
    ['run time garbled', { FAKE_RUNS: JSON.stringify([{ status: 'completed', createdAt: 'yesterday' }]) }, /site deploy run time read as/],
  ]) {
    const r = kick(state({ 'last-deployed': OLD }), env);
    assert.equal(r.status, 1, why + ': ' + r.out);
    assert.equal(r.dispatched, 0, why);
    assert.match(r.out, re, why);
  }
  const r = kick(state({ 'last-deployed': OLD }), { FAKE_DISPATCH_FAIL: '1' });
  assert.equal(r.status, 1);
  assert.match(r.out, /could not dispatch the site deploy for main aaaaaaaaa/);
});

test('#6266: --check says what a tick would decide and dispatches nothing', needJq, () => {
  const r = kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 3600]]) }, ['--check']);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.dispatched, 0);
  assert.match(r.out, /check: site main aaaaaaaaa, last deployed bbbbbbbbb/);
  assert.match(r.out, /check: would ask for a site deploy/);
  assert.equal(fs.existsSync(r.beat), false, 'a check is not a tick');
});

test('#6266: the installer copies the script, writes a 15-minute launchd job, re-runs cleanly, and removes everything', () => {
  const home = fs.mkdtempSync(path.join(SANDBOX, 'home-'));
  const lc = path.join(SANDBOX, 'launchctl.log');
  const fakeLc = path.join(SANDBOX, 'launchctl');
  fs.writeFileSync(fakeLc, `#!/bin/bash\nprintf '%s\\n' "$*" >> "${lc}"\n`, { mode: 0o755 });
  const env = { PATH: '/usr/bin:/bin', KOSMOS_KICK_HOME: home, KOSMOS_LAUNCHCTL: fakeLc };
  for (let i = 0; i < 2; i += 1) {   // a second install refreshes in place
    const r = spawnSync('/bin/bash', [INSTALL], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  const dir = path.join(home, '.local', 'libexec', 'kosmos-site-deploy-kick');
  const plist = path.join(home, 'Library', 'LaunchAgents', 'com.stonesyndicate.kosmos-site-deploy-kick.plist');
  assert.equal(fs.readFileSync(path.join(dir, 'kick.sh'), 'utf8'), fs.readFileSync(KICK, 'utf8'), 'the installed script is the repo copy');
  if (fs.existsSync('/usr/bin/plutil')) {   // macOS only (CI may run this on Linux); the content checks below run everywhere
    const lint = spawnSync('/usr/bin/plutil', ['-lint', plist], { encoding: 'utf8' });
    assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  }
  const xml = fs.readFileSync(plist, 'utf8');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(xml, /<key>StartInterval<\/key><integer>900<\/integer>/);
  assert.match(xml, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(xml, new RegExp('<string>/bin/bash</string><string>' + esc(dir) + '/kick.sh</string>'));
  assert.match(xml, new RegExp('<key>HOME</key><string>' + esc(home) + '</string>'));
  assert.match(xml, /<key>PATH<\/key><string>\/opt\/homebrew\/bin:/, 'launchd PATH must reach the Homebrew gh');
  assert.match(xml, new RegExp('<key>KOSMOS_KICK_HEARTBEAT</key><string>' + esc(dir) + '/last-tick</string>'));
  assert.equal((fs.readFileSync(lc, 'utf8').match(/^bootstrap gui\/\d+ .*kosmos-site-deploy-kick\.plist$/mg) || []).length, 2);
  fs.writeFileSync(path.join(dir, 'kick.sh.new'), 'left by an interrupted install');
  const u = spawnSync('/bin/bash', [INSTALL, '--uninstall'], { encoding: 'utf8', env });
  assert.equal(u.status, 0);
  assert.equal(fs.existsSync(plist), false);
  assert.equal(fs.existsSync(dir), false, 'the folder (and a leftover .new) was not removed');
  assert.match(fs.readFileSync(lc, 'utf8'), /bootout gui\/\d+\/com\.stonesyndicate\.kosmos-site-deploy-kick/);
});
