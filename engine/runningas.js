'use strict';

/**
 * What account and model an agent is ACTUALLY running on, read live.
 *
 * 🛑 WHY THIS EXISTS (#1304). Josh asked three agents which account they were on.
 * Two could not say, one could, and one said it could not after another had.
 * Measured on this fleet the same morning:
 *
 *     briefs naming a model :  5      panes running that model :  0
 *     briefs naming account :  5      wrong                    :  4
 *
 * Every `You run on claude-fable-5` in every brief is false; all 18 panes run
 * `claude-opus-5`. So an agent's only source was a sentence somebody wrote months
 * ago, which means **the agents that answered him were more likely to be wrong
 * than the ones that refused.**
 *
 * ⭐ AND THE SENTENCE CANNOT BE FIXED BY REWRITING IT. Baron Draxum's brief said
 * `other@example.com`; he is on `agent@example.com`, because he was migrated at ~21:58 the
 * night before when `other@example.com` hit its weekly cap. His brief was CORRECT WHEN
 * WRITTEN and went stale when the thing it described moved. Editing 17 briefs
 * would break again at the next migration. **Read live state; do not restate it.**
 *
 * ⚠️ THREE TRAPS, ALL OF WHICH PRODUCED CLEAN, PLAUSIBLE, UNIFORM WRONG ANSWERS
 * while this was being investigated, two of them by the people investigating it:
 *
 *   1. The pane's direct child is the `bun` discord plugin, NOT the agent.
 *      Reading it gives `<no --model flag>` for every agent, which looks like a
 *      finding. The agent process (claude, or codex since #2811) is a
 *      descendant, so the pid tree has to be walked.
 *   2. There are TWO `.claude.json` files. The default account's record sits
 *      BESIDE the config dir at `~/.claude.json` (132KB, written continuously);
 *      `~/.claude/.claude.json` is 624 bytes, carries no `oauthAccount`, and had
 *      not been touched in two days. Reading the decoy says the account is ABSENT.
 *      ⇒ `accounts.configFile()` already gets this right and its docblock already
 *      warned that resolving the path by hand reproduces #527. Two agents resolved
 *      it by hand anyway, in an investigation about this exact fact. **Use the
 *      helper.**
 *   3. `CLAUDE_CONFIG_DIR` is absent from the cmdline and present in the ENV, so
 *      `ps -o command=` cannot see it and `ps -Eww` can.
 *
 * 🔑 EVERY READER IS INJECTABLE so this is testable without a tmux server, a
 * process tree, or a signed-in account. The acceptance bar for #1304 was that
 * whatever gets built has a control that can return the other value; a module
 * that can only be run against the real machine cannot have one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🪟 THE win32 ARM (#570), AND WHAT IT CAN AND CANNOT SEE.
 *
 * Everything above is the darwin arm and is unchanged. Windows has no tmux, so
 * `tmux list-panes` -- the call that turned a session name into a pid -- answers
 * nothing there, and so did this whole module: the board could not report a
 * win32 agent's real account or model at all.
 *
 * 🔑 THE NAME -> pid STEP IS `engine/win32live`'s JOIN, NOT A SECOND COPY. That
 * module is THE ownership join for win32 (`claude agents --json` ∩ the
 * fail-closed `win32sessions` record), it already resolves the board's name, and
 * it already carries the pid -- so this arm asks it rather than re-deriving it.
 * Duplicated derivations are this repo's most expensive recurring defect and the
 * win32 seams had already paid for it twice; see win32live's header.
 *
 * 🔑 AND IT SKIPS TRAP 1 ENTIRELY. There is no pid tree to walk here: the pid in
 * `claude agents --json` IS the Claude process, not a shell whose grandchild is
 * Claude. `agentUnder` is darwin's answer to a tmux pane's first child being the
 * bun plugin, and it has no win32 counterpart because the problem does not exist.
 *
 * 🛑 THE ACCOUNT IS NOT KNOWABLE LIVE ON WINDOWS, AND THIS ARM SAYS SO RATHER
 * THAN GUESSING. On a Mac the account is an environment variable on the process
 * (trap 3), read with `ps -Eww`: `CLAUDE_CONFIG_DIR` for a claude agent and
 * `CODEX_HOME` for a codex one since #2811. Windows has no supported way for an
 * ordinary process to read another process's environment -- Win32_Process
 * exposes CommandLine and not the environment block -- so the variable is
 * invisible here. ⚠️ AND ITS ABSENCE IS NOT EVIDENCE. Darwin may fall back to
 * the default config dir when the var is missing, because there the env WAS read
 * and the var genuinely was not set. Here the env was never read at all, so
 * "therefore the default account" would be a confident answer off a look that
 * did not happen -- precisely the failure this module exists to remove, and
 * precisely the one that made Baron's brief wrong (he had been MIGRATED off the
 * account everything said he was on). So `account`, `organization` and
 * `configDir` are all null, `because` says why, and `server.js:whoamiFor` then
 * falls through to the RECORD for the account and labels it `from: 'record'` --
 * an honest, already-built fallback rather than a new one.
 *
 * 📌 CONSIDERED AND DELIBERATELY NOT DONE: inferring the config dir by hunting
 * for the session's `<sessionId>.jsonl` transcript under each known account. It
 * is a real live read, but accounts that share memory are symlinked onto ONE
 * projects tree (`accounts.sharesMemory`), so a hit can belong to several
 * accounts at once and the honest outcome would often be the same null. A new
 * derivation of "which account owns this directory" is not worth adding for a
 * sometimes-answer; if the launch path ever puts the account on the command line
 * or in the ownership record, THAT is where this should read it from.
 */

const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const accounts = require('./accounts');
const win32live = require('./win32live');

const HOME = () => process.env.AGENT_WORKFORCE_HOME || os.homedir();

const CALL_MS = 5000;

/* 🔑 ONE SHARED BUDGET FOR THE WHOLE LIVE READ (kosmos#1366), NOT THREE INDEPENDENT
   TIMEOUTS. Every exec in this module goes through `sh`, so a deadline threaded
   here bounds the whole read without making anything async and without changing
   the call graph. The card's own note expected this to need restructuring; it does
   not, because there is exactly one call site.
   ⚠️ OPT-IN ON PURPOSE. `deadline` absent means today's behaviour exactly, so
   `everyone()` and every other caller are unaffected until they ask to be bounded.
   That keeps the per-call 5s default a separate decision, which is what the card
   said it should be.
   📌 A SPENT BUDGET RETURNS '' - the same value a failed read already returns - so
   it lands on the fallback the callers ALREADY have rather than needing a new one.
   That is why this is small: the handling exists, only the trigger was missing. */
function sh(cmd, args, deadline) {
  let ms = CALL_MS;
  if (deadline != null) {
    const left = deadline - Date.now();
    /* Refuse rather than run with no time: a 0ms timeout is not a shorter read,
       it is a read that cannot succeed, and spending the process spawn to learn
       that is worse than answering from the record now. */
    if (left <= 0) return '';
    ms = Math.min(CALL_MS, left);
  }
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: ms }); } catch { return ''; }
}

/** session name -> pane pid, from tmux. */
function defaultPanes(deadline) {
  const out = sh('tmux', ['list-panes', '-a', '-F', '#{session_name} #{pane_pid}'], deadline);
  const map = new Map();
  for (const line of String(out).split('\n')) {
    const m = line.match(/^(\S+)\s+(\d+)$/);
    if (m && !map.has(m[1])) map.set(m[1], Number(m[2]));
  }
  return map;
}

/** pid -> { ppid, command }, the whole table in one call. */
function defaultProcs(deadline) {
  const out = sh('ps', ['-eo', 'pid=,ppid=,command='], deadline);
  const map = new Map();
  for (const line of String(out).split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (m) map.set(Number(m[1]), { ppid: Number(m[2]), command: m[3] });
  }
  return map;
}

/** The ENVIRONMENT of one pid. `-E` is the whole point: see trap 3. */
function defaultEnvOf(pid, deadline) {
  return sh('ps', ['-Eww', '-o', 'command=', '-p', String(pid)], deadline);
}

/**
 * The `claude` process under a pane, found by walking DOWN the tree.
 *
 * ⚠️ Breadth-first and cycle-guarded. A pid table read in one shot can contain a
 * process whose parent has already exited and been recycled, and a naive walk on
 * that loops forever.
 */
/* The two runner executables, and the one place their names are written.

   🛑 NOT `status.isCodexCommand`, AND THE REASON MATTERS. That helper is
   `c === 'codex' || c === 'codex.exe'`, which is right for a tmux PANE command
   (a bare name) and returns FALSE for a process PATH like
   `/opt/homebrew/bin/codex`, which is what `ps` gives this function. Reusing it
   here would have compiled, read as correct, and never matched: an inert fix.
   Measured both shapes before deciding.

   📌 NO `.exe` ARM, deliberately, though an earlier draft of this carried one
   "so the posix and win32 arms recognise the same two names". They do not share
   this function: `agentUnder` is called only from `runningAsDarwin`, and the
   header above says why it has no win32 counterpart. The clause could not
   execute and no test could see it. */
function runnerNamed(token) {
  const t = String(token == null ? '' : token);
  for (const name of ['claude', 'codex']) {
    if (t === name || t.endsWith('/' + name)) return name;
  }
  return null;
}

function agentUnder(panePid, procs) {
  const kids = new Map();
  for (const [pid, { ppid }] of procs) {
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  /* 🛑 A LEVEL AT A TIME, AND CLAUDE WINS A TIE. Widening this matcher created a
     risk that could not exist while only `claude` matched: two agent-shaped
     processes in one pane's tree, where whichever the walk happened to reach
     first decided the answer. Getting that wrong is the CARD'S OWN DEFECT
     INVERTED and strictly worse than the bug being fixed: a Claude agent would
     be told it is a Codex agent, its account read from `CODEX_HOME`, and its
     recorded model suppressed as foreign.
     ⇒ Depth still decides first, which is what makes the launcher case work. The
     tie is the only ambiguous case, and it resolves to `claude` because that is
     exactly the answer this function gave before codex was added.
     🛑 THAT LAST PROPERTY HOLDS FOR THE TIE ONLY, and an earlier version of this
     comment claimed it for the whole widening: "cannot turn one answer into
     another". Measurably false, and contradicted by a test in this repo. A
     shallower codex above a deeper claude used to resolve to the claude (it was
     the only thing that matched) and now resolves to the codex, which is the
     intended answer and is asserted by `DEPTH still decides before the runner
     preference`. So the widening CAN change one answer into another, by depth;
     what it cannot do is change the answer at a same-depth tie. */
  let level = [panePid];
  const seen = new Set();
  while (level.length) {
    const next = [];
    let fallback = null;
    for (const pid of level) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const rec = procs.get(pid);
      if (rec) {
        const first = String(rec.command).trim().split(/\s+/)[0] || '';
        /* Matched on the executable PATH ending in /claude or /codex, not on the
           string appearing anywhere: a pane running `grep claude` is not an agent,
           and neither is this module's own command line.

           📌 A NODE-FRONTING INSTALL NEEDS NOTHING EXTRA HERE, and this is worth
           recording because the opposite is very easy to believe. `claude` on a
           native install is a Mach-O binary, but `/opt/homebrew/bin/codex` (the
           npm/homebrew launcher this repo's `runners.js` still supports) is a
           `#!/usr/bin/env node` script, so `ps` shows it as
           `node /opt/homebrew/bin/codex` and the first token is the INTERPRETER.
           An earlier draft therefore taught this function to hop from an
           interpreter to its script argument.

           🛑 THAT WAS UNNECESSARY, MEASURED. The launcher does not become the
           agent: it `spawn`s the native binary as a CHILD, and this is a BREADTH
           walk over the whole subtree, so the child is reached by the plain rule.
           Sampled during a real run:
               node /opt/homebrew/bin/codex --help                  <- launcher
               .../vendor/aarch64-apple-darwin/bin/codex --help     <- the agent
           ⇒ Widening the matcher to accept `node` would have bought nothing and
           cost the thing this rule exists for, since a pane can hold an unrelated
           node process. The refusal during the launcher's first few milliseconds,
           before its child exists, is honest. */
        const runner = runnerNamed(first);
        if (runner === 'claude') return { pid, runner };
        if (runner != null && fallback == null) fallback = { pid, runner };
      }
      for (const k of kids.get(pid) || []) next.push(k);
    }
    if (fallback != null) return fallback;
    level = next;
  }
  return null;
}

/* ── the win32 arm ───────────────────────────────────────────────────────── */

/* The sentinel PowerShell prints AFTER the process list. It is what separates
   "we looked and that process is not there" from "the look never happened":
   Get-CimInstance with a filter that matches nothing exits 0 with NO output, so
   an empty stdout is otherwise indistinguishable from powershell.exe missing, a
   spent budget, or a timeout. Same false-zero rule the whole win32 family holds
   -- an unmade look must never read as an empty answer. */
const WIN32_CMDLINES_OK = 'KOSMOS-CMDLINES-OK';

/**
 * pid -> command line, for a batch of pids, in ONE shell.
 *
 * ⚠️ BATCHED ON PURPOSE, and this is the lesson `everyone()` already paid for
 * below: a per-pid reader here would start a PowerShell per agent, and a
 * PowerShell start is ~0.5s, so the worst case would scale with the fleet AND
 * each spawn would carry its own slice of the shared budget.
 *
 * 🔑 NOTHING EXTERNAL IS INTERPOLATED. The filter is built only from values that
 * already passed `Number.isInteger(n) && n > 0`, so no caller-controlled text
 * reaches the script text. Keep that gate if this ever grows another field.
 *
 * ⚠️ `Out-String -Width 32767` is NOT decoration. PowerShell wraps host output at
 * the console buffer width, and a wrapped command line loses `--model` off the
 * end silently -- a missing model that looks exactly like an agent started
 * without one. 32767 is the Windows command-line length limit, so nothing real
 * can exceed it.
 *
 * @returns {Map<number,string>|null} pid -> command line (a process whose command
 *   line is not readable, e.g. a protected one, maps to ''), or null if the read
 *   itself failed.
 */
function defaultCmdlines(pids, deadline) {
  const ids = [];
  for (const p of pids) if (Number.isInteger(p) && p > 0 && !ids.includes(p)) ids.push(p);
  // No pids to ask about is a complete, successful answer, not a failed read.
  if (!ids.length) return new Map();
  const filter = ids.map((n) => 'ProcessId=' + n).join(' or ');
  const script = "Get-CimInstance Win32_Process -Filter '" + filter + "' | "
    + 'ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" } | Out-String -Width 32767; '
    + "'" + WIN32_CMDLINES_OK + "'";
  return parseCmdlines(sh('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], deadline));
}

/**
 * Parse what `defaultCmdlines` asked PowerShell for. Exported for testability:
 * it is the only part of the win32 process read that can be exercised without a
 * real machine, and a shell that is stubbed away proves nothing about it.
 */
function parseCmdlines(out) {
  const text = String(out == null ? '' : out);
  const lines = text.split(/\r?\n/);
  // The sentinel proves the shell ran to completion. Without it, refuse.
  if (!lines.some((l) => l.trim() === WIN32_CMDLINES_OK)) return null;
  const map = new Map();
  for (const line of lines) {
    // `<pid> <command line>`. A command line containing a newline would leave
    // unmatched continuation lines, which are dropped rather than mis-attributed
    // to the previous pid -- a truncated command line is a wrong answer, and a
    // missing one is only an unknown.
    const m = line.match(/^(\d+) ?(.*)$/);
    if (m && !map.has(Number(m[1]))) map.set(Number(m[1]), m[2]);
  }
  return map;
}

/** `--model` off a command line, the one field win32 CAN read live. */
/* 🛑 BOTH SPELLINGS, BECAUSE THE PRODUCT WRITES BOTH AND THEY SPLIT BY RUNNER.
   `bin/agent-supervisor.sh` launches codex with `-m "$MODEL"` and claude with
   `--model "$MODEL"`, while `engine/win32launch.js` pushes `--model` for BOTH.
   A `--model`-only match is therefore correct on win32 and blind on darwin for
   the one runner darwin can now report, so this read could never see a Codex
   agent's model on the only arm that resolves one.
   ⚠️ It is latent rather than live today: `setModel` refuses a codex agent, so
   `$MODEL` is empty and the supervisor takes its no-flag branch. It goes live the
   moment OpenAI model rows exist, which is exactly when nobody will be looking
   here. Caught by a reviewer who read the supervisor instead of my fixture: every
   codex arm I had written used `--model`, a shape the darwin product never
   produces, so the assertion "the model came from the codex command line" was
   testing an impossible input.
   The token must stand alone (anchored on start-or-space, and a value must
   follow), so this does not match an `-m` buried in a path or another word.
   📌 RESIDUAL, STATED: a standalone `-m` INSIDE a quoted argument value would
   still match, because this reads a flat command string and has no quoting
   model. Sampled against this machine's live process table: 21 command lines
   carried a standalone `-m` and NONE had a claude or codex first token (they
   are mdworker_shared and python). A live sample, so the count moves; the
   zero is the part that matters, and no product launch path produces the
   shape. It is the price of the widened token, not an oversight. */
function modelIn(cmd) {
  const m = String(cmd == null ? '' : cmd).match(/(?:^|\s)(?:--model|-m)[= ](\S+)/);
  return m ? m[1] : null;
}

/* Said once, because both win32 entry points return it and two phrasings of one
   fact is how a caller ends up believing they are two facts. */
const WIN32_NO_ACCOUNT =
  'Windows cannot read another process\'s environment, so which account this agent is signed in as is not knowable live here';

/** One win32 answer, given the joined entry and an already-read command table. */
function win32Answer(entry, cmds) {
  if (entry.pid == null) {
    /* ⚠️ NOT "no such agent" and NOT "no account". The session is live and ours;
       it just reports no process we can inspect (a session still registering, or
       a background one). A different fact, so a different sentence. */
    return { ok: false, because: `${entry.name} is live but reports no process id, so there is nothing to inspect` };
  }
  if (cmds == null) return { ok: false, because: 'we could not read the process table on this computer' };
  const cmd = cmds.get(entry.pid);
  if (cmd == null) {
    return { ok: false, because: `process ${entry.pid} for ${entry.name} was gone by the time we looked at it` };
  }
  return {
    ok: true,
    /* All three null, all three for the same reason, spelled out in the header:
       the environment that carries CLAUDE_CONFIG_DIR is unreadable on Windows,
       and its ABSENCE is not evidence of the default account. */
    account: null,
    organization: null,
    model: modelIn(cmd),
    configDir: null,
    /* ⚠️ `because` ON A SUCCESSFUL READ. `ok` means the look happened; the
       sentence names the HALF of the question this platform cannot answer, so a
       caller rendering it says something true instead of inventing a reason.
       📌 TWO CLAUSES OF THIS COMMENT WERE KILLED BY #2811 and are corrected here
       rather than left: it used to say this shape is one "which the darwin arm
       never does", and that `server.js` "reads only ok/account/configDir/model".
       The darwin arm now returns a `because` ON A SUCCESSFUL READ for a codex
       agent too (see the end of `runningAsDarwin`, which cites this block as its
       precedent), and `server.js` also reads `runner` off the live answer.
       ⚠️ THE SAME PATTERN, NOT THE SAME SHAPE. The two answers differ: darwin
       carries `runner` and a real `configDir`, this arm carries neither. Said
       exactly, because an earlier version of this sentence claimed "exactly this
       shape" while the docstring above denied shape equality, so one file
       asserted both.
       Nothing renders `because` when `ok` is true today, so it remains additive
       rather than a contract change for the existing reader. */
    because: WIN32_NO_ACCOUNT,
  };
}

function runningAsWin32(session, deps = {}) {
  const deadline = deps.budgetMs != null ? Date.now() + deps.budgetMs : null;
  /* THE ownership join, injectable as one seam. A test supplies a Map and needs
     no `claude`, no ownership record and no Windows -- which is the point: the
     fleet's Macs have to be able to assert this arm. */
  const live = deps.live || (() => win32live.byName());
  const cmdlines = deps.cmdlines || ((pids) => defaultCmdlines(pids, deadline));
  const owned = live();
  if (owned == null) {
    /* ⚠️ A FAILED LOOK, NOT AN EMPTY MACHINE. win32live returns null when
       `claude agents --json` could not be read, and "no agents are running" is a
       different answer from "we could not see what is running". */
    return { ok: false, because: 'we could not read the live Claude sessions on this computer' };
  }
  const entry = owned.get(session);
  /* Not "there is no such agent": an unrecorded session (the operator's own) is
     deliberately invisible to the join, so "not one of ours that we can see" is
     the honest scope of this refusal. */
  /* 🛑 KNOWN GAP, NAMED RATHER THAN LEFT TO BE REDISCOVERED: on win32 a live
     Codex agent lands HERE, and this sentence is false about it. The ownership
     join behind `entry` is `win32live.byName()`, whose only source is
     `claude agents --json` -- it has no codex arm at all. Windows does run codex
     agents (`win32launch.js` picks the bare command per runner, `win32create.js`
     records which), so Kosmos owns a session it then says it does not own.
     ⇒ NOT fixed on this branch, and the reason is that it is a different defect
     with a different fix: the darwin arm reads a PROCESS TREE and needed a wider
     match, while this arm needs a SECOND ENUMERATION SOURCE for codex sessions.
     That source is a real piece of work (something must enumerate codex sessions
     the way `claude agents --json` enumerates claude ones); it is not blocked on
     being unable to test win32, which this repo does routinely through injected
     deps.
     📌 WINDOWS DOES NAME THE PROVIDER, THROUGH THE PROFILE, and this note has
     been wrong THREE TIMES about which rung does it. Recorded in full because the
     wrong versions were each plausible and a reader who sees only this one cannot
     tell which stones were already turned over:
       v1 "whoami reports null for it on Windows"   - true of the JSON field,
          read as true of the answer.
       v2 "the sentence names it off the @kosmos_runner marker" - measured on a
          card shape Windows cannot produce (no tmux).
       v3 "every rung floors at claude"             - I retired rung 1 and
          ASSUMED rungs 2 and 3 followed.
       v4 "rung 3 fires, rung 1 does not"           - I then verified rung 3 and
          ASSUMED rung 1 still did not, having only checked that tmux is absent.
     ⭐ FOUR TIMES, ONE PATTERN: each version verified the rung it had just been
     shown and inferred the rest. The fix is not a fifth sentence.
     Traced and measured, rung by rung. TWO of the three fire on Windows:
       rung 1  `card.runner`  -> FIRES. Not via tmux (there is none) but via the
               win32 ROSTER: `server.js` does, under `process.platform === 'win32'`,
               `status.setPaneSource(win32roster.make())`, and `win32roster` emits
               a synthetic PANE_COLUMNS row whose `runner` column is `rec.runner`
               from the win32 sessions record. The engine parses it exactly as it
               parses a tmux pane.
       rung 2  `readJob` -> `~/Library/LaunchAgents` -> null; launchd is macOS.
       rung 3  `store.readProfile(name).provider`    -> FIRES. Measured with no
               plist at all, which IS the Windows state:
                 profile.provider = openai  ->  recordedRunner = "codex"
                 control, no provider written ->  "claude"
     ⇒ Rung 3 is a plain JSON read with NO platform dependency, and the provider
     reaching it is written by SHARED code: `create.js`'s `createAgentInner` (the
     win32 create path calls it) and `engine/discover.js` on connect, which
     contains zero occurrences of win32/darwin/process.platform. So a Windows
     OpenAI agent whose profile was written IS told it is a Codex agent; only the
     live-process `runner` field is null there.
     ⚠️ "win32create.js writes no provider" is true and IRRELEVANT: that file is
     session-id pinning CALLED FROM `create.js`, not the win32 substitute for it.
     Checking it and concluding about the platform is exactly the error a reviewer
     had NAMED as their own weakest premise two rounds earlier. */
  if (!entry) return { ok: false, because: `no session called ${session} that Kosmos owns on this computer` };
  return win32Answer(entry, cmdlines([entry.pid]));
}

function everyoneWin32(deps = {}) {
  const deadline = deps.budgetMs != null ? Date.now() + deps.budgetMs : null;
  const live = deps.live || (() => win32live.byName());
  const cmdlines = deps.cmdlines || ((pids) => defaultCmdlines(pids, deadline));
  const owned = live();
  if (owned == null) return [];
  /* ONE process read for the whole fleet, hoisted for exactly the reason the
     darwin `everyone()` hoists `procs` (see its comment): a per-session read
     would spawn a PowerShell per agent and multiply the timeout by the fleet. */
  const cmds = cmdlines([...owned.values()].map((e) => e.pid));
  return [...owned.values()]
    .map((entry) => ({ session: entry.name, ...win32Answer(entry, cmds) }))
    .sort((a, b) => a.session.localeCompare(b.session));
}

/* ── the platform seam ───────────────────────────────────────────────────── */

/**
 * ⚠️ INJECTABLE, NOT A BARE `process.platform` READ, and the reason is the
 * acceptance bar this module was built to: whatever gets built must have a
 * control that can return the other value. The fleet is Macs and the port is
 * Windows, so a bare read would make each arm unassertable from the other
 * machine -- half the tests would be decoration on whichever box ran them.
 * Same shape as `boardauth.ownerOnlyModeIsEnforced(platform)` and
 * `create.unusablePath(bin, platform)`.
 */
function armFor(deps) {
  return (deps && deps.platform) || process.platform;
}

/**
 * What one agent is running on.
 *
 * Returns `{ ok, account, organization, model, configDir, because }`, plus
 * `runner` ON A SUCCESSFUL DARWIN READ ONLY (#2811: which agent runtime the live
 * process actually is, so a caller never has to infer the provider from a
 * directory name). Everywhere else the key is ABSENT, not null: a refusal has no
 * process to name, and the win32 arm DOES NOT DERIVE A RUNNER AT ALL.
 *
 * 🛑 THAT IS A GAP, NOT AN ABSENCE OF EVIDENCE, and an earlier version of this
 * paragraph said the arm "has no codex source, so it has nothing to report".
 * False: `win32Answer` holds the agent's full command line and already parses it,
 * so it will read a model straight out of a CODEX command line and still report
 * no runner. Measured:
 *     cmdline `C:\Users\x\codex.exe --model gpt-5.6`
 *       -> model "gpt-5.6", and no `runner` key
 *     ⚠️ THAT MEASUREMENT INJECTS A CODEX COMMAND LINE PAST THE OWNERSHIP JOIN,
 *     which the note below explains a real codex agent never gets past. It is
 *     cited only to show the command line is in hand, and is not a reachable
 *     product state.
 * ⇒ The material is present and the derivation was never built. `runnerNamed` is
 * darwin-only on purpose (it matches a POSIX executable path and carries no
 * `.exe` arm), so win32 would need its own first-token match.
 *
 * 📌 AND BUILDING IT HERE WOULD BE DEAD CODE TODAY, which is the real reason it
 * is absent and not the one first written here ("nobody can run it" is wrong:
 * this repo builds and tests the whole win32 arm through injected deps on Macs).
 * A codex agent never REACHES `win32Answer`. The ownership join upstream,
 * `win32live.byName()`, enumerates `claude agents --json` and contains no codex
 * source at all, so a codex agent fails the `!entry` check above and is refused
 * with "no session called ... that Kosmos owns on this computer". The measurement
 * above reaches this arm only by injecting a codex command line past that join.
 * ⇒ The win32 gap is ONE gap and it is upstream: teach the ownership join about
 * codex, and a runner derivation here becomes both reachable and worth writing.
 * Named so the next reader sees the order of the work rather than a platform
 * limit: a Codex agent on win32 is still invisible to this reader, which is this
 * card's own bug on the other platform.
 *
 * 📌 EVERY PATH DRIVEN, NOT GENERALISED. An earlier version of this paragraph was
 * right about the arms and wrong about refusals, and the one before it was wrong
 * about win32 entirely. `engine/runningas.test.js` ("the ANSWER SHAPE is pinned
 * per path") ASSERTS this matrix, so it is a checked contract and not a claim:
 *     darwin ok:true    -> account,because,configDir,model,ok,organization,runner
 *     darwin ok:false   -> no `runner` key
 *     win32  every path -> no `runner` key
 * `server.js` reads it as `live.ok === true && live.runner`, so an absent key on
 * a refusal is exactly what the one consumer expects.
 * On any
 * failure `ok` is false and `because` is a sentence, because "we could not tell"
 * and "it is running on nothing" are different answers and only one of them is
 * ever true.
 *
 * 🪟 On win32 this dispatches to a different reader (see the header), read
 * through `win32live`'s ownership join instead of tmux, with `account` and
 * `configDir` honestly null and `because` saying why. NOT the same answer shape:
 * it carries no `runner` key at all, per the list above.
 */
function runningAs(session, deps = {}) {
  if (armFor(deps) === 'win32') return runningAsWin32(session, deps);
  return runningAsDarwin(session, deps);
}

function runningAsDarwin(session, deps = {}) {
  /* `budgetMs` bounds the WHOLE live read, not each call (kosmos#1366). The route
     wants "answer or fall back", and three independent 5s timeouts gave a worst
     case equal to the client's own patience, so a slow reader produced NO answer
     where the record answer was available the whole time. */
  const deadline = deps.budgetMs != null ? Date.now() + deps.budgetMs : null;
  const panes = deps.panes || defaultPanes(deadline);
  const procs = deps.procs || defaultProcs(deadline);
  const envOf = deps.envOf || ((pid) => defaultEnvOf(pid, deadline));
  const identityOf = deps.identityOf || accounts.identityOf;

  const panePid = panes.get(session);
  if (panePid == null) {
    return { ok: false, because: `no pane called ${session} on this computer` };
  }
  const found = agentUnder(panePid, procs);
  if (found == null) {
    /* ⚠️ NOT "it has no account". The pane exists and nothing is running in it we
       recognise, which is a different fact from an unreadable account.
       #2811: says "Claude Code or Codex" now, because saying only Claude about a
       running codex agent was the lie this card was filed for. */
    return { ok: false, because: `nothing that looks like Claude Code or Codex is running under ${session}` };
  }
  const { pid, runner } = found;

  const cmd = String((procs.get(pid) || {}).command || '');
  /* 🛑 `modelIn`, NOT A SECOND COPY OF ITS REGEX, and this arm carried one. The
     duplicate here read `--model` only, so widening the helper for the codex `-m`
     spelling fixed the win32 arm and left THIS one, the only arm that can report
     a codex agent at all, still blind. One fact derived in two places, the two
     drifting, and the wrong one deciding the path that matters: the shape this
     codebase names more often than any other. */
  const modelFound = modelIn(cmd);
  const env = String(envOf(pid) || '');
  /* #2811: read the env var this RUNNER actually uses. A codex agent is
     configured by CODEX_HOME and has no CLAUDE_CONFIG_DIR, so the Claude-only
     read below used to fall through to the synthesised `~/.claude` and report a
     codex agent as living in a Claude directory: the "cannot identify
     .codex-work2" half of this card. */
  const codex = runner === 'codex';
  /* 🛑 ANCHORED ON START-OR-SPACE, BECAUSE BOTH NAMES HAVE A REAL LONGER TWIN.
     `AGENT_WORKFORCE_CODEX_HOME` and `AGENT_WORKFORCE_CLAUDE_CONFIG_DIR` both
     exist in this repo and are set by its own test sandboxes, and an unanchored
     match takes whichever appears FIRST in the environment block -- which is
     insertion order, not alphabetical, so it is not even reliably wrong.
     Measured on a real `ps -Eww` shape:
       unanchored -> /tmp/sandbox-home          <- the AGENT_WORKFORCE_ one
       anchored   -> /Users/a/.codex-work2      <- the variable actually asked for
     The codex arm is new here; the claude arm had the same hole and is fixed in
     the same expression, because leaving one half of one fact broken is how the
     two drift and the looser one decides. */
  const dirMatch = env.match(codex ? /(?:^|\s)CODEX_HOME=(\S+)/ : /(?:^|\s)CLAUDE_CONFIG_DIR=(\S+)/);
  const configDir = dirMatch ? dirMatch[1] : path.join(HOME(), codex ? '.codex' : '.claude');

  /* 🛑 `identityOf` RESOLVES A CLAUDE ACCOUNT, so it is not asked about a codex
     one. Answering `account: null` with a reason is the honest shape here, and it
     is deliberately NOT a second codex-account derivation: kosmos#2790 is
     reshaping codex account resolution in engine/openaiaccounts.js right now, and
     two readers of "which account is this agent on" would disagree the first time
     either moved. The provider and the config dir are what this card needs, and
     they are what this now answers. */
  const id = codex ? null : identityOf(configDir);
  return {
    ok: true,
    /* null rather than a guess. An agent that says "I do not know" is behaving
       better than one that recites a stale sentence, which is the whole finding
       behind this card. */
    account: (id && id.email) || null,
    organization: (id && id.organization) || null,
    model: modelFound,
    configDir,
    runner,
    because: codex
      /* ⚠️ `because` ON A SUCCESSFUL READ, the same PATTERN `win32Answer` uses
         (not the same shape: see the docstring's per-path key lists) and for the
         same reason: `ok` means the look happened, and the sentence
         names the HALF of the question this answer does not carry, so a caller
         rendering it says something true instead of inventing a reason.
         📌 AND THE SAME HONEST LIMIT, stated rather than implied: nothing renders
         it when `ok` is true today (`whoamiFor` returns account, model, source and
         resolvedRunner, and the route composes its own sentence from those). It is additive, not a contract
         change for the existing reader. Asserted in `runningas.test.js` so it is
         a checked value rather than decoration.
         No card number in the sentence itself: it is user-facing text, and #147's
         gate is right that a number there reads as assigning work. The
         cross-reference lives in the block comment above, as a record. */
      ? 'this is a Codex agent; which OpenAI account it is signed in as is not read here'
      : null,
  };
}

/** Every agent pane, so one call answers "who is on what". */
function everyone(deps = {}) {
  if (armFor(deps) === 'win32') return everyoneWin32(deps);
  /* 🛑 `procs` IS HOISTED FOR THE SAME REASON `panes` ALWAYS WAS, AND ITS ABSENCE
     HERE WAS COSTING A FULL PROCESS-TABLE READ PER SESSION. `runningAs` falls back
     to `defaultProcs()` whenever `deps.procs` is missing, and this loop forwarded
     `panes` but not `procs`, so N panes meant N executions of `ps -eo` where one
     answers for all of them. The asymmetry is the tell: `panes` had to be hoisted
     because it drives the loop, and `procs` has exactly the same shape and was not.
     ⚠️ It compounds #1366 rather than merely being slow: each of those reads
     carries its own timeout, so the worst case scaled with the number of panes. */
  const deadline = deps.budgetMs != null ? Date.now() + deps.budgetMs : null;
  const panes = deps.panes || defaultPanes(deadline);
  const procs = deps.procs || defaultProcs(deadline);
  const out = [];
  for (const session of panes.keys()) {
    out.push({ session, ...runningAs(session, { ...deps, panes, procs }) });
  }
  return out.sort((a, b) => a.session.localeCompare(b.session));
}

/* `_sh` and `_parseCmdlines` are exported for TESTABILITY and for no other reason,
   which is stated here so nobody reads them as API. kosmos#1366's budget is not
   observable through `runningAs`: injecting a dep is exactly what suppresses the
   behaviour under test, and a fake pid makes a real read return empty anyway, so
   both arms agree for the wrong reason. `_parseCmdlines` is the same case on the
   win32 side: injecting `cmdlines` replaces the shell AND its parser, so the
   sentinel rule (an unmade look is not an empty answer) would be asserted
   nowhere. Without these the guards cannot go red, and a test that cannot go red
   is decoration. */
module.exports = { runningAs, everyone, agentUnder, _sh: sh, _parseCmdlines: parseCmdlines };
