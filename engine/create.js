'use strict';

/**
 * Creating an agent.
 *
 * ⚠️ This is the most powerful thing this codebase does. Restart and clear act
 * on something that already exists; this MAKES things — a directory, a file an
 * agent boots from, a tmux session, and a launchd job that will start it again
 * on every reboot until someone removes it.
 *
 * So it is built like the destructive routes rather than like a form handler:
 *
 *   - **A name is validated once, hard, and early.** It has to be exactly its
 *     own sanitised form AND start alphanumeric — the two rules the rest of the
 *     system already enforces separately, which have disagreed before.
 *   - **Every command is `execFile` with an argument array**, never a shell
 *     string, and **nothing is interpolated into shell text at all**. The agent
 *     needs a supervising script — `tmux new-session -d` exits immediately, and
 *     launchd would otherwise respawn the job forever — but that script is
 *     `bin/agent-supervisor.sh`, shipped and shared, taking the agent as
 *     ARGUMENTS. So a name reaches launchd, tmux and the script as one argument
 *     each, never as text a shell could reinterpret.
 *     ⚠️ This is the second correction of this paragraph. It first read "no
 *     shell, ever", which stopped being true when a script was generated per
 *     agent with the name written into it; then it described that generated
 *     text and named `launcherFor`, which no longer exists. A safety header
 *     that is wrong about the safety model is the worst place in the file for
 *     it to be wrong, because it is what stops the next reader checking.
 *   - **A runner seam with a bidirectional interlock**: leaving dry-run throws
 *     unless a runner is already injected, and clearing the runner re-arms
 *     dry-run, so neither ordering leaves a test able to spawn real agents.
 *     ⚠️ And dry-run now suppresses the WRITES as well as the commands. It
 *     guarded them with `DRY_RUN && !runner` — true only in the state where the
 *     commands are inert anyway — so a test that installed a recorder still
 *     wrote a real plist into `~/Library/LaunchAgents`, and launchd starts that
 *     job at the next login whether or not anybody ran `bootstrap`. The
 *     interlock was covering the quieter half of the danger.
 *     ⚠️ This used to say "dry-run by default", and that was FALSE: the flag
 *     starts at `AGENT_WORKFORCE_DRY_RUN === '1'`, which is false unless
 *     somebody sets it, so a fresh process with no runner installed executes
 *     for real. The server relies on exactly that. What actually holds the
 *     tests off the machine is the test file arming dry-run at load, which it
 *     now does explicitly rather than by inheriting a guarantee that was only
 *     written down. A safety comment claiming more than the code does is worse
 *     than none — it is what stops the next reader checking.
 *   - **Nothing is claimed that was not verified.** "Created" is a claim about
 *     us; "it answered" is a claim about the agent, and only the second means
 *     the person has an agent.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const roles = require('./roles');

/**
 * The models an agent can be created on.
 *
 * ⚠️ Served to the screen from HERE (via the create panel's boot data), so
 * the menu a person chooses from and the flag the job runs with cannot
 * drift -- the design pack's own check asserts its display list against
 * this one. `arg` is the exact string handed to `claude --model`; `key` is
 * what the route accepts. DEFAULT (sonnet) sends the flag too: an explicit
 * choice and the preselected one must not behave differently, or the menu
 * lies about what changing it does.
 */
// `why`: one line a business person can choose by, shown under the picker on
// the create form and the agent's Model tab (#405). Relative to each other,
// which is the only comparison a person making this choice has.
const MODELS = [
  { key: 'fable', label: 'Claude Fable 5', arg: 'claude-fable-5',
    why: 'The most capable, and the most expensive to run. For work where being right matters more than being quick.' },
  { key: 'opus', label: 'Claude Opus 5', arg: 'claude-opus-5',
    why: 'Slower, and it holds more of a long job in its head.' },
  { key: 'sonnet', label: 'Claude Sonnet 5', arg: 'claude-sonnet-5', default: true,
    why: 'The everyday choice. Quick, and good at most work.' },
  { key: 'haiku', label: 'Claude Haiku 4.5', arg: 'claude-haiku-4-5-20251001',
    why: 'The quickest and the cheapest. For small, simple jobs done often.' },
];
// ⚠️ The ROSTER, from the module that defines what an agent name is. A second
// reading of tmux here would be a second definition of "who is already
// running", and this codebase's worst defects have all been two definitions of
// one fact. `status` does not require this module, so there is no cycle, and
// its `setPaneSource` seam is what keeps these tests off the real machine.
const status = require('./status');
// ⚠️ The same key every name-keyed route resolves by. Comparing raw names let
// this create `mybot` beside a live `my.bot-discord`: two names, one key, one
// instruction file, one avatar, one commitment record -- so a write naming
// either reached the other. This module's own header exists to prevent exactly
// that ("a name that sanitises to something else means two names can become
// one"), and the gate was checking the wrong thing to enforce it.
const store = require('./store');

const HOME = os.homedir();
const WORKERS_DIR = process.env.AGENT_WORKFORCE_WORKERS || path.join(HOME, 'work', 'workers');
const AGENTS_DIR = process.env.AGENT_WORKFORCE_LAUNCH || path.join(HOME, 'Library', 'LaunchAgents');
/**
 * Where the product keeps things it installs for itself, as opposed to things
 * that belong to an agent.
 *
 * ⚠️ The same root `engine/store.js` uses, honouring the same variable, so a
 * sandboxed test sandboxes this too — and so there is one answer to "where does
 * this product keep its files" rather than a second convention introduced by
 * whoever needed a directory next.
 */
const SUPPORT_DIR = process.env.AGENT_WORKFORCE_DATA
  ? path.join(process.env.AGENT_WORKFORCE_DATA, 'AgentWorkforce')
  : path.join(HOME, 'Library', 'Application Support', 'AgentWorkforce');

const OUTCOME = { CREATED: 'created', REFUSED: 'refused', PARTIAL: 'partial' };

/* ── the runner seam ─────────────────────────────────────────────────────── */

let DRY_RUN = process.env.AGENT_WORKFORCE_DRY_RUN === '1';
let runner = null;

/**
 * ⚠️ A BIDIRECTIONAL interlock. `setDryRun(false)` refuses unless a runner is
 * installed, and `setRunner(null)` re-arms dry-run — so neither ordering can
 * leave a test able to spawn a real tmux session. A one-directional invariant
 * would depend on every test's `finally` running in the right order.
 *
 * (Earlier comments here cited `engine/lifecycle.js` as the precedent. That
 * module is on another branch and does not exist beside this one, so a reader
 * sent to it could not check the invariant being claimed — the same
 * cross-branch reference that put a call to a nonexistent function in this
 * file's own route once already.)
 */
function setRunner(fn) {
  runner = fn || null;
  if (!runner) DRY_RUN = true;
}
function setDryRun(on) {
  if (!on && !runner) {
    throw new Error('refusing to leave dry-run with no injected runner: this would create real agents');
  }
  DRY_RUN = Boolean(on);
}

function run(file, args) {
  if (runner) return runner(file, args);
  if (DRY_RUN) return { ok: true, stdout: '', dryRun: true };
  // ⚠️ `stdio` pipes stderr rather than inheriting it. Without this, the
  // `launchctl print` probe -- which fails for every FREE name, by design --
  // printed "Could not find service" to the operator's console immediately
  // before the board reported a successful creation.
  return {
    ok: true,
    stdout: execFileSync(file, args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }),
  };
}

/* ── names ───────────────────────────────────────────────────────────────── */

/**
 * Is this a name we can build an agent out of?
 *
 * ⚠️ ONE function, because the rules it combines have already disagreed with
 * each other elsewhere in this codebase and the disagreement was the worst
 * defect found on the previous branch. A name has to survive:
 *
 *   - `safeKey` unchanged — the routes resolve by exact name, and a name that
 *     sanitises to something else means two names can become one.
 *   - an alphanumeric first character — `safeServiceName` and `safeTarget` both
 *     require it, so a leading `_` produces a directory we can make and a
 *     service we cannot.
 *   - a length a human will actually see, and a shape a person can type.
 */
const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/**
 * The name we will actually use, from whatever was typed.
 *
 * ⚠️ ONE trim, in one place, EXPORTED. `nameProblem` trimmed its input and
 * `createAgent` trimmed again independently, so the two agreed only by
 * coincidence: `nameProblem(' ab')` answered "that is fine" about a string
 * nobody would ever use, and any third caller that validated a raw value and
 * then used it unchanged would have carried a leading space into a directory
 * name and into the startup script. Found by a property test asking what the
 * validator actually accepts rather than what I remembered it accepting.
 *
 * So: validate the cleaned name, use the cleaned name, and let a caller ask for
 * it rather than re-deriving it.
 */
function cleanName(raw) {
  return String(raw == null ? '' : raw).trim();
}

/**
 * The name the MACHINERY uses: the tmux session, the launchd label, the folder,
 * every key in the store.
 *
 * ⚠️ TWO NAMES, ONE OF THEM LOWER CASE, and the split is the whole change here.
 * This used to refuse a capital outright — "use lower case, so the name is the
 * same everywhere it appears" — which is a true sentence about the machinery
 * and the wrong thing to say to somebody naming a colleague. They type `Casey`
 * and were told their own name for it was invalid.
 *
 * So the capital survives as the DISPLAY name and everything the operating
 * system touches uses this. Nothing on disk changes shape: the session is still
 * `casey`, the label is still `com.kosmos.agent.casey`, and every existing agent
 * keeps every path it has.
 *
 * ⚠️ `toLowerCase` and NOTHING ELSE. It is not `safeKey`, deliberately.
 * `safeKey` STRIPS, so `Ca.sey` would become `casey` — a different agent's name,
 * arrived at silently, which is the exact hole this repo has closed three times
 * on other routes. Lowercasing changes case and nothing else, and `nameProblem`
 * then refuses anything the result is not made of.
 */
function slugFor(raw) {
  /* #740 (Josh, 2026-08-24 21:17: "I've got to be able to have capitals.
     I've got to be able to have spaces... first name, last name"): a run of
     whitespace becomes ONE hyphen, and that is the only thing besides case
     that changes. Still not safeKey: nothing is stripped, so `Ca.sey` is
     still refused rather than silently becoming `casey`. "Kira Knightley"
     is shown as typed and is `kira-knightley` to the machinery; if an agent
     already holds that machine name, createAgent refuses by name, so two
     spellings can never land on one folder in silence. */
  return cleanName(raw).toLowerCase().replace(/\s+/g, '-');
}

function nameProblem(raw) {
  /* #740: a plain space between words is a name; a tab or a line break
     inside one is not (it would break the "You are **Name**" line every
     agent boots from). Refused here, in words, before slugFor folds it. */
  if (/[^\S ]/.test(cleanName(raw))) return 'use plain spaces between the words of a name, not tabs or line breaks';
  const name = slugFor(raw);
  if (!name) return 'give the agent a name';
  // ⚠️ Length gets its OWN sentence. `NAME_RE` enforces 2 to 32 characters, and
  // a person who typed `a` was told to use letters, numbers, hyphens and
  // underscores -- a rule they had not broken, with no way to work out what was
  // actually wrong. A refusal that names the wrong rule is worse than a vague
  // one.
  if (name.length < 2) return 'use at least two characters, so the name is something you can pick out';
  if (name.length > 32) return 'keep it to 32 characters or fewer';
  if (!NAME_RE.test(name)) {
    return 'use letters, numbers, hyphens and underscores, starting with a letter or number';
  }
  /* ⚠️ NOT `<something>-discord`, and this is not cosmetic.
   *
   * The board files an agent under its session name with `-discord` STRIPPED.
   * So an agent created as `angel-discord` would be filed under `angel` — the
   * name a real agent already holds — and the roster collision check, which
   * compares board names, would not see it: it looks for `angel-discord` in a
   * list where the live `angel-discord` session appears as `angel`.
   *
   * Two failures from one accepted name. The creation collides with a running
   * agent the check was written to protect, and even on an empty machine the
   * new agent is filed under a name that is not its session, so its identity,
   * its instructions and its writes all resolve to the wrong key and its card
   * is anonymous and uneditable.
   */
  if (/-discord$/.test(name)) {
    return 'names cannot end in -discord, which the board reads as an agent running somewhere else';
  }
  /* ⚠️ `kosmos-connect` is the sign-in flow's own tmux session
   * (engine/connect.js SESSION). connect.js pins every target with the `=`
   * exact-match prefix, so a NEAR-collision is already harmless there -- this
   * gate closes the EXACT collision, where an agent and the sign-in flow
   * would share one session name and the driver's send-keys, capture and
   * kill would all be aimed at a real agent's pane. Prefix-named agents
   * (kosmos-connect2) stay allowed; exactness is what matters. */
  if (name === require('./connect').SESSION) {
    return 'that name is reserved: it is the window Kosmos signs Claude in through';
  }
  return null;
}

/* ── paths, derived once ─────────────────────────────────────────────────── */

/**
 * Where an agent's files are.
 *
 * 🛑 A RECORDED FOLDER BEATS A DERIVED ONE, and that is the whole of what lets
 * Kosmos look after an agent it did not create. Until now this was
 * `<WORKERS_DIR>/<name>` and nothing else could be true, so an agent somebody
 * had already built somewhere on their Mac could be SEEN and never MANAGED.
 * Josh, 2026-08-22: "if people already have agents anywhere, we need to be able
 * to find them and bring them into the Kosmos platform."
 *
 * ⚠️ NOTHING IS COPIED, WHICH IS WHY THIS IS A FOLDER AND NOT AN IMPORT. Their
 * CLAUDE.md stays their CLAUDE.md, in their folder, and editing it in Kosmos
 * edits the file their own tooling reads. A copy would be a second file that
 * drifts from the first the moment either is touched, which is the defect this
 * codebase pays for most often.
 *
 * 🔑 THE CONTAINMENT GUARD IS NOT WEAKENED BY THIS, IT IS NARROWED. Readers pass
 * a root to `workerfile.readWorkerFile` and it refuses anything outside it. They
 * used to pass the SHARED workers directory, so any agent's file could contain
 * any other agent's; they now pass THIS agent's folder. For an ordinary Kosmos
 * agent that is a strictly tighter root than before. Every other protection --
 * realpath, the symlinked parent, the fifo, the size cap -- is untouched.
 *
 * ⚠️ AND A RECORDED FOLDER IS VALIDATED, NEVER TRUSTED. The record is ours, but
 * "ours" is exactly what was assumed the last six times a reader walked out of
 * the root. It must be an absolute path to a real directory that is not itself a
 * link; anything else falls back to the derived folder, which is always safe.
 */
function agentDirRecorded(name) {
  let dir;
  try { dir = store.readProfile(name).dir; } catch { return null; }
  if (typeof dir !== 'string' || !dir || !path.isAbsolute(dir)) return null;
  let st;
  try { st = fs.lstatSync(dir); } catch { return null; }
  /* `lstat`, so a link is refused rather than followed: the escape this whole
     module family exists to prevent. */
  if (!st.isDirectory()) return null;
  return dir;
}

/**
 * 🛑 THE DERIVED PATH IS BUILT FROM A SANITISED NAME, AND THAT IS LOAD-BEARING
 * NOW IN A WAY IT WAS NOT BEFORE. Callers used to pass the SHARED workers root
 * to `workerfile.readWorkerFile`, so a name like `../victim` produced a path
 * outside it and the containment check caught it. Readers now pass THIS AGENT'S
 * folder as the root -- which is what lets a connected agent be read at all --
 * and a file is always inside its own folder, so that check can no longer catch
 * an escaping name. Containment moved; it did not disappear. It is here.
 *
 * ⚠️ MEASURED, NOT REASONED: the first version of this joined the raw name and
 * `instructions.test.js`'s escape fixture went red immediately --
 * `readIdentity('../victim')` served a name and role parsed out of a file
 * outside the root, which is the sixth defect in this module family arriving for
 * the seventh time. The test that caught it was written for exactly that.
 *
 * An unusable name has no folder at all rather than a guessed one.
 */
function workerDir(name) {
  const recorded = agentDirRecorded(name);
  if (recorded) return recorded;
  /* ⚠️ IT REFUSES A BAD NAME, IT DOES NOT REWRITE ONE. `store.safeKey` was the
     obvious sanitiser and it is wrong here: it LOWERCASES, and a worker folder's
     spelling is case-sensitive on purpose -- `remove.js` has two tests saying a
     case-variant must not report a live agent removed, and both went red. The
     question here is "may this name become a path", not "what would this name
     look like tidied", and the honest answer to a name that may not is no path
     at all. */
  /* ⚠️ AND IT IS A REFUSAL RULE, NOT THE CREATION RULE. Two sanitisers were
     wrong here before this one. `store.safeKey` LOWERCASES, and a worker
     folder's spelling is case-sensitive on purpose. An alphanumeric allow-list
     then refused `orch.main`, `has space`, `0` and `UPPER` -- and removal acts
     on names nobody chose, because the roster admits any tmux session running
     Claude, so refusing those breaks managing the agents somebody already has.
     Both were caught by tests written for exactly those cases.

     🔑 SO IT ASKS THE ONLY QUESTION THAT MATTERS: can this name build a path of
     its own. Separators and traversal are refused; everything else is somebody's
     agent, spelled the way they spelled it. Same shape as `instructions.registryKey`,
     which answers the same question for the same reason. */
  const raw = String(name == null ? '' : name);
  if (!nameUsable(raw)) return path.join(WORKERS_DIR, '\u0000-invalid');
  return path.join(WORKERS_DIR, raw);
}

/**
 * May this name become a path, a tmux session and a launchd label?
 *
 * 🔑 EXPORTED SO THERE IS ONE ANSWER. `workerDir` asks it to decide whether to
 * join, and `discover.connect` asks it before offering to bring a folder in --
 * two callers, one rule. A second copy is how the six escapes in this module
 * family happened, each one a reader with fewer guards than its sibling.
 */
function nameUsable(raw) {
  const s = String(raw == null ? '' : raw);
  if (!s || s === '.' || s === '..') return false;
  if (/[/\\\0]/.test(s) || s.includes('..')) return false;
  return true;
}

/** Does Kosmos already have a launch job for this name? */
function hasJob(name) {
  try { return fs.existsSync(plistPath(name)); } catch { return false; }
}
/**
 * #149/#150: "no launch file" as a PROVEN absence, never an unreadable one.
 * `!hasJob(name)` fails the wrong way for this question: existsSync swallows
 * EACCES and a broken directory into false, so the negation would stamp
 * "made before Kosmos recorded this", a provenance claim, on every agent the
 * moment LaunchAgents cannot be read. Only ENOENT is evidence of absence;
 * any other failure answers "we could not check", which is false here.
 */
function jobMissing(name) {
  try { fs.statSync(plistPath(name)); return false; } catch (e) {
    return Boolean(e && e.code === 'ENOENT');
  }
}
function instructionFile(name) { return path.join(workerDir(name), 'CLAUDE.md'); }
function logFile(name) { return path.join(workerDir(name), 'start.log'); }
function serviceLabel(name) { return `com.kosmos.agent.${name}`; }
function plistPath(name) { return path.join(AGENTS_DIR, `${serviceLabel(name)}.plist`); }

/**
 * The model an agent's launchd job will start it on, read back out of the job
 * this module wrote.
 *
 * ⚠️ THIS EXISTS BECAUSE THE PRODUCT WAS THROWING THE ANSWER AWAY. The model a
 * person picks at create time is written into `ProgramArguments` by `plistFor`
 * and was then never read again: the screen asked a CLAUDE TRANSCRIPT instead,
 * and that file does not exist until the agent has completed a session. So a
 * freshly created agent reported "Unknown Model" on a fact that was on disk
 * the whole time.
 *
 * ⚠️ IT DOES NOT FIX THE MEMORY RING, and an earlier version of this comment
 * implied it did. The context limit is looked up BY model, so the two blanks
 * share a cause — but with no transcript there is no numerator either, so
 * `context.percent` stays null whatever the model is. This closes one blank.
 * The other needs a reading that does not exist yet.
 *
 * ⚠️ IT READS OUR OWN FILE AND LIVES BESIDE `plistFor` FOR THAT REASON. The
 * argument order is the supervisor's contract ($5 log, $6 model); a reader that
 * knew that order from anywhere else would be a second definition of this
 * format, free to drift from the writer the first time an argument is added.
 * This module's own header names that habit as the source of its worst defects.
 *
 * ⚠️ THIS IS NOT THE SAME FACT AS THE RUNNING MODEL and must not be shown as
 * one. It is what the job WILL start on; a transcript says what an agent
 * actually ran as, and the two can disagree (a job edited by hand, a session
 * started some other way). The caller decides the tense. Nothing here outranks
 * a live reading.
 *
 * Returns the raw `--model` argument, or null when there is no job, when the
 * job carries no model argument (every agent created before the picker
 * existed), or when the file cannot be read. ⚠️ Null means WE DO NOT KNOW. It
 * never means "the default".
 */
function plannedModelArg(name) {
  /* ⚠️ THE ONLY CALLER THAT RECEIVES AN UNVALIDATED NAME. Every other use of
     `plistPath` is downstream of `NAME_RE`; this one is handed `a.sessionName`
     straight out of `tmux list-panes`, so the name is whatever a person called
     their session. `path.join(AGENTS_DIR, 'com.….' + name + '.plist')` with
     separators or `..` in it walks out of LaunchAgents and reads an arbitrary
     file. It is not reachable today only because tmux forbids `.` in session
     names — an invariant nothing in this repo states, tests, or controls, which
     is not a guarantee, it is a coincidence we would inherit. */
  if (!NAME_RE.test(String(name == null ? '' : name))) return null;
  let text;
  try {
    text = fs.readFileSync(plistPath(name), 'utf8');
  } catch {
    return null;
  }
  const block = text.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
  if (!block) return null;
  const args = [...block[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1]));
  // 0 bash, 1 supervisor, 2 name, 3 worker dir, 4 claude, 5 tmux, 6 log, 7 model.
  // Anything shorter is the five-argument job an agent without a model choice
  // gets, which is a real and permanent state rather than a malformed file.
  return args.length > 7 && args[7] ? args[7] : null;
}

/**
 * Everything a rewrite of an agent's launch file has to preserve.
 *
 * 🛑 THIS EXISTS BECAUSE `plistFor` REGENERATES THE WHOLE FILE. `setModel` read
 * the two binary paths out, passed them back in, and every other field came
 * from defaults -- which was correct while the model was the only settable
 * thing in it. The moment a SECOND settable field exists (the account), each
 * setter silently erases the other's, and the erasure is invisible: the file
 * still parses, the job still starts, and the agent quietly moves back to the
 * default account the next time somebody changes its model.
 *
 * 🔑 SO THE FIX IS ONE READER, NOT TWO CAREFUL CALLERS. A third settable field
 * added later joins this shape and both setters inherit it, rather than the
 * author of the third field having to find and patch two call sites. Tonight's
 * own lesson, twice over: a new sibling does not inherit the guard.
 */
function readJob(name) {
  if (!NAME_RE.test(String(name == null ? '' : name))) return null;
  let text;
  try { text = fs.readFileSync(plistPath(name), 'utf8'); } catch { return null; }
  const block = text.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
  const args = block ? [...block[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((x) => unxml(x[1])) : [];
  // 0 bash, 1 supervisor, 2 name, 3 worker dir, 4 runner-bin, 5 tmux,
  // 6 log, 7 model, 8 runner (#245; absent means claude).
  if (args.length < 7 || !args[4] || !args[5]) return null;
  /* ⚠️ Matched inside EnvironmentVariables only in the sense that it is the one
     place this key is ever written; the value is read back verbatim, and an
     absent key is `null` rather than the default path, so "unset" and "set to
     the default" stay distinguishable in the one direction that matters. */
  const cfg = text.match(/<key>CLAUDE_CONFIG_DIR<\/key>\s*<string>([\s\S]*?)<\/string>/)
    // A codex agent's account rides CODEX_HOME instead (#540); one field,
    // because to everything above the launch it is "the account's directory".
    || text.match(/<key>CODEX_HOME<\/key>\s*<string>([\s\S]*?)<\/string>/);
  return {
    claude: args[4],
    tmux: args[5],
    model: args.length > 7 && args[7] ? args[7] : null,
    configDir: cfg ? unxml(cfg[1]) : null,
    // Absent means claude, the same way it does in the supervisor: every
    // plist written before runners existed carries no ninth argument.
    runner: args.length > 8 && args[8] ? args[8] : 'claude',
  };
}

/**
 * Point an existing agent at a different Claude account.
 *
 * 🛑 IT REFUSES WHEN THE ACCOUNT'S HISTORY IS NOT THE SHARED ONE, and that
 * refusal is the feature rather than a safety rail around it. Transcripts live
 * under the config directory, so an agent moved to an account with its own tree
 * comes up with no memory and NOTHING ON SCREEN SAYS SO: it looks like a working
 * agent and behaves like a blank one. Josh's rule is the opposite of that --
 * *"her memory should follow her everywhere she goes"* -- so an account that
 * cannot keep the promise is not an account we will move anybody to.
 *
 * `accounts.share()` is the fix a caller offers instead of the move.
 */
function setAccount(name, dir) {
  const clean = cleanName(name);
  if (!NAME_RE.test(String(clean == null ? '' : clean))) {
    return { outcome: OUTCOME.REFUSED, because: 'that is not a name we can act on' };
  }
  const accounts = require('./accounts');
  const all = accounts.list();
  /* The empty string means "back to the default account", which is a real
     choice and not a missing value. */
  const wanted = dir === '' || dir == null ? null : String(dir);
  const acct = wanted === null ? all.find((a) => a.isDefault) : all.find((a) => a.dir === wanted);
  if (!acct) {
    return { outcome: OUTCOME.REFUSED, because: 'we do not know that account on this computer' };
  }
  if (!acct.memoryShared) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `${acct.email || 'that account'} keeps its own separate history, so `
        + `${clean} would arrive there with nothing it has ever done. Point that `
        + 'account at your agents\' history first.',
    };
  }

  const job = readJob(clean);
  if (!job) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `we could not read how ${clean} is started, so we have not changed it.`,
    };
  }
  if (job.runner === 'codex') {
    // Accounts here are Claude accounts (CLAUDE_CONFIG_DIR), which mean
    // nothing to codex; writing one anyway would claim an account change
    // that changes nothing (#245 v1).
    return { outcome: OUTCOME.REFUSED, because: `${clean} runs on OpenAI, on this computer's OpenAI sign-in, so there is no Claude account to change` };
  }
  try {
    fs.writeFileSync(plistPath(clean),
      plistFor(clean, job.claude, job.tmux, job.model, acct.isDefault ? null : acct.dir, job.runner), 'utf8');
  } catch {
    return { outcome: OUTCOME.REFUSED, because: `we could not write ${clean}'s startup file, so nothing changed.` };
  }
  return { outcome: OUTCOME.CREATED, because: null, account: acct };
}

/**
 * Point an existing agent at a different model.
 *
 * 🔑 NOT A NEW SUBSYSTEM, which is why it is twenty lines. The model is already
 * written into `ProgramArguments` by `plistFor`, and `plannedModelArg` already
 * parses it back out — a reader kept deliberately beside its writer. What was
 * missing was the ability to make a change take effect, and that is restart.
 *
 * 🛑 THE PLIST IS REWRITTEN AND THE JOB IS RE-BOOTSTRAPPED, not kickstarted.
 * launchd reads a job's ProgramArguments when the job is BOOTSTRAPPED; asking a
 * loaded job to run again re-runs it with the arguments launchd already holds.
 * So a rewrite plus a kickstart would edit a file and change nothing about what
 * actually starts — the same shape as a restart that lets the supervisor adopt
 * the old window. Reasoned from launchd's documented model rather than measured
 * here; the tests pin the CALLS, so if that reasoning is wrong the fix is a
 * different pair of commands and not a different design.
 *
 * ⚠️ AND THE WINDOW IS CLOSED FIRST, for the reason `remove.restart` exists to
 * state: `agent-supervisor.sh` adopts a session it finds rather than replacing
 * it. Leave the window up and the new job adopts an agent still running the old
 * model.
 *
 * 📌 REFUSES RATHER THAN GUESSING when the existing job cannot be read. Its
 * `claude` and `tmux` paths live in that file and are what the rewrite has to
 * preserve; inventing them would repoint an agent at binaries nobody chose.
 */
/**
 * Switch an agent between providers, with its memory (#246).
 *
 * 🔑 WHAT "WITH ITS MEMORY" MEANS, per the outline and Josh's rulings: the
 * agent keeps everything Kosmos owns -- its name, id (#170), face, role,
 * instructions, worker folder, commitments, projects -- and its past stays
 * READABLE, shared not copied, with no provenance recorded (Josh,
 * 2026-08-24: history is shared, "I don't care about identifying which
 * account a conversation came from"). What does NOT cross is the context
 * window, which does not survive a same-provider restart either, and the
 * provider-shaped choices: a Claude model pick and a Claude account mean
 * nothing to codex, so the switch DROPS them rather than smuggling them,
 * and says so in its result so the route can say so in words.
 *
 * The mechanism is a plist rewrite through the one writer (`plistFor`) and
 * nothing else: no record is copied, moved, or stamped, because nothing
 * about the agent's memory lives in the launch file.
 */
function setProvider(name, provider, opts) {
  const clean = cleanName(name);
  if (!NAME_RE.test(String(clean == null ? '' : clean))) {
    return { outcome: OUTCOME.REFUSED, because: 'that is not a name we can act on' };
  }
  if (provider !== 'anthropic' && provider !== 'openai') {
    return { outcome: OUTCOME.REFUSED, because: 'pick a provider from the list' };
  }
  const job = readJob(clean);
  if (!job) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `${clean} was not started by Kosmos, so we cannot change what it runs on.`,
    };
  }
  const runner = provider === 'openai' ? 'codex' : 'claude';
  if (job.runner === runner) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `${clean} already runs on ${provider === 'openai' ? 'OpenAI' : 'Anthropic'}`,
    };
  }
  const { claudeBin, codexBin } = binPaths(opts);
  const runnerBin = runner === 'codex' ? codexBin : claudeBin;
  if (!DRY_RUN && !fs.existsSync(runnerBin)) {
    return {
      outcome: OUTCOME.REFUSED,
      because: runner === 'codex'
        ? 'we could not find the OpenAI runner on this computer, so nothing was changed'
        : 'we could not find Claude on this computer, so nothing was changed',
    };
  }
  if (runner === 'codex' && !DRY_RUN) {
    try { trustCodexFolder(workerDir(clean)); }
    catch {
      return { outcome: OUTCOME.REFUSED, because: 'we could not let the OpenAI runner work in its folder, so nothing was changed' };
    }
  }
  /* ⚠️ `job.tmux` is kept (the recorded path is the working one); the model
     and the account are NOT, in either direction: they are provider-shaped
     choices, and carrying one across would hand the new runner a value it
     has never heard of, silently, at its next start. */
  try {
    fs.writeFileSync(plistPath(clean), plistFor(clean, runnerBin, job.tmux, null, null, runner), 'utf8');
  } catch {
    return { outcome: OUTCOME.REFUSED, because: `we could not write ${clean}'s startup file, so nothing changed.` };
  }
  try { store.writeProfile(clean, { provider }); }
  catch { /* the plist is the launch truth; the profile record catches up on the next write */ }
  return {
    outcome: OUTCOME.CREATED,
    because: null,
    provider,
    dropped: {
      model: job.model || null,
      account: Boolean(job.configDir),
    },
  };
}

function setModel(name, modelKey) {
  const clean = cleanName(name);
  if (!NAME_RE.test(String(clean == null ? '' : clean))) {
    return { outcome: OUTCOME.REFUSED, because: 'that is not a name we can act on' };
  }
  const m = MODELS.find((x) => x.key === String(modelKey));
  if (!m) return { outcome: OUTCOME.REFUSED, because: 'pick a model from the list' };

  /* ⚠️ THROUGH `readJob`, so this rewrite carries the agent's ACCOUNT forward.
     Reading the two binary paths by hand was correct while the model was the
     only settable field; it is now the shape that silently moves an agent back
     to the default account every time somebody changes its model. */
  const job = readJob(clean);
  if (!job) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `${clean} was not started by Kosmos, so we cannot change what it runs on.`,
    };
  }
  if (job.runner === 'codex') {
    // The catalogue this function validates against is Claude's (#245 v1);
    // writing one of its args into a codex launch would hand codex a model
    // name it has never heard of, at its next restart, silently.
    return { outcome: OUTCOME.REFUSED, because: `${clean} runs on OpenAI, which picks its own model for now` };
  }

  try {
    fs.writeFileSync(plistPath(clean), plistFor(clean, job.claude, job.tmux, m.arg, job.configDir, job.runner), 'utf8');
  } catch {
    return { outcome: OUTCOME.REFUSED, because: `we could not write ${clean}'s startup file, so nothing changed.` };
  }
  return { outcome: OUTCOME.CREATED, because: null, model: m };
}

/**
 * Where the ONE supervisor lives, and how it gets there.
 *
 * ⚠️ It used to be GENERATED PER AGENT: each got its own 151-line copy under
 * its own folder. Every defect in it therefore shipped as many times as there
 * were agents, and every fix reached only the agents created afterwards — the
 * ones already on the machine kept their copy of the bug forever. It also could
 * not be reviewed once; it was reviewed per generation, which is how six
 * separate defects got into it in a single afternoon.
 *
 * ⚠️ INSTALLED, not referenced in place. The job could have pointed at
 * `bin/agent-supervisor.sh` inside this checkout, which is one fewer moving
 * part — but then moving or deleting the repository breaks every agent on the
 * machine at their next login, silently, long after whoever moved it has
 * forgotten. So it is copied to a stable location outside the checkout, and
 * refreshed on every creation so a change reaches the agents that already
 * exist too.
 */
function supervisorSource() {
  return path.join(__dirname, '..', 'bin', 'agent-supervisor.sh');
}

function supervisorPath() {
  return path.join(SUPPORT_DIR, 'bin', 'agent-supervisor.sh');
}

/* The codex notify bridge (#245): installed beside the supervisor, by the
   same refresh, for the same reason — one copy, every agent, every fix
   reaching agents made long ago at their next start. */
/** The one CODEX_HOME resolution, shared by the trust write and the
    connected-check so the two cannot look in different homes. */
function codexHomeDir() {
  return process.env.AGENT_WORKFORCE_CODEX_HOME
    || path.join(process.env.AGENT_WORKFORCE_HOME || os.homedir(), '.codex');
}

/**
 * Trust an agent's folder for the codex runner, the way the Yes button on
 * codex's own trust dialog would. MEASURED (#245): the bypass flag does
 * not skip the dialog; only this config entry does. Append-only, once,
 * into the same CODEX_HOME codexsession.js reads. Shared by creation and
 * the provider switch, one definition.
 */
function trustCodexFolder(dir, home) {
  // The account's own home when the agent runs on one (#540): codex reads
  // config.toml from CODEX_HOME, so the trust must be written where the
  // agent will look, not where the default account keeps its list.
  const codexHome = home || codexHomeDir();
  const cfg = path.join(codexHome, 'config.toml');
  let text = '';
  try { text = fs.readFileSync(cfg, 'utf8'); } catch { /* first entry ever */ }
  const key = `[projects."${dir}"]`;
  if (text.includes(key)) return;
  fs.mkdirSync(codexHome, { recursive: true });
  fs.appendFileSync(cfg, `${text && !text.endsWith('\n') ? '\n' : ''}${key}\ntrust_level = "trusted"\n`);
}

function bridgeSource() {
  return path.join(__dirname, '..', 'bin', 'codex-report-bridge.js');
}

function bridgePath() {
  return path.join(SUPPORT_DIR, 'bin', 'codex-report-bridge.js');
}

/**
 * Put the current supervisor where the jobs point, and answer whether it is
 * there.
 *
 * ⚠️ Returns false rather than throwing, and the caller refuses the creation on
 * a false. An agent whose job points at a script that is not there is the
 * respawn-loop state: `bash` exits at once and `KeepAlive` retries every thirty
 * seconds for as long as the machine is on.
 */
function installSupervisor() {
  /**
   * ⚠️ Answers WHY it failed, not just that it did.
   *
   * Every failure collapsed into one boolean, and the caller then told the
   * operator "trying again will not help until it is fixed". For a full disk,
   * or a support directory momentarily unwritable, that sentence is false in
   * exactly the case that produced it — and it is the sentence that stops them
   * retrying. A missing source file is genuinely permanent; nothing else here
   * is.
   */
  try {
    const dest = supervisorPath();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    /**
     * ⚠️ WRITE BESIDE IT AND RENAME, never copy over it.
     *
     * `copyFileSync` truncates and rewrites the destination in place, same
     * inode — and every live agent's supervisor is a `bash` process reading
     * that exact file. Bash reads a script by file offset as it goes, so
     * rewriting it underneath a running instance can make it execute whatever
     * now sits at that offset, or fall out of its supervision loop and hand the
     * agent back to `KeepAlive`.
     *
     * This branch makes that the NORMAL case rather than an edge one: the
     * refresh exists precisely so a change lands while other agents are
     * running. `rename` is atomic within a filesystem and gives the new file a
     * new inode, so every running instance keeps reading the one it started
     * with and picks the new one up at its next start — which is exactly the
     * update model this change is for.
     */
    // ⚠️ Per-process, because a fixed name lets two installs interleave into one
    // inode (`copyFileSync` opens with O_TRUNC) and rename a truncated script
    // into place for every agent on the machine.
    const staging = `${dest}.${process.pid}.new`;
    fs.copyFileSync(supervisorSource(), staging);
    fs.chmodSync(staging, 0o755);
    fs.renameSync(staging, dest);
    // The codex notify bridge rides the same refresh, same staging-rename
    // discipline, same reason (#245). It is read per event rather than held
    // open like the supervisor, but the interleaved-truncation hazard the
    // pattern exists for is identical.
    const bridgeDest = bridgePath();
    const bridgeStaging = `${bridgeDest}.${process.pid}.new`;
    fs.copyFileSync(bridgeSource(), bridgeStaging);
    fs.chmodSync(bridgeStaging, 0o755);
    fs.renameSync(bridgeStaging, bridgeDest);
    return { ok: true };
  } catch (err) {
    // Leave nothing half-written beside the real one.
    try { fs.rmSync(`${supervisorPath()}.${process.pid}.new`, { force: true }); } catch { /* best effort */ }
    try { fs.rmSync(`${bridgePath()}.${process.pid}.new`, { force: true }); } catch { /* best effort */ }
    // ⚠️ NAME THE FILE. Two files ride this step; when one is absent the
    // sentence must say WHICH, or a person goes looking for a file that is
    // present (#731: the bridge was missing from the served bundle and the
    // refusal blamed the supervisor, which had shipped).
    const absent = [supervisorSource(), bridgeSource()].filter((f) => !fs.existsSync(f)).map((f) => path.basename(f));
    return {
      ok: false,
      missing: Boolean(err && err.code === 'ENOENT' && absent.length),
      missingFile: absent.length ? absent.join(' and ') : null,
    };
  }
}

/**
 * The launchd job.
 *
 * ⚠️ `PATH` **and `LANG`**, and neither is optional. launchd's default PATH
 * omits Homebrew, so tmux is simply not found — the board then serves happily
 * with zero agents. And without a UTF-8 locale, tmux SANITISES its own format
 * output, replacing the tab separators with underscores, so every agent parses
 * as one garbage field. Both were found the hard way on this machine on
 * 2026-08-10; see issue #23.
 *
 * ⚠️ `HOME` too. A launchd job does not reliably carry one, and Claude keeps
 * everything it knows under `~/.claude` — without it the agent starts as
 * somebody with no history.
 *
 * ⚠️ And somewhere to SEE a failure. A job that cannot start writes its reason
 * to a log or to nowhere, and "to nowhere" is how the board spent fourteen
 * hours reporting zero agents this morning.
 */
// A path is a legal place for `&` or `<`, and either one emits a plist launchd
// silently refuses to load. The shell-shape check above rejects quotes and
// metacharacters; this is the XML half of the same idea.
function xml(value) {
  return String(value)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;');
}

/**
 * The inverse of `xml`, for reading our own job files back.
 *
 * ⚠️ `&amp;` LAST, and that ordering is the whole correctness of it. Unescaping
 * it first turns a literal `&amp;lt;` (which `xml` produced from the text
 * "&lt;") into `<`, inventing markup that was never in the value. Every other
 * entity has to be resolved before the ampersand that introduces it.
 */
function unxml(value) {
  return String(value)
    .split('&lt;').join('<')
    .split('&gt;').join('>')
    .split('&amp;').join('&');
}

/**
 * ⚠️ WHOSE BACKGROUND ITEM THIS IS — the `AssociatedBundleIdentifiers` key
 * below, explained here rather than in the plist because that string is a
 * template literal and a backtick inside it ends the string. (Measured: the
 * first version of this note went in as an XML comment and the module stopped
 * parsing.)
 *
 * macOS lists every launchd job in System Settings → General → Login Items, and
 * posts a notification the first time one appears. With nothing to attribute
 * the job to it names the executable — so the person is told `bash` was added
 * as a background item, and later that `bash` is running in the background on
 * their Mac. A security notice about an unidentified shell, minutes after they
 * installed something. The honest reading of that is alarming, and the thing it
 * describes is their own agent staying alive between logins.
 *
 * The key points the notice at the app that owns the job, so it says Kosmos.
 * The identifier is the one the installer registers the bundle under
 * (`install/setup.sh`), written here as a literal because this module has no
 * read of the installed bundle and inventing one would be a second definition
 * of it. A test asserts the two files still agree.
 *
 * ⚠️ EXISTING AGENTS KEEP THEIR PLISTS. Nothing on this branch rewrites a job
 * already on disk; the key arrives when an agent is next created or
 * reinstalled. An operator with a running fleet will keep seeing `bash` for
 * those, deliberately — rewriting live launchd jobs to improve a label is not a
 * trade this product makes.
 *
 * ⚠️ AND IT DOES NOT STOP THE NOTICE. It attributes it. The creation screen says
 * the notice is coming, in as many words, rather than letting somebody meet it
 * unexplained and switch their own agent off.
 */
/* Which board a launched agent belongs to (#577). The server reads PORT the
   same way (server.js: `Number(process.env.PORT || 16180)`), so this is the
   creating server's own port, not a guess. ⚠️ ONE OF FIVE COPIES OF THE
   PINNED 16180 LITERAL (#910: server.js, install/kosmos, install/setup.sh,
   install/pkg-scripts/postinstall, and native-app/main.swift's
   kosmosDefaultPort() -- of those, four compute the full per-account
   derivation, this file and server.js only ever consume/pin the literal);
   it exists so the child can be told nothing when the answer is the
   default every agent on every machine already assumes, and told exactly
   once when it is not. */
const DEFAULT_BOARD_PORT = 16180;
function boardPort() {
  return Number(process.env.PORT) || DEFAULT_BOARD_PORT;
}

function plistFor(name, claudeBin, tmuxBin, modelArg, configDir, runner) {
  const label = serviceLabel(name);
  /* KOSMOS_PORT (#577): a sandboxed server seals what IT writes with the
     AGENT_WORKFORCE_* variables, but nothing told the agent which board made
     it, so its `kosmos reply` and self-reports went to the live board on
     :16180. The job now carries the creating server's port, the supervisor
     hands it into the pane, and the CLI and the codex bridge already read it.
     ⚠️ ABSENT MEANS THE DEFAULT PORT, the same rule as CLAUDE_CONFIG_DIR
     below: stamping 16180 on every job would make every plist rewrite look
     like a change. */
  const port = boardPort();
  const portLine = port !== DEFAULT_BOARD_PORT ? `\n    <key>KOSMOS_PORT</key><string>${port}</string>` : '';
  // The optional sixth supervisor argument. Log ($5) must be present when
  // model ($6) is, and it always is below; an agent created without a model
  // choice writes the five-argument job every existing agent already runs.
  //
  // ⚠️ The RUNNER rides as the optional SEVENTH (#245), and position is the
  // contract: when a runner other than claude is written, the model line is
  // written too (empty when no model was chosen) so the runner can never
  // slide into the model's slot. A claude agent's plist is byte-for-byte
  // what it was before runners existed.
  const isCodex = runner === 'codex';
  const modelLine = (modelArg || isCodex) ? `\n    <string>${xml(modelArg || '')}</string>` : '';
  const runnerLine = isCodex ? `\n    <string>codex</string>` : '';
  /* 🔑 WHICH CLAUDE ACCOUNT THIS AGENT RUNS ON, and it is one environment
     variable because that is genuinely all it is: `CLAUDE_CONFIG_DIR` selects
     the config directory, and everything a Claude Code process knows lives in
     there.
     ⚠️ ABSENT MEANS THE DEFAULT ACCOUNT, deliberately, rather than writing
     `~/.claude` explicitly. Every agent on every machine today has no such key,
     so an absent key has to keep meaning what it already means -- and a
     rewrite that started stamping the default would make an unrelated edit
     look like an account change in every diff of these files. */
  const configKey = isCodex ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
  const configLine = configDir ? `\n    <key>${configKey}</key><string>${xml(configDir)}</string>` : '';
  /* 🔑 WHICH TMUX SERVER THE JOB'S SESSIONS LAND ON (#668). The board and the
     supervisor each resolve the session socket from their OWN environment, and
     nothing tied them together: a board running with TMUX_TMPDIR set made jobs
     whose supervisor used the default socket, so creation reported "started
     it" while the board said "Not running" forever, and a full-permission
     agent ran where nothing could see, reach, or stop it. The job now carries
     the creating server's TMUX_TMPDIR, so the supervisor's sessions land on
     the server the board actually reads.
     ⚠️ ABSENT MEANS THE DEFAULT SOCKET, same rule as KOSMOS_PORT above: every
     plist on every standard machine has no such key, and stamping the default
     would make every rewrite look like a change. $TMUX is NOT carried: it
     names one client's pane on one server and would be a lie inside a launchd
     job; TMUX_TMPDIR is the directory-level fact and the one this module's
     own reader (status.js) resolves. */
  const tmuxSock = typeof process.env.TMUX_TMPDIR === 'string' ? process.env.TMUX_TMPDIR : '';
  const tmuxSockLine = tmuxSock ? `\n    <key>TMUX_TMPDIR</key><string>${xml(tmuxSock)}</string>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${xml(supervisorPath())}</string>
    <string>${xml(name)}</string>
    <string>${xml(workerDir(name))}</string>
    <string>${xml(claudeBin)}</string>
    <string>${xml(tmuxBin)}</string>
    <string>${xml(logFile(name))}</string>${modelLine}${runnerLine}
  </array>
  <key>WorkingDirectory</key><string>${xml(workerDir(name))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${xml(HOME)}</string>
    <key>PATH</key><string>${xml(`${path.dirname(claudeBin)}:${path.dirname(tmuxBin)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
    <key>LANG</key><string>en_US.UTF-8</string>${configLine}${portLine}${tmuxSockLine}
  </dict>
  <!-- Whose background item this is. See the note above plistFor. -->
  <key>AssociatedBundleIdentifiers</key>
  <array><string>com.chaoskosmos.kosmos</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${xml(logFile(name))}</string>
  <key>StandardErrorPath</key><string>${xml(logFile(name))}</string>
</dict>
</plist>
`;
}

/* ── the steps ───────────────────────────────────────────────────────────── */

/**
 * A path we will not use, whatever is at the end of it.
 *
 * ⚠️ EXPORTED FOR THE SAME REASON `binPaths` IS. Creation refuses these outright
 * and answers "we could not find Claude on this computer, so an agent made now
 * would never start" — so a first-run check that asked only whether the file
 * exists reported "Everything it needs to run is installed" for a path creation
 * was always going to reject two screens later. That is the same drift the
 * extraction below exists to end, one rule further along.
 */
function unusablePath(bin) {
  return /['"\n\r\\$`]/.test(String(bin));
}

/**
 * Where the two things an agent needs actually live on this computer.
 *
 * ⚠️ Overridable by environment, because these two defaults are ONE machine's
 * paths: an Intel Mac keeps Homebrew at `/usr/local`, and an npm-global Claude
 * is not in `~/.local/bin` at all. Without a way to say so, this product
 * simply cannot make an agent on those machines — it refuses, correctly but
 * uselessly. It is also what lets the route be tested without depending on
 * what happens to be installed on the machine running the suite.
 *
 * ⚠️ Environment and arguments only. NOT the request body: honouring a
 * caller-supplied path would let anything that can reach this server name an
 * executable to be launched under launchd on every reboot, which is a far
 * worse hole than the one creation already is.
 *
 * ⚠️ EXPORTED so that the first-run check which tells somebody "everything it
 * needs is installed" is answering the same question creation will ask. Those
 * were two lines in two files for about an hour, which is long enough: a check
 * that looks somewhere else than the code it is vouching for can pass while
 * creation refuses, on the screen whose entire job is telling them it will
 * work. One definition, or the two drift.
 */
function binPaths(opts) {
  return {
    // Claude's resolution moved to engine/runners.js (#979, same
    // consolidation the codex line below got in #987): ONE priority list
    // (env override authoritative, then the vendor's canonical path)
    // shared with the runner-install machinery, so the two can never
    // disagree about where Claude lives.
    claudeBin: (opts && opts.claudeBin)
      || require('./runners').resolveBin('claude').bin,
    tmuxBin: (opts && opts.tmuxBin)
      || process.env.AGENT_WORKFORCE_TMUX_BIN
      || '/opt/homebrew/bin/tmux',
    // The OpenAI runner (#245, resolution moved to engine/runners.js for
    // #979). ONE priority list -- env override, then the managed location
    // the runner installer stages into, then legacy Homebrew -- shared
    // with the server's add route, so a runner Kosmos itself installed is
    // immediately usable for agent creation, and the two callers can
    // never again disagree about where the runner lives.
    codexBin: (opts && opts.codexBin)
      || require('./runners').resolveBin('openai').bin,
  };
}

/**
 * Give an agent that already exists the launchd job it never got.
 *
 * 🛑 THIS EXISTS BECAUSE FIFTEEN OF JOSH'S SIXTEEN AGENTS HAD NO JOB. Measured
 * on his machine on 2026-08-22, after the first real reboot: sixteen folders in
 * `~/work/workers`, one plist, one session. An agent whose session is the only
 * thing holding it up is not installed, it is merely running — and nothing
 * anywhere said so, because a registered agent and an unregistered one draw the
 * same card. He found out by restarting.
 *
 * ⚠️ IT WRITES THE SAME FILE `createAgent` WRITES, THROUGH THE SAME `plistFor`,
 * and that is the point of it living here rather than in a repair module of its
 * own. A second writer of this format is the defect this file's header names as
 * its worst habit: it would drift from `plistFor` the first time an argument is
 * added, and the drift would only show up at somebody's next login.
 *
 * ⚠️ WHAT IT CANNOT RECOVER, said rather than papered over. The account and the
 * model live only in the plist, so an agent that never had one has no record of
 * either. The model is taken from what the agent LAST RAN AS when the caller
 * can read it, which is a live reading rather than a stored choice, and the
 * account falls back to the default. Both travel back in the result so the
 * caller can say so instead of implying we knew.
 *
 * ⚠️ IT NEVER OVERWRITES AN EXISTING JOB. A person who edited theirs by hand,
 * or an agent whose job is merely disabled (which is what `remove` does, and it
 * deletes nothing), must not have it silently rewritten from defaults we had to
 * guess at.
 */
/* ── the switched-off job (#310) ─────────────────────────────────────────
   macOS's Login Items shows every agent's background job with a switch, and
   the notice explaining it was removed on Josh's own ruling -- so a person
   who flips one off has silently stopped their agent, and the symptom is an
   agent that never comes back after a restart with nothing connecting the
   two. launchd records exactly this: a per-user override, readable without
   mutation. One probe for the whole fleet, launchctl print-disabled, parsed
   for our label prefix; fail-soft to an empty set, because "we could not
   look" must never dress an agent in "you switched it off". */
function disabledJobs() {
  try {
    const out = run('/bin/launchctl', ['print-disabled', `gui/${process.getuid()}`]);
    const text = String((out && out.stdout) || '');
    const names = new Set();
    for (const m of text.matchAll(/"com\.kosmos\.agent\.([^"]+)"\s*=>\s*(?:true|disabled)/g)) {
      names.add(m[1]);
    }
    return names;
  } catch { return new Set(); }
}

/* ── the job launchd says is running (#668) ──────────────────────────────
   The split this answers: the board sees sessions on ITS tmux server, launchd
   runs the job wherever the job's own environment points, and when the two
   disagree the board published "not running" about an agent whose supervisor
   was alive the whole time -- a confident negative manufactured from a socket
   assumption, the exact inversion status.js forbids. launchd knows which of
   our jobs hold a live process, readable without mutation: `launchctl list`
   prints one row per job, PID first, `-` when nothing runs (MEASURED on this
   fleet's Mac, tab-separated). One probe for the whole fleet, same shape as
   disabledJobs above; fail-soft to an empty set, because "we could not look"
   must never dress a stopped agent in "running unseen". */
function runningJobs() {
  try {
    const out = run('/bin/launchctl', ['list']);
    const text = String((out && out.stdout) || '');
    const names = new Set();
    for (const m of text.matchAll(/^(\d+)\t\S+\tcom\.kosmos\.agent\.(.+)$/gm)) {
      if (Number(m[1]) > 0) names.add(m[2]);
    }
    return names;
  } catch { return new Set(); }
}

function installJob(name, opts) {
  const clean = String(name == null ? '' : name);
  if (!NAME_RE.test(clean)) {
    return { ok: false, because: 'that is not a name this product can build a job from' };
  }
  if (fs.existsSync(plistPath(clean))) {
    return { ok: false, already: true, because: 'it already has one' };
  }
  if (!fs.existsSync(workerDir(clean))) {
    return { ok: false, because: 'there is no folder for it on this computer' };
  }
  const { claudeBin, tmuxBin } = binPaths(opts);
  if (unusablePath(claudeBin) || unusablePath(tmuxBin)) {
    return { ok: false, /* ⚠️ NEITHER BINARY IS NAMED, and `tmux` least of all (Mona Lisa). A person
       who installed Kosmos has no reason to have heard the word, and it cost a
       real diagnostic step this morning: Josh was sent `tmux ls` and got
       command not found, because Kosmos ships its own copy and never touches
       the machine's. Their action is identical either way. */
      because: 'we could not use the programs Kosmos runs agents with, so nothing was changed' };
  }
  if (!DRY_RUN && !fs.existsSync(claudeBin)) {
    return { ok: false, because: 'we could not find Claude on this computer, so a job made now would never start' };
  }
  const installed = DRY_RUN ? { ok: true } : installSupervisor();
  if (!installed.ok) {
    return { ok: false, because: installed.missingFile
      ? `a file this app needs to start agents (${installed.missingFile}) is missing from this installation, so the job would fail every time it ran`
      : 'the startup script could not be put in place, so the job would fail every time it ran' };
  }
  const modelArg = (opts && typeof opts.model === 'string' && opts.model.trim()) ? opts.model.trim() : null;
  const configDir = (opts && typeof opts.configDir === 'string' && opts.configDir) ? opts.configDir : null;
  try {
    if (!DRY_RUN) {
      fs.mkdirSync(AGENTS_DIR, { recursive: true });
      fs.writeFileSync(plistPath(clean), plistFor(clean, claudeBin, tmuxBin, modelArg, configDir), 'utf8');
    }
  } catch {
    return { ok: false, because: 'we could not write the job file' };
  }
  /* ⚠️ enable BEFORE bootstrap. `remove` sticks by writing a per-user `disable`
     override keyed on the LABEL, and that override outlives the plist — so
     bootstrapping into a standing disable succeeds and starts nothing, which
     would report a repaired agent that never comes up. The uninstaller
     documents the same ordering for the same reason. */
  let started = false;
  try {
    run('/bin/launchctl', ['enable', `gui/${process.getuid()}/${serviceLabel(clean)}`]);
  } catch { /* a name that was never disabled has nothing to enable */ }
  try {
    const r = run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath(clean)]);
    started = Boolean(r && r.ok !== false);
  } catch { started = false; }
  /* ⚠️ THE JOB STAYS EITHER WAY, and this is the one place that differs from
     creation's rollback. A failed bootstrap during creation leaves nothing a
     person owns; here the agent already exists, and the file on disk is what
     makes it come back at the NEXT login even if it could not be started now.
     Removing it would throw away the fix to keep the report tidy. */
  return {
    ok: true,
    started,
    model: modelArg,
    /* What we had to assume rather than read, for the caller to say out loud. */
    guessed: {
      model: modelArg ? null : 'we do not know which model it was set to run on, so it will start on the default',
      account: configDir ? null : 'it will run on your main Claude account',
    },
    because: started
      ? 'set up to start at every login, and started now'
      : 'set up to start at your next login, but we could not start it just now',
  };
}

/**
 * Make an agent, and report honestly about how far it got.
 *
 * Returns `{ outcome, because, steps }`. `steps` records each thing attempted
 * and whether it worked, because a half-made agent is a real state and the
 * operator has to be able to see which half.
 */
/* ── the birth record (#157) ─────────────────────────────────────────────
   One append-only line per creation ATTEMPT, refusals included: state (a
   folder, a plist, a profile) can be deleted by anything, and when it is,
   "was this agent ever created by Kosmos?" has no answer. An event log is
   the only thing that answers "did this happen" after the state is gone,
   which is the question Josh actually asked ("we would at least have a
   record of the number of agents"). Best-effort by design: a creation must
   never fail because its receipt could not be written, so the append is
   swallowed and the outcome still returned. */
function createdLogFile() { return path.join(SUPPORT_DIR, 'created.jsonl'); }
function recordBirth(entry) {
  try {
    fs.mkdirSync(SUPPORT_DIR, { recursive: true });
    fs.appendFileSync(createdLogFile(), JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* the record is a receipt, never a gate */ }
}
/* The record, read back: newest last, bad lines skipped rather than one
   torn write poisoning the whole answer. */
function createdLog() {
  let raw;
  try { raw = fs.readFileSync(createdLogFile(), 'utf8'); } catch { return []; }
  return raw.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter((e) => e && typeof e === 'object');
}

function createAgent(opts) {
  const out = createAgentInner(opts);
  /* The name as typed, because a refusal can be ABOUT the spelling; role and
     model as asked for, since a refused creation wrote no plist to read them
     back from. */
  recordBirth({
    at: new Date().toISOString(),
    name: String((opts && opts.name) || '').slice(0, 120),
    role: String((opts && opts.role) || '').slice(0, 120),
    model: String((opts && opts.model) || '').slice(0, 120),
    /* #245: the provider as asked for, same posture as role and model. */
    provider: String((opts && opts.provider) || 'anthropic').slice(0, 40),
    outcome: (out && out.outcome) || 'unknown',
    because: (out && out.because) ? String(out.because).slice(0, 300) : null,
    /* #170: the same id the profile carries, on the creation line, so "was
       this agent ever created" and "which agent was it" are one lookup even
       after every file is wiped. Read back rather than passed through: the
       profile write is the single mint point, and a second copy of the mint
       here is a second place for the two to disagree. Null for refusals
       (nothing was made) and under DRY_RUN (nothing was written). */
    id: (out && out.outcome === OUTCOME.CREATED && !DRY_RUN)
      ? (store.readProfile(out.name).id || null)
      : null,
  });
  return out;
}
function createAgentInner(opts) {
  /**
   * ⚠️ TWO NAMES FROM HERE DOWN, and which one goes where is the whole of 6b.
   *
   *   `name`  — the slug. Everything the machine touches: the folder, the tmux
   *             session, the launchd label, every key in the store.
   *   `shown` — what the person typed, capitals and all. The instruction file
   *             (which is what the board reads a display name back out of), the
   *             stored profile, and every sentence this function returns.
   *
   * The rule is the one `engine/projects.js` states for members and this repo
   * has already shipped a defect against: **act on the machine name, speak the
   * display name.**
   */
  const shown = cleanName(opts && opts.name);
  const name = slugFor(opts && opts.name);
  const roleKey = String((opts && opts.role) || '').trim();
  const wantAccountDir = opts && opts.account;
  /* Trimmed and self-refused at the door, the same posture as `who` on a task:
     a value that cannot be right is refused rather than quietly dropped, and
     an agent reporting to itself is the smallest possible cycle and the one a
     person can actually create by picking their own name from a list. */
  const wantReportsTo = (opts && typeof opts.reportsTo === 'string' && opts.reportsTo.trim())
    ? opts.reportsTo.trim().slice(0, 80) : null;
  const { claudeBin, tmuxBin, codexBin } = binPaths(opts);

  /**
   * Which provider this agent runs on (#245). 'anthropic' is the default
   * and the word every existing caller means by omission; 'openai' launches
   * the codex runner. RECORDED, never inferred: the choice lands in the
   * plist (the runner argument), the profile, and the birth record, so no
   * screen ever has to guess a runner from what happens to be in a pane.
   */
  const provider = (opts && opts.provider !== undefined && opts.provider !== null && String(opts.provider) !== '')
    ? String(opts.provider) : 'anthropic';
  const runner = provider === 'openai' ? 'codex' : 'claude';
  const runnerBin = runner === 'codex' ? codexBin : claudeBin;

  const steps = [];
  if (provider !== 'anthropic' && provider !== 'openai') {
    return { outcome: OUTCOME.REFUSED, because: 'pick a provider from the list', steps };
  }
  if (provider === 'openai') {
    /* v1 boundaries, refused in words rather than silently ignored: the
       model is codex's own default (its catalogue is not ours to mirror
       yet), and the account is this computer's OpenAI sign-in (Claude
       account selection is CLAUDE_CONFIG_DIR, which means nothing to
       codex). Both lift when phase 2 gives them real mechanisms. */
    if (opts && opts.model !== undefined) {
      return { outcome: OUTCOME.REFUSED, because: 'an OpenAI agent picks its own model for now, so leave the model unchosen', steps };
    }
    if (!DRY_RUN && !fs.existsSync(codexBin)) {
      return { outcome: OUTCOME.REFUSED, because: 'we could not find the OpenAI runner on this computer, so an agent made now would never start', steps };
    }
  }
  const problem = nameProblem(shown);
  if (problem) return { outcome: OUTCOME.REFUSED, because: problem, steps };

  const role = roles.byKey(roleKey);
  if (!role) {
    return { outcome: OUTCOME.REFUSED, because: 'pick what this agent is for', steps };
  }
  /**
   * ⚠️ A NAME ON THE REMOVED LIST IS TAKEN, and refusing it here is what stops
   * a new agent being born invisible.
   *
   * The board hides removed agents by name. Nothing prunes that list, and
   * `remove` deletes nothing — so a name removed earlier could be created
   * again, succeed, and then be filtered off the board on every poll: no card,
   * no error, and nothing on screen to explain where it went. The person who
   * hit this would have no way at all to work out what happened.
   *
   * Restoring is almost always what they actually want, so the refusal says so
   * rather than sending them to a manual recipe.
   *
   * ⚠️ Required LAZILY, and it has to stay that way: `remove` requires THIS
   * module at its top, so a top-level require here closes the cycle. By the
   * time an agent is being created both are loaded, so this resolves from
   * cache. (An `eslint-disable-next-line global-require` used to sit on the
   * line below, implying a linter enforced something here. There is no eslint
   * config, no eslint dependency and no lint script in this repo, so it was
   * decoration that read as a rule.)
   */
  /**
   * ⚠️ The pane-2 options, EVERY one validated before ANY write (the same
   * whole-or-not-at-all rule the projects PUT converged on): a refusal
   * after the folder exists is a rollback nobody should need for a typo.
   *
   * - `label` overrides the role's display label (the board's "what they
   *   do" line). Words or refused; the profile write itself happens only
   *   past the point of no rollback, beside displayName, and is non-gating
   *   for the same reason.
   * - `instructions` replaces the role template wholesale. Same tolerance
   *   as the edit path a person reaches afterwards: their words, not ours,
   *   but never empty -- an empty boot file is an agent with no idea what
   *   it is, which the blank-box rule exists to prevent.
   * - `model` must be one of MODELS; the arg it maps to is what the job
   *   runs with forever, so an unknown key is refused rather than guessed.
   */
  const wantLabel = opts && opts.label !== undefined ? opts.label : undefined;
  const wantInstructions = opts && opts.instructions !== undefined ? opts.instructions : undefined;
  // Project ids the route already validated; used once, to compose the
  // projects block into the first write (#323). Never read from here again.
  const wantProjects = opts && Array.isArray(opts.projects)
    ? opts.projects.map((p) => String(p || '').trim()).filter(Boolean) : [];
  const wantModelKey = opts && opts.model !== undefined ? opts.model : undefined;
  /**
   * ⚠️ `own` has no label of its own ON PURPOSE (the catalogue's rule): the
   * board prints this string under the agent's name, and defaulting it to
   * "Custom" gives somebody an agent whose job is "Custom". An empty label
   * here is a gating question for the person, never a default.
   */
  if (roleKey === 'own' && (wantLabel === undefined || !String(wantLabel).trim())) {
    return { outcome: OUTCOME.REFUSED, because: 'say what this agent does in the role label, in your own words', steps };
  }
  if (wantLabel !== undefined
      && (typeof wantLabel !== 'string' || !wantLabel.trim() || wantLabel.trim().length > 80)) {
    return { outcome: OUTCOME.REFUSED, because: 'a role label has to be words (80 characters or fewer)', steps };
  }
  if (wantInstructions !== undefined
      && (typeof wantInstructions !== 'string' || !wantInstructions.trim())) {
    return { outcome: OUTCOME.REFUSED, because: 'instructions have to be words, or leave them out and the role\'s own are used', steps };
  }
  // The SAME bounds the instructions module enforces on every later edit
  // (its MIN_CHARS and MAX_BYTES), carried here so create cannot mint a
  // boot file the app's own editor would refuse to read back: an oversize
  // file makes readWorkerFile refuse forever (anonymous card, unreadable
  // editor, could_not on every project tell), and a two-character one
  // would be refused at the first save.
  if (wantInstructions !== undefined) {
    const instructions = require('./instructions');
    if (wantInstructions.trim().length < instructions.MIN_CHARS) {
      return { outcome: OUTCOME.REFUSED, because: `instructions cannot be this short, say what this agent is for in at least ${instructions.MIN_CHARS} characters`, steps };
    }
    // Measured on the NORMALIZED text (the write step appends a trailing
    // newline when the input lacks one), or an input of exactly MAX_BYTES
    // would validate and then land on disk one byte over the read limit.
    if (Buffer.byteLength(wantInstructions.replace(/\n?$/, '\n'), 'utf8') > instructions.MAX_BYTES) {
      return { outcome: OUTCOME.REFUSED, because: `these instructions are too long, trim them to under ${Math.floor(instructions.MAX_BYTES / 1024)}KB`, steps };
    }
  }
  let modelArg = null;
  if (wantModelKey !== undefined) {
    const m = MODELS.find((x) => x.key === String(wantModelKey));
    if (!m) return { outcome: OUTCOME.REFUSED, because: 'pick a model from the list', steps };
    modelArg = m.arg;
  }

  /**
   * Which Claude account the new agent runs on.
   *
   * 🔑 THE SAME THREE REFUSALS AS `setAccount`, AND FOR ONE OF THEM A BETTER
   * REASON. Moving an EXISTING agent to an account with its own history costs
   * it everything it has done; creating a NEW one there costs nothing today and
   * costs everything the first time somebody moves it back, because its life so
   * far would be in a tree nothing else reads. Kosmos would have quietly built
   * a second history for one agent. Refusing here keeps every agent's past in
   * one place from the first minute rather than from whenever somebody
   * notices.
   *
   * ⚠️ `undefined` is the default account and writes NO key, which is what
   * every agent on every machine already has. Absent has to keep meaning what
   * it already means.
   */
  if (wantReportsTo && wantReportsTo === name) {
    return { outcome: OUTCOME.REFUSED, because: 'an agent cannot report to itself', steps };
  }

  let configDir = null;
  if (provider === 'openai' && wantAccountDir !== undefined && wantAccountDir !== null && String(wantAccountDir) !== '') {
    /* An OpenAI account (#540): a directory with codex's own sign-in in it.
       Memory-sharing has no ruling for codex yet, so no memoryShared gate
       here; the row's absence is the only refusal. */
    const acct = require('./openaiaccounts').list().find((a) => a.dir === String(wantAccountDir));
    if (!acct) return { outcome: OUTCOME.REFUSED, because: 'we do not know that OpenAI account on this computer', steps };
    configDir = acct.isDefault ? null : acct.dir;
  } else if (wantAccountDir !== undefined && wantAccountDir !== null && String(wantAccountDir) !== '') {
    const accountsMod = require('./accounts');
    const acct = accountsMod.list().find((a) => a.dir === String(wantAccountDir));
    if (!acct) return { outcome: OUTCOME.REFUSED, because: 'we do not know that account on this computer', steps };
    if (!acct.memoryShared) {
      return {
        outcome: OUTCOME.REFUSED,
        steps,
        because: `${acct.email || 'that account'} keeps its own separate history, so `
          + `everything ${shown} does would live somewhere nothing else reads. `
          + 'Point that account at your agents\' history first.',
      };
    }
    configDir = acct.isDefault ? null : acct.dir;
  }

  const removedList = require('./remove');
  if (removedList.isRemoved(name)) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `${shown} is on your removed list. Put that one back from "Show removed agents" at the bottom of the Agents tab, delete what was left of it there to free the name, or pick a different name.`,
      steps,
    };
  }

  /* ⚠️ WHAT IS ALREADY HERE, and the refusal has to name the RIGHT half.
   *
   * Three states, not one: a folder can outlive its job, and a job can outlive
   * its folder. (This used to say "because removing an agent is still manual
   * and the README says so". Remove exists now -- but it deliberately deletes
   * NOTHING, so the halves can still come apart, and every reason below still
   * holds.) Checking only the folder meant a leftover launchd job was
   * discovered as a FAILED BOOTSTRAP -- "we set it up but could not start it",
   * which is true and about the wrong thing, on the one screen built to tell
   * somebody which half failed. Checking only the job inverted it.
   *
   * The half-made case matters most in practice: a PARTIAL leaves both on disk,
   * the screen offers Start over, and the person needs to be told what is in
   * the way rather than that an agent they can see is not running exists.
   */
  const hasFolder = fs.existsSync(workerDir(name));
  const hasJob = fs.existsSync(plistPath(name));
  if (hasFolder && hasJob) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `there is already an agent called ${shown}. If it never came up, it is half made rather than missing. Pick another name, or open it under Agents and delete what was left of it, which frees the name.`,
      steps,
    };
  }
  if (hasJob) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `something called ${shown} is still set to start on this computer, though there is no folder for it. Pick another name, or open it under Agents and delete what was left of it, which frees the name.`,
      steps,
    };
  }
  if (hasFolder) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `there is already a folder for an agent called ${shown}. If you removed that agent, its folder was left behind. Pick another name, or delete what was left of it, from its page under Agents or from "Show removed agents" at the bottom of the Agents tab, which frees the name.`,
      steps,
    };
  }

  /* ⚠️ AND A SERVICE THAT IS LOADED WITH NO PLIST ON DISK, which is what the
   * README's own removal recipe produces if the `rm` runs without the
   * `bootout`, or before it.
   *
   * Without this check the creation proceeds, `bootstrap` fails with "service
   * already bootstrapped", the rollback removes the plist it just wrote, and
   * the person is told "we have taken it back off your computer. You can try
   * that name again." Retrying fails identically, forever, against a message
   * promising the opposite -- while the orphaned job keeps respawning against a
   * startup script the rollback has just deleted.
   *
   * ⚠️ We REFUSE rather than booting the stray service out ourselves. It is a
   * job this creation did not install, running something we have not looked at,
   * and unloading somebody else's service to free up a name is exactly the
   * "act on something we have not tied to us" move the rest of this codebase
   * refuses to make.
   */
  //
  // ⚠️ Loaded means launchctl actually DESCRIBED the service, not merely that
  // the command came back. `print` exits non-zero and throws when there is no
  // such service, and prints a block describing it when there is — so the
  // presence of output is the signal, and an empty answer is read as "no". That
  // also keeps the seam honest: a recorder that reports every command as
  // succeeding does not thereby claim every name is taken.
  let loaded = false;
  try {
    const r = run('/bin/launchctl', ['print', `gui/${process.getuid()}/${serviceLabel(name)}`]);
    loaded = Boolean(r && r.ok !== false && String(r.stdout || '').trim());
  } catch {
    loaded = false;
  }
  if (loaded) {
    return {
      outcome: OUTCOME.REFUSED,
      because: `something called ${shown} is already set to start on this computer, though there is nothing else left of it. Pick another name, or open it under Agents and delete what was left of it, which frees the name.`,
      steps,
    };
  }

  /* ⚠️ AND a name nobody has a FOLDER for can still be taken, because the board
   * identifies an agent by its session name with `-discord` STRIPPED. So
   * creating `casey` beside a running `casey-discord` makes two sessions with
   * one name — the exact collision `onePanePerSession` exists to survive, which
   * we would be manufacturing rather than tolerating. Measured on this machine:
   * the creation screen watched for a session called `casey`, found the fleet's
   * existing one, and reported "casey is running" over a creation that had done
   * nothing at all. The screen's verification cannot tell the agent it just made
   * from one that was already there, so the name has to be free BEFORE we start.
   *
   * ⚠️ And it FAILS CLOSED. If tmux cannot be asked who is already running, we
   * do not know the name is free, and "we could not check" is not "it is
   * available" — the whole rule this codebase runs on. Creating blind is what
   * produces the collision, so being unable to check has to stop the creation
   * rather than wave it through. The board's own gates refuse the same way when
   * tmux is unreachable.
   */
  let roster;
  try {
    roster = status.paneRoster();
  } catch {
    return {
      outcome: OUTCOME.REFUSED,
      because: 'we could not check which agents are already running, so we will not risk making a second one with the same name',
      steps,
    };
  }
  const wantedKey = (() => { try { return store.safeKey(name); } catch { return null; } })();
  const clash = roster.find((p) => {
    if (p.sessionName === name) return true;
    if (!wantedKey) return false;
    try { return store.safeKey(p.sessionName) === wantedKey; } catch { return false; }
  });
  if (clash) {
    // ⚠️ Names the SESSION rather than asserting an agent exists. `paneRoster`
    // covers every pane on the machine, so a person with a shell session called
    // `notes` was told there was an agent called `notes`, which there is not --
    // the same "refusal that names the wrong thing" the length rule was split
    // out to avoid.
    // Names the REAL tmux session, not the board name: the board name is the
    // stripped form, so for `my.bot-discord` it would have said "this computer
    // is running my.bot", which is not a session anybody can find.
    const running = clash.session || clash.sessionName;
    const also = running === name ? '' : ` (this computer is running ${running}, which the board files under the same name)`;
    return {
      outcome: OUTCOME.REFUSED,
      because: `something called ${shown} is already running on this computer${also}`,
      steps,
    };
  }

  /**
   * ⚠️ The two programs this agent is made of have to EXIST.
   *
   * Both defaults are this machine's paths. On a Mac with an npm-global Claude,
   * or an Intel Mac where Homebrew lives at `/usr/local`, creation reported
   * CREATED, the screen waited thirty seconds and then said it did not know
   * why, and launchd was left respawning an instantly-failing job every thirty
   * seconds for as long as the machine was on. Refusing up front costs two
   * lines and names the actual problem.
   *
   * ⚠️ And they are checked for SHAPE, not only presence. They are NOT
   * interpolated into shell text any more — they reach the plist as separate
   * XML elements and the supervisor as argv — so the original reason for this
   * check has gone. It is kept because a path carrying a quote or a newline is
   * a path nothing good comes of passing anywhere, and because the relevant
   * guard for the plist is now the XML escaping beside it. Said plainly so the
   * next reader does not have to re-derive which one is load-bearing.
   */
  // ⚠️ The worker folder is checked with them. It is operator-controlled rather
  // than request-controlled (it comes from AGENT_WORKFORCE_WORKERS), and it no
  // longer reaches any generated shell text -- it is passed to the supervisor as
  // one argument. Kept for the same reason as the binaries above: a path
  // carrying a quote or a newline is one nothing good comes of passing
  // anywhere, and the guard that matters for the plist is the XML escaping.
  /**
   * ⚠️ THE RUNNER CHECKED IS THE ONE THIS AGENT WILL RUN (#548). This loop
   * checked Claude for every creation, which was right when Claude was the
   * only engine and became false with #530: an OpenAI-only Mac -- exactly
   * the fresh machine Josh installed on -- was refused an OPENAI agent for
   * Claude's absence. Wrong by supersession, the same expiry as the
   * installer's gate, found by probing the engine rather than reading it.
   *
   * And when Claude IS the missing one, the refusal now carries the remedy
   * and, ONLY WHEN IT IS REAL ON THIS MACHINE, the other path (Mona Lisa's
   * rule, the pill-door law applied to a sentence): "or create this agent
   * on OpenAI instead" is said only with the codex runner present AND an
   * OpenAI sign-in on the machine, because an alternative that dead-ends
   * is a dead click in words. Which condition suppressed it rides the
   * engine-side `alternative`, never the person's sentence.
   */
  const runnerLabel = runner === 'codex' ? 'the OpenAI runner' : 'Claude Code';
  for (const [what, bin] of [[runnerLabel, runnerBin], ['tmux', tmuxBin], ['the agents folder', workerDir(name)]]) {
    if (unusablePath(bin)) {
      return { outcome: OUTCOME.REFUSED, because: `we cannot use that path for ${what}`, steps };
    }
    if (what === 'the agents folder') continue;
    if (!fs.existsSync(bin)) {
      if (what === runnerLabel && runner === 'claude') {
        const codexPresent = fs.existsSync(codexBin);
        const codexConnected = codexPresent && fs.existsSync(path.join(codexHomeDir(), 'auth.json'));
        return {
          outcome: OUTCOME.REFUSED,
          steps,
          /* "could not", not "would never" (Mona Lisa's copy ruling on this
             PR): a person who installs Claude Code an hour later watches
             the agent start, so "never" is false on a real path.
             Present-tense truth, same weight, no forever claim. */
          /* ⚠️ POINTS AT CONNECT, NOT AT A WEBSITE (#979). This used to say
             "Install it first (https://claude.com/claude-code)", which sends
             a person off to do by hand the job Kosmos does for them: pressing
             Connect on Claude downloads it, checks it against the vendor's
             published checksum and sets it up. That sentence was written when
             the installer guaranteed the binary, so this arm was near
             unreachable; with the installer no longer forcing it, this is the
             sentence a real person meets, and the worse of the two remedies
             is the one it was handing them. */
          because: 'we could not find Claude Code on this computer, so an agent made now could not start. '
            + 'Connect a Claude account and Kosmos will set it up'
            + (codexConnected ? ', or create this agent on OpenAI instead' : ''),
          alternative: codexConnected
            ? { offered: true }
            : { offered: false, because: codexPresent ? 'no OpenAI sign-in on this computer' : 'the codex runner is not on this computer' },
        };
      }
      return {
        outcome: OUTCOME.REFUSED,
        because: `we could not find ${what} on this computer, so an agent made now would never start`,
        steps,
      };
    }
  }

  /**
   * ⚠️ PUT THE MACHINE BACK.
   *
   * Every failure after this point has to leave nothing behind, and the reason
   * is not tidiness. Two separate half-states shipped before this existed:
   *
   *   - A failed write left the FOLDER, so the very next attempt at the same
   *     name was refused for the folder's existence -- permanently, from a
   *     screen whose own button is "Start over". The comment beside it claimed
   *     the cleanup "lets the person try the same name again", which was false.
   *   - A failed `bootstrap` left the PLIST, and launchd loads every plist in
   *     that directory at the next login. So an agent the person was told is
   *     "not running yet" was in fact installed to start at their next login,
   *     undisclosed, with `--dangerously-skip-permissions`.
   *
   * Nothing here existed before this call: the folder is refused if it is
   * already there, and so is the job. So removing them takes back only what we
   * just made. The `steps` list still records which half failed, which is where
   * the diagnostic value actually lives.
   */
  function rollBack({ unload = false } = {}) {
    /* ⚠️ `unload` is for a failed START, and only then.
     *
     * `bootstrap` can register a service and still exit non-zero. Removing only
     * the plist then leaves that job respawning against a `start.sh` this
     * rollback has just deleted, and every retry of the name hits the
     * already-loaded refusal above — so the message "you can try that name
     * again" becomes false forever.
     *
     * The refusal above deliberately will NOT unload a stray service, because
     * it did not install it. This one did, seconds ago, which is exactly the
     * difference that makes unloading it the right thing rather than an
     * overreach.
     */
    if (DRY_RUN) return;
    if (unload) {
      try { run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${serviceLabel(name)}`]); }
      catch { /* it was probably never registered, which is the common case */ }
    }
    try { fs.rmSync(plistPath(name), { force: true }); } catch { /* best effort */ }
    try { fs.rmSync(workerDir(name), { recursive: true, force: true }); } catch { /* best effort */ }
  }

  function step(label, fn) {
    try {
      const r = fn();
      steps.push({ label, ok: r !== false });
      return r !== false;
    } catch {
      // ⚠️ Never the raw errno: it carries absolute paths and says nothing a
      // person can act on. The step label is what the operator needs.
      steps.push({ label, ok: false });
      return false;
    }
  }

  // ⚠️ WHETHER WE MADE IT, not whether it is there afterwards. `mkdirSync`
  // with `recursive` returns the first path it created and `undefined` when
  // the folder already existed, which is the one moment the two cases are
  // distinguishable — a second later the folder looks identical either way.
  // The trust write below turns on this, because answering the safety question
  // for a folder the PERSON chose is the case where that question is doing its
  // job.
  //
  // ⚠️ IT IS THE SECOND LINE, NOT THE FIRST, and the difference is worth
  // stating because a comment that named the wrong one would read as satisfied
  // while a later change removed the protection. The FIRST line is the refusal
  // further up: a name whose folder already exists never reaches here at all.
  // ⚠️ AND IT IS NOT DEAD, though it looked it while the only case anybody
  // could name was the one the refusal already covers. What it actually guards
  // is the WINDOW between that refusal's `existsSync` and this `mkdirSync`:
  // anything that creates the folder in between makes recursive mkdir succeed
  // silently and return undefined, and the trust write must not fire for a
  // folder we did not make. That case has its own test, which enters the window
  // by wrapping `mkdirSync`.
  let weMadeTheFolder = false;
  const madeDir = step('made its folder', () => {
    if (DRY_RUN) return true;
    weMadeTheFolder = fs.mkdirSync(workerDir(name), { recursive: true }) !== undefined;
  });
  if (!madeDir) {
    rollBack();
    return { outcome: OUTCOME.REFUSED, because: 'we could not make a folder for it', steps };
  }

  const wroteInstructions = step('wrote its instructions', () => {
    if (DRY_RUN) return true;
    // Their words when they gave any, the role's otherwise. A trailing
    // newline either way, matching what instructionsFor produces.
    let text = wantInstructions !== undefined
      ? wantInstructions.replace(/\n?$/, '\n')
      : roles.instructionsFor(roleKey, shown);
    // The About-you answers ride the boot file from BIRTH, spliced here
    // rather than told after the fact -- at this moment the session does not
    // exist yet, so the tell path's tied-session gate would refuse the very
    // agent being made. Same block machinery as every later re-tell, so an
    // edit to the answers finds and replaces exactly this block. Non-gating:
    // a record we could not read must not cost the person their agent.
    try {
      const youMod = require('./you');
      const rec = youMod.read();
      if (rec.state === 'saved') {
        const spliced = require('./projects').spliceBlock(text, youMod.blockBody(rec.you), youMod.START, youMod.END);
        // ⚠️ Only if the result still FITS. Instructions validated just under
        // MAX_BYTES would cross it once the block lands, making a boot file
        // the product's own reader then refuses to edit -- at that margin the
        // record really would have cost the person their agent's file. The
        // block is the thing to drop, never the person's words.
        const { MAX_BYTES } = require('./instructions');
        if (Buffer.byteLength(spliced, 'utf8') <= MAX_BYTES) text = spliced;
      }
    } catch { /* the boot file simply ships without the block */ }
    // Who it reports to rides from birth too, BOTH paths, keyed on the agent
    // and never on its role (#336): the self-described agent is the one most
    // likely to be placed under a manager later and the one every role-keyed
    // mechanism skipped for as long as the product existed (#333). Always
    // present: an agent nobody assigned reports to the person, and the block
    // says so by name. Composed from the same fields the profile will hold,
    // so the profile-save sync later composes the same bytes and writes
    // nothing. Non-gating, like every block here.
    try {
      const reportsMod = require('./reports');
      const spliced = require('./projects').spliceBlock(text, reportsMod.blockBody({
        role: typeof wantLabel === 'string' ? wantLabel : null,
        reportsTo: typeof wantReportsTo === 'string' ? wantReportsTo : null,
      }), reportsMod.START, reportsMod.END);
      const { MAX_BYTES } = require('./instructions');
      if (Buffer.byteLength(spliced, 'utf8') <= MAX_BYTES) text = spliced;
    } catch { /* the profile-save sync still does it, after the fact */ }
    // The colleagues block rides from birth too, same machinery and the
    // same non-gating posture: agent-to-agent messaging only works if the
    // agents know the command exists, and the file is where agents learn
    // things. Roster-independent content; the taught command is
    // machine-derived and heals via projects.healColleagues when it
    // drifts.
    // ⚠️ ROLE TEMPLATES ONLY. Custom instructions are the person's own
    // words written verbatim (the drift rule at birth, pinned by its own
    // test), so nothing is appended to them uninvited -- a person who
    // writes their agent's file can teach it the command themselves.
    if (wantInstructions === undefined) {
      /* ⚠️ SAID WHEN IT DOES NOT LAND (#182). This block is what teaches an
         agent that a reply in its own window reaches nobody; an agent born
         without it fails silently in exactly the way the block exists to
         prevent, so shipping without it must not be silent too. Still
         non-gating: the step reports, the creation succeeds. */
      let blockLanded = false;
      try {
        const messagesMod = require('./messages');
        const spliced = require('./projects').spliceBlock(text, messagesMod.blockBody(), messagesMod.START, messagesMod.END);
        const { MAX_BYTES } = require('./instructions');
        if (Buffer.byteLength(spliced, 'utf8') <= MAX_BYTES) { text = spliced; blockLanded = true; }
      } catch { /* reported below rather than swallowed */ }
      if (!blockLanded) {
        steps.push({ label: 'could not add the messaging section to its instructions, so it does not yet know how to answer you; edit its instructions or remake it', ok: false });
      }
    }
    // The operating defaults (#122): how an agent behaves whatever its job,
    // as opposed to what it is. Same gate and the same reason as the block
    // above, and the gate is a STANDING RULING rather than a choice made here.
    //
    // ⚠️ I WIRED THIS FOR BOTH PATHS FIRST, on the reasoning that an agent
    // somebody described in their own words needs operating defaults exactly
    // as much as one picked off the menu. That reasoning is not wrong, and it
    // is not mine to act on: the comment above states the decision already
    // taken, that nothing is appended to a person's own words uninvited, and
    // its own test pins it. A gap worth raising is not a gap worth closing
    // silently, so it is raised instead.
    //
    // ⚠️ THE FITS-CHECK IS DEFENCE AGAINST GROWTH AND CANNOT CURRENTLY FIRE,
    // which is stated here because an unlabelled guard reads as a tested one.
    // On this path the text is a role template under a kilobyte plus two
    // bounded blocks, against a 256KB cap: the margin is four orders of
    // magnitude. The near-cap case exists only for CUSTOM instructions, and
    // those never enter this branch. A test asserting the drop passed with
    // this line deleted for exactly that reason, and was replaced by one that
    // measures the margin instead.
    //
    // It stays because the first wiring appended before validation, which
    // turned a too-large file into a REFUSAL to create the agent at all.
    // Dropping the block is the right failure; refusing somebody their agent
    // because the product wanted to teach it something is not.
    /* #591: under a person's own words too. The block is not a job
       description, it is how any agent behaves inside Kosmos, and a person
       who pastes a job has taken authorship of the JOB, not opted out of the
       product working. It goes under its own heading so the seam between
       their words and ours is visible in the file, and the create form says
       so before the write (told before the write is consent). The byte cap
       is unchanged: drop the block, never refuse the agent. */
    try {
      const withDefaults = require('./defaults').appendTo(text);
      const { MAX_BYTES } = require('./instructions');
      if (Buffer.byteLength(withDefaults, 'utf8') <= MAX_BYTES) text = withDefaults;
    } catch { /* ships without the defaults */ }
      /* #1034: how connecting a provider works. Constant words, no machine
         state, no consent surface -- the card's part one. An agent born
         without it will confidently describe a screen it cannot see, which is
         worse than saying "tell me what you are looking at". Same gate and the
         same non-gating posture as the block above. */
      {
        let connLanded = false;
        try {
          const connMod = require('./connections');
          const spliced = require('./projects').spliceBlock(text, connMod.blockBody(), connMod.START, connMod.END);
          const { MAX_BYTES } = require('./instructions');
          if (Buffer.byteLength(spliced, 'utf8') <= MAX_BYTES) { text = spliced; connLanded = true; }
        } catch { /* reported below rather than swallowed */ }
        if (!connLanded) {
          steps.push({ label: 'could not add the connections section to its instructions, so it cannot help you connect a provider; edit its instructions or remake it', ok: false });
        }
      }
    // The projects block rides from birth too (#323). It used to arrive by
    // `projects.syncAgent` once the board could see the session, which is at
    // least one poll AFTER the session started, so every agent made onto a
    // project was born reading "Running on older instructions" with a Restart
    // button, sixty seconds old. Composed here, before the first write, the
    // later sync finds the file already saying this and `instructions.write`
    // declines a byte-identical save, so nothing is newer than the session.
    // ⚠️ LAST, AFTER THE DEFAULTS, because that is where `spliceBlock` puts a
    // block a file does not yet have, and the later sync has to compose the
    // SAME bytes or it writes after all. Both paths, unlike the two blocks
    // above: this block is written into a person's own words on every
    // membership change already, so at birth it is the same invitation.
    // Non-gating, same reason as the rest: an unreadable projects file must
    // not cost the person their agent.
    if (Array.isArray(wantProjects) && wantProjects.length) {
      try {
        const projectsMod = require('./projects');
        const recs = projectsMod.readAll().filter((p) => wantProjects.includes(p.id));
        if (recs.length) {
          const spliced = projectsMod.spliceBlock(text, projectsMod.blockBody(recs, name));
          const { MAX_BYTES } = require('./instructions');
          if (Buffer.byteLength(spliced, 'utf8') <= MAX_BYTES) text = spliced;
        }
      } catch { /* the sync after the session is up still does it, the old way */ }
    }
    fs.writeFileSync(instructionFile(name), text, 'utf8');
  });

  /**
   * The display name, written where the board reads it.
   *
   * ⚠️ NOT A STEP, and deliberately not gating anything. An agent whose profile
   * could not be written is a working agent shown under its slug — a cosmetic
   * loss — and failing the creation over it would destroy the agent to protect
   * its capital letter. The screen's step list is for things that decide whether
   * the person HAS an agent.
   *
   * ⚠️ AND IT IS THE SECOND RECORD OF THIS NAME, which needs saying because two
   * derivations of one fact is this codebase's worst habit. The instruction file
   * written above already says `You are **Casey**`, and `readIdentity` parses it
   * — that is how every pre-existing agent on this machine gets its display
   * name, and it keeps working untouched. This record is what survives the
   * person EDITING that file: the instruction file belongs to them and they may
   * rewrite its first line, and a name that vanishes when somebody edits their
   * own instructions is not a name. `readIdentity` prefers this and falls back
   * to the file, so the two cannot contradict each other — one wins, stated.
   */
  // (The write itself happens at the CREATED return below, round 25: from
  // here to there every step can fail into rollBack, and rollBack removes
  // the plist and the worker directory but deliberately not profiles --
  // the store refuses a profile-deletion API because removal-reversibility
  // depends on profiles surviving. Writing the record only once nothing
  // can be rolled back is what keeps a rolled-back creation from leaving a
  // display name for an agent that never existed, waiting to dress a
  // future stranger by the same slug.)

  // ⚠️ Executable, and that is not a detail. launchd runs it through
  // `/bin/bash` either way, but this file is the one an operator debugging a
  // stuck agent will run by hand with the same arguments the job passes, and a
  // "permission denied" at that moment is a file that is real only to us.
  // ⚠️ Installed rather than written per agent, and still a STEP: if the shared
  // supervisor is not in place, the job would point at a script that does not
  // exist, which is the respawn loop. The gate below stops before the job is
  // written at all.
  let supervisorMissing = false;
  let supervisorMissingFile = null;
  const installedSupervisor = step('put the script that starts agents in place', () => {
    if (DRY_RUN) return true;
    const done = installSupervisor();
    supervisorMissing = done.missing === true;
    supervisorMissingFile = done.missingFile || null;
    return done.ok;
  });

  /**
   * ⚠️ THE JOB IS WRITTEN LAST, AND REMOVED IF WE CANNOT FINISH.
   *
   * Order matters more here than anywhere else in this function. The plist was
   * written before the gate below, so a failed instructions or launcher write
   * left a launchd job on disk pointing at a startup script that does not
   * exist. Skipping `bootstrap` does not help: launchd loads every plist in
   * `~/Library/LaunchAgents` at the next login, `bash` exits at once on a
   * missing file, and `KeepAlive` with `ThrottleInterval 30` respawns it every
   * thirty seconds for as long as the machine is on.
   *
   * That is word for word the harm the gate below says it prevents, arriving
   * through the file the gate does not clean up. And it compounds: the name is
   * then permanently refused by the leftover-job branch above, so the person
   * cannot even retry from the screen.
   */
  /**
   * ⚠️ AN OPENAI AGENT'S FOLDER IS TRUSTED AT CREATION, or the agent is born
   * into a blocking dialog. MEASURED on the first live codex agent this
   * machine ran: codex asks "Do you trust the contents of this directory?"
   * on every launch in an untrusted folder, and
   * --dangerously-bypass-approvals-and-sandbox does NOT skip it (probed) --
   * only the config entry the Yes button writes does (probed too). Creating
   * the agent IS that consent: the folder is ours, made three steps up.
   * Append-only, once, into the same CODEX_HOME codexsession.js reads.
   */
  const trustedFolder = provider !== 'openai'
    || ((wroteInstructions && installedSupervisor) && step('let the OpenAI runner work in its folder', () => {
      if (DRY_RUN) return true;
      trustCodexFolder(workerDir(name), configDir);
      return true;
    }));

  const wroteJob = (wroteInstructions && installedSupervisor && trustedFolder) && step('set it up to keep running', () => {
    if (DRY_RUN) return true;
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
    fs.writeFileSync(plistPath(name), plistFor(name, runnerBin, tmuxBin, modelArg, configDir, runner), 'utf8');
  });

  /**
   * ⚠️ STOP BEFORE LOADING A JOB THAT CANNOT WORK.
   *
   * Only the folder and the start were gating the outcome, so a failed write
   * still returned `CREATED` — "set up and starting" over an agent with no
   * instructions, or with a job pointing at a startup script that was never
   * written. The second one is actively harmful rather than merely untrue:
   * `bash` exits immediately on a missing script, `KeepAlive` restarts it,
   * and the machine gets a job that fails every thirty seconds forever.
   *
   * And the screen built on this said "the folder and the instructions are on
   * your computer either way" — a sentence that is false in exactly the case
   * that produced it.
   */
  if (!wroteInstructions || !installedSupervisor || !wroteJob) {
    rollBack();
    // ⚠️ A missing supervisor gets its OWN sentence. It is not "try again":
    // `bin/agent-supervisor.sh` is missing from the installation, so retrying
    // fails identically forever, and the only place the real cause surfaced was
    // a step label. Naming the wrong cause is the failure the Claude and tmux
    // checks are careful to avoid.
    if (!installedSupervisor) {
      return {
        outcome: OUTCOME.PARTIAL,
        because: supervisorMissing
          ? `a file this app needs to start agents (${supervisorMissingFile || 'the start script'}) is missing from this app, so we have not made it. Trying again will not help until that is fixed; installing Kosmos again usually does.`
          : 'we could not put the script that starts agents in place, so we have not made it. You can try that name again.',
        steps,
      };
    }
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'we could not write everything it needs, so we have not made it. Nothing has been left on your computer, and you can try that name again.',
      steps,
    };
  }

  /**
   * ⚠️ LOADING the job is what starts the agent, and it is deliberately the
   * only way it is started.
   *
   * The previous version ran tmux itself and left the job on disk unloaded, so
   * the agent ran now and was gone after a reboot — the one thing the job
   * exists to prevent. Worse, the two paths would have started it DIFFERENTLY:
   * a session started here and a session started by the job are set up by
   * different code, and the second one is the one that runs for the rest of the
   * agent's life. Starting it any way other than the way it will always be
   * started means the first run is the only one anybody ever tested.
   *
   * So: bootstrap the job, and let `RunAtLoad` do it. One path, exercised at
   * creation, at reboot, and after every crash.
   */
  /**
   * Answer Claude Code's trust-this-folder question for the folder we just
   * made, BEFORE the job starts — the question is asked at startup, so a write
   * after `bootstrap` would land too late to stop the prompt it exists for.
   *
   * ⚠️ NON-GATING, AND NOT A STEP. Every failure inside `trustFolder` leaves
   * the config exactly as it was, and the outcome of that is TODAY'S
   * BEHAVIOUR: the agent starts and asks its person once. A red step on an
   * otherwise successful creation would report a working agent as a broken one
   * over a prompt they can answer by pressing 1.
   *
   * ⚠️ And it is skipped entirely under DRY_RUN, which is the whole point of a
   * dry run: nothing outside Kosmos is touched.
   */
  // ⚠️ THE RESULT IS KEPT BECAUSE THE ROLLBACK NEEDS IT: a key we wrote for a
  // folder we are about to delete has to come back out, or the sentence "we
  // have taken it back off your computer" is false in exactly the case that
  // produces it. It carries the KEY it wrote, so the undo cannot re-derive a
  // path while a rollback is deleting the folder under it.
  //
  // ⚠️ WHAT IS STILL THROWN AWAY, said rather than implied: `because`. Every
  // refusal inside `trustFolder` names its cause, and nothing here surfaces
  // that anywhere, so when an agent still stops on the prompt nothing on the
  // machine says which guard fired. Recorded as a gap, not fixed here — the
  // create result has no slot that shows a person a non-failure.
  let trusted = null;
  if (!DRY_RUN && weMadeTheFolder) {
    try { trusted = require('./trust').trustFolder(workerDir(name)); }
    catch { /* another tool's file; an agent that asks once is not a failed creation */ }
  }

  const started = step('started it', () => {
    const r = run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath(name)]);
    return r && r.ok !== false;
  });

  /* #169: what the failed-start rollback below knows in memory, persisted
     for the ordinary removal that happens weeks later. Only a line WE wrote
     (already false), best-effort and non-gating: a creation whose record
     write failed leaves a line removal will not touch, which was the
     behavior for every agent before this record existed. */
  if (started && !DRY_RUN) {
    try {
      if (trusted && trusted.ok === true && trusted.already === false && trusted.key) {
        require('./trust').recordWrite(name, {
          key: trusted.key, displaced: trusted.displaced, madeEntry: trusted.madeEntry,
        });
      } else {
        /* ⚠️ A NEW INCARNATION THAT DID NOT RECORD INVALIDATES THE OLD ONE.
           A reused name whose fresh creation could not (or did not need to)
           write trust must not leave the PREVIOUS incarnation's record
           alive: the person may answer the prompt themselves for the new
           agent, and the eventual removal would then delete THEIR answer on
           the strength of a record about a different agent. Dropping fails
           toward the stale-line world, which was every agent's world before
           the record existed. */
        require('./trust').dropRecord(name);
      }
    } catch { /* the record is a courtesy to a future removal, never a gate */ }
  }

  if (!started) {
    // ⚠️ AND THE TRUST ENTRY GOES WITH IT — only when we CREATED it (`already`
    // false), never when it was somebody's own decision that happened to be
    // there already. `rollBack` puts the machine back; this is the one thing
    // it puts back that is not ours.
    if (trusted && trusted.ok === true && trusted.already === false && trusted.key) {
      // ⚠️ `trusted.key`, never a fresh realpath of the folder. One derivation
      // of one fact, taken at the moment the folder was certainly there.
      // ⚠️ AND A FAILED UNDO IS RECORDED, because the sentence below tells the
      // person we took it back off their computer. If the undo refuses — the
      // config went unreadable, became a symlink, or a live session rewrote the
      // value under us — that sentence is false in exactly the case that
      // produced it, and `steps` is the one place this result can be seen.
      // ⚠️ IT APPEARS ONLY ON FAILURE. A step saying we tidied up would be
      // noise on a path where the person is already being told something went
      // wrong. An earlier version of this comment claimed the step existed
      // while the push had been lost to a `git checkout` during mutation
      // testing, and the test asserting its ABSENCE could not fail because
      // nothing ever pushed it.
      let undone = false;
      // ⚠️ WITH WHAT THE WRITE DISPLACED, so the undo RESTORES rather than
      // deletes. "Delete the key afterwards" is only a restore when the key was
      // absent before, and it usually was not: nineteen of twenty-two entries
      // on this machine hold `false`.
      try { undone = require('./trust').forgetFolder(trusted.key, trusted.displaced, trusted.madeEntry).ok === true; }
      catch { undone = false; }
      if (!undone) steps.push({ label: 'took back the folder trust', ok: false });
    }
    // ⚠️ INCLUDING THE JOB, and including UNLOADING it. It was left installed
    // here, so an agent reported as "not running yet" would have started at the
    // person's next login anyway -- the one outcome nobody would predict from
    // that sentence. And `bootstrap` can register a service and still fail, so
    // deleting the plist alone would leave a job nothing on disk explains.
    rollBack({ unload: true });
    return {
      outcome: OUTCOME.PARTIAL,
      because: 'we set it up but could not start it, so we have taken it back off your computer rather than leave something half installed. You can try that name again.',
      steps,
    };
  }
  // ⚠️ `CREATED` says the job was accepted, and NOT that the agent is up. The
  // claim, the session and the process all happen inside the job, after this
  // function has returned — so the thing that decides whether a person actually
  // has an agent is the board seeing it, which is watched on the screen rather
  // than asserted here. "We started it" is a claim about us.
  // The display-name record, written only now that nothing can roll back
  // (see the naming docblock above for why this record exists at all).
  // ⚠️ And only when the shown name DIFFERS from the slug (round 33): for
  // an all-lowercase creation the record added nothing readIdentity's
  // file fallback would not answer identically, while costing the
  // record-wins hazards for every agent instead of only the capitalised
  // ones the record exists for.
  // ...and the chosen role label rides the same record: one merged write,
  // not two back-to-back read-merge-write cycles on the same JSON file
  // (which also carried a window where the first landed and the second did
  // not). Both fields follow the same rules: written only past the point
  // of no rollback, non-gating, validated long before any write.
  if (!DRY_RUN) {
    const profile = {};
    if (shown && shown !== name) profile.displayName = shown;
    if (wantLabel !== undefined) profile.role = wantLabel.trim();
    /* Who this agent reports to (#138). Rides the same merged write as the
       other two, for the reason stated above: one read-merge-write on this
       file rather than a second cycle with its own half-landed window.
       ⚠️ NEVER INFERRED, here least of all. The org view draws this, and a
       diagram does not look like a guess: an unanswered reporting line stays
       empty. Kosmos asks; it does not work it out from a role name. */
    if (wantReportsTo) profile.reportsTo = wantReportsTo;
    /* The provider, recorded at birth beside the id (#245, per the OpenAI
       outline): never inferred from what happens to be running in a pane. */
    profile.provider = provider;
    /* Which revision of the working rules this agent was born with (#539),
       beside the id for the same reason the provider is: recorded at the
       moment it is true, never inferred later from file contents a person
       owns and may edit. "Was this agent born before the current ways of
       working" becomes a comparison of two numbers, which is what the
       consented refresh's banner and its per-agent Not-now memory key on. */
    profile.doctrineVersion = require('./defaults').DOCTRINE_VERSION;
    /* Written even when the patch is empty (#170): the write is what mints
       the agent's id, and an id at birth is the point. Before this, an
       all-defaults creation wrote no profile at all and the gate below
       skipped the mint with it. */
    try { store.writeProfile(name, profile); }
    catch { /* a card that reads `casey` with the role template's words is a working agent, not a failure */ }
  }
  return {
    outcome: OUTCOME.CREATED,
    because: `${shown} is set up and starting`,
    steps,
    firstAction: role.firstAction,
    // Where it actually is, so no screen has to rebuild this path and be wrong
    // about it on a machine with the roots pointed elsewhere.
    folder: workerDir(name),
    /**
     * ⚠️ BOTH NAMES, PUBLISHED, and this is not decoration. The creation screen
     * then WATCHES the board for the agent it just made, by `sessionName` — and
     * the board files it under the slug. A screen watching for what the person
     * typed would look for `Casey`, never find it, and tell somebody their
     * successful creation could not be seen coming up. Same rule as everywhere
     * else here: act on the machine name, speak the display name, and never
     * make a caller derive either one for itself.
     */
    name,
    shownAs: shown,
  };
}

/* 🔑 THE SELF-STARTING FACT, SAID ONCE (#671). A Kosmos-made agent's job has
   RunAtLoad and KeepAlive, so "how do I start it?" has a real answer and it is
   "you do not". remove.js's restart refusal and the board's offline sentence
   both need the words; two spellings of one launch model drift the first time
   either is edited, which is this codebase's named worst habit. No trailing
   punctuation: each surface finishes its own sentence. */
const SELF_STARTS = 'it starts itself when this Mac is on and it is not removed';

module.exports = {
  MODELS,
  SELF_STARTS,
  createdLog, createdLogFile, disabledJobs, runningJobs,
  /* ⚠️ Exported as the ONE machine-name rule. `slugFor` only lowercases — it
     is a converter, not a gate — so anything asking "is this a name we can
     act on" has to reach this, or it grows a weaker second copy. */
  NAME_RE,
  /* The disk roots themselves, for #500's stray walk: the walk must read
     these directly, because workerDir() consults recorded folders and
     would resolve a recorded name right out of the root being walked. */
  WORKERS_DIR, AGENTS_DIR,
  setModel,
  installJob,
  nameUsable,
  hasJob, jobMissing,
  setAccount,
  setProvider,
  readJob,
  createAgent,
  binPaths,
  unusablePath,
  nameProblem,
  cleanName,
  slugFor,
  plistFor,
  supervisorPath,
  supervisorSource,
  installSupervisor,
  serviceLabel,
  workerDir,
  instructionFile,
  plistPath,
  plannedModelArg,
  setRunner,
  setDryRun,
  OUTCOME,
  get DRY_RUN() { return DRY_RUN; },
};
