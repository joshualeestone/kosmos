'use strict';
/* kosmos#6266: tools/site-deploy-kick.sh, the 15-minute backstop launchd runs on Mortals because GitHub's own schedule
   fired the site deploy only six times on 2026-10-15. A fake `gh` checks each call's exact arguments and applies the
   script's own --jq filter to sample runs with jq (a fake that ignored the filter could not see it wrong).
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
[ -n "\${FAKE_STDERR:-}" ] && printf '%s\\n' "$FAKE_STDERR" >&2
[ -n "\${FAKE_IGNORE_ALRM:-}" ] && trap '' ALRM   # as gh (Go) does
[ -n "\${FAKE_PIDFILE:-}" ] && echo $$ > "$FAKE_PIDFILE"
[ -n "\${FAKE_PPIDFILE:-}" ] && echo $PPID > "$FAKE_PPIDFILE"   # the perl wrapper's pid
[ -n "\${FAKE_SLEEP:-}" ] && exec sleep "$FAKE_SLEEP"   # the fake becomes the sleep (an ignored ALRM survives exec), as one gh process
# kosmos#6305: the site-deploy hold variable. Absent (404) unless FAKE_HOLD names a reason; FAKE_HOLD_FAIL fails it otherwise.
if [ "$*" = "api repos/owner/site/actions/variables/SITE_DEPLOY_HOLD --jq .value" ]; then
  [ -n "\${FAKE_HOLD_FAIL:-}" ] && { echo 'gh: Bad credentials (HTTP 401)' >&2; exit 1; }
  [ -n "\${FAKE_HOLD_SILENT:-}" ] && exit 1
  [ -n "\${FAKE_HOLD:-}" ] && { printf '%s\\n' "$FAKE_HOLD"; exit 0; }
  echo 'gh: Not Found (HTTP 404)' >&2; exit 1
fi
if [ "$*" = "api repos/owner/site/commits/main --jq .sha" ]; then
  [ -n "\${FAKE_API_FAIL:-}" ] && exit 1; printf '%s\\n' "$FAKE_MAIN"; exit 0
fi
if [ $# -eq 14 ] && [ "$1 $2 $3 $4 $5 $6 $7 $8 $9 \${10} \${11} \${12} \${13}" = "run list --repo owner/site --workflow site-deploy.yml --branch main --limit 20 --json status,conclusion,createdAt,updatedAt,startedAt --jq" ]; then
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
/* An unfinished run's conclusion is "" exactly as gh gives it (measured 2026-10-15; null hid a parsing bug). */
/* [status, created s ago, updated s ago, conclusion, started s ago]: startedAt equals createdAt unless given (a
   re-run's start moves, its creation does not). */
const runs = (list) => JSON.stringify(list.map(([status, ago, upd, conclusion, started]) => ({
  status, conclusion: conclusion || (status === 'completed' ? 'success' : ''), createdAt: iso(ago), updatedAt: iso(upd == null ? ago : upd),
  startedAt: iso(started == null ? ago : started) })));
/* jq ships with macOS (where this runs for real); only elsewhere may it be missing and the tests skip. */
const needJq = { skip: JQ || process.platform === 'darwin' ? false : 'jq is not installed here' };

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
    ['in_progress', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['in_progress', 60, 30]]) }],
    ['waiting', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['waiting', 60]]) }],
    ['requested', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['requested', 60]]) }],
    ['pending', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['pending', 60]]) }],
    ['a run created 5 min ago', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['completed', 300], ['completed', 4000]]) }],
    ['a run queued long that FAILED a minute ago (from when it ended)', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['completed', 1000, 60, 'failure']]) }],
    ['a run that timed out a minute ago', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['completed', 1000, 60, 'timed_out']]) }],
    ['a run that failed to start a minute ago', { 'last-deployed': OLD }, { FAKE_RUNS: runs([['completed', 1000, 60, 'startup_failure']]) }],
  ]) {
    const r = kick(state(files), env);
    assert.equal(r.status, 0, why + ': ' + r.out);
    assert.equal(r.dispatched, 0, why);
    assert.equal(r.out, '', why + ': a quiet tick prints nothing');
  }
  // CONTROLs: no runs at all, or the newest finished 15 minutes ago, are asked for.
  // a GREEN run created 1000 s ago that ended a minute ago does not hold the next ask (only a failure's end does).
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 1000, 60, 'success']]) }).dispatched, 1);
  // A superseded (cancelled) pending run counts from its creation too.
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 1000, 60, 'cancelled']]) }).dispatched, 1);
  // A parked sha other than main does not hold main back (the job parks one sha, until main moves).
  assert.equal(kick(state({ 'last-deployed': OLD, parked: 'c'.repeat(40) }), { FAKE_RUNS: runs([['completed', 3600]]) }).dispatched, 1);
  // A paused tick still writes its heartbeat: launchd started it.
  assert.ok(fs.existsSync(kick(state({ paused: '' })).beat));
  const first = kick(state());
  assert.equal(first.dispatched, 1, 'with no last-deployed and no runs, it asks');
  assert.doesNotMatch(first.out, /No such file/, 'a missing state file is not an error');
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 900]]) }).dispatched, 1);
});

test('#6266: a run not finished 3 hours after creation is stuck: said, not waited on, and the tick exits 1', needJq, () => {
  for (const [why, list] of [['running 3 h 20 min', [['in_progress', 12000, 600]]], ['queued 3 h 20 min', [['queued', 12000]]]]) {
    const r = kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs(list) });
    assert.equal(r.dispatched, 1, why + ': one stuck run silenced the backstop');
    assert.equal(r.status, 1, why + ': launchctl\'s last exit code should show it');
    assert.match(r.out, /a site deploy run has been .* \(200 minutes\), past its limit; not waiting on it/, why);
    assert.ok(r.out.includes('since ' + iso(12000)), why + ': the line names the time its age counts from');
  }
  // The 3-hour limit is pinned on both sides: 10900 s is stuck, 10700 s is waited on.
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['queued', 10900]]) }).dispatched, 1, '10900 s');
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['queued', 10700]]) }).dispatched, 0, '10700 s');
  // A FINISHED re-run of an old run that started 5 minutes ago holds the gap too (its attempt is recent), and a failed
  // one that ended a minute ago as well.
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 20000, 200, 'success', 300]]) }).dispatched, 0, 'a recent re-run did not hold the gap');
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 20000, 60, 'failure', 900]]) }).dispatched, 0, 'a re-run that just failed did not hold the gap');
  // A re-run of a 6-hour-old run that started 10 minutes ago is not stuck: its attempt is new.
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['in_progress', 21600, 60, null, 600]]) }).dispatched, 0, 'a fresh re-run was called stuck');
  // CONTROLs: an hour queued behind CI on the shared runner, or running after a long wait, is waited on.
  for (const [why, list] of [['queued 1 h', [['queued', 3600]]], ['running, created 2 h 40 min ago', [['in_progress', 9600, 60]]]]) {
    const q = kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs(list) });
    assert.equal(q.dispatched, 0, why);
    assert.equal(q.out, '', why);
  }
});

test('#6266: the 14-minute gap is measured from the newest run by time, whatever order gh lists them in', needJq, () => {
  for (const [ago, want] of [[830, 0], [850, 1]]) {
    assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', ago]]) }).dispatched, want, ago + ' s');
  }
  // Oldest first: the newest (300 s) still holds the tick back.
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 5000], ['completed', 300]]) }).dispatched, 0);
  // An active run behind older finished ones still holds it.
  assert.equal(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 5000], ['in_progress', 1200, 60]]) }).dispatched, 0);
});

test('#6266: a gh failure carries its own first line into the log, so a lost login reads as one', needJq, () => {
  const r = kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 3600]]), FAKE_DISPATCH_FAIL: '1', FAKE_STDERR: 'HTTP 403: Resource not accessible by integration' });
  assert.equal(r.status, 1);
  assert.match(r.out, /could not dispatch the site deploy for main aaaaaaaaa \(gh: HTTP 403: Resource not accessible by integration\)/);
  assert.match(kick(state(), { FAKE_API_FAIL: '1', FAKE_STDERR: 'gh auth login required' }).out, /could not read site main \(owner\/site\) \(gh: gh auth login required\)/);
});

test('#6266: anything it cannot read asks nothing and exits 1 with a line saying what', needJq, () => {
  for (const [why, env, re] of [
    ['api fails', { FAKE_API_FAIL: '1' }, /could not read site main/],
    ['main not a sha', { FAKE_MAIN: 'not found' }, /not a sha/],
    ['main a short sha', { FAKE_MAIN: 'abc123' }, /not a full sha/],
    ['run list fails', { FAKE_LIST_FAIL: '1' }, /could not list site deploy runs/],
    ['run time garbled', { FAKE_RUNS: JSON.stringify([{ status: 'completed', conclusion: 'success', createdAt: '2026-13-45T99:99:99Z', updatedAt: '2026-13-45T99:99:99Z' }]) }, /site deploy run time read as/],
    ['only the start time garbled', { FAKE_RUNS: JSON.stringify([{ status: 'completed', conclusion: 'success', createdAt: iso(3600), updatedAt: iso(3600), startedAt: 'garbled' }]) }, /site deploy run time read as 'garbled'/],
    ['only the update time garbled, on a failed run', { FAKE_RUNS: JSON.stringify([{ status: 'completed', conclusion: 'failure', createdAt: iso(3600), updatedAt: 'garbled' }]) }, /site deploy run time read as 'garbled'/],
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

test('#6266: with no deploy state folder it asks nothing and exits 1 (fails closed)', needJq, () => {
  const r = kick(path.join(SANDBOX, 'no-such-state'), { FAKE_RUNS: runs([['completed', 3600]]) });
  assert.equal(r.status, 1);
  assert.equal(r.dispatched, 0);
  assert.match(r.out, /no deploy state folder at .*no-such-state.*nothing asked/);
});

test('#6266: a hung gh call that ignores SIGALRM (as Go does) is cut off, said as timed out, and asks nothing', () => {
  const t0 = Date.now();
  const r = kick(state({ 'last-deployed': OLD }), { FAKE_SLEEP: '20', FAKE_IGNORE_ALRM: '1', KOSMOS_KICK_GH_TIMEOUT: '1' });
  const took = (Date.now() - t0) / 1000;
  assert.ok(took < 10, 'the call was not cut off (took ' + took + ' s; the fake sleeps 20 s)');
  assert.equal(r.status, 1);
  assert.equal(r.dispatched, 0);
  // kosmos#6305: the hold read is the first gh call now, so a hung gh is cut off there (and the tick holds).
  assert.match(r.out, /could not read the site-deploy hold on owner\/site \(gh: timed out after 1 s\); treated as held, nothing asked/);
});

test('#6266: a tick that cannot make its temporary file still leaves its heartbeat and its result', () => {
  const beatDir = fs.mkdtempSync(path.join(SANDBOX, 'tmpfail-'));
  const r = kick(state({ 'last-deployed': OLD }), { TMPDIR: path.join(SANDBOX, 'no-such-tmp-dir'), KOSMOS_KICK_HEARTBEAT: path.join(beatDir, 'last-tick') });
  assert.equal(r.status, 1);
  assert.equal(r.calls.length, 0, 'gh was called without a place for its error');
  assert.match(r.out, /could not make a temporary file; nothing asked/);
  assert.ok(fs.existsSync(path.join(beatDir, 'last-tick')), 'no heartbeat');
  assert.match(fs.readFileSync(path.join(beatDir, 'last-result'), 'utf8'), / rc=1 could not make a temporary file; nothing asked\n$/);
});

test('#6266: a mistyped --check runs nothing and exits 2', () => {
  const r = kick(state({ 'last-deployed': OLD }), {}, ['--chek']);
  assert.equal(r.status, 2);
  assert.equal(r.calls.length, 0);
  assert.equal(fs.existsSync(r.beat), false);
});

/* The script falls back to gh on PATH, so this can only be asserted where PATH (/usr/bin:/bin here) holds no gh. */
const systemGh = ['/usr/bin/gh', '/bin/gh'].some((p) => fs.existsSync(p));
test('#6266: a gh that is not there says so', { skip: systemGh ? 'a gh on /usr/bin or /bin would be found by the fallback' : false }, () => {
  const none = kick(state({ 'last-deployed': OLD }), { KOSMOS_GH: path.join(SANDBOX, 'no-gh-here') });
  assert.equal(none.status, 1);
  assert.match(none.out, /could not read the site-deploy hold on owner\/site \(gh: perl or gh could not be run \(.*no-gh-here: not found or not executable\?\)\); treated as held/);
});

test('#6266: a hard kill of the tick\'s process group (launchd\'s cleanup of a stopped job) takes gh with it', async () => {
  const { spawn } = require('node:child_process');
  const pf = path.join(SANDBOX, 'gh-pid-' + Math.random().toString(36).slice(2));
  const log = path.join(SANDBOX, 'gh-term.log');
  fs.writeFileSync(log, '');
  const child = spawn('/bin/bash', [KICK], { detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin', KOSMOS_GH: FAKE_GH,
    KOSMOS_AUTODEPLOY_STATE: state({ 'last-deployed': OLD }), KOSMOS_SITE_REPO: 'owner/site', KOSMOS_KICK_HEARTBEAT: path.join(SANDBOX, 'term-beat', 'last-tick'),
    FAKE_LOG: log, FAKE_MAIN: MAIN, FAKE_SLEEP: '30', FAKE_IGNORE_ALRM: '1', FAKE_PIDFILE: pf, KOSMOS_KICK_GH_TIMEOUT: '60' } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let gh = 0;
  try {
    for (let i = 0; i < 50 && !fs.existsSync(pf); i += 1) await wait(100);
    gh = Number(fs.readFileSync(pf, 'utf8').trim());
    assert.ok(gh > 1, 'PRECONDITION: the fake gh started');
    process.kill(-child.pid, 'SIGKILL');   // no handler can run: only gh's place in the group can save it from orphaning
    for (let i = 0; i < 30 && alive(gh); i += 1) await wait(100);
    assert.equal(alive(gh), false, 'gh outlived a hard kill of the tick\'s process group');
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
    if (gh > 1 && alive(gh)) { try { process.kill(gh, 'SIGKILL'); } catch { /* gone */ } }   // never leave the fake behind
  }
});

test('#6266: a TERM to the perl wrapper alone is passed on to gh', async () => {
  const { spawn } = require('node:child_process');
  const pf = path.join(SANDBOX, 'gh-pid-' + Math.random().toString(36).slice(2));
  const ppf = pf + '.perl';
  const log = path.join(SANDBOX, 'gh-wterm.log');
  fs.writeFileSync(log, '');
  const child = spawn('/bin/bash', [KICK], { detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin', KOSMOS_GH: FAKE_GH,
    KOSMOS_AUTODEPLOY_STATE: state({ 'last-deployed': OLD }), KOSMOS_SITE_REPO: 'owner/site', KOSMOS_KICK_HEARTBEAT: path.join(SANDBOX, 'wterm-beat', 'last-tick'),
    FAKE_LOG: log, FAKE_MAIN: MAIN, FAKE_SLEEP: '30', FAKE_IGNORE_ALRM: '1', FAKE_PIDFILE: pf, FAKE_PPIDFILE: ppf, KOSMOS_KICK_GH_TIMEOUT: '60' } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let gh = 0;
  try {
    for (let i = 0; i < 50 && !(fs.existsSync(pf) && fs.existsSync(ppf)); i += 1) await wait(100);
    gh = Number(fs.readFileSync(pf, 'utf8').trim());
    const perl = Number(fs.readFileSync(ppf, 'utf8').trim());
    assert.ok(gh > 1 && perl > 1 && perl !== child.pid, 'PRECONDITION: the fake gh and its perl wrapper started');
    process.kill(perl, 'SIGTERM');   // only the wrapper: without its handler gh would be left running
    for (let i = 0; i < 50 && alive(gh); i += 1) await wait(100);
    assert.equal(alive(gh), false, 'a TERM to the wrapper was not passed on to gh');
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
    if (gh > 1 && alive(gh)) { try { process.kill(gh, 'SIGKILL'); } catch { /* gone */ } }
  }
});

test('#6266: a gh time limit of 0 (no limit to perl) is refused and the default used', needJq, () => {
  const r = kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 3600]]), KOSMOS_KICK_GH_TIMEOUT: '0' }, ['--check']);
  assert.match(r.out, /check: each gh call is limited to 90 s/);
  assert.match(kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 3600]]), KOSMOS_KICK_GH_TIMEOUT: '7' }, ['--check']).out, /limited to 7 s/, 'CONTROL');
});

test('#6266: --check says what a tick would decide and dispatches nothing', needJq, () => {
  const r = kick(state({ 'last-deployed': OLD }), { FAKE_RUNS: runs([['completed', 3600]]) }, ['--check']);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.dispatched, 0);
  assert.match(r.out, /check: site main aaaaaaaaa, last deployed bbbbbbbbb/);
  assert.match(r.out, /check: would ask for a site deploy/);
  assert.equal(fs.existsSync(r.beat), false, 'a check is not a tick');
  assert.equal(fs.existsSync(path.join(path.dirname(r.beat), 'last-result')), false, 'a check leaves no result');
});

test('#6266: each tick leaves its exit code and last line in last-result, and --check shows it', needJq, () => {
  const st = state({ 'last-deployed': OLD });
  const beatDir = fs.mkdtempSync(path.join(SANDBOX, 'beatdir-'));
  const env = { FAKE_RUNS: runs([['completed', 3600]]), FAKE_DISPATCH_FAIL: '1', FAKE_STDERR: 'HTTP 401', KOSMOS_KICK_HEARTBEAT: path.join(beatDir, 'last-tick') };
  const r = kick(st, env);
  assert.equal(r.status, 1);
  const result = fs.readFileSync(path.join(beatDir, 'last-result'), 'utf8');
  assert.match(result, / rc=1 could not dispatch the site deploy for main aaaaaaaaa \(gh: HTTP 401\)\n$/);
  const c = kick(st, { ...env, FAKE_DISPATCH_FAIL: '' }, ['--check']);
  assert.match(c.out, /check: last tick: .* rc=1 could not dispatch/);
  // A garbled run time records its reason, not "(quiet)" (the line was said in a subshell).
  kick(st, { FAKE_RUNS: JSON.stringify([{ status: 'completed', conclusion: 'success', createdAt: 'x', updatedAt: 'x' }]), KOSMOS_KICK_HEARTBEAT: path.join(beatDir, 'last-tick') });
  assert.match(fs.readFileSync(path.join(beatDir, 'last-result'), 'utf8'), / rc=1 site deploy run time read as 'x'; nothing asked\n$/);
  // A stuck run that is then asked past keeps the stuck reason in last-result.
  kick(st, { FAKE_RUNS: runs([['queued', 12000]]), KOSMOS_KICK_HEARTBEAT: path.join(beatDir, 'last-tick') });
  assert.match(fs.readFileSync(path.join(beatDir, 'last-result'), 'utf8'), / rc=1 asked for a site deploy: .*; and a site deploy run has been queued since .* past its limit/);
  // A quiet tick (main deployed) records rc=0 (quiet).
  kick(state({ 'last-deployed': MAIN }), { KOSMOS_KICK_HEARTBEAT: path.join(beatDir, 'last-tick') });
  assert.match(fs.readFileSync(path.join(beatDir, 'last-result'), 'utf8'), / rc=0 \(quiet\)\n$/);
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
  // The installed copy records its kosmos commit: a real sha here (this runs in a checkout); "unknown" only without git.
  const head = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const want = head.status === 0 ? new RegExp('^' + head.stdout.trim() + '(-dirty)?\\n$') : /^unknown\n$/;
  assert.match(fs.readFileSync(path.join(dir, 'source'), 'utf8'), want);
  const u = spawnSync('/bin/bash', [INSTALL, '--uninstall'], { encoding: 'utf8', env });
  assert.equal(u.status, 0);
  assert.equal(fs.existsSync(plist), false);
  assert.equal(fs.existsSync(dir), false, 'the folder (and a leftover .new) was not removed');
  assert.match(fs.readFileSync(lc, 'utf8'), /bootout gui\/\d+\/com\.stonesyndicate\.kosmos-site-deploy-kick/);
});

test('#6266: the installer retries a refused load once, and says what to run when launchd still refuses', () => {
  const home = fs.mkdtempSync(path.join(SANDBOX, 'home-retry-'));
  const count = path.join(SANDBOX, 'bootstrap-count');
  const flaky = path.join(SANDBOX, 'launchctl-flaky');
  // Refuses the first bootstrap (launchd still tearing the old job down), accepts the second.
  fs.writeFileSync(flaky, `#!/bin/bash\n[ "$1" = bootstrap ] || exit 0\nn=$(($(cat "${count}" 2>/dev/null || echo 0) + 1)); echo $n > "${count}"\n[ $n -ge 2 ]\n`, { mode: 0o755 });
  const ok = spawnSync('/bin/bash', [INSTALL], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', KOSMOS_KICK_HOME: home, KOSMOS_LAUNCHCTL: flaky } });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(fs.readFileSync(count, 'utf8').trim(), '2');
  const never = path.join(SANDBOX, 'launchctl-never');
  fs.writeFileSync(never, '#!/bin/bash\n[ "$1" = bootstrap ] && exit 5\nexit 0\n', { mode: 0o755 });
  const bad = spawnSync('/bin/bash', [INSTALL], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', KOSMOS_KICK_HOME: home, KOSMOS_LAUNCHCTL: never } });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /launchd did not load com\.stonesyndicate\.kosmos-site-deploy-kick; if it was disabled, run: launchctl enable/);
});

test('kosmos#6305: a site-deploy hold (the SITE_DEPLOY_HOLD variable set) asks nothing and says why', needJq, () => {
  const r = kick(state({ 'last-deployed': OLD + '\n' }), { FAKE_RUNS: runs([['completed', 3600]]), FAKE_HOLD: 'promoting 0.7.51' });
  assert.equal(r.status, 0, r.out);
  assert.equal(r.dispatched, 0, 'a held site was deployed: ' + r.calls.join('\n'));
  assert.match(r.out, /held: promoting 0\.7\.51 \(SITE_DEPLOY_HOLD on owner\/site\); nothing asked/, r.out);
  // CONTROL: the same tick with no hold (the variable absent, a 404) dispatches, as before.
  const c = kick(state({ 'last-deployed': OLD + '\n' }), { FAKE_RUNS: runs([['completed', 3600]]) });
  assert.equal(c.dispatched, 1, c.out);
});

test('kosmos#6305: a hold that cannot be read is treated as held (nothing asked, a failing tick)', needJq, () => {
  const r = kick(state({ 'last-deployed': OLD + '\n' }), { FAKE_RUNS: runs([['completed', 3600]]), FAKE_HOLD_FAIL: '1' });
  assert.equal(r.status, 1, r.out);
  assert.equal(r.dispatched, 0, 'an unreadable hold let a deploy through: ' + r.calls.join('\n'));
  assert.match(r.out, /could not read the site-deploy hold on owner\/site \(gh: gh: Bad credentials \(HTTP 401\)\); treated as held, nothing asked/, r.out);
});

test('kosmos#6305: a hold read that fails silently (exit 1, no words) is still a failed read, not a set hold', needJq, () => {
  const r = kick(state({ 'last-deployed': OLD + '\n' }), { FAKE_RUNS: runs([['completed', 3600]]), FAKE_HOLD_SILENT: '1' });
  assert.equal(r.status, 1, r.out);
  assert.equal(r.dispatched, 0, r.calls.join('\n'));
  assert.match(r.out, /could not read the site-deploy hold on owner\/site \(gh failed, no reason given\); treated as held/, r.out);
  assert.doesNotMatch(r.out, /held: +\(SITE_DEPLOY_HOLD/, 'a failed read was reported as a set hold');
});

test('kosmos#6305: a hold reason with line breaks stays one line', needJq, () => {
  const r = kick(state({ 'last-deployed': OLD + '\n' }), { FAKE_HOLD: 'promoting\n0.7.51' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /held: promoting 0\.7\.51 \(SITE_DEPLOY_HOLD/, r.out);
});

