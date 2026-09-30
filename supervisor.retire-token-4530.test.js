'use strict';
/**
 * #4530: on a Mac, a run's sender token must stop being a credential once that run is over.
 * Before this, nothing retired it (only the Windows path called retire), so every past launch
 * of an agent stayed a valid token until 32 newer ones pushed it out: Scorpion had 18.
 *
 * This executes the shipped supervisor against the REAL token store (engine/sendertoken.js,
 * sandboxed by AGENT_WORKFORCE_DATA) and a tmux stand-in that keeps session state in a folder:
 * a session is alive while `alive` exists there, and options set on it are files. The runner
 * records the token it was handed. `sleep` is shimmed short so the supervision loop turns fast.
 *
 *   RELAUNCH  a run whose supervisor was killed (so nothing retired its token) and whose
 *             session then ended is relaunched: the agent has exactly ONE live token, the new
 *             run's, and the previous one no longer resolves. RED on main (two live tokens).
 *   EXIT      a run whose session ends is retired by its own supervisor: no live token is left.
 *   ADOPT     a supervisor restarted mid-run adopts the live session, never mints, and still
 *             retires that run's token when the session ends (it reads the session's record).
 *   OTHERS    a remote agent's token (tagged `remote`) survives a launch and an exit.
 *   UNTAGGED  a token minted before #4530 (no launcher) is retired by a LAUNCH, but kept when the
 *             -discord twin has a session (it shares the token file and may be running on it) and
 *             when the supervisor ADOPTS a live run (that run's own pre-#4530 token is untagged).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const REPO = __dirname;
const SHIPPED = process.env.SUPERVISOR_UNDER_TEST || path.join(REPO, 'bin', 'agent-supervisor.sh');
const NAME = 'relaunch4530';

function fixture(runnerKind = 'claude') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-retire-token-4530-'));
  for (const dir of ['bin', 'data', 'work', 'state', 'shim', 'home']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.symlinkSync(SHIPPED, path.join(root, 'bin', 'agent-supervisor.sh'));
  fs.symlinkSync(path.join(REPO, 'engine'), path.join(root, 'engine'));   // the real sendertoken.js
  const evidence = path.join(root, 'tokens.txt');
  const runner = path.join(root, 'runner.sh');
  const version = runnerKind === 'antigravity' ? 'agy 1.2.10' : '2.1.282 (Claude Code)';
  fs.writeFileSync(runner, `#!/bin/bash\n[ "\${1:-}" = --version ] && { echo "${version}"; exit 0; }\nprintf "%s\\n" "\${KOSMOS_AGENT_TOKEN:-<missing>}" >> "$EVIDENCE"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'shim', 'sleep'), '#!/bin/bash\n/bin/sleep 0.1\n', { mode: 0o755 });
  const tmux = path.join(root, 'tmux.sh');
  fs.writeFileSync(tmux, [
    '#!/bin/bash',
    'S="$TMUX_STATE"',
    'case "${1:-}" in',
    /* FLAKE_ONCE: the next has-session fails like a tmux binary mid-swap (127), once. */
    /* FLAKE_ONES: the next N has-session calls answer 1 ("no such session") while it is alive. */
    '  has-session) if [ -f "$S/flake" ]; then rm -f "$S/flake"; exit 127; fi;',
    '    if [ -s "$S/ones" ]; then n=$(cat "$S/ones"); if [ "$n" -gt 0 ]; then echo $((n - 1)) > "$S/ones"; exit 1; fi; fi;',
    '    [ -f "$S/alive" ]; exit $? ;;',
    /* A plain-name target falls back to a PREFIX match when the exact session is gone, as
       tmux does (measured): it then reaches the -discord twin, whose options are twin-opt-*. */
    '  show-options) for a in "$@"; do last="$a"; done; p="opt"; [ -f "$S/alive" ] || p="twin-opt"; f="$S/$p-${last#@}"; [ -f "$f" ] && cat "$f"; exit 0 ;;',
    /* An option set through the session id ($1) lands on the session; anything else is refused,
       as tmux refuses a dead or unknown target. */
    '  set-option) t=""; [ "$2" = -t ] && t="$3"; while [ "$#" -gt 2 ]; do shift; done;',
    '    case "$t" in \\$1) [ -f "$S/alive" ] || exit 1; printf "%s" "$2" > "$S/opt-${1#@}" ;; \\$2) printf "%s" "$2" > "$S/twin-opt-${1#@}" ;;',
    '      *) if [ -f "$S/alive" ]; then printf "%s" "$2" > "$S/opt-${1#@}"; else printf "%s" "$2" > "$S/twin-opt-${1#@}"; fi ;; esac; exit 0 ;;',
    /* list-sessions: this agent's session (when alive) plus a -discord twin that always lives. */
    '  list-sessions) fmt="$3";',
    /* The names alone (#4530's twin check). NOTWIN: the -discord twin has no session. */
    '    if [ "$fmt" = "#{session_name}" ]; then [ -f "$S/notwin" ] || printf "%s\\n" "$NAME-discord"; [ -f "$S/alive" ] && printf "%s\\n" "$NAME"; exit 0; fi',
    /* The twin is listed FIRST, so a read that takes the first row or matches by prefix gets the twin's run. */
    '    case "$fmt" in *session_id*) printf "%s\\t%s\\n" "$NAME-discord" "\\$2" ;; *token_instance*) printf "%s\\t%s\\n" "$NAME-discord" "abcabcabcabc" ;; esac',
    '    if [ -f "$S/alive" ]; then case "$fmt" in *session_id*) printf "%s\\t%s\\n" "$NAME" "\\$1" ;; *token_instance*) printf "%s\\t%s\\n" "$NAME" "$(cat "$S/opt-kosmos_token_instance" 2>/dev/null)" ;; esac; fi',
    '    exit 0 ;;',
    '  list-panes) printf "claude\\n"; exit 0 ;;',
    '  new-session)',
    '    shift',
    '    while [ "$#" -gt 0 ]; do',
    '      case "$1" in',
    '        -d) shift ;;',
    '        -P) print_pane=1; shift ;;',
    '        -s|-c|-F) shift 2 ;;',
    '        -e) export "$2"; shift 2 ;;',
    '        *) break ;;',
    '      esac',
    '    done',
    '    [ -f "$S/refuse" ] && exit 1',
    '    [ -f "$S/dieatonce" ] || touch "$S/alive"',
    '    "$@" >/dev/null 2>&1',
    '    [ -n "${print_pane:-}" ] && printf "%%4530\\n"',
    '    exit 0 ;;',
    '  kill-session) rm -f "$S/alive"; exit 0 ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
  const env = {
    PATH: path.join(root, 'shim') + ':' + process.env.PATH,
    HOME: path.join(root, 'home'),
    EVIDENCE: evidence,
    TMUX_STATE: path.join(root, 'state'),
    NAME,
    AGENT_WORKFORCE_HOME: root,
    AGENT_WORKFORCE_DATA: path.join(root, 'data'),
    AGENT_WORKFORCE_CLAUDE_CONFIG: path.join(root, 'home', '.claude.json'),
    CLAUDE_CONFIG_DIR: path.join(root, 'home', '.claude'),
  };
  const args = [path.join(root, 'bin', 'agent-supervisor.sh'), NAME, path.join(root, 'work'), runner, tmux, '', '', runnerKind];
  const tokens = () => (fs.existsSync(evidence) ? fs.readFileSync(evidence, 'utf8').split('\n').filter(Boolean) : []);
  /* The store is read in a child process with the same data root, so this file never
     freezes store.ROOT on the real Application Support. */
  const store = (expr) => {
    const r = spawnSync(process.execPath, ['-e', `const s = require(${JSON.stringify(path.join(REPO, 'engine', 'sendertoken.js'))}); process.stdout.write(JSON.stringify(${expr}));`],
      { encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_DATA: env.AGENT_WORKFORCE_DATA } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const live = () => store(`s.live(${JSON.stringify(NAME)})`);
  const resolves = (token) => store(`s.resolveName(${JSON.stringify(token)}).ok`);
  const kids = [];
  const start = () => { const c = spawn('/bin/bash', args, { env, stdio: 'ignore' }); kids.push(c); return c; };
  const ends = (child) => new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const until = async (fn, what) => {
    for (let i = 0; i < 300; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); }
    assert.fail('timed out waiting for ' + what);
  };
  /* Like until, but hands back whether it came true instead of failing, for a state the
     supervisor reaches a moment AFTER the evidence appears (the sweep runs after the claim). */
  const settles = async (fn) => {
    for (let i = 0; i < 200; i++) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
    return false;
  };
  const endSession = () => fs.rmSync(path.join(root, 'state', 'alive'), { force: true });
  const flag = (name) => fs.writeFileSync(path.join(root, 'state', name), '');
  /* A failing arm stops before it ends its session, and a supervisor watching a live session never
     exits: end the session AND stop every supervisor this arm started, or the file never finishes
     (seen on main, where the arms fail early). */
  const cleanup = () => {
    fs.rmSync(path.join(root, 'state', 'alive'), { force: true });
    for (const c of kids) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  return { root, tokens, live, resolves, start, ends, until, settles, endSession, flag, cleanup, store };
}

test('#4530 RELAUNCH: after a relaunch the agent has exactly one live token, and the previous one does not resolve', async () => {
  const f = fixture();
  try {
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the first run to receive its token');
    const [t1] = f.tokens();
    assert.match(t1, /^[0-9a-f]{64}$/, 'the first run did not get a real token');
    assert.equal(f.resolves(t1), true, 'CONTROL: the first run\'s token resolves while it runs');
    /* The first supervisor dies without seeing its run end (a crash, a kill -9), so only the
       relaunch itself can retire that token; then the session ends. */
    one.kill('SIGKILL');
    await f.ends(one);
    f.endSession();

    const two = f.start();
    await f.until(() => f.tokens().length === 2, 'the relaunched run to receive its token');
    const t2 = f.tokens()[1];
    assert.notEqual(t2, t1);
    /* The token reaches the runner at new-session; the earlier runs are retired just after, once
       the session is claimed. So wait (up to 10s) for one live token rather than reading at once. */
    const one1 = await f.settles(() => f.live().length === 1);
    const n = f.live().length;
    assert.ok(one1 && n === 1, `a relaunch left ${n} live tokens for the agent`);
    assert.equal(f.resolves(t1), false, 'the previous run\'s token still resolves after a relaunch');
    assert.equal(f.resolves(t2), true, 'the relaunched run\'s own token does not resolve');
    f.endSession();
    await f.ends(two);
  } finally { f.cleanup(); }
});

test('#4530 EXIT: when a run\'s session ends, its supervisor retires that run\'s token', async () => {
  const f = fixture();
  try {
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the run to receive its token');
    const [t1] = f.tokens();
    assert.equal(f.live().length, 1, 'CONTROL: the running agent holds one live token');
    f.endSession();
    const how = await f.ends(one);
    assert.equal(how.code, 0, 'the supervisor did not exit cleanly after its session ended');
    assert.deepEqual(f.live(), [], 'a run that ended left its token live');
    assert.equal(f.resolves(t1), false, 'an ended run\'s token still resolves');
  } finally { f.cleanup(); }
});

test('#4530 ADOPT: a supervisor restarted mid-run retires the adopted run\'s token when the session ends', async () => {
  const f = fixture();
  try {
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the run to receive its token');
    const [t1] = f.tokens();
    /* The runner gets its token inside new-session, before the supervisor stamps the run on the
       session: kill before the stamp and there is nothing for an adopter to read (flaky, iteration 3). */
    await f.until(() => fs.existsSync(path.join(f.root, 'state', 'opt-kosmos_token_instance')), 'the run to be recorded on its session');
    one.kill('SIGKILL');   // the supervisor restarts (an update, a launchd reload) while the run lives on
    await f.ends(one);
    assert.equal(f.resolves(t1), true, 'CONTROL: the live run kept its token when its supervisor died');

    const two = f.start();
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(f.tokens().length, 1, 'the restarted supervisor launched a second run instead of adopting the live one');
    assert.equal(f.resolves(t1), true, 'adopting the live run cut its token off while it was still running');
    f.endSession();
    await f.ends(two);
    assert.equal(f.resolves(t1), false, 'the adopted run\'s token still resolves after its session ended');
  } finally { f.cleanup(); }
});

test('#4530 OTHERS: a launch and an exit leave a remote agent\'s token alone (tagged remote)', async () => {
  const f = fixture();
  try {
    f.flag('notwin');   // so the untagged sweep runs, and this proves it spares a tagged remote token
    const remote = f.store(`(() => { const m = s.mint(${JSON.stringify(NAME)}, { launcher: 'remote' }); return m.token; })()`);
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the run to receive its token');
    assert.equal(f.resolves(remote), true, 'launching swept a token it did not mint');
    f.endSession();
    await f.ends(one);
    assert.equal(f.resolves(remote), true, 'the run\'s exit retired a token it did not mint');
    assert.equal(f.live().length, 1, 'only the remote token should be left');
  } finally { f.cleanup(); }
});

/* Every runner that launches differently: Antigravity makes its session itself (it needs the pane id)
   instead of through launch_pane, and review iteration 2 found it losing a live token on exit. */
for (const kind of ['claude', 'antigravity']) {
  test(`#4530 FLAKE (${kind}): a tmux that fails to answer once does not retire a live run's token`, async () => {
    const f = fixture(kind);
    try {
      const one = f.start();
      await f.until(() => f.tokens().length === 1, 'the run to receive its token');
      const [t1] = f.tokens();
      f.flag('flake');   // the next has-session exits 127 while the session is still alive
      await f.ends(one);
      assert.equal(fs.existsSync(path.join(f.root, 'state', 'alive')), true, 'CONTROL: the session is still alive');
      assert.equal(f.resolves(t1), true, 'one failed has-session retired a live agent\'s token');
    } finally { f.cleanup(); }
  });

  test(`#4530 STOPPED (${kind}): a supervisor stopped while its run lives does not take the run's token with it`, async () => {
    const f = fixture(kind);
    try {
      const one = f.start();
      await f.until(() => f.tokens().length === 1, 'the run to receive its token');
      const [t1] = f.tokens();
      await new Promise((r) => setTimeout(r, 500));   // past the launch, into the supervision loop
      one.kill('SIGTERM');   // launchctl bootout, a logout, a manual stop
      await f.ends(one);
      assert.equal(f.resolves(t1), true, 'stopping the supervisor retired its live run\'s token');
    } finally { f.cleanup(); }
  });
}

test('#4530 ONES: "no such session" answered once more after the loop, by a session that is alive, retires nothing', async () => {
  const f = fixture();
  try {
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the run to receive its token');
    const [t1] = f.tokens();
    /* Two wrong answers of 1: the loop's own check, then the first check after it. Only the second,
       two seconds later, sees the session, so this arm fails if that second check is removed. */
    fs.writeFileSync(path.join(f.root, 'state', 'ones'), '2');
    await f.ends(one);
    assert.equal(fs.readFileSync(path.join(f.root, 'state', 'ones'), 'utf8').trim(), '0', 'CONTROL: both wrong answers were used');
    assert.equal(f.resolves(t1), true, 'a session that answered "gone" once too often lost its live token');
  } finally { f.cleanup(); }
});

test('#4530 LOSER: a launch that mints and then loses the session name retires only its own token', async () => {
  const f = fixture();
  try {
    /* The winner: a live run of this session, minted the way the supervisor mints. */
    const winner = f.store(`s.mint(${JSON.stringify(NAME)}, { launcher: 'supervisor:' + ${JSON.stringify(NAME)} })`);
    f.flag('refuse');   // new-session fails: the name was taken between the check and the launch
    const how = await f.ends(f.start());
    assert.notEqual(how.code, 0, 'CONTROL: the refused launch should have failed');
    assert.deepEqual(f.live(), [winner.instance], 'the losing launch cut off the winner, or kept its own token');
    assert.equal(f.resolves(winner.token), true);
  } finally { f.cleanup(); }
});

test('#4530 TWIN, adopt: the adopter reads THIS session\'s run, not the -discord twin listed before it (exact name, not first row or prefix)', async () => {
  const f = fixture();
  try {
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the run to receive its token');
    const opt = path.join(f.root, 'state', 'opt-kosmos_token_instance');
    await f.until(() => fs.existsSync(opt), 'the run to be recorded on its session');
    one.kill('SIGKILL');
    await f.ends(one);
    const recorded = fs.readFileSync(opt, 'utf8');
    assert.match(recorded, /^[0-9a-f]{12}$/, 'the run did not record its instance on its session');
    const two = f.start();   // adopts, and must read THIS session's record, not the twin's
    await new Promise((r) => setTimeout(r, 1500));
    f.endSession();
    await f.ends(two);
    assert.deepEqual(f.live(), [], 'the adopted run\'s own token was not the one retired');
  } finally { f.cleanup(); }
});

test('#4530 TWIN, launch race: a run whose session dies at once never stamps its instance on the -discord twin', async () => {
  const f = fixture();
  try {
    f.flag('dieatonce');   // the runner starts and its session is gone before the claim
    await f.ends(f.start());
    assert.equal(f.tokens().length, 1, 'CONTROL: the run did start and receive its token');
    assert.equal(fs.existsSync(path.join(f.root, 'state', 'twin-opt-kosmos_token_instance')), false,
      'the run\'s instance was written onto the -discord twin by a prefix match');
  } finally { f.cleanup(); }
});

/* An untagged token: what every Mac launch minted before #4530 (and what adopt.js mints). */
const mintUntagged = (f) => f.store(`(() => { const m = s.mint(${JSON.stringify(NAME)}); return m.token; })()`);
/* A past run of the SAME launcher, so an arm can see that the sweep has run before judging what it kept. */
const mintPastRun = (f) => f.store(`(() => { const m = s.mint(${JSON.stringify(NAME)}, { launcher: 'supervisor:${NAME}' }); return m.token; })()`);

test('#4530 UNTAGGED, launch: a token minted before #4530 is retired by the next launch', async () => {
  const f = fixture();
  try {
    f.flag('notwin');
    const old = mintUntagged(f);
    assert.equal(f.resolves(old), true, 'CONTROL: the pre-#4530 token resolves before the launch');
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the run to receive its token');
    const [t1] = f.tokens();
    assert.ok(await f.settles(() => !f.resolves(old)), 'a launch left a pre-#4530 (untagged) token valid');
    assert.equal(f.resolves(t1), true, 'the launch retired its own run\'s token');
    assert.equal(f.live().length, 1, 'more than the new run\'s token is live after the launch');
    f.endSession();
    await f.ends(one);
  } finally { f.cleanup(); }
});

test('#4530 UNTAGGED, twin: an untagged token is kept while the -discord twin has a session', async () => {
  const f = fixture();   // the stand-in lists the twin
  try {
    const twinRun = mintUntagged(f);   // may be the twin's live pre-#4530 run: same token file
    const past = mintPastRun(f);
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the run to receive its token');
    assert.ok(await f.settles(() => !f.resolves(past)), 'CONTROL: the sweep never ran (a past run of this launcher is still valid)');
    assert.equal(f.resolves(twinRun), true, 'a launch cut off a token the live -discord twin may be running on');
    f.endSession();
    await f.ends(one);
  } finally { f.cleanup(); }
});

test('#4530 UNTAGGED, adopt: adopting a live run never retires untagged tokens', async () => {
  const f = fixture();
  try {
    f.flag('notwin');
    const before = mintUntagged(f);   // the first launch's sweep retires this; seeing it gone means the sweep is over
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the run to receive its token');
    await f.until(() => fs.existsSync(path.join(f.root, 'state', 'opt-kosmos_token_instance')), 'the run to be recorded on its session');
    /* #4666: the sweep runs after the session is recorded, in a node process a SIGKILL of the supervisor does not
       stop. Killed before it finished, that sweep went on to retire the token minted below (seen under load). */
    assert.ok(await f.settles(() => !f.resolves(before)), 'CONTROL: the first launch\'s sweep never retired an earlier untagged token');
    one.kill('SIGKILL');   // an update restarts the supervisor while the run lives on
    await f.ends(one);
    const live = mintUntagged(f);   // stands for a live run's own pre-#4530 token
    const two = f.start();
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(f.tokens().length, 1, 'CONTROL: the restarted supervisor adopted, it did not launch');
    assert.equal(f.resolves(live), true, 'adopting a live run retired an untagged token');
    f.endSession();
    await f.ends(two);
  } finally { f.cleanup(); }
});
