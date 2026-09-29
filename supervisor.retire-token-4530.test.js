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
 *   OTHERS    a token with no launcher (a remote agent's, or one minted before #4530) survives.
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

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-retire-token-4530-'));
  for (const dir of ['bin', 'data', 'work', 'state', 'shim', 'home']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.symlinkSync(SHIPPED, path.join(root, 'bin', 'agent-supervisor.sh'));
  fs.symlinkSync(path.join(REPO, 'engine'), path.join(root, 'engine'));   // the real sendertoken.js
  const evidence = path.join(root, 'tokens.txt');
  const runner = path.join(root, 'runner.sh');
  fs.writeFileSync(runner, '#!/bin/bash\n[ "${1:-}" = --version ] && { echo "2.1.282 (Claude Code)"; exit 0; }\nprintf "%s\\n" "${KOSMOS_AGENT_TOKEN:-<missing>}" >> "$EVIDENCE"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'shim', 'sleep'), '#!/bin/bash\n/bin/sleep 0.1\n', { mode: 0o755 });
  const tmux = path.join(root, 'tmux.sh');
  fs.writeFileSync(tmux, [
    '#!/bin/bash',
    'S="$TMUX_STATE"',
    'case "${1:-}" in',
    /* FLAKE_ONCE: the next has-session fails like a tmux binary mid-swap (127), once. */
    '  has-session) if [ -f "$S/flake" ]; then rm -f "$S/flake"; exit 127; fi; [ -f "$S/alive" ]; exit $? ;;',
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
    '    if [ -f "$S/alive" ]; then case "$fmt" in *session_id*) printf "%s\\t%s\\n" "$NAME" "\\$1" ;; *token_instance*) printf "%s\\t%s\\n" "$NAME" "$(cat "$S/opt-kosmos_token_instance" 2>/dev/null)" ;; esac; fi',
    '    case "$fmt" in *session_id*) printf "%s\\t%s\\n" "$NAME-discord" "\\$2" ;; *token_instance*) printf "%s\\t%s\\n" "$NAME-discord" "abcabcabcabc" ;; esac',
    '    exit 0 ;;',
    '  list-panes) printf "claude\\n"; exit 0 ;;',
    '  new-session)',
    '    shift',
    '    while [ "$#" -gt 0 ]; do',
    '      case "$1" in',
    '        -d) shift ;;',
    '        -P) shift ;;',
    '        -s|-c|-F) shift 2 ;;',
    '        -e) export "$2"; shift 2 ;;',
    '        *) break ;;',
    '      esac',
    '    done',
    '    [ -f "$S/refuse" ] && exit 1',
    '    [ -f "$S/dieatonce" ] || touch "$S/alive"',
    '    "$@" >/dev/null 2>&1',
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
  const args = [path.join(root, 'bin', 'agent-supervisor.sh'), NAME, path.join(root, 'work'), runner, tmux, '', '', 'claude'];
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
  const start = () => spawn('/bin/bash', args, { env, stdio: 'ignore' });
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
  const cleanup = () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } };
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

test('#4530 OTHERS: a relaunch leaves a token with no launcher alone (a remote agent\'s, or one minted before #4530)', async () => {
  const f = fixture();
  try {
    const remote = f.store(`(() => { const m = s.mint(${JSON.stringify(NAME)}); return m.token; })()`);
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the run to receive its token');
    assert.equal(f.resolves(remote), true, 'launching swept a token it did not mint');
    f.endSession();
    await f.ends(one);
    assert.equal(f.resolves(remote), true, 'the run\'s exit retired a token it did not mint');
    assert.equal(f.live().length, 1, 'only the remote token should be left');
  } finally { f.cleanup(); }
});

test('#4530 FLAKE: a tmux that fails to answer once does not retire a live run\'s token', async () => {
  const f = fixture();
  try {
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the run to receive its token');
    const [t1] = f.tokens();
    f.flag('flake');   // the next has-session exits 127 while the session is still alive
    await f.ends(one);
    assert.equal(fs.existsSync(path.join(f.root, 'state', 'alive')), true, 'CONTROL: the session is still alive');
    assert.equal(f.resolves(t1), true, 'one failed has-session retired a live agent\'s token');
    f.endSession();
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

test('#4530 TWIN: the -discord twin\'s run is never read as this session\'s (exact names, not prefixes)', async () => {
  const f = fixture();
  try {
    const one = f.start();
    await f.until(() => f.tokens().length === 1, 'the run to receive its token');
    one.kill('SIGKILL');
    await f.ends(one);
    const opt = path.join(f.root, 'state', 'opt-kosmos_token_instance');
    const recorded = fs.readFileSync(opt, 'utf8');
    assert.match(recorded, /^[0-9a-f]{12}$/, 'the run did not record its instance on its session');
    assert.notEqual(recorded, 'abcabcabcabc', 'the record landed on the twin');
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
