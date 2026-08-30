'use strict';

/**
 * A local window onto the agents running on this machine.
 *
 * Binds to localhost only, and it WRITES: it stores avatars, roles, the
 * commitments each agent says it is holding, and the instruction file each
 * agent reads at startup. It also MAKES agents: `POST /api/agents` writes a
 * worker directory, a startup script and a launchd job, and loads that job.
 * It can now stop and remove an agent, and put one back. And it TYPES INTO
 * ONE: `POST /api/project/:id/thread/:agent` places a line of text into that
 * agent's own tmux session. That is the strongest thing in this file, so read
 * `engine/chat.js`'s header for what it may and may not claim about it — the
 * short version is that a keystroke reaching a terminal is never evidence that
 * an agent read anything.
 *
 * See the ⚠️ block above `start()` for what protects it, and what does not.
 */

const http = require('node:http');
const { pipeline } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
// `STATE` travels with them: the thread route compares a member's state, and a
// literal there is a comparison that silently stops matching the day the engine
// renames one.
const {
  snapshot, paneRoster, countAgents, STATE, modelDisplayName,
  /* #1304: the tier vocabulary, imported rather than hand-written. A literal
     'structured' beside a value read off a process command line is exactly the
     two-copies-of-one-fact habit this file criticises elsewhere. */
  CONFIDENCE,
  /* #1304: an agent asking what MODEL it is running gets the same derivation
     that fills its card, rather than a second reader of the same transcript. */
  readModel,
  /* What tmux said the last time a look failed, for the 500 below to carry. */
  lastLookProblem,
  /* #684: the ONE derivation of "did anyone actually name this agent", for
     the offline rows below. `register.survey`'s shownAs cannot answer it --
     shownName falls back to the machine name, so it is never empty. */
  readIdentity,
} = require('./engine/status');
const removal = require('./engine/remove');
const leftover = require('./engine/delete-leftover');
const firstrun = require('./engine/firstrun');
const discover = require('./engine/discover');
const subscription = require('./engine/subscription');
const connect = require('./engine/connect');
const machine = require('./engine/machine');
const updates = require('./engine/update');
const usage = require('./engine/usage');

// Single source of truth for the version. With no support function, "what
// version are you on?" is the first question of every diagnosis, so the number
// on screen has to be the number in the release rather than a hand-typed label
// that drifts.
const { version } = require('./package.json');

/**
 * Whether this process is behind the code on disk (#338).
 *
 * `web/index.html` is read per request, so the page is never the stale part;
 * the engine is: node holds what it `require`d at startup, and a board left
 * running across a merge answered with hours-old code while looking entirely
 * current. Measured 2026-08-23: six hours, three merged PRs, `/api/roles`
 * still serving the morning's file.
 *
 * ⚠️ NOT A VERSION COMPARISON. The merges that caused it never bumped
 * `package.json`, so served and disk versions were equal the whole time. This
 * compares the mtime of every loaded module under the repo root to when the
 * process started, which is the same comparison `engine/instructions.js`
 * makes for an agent's own file.
 *
 * 📌 One stat sweep per five seconds, not per request (the poll's own
 * cadence), over repo-root entries of `require.cache` only; `node_modules` is
 * excluded by path even though nothing there is loaded today. `staleSince` is
 * ALWAYS present, null when current, so the status shape never grows a field
 * conditionally. Never throws: an unreadable stat counts as not stale.
 */
const ENGINE_STARTED_AT = new Date();
const ENGINE_ROOT = __dirname + path.sep;
let engineLook = { at: 0, staleSince: null };
/* #761's valve for the part routes (below, near heardBy): unlike a task,
   a part carries no `addedVia`/`createdAt` of its own, so counting
   process-made PARTS the way taskMake counts process-made tasks would need
   widening that record shape for a safety valve alone. This counts the
   thing actually being limited -- process-triggered pane notifications --
   directly, in memory. ⚠️ Resets on restart, unlike taskMake's persisted
   count: an acceptable line for a notification valve (the write it guards
   still lands either way) but NOT one to reuse for anything that gates data. */
const heardBudgetLog = [];
const HEARD_BUDGET_WINDOW_MS = 3600000;
const HEARD_BUDGET_MAX = 12;
function heardBudgetAllows() {
  const cutoff = Date.now() - HEARD_BUDGET_WINDOW_MS;
  while (heardBudgetLog.length && heardBudgetLog[0] < cutoff) heardBudgetLog.shift();
  return heardBudgetLog.length < HEARD_BUDGET_MAX;
}
function heardBudgetRecord() {
  heardBudgetLog.push(Date.now());
}
// Test-only, same shape as chatEngine.resetForTests()/messagesEngine.resetForTests():
// heardBudgetLog is in-memory and module-scoped, so without this, one test's
// spent budget silently carries into the next test in the same file.
function resetHeardBudgetForTests() {
  heardBudgetLog.length = 0;
}
function engineFreshness() {
  const now = Date.now();
  if (now - engineLook.at > 5000) {
    let newest = 0;
    for (const file of Object.keys(require.cache)) {
      if (!file.startsWith(ENGINE_ROOT) || file.includes(path.sep + 'node_modules' + path.sep)) continue;
      try {
        const m = fs.statSync(file).mtimeMs;
        if (m > newest) newest = m;
      } catch { /* gone or unreadable: not evidence of staleness */ }
    }
    engineLook = {
      at: now,
      staleSince: Math.floor(newest / 1000) > Math.floor(ENGINE_STARTED_AT.getTime() / 1000) ? new Date(newest).toISOString() : null,
    };
  }
  return { startedAt: ENGINE_STARTED_AT.toISOString(), staleSince: engineLook.staleSince };
}
const store = require('./engine/store');
/* Sandboxed whole or not at all (#634): refused before anything listens or
   writes. In-process (a test requiring this file) it throws; as the program it
   says the sentence and exits 2. */
{
  const sandbox = require('./engine/sandbox');
  const a = sandbox.audit(process.env);
  if (a.partial) {
    const msg = sandbox.sentence(a);
    if (require.main === module) { process.stderr.write(msg + '\n'); process.exit(2); }
    throw new Error(msg);
  }
}
const create = require('./engine/create');
const register = require('./engine/register');
/* ⚠️ For the not-running rows only. `engine/status.js` reads the same store for
   the agents it can see; this is the same question asked about an agent with no
   pane, not a second idea of where a face lives. */
function safeAvatarFor(name) {
  try { return store.avatarPath(name); } catch { return null; }
}
const roles = require('./engine/roles');
const commitments = require('./engine/commitments');
const you = require('./engine/you');
const policyEngine = require('./engine/policy');
const skillsEngine = require('./engine/skills');
const reports = require('./engine/reports');
const limits = require('./engine/limits');
const engmode = require('./engine/engmode');
const accounts = require('./engine/accounts');
/* #1304, second half: PigeonPete's live reader. It walks the pane's process tree
   to the claude descendant and reads the environment it is ACTUALLY running
   with, which is a better source than a startup file or a transcript for the
   question "what am I running on". Preferred below, with the record-based
   derivation as the fallback for an agent it cannot see. */
const runningas = require('./engine/runningas');
const openaiAccounts = require('./engine/openaiaccounts');
const runners = require('./engine/runners');
const github = require('./engine/github');
const vercel = require('./engine/vercel');
const cloudflare = require('./engine/cloudflare');
const tokendoors = require('./engine/tokendoors');
/* #553: this process's boot identity, for the update overlay to tell "the
   board went away and came back" from a client-side fetch failure. */
const BOOTED_AT = new Date().toISOString();
const forget = require('./engine/forget');
const ping = require('./engine/ping');
const notify = require('./engine/notify');
const selfreport = require('./engine/selfreport');
const sendertoken = require('./engine/sendertoken');
const liveness = require('./engine/liveness');
const connections = require('./engine/connections');
const doctrine = require('./engine/doctrine');
const githubdevice = require('./engine/githubdevice');
const remote = require('./engine/remote');
const styles = require('./engine/styles');
const autoupdate = require('./engine/autoupdate');
const instructions = require('./engine/instructions');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const chat = require('./engine/chat');
const messages = require('./engine/messages');
const unfurl = require('./engine/unfurl');
const attachments = require('./engine/attachments');
/* ⚠️ THE SAME MODULE UNDER A SECOND NAME, and it is not a convenience. The
   thread handler builds a local `messages` array for its payload, which shadows
   this binding for the whole of that scope, so `messages.owesReply` in there
   would be a property of an array. Naming it once here beats a rename inside
   the handler that would touch a payload key a screen reads. */
const messageLog = messages;
const os = require('node:os');

/**
 * The agent CARDS a project row is described against, or null if we could not
 * look.
 *
 * ⚠️ A SECOND DOCBLOCK USED TO SIT ABOVE THIS ONE describing `paneRoster`'s
 * fail-closed contract, left over from when this helper called it. It has not
 * called it since the defect below was fixed, so the paragraph documented a
 * function this code does not use, immediately above a paragraph saying so in
 * capitals. Removed rather than reworded: an outlived sentence is the defect
 * this file keeps finding, and keeping two is not better than keeping one.
 *
 * What survives from it, because it is still true of THIS helper: refusing is
 * right for the board, whose job is to say how agents ARE, and wrong for a
 * project's own record, which is readable either way — the members are still
 * ours to list, and `describe` marks each one `present: false` with a reason.
 * So this degrades to "we could not see them", never to "you have no projects",
 * and the route that reports fleet state alongside the list says so explicitly
 * with `agentsUnreadable` rather than pretending the roster is empty.
 *
 * ⚠️ `snapshot()`, NOT `paneRoster()`, and this was a real shipped defect for
 * the whole of this branch's life. `paneRoster` returns exactly
 * `{sessionName, session, isNamedOurs}` — it has never carried `name`, `state`
 * or `because`. `describe` reads all three, so every member row rendered with
 * the machine name instead of the display name (`claudebot`, never
 * `Splinter` — the ONE thing this feature's own docstring promises), with
 * `state: undefined` showing as a bare "Can't tell", and with `needsYou` and
 * `working` permanently zero, so the "1 needs you" the list exists to draw
 * could never appear. It is visible in the committed screenshots.
 *
 * It survived six rounds of review because THE TEST FIXTURE INVENTED THE
 * FIELDS. `ROSTER` in the engine suite carried `name`/`state`/`because`, which
 * nothing in this repo produces, so the tests measured a world that does not
 * exist. Measuring against the wrong world is worse than not measuring: it
 * produces confidence.
 *
 * ⚠️ RETURNS NULL, NOT [], when the look fails. An empty array is a claim — it
 * says we looked and there was nobody — and every consumer treats a non-array
 * roster as "we could not look" and says so.
 */
/* What the policy screens are shown (#685): every entry, full text summarised
   the same way in every route -- id, name, provenance, size, first 240
   characters. ONE derivation, because GET and all three mutations answer the
   same list and two spellings of it would drift. Pass a fresh read() to
   avoid a second disk read when the caller already holds one. */

/**
 * Who is sending this? One derivation, used by every route that needs it.
 *
 * 🛑 THREE EVIDENCE PATHS, IN ORDER, AND THE THIRD IS NEW (#1112).
 *   1. a token that resolves to a ROSTER CARD  -- an agent that is a live,
 *      tied, listable tmux pane. Unchanged, and still the strongest.
 *   2. a token that resolves to a NAME plus a LIVE HEARTBEAT -- an agent with
 *      no pane at all, which is every agent on a machine without tmux.
 *   3. no token: the pane, as before.
 *
 * ⚠️ PATH 2 IS NOT A RELAXATION OF PATH 1. `resolve` refuses a cardless agent
 * on purpose, and that refusal still stands on its own evidence. What path 2
 * adds is DIFFERENT evidence for the same fact: the pane proves an agent is
 * running BY EXISTING; a heartbeat proves it BY BEATING. Without a beat inside
 * the window there is no path 2 at all, so nothing here lets a token alone
 * speak for an agent that is not running.
 *
 * 🔑 `alive()` RETURNS null FOR "NO RECORD", AND null IS NOT true. Every Mac
 * agent has no heartbeat record, so path 2 simply never fires for them and
 * they keep taking path 1 exactly as before. That is what makes this additive.
 *
 * 📌 LIMITATION, STATED RATHER THAN HIDDEN: the token store is keyed by
 * `store.safeKey(sessionName)`, so a paneless card carries the SAFEKEY'D name,
 * not the original. For every name that survives safeKey unchanged they are
 * the same string. A name that does not survive it would key its records under
 * the safe form -- correct and consistent, but not identical to what a pane
 * would have reported. Worth fixing by storing the original name at mint time
 * if it ever matters; it does not yet.
 */
function resolveAgentSender(req, body, roster) {
  const presented = (req && req.headers && req.headers['x-kosmos-agent-token']) || (body && body.token);
  if (!presented) return messages.resolveSender(body && body.from_pane, roster);

  const carded = sendertoken.resolve(presented, roster);
  if (carded.ok) return carded;

  const byName = sendertoken.resolveName(presented);
  if (byName.ok && liveness.alive(byName.key) === true) {
    return { ok: true, card: { sessionName: byName.key, isNamedOurs: true }, instance: byName.instance || null, paneless: true };
  }
  /* The original refusal, verbatim: `resolve` deliberately gives the same
     sentence for "never issued" and "issued but no card", so that a probe
     cannot confirm a token was ever real. Substituting a message here would
     undo that. */
  return carded;
}

/**
 * The live reader, behind a seam a test can reach (#1304).
 *
 * 🛑 WITHOUT THIS THE ROUTE'S LIVE ARM HAD NO CONTROL. `fleet.install` stubs
 * `status.setPaneSource`/`setPaneCapture`; `runningas` has its own independent
 * `deps` seam that the route never passed, so a route test shelled out to the
 * developer's real `tmux list-panes -a` and a full-machine `ps`, and its
 * assertions depended on which sessions happened to exist. A test that reads
 * the machine it runs on is not a control.
 *
 * ⚠️ Same shape and same reason as `setPaneSource` two files over: replace
 * where the DATA comes from, never what is done with it, so the seam cannot
 * reach a real agent.
 */
let liveReaderFn = null;
function setLiveReader(fn) { liveReaderFn = typeof fn === 'function' ? fn : null; }
function liveReader() { return liveReaderFn || runningas.runningAs; }

/**
 * One answer about an agent, from the best source that can see it (#1304).
 *
 * 🔑 TWO READERS, ONE ANSWER SHAPE, AND WHICH ONE WINS IS PER FIELD.
 *
 *     account   LIVE first, record as fallback
 *     model     RECORD first, live as fallback
 *
 * 🛑 This headline used to read "AND THE LIVE ONE WINS", which is false for the
 * model and was left standing when the retraction was written INSIDE the
 * function forty lines below. The summary a reader hits first was wrong about
 * half the contract for a whole round. A correction that lives only in the body
 * is a correction most readers never see.
 *
 * `runningas` reads the environment the claude process is ACTUALLY running with;
 * the record reads the startup file Kosmos wrote and the transcript the session
 * left behind. The model prefers the RECORD because a transcript follows a
 * mid-session `/model` switch and a launch command line does not.
 * PigeonPete's measurement is why the order is that way round: every agent brief
 * on this machine says `claude-fable-5` and all 18 panes run `claude-opus-5`, and
 * Baron's said `josh@stuff.io` after he had been migrated to `josh@book.io`. Both
 * were correct when written. **Read live state; do not restate it.**
 *
 * ⚠️ THE FALLBACK IS NOT A GUESS, it is a different reading. A paneless agent
 * (a token holder with no tmux session) has no process tree to walk, so the live
 * reader cannot see it and the record is the only thing that can answer. Marking
 * WHICH one answered is why `source` rides along: an operator comparing two
 * agents should be able to see that one was read live and the other from a file.
 *
 * 🛑 AND NEITHER MAY GUESS. `account: null` means we could not tell, from either
 * source. This whole card exists because agents gave confident wrong answers,
 * so a null that says so is the required behaviour rather than a gap.
 *
 * `live` is passed in rather than fetched here so the shape can be driven
 * directly by a test without a process tree, a tmux server or a signed-in
 * account.
 */
function whoamiFor(card, known, live) {
  const who = card && card.sessionName;
  const seen = live && live.ok === true ? live : null;

  /* 🛑 PER FIELD, NEVER ALL-OR-NOTHING. The first version gated on
     `live.ok && (live.account || live.model)` and returned early, so a live
     reading that knew ONE fact hard-nulled the other. That is not a corner:
     `bin/agent-supervisor.sh` adds `--model` only when a model was chosen, so
     an agent without one gives `{ok:true, account:'…', model:null}` and the
     route answered "we cannot tell which model" about an agent whose transcript
     plainly says `claude-opus-5`. Each field now takes the best source that has
     it, and each carries where it came from. */
  const account = (() => {
    /* Live first: the account is what the process is authenticated as, and a
       startup file can be stale after a migration (Baron was moved off
       josh@stuff.io while his file still said so). */
    /* 🔑 ONE RULE FOR `isDefault`, AND IT LIVES IN `accounts`. `runningAs` sets
       `configDir` UNCONDITIONALLY on a successful read - the env var when it
       finds one, the default synthesised when it does not - so hardcoding
       `false` here asserted "not the default account" about a directory that is
       very often exactly the default.

       🛑 MY FIRST FIX WROTE THE COMPARISON OUT HERE AGAINST BARE `os.homedir()`
       AND CLAIMED IN THIS COMMENT THAT IT REUSED `accounts`. It did not, and the
       two disagree: `accounts` resolves HOME as
       `process.env.AGENT_WORKFORCE_HOME || os.homedir()`, the sandbox convention
       28 files here rely on. Measured - with the override set, `accounts` says
       the synthesised dir IS the default and my copy said it was not, for
       exactly the directory `runningAs` had just synthesised AS the default.
       ⇒ I introduced a second derivation of one fact while writing a comment
       saying I had avoided one. The fix for that is to make the first callable,
       not to write a third, so `isDefaultDir` is now exported from `accounts`. */
    const isDefaultDir = accounts.isDefaultDir;
    if (seen && seen.account) {
      return {
        value: {
          email: seen.account,
          /* 🛑 THE ORGANISATION IS NOT THE LABEL, AND PUTTING IT THERE MADE ONE
             FIELD CARRY TWO FACTS. `accounts.list()` sets `label` to the config
             DIRECTORY'S nickname (`account-b`); this path was setting it from
             Claude's `organizationName` (`Anthropic`). Both landed in one wire
             field, and `sentenceForWhoami` uses it as the second fallback for
             the human sentence - so two agents could read back "This agent runs
             on account-b" and "This agent runs on Anthropic" from the same
             field, meaning different things.
             ⇒ An organisation is not an account, so it gets its own field and
             never stands in for one. Same defect this branch exists to fix
             (two derivations of one fact), arriving as ONE NAME FOR TWO FACTS. */
          label: null,
          organization: seen.organization || null,
          dir: seen.configDir || null,
          isDefault: isDefaultDir(seen.configDir),
        },
        from: 'process',
      };
    }
    /* ⚠️ A CONFIGURED DIRECTORY WE CANNOT IDENTIFY IS STILL REPORTED, the same
       rule `accountForAgent` states for the record path: returning null there
       would say "the default account" about an agent pointed somewhere else. */
    if (seen && seen.configDir) {
      return {
        value: { email: null, label: null, organization: null, dir: seen.configDir, isDefault: isDefaultDir(seen.configDir) },
        from: 'process',
      };
    }
    const rec = accountForAgent(who, known);
    return {
      /* Field-for-field with the live branches above, `organization` included.
         A consumer must not be able to tell WHICH reader answered from the
         presence of a key - that is what `source` is for, and a shape that
         differs by reader is a second, accidental channel saying the same
         thing differently. */
      value: rec
        ? { email: rec.email, label: rec.label, organization: rec.organization || null, dir: rec.dir, isDefault: rec.isDefault }
        : null,
      from: 'record',
    };
  })();

  /* 🔑 AND THE MODEL GOES THE OTHER WAY, which is the opposite of what this
     change first did. `runningas` reads `--model` off the process COMMAND LINE,
     which is what the agent was STARTED with. `readModel` reads the tail of the
     transcript, which follows a mid-session `/model` switch: its own docblock
     cites Josh switching an agent from Fable to Opus and watching the board.
     ⇒ For the model the record is the FRESHER witness and the live read is the
     stale one, so the launch argument is the fallback rather than the winner.
     ⚠️ The evidence that justified preferring live was about agent BRIEFS,
     which nobody regenerates. It does not carry to the transcript. */
  const model = (() => {
    /* 📌 `sender.instance` IS DELIBERATELY NOT PASSED, and saying so because a
       pre-existing bug removed inside a refactor is indistinguishable from an
       accident. `readModel(name, exactSession)` uses the second argument as a
       tmux SESSION NAME; `instance` is a per-launch hex label from
       `sendertoken`, never a session name, so passing it built a `wanted` list
       that could never match and every token-presenting caller fell through to
       the workdir lookup anyway. Dropping it changes no behaviour and removes a
       misleading argument.

       ⚠️ CORRECTED: "changes no behaviour" is too strong, and a reviewer
       measured the exception. Three arms:
         readModel(name)              -> claude-opus-5, structured
         readModel(name, '<instance>')-> null, none        <- the old call
         readModel('nobodyhere')      -> null, none        <- control
       The claim holds only where `byWorkdir` independently finds the same
       transcript. Where the registry is the ONLY route to it, dropping the
       argument is a behaviour CHANGE - an improvement, and still a change. */
    /* 🛑 THE EXACT SESSION, NOT JUST THE NAME, AND DROPPING IT CAN HAND AN AGENT
       ANOTHER AGENT'S MODEL AT `structured` CONFIDENCE.

       `engine/status.js` states the cost in its own words: the board's name is
       the session with `-discord` stripped, so `foo` and `foo-discord` are ONE
       NAME AND TWO SESSIONS, and the surviving card of that collision can show
       the other agent's model and memory. The board therefore calls
       `readModel(pane.name, pane.session)` (status.js:3683). This route called
       `readModel(who)`.

       Measured, four arms:
         readModel('foo')                -> claude-fable-5  structured  <- the OTHER agent
         readModel('foo', 'foo')         -> claude-opus-5   structured  <- correct
         readModel('foo', 'foo-discord') -> claude-fable-5  structured  <- positive control
         readModel('nobodyhere')         -> null            none        <- negative control

       ⚠️ AND IT IS THE PREFERRED SOURCE, so a wrong value here BEATS the live
       reading that knew the truth - the confident-wrong-answer this whole card
       exists to remove, arriving through the reader we trust most.

       ⭐ Same distinction I pinned two hundred lines up for the LIVE reader
       (`card.session`, not `card.sessionName`), missed in the sibling call in
       the same function. */
    const rec = (() => {
      try { return readModel(who, (card && card.session) || undefined); } catch { return null; }
    })();
    if (rec && rec.model) {
      /* `modelDisplayName`, NOT the raw id, and this is the branch that normally
         answers. The LIVE path's display name was pinned; this one - the
         PREFERRED source for the model - was asserted nowhere, so swapping it
         for `rec.model` survived the whole suite and sent an agent
         "and its model is claude-opus-5" instead of "Claude Opus 5". Guarding
         the fallback and not the default is the wrong way round. */
      return { value: { id: rec.model, name: modelDisplayName(rec.model), confidence: rec.confidence }, from: 'record' };
    }
    if (seen && seen.model) {
      /* ⚠️ NOT `structured`. That tier means "read from a file written for this
         purpose"; this is a process command line, and mislabelling provenance
         in a change about provenance would be the joke writing itself. */
      return { value: { id: seen.model, name: modelDisplayName(seen.model), confidence: CONFIDENCE.SCRAPED }, from: 'process' };
    }
    /* 📌 `record` when NEITHER answered, and it is a compromise worth naming:
       `source` means "who answered" everywhere else, and here nobody did. The
       alternative is a third value, which every consumer would have to learn in
       order to render the same "we cannot tell" sentence. Kept as `record`
       because the record is the fallback and therefore the last reader
       consulted; revisit if a caller ever needs to distinguish them. */
    return { value: null, from: 'record' };
  })();

  return {
    account: account.value,
    model: model.value,
    /* Per field, because they can now come from different places. */
    source: { account: account.from, model: model.from },
  };
}

/**
 * The one sentence an agent reads back when somebody asks (#1304).
 *
 * 🔑 COMPOSED HERE, NOT BY THE AGENT. If every agent phrases this itself, three
 * agents give three answers, which is the defect this card is about wearing a
 * different coat. An unknown is said plainly rather than smoothed over.
 */
function sentenceForWhoami(account, model) {
  const acct = account && account.email ? account.email
    : account && account.label ? account.label
      : account && account.dir ? 'an account we cannot identify (' + account.dir + ')'
        : null;
  const parts = [];
  /* 🛑 ONE FORM, NOT TWO, AND THE SECOND ONE WAS DEAD. This used to branch on
     the source so the reason would match the reader that failed. A reviewer
     measured that the process form is UNREACHABLE: `runningAs` always sets
     `configDir` on a successful read, so a `process` account always carries at
     least a directory, `acct` below is always truthy, and the branch could
     never be pushed. Mutation, with a control: making the process form throw
     left 249/249 green; making the record form throw failed 1.

     ⇒ A comment describing behaviour the code cannot produce is worse than no
     comment, so the branch is gone rather than left as decoration. If a future
     `runningAs` can return `ok: true` with no directory, this needs the process
     form back AND a test that reaches it. */
  const why = 'We cannot tell which account this agent runs on, because we have no startup file for it';
  /* 🛑 THE MODEL MUST NEVER FILL IN FOR THE ACCOUNT, and a reviewer put that
     defect back in with the entire suite still green:

       M27  acct ? … : (model ? 'This agent runs on ' + model.name : why)
       ⇒    "This agent runs on Claude Opus 5, and its model is Claude Opus 5."

     That is the card's own headline failure - answering the easier question and
     not the one that was asked. Nothing caught it because no arm had a NULL
     ACCOUNT AND A KNOWN MODEL AT ONCE: one test stubs `ok:false` against a
     fixture with no transcript so both are null, the other supplies a live
     account so `acct` is truthy.
     ⭐ Third time on this branch that a gap was "no arm had both populated",
     one field over each time. */
  parts.push(acct ? 'This agent runs on ' + acct : why);
  parts.push(model && model.name ? 'and its model is ' + model.name : 'and we cannot tell which model it is running');
  return parts.join(', ') + '.';
}

/**
 * Which account an agent runs on, from its own startup file (#1304).
 *
 * 🔑 ONE DERIVATION, TWO CALLERS, and that is the whole point of it being here
 * rather than inside the status route where it was born.
 *
 * 🛑 AND THAT IS NO LONGER THE WHOLE STORY, SAID HERE RATHER THAN LEFT TO
 * CONTRADICT ITSELF (#1304). `/api/whoami` now prefers a LIVE read of the
 * agent's process for the ACCOUNT, while the board still reads this function.
 * For an agent migrated between accounts without its startup file being
 * rewritten, the two will disagree, and the live one is right. That is a real
 * gap rather than a tidy one: moving the board onto the live reader is a
 * per-poll cost across the whole fleet and belongs in its own card. Until then,
 * **the agent's own answer is the authoritative one and the board is the stale
 * one**, which is the opposite of what a reader would assume. The board answers
 * "which account is this agent on" for a person looking at the screen, and
 * `/api/whoami` answers it for the AGENT ITSELF. Two copies of that lookup
 * would disagree the first time either moved, and an agent contradicting the
 * board about its own account is worse than neither of them knowing.
 *
 * 🛑 `null` MEANS ONE THING ONLY: we could not read this agent's launch file,
 * so we do not know. It does NOT mean the default account. The first version
 * let the SCREEN decide, by falling back to "your first account" whenever this
 * was null and the pane was ours, and the page then said "Signed in as your
 * first account" about an agent whose launch file Kosmos has never seen.
 *
 * ⚠️ A CONFIGURED DIRECTORY WE CANNOT IDENTIFY IS STILL REPORTED, with what we
 * do know. Returning null there would say "the default account" about an agent
 * explicitly pointed somewhere else, which is the one wrong answer available.
 *
 * `known` is passed in because the status route reads `accounts.list()` once
 * per poll for the whole fleet; a per-agent call would stat the same handful of
 * directories thirteen times a tick to answer the same question.
 */
function accountForAgent(name, known) {
  const job = create.readJob(name);
  if (!job) return null;
  const dir = job.configDir;
  const list = Array.isArray(known) ? known : [];
  const found = dir ? list.find((x) => x.dir === dir) : list.find((x) => x.isDefault);
  if (found) {
    return {
      dir: found.dir, email: found.email, label: found.label,
      /* `organization` is a LIVE-only fact (Claude's `organizationName`); the
         record has no source for it. Present and null rather than absent, so
         both readers return the same shape. */
      organization: null,
      isDefault: found.isDefault,
    };
  }
  /* 🛑 `isDefaultDir`, NOT A HARDCODED false. This returned `false` for ANY
     directory not matched in `known` - INCLUDING the default one - while the
     live branches above ask `accounts.isDefaultDir`. So the two readers
     disagreed about the same directory, and which answer an agent got depended
     on whether its pane happened to be readable.
     ⭐ Two derivations of one fact, in the field I unified one round earlier:
     the live path was fixed and its sibling was not. Same miss, third time. */
  return dir
    ? { dir, email: null, label: null, organization: null, isDefault: accounts.isDefaultDir(dir) }
    : null;
}

function policySummaries(r) {
  const got = r || policyEngine.read();
  return got.policies.map((p) => ({
    id: p.id, name: p.name, source: p.source, savedAt: p.savedAt,
    chars: p.text.length, opening: p.text.slice(0, 240),
  }));
}
function safeRoster() {
  try {
    const board = snapshot();
    const agents = (board && board.agents) || [];
    // ⚠️ REMOVED AGENTS COME OFF HERE TOO, exactly as they do on the board. Two
    // derivations of "the fleet" is this codebase's worst habit, and this was
    // one: an agent the person had removed -- which the board calls "the whole
    // user-visible half of a removal" -- still showed on a project row as
    // present, with a live state, and the write gate still let us splice the
    // managed block into its boot file. So Kosmos would have edited the
    // instructions of an agent it had told the person was gone, and the row
    // would have claimed a successful tell about it (the told sentence
    // itself is retired now -- success says nothing -- but the write
    // gate this comment justifies is unchanged).
    const gone = new Set(removal.removedAgents().filter((r) => r.stopped !== false).map((r) => r.name));
    return agents.filter((a) => !gone.has(a.sessionName));
  } catch {
    return null;
  }
}

// Reads the body of an upload. Capped, because an unbounded read on a local
// server is still a way to fill someone's memory by accident.
const MAX_UPLOAD = 6 * 1024 * 1024;
function readBody(req, limit) {
  const max = Number.isFinite(limit) ? limit : MAX_UPLOAD;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new Error('file is too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Is this a name the board actually knows?
 *
 * ⚠️ Known limitation, written down rather than left to be discovered. This
 * compares against `safeKey(name)`, so an agent whose tmux session name is not
 * already its own sanitised form (a capital, a dot, a space) is rejected by
 * every route here, even though the status poll publishes a real staleness
 * verdict for it. The card would show "running on older instructions" and
 * clicking through would 404.
 *
 * ⚠️ And a correction to what an earlier version of this comment claimed. It
 * said that NOT widening the gate avoided accepting two names that sanitise to
 * the same directory. That was wrong: the gate compares against `safeKey(name)`
 * and `fileFor` resolves through `safeKey` too, so it ALREADY accepts every
 * spelling that sanitises to a live agent. Verified against the live roster:
 * `an.gel`, `ANGEL`, `a n g e l` and `ang!el` all pass and all resolve to
 * `angel/CLAUDE.md`. That is harmless while it is the same agent.
 *
 * The real latent risk, stated accurately: if two agents ever exist whose names
 * sanitise to the SAME key (sessions `mybot` and `my.bot`), the gate cannot
 * tell them apart and both read and write one file. Nothing detects that today.
 * There are currently no such collisions and no agent whose name differs from
 * its own sanitised form, both checked rather than assumed. The real fix is one
 * identity per agent instead of a name that is sanitised in one place and
 * verbatim in another, which is a change to the avatar and profile stores too.
 */
/**
 * Is this name currently claimed by a pane that is NOT tied to it?
 *
 * The precise question for a READ keyed on an agent name. `knownAgent` asks
 * whether the agent is on the board, which is the wrong question for a record
 * meant to outlive the agent's conversation.
 */
/**
 * The card that answers for this spelling, or `null` if none does.
 *
 * ⚠️ ONE predicate, because two of them diverged and the divergence was the
 * worst defect on this branch. `borrowedName` was corrected three times until
 * it asked the right question — **which CARD answers for the spelling asked
 * for**, not which cards share a sanitised key — and `knownAgent` was left on
 * the old per-key form. So with the real `angel-discord` up and a bystander's
 * `tmux new -s Angel` open, the reads refused correctly while the WRITES
 * accepted: `PUT /api/agent/Angel/instructions` rewrote the real agent's boot
 * file, `PUT .../profile` overwrote its role, `DELETE .../avatar` deleted its
 * picture, and `GET .../instructions` handed back its full text and path.
 *
 * That is the fifth time on this work that a fix stopped one layer short, and
 * it is the reason these are wrappers rather than two implementations: a lesson
 * learned by one gate has to be structurally impossible for the other to miss.
 *
 * The rule, re-derived: if a card's OWN session name is exactly what was asked
 * for, that card answers — nobody else's spelling is relevant. Only when no
 * card spells it that way do we fall back to the sanitised key, which is what
 * keeps a healthy agent reachable under its normalised name.
 */
function claimantFor(name) {
  const roster = paneRoster();
  const asked = String(name);

  const exact = roster.filter((a) => a.sessionName === asked);
  if (exact.length) return exact.find((a) => a.isNamedOurs === true) || exact[0];

  const key = store.safeKey(asked);
  const claimants = roster.filter((a) => {
    try { return store.safeKey(a.sessionName) === key; } catch { return false; }
  });
  if (!claimants.length) return null;
  return claimants.find((a) => a.isNamedOurs === true) || claimants[0];
}

/**
 * WHY a read of this name is refused, or null when it is not.
 *
 * ⚠️ TWO REASONS, AND THEY ARE NOT THE SAME FACT. `borrowedName` collapses
 * both into one boolean, which is correct for the GATE and wrong for the
 * SENTENCE: a pane holding this name untied is a STANDING condition that will
 * answer 404 on every poll forever, while tmux failing to answer is a blip
 * that clears by itself. The page said "we cannot show this" without a time
 * phrase for both, so a five-second hiccup on a perfectly ordinary agent read
 * as permanent, with no cause anywhere on the panel (`#d-untied` is hidden for
 * a TIED card). Nothing can tell the two apart downstream of the boolean, so
 * the reason is decided here, where it is known, and carried on the 404.
 *
 * ⚠️ Fails CLOSED either way. `paneRoster` throws when tmux cannot be asked,
 * rather than answering "nothing" — the realistic failure used to arrive here
 * as an empty roster and serve the record.
 */
function nameRefusal(name) {
  try {
    const card = claimantFor(name);
    return (Boolean(card) && card.isNamedOurs !== true) ? 'borrowed' : null;
  } catch {
    return 'unreadable';
  }
}

/**
 * Is this spelling answered by a card we cannot tie to the name it is filed
 * under? The question for a READ. ONE derivation: the reason above decides,
 * this only forgets which one it was.
 */
function borrowedName(name) {
  return nameRefusal(name) !== null;
}

/**
 * Is this spelling answered by a card we CAN tie to its name? The question for
 * a WRITE, and the strictly stronger one: a name nobody is running is not
 * writable, while its record stays readable.
 */
/**
 * The REAL tmux session behind a board name.
 *
 * ⚠️ Every reader that resolves a per-session artifact needs this rather than
 * the displayed name, and the fix reached them one at a time: the model and the
 * memory ring first, then the card's staleness, and this is the fourth. Until
 * it did, the panel and the card could date the same agent from two different
 * conversations -- one fact with two derivations, which is what this whole
 * branch is about.
 */
function sessionOf(name) {
  try {
    const card = claimantFor(name);
    return (card && card.session) || undefined;
  } catch {
    return undefined;
  }
}
// ⚠️ Two roster reads per request is two SNAPSHOTS: the gate can be decided
// against one and the session resolved against another, which is the same
// one-fact-two-derivations problem one level up. Both callers below run
// `knownAgent` first, so this is noted rather than fixed here — the shape that
// removes it is a single `claimantFor` whose card both the gate and the session
// come from, and that is a change to how every name-keyed route resolves.

function knownAgent(name) {
  try {
    const card = claimantFor(name);
    return Boolean(card) && card.isNamedOurs === true;
  } catch {
    return false;
  }
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/* ⚠️ ONE OF FIVE COPIES OF THE PINNED 16180 LITERAL (#910: here,
   `install/kosmos`, `install/setup.sh`, `install/pkg-scripts/postinstall`,
   and native-app/main.swift's `kosmosDefaultPort()`) -- but this is the
   ONLY one that is a pure consumer's dev-only fallback, not a computing
   site: every real invocation (the launcher, the app bundle, a .pkg
   install) resolves PORT itself and hands it here already set, so this
   literal is reached only by a bare `node server.js` with no PORT in its
   environment. A stale value here is invisible until somebody runs the
   server that way directly, and then it is a board on a port nothing
   else expects.
   📌 16180: 4317 is the OpenTelemetry OTLP/gRPC default and collided with the
   people most likely to run this. Not in 49152-65535, which is macOS's
   ephemeral pool: a fixed listener there collides at random. */
const PORT = Number(process.env.PORT || 16180);

/**
 * The path, with any query string removed.
 *
 * Routing used to match `req.url` directly, which includes the query string, so
 * an anchored pattern stopped matching the moment a caller appended anything.
 * The request then fell past every route to the catch-all and was answered with
 * the HTML page, at status 200.
 *
 * That is how a working avatar looked broken for an afternoon: the detail page
 * cache-busts with `?t=<now>` so a freshly uploaded picture appears immediately,
 * and that query string was the exact reason the picture never appeared. The
 * card grid, which requests the same avatar without one, showed it correctly --
 * so it read as a bad image format rather than a bad route.
 *
 * Matching on the pathname makes a query string unable to change which handler
 * runs, which is the only sane rule. Callers are free to append whatever they
 * like.
 */
const ROUTING_BASE = 'http://localhost';
// Loopback identities this server will answer to. Compared on HOSTNAME, not
// host: the port is deliberately ignored, because a proxy or tunnel in front of
// this process legitimately names a different one, and the earlier host-based
// check got it exactly backwards -- routing `//localhost/x` (port 80, not us)
// while refusing `//localhost:4317/x` (us).
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Extra hostnames this server will answer to, comma-separated.
 *
 * Empty by default. Set it only if you are deliberately putting a proxy in
 * front of this port, and read the warning above `start()` first: there is no
 * authentication here, and the writes include the file an agent boots from.
 */
const ALLOWED_HOSTS = new Set(
  String(process.env.AGENT_WORKFORCE_ALLOWED_HOSTS || '')
    .split(',')
    // ⚠️ The PORT is stripped, because the incoming value is compared as a bare
    // hostname and an operator copying `host:port` out of their proxy config
    // would otherwise get a silently dead entry and a 400 with nothing pointing
    // at the cause. Trailing dot and case too, matching how the header is
    // normalised below: an allowlist that only works if you spell it the way
    // the code happens to expect is not an allowlist.
    .map((h) => h.trim().replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase())
    .filter(Boolean),
);

/**
 * Returns the request's path with any query string removed, or `null` when the
 * target is not one we should route at all.
 *
 * `null` is distinct from `'/'` on purpose. `'/'` means "no route matched, show
 * the page", which is right for an ordinary unknown path in a single-page app.
 * A target we cannot place -- one carrying someone else's authority -- is not
 * an unknown page, it is a request that was not for us, and answering it with
 * the index at 200 is the same silent-success shape as the bug below.
 */
function pathOf(req) {
  const raw = req && req.url;
  if (typeof raw !== 'string' || raw === '') return null;

  // Parse first, judge after. An earlier version rejected anything not starting
  // with '/', which threw out absolute-form (`GET http://host/path`) before the
  // loopback check could see it -- and absolute-form is exactly what a proxy in
  // front of this port sends, the deployment the warning above start() says is
  // live on this machine. Origin-form and absolute-form both parse here; only
  // the resolved host decides.
  let parsed;
  try {
    parsed = new URL(raw, ROUTING_BASE);
  } catch {
    return null;
  }

  // Only route targets whose own authority is us. A target carrying an
  // authority -- `//host/path`, or an absolute `http://host/path` -- otherwise
  // has its host silently discarded and gets routed on the path alone.
  //
  // ⚠️ This inspects the request TARGET, not the `Host` header. Those are
  // different questions and this one is not an origin check. The `Host` check
  // that closes DNS rebinding is a separate block further down, added later;
  // this comment used to say the gap was "tracked separately" and left that
  // standing after it was closed, which understates the protection rather than
  // overstating it but is the same defect either way.
  //
  // Checking the parsed host rather than the string shape is deliberate. The
  // obvious guard is `raw.startsWith('//')`, and it does not work: the URL
  // parser treats a backslash as a slash for http, so `/\evil.example/api/status`
  // is authority-form while passing any startsWith check, and resolves to host
  // `evil.example` with pathname `/api/status`. Asserting on what the parser
  // actually produced is the only version that holds, because it tests the
  // property we care about rather than a spelling of it.
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null;

  // ⚠️ And the `Host` HEADER, which is a different question from the target's
  // authority and closes a different hole.
  //
  // The check above inspects what the client ASKED FOR. This one inspects what
  // it thinks it is talking to, and without it the server answers
  // `Host: evil.example.com` with the full agent roster. That is DNS rebinding:
  // a page on some other site, whose DNS then points at 127.0.0.1, becomes
  // same-origin with this server, so no CORS preflight is involved and the
  // response is readable. The attacker enumerates the agents and then PUTs a
  // new instruction file for any of them.
  //
  // This gap predates the branch and was survivable while the writes were an
  // avatar and a job title. It is not survivable now: this server edits the
  // file an agent boots from, so the same hole is remote code execution by the
  // agent, one restart later. The comment above `start()` used to enumerate
  // "two ways that protection is lost" and this was not one of them.
  //
  // ⚠️ This REFUSES a proxied request, and that is deliberate rather than an
  // oversight. Said plainly because it is a behaviour change: a reverse proxy
  // forwards its own hostname in `Host`, so nginx or a Tailscale Funnel in
  // front of this port now gets a 400 where it used to get the board.
  //
  // That is the posture the warning above `start()` already describes: this
  // server has no authentication, so a tunnel pointed at it exposes every write
  // route to whoever finds the URL, and it now edits the file an agent boots
  // from. Refusing is the honest default for a thing that was only ever safe
  // because it was unreachable.
  //
  // `AGENT_WORKFORCE_ALLOWED_HOSTS` is the deliberate opt-in for someone who
  // genuinely wants that, comma-separated hostnames. It exists so the choice is
  // made on purpose rather than discovered, and so this change does not
  // silently break a deployment that already relies on it.
  //
  // Only the HOSTNAME is compared: a proxy legitimately names a different port.
  // A request with no `Host` at all is HTTP/1.0 or a raw socket, neither of
  // which is a browser being rebound.
  const sent = req.headers && req.headers.host;
  if (sent) {
    let asked;
    try {
      asked = new URL(`http://${sent}`).hostname;
    } catch {
      return null;
    }
    // A trailing dot is the same host, and a browser will send one.
    const bare = asked.replace(/\.$/, '').toLowerCase();
    if (!LOOPBACK_HOSTS.has(bare) && !ALLOWED_HOSTS.has(bare)) return null;
  }

  return parsed.pathname;
}

/**
 * Percent-decode one path segment, or null if it is malformed.
 *
 * `decodeURIComponent` throws on a stray `%`, and a throw inside the request
 * handler is an uncaught exception that takes the process down. So a single
 * unauthenticated `GET /api/agent/%/avatar` was enough to kill the board.
 *
 * This existed before routing moved to the pathname, but that move made it
 * reachable from more requests: the anchored patterns previously stopped
 * matching as soon as a query string was appended, so `/api/agent/%/avatar?t=1`
 * fell harmlessly to the catch-all and only the bare form crashed. Widening
 * which requests reach a decode is exactly the kind of second-order effect a
 * routing change is prone to.
 */
/* #670: every project on the wire carries its unread count, derived HERE
   from the record and the read cursor, never re-counted on the page. null
   when the record or the cursor cannot be read (unknown is not zero), and
   never a 500: a projects list that fails because a bubble could not be
   computed would be the wrong thing to lose. */
function withUnread(list) {
  let counts = null;
  try { counts = messages.unreadAll(); } catch { counts = null; }
  return (list || []).map((p) => ({ ...p, unread: counts === null ? null : (counts[p.id] || 0) }));
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Is this write coming from a page on some OTHER website?
 *
 * ⚠️ THE HOST CHECK DOES NOT COVER THIS, and the create route's own comment
 * said it did. Measured, against the real server: a page on any site can run
 *
 *     fetch('http://127.0.0.1:4317/api/agents',
 *           { method: 'POST', headers: { 'content-type': 'text/plain' },
 *             body: '{"name":"theirs","role":"pm"}' })
 *
 * and that is a CORS *simple request* — POST with a `text/plain` body needs no
 * preflight. `Host` is `127.0.0.1:4317`, which is exactly what a legitimate
 * request looks like, so the Host check passes. The attacker cannot READ the
 * answer, and does not need to: the side effect is the attack. A real worker
 * directory and a real launchd job were created on this machine by that
 * request while this was being written.
 *
 * It is worse than a drive-by write because of what the job is: `RunAtLoad`,
 * `KeepAlive`, and an agent started with `--dangerously-skip-permissions` that
 * comes back on every reboot, whose instruction file any subsequent write can
 * rewrite.
 *
 * ⚠️ Why the EXISTING writes were not reachable this way, which is the thing
 * the old comment got wrong: they are all `PUT` and `DELETE`, and those are
 * never simple requests, so a browser preflights them, this server answers the
 * `OPTIONS` with a 404 carrying no CORS headers, and the browser drops the real
 * request. `POST /api/agents` was the first route on this server a stranger's
 * page could actually reach. "No worse than what is here" was false, and it was
 * false in the direction that matters.
 *
 * Two checks, because either alone leaves a gap:
 *
 *   1. `Origin`, when present, must be loopback. A browser attaches it to every
 *      cross-origin request and to same-origin POSTs, so this is the direct
 *      signal — but a non-browser client sends none at all.
 *   2. The `content-type` must NOT be one a form can produce. Those three types
 *      are the whole simple-request set, and being outside it is what forces
 *      the preflight this server does not answer — so a page that manages to
 *      omit `Origin` still cannot get a write through.
 *
 * ⚠️ The rule is "not a simple type", NOT "must be JSON", and the difference is
 * a real one this nearly shipped wrong: the avatar upload PUTs an IMAGE, and
 * `store.saveAvatar` reads that content type to decide the format. A blanket
 * JSON requirement would have refused every picture in the product while
 * reading, in review, exactly like the stricter and therefore safer choice.
 *
 * A request with no content type at all is left alone rather than broken,
 * because refusing it would break every non-browser caller (curl, a script) and
 * a form cannot produce one.
 * ⚠️ This used to justify itself with "a `fetch` with a body always sets one",
 * which is FALSE: `fetch(url, {method:'POST', body: new Blob(['…'])})` with a
 * typeless Blob sends no content type at all and is still a simple request.
 * What actually covers that case is the Origin arm above — a browser attaches
 * `Origin` to every POST — so the guard holds, and the sentence that said why
 * did not. Correcting it matters because the next person to touch the Origin
 * arm needs to know it is load-bearing here.
 *
 * Applied to every state-changing method, not only the new route: the others
 * are protected by preflight today, and depending on the browser's method
 * classification rather than saying so ourselves is how this was missed once.
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// The CORS simple-request set, in full. Anything outside it is preflighted.
const FORM_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]);

/* The read-side sibling of `crossSiteWrite`, for the two GETs that fetch
   from the internet on the page's behalf (#357). Browsers mark a request's
   provenance in Sec-Fetch-Site; a value other than same-origin or none (a
   direct address-bar load) means another website caused it, and a Referer
   from a host this board does not answer for means the same. Either is
   refused. A request with neither header (curl, an old browser) passes: the
   guard is against the drive-by, not against the person. */
/* Attach a link preview to every row that carries text with a link (#357).
   Read from the engine's cache while serving; a link never asked for starts
   its fetch now and is carried on the next poll, so a payload is never held
   for the internet. A refusal or "nothing to show" attaches nothing: absence
   is how the page draws a link that stays a link. The image is this board's
   own path, never the site's. */
function withPreviews(rows) {
  if (!Array.isArray(rows)) return rows;
  for (const r of rows) {
    if (!r || typeof r !== 'object' || typeof r.text !== 'string') continue;
    const link = unfurl.firstLink(r.text);
    if (!link) continue;
    const hit = unfurl.peek(link);
    if (hit === null) { unfurl.warm(link); continue; }
    if (!hit.ok) continue;
    r.preview = {
      url: hit.url, title: hit.title, description: hit.description, site: hit.site, fetchedAt: hit.fetchedAt,
      image: hit.image ? '/api/unfurl/image?url=' + encodeURIComponent(hit.image) : '',
    };
  }
  return rows;
}

function crossSiteRead(req) {
  const site = req && req.headers && req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    return 'that request came from another website, so we will not fetch for it';
  }
  const referer = req && req.headers && req.headers.referer;
  if (referer) {
    let host = '';
    try { host = new URL(referer).hostname.replace(/\.$/, '').toLowerCase(); } catch { host = ''; }
    if (!LOOPBACK_HOSTS.has(host) && !ALLOWED_HOSTS.has(host)) {
      return 'that request came from another website, so we will not fetch for it';
    }
  }
  return null;
}

function crossSiteWrite(req) {
  if (!req || !WRITE_METHODS.has(req.method)) return null;

  const origin = req.headers && req.headers.origin;
  // `null` is what a sandboxed iframe or a `file://` page sends, and it is
  // never this board.
  if (origin && origin !== 'null') {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      return 'that request came from somewhere this board does not answer';
    }
    const host = parsed.hostname.replace(/\.$/, '').toLowerCase();
    if (!LOOPBACK_HOSTS.has(host) && !ALLOWED_HOSTS.has(host)) {
      return 'that request came from another website, so we will not act on it';
    }
    /**
     * ⚠️ AND THE PORT, for a loopback origin.
     *
     * Comparing the hostname alone made every other page on this machine
     * same-site: a dev server on `http://127.0.0.1:3000` rendering somebody
     * else's content, or an XSS in any other local app, could POST here and
     * install a launchd job. "A page on another website" is the threat this
     * guard names, and a page on another local port is one.
     *
     * The port is deliberately NOT compared for an `ALLOWED_HOSTS` name: that
     * list is the explicit opt-in for a reverse proxy, and a proxy legitimately
     * renumbers ports — the same reasoning the `Host` check gives. The
     * difference is that a loopback origin has an exact right answer, which is
     * this server's own.
     */
    // Compared against the `Host` the browser actually used, NOT against the
    // module's `PORT` constant: this server can be started on any port, and a
    // guard that tests a configured default refuses legitimate writes on every
    // other one. Origin and Host being the same host:port is precisely what
    // same-origin means, so this asks the real question.
    const sentHost = String((req.headers && req.headers.host) || '')
      .toLowerCase().replace(/\.(?=:|$)/, '');
    const originHost = `${host}${parsed.port ? `:${parsed.port}` : ''}`;
    // ALLOWED_HOSTS is the explicit reverse-proxy opt-in, and a proxy
    // legitimately renumbers ports — the same exception the `Host` check makes.
    // ⚠️ A missing `Host` alongside an `Origin` FAILS CLOSED. No browser omits
    // Host, so this is not a live bypass — but the alternative is the strongest
    // arm of this guard degrading silently, which is the posture everything
    // else in this file refuses.
    if (originHost !== sentHost && !ALLOWED_HOSTS.has(host)) {
      return 'that request came from another program on this computer, so we will not act on it';
    }
  } else if (origin === 'null') {
    return 'that request came from somewhere this board does not answer';
  }

  // ⚠️ A request whose Origin we have already recognised as our own does not
  // need the content-type arm: that arm exists to catch a page that sent no
  // Origin at all. Refusing a same-origin POST for its content type is a trap
  // for the next route somebody adds here.
  if (req.headers && req.headers.origin && req.headers.origin !== 'null') return null;

  // ⚠️ POST ONLY. A simple request is a METHOD and a content type together —
  // `PUT`, `DELETE` and `PATCH` are never simple whatever body they carry, so
  // they are already preflighted and refusing them on their content type buys
  // nothing. The first version applied this to every write and broke
  // `PUT /avatar` with a plain-text body, which an existing test caught: a
  // guard stricter than the threat is still a guard that breaks the product.
  if (req.method !== 'POST') return null;

  const type = String((req.headers && req.headers['content-type']) || '').split(';')[0].trim().toLowerCase();
  if (type && FORM_TYPES.has(type)) {
    return 'that request is shaped like one another website could send, so we will not act on it';
  }
  return null;
}

/* 🔑 THE INSTALL GATE'S REQUEST LOG (#908). On 2026-08-25 and again on
   2026-08-26 the gate went red because something loaded a sandboxed board's
   page (POST /api/whats-new/seen wrote seen-version.json, #891), and nothing
   could name the client: the board keeps no request log and the gate deletes
   its sandbox on exit. With KOSMOS_INSTALL_GATE=1 every request appends one
   line, `time method path user-agent`, to a file OUTSIDE the sandbox
   (KOSMOS_INSTALL_GATE_LOG, default ~/.claude/logs/install-gate-requests.log,
   where the cut record already outlives cuts). A GET / before the API calls
   means something opened the page; API calls with no page load means a page
   from another process on a reused port; the User-Agent names the host.
   Env-gated, off in the product, no data path changes. Approved by Splinter
   2026-08-25 15:40. Never throws: a log that cannot be written must not
   turn the instrument into a second defect. */
/* ⚠️ TWO SWITCHES, MEASURED: KOSMOS_INSTALL_GATE=1 is ALSO the release
   cut's short-mode flag in tools/test-install.sh (stop before the probe
   blocks, #624), so the suite must never export it for the log's sake: the
   first version did, and every full run silently became the short run (81
   checks instead of 274, 2026-08-26 01:20). A cut sets the flag and gets
   the log for free; a full local run names the PATH instead. */
const GATE_LOG = process.env.KOSMOS_INSTALL_GATE === '1' || process.env.KOSMOS_INSTALL_GATE_LOG
  ? (process.env.KOSMOS_INSTALL_GATE_LOG || path.join(os.homedir(), '.claude', 'logs', 'install-gate-requests.log'))
  : null;
function gateLog(req) {
  if (!GATE_LOG) return;
  try {
    fs.mkdirSync(path.dirname(GATE_LOG), { recursive: true });
    const ua = String(req.headers['user-agent'] || '-').replace(/[\r\n\t]+/g, ' ');
    fs.appendFileSync(GATE_LOG, `${new Date().toISOString()} ${req.method} ${req.url} ${ua}\n`);
  } catch { /* the instrument never becomes the defect */ }
}

const server = http.createServer((req, res) => {
  gateLog(req);
  const pathname = pathOf(req);
  if (pathname === null) {
    // Not addressed to us. Saying so is better than handing back the index,
    // which would look like a successful page load.
    sendJson(res, 400, { error: 'that request was not addressed to this server' });
    return;
  }

  // ⚠️ BEFORE every route, so a write added later is covered by default rather
  // than by whoever adds it remembering. The one that was missed was the one
  // written last.
  const refusal = crossSiteWrite(req);
  if (refusal) {
    sendJson(res, 403, { error: refusal });
    return;
  }

  if (pathname === '/api/status' && (req.method === 'GET' || req.method === 'HEAD')) {
    let body;
    try {
      const snap = snapshot();
      // Attach what each agent says it is holding. Read here rather than in the
      // status engine, which derives state from tmux and transcripts; this is a
      // separate record that the agent wrote about itself.
      //
      // Every agent gets a commitment block, including ones that have never
      // reported -- they come back `unknown`, and it is that value the restart
      // confirmation needs. Omitting the field for silent agents would leave
      // the caller unable to tell "nothing pending" from "never asked".
      // ⚠️ BOTH of these are keyed on the NAME, so both need the same gate the
      // snapshot applies to identity, model, context, avatar and profile.
      // Without it the leak `status.js` closes is reopened one layer up: an
      // untied stranger's card came back carrying the real agent's commitment
      // TEXT, its boot-file hash, and a `startedAt` read out of the real
      // agent's transcript — while the snapshot's own sentence promises "we
      // will not read another agent's transcript for it".
      //
      // It also reinstates the measured wrong-card-cost failure: the restart
      // dialog reads these, so the cost shown would be the real agent's while
      // the pane acted on is a stranger's.
      // ⚠️ REMOVED AGENTS COME OFF THE BOARD HERE, and this filter is the whole
      // user-visible half of a removal. Everything else the engine does is
      // invisible: the launchd job is disabled, the session ended. If a removed
      // agent still appeared in this list, the person who removed it would have
      // clear evidence the product ignored them, and no way to tell that
      // anything had happened at all.
      //
      // Filtering the SNAPSHOT rather than the pane source is deliberate: a
      // removed agent's session is gone, but a foreign agent whose session was
      // not ours to end can still be running, and it must vanish from the board
      // regardless. "Removed" is a fact this product keeps, not something it
      // infers from what tmux happens to show.
      // ⚠️ `sessionName`, NOT `name`. They are different fields and they differ
      // for exactly the agents this feature was rebuilt to support. `name` is
      // the DISPLAY name, parsed out of "You are **Angel**" in the agent's own
      // instructions or supplied by an override; `sessionName` is what tmux and
      // launchd know it as, and it is what a removal records. For an agent this
      // app created the two coincide, which is why filtering on the wrong one
      // passed every test — and why removing `claudebot`, whose card reads
      // "Splinter", would have left it on the board and in the removed list at
      // the same time. Every other name-keyed reader in this block already uses
      // `sessionName`; this was the one that did not.
      // ⚠️ Only the ones that actually STOPPED come off the board. A removal
      // that half-worked is recorded — so there is a Restore button — but its
      // agent may still be running, and hiding a running agent is the one thing
      // this board must never do.
      // ⚠️ The predicate is read off the records already in hand, not by calling
      // `isHidden` per agent -- that re-read and re-parsed `removed.json` once
      // per removed agent, on top of the read `removedAgents()` just did, on
      // every five-second poll. `stopped !== false` is `isHidden`'s own test;
      // if the two ever diverge this is the copy that is wrong.
      const gone = new Set(removal.removedAgents().filter((r) => r.stopped !== false).map((r) => r.name));
      /**
       * What an agent's job will START it on, for the agents whose live model
       * we could not read.
       *
       * ⚠️ WHEN NO LIVE MODEL WAS READ, PLUS EVERY STOPPED AGENT.
       * ⚠️ THIS GATE IS COST, NOT CORRECTNESS, and an earlier version of this
       * line claimed both. Which reading WINS is decided on the page, by
       * `modelLine` and `runsOnLine`; populating this field for a running agent
       * would change nothing on screen, only add a disk read per agent per
       * five-second poll. Measured: mutating the gate to always consult the job
       * fails no test, and correctly so — the display layer is where the
       * precedence lives, and that half IS pinned.
       * (The line also said "only when `modelName` is absent", which the
       * stopped-agent clause contradicts. A header is what a later reader
       * trusts, so it is the one that has to be right.) The cost half stands on its own: this route polls every
       * five seconds for every agent, so a disk read per agent per poll to
       * answer a question already answered is the waste the instruction-text
       * note above refuses. ⚠️ The correctness half USED to be here too — "a
       * live reading must never be second-guessed by a job file" — and it was
       * left standing after the header above retracted it. Two claims about one
       * fact in one comment, which is what this block's own last line warns
       * against.
       *
       * ⚠️ GATED ON `isNamedOurs` LIKE EVERY OTHER NAME-KEYED READ IN THIS
       * BLOCK. The plist is keyed on the NAME, so without the gate an untied
       * stranger's pane reports the REAL agent's planned model — the precise
       * leak this block's other three fields already close, and a new field
       * does not inherit that guard by being written next to them.
       */
      const plannedFor = (a) => {
        if (!a.isNamedOurs) return null;
        // ⚠️ A STOPPED AGENT NEEDS THIS EVEN THOUGH IT HAS A modelName. The
        // transcript says what it RAN as; only the job says what it will START
        // on, and the panel makes a future-tense claim for stopped agents. With
        // the old `|| a.modelName` gate that claim was sourced from a session
        // that has ended -- and for a job carrying no --model at all (every
        // agent created before the picker existed) it stated a specific future
        // model we had no basis for. The cost gate still holds: a RUNNING agent
        // whose model we could read never reaches the disk.
        // ⚠️ THIS AND `modelLine`'s `cardStOf(a).pres === 'off'` ARE THE SAME
        // QUESTION ACROSS A BOUNDARY. The client cannot import STATE and the
        // server cannot import CARD_ST, so they cannot literally share the
        // derivation — they agree because `stopped` is the only CARD_ST entry
        // mapping to `pres: 'off'`. That coincidence is pinned by a test rather
        // than left to be discovered: add a second `off` state and the client
        // would prefer the job for it while this never populated the field, so
        // "Will start on" would silently stop appearing.
        if (a.modelName && a.state !== STATE.STOPPED) return null;
        const arg = create.plannedModelArg(a.sessionName);
        return arg ? modelDisplayName(arg) : null;
      };
      /* One list read per poll rather than per agent: `accounts.list()` stats a
         handful of directories, and doing it thirteen times a tick to answer
         the same question is waste the five-second poll would pay forever. */
      const known = (() => { try { return accounts.list(); } catch { return []; } })();
      /* 🛑 `null` HERE MEANS ONE THING ONLY: we could not read this agent's
         launch file, so we do not know. It does NOT mean the default account.
         The first version let the SCREEN decide, by falling back to "your
         first account" whenever this was null and the pane was ours -- and the
         rendered page then said "Signed in as your first account" about an
         agent whose launch file Kosmos has never seen. Truthiness standing in
         for validity, again: `isNamedOurs` answers "is this our agent", never
         "did we write its job". */
      const accountOf = (name) => accountForAgent(name, known);
      const agents = snap.agents.filter((a) => !gone.has(a.sessionName)).map((a) => ({
        ...a,
        /* 🔑 STATED ON EVERY ROW, and it was stated on only half. The board
           branches on `running === false`, and the not-running rows below set
           it while these did not: so for every live agent the page was reading
           a field the route does not emit, getting `undefined`, and working by
           accident. `undefined === false` is false, which is the right answer
           for the wrong reason, and the first person to write `if (a.running)`
           would have got false for a fleet that is entirely up.
           ⚠️ TRUE FOR A `stopped` PANE TOO. That state means a session exists
           with something other than Claude in it, and that agent IS up; the
           rows that carry `false` are the ones with no session at all.
           Found by wrapping this route's output in the fixture's strict proxy,
           which threw the moment a renderer touched it. */
        running: true,
        // The name only. `plannedModelArg` returns null for "we do not know",
        // and null travels as null: the screen must not be able to tell a
        // missing job from a default.
        plannedModelName: plannedFor(a),
        /* Which Claude account this agent runs on, read from its startup file
           and resolved to something a person recognises. `null` means the
           default account, which is what an absent key has always meant.
           ⚠️ Only for agents we started: an untied pane borrowing a name has
           no startup file of ours, and answering for it would be answering for
           a stranger's session. */
        /* #170: the agent's id, read-only, so screens and future
           outside-agent reconciliation can tell two same-named agents
           apart. `agentId` answers null for a profile minted under another
           install (a restored agent is a different agent and gets a fresh
           id on its first local write) and for an untied pane, which is not
           ours to name. Nothing resolves BY id yet; the name remains the
           operational key everywhere. */
        id: a.isNamedOurs ? store.agentId(a.sessionName) : null,
        account: a.isNamedOurs ? accountOf(a.sessionName) : null,
        commitments: a.isNamedOurs
          ? commitments.read(a.sessionName)
          : { state: 'unknown', commitments: [], reportedAt: null, because: 'we cannot tie this pane to an agent by name, so we will not speak for what that name is holding' },
        // Staleness only, NOT the instruction text. The board polls this every
        // five seconds for every agent, and the real files run to several
        // kilobytes each -- carrying them here would put ~90KB on the wire per
        // poll to render a badge. The text is fetched once, by the detail page,
        // when someone actually opens it.
        // ⚠️ `editable: false` matters as much as hiding the hash. The board
        // renders an Edit affordance from this, so gating `knownAgent` without
        // gating this left the card ADVERTISING an edit the route then 404s —
        // offer-an-action-that-cannot-work, which is worse than refusing plainly.
        instructions: a.isNamedOurs
          // ⚠️ The pane's REAL session, so the staleness verdict resolves the
          // same transcript the model and the memory ring did. Without it this
          // reader falls back to preferring the `-discord` spelling, and a
          // lingering registry entry for a long-gone `<name>-discord` dates the
          // card from one conversation while its other numbers come from
          // another. The fix reached two of the three readers and stopped one
          // short.
          ? projects.toldOverride(instructions.staleness(a.sessionName, undefined, a.session), a.sessionName)
          : { state: 'unknown', editable: false, version: null, startedAt: null, because: 'we cannot tie this pane to an agent by name' },
      }));
      // ⚠️ THE COUNTS DESCRIBE THE CARDS THAT ARE LEFT. Computed over the
      // unfiltered snapshot they put "12 agents" above 11 cards, and can put
      // "1 needs you" on screen with no card anywhere to click. Recomputed with
      // the ENGINE's own counter rather than a copy of its predicates here, so
      // a count added there cannot quietly stop being recomputed here.
      /**
       * 🛑 AN AGENT THAT IS NOT RUNNING IS STILL AN AGENT, and the board was
       * discarding it. The roster above comes from `tmux list-panes`, so an
       * agent with no live pane is not merely unreported, it is absent: Josh's
       * board read "1 Agents" this morning while fifteen more sat in
       * ~/work/workers with their instructions, avatars and history intact, and
       * the Projects tab one click away was correctly saying "4 agents, 4 we
       * cannot see" about the same fleet. Two screens, one app, one moment,
       * opposite answers (Mona Lisa, #278).
       *
       * 🔑 IT IS MERGED HERE RATHER THAN IN `snapshot()` because
       * `engine/register.js` already requires `engine/status.js`, and the
       * reverse is a circular import. The consequence, stated rather than
       * discovered: `node engine/status.js` on the command line still shows
       * only what is running, which is right for a tmux reader.
       *
       * ⚠️ RECORD FIELDS ONLY, NEVER A READING (Mona Lisa's ruling). The name,
       * the face, the role and the reporting line survive a stopped session and
       * are true right now. The memory, the task line and the model do not
       * exist for an agent that is not up: the transcript holds YESTERDAY's
       * model, and a card showing it would be the stale-screenshot failure this
       * morning already cost us. So the row carries no `context`, no `model`
       * and no `task` at all — absent, rather than blank or unknown, because
       * "unknown" means we tried to read it and could not, and here there is
       * nothing to read.
       */
      /**
       * 🛑 A PARTIAL PANE READ PUBLISHED RUNNING AGENTS AS NOT RUNNING, and it
       * did so at the HIGHEST confidence level this file has. `seen` holds the
       * panes that PARSED, so an agent whose line `readPanes` rejected fell
       * straight through into the offline list carrying `state: stopped`,
       * `running: false`, `stateConfidence: structured` and a `because` saying
       * nothing on this computer has a session for it. On a partial read all
       * four are false: the agent is running and we could not read its line.
       *
       * 🔑 THE INVERSION MANUFACTURING A CONFIDENT NEGATIVE rather than
       * withholding, which is the opposite of what every other refusal in this
       * file does (Mona Lisa, #294). And it defeated the honest warning above
       * it: the board already says "N we could not read at all, so some agents
       * may be missing", and a reader who has been handed a Not running card
       * for that agent has been given an explanation and stops looking.
       *
       * ⚠️ REACHABLE WITH NOTHING OF OURS BROKEN. `PANE_FORMAT` carries a pane
       * TITLE, which is arbitrary text an agent wrote about itself, and the
       * mangled `anna_0.0_2.1.237_0___` line that cost Josh an hour this
       * morning is exactly that input. That agent was running throughout.
       *
       * 📌 SO THE WHOLE LIST IS WITHHELD, not softened per agent. Subtracting
       * a set we know to be incomplete cannot produce a trustworthy remainder,
       * and there is no way to tell WHICH missing agent the unreadable line
       * belonged to. The board keeps its own sentence about the lines it could
       * not read, which is the true thing to say in that state.
       */
      const offline = (() => {
        try {
          if (snap.counts && snap.counts.unreadableLines > 0) return [];
          const seen = new Set(agents.map((a) => a.sessionName));
          const known = register.survey();
          if (!known.ok) return [];
          /* One launchd probe per poll, for #310's sentence below. Empty on
             any failure: could-not-look must never read as switched-off. */
          const switchedOff = create.disabledJobs();
          /* And one for #668's sentence: the jobs launchd says are RUNNING.
             An offline row whose job holds a live process is not a stopped
             agent -- it is an agent running somewhere this board cannot see
             (the board and the supervisor resolved different tmux servers),
             and publishing "not running" about it is the confident negative
             this roster already refuses elsewhere. Empty on any failure:
             could-not-look must never dress a stopped agent in running. */
          const runningNow = create.runningJobs();
          /* 🛑 #127: A LEFTOVER JOB WITH NO FOLDER IS STILL A LEFTOVER, and it
             was the one this list discarded. The gate used to be `k.folder`
             alone, so an agent whose worker folder was deleted while its
             launchd job survived (the shape Splinter's orphaned processes took
             tonight: the directory gone, the work not) fell out of the roster
             entirely -- invisible in the product, and therefore unremovable
             from it, while `create.js` still refused the name because the job
             exists (`:715`). `remove.js` can already clear it (`exists()` gates
             on `jobFor`), so the only thing missing was the row that carries a
             Remove control to it. A folder OR a job is enough to be a leftover
             worth showing; both blocking states are now reachable. */
          return known.agents
            .filter((k) => !k.removed && (k.folder || k.job) && !seen.has(k.name) && !gone.has(k.name))
            .map((k) => {
              try {
              const profile = store.readProfile(k.name) || {};
              /* #668: launchd holds a live process for this job, and this
                 board can see no session for it. Two true facts that
                 disagree, and the disagreement is the story -- so the row
                 refuses the confident "stopped" (state unknown, confidence
                 none) and its sentence names both facts. Gated on the job
                 EXISTING the same way the switched-off sentence is: a
                 running pid for a label whose plist is gone is #127's
                 leftover shape and keeps that sentence. */
              const unseen = !create.jobMissing(k.name) && k.folder
                && runningNow.has(k.name);
              return {
                name: k.shownAs || k.name,
                sessionName: k.name,
                session: null,
                /* #684: TRUE WHEN A RECORD SUPPLIED THE NAME -- readIdentity's
                   own `derived`, not a re-derivation (shownAs cannot answer
                   this: it falls back to the machine name, so it is never
                   empty). This was hardcoded false, so every offline agent
                   WITH a chosen name wore the panel's no-name disclosure
                   about a name somebody chose (witnessed on the first-run
                   journey walk: a just-created agent's panel said it was
                   shown by its machine name). Fail toward false: an identity
                   we could not read keeps the honest disclosure. */
                nameDerived: (() => { try { return readIdentity(k.name).derived === true; } catch { return false; } })(),
                role: profile.role || null,
                /* Nothing to act ON: there is no pane to type into, no session
                   to capture, and every gate downstream reads these. */
                target: null,
                isAgentPane: false,
                isAgentSession: false,
                isFleetSession: false,
                isNamedOurs: true,
                /* #668: "stopped" is a claim, and for the running-unseen row
                   it is a false one -- launchd says otherwise. Unknown at
                   confidence none is the honest pair: we tried to read it and
                   could not, which is exactly what those two values mean. */
                state: unseen ? 'unknown' : 'stopped',
                /* ⚠️ THE FLAG THE SCREEN BRANCHES ON, and it is not derivable
                   from the state: a pane running something that is not Claude
                   is also stopped, and that agent IS up. Stays false on the
                   #668 row too: it answers "is there a pane here to act on",
                   and there is not. */
                running: false,
                stateConfidence: unseen ? 'none' : 'structured',
                /* #310: when the job exists and launchd holds an override
                   against it, the Login Items switch is the story, and it is
                   the one cause a person produced themselves with no screen
                   connecting the two. Said here, once, so every surface that
                   reads `because` says it. */
                because: k.profile === false
                  /* #500: the profile-less stray this row now surfaces. The
                     survey found it on disk with no record behind it, so the
                     one true sentence is that Kosmos does not know it. The
                     promise stops at what removal DOES: remove is not delete
                     (remove.js's own first rule), so removing a stray stops
                     its job and takes it off the board while its files stay,
                     and the name stays taken until those files are gone.
                     "Remove it here to free the name" was the first draft
                     and it was false; freeing a name held by files needs a
                     delete-leftover feature this product does not have yet,
                     carded as the follow-up. */
                  ? (k.folder
                      /* The folder arm is only reachable through the birth
                         receipt, which IS Kosmos's own record; saying "no
                         record" there would be contradicted by the row's
                         own existence. The job arm's tie is the label
                         namespace, which says nothing about whether a
                         receipt exists (a created agent whose folder and
                         profile were deleted lands here too), so its
                         sentence claims only what was checked: no profile,
                         nothing set up. */
                      ? ('Kosmos made this agent once, but only its folder'
                          + (k.job ? ' and an auto-start file remain' : ' remains')
                          + ' on disk. Removing it clears it off the board; its files are never deleted')
                      : 'Kosmos no longer has this agent set up: an auto-start file was found on disk. Removing it stops that file from starting anything and clears it off the board')
                  : (k.job && !k.folder)
                  /* #127: the distinct, broken state this row now surfaces. A
                     job with no folder cannot start (it has nothing to run) and
                     fails on every launchd interval; the only cure is to remove
                     it, which this row finally makes reachable. Said before the
                     switched-off case because it is the stronger fact: a folder
                     that is gone is gone whether or not the job is also off. */
                  ? 'this agent cannot run: its folder is gone but a leftover auto-start file remains. Remove it here to stop it for good'
                  : unseen
                  /* #668: both halves are facts we hold right now, and the
                     sentence claims nothing past them -- not why, not what to
                     do, because this board cannot reach what it cannot see
                     and a promised cure here would be false. No terminal
                     words (Mona Lisa's ruling: a person who installed Kosmos
                     has no reason to have heard "tmux"). */
                  ? 'something is off about this agent: this computer says its background job is running, but no session for it is visible from here, so Kosmos cannot show or reach whatever that job started'
                  : (!create.jobMissing(k.name) && switchedOff.has(k.name))
                    ? 'this agent is not running because its background job was switched off, probably in System Settings under Login Items. Switch it back on there and it can start again'
                    : !create.jobMissing(k.name)
                    /* #671: the one offline cause whose sentence ended at the
                       diagnosis. The agent has a job, is not removed (filtered
                       above) and is not switched off (the branch above), so
                       the launch model is the true next move: nothing to
                       press, it comes back on its own -- and when it does
                       not, this computer holds no reason, and saying THAT is
                       still more than a full stop. Sentence shared with
                       remove.js's restart refusal via create.SELF_STARTS. */
                    ? 'this agent is not running: nothing on this computer has a session for it. '
                      + create.SELF_STARTS.charAt(0).toUpperCase() + create.SELF_STARTS.slice(1)
                      + '; if it stays off, this computer is not saying why'
                    : 'this agent is not running: nothing on this computer has a session for it',
                hasAvatar: Boolean(safeAvatarFor(k.name)),
                profile,
                plannedModelName: plannedFor({ sessionName: k.name, isNamedOurs: true }),
                /* #149/#150: same field the roster rows carry, same meaning.
                   A stopped agent with no launch file is exactly the state
                   the sentence exists for: nothing will start it, and no
                   restart fills the record in. */
                /* #500 note, deliberate: a stray folder-only row carries
                   true here, so its model panel says Kosmos has no record
                   of how it starts (true: no plist, no profile) and points
                   at Found agents, the legitimate way to adopt it back.
                   The card label that renders from this field reads "Made
                   before Kosmos recorded this", which for a birth-recorded
                   stray is loose about provenance; re-labeling that card
                   state belongs with #514's delete-leftover surface work,
                   not a midnight re-plumb of the model panel. */
                neverRecorded: create.jobMissing(k.name),
                /* #310: the Login Items switch. Only meaningful on a stopped
                   agent with a job that EXISTS and is overridden off; the
                   never-recorded case above wins when both could apply. */
                jobSwitchedOff: !create.jobMissing(k.name) && switchedOff.has(k.name),
                /* #668: the card branches on this the way it branches on
                   nothing else in the offline shape -- the one row whose
                   "Not running" pill would be a lie gets the could-not-check
                   treatment instead. */
                jobRunningUnseen: unseen,
                /* #170: same field, same meaning as the running rows. The
                   embedded `profile` above may carry a foreign install's id
                   inside it; THIS field is the one consumers read, and it is
                   already filtered. */
                id: store.agentId(k.name),
                /* #246: which runner this agent runs on, for the switch
                   screen. A stopped agent has no pane to have recorded it,
                   so the profile's provider (written at creation and at
                   every switch) is the record; absent means claude, as
                   everywhere. */
                runner: (profile.provider === 'openai') ? 'codex' : 'claude',
                account: accountOf(k.name),
                commitments: commitments.read(k.name),
                instructions: projects.toldOverride(instructions.staleness(k.name), k.name),
              };
              } catch {
                /* Per ROW: one uncomposable leftover (#500 widened what
                   flows here to names with no profile at all) must not
                   take every profile-backed row off the board with it.
                   The outer catch keeps its job for known()-level
                   failures. Known quiet spot: a dropped row shrinks
                   notRunning with nothing saying a row was withheld;
                   the accounting field belongs with #514's surface work
                   alongside straySweepFailed. */
                return null;
              }
            })
            .filter(Boolean);
        } catch {
          /* ⚠️ A roster we could not extend is the roster we already had. This
             must never be able to take the running agents off the board. */
          return [];
        }
      })();
      const counts = countAgents(agents, snap.counts && snap.counts.unreadableLines, snap.counts && snap.counts.unreadableSamples);
      /* ⚠️ COUNTED SEPARATELY, and the row still adds up: Working plus Idle
         plus the rest is what is RUNNING, and `notRunning` is the remainder of
         `total`. A single "Agents" number covering both would put a figure on
         screen that no arithmetic on the other tiles reaches. */
      /* ⚠️ AND ZERO IS A CLAIM. On a partial read `offline` is deliberately
         empty, and publishing `notRunning: 0` beside it would say "none of
         your agents are stopped" on the one poll where that is unknowable.
         `null` travels as "we could not work it out"; the tile shows it the
         same way it shows a blind poll. */
      const couldNotAccount = Boolean(snap.counts && snap.counts.unreadableLines > 0);
      counts.notRunning = couldNotAccount ? null : offline.length;
      counts.total += offline.length;
      // ⚠️ A MACHINE-LEVEL FACT, DELIBERATELY NOT A PER-AGENT ONE. Whether this
      // computer can reach a Claude subscription is one fact about the machine,
      // not thirteen facts about thirteen agents, and putting it on every card
      // would bury the one thing the reader needs to see.
      //
      // Before this, `subscription.check()` was called in exactly one place --
      // first-run -- so Kosmos checked the connection during onboarding and then
      // never looked again. An agent stranded by a broken sign-in produces no
      // output, lands in `idle`, and reads identically to a healthy agent
      // waiting for work. The board rendered a dead fleet as a resting one.
      //
      // `checkCached` and not `check`: this runs every 5 seconds and the config
      // is ~95KB. See the cache's own comment for why its key is paranoid.
      const connection = subscription.checkCached();
      // Update awareness rides the status tick the screen already polls:
      // poke() returns immediately (once per TTL window, background refresh) and
      // available() is the cached verdict -- the request path never waits on
      // the release host, and a down host just means no toast.
      updates.poke();
      body = JSON.stringify({
        ...snap, agents: agents.concat(offline), counts, connection, version,
        /* 🛑 NO OFFER FROM A BOARD THAT CANNOT TAKE ONE. A Kosmos running from
           its source (this Mac's, under the hand plist) cannot install: the
           install route answers "it updates from git, not from here". But the
           status payload offered anyway, so the moment a release was
           published the toast said Install, the dialog said "closes for a few
           seconds while it updates", and pressing it met a refusal (Josh,
           2026-08-23 13:03: "it says there's no update to install... when I hit
           Update nothing happens"). An offer is a promise the route must be
           able to keep; a source-run board says what it is instead (the
           engine-stale line from #338 covers "newer code is on disk"). */
        update: updates.installedRoot() ? updates.available() : null, updateLook: updates.lastLook(),
        /* #553: the last install attempt this server saw END (a failure;
           a success kills the server first). The overlay reads it to say
           a true sentence instead of spinning. */
        updateAttempt: updates.lastAttempt(),
        /* And the two facts the overlay needs even when the attempt record
           is gone with the old server: the diary's path (from the engine's
           root, never guessed by the page) and THIS server's boot identity,
           so "went away and came back" is a change of boot, never a client
           network hiccup. */
        updateLog: updates.installLog(),
        bootedAt: BOOTED_AT,
        engine: engineFreshness(),
      });
    } catch (err) {
      // Failing loudly beats serving a stale or empty board that looks healthy.
      /* ⚠️ AND SAYING WHAT WENT WRONG BEATS FAILING LOUDLY IN A SENTENCE NOBODY
         CAN ACT ON. `detail` is tmux's own words for the last failed look, kept
         by the engine rather than asked for again here: a second call would
         report a different moment from the one that just failed. */
      res.writeHead(500, { 'content-type': 'application/json' });
      let detail = null;
      try { detail = lastLookProblem(); } catch { detail = null; }
      res.end(JSON.stringify({ error: String(err && err.message), detail: detail || undefined }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }

  // --- avatar: read -------------------------------------------------------
  // ⚠️ The FOURTH name-keyed consumer. The comment introducing the third calls
  // itself "the THIRD", and the `knownAgent` comment that exists specifically to
  // correct an earlier claim of completeness enumerates the set — both were
  // incomplete again, in this same file. Three corrections, each missing one.
  //
  // Measured: with the only card under `angel` being an untied stranger,
  // `GET /api/agent/angel/avatar` served the real agent's stored image at 200.
  // The snapshot sets `hasAvatar: false` so today's board does not request it,
  // but "the real agent's photograph on a stranger's card" is closed at the
  // snapshot and open at the route, and a caller that guesses the URL gets it.
  /**
   * The PERSON's picture. Its own route, its own file, its own namespace.
   *
   * 🛑 IT IS NOT `/api/agent/you/avatar`, and that is the point rather than a
   * tidiness preference. `engine/messages.js` already refuses to let a string
   * match promote an agent to operator, and routing the person's picture
   * through the agent namespace would put that collision in the storage layer:
   * `store.safeKey` strips punctuation, so every spelling of "you" is one key,
   * and an agent genuinely called You could not hold its own picture.
   *
   * ⚠️ The GET is deliberately simpler than the agent one. That branch is
   * hardened against a name a stranger's pane is claiming, a directory that
   * opens and fails on read, and a cancelled <img> load taking the process
   * down; the first does not apply here (there is no name) and the other two
   * are inherited by using the same stream shape. `readFile` rather than a
   * stream because this is one small file read once per page rather than the
   * per-agent, per-render traffic that made the other branch's care necessary.
   */
  if (pathname === '/api/you/avatar' && (req.method === 'GET' || req.method === 'HEAD')) {
    const file = you.picturePath();
    /* #617: "no picture yet" is not an error, and a 404 here logged a console
       failure on EVERY first-run screen (the page probes this with HEAD on
       each paint). 204, no body: the page keys on status 200 for "there is
       a picture", so nothing draws an image that is not there. */
    if (!file) { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      /* Size as well as existence: the write is not atomic, so an interrupted
         save leaves a zero-byte file that is a perfectly good file and a
         perfectly useless picture. Same reasoning as the agent branch. */
      if (err || !buf || !buf.length) { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return; }
      const ext = path.extname(file);
      const type = Object.keys(you.PIC_TYPES).find((k) => you.PIC_TYPES[k] === ext) || 'application/octet-stream';
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(buf);
    });
    return;
  }
  if (pathname === '/api/you/avatar' && (req.method === 'PUT' || req.method === 'DELETE')) {
    if (req.method === 'DELETE') {
      const out = you.removePicture();
      if (!out.ok) { sendJson(res, 400, { error: out.because }); return; }
      sendJson(res, 200, { removed: out.had });
      return;
    }
    readBody(req)
      .then((buf) => {
        const out = you.savePicture(String(req.headers['content-type'] || '').split(';')[0].trim(), buf);
        if (!out.ok) { sendJson(res, 400, { error: out.because }); return; }
        sendJson(res, 200, { ok: true });
      })
      .catch((err) => sendJson(res, (err && err.status) || 400,
        { error: String((err && err.message) || 'we could not read that picture') }));
    return;
  }

  const avatarGet = pathname.match(/^\/api\/agent\/([^/]+)\/avatar$/);
  if (avatarGet && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(avatarGet[1]);
    if (name === null) { sendJson(res, 404, { error: 'that is not a name we can read' }); return; }
    // Same gate as the commitments read, for the same reason: refuse only when
    // a pane on the board is CLAIMING this name without being tied to it.
    if (borrowedName(name)) { sendJson(res, 404, { error: 'no picture for that agent' }); return; }
    let file = null;
    try { file = store.avatarPath(name); } catch { /* invalid name */ }
    if (!file) { sendJson(res, 404, { error: 'no picture for that agent' }); return; }
    const ext = path.extname(file);
    const type = Object.keys(store.ALLOWED_IMAGES).find((k) => store.ALLOWED_IMAGES[k] === ext) || 'application/octet-stream';
    // Three things have to hold here, and each failed a different way before.
    //
    // 1. The status is withheld until we know the read will work. Writing 200
    //    first and catching the error after commits the header, so a file that
    //    is not there answers 200 with an empty body -- a picture reported as
    //    fine, rendering as a broken image, which is the symptom this branch
    //    exists to remove.
    // 2. `open` succeeding is not enough: a directory opens fine and fails on
    //    first read, past the header. So the entry is stat'd and must be a
    //    regular file. `store.avatarPath` prefix-scans the directory and will
    //    return any matching entry, including a directory.
    // 3. `pipeline` rather than `pipe`, because `pipe` neither forwards the
    //    source's errors (an unhandled 'error' event exits the process) nor
    //    destroys the source when the client goes away (60 aborted requests
    //    leaked 49 file descriptors, which walks to EMFILE on a server anyone
    //    can reach).
    fs.stat(file, (statErr, stat) => {
      if (statErr || !stat.isFile() || stat.size === 0) {
        // Size matters as much as existence here. store.saveAvatar writes
        // non-atomically, so an interrupted save leaves a zero-byte file that
        // is a perfectly good file and a perfectly useless picture.
        sendJson(res, 404, { error: 'no picture for that agent' });
        return;
      }
      const stream = fs.createReadStream(file);
      stream.once('readable', () => {
        // The client may already be gone. Deferring the header to 'readable'
        // is what stops an empty 200, but it opens a window in which `res` can
        // be destroyed before we get here -- and `pipeline` THROWS
        // synchronously on a destroyed destination, which from inside this
        // handler is an uncaught exception that exits the process.
        //
        // This is ordinary use, not an attack: a browser cancels in-flight
        // <img> loads routinely, and the detail page re-sets img.src with a
        // fresh ?t= on every render. Cancelled avatar requests killed the
        // board.
        if (res.destroyed || res.writableEnded) { stream.destroy(); return; }
        // Deliberately no content-length. It would have to come from the stat,
        // while the bytes come from a separate read of the same file, and
        // store.saveAvatar writes non-atomically -- so a stat that under-reports
        // yields a clean 200 truncated to the declared length, with the surplus
        // bytes landing on the wire afterwards and desyncing a keep-alive
        // connection. Chunked costs a few bytes and cannot do that.
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        // Belt and braces: the check above closes the window we know about, and
        // a throw here would still be fatal, so it is caught rather than
        // trusted not to happen.
        try {
          pipeline(stream, res, () => {
          // A failure after the header is committed cannot be reported as a
          // status. Destroying the response cuts the connection mid-chunk, so
          // the client sees a broken transfer rather than a clean short body it
          // would treat as the whole picture.
            if (!res.writableEnded) res.destroy();
          });
        } catch {
          stream.destroy();
          if (!res.writableEnded) res.destroy();
        }
      });
      stream.once('error', () => {
        if (!res.headersSent) sendJson(res, 404, { error: 'that picture could not be read' });
        else res.destroy();
      });
    });
    return;
  }

  // --- avatar: set or clear ----------------------------------------------
  if (avatarGet && (req.method === 'PUT' || req.method === 'DELETE')) {
    const name = decodeSegment(avatarGet[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    // Only agents that actually exist. The name is already sanitised against
    // path traversal, but without this you can still accumulate pictures for
    // agents nobody has — junk rather than a hole, and cheap to refuse.
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    if (req.method === 'DELETE') {
      try { sendJson(res, 200, { removed: store.removeAvatar(name) }); }
      catch (err) { sendJson(res, 400, { error: String(err.message) }); }
      return;
    }
    readBody(req)
      .then((buf) => {
        store.saveAvatar(name, req.headers['content-type'], buf);
        sendJson(res, 200, { ok: true });
      })
      // The message is shown to the person verbatim, so it has to say what to
      // do rather than name an exception.
      .catch((err) => sendJson(res, 400, { error: String(err.message) }));
    return;
  }

  // --- the roles a new agent can be ----------------------------------------
  //
  // Read-only and unkeyed: it is a menu, not an agent. It carries the blurb and
  // the suggested first action so the screen cannot invent either — the copy a
  // person reads while choosing has to be the copy the agent is actually
  // created from.
  /* ── skills (#477 per-agent, #478 global) ──────────────────────────────
     Reads answer from disk, the same folders the runtime loads. Writes into
     an agent's own folder carry the LOOSE-TO-NOTICE, EXACT-TO-PERMIT gate
     every instruction-file write carries: any spelling can ask, only an
     exact roster match with isNamedOurs may cause a write into a worker
     directory. The global write needs no roster: the directory belongs to
     the operator, not to any agent. */
  if (pathname === '/api/skills' && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(res, 200, skillsEngine.list(skillsEngine.globalDir()));
    return;
  }
  if (pathname === '/api/skills' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; } catch { throw new Error('we could not read that request'); }
        const made = skillsEngine.add(skillsEngine.globalDir(), { name: body.name, body: body.body });
        sendJson(res, made.ok ? 200 : 400, made);
      })
      .catch((err) => sendJson(res, 400, { ok: false, because: String((err && err.message) || 'we could not read that request') }));
    return;
  }
  const globalSkillRm = pathname.match(/^\/api\/skills\/([^/]+)$/);
  if (globalSkillRm && req.method === 'DELETE') {
    const key = decodeSegment(globalSkillRm[1]);
    if (key === null) { sendJson(res, 400, { ok: false, because: 'that is not a skill name we can read' }); return; }
    const gone = skillsEngine.remove(skillsEngine.globalDir(), key);
    sendJson(res, gone.ok ? 200 : 400, gone);
    return;
  }
  /* The delete carries the same exact-match permit as the write: removing a
     file from a worker folder is a write to it. */
  const agentSkillRm = pathname.match(/^\/api\/agent\/([^/]+)\/skills\/([^/]+)$/);
  if (agentSkillRm && req.method === 'DELETE') {
    const name = decodeSegment(agentSkillRm[1]);
    const key = decodeSegment(agentSkillRm[2]);
    if (name === null || key === null) { sendJson(res, 400, { ok: false, because: 'that is not a name we can read' }); return; }
    const roster = safeRoster();
    if (!Array.isArray(roster) || !roster.some((a) => a && a.sessionName === name && a.isNamedOurs === true)) {
      sendJson(res, 409, { ok: false,
        because: !Array.isArray(roster)
          ? 'we could not check which agents are running, so we will not write into a worker folder on a guess'
          : 'we could not find an agent with exactly this name on this computer' });
      return;
    }
    const gone = skillsEngine.remove(skillsEngine.agentDir(create.workerDir(name)), key);
    sendJson(res, gone.ok ? 200 : 400, gone);
    return;
  }
  const agentSkills = pathname.match(/^\/api\/agent\/([^/]+)\/skills$/);
  if (agentSkills && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(agentSkills[1]);
    if (name === null) { sendJson(res, 400, { ok: false, because: 'that is not a name we can read' }); return; }
    const dir = create.workerDir(name);
    if (!fs.existsSync(dir)) { sendJson(res, 404, { ok: false, because: 'there is no agent by that name on this computer' }); return; }
    sendJson(res, 200, skillsEngine.list(skillsEngine.agentDir(dir)));
    return;
  }
  if (agentSkills && req.method === 'POST') {
    const name = decodeSegment(agentSkills[1]);
    if (name === null) { sendJson(res, 400, { ok: false, because: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; } catch { throw new Error('we could not read that request'); }
        const roster = safeRoster();
        if (!Array.isArray(roster) || !roster.some((a) => a && a.sessionName === name && a.isNamedOurs === true)) {
          sendJson(res, 409, { ok: false,
            because: !Array.isArray(roster)
              ? 'we could not check which agents are running, so we will not write into a worker folder on a guess'
              : 'we could not find an agent with exactly this name on this computer' });
          return;
        }
        const made = skillsEngine.add(skillsEngine.agentDir(create.workerDir(name)), { name: body.name, body: body.body });
        sendJson(res, made.ok ? 200 : 400, made);
      })
      .catch((err) => sendJson(res, 400, { ok: false, because: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  /* ── the working rules, consented (#539) ─────────────────────────────────
     GET answers the banner and the dialog (which sections are missing, the
     exact span a click would write, and the hash that click must present);
     the two POSTs are the click and the Not-now. NOTHING here writes
     without the click: the GET is pure planning, and the plan the dialog
     shows is the composition the click writes, proven by hash (a file that
     changed in between refuses with look-again). */
  const doc = pathname.match(/^\/api\/agent\/([^/]+)\/doctrine$/);
  if (doc && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(doc[1]);
    if (name === null) { sendJson(res, 400, { ok: false, because: 'that is not a name we can read' }); return; }
    if (!fs.existsSync(create.workerDir(name))) { sendJson(res, 404, { ok: false, because: 'there is no agent by that name on this computer' }); return; }
    const st = doctrine.status(name);
    sendJson(res, 200, {
      state: st.state,
      because: st.because || null,
      carried: st.carried === undefined ? null : st.carried,
      currentVersion: st.currentVersion,
      declined: st.declined === true,
      sections: (st.sections || []).map((s) => s.heading),
      span: st.spanNext || null,
      hash: st.hash || null,
    });
    return;
  }
  const docGo = pathname.match(/^\/api\/agent\/([^/]+)\/doctrine\/(refresh|not-now)$/);
  if (docGo && req.method === 'POST') {
    const name = decodeSegment(docGo[1]);
    if (name === null) { sendJson(res, 400, { ok: false, because: 'that is not a name we can read' }); return; }
    if (docGo[2] === 'not-now') {
      sendJson(res, 200, doctrine.decline(name));
      return;
    }
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; } catch { throw new Error('we could not read that request'); }
        /* The per-agent click REQUIRES the plan it consented to (Angel's
           review): without the hash, "the click writes what the dialog
           showed" would be a claim the code does not enforce. The fleet
           route is the deliberate name-level exception, stated there. */
        if (typeof body.hash !== 'string' || !body.hash) {
          sendJson(res, 400, { state: 'could_not', because: 'the click must carry the plan it consented to; reopen the dialog' });
          return;
        }
        const got = doctrine.refresh(name, safeRoster(), { expectHash: body.hash });
        sendJson(res, 200, got);
      })
      .catch((err) => sendJson(res, 400, { ok: false, because: String((err && err.message) || 'we could not read that request') }));
    return;
  }
  if (pathname === '/api/doctrine/fleet' && (req.method === 'GET' || req.method === 'HEAD')) {
    /* The fleet dialog's list, computed BEFORE any click: which agents
       would change and which would not and why, by name (Mona Lisa's
       ruling: the click is consent for the listed names only). */
    const roster = safeRoster();
    if (!Array.isArray(roster)) { sendJson(res, 200, { ok: false, because: 'we could not check which agents are running' }); return; }
    const rows = roster.filter((a) => a && a.isNamedOurs === true).map((a) => {
      const st = doctrine.status(a.sessionName);
      return {
        name: a.name || a.sessionName,
        sessionName: a.sessionName,
        state: st.declined === true && st.state === 'refresh' ? 'declined' : st.state,
        because: st.because || null,
        sections: (st.sections || []).map((s) => s.heading),
      };
    });
    sendJson(res, 200, { currentVersion: require('./engine/defaults').DOCTRINE_VERSION, agents: rows });
    return;
  }
  if (pathname === '/api/doctrine/refresh-fleet' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; } catch { throw new Error('we could not read that request'); }
        const names = Array.isArray(body.names) ? body.names.filter((n) => typeof n === 'string') : [];
        if (!names.length) { sendJson(res, 400, { ok: false, because: 'no agents were named, and a fleet click is consent for named agents only' }); return; }
        const roster = safeRoster();
        const verdicts = names.map((name) => {
          /* A fleet click never overrides a per-agent Not now (Mona Lisa's
             ruling): the list showed those names as staying, so writing to
             one would be a write nobody consented to. */
          let profile = {};
          try { profile = store.readProfile(name) || {}; } catch { profile = {}; }
          if (profile.doctrineDeclined === require('./engine/defaults').DOCTRINE_VERSION) {
            return { name, state: 'declined' };
          }
          return { name, ...doctrine.refresh(name, roster) };
        });
        sendJson(res, 200, { verdicts });
      })
      .catch((err) => sendJson(res, 400, { ok: false, because: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  if (pathname === '/api/roles' && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(res, 200, {
      // The models an agent can be created on, from the engine's own list,
      // so the menu and the flag the job runs with cannot drift.
      /* ⚠️ `provider` TRAVELS WITH EACH ROW (#1026). The create screen reads
         this straight into its dropdown, so without it a GPT agent is offered
         four Claude models. Serving the fact beats the screen deriving it:
         a client-side mapping of model to vendor is a second definition of
         something the engine already knows. */
      models: create.MODELS.map((m) => ({
        key: m.key, provider: m.provider, label: m.label,
        default: m.default === true, why: m.why || '',
      })),
      // The third radio's prefill, served whole so the screen and the
      // engine cannot hold two versions of the example. No label field:
      // that is the person's own words, gated at create.
      /* #591: the working rules every agent gets, served whole so the create
         form can show exactly what will follow a person's own words. */
      defaults: require('./engine/defaults').block(),
      own: (() => {
        const o = roles.byKey('own');
        return o ? { key: o.key, blurb: o.blurb, firstAction: o.firstAction, instructions: o.instructions } : null;
      })(),
      // ⚠️ MENU roles only: `own` (menu: false) prefills the third radio's
      // editor and must not appear in the grouped list or raise any count.
      roles: roles.ROLES.filter((r) => r.menu !== false).map((r) => ({
        key: r.key, label: r.label, blurb: r.blurb, firstAction: r.firstAction,
        // The template itself, {{NAME}} and all: the details screen prefills
        // its editor from this so the words a person reads before creating
        // are the words the agent boots from. An untouched editor sends
        // nothing back and the engine writes this same template server-side;
        // only edited text travels.
        instructions: r.instructions,
        // The catalogue's section, so the picker's menu can group without a
        // second copy of the grouping living in the page.
        group: r.group || null,
        // ⚠️ The limit travels WITH the role. A caution that lives only in the
        // agent's instruction file is read after the person has chosen, which
        // is exactly too late for the two roles that have one.
        caution: r.caution || null,
      })),
    });
    return;
  }

  // --- create an agent -----------------------------------------------------
  //
  // ⚠️ The most powerful route here, and the reasoning for shipping it on a
  // server with no login is worth stating rather than assuming.
  //
  // ⚠️ THIS COMMENT USED TO SAY "it does NOT cross a new line", on the argument
  // that the server already lets a local process rewrite an agent's boot file.
  // That was FALSE, and measurably so: every other write is PUT or DELETE, which
  // a browser always preflights, so this was the first route on this server a
  // page on another website could actually reach. Running that request created a
  // worker directory and installed a launchd job on this machine. See
  // `crossSiteWrite`, which exists because of it.
  //
  // What it adds beyond the writes that were already here is PERSISTENCE: a
  // launchd job outlives the session that made it, and starts Claude with
  // `--dangerously-skip-permissions` at every login. So the containment is in
  // `engine/create`: the name is validated hard and early, no caller-supplied
  // path is honoured, every command is `execFile` with an argument array, and
  // any failure rolls the whole thing back rather than leaving half of it.
  //
  // ⚠️ Three things hold this up, not two: the loopback bind, the Host check,
  // and the cross-site guard. It should be behind a login the moment one
  // exists. The honest summary is that it is the largest thing here and it is
  // contained, not that it is safe.
  if (pathname === '/api/agents' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try {
          body = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          // No error code: the catch below answers in our own words whatever
          // this is, and a code nothing reads is a hint that something does.
          throw new Error('we could not read that request');
        }

        /**
         * ⚠️ The projects the new agent should join are validated HERE,
         * BEFORE the engine writes anything: a refusal after the folder
         * exists would need the rollback nobody should pay for a typo. The
         * ATTACH happens after CREATED and is non-gating, exactly like the
         * project-create route's own telling: a recorded agent whose
         * membership write failed is a real, reportable state, never a
         * reason to un-make the agent.
         */
        let wantProjects;
        if (body.projects !== undefined) {
          if (!Array.isArray(body.projects)
              || body.projects.some((p) => typeof p !== 'string' || !p.trim())) {
            sendJson(res, 400, { error: 'projects has to be a list of project ids' });
            return;
          }
          wantProjects = [...new Set(body.projects.map((p) => p.trim()))];
          // ⚠️ Wrapped separately: an UNREADABLE projects store is OUR fact
          // (500, the engine's own sentence), not a malformed request, and
          // the route's shared catch would have answered "we could not read
          // that request" about a file the person never touched.
          let known;
          try {
            known = projects.readAll();
          } catch (err) {
            const code = (err && err.code === 'UNREADABLE') ? 500 : 400;
            sendJson(res, code, { error: String((err && err.message) || 'we could not read your projects') });
            return;
          }
          const missing = wantProjects.filter((id) => !known.some((p) => p.id === id));
          if (missing.length) {
            sendJson(res, 400, { error: `there is no project by that name (${missing.join(', ')})` });
            return;
          }
        }

        /* 🔑 THE FIRST AGENT BRINGS ITS OWN HOME (#166), MADE BEFORE THE AGENT
           IS (#732). It used to be created AFTER createAgent returned, i.e.
           after the session was already running, so the home's block reached
           the instruction file through the later sync, three seconds after
           the session started: every first agent was born reading "Kosmos
           put it on Getting started. Restart it so it knows" (Pete,
           2026-08-24 21:04). Made here, its id rides `projects` into the
           creation and the block is composed at birth, so the later sync finds
           the same bytes and writes nothing. Once EVER, by flag (remove()
           deletes the record outright, so an empty store cannot tell "never
           had one" from "the person removed it"). If the creation then fails,
           the seed is rolled back below and the flag is never written. */
        const projectsToJoin = Array.isArray(wantProjects) ? wantProjects.slice() : [];
        let home = null;
        const seededFlag = path.join(require('./engine/store').ROOT, 'seeded-project.json');
        try {
          if (!fs.existsSync(seededFlag) && projects.readAll().length === 0) {
            home = projects.create({
              name: 'Getting started',
              agents: [],
              roster: safeRoster(),
              /* kosmos#1005: the removability sentence is NOT here any more, and it
                 was not moved -- the room note below already said it, better
                 ("Delete this project whenever you like, it is only here to show
                 you around"). This was a second copy of one fact.
                 🔑 Why it had to go from THIS side specifically: the project
                 description now sits behind a closed disclosure on the title, so
                 a sentence living only here is invisible to a new person, who is
                 exactly who it was written for. The room note is in the
                 conversation, is not collapsible, and is the first thing read. */
              description: 'Kosmos made this so your first agent has somewhere to work with you. '
                + 'Post below and everyone on it answers here.',
              made: { via: 'kosmos' },
            });
            projectsToJoin.push(home.id);
          }
        } catch { home = null; /* a first screen a person fills themselves is the fallback, not a failure */ }
        const result = create.createAgent({
          name: body.name, role: body.role,
          label: body.label, instructions: body.instructions, model: body.model,
          // Which provider it runs on (#245). Absent means Anthropic, which
          // is what every existing caller means; the engine validates and
          // refuses anything it does not know.
          provider: body.provider,
          // Which Claude account it runs on. Absent is the default account,
          // which is what every agent already made on this machine has.
          account: body.account,
          reportsTo: body.reportsTo,
          // Validated above; composed into the file BEFORE the session starts
          // (#323), so the addAgent below finds the block already there.
          projects: projectsToJoin,
        });
        /* #238. Only on a real creation, and never in a way that can affect
           one: `agentCreated` returns nothing, so this cannot be awaited, and
           every failure inside it is swallowed. The box on the form is one
           agent's answer; the standing setting in Settings beats it. */
        if (result.outcome === create.OUTCOME.CREATED) {
          ping.agentCreated({ wanted: body.tellKosmos !== false });
        }
        // REFUSED is the caller's fault (a bad name, a duplicate); PARTIAL is
        // ours, and it is a 200 because the thing half-happened and the caller
        // needs the detail rather than an error.
        const code = result.outcome === create.OUTCOME.REFUSED ? 400 : 200;
        if (result.outcome === create.OUTCOME.CREATED && projectsToJoin.length) {
          // One roster read for the whole request, same rule as the project
          // routes: syncAgent refuses to write without an exact match in it.
          const roster = safeRoster();
          // ⚠️ `result.name`, the slug the engine PUBLISHES for exactly this
          // reason (its comment: act on the machine name). The first version
          // read `result.sessionName`, a field the CREATED result has never
          // carried, so every attach refused with "choose an agent" while the
          // suite stayed green -- nothing exercised this route with projects.
          // The route test now creates through here and asserts added: true.
          result.projects = projectsToJoin.map((id) => {
            try {
              projects.addAgent(id, result.name, roster, { via: isViaScreen(req) ? 'screen' : 'process' });
              return home && id === home.id ? { id, added: true, seeded: true } : { id, added: true };
            } catch (err) {
              return { id, added: false, because: String((err && err.message) || 'we could not put it on that project') };
            }
          });
          // ⚠️ NO syncAgent here, on purpose. This code runs milliseconds
          // after `launchctl bootstrap` returns, which is the one moment a
          // tell is near-guaranteed to fail: the tmux session and its
          // @kosmos_agent claim do not exist yet (create.js's own comment:
          // they happen inside the job, after this function has returned).
          // Syncing now STORED could_not against every create-with-project.
          // So membership is recorded, told is honestly `not_tried`, and the
          // creation screen re-fires the tell through the member route the
          // moment the board can actually see the agent running.
          for (const p of result.projects) {
            if (p.added) p.told = { state: projects.TOLD.NOT_TRIED, because: null };
          }
        }
        // The home's furniture, only once the agent exists (#166): the room
        // note in Kosmos's own voice, three genuinely-undone tasks (unassigned
        // on purpose: a task claimed FOR an agent is an assignment nobody
        // made), and the once-ever flag. A failed creation rolls the seed back
        // instead, so a store never carries a memberless home nobody made.
        if (home) {
          if (result.outcome === create.OUTCOME.CREATED) {
            try {
              messages.roomNote(home.id,
                'This is where you talk to everyone on a project at once. Whatever you write here, every agent on the project gets. Delete this project whenever you like, it is only here to show you around.');
            } catch { /* the note is furniture */ }
            try {
              const tasksEngine = require('./engine/tasks');
              tasksEngine.create(home.id, { sentence: 'Say hello to everyone in the conversation' }, null);
              tasksEngine.create(home.id, { sentence: 'Give ' + (result.shown || result.name) + ' something small to do' }, null);
              tasksEngine.create(home.id, { sentence: 'Put your next agent on this project too' }, null);
            } catch { /* tasks are furniture the person can also make; the project stands without them */ }
            try { fs.writeFileSync(seededFlag, JSON.stringify({ at: new Date().toISOString(), project: home.id }) + '\n', 'utf8'); } catch { /* next first agent seeds again; harmless */ }
          } else {
            try { projects.remove(home.id); } catch { /* best effort; the store's own guards cover the rest */ }
          }
        }
        sendJson(res, code, result);
      })
      // ⚠️ OUR sentence, never the raw message. The first version called
      // `errorAnswer`, which does not exist on this branch — it is from another
      // one — so the catch path would have thrown at runtime, and the suite went
      // green because nothing exercised it. A route's error path needs a test as
      // much as its happy path does.
      .catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
    return;
  }

  /**
   * --- removing an agent ---------------------------------------------------
   *
   * ⚠️ REMOVE IS NOT DELETE, and every route here is shaped by that. Removing
   * takes an agent off this board and stops it coming back; it does not touch
   * one byte of what is on disk. That is what makes RESTORE possible, and
   * restore is the reason the removal is safe to offer at all.
   *
   * ⚠️ `GET` returns the QUESTION the confirmation asks — not a list of steps.
   * Josh's wording, deliberately: a person removing an agent does not want to
   * read that a launchd job will be disabled. They want to be asked once, by
   * name, and told nothing of theirs is being destroyed. The screen must not
   * compose that sentence itself, because a screen that writes its own
   * description of the work can drift from the work.
   *
   * ⚠️ It removes agents this product did NOT create, on purpose. An earlier
   * design refused them, reasoning that whatever set an agent up is what should
   * take it away. Josh reversed it: managing the fleet you actually have is the
   * point of the product, and an agent it cannot manage is a hole, not a
   * safeguard. What survives from that caution is that nothing of theirs is
   * deleted — a foreign job is DISABLED and its exact label recorded, so
   * restore puts back precisely what was taken away.
   */
  const rm = pathname.match(/^\/api\/agent\/([^/]+)\/removal$/);
  if (rm && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(rm[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
  /**
   * ⚠️ GUARDED, like every other engine call in this file.
   *
   * These four are the only routes that STOP things, and they were the four
   * handed straight to the socket. `plan` reads the filesystem (the removed
   * list, the plists, the agent's instruction file for its display name),
   * `remove` and `restore` shell out to launchctl and tmux, and any of that can
   * throw. An uncaught throw here does not fail the request, it exits the
   * process -- so the board goes down at the exact moment somebody is halfway
   * through removing an agent, with no way to see what happened. The convention
   * is stated a hundred lines below at `/api/agent/:name/commitments`, and
   * these routes were written without it.
   */
    let plan;
    try { plan = removal.plan(name); }
    catch (err) { sendJson(res, 500, { error: 'we could not work out whether this agent can be removed', detail: String(err && err.message || err) }); return; }
    sendJson(res, plan.ok ? 200 : 400, plan);
    return;
  }
  if (rm && req.method === 'DELETE') {
    const name = decodeSegment(rm[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    let done;
    // ⚠️ Guarded for the reason given on the route above, and it matters most
    // here: this is the call that has already disabled a launchd job by the
    // time anything downstream can throw.
    try { done = removal.remove(name); }
    catch (err) { sendJson(res, 500, { error: 'the removal failed partway and we cannot tell you how far it got', detail: String(err && err.message || err) }); return; }
    // ⚠️ A PARTIAL answers 200, deliberately: the request was understood and
    // acted on, and what happened is in the body, which is where a removal's
    // outcome has to be read anyway (a removal that half-worked is not an
    // error, it is a state). The screen branches on `outcome` rather than on
    // status for exactly that reason.
    sendJson(res, done.outcome === removal.OUTCOME.REFUSED ? 400 : 200, done);
    return;
  }

  // --- putting one back ------------------------------------------------------
  //
  // ⚠️ This route is the whole reason the removal is allowed to be casual. If
  // restore did not genuinely work, "remove" would be a destructive act wearing
  // a light confirmation, which is the exact defect this codebase keeps
  // cataloguing. It re-enables the SPECIFIC label that was disabled — read back
  // from the record, never re-derived — so a foreign agent goes back onto the
  // job that actually starts it.
  /* #514: delete what is left of an agent, the separate verb that frees a
     name. `remove` never deletes (its first rule), so a removed agent's name
     stays taken by its folder or job file; this is the way through. GET
     plans in the engine's words (the confirmation paints those, never its
     own); DELETE acts, with the typed name when the plan asked for one. */
  const lo = pathname.match(/^\/api\/agent\/([^/]+)\/leftover$/);
  if (lo && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(lo[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    let plan;
    try { plan = leftover.plan(name); }
    catch (err) { sendJson(res, 500, { error: 'we could not work out what is left of this agent', detail: String(err && err.message || err) }); return; }
    /* 200 whatever the plan says: every agent page asks this question, and
       "not a leftover" is a true answer to it, not a failed request. A 400
       here logged a console error on every living agent's page and turned
       the release page gate red (Angel, 2026-08-24). The page reads
       `plan.ok`, never the status. DELETE keeps 400 for a refusal. */
    sendJson(res, 200, plan);
    return;
  }
  if (lo && req.method === 'DELETE') {
    const name = decodeSegment(lo[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((buf) => {
        let body = {};
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; } catch { body = {}; }
        let done;
        try { done = leftover.del(name, { typed: body.typed }); }
        catch (err) { sendJson(res, 500, { error: 'the delete failed partway and we cannot tell you how far it got', detail: String(err && err.message || err) }); return; }
        sendJson(res, done.outcome === leftover.OUTCOME.REFUSED ? 400 : 200, done);
      })
      .catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
    return;
  }

  const rs = pathname.match(/^\/api\/agent\/([^/]+)\/restore$/);
  if (rs && req.method === 'POST') {
    const name = decodeSegment(rs[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    let back;
    try { back = removal.restore(name); }
    catch (err) { sendJson(res, 500, { error: 'we could not put this agent back', detail: String(err && err.message || err) }); return; }
    sendJson(res, back.outcome === removal.OUTCOME.REFUSED ? 400 : 200, back);
    return;
  }

  /**
   * Start an agent's window over, so it reads its instructions again.
   *
   * 🔑 THE ACTION THAT MAKES TWO SIGNALS ACTIONABLE. The board has been telling
   * people an agent is "running on older instructions" since the staleness work
   * landed, and offering nothing to do about it — half a signal. Adding an agent
   * to a project edits its instructions, so this is the common case rather than
   * an exotic one.
   *
   * ⚠️ POST, and it takes no body. There is nothing to choose: an agent either
   * restarts or it does not, and a body would invite a caller to pass a name
   * that disagrees with the path.
   */
  /* Compact and clear (#214): the two Memory controls that had no engine.
     Each types one Claude Code slash command into the agent's pane and
     submits it, through the same delivery as a message: no envelope and no
     operator line (Angel's note: "[message from your operator] /compact" is
     not a command Claude runs), and the pane has to be idle-shaped, so a
     busy agent answers could_not with a sentence, which is right here too:
     compacting mid-task is worse than waiting. Nothing is recorded in any
     thread; these are not messages, and a row reading "/clear" would be a
     lie about what the person said. The verdict is the answer. */
  const ctx = pathname.match(/^\/api\/agent\/([^/]+)\/(compact|clear)$/);
  if (ctx && req.method === 'POST') {
    const name = decodeSegment(ctx[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    const command = '/' + ctx[2];
    let delivery;
    try { delivery = chat.deliver(name, command, safeRoster(), undefined, undefined); }
    catch (err) { sendJson(res, 500, { error: 'we could not reach this agent', detail: String(err && err.message || err) }); return; }
    sendJson(res, delivery.state === chat.DELIVERY.COULD_NOT ? 409 : 200, { command: ctx[2], delivery });
    return;
  }

  const rst = pathname.match(/^\/api\/agent\/([^/]+)\/restart$/);
  if (rst && req.method === 'POST') {
    const name = decodeSegment(rst[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    let out;
    try { out = removal.restart(name); }
    catch (err) { sendJson(res, 500, { error: 'we could not restart this agent', detail: String(err && err.message || err) }); return; }
    sendJson(res, out.outcome === removal.OUTCOME.REFUSED ? 400 : 200, out);
    return;
  }

  /**
   * Point an agent at a different model.
   *
   * 🛑 TWO WRITES AND THE SECOND IS NOT OPTIONAL. `setModel` rewrites the
   * startup file; `restart` is what makes launchd read it. Shipping the first
   * without the second would be a control that reports success and changes
   * nothing until the next reboot — the exact class of defect this app spends
   * its comments on.
   *
   * ⚠️ THE RESTART'S VERDICT IS CARRIED, NOT SWALLOWED. If the file changed and
   * the window could not be closed, the person is running the OLD model and has
   * been told the new one is set. That is the one outcome worth reporting
   * loudly, so it comes back as its own state rather than as a success.
   */
  /**
   * Switch an agent between providers (#246). The same two-writes shape as
   * the model route below, for the same reason: `setProvider` rewrites the
   * startup file, `restart` is what makes launchd read it, and the
   * restart's verdict is carried rather than swallowed. What the agent
   * keeps needs no route work at all -- its name, id, face, instructions,
   * folder, and everything it has done stay where they are, shared not
   * copied, which is Josh's ruling and the whole design.
   */
  const prov = pathname.match(/^\/api\/agent\/([^/]+)\/provider$/);
  if (prov && req.method === 'POST') {
    const name = decodeSegment(prov[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((raw) => {
        let body = null;
        try { body = JSON.parse(raw || 'null'); } catch { body = null; }
        /* #1373: the account the person picked rides through. Absent, the
           engine states a default and names it, exactly as before. */
        const wrote = create.setProvider(name, body && body.provider, {
          accountDir: body && typeof body.account === 'string' ? body.account : null,
          /* WHETHER A PERSON CHOSE, sent separately from WHICH. The account is
             honoured whenever the page shows the menu; only this decides whether
             the answer says "you picked" rather than "we picked and are telling
             you". Defaults false, so a caller that says nothing gets the modest
             sentence rather than the flattering one. */
          pickedByPerson: !!(body && body.picked === true),
        });
        if (wrote.outcome === create.OUTCOME.REFUSED) {
          sendJson(res, 400, { outcome: 'refused', because: wrote.because });
          return;
        }
        let back;
        try { back = removal.restart(name); }
        catch (err) { back = { outcome: 'partial', because: String(err && err.message || err), steps: [] }; }
        const ok = back.outcome === removal.OUTCOME.RESTARTED;
        const label = wrote.provider === 'openai' ? 'OpenAI' : 'Claude';
        /* The dropped choices are SAID, not implied: a person who picked a
           model or an account deserves to hear it did not cross, in the
           sentence that reports the switch, not on a later surprise. */
        const dropped = wrote.provider === 'openai'
          ? [wrote.dropped.model ? 'its Claude model choice does not cross (OpenAI picks its own)' : '',
            wrote.dropped.account ? 'and it leaves its Claude account behind' : '']
          : ['it starts on your main Claude account and Claude’s own default model until you change them'];
        const droppedWords = dropped.filter(Boolean).join(' ');
        /* WHICH OpenAI sign-in it landed on (#1211). Josh switched an agent,
           read "API key ending WWUA" elsewhere on the screen, and could not
           tell whether that was the account his agent was now using: the
           switch USED to carry no account, so it always landed on this
           computer's default OpenAI sign-in, and nothing said which that was.
           🛑 BOTH HALVES ARE DIFFERENT NOW: a person can choose, and the
           sentence below says whether they did. The reason the sentence exists
           at all is still the original complaint above.
           ⚠️ Said only when the engine actually looked. `openaiAccount` is
           null on a switch back to Claude and under dry-run, and naming an
           account nobody read would be the invention this route already
           refuses elsewhere. */
        const acct = wrote.openaiAccount;
        /* #1373: "you picked this" and "we picked this and are telling you"
           are different promises, so they get different sentences. Saying
           "the one you picked" when nobody picked would be the invention this
           route refuses elsewhere; saying nothing when they DID pick loses the
           confirmation that their choice was honoured. */
        const whichAcct = acct
          ? (acct.email ? ` (${acct.email})` : acct.keyTail ? ` (API key ending ${acct.keyTail})` : '')
          : '';
        /**
         * One place the account is named, two tenses.
         *
         * ⚠️ THE TENSE SPLIT IS THE POINT AND IS PRESERVED, not smoothed away: the
         * OK branch says the agent RUNS on it, the partial branch says it WILL when
         * it restarts, because there the plist already carries the chosen home but
         * the agent has not moved to it yet and the sentence beside it says so.
         * What was duplicated is the other axis -- picked-versus-default -- which
         * was written out four times over the same `whichAcct`. Three separate
         * reviews raised the repetition; the risk of consolidating was always that
         * somebody would collapse the tenses too, so they are parameters here
         * rather than an accident of copying.
         */
        const runsOn = (tense) => (acct
          ? (acct.chosen
            ? ` ${tense} the OpenAI sign-in you picked${whichAcct}.`
            : ` ${tense} your OpenAI sign-in${whichAcct}.`)
          : '');
        const landedOn = runsOn('It runs on');
        sendJson(res, 200, {
          outcome: ok ? 'changed' : 'partial',
          provider: wrote.provider,
          because: ok
            ? `${label} it is. Everything it knows and everything it has done stays. `
              + (droppedWords ? `${droppedWords.charAt(0).toUpperCase()}${droppedWords.slice(1)}. ` : '')
              + 'It is starting again now, and it will look idle until you say something to it.'
              + landedOn
            : `We saved the switch to ${label}, but could not start it again: ${back.because} `
              + 'It is still running as before until it restarts.'
              /* ⚠️ FUTURE TENSE HERE, NOT `landedOn`'S PRESENT. The plist already
                 carries the chosen home, so the account IS decided, but the agent has
                 NOT moved to it yet: the sentence one line up says it is still running
                 as before. Reusing "It runs on X" would contradict that in the same
                 paragraph, and this is the branch where something already went wrong,
                 which is where a confident-sounding sentence costs most. */
              + runsOn('When it restarts it will run on'),
          steps: back.steps || [],
        });
      })
      .catch((err) => sendJson(res, (err && err.status) || 400,
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  const mdl = pathname.match(/^\/api\/agent\/([^/]+)\/model$/);
  if (mdl && req.method === 'POST') {
    const name = decodeSegment(mdl[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    /* ⚠️ `readBody`, which is what every other POST in this file uses. The
       first version called `readJson` — a function that does not exist — so the
       route threw an uncaught ReferenceError and the request simply never
       answered. Caught by its own test hanging for forty-five seconds rather
       than failing, which is what a crashed handler looks like from outside. */
    readBody(req)
      .then((raw) => {
        let body = null;
        try { body = JSON.parse(raw || 'null'); } catch { body = null; }
        const wrote = create.setModel(name, body && body.model);
        if (wrote.outcome === create.OUTCOME.REFUSED) {
          sendJson(res, 400, { outcome: 'refused', because: wrote.because });
          return;
        }
        let back;
        try { back = removal.restart(name); }
        catch (err) { back = { outcome: 'partial', because: String(err && err.message || err), steps: [] }; }
        const ok = back.outcome === removal.OUTCOME.RESTARTED;
        sendJson(res, 200, {
          outcome: ok ? 'changed' : 'partial',
          model: wrote.model,
          because: ok
            /* 🔑 IT NAMES THE NEXT ACTION. A restarted agent has done nothing,
               so every reading on its page reads as empty until somebody speaks
               to it — and Josh read that as the change having failed, twice.
               Saying so here is cheaper than a person discovering it. */
            ? `${wrote.model.label} it is. It is starting again now, and it will look idle until you say something to it.`
            /* ⚠️ The file is already written, so this says what is TRUE: the
               choice is saved and the agent has not picked it up yet. */
            : `We saved ${wrote.model.label}, but could not start it again: ${back.because} `
              + 'It is still running the old one until it restarts.',
          steps: back.steps || [],
        });
      })
      .catch((err) => sendJson(res, (err && err.status) || 400,
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  /**
   * The Claude accounts on this computer, and whether each one can hold an
   * agent's history.
   *
   * ⚠️ `memoryShared` travels with every row rather than being computed on the
   * screen: the page must not be able to disagree with the engine about which
   * accounts are safe to move somebody onto.
   */
  /* What "Delete your history" would remove, so the screen can say it before
     it asks. The counts come from the engine, never from the page: a control
     with no undo must not describe its own scope in its own words. */
  /* The standing answer for #238, so Settings can turn it off for good. Same
     shape as the other preference routes: GET to learn it, PUT to set it, and
     the READ is echoed back after a write rather than the request body. */
  if (pathname === '/api/ping-setting' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { const r = ping.read(); sendJson(res, 200, { on: r.on, ok: r.ok }); }
    catch { sendJson(res, 500, { error: 'that setting could not be read' }); }
    return;
  }
  if (pathname === '/api/ping-setting' && req.method === 'PUT') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const saved = ping.setOn(body.on);
        if (!saved.ok) { sendJson(res, 400, { error: saved.because }); return; }
        const r = ping.read();
        sendJson(res, 200, { on: r.on, ok: r.ok });
      })
      .catch(() => sendJson(res, 400, { error: 'we could not save that setting' }));
    return;
  }

  /* The outbound "something happened" setting (engine/notify.js): the seam a
     phone notification rides on, off by default. Same two routes as the
     created ping, same shape. */
  /* ---- Plus (the relay service): the Settings tab's seam over
     engine/remote.js (#464). READ is always honest; the write routes are
     real but the page renders them only when a relay is configured,
     because sign-up cannot complete before DNS and certificates exist and
     a working-looking button that cannot work is the dead-button rule
     broken. Since #722 the real relay is the DEFAULT (the domain is ruled
     and the box serves it), so "configured" is true with nothing set; the
     answer comes from the engine, never re-derived here (#790). */
  if (pathname === '/api/remote' && (req.method === 'GET' || req.method === 'HEAD')) {
    try {
      const r = remote.read();
      sendJson(res, 200, {
        status: remote.status(),
        on: r.on === true,
        ok: r.ok !== false,
        /* Configured is a FACT about this machine, asked of the ONE place
           that decides which relay the connector dials (env, saved, or the
           production default). The page gates the whole flow on it; on
           served 0.5.24 this line re-derived it from saved-or-env, missed
           the default, and told every stranger "Sign-up is not open yet"
           while the connector dialed fine (#790). */
        configured: remote.configured(),
        email: r.email || '',
        enrolled: remote.enrolled() === true,
      });
    } catch { sendJson(res, 500, { error: 'we could not read the Plus state' }); }
    return;
  }
  if (pathname === '/api/remote' && req.method === 'PUT') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const saved = remote.setOn(body.on);
        if (!saved.ok) { sendJson(res, 400, { error: saved.because }); return; }
        try { remote.ensure(); } catch { /* status says what happened */ }
        sendJson(res, 200, { status: remote.status(), on: remote.read().on === true });
      })
      .catch(() => sendJson(res, 400, { error: 'we could not save that setting' }));
    return;
  }
  if (pathname === '/api/remote/setup-start' && req.method === 'POST') {
    readBody(req)
      .then(async (buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const email = String(body.email || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          sendJson(res, 400, { error: 'that does not look like an email address' });
          return;
        }
        const got = await remote.setupStart(email);
        if (!got.ok) { sendJson(res, 400, { error: got.because }); return; }
        sendJson(res, 200, { ok: true });
      })
      .catch(() => sendJson(res, 400, { error: 'we could not start the sign-up' }));
    return;
  }
  if (pathname === '/api/remote/setup-complete' && req.method === 'POST') {
    readBody(req)
      .then(async (buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const code = String(body.code || '').trim();
        const name = String(body.name || '').trim();
        if (!code) { sendJson(res, 400, { error: 'type the code from the email' }); return; }
        /* The engine's order and its second argument, read from source this
           time: setupComplete(code, name), the email already held by the
           settings the start step wrote. */
        const got = await remote.setupComplete(code, name);
        if (!got.ok) { sendJson(res, 400, { error: got.because }); return; }
        try { remote.ensure(); } catch { /* status says what happened */ }
        sendJson(res, 200, { ok: true, status: remote.status() });
      })
      .catch(() => sendJson(res, 400, { error: 'we could not finish the sign-up' }));
    return;
  }
  /* ---- Second-factor reset (#733 recovery): the Mac's own signed request,
     relayed. The control under Plus is the design queue's; this is the seam. */
  if (pathname === '/api/remote/second-reset' && req.method === 'POST') {
    remote.secondReset()
      .then((got) => sendJson(res, got.ok ? 200 : 400, got.ok ? { ok: true } : { error: got.because }))
      .catch((err) => sendJson(res, 500, { error: 'we could not reset the second factor: ' + (err && err.message) }));
    return;
  }
  /* ---- Forget this Mac (#793): retire at the coordinator while the key
     exists, then destroy the key. The engine owns the order; this route only
     relays the outcome, including the case where the coordinator could not
     be told, so the page can say the address may still show on the account. */
  if (pathname === '/api/remote/forget' && req.method === 'POST') {
    remote.forget()
      .then((got) => sendJson(res, 200, { ok: true, retired: got.retired === true, address: got.address, because: got.because, status: remote.status() }))
      .catch((err) => sendJson(res, 500, { error: 'we could not forget this computer: ' + (err && err.message) }));
    return;
  }
  /* ---- Devices (#567): the Allow moment's seam. `pending` is a FILE the
     running tunnel refreshes (every open board reads it every five seconds,
     so it must never spawn); the list and the three verbs shell to the
     tunnel, the only writer of this Mac's allow_list. The page renders the
     card only when Plus is on and enrolled, which the engine already
     encodes as an empty list. */
  if (pathname === '/api/remote/pending' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { sendJson(res, 200, remote.pendingDevices()); }
    catch { sendJson(res, 500, { error: 'we could not read what is waiting' }); }
    return;
  }
  if (pathname === '/api/remote/devices' && (req.method === 'GET' || req.method === 'HEAD')) {
    remote.devicesList()
      .then((list) => {
        if (!list.ok) { sendJson(res, 500, { error: list.because }); return; }
        const pending = remote.pendingDevices();
        sendJson(res, 200, { pending: pending.devices, allowed: list.data.devices, email: pending.email, on: remote.read().on === true });
      })
      .catch(() => sendJson(res, 500, { error: 'we could not read the devices' }));
    return;
  }
  const deviceVerb = /^\/api\/remote\/devices\/(allow|deny|remove)$/.exec(pathname);
  if (deviceVerb && req.method === 'POST') {
    readBody(req)
      .then(async (buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const id = typeof body.device_id === 'string' ? body.device_id : '';
        const verb = deviceVerb[1];
        const got = verb === 'allow' ? await remote.deviceAllow(id, body.name)
          : verb === 'deny' ? await remote.deviceDeny(id)
            : await remote.deviceRemove(id);
        if (!got.ok) { sendJson(res, 400, { error: got.because }); return; }
        sendJson(res, 200, { ok: true, ...(got.data || {}) });
      })
      .catch(() => sendJson(res, 400, { error: 'we could not change that' }));
    return;
  }
  /* ---- Styles (#480): named themes plus a pasted token file ---- */
  if (pathname === '/api/style' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { sendJson(res, 200, { ...styles.effective(), themes: styles.themeList() }); }
    catch { sendJson(res, 500, { error: 'we could not read the style' }); }
    return;
  }
  if (pathname === '/api/style' && req.method === 'PUT') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        if (typeof body !== 'object' || Array.isArray(body)) { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        /* A present-but-mistyped field is a 400 naming the field, never
           a silent no-change 200 a scripted client reads as saved. */
        /* 🛑 REFUSED BY NAME, NOT IGNORED (kosmos#1001). The paste-your-own-
           style box is gone, so this field can no longer do anything -- and
           accepting it with a 200 that changes nothing is the exact shape this
           route's own tests forbid: "never a silent no-change 200 a scripted
           client would read as saved". Whatever sent it believes it applied a
           style; it did not, and it deserves to be told. */
        if ('customText' in body) { sendJson(res, 400, { error: 'customText is no longer accepted: the paste-your-own-style box was removed' }); return; }
        if ('theme' in body && typeof body.theme !== 'string') { sendJson(res, 400, { error: 'theme must be a string' }); return; }
        if ('layout' in body && typeof body.layout !== 'string') { sendJson(res, 400, { error: 'layout must be a string' }); return; }
        /* One validated write for the whole request: sequential setters
           left a half-applied theme behind a refused paste, and the 400
           then named only the paste while the store had already moved. */
        const saved = styles.set({
          theme: typeof body.theme === 'string' ? body.theme : undefined,
          layout: typeof body.layout === 'string' ? body.layout : undefined,
        });
        if (!saved.ok) { sendJson(res, 400, { error: saved.because }); return; }
        sendJson(res, 200, { ...styles.effective(), themes: styles.themeList() });
      })
      .catch(() => sendJson(res, 400, { error: 'we could not save the style' }));
    return;
  }
  if (pathname === '/api/notify-setting' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { const r = notify.read(); sendJson(res, 200, { on: r.on, ok: r.ok }); }
    catch { sendJson(res, 500, { error: 'that setting could not be read' }); }
    return;
  }
  if (pathname === '/api/notify-setting' && req.method === 'PUT') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const saved = notify.setOn(body.on);
        if (!saved.ok) { sendJson(res, 400, { error: saved.because }); return; }
        const r = notify.read();
        sendJson(res, 200, { on: r.on, ok: r.ok });
      })
      .catch(() => sendJson(res, 400, { error: 'we could not save that setting' }));
    return;
  }
  if (pathname === '/api/history' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { sendJson(res, 200, forget.summary()); }
    catch { sendJson(res, 500, { error: 'we could not look at your history' }); }
    return;
  }
  /**
   * #853: real per-model, per-day token usage, not the point-in-time
   * context-window reading `/api/status` answers per agent. `?days=N`
   * (default 7) is clamped inside `dailyUsageByModel` itself, so a bad or
   * hostile value cannot crash this route.
   *
   * ⚠️ FOUR BUCKETS, NEVER BLENDED -- the response carries
   * input_tokens/output_tokens/cache_creation_input_tokens/
   * cache_read_input_tokens separately per day per model, exactly as
   * engine/usage.js produces them. This route does not sum them; a caller
   * that wants one number has to choose how, and say what it chose.
   * `rootsRead` travels too, so a caller can say which config directories
   * were actually scanned rather than imply it saw everything.
   */
  if (pathname === '/api/usage' && (req.method === 'GET' || req.method === 'HEAD')) {
    let days = 7;
    try { days = Number(new URL(req.url, ROUTING_BASE).searchParams.get('days')) || 7; } catch { days = 7; }
    // Async, not a blocking call: usage.dailyUsageByModel reads potentially
    // hundreds of transcripts (tens of MB) off disk, and a synchronous read
    // there would stall every other route on this single-threaded server
    // for the scan's duration -- found in review, fixed at the source.
    usage.dailyUsageByModel(days)
      .then((result) => sendJson(res, 200, result))
      .catch(() => sendJson(res, 500, { error: 'we could not read token usage' }));
    return;
  }
  /**
   * And the act.
   *
   * 🛑 A BODY IS REQUIRED AND IT HAS TO SAY THE WORD. This is the only
   * irreversible route in the product, and a bare POST is one stray fetch, one
   * replayed request, or one over-eager client away from deleting somebody's
   * conversations. The confirm token is not security -- anything that can reach
   * this port can send it -- it is a guarantee that the caller MEANT this
   * specific act rather than arrived here by accident.
   */
  if (pathname === '/api/history' && req.method === 'DELETE') {
    readBody(req)
      .then((raw) => {
        let body = null;
        try { body = JSON.parse(raw || 'null'); } catch { body = null; }
        if (!body || body.confirm !== 'delete') {
          sendJson(res, 400, { error: 'that request did not confirm the deletion' });
          return;
        }
        const out = forget.forget();
        if (!out.ok) { sendJson(res, 500, { error: out.because }); return; }
        sendJson(res, 200, out);
      })
      .catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
    return;
  }

  if (pathname === '/api/accounts' && (req.method === 'GET' || req.method === 'HEAD')) {
    /* Every provider's accounts in one list (#540), each row saying which
       provider it belongs to. Both the Claude rows (accounts.listLive(),
       #881) and the OpenAI rows (openaiAccounts.listLive(), #960) carry a
       real, live-checked `connection` field, not just what a saved local
       file's shape implies -- one badge vocabulary, one meaning, across
       providers.
       ⚠️ listLive(), NOT list(): this route is the one place a live,
       per-account check is safe to pay for -- its callers are deliberate,
       person-paced moments, never the 5-second status tick (which still
       calls the plain, fast list() elsewhere in this file, untouched).
       Callers today, and this list is the JUSTIFICATION for paying listLive()'s
       per-account check, so it has to stay complete: a Settings > Accounts open;
       the first-run wizard's model step entering (frPaintOpenai); the agent
       panel's account picker opening; and, added by #1373, a SUCCESSFUL account
       move and a FAILED provider switch, both of which drop the page-side cache
       and repaint so the remedy the refusal names points at a fresh list.
       ⚠️ Every one of those is a person pressing something. That is the property
       the cost is justified against, not the count, so a new caller is fine and a
       new TIMER would not be. The wizard step can re-fire on a back/forward pass
       -- still a person walking a screen, not a timer, and the client holds a
       supersession token so a
       slow answer landing late cannot overwrite a newer state.
       ⚠️ HEAD SKIPS THE LIVE CHECK. Nothing in web/index.html sends one
       today, but a HEAD is conventionally cheap/side-effect-light, and
       nothing about it needs a per-account subprocess/network call to
       answer -- it only asks whether the route is there. */
    if (req.method === 'HEAD') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(); return; }
    Promise.all([accounts.listLive(), openaiAccounts.listLive()])
      .then(([claudeRows, openaiRows]) => {
        const claude = claudeRows.map((a) => ({ provider: 'anthropic', providerName: 'Anthropic / Claude', ...a }));
        sendJson(res, 200, { accounts: [...claude, ...openaiRows] });
      })
      .catch(() => sendJson(res, 500, { error: 'we could not read the accounts on this computer' }));
    return;
  }
  /**
   * The provider runners (#979): what is installed, what is installing,
   * and the numbers a progress bar needs. The wizard and Settings both
   * poll this while an install runs -- polling is the board's existing
   * propagation idiom (the root-cause question of stale screens is #972,
   * deliberately not answered by a new push mechanism here).
   */
  if (pathname === '/api/runners' && (req.method === 'GET' || req.method === 'HEAD')) {
    // HEAD like the sibling read routes: cheap route-is-there probe.
    if (req.method === 'HEAD') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(); return; }
    sendJson(res, 200, { runners: runners.status() });
    return;
  }
  /**
   * Start (or join) a runner install. Idempotent on purpose: a second
   * Confirm while a download runs gets the RUNNING job, and Confirm on an
   * already-present runner answers `installed` without touching the
   * network. The response is the job's state right now; progress is read
   * from GET /api/runners.
   */
  {
    const m = pathname.match(/^\/api\/runners\/([a-z]+)\/install$/);
    if (m && req.method === 'POST') {
      req.resume(); // no body is expected; drain anything sent so keep-alive survives
      const job = runners.install(m[1]);
      sendJson(res, job.phase === 'failed' ? 400 : 200, { job });
      return;
    }
  }
  /* Add an OpenAI account from a pasted key (#540). The key goes to codex's
     own login on stdin and is never echoed, logged, or answered back. */
  if (pathname === '/api/accounts/openai' && req.method === 'POST') {
    readBody(req)
      .then((raw) => {
        let body = null;
        try { body = JSON.parse(raw || 'null'); } catch { body = null; }
        if (!body || typeof body !== 'object') { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        /* ONE resolver (engine/runners.js), not a hardcoded default: this
           route refusing while create.js would have accepted (or the
           reverse) is half of how the #979 dead end shipped. When the
           runner is missing the answer is STRUCTURED -- needsRunner tells
           the screen to reveal the install step in place, and the error
           string stays exactly what it was so today's UI keeps working
           until Mona Lisa's flow binds the richer shape. DELIBERATE
           ordering change: the runner check now precedes key validation
           (a bad key with no runner answers needsRunner, not the key
           nit), matching the approved flow -- install first, then the
           credential. */
        const resolved = runners.resolveBin('openai');
        // The proving window counts as not-ready: the symlink is up while
        // --version may still fail, and a key pasted in that instant would
        // reach a never-proven binary and surface a confusing login error
        // instead of this structured answer.
        const liveJob = (runners.status().openai || {}).job;
        const midInstall = liveJob && liveJob.phase !== 'installed' && liveJob.phase !== 'failed';
        if (!resolved.present || midInstall) {
          sendJson(res, 400, {
            error: openaiAccounts.MISSING_RUNNER_SENTENCE,
            needsRunner: true,
            provider: 'openai',
          });
          return;
        }
        const out = openaiAccounts.addWithKey({
          key: body.key,
          label: body.label,
          codexBin: resolved.bin,
        });
        if (!out.ok) { sendJson(res, 400, { error: out.because }); return; }
        sendJson(res, 200, { account: out.account });
      })
      .catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
    return;
  }

  /**
   * Forget an OpenAI account (#1372).
   *
   * 🛑 THE WAY BACK OUT THAT DID NOT EXIST. A person could add up to 500 and
   * remove none, and the only escape was deleting a dot-directory in Terminal.
   * Josh on that shape: "a total dead stop in the water."
   *
   * ⭐ THIS ROUTE'S ONE JOB BEYOND CALLING THE ENGINE IS ANSWERING "WHICH
   * AGENTS ARE ON IT". `openaiaccounts` cannot ask, because it would have to
   * require `create.js`, which requires it back. The route knows both, so the
   * coupling lives here rather than as a cycle.
   *
   * 📌 An agent counts as on this account when its launch file names that home,
   * OR when it runs on codex with no home recorded and this IS the default
   * home, because that is where creation put its trust entry. The second half
   * is the one a configDir-only check would miss, and created agents are the
   * common case.
   */
  if (pathname === '/api/accounts/openai' && req.method === 'DELETE') {
    readBody(req)
      .then((raw) => {
        let body = null;
        try { body = JSON.parse(raw || 'null'); } catch { body = null; }
        const dir = body && typeof body.dir === 'string' ? body.dir : '';
        if (!dir) { sendJson(res, 400, { error: 'we could not read that request' }); return; }

        let isDefault = false;
        try { isDefault = path.resolve(dir) === path.resolve(openaiAccounts.defaultDir()); }
        catch { isDefault = false; }

        /* 🛑 THE ENUMERATION FAILS CLOSED, AND THE FIRST VERSION DID NOT
           (Renet Tilley, reviewing #1447). `safeRoster()` answers NULL when it
           cannot read the fleet, `|| []` turned that into an empty list, and an
           empty list means "no agents are on this account" -> PROCEED. So an
           unreadable roster, or one agent whose launch file threw, silently
           became permission to rename a directory out from under a running
           agent.
           ⭐ His sentence for it: AMBIGUITY WAS SILENTLY NONE. The refusal
           below exists to make a rename safe, and a safety check that cannot
           tell "nobody" from "I could not look" is not one.
           📌 A NULL job is NOT incomplete: `readJob` answers null for an agent
           Kosmos did not start, which is a real answer meaning "not a codex
           agent". Only a THROW, or an unreadable roster, is ignorance. */
        const roster = safeRoster();
        let complete = roster !== null;
        const usedBy = [];
        for (const a of (roster || [])) {
          let job = null;
          try { job = create.readJob(a.sessionName); }
          catch { complete = false; continue; }
          /* 🛑 A NULL JOB IS TWO DIFFERENT ANSWERS AND readJob CANNOT TELL YOU
             WHICH. It catches its own read error and returns null, so "this
             agent has no launch file" and "I could not read its launch file"
             arrive identically. The first is a real answer; the second is
             ignorance, and treating it as the first is the same fail-open one
             layer down from the one this review caught.
             ✅ `jobMissing` is the helper that separates them, and its own
             docblock says why: "Only ENOENT is evidence of absence; any other
             failure answers we could not check." */
          if (!job) {
            let absent = true;
            try { absent = create.jobMissing(a.sessionName); } catch { absent = false; }
            if (!absent) complete = false;
            continue;
          }
          if (job.runner !== 'codex') continue;
          const home = job.configDir || null;
          let onIt = false;
          try { onIt = home ? path.resolve(home) === path.resolve(dir) : isDefault; }
          catch { complete = false; continue; }
          if (onIt) usedBy.push(a.sessionName);
        }
        if (!complete) {
          sendJson(res, 400, {
            error: 'we could not check which agents are running, so nothing was changed',
            usedBy: [],
          });
          return;
        }

        const out = openaiAccounts.forgetAccount(dir, usedBy);
        if (!out.ok) {
          sendJson(res, 400, { error: out.because, usedBy: out.usedBy || [] });
          return;
        }
        /* "Removed" and "deleted" are different promises and the person is
           entitled to know which one they got. */
        sendJson(res, 200, {
          forgotten: out.forgotten === true,
          because: out.forgotten
            ? 'That account is off the list. Its sign-in file is still on this computer, '
              + 'so nothing was deleted.'
            : 'That account was already gone from this computer.',
          accounts: openaiAccounts.list(),
        });
      })
      .catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
    return;
  }

  /**
   * Point an account's history at the shared tree, so agents can be moved to it.
   *
   * 📌 A SEPARATE ACT FROM THE MOVE, on purpose. It edits something outside
   * Kosmos's own data (a directory belonging to a Claude account), so it is
   * something a person chooses, not a side effect of picking a name in a
   * dropdown.
   */
  if (pathname === '/api/accounts/share' && req.method === 'POST') {
    readBody(req)
      .then((raw) => {
        let body = null;
        try { body = JSON.parse(raw || 'null'); } catch { body = null; }
        const dir = body && body.dir;
        const known = accounts.list().find((a) => a.dir === dir);
        if (!known) { sendJson(res, 400, { error: 'we do not know that account on this computer' }); return; }
        const out = accounts.share(known.dir);
        if (!out.ok) { sendJson(res, 400, { error: out.because }); return; }
        sendJson(res, 200, { accounts: accounts.list() });
      })
      .catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
    return;
  }

  /**
   * Point an agent at a different Claude account.
   *
   * 🛑 THE SAME TWO WRITES AS THE MODEL ROUTE, and the second is not optional:
   * launchd reads the startup file when the job is bootstrapped, so without the
   * restart this is a control that reports success and changes nothing until the
   * next reboot.
   */
  const acctRoute = pathname.match(/^\/api\/agent\/([^/]+)\/account$/);
  if (acctRoute && req.method === 'POST') {
    const name = decodeSegment(acctRoute[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((raw) => {
        let body = null;
        try { body = JSON.parse(raw || 'null'); } catch { body = null; }
        const wrote = create.setAccount(name, body && body.dir);
        if (wrote.outcome === create.OUTCOME.REFUSED) {
          sendJson(res, 400, { outcome: 'refused', because: wrote.because });
          return;
        }
        let back;
        try { back = removal.restart(name); }
        catch (err) { back = { outcome: 'partial', because: String((err && err.message) || err), steps: [] }; }
        const ok = back.outcome === removal.OUTCOME.RESTARTED;
        const who = wrote.account.email || wrote.account.label || 'that account';
        sendJson(res, 200, {
          outcome: ok ? 'changed' : 'partial',
          account: wrote.account,
          because: ok
            /* Same shape as the model route's sentence, and for the same
               reason: a restarted agent has done nothing, and Josh read that
               emptiness as the change having failed. The history sentence is
               here because it is the one thing a person is right to worry
               about when moving accounts, and the answer is good news. */
            ? `${name} runs on ${who} now. It is starting again, and it will look idle `
              + 'until you say something to it. Everything it has done comes with it.'
            : `We saved ${who}, but could not start it again: ${back.because} `
              + 'It is still on the old account until it restarts.',
          steps: back.steps || [],
        });
      })
      .catch((err) => sendJson(res, (err && err.status) || 400,
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  /**
   * What first run should show, and whether it should show at all.
   *
   * ⚠️ One GET, answered by the engine, so the screen cannot disagree with the
   * code about which path somebody is on or whether they are connected. The
   * instruction editor shipped a version of that bug and it took two review
   * passes to find.
   */
  /**
   * The agents this computer already has, running or not.
   *
   * 🛑 ITS OWN ROUTE, NOT A FIELD ON /api/first-run, and the reason is cost. That
   * route is polled: every "Check again", every repaint of the setup flow. This
   * one opens a transcript per project folder and an instruction file per agent,
   * which is the right price to pay once when somebody is looking at the list and
   * the wrong one to pay on a poll.
   *
   * ⚠️ READ-ONLY. Finding is not connecting; nothing here starts, stops or writes
   * anything, which is why it answers to GET.
   */
  if (pathname === '/api/found-agents' && (req.method === 'GET' || req.method === 'HEAD')) {
    let out;
    try { out = discover.found(); }
    catch (err) {
      /* Never 500s for a state question, the same contract /api/machine records:
         "we could not look" is an ANSWER and the screen can render it. */
      sendJson(res, 200, { ok: false, agents: [],
        because: 'we could not look for the agents on this computer',
        detail: String((err && err.message) || err) });
      return;
    }
    /* Whether the person sent the board's block away for good (Josh,
       2026-08-24 17:06). Carried on the same answer so the painter cannot
       show the list on one fetch and hide it on another. */
    sendJson(res, 200, { ...out, dismissed: discover.dismissed() });
    return;
  }

  /* "Dismiss this forever": remembered on disk, behind the same cross-site
     guard as every other write. There is no route back on purpose; the word
     Josh chose was forever, and the confirmation on the board says so. */
  if (pathname === '/api/found-agents/dismiss' && req.method === 'POST') {
    try { discover.dismiss(); }
    catch { sendJson(res, 500, { ok: false, because: 'we could not remember that' }); return; }
    sendJson(res, 200, { ok: true, dismissed: true });
    return;
  }

  /**
   * "This isn't an agent": one folder, said no to once (#1531).
   *
   * 🛑 NOT `dismiss`, WHICH IS THE WHOLE BLOCK. Josh's word for that one was forever
   * and it hides everything; this hides one folder. Conflating them would make a
   * single decline switch off the entire offer, which is the opposite of what the
   * person pressed.
   *
   * ⭐ IT PERSISTS BECAUSE THE COPY SAYS IT DOES. The screen says we will not ask
   * about this folder again, and a session-only hide would make that sentence untrue
   * on the next load. Behind the same cross-site guard as every other write.
   */
  if (pathname === '/api/found-agents/decline' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { ok: false, because: 'we could not read that request' }); return; }
        let out;
        try { out = discover.decline(body.dir); }
        catch { out = { ok: false, because: 'we could not remember that' }; }
        sendJson(res, out.ok ? 200 : 400, out);
      })
      .catch(() => sendJson(res, 400, { ok: false, because: 'we could not read that request' }));
    return;
  }

  /* And back again, because the screen offers an Undo and it must do something. */
  if (pathname === '/api/found-agents/undecline' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { ok: false, because: 'we could not read that request' }); return; }
        let out;
        try { out = discover.undecline(body.dir); }
        catch { out = { ok: false, because: 'we could not remember that' }; }
        sendJson(res, out.ok ? 200 : 400, out);
      })
      .catch(() => sendJson(res, 400, { ok: false, because: 'we could not read that request' }));
    return;
  }

  /**
   * Bring one agent that already exists on this computer under Kosmos.
   *
   * ⚠️ POST, and behind the same cross-site guard as every other write: it
   * installs a launch job and starts a session, which is the most consequential
   * thing any route here does on somebody's machine.
   *
   * 🔑 IT TAKES A FOLDER, NOT A NAME. The folder is the agent -- the name is
   * derived from it, and a name is exactly the kind of thing a caller could bend
   * into a path. `discover.connect` refuses anything that is not an absolute
   * path to a real directory holding instructions that say who the agent is.
   */
  if (pathname === '/api/connect-agent' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { ok: false, because: 'we could not read that request' }); return; }
        /* 🔑 THE FIRST AGENT BRINGS ITS OWN HOME, WHETHER IT WAS MADE OR IMPORTED
           (#1349). The seed lived only in the create route, so a person whose
           first agents are IMPORTED landed on an empty Projects tab -- the first
           screen after the thing that just worked.

           ⚠️ MADE BEFORE `connect`, not after, and that ordering is #732: connect
           STARTS the agent, so a project joined afterwards reaches its
           instructions through the later sync and the agent is born reading
           "Kosmos put it on Getting started. Restart it so it knows".

           📌 Same once-EVER flag as creation, deliberately shared rather than
           copied: two flags would let an importer and a creator each seed a home
           and give somebody two. */
        const projectsToJoin = [];
        let home = null;
        const seededFlag = path.join(require('./engine/store').ROOT, 'seeded-project.json');
        try {
          if (!fs.existsSync(seededFlag) && projects.readAll().length === 0) {
            home = projects.create({
              name: 'Getting started',
              agents: [],
              roster: safeRoster(),
              description: 'Kosmos made this so your first agent has somewhere to work with you. '
                + 'Post below and everyone on it answers here.',
              made: { via: 'kosmos' },
            });
            projectsToJoin.push(home.id);
          }
        } catch { home = null; /* a first screen a person fills themselves is the fallback, not a failure */ }

        let out;
        /* 🔑 THE NAME THE PERSON TYPED (#1531, Josh's ruling 2(a)). A folder with no
         instructions file has nothing to read a name out of, so the screen asks and
         this carries the answer. `connect` trims it and refuses an unusable one; an
         absent field is absent rather than empty, and the folder's own name is still
         the answer when nobody supplies one. */
      try { out = discover.connect(body.dir, { projects: projectsToJoin, name: body.name }); }
        catch (err) {
          /* A state question never 500s, the contract every sibling here keeps:
             the screen can render "we could not" and cannot render a stack. */
          sendJson(res, 200, { ok: false,
            because: 'we could not bring that agent in',
            detail: String((err && err.message) || err) });
          return;
        }
        /* The membership record, AFTER the agent exists -- the block it reads was
           already composed above. Same split as creation: block before birth,
           record after. */
        if (out.ok && projectsToJoin.length) {
          try {
            const roster = safeRoster();
            for (const id of projectsToJoin) projects.addAgent(id, out.name, roster, { via: 'process' });
          } catch { /* the agent is in; a failed join is not worth undoing it */ }
        }
        /* 🛑 ROLLED BACK IF THE ADOPTION FAILED, and the flag is never written --
           otherwise a refused import leaves a Getting started project with nobody
           on it, and the NEXT person to make an agent gets no home because the
           store is no longer empty. */
        if (!out.ok && home) {
          try { projects.remove(home.id); } catch { /* nothing better to do */ }
        } else if (out.ok && home) {
          try { fs.writeFileSync(seededFlag, JSON.stringify({ at: new Date().toISOString(), via: 'import' })); }
          catch { /* the emptiness check still guards the common case */ }
        }
        sendJson(res, out.ok ? 200 : 400, out);
      })
      .catch(() => sendJson(res, 400, { ok: false, because: 'we could not read that request' }));
    return;
  }

  /* Undoing one of those adds. Deliberately a sibling of connect rather than a
     branch of the removal API: what it is allowed to touch is narrower (an agent
     whose folder Kosmos did not create), and the engine is where that is
     enforced. Covered by the same cross-site write guard as every POST here. */
  if (pathname === '/api/disconnect-agent' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { ok: false, because: 'we could not read that request' }); return; }
        let out;
        try { out = discover.disconnect(body.name); }
        catch (err) {
          sendJson(res, 200, { ok: false,
            because: 'we could not undo that',
            detail: String((err && err.message) || err) });
          return;
        }
        sendJson(res, out.ok ? 200 : 400, out);
      })
      .catch(() => sendJson(res, 400, { ok: false, because: 'we could not read that request' }));
    return;
  }

  if (pathname === '/api/first-run' && (req.method === 'GET' || req.method === 'HEAD')) {
    /* 🛑 PROMISE-SHAPED SINCE #874, because firstrun.state() now VERIFIES the
       subscription live rather than reading a cached file that says CONNECTED
       for a logged-out person. Same shape as github.state()/vercel.state()
       below, which have always been async here. The rejection arm keeps the
       original sentence verbatim: a state question must never 500 with a stack
       trace at somebody setting the product up. */
    firstrun.state().then(
      (state) => sendJson(res, 200, state),
      (err) => {
      sendJson(res, 500, { error: 'we could not work out whether this machine has been set up yet', detail: String(err && err.message || err) });
      },
    );
    return;
  }

  /**
   * What this computer will and will not do — the "Checking your computer" step.
   *
   * ⚠️ ITS OWN ROUTE, not folded into /api/first-run, for two reasons. It shells
   * out twice, so folding it in would make the decision about which screen to
   * open wait on two subprocesses; and the screen offers to run it again, which
   * needs something to call.
   *
   * ⚠️ AND IT NEVER 500s. Every check already answers `unknown` when it cannot
   * look, so an error here would mean the check-runner itself broke -- and a
   * screen with no answers at all is worse than three that say "we could not
   * tell". The catch turns that into exactly that.
   */
  if (pathname === '/api/machine' && (req.method === 'GET' || req.method === 'HEAD')) {
    let checks;
    try { checks = machine.check(); }
    catch (err) {
      sendJson(res, 200, {
        checks: [{
          key: 'all', state: 'unknown',
          title: 'We could not check this computer',
          detail: 'That does not mean anything is wrong with it, only that we could not look. ('
            + String((err && err.message) || err) + ')',
        }],
        attention: 0,
        unknown: 1,
        // The degraded answer keeps the healthy answer's shape: step 5 reads
        // this field, and the honest state when the check-runner itself broke
        // is could-not-look here too -- the ENGINE'S OWN row, not a copied
        // literal that goes stale the moment the wording moves.
        appLocation: machine.appLocationUnknown(),
      });
      return;
    }
    /* The birth record, surfaced (#157, #265): how many agents Kosmos has
       ever made on this Mac, and how many attempts it refused. Read from the
       append-only record so the number survives every deletion; best-effort,
       because a machine check must not fail over its receipt. */
    try {
      const births = create.createdLog();
      checks.made = {
        agents: births.filter((b) => b && b.outcome === 'created').length,
        refused: births.filter((b) => b && b.outcome === 'refused').length,
      };
    } catch { checks.made = null; }
    sendJson(res, 200, checks);
    return;
  }

  /**
   * Open the Mac's sleep settings screen. POST, so it inherits the
   * cross-site guard: it launches an app on the person's machine. The pane
   * URL is derived server-side from what is on disk, never taken from the
   * request, so this cannot become an open-arbitrary-URL primitive; and when
   * the pane was not found the button was never rendered, so the 409 here is
   * a race (an update changed the world) rather than a normal path.
   */
  if (pathname === '/api/open-sleep-settings' && req.method === 'POST') {
    const opened = machine.openSleepSettings();
    if (opened.ok) { sendJson(res, 200, { ok: true }); return; }
    sendJson(res, 409, { error: opened.because });
    return;
  }

  /* The Accessibility pane (kosmos#1344). Josh asked for a button that opens the
     setting so a person can grant it, beside a sentence saying why.
     ⚠️ POST, so it inherits the cross-site guard above, exactly like its sleep
     sibling: this reaches out and touches the machine.
     🛑 IT TAKES NO URL AND NO PARAMETER. The engine derives the pane itself. A
     route that accepted a target would be a way for any page to `open` arbitrary
     things on somebody's computer, which is the property the sleep route's own
     comment exists to protect. */
  if (pathname === '/api/open-accessibility-settings' && req.method === 'POST') {
    const opened = machine.openAccessibilitySettings();
    if (opened.ok) { sendJson(res, 200, { ok: true }); return; }
    sendJson(res, 409, { error: opened.because });
    return;
  }

  // Marking it done. ⚠️ POST, because it writes -- so it inherits the
  // cross-site guard above rather than being reachable from any page.
  if (pathname === '/api/first-run/complete' && req.method === 'POST') {
    let ok;
    try { ok = firstrun.complete(); }
    catch (err) {
      sendJson(res, 500, { error: 'we could not remember that you have set this up', detail: String(err && err.message || err) });
      return;
    }
    /**
     * ⚠️ Reports whether it STUCK, read back, rather than whether the write
     * threw. A flag that did not persist means onboarding reappears on the next
     * launch, and the screen would rather say so now than surprise them then.
     */
    sendJson(res, ok ? 200 : 500, ok
      ? { done: true }
      : { error: 'we could not remember that, so this may appear again next time' });
    return;
  }

  // --- connect: the click that installs Claude and signs it in -------------

  /**
   * Where the connect flow is right now. Polled by first run while a connect
   * is in flight.
   *
   * ⚠️ NEVER 500s for a state question, same contract as /api/machine: every
   * phase, including stuck, is an ANSWER. An error here would blank the one
   * screen whose job is telling somebody what is happening.
   */
  /* GitHub, connected (#529): the state is read from gh every time; start
     runs GitHub's own device flow; cancel kills it. The one-time code and
     URL ride the state so the door can show them. Nothing here holds a key. */
  if (pathname === '/api/github' && (req.method === 'GET' || req.method === 'HEAD')) {
    github.state().then((st) => sendJson(res, 200, st));
    return;
  }
  if (pathname === '/api/github/start' && req.method === 'POST') {
    github.start().then((st) => sendJson(res, st.refused ? 409 : 200, st));
    return;
  }
  if (pathname === '/api/github/cancel' && req.method === 'POST') {
    github.cancel().then((st) => sendJson(res, 200, st));
    return;
  }
  /* GitHub with nothing installed (#620): Kosmos's own device flow, the
     road for a Mac with no gh. Same verbs as the gh door plus forget (the
     token is HELD here, Cloudflare's shape) and the one Josh-line setting.
     No route ever answers the token. */
  if (pathname === '/api/github-device' && (req.method === 'GET' || req.method === 'HEAD')) {
    githubdevice.state().then((st) => sendJson(res, 200, st));
    return;
  }
  if (pathname === '/api/github-device/start' && req.method === 'POST') {
    githubdevice.start().then((st) => sendJson(res, st.refused ? 409 : 200, st));
    return;
  }
  if (pathname === '/api/github-device/cancel' && req.method === 'POST') {
    githubdevice.cancel().then((st) => sendJson(res, 200, st));
    return;
  }
  if (pathname === '/api/github-device/forget' && req.method === 'POST') {
    githubdevice.forget().then((st) => sendJson(res, 200, st));
    return;
  }
  if (pathname === '/api/github-device/app' && req.method === 'POST') {
    /* The Josh-line's landing spot: the client_id he hands over, pasted
       once. Public by design (a device-flow client id), so it may ride a
       route; the TOKEN never does. */
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; } catch { throw new Error('we could not read that request'); }
        const got = githubdevice.setClientId(body.clientId);
        if (!got.ok) { sendJson(res, 400, got); return; }
        githubdevice.state().then((st) => sendJson(res, 200, st));
      })
      .catch((err) => sendJson(res, 400, { ok: false, because: String((err && err.message) || 'we could not read that request') }));
    return;
  }
  if (pathname === '/api/vercel' && (req.method === 'GET' || req.method === 'HEAD')) {
    vercel.state().then((st) => sendJson(res, 200, st));
    return;
  }
  if (pathname === '/api/vercel/start' && req.method === 'POST') {
    vercel.start().then((st) => sendJson(res, st.refused ? 409 : 200, st));
    return;
  }
  if (pathname === '/api/vercel/cancel' && req.method === 'POST') {
    vercel.cancel().then((st) => sendJson(res, 200, st));
    return;
  }
  /* Cloudflare, connected (#529): a pasted scoped token, checked with
     Cloudflare before it is kept, kept in one mode-600 file under the store,
     never answered back. */
  if (pathname === '/api/cloudflare' && (req.method === 'GET' || req.method === 'HEAD')) {
    cloudflare.state().then((st) => sendJson(res, 200, st));
    return;
  }
  if (pathname === '/api/cloudflare/token' && req.method === 'POST') {
    readBody(req)
      .then((raw) => {
        let body = null;
        try { body = JSON.parse(raw || 'null'); } catch { body = null; }
        if (!body || typeof body !== 'object') { sendJson(res, 400, { error: 'we could not read that request' }); return null; }
        return cloudflare.connect(body.token).then((st) => sendJson(res, st.refused ? 400 : 200, st));
      })
      .catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
    return;
  }
  if (pathname === '/api/cloudflare/forget' && req.method === 'POST') {
    cloudflare.forget().then((st) => sendJson(res, 200, st));
    return;
  }
  /* The token doors (#529): Cloudflare's shape for every service that
     issues a token from its own page. One engine, a spec per service
     (engine/tokendoors.js); the routes are the same three for each. The
     token is checked with the service before it is kept, kept in one
     mode-600 file under secrets/env/<VAR>, handed to agents' panes by the
     supervisor, never answered back. */
  /* The shelf (#805): every category row on the Connections page reads the
     doors' own state from here, in one read, so the summary can never
     disagree with the door under it. Pete connected Cloudflare and Hetzner,
     came back, and every row said "Nothing connected" while each door said
     Connected: the rows were static words. Keyed by the door's route, which
     is what the page holds (SVC_BUILT). A door whose check threw answers
     connected:null, which the page says as could-not-check, never as
     nothing. GitHub is connected on either of its two roads (#620). */
  if (pathname === '/api/connections' && (req.method === 'GET' || req.method === 'HEAD')) {
    const ask = (fn) => Promise.resolve().then(fn).then(
      /* A held token whose service could not be reached is not "not connected":
         the door says so in its own words, and the shelf must not say nothing. */
      (st) => ({ connected: st && st.unreachable === true ? null : !!(st && st.connected === true), who: (st && (st.who || st.login)) || null }),
      (err) => ({ connected: null, because: 'could not check: ' + (err && err.message) }),
    );
    const jobs = {
      '/api/github': ask(async () => {
        const st = await github.state();
        if (st && st.connected) return st;
        if (st && st.gh === 'missing') { const d = await githubdevice.state(); if (d && d.connected) return d; }
        return st;
      }),
      '/api/vercel': ask(() => vercel.state()),
      '/api/cloudflare': ask(() => cloudflare.state()),
    };
    for (const [name, route] of Object.entries(tokendoors.routes())) jobs[route] = ask(() => tokendoors.byName(name).state());
    const keys = Object.keys(jobs);
    Promise.all(keys.map((k) => jobs[k])).then((vals) => {
      const doors = {};
      keys.forEach((k, i) => { doors[k] = vals[i]; });
      sendJson(res, 200, { doors });
    });
    return;
  }
  {
    const m = /^\/api\/svc\/([a-z0-9-]+)(?:\/(token|forget))?$/.exec(pathname);
    if (m) {
      const door = tokendoors.bySlug(m[1]);
      if (!door) { sendJson(res, 404, { error: 'no such door' }); return; }
      if (!m[2] && (req.method === 'GET' || req.method === 'HEAD')) { door.state().then((st) => sendJson(res, 200, st)); return; }
      if (m[2] === 'token' && req.method === 'POST') {
        readBody(req)
          .then((raw) => {
            let body = null;
            try { body = JSON.parse(raw || 'null'); } catch { body = null; }
            if (!body || typeof body !== 'object') { sendJson(res, 400, { error: 'we could not read that request' }); return null; }
            return door.connect(body.token).then((st) => sendJson(res, st.refused ? 400 : 200, st));
          })
          .catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
        return;
      }
      if (m[2] === 'forget' && req.method === 'POST') { door.forget().then((st) => sendJson(res, 200, st)); return; }
    }
  }
  if (pathname === '/api/connect' && (req.method === 'GET' || req.method === 'HEAD')) {
    let st;
    try { st = connect.state(); }
    catch (err) {
      /**
       * ⚠️ NOT `stuck`: the page paints stuck as "we could not finish
       * connecting Claude", a settled sentence about an attempt that may
       * never have happened. "We cannot tell where the flow is" is a third
       * answer; the page has no panel for `unsure` on purpose, so the static
       * verdict stands. (Defensive only -- state() never throws today.)
       */
      st = {
        phase: 'unsure',
        because: 'we could not work out where the connection attempt is',
        tail: String((err && err.message) || err),
      };
    }
    sendJson(res, 200, st);
    return;
  }

  /* Ask the release host RIGHT NOW (Check now): bypasses the TTL, and
     the answer carries reachability so the screen can say "could not
     reach" instead of a false "up to date". POST because it makes a
     network request on the person's behalf (cross-site guard). */
  if (pathname === '/api/update/check' && req.method === 'POST') {
    updates.checkNow()
      // offer is the newer()-gated verdict (same gate the toast rides), so
      // the card never has to re-derive version ordering client-side.
      .then((out) => sendJson(res, 200, { ...out, offer: updates.installedRoot() ? updates.available() : null, source: !updates.installedRoot() }))
      .catch(() => sendJson(res, 200, { running: updates.RUNNING, latest: null, reached: false, readable: false, offer: null }));
    return;
  }

  /**
   * Install the published update. POST, so it inherits the cross-site guard:
   * this one downloads and runs software, the same class as /api/connect/start.
   *
   * Two refusals, two different facts, both 409 (a state conflict, not a
   * malformed request):
   *  - nothing newer is published: a stray POST must not reinstall the same
   *    version and restart the board for nothing;
   *  - a from-source run: the installer must never be pointed at a working
   *    tree; source updates with git.
   * Past those, the answer is 200 BEFORE anything happens, because what
   * happens next kills this server on purpose: the detached installer stages,
   * verifies, swaps, and restarts the board. Agents keep working throughout;
   * their launchd jobs and tmux sessions are separate process trees this
   * update never touches.
   */
  if (pathname === '/api/update' && req.method === 'POST') {
    const avail = updates.available();
    if (!avail) { sendJson(res, 409, { error: 'there is no update to install right now' }); return; }
    if (!updates.installedRoot()) {
      sendJson(res, 409, { error: 'this Kosmos runs from its source code, so it updates from git, not from here' });
      return;
    }
    if (updates.alreadyInstalling()) {
      // Idempotent: the first POST started it; a retry, a double click, or a
      // second tab gets the same true answer without a second installer
      // racing the first through the stage-and-swap.
      /* The in-flight attempt is the one this second press joins; its
         stamp rides back so a reattached overlay can see its verdict. */
      const inflight = updates.lastAttempt();
      sendJson(res, 200, { ok: true, updating: avail.version, already: true, startedAt: inflight ? inflight.startedAt : null });
      return;
    }
    try { updates.beginInstall(); }
    catch (err) {
      sendJson(res, 500, { error: 'we could not start the update', detail: String((err && err.message) || err) });
      return;
    }
    /* #553: the attempt's own start stamp rides back so the page can tell
       THIS attempt's verdict from any older one by exact equality, never
       by comparing clocks. */
    const att = updates.lastAttempt();
    sendJson(res, 200, { ok: true, updating: avail.version, startedAt: att ? att.startedAt : null });
    return;
  }

  // Begin (or, after an interruption, begin again -- `start` re-checks
  // reality and skips whatever is already true). POST, so it inherits the
  // cross-site guard: this one downloads and runs software.
  if (pathname === '/api/connect/start' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body = {};
        /* Fails CLOSED: an unreadable request must not run the OPPOSITE
           flow from the one asked for (a mangled another:true silently
           becoming a global start would kill a leftover session and
           answer connected for the wrong account). Same direction as
           /api/connect/code one route below. */
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return null; }
        if (typeof body !== 'object' || Array.isArray(body)) { sendJson(res, 400, { error: 'we could not read that request' }); return null; }
        if ('another' in body && typeof body.another !== 'boolean') { sendJson(res, 400, { error: 'another must be true or false' }); return null; }
        if ('accountDir' in body && typeof body.accountDir !== 'string') { sendJson(res, 400, { error: 'accountDir must be the folder of an account on this computer' }); return null; }
        /* 🛑 SIGNING IN AGAIN TO AN ACCOUNT THAT ALREADY EXISTS (#1492). Without
           this the only two shapes were "the default account" and `another:true`,
           which picks a FREE spot and makes a NEW record. So a person whose login
           had merely EXPIRED had no route back except the one that duplicates
           them, which is exactly what happened to the first outside user: her
           token lapsed, Settings correctly said not connected, the only
           affordance was "add a provider", and she ended with two records for one
           login and no way to move her agent onto either.

           ⚠️ The ENGINE could always do this: `connect.start()` has taken a
           `configDir` since it was written, and `another:true` already uses it.
           What was missing was a way to ASK for an existing directory. */
        if (body && typeof body.accountDir === 'string' && body.accountDir !== '') {
          if (body.another === true) {
            sendJson(res, 400, { error: 'ask for a new account or an existing one, not both' });
            return null;
          }
          /* Resolved before comparing, for the reason #1486 records: `list()`
             stores a resolved dir, so a trailing slash or a `..` would miss an
             account that is genuinely here and send the person back to the
             duplicate-making route. */
          const want = path.resolve(body.accountDir);
          const known = accounts.list().find((a) => a.dir === want);
          /* 🛑 REFUSED RATHER THAN CREATED. An unknown folder must not become a
             new account by the back door: that is the very defect this route mode
             exists to remove, and it would arrive here wearing a helpful name. */
          if (!known) {
            sendJson(res, 400, { error: 'we do not know that account on this computer' });
            return null;
          }
          return connect.start({ configDir: known.dir });
        }
        /* { another: true } asks for a SECOND account (#248/#324): pick the
           first free work spot, prepare it (idempotent; the shared-memory
           symlink is wired before the sign-in so the account is right from
           birth), and run the same flow pointed at that directory. Anything
           else is exactly the call this route has always made. */
        if (body && body.another === true) {
          const spot = accounts.nextWorkDir();
          if (!spot) {
            sendJson(res, 500, { error: 'we could not find a free spot for another account' });
            return null;
          }
          const prep = accounts.prepare(spot.label);
          if (!prep.ok) {
            sendJson(res, 500, { error: prep.because });
            return null;
          }
          /* Born shared or not born: an account whose memory is not the
             one shared tree gives every agent moved onto it a blank
             history with nothing on screen saying why. Refusing here is
             the whole point of preparing BEFORE the sign-in. */
          if (!prep.memoryShared) {
            sendJson(res, 500, { error: 'we could not set up the new account to share this computer\'s memory, so we did not start the sign-in' });
            return null;
          }
          return connect.start({ configDir: prep.dir });
        }
        return connect.start();
      })
      .then((st) => { if (st) sendJson(res, 200, st); })
      .catch((err) => sendJson(res, 500, {
        error: 'we could not start connecting',
        detail: String((err && err.message) || err),
      }));
    return;
  }

  /**
   * The pasted sign-in code. Refused with the reason whenever the terminal is
   * not actually asking for one -- typing into a screen that is not asking is
   * how a driver corrupts a flow.
   */
  if (pathname === '/api/connect/code' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let code;
        try { code = JSON.parse(buf.toString('utf8') || '{}').code; }
        catch { sendJson(res, 400, { error: 'we could not read that' }); return; }
        const put = connect.submitCode(typeof code === 'string' ? code.trim() : code);
        // A malformed code is the caller's input being wrong (400); asking at
        // the wrong moment is a state conflict (409). Different fixes.
        const status = put.ok ? 200 : (put.kind === 'format' ? 400 : 409);
        sendJson(res, status, put.ok ? { ok: true } : { error: put.because });
      })
      .catch((err) => sendJson(res, 400, { error: String((err && err.message) || err) }));
    return;
  }

  // Stop, clean up what we made, own nothing half-claimed.
  if (pathname === '/api/connect/cancel' && req.method === 'POST') {
    connect.cancel()
      .then((st) => sendJson(res, 200, st))
      .catch((err) => sendJson(res, 500, {
        error: 'we could not stop it cleanly',
        detail: String((err && err.message) || err),
      }));
    return;
  }

  // The removed ones, for the list at the bottom of the agents tab. Removing
  // something must never mean losing track of it.
  if (pathname === '/api/removed' && (req.method === 'GET' || req.method === 'HEAD')) {
    let agents;
    // ⚠️ A throw here is the worst of the four: this list IS the undo path, and
    // taking the process down while somebody looks for it is how a reversible
    // removal stops being reversible.
    try { agents = removal.removedAgents(); }
    catch (err) { sendJson(res, 500, { error: 'we could not read the removed list', detail: String(err && err.message || err) }); return; }
    /**
     * ⚠️ Only the fields the screen uses. The stored record also carries the
     * absolute plist path, the launchd label and whether the job is ours --
     * none of which the browser reads, and all of which are machine detail this
     * product's whole vocabulary rule says a person is never shown.
     */
    sendJson(res, 200, {
      agents: agents.map((a) => ({
        name: a.name,
        shownAs: a.shownAs || a.name,
        removedAt: a.removedAt,
        stopped: a.stopped,
      })),
    });
    return;
  }

  // --- profile: things the machine cannot derive (role, etc.) --------------
  const prof = pathname.match(/^\/api\/agent\/([^/]+)\/profile$/);
  if (prof && req.method === 'PUT') {
    const name = decodeSegment(prof[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    readBody(req)
      .then((buf) => {
        const patch = JSON.parse(buf.toString('utf8') || '{}');
        const clean = {};
        // Only fields we know. An unrecognised key is dropped rather than
        // stored, so the profile cannot become a junk drawer.
        if (typeof patch.role === 'string') clean.role = patch.role.slice(0, 80);
        // ⚠️ displayName is writable HERE because the record now WINS over
        // the instruction file (round 32): creation writes it, readIdentity
        // prefers it, and with no route accepting it a Kosmos-created agent
        // had a permanently unchangeable name -- editing the file's
        // identity line, which used to rename the board, silently did
        // nothing with no sentence saying why. One-line trim: an
        // empty-after-trim name is dropped rather than stored, so a person
        // cannot blank an agent into anonymity by accident; the file line
        // remains the fallback for agents with no record.
        if (typeof patch.displayName === 'string' && patch.displayName.trim()) {
          clean.displayName = patch.displayName.trim().slice(0, 80);
        }
        /**
         * Who this agent reports to (#138, which unblocks the org view #137).
         *
         * 🛑 STORED, NEVER INFERRED. `engine/chat.js` already answers "is this
         * the manager" by regex on role text, and its own comment prices that
         * looseness honestly: being wrong costs a preselected dropdown entry
         * somebody fixes in one click. That price is right for a dropdown and
         * WRONG here, because #137 DRAWS this answer -- and a diagram does not
         * look like a guess. "Team Lead" and "Lead Designer" both match. So an
         * unanswered reporting line stays empty; empty is honest, inferred is
         * a claim. (Mona Lisa's standing note on #138.)
         *
         * ⚠️ An empty string CLEARS it, and that is a real choice rather than
         * a missing value: somebody removing a reporting line must be able to,
         * and `null` in the record is what "nobody" means.
         */
        if (typeof patch.reportsTo === 'string') {
          const to = patch.reportsTo.trim().slice(0, 80);
          /* Refused rather than stored: a cycle of one is the whole cycle
             problem in its smallest form, and it is the one a person can
             actually create by picking their own name out of a list. */
          if (to && to === name) { sendJson(res, 400, { error: 'an agent cannot report to itself' }); return; }
          /* 🛑 AND NOT TO SOMEBODY WHO REPORTS TO IT, at any distance (Angel's
             note on #336): A under B under A draws a ring the org chart cannot
             root and writes two files each telling the other to take its
             questions to the other. Walked on the records, bounded, refused in
             a sentence that names the loop. */
          if (to) {
            const seen = new Set([name]);
            let cur = to;
            for (let hops = 0; cur && hops < 64; hops += 1) {
              if (seen.has(cur)) {
                sendJson(res, 400, { error: `that would make a loop: ${cur} already reports up to this agent` });
                return;
              }
              seen.add(cur);
              let p = null;
              try { p = store.readProfile(cur); } catch { p = null; }
              cur = p && typeof p.reportsTo === 'string' ? p.reportsTo : null;
            }
          }
          /* `null` in the record means REPORTING TO THE PERSON (Josh, 2026-08-23
             09:55: "a default state for any agent, if they haven't been
             assigned, is that they report directly to me as the user"). Not
             "nobody": there is no nobody, and the org chart has always drawn
             an unassigned agent to the hub that is the person. The file says
             the same, by name, via the reports block below. */
          clean.reportsTo = to || null;
        }
        /* 🛑 THE AGENT'S OWN INSTRUCTIONS FOLLOW THE RENAME, and this is the
           half that was missing. Josh renamed an agent Bob to Scarlet
           (2026-08-22) and it still thought it was Bob: the name lives in the
           record, which every SCREEN reads, and in the sentence at the top of
           the instruction file, which is the only one the AGENT ever reads. The
           record moved and the file did not, so every screen agreed on Scarlet
           while Scarlet introduced herself as Bob.
           ⚠️ READ BEFORE THE WRITE, so "did this actually change the name" is
           answered against what the record said a moment ago rather than
           against what we are about to put in it. */
        let had = null;
        try { had = store.readProfile(name); } catch { had = null; }
        const written = store.writeProfile(name, clean);
        /* ⚠️ BEST-EFFORT, AND NEVER A FAILED RENAME. The record is already
           saved; a stale sentence in a file is a thing to tell somebody about,
           not a reason to report that the rename did not work -- which would
           have them do it again. Same posture as the instructions route's own
           follow in the other direction. */
        let renamed = null;
        if (clean.displayName && (!had || had.displayName !== clean.displayName)) {
          try { renamed = instructions.renameIn(name, clean.displayName); }
          catch { renamed = { ok: false, changed: false, because: 'we could not update its instructions' }; }
        }
        /* 🔑 AND IT SAYS THE AGENT HAS NOT HEARD YET. A running agent read its
           instructions when it started; changing the file does not reach the
           one that is already going. The screen needs to be able to offer a
           restart, and it cannot invent this. */
        /* The file half of role and reports-to (#336): the record moved, now
           the agent's own file does, through the managed block. Rewritten on
           every save that touched either field; a save that changed neither
           writes nothing (the splice composes the same bytes). And a rename
           reaches the files of agents that report to THIS one, because they
           name it. Non-gating, verdict carried: the screen reads `reports` to
           decide whether to say a restart is needed, never infers it. */
        let told = null;
        const roster = safeRoster();
        if ('role' in clean || 'reportsTo' in clean) {
          try { told = reports.tellAgent(name, roster, { trusted: true }); }
          catch (e2) { told = { state: projects.TOLD.COULD_NOT, because: String((e2 && e2.message) || 'we could not update its instructions') }; }
        }
        if (renamed && renamed.changed) {
          try { reports.syncReportsTo(name, roster); } catch { /* their markers carry it */ }
        }
        sendJson(res, 200, { ...written, ...(renamed ? { renamed } : {}), ...(told ? { reports: told } : {}) });
      })
      .catch((err) => sendJson(res, 400, { error: String(err.message) }));
    return;
  }

  // --- commitments: what an agent says it is holding -----------------------
  //
  // Matches on `pathname`, not `req.url`, and decodes with `decodeSegment`.
  // This branch was written before the routing fix landed, so its original
  // form used both of the things that fix removed -- a raw `req.url` match
  // (broken by any query string) and a bare `decodeURIComponent` (a stray `%`
  // exits the process). Rebasing it unchanged would have reintroduced both on
  // a brand-new endpoint.
  //
  // Ordered BEFORE the /api/ fallthrough below, or that guard would answer
  // this route with a 404 before it was ever reached.
  const commits = pathname.match(/^\/api\/agent\/([^/]+)\/commitments$/);
  if (commits && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(commits[1]);
    if (name === null) { sendJson(res, 404, { error: 'that is not a name we can read' }); return; }
    // Guarded on its own merit. Every other engine call in this file is inside
    // a try or a promise catch; this one was handed straight to the socket, so
    // any future throw from the store would exit the process rather than answer
    // an error. read() is documented never to throw, and it did once.
    // ⚠️ The THIRD name-keyed consumer, and the comment at `knownAgent` that
    // exists specifically to correct an earlier claim of completeness listed
    // two and missed this one — in the same file. Twice now a correction has
    // itself been incomplete.
    //
    // The board does not call this route today. The restart dialog will, and it
    // is the caller that would fetch the real agent's commitment text by name
    // to display as the cost of clearing a stranger's pane, which is the exact
    // measured failure this branch closes elsewhere. Gating it now costs
    // nothing and closes it before the consumer arrives.
    // ⚠️ NOT `knownAgent`, which was the first attempt and was too strict: it
    // requires the agent to be on the board right now, and a record's whole
    // purpose is to outlive the conversation — an agent that is stopped
    // entirely must still be readable. Two tests caught that immediately.
    //
    // The danger is narrower than "is it running". It exists only when a pane
    // IS on the board under this name and that pane is NOT tied to it: then the
    // caller asking for `angel` gets the real Angel's commitment text while the
    // card in front of them is a stranger's. If no pane claims the name at all,
    // there is nobody to be confused with.
    if (borrowedName(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    try {
      sendJson(res, 200, commitments.read(name));
    } catch {
      sendJson(res, 500, { error: 'that agent record could not be read' });
    }
    return;
  }

  if (commits && req.method === 'PUT') {
    const name = decodeSegment(commits[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    readBody(req)
      .then((buf) => {
        const patch = JSON.parse(buf.toString('utf8') || '{}') || {};
        // A bare list is the whole payload: this is an assertion of everything
        // the agent holds, not an addition to it. An append would make "I hold
        // nothing" unsayable, which is the one thing this record exists for.
        if (!Array.isArray(patch.commitments)) {
          throw new Error('send a commitments list, even if it is empty');
        }
        commitments.report(name, patch.commitments);
        // Answer with the READ shape, not the raw record. The raw record has no
        // state and no `because`, so a client that asserted "I hold nothing"
        // got back a bare empty list -- exactly the shape this module exists to
        // keep out of callers' hands. Both verbs now speak the same
        // three-state vocabulary.
        sendJson(res, 200, commitments.read(name));
      })
      .catch((err) => sendJson(res, 400, { error: String(err.message) }));
    return;
  }

  // --- the person the agents work for --------------------------------------
  //
  // Answered once on the About-you step (no skip, at Josh's call); PUT also
  // re-teaches every tied agent, because "answer once and every agent you
  // make will know it" is the step's own sentence and a record nobody was
  // told about does not make it true. The read shape is three-state
  // (saved / absent / unknown-with-reason): absent is the wizard's normal
  // starting state, not an error, so it is a 200 like its commitments
  // sibling, never a 404 the screen has to special-case.
  /**
   * --- agent-to-agent messages ---------------------------------------------
   *
   * POST body: { to, text, from_pane, in_reply_to? }. The sender is NOT in
   * the body -- it is derived from the pane the caller's `kosmos msg` ran
   * inside (engine/messages.resolveSender), which is what keeps the
   * attribution a fact rather than a typed claim. The verdict passes
   * through whole, three states and all, for the same reason the project
   * chat's does: `unconfirmed` folded into failure invites the duplicate
   * re-send.
   */
  /**
   * An agent answering the person, in the box on its own page.
   *
   * 🛑 THE THING THAT DID NOT EXIST. Two calls in this file wrote into a
   * conversation and both were operator-only, so an agent had nowhere to put a
   * reply: it answered in its own session, which reaches nobody, and a person
   * watched an empty box (#175). The two commands an agent knew were `post`
   * (a room) and `msg` (types into ANOTHER AGENT'S terminal) — neither one
   * reaches the person.
   *
   * ⚠️ THE SENDER IS THE PANE, NEVER A NAME IN THE BODY, which is the same rule
   * `/api/msg` follows: a name in a request is a claim by the caller, and any
   * local process could make it. `resolveSender` ties the pane to a card on the
   * roster, so a body naming somebody else changes nothing.
   *
   * 🛑 AND A PANE IS A CLAIM TOO, said plainly because an earlier version of
   * this comment said "an agent can only ever write as itself" and that is
   * stronger than the code. Pane ids are enumerable —
   * `tmux list-panes -a -F '#{pane_id} #{session_name}'` — so any local process
   * can pass a second agent's pane and have this write as that agent.
   *
   * ⚠️ WHAT MAKES IT WORSE HERE THAN ON `/api/msg`, which has the identical
   * exposure: that route types into a live terminal somebody can watch, and
   * this one PERSISTS a false attribution into the record the screen reads.
   * The browser vector is closed by `crossSiteWrite`; the local-process one is
   * not, and nothing on this machine separates one local program from another.
   * Recorded rather than papered over, because a secret the CLI holds would sit
   * in a file the same processes can read.
   *
   * ⚠️ AND THERE IS NO DELIVERY STATE HERE. The person's own sends carry one
   * because a message must cross into a terminal and may not arrive. This
   * writes straight into the record the screen reads: the append IS the
   * arrival. Reporting `placed` would invent a mechanism that did not happen —
   * the claim-table rule, applied to the direction nobody had built yet.
   */
  if (pathname === '/api/whoami' && req.method === 'POST') {
    /**
     * What THIS agent is running on, answered to the agent itself (#1304).
     *
     * Josh, 2026-08-28: *"I asked the models to tell me what account they were
     * on. One of them could not tell me this. One of them could and then
     * another one told me that they couldn't."*
     *
     * 🛑 THE INCONSISTENCY WAS WORSE THAN THE IGNORANCE. Three agents, three
     * different answers, so a person who gets one reasonably concludes the
     * others are broken. This route exists so the answer has ONE SHAPE from
     * every agent on the machine, including when the honest answer is that we
     * do not know.
     *
     * 🔑 THE SENDER IS DERIVED, NEVER NAMED, the same chain `/api/report` uses:
     * an agent cannot ask who SOMEBODY ELSE is by naming them. There is no
     * `agent` parameter for that reason.
     *
     * 🔑 AND EVERY FACT COMES FROM THE DERIVATION THE BOARD ALREADY USES.
     * `accountForAgent` is the status route's own lookup, lifted to be shared
     * rather than copied, and the model comes from `status.readModel`, which is
     * what fills the card. An agent that contradicted the board about its own
     * account would be worse than one that said nothing.
     */
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch { body = {}; }
        const roster = safeRoster();
        if (roster === null) {
          sendJson(res, 200, { ok: false, because: 'we could not check which agents are running, so we could not tell who you are' });
          return;
        }
        const sender = resolveAgentSender(req, body, roster);
        if (!sender.ok) { sendJson(res, 200, { ok: false, because: sender.because }); return; }
        const who = sender.card.sessionName;
        const known = (() => { try { return accounts.list(); } catch { return []; } })();
        /* The tmux session, taken from the roster row rather than rebuilt from
           the board name: `sessionName` is `angel` and the session is
           `angel-discord`, and a second place that knows that convention is a
           second place to get it wrong. A token-resolved paneless agent has no
           session at all, which is exactly when the live reader cannot answer. */
        /* ⚠️ LATENCY BUDGET, STATED BECAUSE IT IS NOT FREE. `runningAs` makes
           three synchronous `execFileSync` calls, each with its own 5s timeout,
           on a single-threaded server, after `safeRoster()` has already
           enumerated tmux. The CLI calls this route with `curl -m 15`, so a
           degraded `tmux` or `ps` makes whoami TIME OUT rather than fall back:
           the fallback covers "cannot see the agent", not "the reader was
           slow".

           🛑 AND THE ARITHMETIC, WHICH THIS COMMENT USED TO OMIT WHILE NAMING
           THE RISK: 3 x 5s = 15s, and `install/kosmos` `cmd_whoami` uses
           `curl -m 15`. The budget does not merely approach the client timeout,
           it EQUALS it. So in the degraded case the verb prints "Kosmos did not
           answer" instead of the record answer it could have given - which is
           the failure this card exists to remove, reappearing at the timeout
           rather than at the reader.

           ⚠️ `/api/whoami` is also unauthenticated on a single-threaded server,
           so that is up to 15s of blocking from any local process.

           📌 NOT FIXED HERE, DELIBERATELY. The timeouts live in `runningas`'s
           default readers and belong to every caller of that module, so
           shrinking them from this route would be a product change smuggled
           into a wiring change. Carded instead; the honest arithmetic is above
           so the next reader does not have to derive it. */
        const live = (() => {
          const sess = sender.card.session;
          if (!sess) return null;
          try { return liveReader()(sess); } catch { return null; }
        })();
        const seenLive = whoamiFor(sender.card, known, live);
        const account = seenLive.account;
        /* ⚠️ THE TWO FACTS ARE SEPARATE AND ONE MUST NOT STAND IN FOR THE OTHER.
           The card says so in as many words: an agent that answers "I am Claude
           Opus" has answered the easier question and not the one that was
           asked. So the model never fills in for a missing account, and each
           carries its own null. */
        const model = seenLive.model;
        sendJson(res, 200, {
          ok: true,
          agent: who,
          account,
          model,
          /* WHICH reader answered. An operator comparing two agents should be
             able to see that one was read from its running process and the
             other from a file. */
          source: seenLive.source,
          /* One sentence a person can read out, so an agent asked in plain
             words does not have to compose one and get it subtly wrong. */
          because: sentenceForWhoami(account, model),
        });
      })
      .catch(() => sendJson(res, 200, { ok: false, because: 'we could not read that request' }));
    return;
  }
  if (pathname === '/api/report' && req.method === 'POST') {
    /* #188's third verb: records rather than delivers. The agent says what
       it is DOING (one of selfreport.STATES); nothing is typed anywhere,
       nothing fans out. The board reads the record back through
       `status.reconcileReport`, where a fresh report outranks the pane.

       🔑 THE SENDER IS DERIVED, NEVER NAMED BY THE SENDER. There is no
       `from` field to fill in: the caller presents a HANDLE, we map it, and
       the roster tie (`isNamedOurs`) decides whether that row may speak.

       🛑 THIS COMMENT USED TO SAY a report "anyone on the machine could
       forge would not be evidence", implying none could. AND A PANE IS A
       CLAIM TOO: pane ids are enumerable with `tmux list-panes`, and this
       server binds loopback with no auth, so a local process can pass a
       second agent's pane and have this record as that agent. That is not a
       new finding -- the `/api/reply` comment a few hundred lines up already
       says it, in those words, after its own too-strong wording was
       corrected. This route's copy was simply never updated with it, which
       is how one codebase ends up holding both the correction and the thing
       it corrected. Fixed on #570.

       🔑 ONE RESOLVER CHAIN, TOKEN FIRST, PANE SECOND (#570 item 2). An
       agent with no pane -- Windows, or an SDK runner that was never in a
       terminal -- presents the launch token it was handed instead. Both arms
       return the same `{ ok, card }` and the same failure shape, because a
       Windows path living beside a Mac path is two copies of one fact.

       ⚠️ NO DOWNGRADE. A presented token DECIDES: if it does not resolve we
       refuse rather than falling back to the pane. A caller free to choose
       which identity check judges it would choose the weakest one. */
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch {
          const bad = new Error('that request is not something we can read');
          bad.status = 400; throw bad;
        }
        if (!body || typeof body !== 'object') {
          const bad = new Error('that request is not the shape we expect');
          bad.status = 400; throw bad;
        }
        const roster = safeRoster();
        if (roster === null) {
          sendJson(res, 200, { recorded: false, because: 'we could not check which agents are running, so we could not tell who this is from' });
          return;
        }
        const sender = resolveAgentSender(req, body, roster);
        if (!sender.ok) { sendJson(res, 200, { recorded: false, because: sender.because }); return; }

        const who = sender.card.sessionName;
        const kept = selfreport.record(who, {
          state: body.state,
          project: typeof body.project === 'string' ? body.project : undefined,
          because: body.text,
          on: body.on,
          owner: body.owner,
          until: body.until,
          /* #570: which RUN said it, when the sender came from a launch token.
             The pane arm resolves no instance and leaves this undefined. */
          instance: sender.instance,
          /* #900: an AUTOMATIC write, from a lifecycle hook rather than the
             agent choosing to say it. Only the machine's `idle` is refused
             over a standing waiting state; see selfreport.record. */
          auto: body.auto === true,
        });
        if (kept.recorded !== true) {
          sendJson(res, 200, { recorded: false, because: kept.because });
          return;
        }
        /* 🛑 THE BEAT, AND WITHOUT IT NOTHING ELSE ON THIS ROUTE REACHES A
           PANELESS AGENT (#1502). `liveness.seen` had ZERO production callers
           from the day I wrote it: `panelessKeys` and the name arm of
           `resolveAgentSender` both gate on `liveness.alive(key) === true`,
           which cannot be true with no record, so a Windows agent could hold a
           valid token, report `blocked` correctly, and never appear on any
           board. Measured: the liveness directory had never been created on a
           machine that has run Kosmos for a week.

           🔑 A REPORT IS PROOF OF LIFE BY DEFINITION, so this is not a second
           signal to keep in step with the first -- it is the same fact, written
           where the roster can read it.

           ⚠️ AND IT IS DELIBERATELY NOT `selfreport.record`'s job. That module
           refuses anything without a valid state; a beat carries none, and
           routing liveness through it would make a timer assert `working` and
           overwrite a standing `blocked`. That is #900 and #1058, twice fixed.
           The two stay apart; only the CALL is shared.

           ⚠️ THROW-SAFE. Liveness is an improvement to a row, never a reason to
           refuse a report that has already been recorded. */
        try { liveness.seen(who); } catch { /* the report stands; the row may be thinner */ }
        /* The phone seam, AFTER the record, and with ZERO translation: the
           report's word IS notify's word. This is the state transition
           notify.js:26 has been waiting for -- `needs_you` stops being a
           pane scrape on every platform at once, because the agent said it. */
        if (body.state === 'needs_you') {
          notify.happened({ kind: 'needs_you', id: 'report:' + who + ':' + kept.at, agent: sender.card.name || who, session: who, project: null });
        }
        sendJson(res, 200, { recorded: true });
      })
      .catch((err) => sendJson(res, (err && err.status) || 400, { error: String((err && err.message) || err) }));
    return;
  }

  if (pathname === '/api/reply' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch {
          const bad = new Error('that request is not something we can read');
          bad.status = 400; throw bad;
        }
        if (!body || typeof body !== 'object') {
          const bad = new Error('that request is not the shape we expect');
          bad.status = 400; throw bad;
        }
        // Refused before anything is looked up, exactly as the operator's own
        // send is: a message we would never keep should not cost a roster read.
        const problem = chat.messageProblem(body.text);
        if (problem) { const bad = new Error(problem); bad.status = 400; throw bad; }
        /* The same impersonation refusal msg and post run. This route kept a
           reply carrying a delivery marker until #145's review caught it: the
           colleagues block promises the refusal on every send path, and this
           was the path that broke the promise.
           Bare 400, no logged refusal row, deliberately: this route's
           messageProblem refusal is equally bare (attribution would cost a
           roster read before refusing), and the block's warning is the
           compensating control that reaches the agent BEFORE the guard. */
        const marker = messages.markerProblem(body.text);
        if (marker) { const bad = new Error(marker); bad.status = 400; throw bad; }

        const roster = safeRoster();
        if (roster === null) {
          sendJson(res, 200, { kept: false, because: 'we could not check which agents are running, so we could not tell who this is from' });
          return;
        }
        /* ⭐ SAME RESOLVER CHAIN AS /api/report, TOKEN FIRST, PANE SECOND (#570).
           Reply was pane-only, which made it the half an agent without a
           terminal could not do: it could say what it was doing and could not
           answer you. That is half of #570's closing condition, and it is what
           "talk to my agents from my phone" needs from a Windows or SDK runner.
           🛑 AND IT IS ALSO A CONTAINMENT GAP: a pane name is guessable, so
           retiring the fallback on /api/report alone would have left this route
           forging-capable. The pane path has to leave BOTH or neither. */
        const sender = resolveAgentSender(req, body, roster);
        if (!sender.ok) { sendJson(res, 200, { kept: false, because: sender.because }); return; }

        const who = sender.card.sessionName;
        const at = new Date().toISOString();
        const kept = chat.appendMessage(chat.DIRECT, who, {
          text: body.text,
          at,
          from: who,
        });
        /* The phone seam, AFTER the record: a reply that was not kept is not
           something the phone can fetch. The id is the thread's own key for
           the row (agent plus time), so a coordinator can de-duplicate and a
           phone can ask the Mac for this one. */
        if (kept.recorded === true) {
          notify.happened({ kind: 'replied', id: 'reply:' + who + ':' + at, agent: sender.card.name || who, session: who, project: null });
        }
        sendJson(res, 200, {
          kept: kept.recorded === true,
          because: kept.recorded === true ? null : kept.because,
        });
      })
      .catch((err) => sendJson(res, (err && err.status) || 400, { error: String((err && err.message) || err) }));
    return;
  }

  if (pathname === '/api/msg' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch {
          const bad = new Error('that request is not something we can read');
          bad.status = 400;
          throw bad;
        }
        // `null` is valid JSON and survives the parse; dereferencing it
        // would answer a raw TypeError -- codes, not sentences.
        if (!body || typeof body !== 'object') {
          const bad = new Error('that request is not the shape we expect');
          bad.status = 400;
          throw bad;
        }
        const roster = safeRoster();
        if (roster === null) {
          sendJson(res, 200, { delivery: { state: 'could_not', because: 'we could not check which agents are running, so nothing was sent' } });
          return;
        }
        const delivery = messages.send({
          fromPane: body.from_pane,
          to: body.to,
          text: body.text,
          inReplyTo: body.in_reply_to,
        }, roster);
        sendJson(res, 200, { delivery });
      })
      .catch((err) => sendJson(res, (err && err.status) || 400,
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  /* --- a post into a project room (View D) --------------------------------
     The same shape as /api/msg: the CLI's pane rides in, the engine does
     the judging. The route's one derivation is the member list, read off
     the project record so the engine owns no membership model. */
  if (pathname === '/api/post' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch {
          const bad = new Error('that request is not something we can read');
          bad.status = 400;
          throw bad;
        }
        if (!body || typeof body !== 'object') {
          const bad = new Error('that request is not the shape we expect');
          bad.status = 400;
          throw bad;
        }
        const roster = safeRoster();
        if (roster === null) {
          sendJson(res, 200, { delivery: { state: 'could_not', because: 'we could not check which agents are running, so nothing was posted' } });
          return;
        }
        let found = null;
        try { found = projects.get(String(body.project == null ? '' : body.project).trim(), roster); } catch { found = null; }
        if (!found) {
          sendJson(res, 200, { delivery: { state: 'could_not', because: 'there is no project by that name, so there is no room to post into' } });
          return;
        }
        // An archived project still accepts posts, a RECORDED trade: the
        // archive hides a project from the list and stops it counting,
        // and nothing else in the app gates behavior on it (an archived
        // project's detail is still reachable and its members are still
        // its members). If archive ever comes to mean "closed", this is
        // the line that changes.
        const members = (found.agents || []).map((a) => a.sessionName);
        const delivery = messages.sendPost({
          fromPane: body.from_pane,
          project: found.id,
          // The NAME for the envelope the agent reads, the id for everything a
          // machine keys on. Both, from the same record, so they cannot drift.
          projectName: found.name,
          text: body.text,
        }, roster, members);
        /* An agent posted in a room: the phone seam (engine/notify.js). Only
           a post that reached the room is something that happened; a refusal
           is not. The sender's shown name and the project's name, never the
           words. */
        if (delivery && delivery.state !== 'could_not') {
          const card = roster.find((c) => c && c.sessionName === delivery.from) || null;
          notify.happened({ kind: 'posted', id: delivery.id || null, agent: (card && card.name) || delivery.from || 'an agent', session: delivery.from || null, project: found.name });
        }
        sendJson(res, 200, { delivery });
      })
      .catch((err) => sendJson(res, (err && err.status) || 400,
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }
  /* The `/api/agent/:name/conversation` route is gone with the box that
     read it (Josh, 2026-08-23 12:38). It merged every project thread and the
     agent-to-agent record into one tail for the agent page; a room's
     messages are read in that room, and nothing else asked for the merge. */
  /**
   * --- the thread between the person and ONE agent -------------------------
   *
   * The project thread's sibling, and the difference is what it is FOR: that
   * one belongs to a project and an agent on it, this one belongs to nobody
   * else. The pack puts the private exchange, and the answer to a question the
   * agent is asking, on the agent's own page — so the record has to outlive
   * every project the agent is or was on, which is why it is filed under
   * `chat.DIRECT` and carries no project stamp.
   *
   * ⚠️ THE GATE IS `nameRefusal` (the reason `borrowedName` is a wrapper for),
   * NOT `knownAgent`, and the commitments route learned this first: a record
   * whose purpose is to outlive the conversation must stay readable when the
   * agent is STOPPED. The danger is narrower than
   * "is it running" — it is a pane sitting on the board under this name that is
   * not tied to it, which would serve the real agent's private thread beside a
   * stranger's card. If no pane claims the name, there is nobody to confuse it
   * with. (The PLAN for this branch said 404-unknown; that would have hidden a
   * stopped agent's own conversation, which is the thing the file exists for.)
   */
  const dm = pathname.match(/^\/api\/agent\/([^/]+)\/thread$/);
  if (dm && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(dm[1]);
    // 404 on the read and 400 on the write for the same unreadable segment,
    // which looks inconsistent and is the commitments route's own split: a
    // read of a name we cannot even decode is "no such agent", a write is a
    // malformed request. Matched to the sibling that shares this gate rather
    // than to the project-thread route, which shares neither.
    if (name === null) { sendJson(res, 404, { error: 'that is not a name we can read' }); return; }
    /**
     * ⚠️ A NAME NO PANE RUNS AT ALL passes this and gets a 200 with an empty
     * thread, while the POST 404s. That asymmetry is deliberate and it is the
     * commitments route's: a record stays READABLE for an agent that is not
     * running (that is what a record is for), and is not WRITABLE, because
     * there is nothing to type into.
     *
     * ⚠️ AND IT DOES NOT HIDE WHICH NAMES EXIST. An earlier version of this
     * comment claimed it did — that an unknown name and a stopped agent
     * "answer identically" — which is simply false: `presenceBecause` carries
     * `addressable`'s own two sentences, and "we cannot see an agent by
     * exactly this name" is plainly not "there is no Claude running in its
     * window". The claim was never tested, and it was wrong. Nothing here is
     * an authentication boundary (the whole app is an unauthenticated
     * loopback server, as `start()` says at length), so this is recorded as
     * what it is rather than defended: the route tells you whether a name is
     * running, and so does every other route on this port.
     */
    /* ⚠️ THE REASON RIDES THE 404, because the page draws two different
       sentences off it and cannot derive which from the status. See
       `nameRefusal`: 'borrowed' is standing and 'unreadable' is a blip. */
    const refusal = nameRefusal(name);
    if (refusal) {
      sendJson(res, 404, {
        error: refusal === 'borrowed'
          ? 'no agent by that name'
          : 'we could not check which agents are running',
        because: refusal,
      });
      return;
    }
    /**
     * ⚠️ ONE roster read for everything DERIVED BELOW THIS LINE, which is a
     * narrower claim than the one that used to sit here.
     *
     * The earlier comment said "one roster read for the whole request", and
     * that is false: `nameRefusal` a few lines up runs `claimantFor` ->
     * `paneRoster()`, its own uncached `tmux list-panes`. So a GET makes two,
     * and the 404 gate is decided against a different look from the one the
     * payload describes. The harm the comment warns about is therefore
     * REACHABLE at that seam, and pretending otherwise is worse than saying so.
     *
     * ⚠️ AND THE SECOND HALF OF THAT SENTENCE WAS ALSO WRONG. It said every
     * value below comes from this one snapshot. `presence` and `asking` do.
     * `question` does NOT: `chat.viewport` runs its own, later `capture-pane`,
     * with different flags and a different depth (60 lines with `-J`, against
     * the snapshot's 40 without, of which `classify` reads the last 25).
     * `questionIn`'s docblock documents that divergence at length, and
     * `questionBecause` exists precisely because the two reads can disagree.
     * So this route makes two roster reads AND two captures, and the honest
     * claim is only that nothing below re-reads the ROSTER.
     */
    const roster = safeRoster();
    const card = Array.isArray(roster)
      ? (roster.find((a) => a && a.sessionName === name && a.isNamedOurs === true) || null)
      : null;

    /**
     * ⚠️ TWO HISTORY CHANNELS, NOT THREE. `historyOther` has no meaning here:
     * it says "an EARLIER project of this name has messages kept aside", and
     * this thread has no project to have been born with. Carrying the field
     * anyway would be a surface that can never be true.
     */
    let messages = null;
    let historyBecause = null;
    let historyUnfilable = false;
    try {
      // No `bornAt`: a direct thread outlives every project, so there is no
      // birth date for it to be refused against.
      messages = chat.readThread(chat.DIRECT, name).messages;
    } catch (err) {
      if (err && err.code === 'BAD_THREAD') {
        // There is no file and there never will be one — the agent's name
        // cannot be filed under. Sending still works; nothing is kept.
        messages = [];
        historyUnfilable = true;
        historyBecause = String((err && err.message) || 'we cannot keep a conversation under this agent’s name');
      } else {
        historyBecause = String((err && err.message) || 'we cannot read what you have sent this agent');
      }
    }

    // The board's word, through the engine's own constant. `tied` is implied
    // by the card lookup above (isNamedOurs), which is the same conjunct the
    // project route spells out.
    const asking = Boolean(card) && card.state === STATE.NEEDS_YOU;
    /**
     * ⚠️ THE CAPTURE RUNS ONLY WHEN THE QUESTION NEEDS IT, and that is a
     * DIFFERENT gate from the one the project thread refused.
     *
     * That route captures unconditionally, and its comment says why: an early
     * version gated on ENGINEERING MODE and silently blinded the needs-you flow
     * with the switch off. That was gating on a setting unrelated to the
     * question. This gates on `asking` — the board's own word for whether there
     * is a question at all — so the question path is untouched by construction:
     * when `asking` is false there is nothing for `questionIn` to find.
     *
     * It matters because this route rides the 5s tick on the app's most-visited
     * screen. `safeRoster()` is already one `list-panes` plus a `capture-pane`
     * PER AGENT; an unconditional second capture here added another one every
     * tick, for an idle agent, to feed nothing.
     *
     * ⚠️ AND THE RAW WINDOW IS NOT SERVED FROM HERE AT ALL. This page already
     * has `/api/agent/:name/window` for that (no longer behind Engineering
     * mode since agent-page-nav; the switch governs this page's viewport
     * only), with its own box. A second copy on this payload was an unread surface on a poll,
     * the thing rounds 19, 22 and 38 deleted three times.
     */
    const view = asking ? chat.viewport(name, roster) : null;
    const question = (asking && view && view.text) ? chat.questionIn(view.text) : null;
    // The same two sentences as the project route, and they stay two: "we read
    // its screen and the question is not in the capture" is not "we could not
    // read its screen at all".
    const questionBecause = (asking && !question)
      ? ((!view || view.text == null)
        ? 'we could not read its screen just now to show the question'
        : 'we cannot find the question on its screen right now')
      : null;
    /**
     * ⚠️ THE BUTTONS ARE OFFERED ONLY WHEN THE MENU IS CERTAIN. `optionsIn`
     * returns null for anything it cannot be sure of, and null here is not a
     * degraded state — it is the screen this page shows today, the question as
     * the terminal draws it, which the person can answer by typing.
     */
    const options = (asking && question) ? chat.optionsIn(question.text) : null;
    /**
     * ⚠️ PRESENCE IS THE SEND GATE'S OWN ANSWER, not a second derivation of it.
     * The first version of this route asked whether a tied card existed, which
     * is a WEAKER question than "can we type into it" and got a measurable case
     * wrong: a STOPPED agent has a card (its pane is alive, its name is ours)
     * and no Claude in the window, so the composer invited a message that
     * `chat.deliver` would then refuse. Two derivations of one fact, disagreeing
     * on screen, is this codebase's worst habit and it had crept back in.
     *
     * `addressable` also carries the SENTENCE, which is better copy than
     * anything this route could compose: it tells apart a window with no Claude
     * in it (what we typed would be run as a command) from one scrolled back in
     * copy-mode (what we typed would go to the scrollback). The composer says
     * whichever is true.
     *
     * ⚠️ THREE-VALUED, because "there is nobody there" and "we could not look"
     * are different facts. The `unsure` arm is NOT reachable through today's
     * producers — a roster read that fails also fails `nameRefusal` above,
     * which fails closed at the 404 — so no test here holds it. It stays,
     * recorded rather than quietly kept, because the two reads are separate
     * calls (`snapshot` here, `listPanes` there) and the day they can disagree
     * is the day this arm is the difference between "your agent is off" and the
     * truth. Same posture as the thread route's `member.tied` conjunct.
     */
    const reach = chat.addressable(name, roster);
    const presence = reach.ok ? 'on' : (!Array.isArray(roster) ? 'unsure' : 'off');
    const presenceBecause = reach.ok ? null : reach.because;
    const TAIL = 200;
    const olderCount = Array.isArray(messages) && messages.length > TAIL
      ? messages.length - TAIL : 0;
    if (olderCount) messages = messages.slice(-TAIL);
    /**
     * ⚠️ EVERY FIELD HERE HAS A READER ON THE PAGE. The first version also
     * carried `agent`, `viewport` and `agentsUnreadable` "for parity with the
     * sibling route", and nothing on this screen read any of them — on a
     * 5-second poll. This repo has deleted exactly that three times (the
     * payload's agents copy in round 19, readIdentity's source in round 22, the
     * POST's thread in round 38), and parity with a route that draws a
     * different screen is not a reader.
     *
     * `presence` already carries what `agentsUnreadable` would have said, in
     * the vocabulary the composer uses ('unsure'), so a second spelling of it
     * would be two derivations of one fact again.
     */
    const owes = messageLog.owesReply(name);
    sendJson(res, 200, {
      messages: withPreviews(messages),
      olderCount,
      historyBecause,
      historyUnfilable,
      /* 🔑 THE MISSING HALF OF A SIGNAL THE ROOM ALREADY HAS. `pjSilentSince`
         is gated on a project having two or more members, so a one-to-one
         thread had nothing at all. This is that, for this box (#5).
         ⚠️ IT RIDES HERE RATHER THAN ON THE STATUS PAYLOAD: it is a fact about
         this conversation and the board has no line to draw it on.
         🛑 AND IT IS `owesReply` ON THE MODULE, WHICH IS SHADOWED IN THIS
         SCOPE. `messages` here is the local array being sent; the module of
         the same name is not reachable by that identifier inside this handler,
         so it is captured under its own name at the top of the file. */
      owes,
      presence,
      presenceBecause,
      asking,
      question,
      questionBecause,
      options,
    });
    return;
  }

  if (dm && req.method === 'POST') {
    const name = decodeSegment(dm[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((buf) => {
        let body;
        try {
          body = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          throw new Error('we could not read that request');
        }
        // Refused before anything is looked up, so a message we would never
        // send does not cost a tmux fan-out.
        const problem = chat.messageProblem(body.text);
        if (problem) throw new Error(problem);
        /**
         * ⚠️ `chose` IS THE OPTION'S OWN WORDS, and it is bounded like any
         * other text off the wire. It rides only on a button send: the bubble
         * shows what the person CHOSE ("Yes, and don't ask again"), while the
         * wire text — the digit the agent's prompt is waiting for — is kept
         * beside it. A thread that recorded only the digit would show "1" for
         * an answer nobody would recognise a week later; one that recorded
         * only the words would misdescribe the mechanism. Both, or the record
         * lies one way or the other.
         */
        /**
         * ⚠️ CHECKED BY THE SAME GATE AS THE TEXT, not by a hand-rolled pair of
         * conditions. `chose` is never typed into a pane, so the first version
         * only bounded its length — but this module's contract is that what was
         * CHECKED is what gets KEPT, and `cleanMessage` does not strip control
         * characters. An ESC or a C1 byte in an option label would have gone
         * into the stored thread and back out to the screen, refused everywhere
         * else in the product and admitted here.
         *
         * A bad `chose` is not a bad send: the digit is still what the agent is
         * waiting for. So it is dropped rather than refused, and the bubble
         * falls back to showing what was actually sent.
         */
        let chose = (typeof body.chose === 'string' && !chat.messageProblem(body.chose))
          ? body.chose : null;

        // The write gate FIRST, then the expensive look. `knownAgent` is a
        // `list-panes`; `safeRoster` is that plus a `capture-pane` per agent —
        // so ordering them the other way made a POST for a name nobody runs
        // pay for the whole fan-out before its 404, against this route's own
        // rule two blocks up that a message we would never send must not cost
        // a tmux fan-out.
        // (`chat.deliver` refuses on its own too — exact match to permit, tied,
        // and a pane with Claude in it. This one is about the NAME.)
        if (!knownAgent(name)) {
          const missing = new Error('no agent by that name');
          missing.status = 404;
          throw missing;
        }
        const roster = safeRoster();
        /**
         * ⚠️ THE WORDS ARE CHECKED AGAINST THE SCREEN WHERE WE CAN SEE IT.
         * `chose` arrives from the client, and it is the half of the pair the
         * server does not derive — so a client bug could put words in the
         * record that were never on the person's screen, under a mechanism
         * that says the opposite. Where the pane still shows a menu we can
         * parse, the label for that digit must be the label we were handed.
         *
         * ⚠️ AND IT IS NOT REQUIRED WHERE WE CANNOT SEE IT. A pane that has
         * already redrawn parses to nothing, and the person DID read those
         * words a moment ago — dropping them there would make the record less
         * faithful in the ordinary case to defend against a case this app's
         * single-origin write guard already covers. So: never claim words the
         * visible screen contradicts, and do not demand proof from a screen
         * that has moved on. The digit is unaffected either way; only the
         * bubble's wording is at stake.
         */
        if (chose) {
          /**
           * ⚠️ A BUTTON SEND IS REFUSED WHEN THE SCREEN CONTRADICTS IT, rather
           * than stripped of its words and sent anyway.
           *
           * The first version dropped `chose` on a contradiction and still
           * typed the digit. But a button's digit is only meaningful against
           * the menu it was drawn from: if the pane has redrawn into a
           * DIFFERENT menu, `3` no longer means what the person pressed, and we
           * would be sending an answer to a question they never saw. Losing the
           * words was treated as the whole problem when the words were the
           * evidence that the digit was stale too.
           *
           * ⚠️ ONLY WHERE THERE IS POSITIVE EVIDENCE. A pane that has moved on
           * parses to no menu at all, and that is NOT a contradiction: the
           * person did read those words a moment ago, and refusing there would
           * refuse the ordinary case. So: a menu we can read that disagrees is
           * a refusal; a screen we cannot read a menu from is not.
           */
          /**
           * ⚠️ AND ONLY WHERE SOMETHING IS BEING ASKED. `chose` is words the
           * client says were on a button; if the board does not say this agent
           * is asking anything, there was no button. A stale or buggy client
           * could otherwise POST `{text:'ok', chose:'Approve the wire
           * transfer'}` at an idle agent, and because a non-question screen
           * parses to no menu, the verification below would be skipped and the
           * record would keep words nobody was ever offered.
           *
           * The roster is already read, so this costs nothing.
           */
          const card = Array.isArray(roster)
            ? (roster.find((a) => a && a.sessionName === name && a.isNamedOurs === true) || null)
            : null;
          if (!card || card.state !== STATE.NEEDS_YOU) chose = null;
          const seen = chose ? chat.viewport(name, roster) : null;
          const asked = (seen && seen.text) ? chat.questionIn(seen.text) : null;
          const menu = asked ? chat.optionsIn(asked.text) : null;
          const row = menu ? menu.find((o) => String(o.n) === String(body.text).trim()) : null;
          /* ⚠️ COMPARED AS IT WILL BE STORED. `appendMessage` puts the bubble
             text through `cleanMessage`, so comparing the raw string here
             admitted a label that then changed on its way into the record --
             small, and the whole point of this pair is that the record does not
             drift from the screen. */
          if (chose) chose = chat.cleanMessage(chose);
          if (menu && (!row || chat.cleanMessage(row.label) !== chose)) {
            const moved = new Error('that question changed on its screen before this was sent, '
              + 'so we did not answer it. Its current question is on this page.');
            moved.status = 409;
            throw moved;
          }
          /**
           * ⚠️ AND WHICH QUESTION, not only which words. The check above
           * verifies the label for the pressed digit and nothing about the
           * question it belongs to -- and this product's most common menu draws
           * the SAME labels every time. Measured: "Edit file src/a.js? / ❯ 1.
           * Yes / 2. No" and the same prompt for `src/b.js` produce identical
           * options, so a pane that redrew between the paint and the POST
           * passed verification and `1` approved a file nobody chose. The guard
           * was weaker than the sentence describing it.
           *
           * The page has held the discriminator since the answered-hold was
           * written; it just never sent it. `asked` is that text, and
           * `questionAbove` is the engine's twin of the rule that computes it,
           * so both sides compare the same fact rather than two spellings.
           *
           * Optional on the wire: a client that does not send it is no worse
           * off than before, and a button send from this page always does.
           */
          /**
           * ⚠️ BOUNDED, NOT GATED, and `messageProblem` here disabled the guard
           * silently. It refuses over MAX_TEXT and on any control character,
           * and a refusal made `askedAbove` null, which skips this check with
           * no error and no log. `viewport` captures with `-J`, which JOINS
           * wrapped lines, so one logical line of agent output can be
           * arbitrarily long -- the guard would switch itself off on exactly
           * the busiest screens. This field is compare-only and never stored,
           * so the right treatment is to bound BOTH SIDES identically and
           * compare what is left, rather than to stop looking.
           */
          const bound = (v) => chat.cleanMessage(v).slice(0, 2000);
          const askedAbove = typeof body.asked === 'string' && body.asked.trim()
            ? bound(body.asked) : null;
          const nowAbove = asked ? chat.questionAbove(asked.text) : null;
          const nowClean = nowAbove ? bound(nowAbove) : null;
          /**
           * ⚠️ EQUALITY, and containment was a hole rather than a fix.
           *
           * Containment was written for a false refusal: the identity moved
           * when the cursor did, because `questionIn` anchors on the last
           * needs-you marker and the marked option line is one. But a pane
           * ACCUMULATES, so a genuinely new question's window legitimately
           * contains the answered one's, and `includes` called that the same
           * question. Measured end to end through the real producers: buttons
           * drawn for "Do you want to proceed?", the pane redrew to `rm -rf
           * /Users/josh/build` above the same Yes/No menu, both 409s passed,
           * and "1" went through.
           *
           * The cursor problem is fixed where it belongs -- `questionAbove` now
           * keys on the last three meaningful lines ABOVE the run, which do not
           * move when the window's top does -- so equality is exact again, and
           * exact is what a guard against answering the wrong question needs.
           */
          const sameQuestion = askedAbove !== null && nowClean !== null && nowClean === askedAbove;
          if (askedAbove && nowClean && !sameQuestion) {
            /* ⚠️ TRUE OF BOTH CAUSES. This fires when the screen genuinely moved
               on AND when only the cursor moved inside the same question -- see
               `questionAbove` for why the second is a known cost rather than an
               oversight. "It is asking something else now" is false in the
               second case, and a sentence that is false half the time it is
               shown teaches people to ignore it. This one says what we know
               (the screen moved since the press) and what to do about it. */
            const moved = new Error('its screen moved between drawing that button and sending it, '
              + 'so we did not send the answer. What is on this page now is current: press again '
              + 'if it is still the one you want.');
            moved.status = 409;
            throw moved;
          }
        }
        // Deliver first, then record the verdict with it — and record even a
        // failure, exactly as the project thread does.
        /* An attached file (#358): the record rides the row, and the pane is
           told the file's path in the bracketed line so the agent can open it. */
        const files = attachments.resolveForMessage(body, 'agent', name, 'that attachment is not one this conversation can send');
        if (!files.ok) throw new Error(files.because);
        const delivery = chat.deliver(name, body.text, roster, messages.OPERATOR_DIRECT, attachments.wireNote(files.recs));
        const kept = chat.appendMessage(chat.DIRECT, name, {
          ...attachments.rowFields(files.recs),
          text: chose || body.text,
          /**
           * The PERSON'S words as they reached the pane, when they are not the
           * words the bubble shows.
           *
           * ⚠️ NOT "everything that was typed", which it was called until the
           * operator envelope landed above and made that phrasing false on
           * every row. The envelope is Kosmos's own framing, identical on all
           * of them, and storing a constant per message would be noise; what
           * this field reconciles is the bubble against the message. The
           * previous drift here was the same shape and is recorded below.
           *
           * ⚠️ THROUGH `cleanMessage`, because that is what `deliver` types.
           * Storing the raw body made this field's own comment false: a text
           * with interior padding or a newline is collapsed on the way to the
           * pane and was kept here uncollapsed, so the record's account of the
           * mechanism differed from the mechanism.
           */
          wire: chose ? chat.cleanMessage(body.text) : null,
          at: delivery.at,
          delivery,
        });
        // (No `agentsUnreadable`: nothing reads it here, and the GET on this
        // same route deleted the identical field for the identical reason.
        // One rule, both halves.)
        sendJson(res, 200, {
          delivery,
          recorded: kept.recorded === true,
          recordedBecause: kept.because || null,
        });
      })
      .catch((err) => sendJson(res, (err && err.status) || ((err && err.code === 'UNREADABLE') ? 500 : 400),
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  if (pathname === '/api/messages' && (req.method === 'GET' || req.method === 'HEAD')) {
    // The record the screens draw conversations from; ?agent= filters to
    // one agent's messages. Read-only, best-effort history.
    try {
      let who = null;
      try { who = new URL(req.url, ROUTING_BASE).searchParams.get('agent') || null; } catch { who = null; }
      sendJson(res, 200, { messages: withPreviews(messages.list(who)) });
    } catch (err) {
      sendJson(res, 500, { error: String((err && err.message) || 'we could not read the record') });
    }
    return;
  }
  /* --- which agents survive a restart ------------------------------------- */
  /* 🛑 THE QUESTION HAD NO ANSWER ANYWHERE. An agent with a login job and one
     without draw exactly the same card, so the only way to find out which of
     yours come back was to restart the computer. Josh did, on 2026-08-22, and
     one of his sixteen came back. */
  if (pathname === '/api/register' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { sendJson(res, 200, register.survey()); }
    catch { sendJson(res, 500, { error: 'we could not check which of your agents start on their own' }); }
    return;
  }
  /* ⚠️ POST, because it writes launchd jobs and starts processes. And it takes
     NO BODY: there is nothing to choose here, and the set it acts on is exactly
     the set the GET above reports, so the two can never describe different
     work. A body would let a caller name an agent the survey refused. */
  if (pathname === '/api/register' && req.method === 'POST') {
    try {
      /* The model each one LAST RAN AS, which is the only surviving record of
         it: the model an agent was SET to run on lived in the job that does not
         exist. A reading we cannot make travels as nothing, and that agent
         comes back on Claude's own default rather than not coming back. */
      const out = register.repair({
        modelFor: (name) => {
          try { const m = status.readModel(name); return (m && m.model) || null; }
          catch { return null; }
        },
      });
      sendJson(res, out.ok ? 200 : 500, out);
    } catch { sendJson(res, 500, { error: 'we could not set your agents to start on their own' }); }
    return;
  }
  /* --- engineering mode (whether the raw session is shown) ---------------- */
  /* The automatic-updates switch. Same shape as /api/engmode deliberately:
     one preference, GET to learn it, PUT to set it, and the READ is echoed
     back after a write rather than the request body -- so the screen paints
     what is stored, never what was asked for. */
  // --- what changed under a running board (#541) ---------------------------
  /* The seen-version record: one tiny file, so dismissed stays dismissed
     across restarts and browsers. First sight of a machine records the
     current version silently; the line only ever describes a CHANGE. */
  if (pathname === '/api/whats-new' && (req.method === 'GET' || req.method === 'HEAD')) {
    let seen = null;
    // ⚠️ `store.ROOT` ALONE, #891: `store.ROOT` already resolves
    // AGENT_WORKFORCE_DATA (engine/store.js joins it with the app's own
    // 'AgentWorkforce' subfolder when the env var is set, and falls back
    // to the real default otherwise). `process.env.AGENT_WORKFORCE_DATA ||
    // store.ROOT` looked like the same fallback but is not: when the env
    // var IS set it short-circuits PAST that join, landing this file one
    // directory above every other file the app writes. Unnoticed with the
    // env var unset (every real install), it is exactly the condition a
    // sandboxed install gate sets -- and exactly why that gate caught this
    // file surviving an uninstall that swept the correct directory.
    try { seen = JSON.parse(fs.readFileSync(path.join(store.ROOT, 'seen-version.json'), 'utf8')).version || null; } catch { seen = null; }
    sendJson(res, 200, { current: version, seen });
    return;
  }
  if (pathname === '/api/whats-new/seen' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; } catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const v = String(body.version || '');
        if (!/^\d+\.\d+\.\d+$/.test(v)) { sendJson(res, 400, { error: 'that is not a version we can record' }); return; }
        try {
          fs.mkdirSync(store.ROOT, { recursive: true });
          const tmp = path.join(store.ROOT, 'seen-version.json.tmp');
          fs.writeFileSync(tmp, JSON.stringify({ version: v }) + '\n');
          fs.renameSync(tmp, path.join(store.ROOT, 'seen-version.json'));
          sendJson(res, 200, { seen: v });
        } catch { sendJson(res, 500, { error: 'we could not record that' }); }
      })
      .catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
    return;
  }

  if (pathname === '/api/autoupdate' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { sendJson(res, 200, autoupdate.read()); }
    catch { sendJson(res, 500, { error: 'that setting could not be read' }); }
    return;
  }
  if (pathname === '/api/autoupdate' && req.method === 'PUT') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const saved = autoupdate.write({ on: body.on });
        if (!saved.ok) { sendJson(res, 400, { error: saved.because }); return; }
        sendJson(res, 200, autoupdate.read());
      })
      .catch(() => sendJson(res, 400, { error: 'we could not save that setting' }));
    return;
  }
  /* Link previews (#357). Two GETs that make this Mac fetch from the wider
     internet on the page's behalf, which is why they carry a guard the other
     GETs do not need: a GET is reachable from ANY website the person has open
     (an <img src="http://127.0.0.1:16180/api/unfurl/image?url=..."> on a page
     they visit), and these two would then fetch on a stranger's command and,
     for the image one, proxy the answer back to them. `crossSiteRead` refuses
     a request the browser marks as coming from another site; the engine's
     own gate (no private addresses, caps, redirects) stands behind it. */
  /* Attachments (#358). Upload is a raw body (the avatar route's shape, no
     multipart): PUT the bytes with the file's type as content-type and its
     name in x-attachment-name, get the record back, then post the message
     with `attachment: <id>`. Two steps so a failed upload is a sentence
     before anything is said, and so the 25 MB limit applies to the bytes
     alone. The file is served back as a download, never inline, and the
     preview is a PNG this Mac drew (or the image itself). */
  const attachUp = pathname.match(/^\/api\/(agent|project)\/([^/]+)\/attachment$/);
  if (attachUp && req.method === 'PUT') {
    const scope = attachUp[1];
    const owner = decodeSegment(attachUp[2]);
    if (owner === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    if (scope === 'agent' && !knownAgent(owner)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    if (scope === 'project') {
      let has = false;
      try { has = projects.readAll().some((p) => p.id === owner); } catch { sendJson(res, 500, { error: 'we could not read the projects' }); return; }
      if (!has) { sendJson(res, 404, { error: 'there is no project by that name' }); return; }
    }
    readBody(req, attachments.MAX_BYTES + 1)
      .then((bytes) => {
        let name = '';
        try { name = decodeURIComponent(String(req.headers['x-attachment-name'] || '')); } catch { name = String(req.headers['x-attachment-name'] || ''); }
        const rec = attachments.save(scope, owner, { name, type: req.headers['content-type'], bytes });
        sendJson(res, 200, { attachment: attachments.rowField(rec) });
      })
      .catch((err) => sendJson(res, 400, { error: String((err && err.message) || 'we could not keep that file') }));
    return;
  }
  const attachGet = pathname.match(/^\/api\/attachment\/([0-9a-f]{24})(\/preview)?$/);
  if (attachGet && (req.method === 'GET' || req.method === 'HEAD')) {
    const rec = attachments.read(attachGet[1]);
    if (!rec) { sendJson(res, 404, { error: 'no such attachment' }); return; }
    if (attachGet[2]) {
      attachments.preview(rec).then((pv) => {
        if (!pv.ok) { sendJson(res, 404, { error: pv.because }); return; }
        res.writeHead(200, { 'content-type': pv.type, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" });
        res.end(req.method === 'HEAD' ? undefined : pv.bytes);
      }).catch(() => sendJson(res, 404, { error: 'this computer could not draw the first page' }));
      return;
    }
    let bytes;
    try { bytes = fs.readFileSync(rec.file); } catch { sendJson(res, 404, { error: 'that file could not be read' }); return; }
    /* A download, whatever the type: a person's file is handed back as a
       file, and an HTML one never renders on the board's origin. */
    res.writeHead(200, {
      'content-type': rec.type, 'content-length': bytes.length, 'x-content-type-options': 'nosniff',
      'content-disposition': 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(rec.name),
      'content-security-policy': "default-src 'none'; sandbox",
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
    return;
  }
  if (pathname === '/api/unfurl' && req.method === 'GET') {
    const refusedRead = crossSiteRead(req);
    if (refusedRead) { sendJson(res, 403, { error: refusedRead }); return; }
    let target = '';
    try { target = new URL(req.url, ROUTING_BASE).searchParams.get('url') || ''; } catch { target = ''; }
    if (!target) { sendJson(res, 400, { error: 'say which link' }); return; }
    unfurl.preview(target).then((got) => {
      if (!got.ok) { sendJson(res, 200, { ok: false, because: got.because }); return; }
      sendJson(res, 200, {
        ok: true, url: got.url, title: got.title, description: got.description, site: got.site, fetchedAt: got.fetchedAt,
        /* The image is served back through this process, never as the site's
           own address: the browser never talks to the site. */
        image: got.image ? '/api/unfurl/image?url=' + encodeURIComponent(got.image) : '',
      });
    }).catch(() => sendJson(res, 200, { ok: false, because: 'we could not read that page' }));
    return;
  }
  if (pathname === '/api/unfurl/image' && req.method === 'GET') {
    const refusedRead = crossSiteRead(req);
    if (refusedRead) { sendJson(res, 403, { error: refusedRead }); return; }
    let target = '';
    try { target = new URL(req.url, ROUTING_BASE).searchParams.get('url') || ''; } catch { target = ''; }
    if (!target) { sendJson(res, 400, { error: 'say which image' }); return; }
    unfurl.image(target).then((got) => {
      if (!got.ok) { sendJson(res, 404, { error: got.because }); return; }
      /* Raster only (the engine refuses SVG), and sandboxed anyway: this is
         a third party's bytes on the board's own origin, so nothing in them
         may run or load. */
      res.writeHead(200, {
        'content-type': got.type, 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox", 'content-disposition': 'inline',
      });
      res.end(got.bytes);
    }).catch(() => sendJson(res, 404, { error: 'we could not read that image' }));
    return;
  }
  if (pathname === '/api/engmode' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { sendJson(res, 200, engmode.read()); }
    catch { sendJson(res, 500, { error: 'that setting could not be read' }); }
    return;
  }
  if (pathname === '/api/engmode' && req.method === 'PUT') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const saved = engmode.write({ on: body.on });
        if (!saved.ok) { sendJson(res, 400, { error: saved.because }); return; }
        sendJson(res, 200, engmode.read());
      })
      .catch(() => sendJson(res, 400, { error: 'we could not save that setting' }));
    return;
  }
  /* The agent page's raw window: the SAME derivation as the project
     viewport (chat.viewport, refusals and all), behind the same
     knownAgent gate as the instructions read, for the same reason: a
     name-shaped probe must not become a which-panes-exist oracle. */
  const agentWindow = pathname.match(/^\/api\/agent\/([^/]+)\/window$/);
  if (agentWindow && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(agentWindow[1]);
    if (name === null) { sendJson(res, 404, { error: 'that is not a name we can read' }); return; }
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    try {
      // 🛑 NO LONGER BEHIND THE ENGINEERING-MODE SWITCH (Josh, 2026-08-22, on
      // the agent-page mock: the agent's own page always shows its window;
      // the switch was for the project screen). The thread's viewport below
      // keeps its gate. A client that ungated its box while this route still
      // refused was the first thing the browser check photographed: a heading
      // over "engineering mode is off, so the window is not read", a screen
      // contradicting the switch's own new copy. One surface is governed by
      // the switch now, and this route is not it.
      // ⚠️ The cost is bounded by the CLIENT (Terminal section on screen,
      // tab visible, one in flight), not here: every request is a roster
      // read plus a capture-pane. Fine for a local single-person server;
      // a second client polling this route pays that every call.
      const roster = safeRoster();
      // Resolved to the card's OWN sessionName (the sessionOf lesson: a
      // spelling that passes the gate via the safeKey fallback would
      // exact-miss viewport's roster lookup and answer a refusal about
      // an agent that is right there).
      let exact = name;
      try { const card = claimantFor(name); if (card && card.sessionName) exact = card.sessionName; } catch { /* the gate already passed */ }
      sendJson(res, 200, chat.viewport(exact, roster));
    } catch {
      sendJson(res, 500, { error: 'we could not read its window just now' });
    }
    return;
  }

  /* --- the conversation limit (the person's control) ---------------------- */
  if (pathname === '/api/limits' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { sendJson(res, 200, { ...limits.read(), tiers: limits.TIERS }); }
    catch { sendJson(res, 500, { error: 'that setting could not be read' }); }
    return;
  }
  if (pathname === '/api/limits' && req.method === 'PUT') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const saved = limits.write({ on: body.on, perHour: body.perHour });
        if (!saved.ok) { sendJson(res, 400, { error: saved.because }); return; }
        sendJson(res, 200, { ...limits.read(), tiers: limits.TIERS });
      })
      .catch(() => sendJson(res, 400, { error: 'we could not save that setting' }));
    return;
  }

  // --- the company AI policies: held once, handed to every agent (#479,
  //     plural since #685: named, all global, stacked) ----------------------
  if (pathname === '/api/policy' && (req.method === 'GET' || req.method === 'HEAD')) {
    try {
      const r = policyEngine.read();
      // The full text stays on disk; the screen gets what it shows.
      /* The pre-#685 singular `policy` field is gone: the plural Settings
         screen (#701) reads `policies` only, and Mona Lisa cleared the
         drop on 2026-08-24 once nothing shipped depended on it. */
      sendJson(res, 200, r.state === 'saved'
        ? { state: 'saved', policies: policySummaries(r), because: null }
        : { state: r.state, policies: [], because: r.because });
    } catch { sendJson(res, 500, { error: 'that record could not be read' }); }
    return;
  }
  if (pathname === '/api/policy' && req.method === 'POST') {
    readBody(req)
      .then(async (buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        let text; let source;
        if (typeof body.url === 'string' && body.url.trim()) {
          // The BOARD fetches, through the same gate every link preview
          // uses: private addresses refused, redirects gated, size capped.
          const got = await unfurl.pageText(body.url.trim());
          if (!got.ok) { sendJson(res, 400, { error: got.because }); return; }
          if (got.text.length > policyEngine.TEXT_MAX) {
            sendJson(res, 400, { error: 'that page is too long to hand to every agent; paste the part that applies instead' });
            return;
          }
          text = got.text; source = got.url;
        } else if (typeof body.text === 'string' && body.text.trim()) {
          text = body.text; source = 'pasted';
        } else {
          sendJson(res, 400, { error: 'give us a link to the policy, or paste the policy itself' });
          return;
        }
        let saved;
        /* `id` re-ingests an existing policy's words; `name` adds a new one
           (add never overwrites -- a taken name is refused in the engine's
           own sentence). The old screen's nameless POST is gone with that
           screen (#701): a policy is named or it is a re-ingest. */
        try { saved = policyEngine.add({ id: body.id, name: body.name, text, source }); }
        catch (err) { sendJson(res, 400, { error: String((err && err.message) || 'we could not save that') }); return; }
        // Non-gating, same as every tell: a policy that could not be
        // announced everywhere is still saved, and each verdict is carried.
        let told;
        try {
          const roster = safeRoster();
          told = policyEngine.syncEveryone(roster).map((t) => {
            const card = t && Array.isArray(roster) ? roster.find((c) => c && c.sessionName === t.agent) : null;
            return card && card.name ? { ...t, shownAs: card.name } : t;
          });
        } catch (err2) { told = [{ agent: null, state: projects.TOLD.COULD_NOT, because: String((err2 && err2.message) || 'we could not tell the agents') }]; }
        sendJson(res, 200, {
          policies: policySummaries(),
          saved: { id: saved.id, name: saved.name },
          told,
        });
      })
      .catch(() => sendJson(res, 500, { error: 'we could not save that record' }));
    return;
  }
  if (pathname === '/api/policy/rename' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        /* A rename changes no agent's words TODAY (names only appear in the
           stacked block), but it changes what the next splice writes, so the
           agents are told the same non-gating way every policy change tells
           them -- and when exactly one policy exists the splice is unchanged
           and tells write nothing. */
        let renamed;
        try { renamed = policyEngine.rename(body.id, body.name); }
        catch (err) { sendJson(res, 400, { error: String((err && err.message) || 'we could not rename that') }); return; }
        let told;
        try { told = policyEngine.syncEveryone(safeRoster()); }
        catch { told = [{ agent: null, state: projects.TOLD.COULD_NOT, because: 'we could not tell the agents' }]; }
        sendJson(res, 200, { policies: policySummaries(), renamed: { id: renamed.id, name: renamed.name }, told });
      })
      .catch(() => sendJson(res, 500, { error: 'we could not save that record' }));
    return;
  }
  if (pathname === '/api/policy/remove' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const id = (typeof body.id === 'string' && body.id) ? body.id : null;
        /* An id, always (#701): the no-id "clear the policy" belonged to
           the single-policy screen and went with it. Removal names what it
           removes, whatever the count. */
        if (!id) { sendJson(res, 400, { error: 'say which policy to remove' }); return; }
        try { policyEngine.removeOne(id); }
        catch (err) { sendJson(res, 400, { error: String((err && err.message) || 'we could not remove the saved policy') }); return; }
        let told;
        try { told = policyEngine.syncEveryone(safeRoster()); }
        catch { told = [{ agent: null, state: projects.TOLD.COULD_NOT, because: 'we could not tell the agents' }]; }
        const after = policyEngine.read();
        sendJson(res, 200, { state: after.state, policies: policySummaries(after), told });
      })
      .catch(() => sendJson(res, 500, { error: 'we could not save that record' }));
    return;
  }

  if (pathname === '/api/you' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { sendJson(res, 200, you.read()); }
    catch { sendJson(res, 500, { error: 'that record could not be read' }); }
    return;
  }
  if (pathname === '/api/you' && req.method === 'PUT') {
    readBody(req)
      .then((buf) => {
        // Parsed HERE, refused in OUR sentence: letting JSON.parse's own
        // message ride the shared catch answers "Unexpected token" where the
        // sibling routes say what to do.
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const saved = you.save({ name: body.name, does: body.does, know: body.know });
        // Non-gating, same as every tell: answers that could not be announced
        // are still saved, and each agent's verdict is carried, never invented.
        let told;
        try {
          const roster = safeRoster();
          /* The display name beside the machine name, for the screen: a miss
             read out as "claudebot" is about an agent every other screen
             calls Splinter. Same shape as the project-removal route. */
          told = you.syncEveryone(roster).map((t) => {
            const card = t && Array.isArray(roster) ? roster.find((c) => c && c.sessionName === t.agent) : null;
            return card && card.name ? { ...t, shownAs: card.name } : t;
          });
          // The reports-to block names the person in its default form (#336),
          // so a new name here has to reach it too. Same roster, same posture.
          try { reports.syncEveryone(roster); } catch { /* carried by the marker, not here */ }
          /* #1034: the connections block rides the same sweep. Its words never
             change, so this is a no-op for an agent that already has it, and it
             is the one write that gives it to every agent created before the
             block existed. */
          try { connections.syncEveryone(roster); } catch { /* carried by the marker, not here */ }
        }
        catch (err2) { told = [{ agent: null, state: projects.TOLD.COULD_NOT, because: String((err2 && err2.message) || 'we could not tell the agents') }]; }
        sendJson(res, 200, { you: saved, told });
      })
      .catch((err) => {
        // A refusal speaks the field's own sentence at 400; a disk failure
        // (ENOSPC, EACCES on the rename) is OURS and answers 500, because a
        // raw errno presented as something the person can fix aims the
        // complaint at the wrong party.
        if (err && err.code) { sendJson(res, 500, { error: 'we could not save that record' }); return; }
        sendJson(res, 400, { error: String((err && err.message) || 'we could not save that') });
      });
    return;
  }

  // --- instructions: the file an agent reads to know what it is for --------
  //
  // ⚠️ The most powerful write in the product. It changes how a live agent
  // behaves the next time it starts, which is why engine/instructions.js guards
  // it harder than anything else here.
  const instr = pathname.match(/^\/api\/agent\/([^/]+)\/instructions$/);
  if (instr && (req.method === 'GET' || req.method === 'HEAD')) {
    const name = decodeSegment(instr[1]);
    if (name === null) { sendJson(res, 404, { error: 'that is not a name we can read' }); return; }
    // Guarded the same way PUT is. Without this, GET answers 200 for any name
    // at all and hands back the absolute path it would have used, which turns
    // the route into a "does ~/work/workers/<x> exist" oracle for names that
    // are not agents. There is no reason for the read and the write to disagree
    // about which names exist.
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    try {
      /* 🛑 THE VERDICT IS WRAPPED HERE TOO (#1228). `instructions.read` returns the
         RAW staleness, and this route feeds `renderStale`, whose `told` branch was
         therefore UNREACHABLE from its own data source: only `toldOverride`
         produces `told`, and it was applied on the two /api/status routes and
         nowhere else. A branch its own endpoint cannot trigger is not a feature
         with no users, it is a state the screen claims to handle and does not. */
      const readOut = instructions.read(name, sessionOf(name));
      sendJson(res, 200, readOut && readOut.staleness
        ? { ...readOut, staleness: projects.toldOverride(readOut.staleness, sessionOf(name) || name) }
        : readOut);
    } catch {
      sendJson(res, 500, { error: 'those instructions could not be read' });
    }
    return;
  }

  if (instr && req.method === 'PUT') {
    const name = decodeSegment(instr[1]);
    if (name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    if (!knownAgent(name)) { sendJson(res, 404, { error: 'no agent by that name' }); return; }
    readBody(req)
      .then((buf) => {
        let patch;
        try {
          patch = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          // A raw SyntaxError here reads "Unexpected token } in JSON at
          // position 4", which is an exception name and an offset rather than
          // anything a person can act on. Every other refusal on this route
          // says what to send instead, and unparseable input was the one hole.
          throw new Error('send the instructions as JSON, like {"text": "..."}');
        }
        if (typeof patch.text !== 'string') {
          throw new Error('send the instructions as text');
        }
        // `version` is the sha256 the editor was last shown. Passing it through lets
        // the engine refuse a save that would overwrite an edit made since,
        // rather than silently picking the version in the textarea.
        /* ⚠️ The rename-follow keys on the LINE CHANGING, not on the line
           disagreeing with the record (round 37). "Parses to a name that
           differs from the record" is also true when the person renamed
           through the PROFILE route and then saved an unrelated paragraph
           edit: the untouched identity line still reads the old name, and
           following it silently reverted the profile rename. So the
           pre-save file's identity line is read first, and the record
           follows only a save in which that line itself moved -- the one
           observable act that distinguishes "they edited the name" from
           "they edited something else". Read-before-write is not atomic
           with the write, but the same person racing their own two saves
           lands on whichever save carried the line change, which is the
           behaviour either order promises. */
        const wrote = instructions.write(name, patch.text, patch.version, sessionOf(name), { who: 'person', because: null });
        /* The pre-save line comes from the WRITE's own read (round 39), not
           a second read here: the round-37 version read the file twice, and
           in the window between them a transient read failure came back as
           exists:false -- which this parse would take for "no identity
           line", making an unrelated paragraph save satisfy "the line
           changed" and revert a profile-route rename through the
           could-not-look path. write.hadIdentityText is null ONLY for a
           positively absent file (unreadable pre-files make write throw),
           so the create path still follows and the unknown state cannot. */
        const lineHad = (() => {
          const m = wrote.hadIdentityText && wrote.hadIdentityText.match(/You are \*\*([^*]+)\*\*/);
          return m ? m[1].trim().slice(0, 80) : null;
        })();
        /* ⚠️ A DELIBERATE rename through the identity line updates the
           RECORD (round 33): the record wins over the file so an
           accidental mangle cannot un-name an agent, but that made the
           in-product edit of `You are **X**` -- the only rename path a
           person had -- a silent no-op that still reported "Saved." The
           split that honours both: a saved line that PARSES to a
           different name is a deliberate act and the record follows it;
           a line that no longer parses updates nothing, so the name
           survives exactly the accident the record exists for. */
        // (No wrote.ok guard: instructions.write THROWS on every failure
        // path, so reaching here means the save landed -- round 34
        // removed a decorative precondition that could never be false.)
        {
          const m = String(patch.text).slice(0, 4000).match(/You are \*\*([^*]+)\*\*/);
          // Same 80-char cap the profile route applies (round 34): the
          // identity line can carry ~3,900 characters into the capture,
          // and uncapped it became the agent's name on every card.
          const typed = m && m[1].trim().slice(0, 80);
          if (typed && typed !== lineHad) {
            /* ⚠️ Guarded, because the SAVE ALREADY LANDED (round 40): a
               throw out of the profile store here fell to the route's
               .catch, which answered 400 with the raw message -- so a
               committed instructions save was reported as a failed one,
               with an errno and an internal temp path printed into the
               editor's message line. Two rules broken at once (recording
               failure reported as act failure; errnos on screen). Same
               posture as create.js's own display-name write: a rename we
               could not record is a card that keeps its old name, not a
               failure. */
            try {
              const had = store.readProfile(name);
              if (had && typeof had.displayName === 'string' && had.displayName !== typed) {
                store.writeProfile(name, { displayName: typed });
              }
            } catch { /* the save succeeded; the follow is best-effort */ }
          }
        }
        sendJson(res, 200, wrote);
      })
      // The message reaches the person verbatim, so it says what to do rather
      // than naming an exception.
      .catch((err) => {
        // A conflict is not a malformed request. 409 is what a non-browser
        // client keys on to offer a reload rather than a retry.
        //
        // Keyed on `err.code`, not on the wording: this used to regex-match the
        // engine's English, so rewording one sentence silently downgraded the
        // status to 400.
        sendJson(res, err.code === 'CONFLICT' ? 409 : 400, { error: String(err.message) });
      });
    return;
  }

  /**
   * --- projects ------------------------------------------------------------
   *
   * A project is a folder the person already has, plus the agents they have put
   * on it. Both halves are read against reality on every request rather than
   * reported from the record: the folder is stat'd, and the members are joined
   * to the live roster so one we cannot see comes back as unknown instead of
   * being quietly dropped from its own project.
   *
   * ⚠️ NOTHING HERE IS A PERMISSION. Membership is an organising fact and never
   * a boundary (§4, 2026-08-11). No response carries an access level, because
   * there are none, and a level that is not enforced is worse than none.
   *
   * ⚠️ `snapshot()` THROWS when tmux cannot be asked, and that is deliberate
   * upstream — the realistic failure used to arrive as an empty roster, which
   * here would mean answering "none of your agents are there" when the truth is
   * "we could not look". So `safeRoster` catches it and these routes report a
   * failure to SEE, distinct from a failure to READ THE RECORD.
   *
   * (This named `paneRoster` until iteration 8. These routes describe members
   * against `snapshot().agents` and have not called `paneRoster` since the
   * display-name defect was fixed — the sentence outlived the code it was
   * written about, which is this file's own recurring failure.)
   */
  if (pathname === '/api/projects' && (req.method === 'GET' || req.method === 'HEAD')) {
    // ⚠️ An unreadable projects FILE is answered as an error, never as an empty
    // list. Serving `{projects: []}` there put "No projects yet. Point Kosmos at
    // a folder you already have" on screen for somebody who has projects we
    // simply could not read -- the exact "asserting a state nobody checked"
    // failure, arriving through the quietest path there is.
    try {
      projects.readAll();
    } catch (err) {
      sendJson(res, 500, {
        error: String((err && err.message) || 'we cannot read your projects right now'),
        projectsUnreadable: true,
      });
      return;
    }
    const roster = safeRoster();
    try {
      sendJson(res, 200, { projects: withUnread(projects.list(roster)), agentsUnreadable: roster === null });
    } catch {
      // The record is still readable when the roster is not, so the projects
      // themselves are served with every member marked unseen rather than the
      // whole page failing. `describe` already says `present: false` for each.
      // ⚠️ WRAPPED TOO, though `readAll` was proven readable a few lines above.
      // An external writer can corrupt the file in between, and this arm
      // running unguarded is the same class as the crash the route below it was
      // measured and fixed for — the process exiting on a plain read.
      let listed;
      try {
        listed = projects.list(null);
      } catch (err) {
        sendJson(res, 500, {
          error: String((err && err.message) || 'we cannot read your projects right now'),
          projectsUnreadable: true,
        });
        return;
      }
      sendJson(res, 200, {
        projects: withUnread(listed),
        agentsUnreadable: true,
        because: 'we cannot read the agents on this computer right now, so we are not saying anything about how they are doing',
      });
    }
    return;
  }

  /**
   * Where a project of this name WOULD go, before anything is made.
   *
   * ⚠️ ONE derivation, and this route is why. The add screen has to show the
   * exact path before it creates anything — a folder name derived from what was
   * typed, without showing the derivation, is a folder the person cannot find.
   * The page could compute it, and then the string on screen and the directory
   * on disk would be two answers to one question, drifting the first time the
   * rule changes. So the engine answers and the page renders.
   *
   * ⚠️ ANSWERS 200 EITHER WAY. A name we cannot make a folder out of is a
   * renderable state — the sentence goes under the field the person is still
   * typing in — not an error the screen has to catch.
   */
  if (pathname === '/api/project-folder' && (req.method === 'GET' || req.method === 'HEAD')) {
    let asked = '';
    try { asked = new URL(req.url, ROUTING_BASE).searchParams.get('name') || ''; } catch { asked = ''; }
    const problem = projects.folderNameProblem(asked);
    if (problem) { sendJson(res, 200, { path: null, problem }); return; }
    // ⚠️ `folderPathPreview`, which does NOT create anything (it only lists
    // the parent). Somebody typing into a name box must not leave a trail of
    // empty directories behind them; the folder is made once, by `create`,
    // when they press the button. The preview carries makeFolder's own
    // case correction, so the path shown is the path the act produces.
    const preview = projects.folderPathPreview(asked);
    // `exists` rides along so the page can say ADOPT instead of MAKE for a
    // folder that is already there -- two different acts, one sentence each.
    // `blocked` is the third arm (a FILE at the path): the preview speaks
    // makeFolder's refusal before the button is pressed, instead of
    // promising a make the engine will refuse (round 23).
    sendJson(res, 200, { path: preview.path, exists: preview.exists, blocked: preview.blocked || null, problem: null });
    return;
  }

  /**
   * Every task across every project, open and finished (#1382).
   *
   * 🛑 AN UNREADABLE STORE IS AN ERROR, NEVER AN EMPTY LIST. Same rule as
   * `/api/projects` above, and for the same reason: "No tasks yet" is a CLAIM
   * about somebody's own work, and serving it when we simply could not read is
   * the quietest way to say something false.
   *
   * 🔑 `count` IS DERIVED FROM THE ARRAY WE ARE SENDING, not counted a second
   * way. The control that opens this screen shows that number, and a count
   * computed separately is exactly #1346: three rows under a heading that said
   * six, because one number came from the data and the other from the DOM.
   */
  if (pathname === '/api/tasks' && (req.method === 'GET' || req.method === 'HEAD')) {
    try {
      projects.readAll();
    } catch (err) {
      sendJson(res, 500, {
        error: String((err && err.message) || 'we cannot read your tasks right now'),
        projectsUnreadable: true,
      });
      return;
    }
    const all = tasks.allTasks();
    sendJson(res, 200, { tasks: all, count: all.length });
    return;
  }

  if (pathname === '/api/projects' && req.method === 'POST') {
    readBody(req)
      .then((buf) => {
        let body;
        try {
          body = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          throw new Error('we could not read that request');
        }
        // One roster for the whole request: the same observation decides
        // `everSeen`, the write permission, and what the response reports.
        const roster = safeRoster();
        /* Who is asking (#327): a browser sends sec-fetch-site, a curl does
           not, and the header is the BROWSER'S, not the request body's -- so
           the screen/process split cannot be minted by a local process lying
           about itself in JSON. A process that offered its pane gets named
           through the same roster the write already trusts. Advisory: an
           agent runs as the operator; this is for telling things apart. */
        const viaScreen = typeof req.headers['sec-fetch-site'] === 'string'
          || (() => { try { const h = new URL(String(req.headers.origin || '')).hostname.replace(/\.$/, '').toLowerCase(); return LOOPBACK_HOSTS.has(h) || ALLOWED_HOSTS.has(h); } catch { return false; } })();
        const paneCard = !viaScreen && typeof body.from_pane === 'string'
          ? (Array.isArray(roster) ? roster.find((c) => c && c.target === body.from_pane) : null)
          : null;
        /* The runaway bound (#327 q2): a looping process can create projects
           as fast as it can curl, and nothing else limits API writes. Twelve
           process-made projects in an hour is far past any brief and far
           under any loop. The SCREEN is never valved -- the person is the
           one participant this exists to protect, the room valve's own rule. */
        if (!viaScreen) {
          const hourAgo = Date.now() - 3600000;
          const recent = projects.readAll().filter((p) => p && p.made && p.made.via === 'process'
            && Number.isFinite(Date.parse(p.made.at)) && Date.parse(p.made.at) >= hourAgo).length;
          if (recent >= 12) {
            sendJson(res, 429, { error: 'agents have made ' + recent + ' projects in the last hour, so Kosmos is pausing agent-made projects; the person can still make them from the screen' });
            return;
          }
        }
        const made = projects.create({ name: body.name, folder: body.folder, agents: body.agents, roster, description: body.description,
          made: { via: viaScreen ? 'screen' : 'process', by: paneCard ? paneCard.sessionName : null } });
        // ⚠️ Told AFTER the record is written, never before. If announcing it
        // failed first, a membership the person asked for would not exist at
        // all -- and the whole point of the three-valued verdict is that a
        // recorded membership we could not announce is a real, reportable
        // state rather than a reason to refuse the request.
        // ⚠️ ONE roster read for the whole request, threaded into every sync.
        // `syncAgent` REFUSES to write without an exact match in it, so passing
        // it is not an optimisation -- it is the permission.
        // ⚠️ The record is written; from here the project EXISTS. A throw while
        // telling its members must not come back as "we could not create that
        // project" -- DELETE was split into two try blocks for exactly this
        // ("the person was told their removal failed for a removal that
        // happened") and create had the same shape.
        let told = [];
        try {
          told = made.agents.map((a) => {
            const verdict = projects.syncAgent(a, roster);
            // Agents put on a project at its creation are usually already
            // running; the pane line is what tells them now (#141).
            const said = projects.speakOfMembership(a, made, 'joined', roster);
            return { agent: a, ...verdict, said };
          });
        } catch (err) {
          told = [{ agent: null, state: projects.TOLD.COULD_NOT, because: String((err && err.message) || 'we could not reach the agents you put on it') }];
        }
        let project = null;
        try { project = projects.get(made.id, roster); } catch { project = null; }
        sendJson(res, 200, { project, told, id: made.id, agentsUnreadable: roster === null });
      })
      .catch((err) => sendJson(res, (err && err.code === 'UNREADABLE') ? 500 : 400,
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  const proj = pathname.match(/^\/api\/project\/([^/]+)$/);
  if (proj && (req.method === 'GET' || req.method === 'HEAD')) {
    const id = decodeSegment(proj[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    // ⚠️ WRAPPED, because `readAll` THROWS on a store it cannot read and this
    // was the one read that did not catch it. Measured: with a corrupt
    // projects.json the list route answered its honest 500 and the very next
    // request for one project took the whole board process down — exit 9,
    // nothing serving. The app that watches the fleet dying on a plain read is
    // worse than every state the guard family around it protects.
    // ⚠️ ONE roster read per request. Two `tmux list-panes` calls can disagree,
    // and the disagreement is exactly the sentence this app exists not to say:
    // the response could carry every member as "we cannot see this agent right
    // now" while asserting `agentsUnreadable: false` -- claiming those agents
    // are missing on the strength of a look that had in fact failed.
    const roster = safeRoster();
    let found;
    try {
      found = projects.get(id, roster);
    } catch (err) {
      sendJson(res, 500, {
        error: String((err && err.message) || 'we cannot read your projects right now'),
        projectsUnreadable: true,
      });
      return;
    }
    if (!found) { sendJson(res, 404, { error: 'there is no project by that name' }); return; }
    sendJson(res, 200, { project: found, agentsUnreadable: roster === null });
    return;
  }

  if (proj && req.method === 'PUT') {
    const id = decodeSegment(proj[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((buf) => {
        let body;
        try {
          body = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          throw new Error('we could not read that request');
        }
        // ⚠️ A missing project is a 404 here as it is on GET and DELETE. It
        // used to be a 400 for the identical condition, which told a caller
        // its request was malformed when the request was fine.
        if (!projects.readAll().some((p) => p.id === id)) {
          const missing = new Error('there is no project by that name');
          missing.status = 404;
          throw missing;
        }
        /* ⚠️ Each field moves only when the request CARRIES it, and every
           carried field is applied in ONE engine write. Two separate
           mutations here meant a failure in the second answered "your save
           failed" about a rename that had already persisted. An EXPLICIT
           empty description clears the field -- deliberately unlike the
           profile displayName's blank-drop, because a description is
           optional by design and the settings screen offers clearing; the
           never-delete rule protects a person's words in composition, not a
           field they chose to empty. A carried field of the WRONG TYPE is
           refused loudly by the engine (cleanName throws on nothing,
           cleanDescription on non-words), and a body carrying NO field we
           recognise is refused too -- {"descrption": "..."} answering
           "saved" is a save the person believes happened. */
        const fields = {};
        if (body.name !== undefined) fields.name = body.name;
        if (body.description !== undefined) fields.description = body.description;
        /* archived is a carried field like the others: the engine's edit
           validates every carried field before its ONE write (a non-boolean
           archived is refused there, because `!!` would turn
           {"archived": "false"} into an archive), so a mixed body either
           applies whole or not at all. */
        if (body.archived !== undefined) fields.archived = body.archived;
        projects.edit(id, fields);
        // The block names the project, so a rename has to reach the agents that
        // were told the old name -- otherwise their instructions describe a
        // project that no longer goes by that. Archiving does NOT re-tell: the
        // name did not change, and the engine's own rule is that archiving
        // changes nothing about the members.
        // ⚠️ Re-read rather than reusing the row from the existence check: a
        // record removed in between made this `.agents` of `undefined`, and the
        // raw TypeError went out as the person's error message.
        const reRead = projects.readAll().find((p) => p.id === id);
        const roster = safeRoster();
        // Same reason as create and delete: the rename HAPPENED. A failure
        // re-telling the members is a different fact from a failed rename.
        // (Only when the name moved: the managed block carries the name and
        // the folder, and neither the description, the archived flag, nor
        // anything else this route can change, so a name-less save has
        // nothing to re-tell.)
        try {
          if (body.name !== undefined) {
            for (const a of (reRead ? reRead.agents : [])) projects.syncAgent(a, roster);
          }
        } catch { /* reported by the row's own told verdict on the next read */ }
        let project = null;
        try { project = projects.get(id, roster); } catch { project = null; }
        // ⚠️ ONE roster read, and `agentsUnreadable` reported — PUT was the one
        // route that read it twice and told nobody, so a failed second look
        // came back asserting every member was unseen.
        sendJson(res, 200, { project, agentsUnreadable: roster === null });
      })
      .catch((err) => sendJson(res, (err && err.status) || ((err && err.code === 'UNREADABLE') ? 500 : 400), { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  if (proj && req.method === 'DELETE') {
    const id = decodeSegment(proj[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    // ⚠️ TWO try blocks, because they answer different questions. Removing the
    // record and re-telling the members were in ONE, so a failure while
    // re-telling was answered "there is no project by that name" -- 404, after
    // the project had actually been removed. The person was told their removal
    // failed for a removal that happened.
    let gone;
    try {
      gone = projects.remove(id);
    } catch (err) {
      sendJson(res, (err && err.code === 'UNREADABLE') ? 500 : 404,
        { error: String((err && err.message) || 'there is no project by that name') });
      return;
    }
    // The members are re-told AFTER the project is gone, so the block in their
    // instructions stops naming a project that no longer exists.
    let told = [];
    try {
      const roster = safeRoster();
      // ⚠️ THE DISPLAY NAME TRAVELS WITH THE VERDICT. `gone.agents` are machine
      // names, and the list's failure note printed them raw -- so for the exact
      // fleet this feature was built for, the person read "claudebot still
      // mentions it in their instructions" about the agent whose card everywhere
      // else says "Splinter". The module's own rule is act on the machine name,
      // SPEAK the display name, and the roster that resolves the two is already
      // in hand here. `shownAs` falls back to the machine name, because a name
      // we cannot resolve is still the only name we have.
      told = gone.agents.map((a) => {
        const card = Array.isArray(roster) ? roster.find((c) => c && c.sessionName === a) : null;
        const verdict = projects.syncAgent(a, roster);
        // A running member hears that the project is gone (#304); a stopped
        // one reads it at its next start, and could_not here is that fact.
        const said = projects.speakOfMembership(a, gone, 'removed', roster);
        return { agent: a, shownAs: (card && card.name) || a, ...verdict, said };
      });
    } catch (err) {
      told = [{ agent: null, state: projects.TOLD.COULD_NOT, because: String((err && err.message) || 'we could not reach the agents that were on it') }];
    }
    sendJson(res, 200, { removed: gone.id, name: gone.name, told });
    return;
  }

  /**
   * The Success screen's "Show me where it is" (the pack draws it; Josh
   * asked for it by name). POST like its reveal-folder sibling below, same
   * cross-site posture: this opens an app on the person's machine. The
   * engine re-derives the location itself; nothing from the request is
   * honoured, and a location that cannot be found right now refuses with a
   * sentence instead of opening nothing.
   */
  if (pathname === '/api/reveal-app' && req.method === 'POST') {
    // Cross-site writes were already refused by the global guard that runs
    // BEFORE every route; an inline re-check here could never fire and only
    // implied the sibling routes were less covered than they are.
    try {
      sendJson(res, 200, machine.revealApp());
    } catch (err) {
      // The engine rethrows programming errors so a bug does not wear the
      // failure's clothes; the route keeps that split. A ReferenceError
      // painted into the dock as an honest refusal is the same lie one
      // layer up, so it answers 500 with the sibling routes' shape.
      if (err instanceof ReferenceError || err instanceof TypeError) {
        sendJson(res, 500, { error: 'something went wrong on our side showing it', detail: String((err && err.message) || err) });
        return;
      }
      sendJson(res, 409, { error: String((err && err.message) || 'we could not show it') });
    }
    return;
  }

  /**
   * Reveal the project's folder in Finder. POST, guard-inherited (it opens
   * an app). The path is ALWAYS the stored record's, never the request's,
   * same rule as the sleep-settings opener: this must not become an
   * open-arbitrary-path primitive. Refused with the state's own sentence
   * when the folder is not there to show.
   */
  /* --- the project room ----------------------------------------------------
     The thread is the record filtered by PROJECT ALONE (the spec's
     falsifiable claim: no reference to the member list), posts plus the
     room's own valve closings. Read-only, best-effort history. */
  /* #670: the person opened this project's room, so everything posted
     before now is read. POST, behind the cross-site guard like every write.
     The count itself is server-derived (see withUnread); this only moves
     the cursor. */
  const roomSeen = pathname.match(/^\/api\/project\/([^/]+)\/seen$/);
  if (roomSeen && req.method === 'POST') {
    const id = decodeSegment(roomSeen[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    let at;
    try { at = messages.markSeen(id); }
    catch (err) { sendJson(res, 500, { error: String((err && err.message) || 'we could not record that') }); return; }
    sendJson(res, 200, { seen: at, unread: 0 });
    return;
  }

  const roomThread = pathname.match(/^\/api\/project\/([^/]+)\/room$/);
  if (roomThread && (req.method === 'GET' || req.method === 'HEAD')) {
    const id = decodeSegment(roomThread[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    try {
      const rec = messages.record();
      const rows = rec.rows
        /* Refused rows too (#315): the valve notice is deduped per room, so
           without these every agent blocked after the first vanishes silently
           and reads as unresponsive. The refusal contract already records
           who and why, once per sender-reason-window; the room just shows it. */
        .filter((m) => m && ((m.kind === 'post' || m.kind === 'valve' || m.kind === 'note') ? m.project === id
          : (m.kind === 'refused' && m.project === id)))
        .map((m) => (m.kind === 'refused'
          ? { kind: 'refused', from: m.from, because: m.because || null, at: m.at }
          : m.kind === 'note'
          ? { kind: 'note', text: m.text || null, at: m.at }
          : m.kind === 'post'
          ? { kind: 'post', id: m.id, from: m.from, to: m.to, operator: m.operator === true,
              text: m.text, at: m.at, outcomes: m.outcomes || {},
              // #460: the only thing a renderer may style as quoted.
              ...(Array.isArray(m.quotes) && m.quotes.length ? { quotes: m.quotes } : {}),
              ...(m.attachment && typeof m.attachment === 'object' ? { attachment: m.attachment } : {}),
              ...(Array.isArray(m.attachments) ? { attachments: m.attachments } : {}) }
          : { kind: 'valve', project: m.project, because: m.because || null, at: m.at }));
      rows.sort((a2, b2) => String(a2.at || '').localeCompare(String(b2.at || '')));
      /* Plain text on ?as=text, for `kosmos room <id>` (#314): the CLI runs on
         stock bash 3.2 with no JSON parser, so the server does the shaping.
         The tail only (last 40), oldest first, one line per row, and the
         unreadable case says so rather than printing an empty room. */
      let asText = false;
      try { asText = new URL(req.url, ROUTING_BASE).searchParams.get('as') === 'text'; } catch { asText = false; }
      /* #185, #563: who still owes an answer, from the record alone, computed
         ONCE here for both arms. The page draws its small line from this and
         the text view prints the same line under the same post, so an agent
         reading the room with `kosmos room` sees its own debt where the
         person sees it. Neither arm re-derives it. Best-effort like the room. */
      let silent = {};
      try { silent = messages.unanswered(id, Date.now()); } catch { silent = {}; }
      if (asText) {
        const tail = rows.slice(-40);
        const lines = tail.flatMap((m) => {
          const when = m.at ? String(m.at).slice(11, 16) : '--:--';
          if (m.kind === 'valve') return [when + '  [kosmos] ' + (m.because || 'Kosmos stepped in.')];
          if (m.kind === 'refused') return [when + '  [kosmos] ' + m.from + ' tried to post here and Kosmos stopped it: ' + (m.because || 'no reason recorded')];
          if (m.kind === 'note') return [when + '  [kosmos] ' + String(m.text || '')];
          const who = m.operator ? 'operator' : m.from;
          const line = when + '  ' + who + ' -> ' + (Array.isArray(m.to) ? m.to.join(', ') : 'the room') + ': ' + String(m.text || '');
          /* The same sentence the page shows, one per silent name, right
             under the post it is about (#563). */
          const owed = Array.isArray(silent[m.id]) ? silent[m.id] : [];
          return [line, ...owed.map((name) => when + '  [kosmos] ' + name + ' has not answered here yet.')];
        });
        const head = rec.ok === false
          ? 'We could not read some of this room; what follows may be missing recent posts.\n'
          : (lines.length ? '' : 'Nothing has been said in this room yet.\n');
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(head + lines.join('\n') + (lines.length ? '\n' : ''));
        return;
      }
      /* #185: which addressed agents have not answered which posts, from
         the record alone; the page renders the small line from this and
         never re-derives it. Best-effort like the room itself. */
      sendJson(res, 200, { ok: rec.ok, rows: withPreviews(rows), unanswered: silent });
    } catch (err) {
      sendJson(res, 500, { error: String((err && err.message) || 'we could not read the room') });
    }
    return;
  }
  /* The operator's post into the room. Its OWN route, never /api/post:
     that route carries a pane and must stay unable to mint operator
     authority -- the flag is set here, by the surface that IS the
     operator's, and nowhere reachable from a pane. (Local processes can
     reach this too; the pane derivation guards mistakes, not malice, and
     the module says so.) */
  if (roomThread && req.method === 'POST') {
    const id = decodeSegment(roomThread[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch {
          const bad = new Error('that request is not something we can read');
          bad.status = 400;
          throw bad;
        }
        if (!body || typeof body !== 'object') {
          const bad = new Error('that request is not the shape we expect');
          bad.status = 400;
          throw bad;
        }
        const roster = safeRoster();
        if (roster === null) {
          sendJson(res, 200, { delivery: { state: 'could_not', because: 'we could not check which agents are running, so nothing was posted' } });
          return;
        }
        let found = null;
        try { found = projects.get(id, roster); } catch { found = null; }
        if (!found) {
          sendJson(res, 200, { delivery: { state: 'could_not', because: 'there is no project by that name, so there is no room to post into' } });
          return;
        }
        const members = (found.agents || []).map((a) => a.sessionName);
        /* An attached file (#358), owned by this project. */
        const files = attachments.resolveForMessage(body, 'project', found.id, 'that attachment is not one this project can send');
        if (!files.ok) { sendJson(res, 400, { error: files.because }); return; }
        const fields = attachments.rowFields(files.recs);
        const delivery = messages.sendPost({
          operator: true, project: found.id, projectName: found.name, text: body.text,
          attachment: fields.attachment || null, attachments: fields.attachments || null, trailer: attachments.wireNote(files.recs),
        }, roster, members);
        sendJson(res, 200, { delivery });
      })
      .catch((err) => sendJson(res, (err && err.status) || 400,
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  /* --- a project's documents ----------------------------------------------
   *
   * Josh, 2026-08-19: "i only want a list of the files and if i click them they
   * open", covering both what he drops in and what an agent writes to share.
   *
   * ⚠️ THE LIST IS A GET AND THE OPEN IS A POST, and that split is the guard
   * rather than a REST habit. Reading a folder's names is a read. `open` LAUNCHES
   * things, so it inherits the cross-site guard every other POST here has, and a
   * page on another site cannot make this machine open a file by embedding a
   * form. Same reasoning as reveal-folder below it.
   */
  const docs = pathname.match(/^\/api\/project\/([^/]+)\/documents$/);
  if (docs && (req.method === 'GET' || req.method === 'HEAD')) {
    const id = decodeSegment(docs[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    let record;
    try {
      record = projects.readAll().find((x) => x.id === id) || null;
    } catch (err) {
      sendJson(res, 500, { error: String((err && err.message) || 'we cannot read your projects right now') });
      return;
    }
    if (!record) { sendJson(res, 404, { error: 'there is no project by that name' }); return; }
    // ⚠️ 200 WITH A REASON, not an error status: a project whose folder has
    // gone is a state this screen must DRAW, and a 4xx would make the list
    // render as a failed request rather than as "we could not look".
    /* ?limit= for the Documents view (#134), bounded: the tile keeps its 10,
       the view asks for up to 500, and an unbounded ask cannot be minted. */
    let fileCap = 10;
    try { const l = Number(new URL(req.url, ROUTING_BASE).searchParams.get('limit')); if (Number.isFinite(l) && l > 0) fileCap = Math.min(Math.floor(l), 500); } catch { fileCap = 10; }
    sendJson(res, 200, projects.listFiles(record.folder, fileCap));
    return;
  }

  if (docs && req.method === 'POST') {
    sendJson(res, 405, { error: 'the documents list is read-only; use open-file to open one' });
    return;
  }

  const openOne = pathname.match(/^\/api\/project\/([^/]+)\/open-file$/);
  if (openOne && req.method === 'POST') {
    const id = decodeSegment(openOne[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((buf) => {
        /* ⚠️ `readBody` RESOLVES A BUFFER, not parsed JSON. The first version of
         * this route named the parameter `body` and read `body.name` off it,
         * which is always undefined — so every open refused with "no file was
         * named" and the route never saw a filename at all.
         * The route test caught it, and only because it asserted the SENTENCE
         * rather than the status: the escape case still returned 409, so a test
         * checking the code alone would have gone green on a route that could
         * not open anything and could not refuse anything for the right reason. */
        let named;
        try { named = JSON.parse(buf.toString('utf8') || '{}').name; }
        catch { sendJson(res, 400, { error: 'we could not read that' }); return; }
        let record;
        try {
          record = projects.readAll().find((x) => x.id === id) || null;
        } catch (err) {
          sendJson(res, 500, { error: String((err && err.message) || 'we cannot read your projects right now') });
          return;
        }
        if (!record) { sendJson(res, 404, { error: 'there is no project by that name' }); return; }
        /* ⚠️ THE NAME IS NOT VALIDATED HERE, deliberately. Every gate lives in
         * `projects.openFile`, including the one a name check cannot do
         * (resolve both sides and compare, which is what catches a symlink
         * planted inside the folder). A second, weaker copy of the rules at
         * this layer is how two validators drift and the looser one wins. */
        const opened = projects.openFile(record.folder, named);
        if (opened.ok) { sendJson(res, 200, { ok: true }); return; }
        sendJson(res, 409, { error: opened.because });
      })
      .catch((err) => sendJson(res, 400,
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  /**
   * Show a person where their stored dialogue lives (kosmos#969).
   *
   * Josh, 2026-08-26: Project Settings already has "Show me where the work
   * lives"; Kosmos stores the full dialogue for every project, so he asked for
   * a companion.
   *
   * 🛑 IT IS NOT PER-PROJECT AND THE COPY MUST NOT PRETEND IT IS. Every room's
   * thread lives in ONE directory, `<data>/chats`, one file per room. A button
   * in a project's own settings that silently revealed every project's dialogue
   * would be the screen answering a narrower question than it was asked. So the
   * route is global by name -- `/api/chats/reveal`, not
   * `/api/project/<id>/reveal-chats` -- and the button beside it says so.
   *
   * ⚠️ A MISSING DIRECTORY IS NOT AN ERROR, IT IS AN ANSWER. Kosmos creates it
   * on the first message, so "it is not there yet" means nobody has said
   * anything, and `open` on a path that does not exist would report a Finder
   * failure for a working install.
   */
  if (pathname === '/api/chats/reveal' && req.method === 'POST') {
    const chat = require('./engine/chat');
    const dir = chat.chatsDir();
    if (!fs.existsSync(dir)) {
      sendJson(res, 409, { error: 'there is no stored dialogue yet, so there is nothing to show you' });
      return;
    }
    const opened = projects.revealFolder(dir);
    if (opened.ok) { sendJson(res, 200, { ok: true, where: dir }); return; }
    sendJson(res, 409, { error: opened.because });
    return;
  }

  const reveal = pathname.match(/^\/api\/project\/([^/]+)\/reveal-folder$/);
  if (reveal && req.method === 'POST') {
    const id = decodeSegment(reveal[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    let record;
    try {
      record = projects.readAll().find((x) => x.id === id) || null;
    } catch (err) {
      sendJson(res, 500, { error: String((err && err.message) || 'we cannot read your projects right now') });
      return;
    }
    if (!record) { sendJson(res, 404, { error: 'there is no project by that name' }); return; }
    const state = projects.folderState(record.folder);
    if (!state || state.state !== projects.FOLDER.READABLE) {
      sendJson(res, 409, { error: (state && state.because) || 'we cannot find that folder right now, so there is nothing to show' });
      return;
    }
    const opened = projects.revealFolder(record.folder);
    if (opened.ok) { sendJson(res, 200, { ok: true }); return; }
    sendJson(res, 409, { error: opened.because });
    return;
  }

  // --- tasks: things that need doing on THIS project -----------------------
  // POSTs, so they inherit the cross-site guard. The number is issued by the
  // project inside the engine's atomic write; closing is a record edit and
  // never an act on an agent (engine/tasks.js carries the reasoning, the
  // screen carries the sentence).
  const taskMake = pathname.match(/^\/api\/project\/([^/]+)\/tasks$/);
  if (taskMake && req.method === 'POST') {
    const id = decodeSegment(taskMake[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((buf) => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}'); }
        catch { sendJson(res, 400, { error: 'we could not read that request' }); return; }
        const roster = safeRoster();
        /* Who is asking (#485, extending #327's shape verbatim): the header
           is the browser's, not the body's, so the screen/process split
           cannot be minted by a process lying in JSON; a process that
           offered its pane gets named through the same roster the write
           already trusts. */
        const viaScreen = isViaScreen(req);
        const paneCard = !viaScreen && typeof body.from_pane === 'string'
          ? (Array.isArray(roster) ? roster.find((c) => c && c.target === body.from_pane) : null)
          : null;
        /* The runaway bound, #327's twelve-an-hour extended here: a task
           carries an assignee, so a looping process would not just litter,
           it would command. Counted across ALL projects, and the SCREEN is
           never valved -- the person is who this protects. */
        if (!viaScreen) {
          const hourAgo = Date.now() - 3600000;
          const recent = projects.readAll().reduce((n, p) => n + ((p && p.tasks) || []).filter((t) => t && t.addedVia === 'process'
            && Number.isFinite(Date.parse(t.createdAt)) && Date.parse(t.createdAt) >= hourAgo).length, 0);
          if (recent >= 12) {
            sendJson(res, 429, { error: 'agents have made ' + recent + ' tasks in the last hour, so Kosmos is pausing agent-made tasks; the person can still make them from the screen' });
            return;
          }
        }
        try {
          const made = tasks.create(id, { sentence: body.sentence, detail: body.detail, who: body.who,
            made: { via: viaScreen ? 'screen' : 'process', by: paneCard ? paneCard.sessionName : null } }, roster);
          // The assignee's managed block now lists this task in the exact
          // spelling the join matches on, so the agent is TOLD, not merely
          // recorded. Non-gating, same as every tell: a task that could not
          // be announced is still a task. (Shape note: `told` here is ONE
          // bare verdict -- a task has one assignee -- where the project
          // create/remove routes carry an array of {agent, ...} entries.)
          let told;
          if (made.who) {
            try { told = projects.syncAgent(made.who, roster); }
            catch (err2) { told = { state: projects.TOLD.COULD_NOT, because: String((err2 && err2.message) || 'we could not reach that agent') }; }
          }
          // heardBy shares its budget with the part routes' valve (below):
          // a process at the part routes' 12/hour cap must not ALSO get a
          // separate 12/hour allowance here -- one shared count of "how many
          // times a process paged a live pane this hour", not two 12/hour
          // caps that combine to 24. Task CREATION keeps its own, stronger,
          // persisted refusal above (429s the whole request); this only
          // gates whether the creation also gets to page a pane.
          let heard;
          if (viaScreen || heardBudgetAllows()) {
            heard = heardBy(id, made, made.who, made.sentence, roster);
            // Only a REAL delivery spends the budget -- a run of failed
            // attempts at an unreachable agent must not exhaust the shared
            // hour for every other project's legitimate placements.
            if (heard && heard.state === chat.DELIVERY.PLACED && !viaScreen) heardBudgetRecord();
          }
          sendJson(res, 200, { task: made, told, heard });
        } catch (err) {
          // Three answers for three facts, same split as the member route:
          // our unreadable store (500), a project that is not there (404),
          // the person's input (400).
          const code = (err && err.code === 'UNREADABLE') ? 500
            : (/no project by that name/.test(String(err && err.message)) ? 404 : 400);
          sendJson(res, code, { error: String((err && err.message) || 'we could not add that task') });
        }
      })
      .catch((err) => sendJson(res, 400, { error: String((err && err.message) || err) }));
    return;
  }

  /**
   * Re-tell everybody named on a task, after its record changed.
   *
   * 🔑 ONE HELPER RATHER THAN FOUR COPIES. Close, reopen, add-a-part, assign
   * and finish-a-part all change what an assignee's managed block should list,
   * and the block only follows the record if every one of them says so. Four
   * call sites each remembering to do it is four chances for the one that
   * forgets to be the one somebody uses.
   * ⚠️ Non-gating in every case: failing to update an agent's instructions must
   * not fail the edit that already landed.
   */
  /* #761 (Josh, 2026-08-24 21:56: "I created three new tasks and assigned them
     but I don't know that the agent was notified"): being written into an
     agent's instructions (`told`, above) reaches it at its NEXT start; a running
     agent hears nothing. So an assignment is also typed into the assignee's
     pane, one line, the way the room's nudge is, and the answer says whether it
     was placed. Only on assignment (create with a who, a part given a who):
     closing or reopening a task types nothing. */
  // #327's shape, factored out rather than copied a third time (taskMake
  // already had its own inline copy; #761 needs the same split for parts).
  function isViaScreen(req) {
    return typeof req.headers['sec-fetch-site'] === 'string'
      || (() => { try { const h = new URL(String(req.headers.origin || '')).hostname.replace(/\.$/, '').toLowerCase(); return LOOPBACK_HOSTS.has(h) || ALLOWED_HOSTS.has(h); } catch { return false; } })();
  }
  // heardBudgetAllows/heardBudgetRecord: module scope, above, beside
  // ENGINE_STARTED_AT -- they must survive across requests, and every name
  // in this handler is redefined fresh per request.
  // `sentence` is explicit, never read off `t`: a part's own sentence is
  // never the task's top-level one (a task with parts drops `who`/keeps one
  // `sentence` at the top, and a part given a `who` must be heard for the
  // part it was actually given, not the parent task's original wording).
  // `roster`: the caller's already-fetched snapshot, never a fresh
  // safeRoster() of our own -- snapshot() fans out a real tmux capture-pane
  // per agent, and every call site here already has one in scope.
  function heardBy(projectId, t, who, sentence, roster) {
    const name = typeof who === 'string' && who.trim() ? who.trim() : null;
    if (!name || !t || typeof t.number !== 'number') return undefined;
    let title = projectId;
    try { const rec = projects.readAll().find((x) => x && x.id === projectId); if (rec && rec.name) title = rec.name; } catch { /* the id will do */ }
    const line = '[Kosmos: you were given task ' + t.number + ' in "' + String(title).replace(/[\r\n"]/g, ' ') + '": '
      + String(sentence || '').replace(/[\r\n]/g, ' ') + '. When you take it up, say "task ' + t.number + ' of ' + String(title).replace(/[\r\n"]/g, ' ')
      + '" in what you report (every project numbers from 1, so the name matters; #779); the room is: kosmos post ' + projectId + ']';
    let sent;
    try { sent = chat.deliver(name, line, roster); }
    catch (err2) { sent = { state: chat.DELIVERY.COULD_NOT, because: String((err2 && err2.message) || 'we could not reach that agent') }; }
    return { who: name, state: sent.state, because: sent.because || null };
  }
  // `roster`: optional, so taskAct (close/reopen, below) keeps fetching its
  // own exactly as before -- only #761's routes, which already have one in
  // scope for `heardBy`, pass it through instead of paying for a second
  // snapshot() in the same request.
  const tellEveryoneOn = (t, roster) => {
    const named = tasks.whoOf(t);
    if (!named.length) return undefined;
    if (!roster) roster = safeRoster();
    let last;
    for (const one of named) {
      try { last = projects.syncAgent(one, roster); }
      catch (err2) { last = { state: projects.TOLD.COULD_NOT, because: String((err2 && err2.message) || 'we could not reach that agent') }; }
    }
    /* The LAST verdict, which is the shape the single-assignee route has
       always returned. With several agents on a task the screen has no place
       to show more than one, and inventing a per-agent panel here would be
       drawing a surface nobody designed. */
    return last;
  };

  const taskAct = pathname.match(/^\/api\/project\/([^/]+)\/task\/(\d+)\/(close|reopen)$/);
  if (taskAct && req.method === 'POST') {
    const id = decodeSegment(taskAct[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    try {
      const t = taskAct[3] === 'close' ? tasks.close(id, taskAct[2]) : tasks.reopen(id, taskAct[2]);
      // Close and reopen change what the assignee's block should list, so
      // the block follows the record. Non-gating.
      // ⚠️ `whoOf`, not `t.who`: a task with parts has no `who`, so the block
      // stopped following the record and an agent's instructions kept listing
      // a task it had already finished.
      let told = tellEveryoneOn(t);
      sendJson(res, 200, { task: t, told });
    } catch (err) {
      const msg = String((err && err.message) || '');
      const code = (err && err.code === 'UNREADABLE') ? 500
        : (/no project by that name|no task by that number/.test(msg) ? 404 : 400);
      sendJson(res, code, { error: msg || 'we could not change that task' });
    }
    return;
  }

  /* The parts of a task (#206 step 2). One route per verb, the same shape as
     close/reopen above, and every one of them re-tells the people named on the
     task afterwards. */
  const partMake = pathname.match(/^\/api\/project\/([^/]+)\/task\/(\d+)\/parts$/);
  if (partMake && req.method === 'POST') {
    const id = decodeSegment(partMake[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req).then((raw) => {
      let body = null;
      try { body = JSON.parse(raw || 'null'); } catch { body = null; }
      const screen = isViaScreen(req);
      /* The parts valve (#803): the WRITE is refused for a process past
         twelve part changes an hour, counted across projects from the
         records themselves; the screen is never valved. The sentence says
         the number and when it lifts, and the header says it too. */
      if (!screen) {
        const v = tasks.partValve();
        if (v.refused) { res.setHeader('retry-after', String(v.retryAfterSecs)); sendJson(res, 429, { error: v.because, retry_after_secs: v.retryAfterSecs }); return; }
      }
      try {
        const out = tasks.addPart(id, partMake[2], { sentence: body && body.sentence, who: body && body.who, made: { via: screen ? 'screen' : 'process' } });
        if (!out.ok) { sendJson(res, 400, { error: out.because }); return; }
        // The STORED (trimmed) sentence, off the part addPart just appended
        // -- never the raw request body, which can carry whitespace addPart
        // itself strips before saving.
        const newPart = (out.task.parts || [])[(out.task.parts || []).length - 1];
        const roster = safeRoster();
        let heard;
        if (screen || heardBudgetAllows()) {
          heard = heardBy(id, out.task, body && body.who, newPart && newPart.sentence, roster);
          if (heard && heard.state === chat.DELIVERY.PLACED && !screen) heardBudgetRecord();
        }
        sendJson(res, 200, { task: out.task, told: tellEveryoneOn(out.task, roster), heard });
      } catch (err) {
        const msg = String((err && err.message) || '');
        sendJson(res, /no project by that name|no task by that number/.test(msg) ? 404 : 400,
          { error: msg || 'we could not add that part' });
      }
    }).catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
    return;
  }

  const partAct = pathname.match(/^\/api\/project\/([^/]+)\/task\/(\d+)\/part\/(\d+)\/(who|close|reopen)$/);
  if (partAct && req.method === 'POST') {
    const id = decodeSegment(partAct[1]);
    if (id === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req).then((raw) => {
      let body = null;
      try { body = JSON.parse(raw || 'null'); } catch { body = null; }
      const screen = isViaScreen(req);
      const verb = partAct[4];
      /* The parts valve (#803), the move half: a process reassigning parts in
         a loop is the same runaway as adding them. Close and reopen are not
         valved: they change a state, not who is commanded. */
      if (verb === 'who' && !screen) {
        const v = tasks.partValve();
        if (v.refused) { res.setHeader('retry-after', String(v.retryAfterSecs)); sendJson(res, 429, { error: v.because, retry_after_secs: v.retryAfterSecs }); return; }
      }
      try {
        const out = verb === 'who'
          ? tasks.assignPart(id, partAct[2], partAct[3], body && body.who, { via: screen ? 'screen' : 'process' })
          : tasks.setPartClosed(id, partAct[2], partAct[3], verb === 'close' ? new Date().toISOString() : null);
        if (!out.ok) { sendJson(res, 400, { error: out.because }); return; }
        // `out.changed`: assignPart reports whether `who` actually moved, so
        // re-posting the same assignee does not re-type the same pane line
        // (#304's rule). The budget check mirrors partMake's.
        const roster = safeRoster();
        let heard;
        if (verb === 'who' && out.changed && (screen || heardBudgetAllows())) {
          const sentence = (((out.task && out.task.parts) || []).find((x) => Number(x.id) === Number(partAct[3])) || {}).sentence;
          heard = heardBy(id, out.task, body && body.who, sentence, roster);
          if (heard && heard.state === chat.DELIVERY.PLACED && !screen) heardBudgetRecord();
        }
        sendJson(res, 200, { task: out.task, told: tellEveryoneOn(out.task, roster), heard });
      } catch (err) {
        const msg = String((err && err.message) || '');
        sendJson(res, /no project by that name|no task by that number/.test(msg) ? 404 : 400,
          { error: msg || 'we could not change that part' });
      }
    }).catch(() => sendJson(res, 400, { error: 'we could not read that request' }));
    return;
  }

  const member = pathname.match(/^\/api\/project\/([^/]+)\/agent\/([^/]+)$/);
  if (member && (req.method === 'POST' || req.method === 'DELETE')) {
    const id = decodeSegment(member[1]);
    const name = decodeSegment(member[2]);
    if (id === null || name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    // ⚠️ TWO try blocks, for the same reason delete and create have them: once
    // the membership change has landed it HAPPENED, and a later failure while
    // telling the agent or reading the project back must not come back as "we
    // could not change that project".
    const roster = safeRoster();
    // Whether this request MOVES membership, read before the write: add and
    // remove both no-op on a repeat, and the pane line below must not be
    // typed twice for one fact (#304).
    let moved = false;
    try {
      const before = projects.readAll().find((p) => p && p.id === id);
      const on = !!(before && (before.agents || []).includes(name));
      moved = req.method === 'POST' ? !on : on;
    } catch { moved = false; }
    /* The membership valve (#803, extended): a process past sixty membership
       changes an hour across projects is refused the WRITE with the count
       and the minutes; the screen is never valved (a person building a team
       meets no refusal). Only a change that MOVES membership is counted. */
    const viaScreenMember = isViaScreen(req);
    if (moved && !viaScreenMember) {
      const v = projects.memberValve();
      if (v.refused) { res.setHeader('retry-after', String(v.retryAfterSecs)); sendJson(res, 429, { error: v.because, retry_after_secs: v.retryAfterSecs }); return; }
    }
    try {
      if (req.method === 'POST') projects.addAgent(id, name, roster, { via: viaScreenMember ? 'screen' : 'process' });
      else projects.removeAgent(id, name, { via: viaScreenMember ? 'screen' : 'process' });
    } catch (err) {
      // ⚠️ Three different answers, because they are three different facts. A
      // store we cannot read is ours (500), a project that is not there is a
      // 404 like every sibling route, and only a genuinely bad request is a
      // 400. Answering 400 for an unreadable store put "we will not overwrite
      // your projects file while we cannot read it" in front of somebody as if
      // it were a complaint about what they had typed.
      const code = (err && err.code === 'UNREADABLE') ? 500
        : (/no project by that name/.test(String(err && err.message)) ? 404 : 400);
      sendJson(res, code, { error: String((err && err.message) || 'we could not change that project') });
      return;
    }
    let verdict;
    try {
      verdict = projects.syncAgent(name, roster);
    } catch (err) {
      verdict = { state: projects.TOLD.COULD_NOT, because: String((err && err.message) || 'we could not reach that agent') };
    }
    let project = null;
    try { project = projects.get(id, roster); } catch { project = null; }
    // The pane line, the only thing that reaches a RUNNING agent (#141/#143/
    // #304/#305). Only when membership moved; the verdict rides the response
    // so the screen can say whether the agent was told now or reads it at
    // its next start.
    let said = null;
    if (moved && project) {
      said = projects.speakOfMembership(name, project, req.method === 'POST' ? 'joined' : 'left', roster);
    }
    sendJson(res, 200, { project, told: verdict, said, agentsUnreadable: roster === null });
    return;
  }

  /**
   * --- talking to ONE agent on ONE project ---------------------------------
   *
   * ⚠️ THE MEMBERSHIP CHECK IS A ROUTING RULE, NOT A PERMISSION, and the
   * difference has to be said out loud on this branch. Nothing in this product
   * confines an agent to a project (`engine/projects.js` says so at length),
   * and this does not start. What it does is refuse to make THIS route a
   * general "type into any agent on the machine" endpoint that merely happens
   * to take a project id: a thread belongs to a project and an agent on it, so
   * an agent that is not on the project has no thread here to read or write.
   * The gate that decides whether a keystroke may reach a session at all is
   * `chat.addressable`, and it is about the PANE, not the project.
   *
   * ⚠️ Both halves answer renderable state on every path. A viewport we could
   * not capture, a history file we could not read, and an agent we cannot tie
   * to a session are each a sentence rather than a blank screen.
   */
  const thread = pathname.match(/^\/api\/project\/([^/]+)\/thread\/([^/]+)$/);
  if (thread && (req.method === 'GET' || req.method === 'HEAD')) {
    const id = decodeSegment(thread[1]);
    const name = decodeSegment(thread[2]);
    if (id === null || name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    // ⚠️ ONE roster read for the whole request, like every sibling route here.
    // Two `tmux list-panes` calls can disagree, and the disagreement is exactly
    // the sentence this app exists not to say — a viewport captured from one
    // look reported beside a membership described from another.
    const roster = safeRoster();
    let project;
    try {
      project = projects.get(id, roster);
    } catch (err) {
      sendJson(res, 500, {
        error: String((err && err.message) || 'we cannot read your projects right now'),
        projectsUnreadable: true,
      });
      return;
    }
    if (!project) { sendJson(res, 404, { error: 'there is no project by that name' }); return; }
    const member = (project.agents || []).find((m) => m.sessionName === name) || null;
    if (!member) { sendJson(res, 404, { error: 'that agent is not on this project' }); return; }

    /**
     * ⚠️ THE HISTORY AND THE VIEWPORT FAIL SEPARATELY, because they are
     * different objects with different owners. The messages are OURS — we wrote
     * them — and an unreadable record is reported as unreadable rather than as
     * an empty conversation, the same refusal `/api/projects` makes for the
     * projects file. The viewport is the AGENT's screen, live-only, and its
     * failure says so in its own sentence.
     */
    let messages = null;
    let historyBecause = null;
    /**
     * ⚠️ "WE WITHHELD IT" IS NOT "WE COULD NOT READ IT", and collapsing the two
     * put three false sentences on one screen.
     *
     * A thread belonging to an EARLIER project of this name is one we read
     * perfectly well and chose not to show. Reported through the same channel as
     * a corrupt file, the page said "We cannot read what you have sent this
     * agent" (false — we read it) and then "this is not saying you have sent
     * nothing" (false the other way — for THIS project they have sent nothing,
     * and that is exactly the fact to state).
     *
     * So the two travel separately. `historyOther` means: this project's own
     * conversation is empty, and an earlier one of the same name has messages
     * kept aside.
     */
    let historyOther = false;
    /**
     * ⚠️ A THIRD CHANNEL, because a name we CANNOT FILE UNDER is a third fact.
     *
     * `chat.threadFile` refuses an agent whose session name is not already its
     * own store key — a capital or a dot, which is exactly what the pre-existing
     * `-discord` agents adoption produces and exactly what Josh asked for when
     * he asked for capitalised names. The refusal is right (relaxing it would
     * reintroduce the `MyBot`/`mybot` collision this branch already killed), but
     * routing it into `historyBecause` produced, again, the two false sentences
     * `historyOther` exists to have removed: "We cannot read what you have sent
     * this agent" (there is no file to read) and "this is not saying you have
     * sent nothing" (nothing is kept, here or anywhere).
     *
     * So it gets its own channel and its own vocabulary. Sending still WORKS —
     * `deliver` places the words in the agent's session — and the send-time line
     * already says the message was not added to the conversation. What this
     * flags is the standing fact behind that: for this agent, nothing is kept,
     * and nothing will be.
     */
    let historyUnfilable = false;
    try {
      // ⚠️ The project's own birth date goes in, so a thread written for an
      // EARLIER project that had this name is refused rather than shown under
      // this one. Ids are derived from names and a removal frees the id.
      messages = chat.readThread(id, name, project.createdAt).messages;
    } catch (err) {
      if (err && err.code === 'OTHER_PROJECT') {
        historyOther = true;
        // Empty is the TRUE answer for this project: it is a new project and
        // nothing has been sent to this agent from it.
        messages = [];
      } else if (err && err.code === 'BAD_THREAD') {
        historyUnfilable = true;
        // There is no file and there never will be one, so an empty list is
        // the honest shape — the sentence beside it carries the standing fact.
        // ⚠️ BAD_THREAD can also mean a bad PROJECT id (chat.js throws it for
        // either half of the key), and the page renders this channel as a
        // sentence about the AGENT'S name. Unreachable today with ~3 chars of
        // margin: cleanName caps a project name at 120, safeKey only strips,
        // idFor adds a short counter, and PROJECT_ID allows 128 (the raised
        // bound is pinned by a test). If ids ever grow, branch this on which
        // half failed before the margin is spent.
        messages = [];
        // Set for API consumers and pinned by the route test's own-words
        // assertion; the PAGE does not read it on this arm (it composes the
        // named sentence itself and branches on historyUnfilable first).
        // ⚠️ This is a STATED EXCEPTION to the no-unread-surface rule that
        // removed the payload's agents copy (round 19) and readIdentity's
        // source (round 22): those had no reader anywhere, while this field
        // keeps the GET contract uniform across its three history arms for
        // any non-page consumer -- the field exists on the other two arms
        // for the page, so absence HERE would be the special case (round
        // 26, kept deliberately).
        historyBecause = String((err && err.message) || 'we cannot keep a conversation under this agent’s name');
      } else {
        historyBecause = String((err && err.message) || 'we cannot read what you have sent this agent');
      }
    }
    /* ⚠️ The capture ALWAYS runs: the question region derives from this
       same read (chat.questionIn(view.text) below), and the question is
       safety, not chrome -- a first cut gated the capture itself and
       silently blinded the needs-you flow in Off, which is the one
       thing the spec says the mode must never touch. What Engineering
       mode gates is what is SERVED as the raw window, further down. */
    const view = chat.viewport(name, roster);
    /**
     * ⚠️ The question region is offered only when the BOARD says this agent is
     * asking one, so the thread cannot contradict the card that sent the person
     * here. And when the board says so while the markers are not in the capture
     * — the pane redraws, and the two reads are milliseconds apart — that is
     * said plainly rather than rendered as no question at all.
     */
    // The engine's own constant, not a literal: a state renamed there must move
    // this with it rather than leaving a comparison that silently never matches.
    // ⚠️ The `member.tied &&` conjunct is defence-in-depth the same way the
    // page's button gate is: today's pipeline forces an untied member's
    // state to `unknown` upstream, so no fixture can drive tied=false
    // together with NEEDS_YOU and no test can hold this conjunct (round 14
    // measured its removal green). It stays for the day the upstream gating
    // changes; there is no route-level pin for it, on purpose recorded here.
    const asking = member.tied && member.state === STATE.NEEDS_YOU;
    const question = asking && view.text ? chat.questionIn(view.text) : null;
    /**
     * ⚠️ TWO DIFFERENT FACTS, TWO SENTENCES. "We read its screen and the
     * question is not in the capture" and "we could not read its screen at
     * all" were one string here, so a failed capture rendered as a claim
     * about what IS on a screen nobody read -- with the page then adding
     * "its whole screen is below" over a screen it was hiding. The exact
     * collapse this branch fixed three times elsewhere, on the one screen
     * the feature exists for.
     */
    // The page composes "<name> is waiting on an answer, and <clause>", so
    // the clause must not restate that premise -- "its card says it is
    // asking something, and we could not read..." doubled back on itself on
    // screen (round 15). One derivation of the sentence, on this side.
    const questionBecause = (asking && !question)
      ? (view.text == null
        ? 'we could not read its screen just now to show the question'
        : 'we cannot find the question on its screen right now')
      : null;
    /* ⚠️ The poll gets a BOUNDED tail (round 36): at the engine's own
       ceilings a full thread is a ~2MB parse-and-stringify every five
       seconds on a synchronous server that can already block on tmux in
       the same request path. The last 200 ride; `olderCount` says how
       many the file still keeps, so the page can state the truth instead
       of implying the visible list is everything. */
    const TAIL = 200;
    const olderCount = Array.isArray(messages) && messages.length > TAIL
      ? messages.length - TAIL : 0;
    if (olderCount) messages = messages.slice(-TAIL);
    sendJson(res, 200, {
      project: { id: project.id, name: project.name },
      agent: member,
      messages: withPreviews(messages),
      olderCount,
      historyBecause,
      // See the block above: withheld is not unreadable, and the page says a
      // different sentence for each.
      historyOther,
      // The third channel: this agent's name cannot be filed under at all.
      historyUnfilable,
      // (An `agents` copy of the membership used to ride here; nothing read
      // it -- the picker builds from the projects poll -- so it was dropped
      // rather than left as surface with no consumer. Round 19.)
      /* Engineering mode gates the SERVED window, not the capture (the
         capture feeds the question above): Off answers the truth in
         words so a stale client cannot render a window the person
         turned off. */
      viewport: engmode.read().on ? view
        : { text: null, because: 'engineering mode is off, so the window is not shown' },
      asking,
      question,
      questionBecause,
      // Carried for contract parity with the projects routes and held by
      // the blind-roster test; the page's fleet-unreadable sentence on this
      // screen is rendered from the projects payload (PJ_AGENTS_UNREADABLE),
      // not from this field.
      agentsUnreadable: roster === null,
    });
    return;
  }

  if (thread && req.method === 'POST') {
    const id = decodeSegment(thread[1]);
    const name = decodeSegment(thread[2]);
    if (id === null || name === null) { sendJson(res, 400, { error: 'that is not a name we can read' }); return; }
    readBody(req)
      .then((buf) => {
        let body;
        try {
          body = JSON.parse(buf.toString('utf8') || '{}') || {};
        } catch {
          throw new Error('we could not read that request');
        }
        // Refused before anything is looked up, so a message we would never
        // send does not cost a tmux fan-out.
        const problem = chat.messageProblem(body.text);
        if (problem) throw new Error(problem);

        const roster = safeRoster();
        let project;
        try {
          project = projects.get(id, roster);
        } catch (err) {
          const unreadable = new Error(String((err && err.message) || 'we cannot read your projects right now'));
          unreadable.status = 500;
          throw unreadable;
        }
        if (!project) {
          const missing = new Error('there is no project by that name');
          missing.status = 404;
          throw missing;
        }
        if (!(project.agents || []).some((m) => m.sessionName === name)) {
          const notOn = new Error('that agent is not on this project');
          notOn.status = 404;
          throw notOn;
        }

        /**
         * ⚠️ DELIVER FIRST, THEN RECORD THE VERDICT WITH IT — and record even a
         * failure. "I asked casey this and it did not get there" is a thing the
         * person needs to be able to see later; a thread that remembers only
         * the successes quietly rewrites its own history.
         *
         * ⚠️ AND THE TWO ANSWERS ARE REPORTED SEPARATELY. A message that WAS
         * placed and could not be written down must not come back looking like
         * a message that was not sent, which is what one merged boolean would
         * have done. Same reason create and delete each carry two try blocks.
         */
        /**
         * ⚠️ THE VERDICT IS PASSED THROUGH WHOLE, three states and all, and
         * nothing here narrows it to a boolean. `unconfirmed` is not a flavour
         * of failure: it means the text may already be in that agent's
         * composer, so a screen that folded it into `could_not` would invite
         * the re-send that duplicates it. See `DELIVERY` in engine/chat.js.
         */
        const files = attachments.resolveForMessage(body, 'project', id, 'that attachment is not one this project can send');
        if (!files.ok) throw new Error(files.because);
        const delivery = chat.deliver(name, body.text, roster, undefined, attachments.wireNote(files.recs));
        const kept = chat.appendMessage(id, name, { text: body.text, at: delivery.at, delivery, ...attachments.rowFields(files.recs) }, project.createdAt);
        sendJson(res, 200, {
          delivery,
          recorded: kept.recorded === true,
          recordedBecause: kept.because || null,
          // Said out loud when an earlier project of this name had a
          // conversation: it was kept, and it is not this project's.
          supersededBecause: kept.supersededBecause || null,
          // No `messages` here (round 38): nothing read it -- the page
          // refreshes through the GET, which is also where the round-36
          // TAIL bound lives. Carrying the whole record on the POST was
          // both an unread API surface and an unbounded ~2MB payload the
          // GET had already been bounded against.
          agentsUnreadable: roster === null,
        });
      })
      // The UNREADABLE arm here is defensive, not live: deliver and
      // appendMessage never throw by contract, and projects.get's failure is
      // rewrapped with an explicit .status above, which wins first. Kept so
      // this catch matches its siblings if a throwing read is ever added.
      .catch((err) => sendJson(res, (err && err.status) || ((err && err.code === 'UNREADABLE') ? 500 : 400),
        { error: String((err && err.message) || 'we could not read that request') }));
    return;
  }

  /**
   * --- choosing a folder ---------------------------------------------------
   *
   * A browser cannot hand back a real path. `<input webkitdirectory>` withholds
   * it deliberately, so the only options are "make the person type a path" or
   * "let the server list folders" — and typing a path is exactly the wall §0
   * exists to remove for a non-technical person. Hence this: read-only,
   * directories only, one level at a time, rooted at the home folder.
   *
   * ⚠️ THIS IS NEW SAFETY CODE, WHICH IS THE LEAST TRUSTWORTHY CODE IN ANY DIFF
   * OF MINE. Five of nine blockers in a previous challenge loop were in guards
   * added during that loop. So containment is asserted on the RESOLVED path and
   * nowhere else: `..` is not stripped, spelling is not inspected, and no
   * prefix is compared before `realpathSync` has run. A symlink inside the home
   * folder pointing outside it is the case every string-level check misses.
   */
  if (pathname === '/api/folders' && (req.method === 'GET' || req.method === 'HEAD')) {
    // ⚠️ RESOLVED, because `real` below is resolved and the two are compared.
    // With an un-resolved `home`, a machine whose home directory is reached
    // through a symlink (which is ordinary) failed its OWN containment check:
    // the browser refused the home folder it had just been asked for, and the
    // whole add-project flow was dead. The route's test compared against
    // `realpathSync(homedir())` too, so it could only pass.
    let home;
    try { home = fs.realpathSync(os.homedir()); } catch { home = os.homedir(); }
    // Parsed here rather than threaded down from `pathOf`, which deliberately
    // returns the path alone -- routing on anything that carries a query string
    // is the bug that function exists to have fixed.
    let asked = null;
    try { asked = new URL(req.url, ROUTING_BASE).searchParams.get('path'); } catch { asked = null; }
    let real;
    try {
      const target = asked ? String(asked) : home;
      // A null byte throws out of `realpathSync` rather than truncating the
      // path somewhere the check no longer applies.
      if (target.includes('\0')) throw new Error('bad path');
      real = fs.realpathSync(target);
    } catch {
      sendJson(res, 400, { error: 'we cannot see a folder there' });
      return;
    }
    // ⚠️ Containment on the RESOLVED path, expressed as "the relative route
    // from home does not climb". `startsWith(home)` is the wrong test twice
    // over: `/Users/agentine` starts with `/Users/agent1`... only by accident of
    // spelling, and it says nothing about a symlink.
    // ⚠️ CASE, on macOS: `realpath` resolves symlinks but does NOT canonicalise
    // case on a case-insensitive volume, so `/users/agent1/x` stays lowercase
    // and `path.relative('/Users/agent1', …)` yields a climb. The containment
    // check then refuses a path that is genuinely inside home. Left as-is
    // rather than case-folded: it FAILS CLOSED (a false refusal, never an
    // escape), the browser only ever hands back paths this route itself
    // produced, and case-folding a path comparison is exactly the kind of
    // loosening that turns a containment check into a hole. Recorded so the
    // next person to meet it knows it is a known false refusal, not a bug in
    // their typing.
    const rel = path.relative(home, real);
    // `rel.startsWith('..')` alone also refuses a folder legitimately named
    // `..archive`. The climb is the segment `..`, not the two characters.
    const climbs = rel === '..' || rel.startsWith('..' + path.sep);
    if (real !== home && (climbs || path.isAbsolute(rel))) {
      sendJson(res, 403, { error: 'we only look inside your home folder' });
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(real, { withFileTypes: true });
    } catch {
      sendJson(res, 400, { error: 'we cannot read that folder' });
      return;
    }
    const folders = entries
      // Directories the person would recognise: no dotfiles, and a symlinked
      // directory is offered because it is a perfectly ordinary way to keep
      // work — it just gets resolved again when it is opened or chosen.
      .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || e.isSymbolicLink()))
      .map((e) => ({ name: e.name, path: path.join(real, e.name), sure: e.isDirectory() }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const LIMIT = 500;
    // ⚠️ Only the entries that will actually be SHOWN get a `stat`, and only
    // the ones `readdir` could not already type as directories. A synchronous
    // stat per entry blocked the single-threaded server across the whole
    // folder, including the thousands past the limit that nobody sees.
    const shown = [];
    // ⚠️ Tracked explicitly, not inferred from `folders.length > shown.length`.
    // That comparison also counts entries dropped for NOT BEING FOLDERS, so a
    // directory holding one link-to-a-file reported itself as truncated -- a
    // warning about missing folders when nothing was missing. "We stopped
    // early" is the fact; "some entries were not folders" is a different one.
    let hitLimit = false;
    for (const e of folders) {
      if (shown.length >= LIMIT) { hitLimit = true; break; }
      if (!e.sure) {
        try { if (!fs.statSync(e.path).isDirectory()) continue; } catch { continue; }
      }
      shown.push({ name: e.name, path: e.path });
    }
    sendJson(res, 200, {
      path: real,
      home,
      // ⚠️ Said out loud. A silent cut made a folder that exists but sorts past
      // the limit indistinguishable from one that is not there — the page's
      // "nothing else in here" would be a claim nobody checked.
      truncated: hitLimit,
      showing: shown.length,
      // ⚠️ NO TOTAL WHEN WE STOPPED EARLY, because we do not have one.
      //
      // This read `hitLimit ? folders.length : shown.length`, with a comment
      // correctly explaining that `folders.length` counts entries that never
      // reached the directory check -- and then using it in exactly the branch
      // where that is true. `readdir` gives 520 entries; we typed the first
      // 500 and stopped; the other 20 may be files, links to files, or
      // anything else. So "the first 500 of 520" was a count of things we had
      // not looked at, and a directory of 500 folders plus 20 links-to-files
      // announced 20 folders that do not exist.
      //
      // `null` is the honest answer and the page says "there are more" rather
      // than inventing a number. Counting them properly would mean stat-ing
      // every entry past the limit, which is the synchronous-blocking cost the
      // limit exists to avoid.
      total: hitLimit ? null : shown.length,
      // Null AT home rather than at the filesystem root, so "up" can never walk
      // out of the only place this route will serve.
      parent: real === home ? null : path.dirname(real),
      folders: shown,
    });
    return;
  }

  // Anything under /api/ that reached here matched no handler -- usually a
  // method the route does not implement, e.g. PATCH on an avatar. Falling
  // through to the page would answer an API call with HTML at 200, which is the
  // same silent-success failure the query-string bug produced. Different way
  // in, identical signature, so it is closed here rather than route by route.
  //
  // Compared against the DECODED path. `/api%2fstatus` does not start with
  // `/api/` as a string, so an un-decoded check let it through to the page --
  // the invariant failing on the one spelling a syntactic check gets wrong,
  // which is the same mistake pathOf documents for `//`.
  const apiPath = decodeSegment(pathname) || pathname;
  if (apiPath === '/api' || apiPath.startsWith('/api/')) {
    sendJson(res, 404, { error: 'no such endpoint' });
    return;
  }

  /* The web app manifest (#718, the home-screen third): with it, Add to Home
     Screen on a phone produces an app-shaped launch (its own icon, no
     browser chrome, start_url the board). It is NOT the App Store third and
     not iOS parity; Josh ruled push + icon + store, and this is one of the
     three. Served as its own type so a browser reads it as a manifest and
     not as the page. The name, short_name and colours in it appear under
     the icon and paint the status bar: placeholders until Mona Lisa says
     them (#815). */
  if (apiPath === '/manifest.webmanifest' && (req.method === 'GET' || req.method === 'HEAD')) {
    fs.readFile(path.join(__dirname, 'web', 'manifest.webmanifest'), (err, buf) => {
      if (err) { sendJson(res, 404, { error: 'no manifest' }); return; }
      res.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=3600' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
    return;
  }

  /* The tab icons (#45, Josh 2026-08-17). An explicit allowlist of the six
     shipped sizes (192 and 512 joined for the manifest, #718), because everything else below falls through to the page:
     without this route, /icons/kosmos-32.png would answer HTML at 200 with
     the wrong content type, the same silent-success signature the API guard
     above exists to stop. A name outside the allowlist 404s as JSON rather
     than serving the page as an image. */
  const iconGet = pathname.match(/^\/icons\/(kosmos-(?:16|32|48|180|192|512)\.png)$/);
  if (iconGet && (req.method === 'GET' || req.method === 'HEAD')) {
    fs.readFile(path.join(__dirname, 'web', 'icons', iconGet[1]), (err, buf) => {
      if (err) { sendJson(res, 404, { error: 'no such icon' }); return; }
      // A day of cache is a choice: a redesigned icon may serve stale for
      // up to 24h after an update, accepted for favicon-class assets.
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
    return;
  }
  // Compared against the DECODED path, the same lesson the /api/ guard
  // above records: /icons%2fx does not start with /icons/ as a string, and
  // an un-decoded check would hand the encoded spelling the page at 200.
  // (The doubled-slash spelling //icons/x never reaches here: pathOf
  // refuses protocol-relative shapes with a 400, measured; the test pins
  // that it cannot get the page either way.)
  // Case-insensitive: macOS filesystems are, and /Icons/x reaching the
  // page as HTML would be the same silent-success shape in one more
  // spelling. (Browsers request the exact lowercase hrefs; this is
  // belt-and-braces for probes.)
  if (/^\/icons(\/|$)/i.test(apiPath)) {
    sendJson(res, 404, { error: 'no such icon' });
    return;
  }
  // /favicon.ico 404s BY DESIGN, matching the site: the icon set is the
  // four explicit PNGs above, and a probe for the .ico must not receive
  // the page dressed as an icon (the silent-success signature again).
  if (apiPath === '/favicon.ico') {
    sendJson(res, 404, { error: 'no favicon.ico: the icons are /icons/kosmos-<size>.png' });
    return;
  }

  const file = path.join(__dirname, 'web', 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('could not read the page');
      return;
    }
    /* 🛑 `no-store`, THE SAME AS EVERY JSON ROUTE, and its absence was invisible
       by construction. This sent no cache header, no ETag and no
       last-modified, which does not mean "do not cache" -- it means the
       browser decides, and browsers keep HTML.
       ⚠️ THE WHOLE APP IS ONE FILE, so a cached page is cached markup, CSS and
       script together. An update lands, the installer restarts the server on
       the new bundle, the version line reports the new number, and the person
       goes on looking at the PREVIOUS build with no signal anywhere. Josh hit
       exactly that: 0.2.75 on the line and the previous page on screen.
       📌 It costs a re-read of one local file per load, which is the price of
       an update actually arriving. (#271, Mona Lisa.) */
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(buf);
  });
});

/**
 * ⚠️ Bound to localhost deliberately. This server writes and has no auth.
 *
 * It sets roles, stores avatars, records the commitments the restart
 * confirmation will read, and EDITS THE FILE AN AGENT BOOTS FROM. There is no
 * authentication of any kind.
 *
 * ⚠️ AND IT TYPES INTO RUNNING AGENTS. `POST /api/project/:id/thread/:agent`
 * puts arbitrary text plus a separate Enter into a live agent's Claude
 * session -- on a permission prompt, that is an unauthenticated caller
 * answering on behalf of an agent started with
 * `--dangerously-skip-permissions`. Added 2026-08-14, and added to THIS
 * paragraph the same day, for the reason the next paragraph records about
 * the last capability that went unlisted.
 *
 * ⚠️ AND IT CREATES AGENTS, which was the most powerful thing behind this bind
 * and was missing from this list while it was true. `POST /api/agents` installs
 * a launchd job with RunAtLoad and KeepAlive that starts Claude with
 * `--dangerously-skip-permissions` at every login, and whose instruction file
 * any subsequent write here can rewrite. This paragraph is what README points
 * a reader at for "what protects it, and what does not", so leaving the newest
 * and largest capability out of it made the canonical statement of the posture
 * the least accurate thing about it.
 *
 * THREE ways that protection is lost, and only the first is obvious:
 *
 *   1. Changing this to '0.0.0.0'. A one-line edit that looks harmless and
 *      exposes every write endpoint to whatever network the machine is on.
 *
 *   2. A reverse proxy or tunnel pointed at this port. **Binding to localhost
 *      is not sufficient on a machine running one.** Tailscale Funnel, for
 *      instance, proxies `127.0.0.1` ports straight to the public internet —
 *      it is already enabled on the mini this was built on, publishing three
 *      localhost ports. Adding a route for this one would publish it too,
 *      without touching a line of this file.
 *
 *   3. ⚠️ A page on ANOTHER SITE, which needs no misconfiguration at all. A
 *      POST with a form content type is a CORS simple request: no preflight,
 *      and the loopback `Host` a legitimate request carries. Measured against
 *      this server before `crossSiteWrite` existed — a page on any origin
 *      created a worker directory and installed a launchd job. That guard is
 *      now the third thing holding this up, and it is the only one that
 *      protects a machine whose owner did nothing wrong.
 *
 * So localhost is a *default*, not a guarantee. Reachability and login arrive
 * together or not at all.
 *
 * ---
 *
 * Binds and resolves once listening. Port 0 asks the OS for a free one, which
 * is how the tests get a port without colliding with a board someone is using.
 */
function start(port = PORT) {
  return new Promise((resolve, reject) => {
    // Without this, a bind failure -- EADDRINUSE when a board is already
    // running on 4317, which is the common case -- is an unhandled 'error'
    // event that exits with a raw stack trace. Returning a Promise implies the
    // caller can be told; this makes that true.
    const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
    const onListening = () => {
      server.removeListener('error', onError);
      // Keep a listener attached for the life of the process. Without one, an
      // error after a successful bind is uncaught and exits with a raw stack.
      server.on('error', (err) => {
        process.stderr.write(`Kosmos server error: ${String(err && err.message)}\n`);
      });
      /* The engine's own contract: the server calls ensure at boot with
         the board's port, and until somebody does, a configured, enrolled,
         switched-on machine rests forever at "the board has not started
         the tunnel". The bound port, not the requested one. */
      try { remote.ensure(server.address().port); } catch { /* status says what happened */ }
      /* The tunnel's ensure tick. The comment above is the whole defect: the
         engine starts the tunnel only when SOMEBODY calls ensure(), and the
         callers are boot, the Plus switch, and the Mac's own code step. Any
         way enrolment or the switch can land without one of those (measured
         on Josh's fresh Mac, 2026-08-26 08:50: "The board has not started the
         tunnel" after sign-in, every precondition true, no child) rests
         forever. ensure() is idempotent (a running child or a pending
         restart returns at once), so a tick costs one settings read and
         four stat() calls every fifteen seconds, and the resting state can
         last at most that long. unref'd so it never holds the process open. */
      const ensureTick = setInterval(() => {
        try { remote.ensure(); } catch { /* status says what happened */ }
      }, Number(process.env.AGENT_WORKFORCE_TUNNEL_ENSURE_MS) > 0 ? Number(process.env.AGENT_WORKFORCE_TUNNEL_ENSURE_MS) : 15 * 1000);  // the env is the test seam only
      if (typeof ensureTick.unref === 'function') ensureTick.unref();
      /* #185: the nudge sweep. Its own timer, never the status GET (a
         read must stay a read); once a minute is far inside the
         ten-minute constant it serves. unref'd so it never holds the
         process open, and every run is best-effort: the room's own
         unanswered line is the person-facing surface either way. */
      const sweep = setInterval(() => {
        /* ⚠️ safeRoster(), NEVER paneRoster(): the sweep delivers, and
           delivery needs full snapshot-shaped cards (target and all).
           paneRoster's thin rows fail addressable() before anything is
           typed, and the first call site shipped exactly that, burning
           every pair's one nudge as could_not with zero send-keys,
           invisibly, while the suite's full-card fixture passed. The
           paneRoster-vs-snapshot confusion this file's own docblock
           warns about, one more time. */
        try { messages.sweepUnanswered(safeRoster()); } catch { /* the line still shows */ }
      }, 60 * 1000);
      if (sweep && typeof sweep.unref === 'function') sweep.unref();
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

// Only boot when run directly. Requiring this module -- which the routing tests
// do, so they can drive the real server -- must not bind a port as a side
// effect of the import. Same guard as engine/status.js.
/**
 * Put the current startup script where every agent's job points, at boot.
 *
 * 🛑 A FIX TO IT REACHED NOBODY UNTIL SOMEBODY MADE A NEW AGENT. `bin/agent-supervisor.sh`
 * is shared by every agent on the machine, and its own header says a change
 * there "reaches every agent the next time it starts". That sentence was true
 * of the FILE and false of the MACHINE: the only two callers of
 * `installSupervisor` are agent creation and the login-job repair, so on an
 * install where nobody happens to create an agent, an update ships a new
 * supervisor into the app bundle and the jobs go on running the old copy under
 * the data directory. Forever, silently, and the header explaining the update
 * model is what a reader finds instead of the gap.
 *
 * 🔑 THE BOARD RESTARTING IS THE UPDATE. Every update stops and starts this
 * process, and so does every login, so this is the one place that runs exactly
 * when a new supervisor arrives and never in between.
 *
 * ⚠️ THE WRITE IS RENAME-INTO-PLACE, which is what makes it safe to do under
 * running agents: every live supervisor is a `bash` process reading that exact
 * file by offset, so a new inode leaves them reading the one they started with
 * and they pick this up at their next start. `installSupervisor` already works
 * that way for the same reason; this is a new caller, not a new mechanism.
 *
 * ⚠️ NOT FATAL, and it must never be. A board that refuses to start because it
 * could not refresh a script is strictly worse than a board running with the
 * previous one, which is the state every install is in today.
 *
 * ⚠️ AND NOT AT IMPORT. The routing tests require this module; writing files as
 * a side effect of an import is the same class as binding a port, which the
 * guard below already exists to prevent.
 */
if (require.main === module) {
  /* 🛑 PINNED TO $HOME, NOT AT IMPORT, ONLY WHEN THIS IS THE REAL BOARD
     PROCESS (#923). Nothing anywhere in this file or engine/ ever calls
     process.chdir(), so this process's own cwd is whatever directory
     whoever launched `node server.js` happened to be in -- for a real
     install, that is install/pkg-scripts/postinstall's own root-descended
     shell chain, which runs from Installer.app's temporary package-script
     staging directory. This board process is the ONE thing in that chain
     that OUTLIVES it (nohup, backgrounded, meant to survive the installer
     exiting), so its cwd stays pointed at a directory Installer.app tears
     down once the .pkg finishes -- likely within moments, well before
     anyone reaches Connect. Nothing here needed that directory for its own
     file I/O (every write already resolves through store.ROOT or another
     absolute path) -- but engine/connect.js's `run()` spawns `<binary>
     install` without an explicit cwd, so that CHILD PROCESS inherits the
     dead directory and dies at its own startup the moment it tries to
     resolve anything relative to a cwd that no longer exists. Traced from
     Josh's exact report (a wiped Mac, first install, Connect for Claude:
     "the current working directory was deleted so that command didn't
     work"), corroborated the same evening by a stray dev `node server.js`
     found with the identical shape from the other direction (its OWN
     worktree removed out from under it, still running, cwd dead) -- #923.
     $HOME, not KOSMOS_HOME or store.ROOT: guaranteed to exist for the
     whole life of the account running this process, no mkdir/install-order
     dependency, unlike a fresh install's own directories which this exact
     card is about the timing of. Guarded, matching this whole file's own
     "not fatal" posture: if even $HOME is somehow unreachable, the board
     still attempts to start with whatever cwd it already had -- no worse
     than before this fix, for that one pathological case. */
  try { process.chdir(os.homedir()); } catch { /* keep whatever cwd we had */ }
  try {
    const put = create.installSupervisor();
    if (!put.ok) {
      process.stderr.write(put.missing
        ? 'Kosmos could not find the script it starts agents with, so agents made from here would not start.\n'
        : 'Kosmos could not refresh the script it starts agents with; your agents keep the one they have.\n');
    }
  } catch (err) {
    process.stderr.write(`Kosmos could not refresh the script it starts agents with: ${String(err && err.message)}\n`);
  }
  start().then(() => {
    // Report the port actually bound, not the one requested, or a `PORT=0` run
    // would announce itself on port 0.
    process.stdout.write(`Kosmos on http://127.0.0.1:${server.address().port}\n`);
    process.stdout.write('Local only. It writes, and it has no login yet.\n');
  }).catch((err) => {
    // Say what to do rather than name an exception. A raw EADDRINUSE stack is
    // exactly what start()'s promise exists to replace, and leaving this
    // uncaught made the comment above it a lie.
    const detail = err && err.code === 'EADDRINUSE'
      ? `port ${PORT} is already in use. Is a board already running?`
      : String(err && err.message);
    process.stderr.write(`Kosmos could not start: ${detail}\n`);
    process.exit(1);
  });
}

// Exported so the routing tests can drive the real server rather than a
// re-implementation of it. Testing the path helper in isolation would not have
// caught the routing bug, because the helper was never the broken part -- the
// routes reading `req.url` around it were.
module.exports = {
  server, start, pathOf, decodeSegment, resetHeardBudgetForTests,
  /* #1304: exported so the two-reader precedence can be driven directly. A test
     that needed a real process tree, a tmux server and a signed-in account would
     not run anywhere, and the precedence is the part worth pinning.
     `setLiveReader` is the seam for the ROUTE's live arm, which `whoamiFor`
     alone cannot cover: the wiring is where the session name is chosen. */
  whoamiFor, setLiveReader,
  /* Exported so the sentence can be pinned DIRECTLY. It is the only part of
     this answer a person actually reads, and five mutations of it survived the
     whole suite - including the model standing in for the account - because the
     only assertions on it went through the route, where the fixtures could not
     produce a null account and a known model at the same time (#1304). */
  sentenceForWhoami,
};
