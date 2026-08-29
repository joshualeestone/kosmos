'use strict';

/**
 * Status engine.
 *
 * Derives the state of every agent on this machine. Read-only: it runs tmux
 * queries and reads files, and never writes, sends keys, or starts anything.
 *
 * The one rule that shapes the whole file: an agent we cannot read must come
 * out as `unknown`, never as something healthy. Most monitoring bugs are the
 * same shape -- the check cannot tell "fine" from "I can't see it" and renders
 * green. Every field here therefore carries how it was determined, so the UI
 * can show confidence rather than implying certainty it does not have.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('./store');
const selfreport = require('./selfreport');
/* The two halves the pane used to supply on its own: the token store says
   WHICH agent, the liveness record says it is STILL RUNNING. Neither module
   requires this one, so there is no cycle. */
const sendertoken = require('./sendertoken');
const liveness = require('./liveness');
/* For SESSION only: the sign-in flow's own tmux session name, defined once
   where the session is created. No cycle: connect never requires status. */
const connect = require('./connect');
const { readWorkerFile } = require('./workerfile');

/* 🛑 A FUNCTION, NOT A CONST (#1432). Frozen at require time this read past
   the sandbox seam: a caller setting the seam AFTER requiring this module
   operated on the operator's real machine while believing it was sandboxed.
   Measured in this class: `accounts.list()` returned four of the operator's
   real accounts against an empty fixture (#1419), and `delete-leftover`'s
   TRASH() resolved to the operator's real ~/.Trash (#1432). */
function homeDir() { return os.homedir(); }

/**
 * Claude Code config roots.
 *
 * There is usually one (`~/.claude`), but an agent launched with
 * CLAUDE_CONFIG_DIR pointing elsewhere keeps its transcripts and its registry
 * entry under that root instead. On this fleet the two agents billed to a
 * second subscription run with `CLAUDE_CONFIG_DIR=~/.claude-account-b`, and a
 * reader that only knows about `~/.claude` reports them as unreadable while
 * their data sits in plain sight one directory over.
 *
 * So we discover roots rather than assuming one. The alternative -- parsing
 * launch scripts for the variable -- couples us to how agents happen to be
 * started on one machine.
 */
function configRoots() {
  // ⚠️ An override, so a test can point this at a sandbox. Without one, the
  // only way to give a fixture a registry entry and a transcript was to write
  // into the operator's REAL `~/.claude` — which the test suite did: it planted
  // a phantom `ghostly-discord_0.0.json` beside fifteen live agents and a
  // phantom `projects/seeded/` directory, and removed neither. Fleet tooling
  // that scans `agent-registry` would have picked it up.
  //
  // Worse for the suite itself: because the files persisted between runs, the
  // test's own anti-vacuity check ("the fixture stopped seeding, so these nulls
  // are vacuous again") passed off the PREVIOUS run's leftovers. Deleting the
  // seeding would have left the suite green forever on any machine that had run
  // it once.
  if (process.env.AGENT_WORKFORCE_CONFIG_ROOT) {
    return [process.env.AGENT_WORKFORCE_CONFIG_ROOT];
  }

  /* 🛑 A SANDBOXED PROCESS MUST NOT READ THE OPERATOR'S REAL AGENTS.
     Setting the variable in one harness fixes that harness. This refuses for
     every harness anyone writes next, including the one that does not exist
     yet and will forget, which is exactly what happened when #1134 fixed
     docs/browser-checks/thread-server.js and left tools/browser-checks.sh
     reading this Mac for weeks.

     ⭐ IT KEYS ON AN INCONSISTENT SANDBOX, NOT ON "am I a test". A process
     whose data dir is a temp dir has declared itself a fixture; if its homeDir() is
     still the real one, the scan below is about to walk the operator's machine
     and every assertion downstream becomes a fact about whoever ran it.

     ⚠️ DIRECTION IS DELIBERATE: it can only ever stop a fixture, never a user.
     Production sets AGENT_WORKFORCE_DATA to Application Support, which is not
     under the temp dir, so this cannot fire for somebody running Kosmos. A
     test that sandboxes homeDir() instead of CONFIG_ROOT is already safe and is
     left alone.

     🛑 THE ONE SHAPE THAT WOULD BREAK THIS, WRITTEN DOWN BECAUSE IT DOES NOT
     EXIST YET AND SO CANNOT BE TESTED: a caller that stages its data dir in
     temp while doing REAL work needing the operator's own `~/.claude`.
     First-run import is exactly that kind of work. Safe today, checked
     rather than assumed: install/setup.sh uses "$KOSMOS_HOME/data" and
     cannot fire, and tools/build-kosmos-bundle.sh stages to mktemp and DOES
     fire, which is correct because its smoke asserts only that the app
     announces a port, answers, and returns its own page, nothing about the
     roster. If you are adding an installer smoke that stages to temp AND
     asserts the import found real agents, this guard is what fails it, and
     the fix is to set AGENT_WORKFORCE_CONFIG_ROOT deliberately rather than
     to widen the condition. */
  /* ⚠️ `/tmp` IS NOT `os.tmpdir()` ON macOS, and keying on one of them
     alone leaves the other wide open. os.tmpdir() here is /var/folders/.../T,
     so a fixture sandboxed to /tmp was NOT caught: my own board did exactly
     that and reported "We found 17 agents on this Mac". I only saw it because
     of the seen-text I had added to the assertion minutes earlier. Both roots
     count, and they are resolved because /tmp is a symlink to /private/tmp. */
  /* 🛑 COMPARE BOTH RESOLVED AND UNRESOLVED, ON BOTH SIDES. My first version
     realpath'd only the ROOTS, and on macOS /var is a symlink to /private/var,
     so the root became /private/var/folders/.../T while the candidate stayed
     /var/folders/.../T and the guard stopped firing entirely. My own probe
     caught it one command after I wrote it; nothing else would have, because a
     guard that has quietly stopped firing looks exactly like a guard with
     nothing to catch. */
  const TMP_ROOTS = [];
  for (const d of [os.tmpdir(), '/tmp']) {
    const r = path.resolve(d);
    TMP_ROOTS.push(r);
    try { const rp = fs.realpathSync(d); if (rp !== r) TMP_ROOTS.push(rp); } catch { /* absent is fine */ }
  }
  const under = (d) => {
    if (!d) return false;
    const cands = [path.resolve(d)];
    try { cands.push(path.join(fs.realpathSync(path.dirname(d)), path.basename(d))); } catch { /* parent may not exist yet */ }
    return cands.some((c) => TMP_ROOTS.some((t) => c === t || c.startsWith(t + path.sep)));
  };
  if (under(process.env.AGENT_WORKFORCE_DATA) && !under(homeDir())) {
    /* ⚠️ IT RETURNS AN EMPTY SANDBOX RATHER THAN THROWING, AND THE DIFFERENCE
       IS MEASURED, NOT PREFERRED. Throwing here failed 161 of 2374 tests, so
       it could not land; and 161 reds all saying the same thing would have
       been read as "the guard is wrong" rather than as the exposure it is.
       Returning a path that does not exist gives a fixture the answer a
       fixture should get, nothing, and leaves exactly the tests that really
       depended on the operator's machine failing, which is the list worth
       having. */
    return [path.join(process.env.AGENT_WORKFORCE_DATA, 'no-config-root-sandbox')];
  }
  const roots = [];
  let entries = [];
  try {
    entries = fs.readdirSync(homeDir());
  } catch { /* fall through to the default */ }
  for (const name of entries) {
    if (name !== '.claude' && !name.startsWith('.claude-')) continue;
    const projects = path.join(homeDir(), name, 'projects');
    if (fs.existsSync(projects)) roots.push(path.join(homeDir(), name));
  }
  if (!roots.length) roots.push(path.join(homeDir(), '.claude'));
  // Primary root first, so the common case costs one lookup.
  roots.sort((a) => (a.endsWith('/.claude') ? -1 : 1));
  return roots;
}

// How the value was arrived at. The UI renders low-confidence values
// differently, and never renders `none` as a real number.
/**
 * The sentences a person reads when we cannot see what an agent has been doing.
 *
 * 🔑 ONE SET, SHARED BY EVERY PROVIDER, and that is the point rather than tidiness.
 * A reason is about the AGENT, not about the runtime underneath it: "we cannot
 * find a transcript for it" is equally true of a Claude agent and a Codex one,
 * in the same words. The moment the two paths phrase it differently, the board
 * speaks two dialects about one fact and a person can tell which provider an
 * agent runs on from an ERROR MESSAGE.
 *
 * ⚠️ AND NO PRODUCT NAME BELONGS IN THEM. Somebody chose a provider on one
 * screen an hour ago; they did not sign up to learn what Codex calls its files.
 * The Claude path has never said "Claude" here either, and that was not an
 * accident. (Mona Lisa, on the OpenAI phase: the principle, not a copy nit.)
 */
const NO_READING = {
  NO_TRANSCRIPT: 'we cannot find a transcript for it',
  UNREADABLE: 'could not read the transcript',
};

const CONFIDENCE = {
  STRUCTURED: 'structured', // read from a file written for this purpose
  SCRAPED: 'scraped',       // read off a terminal pane; may be UI chrome
  NONE: 'none',             // could not determine -- must not render as a value
};

const STATE = {
  WORKING: 'working',
  NEEDS_YOU: 'needs_you',
  RATE_LIMITED: 'rate_limited',
  /* #874: a bearer token that Anthropic has rejected outright -- revoked,
     expired, or never valid. Distinct from RATE_LIMITED: a rate limit is a
     real, working account that has used up its allowance and will work
     again later; this is a token no API call will ever succeed with until
     somebody reconnects the account. Claude Code's own retry loop still
     draws "esc to interrupt"-shaped chrome while it fails, which is why
     nothing caught this before -- classify() checked AUTH_FAILED_MARKERS
     first, mirroring RATE_LIMIT_MARKERS's own precedent. */
  AUTH_FAILED: 'auth_failed',
  IDLE: 'idle',
  STOPPED: 'stopped',
  /* Reported-only (#188's third verb): waiting on something that is NOT the
     person -- another agent, a deploy, a review. No pane shape produces it;
     it exists because an agent can SAY it, with what and who, which is the
     split every agent already reports in prose ("blocked on X, owned by Y").
     A rate limit is the one blocked the pane can see, and it keeps its own
     state above because the screens treat it specially. */
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown', // the default, deliberately
};

/* 🛑 THE READS HONOUR THE SAME VARIABLE THE WRITES DO (#332). Every other
   engine module resolves tmux through AGENT_WORKFORCE_TMUX_BIN; this one
   read bare `tmux` off the PATH, so a test that pointed the variable at
   /bin/echo stubbed every WRITE and left every READ on the operator's live
   fleet. About ten server tests passed on this Mac for that reason and
   would have behaved differently on any other. The launcher exports the
   variable to the bundled binary, so in the product the two agree. Bare
   `tmux` as the default keeps this file's pre-existing behaviour; the
   writers default to /opt/homebrew/bin/tmux, a split that predates this and
   only bites a `node server.js` run from a terminal with the variable unset. */
function tmuxBin() {
  return process.env.AGENT_WORKFORCE_TMUX_BIN || 'tmux';
}

function sh(cmd, args) {
  const got = shDetail(cmd, args);
  return got.ran && got.status === 0 ? got.out : null;
}

/**
 * The same call, with the outcome kept rather than flattened to `null`.
 *
 * ⚠️ `sh` throwing everything away is what made "there are no sessions"
 * indistinguishable from "we could not ask", and this module's whole reason for
 * existing is that those are different facts. `execFileSync` throws on a
 * non-zero exit AND on a failed spawn, so the catch could not tell a tmux that
 * ANSWERED from a tmux that is not installed.
 *
 * `ran` is the distinction: a process that started and exited has a numeric
 * `status`, and one that never started (ENOENT) or was killed by the timeout
 * does not.
 */
function shDetail(cmd, args) {
  try {
    return { ran: true, status: 0, out: execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 }), err: '' };
  } catch (e) {
    const status = e && typeof e.status === 'number' ? e.status : null;
    return {
      ran: status !== null,
      status,
      out: (e && e.stdout && e.stdout.toString()) || '',
      err: (e && e.stderr && e.stderr.toString()) || '',
    };
  }
}

/**
 * Did tmux ANSWER, and answer that there is nothing to list?
 *
 * ⚠️ A REAL PRODUCT STATE, and refusing it was a regression this branch
 * introduced while fixing its mirror image. `tmux list-panes -a` exits 1 with
 * "no server running on …" / "error connecting to …" (and, from the bundled
 * 3.5a, "server exited unexpectedly" with no socket on disk) when no tmux
 * server is up
 * — which is the NORMAL state of a machine that has tmux installed and no
 * agents running yet. That is precisely the first-run machine this product
 * exists for.
 *
 * Before this, `sh` flattened that to `null` and `listPanes` threw, so a person
 * who had installed Kosmos and not yet created an agent got "we cannot read the
 * agents right now" — the board refusing to speak about a machine it had
 * successfully looked at. The earlier fix corrected one false claim ("0 agents,
 * checked just now" when tmux was unreachable) by minting its mirror image.
 *
 * ⚠️ IT IS A FACT ABOUT THE SOCKET WE ASKED, not about the machine. "No server
 * on the socket this process would use" is read here as "no agents". The day
 * this comment warned about ARRIVED (#668, measured on a sandboxed walk): a
 * board with `TMUX_TMPDIR` set made launchd jobs that used the default socket,
 * and "I am looking at a different socket" became a confident "Not running" on
 * every card -- the exact conversion this module exists to prevent, arriving
 * through its own fix for it. Two seams now hold it closed: `create.plistFor`
 * carries the creating server's `TMUX_TMPDIR` into every job, and the offline
 * roster (server.js) checks `launchctl list` so a job launchd says is RUNNING
 * with no visible session says so instead of claiming stopped. Neither seam
 * covers `$TMUX` pointing this process at a non-default server; that stays a
 * way to hold this fact wrongly about the machine.
 *
 * ⚠️ MATCHED ON TMUX'S OWN MESSAGE, not on the exit code alone. Exit 1 also
 * covers errors we have no business reading as an empty machine, so anything
 * that is not recognisably "there is no server" still refuses. Measured on
 * this machine: `tmux -L <unused> list-panes -a` exits 1 with
 * "error connecting to /private/tmp/tmux-501/<unused> (No such file or
 * directory)".
 */
function tmuxSaidNoServer(got) {
  if (!got || !got.ran || got.status === 0) return false;
  const err = String(got.err || '');
  // ⚠️ "error connecting to" ALONE IS TOO LOOSE, and the first version of this
  // guard used it. tmux prints that line for any socket it cannot reach, so
  // `error connecting to <socket> (Permission denied)` — a socket owned by
  // somebody else — would have read as "this machine has no agents". That is
  // the same cannot-see-reported-as-nothing failure this function exists to
  // fix, rebuilt inside the fix. Only the No-such-file variant is evidence that
  // there is no server, so only it is accepted.
  //
  // MEASURED, and it is why the qualifier matters: a tmux socket directory with
  // wrong permissions answers "directory … has unsafe permissions", which
  // matches neither branch and correctly stays a refusal.
  if (/no server running/i.test(err)) return true;
  if (/error connecting to/i.test(err) && /no such file or directory/i.test(err)) return true;
  /* 🛑 THE TMUX WE BUNDLE HAS A THIRD SERVERLESS VOICE, and until this
     branch the board 500ed on every fresh install because of it. The
     shipped 3.5a, asked to list with no server, auto-spawns one that exits
     at once having nothing to serve, and the client reports "server exited
     unexpectedly" (MEASURED 2026-08-23 against the shipped bundle with a
     fresh empty TMUX_TMPDIR; it leaves no socket behind). The SAME words
     are also the version wall: a REAL server owned by a newer tmux answers
     identically to our older client (measured on this fleet's own Mac,
     which is how a sister's machine full of agents once read as empty).
     Two states, one sentence, so the words alone must never decide: the
     socket on disk is the dimension. No socket file = there was never a
     server = the clean machine this product installs onto. A socket
     present = somebody's live server we cannot read = the refusal stands,
     and the board says it cannot see rather than claiming empty. The
     existsSync failure direction is the refusal too: an unreadable socket
     directory is not evidence of absence. */
  if (/server exited unexpectedly/i.test(err)) {
    /* statSync with ENOENT-only as absence, NOT !existsSync: existsSync
       returns false on EACCES too, so an unreadable socket directory
       hiding a real live server would have read as a clean machine, the
       exact conversion this function forbids. Only a proven no-such-file
       is evidence of absence; every other failure answers "could not
       check", and the refusal stands. Same rule as create.jobMissing. */
    try {
      fs.statSync(path.join(process.env.TMUX_TMPDIR || '/tmp', 'tmux-' + process.getuid(), 'default'));
      return false;
    } catch (e) {
      return Boolean(e && e.code === 'ENOENT');
    }
  }
  return false;
}

/**
 * The raw `list-panes` text, an empty listing, or `null` for "we could not ask".
 *
 * One derivation, shared by `listPanes` and `paneRoster`, because two readers of
 * the same question drifting apart is this codebase's worst habit and these two
 * have already drifted once.
 */
/**
 * What went wrong the last time we asked tmux, in tmux's own words.
 *
 * 🛑 THE ANSWER EXISTED AND WAS DISCARDED ONE LAYER DOWN. `shDetail` keeps the
 * stderr; `tmuxPanes` flattened a failure to `null`, so the board could say
 * "we cannot read your agents" and nothing anywhere could say WHY. Josh's Mac,
 * 2026-08-22: the board came back after a reboot, the agents call returned 500,
 * and finding out what tmux had actually said needed a terminal, a person, and
 * two rounds of messages. The machine knew the whole time.
 *
 * ⚠️ IT IS A HINT, NOT A DIAGNOSIS, and the screen must present it as one. It is
 * the last failure this process saw, so it can be stale relative to the call
 * being reported on; it is worth showing because a stale real message beats an
 * accurate silence, not because it is authoritative.
 *
 * 📌 Null after a successful look, so a screen cannot show yesterday's problem
 * beside today's healthy board.
 */
let LAST_LOOK_PROBLEM = null;
function lastLookProblem() { return LAST_LOOK_PROBLEM; }

/* One line, bounded, and never HTML: it reaches a screen. */
function oneLine(text, max) {
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function tmuxPanes() {
  const got = shDetail(tmuxBin(), ['list-panes', '-a', '-F', PANE_FORMAT]);
  if (got.ran && got.status === 0) { LAST_LOOK_PROBLEM = null; return got.out; }
  // ⚠️ An empty STRING, not null. `readPanes('')` is zero panes and zero
  // rejects, which is the honest reading of "tmux answered, and there are no
  // sessions" — and it is a different value from the `null` that means we never
  // got an answer.
  if (tmuxSaidNoServer(got)) { LAST_LOOK_PROBLEM = null; return ''; }
  /* ⚠️ TWO DIFFERENT FAILURES AND THEY NEED DIFFERENT WORDS. A process that
     never started (`ran` false: not installed, not on PATH, killed by the
     timeout) has no stderr to quote, and quoting an empty string would put an
     empty pair of quotes on somebody's screen. */
  /* jargon-ok:tmux — THE RULE, stated once here and referred to below.

     A PRIMARY sentence must never name our components. A person who installed
     Kosmos has no reason to have heard of tmux, and being told about one is a
     fact they cannot act on: `create.js` said "the paths this computer gave
     us for Claude and tmux" and it cost a real diagnostic step, because Josh
     was then sent `tmux ls` on a machine whose only copy is the one we ship
     and never put on his PATH.

     A DETAIL line is the opposite case and naming the component is its whole
     job. It sits behind a plain primary sentence ("we could not make sense of
     what came back"), it exists so that a cause reaches the screen instead of
     a terminal, and a cause with the actor removed is not a cause. The four
     sites marked here are all that channel. (Mona Lisa, 2026-08-22.) */
  LAST_LOOK_PROBLEM = got.ran
    ? (oneLine(got.err, 300) || `tmux exited ${got.status} without saying why`)
    : 'we could not run tmux at all on this computer';
  return null;
}

/**
 * ⚠️ Three tiers live here, and mixing them up has caused a defect at every
 * level, so read which one you want before using it:
 *
 *   `isFleetSession` — our session, whatever is running in it. What RESTART
 *                      asks, because a crashed agent is still our agent.
 *   `isAgentSession` — the above, AND Claude is actually running.
 *   `isAgentPane`    — the above, AND the pane is not scrolled back in
 *                      copy-mode. What TYPING asks.
 *
 * `list-panes -a` returns EVERY pane on the machine, and the roster it feeds
 * gates every destructive route. Without these, `/clear` and Enter would be
 * typed into a plain shell, an editor, or a REPL, where the text is EXECUTED
 * rather than read as a slash command. Latent while every session happens to be
 * a Claude agent; live the moment anyone opens an unrelated tmux session.
 *
 * ⚠️ Split apart because RESTART needs a different question from typing, and
 * conflating them was a real hole at both ends.
 *
 * Too loose: `restart` was exempt from every roster check on the reasoning that
 * it goes through launchd and types nothing. But the roster is every tmux pane
 * on the machine with the `-discord` suffix merely STRIPPED, never required. So
 * a plain shell in a session called `mikey` appeared as an agent named `mikey`,
 * and its Restart button ran `restart-bot.sh mikey` against the REAL bot. The
 * shown cost even looked right, because the dialog reads the real `mikey`'s
 * commitments. The operator would be acting on a card that is not the thing
 * being restarted.
 *
 * Too tight: making restart use `isAgentPane` instead would refuse whenever the
 * pane is scrolled back in copy-mode, which matters only for TYPING. Restart
 * sends no keystrokes, so copy-mode is irrelevant to it, and refusing there
 * would take the feature away in a state the operator can enter by accident
 * with a scroll wheel.
 */
/**
 * Is this pane in one of the fleet's sessions, whatever is running in it?
 *
 * ⚠️ Three tiers now, and the distinction between this one and
 * `isAgentSession` is the difference between restart working and restart being
 * useless in the case it matters most.
 *
 * `isAgentSession` additionally requires a live Claude process. Gating RESTART
 * on that was too strict in a way that inverted the feature: an agent that has
 * crashed back to a shell inside its own `*-discord` session has no Claude
 * process, so it classified `stopped` and its Restart button answered "we are
 * not confident that card is one of your agents". That sentence is untrue — it
 * plainly is one of your agents — and a crashed agent is the single most
 * valuable thing a Restart button can act on. The guard refused precisely the
 * case the feature exists for.
 *
 * The hazard restart was actually exposed to is an unrelated session that
 * merely COLLIDES with an agent's name (`tmux new -s mikey`).
 *
 * ⚠️ The suffix test does NOT close that on its own any more, and this comment
 * claimed it did for one commit after it stopped being true — which is worse
 * than saying nothing, because the claim is what stops the next reader checking.
 * Once the process arm below was added, an impostor session RUNNING CLAUDE
 * passes this function: `isFleetSession({session:'mikey', command:'2.1.212'})`
 * is `true`. What actually closes the collision now is `rank`, which puts every
 * named-ours pane above an unnamed one so the impostor cannot win the name. The
 * gate here answers "could this be an agent at all"; `rank` answers "which pane
 * IS this agent". Both are needed and only the second resolves a collision.
 *
 * `restart-bot.sh` refuses independently when there is no `com.<name>.discord`
 * plist, so a name that is not a real service cannot reach launchd either.
 *
 * What this deliberately does NOT stop is somebody opening a session literally
 * called `<agent>-discord` by hand. That is not the accident this guards
 * against, and anyone able to do it can run `restart-bot.sh` directly.
 */
/**
 * The canonical "this command IS Claude" test, in ONE place.
 *
 * ⚠️ Written out three times before this: in `isFleetSession`, in
 * `isAgentSession`, and in `rank`. The header of this file condemns exactly
 * that, and `isAgentPane` obeys it — but `rank`, the function that decides
 * WHICH PANE a destructive action reaches, carried a private copy. Loosening
 * the rule in the two that read as "the check" would have silently demoted every
 * real agent a tier in `rank` with no test noticing.
 */
function isNativeClaude(command) {
  return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(command || '').trim());
}

/**
 * Is a Claude process running in this pane? ONE definition, used by everything.
 *
 * ⚠️ There were two, and the looser one decided what the board asserted.
 * `classify` asked `isClaudeRunning`, a DENYLIST of six shell names, while
 * `isAgentSession` asked an ALLOWLIST. So `vim`, `ssh`, `python3`, `less` — and
 * `-zsh`, a login shell, which is not in the denylist at all despite this
 * branch's own tests using it as the crashed case — were all "Claude is
 * running" to `classify`.
 *
 * The consequence was not theoretical: a crashed agent whose only remaining
 * pane is an editor won its name in `rank`, then `classify` scraped that
 * editor's screen and reported `idle` if the buffer contained "Worked for",
 * `needs_you` if it contained "Do you want to proceed", `rate_limited` if it
 * contained "rate limit". **The board reported a healthy state for a crashed
 * agent, on the one card whose Restart button exists for that case.**
 *
 * Matched against the fleet's canonical rule
 * (`~/.claude/scripts/lib/claude-process-classify.sh`): a strict three-segment
 * version, or one of the legacy names, because an npm-global install fronts as
 * `node`.
 */
function isClaudeCommand(command) {
  const c = String(command || '').trim();
  return isUnambiguousClaude(c) || c === 'node';
}

/**
 * Claude, with no other plausible reading of the command name.
 *
 * ⚠️ The distinction that matters to `rank`: `node` is shared with every dev
 * server, REPL and build watcher on the machine, so it cannot outrank an
 * agent's own crashed shell. A version string, `claude` and `claude.exe` are
 * shared with nothing, so they must.
 */
function isUnambiguousClaude(command) {
  const c = String(command || '').trim();
  return isNativeClaude(c) || c === 'claude' || c === 'claude.exe';
}

function isFleetSession(pane) {
  if (!pane) return false;

  /* ⚠️ THE SIGN-IN SESSION IS NOT AN AGENT (#603, Josh met the card live:
     "This weird Kosmos Connect thing popped up in my agents"). It is the
     connect flow's own disposable tmux session, and it RUNS claude, so the
     process arm below claims it for the fleet whatever it is called -- the
     name refusal in create.js never touched this path. Refused here at the
     TOP, before either arm, on the constant exported where the session is
     created: anywhere later and the pane is already restartable and
     typeable as an agent. EXACT match, so an agent someone really names
     kosmos-connect2 keeps both arms. A LEFTOVER session (a mid-sign-in
     server death, connect.js's own documented case) is exactly when a
     person meets this, so the guard must not depend on the session being
     short-lived. */
  if (pane.session === connect.SESSION) return false;

  // ⚠️ EITHER a session we recognise by name, OR a pane visibly running Claude.
  //
  // This used to require `/-discord$/` and nothing else, which meant an agent
  // that was not a Discord bot was invisible to every check here: not
  // restartable, not typeable, effectively unmanaged. That is a straight
  // contradiction of the product's own second paragraph ("Not Discord as the
  // surface"), and it was load-bearing rather than cosmetic — it is why the
  // install instructions grew a Discord developer-portal step nobody should
  // have to take.
  //
  // Both arms are needed, and each covers what the other cannot:
  //
  //   - The NAME arm keeps a CRASHED agent ours. Its pane is a shell, so there
  //     is no Claude process to see, and restart is the whole reason to care
  //     about it. Only the session name still says whose it is.
  //   - The PROCESS arm is what removes the Discord coupling. A native Claude
  //     install fronts as a strict three-segment version, which nothing else on
  //     a machine looks like, so it is evidence on its own whatever the session
  //     is called.
  //
  // Deliberately NOT in the process arm: `node`. An npm-global Claude install
  // fronts as `node`, and so does every dev server, REPL and build watcher. A
  // bare `node` pane is claimed only via the name arm, because trusting it
  // alone would make `/clear` typeable into a webpack watcher — the exact
  // hazard these checks exist for.
  if (isNamedOurs(pane)) return true;
  return isNativeClaude(pane.command);
}

function isAgentSession(pane) {
  if (!isFleetSession(pane)) return false;

  // ⚠️ An ALLOW list, not a deny list.
  //
  // `isClaudeRunning` merely excludes six known shell names, so inside a
  // `*-discord` session every other command passed: `vim`, `nvim`, `node`,
  // `less`, `ssh`, `python3` all classified as an agent pane, and the comment
  // above claimed it stopped an editor or a REPL. It stopped neither.
  //
  // Matched against the fleet's CANONICAL rule rather than a rule invented
  // here: `~/.claude/scripts/lib/claude-process-classify.sh` accepts a strict
  // three-segment version (the native install fronts as `2.1.212`) or one of
  // the legacy names, because an npm-global install fronts as `node`. A
  // two-segment form was accepted here for one round, which the canonical rule
  // deliberately excludes to avoid matching an unrelated numeric-named process,
  // and the legacy names were rejected, which silently removed this feature for
  // any agent on an npm install.
  return isClaudeCommand(pane.command);
}

/**
 * ⚠️ DERIVED from `isAgentSession`, not a second copy of its rule. Writing the
 * suffix test and the command allowlist out again here is the defect this
 * codebase has shipped more times than any other: one fact derived in two
 * places, the two drifting, and the looser one deciding the dangerous path.
 * This adds exactly one clause and inherits the rest.
 */
function isAgentPane(pane) {
  if (!isAgentSession(pane)) return false;

  // ⚠️ Not while the pane is scrolled back in copy-mode. There, keystrokes go
  // to copy-mode bindings rather than the composer, so nothing is compacted or
  // cleared and the route would still answer "we asked it to". This clause is
  // about TYPING, which is why restart asks `isAgentSession` instead.
  //
  // ⚠️ `=== '0'`, an ALLOWLIST, not `!== '1'`. The negative form ruled a pane
  // typeable whenever `inMode` was anything unexpected — undefined, empty, a
  // value from a future tmux — which is asserting the safe answer from an
  // absence of information. `parsePanes` already defends that default at the
  // boundary, and defending one fact in only one of the two places that decide
  // it is precisely the shape this codebase keeps shipping: any caller holding
  // a pane object it did not get from the parser got the permissive answer.
  return pane.inMode === '0';
}

/**
 * The columns we ask tmux for, in order.
 *
 * ⚠️ ONE list, used to build the format string AND to read the answer back.
 *
 * These were two separate literals: a format string here and a positional
 * destructure below. Nothing tied them together, so deleting `#{pane_in_mode}`
 * from the format, or reordering any column, left the whole suite green while
 * `inMode` silently held the pane TITLE. `inMode !== '1'` is then true for every
 * pane, and every copy-mode pane classifies as typeable — which is precisely
 * the case the copy-mode clause was added to refuse, disabled by an edit
 * nowhere near it.
 *
 * `title` is last on purpose: it is the only field that can itself contain a
 * tab, so it absorbs the remainder rather than shifting every column after it.
 */
const PANE_COLUMNS = [
  { key: 'session', fmt: '#{session_name}' },
  { key: 'pane', fmt: '#{window_index}.#{pane_index}' },
  { key: 'command', fmt: '#{pane_current_command}' },
  { key: 'inMode', fmt: '#{pane_in_mode}' },
  // ⚠️ The CLAIM, and it must sit before `title` — `title` is `rest: true`, so
  // it absorbs every remaining tab and anything after it would be swallowed.
  //
  // This is a tmux user option Kosmos sets on the session it creates. It reports
  // empty for every session that does not have one, which is what makes it
  // evidence rather than a naming convention.
  { key: 'claim', fmt: '#{@kosmos_agent}' },
  /* The RUNNER, recorded by the supervisor at launch beside the claim
     (#245). Needed because pane_current_command cannot carry it: the
     homebrew codex fronts as `node` (an npm launcher), which is also on
     Claude's own command allowlist -- so inferring the runner from the
     command routes a codex pane through the Claude classifier. MEASURED,
     on the first live codex agent this machine ran. Empty for every pane
     that predates the option, which correctly means claude. */
  { key: 'runner', fmt: '#{@kosmos_runner}' },
  { key: 'title', fmt: '#{pane_title}', rest: true },
];

const PANE_FORMAT = PANE_COLUMNS.map((c) => c.fmt).join('\t');

/**
 * Is this line actually a pane, or something we cannot read?
 *
 * ⚠️ `PANE_FORMAT` is TAB-separated, and when the separator is absent every
 * field but the first is missing — so the whole line landed in `session` and
 * the rest defaulted, producing a syntactically valid agent whose name was the
 * entire raw line and whose target was `<whole line>:undefined`.
 *
 * That is not hypothetical. It happened on this machine: without a UTF-8
 * locale, **tmux sanitises its own format output** and replaces the tabs with
 * underscores (bisected: `PATH` alone gives mangled output, `PATH`+`LANG`
 * gives correct). The board then showed thirteen agents named
 * `angel-discord_0.0_2.1.223_0__ …` — populated, confident, and wrong, with
 * those entries carrying a name, a rank and a target into everything
 * downstream, where `safeKey` would happily sanitise one into a collision with
 * a real agent's key.
 *
 * ⚠️ THE RULE IS "IS THE SESSION A FIELD", NOT "ARE ALL THE FIELDS THERE", and
 * the difference is a decision, not an oversight.
 *
 * Requiring every column would also reject a TRUNCATED line — and this module
 * deliberately keeps those. A short line still names a session we can identify,
 * and the missing fields default to the UNSAFE answer (`inMode` defaults to in
 * copy-mode, a missing `command` classifies `unknown` rather than `stopped`),
 * which is handled and tested. Dropping them would hide a running agent from
 * the board, which is the same class of harm as showing a garbage one, pointed
 * the other way.
 *
 * What makes the mangled line different is that NOTHING about it can be
 * identified: with no separator at all, `session` is the whole line, so there is
 * no agent to be conservative about.
 *
 * ⚠️ "A separator somewhere" is NOT enough, and the first version of this rule
 * was exactly that. `title` is the one field that can itself contain a tab (see
 * the format note above, and the test for tab-carrying titles), so a mangled
 * line whose title happened to hold one sailed through and produced the very
 * garbage agent this exists to reject — reproduced: a line reading
 * `angel-discord_0.0_…_ Working<tab>on<tab>the thing` parsed as an agent named
 * `angel-discord_0.0_…_ Working`, with `rejected: 0`, so nothing refused and
 * nothing was counted.
 *
 * So the second field is CHECKED FOR SHAPE. `#{window_index}.#{pane_index}`
 * is always two integers separated by a dot, tmux always produces it, and no
 * mangled line can fake it. A truncated `session<tab>0.0` still passes, which
 * keeps the deliberate policy above intact.
 *
 * ⚠️ A mistake in OUR OWN format string is a different problem and is not
 * caught here. It is also not constructible in the form the issue imagined:
 * `PANE_FORMAT` is derived by joining `PANE_COLUMNS` with a tab, so a `\t`
 * cannot be dropped from it by hand. What can happen is a column being added,
 * removed or reordered, and the round-trip test over a hand-built line catches a
 * merge or a reorder — though not an appended column, which nothing currently
 * would. That is a gap in the tests rather than something this guard should
 * try to cover.
 */
const PANE_INDEX_SHAPE = /^\d+\.\d+$/;

function isParseable(line) {
  const parts = String(line).split('\t');
  return parts.length > 1 && PANE_INDEX_SHAPE.test(parts[1]);
}

/**
 * Parse `list-panes -F PANE_FORMAT` output, and say what could not be read.
 *
 * ⚠️ REJECTING IS ONLY HALF THE FIX, and the missing half is the one that cost
 * fourteen hours. Dropping unreadable lines silently turns "tmux told us
 * something we cannot understand" into "there are no agents" — which is exactly
 * what the board displayed, all night, while thirteen agents were running. An
 * empty board and an unreadable one look identical and mean opposite things.
 *
 * So the count travels with the panes, and `listPanes` refuses rather than
 * serving an empty fleet it cannot vouch for.
 */
function readPanes(out) {
  if (!out) return { panes: [], rejected: 0, rejectedLines: [] };
  const lines = out.trim().split('\n').filter(Boolean);
  // ⚠️ Counted from what actually PARSED, not from a second application of the
  // filter. Two derivations of "how many did we lose" can drift the moment
  // `parsePanes` drops a line for any other reason.
  const panes = parsePanes(out);
  /* #734: the lines themselves ride along (bounded: three, one line each,
     160 chars), so the board can SHOW what it could not read rather than
     only count it. A count says the fleet is short; the line says which
     pane, which is the only way anyone finds it. A pane title is text an
     agent wrote and this reaches a screen, hence the bound. */
  const rejectedLines = lines.filter((l) => !isParseable(l)).slice(0, 3).map((l) => oneLine(l, 160));
  return { panes, rejected: lines.length - panes.length, rejectedLines };
}

/**
 * Parse `list-panes -F PANE_FORMAT` output. Pure, so it can be tested.
 *
 * ⚠️ It DROPS lines it cannot read (see `isParseable`) and says nothing about
 * how many. That silence is the fourteen-hour failure in miniature, so anything
 * that needs to tell "no agents" from "an answer we could not read" must use
 * `readPanes`, which returns the count alongside.
 */
function parsePanes(out) {
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean).filter(isParseable).map((line) => {
    const parts = line.split('\t');
    const raw = {};
    PANE_COLUMNS.forEach((col, i) => {
      raw[col.key] = col.rest ? parts.slice(i).join('\t') : parts[i];
    });
    const session = raw.session || '';
    return {
      name: session.replace(/-discord$/, ''),
      session,
      // Kept, not just folded into `target`: choosing one pane per session
      // needs to compare indexes, and re-parsing them back out of the target
      // would be a second derivation of something we already had.
      pane: raw.pane || '',
      target: `${session}:${raw.pane}`,
      // ⚠️ `null`, not `''`. An empty string reaches `classify` as "not a Claude
      // command", which answers `stopped` at STRUCTURED confidence — a
      // confident structural claim that an agent is not running, derived
      // entirely from a field that was MISSING. That is the move the `inMode`
      // default three lines below explicitly refuses, made in the same
      // function.
      // ⚠️ Empty counts as absent, matching the `inMode` default below rather
      // than merely claiming to. The first version handled only `undefined`, so
      // a dead or `remain-on-exit` pane reporting an EMPTY command still
      // reached `classify` as "not Claude" and answered `stopped` at
      // STRUCTURED confidence — the same confident claim from no information,
      // in the same function, under a comment asserting parity it did not have.
      command: raw.command == null || raw.command === '' ? null : raw.command,
      // '1' when the pane is scrolled back in copy-mode, where keystrokes go to
      // copy-mode bindings rather than to the composer.
      //
      // ⚠️ Defaults to '1' (in copy-mode), not '0'. A truncated or malformed
      // line leaves this undefined, and defaulting to '0' meant "not in copy
      // mode, safe to type" — asserting the safe answer from an absence of
      // information, which is the one thing this codebase refuses to do.
      inMode: raw.inMode === undefined || raw.inMode === '' ? '1' : raw.inMode,
      // ⚠️ Kosmos's claim on the session. Empty for every session it did not
      // create, which is what makes it evidence rather than a convention.
      //
      // ⚠️ AND THE LESSON: this field existed in `PANE_COLUMNS` and was parsed
      // into `raw` and then **silently dropped**, because this return builds its
      // object by hand. `PANE_COLUMNS` was introduced so the format and the
      // parser could not drift — and the drift moved one step downstream, to
      // the parser and the object it returns. The round-trip test did not catch
      // it because it asserted the fields it already knew about.
      //
      // Adding a column is therefore TWO edits, and the test below now asserts
      // that every column reaches the output so the next one cannot be lost the
      // same way.
      claim: raw.claim || '',
      /* Empty means claude, the same absent-means-default the supervisor's
         optional runner argument carries (#245). Normalised to the two
         words the classifier dispatches on, so a truncated line cannot
         invent a runner. */
      runner: raw.runner === 'codex' ? 'codex' : '',
      title: raw.title || '',
    };
  /* ⚠️ AND THE ROW ITSELF (#603's other half, MEASURED before believed):
     the isFleetSession guard above was applied alone first, and the board
     still drew the card -- snapshot() maps every pane and consults fleet
     membership for ACTIONS, not for row existence. So the sign-in session
     is dropped here too, at the one parse both roster readers share, on
     the same exported constant. Two questions, one constant: may this
     pane act as fleet (the guard), and does it get a row at all (this).
     The guard stays even though parse-fed flows can no longer reach it:
     it is the defence for any caller handing a pane-shaped object that
     did not come through this parse. */
  }).filter((p) => p.session !== connect.SESSION);
}

/**
 * Where the raw `list-panes` output comes from.
 *
 * ⚠️ A seam, and it exists for one reason: without it the WIRING is unpinnable.
 * `onePanePerSession` had three tests and deleting its call from `snapshot()`
 * left all of them green, because every pane on this machine is already a
 * distinct session — the duplicate case cannot be arranged on a live fleet, so
 * a test that reads the real board can never fail. The same shape as
 * `setRunner` in `engine/lifecycle.js`, and for the same reason.
 *
 * Read-only either way: this replaces where the TEXT comes from, never what is
 * done with it, so it cannot be used to reach a real agent.
 */
let paneSource = null;

function setPaneSource(fn) { paneSource = typeof fn === 'function' ? fn : null; }

function listPanes() {
  const out = paneSource ? paneSource() : tmuxPanes();
  /**
   * ⚠️ TMUX COULD NOT BE ASKED AT ALL, which is not an empty machine either —
   * and this case was missing while the one below it was carefully handled.
   * `sh` swallows a failed spawn and returns null, so on a machine where tmux
   * is not installed (or not on PATH) `readPanes(null)` produced zero panes and
   * zero rejects, and the board reported a machine with no agents off a look
   * that never happened. That is the exact failure the comment below describes
   * — "a mangled answer and no answer were indistinguishable" — with the third
   * case, NO ANSWER AT ALL, still indistinguishable from an empty fleet.
   *
   * `paneSource` returning null is the same fact from the test seam, so both
   * go through here.
   */
  if (out === null || out === undefined) {
    throw new Error('we could not see what is running on this computer');
  }
  const { panes, rejected, rejectedLines } = readPanes(out);

  /**
   * ⚠️ TMUX SPOKE AND WE UNDERSTOOD NONE OF IT. That is not an empty machine,
   * and the difference is the whole reason this module exists.
   *
   * Refusing here reaches the board as its "we cannot read the agents right
   * now" state, which says plainly that it is not claiming they are fine.
   * Returning an empty list instead would render as a machine with no agents —
   * which is what this board showed for fourteen hours while thirteen were
   * running, because a mangled answer and no answer were indistinguishable.
   */
  if (rejected > 0 && panes.length === 0) {
    /* 🔑 SHOW A LINE OF IT. "We could not make sense of what came back" is
       honest and unactionable; the answer is in the shape of what came back and
       one line of it names the cause outright. Josh's board, 2026-08-22, said
       exactly that sentence for an hour while the mangled line underneath it
       would have read anna_0.0_2.1.237_0___ and pointed straight at the
       missing locale.
       ⚠️ ONE LINE AND BOUNDED. A pane title is arbitrary text somebody's agent
       wrote, and this reaches a screen. */
    /* jargon-ok:tmux — a detail line; see the rule above `tmuxPanes`. */
    LAST_LOOK_PROBLEM = `tmux answered and we could not read it. It came back like this: ${oneLine(String(out).split('\n')[0], 160)}`;
    throw new Error('we could not make sense of what came back');
  }
  // Some read, some did not: the fleet is shown, and the gap is RETURNED
  // alongside it rather than quietly closed, so `snapshot` can put it in the
  // counts. Returned rather than stashed in module state — the first version
  // used a module-level variable and justified it as avoiding a second
  // derivation, which was not true: threading it costs one destructuring and
  // cannot go stale.
  return { panes, rejected, rejectedLines };
}

/**
 * One entry per agent NAME, not per pane and not per session.
 *
 * ⚠️ `list-panes -a` returns every pane, and the roster mapped straight over
 * it. A `*-discord` session with a split window produced two cards with the
 * same name, the same commitment record and the same `data-fresh` value — and
 * both the card click and the action route resolve an agent by `.find()`, which
 * takes whichever sorted first. So the operator could click the card for one
 * pane and have the keystrokes go to the other.
 *
 * ⚠️ Keyed on NAME rather than session, because the roster STRIPS `-discord`
 * without requiring it: `kappa` and `kappa-discord` are two sessions and one
 * agent name, which is the same collision one level up.
 *
 * A name with no agent pane still yields one entry, because the board must show
 * something it cannot read rather than hiding it — but it will be an entry that
 * `isAgentPane` refuses, which is the honest answer for it. See `rank` for
 * which pane represents the name.
 */
/**
 * Does the SESSION NAME say this pane is ours?
 *
 * Separated from `isFleetSession` because the two arms of that function are not
 * equally strong evidence and `rank` has to tell them apart. The name is
 * evidence of WHOSE a pane is. A Claude process is evidence only that SOMEONE's
 * Claude is running there.
 */
function isNamedOurs(pane) {
  if (!pane) return false;

  // ⚠️ THE CLAIM ARM, and it is what makes an agent Kosmos creates recognisable.
  //
  // Before this, the only evidence a pane belonged to the name it is filed under
  // was a `-discord` suffix — so an agent Kosmos created itself came back
  // anonymous and unwritable, because it has no reason to carry a naming
  // convention from our dev environment. The gate was right and its only
  // evidence was wrong.
  //
  // The claim is a tmux user option Kosmos sets on the session at creation, and
  // it beats a file on disk in the way that matters: **it dies with the
  // session**. A stranger opening a session with the same name does not inherit
  // it, and there is no stale record to reconcile — the two failure modes a
  // claims file on disk would have had.
  //
  // ⚠️ It must match the pane's own NAME, not merely be present. A claim naming
  // a different agent is somebody else's claim, and reading "has a claim" as
  // "is ours" would be the borrowed-name hole rebuilt out of new parts.
  //
  // ⚠️ KOSMOS writes this, never the agent, and that is a CONVENTION rather
  // than an enforcement — worth stating precisely, because the sentence used to
  // read as a guarantee the mechanism does not provide. Any local process can
  // run `tmux set-option -t <name> @kosmos_agent <name>` and be treated as
  // ours, exactly as any local process can open a session called
  // `<name>-discord` and be treated as ours by the legacy arm below. So this
  // arm is no weaker than the one it extends, and neither is a defence against
  // a process already running as you — which could rewrite the instruction file
  // directly anyway.
  //
  // What the claim actually buys is that it DIES WITH THE SESSION: there is no
  // stale record for a stranger to inherit later, which is the failure a claims
  // file on disk would have had.
  const claim = String(pane.claim || '').trim();
  if (claim && claim === String(pane.name || '')) return true;

  // The legacy arm: the existing fleet carries the suffix and no claim, and
  // must keep working untouched.
  return /-discord$/.test(String(pane.session || ''));
}

/**
 * How much this pane deserves to be the card for its name. Lower wins.
 *
 * ⚠️ FIVE tiers, because two different pairs of cases used to tie here and a tie
 * falls through to pane index — which compares indexes across unrelated sessions,
 * i.e. picks arbitrarily. Both ties were introduced by the commit that removed
 * the Discord coupling from `isFleetSession`, and both were wrong-agent bugs of
 * exactly the kind this branch exists to prevent:
 *
 *   1. `tmux new -s mikey` with Claude running in it now satisfied
 *      `isAgentSession` via the new process arm, so the impostor tied with the
 *      real `mikey-discord` at tier 0. tmux lists `mikey` first, so the impostor
 *      WON: the real agent vanished from the board, and the surviving card read
 *      the real agent's commitments, typed `/clear` into the impostor's pane,
 *      and then tombstoned the real agent's record. One conversation destroyed,
 *      the cost of a different one displayed, and a false claim that the real
 *      agent's holdings were gone while they were intact.
 *   2. Inside a genuine `zeta-discord`, a `node` pane (a build watcher in a
 *      split) tied with the real agent's version-string pane, because
 *      `isAgentSession`'s legacy arm accepts `node` for npm-global installs.
 *      Pane `0.0` won, so `/clear` and a bare Enter were typed into a process
 *      that EXECUTES text rather than reading it as a slash command.
 *
 * ⚠️ CRASHED OUTRANKS LEGACY, and that ordering is deliberately the less
 * convenient one. Inside a real `<agent>-discord` session, a bare `node` pane
 * cannot be told apart from the agent itself: an npm-global Claude install
 * fronts as `node`, and so does a build watcher in a split. Ranking `node`
 * higher meant that when the agent CRASHED to a shell, the watcher won the name
 * — so the board reported "we cannot tell" instead of "not running", hiding the
 * crash on the one card whose Restart button exists for it, and if the
 * watcher's tail ever matched an idle marker, `/clear` plus a bare Enter went
 * into a `node` process, which EXECUTES text rather than reading it.
 *
 * Both readings are wrong in one direction or the other, so the tie is settled
 * on which wrongness is recoverable:
 *
 *   - Picking the shell when `node` was really an npm-global agent: the board
 *     says `stopped` for something that is running, and typing is refused.
 *     **Restart still works** (the session name is still ours), which is the
 *     recovery, and the operator can see the pane themselves.
 *   - Picking `node` when it was really a watcher: the board hides a crash and
 *     may type an executable string into an unrelated process. **Nothing
 *     recovers that.**
 *
 * ⚠️ So the known cost, stated rather than discovered: an npm-global agent that
 * shares its session with any shell pane reads as `stopped` and is
 * restart-only. That is a real regression for that setup and it is the price of
 * not typing into a build watcher.
 *
 * ⚠️ The tier is WIDER than "a shell": `RANK_NAMED_CRASHED` is every named-ours
 * pane that is not native Claude and not one of the legacy names, so `vim`,
 * `ssh`, `python3`, `less` and `man` all land in it and outrank a `node` pane.
 *
 * That used to matter twice over, because `classify` held a SECOND and looser
 * definition of "no Claude here" — a six-name shell denylist — so a winning
 * `vim` pane was not reported as stopped, its screen was scraped instead, and
 * `idle`, `working`, `needs_you` and `rate_limited` were all reachable from
 * arbitrary text. **That is fixed**: `classify` and `isAgentSession` both derive
 * from `isClaudeCommand` now, and `status.test.js`'s "a crashed agent is
 * reported stopped, not scraped off whatever replaced it" pins it for six
 * commands.
 *
 * ⚠️ This note described that gap as OPEN for one commit after the same commit
 * closed it — a comment claiming a defect that no longer exists, which is the
 * inverse of the failure this file keeps warning about and just as costly: the
 * next reader either chases a phantom or "fixes" it by re-loosening `classify`,
 * which is the actual bug.
 *
 * ⚠️ The ordering principle, and the reason a crashed agent outranks a stranger:
 * **the session name is the only evidence of WHOSE a pane is.** A Claude process
 * in a session we cannot name is somebody else's Claude. So every named-ours
 * pane, including one that has crashed to a shell, beats an unnamed one — which
 * is also the case restart exists for.
 *
 * This does NOT re-couple anything to Discord. A non-Discord agent still ranks
 * (tier 3), still appears, and is still typeable. The name only settles a TIE
 * against a same-named session that does carry the suffix.
 */
const RANK_NAMED_RUNNING = 0;   // ours by name, unambiguously Claude
const RANK_NAMED_CRASHED = 1;   // ours by name, fallen back to a shell
const RANK_NAMED_LEGACY = 2;    // ours by name, AMBIGUOUS process — `node` only
/**
 * ⚠️ Everything ours by CLAIM sits below everything ours by SUFFIX, whatever is
 * running in either.
 *
 * The first version of this tie-break only preferred a suffixed pane that was
 * running unambiguous Claude, which left the hole one step along: a real
 * `angel-discord` CRASHED to a shell ranks `NAMED_CRASHED`, and a claimed
 * impostor running Claude ranks `NAMED_RUNNING`, so the impostor still won the
 * name. Measured — the roster came back with the impostor alone, and the real
 * agent was off the board.
 *
 * That case is the worst one available: the crash is hidden on the very card
 * whose Restart button exists for it, and `knownAgent` is satisfied through the
 * impostor, so a write still reaches the REAL agent's boot file while the
 * screen shows somebody else's pane. Under `main`'s ladder the crashed real
 * agent kept its card; the claim arm is what put it at risk, so the offset is
 * unconditional rather than conditional on what the impostor happens to run.
 *
 * Within either group the order is unchanged, and a claimed agent with no
 * suffixed twin — every agent this product creates — is unaffected, because the
 * offset applies uniformly to every pane in its name group.
 */
const RANK_CLAIM_ONLY = 3;      // added to any named-ours pane with no suffix
const RANK_INFERRED = 7;        // not ours by name; a Claude process says maybe
const RANK_NONE = 8;

function rank(pane) {
  if (isNamedOurs(pane)) {
    /* ⚠️ THE SUFFIXED PANE WINS A TIE, and adding the claim arm is what made
     * that necessary.
     *
     * `onePanePerSession` keys on the board NAME, and `angel` and
     * `angel-discord` are one name. Before the claim existed only the suffixed
     * session could be "ours", so the tie could not arise. Now any local
     * process can run `tmux new -s angel` and `set-option @kosmos_agent angel`,
     * and both panes rank identically at pane 0.0 — so the winner was whichever
     * tmux happened to list first. Measured on this code: the roster came back
     * with ONE entry, the impostor's, and the real agent was not on the board
     * at all. Everything keyed on the name then followed it: the instruction
     * reads and writes, and the name-keyed gates.
     *
     * A claim is set by us but is not unforgeable — any process running as this
     * user can set the same option. The suffix is the fleet's own convention
     * and is the older, established tie. So when both say "ours", the suffixed
     * one is the agent, and the claim is what recognises the agents WE create,
     * which by construction have no suffixed twin.
     */
    // ⚠️ `claude` and `claude.exe` belong UP HERE with the version string, not
    // down with `node`. Demoting the whole legacy set below a crashed shell
    // over-corrected: `node` is ambiguous because a dev server looks identical,
    // but a pane whose command is literally `claude` is not ambiguous at all.
    // Measured after the first version of this swap: `zeta-discord:0.0 zsh`
    // plus `zeta-discord:0.1 claude` picked the SHELL, so a healthy running
    // agent was reported dead and Clear and Compact were refused for it — and
    // `classify` disagreed, reporting `claude` as running. One fact, two
    // answers, in the two functions this file most recently unified.
    // The suffix is the fleet's own convention and cannot be taken by setting
    // an option; a claim can. So a pane claiming a name it does not carry sits
    // below every pane that carries it, whatever either is running.
    const byClaimOnly = /-discord$/.test(String(pane.session || '')) ? 0 : RANK_CLAIM_ONLY;

    if (isUnambiguousClaude(pane && pane.command)) return RANK_NAMED_RUNNING + byClaimOnly;
    // `isAgentSession` accepts these too, but they are weaker: `node` is what a
    // dev server looks like, and inside our own session it must not outrank the
    // pane that is unambiguously Claude.
    if (isAgentSession(pane)) return RANK_NAMED_LEGACY + byClaimOnly;
    return RANK_NAMED_CRASHED + byClaimOnly;
  }

  if (isAgentSession(pane)) return RANK_INFERRED;
  return RANK_NONE;
}

/** `<window>.<pane>` as a sortable number pair. */
function paneOrder(id) {
  const [w, p] = String(id || '').split('.');
  return (Number(w) || 0) * 10000 + (Number(p) || 0);
}

function onePanePerSession(panes) {
  const bySession = new Map();
  for (const pane of panes) {
    // ⚠️ Keyed on NAME, not session. Every consumer identifies an agent by
    // `name` (the session with `-discord` stripped) — `findAgent`, the card's
    // `data-fresh`, `openFresh`, all `.find()` by name — so deduping by session
    // left the one collision this function exists to prevent wide open:
    // `kappa` and `kappa-discord` are two sessions and ONE name.
    //
    // Measured: both survived as two roster entries called `kappa`, and
    // whichever tmux listed first won every lookup. If the impostor sorted
    // first, the REAL agent's dialog rendered all three options refused with
    // "we are not confident that card is one of your agents" — the exact untrue
    // refusal `isFleetSession` was introduced to eliminate. The two cards also
    // shared a `data-fresh` value and an SVG element id.
    //
    // The preference below already resolves it correctly once they collide:
    // the real agent pane wins over the shell.
    const key = pane.name;
    const held = bySession.get(key);
    if (!held) { bySession.set(key, pane); continue; }

    if (rank(pane) < rank(held)
      || (rank(pane) === rank(held) && paneOrder(pane.pane) < paneOrder(held.pane))) {
      bySession.set(key, pane);
    }
  }
  return [...bySession.values()];
}

/**
 * Where a pane's visible text comes from. The companion to `setPaneSource`.
 *
 * ⚠️ Both seams exist for one reason, and it is a coverage reason rather than a
 * convenience one. Every test of this feature's safety surface sourced its
 * agent from the LIVE roster, so on a machine without a running fleet the whole
 * surface skipped and the suite still reported green: measured at 19 skips,
 * including the cross-site guard, the confirmation token, the alias guard, the
 * `mayTypeInto` call site and the tombstone. A suite that passes on a laptop
 * with no agents while testing none of the dangerous paths is worse than one
 * that fails.
 *
 * `setPaneSource` alone was not enough: a synthetic pane has no real tmux
 * session, so `capturePane` returns null and every agent classifies `unknown`,
 * which the action routes correctly refuse. Both halves are needed to describe
 * an agent that is idle and actionable.
 *
 * Read-only, like its companion: this replaces where the TEXT comes from and
 * nothing about what is done with it, so neither seam can reach an agent.
 */
let paneCapture = null;

function setPaneCapture(fn) { paneCapture = typeof fn === 'function' ? fn : null; }

function capturePane(target, lines = 40) {
  if (paneCapture) return paneCapture(target, lines);
  /* 🛑 `-J` JOINS WRAPPED ROWS, AND WITHOUT IT PANE WIDTH IS A HIDDEN INPUT TO
     EVERY RULE IN `classify()` (#1234). `engine/chat.js` and `engine/connect.js`
     already ask for the logical line; this caller was the one that did not, so
     the module that CLASSIFIES a pane and the module that SHOWS it to a person
     read different text off the same screen.
     ⚠️ MEASURED, AND IT IS A REGRESSION #1155 INTRODUCED THAT NOBODY TESTED FOR:
     on a WRAPPED pane an option-less prompt -- "Do you want to proceed?", the
     real observed shape at `status.test.js:347` -- can classify `idle`, because
     that rule needs the marker to OPEN the line and the line to CLOSE at the
     question, and a wrap breaks both.
     🛑 THIS USED TO READ "on any pane narrower than the question" AND THAT
     QUANTIFIER IS FALSE. Measured 2026-08-28 across every width from 6 to 79,
     both marker sets loaded side by side, control at 80 columns where they
     agree: "Do you want to proceed?" diverges at ONE width, 22; "Would you
     like to continue?" diverges at 17-26. BELOW the divergence the marker
     string itself is split, so neither version matches and no red is lost --
     including at the 20 columns this comment's own table uses, where pre-#1155
     also reads `idle`. The class is real; the quantifier was not.
       20 columns, without -J:  idle        <- benign. The agent waits, the board
       20 columns, with -J:     needs_you      says it is fine.
     🛑 AND THE SENTENCE THAT USED TO SIT HERE WAS FALSE IN BOTH HALVES,
     TWO LINES BELOW THE CORRECTION ABOVE. It read "Before #1155 the same
     screen read `needs_you`, because the old rule tested the whole tail and
     did not care where the rows fell." Measured: at the 20 columns this
     comment's own table uses, pre-#1155 reads NOT-RED as well, so it is not
     "the same screen"; and the old rule was a regex over a tail CONTAINING
     NEWLINES, so it did care where the rows fell -- a wrap inside the marker
     phrase broke it too.
     ✅ The true statement: the old rule tolerated a wrap ANYWHERE OUTSIDE the
     marker phrase, and the new one additionally requires the marker to OPEN
     the line and the line to CLOSE at the question. The band where they differ
     is therefore the widths that are wide enough to keep the phrase intact and
     narrow enough to break that stronger shape -- one width for this prompt,
     ten for "Would you like to continue?".
     📌 LATENT, NOT LIVE, at the time of writing: all 18 panes on this Mac are 80
     columns and the observed prompts are 22-29 chars. It becomes live the moment
     a pane is split or a prompt is longer than its pane. */
  return sh(tmuxBin(), ['capture-pane', '-p', '-J', '-t', target, '-S', `-${lines}`]);
}

/**
 * Is a Claude process running in this pane at all?
 *
 * pane_current_command reports a version string ("2.1.222") when Claude Code
 * is running, and a shell name when it is not. That distinguishes running from
 * stopped and nothing else -- it cannot tell working from idle from blocked.
 */
// ⚠️ DERIVED, not a second rule. This was a denylist of six shell names, which
// made every editor, REPL and login shell read as a running Claude. See
// `isClaudeCommand` for what that cost.
function isClaudeRunning(command) {
  return isClaudeCommand(command);
}

/**
 * Codex, with no other plausible reading (#249): the binary installs as
 * `codex` and nothing else common shares the name. Kept as strict as
 * `isUnambiguousClaude`, and deliberately NOT folded into isClaudeCommand:
 * the classifier dispatches per runner, it does not pretend one runner is
 * the other.
 */
function isCodexCommand(command) {
  const c = String(command || '').trim();
  return c === 'codex' || c === 'codex.exe';
}

/**
 * Braille spinner frames. Claude Code animates these in the pane title while
 * it is actively producing output, so their presence is a live "working"
 * signal. Their absence is NOT evidence of idleness -- we may simply have
 * sampled between frames.
 */
const SPINNER = /[⠀-⣿]/;

// Frozen (round 29): this is exported as the live array the classifier
// itself reads, so a consumer pushing into it would rewrite the board's
// definition of needs_you from outside. Freezing makes the one-derivation
// contract structural instead of conventional.
const NEEDS_YOU_MARKERS = Object.freeze([
  /Do you want to proceed/i,
  /Would you like to/i,
  /\bAllow\b.*\?/,
  /permission to/i,
  /❯\s*1\.\s*Yes/,
]);

/* Companions to NEEDS_YOU_MARKERS, used by `asksSomething` below. OPTION_LINE is
   anchored so a quoted glyph mid-sentence is not a prompt; ENDS_AT_QUESTION is what
   separates a question from a sentence that merely contains one. */
/* ❯ ONLY, NOT ›. This qualifies the CLAUDE marker list; Codex's › is owned by
   CODEX_NEEDS_YOU_MARKERS on its own path, and #245 pins that a node-fronted
   pane with NO recorded runner must stay UNKNOWN on the Claude path rather
   than being rescued by a Codex glyph. Including › here made that test fail,
   which is the separation #249/#998 exist to keep. */
const OPTION_LINE = /^\s*❯\s*\d+\.\s/;
const ENDS_AT_QUESTION = /\?\s*(\([yYnN/]+\))?\s*$/;


/**
 * The selector glyphs a runner draws beside the highlighted option, as a
 * character class two files can share.
 *
 * 🛑 IT LIVES HERE, EXPORTED, BECAUSE TWO PARSERS KEYED ON THIS SEPARATELY
 * AND DISAGREED (#998). This file's markers knew Codex draws › (U+203A) and
 * Claude draws ❯ (U+276F) -- #249 exists entirely because of that difference.
 * `engine/chat.js`'s option parser knew only ❯. So a Codex agent's choice
 * prompt was correctly detected as "waiting on an answer" and then produced
 * NO buttons, because the option lines never matched: the person was told
 * their agent was stuck and given nothing to unstick it with.
 *
 * ⚠️ ADD TO THIS BY OBSERVING, exactly as the marker lists above demand. A
 * guessed glyph is the same 0-for-1 bet as a guessed wording. Plain ASCII `>`
 * is deliberately NOT here: no runner has been observed drawing it.
 */
const SELECTOR_GLYPHS = '❯›';
/* ⚠️ VALIDATED AT LOAD, because this string is interpolated into a CHARACTER
   CLASS in engine/chat.js and the docblock above invites future additions. A
   `^` added here would yield `[^❯›]`, which matches ANY leading character and
   so sets the menu-vs-prose `marked` gate on plain prose -- the parser that
   types into a live terminal, failing OPEN. `]`, `-` and `\` break the class
   the same way. Cheap, load-time, and it turns a silent widening into a crash
   on the line that caused it. */
if (typeof SELECTOR_GLYPHS !== 'string' || !SELECTOR_GLYPHS.length
    || /[\\\]^-]/.test(SELECTOR_GLYPHS)) {
  throw new Error('SELECTOR_GLYPHS must be a non-empty string of plain characters: '
    + 'it is interpolated into a regex character class, where ^ ] - and \\ change its meaning');
}

/**
 * Codex's needs-you shapes (#249). OBSERVED, per this file's own rule that
 * guessed wordings are 0 for 1 against reality: captured from a live
 * codex-cli 0.149.0 pane on this machine, 2026-08-23. Its selection dialog
 * draws
 *
 *   › 1. Yes, continue
 *     2. No, quit
 *
 * and the selector glyph is › (U+203A), NOT Claude's ❯ (U+276F), which is
 * the whole reason this card exists: to a byte-for-byte matcher those are
 * different prompts, so a Codex agent asking a question matched nothing and
 * the board's one red state was structurally unreachable for it.
 *
 * ⚠️ ONE OBSERVED SHAPE, DELIBERATELY. The command-approval dialog could
 * not be observed tonight (this machine's Codex API key answers 401, a
 * finding reported on its own), so it is not guessed at here. Add to this
 * list by OBSERVING, exactly as the rate-limit markers demand.
 */
/**
 * 🛑 ANCHORED, BECAUSE #1178 FIXED THE CLAUDE BRANCH AND LEFT THIS ONE (#1243).
 *
 * Its Claude counterpart three lines up, `OPTION_LINE`, is `/^\s*❯\s*\d+\.\s/`,
 * and #1178's note beside it says why: *"structural options only when the glyph
 * OPENS the line. `and then ❯ 1. Yes underneath it.` is prose about a prompt,
 * not a prompt."* Exactly the same is true of `›`, and this array was tested
 * anywhere in the tail. Measured before the anchor: a codex agent whose screen
 * carried the sentence `The codex marker is the line drawn as › 1. Yes.`
 * classified `needs_you`.
 *
 * The `m` flag matters: the codex classifier tests this against the whole tail
 * rather than per line, so `^` has to mean line-start rather than text-start.
 * `chat.js`'s two consumers (`:930`, `:1270`) already test one line at a time,
 * where the anchor is correct either way.
 *
 * 📌 KEPT NARROW ON THE VOCABULARY ON PURPOSE. `OPTION_LINE` accepts any digit;
 * this stays on the captured `1. Yes` because every Codex shape in this file was
 * captured from a live pane (#249, #998) and a second observed prompt is what
 * would license widening it, not a symmetry argument.
 */
/* 🔑 THE SECOND OBSERVED PROMPT ARRIVED, AND IT IS WHAT LICENSES THE WIDENING
   (#1320). The note above says so in its own words: "a second observed prompt is
   what would license widening it, not a symmetry argument." This is not the
   symmetry argument. PigeonPete captured this off a live pane on 2026-08-28
   while answering #1315, verbatim:

       › 1. Update now (runs `npm install -g @openai/codex`)
         2. Skip
         3. Skip until next version

   ⇒ The old list required the first option to literally say `Yes`, so EVERY
   codex agent stopped here and the board called it `unknown`, the same word it
   uses for an agent that is merely quiet. Nothing escalated. Nobody was told.

   ⚠️ IT MATCHES THE STRUCTURE, NOT THE WORDS, and that is the point of the card:
   a prompt that is not phrased as a question was invisible. `Update now` is not
   a question and neither is `Skip`.

   🛑 BUT IT REQUIRES A SECOND OPTION LINE, which plain OPTION_LINE does not, and
   that is deliberate rather than cautious: codex draws `›` as its COMPOSER
   glyph, so somebody typing `1. fix the bug` into the box would render
   `› 1. fix the bug` and a bare option-line pattern would call that a prompt.
   A real prompt always draws its other choices underneath, unglyphed. Measured
   against both of Pete's captures and against a composer line.

   📌 THE ANCHOR AND THE `m` FLAG SURVIVE UNCHANGED, for #1243's reason stated
   above: `^` has to mean line-start because this is tested against the whole
   tail, or prose describing a prompt classifies as one. */
const CODEX_NEEDS_YOU_MARKERS = Object.freeze([
  /^\s*›\s*1\.\s*Yes/m,
  /^\s*›\s*\d+\.\s.*\n\s*\d+\.\s/m,
]);

/**
 * Every runner's needs-you shapes, for consumers that read a PANE without
 * knowing which runner drew it (chat.js's question finder). The per-runner
 * classifiers keep using their own lists; this union exists so a question
 * on any runner's screen can be found and sliced for display.
 */
const ALL_NEEDS_YOU_MARKERS = Object.freeze([...NEEDS_YOU_MARKERS, ...CODEX_NEEDS_YOU_MARKERS]);

/**
 * 🛑 THE FIRST FOUR WERE GUESSES AT WORDING AND CLAUDE CODE SAYS SOMETHING ELSE.
 *
 * Josh, 2026-08-21, from the raw window of an agent that could not answer him:
 *
 *   You've reached your Fable 5 limit. Run /usage-credits to continue or
 *   switch models with /model.
 *
 * None of `rate limit`, `usage limit`, `429` or `try again later` appears in
 * that sentence — it says usage-CREDITS, not usage limit — so the agent
 * classified as IDLE. Her card read Idle while she was blocked and could not
 * work, which is the board reporting health it has not verified, the one thing
 * `classify` exists to prevent.
 *
 * ⚠️ THE LAST TWO ARE OBSERVED AND THE FIRST FOUR ARE NOT. Nobody has produced
 * a pane containing "rate limit" or "429"; they are plausible strings somebody
 * wrote down. These two came off a screenshot of the real thing. Add to the
 * observed half by observing — the guesses are 0 for 1 against reality.
 *
 * 📌 Broad on the model name (`reached your … limit`) because the vendor puts
 * the model in the middle of it, and narrow on `/usage-credits`, a literal
 * command string that cannot appear by accident. Neither widens the false
 * positives: a pane merely DISCUSSING rate limits already matched `/rate limit/`
 * before this change, which is why 0.2.20 made the card say what it SAW
 * ("its screen mentions a usage limit") rather than what it concluded.
 *
 * 🛑 `/usage limit/i` REMOVED 2026-08-25. Josh's screenshot of a fresh Mac
 * Mini's very first agent (Casey), healthy account, zero real usage:
 *
 *   Fable 5 is now a standard part of your Max plan
 *   You can use up to 50% of your weekly usage limit on Fable 5. If you hit
 *   your limit, you can continue on Fable 5 with usage credits...
 *
 * This is Claude Code's own benign startup promo banner, not a block. It
 * contains the words "usage limit" describing a FEATURE, so the bare phrase
 * marker fired on a healthy, idle agent and stuck her card on "Paused" —
 * the same class of failure as the 2026-08-21 incident above, mirrored: that
 * one was a real block the markers were too NARROW to see, this one is a
 * non-block the markers were too BROAD to rule out. Safe to drop: the banner
 * matches neither `/reached your .{0,40}limit/i` (no "reached your" phrasing)
 * nor `/\/usage-credits\b/` (says "usage credits", not the "/usage-credits"
 * command), and every genuine block this array exists to catch keeps at
 * least one of the other five markers.
 *
 * 🛑 THE THREE REMAINING GUESSES REMOVED 2026-08-27 (#1180). The paragraph above
 * says the guesses are "0 for 1 against reality" and then keeps them. They were
 * not merely useless: they were the live cause of a FALSE CALM, which is the
 * failure this board keeps paying for.
 *
 * Measured through the real `classify()`, all five rows returning `rate_limited`:
 *
 *   'I hit the rate limit earlier but it cleared. Continuing with the sweep.'
 *   'That endpoint was flaky, so I will try again later in the run.'
 *   'The log shows 429 responses from the API during the burst.'
 *   'I hit the rate limit earlier.'  +  'Do you want to proceed?'
 *
 * ⚠️ THE LAST ROW IS THE EXPENSIVE ONE, AND IT IS NOT A WRONG BADGE. This array
 * is tested BEFORE the needs-you branch, deliberately, so an agent genuinely
 * ASKING A QUESTION with the words "rate limit" anywhere in its last 25 lines
 * was reported rate-limited and ITS QUESTION NEVER SURFACED. The agent waits,
 * and the board shows a plausible, wrong, calm-looking reason for the silence.
 *
 * 📌 PROVENANCE, FROM THE LOG RATHER THAN FROM MEMORY. `git log -S` puts
 * `/rate limit/i`, `/\b429\b/` AND `/try again (later|at)/i` all in `78b6720c`
 * ("Phase 1: read-only status engine", 2026-08-06) -- the scaffolding commit,
 * three weeks before anyone watched a real limit screen. The comment above says
 * so itself ("the first FOUR were guesses"), and deddd811's own test says none
 * of the four appeared in the real sentence. Only the two dated `observed
 * 2026-08-21` came off a screenshot, and both are kept.
 *
 * ⚠️ CARD #1180's provenance table is WRONG on one row: it lists
 * `try again (later|at)` as observed and first added in deddd811. It is not and
 * it was not. Corrected here because the table was about to license keeping it.
 *
 * 🔑 AND THE TWO OBSERVED MARKERS ARE DELIBERATELY NOT NARROWED, though each
 * still matches one piece of prose ("try again later" is gone with the guesses,
 * but 'We reached your context limit discussion...' still trips
 * `reached your .{0,40}limit`). Four narrowings were tested against the real
 * 2026-08-21 screen plus plausible unobserved phrasings, and EVERY ONE that
 * killed the prose also dropped a real limit:
 *
 *   requiring the clause to end at "limit"   -> loses "...limit and cannot continue"
 *   allowing a comma too                     -> loses "...limit for Opus 5"
 *   forbidding a following lowercase word    -> loses both
 *
 * A missed limit is #880's regression and is worse than a rare false pause, so
 * the remaining false positive is LEFT IN and recorded rather than traded for
 * one. Narrowing these two needs a SECOND observed screen, not a cleverer regex.
 */
const RATE_LIMIT_MARKERS = [
  /reached your .{0,40}limit/i,   // observed 2026-08-21
  /\/usage-credits\b/,            // observed 2026-08-21
];

/**
 * #874. Captured from a live pane, 2026-08-25, an agent whose account's
 * bearer token had been revoked or expired:
 *
 *   401 {"type":"error","error":{"type":"authentication_error","message":
 *   "OAuth access token is invalid."},"request_id":null}
 *   Retrying in 30 seconds… (attempt 7/10)
 *
 * `"OAuth access token is invalid"` is the specific message this exact
 * failure printed; `"type":"authentication_error"` is Anthropic's own
 * error-type field for the whole class (also observed directly in the
 * same capture, not guessed at) -- an expired token or a token from a
 * fully revoked account would carry a different message but the same
 * type, so both are kept rather than only the narrower string.
 *
 * ⚠️ CHECKED IN THE CLAUDE BRANCH OF classify() ONLY. Codex's own
 * 401-in-a-reconnect-loop (#249, this file's own CODEX_WORKING fixture in
 * status.test.js, captured from a live codex-cli pane) is a DIFFERENT
 * shape ("Unexpected status 401 Unauthorized" during a live reconnect,
 * not this Anthropic-specific error envelope) on a completely separate
 * branch of classify() that returns before this module is ever reached --
 * that pinned test is deliberately left as WORKING and this change does
 * not touch it.
 */
const AUTH_FAILED_MARKERS = [
  /OAuth\s*access\s*token\s*is\s*invalid/i,
  /"type":\s*"authentication_error"/i,
];

/**
 * The envelope the two markers above were captured INSIDE, and the thing that
 * separates a dead token from an agent talking about one (#1233).
 *
 * 🛑 A MARKER IN A SENTENCE IS NOT A DEAD TOKEN. Measured through the shipped
 * classifier, four plausible agent sentences all returned `auth_failed`:
 *
 *   'I narrowed AUTH_FAILED_MARKERS so that "type":"authentication_error" ...'
 *   'The pane said OAuth access token is invalid, which is how #874 was found.'
 *   'The card should carry the captured line verbatim:' + the payload below it
 *   'The marker is "type":"authentication_error" ...' + 'Do you want to proceed?'
 *
 * ⚠️ AND IT IS THE WORST OF THE THREE MARKER SETS TO BE WRONG IN. `auth_failed`
 * is tested BEFORE the needs-you branch, and #966's rule 3b makes a scraped
 * `auth_failed` stand over a fresh self-report, both correct for a real dead
 * token. On a false positive they compose into this, measured:
 *
 *   agent reports  {state: needs_you, because: 'May I merge the PR?'}
 *   board shows    {state: auth_failed, reported: false, conflict: null}
 *
 * The question is gone, the agent's own account of itself is discarded, and no
 * conflict is raised, so nothing on screen hints the two witnesses disagreed.
 * The needs-you path at least surfaces a conflict; this one does not.
 *
 * 🔑 #1180's remedy does not apply: there are no guesses to drop. Both markers
 * were captured 2026-08-25, off the SAME line. What the prose lacks is the rest
 * of that line, so the rest of that line is the discriminator.
 */
const AUTH_ENVELOPE = /"type":\s*"error"/i;

/* #369: the CURRENT mid-turn spinner line, keyed on structure. See the
   comment at its use site in classify(). Module-level like its sibling
   marker sets. Whitespace INSIDE the timer group is \s+ too, so a
   narrow pane wrapping anywhere in the line (gerund-to-paren, or between
   timer units) still classifies; probed at all three wrap points.
   🛑 THE FRAME CLASS IS MEASURED, NOT GUESSED, and it excludes ⏺ on
   purpose: that is the bullet Claude prefixes on every line the AGENT
   writes, so including it (an earlier draft did) turned any echoed
   "⏺ Waiting… (10s)" into a working verdict on a finished pane. */
const WORKING_LINE = /^\s*[·✢✳✶✻✽*] \S+…\s+\((?:\d+h\s+)?(?:\d+m\s+)?\d+s(?:\s*·|\))/mu;

/**
 * The OLD progress line's phrase, and it has to be inside the parentheses
 * the runners draw it in (#1243).
 *
 * 🛑 A SENTENCE CONTAINING THE PHRASE IS NOT A RUNNING TURN, AND THIS ONE FAILS
 * TOWARD CALM. Measured on two panes differing only in one clause, both with
 * the prompt footer on screen, which is what a real waiting agent looks like:
 *
 *   '⏺ Codex draws "(4s esc to interrupt)" the way Claude s older UI did.'
 *      -> working, "it is mid-task"
 *   '⏺ Codex draws its own progress line the way Claude s older UI did.'
 *      -> idle, "it is sitting at its prompt"
 *
 * The agent is waiting for the person and the board says it is busy. This rule
 * is tested above the footer rule, so it wins, and nobody goes to look at an
 * agent that is mid-task. Same shape as #880, arriving through the vocabulary
 * instead of through a missing marker.
 *
 * 🔑 EVERY OBSERVED INSTANCE IS PARENTHESISED, on both runners:
 *
 *   • Reconnecting... 4/5 (4s • esc to interrupt)   <- codex, captured live
 *   · Working (esc to interrupt)                    <- old Claude UI
 *
 * so the parens are structure that is already there rather than a rule imposed
 * on the runners. Prose carries the phrase bare in a sentence.
 *
 * ⚠️ THE RESIDUAL, PINNED AND NOT TRADED AWAY: prose that QUOTES the
 * parenthesised form still matches, the same residual #1233 and #1180 both
 * carry. Killing it would need the timer too, and the old Claude UI's own line
 * has no timer, so that would drop a real working pane.
 */
const INTERRUPT_LINE = /\([^)]*esc to interrupt[^)]*\)/i;

/**
 * The first line of `text` that any of `markers` matches, or null.
 *
 * ⚠️ RETURNS THE LINE, NOT A BOOLEAN, so a caller can show what it saw rather
 * than assert what it concluded. Trimmed of the tree-drawing glyphs Claude Code
 * prefixes its own notices with, and capped: pane text is arbitrary and this is
 * on its way to a person's screen.
 */
function matchedLine(text, markers) {
  const lines = String(text == null ? '' : text).split('\n');
  for (const raw of lines) {
    if (!markers.some((re) => re.test(raw))) continue;
    /* #887: the class must also cover the two PROMPT glyphs, Claude Code's
       ❯ (U+276F) and Codex's › (U+203A), or evidence captured from the line
       the prompt prefixes renders as "❯ 401 {...}" on a person's screen.
       Observed live on 0.5.31's #880 walk. */
    /* 📌 NOT SELECTOR_GLYPHS, deliberately (#998): this strips FRAME and
       prompt characters as well as selectors, and it includes plain `>`,
       which the glyph class excludes because no runner has been observed
       drawing it as a selector. Two overlapping sets with different jobs;
       collapsing them would widen one of them by accident. */
    const line = raw.replace(/^[\s>│├└─*❯›]+/, '').trim();
    if (!line) continue;
    return line.length > 240 ? line.slice(0, 240) + '…' : line;
  }
  return null;
}

/**
 * The whole MESSAGE that starts at the first line matching `markers`, not just
 * that line (#1248).
 *
 * 🛑 THE VENDOR WROTE A MESSAGE AND THIS FIELD WAS READING A LINE. The real
 * 2026-08-21 limit screen is two lines:
 *
 *   You've reached your Fable 5 limit. Run /usage-credits to continue or
 *   switch models with /model.
 *
 * `matchedLine` returns the first, so the board showed ONE of the vendor's two
 * remedies and ended the sentence on the word "or", which reads as a truncation
 * without saying what was cut. Measured at every pane width from 40 to 200
 * columns: the second remedy was absent at all 41. It is not a wrapping
 * problem, and `-J` (#1234) does not touch it.
 *
 * ⚠️ THAT FIELD EXISTS FOR EXACTLY THE THING IT WAS DROPPING. Its own comment:
 * "That names the model, carries the vendor's own two remedies, and stays true
 * if the wording changes under us." Josh asked for something that would "prompt
 * a user to know" their usage is full; half a remedy is the part that does that
 * work.
 *
 * 🔑 WHERE IT STOPS, and it is three bounds rather than one:
 *   - a line ending in a sentence terminator ENDS the message. The observed one
 *     ends at "/model." and the first line deliberately does not, because the
 *     vendor's own sentence continues.
 *   - a following line that is not prose ends it too. A limit message with the
 *     prompt footer under it must never paste "⏵⏵ accept edits on…" into a
 *     person's screen, so a continuation has to OPEN with a letter, digit or
 *     slash. Every runner's chrome opens with a glyph.
 *   - at most two extra lines, the same window the working-line evidence
 *     builder uses, and the same 240-character cap as everything else here.
 *
 * 📌 Joining with a single space is correct BECAUSE of #1234: `capture-pane`
 * now passes `-J`, so these are logical lines and a wrapped row can no longer
 * arrive as two. Before that landed this could not have been done safely at all
 * (a wrapped row must be joined with nothing and a real line with a space, and
 * nothing downstream could tell them apart).
 */
function messageAt(text, markers) {
  const rows = String(text == null ? '' : text).split('\n');
  const ENDS = /[.!?]["')\]]?\s*$/;
  const CONTINUES = /^[A-Za-z0-9/]/;
  for (let i = 0; i < rows.length; i += 1) {
    if (!markers.some((re) => re.test(rows[i]))) continue;
    let out = rows[i].replace(/^[\s>│├└─*❯›]+/, '').trim();
    if (!out) continue;
    for (let extra = 0; extra < 2 && !ENDS.test(out); extra += 1) {
      const next = rows[i + 1 + extra];
      if (next === undefined) break;
      const line = next.replace(/^[\s>│├└─*❯›]+/, '').trim();
      if (!line || !CONTINUES.test(line)) break;
      out += ' ' + line;
    }
    return out.length > 240 ? out.slice(0, 240) + '…' : out;
  }
  return null;
}

/**
 * A dead token, or an agent with the words on its screen? (#1233)
 *
 * 🔑 TESTED AGAINST THE PAYLOAD, NOT AGAINST A SCREEN ROW, and that one change
 * fixes both directions of the same fault.
 *
 * FALSE RED. Prose carries a marker and nothing else; the real screen carries
 * the marker inside Anthropic's error envelope:
 *
 *   401 {"type":"error","error":{"type":"authentication_error","message":
 *   "OAuth access token is invalid."},"request_id":null}
 *   Retrying in 30 seconds… (attempt 7/10)
 *
 * Requiring `AUTH_ENVELOPE` alongside the marker drops all four measured
 * sentences and keeps the captured screen.
 *
 * FALSE CALM, which is the more expensive half and was found by measuring
 * rather than reasoning. `capturePane` does NOT pass `-J`, so the tail is
 * SCREEN ROWS and that ~120-character line wraps. Driven through real tmux
 * panes, one width at a time, the captured #874 screen classified:
 *
 *   width 40..51  ->  unknown        <- a REAL dead token, missed
 *   width 52..200 ->  auth_failed
 *
 * Same screen, same code; the only variable was how wide the window was. That
 * is #880's regression, which this file argues is the worse failure. Joining
 * the rows is exactly what undoes a wrap, so the same join that lets the
 * envelope be seen also restores the narrow pane. (The wider divergence, that
 * this module reads rows while `chat.js` and `connect.js` both read logical
 * lines, is #1234 and is deliberately NOT fixed here: `-J` would change the
 * input to every rule in this function at once.)
 *
 * ⚠️ JOINED WITH NO SEPARATOR, because a wrap eats the character at the
 * boundary: at 100 columns the capture splits `inva|lid`, and any separator
 * would leave a word that no marker matches. The cost is that a space wrapped
 * away is gone too (`"OAuth|access` at 80 columns), which is why the markers
 * spell their spaces `\s*` rather than ' '.
 *
 * ⚠️ AND ONE RESIDUAL IS PINNED RATHER THAN TRADED AWAY: an agent that pastes
 * the WHOLE payload verbatim still reads `auth_failed`. It is a far rarer
 * sentence than the four above, and every narrowing that would kill it also
 * risks a real screen whose envelope is worded differently. A missed dead token
 * is worse than a rare false pause; that trade is this file's oldest rule.
 */
function authFailed(tail) {
  /* Leading indentation and Claude's tree glyphs are stripped per row before
     the join for the same reason `matchedLine` strips them: they are drawing,
     not content. Rows that were NOT wrapped get glued to their neighbour as a
     side effect, which cannot manufacture an envelope out of prose that does
     not already contain one, but is worth knowing when reading a match. */
  const rows = String(tail == null ? '' : tail)
    .split('\n')
    .map((line) => line.replace(/^[\s>│├└─*❯›]+/, ''));
  const joined = rows.join('');
  /* 🛑 THE MARKER AND THE ENVELOPE MUST MEET ON ONE ROW (#1241). This gate used
     to run against `joined`, which was the only way to reassemble a wrapped
     payload while `capture-pane` returned screen rows. `-J` does that job now, at
     the capture, and ONLY for rows that were actually wrapped.
     ⚠️ The blind join's own comment said gluing "cannot manufacture an envelope
     out of prose that does not already contain one". TRUE OF ONE LINE, FALSE OF
     TWO. Measured on the shipped build: a card comment quoting the marker on one
     line and the envelope on the next classified `auth_failed`, and so did prose
     about #874 sitting above a real `overloaded_error` payload -- two TRUE things
     on one screen joined into a third that is false.
     ⭐ The first of those is a comment documenting this very fix: a detector keyed
     on a literal matches the prose that describes it, so prose has to be separable
     from payload, and what separates them is that a real payload is ONE row.
     📌 The EVIDENCE logic below still consults `joined`, deliberately: a capture
     clipped mid-redraw can split a payload that `-J` would otherwise have joined,
     and showing a person a reassembled line beats showing them nothing. Detection
     is the half that must not be fooled; evidence is read only once detection has
     already been satisfied by a single row. */
  /* Detection accepts a payload that is whole on ONE row, or one that is whole
     across rows a terminal WRAPPED. It must not accept one assembled out of two
     rows of prose, which is what gluing every row unconditionally did (#1241).
     🔑 A WRAPPED ROW ENDS MID-TOKEN; A PROSE ROW ENDS IN PUNCTUATION. Measured
     against the verbatim capture fixtures below and the #1241 prose:
       wrap   `...{"type":"authenticat`      ends mid-token
       prose  `...in engine/status.js.`      ends with a full stop
       prose  `...which is how #874 was found.`   ends with a full stop
     ⚠️ THIS IS A HEURISTIC AND IT IS THE WEAKER HALF OF THE FIX. `-J` at the
     capture is the real answer and makes this path unreachable from a live pane;
     it is kept because `classify()` is also called directly, and because a
     capture clipped mid-redraw can still split a payload. If it ever has to be
     tightened, tighten `-J` coverage first. */
  const wholeOnOneRow = rows.some(
    (row) => AUTH_FAILED_MARKERS.some((re) => re.test(row)) && AUTH_ENVELOPE.test(row),
  );
  const wrapJoined = rows
    .map((row, i) => (i + 1 < rows.length && /[A-Za-z0-9_"{,:]$/.test(row) ? row + rows[i + 1] : ''))
    .some((glued) => glued && AUTH_FAILED_MARKERS.some((re) => re.test(glued)) && AUTH_ENVELOPE.test(glued));
  if (!wholeOnOneRow && !wrapJoined) return null;
  /* Evidence is the payload read WHOLE, from wherever it can be read whole.
     An unwrapped screen keeps today's contract exactly: the matched LINE,
     glyph-stripped and capped, because the entire envelope is on it. A row
     carrying a marker but only PART of the envelope is a wrap fragment, and
     returning it puts a sentence starting mid-token on a person's screen
     (`ion_error","message":"OAuth access token is invalid.` at 52 columns,
     `401 {"type":"error","error":{"type":"authentication_error"` at 62, both
     measured), so those fall through to the joined form. Wholeness is the
     brace closing, not the envelope merely appearing: at 62 columns the row
     has the envelope, a marker, and no close at all. */
  const line = matchedLine(tail, AUTH_FAILED_MARKERS);
  if (line !== null && closedEnvelope(line) !== null) return line;
  const payload = closedEnvelope(joined);
  if (payload !== null) return payload;
  /* No close anywhere: a capture clipped mid-redraw. Show what there is,
     from the same starting point a closed one would use, capped, rather than
     nothing and rather than an unbounded run. */
  const cut = joined.slice(envelopeStart(joined));
  return cut.length > 240 ? cut.slice(0, 240) + '…' : cut;
}

/**
 * Where the evidence should start: the envelope's opening brace, or the HTTP
 * status when one sits right in front of it, because "401" is the part a
 * person reads first. Bounded, so it cannot pick up prose that happens to end
 * in three digits far from the payload. Returns 0 when there is no envelope,
 * so a caller slicing with it still gets text rather than an exception.
 */
function envelopeStart(text) {
  const at = text.search(AUTH_ENVELOPE);
  if (at === -1) return 0;
  const open = text.lastIndexOf('{', at);
  if (open === -1) return 0;
  const status = text.slice(Math.max(0, open - 5), open).match(/(\d{3})\s*$/);
  return status ? open - status[0].length : open;
}

/**
 * The error envelope in `text`, from its HTTP status (when one is right in
 * front of it) to the brace that CLOSES it, or null if it never closes inside
 * the cap.
 *
 * 🔑 DEPTH-COUNTED, NOT `lastIndexOf('}')`. `authFailed` joins every row, so a
 * brace on an unrelated row downstream would extend the evidence to swallow
 * the retry line, and a person would be shown one unreadable run
 * (`..."request_id":nullRetrying in 30 seconds…`, measured before this).
 * Closing is also what tells a complete row from a wrap fragment, which is the
 * other thing the caller needs.
 */
function closedEnvelope(text) {
  const at = text.search(AUTH_ENVELOPE);
  if (at === -1) return null;
  const open = text.lastIndexOf('{', at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length && i < open + 240; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth !== 0) continue;
      return text.slice(envelopeStart(text), i + 1);
    }
  }
  return null;
}

/**
 * Classify one pane.
 *
 * Ordered most-certain first. Anything that does not match a rule falls
 * through to UNKNOWN on purpose; that is the honest answer and it is what
 * stops the board reporting health it has not verified.
 */

/**
 * 🛑 A MARKER MATCHING SOMEWHERE IN THE TAIL IS NOT A PROMPT (#1155).
 *
 * `NEEDS_YOU_MARKERS` are phrases, and phrases occur in ordinary agent prose.
 * Measured on the shipped classifier: "I asked Splinter for permission to merge
 * the PR", "Would you like to see the diff before I push it? I can paste it
 * here", "mode 700 so only the owner has permission to read it" and a sentence
 * QUOTING a prompt all classified `needs_you`. FIVE false REDs in total -- the
 * four prose sentences plus the quoted prompt, which is the fifth and is easy
 * to miss because it is a different category.
 * ⚠️ THREE of those four prose sentences are named ABOVE this line; the fourth
 * ("The card says: Allow this to run in the installed layout?") lives only in
 * `status.test.js`, so this docblock has never listed all four. An earlier
 * version here said "Four false REDs from four plausible sentences" and
 * counted the four items IT named -- three prose plus the quoted prompt --
 * which is a DIFFERENT four from the one rule 3 means. Both readings were
 * defensible and they disagreed, which is why the file contradicted itself.
 *
 * ⚠️ AND A FALSE RED IS NOT COSMETIC HERE: `reconcileReport` rule 3 makes a
 * scraped `needs_you` stand OVER a fresh self-report, deliberately, so that a
 * real red is never suppressed. That means a scraped false positive silently
 * overrides an agent's own accurate account of itself.
 *
 * 🔑 WHAT SEPARATES THEM IS STRUCTURE, NOT VOCABULARY OR POSITION. Both were
 * tried on the card and both fail: requiring a selector glyph anywhere fails on
 * a sentence quoting one, and requiring the match in the last N lines fails
 * whenever the prose IS the newest output, which for a chatty agent is most of
 * the time. Position narrows the window; it does not discriminate.
 *
 * A real prompt line is the QUESTION AND NOTHING ELSE: the marker opens the
 * line and the line closes at the question mark (optionally `(y/N)`). Prose
 * either arrives with something in front of the marker ("The card says: Allow
 * ...?", "I asked Splinter for permission to ...") or keeps going after the
 * question ("... push it? I can paste it here."). A runner-drawn option line
 * counts too, and is checked on the RAW line, because the prefix strip below
 * removes the very selector glyph that identifies it.
 *
 * 📌 Structural options only when the glyph OPENS the line. `and then ❯ 1. Yes
 * underneath it.` is prose about a prompt, not a prompt.
 */
function asksSomething(tail) {
  for (const raw of String(tail == null ? '' : tail).split('\n')) {
    if (OPTION_LINE.test(raw)) return true;
    const line = raw.replace(/^[\s>│├└─*❯›]+/, '').trim();
    if (!line) continue;
    for (const re of NEEDS_YOU_MARKERS) {
      const hit = line.match(re);
      if (hit && hit.index === 0 && ENDS_AT_QUESTION.test(line)) return true;
    }
  }
  return false;
}

function classify(pane, paneText) {
  // ⚠️ A MISSING command is not evidence of anything. A truncated tmux line
  // gave `command: ''`, which fell through to "Claude is not running for this one"
  // — `stopped` at STRUCTURED confidence, i.e. a confident structural claim
  // built from a field that was not there. `unknown` is the honest answer, and
  // it is the rule the rest of this module runs on.
  if (pane && pane.command == null) {
    return {
      state: STATE.UNKNOWN,
      confidence: CONFIDENCE.NONE,
      because: 'we could not tell what it is doing',
    };
  }
  // ⚠️ FIRST, before the screen is read at all. `classify` consulted only
  // `pane.command`, so a session this engine has explicitly rejected still got
  // a scraped state: measured, a lone `devserver` running `node` with
  // "Do you want to proceed? (y/N)" on screen produced
  // `{state:'needs_you', confidence:'scraped'}` and occupied the board's
  // headline needs-you count — a vite dev server rendered as an agent asking
  // for help. With "Worked for 3m" on screen it read `idle`.
  //
  // That is this module's one rule inverted: something we KNOW is not ours,
  // reported as something healthy. Reading a pane's screen is only meaningful
  // once we believe the pane is an agent's.
  if (!isFleetSession(pane)) {
    return {
      state: STATE.UNKNOWN,
      confidence: CONFIDENCE.NONE,
      because: 'this is not one of your agents, so we cannot say what it is doing',
    };
  }
  /**
   * A pane running Codex is a RUNNING agent on another runner, not a
   * stopped one (#249). Before this branch it fell through to STOPPED with
   * "Claude is not running for this one" -- true words assembling a false
   * sentence, about an agent that was up and possibly asking for help. It
   * gets its own classifier, built ONLY from observed shapes; anything its
   * screen shows that we have not observed classifies unknown, because "we
   * could not look" must never render as "nothing is happening". The
   * sentences are shared with the Claude path on purpose: a reason is about
   * the AGENT, never the runtime underneath it (codexsession.js's rule).
   */
  if (pane.runner === 'codex' || isCodexCommand(pane.command)) {
    if (paneText === null) {
      return { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'we could not read its screen' };
    }
    const codexTail = paneText.split('\n').slice(-25).join('\n');
    if (CODEX_NEEDS_YOU_MARKERS.some((re) => re.test(codexTail))) {
      return { state: STATE.NEEDS_YOU, confidence: CONFIDENCE.SCRAPED, because: 'it is asking you something' };
    }
    // Observed: codex draws "(4s • esc to interrupt)" on its live progress
    // line, the same phrase Claude's older UI used. Vocabulary coincidence,
    // matched deliberately: it was captured from a real pane, not assumed.
    if (INTERRUPT_LINE.test(codexTail)) {
      return { state: STATE.WORKING, confidence: CONFIDENCE.SCRAPED, because: 'it is mid-task' };
    }
    // Observed: the empty composer, codex's equivalent of sitting at the
    // prompt. Like Claude's footer rule this sits below the checks above:
    // reaching it means nothing said working and nothing said it needs you.
    if (/›\s*Ask Codex to do anything/.test(codexTail)) {
      return { state: STATE.IDLE, confidence: CONFIDENCE.SCRAPED, because: 'it is sitting at its prompt' };
    }
    return { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'nothing on its screen says what it is doing' };
  }
  if (!isClaudeRunning(pane.command)) {
    return { state: STATE.STOPPED, confidence: CONFIDENCE.STRUCTURED, because: 'Claude is not running for this one' };
  }
  if (paneText === null) {
    return { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'we could not read its screen' };
  }

  const tail = paneText.split('\n').slice(-25).join('\n');

  const limitLine = matchedLine(tail, RATE_LIMIT_MARKERS);
  if (limitLine !== null) {
    /**
     * 🔑 THE LINE ITSELF RIDES ALONG, and it is the difference between a claim
     * and evidence. Josh, 2026-08-21: *"is there any way we could show that her
     * usage is full or something, or something that would prompt a user to know
     * that"*. We cannot know his account is spent — all we saw is a sentence on
     * a screen — but we can show him the sentence:
     *
     *   You've reached your Fable 5 limit. Run /usage-credits to continue or
     *   switch models with /model.
     *
     * That names the model, carries the vendor's own two remedies, and stays
     * true if the wording changes under us. Anything we wrote instead would be
     * our paraphrase of somebody else's message, going stale silently.
     *
     * ⚠️ ONE LINE, TRIMMED AND CAPPED. This is pane text on its way to a screen:
     * unbounded, it is a paste of somebody's terminal into a product surface.
     */
    return {
      state: STATE.RATE_LIMITED,
      confidence: CONFIDENCE.SCRAPED,
      because: 'its screen mentions a usage limit',
      /* The whole message, not its first line (#1248). See `messageAt`: the
         vendor's second remedy lives on the line after the marker. */
      evidence: messageAt(tail, RATE_LIMIT_MARKERS),
    };
  }
  /**
   * #874. Checked before NEEDS_YOU/WORKING for the same reason the
   * rate-limit check above is: an agent stuck retrying a rejected token
   * still draws "esc to interrupt"-shaped chrome (the checks below would
   * classify it WORKING forever), and this is a more certain, more
   * specific read of the same lines. Kosmos cannot know the account is
   * fully dead -- a person could reconnect it a second after this reads --
   * but it can show what the screen actually says, the same "line rides
   * along as evidence, not a paraphrase" rule the rate-limit case uses.
   */
  const authLine = authFailed(tail);
  if (authLine !== null) {
    return {
      state: STATE.AUTH_FAILED,
      confidence: CONFIDENCE.SCRAPED,
      because: 'its Claude sign-in is not working',
      evidence: authLine,
    };
  }
  if (asksSomething(tail)) {
    return { state: STATE.NEEDS_YOU, confidence: CONFIDENCE.SCRAPED, because: 'it is asking you something' };
  }
  if (SPINNER.test(pane.title)) {
    return { state: STATE.WORKING, confidence: CONFIDENCE.SCRAPED, because: 'it is producing output right now' };
  }
  if (INTERRUPT_LINE.test(tail)) {
    return { state: STATE.WORKING, confidence: CONFIDENCE.SCRAPED, because: 'it is mid-task' };
  }
  /**
   * The CURRENT spinner line, keyed on structure rather than vocabulary
   * (#369). Newer Claude Code draws its mid-turn line as a bullet, one
   * gerund ending in an ellipsis, and a LIVE elapsed timer opening the
   * parens:
   *
   *   · Improvising… (35s · ↓ 1.5k tokens · thought for 8s)
   *   · Canoodling… (4h 39m 45s · ↓ 673.5k tokens)
   *
   * MEASURED 2026-08-23 on two live Fable sessions mid-turn. Neither line
   * contains "esc to interrupt" (the old UI's phrase, which the rule above
   * keys on), and the gerund is drawn from a large rotating vocabulary, so
   * a word list would be stale on arrival: the finished-line list below
   * already misses "Cooked for" and "Crunched for" for exactly that
   * reason. The stable parts are the ellipsis and the timer, so that is
   * the key. The finished line ("✳ Cooked for 1m 33s", U+2733 as measured,
   * not the U+2731 the enumerated idle list keys on, so those lines reach
   * idle only via the footer rule below) has no parens and cannot match; a
   * person's own text could echo the shape, which is true of every scraped
   * marker in this function and no worse here. The glyph class excludes
   * word and numeral prefixes, so an agent NARRATING its own progress
   * ("1. Deploying… (30s)") does not read as the UI's spinner.
   * ⚠️ ASSUMED: the timer always renders a seconds field. Every observed
   * variant does; if the UI ever drops seconds at large elapsed values
   * this goes false negative and the tile undercounts again.
   *
   * ⚠️ This sits ABOVE the prompt-footer idle rule by necessity, not
   * taste: the ⏵⏵ footer stays on screen DURING a Fable turn, so footer
   * evidence cannot separate working from waiting, and before this rule
   * a fleet mid-turn read "0 Working" on the headline tile.
   */
  /* The glyph class is the OBSERVED spinner frames, enumerated, not "any
     punctuation": a bare punctuation class let markdown bullets and
     box-drawing wrap ("- Deploying… (30s)", "> Fetching… (12s)",
     "│ Improvising… (35s)") read as the UI's spinner, and Claude panes are
     full of exactly those shapes. `*` IS a real frame and also a markdown
     bullet; it stays in because an echoed line would need the ellipsis AND
     a live timer to slip through, and dropping it would misread every poll
     that samples that frame. Word and numeral prefixes stay excluded.
     ⚠️ Further assumed false-negative shapes, beside the seconds field
     noted above: a days unit ("(2d 4h…") and a multi-word verb
     ("· Reticulating splines…") do not match; neither has been observed. */
  const m = tail.match(WORKING_LINE);
  if (m) {
    return { state: STATE.WORKING, confidence: CONFIDENCE.SCRAPED, because: 'it is mid-task',
             /* The whole line via the module's own convention (glyph-strip,
                240 cap), not the regex fragment. A narrow pane can hard-wrap
                the spinner line between gerund and timer: the classification
                still fires (\s+ crosses the wrap) but no single raw line
                matches, so the per-line reader comes back empty and the
                match itself, whitespace-normalised, keeps the contract that
                evidence shows what the board saw. (matchedLine's strip class
                takes the leading glyph off a *-frame line; cosmetic, and the
                fallback path keeps its glyph.) */
             evidence: (() => {
               /* ONE evidence path, this builder, on every match (wrapped
                  or not): start of the match's own line through the end of
                  the line the TIMER'S close paren sits on. The close is
                  searched from the timer's OWN opening paren (a gerund may
                  legally contain parens), and only inside a two-extra-line
                  window, because a capture clipped mid-redraw has no close
                  at all and an unbounded scan pastes whatever later line
                  happens to carry one (the prompt footer does) into a
                  product surface. A close that is absent or out of window
                  yields the match's own line with the truncation marker,
                  so a cut is visibly a cut. matchedLine is not used here:
                  a wrapped line's first fragment satisfies the regex alone
                  (a trailing separator doubles as the close), so the
                  per-line reader would return exactly the dangling cut
                  this contract forbids. Glyphs are kept as captured. */
               const from = tail.lastIndexOf('\n', m.index) + 1;
               const open = m.index + m[0].lastIndexOf('(');
               let win = tail.indexOf('\n', m.index + m[0].length);
               if (win !== -1) win = tail.indexOf('\n', win + 1);
               const bound = win === -1 ? tail.length : win;
               const paren = tail.indexOf(')', open);
               const closed = paren !== -1 && paren < bound;
               const at = closed
                 ? tail.indexOf('\n', paren)
                 : tail.indexOf('\n', m.index + m[0].length);
               const line = tail.slice(from, at === -1 ? tail.length : at)
                 .replace(/\s+/g, ' ').trim();
               if (line.length > 240) return line.slice(0, 240) + '…';
               return closed ? line : line + '…';
             })() };
  }
  if (/✱|Worked for|Brewed for|Baked for|to save .* tokens/i.test(tail)) {
    return { state: STATE.IDLE, confidence: CONFIDENCE.SCRAPED, because: 'it finished and is waiting for you' };
  }
  /**
   * ⚠️ THE INPUT BOX ITSELF, and it has to be last.
   *
   * Every marker above is a trace of something the agent DID, and traces scroll
   * away. An agent that has been sitting at its prompt long enough fell through
   * to `unknown` — so the board told the operator "we cannot see this one, so we
   * are not telling you it is fine" about an agent that was plainly waiting for
   * them, and a person who had just created their first agent landed on exactly
   * that card. Measured on a real created agent, and on the fleet: the footer is
   * frequently the only marker left in the last twenty-five lines.
   *
   * The footer is drawn by Claude's own interactive UI, so it is evidence that
   * Claude is running AND rendering a prompt. It is present while working too,
   * which is why this sits BELOW every working check rather than above them:
   * reaching here means nothing said working, nothing said it needs you, and
   * the prompt is on screen. That is waiting for you.
   *
   * ⚠️ Weigh this before extending it, because it moves the board's headline
   * count: with the footer on almost every live Claude pane, `unknown` stops
   * being reachable for a RUNNING agent, and this codebase's whole rule is that
   * "I cannot see it" must never be reported as something healthy. Two things
   * make it a fair trade rather than a green light. The state it produces is
   * "waiting for you", not "fine" — the card says which, and the `because` line
   * names the evidence. And an agent stuck on a question does not show this
   * footer at all: the dialog replaces the input box, so it is caught above by
   * `NEEDS_YOU_MARKERS` rather than swallowed here. If a future Claude draws a
   * blocking prompt WITH the footer still on screen, this becomes the trap the
   * module exists to prevent, and it has to be revisited.
   *
   * ⚠️ And that premise is ASSERTED, not measured. It is a claim about a user
   * interface this repo does not control, so no test here can hold it: the
   * ordering below is pinned, the premise is not, and nothing would notice the
   * day it stops being true. Said plainly rather than left for a reader to
   * assume the tests cover it.
   */
  if (/⏵⏵|\? for shortcuts/.test(tail)) {
    return { state: STATE.IDLE, confidence: CONFIDENCE.SCRAPED, because: 'it is sitting at its prompt' };
  }

  return { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'nothing on its screen says what it is doing' };
}

/** The task line Claude Code keeps in the pane title, stripped of glyphs. */
function taskLine(title) {
  const cleaned = (title || '').replace(SPINNER, '').replace(/^[✀-➿\s]+/, '').trim();
  return cleaned || null;
}

/**
 * Current context-window fill, from the session transcript.
 *
 * Deliberately NOT the pane's "/clear to save Nk tokens" figure. That one is
 * cumulative session tokens: it only ever grows, so a ring driven by it would
 * fill once and never empty, and could never show the reset that is the entire
 * point of showing it. This is per-turn window occupancy, which oscillates and
 * therefore actually predicts a reset.
 */
/**
 * Per-model context limits, in tokens.
 *
 * Evidenced, not assumed. Across eight separate opus-4-8 sessions on this
 * machine the window peaks at 999,173 / 999,076 / 998,545 / 998,022 and so on,
 * clustering just under 1,000,000 and never crossing it. That is a 1M window
 * showing itself repeatedly.
 *
 * An earlier version of this file hardcoded 200,000, which was inferred from
 * the largest number seen at the time rather than from evidence. A ring
 * calibrated to it would have put a real agent at 406% and pegged it full
 * forever.
 *
 * A second attempt tried to learn each agent's ceiling from its own history.
 * That was worse and it was visibly worse: for a session still growing, the
 * highest value it has reached IS roughly its current value, so every agent
 * rendered at 100%. Cleverness that produces a uniformly wrong answer is just
 * a slower way to be wrong.
 *
 * Limits are per-model and must stay that way. A Haiku agent genuinely does
 * have a 200k window, so a single global constant would be wrong again in the
 * other direction.
 */
const CONTEXT_LIMITS = {
  'claude-opus-4-8': 1000000, // observed: 8 sessions peaking 996k-999k
};

/**
 * Models we have not directly watched hit their ceiling.
 *
 * Every current-generation model observed here is consistent with 1M and none
 * contradicts it, so this is applied as a labelled assumption rather than
 * withheld. The UI marks it: an assumed denominator is fine to show as long as
 * nobody is told it was measured.
 */
const ASSUMED_LIMIT = 1000000;
const ASSUMED_LIMIT_MODELS = /^claude-(opus|sonnet|fable)-/;

/**
 * 🛑 HAIKU IS NOT 1M, AND SWEEPING IT INTO THE RULE ABOVE WOULD HAVE BEEN THE
 * DANGEROUS KIND OF WRONG.
 *
 * Josh, 2026-08-21: two of his eight agents read "Unknown" after the memory fix
 * landed, and they were the only two Haiku agents on the board. `limitFor`
 * returns null for `claude-haiku-4-5-20251001` — not in `CONTEXT_LIMITS`, its
 * undated form is not either, and the regex above omits haiku — so `noCeiling`
 * is set, `percent` stays null, and the badge falls back to Unknown. Their
 * memory was being read the whole time; only the denominator was missing.
 *
 * ⚠️ THE COMMENT ON THE RULE ABOVE ARGUES FROM OBSERVATION — "every
 * current-generation model observed here is consistent with 1M and none
 * contradicts it" — and nobody has observed a Haiku agent's ceiling. Being
 * current-generation makes Haiku eligible for that reasoning, not covered by
 * its evidence. Adding it there would have given every Haiku agent a
 * five-times-too-large denominator: one at 80% would draw at 16%, and a person
 * would not know it was nearly full. A vague "Unknown" is a bad reading; a
 * confident 16% for 80% is a wrong one, and this file's whole posture is that
 * the second is worse.
 *
 * 📌 So it gets its own assumed figure, carried as an assumption exactly as the
 * others are, and the UI marks it. Replace this with a measurement the day one
 * exists — `CONTEXT_LIMITS` is where an observed ceiling belongs.
 */
const HAIKU_ASSUMED_LIMIT = 200000;
const HAIKU_MODELS = /^claude-haiku-/;

function limitFor(model) {
  if (!model) return null;
  if (CONTEXT_LIMITS[model]) return { limit: CONTEXT_LIMITS[model], assumed: false };
  const undated = model.replace(/-\d{8}$/, '');
  if (CONTEXT_LIMITS[undated]) return { limit: CONTEXT_LIMITS[undated], assumed: false };
  if (ASSUMED_LIMIT_MODELS.test(model)) return { limit: ASSUMED_LIMIT, assumed: true };
  // Its own figure, for the reason above: the 1M assumption is not Haiku's.
  if (HAIKU_MODELS.test(model)) return { limit: HAIKU_ASSUMED_LIMIT, assumed: true };
  return null;
}



/**
 * Find the transcript belonging to an agent's CURRENT session.
 *
 * The obvious approach -- guess a project directory from the agent's name --
 * silently reads the wrong file. Claude Code creates a project directory per
 * working directory, agents move between directories, and one agent can
 * therefore own transcripts in several places while another agent's directory
 * looks like a plausible match for a name it does not own. That failure is the
 * dangerous kind: it finds *a* transcript, so it looks like it worked, and
 * reports confident numbers from the wrong session.
 *
 * The registry records each agent's live `session_id`, and a transcript is
 * named for its session id. That is an exact identity, not a resemblance, so
 * we resolve by it and search every project directory for the file.
 */
/**
 * ⚠️ The registry is keyed on the SESSION name, and this function used to
 * reconstruct that name by appending `-discord`.
 *
 * For the existing fleet the two are the same string — the session really is
 * `angel-discord` — so nothing looked wrong. For an agent Kosmos creates, whose
 * session is simply `kosmos-demo`, the reconstruction asks for
 * `kosmos-demo-discord_0.0.json`, which never exists. The entry sitting right
 * beside it is called `kosmos-demo_0.0.json`.
 *
 * The consequence was the last piece of Discord coupling still visible to a
 * user: a created agent showed on the board with its name and its role and then
 * `model unknown` and a dashed, unknowable memory ring, permanently, because no
 * transcript could be found for it. Measured on a real agent created through
 * the product on 2026-08-10.
 *
 * ⚠️ And an entry that says whose it is is CHECKED rather than trusted by its
 * filename. It records its own `session_name`, so we confirm the file belongs to
 * the agent we asked about instead of inferring it from what it is called. An
 * entry with no `session_name` at all cannot be checked and is still taken on
 * its filename, which is the pre-existing behaviour and is said here so the
 * guarantee is not read as broader than it is — a file
 * named for one agent holding another's session id would otherwise produce
 * confident numbers about the wrong conversation, which is the exact failure
 * this whole resolution path was written to avoid.
 */
/**
 * ⚠️ A NAME THAT CANNOT WALK OUT OF THE REGISTRY DIRECTORY.
 *
 * Both arguments below are joined into a filename, and both arrive from tmux —
 * which accepts a `/` in a session name (measured: `tmux new -s 'a/b'`
 * succeeds). So a local session called `../../something-discord` is tied by the
 * legacy suffix arm and would have this function read a JSON file outside the
 * root and take a session id from it.
 *
 * `instructions.registryKey` exists to refuse exactly that, and threading the
 * real session through here routed around it. Rather than import across
 * modules for four lines, the same rule is applied at the point the value
 * becomes a path, which is where it can be checked against what it is about to
 * do.
 */
function registrySafe(value) {
  const name = String(value == null ? '' : value);
  if (!name || name === '.' || name === '..') return null;
  if (/[/\\\0]/.test(name) || name.includes('..')) return null;
  return name;
}

/**
 * ⚠️ AN EMPTY LIST HAS SEVERAL CAUSES AND NOTHING HERE SEPARATES THEM: no
 * entry anywhere, a corrupt entry, an entry with no session id, a name we
 * refuse to build a path from, an entry belonging to a DIFFERENT agent. Some of
 * those mean nothing has ever been registered; others mean we could not or
 * would not look.
 *
 * ⚠️ AND "NO ENTRY ANYWHERE" IS NOT THE CLEAN ABSENCE IT READS AS. The key is
 * `<session>_<window>.<pane>` and this only ever builds `_0.0`, so an agent in
 * pane 0.1 has an entry we never look for; a config root with no
 * `agent-registry` directory has none to find; entries get rotated away.
 *
 * 🔑 SO THE CALLER MUST NOT READ AN EMPTY LIST AS "this agent has never
 * started". An earlier version of this comment asserted exactly that, and the
 * claim is what let a running agent be reported as one that had never run.
 * A previous attempt returned a flag saying WHICH kind of empty this was; it
 * did not help, because the kinds it could tell apart were not the kinds that
 * matter, and it cost a second read of every registry file on every poll.
 */
function sessionIdsFor(sessionName, exactSession) {
  // ⚠️ When the caller knows the REAL session name, only that spelling is
  // tried. The board's name is the session with `-discord` stripped, so `foo`
  // and `foo-discord` are one name and two sessions — and trying both spellings
  // for a name means the surviving card of that collision can show the OTHER
  // agent's model and memory at structured confidence. `snapshot` holds the
  // pane, so it passes the session itself and this ambiguity never arises
  // there; the fallback below is for callers that have only a name.
  // ⚠️ The fallback tries the SUFFIXED spelling FIRST. Callers that hold only a
  // name (`instructions.sessionStartedAt`) used to try that spelling and no
  // other, so leading with the un-suffixed one silently changed which session
  // they resolve when a machine has both — the staleness verdict would then be
  // computed from the wrong agent's transcript. New capability, same order of
  // preference as before.
  const safeExact = exactSession === undefined ? undefined : registrySafe(exactSession);
  const safeName = registrySafe(sessionName);
  // A name we would refuse to build a path from resolves to nothing at all,
  // rather than to a path we then hope is harmless.
  // ⚠️ A REFUSAL, NOT AN ABSENCE. We can see there is a name and are declining
  // to build a path from it — the same shape as the identity refusal further
  // down, and the opposite of "nothing has ever been registered here".
  if (exactSession !== undefined && !safeExact) return [];
  if (!safeName) return [];
  const candidates = safeExact
    ? [`${safeExact}_0.0.json`]
    : [`${safeName}-discord_0.0.json`, `${safeName}_0.0.json`];
  const found = [];
  // ⚠️ CANDIDATE-major, not root-major. The comment above promises the suffixed
  // spelling is preferred, and root-major iteration silently broke that promise
  // on any machine with more than one config root (this one has two): root 1's
  // un-suffixed entry would outrank root 2's suffixed one. A stated order of
  // preference that the loop does not implement is the same class of defect as
  // a safety comment that overstates its guard.
  const roots = configRoots();
  for (const candidate of candidates) {
    for (const root of roots) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(root, 'agent-registry', candidate), 'utf8'));
        const owner = String(entry.session_name || '');
        const wanted = exactSession
          ? [exactSession]
          : [sessionName, `${sessionName}-discord`];
        // A registry entry that names a DIFFERENT agent is a collision we
        // deliberately refuse to read across.
        if (owner && !wanted.includes(owner)) continue;
        if (entry.session_id) found.push(entry.session_id);
      } catch { /* try the next candidate */ }
    }
  }
  // ⚠️ ALL of them, in preference order, rather than the first one found.
  // Returning the first meant a caller with only a name (the staleness check)
  // could be handed a session id whose transcript no longer exists, and stop —
  // reporting "no transcript" for an agent whose own transcript was sitting
  // under the other spelling. Registry entries outlive their sessions, so the
  // first match is not necessarily the live one.
  return found;
}

/**
 * The transcript belonging to THIS session, with no folder fallback.
 *
 * 🛑 SPLIT OUT BECAUSE ONE CALLER MUST NOT TAKE THE FALLBACK. Reading a
 * transcript to show what an agent has been doing is happy with the newest file
 * in its folder. Reading one to establish when the CURRENT session started is
 * not: after a restart the new session has no file yet, so the fallback hands
 * back the previous session's, and its birth time is older than the edit that
 * prompted the restart. The verdict then stays "running on older instructions"
 * forever, with a button that cannot clear it -- only speaking to the agent
 * could, because that is what creates the new file. Josh pressed it three times
 * on 2026-08-22; the restart had worked every time (found by Splinter).
 */
function transcriptForSession(agentName, exactSession) {
  for (const sessionId of sessionIdsFor(agentName, exactSession)) {
    for (const root of configRoots()) {
      const projects = path.join(root, 'projects');
      let dirs;
      try { dirs = fs.readdirSync(projects); } catch { continue; }
      for (const d of dirs) {
        const candidate = path.join(projects, d, `${sessionId}.jsonl`);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function transcriptFor(agentName, exactSession) {
  const sessionIds = sessionIdsFor(agentName, exactSession);
  /* 🛑 NO EARLY RETURN HERE ANY MORE, and the early return was the whole bug on
     a clean install. `sessionIdsFor` comes back EMPTY when there is no registry
     to read — which is every machine that is not the fleet's — so returning
     null here made `byWorkdir` below unreachable in exactly the case it exists
     for. Caught by its own test, which is the only reason it is not shipping
     dead: the fix was wired in behind a guard that skipped it. */

  for (const sessionId of sessionIds) {
    for (const root of configRoots()) {
      const projects = path.join(root, 'projects');
      let dirs;
      try {
        dirs = fs.readdirSync(projects);
      } catch {
        continue;
      }
      for (const d of dirs) {
        const candidate = path.join(projects, d, `${sessionId}.jsonl`);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  // No registry entry, or its session has gone. We deliberately do NOT fall
  // back to guessing by NAME: a wrong transcript produces confident numbers
  // about the wrong conversation, which is worse than no numbers at all.
  // 📌 `byWorkdir` below is not that. It keys on the folder Kosmos itself
  // launched the agent in, and then VERIFIES the transcript says the same
  // folder before using it. See its own note.
  return byWorkdir(agentName);
}

/**
 * The transcript found from the folder Kosmos launched the agent in.
 *
 * 🛑 THE REGISTRY THIS FILE READS IS NOT WRITTEN BY CLAUDE CODE, AND NOT BY
 * KOSMOS. On the fleet machine where every one of these code paths was built,
 * `~/.claude/agent-registry/` is written by `~/.claude/scripts/lib/session-recovery.sh`
 * — local tooling that has nothing to do with this product. Kosmos only ever
 * READ that folder; nothing in this repo writes it.
 *
 * ⚠️ SO MEMORY HAS NEVER WORKED FOR ANYBODY WHO IS NOT US. Josh, 2026-08-21, on
 * a clean install: `ls: /Users/cabal/.claude/agent-registry/: No such file or
 * directory`, and every agent on his board reading "Unknown". Not four agents
 * misbehaving — the normal case, on a machine without our fleet's scripts. The
 * development machine had a file the product depended on and did not create,
 * which is why the gap survived every test: they all ran here.
 *
 * 🔑 WHAT THIS USES INSTEAD IS SOMETHING KOSMOS ALREADY KNOWS. Claude Code
 * writes each transcript to `<root>/projects/<the-launch-directory>/<id>.jsonl`,
 * with the directory's path flattened — every character that is not a letter or
 * a digit becomes a dash. MEASURED, not assumed: `/Users/agent1/.openclaw-workspace`
 * is stored as `-Users-agent1--openclaw-workspace`, and the naive
 * `[^A-Za-z0-9] -> -` reproduces it exactly, double dash and all. And the
 * supervisor launches every agent with `-c "$WORKDIR"`, one folder per agent,
 * created by `create.js`. So the folder is derivable from the agent's name.
 *
 * ⚠️ AND THE GUESS IS VERIFIED RATHER THAN TRUSTED, which is what makes this
 * different from the name-guessing the comment above refuses. Two paths CAN
 * flatten to one directory (`a.b` and `a-b` both become `a-b`), so the chosen
 * transcript is opened and its own `cwd` compared against the folder we meant.
 * A mismatch is refused, not used. A wrong reading is the one outcome worth
 * more than a missing one.
 */
function byWorkdir(agentName) {
  return byWorkdirDetailed(agentName).file;
}

/**
 * The same search, keeping WHICH of two worlds it found.
 *
 * 🛑 IT RETURNED ONE NULL FOR TWO OPPOSITE FACTS, which is the third instance of
 * that shape tonight after `because` and `ceilingAssumed`:
 *
 *   no folder, or no transcripts in it   Claude Code has never written there
 *   transcripts, none whose cwd matches  something IS wrong
 *
 * The first is an agent that has not started a session. The second is a fault.
 * Collapsed into `null`, the caller could only ever say the second, so a
 * brand-new agent that has never spoken was greeted with "could not be read" —
 * Josh's Ava, minutes old and sitting at her prompt, 2026-08-21.
 */
function byWorkdirDetailed(agentName) {
  const nothing = { file: null, sawTranscripts: false };
  // Lazily, and from create.js rather than re-derived here: the workers
  // directory is that module's fact, and a second copy of it would drift the
  // first time somebody moves it.
  let dir;
  try { dir = require('./create').workerDir(agentName); } catch { return nothing; }
  if (!dir) return nothing;
  const flat = dir.replace(/[^A-Za-z0-9]/g, '-');
  let sawTranscripts = false;

  for (const root of configRoots()) {
    const projects = path.join(root, 'projects', flat);
    let names;
    try { names = fs.readdirSync(projects); } catch { continue; }
    const jsonl = names.filter((n) => n.endsWith('.jsonl'));
    if (!jsonl.length) continue;
    // Something has been written for this agent, whether or not it turns out to
    // be readable. That fact is what separates "has not started" from "broken".
    sawTranscripts = true;
    // Newest first: a running agent is writing to its current session, and an
    // agent that has been restarted has older ones beside it.
    const byNewest = jsonl
      .map((n) => {
        const full = path.join(projects, n);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch { /* skip below */ }
        return { full, mtime };
      })
      .filter((f) => f.mtime > 0)
      .sort((a, b) => b.mtime - a.mtime);
    for (const f of byNewest) {
      if (transcriptCwd(f.full) === dir) return { file: f.full, sawTranscripts };
    }
  }
  return { file: null, sawTranscripts };
}

/**
 * The working directory a transcript says it belongs to, or null.
 *
 * ⚠️ NOT ON THE FIRST LINE. Measured on a real transcript: line 1 carries only
 * `type`, `mode` and `sessionId`, and the first `cwd` appeared on line 5. So a
 * few lines are read rather than one, and a file that never says is refused
 * rather than assumed to match.
 */
/**
 * Has Kosmos launched this agent somewhere nothing has yet been written?
 *
 * ⚠️ TRUE ONLY WHEN BOTH HALVES HOLD — see the long note at the caller. The
 * plist is the half that makes the folder's emptiness mean anything: without
 * it, an empty folder says only that the agent did not run HERE.
 *
 * 📌 Any error reading either fact answers FALSE, so an unreadable machine
 * falls back to the admission rather than to a claim about the agent's life.
 */
function notYetStarted(agentName) {
  let managed = false;
  try { managed = fs.existsSync(require('./create').plistPath(agentName)); } catch { return false; }
  if (!managed) return false;
  try { return byWorkdirDetailed(agentName).sawTranscripts === false; } catch { return false; }
}

/**
 * No launch file at all: made (or hand-started) before Kosmos recorded how it
 * starts. The same plist gate `notYetStarted` trusts, inverted, and it FAILS
 * TOWARD FALSE: a wrong "never recorded" asserts provenance about an agent we
 * could not check, while a wrong false only leaves the ordinary admission,
 * which is vague but not a claim. Which is why this is create.jobMissing and
 * not !existsSync: only ENOENT counts as absence, an unreadable directory
 * answers "could not check" and stays false. Callers must apply it only to a pane tied
 * to the name (`isNamedOurs`); this function knows files, not panes.
 */
function neverRecorded(agentName) {
  // require at CALL time: create.js requires status.js at load, so a
  // top-level require here would be a cycle landing half-initialized.
  try { return require('./create').jobMissing(agentName) === true; } catch { return false; }
}

function transcriptCwd(file) {
  const text = headBytes(file, 65536);
  if (text === null) return null;
  const lines = text.split('\n');
  // Bounded: this runs per agent per snapshot, and the answer is at the top.
  for (const line of lines.slice(0, 40)) {
    if (!line || line.charAt(0) !== '{') continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row && typeof row.cwd === 'string' && row.cwd) return row.cwd;
  }
  return null;
}

/**
 * Read the tail of a file without loading all of it. Transcripts reach 8MB+.
 *
 * ⚠️ IT ALSO REPORTS WHETHER IT SAW THE WHOLE FILE, and that is not a detail.
 * A caller that concludes "there is no usage data here" from a 256KB WINDOW is
 * making a claim about a file it did not read: one oversized tool result at the
 * end of an 8MB transcript pushes every usage row out of view, and a heavily
 * used agent then reports as one that has never used any memory. Truncation is
 * knowable — `size > bytes` — so it is answered rather than assumed.
 */
function tailBytes(file, bytes = 262144) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(Math.min(bytes, size));
    fs.readSync(fd, buf, 0, buf.length, start);
    // ⚠️ RETURNED, not stashed in a module variable. The first version of this
    // set a shared flag that the caller read on the next line, which works and
    // is one interleaved call away from a verdict computed about a different
    // file. The fact belongs to the read.
    return { text: buf.toString('utf8'), whole: size <= bytes };
  } catch {
    return { text: null, whole: false };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * The FIRST bytes of a file, which is the opposite of its sibling above.
 *
 * ⚠️ `tailBytes` READS THE END, and the first version of `transcriptCwd` used
 * it and then took `slice(0, 40)` — which on any transcript over 64KB is forty
 * lines from the middle of the file, not the top, dressed as the top. The
 * verification would still usually have worked, because `cwd` repeats on most
 * rows, and "usually works for a reason you did not intend" is how a check
 * stops being one.
 */
function headBytes(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, read).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * ⚠️ TWO DIFFERENT ANSWERS WERE SHARING ONE WORD, and the card said the one
 * that is a CLAIM.
 *
 *     nothing has been recorded yet   an admission: we looked, there is
 *                                     nothing there to look at
 *     we could not read it            a claim: something exists and we failed
 *
 * A thirty-second-old agent is the first. The card said "Unknown" and the ring
 * said "Memory could not be read", so a brand-new agent read as a fault — which
 * is why Josh screenshotted a working agent and asked how to stop it.
 *
 * 🔑 Mona Lisa's rule, and the reason the split resolves the way it does:
 * WHEN A CASE CANNOT BE ASSIGNED WITHOUT A THRESHOLD, IT GOES TO UNKNOWN.
 * "Not yet" is a claim about where an agent is in its life; "unknown" is an
 * admission about what we can see, and a wrong claim is worse than a vague
 * admission. So ambiguity resolves toward the admission every time.
 *
 * ⚠️ AND `notYet` IS DECIDED ON WHAT THE CODE ALREADY DISTINGUISHES, never on
 * the agent's age. Age would have been a threshold wearing a dimension's
 * clothes: it looks principled, and the number is somebody's guess.
 */
function readContext(agentName, model, exactSession) {
  const file = transcriptFor(agentName, exactSession);
  if (!file) {
    // ⚠️ TWO STATES COLLAPSED INTO ONE `null` HERE. No registry entry means
    // Claude Code has never registered a session for this agent, so there has
    // never been anywhere to look. An entry whose file is GONE is the other
    // thing entirely: it was read once and is not there now, and calling that
    // "not yet" would be false in a specific way rather than merely vague.
    // 🛑 NO TRANSCRIPT IS ALWAYS THE ADMISSION, and three attempts at being
    // cleverer than that were all wrong in the same direction.
    //
    // "No entry" reads like a clean absence and is not one. The registry key is
    // <session>_<window>.<pane> and we only ever build `_0.0`, so an agent in
    // pane 0.1 has one we never look for; a config root with no agent-registry
    // directory has none to find; an entry can be rotated away; the file can be
    // unreadable. Some of those mean the agent never started and some mean it
    // has been running for hours, and NOTHING HERE SEPARATES THEM.
    //
    // ⚠️ I TRIED TO SEPARATE THEM WITH "IS THE PANE RUNNING CLAUDE", which is a
    // fact the caller holds, and it was wrong three ways: `node` is a real
    // Claude install (npm-global fronts as node) and reads as not-running; a
    // truncated tmux line has no command at all and reads as not-running, while
    // `classify` two hundred lines up refuses that same input as "we could not
    // tell what it is doing"; and a crashed agent's pane is a shell, which is a
    // first-class state in this file. Each one produced "it has not started a
    // session yet" on an agent that plainly had.
    //
    // 🔑 The rule was there the whole time: a case that cannot be separated
    // WITHOUT A THRESHOLD resolves to the admission. This one cannot be
    // separated at all, so it resolves there unconditionally, and the two extra
    // registry reads I added to try go with it.
    /**
     * 🔑 AND ONE OF THOSE CASES CAN NOW BE SEPARATED, WHICH THE PARAGRAPH ABOVE
     * COULD NOT DO WHEN IT WAS WRITTEN.
     *
     * Every reason it lists is a REGISTRY reason — a key we never build, a
     * missing agent-registry directory, a rotated entry, an unreadable file —
     * and it is right that none of them separates "never started" from "running
     * for hours". 0.2.21 stopped depending on that registry, and the signal it
     * replaced it with is a different fact: the agent's OWN folder, the one
     * Kosmos created and launched it in.
     *
     * ⚠️ TWO CONDITIONS, AND NEITHER IS SUFFICIENT ALONE:
     *
     *   we wrote its plist AND nothing has been written at its folder
     *       -> Kosmos launched it there, so there is nowhere else it could
     *          have written. It has not started a session.  -> notYet
     *   we wrote its plist AND transcripts exist but none match
     *       -> something IS wrong.                          -> the admission
     *   we did not write its plist
     *       -> we cannot say where it ran.                  -> the admission
     *
     * 🛑 THE PLIST GATE IS LOAD-BEARING AND THE FOLDER CHECK ALONE IS A LIE.
     * Rick, 2026-08-21, diagnosed his own case: no plist at all, never launched
     * by our supervisor, running for hours. His expected folder is empty, so the
     * folder check on its own would announce that a working agent had never
     * started — the wrong-claim direction this file refuses. The gate is a fact
     * about OUR bookkeeping rather than a threshold, which is why it survives
     * the rule that killed the age heuristic.
     *
     * 📌 Mona Lisa ruled this shape and corrected two attempts at the
     * discriminator on the way, including one that 0.2.21 had invalidated
     * ninety minutes earlier: `sessionIdsFor` returning nothing used to mean
     * "never registered" and now means "this is a normal machine".
     */
    if (notYetStarted(agentName)) {
      return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: true,
               /* ⚠️ NOT "it has not started a session yet", which is what this said
                  when it shipped in 0.2.23 and which Mona Lisa's jargon check
                  caught within minutes. "Session" is agent vocabulary; this
                  sentence is read by the person, on the Memory panel. The word
                  arrived from the LAYER the fact was computed in, which is how
                  most of these get in.
                  📌 And the fact is easier to say than the mechanism: nobody
                  needs to know a session exists to understand that nothing has
                  happened yet. Beside `lead: 'memory has nothing recorded yet.'`
                  the pair reads as one thought rather than two vocabularies. */
               because: 'it has not done anything yet' };
    }
    /* #149/#150: the no-plist case CAN be separated, by the same bookkeeping
       fact the notYet gate above trusts. "We cannot find a transcript" reads
       as a fault somebody should fix; for an agent Kosmos never recorded a
       launch file for, the truth is there was never anywhere to look, and no
       amount of restarting fills it in. Only reached for a TIED pane: the
       untied refusal returns before readContext is called. */
    if (neverRecorded(agentName)) {
      return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false, neverRecorded: true,
               because: 'made before Kosmos recorded this, so there is no record to read' };
    }
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false,
             because: NO_READING.NO_TRANSCRIPT };
  }
  const { text, whole } = tailBytes(file);
  // ⚠️ `text === null` AND `text === ''` ARE NOT THE SAME ANSWER, and `if
  // (!text)` treated them as one. tailBytes returns null when the read threw
  // and '' when the file is there and empty — which is exactly the state a
  // transcript is in the instant Claude Code opens it. So the newest agent on
  // the machine was reported as one we could not read.
  if (text === null) {
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false, because: NO_READING.UNREADABLE };
  }
  if (text === '') {
    // ⚠️ AN EMPTY FILE IS NOT EVIDENCE THE AGENT IS NEW. It is evidence about
    // the FILE: a write that failed, a file truncated to zero, a path we
    // resolved to the wrong place, or a session whose first line has not landed
    // yet. Only the last of those is "nothing recorded yet", and nothing here
    // separates them, so the admission.
    //
    // ⚠️ AN EARLIER VERSION OF THIS COMMENT SAID "Claude Code opens a FRESH file
    // when it compacts", and that is FALSE on this machine — compact summaries
    // are appended mid-file (measured: `isCompactSummary` rows at lines 3682 and
    // 7579 of a 9575-line transcript). The verdict was right and the reason was
    // invented, which is worse than a wrong verdict: it would have been believed
    // and reused.
    /* ⚠️ THE COMMENT THIS REPLACES SAID AN EMPTY FILE "tells us about the file
       rather than the agent", and that was right when nothing could tell the
       two apart. For an agent KOSMOS STARTED we now can: it was launched in a
       folder we made, so an empty transcript there is an agent that has not
       spoken, not a file we failed to read. Anything we did not start keeps the
       admission, because it could have run anywhere. Same gate as the
       no-transcript branch above, same reason. */
    return notYetStarted(agentName)
      ? { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: true,
          because: 'it has not done anything yet' }
      : { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false,
          because: 'its transcript is empty, which tells us about the file rather than the agent' };
  }

  /**
   * 🔑 A SYNTHETIC ROW'S USAGE IS NOT THE AGENT'S USAGE. Claude Code stamps
   * `"model":"<synthetic>"` on rows it writes itself — a usage-limit notice
   * among them — and those rows can carry a `usage` object of their own. Scanned
   * flat, one of them is the agent's memory reading.
   *
   * ⚠️ THIS IS WHAT JOSH ACTUALLY HIT, 2026-08-21. Ava, seconds after a restart:
   * *"Ava's memory could not be read. Usage data was empty."* She had taken no
   * turns; the only usage in her transcript belonged to a row Claude Code had
   * written. Excluding it leaves NO usage at all, and the branch below already
   * reasons that case correctly — read the whole file and find none, and the
   * agent has not used any memory.
   *
   * 📌 SO THE FIX IS AN EXCLUSION, NOT A NEW RULE. I first tried to make a
   * zero-sum usage mean "nothing yet" and that was wrong: a zero sum is either
   * a fresh agent or bad data, the only separator is age, and that threshold is
   * the thing this split refused. Its test says so by name. This changes what
   * COUNTS as a reading rather than what a reading means.
   *
   * ⚠️ Line by line, because a row is the unit that has a model: JSONL puts one
   * object per line, so a line carrying the placeholder is a row we skip whole.
   */
  const usages = text.split('\n')
    .filter((line) => line && !/"model":"<[^"]*>"/.test(line))
    .flatMap((line) => [...line.matchAll(/"usage":\{([^}]*)\}/g)]);
  if (!usages.length) {
    // 🛑 AND ONLY IF WE READ THE WHOLE FILE. `tailBytes` returns the last 256KB
    // of a transcript that can reach 8MB, so "no usage rows" from a truncated
    // window means "none in the part we looked at" — one oversized tool result
    // at the end is enough. Claiming "not yet" there would put "nothing has
    // been recorded, that is normal for a new agent" on the card of an agent
    // sitting at 95%, which is this whole change's bug with the sign flipped.
    // ⚠️ It is separable WITHOUT A THRESHOLD, which is why it is separated:
    // whether the read covered the file is a fact the read already has.
    return whole
      ? { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: true, because: 'it has not used any memory yet' }
      : { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false, because: 'we could not find a memory reading in the part of the transcript we read' };
  }

  const num = (blob, key) => {
    const m = blob.match(new RegExp(`"${key}":(\\d+)`));
    return m ? Number(m[1]) : 0;
  };
  const last = usages[usages.length - 1][1];
  const tokens = num(last, 'input_tokens') +
                 num(last, 'cache_creation_input_tokens') +
                 num(last, 'cache_read_input_tokens');

  if (!tokens) {
    // ⚠️ UNKNOWN, NOT "not yet", and this is the tie-breaker doing its work.
    // A usage record that sums to zero could be a session that has genuinely
    // done nothing, or data that is wrong. Separating those needs the agent's
    // age, which is the threshold we refused, so it goes to the admission.
    /* ⚠️ STAYS THE ADMISSION, and I tried to change it and was wrong. A usage
       record summing to zero is either an agent that has done nothing or data
       that is wrong, and the only separator anyone has proposed is the agent's
       AGE — the threshold this whole split refused. Its test says so by name.
       📌 What DID fix Josh's case is one branch up: a synthetic row's usage is
       not the agent's usage, so it is not counted at all, and the no-usage
       branch's existing `whole` reasoning takes over. */
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false, because: 'usage data was empty' };
  }

  const found = limitFor(model);
  const ceiling = found && found.limit;

  if (!ceiling) {
    // ⚠️ A SEVENTH CASE, and it is neither of the two the split is about: we
    // READ the memory and cannot express it as a percentage, because we do not
    // know what this model holds. `notYet` is false because something was read;
    // the card still shows the unknown badge, since pctOf is null. Whether
    // Unknown is the right WORD for a measured-but-unscaled agent is a
    // separate question and belongs with the unknown-model cards (#149/#150).
    return {
      tokens,
      percent: null,
      ceiling: null,
      ceilingSource: null,
      notYet: false,
      // ⚠️ AN EXPLICIT FLAG, not a null the UI has to infer. The surfaces need
      // to tell "we read it and cannot scale it" from "we could not read it",
      // and `ceiling === null` distinguishes those only if you also know that
      // every other shape leaves the field UNDEFINED rather than null. That is
      // a rule nothing states and a test fixture broke within an hour.
      noCeiling: true,
      confidence: CONFIDENCE.STRUCTURED,
      because: `measured, but we do not know how much ${model || 'this model'} can hold`,
    };
  }

  const percent = Math.round((tokens / ceiling) * 100);
  return {
    tokens,
    percent: Math.min(100, percent),
    overCeiling: percent > 100,
    notYet: false,
    ceiling,
    ceilingAssumed: found.assumed,
    confidence: CONFIDENCE.STRUCTURED,
    because: found.assumed
      ? 'measured, against a limit we have assumed rather than watched'
      : 'measured, against a limit we have watched it hit',
  };
}

/**
 * Model IDs as a person should read them.
 *
 * An explicit table, not a transform. A dash-to-space rule looks fine on
 * `claude-opus-5` and then ships a visible bug on `claude-haiku-4-5`, which
 * would render "Haiku 4 5" when the last two segments are a decimal. Version
 * numbers are not word separators.
 *
 * We deliberately do not ask the Models API for display names, even though it
 * has this exact field: that call needs an API key, and the rule the whole cost
 * model rests on is that this platform never talks to the API directly. Not
 * worth breaking for a label.
 *
 * An ID we do not recognise renders raw. New models ship often, and an
 * unfamiliar accurate name beats a confident wrong one -- the same rule the
 * status board follows.
 */
const MODEL_NAMES = {
  'claude-opus-5': 'Claude Opus 5',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-fable-5': 'Claude Fable 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
};

function modelDisplayName(id) {
  if (!id) return null;
  if (MODEL_NAMES[id]) return MODEL_NAMES[id];
  // Dated IDs (…-20251001) are the same model with a snapshot suffix.
  const undated = id.replace(/-\d{8}$/, '');
  if (MODEL_NAMES[undated]) return MODEL_NAMES[undated];
  return id;
}

function readModel(agentName, exactSession) {
  const file = transcriptFor(agentName, exactSession);
  if (!file) return { model: null, confidence: CONFIDENCE.NONE };
  const { text } = tailBytes(file, 65536);
  if (!text) return { model: null, confidence: CONFIDENCE.NONE };
  /**
   * 🛑 `<synthetic>` IS NOT A MODEL, AND IT IS THE LAST ONE IN THE FILE EXACTLY
   * WHEN SOMEBODY IS LOOKING.
   *
   * Claude Code writes `"model":"<synthetic>"` on rows it generates itself, and
   * taking the last match blindly rendered that straight onto the page. Josh,
   * 2026-08-21, seconds after switching an agent from Fable to Opus: **"Right
   * now: Claude <synthetic>"**. The restart had worked — her window said
   * `Opus 5 · Claude Max` — and the panel reported a model that does not exist,
   * at the one moment the person is checking whether the change took.
   *
   * ⚠️ MEASURED, NOT GUESSED, across the real transcript tree on this machine:
   *   claude-opus-5   19500     claude-fable-5   18413
   *   claude-opus-4-8   520     opus                45
   *   <synthetic>        45     (109 across all projects)
   * `<synthetic>` is the ONLY bracketed value that occurs. The bracket shape is
   * the rule rather than the literal string, because a sentinel written that way
   * is a placeholder by construction and a model id never is — but the literal
   * is what was observed, and if a second sentinel ever appears it should be
   * added here with its own count rather than assumed to match.
   *
   * 📌 SKIPS BACKWARDS RATHER THAN FILTERING FORWARDS: the most recent REAL
   * model is what the agent is running, and synthetic rows sit on top of it.
   */
  const matches = [...text.matchAll(/"model":"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((v) => !/^<.*>$/.test(v));
  if (!matches.length) return { model: null, confidence: CONFIDENCE.NONE };
  /**
   * 🔑 A RECOGNISED ID WINS OVER A MERELY RECENT ONE, which is Mona Lisa's
   * point on this defect and is worth more than the bracket rule above.
   *
   * Last-match is the fragile part: the tail also carries `"model":"opus"`
   * (45 occurrences on this machine against 19500 `claude-opus-5`), a bare
   * short form somebody passed to `--model`. Taking it verbatim renders
   * "Claude opus" — true, ugly, and avoidable when a full id for the same
   * session is sitting a few lines up.
   *
   * ⚠️ AND THE FALLBACK IS DELIBERATELY NOT "REFUSE THE UNRECOGNISED". Mona
   * proposed accepting only ids `MODEL_NAMES` knows; that would report "we
   * could not tell" the day a genuinely new model ships, which is exactly what
   * `modelDisplayName`'s `return id` was written to avoid. A future
   * `claude-opus-6` looks like a model and should be shown; `<synthetic>` does
   * not and is dropped above. The two questions are separated rather than
   * merged: BRACKETS decide "is this an id at all", the table decides "do we
   * have a nicer name for it".
   */
  const known = matches.filter((v) => MODEL_NAMES[v] || MODEL_NAMES[v.replace(/-\d{8}$/, '')]);
  const chosen = known.length ? known[known.length - 1] : matches[matches.length - 1];
  return { model: chosen, confidence: CONFIDENCE.STRUCTURED };
}

/**
 * Who the agent actually is, as opposed to what the machine calls it.
 *
 * `claudebot` is Splinter. `angel` is Angel Bridge. The tmux session name is an
 * infrastructure identifier and showing it to a person is a small lie of
 * omission -- it is the name of a process, not the name of a colleague.
 *
 * On this fleet the real name lives in the agent's own instruction file, which
 * is fitting: that file is the source of truth for who the agent is, and it is
 * the same file the agent-detail screen is built around. In the product proper
 * this is just a field somebody typed when they created the agent.
 *
 * Where it cannot be derived we show the raw session name and say so, rather
 * than inventing something friendlier.
 */
/**
 * Where worker directories live.
 *
 * ⚠️ Honours `AGENT_WORKFORCE_WORKERS` because `engine/instructions.js` does,
 * and these two must be the SAME root. They were not: this one was hardcoded,
 * so relocating the variable moved the instruction READ and WRITE while leaving
 * `readIdentity` pointed at the operator's live `~/work/workers`. A test suite
 * that believed it was sandboxed was still reading real agents' files, and the
 * sandbox comment in server.test.js said so in good faith while being wrong.
 *
 * ⚠️ The ROOT is now shared. The per-agent SEGMENT still is not: `readIdentity`
 * below joins the verbatim `sessionName`, while `instructions.fileFor` joins
 * `safeKey(sessionName)`. For any agent whose session name is not already its
 * own sanitised form, those two resolve to different directories, so the board
 * can show a derived name and role read from one file while staleness reports
 * on another.
 *
 * ⚠️ An earlier version of this said "it fails safe in both directions". That
 * is false, and the correction matters because the unsafe direction is a
 * CROSS-AGENT WRITE. Measured with two agents whose names collide under
 * `safeKey` (`mybot` and `my.bot`), each with its own worker directory:
 * `readIdentity('my.bot')` read `my.bot`'s file, while `fileFor('my.bot')`
 * resolved to `mybot`'s, `read` returned `mybot`'s text and `staleness`
 * returned a confident `current` computed from it. `knownAgent` compares
 * `sessionName === safeKey(name)`, so `PUT /api/agent/my.bot/instructions`
 * passes the gate and rewrites `mybot`'s boot file.
 *
 * There are no such collisions on this machine, checked rather than assumed,
 * and `server.js` states the same risk accurately at `knownAgent`. The real fix
 * is one identity per agent instead of a name sanitised in one place and taken
 * verbatim in another, which reaches the avatar and profile stores too.
 *
 * ⚠️ AND THE DISPLAY NAME IS NOW ON THAT LIST. `readIdentity` reads
 * `store.readProfile(sessionName)` for the name a person typed at creation, and
 * `readProfile` resolves through `safeKey` — while the file read three lines
 * below it joins the session name VERBATIM. So the same split runs through this
 * one function: for a colliding pair, the recorded display name comes from one
 * agent's profile and the instruction file from the other's, and the card would
 * show `mybot`'s name over `my.bot`'s role. It is the mildest consumer of the
 * collision (a wrong label, not a cross-agent write) and it is named here
 * because the list of things this defect reaches is the whole argument for
 * fixing it properly, and a list that quietly stops being complete stops making
 * that argument.
 */
/* 🛑 A FUNCTION (#1432). As a const this CALLED `homeDir()` at require
   time, so making homeDir() lazy moved the freeze up one level rather
   than removing it: measured, `create.workerDir()` still returned the
   real machine with the seam set after require. */
function workersDir() { return process.env.AGENT_WORKFORCE_WORKERS || path.join(homeDir(), 'work', 'workers'); }

/**
 * Explicit overrides for agents whose identity is not derivable.
 *
 * Convention holds for twelve of the thirteen here. The thirteenth predates the
 * convention and is inconsistent at every layer: tmux says `claudebot-discord`,
 * its launch script is `launch-discord-bot.sh`, its config dir is
 * `channels/discord`, its launchd job is `com.claudebot.discord`, and the person
 * using it calls it Splinter. Five identifiers, none of them "splinter".
 *
 * Deriving from any single layer produces a confident wrong answer -- the config
 * dir would name it "discord". So exceptions are listed, not inferred. In the
 * product proper this whole file collapses into a field somebody typed.
 */
const IDENTITY_OVERRIDES = {
  claudebot: { displayName: 'Splinter', role: 'Project Manager' },
};

function readIdentity(sessionName) {
  const override = IDENTITY_OVERRIDES[sessionName];
  if (override) return { ...override, derived: true };

  /**
   * ⚠️ THE RECORD BEFORE THE FILE, and the order is the point.
   *
   * An agent created as `Casey` runs as `casey` everywhere the machine looks —
   * session, launchd label, folder — and is called Casey everywhere a person
   * looks. `create` writes the display name here as well as into the first line
   * of the instruction file, and this prefers the record because the file
   * belongs to the PERSON: they can rewrite that line, and a display name that
   * vanishes when somebody edits their own instructions is not a name.
   *
   * ⚠️ It cannot make an agent anonymous. A profile with no `displayName` — every
   * agent that existed before this was written — falls straight through to the
   * file exactly as before, which is how `claudebot` still reads `Splinter`.
   * `role` deliberately still comes from the file below: the profile's own
   * `role` field is what a person types into the detail panel, and the board
   * already prefers that separately, one level up.
   */
  /* ⚠️ Known limit, recorded rather than fixed (round 40): readProfile
     swallows read errors and answers as if no record exists, so an
     UNREADABLE profile is indistinguishable from an absent one and the
     name silently falls back to the instruction file's identity line for
     as long as the blip lasts. Accepted because the fallback is the
     agent's own boot name (never an invented one), the record wins again
     on the next poll, and a per-card hedge sentence for a transient read
     failure would flap on and off every five seconds. If profiles ever
     carry state whose stale reading is dangerous rather than cosmetic,
     readProfile needs a third answer before that lands. */
  const remembered = store.readProfile(sessionName);
  const recorded = remembered && typeof remembered.displayName === 'string'
    ? remembered.displayName.trim() : '';

  /* ⚠️ THROUGH `create.workerDir`, NOT `workersDir()` + name. This module and
     `instructions.js` are the two readers of one file, and they diverged once
     before -- one refused a linked worker folder and the other followed it. A
     connected agent's folder is recorded rather than derived, so a second
     derivation here would find nothing for exactly the agents this change
     exists to support, while the instructions route found it.
     ⚠️ Required lazily: `create` requires `store`, and requiring it at the top
     of this file makes a cycle. */
  const file = path.join(require('./create').workerDir(sessionName), 'CLAUDE.md');

  // ⚠️ Through the SHARED reader, not a local `readFileSync`.
  //
  // This was the sixth instance of one defect on this branch: a second reader
  // of the workers directory with fewer guards than the first. It followed a
  // symlinked worker folder, then, once that was fixed, still followed a
  // symlinked CLAUDE.md and served a name parsed out of a file outside the
  // root, while the instructions route for the same agent correctly refused.
  // It also blocked FOREVER on a fifo, and because `knownAgent` calls
  // `snapshot()`, that wedged every route on the server with no crash to say
  // why. Both measured, not theorised.
  //
  // The guards are no longer duplicated here, because duplicating them is what
  // kept going wrong. `engine/workerfile.js` sits below both modules on purpose:
  // `instructions.js` already requires this one, so anything shared has to live
  // underneath or the require becomes a cycle.
  /* The agent's own folder as the root, matching `instructions.fileFor`: two
     readers of one file, one rule about where that file may be. */
  const got = readWorkerFile(file, path.dirname(file));
  // ⚠️ `derived: true` when we have a recorded name even though the file is
  // unreadable, because `derived` answers "did we find a real name for this
  // one, or is this the machine name?" — and a recorded name IS a real name.
  // Answering false would put the card's "machine name" flag on an agent whose
  // name the person themselves typed.
  if (!got.ok) {
    return recorded
      ? { displayName: recorded, role: null, derived: true }
      : { displayName: sessionName, role: null, derived: false };
  }
  const text = got.buf.toString('utf8').slice(0, 4000);

  const parsed = identityFromText(text);
  if (!parsed) {
    return recorded
      ? { displayName: recorded, role: null, derived: true }
      : { displayName: sessionName, role: null, derived: false };
  }

  const displayName = recorded || parsed.displayName;
  const role = parsed.role;

  // No `source` field (round 22): it had no consumer anywhere -- snapshot
  // builds the card from displayName/derived/role, the page never read it,
  // no test pinned it -- and its justifying comment claimed an every-branch
  // completeness two fallbacks did not have. Unread API surface is the same
  // thing round 19 removed from the thread payload; where a name came from
  // is answered by `derived` for the one question the page asks.
  return { displayName, role: role || null, derived: true };
}

/**
 * The name and role an instruction file states about itself.
 *
 * 🔑 EXTRACTED FROM `readIdentity` RATHER THAN COPIED, because a second reader of
 * this sentence is two derivations of one fact and they drift the first time
 * either is edited -- the habit this file pays for most. `readIdentity` answers
 * for an agent Kosmos knows by session name; discovery has to ask the same
 * question of a folder it has never seen, and both now ask it here.
 *
 * ⚠️ IT KNOWS NOTHING ABOUT PROFILES. The record's display name WINS over the
 * file for an agent that has one, and that precedence belongs to the caller:
 * this reads what the file says and stops.
 *
 * Returns null when the file does not introduce an agent at all, which is the
 * honest answer for a CLAUDE.md that is project notes rather than an identity.
 */
/**
 * 🛑 TWO ALTERNATIVES, AND THE BOLD ONE IS UNCHANGED ON PURPOSE (kosmos#1078).
 * Josh asked for the exact `You are **Name**` requirement dropped, because a
 * person hand-writing an instruction file has no way to know the asterisks are
 * load-bearing. Import exists FOR that person: every file Kosmos writes gets the
 * bold line from `engine/create.js`, so the parser has only ever read files its
 * own generator wrote, which is why nobody has hit this.
 *
 * ⚠️ THE OBVIOUS LOOSENING IS DANGEROUS AND WAS MEASURED, NOT ARGUED. Accepting
 * "what a person plausibly writes" -- anything up to the comma -- takes
 * "You are talking to a person running a business, not an engineer.", which is
 * in THIS REPO at engine/defaults.js:179, in the working-rules block Kosmos
 * writes into agent instructions. That parser would find a false agent inside
 * our own defaults, on every machine where they have been applied.
 * ⭐ A WRONG LIST IS USED; AN EMPTY ONE IS QUESTIONED.
 *
 * 🔑 SO THE PLAIN-PROSE ARM IS ANCHORED ON CAPITALISATION: one to three
 * Capitalised words. "Nevaeh" and "Mona Lisa" pass; "talking to a person",
 * "an expert in Rust", "the assistant", "working in a monorepo" and "not alone"
 * do not, because none of them starts with a capital.
 *
 * 🛑 AND THE BOLD ARM KEEPS TAKING ANYTHING, which is not laziness: existing
 * agents are named `rep-own` and `side-quests`, and a template writes
 * `You are **{{NAME}}**`. Requiring a capital in the bold arm would have
 * un-found agents that are found today. Only the UNBOLD case is new.
 *
 * ⚠️ MEASURED ON 92 REAL CLAUDE.md FILES: strict finds 13, this finds the same
 * 13, zero new and zero false. It adds nothing ON THIS MACHINE, and it cannot,
 * because every file here came from one generator. Its value is only visible on
 * a machine with a hand-written file, which is exactly the machine import is for.
 */
/**
 * 🛑 THE NON-BOLD ARM MUST NOT CROSS A SENTENCE BOUNDARY (#1168).
 *
 * The arm exists for a person hand-writing a `CLAUDE.md` in plain prose, and
 * the most natural plain prose was the shape it got wrong. Measured through
 * `identityFromText` on the shipped parser:
 *
 *   You are Bob.                  ->  name "Bob."          a full stop welded on
 *   You are Mary Anne Smith.      ->  name "Mary Anne Smith."
 *   You are Bob. He writes copy.  ->  name "Bob. He", role "writes copy"
 *   You are J.R.                  ->  name "J.R."          CORRECT, must stay
 *
 * The second row is the expensive one: it reads past the full stop and INVENTS
 * A ROLE out of the next sentence. A fabricated role on a card is worse than a
 * missing one, because nothing on the screen says where it came from.
 *
 * 🔑 `(?<!\.)` IS THE WHOLE REGEX CHANGE: a following capitalised word joins
 * the name only when the word before it did NOT end in a period. `Bob. He`
 * stops at `Bob.`; `Mary Anne Smith` still joins; `J.R.` has no space in it and
 * is untouched.
 *
 * ⚠️ THE `.` STAYS IN THE CHARACTER CLASS ON PURPOSE. Removing it, or stripping
 * every trailing stop, breaks `You are J.R.`, which is correct today. The trim
 * is done below where an initial can be told from a word.
 */
/**
 * 🛑 A PERIOD ENDS A SENTENCE OR ABBREVIATES A WORD, AND #1168 TREATED BOTH THE
 * SAME. Regression I shipped and then found by spot-checking my own merge:
 *
 *   You are Dr. Smith, a copywriter.   was "Dr. Smith"/copywriter, became "Dr"
 *   You are J. R. Tolkien, a writer.   was "J. R. Tolkien"/writer, became "J."
 *   You are Mr. Wolf.                                              became "Mr"
 *
 * The lookbehind stopped the name at ANY word ending in a stop, which is right
 * for `Bob. He writes copy.` and wrong for every title and every spaced
 * initial. A person hand-writing this file is exactly who writes `Dr.`, and the
 * non-bold arm exists for that person.
 *
 * 🔑 THE DISCRIMINATOR IS WHAT PRECEDES THE STOP, not the stop itself: a single
 * letter is an initial (`J.`), a known title is an abbreviation (`Dr.`), and
 * anything else ends a sentence. `Bob. He` still stops at Bob.
 *
 * ⚠️ AND THE TAIL TRIM NEEDS THE SAME TEST, or `Mr. Wolf.` loses its Wolf.
 */
/**
 * 🔑 ONLY THE TITLES THAT COME BEFORE A NAME. `Jr` and `Sr` are trailing
 * abbreviations, and letting the name CROSS one reintroduces the fabricated
 * role #1168 exists to kill: measured, with them in this list
 * `You are Bob Jr. He writes copy.` gave name "Bob Jr. He" and role
 * "writes copy". No real name continues `Jr. <Given>`, so they buy nothing
 * here and cost the sentence boundary.
 *
 * 📌 THAT MEASUREMENT WAS AGAINST AN EARLIER FORM OF THIS FIX, whose lookbehind
 * had no prefix anchor. With the anchor below, adding `Jr` back is inert FOR A
 * NAME THAT CROSSES ONE, because the anchor already refuses it: `Bob` is not a
 * title or an initial. ⚠️ It is NOT inert at FIRST position, where the anchor
 * does not apply: `You are Jr. Smith, a clerk.` would go from `"Jr"`/null to
 * `"Jr. Smith"`/`"clerk"`. The exclusion stays, and this note says which half
 * of the claim reproduces so nobody re-adds them on a false promise.
 *
 * 🔑 AND A TITLE MAY ONLY BE CROSSED AS THE FIRST WORD, which is what makes
 * `St` safe to keep. It is a prefix in `St. John Rivers` and a SURNAME in
 * `Anna St. He writes copy.`, and only the position tells them apart: measured,
 * without the anchor the second gives name "Anna St. He" rather than "Anna St".
 *
 * ⚠️ THIS PARAGRAPH USED TO CLAIM THE ROLE TOO - "and role 'writes copy', the
 * same fabricated role one word later" - AND THAT IS FALSE. Re-measured:
 *
 *     without the anchor, no comma   name "Anna St. He"   role NULL
 *     without the anchor, comma      name "Anna St. He"   role "writes copy"
 *
 * ⇒ On the NO-COMMA spelling the COMMA RULE kills the role, not the anchor. The
 * anchor's role-protection shows only on the comma spelling, which is exactly
 * what the block below this one says at length.
 *
 * 🛑 THE TWO PARAGRAPHS CONTRADICTED EACH OTHER, TWENTY LINES APART, IN THIS
 * FILE, ON MAIN. I corrected the conclusion below and left the argument for it
 * standing up here. A stale DESCRIPTION misinforms; a stale JUSTIFICATION
 * RECRUITS - it argues the reader toward a refuted position in the author's own
 * confident voice, and the reader who stops at the first one never reaches the
 * retraction. Found by grepping for a premise I had disproved, not by re-reading:
 * re-reading gives you back your intention, and both paragraphs were mine.
 */
const NAME_JOIN_TITLES = 'Dr|Mr|Mrs|Ms|Prof|Rev|Hon|St';
/**
 * 🔑 A STOP MAY BE CROSSED ONLY WHILE THE NAME IS STILL ITS OWN PREFIX. Every
 * token from `You are ` up to that stop must be a title or an initial, which is
 * what separates the two shapes that both end a word in a stop:
 *
 *   You are J. R. Tolkien, a writer.   J. and R. are initials  ->  crosses
 *   You are Dr. J. R. Tolkien          a title then initials    ->  crosses
 *   You are Mary J. She writes copy.   `Mary` is neither        ->  STOPS at J.
 *   You are Bob Jr. He writes copy.    `Bob` is neither         ->  STOPS at Jr
 *   You are Anna St. He writes copy.   `St` is a SURNAME here   ->  STOPS at St
 *
 * ⚠️ The last three are the fabricated-role defect #1168 exists to kill, and a
 * bare-initial version of it (`Mary J. She`) survived the first two attempts at
 * this fix. Position is the only thing in the text that separates a prefix
 * abbreviation from a trailing one.
 *
 * 📌 WHAT THIS ANCHOR ACTUALLY BUYS, measured rather than assumed, because an
 * earlier version of this comment over-credited it. Removing the anchor from
 * HEAD leaves `You are Anna St. He writes copy.` with role NULL: the COMMA RULE
 * kills that one, not the anchor. The anchor's surviving role-protection is on
 * the comma spelling, `You are Anna St. He, writes copy.`, which without it
 * reads "Anna St. He" / "writes copy". The NAME is the anchor's work in both.
 * ⇒ Two rules protect overlapping ground here, and whoever changes either one
 * should know which half they are holding.
 *
 * ⚠️ AND IT CANNOT SEPARATE A TITLE FROM A PRONOUN AFTER IT: `You are Dr. He
 * writes copy.` reads `Dr. He` as the name, which is worse than main's `Dr`.
 * The comma rule refuses a role for that spelling.
 * 🛑 IT DOES NOT REFUSE ONE FOR THE COMMA SPELLING, and an earlier version of
 * this comment claimed it did: `You are Dr. He, writes copy.` yields
 * "Dr. He" / "writes copy" where main gave "Dr" / null.
 * ⭐ AND THAT IS PROBABLY RIGHT RATHER THAN WRONG, which is why it stays: `He`
 * is a real surname, so `You are Dr. He, a cardiologist.` is the realistic
 * reading of that shape and the new output is correct there. The objection was
 * to the absolute claim, not the behaviour. Both spellings are pinned now.
 */
const NAME_PREFIX_RUN = "(?<=You are (?:(?:" + NAME_JOIN_TITLES + "|[A-Z])\\. )*(?:" + NAME_JOIN_TITLES + "|[A-Z])\\.)";
/**
 * {0,4}. ⚠️ THIS WAS {0,2} FOR THREE REVIEW ITERATIONS AND THE ARGUMENT FOR
 * KEEPING IT WAS WRONG, in a way worth recording because it was a SCOPE call
 * rather than a measurement.
 *
 * I held it at the pre-#1168 value on the grounds that name length is a
 * separate decision. But a title consumes one of the slots, so at {0,2} a
 * perfectly ordinary name truncates:
 *
 *   You are Dr. J. R. R. Tolkien, a writer.   {0,2} "Dr. J. R." / null
 *                                             {0,4} whole, with its role
 *
 * ⚠️ AND IT DOES NOT FIX EVERYTHING, WHICH I CHECKED RATHER THAN ASSUMED. The
 * review offered `You are Dr. John Q. Smith, a writer.` as a second row the
 * bound would fix. It does not: the PREFIX RUN refuses the crossing after `Q.`
 * because `John` is neither a title nor an initial, so it stays "Dr. John Q.".
 * That shape is text-identical to `Mary J. She writes copy.`, which must stop,
 * so it is undecidable here rather than unfixed. The role is null either way,
 * and `main` gave "Dr", so both readings are wrong names and neither invents a
 * job. Pinned in the test as a known limit.
 *
 * 🛑 AND `"Dr. John Q."` IS THE SHAPE THIS CARD IS ABOUT. `main` produced `"Dr"`,
 * which is self-evidently broken; a truncation that still looks like a name is
 * the invisible version of the same defect, and nothing on the screen says
 * where it came from. Keeping the old bound traded a visible defect for a
 * quiet one.
 *
 * 🔑 THE NEGATIVES HOLD, measured independently by two reviewers at {0,3},
 * {0,4}, {0,5} and {0,10}: every prose row in this suite, including the
 * working-rules text read out of `defaults.js`, still returns null.
 *
 * ⚠️ THE COST, and it is not a new class: the Title-Case prose canary captures
 * one word further per step (`You are The Owner Of This Machine.`). That string
 * was already captured as a name at {0,2}; widening makes an existing false
 * positive longer rather than creating one. It is pinned in the test at this
 * bound so the next change to it is deliberate.
 */
const IDENTITY_RE = new RegExp(
  "You are (?:\\*\\*([^*]+)\\*\\*|([A-Z][\\w.'-]*"
  + "(?:(?:(?<!\\.)|" + NAME_PREFIX_RUN + ") [A-Z][\\w.'-]*){0,4}"
  + "))(?:\\s*\\(([^)]+)\\))?\\s*(,)?\\s*([^.\\n]*)",
);

/**
 * A trailing full stop that ENDED THE SENTENCE, as opposed to one that belongs
 * to an initial (#1168).
 *
 * `Bob.` ends a sentence. `J.R.` does not: its last stop follows a single
 * letter which itself opens the name or follows another stop. That is the only
 * distinction available in the text, and it is the one the card asked for.
 */
const NAME_ENDS_SENTENCE = /[\w'-]{2,}\.$/;

function identityFromText(text) {
  const m = String(text || '').match(IDENTITY_RE);
  if (!m) return null;
  let name = m[1] !== undefined ? m[1] : m[2];
  /* #1168. Only the prose arm can carry a sentence-ending stop: the bold arm is
     delimited by its own asterisks, and `**side-quests**.` already comes back
     clean. */
  const endedSentence = m[1] === undefined && NAME_ENDS_SENTENCE.test(name);
  /**
   * 🛑 IN THE PROSE ARM, A ROLE MUST FOLLOW A COMMA. Nothing else may become one.
   *
   * Three separate defects on this branch were all one rule missing:
   *
   *   You are Dr. J. R. R. Tolkien, a writer.  role "Tolkien"      a surname, as a job
   *   You are Dr. He writes copy.              role "writes copy"  main gave none
   *   You are Ms. Understood by all.           role "by all"       main gave none
   *
   * ⚠️ TWO NARROWER RULES WERE TRIED FIRST AND BOTH LEAKED. "the tail starts with
   * a capital" also deleted every real capitalised role
   * (`You are Nevaeh, Chief Engineer.`), and gating on the repetition bound
   * actually being hit misses the cases above, where the name is one token and
   * did not run out of room at all.
   *
   * 🔑 The comma is what a person puts between a name and a role, and it is the
   * only mark in the text that says "what follows describes the one before it".
   *
   * ⚠️ THE COST, PINNED IN THE TEST RATHER THAN LEFT TO BE FOUND: a role written
   * WITHOUT a comma is dropped, and `main` kept it. That is deliberate under this
   * card's own standard, which is that **a fabricated role is worse than a
   * missing one**, and it was measured on 84 real instruction files on this
   * machine: identity detection is unchanged, 17 found before and after, while
   * four files lose a fabricated role built out of a sentence.
   *
   * 📌 The bold arm is untouched, and the honest reason is narrower than "it is
   * unambiguous": the asterisks settle where the NAME ends, not whether what
   * follows is a role. `You are **Anna**\n\nYour job is to help everyone.` still
   * yields a role of "Your job is to help everyone", exactly as it did on main.
   * Left alone because it is not a regression and every generated template writes
   * `You are **{{NAME}}**, <a role>.` with the comma.
   */
  const roleUnmarked = m[1] === undefined && m[4] === undefined;
  if (endedSentence) name = name.slice(0, -1);
  let role = (endedSentence || roleUnmarked ? '' : m[5] || '')
    .replace(/\*\*/g, '')          // instruction files are markdown; strip emphasis
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/^Josh Stone's\s+/i, '')
    .split(/\s+in the\s+|,/)[0]
    .trim();
  if (role.length > 60) role = role.slice(0, 60).trim();
  /* 🔑 AND THE ROLE IS DROPPED WHEN THE NAME ENDED THE SENTENCE, which is the
     other half of #1168 and the half that was inventing things. If the name
     closed a sentence, whatever follows is a DIFFERENT sentence, and a role
     lives in the same sentence as the name it describes. `You are Bob. He
     writes copy.` yields Bob with no role rather than Bob with a role read off
     a sentence about somebody else.
     ⚠️ The cost, stated rather than discovered later: `You are Bob. A
     copywriter.` also yields no role, and a person may have meant one. Guessing
     across a full stop is exactly what produced the defect, so this declines to
     guess in both directions. */
  return { displayName: String(name).trim(), role: role || null };
}

function safeAvatar(name) {
  try { return store.avatarPath(name); } catch { return null; }
}

/**
 * Just who is on the board and whether each is tied to its name — no captures.
 *
 * ⚠️ Exists because the gate checks were calling `snapshot()`, which is a
 * synchronous fan-out: one `list-panes` plus one `capture-pane` PER AGENT plus
 * transcript reads, measured at 43-60ms of blocked event loop for thirteen
 * agents. On the avatar route that landed on a polling path — the board
 * refetches every card's picture every five seconds — costing roughly 0.65s of
 * blocked loop and ~170 extra `capture-pane` calls against live agents per tick.
 *
 * A gate needs the NAME and whether it is tied. Both come from the pane list
 * alone, which is ONE tmux call and no captures. Memoising `snapshot()` was the
 * other option and it was wrong: it makes a gate answer from a stale roster,
 * which is exactly the wrong direction for a check that decides whose data to
 * hand out.
 */
function paneRoster() {
  // ⚠️ THROWS when tmux could not be asked, rather than answering "nothing".
  //
  // `sh()` swallows every failure and returns `null`, and `parsePanes(null)`
  // returns `[]` — so tmux dead, tmux missing, or the five-second timeout
  // expiring all arrived at a caller as an empty roster, indistinguishable from
  // a machine with no agents. `borrowedName`'s catch is written to fail CLOSED
  // and its comment says so, but the only input that reached it was an injected
  // throw from a test: **the realistic failure failed open and served the
  // record.** A guard whose closed path production cannot take is not a guard.
  //
  // ⚠️ AND `snapshot()` REFUSES THE SAME WAY NOW, through `listPanes`. This
  // note used to say the opposite at length — that snapshot stayed lenient, so
  // `/api/status` answered 200 with zero agents and a fresh `checkedAt` and the
  // board painted "0 agents, checked just now" — and that it was being left
  // that way deliberately because changing it was a product decision. The
  // product decision was made one round later, in `listPanes`, and this
  // paragraph was not re-read: `/api/status` now 500s with the reason and the
  // board says it cannot read the agents. The sentence outlived the behaviour
  // it described, which is this module's own recurring defect pointed at its
  // own documentation. Both refusals are asserted together in
  // `fixture-discipline.test.js`, so the pair cannot drift silently again.
  //
  // The two functions still are not one, because this one is deliberately
  // stricter about a PARTIAL answer: see the note below.
  const out = paneSource ? paneSource() : tmuxPanes();
  if (out === null || out === undefined) {
    throw new Error('we could not see what is running on this computer');
  }
  /**
   * ⚠️ AND THE SAME POSTURE FOR AN ANSWER WE CANNOT READ.
   *
   * "We could not ask" and "we asked and understood none of it" are the same
   * thing to a gate: in both, the roster is not evidence that a name is free or
   * that a pane is a stranger's. This function is what decides whether a write
   * reaches an agent, so an unreadable answer has to fail CLOSED here rather
   * than become an empty roster — which every caller reads as "nobody is
   * claiming this name".
   *
   * `listPanes` refuses on the same condition for the board. Two readers, one
   * rule, and the reason they are not one function is that this one is
   * deliberately stricter than `snapshot` about being asked at all.
   *
   * ⚠️ A PARTIAL answer does NOT refuse here, and that is a decision rather
   * than an omission. Refusing on any unreadable line would take every
   * name-keyed read and write away from the whole fleet because one pane's line
   * was mangled — a machine-wide outage caused by a cosmetic fault in one line.
   * The gates this feeds are already conservative about a name they cannot
   * find: `knownAgent` answers false, which fails closed.
   *
   * ⚠️ What it costs, said plainly: `borrowedName` also answers false, so a
   * record stays readable on the strength of a roster this module has just
   * admitted was incomplete. That is the weaker half of the trade, and it is
   * bounded — the alternative is refusing every route on the machine for one
   * bad line, which is a worse failure with a wider blast radius.
   */
  const { panes, rejected } = readPanes(out);
  if (rejected > 0 && panes.length === 0) {
    /* The same sample as `listPanes`, because this refusal reaches a person too
       (every name-keyed route fails closed through here) and a caller cannot
       tell which of the two threw. */
    /* jargon-ok:tmux — a detail line; see the rule above `tmuxPanes`. */
    LAST_LOOK_PROBLEM = `tmux answered and we could not read it. It came back like this: ${oneLine(String(out).split('\n')[0], 160)}`;
    throw new Error('we could not make sense of what came back');
  }
  return onePanePerSession(panes).map((pane) => ({
    sessionName: pane.name,
    // The real tmux session beside the board name, for the same reason
    // `snapshot` publishes it: anything that resolves a per-session artifact
    // needs the name tmux knows, not the one we display.
    session: pane.session,
    isNamedOurs: isNamedOurs(pane),
  }));
}

/* Five minutes. A genuinely working agent heartbeats through its tool calls,
   so a `working` older than this is a claim nobody is standing behind. */
const REPORT_WORKING_DECAY_MS = 5 * 60 * 1000;

/**
 * One state from two witnesses: the agent's own report and the pane reader.
 * A fresh report is authoritative; the reader stays as corroboration and
 * audit (#188, and the architecture note on #253: reports as truth, readers
 * as evidence -- both, never a choice between them).
 *
 * The precedence, in order, and each line is a rule rather than a tiebreak:
 *
 *   1. No report -> the scraped verdict, untouched. An agent that never
 *      adopted the verb renders exactly as today.
 *   2. STRUCTURE OUTRANKS ANY CLAIM ABOUT LIVENESS, both directions. A pane
 *      whose process is gone (`stopped` at STRUCTURED confidence) is stopped
 *      whatever the record's last line says -- an agent cannot report its own
 *      death, so a crash's last word is `working` forever and must not win.
 *      And a live process that reported `stopped` is running, whatever it
 *      said: the scraped state stands, with the contradiction SURFACED.
 *   3. THE RED IS NEVER SUPPRESSED BY A REPORT. A scraped `needs_you` beside
 *      a report that says otherwise renders `needs_you`, with the conflict
 *      surfaced. This is deliberate asymmetry for the interface's one known
 *      hole (a question asked through the runtime's question tool fires no
 *      hook, so the reporter can honestly not know) -- and false calm is the
 *      failure that ships, four times now on this fleet.
 *      🛑 AND RULE 3 IS NOT A TIEBREAK FOR A RARE CASE. THE PANE READER IS
 *      WHERE `needs_you` COMES FROM, AND SAYING SO IS #1253's OPTION 3.
 *      Measured over the whole record at 2026-08-28 18:58 CDT -- one snapshot
 *      with its clock time, because the record is append-only and any total
 *      quoted without one is three different numbers by morning -- 22 of
 *      26,392 self-reports are `needs_you`. The split has THREE derivations of
 *      unequal strength, said explicitly because the next person cannot tell
 *      which is which by looking. ⚠️ #1453 was that the record did not say WHO
 *      wrote a line; #1457 fixed it, and `selfreport.record` now persists
 *      `by: 'auto'|'agent'`. THE FIX IS NOT RETROACTIVE and this is a claim
 *      about the HISTORICAL record. At the snapshot below no line on disk
 *      carried `by`; the field is being written now, and the narrower claim
 *      that matters here is still true -- NO `needs_you` row carries it, so
 *      the split still rests on the weaker marker. The tool
 *      prefers `by` where it exists and prints how many of each, so that
 *      number can be watched falling:
 *          14  walkthrough FIXTURES   by AGENT NAME (`walk-birch`,
 *                                     `walk-cedar`). An UNLINKED convention:
 *                                     nothing reserves that prefix, so a real
 *                                     agent could take it.
 *           7  the permission hook    by a STRING MATCH on the hook's own
 *                                     sentence, re-checked against
 *                                     `install/kosmos-report-hook.sh` at run
 *                                     time rather than trusted.
 *           1  typed by a working agent, ever      <- the remainder, so every
 *                                     classification error above lands here.
 *      ⚠️ AN OVER-BROAD MARKER ERRS IN THE DIRECTION THAT FLATTERS THIS
 *      PARAGRAPH, which is the one direction a caveat must not be wrong in:
 *      it moves a record OUT of agent-typed. Scoped, because the opposite
 *      error exists and an unqualified "both markers always" would be false:
 *      a REWORDED hook moves records INTO agent-typed, which is what
 *      `hookPrefixIsLive` refuses to be silent about, and an absent or
 *      truncated `because` lands there too.
 *      🛑 AND THE WORST CASE DOES NOT SURVIVE, WHICH AN EARLIER VERSION OF
 *      THIS PARAGRAPH CLAIMED IT DID. Granting every hook record to its agent
 *      keeps the tool's SHARE cutoff comfortably and BREAKS its DISTINCT-AGENT
 *      cutoff, because those records are spread across MANY agents rather than
 *      one; build that fixture (strip the hook prefix from the `needs_you`
 *      rows of a copy of the record) and the tool prints the OPPOSITE verdict.
 *      No count here: it was written as "six" and was seven within two hours. The earlier sentence
 *      bounded against one of two cutoffs -- the one that let it pass -- which
 *      is the flattering direction committed by the sentence written to guard
 *      against it. ⇒ What stands here is an ARGUMENT, not a bound: those
 *      records carry the hook's GENERATED SHAPE, a tool name plus a verbatim
 *      command, which a person does not type by hand. (No count: the sentence
 *      four lines above pledges not to carry one, and an earlier version of
 *      THIS line carried one anyway, four lines below the pledge.)
 *      ⇒ Most rules here arbitrate between two witnesses. This one arbitrates
 *      between a witness and, in practice, a silence. ("Most", not "every":
 *      rule 1 has a single witness by construction.) So anything
 *      that narrows the classifier narrows the only path that produces the
 *      board's red state at all.
 *      🛑 AND AN EARLIER VERSION OF THIS PARAGRAPH BLAMED #1155 FOR THAT, WHICH
 *      IS FALSE AND WAS CAUGHT BY MEASURING BOTH ARMS. It said #1155's
 *      tightening is why a prose question is invisible. Against the PRE-#1155
 *      marker set (`git show ca46bacf^:engine/status.js`), "May I merge the
 *      PR?" already classified `unknown`, with positive controls returning
 *      true. It classifies `unknown` today too. ⇒ The markers are a CLOSED
 *      VOCABULARY that never covered arbitrary prose, before or after, so the
 *      prose case was never #1155's doing. #1155's measured effect on that
 *      case is nil; its measured effect overall was removing FIVE false reds
 *      (four pieces of ordinary prose plus an agent quoting a prompt: 2 of 7
 *      before, 7 of 7 after, per the #1155 docblock in `status.test.js`). An
 *      earlier version here said four, counting only the prose rows -- and the
 *      #1155 docblock IN THIS FILE, at ~1852, still said four until this
 *      change, so a reader grepping `status.js` found it contradicting itself.
 *      Corrected there too, on the precedent this branch set at ~1196: fix the
 *      sibling rather than cite it while knowing it is wrong.
 *      🛑 BUT DO NOT READ THAT AS "#1155 NARROWED NOTHING LEGITIMATE" -- AN
 *      EARLIER VERSION OF THIS PARAGRAPH SAID EXACTLY THAT AND THIS FILE
 *      CONTRADICTS IT AT LINE ~1191, IN ITS OWN MEASURED WORDS. #1155 also
 *      introduced a real regression nobody tested for: on a WRAPPED pane an
 *      option-less prompt can classify `idle` where before #1155 it read
 *      `needs_you`, because the new rule needs the marker to OPEN the line and
 *      the line to CLOSE at the question, and a wrap breaks both. That IS a
 *      legitimate red lost to #1155; latent rather than live, and adding `-J`
 *      to the capture neutralised it.
 *      ⚠️ THE BAND IS NARROWER THAN "ANY PANE NARROWER THAN THE QUESTION",
 *      WHICH IS WHAT AN EARLIER VERSION OF THIS PARAGRAPH SAID AND WHAT THE
 *      COMMENT AT ~1187 STILL SAID UNTIL THIS CHANGE. Measured here across
 *      every width from 6 to 79, both marker sets loaded side by side, with a
 *      control at 80 columns where the two agree:
 *          "Do you want to proceed?"      diverges at ONE width, 22
 *          "Would you like to continue?"  diverges at widths 17-26
 *      Below the divergence the MARKER ITSELF is split, so neither version
 *      matches and nothing was lost. ⇒ The class is real and the quantifier
 *      was not, and the error ran in the direction that flattered this
 *      paragraph's own tidy "wrong in both directions once" symmetry.
 *      ⇒ So: the prose case is structural to the marker approach and predates
 *      #1155; the wrap case was #1155's and is fixed. Two corrections in
 *      opposite directions, and I shipped each of them wrong once.
 *      📌 DO NOT TRUST THE NUMBERS IN THIS PARAGRAPH. RE-RUN THEM:
 *          node tools/needs-you-source.js
 *      It prints this split -- not these exact numbers, because the record is
 *      append-only and the hook keeps adding to it, so the hook row in
 *      particular moves; the `1` above is its line labelled "typed by a
 *      working agent" -- plus its own cutoffs and the date of
 *      the newest record typed by a WORKING agent (the tool prints a second,
 *      later date that includes the fixtures; this is not that one). That date
 *      is 2026-08-24, and #1255
 *      shipped the instruction telling agents to report the state on
 *      2026-08-27 CDT -- so the only time a working agent ever used the verb
 *      was BEFORE anybody told it to, and nothing has been typed since.
 *      🛑 DO NOT READ THAT AS "THE INSTRUCTION DID NOT PERSUADE ANYBODY". IT
 *      IS NOT ON ANY AGENT HERE, AND THE REASON IS SIMPLER AND LARGER THAN THE
 *      ONE TWO EARLIER VERSIONS OF THIS PARAGRAPH GAVE. Measured 2026-08-28
 *      18:58 CDT, over the 17 fleet worker instruction files existing then:
 *          0 of 17 carry `kosmos report needs_you`
 *          0 of 17 carry the Kosmos doctrine BLOCK at all (`kosmos:doctrine:`)
 *         17 of 17 match a common word    <- control, so the grep sees them
 *      ✅ AND AT 20:49 THE SAME EVENING A NEWLY CREATED AGENT CARRIED THE VERB.
 *      (That agent, `pete1456pre`, was REMOVED at 20:55:49, per
 *      `removed.json`, which is the only machine record of it; a colleague
 *      reported 20:57 from memory and I repeated it. Its instruction file
 *      survives, because a Kosmos removal is reversible by design and deletes
 *      nothing -- `bootout` plus `disable`, per `engine/remove.js`. So the
 *      READING stands and the loop below will keep counting that file: a
 *      worker directory is not proof of a live agent.)
 *      That is the other half of the story and it arrived after the snapshot:
 *      #1296's fix DOES reach an agent created after it, so the zero above is
 *      about PRE-EXISTING agents holding an unaccepted offer, not about a fix
 *      that does not work. ⚠️ It also means a reader re-deriving later gets a
 *      different numerator, which is why the snapshot is timestamped. Re-derive
 *      rather than trusting either figure:
 *          for f in ~/work/workers/<any>/CLAUDE.md ; do
 *            grep -l 'kosmos report needs_you' "$f" ; done
 *      with the same loop on plain `kosmos` as the control. (Written with
 *      `<any>` rather than a glob on purpose: a `*` followed by a slash would
 *      close this comment block, which is how the first version of this line
 *      broke the file and was caught by `node --check` one command later.)
 *      ⚠️ THAT MARKER ZERO MEASURES THE CONSENTED-REFRESH SPAN, NOT RECEIPT,
 *      and an earlier version of this paragraph read it as "these agents have
 *      never received the DOCTRINE block". Two of the seventeen DID receive
 *      one: they carry nine of `defaults.sections()`'s headings verbatim, as
 *      PLAIN TEXT, because the creation path (`defaults.appendTo`) writes the
 *      same text with no marker at all. Measured, with two other agents at
 *      0 of 12 as the control.
 *      ⇒ Which makes the evidence STRONGER rather than weaker: those two
 *      received a doctrine block and STILL do not carry the verbs, because
 *      they were created before the verbs existed and the later edits landed
 *      inside a heading they already held. A zero on the marker could not have
 *      told you that; the heading counts can. ⚠️ Not "no sync has ever written to them",
 *      which an earlier version said and which is false: 17 of 17 carry
 *      `kosmos:connections:` and 3 of 17 carry `kosmos:projects:`. Other
 *      managed blocks reach these files; the doctrine span is the one that
 *      does not, and it is the one carrying these verbs.
 *      ⚠️ THE HEADING-PLACEMENT STORY IS REAL AND EXPLAINS ONLY TWO FILES.
 *      `defaults.js`'s version log records its versions 4 and 5 (the cards, #1253
 *      and #1272; the PRs are #1255 and #1292 -- the log names #1255 later on,
 *      in its own version-6 entry, and never names #1292) as
 *      both editing
 *      verb lines inside `### Telling people what is happening`, which
 *      `missingFrom` will not re-offer to a file that already has that
 *      heading -- and exactly 2 of the 17 have it, as plain text, both
 *      carrying `kosmos msg` and neither carrying `kosmos report`. That is
 *      the mechanism visible in the data, for those two. For the other
 *      fifteen `missingFrom` would have offered the old heading, verbs and
 *      all, so their zero is NOT evidence about heading placement: it is the
 *      same zero whether #1255, #1292 or #1296 exists. An earlier version of
 *      this paragraph cited it as though it were, which is the
 *      indistinguishable-outcomes defect this file argues against elsewhere.
 *      📌 And #1292 did BOTH: it added `### You do not stop` (a new heading
 *      `missingFrom` does offer) as well as editing inside the old one. #1296
 *      then moved the two verbs into that new section. Saying only the second
 *      half, as two earlier versions did, reads as though nothing from #1292
 *      could reach anybody.
 *      ⇒ The flat count is evidence of NON-DELIVERY, and this rule's
 *      conclusion is unaffected either way: the scrape is load-bearing today
 *      whatever the reason the other path is empty.
 *      📌 THREE OTHER SHIPPED COPIES OF THIS SPLIT EXIST, all quoting the
 *      older `22 of 21,500`: `defaults.js`'s version log, and
 *      `defaults.test.js` twice. Same numerator, older denominator, no
 *      snapshot time. The record is append-only, so all were true when
 *      written; this paragraph carries a clock time and is the one to prefer.
 *      ⚠️ An earlier version of this note named ONE of the three, which is the
 *      one-fix-two-sites failure occurring inside the sentence about it. The
 *      tool also says plainly if working agents have started reporting it, in
 *      which case this paragraph is stale and rule 3 wants re-arguing rather
 *      than repeating.
 *   3b. NOR IS A DEAD TOKEN (#886). A scraped `auth_failed` stands over any
 *      report: no hook fires once the request itself is refused, so the
 *      reporter cannot know, and an idle report never decays (rule 6), which
 *      would render a 401 loop as "at rest" forever.
 *   3c. A SCRAPED RATE LIMIT IS A WARNING, NOT A VERDICT (#966). It used to
 *      share 3b, on 3b's reasoning -- but that reasoning is about a REFUSED
 *      REQUEST, and a usage limit refuses the model, not the credential. The
 *      hook still fires, so the reporter still knows. Josh watched an agent
 *      answer two messages and report `done` while a promotional banner had
 *      its card reading "Paused". A FRESH report therefore wins and the screen
 *      is surfaced as the conflict; stale or absent, 3b's treatment stands,
 *      because then the screen is the only witness there is.
 *   4. A fresh reported `working` is working, in the agent's own words.
 *   5. A STALE `working` DECAYS TO UNKNOWN, NEVER TO IDLE. A report that
 *      stopped arriving says the REPORTER stopped, not that the agent
 *      finished; an agent mid-task rendered "resting quietly" is the
 *      false-negative this board has paid for repeatedly, because nobody
 *      investigates calm. Before decaying, the pane gets its say: a screen
 *      still visibly mid-task means the agent is alive and the REPORTER is
 *      broken -- a different fault with a different fix, so that renders as
 *      the scraped working with the contradiction surfaced rather than
 *      collapsing to unknown before the comparison can happen.
 *   6. `idle`, `needs_you` and `blocked` do NOT decay: an idle agent has no
 *      execution to heartbeat with, and a question keeps standing until it
 *      is answered. Their liveness guard is rule 2, not a clock.
 *
 * `conflict` on the answer is a sentence when the two witnesses materially
 * disagree, null otherwise. Surfaced, never silently resolved: a silent
 * override is how two sources of truth become one confident lie.
 */
/**
 * What the agent SAID, as a clause to hang off a conflict sentence (#1259).
 *
 * 🛑 WINNING THE PRECEDENCE WAS DELETING THE LOSER'S EVIDENCE. Measured:
 *
 *   reported needs_you "May I merge the PR?"  vs scraped rate_limited
 *      -> needs_you, because = "May I merge the PR?"      the question survives
 *   the same report                           vs scraped auth_failed
 *      -> auth_failed, and the string "May I merge the PR?" appears NOWHERE
 *
 * The precedence itself is right and is not touched here: a dead token is
 * exactly the thing a reporter cannot know (#966 rule 3b). But it is also the
 * one case where the LOSING witness knew something the winner cannot, because a
 * screen cannot show what an agent is waiting to be told. So the person fixes
 * the sign-in, is never told a question was asked, and the record no longer
 * holds it to tell them later. Agents do not ask twice.
 *
 * 🔑 ONLY FROM A FRESH REPORT, the same decay rule 3 and rule 5 already use. A
 * two-day-old question carried onto today's screen is a different lie, and the
 * stale rate-limit branch below is stale BY CONSTRUCTION, so this returns null
 * there without needing to know that.
 *
 * ⚠️ CAPPED. `because` and `on` are agent-authored text on its way to a
 * person's card, the same posture as every evidence line in this module.
 */
function saidWords(reported, nowMs) {
  if (!reported || reported.found !== true) return '';
  const at = Date.parse(reported.at || '');
  if (!Number.isFinite(at) || (nowMs - at) > REPORT_WORKING_DECAY_MS) return '';
  const trim = (v, n) => {
    const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return t.length > n ? t.slice(0, n) + '…' : t;
  };
  if (reported.state === 'needs_you') {
    const q = trim(reported.because, 120);
    return q ? `, and it had asked: ${q}` : '';
  }
  if (reported.state === 'blocked') {
    const on = trim(reported.on, 80);
    if (!on) return '';
    const owner = trim(reported.owner, 60);
    return owner ? `, and it reported being blocked on ${on}, owned by ${owner}` : `, and it reported being blocked on ${on}`;
  }
  return '';
}

function reconcileReport(reported, scraped, nowMs) {
  if (!reported || reported.found !== true) {
    /* 🔑 "IT HAS NEVER SAID ANYTHING" IS A DIFFERENT FACT FROM "WE COULD NOT TELL",
       and only one of them is actionable (#1315). `selfreport.read` already
       separates NEVER_REPORTED from UNREADABLE and NOTHING HAS EVER CONSUMED THE
       DISTINCTION - it was defined, returned, and read by no caller outside its
       own module.

       🛑 THE CASE IT WAS WRITTEN FOR, measured 2026-08-28: a codex agent stops at
       a first-run prompt before it can do anything. `classify` reads that pane as
       `unknown` - the same word it uses for an agent that is merely quiet -
       because the codex markers are question-shaped and the prompt is not a
       question. So the board said the same thing about a blocked agent and a busy
       one, and nobody could tell them apart.

       ⭐ AN AGENT THAT HAS NEVER REPORTED HAS AN EMPTY REPORT HISTORY, AND THAT IS
       MACHINE-CHECKABLE WITHOUT READING ITS SCREEN. It is the one fact about a
       stuck first launch that does not depend on guessing what a pane says.

       ⚠️ ONLY WHEN THE SCRAPE ALREADY SAYS UNKNOWN. If the screen told us
       something, that answer stands - a never-reported agent whose pane clearly
       shows it working is working, and overriding that would trade a true reading
       for a bookkeeping fact.
       ⚠️ AND IT CHANGES NO STATE. `unknown` stays `unknown` and the confidence is
       untouched; only the sentence gets truer. A state change here would put a
       new light on the board for every agent that has not spoken yet, which is
       most of them on any machine that predates self-reporting. */
    /* 🛑 selfreport's NO_READING, NOT THIS MODULE'S. Both files export a constant of
       that name and they hold DIFFERENT keys: status.js has NO_TRANSCRIPT and
       UNREADABLE only. Written against the local one, this compared
       `reported.because` to `undefined` and would have fired on every report
       whose `because` was absent - the wrong agents, silently. Caught before it
       ran; same shape as two delimited blocks with near-identical names. */
    const neverSpoke = !!(reported && reported.because === selfreport.NO_READING.NEVER_REPORTED);
    if (neverSpoke && scraped && scraped.state === STATE.UNKNOWN) {
      return {
        ...scraped,
        because: 'it has never reported anything, so we cannot tell what it is doing',
        reported: false,
        conflict: null,
      };
    }
    return { ...scraped, reported: false, conflict: null };
  }

  const said = (fallback) => reported.because || fallback;

  // Rule 2: the process is gone. Agreement is a clean goodbye; anything
  // else is a crash, which is rule 2's whole reason to exist -- not a
  // contradiction to flag but the honest reading of a dead process.
  if (scraped.state === STATE.STOPPED && scraped.confidence === CONFIDENCE.STRUCTURED) {
    if (reported.state === 'stopped') {
      return { state: STATE.STOPPED, confidence: CONFIDENCE.STRUCTURED, because: 'it said it was stopping', reported: true, conflict: null };
    }
    return { ...scraped, reported: false, conflict: null };
  }
  // Rule 2, the other direction: it said goodbye and is visibly still here.
  if (reported.state === 'stopped') {
    return { ...scraped, reported: false, conflict: 'it reported stopping, but it is still running' };
  }
  // Rule 3b (#886): a DEAD TOKEN or a RATE LIMIT read off the screen stands
  // over ANY report. Once the token is rejected no hook fires, so the
  // reporter's last word (an idle that never decays, rule 6, or a fresh
  // working) is precisely the thing it cannot know is stale; rendering
  // "at rest and nothing is needed" over a 401 retry loop is the same false
  // calm rule 3 exists for, one state over. Observed live on 0.5.31 (#880).
  if (scraped.state === STATE.AUTH_FAILED) {
    return { ...scraped, reported: false, conflict: 'its screen shows its Claude sign-in is being rejected, which its reports cannot know about' + saidWords(reported, nowMs) };
  }
  /* Rule 3b, rate-limit half (#966). The rule above states its own
     justification -- "no hook fires once the request itself is refused" -- and
     that is TRUE OF A DEAD TOKEN AND NOT OF A USAGE LIMIT. A limit does not
     revoke the credential, and the reporting path is a shell hook posting to
     localhost rather than a model call, so a rate-limited agent CAN still
     report. Josh watched one do it: a promotional banner matched the markers,
     the card read "Paused", and the agent answered two messages and reported
     `done` while it said so.
     => So for this half there IS evidence that can contradict the screen, and
     standing over it unconditionally discarded the better witness. A FRESH
     report now wins and the screen becomes a WARNING; a stale or missing report
     changes nothing, because then the screen is the only thing that knows.
     The reconcile is re-entered with the rate-limit signal removed rather than
     the report rules being copied, so this branch cannot drift from them. */
  if (scraped.state === STATE.RATE_LIMITED) {
    const atRl = Date.parse(reported.at || '');
    const freshRl = Number.isFinite(atRl) && (nowMs - atRl) <= REPORT_WORKING_DECAY_MS;
    if (freshRl) {
      const answer = reconcileReport(reported, { ...scraped, state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE }, nowMs);
      return { ...answer, conflict: 'its screen shows a usage limit, but it is still reporting, so it may be working through it' };
    }
    return { ...scraped, reported: false, conflict: 'its screen shows it has hit a usage limit, which its reports cannot know about' + saidWords(reported, nowMs) };
  }
  // Rule 3: the red stands.
  if (scraped.state === STATE.NEEDS_YOU && reported.state !== 'needs_you') {
    /* #763: a question read off the screen beside a report that named a
       project (or inherited one) is about that project as far as anyone can
       tell: the same inference the hook's project-less needs_you gets, and
       marked as one. Null project when the reports named none. */
    // Only from a report young enough to still describe what the agent is doing
    // (the same decay rule 5 applies to a working report): a two-day-old naming
    // must not attribute today's question. Fewer false lights.
    const at3 = Date.parse(reported.at || '');
    const fresh3 = Number.isFinite(at3) && (nowMs - at3) <= REPORT_WORKING_DECAY_MS;
    const p = (fresh3 && typeof reported.project === 'string' && reported.project) ? reported.project : null;
    return { ...scraped, reported: false, conflict: 'its screen shows a question its reports do not mention', project: p, projectInferred: p !== null };
  }

  if (reported.state === 'working') {
    const at = Date.parse(reported.at || '');
    const stale = !Number.isFinite(at) || (nowMs - at) > REPORT_WORKING_DECAY_MS;
    if (!stale) {
      return { state: STATE.WORKING, confidence: CONFIDENCE.STRUCTURED, because: said('it says it is working'), reported: true, conflict: null };
    }
    // Rule 5: the comparison happens BEFORE the decay.
    if (scraped.state === STATE.WORKING) {
      return { ...scraped, reported: false, conflict: 'its reports stopped arriving while its screen still shows work, so the reporter may be broken' };
    }
    return {
      state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE,
      because: 'it said it was working and has not said anything since; we could not check',
      reported: true, conflict: null,
    };
  }
  if (reported.state === 'needs_you') {
    /* #763: the question's project rides on the state, so a project tile can
       light for its own question only. Null when the agent named none. */
    return { state: STATE.NEEDS_YOU, confidence: CONFIDENCE.STRUCTURED, because: said('it is asking you something'), reported: true, conflict: null, project: (typeof reported.project === 'string' && reported.project) ? reported.project : null, projectInferred: reported.projectInferred === true };
  }
  if (reported.state === 'blocked') {
    const what = reported.on ? 'it is waiting on ' + reported.on + (reported.owner ? ', which ' + reported.owner + ' owns' : '')
      : 'it is waiting on something that is not you';
    return { state: STATE.BLOCKED, confidence: CONFIDENCE.STRUCTURED, because: said(what), reported: true, conflict: null };
  }
  // `idle`, and `started` with nothing after it: at rest either way.
  return { state: STATE.IDLE, confidence: CONFIDENCE.STRUCTURED, because: said('it is at rest and nothing is needed'), reported: true, conflict: null };
}

/**
 * A card for an agent that has NO PANE AT ALL.
 *
 * 🛑 WHAT THIS IS AND IS NOT. A tmux pane does two jobs at once: it says WHICH
 * agent this is, and it says the agent is STILL RUNNING. Every agent on a
 * machine without tmux has neither. The launch token replaces the first and
 * the liveness beat replaces the second, and this function is what turns that
 * pair into a row the board can hold. It invents no third source of truth: the
 * caller decides who qualifies, this only shapes the answer.
 *
 * 🔑 `target: null`, AND IT IS THE LOAD-BEARING FIELD ON THIS CARD. There is
 * no pane, so there is nowhere to type, and every consumer that types or reads
 * a screen already refuses a card with no target (`chat.deliver`,
 * `chat.screen`, `messages`). Measured: those guards are `if (!card.target)`,
 * so a paneless card takes the refusal path they already had rather than
 * needing a new branch anywhere.
 *
 * ⚠️ NULL, NEVER THE EMPTY STRING, and that is not fussiness. Two routes match
 * a reporting process to its card with `roster.find((c) => c.target ===
 * body.from_pane)` behind a `typeof body.from_pane === 'string'` gate, so a
 * card carrying `''` would be matched by a request sending `from_pane: ""`.
 * `null` cannot be reached that way.
 *
 * ⚠️ WHAT WE DO NOT KNOW IS NULL, NOT A DEFAULT. No transcript for a process
 * on another machine, so no context and no model; no launch record here, so
 * `neverRecorded` is false rather than a true that would render "made before
 * Kosmos kept records" about an agent this Mac never made. `runner` is null
 * because the token store does not record one -- the screen's fallback will
 * read that as Anthropic, which is a display default we inherit and not a
 * claim this card makes.
 *
 * 📌 THE NAME IS THE SAFEKEY'D ONE. `mint` files a token under
 * `store.safeKey(sessionName)`, so that is the only spelling this store knows.
 * For every name that survives safeKey unchanged the two are the same string.
 */
function panelessCard(key, nowMs) {
  const identity = readIdentity(key);
  /* The agent's own account, reconciled against a scrape that could not
     happen. Passing UNKNOWN/NONE rather than skipping `reconcileReport` is
     deliberate: the report rules -- a stale `working` decaying, `blocked` and
     `needs_you` never decaying -- are the same rules for an agent with no
     screen, and copying them here is how two readings of one report start to
     disagree. */
  const status = reconcileReport(
    selfreport.read(key),
    { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'it has no window on this computer to read, and it has not said anything yet' },
    nowMs);
  return {
    name: identity.displayName,
    sessionName: key,
    session: null,
    nameDerived: identity.derived,
    role: identity.role,
    target: null,
    isAgentPane: false,
    isAgentSession: false,
    isFleetSession: false,
    /* The tie is the TOKEN, which is stronger evidence than a session name:
       we minted it, and `retire`/`revoke` take it back. A stranger cannot
       arrive on this list by naming a tmux session after one of ours. */
    isNamedOurs: true,
    /* ⭐ The one field that tells a consumer this card has no pane behind it.
       Only paneless cards carry it, so a pane card is untouched and every
       existing reader sees exactly what it saw before. Test `=== true`. */
    paneless: true,
    runner: null,
    task: null,
    state: status.state,
    stateConfidence: status.confidence,
    stateProject: (typeof status.project === 'string' && status.project) ? status.project : null,
    stateProjectInferred: status.projectInferred === true,
    stateEvidence: status.evidence || null,
    because: status.because,
    stateReported: status.reported === true,
    stateConflict: status.conflict || null,
    context: {
      tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false,
      because: 'it is not running on this computer, so there is no transcript here to measure',
    },
    model: null,
    modelName: null,
    neverRecorded: false,
    hasAvatar: Boolean(safeAvatar(key)),
    profile: store.readProfile(key),
  };
}

/**
 * Which token-known agents have no pane and are beating right now.
 *
 * 🛑 BOTH CONDITIONS, AND NEITHER ALONE IS ENOUGH. A held token says an agent
 * MAY speak; a fresh beat says something holding it IS RUNNING. A token on its
 * own would put a card on the board for an agent that exited hours ago, which
 * is precisely the failure the pane never had -- a dead pane disappears.
 *
 * 🔑 `alive()` RETURNS null FOR "NO RECORD", AND null IS NOT true. Every Mac
 * agent has no liveness record, so no Mac agent can arrive here even if this
 * ran with an empty pane list. That is what makes the whole change additive.
 *
 * ⚠️ A REVOKED AGENT DISAPPEARS, because `sendertoken.keys()` lists held
 * tokens only. The credential is the off switch on this path exactly as it is
 * on the reporting path, rather than this list needing its own idea of gone.
 */
function panelessKeys(paneKeys) {
  const out = [];
  for (const key of sendertoken.keys()) {
    if (paneKeys.has(key)) continue;
    if (liveness.alive(key) !== true) continue;
    out.push(key);
  }
  return out;
}

function snapshot() {
  const { panes: read, rejected: unreadableLines, rejectedLines: unreadableSamples } = listPanes();
  const panes = onePanePerSession(read);
  const agents = panes.map((pane) => {
    const text = capturePane(pane.target);
    const scrapedStatus = classify(pane, text);
    /* The agent's own account outranks the scrape when fresh (#188); only a
       pane TIED to the name may read that name's record, the same gate every
       name-keyed read below honours. */
    const status = reconcileReport(
      isNamedOurs(pane) ? selfreport.read(pane.name) : { found: false },
      scrapedStatus, Date.now());
    // ⚠️ Identity, model and context are all filed under the NAME, and only a
    // pane whose SESSION NAME says it is ours has been tied to that name.
    //
    // Measured with the real `claudebot-discord` absent and a stranger's
    // `tmux new -s claudebot` running Claude: the card came back named
    // "Splinter", role "Project Manager", model `claude-opus-4-8`, context ring
    // 24% at STRUCTURED confidence — all the REAL agent's, read out of its
    // registry file — while the state and the target were the stranger's. An
    // operator would be looking at a card that is Splinter in every respect
    // except the one that decides what a destructive action reaches.
    //
    // Publishing `isNamedOurs` and leaving another branch to honour it is not
    // enough: this module is what asserts the identity, so this module has to
    // stop asserting it. An inferred pane keeps its raw session name, is marked
    // underived, and carries no model and no context — which is the honest
    // answer, because we do not know whose conversation it is.
    const tied = isNamedOurs(pane);
    const { model } = tied ? readModel(pane.name, pane.session) : { model: null };
    const context = tied
      ? readContext(pane.name, model, pane.session)
      // ⚠️ Unknown, and not because it is ambiguous: this one is a REFUSAL. We
      // can see there is something to read and are declining to read it, so
      // 'not yet' would be false about us as well as about the agent.
      : { tokens: null, percent: null, confidence: CONFIDENCE.NONE, notYet: false, because: 'we cannot tell which agent this is, so we will not read another agent\u2019s transcript for it' };
    const identity = tied
      ? readIdentity(pane.name)
      : { displayName: pane.name, role: null, derived: false };
    return {
      name: identity.displayName,
      sessionName: pane.name,
      // ⚠️ The REAL tmux session, beside the board name it is filed under. They
      // differ for every legacy agent (`angel-discord` vs `angel`), and any
      // reader that resolves a per-session artifact -- a transcript, a registry
      // entry -- needs the one tmux knows, not the one we display. Publishing
      // it is what lets a consumer stop guessing between the two spellings.
      session: pane.session,
      nameDerived: identity.derived,
      role: identity.role,
      target: pane.target,
      // ⚠️ Whether this pane is one an action may be typed into. `list-panes -a`
      // returns every pane on the machine, so the roster alone is not evidence
      // that a pane holds an agent, and `/clear` typed into a shell is executed
      // rather than read as a command.
      isAgentPane: isAgentPane(pane),
      // Restart needs this one, not the copy-mode-sensitive one above.
      isAgentSession: isAgentSession(pane),
      // ⚠️ NOT "the suffix alone", and NOT what restart asks — this comment said
      // both and neither is true. It is suffix OR a live Claude process, and
      // restart's effective gate is `isNamedOurs` below, because restart reaches
      // the launchd service rather than the pane. This is kept because the UI
      // distinguishes "one of ours" from "an agent we inferred".
      isFleetSession: isFleetSession(pane),
      // ⚠️ Whether the SESSION NAME ties this pane to the fleet's record for
      // this name — as opposed to us having merely inferred an agent from a
      // Claude process. The distinction exists because a card's name addresses
      // THREE different objects: the tmux pane, the launchd service
      // (`com.<name>.discord`, what restart acts on), and the commitment record.
      // Only the suffixed session name is evidence that all three are the same
      // agent. Without it we may still show the pane and type into it — it is
      // the pane the operator clicked — but we must not act on the service or
      // claim to have destroyed the record, because those belong to whoever
      // owns the NAME and this pane has not proven it is them.
      isNamedOurs: isNamedOurs(pane),
      /* ⭐ This card HAS a pane, and saying so is not redundant (#1112 phase 1).
         The board now also holds cards for agents with no pane at all, and the
         fixture's own rule is that a field only some cards carry is read as
         `undefined` in production while nothing fails. So both kinds answer
         this, and a consumer branches on a fact rather than on absence. */
      paneless: false,
      /* Which runner this pane RECORDED at launch (#245/#246): 'codex' or
         'claude', with empty meaning claude the way it does everywhere the
         option is absent. The switch screen keys on this, and it is the
         supervisor's record, never an inference from the command. */
      runner: pane.runner === 'codex' ? 'codex' : 'claude',
      task: taskLine(pane.title),
      state: status.state,
      stateConfidence: status.confidence,
      /* #763: which project a reported needs_you is about; null for a scraped
         question and for a report that named no project. */
      stateProject: (typeof status.project === 'string' && status.project) ? status.project : null,
      /* true when no report attributed THIS question to that project: the
         project came from an earlier report (the hook's question, or a
         question read off the screen). A lit tile that rests on an inference. */
      stateProjectInferred: status.projectInferred === true,
      /* The line the classifier actually matched, when it has one. Null for
         every state that did not read a sentence off the screen. */
      stateEvidence: status.evidence || null,
      because: status.because,
      /* Whether the state above is the agent's own account (#188's third
         verb) rather than a pane reading. */
      stateReported: status.reported === true,
      /* A sentence when the agent's report and the pane reader materially
         disagree, null otherwise. Surfaced rather than silently resolved:
         the two witnesses disagreeing is a fact the operator gets to see. */
      stateConflict: status.conflict || null,
      context,
      model,
      modelName: modelDisplayName(model),
      /* #149/#150: no launch file for a pane TIED to the name. The screen's
         wording branches on this rather than re-deriving it, so the card, the
         detail panel and the memory panel cannot disagree about which state
         the agent is in. Never computed for an untied pane: answering "was
         this made before Kosmos kept records" about a stranger's session is
         answering for a stranger. */
      neverRecorded: tied ? neverRecorded(pane.name) : false,
      // Things a person set, which the machine cannot derive. Role in
      // particular: nothing on this machine records what an agent *is*.
      // ⚠️ These two are keyed on the NAME as well, and gating identity, model
      // and context while leaving them open made the first fix incomplete on
      // its own terms. `hasAvatar` renders the real agent's PHOTOGRAPH on the
      // stranger's card, and the detail panel reads `profile.role || role` — so
      // the `role: null` above is only the fallback, and the operator-set role
      // came straight back through the profile store.
      //
      // Every read in this function keyed on `pane.name` needs the same gate.
      // Fixing four of six is not a partial fix, it is the same defect with a
      // smaller surface.
      hasAvatar: tied ? Boolean(safeAvatar(pane.name)) : false,
      profile: tied ? store.readProfile(pane.name) : null,
    };
  });

  /* ⭐ THE ROSTER CAN NOW HOLD AN AGENT WITH NO PANE (#1112 phase 1).
     Merged HERE, in the one function that derives the fleet, rather than in
     the server: `safeRoster()` is `snapshot()` plus a removal filter, and the
     counts on the summary line are computed from this same array. A second
     place that adds paneless rows would be two derivations of "the fleet",
     which this file's own comments call its worst habit.

     ⚠️ THE PANE WINS ON A TIE. An agent that has a pane AND a beat is one
     agent, and its pane card is the richer one -- it carries a target, a
     model and a context. Deduping on the safeKey'd name is what makes the
     beat harmless for a Mac agent that later gets one. */
  const paneKeys = new Set();
  for (const a of agents) {
    try { paneKeys.add(store.safeKey(a.sessionName)); } catch { /* a name we cannot key cannot collide */ }
  }
  const nowMs = Date.now();
  for (const key of panelessKeys(paneKeys)) {
    /* 🛑 ONE BAD KEY MUST NOT COST THE WHOLE BOARD, and this is structure
       rather than an argument. Every read inside `panelessCard` is throw-safe
       by inspection today -- `readProfile`, `safeAvatar`, `selfreport.read`
       and `liveness.read` all catch and answer -- but "additive" is the entire
       claim of this change, and an argument that holds today is not the same
       as a shape that cannot fail. Losing a paneless row costs a row that did
       not exist last week; letting it throw costs every Mac agent their card. */
    try { agents.push(panelessCard(key, nowMs)); } catch { /* that one agent is not listable */ }
  }

  agents.sort((a, b) => a.name.localeCompare(b.name));

  return {
    // Freshness is not decoration. An ambient display gets trusted passively,
    // and silence from it reads as "all fine". If this poller dies, the UI can
    // show the stamp going stale instead of freezing on a happy picture.
    checkedAt: new Date().toISOString(),
    counts: countAgents(agents, unreadableLines, unreadableSamples),
    agents,
  };
}

/**
 * The numbers on the summary line, for a given set of cards.
 *
 * ⚠️ EXPORTED, and it is exported for one reason: the server FILTERS this
 * board — removed agents come off it — and counts computed over the unfiltered
 * set put "12 agents" above 11 cards. The fix is one definition used twice, not
 * a second copy in the server that starts identical and drifts the first time a
 * count is added here.
 *
 * `unreadableLines` is passed in rather than derived: it is a fact about what
 * tmux returned, not about the cards, and it survives filtering unchanged.
 */
function countAgents(agents, unreadableLines, unreadableSamples) {
  return {
    total: agents.length,
    needsYou: agents.filter((a) => a.state === STATE.NEEDS_YOU).length,
    unknown: agents.filter((a) => a.state === STATE.UNKNOWN).length,
    /* ⚠️ "we tried to read a transcript and could not", which is why a
       paneless agent is not counted here. Its context is absent by
       construction -- the process is on another machine and there is no
       transcript on this one -- and folding that into a number that means
       "something went wrong reading" would make the number quietly false the
       first time a Windows agent appears. */
    unreadableTokens: agents.filter((a) => a.paneless !== true && a.context.tokens === null).length,
    /* ⚠️ EXCLUDED FOR THE SAME REASON AS `unreadableTokens` DIRECTLY ABOVE,
       and they have to move together: they are two readings of one absent
       context, so excluding a paneless row from one and not the other would
       have the same board answering "we could not read it" and "there was
       nothing to read" about the same card. */
    unknownFullness: agents.filter((a) => a.paneless !== true && a.context.percent === null).length,
    // ⚠️ Lines tmux gave us that were not panes. Zero is the normal answer;
    // anything else means part of the fleet is missing from this board and the
    // board has to say so rather than presenting what is left as all of it.
    unreadableLines,
    // #734: the lines behind that count, so a screen can show which pane.
    unreadableSamples: Array.isArray(unreadableSamples) ? unreadableSamples : [],
  };
}

// `transcriptFor` is exported for the instructions module, which needs a
// session start time. It resolves by session id rather than by guessing a
// directory from the agent's name, for the reason its own comment gives: a
// guess finds *a* transcript every time, so it looks like it worked while
// reporting from the wrong session. One derivation, shared, rather than a
// second copy that can drift.
/**
 * When tmux says this session started, in milliseconds, or null.
 *
 * 🛑 THIS IS A READING, NOT AN INFERENCE, and that is the whole point of it.
 * The staleness verdict used to date an agent's start from the birth time of
 * its transcript, which does not exist until the agent has been spoken to --
 * so a restarted agent kept reporting the PREVIOUS session's start and stayed
 * "running on older instructions" no matter how many times it was restarted.
 * tmux has always known when the session began.
 *
 * ⚠️ NULL IS "WE COULD NOT LOOK", and callers must treat it as not-knowing
 * rather than as not-started. A board that cannot reach tmux at all is a state
 * this codebase already renders honestly everywhere else.
 */
/**
 * ⚠️ A SEPARATE TMUX QUESTION, NOT A NEW PANE COLUMN, and the reason is worth
 * stating. `PANE_COLUMNS` is positional: every field is found by its index in a
 * tab-separated line, so inserting one shifts every field after it, and the
 * suite hand-writes sixty-odd of those lines. Sessions are a different list
 * from panes anyway -- `#{session_created}` is a property of the session, and
 * asking `list-sessions` for it is one small read rather than a change to the
 * shape every other reading in this file depends on.
 */
const SESSION_FORMAT = '#{session_name}\t#{session_created}';

let sessionSource = null;

/** The test seam, same contract as `setPaneSource`: replaces WHERE the text
 *  comes from, never what is done with it. */
function setSessionSource(fn) { sessionSource = typeof fn === 'function' ? fn : null; }

function tmuxSessions() {
  /* jargon-ok:tmux — a detail path; see the rule above `tmuxPanes`. */
  const got = shDetail(tmuxBin(), ['list-sessions', '-F', SESSION_FORMAT]);
  if (got.ran && got.status === 0) return got.out;
  // No server is no sessions, which is a real and ordinary answer.
  if (tmuxSaidNoServer(got)) return '';
  return null;
}

/**
 * ⚠️ CACHED FOR A MOMENT, because staleness is computed once per agent and the
 * board polls every five seconds: without this, a fourteen-agent fleet would
 * ask the same question fourteen times a tick. Two seconds is shorter than the
 * poll, so no reading is ever carried across one.
 */
let SESSION_CACHE = { at: 0, text: null };
const SESSION_CACHE_MS = 2000;

function sessionText(now) {
  /* 🛑 THE SEAM IS NEVER CACHED. A test that swaps the source and asks again
     within the window would be answered from the previous swap -- so the cache
     would be supplying the fixture, and a test could pass while measuring the
     wrong world. The cache exists for the poll, and the poll never uses the
     seam. */
  if (sessionSource) return sessionSource();
  if (SESSION_CACHE.text !== null && now - SESSION_CACHE.at < SESSION_CACHE_MS) return SESSION_CACHE.text;
  const text = tmuxSessions();
  SESSION_CACHE = { at: now, text: text === undefined ? null : text };
  return SESSION_CACHE.text;
}

function sessionStartedAtFromTmux(sessionName, now = Date.now()) {
  const want = String(sessionName == null ? '' : sessionName);
  if (!want) return null;
  let text;
  try { text = sessionText(now); } catch { return null; }
  if (text === null || text === undefined) return null;
  for (const line of String(text).split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    if (line.slice(0, tab) !== want) continue;
    const secs = Number(line.slice(tab + 1).trim());
    /* ⚠️ A NUMBER OR NULL, never 0. tmux answers seconds since the epoch, and a
       zero would be 1970 -- which every edit is newer than, so an unreadable
       field would make every agent look like it had never restarted. That is
       the exact direction of error this whole change exists to remove. */
    return Number.isFinite(secs) && secs > 0 ? secs * 1000 : null;
  }
  return null;
}

module.exports = {
  NO_READING,
  sessionStartedAtFromTmux, transcriptForSession, setSessionSource,
  identityFromText, configRoots, transcriptCwd,
  countAgents, snapshot, paneRoster, readPanes, isParseable, classify, isNamedOurs,
  rank, paneOrder, modelDisplayName, readIdentity, transcriptFor,
  /* ⚠️ Exported so the ROUTE can say what tmux said. The alternative is a
     second caller of `list-panes` asking the same question a second time,
     which would report a different moment from the one that failed. */
  lastLookProblem,
  isAgentPane, isAgentSession, isFleetSession, parsePanes, onePanePerSession,
  setPaneSource, setPaneCapture, tmuxSaidNoServer, shDetail,
  /* #188's third verb: one state from two witnesses. Exported so the suite
     can pin every precedence rule without standing up a fleet. */
  reconcileReport, REPORT_WORKING_DECAY_MS,
  PANE_FORMAT, PANE_COLUMNS, STATE, CONFIDENCE, CONTEXT_LIMITS,
  /* ⚠️ EXPORTED for the restart-survival repair, which has to put the model an
     agent LAST RAN AS into a job that never recorded a choice. Exported rather
     than copied for the reason `countAgents` is: a private second reader of a
     transcript is the most-shipped defect in this codebase, and the two would
     disagree the first time the synthetic-row rule below moves. */
  readModel,
  // ⚠️ EXPORTED so `engine/chat.js` can show the person the part of the screen
  // that produced the NEEDS_YOU verdict. It is exported rather than copied for
  // the reason `countAgents` is: a private second copy is two derivations of
  // one question, this codebase's worst habit, and the copy would drift the
  // first time a marker is added here. The card that says "Needs you" and the
  // thread that shows the question must never be able to disagree.
  NEEDS_YOU_MARKERS,
  CODEX_NEEDS_YOU_MARKERS,
  ALL_NEEDS_YOU_MARKERS,
  SELECTOR_GLYPHS,
  isCodexCommand,
};

if (require.main === module) {
  process.stdout.write(JSON.stringify(snapshot(), null, 2) + '\n');
}
