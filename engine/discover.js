'use strict';

/**
 * Agents that already exist on this computer, whether or not they are running.
 *
 * 🛑 WHY THIS EXISTS, IN JOSH'S WORDS (2026-08-22, after the first install by
 * somebody outside this team): *"if people already have agents anywhere, we need
 * to be able to find them and bring them into the Kosmos platform... It's the
 * most catastrophic flaw in the entire system."*
 *
 * Until now "your agents" meant `status.paneRoster()`, which is tmux, which is
 * PROCESSES RUNNING RIGHT NOW. A person means the agents they have made. Those
 * two are the same set only on a machine where nothing has ever been closed --
 * which describes every Mac this project has been tested on, because on all of
 * them Kosmos created the agents itself. The case has never been run.
 *
 * 🔑 SO THIS READS THE DISK INSTEAD. Claude keeps one folder per working
 * directory under `~/.claude/projects`; each holds that directory's session
 * transcripts, and a transcript records the real `cwd` it ran in. A directory
 * with a `CLAUDE.md` that introduces an agent IS an agent, running or not.
 *
 * ⚠️ THE FOLDER NAME IS NOT THE PATH, and reading it as one is the obvious
 * shortcut. `~/work/workers/angel` is filed as `-Users-agent1-work-workers-angel`
 * -- every non-alphanumeric becomes a dash, so a path with a dash in it and one
 * with a slash arrive identical and there is no way back. The transcript's own
 * `cwd` is the only reliable answer, which is why this opens a file per folder
 * rather than parsing a name.
 *
 * ⚠️ READ-ONLY, AND NOTHING HERE STARTS OR TOUCHES AN AGENT. Finding is a
 * separate act from connecting, and this module does only the first.
 */

const fs = require('node:fs');
const path = require('node:path');
const status = require('./status');

/**
 * Is this folder's agent already one Kosmos looks after?
 *
 * ⚠️ NEVER THROWS AND FAILS TOWARDS "NO". A wrong `false` re-offers an agent
 * somebody already has, and the add refuses with a sentence saying so. A wrong
 * `true` hides an agent from the one screen that exists to surface it, silently,
 * which is the defect this whole module was written after.
 */
/**
 * Whether a pane is running under this name right now, whatever started it.
 *
 * 🛑 THE THIRD WAY OF BEING KNOWN (#362). An agent launched by hand, under a
 * session named for it, is on the board (the status engine names it) and yet
 * had no Kosmos job and no recorded folder, so this file offered it as "not
 * in Kosmos" while the board counted it, and pressing Add would have written
 * a job for a folder that already had a running Claude: two in one worker
 * folder, fighting over the hand-written plist. Measured on the dev fleet
 * (every <name>-discord session); reachable on any machine where a session is
 * named for a folder Kosmos did not make.
 *
 * Returns the roster entry, null when nothing runs under the name, and
 * `undefined` when the roster could not be read at all, which callers must
 * treat as "do not know", never as "not running".
 */
function runningUnderName(name, roster) {
  let list = roster;
  if (!Array.isArray(list)) {
    try { list = status.paneRoster(); } catch { return undefined; }
  }
  return list.find((a) => a && a.sessionName === name) || null;
}

/**
 * ONE DEFINITION OF "IN KOSMOS", for the found list and for connect alike
 * (#362): a Kosmos job under the name, a folder recorded against the name, or
 * a pane already running under the name. The list and the Add button used to
 * answer with two of the three and disagree with the board, which used the
 * third.
 */
function alreadyIn(dir, roster) {
  const create = require('./create');
  const store = require('./store');
  const name = path.basename(String(dir || ''));
  if (!name || !create.nameUsable(name)) return false;
  try { if (create.hasJob(name)) return true; } catch { /* ask the other one */ }
  try {
    const p = store.readProfile(name);
    if (p && p.dir && p.dir === dir) return true;
  } catch { /* no record is not a reason to hide it */ }
  if (runningUnderName(name, roster)) return true;
  return false;
}

/** The newest transcript in a project folder, or null. */
function newestTranscript(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  let best = null;
  let bestAt = 0;
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const full = path.join(dir, n);
    let at = 0;
    try { at = fs.statSync(full).mtimeMs; } catch { continue; }
    if (at > bestAt) { bestAt = at; best = full; }
  }
  return best;
}

/**
 * Every agent this computer has on disk.
 *
 * ⚠️ NEVER THROWS, and answers `ok:false` rather than an empty list when it
 * could not look. "We found none" and "we could not look" are different
 * sentences and this codebase exists because they were once the same one.
 */
function found() {
  let roots;
  try { roots = status.configRoots(); } catch (err) {
    return { ok: false, agents: [], because: 'we could not work out where Claude keeps its records' };
  }

  const byDir = new Map();
  let looked = 0;
  /* One look at what is running, for every folder below (#362). An unreadable
     roster reads as undefined, and alreadyIn then treats "running" as unknown
     rather than as no. */
  let roster;
  try { roster = status.paneRoster(); } catch { roster = undefined; }

  for (const root of roots) {
    const projects = path.join(root, 'projects');
    let dirs;
    try { dirs = fs.readdirSync(projects); } catch { continue; }
    looked += 1;
    for (const d of dirs) {
      const folder = path.join(projects, d);
      let st;
      try { st = fs.statSync(folder); } catch { continue; }
      if (!st.isDirectory()) continue;

      const transcript = newestTranscript(folder);
      if (!transcript) continue;
      let cwd = null;
      try { cwd = status.transcriptCwd(transcript); } catch { cwd = null; }
      if (!cwd || byDir.has(cwd)) continue;

      /* The instruction file is what makes a working directory an AGENT rather
         than a folder somebody once ran Claude in. Most of these are the
         second thing. */
      const file = path.join(cwd, 'CLAUDE.md');
      let text;
      try { text = fs.readFileSync(file, 'utf8').slice(0, 4000); } catch { continue; }

      const id = status.identityFromText(text);
      /* ⚠️ A `CLAUDE.md` THAT DOES NOT INTRODUCE ANYBODY IS NOT AN AGENT. Every
         repo in this org has one and they are project instructions; listing
         them as agents would bury the real ones in a list nobody trusts. */
      if (!id || !id.displayName) continue;

      byDir.set(cwd, {
        dir: cwd,
        name: id.displayName,
        role: id.role,
        instructions: file,
        /* 🔑 WHETHER KOSMOS ALREADY HAS THIS ONE, so a screen outside setup can
           offer only what is missing. Answered here rather than by the page,
           which would need the fleet list and the folder record and would get a
           different answer from whichever it happened to have.
           ⚠️ TWO WAYS TO BE IN, and either counts: Kosmos made it (a job under
           its name) or somebody connected it (a folder recorded against its
           name). Asking only the first would re-offer every connected agent the
           moment its job was ever removed by hand. */
        already: alreadyIn(cwd, roster),
      });
    }
  }

  if (!looked) {
    return { ok: false, agents: [], because: 'we could not read where Claude keeps its records' };
  }
  /* Stable and human: by the name a person would look for. */
  const agents = [...byDir.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, agents, because: null };
}

/**
 * Bring an agent Kosmos did not create under its management.
 *
 * 🔑 NOTHING IS MOVED, COPIED OR RE-CREATED, and that is the whole design. The
 * agent already exists: a folder with a CLAUDE.md in it. Connecting records
 * where that folder is and installs the launch job that starts an agent THERE,
 * so from that moment its instructions are read from their file, its restart is
 * the same one click as any other agent's, and it comes back at login.
 *
 * ⚠️ SO CONNECTING AND RESTARTING ARE THE SAME OPERATION, which is the insight
 * that made this small (Splinter, 2026-08-22): Kosmos never has to take over a
 * running process. It starts a fresh session in that folder, and every managed
 * behaviour follows from having started it.
 *
 * ⚠️ AND IT REFUSES RATHER THAN GUESSES. A folder with no readable identity, a
 * name that cannot become a session, or a name already taken all stop here with
 * a sentence. The one thing this must never do is half-connect: a recorded
 * folder for an agent with no job is an agent the board believes in and launchd
 * has never heard of, so the record is rolled back if the job cannot be written.
 */
function connect(dir) {
  const create = require('./create');
  const store = require('./store');

  const given = String(dir == null ? '' : dir);
  if (!given || !path.isAbsolute(given)) {
    return { ok: false, because: 'that is not a folder on this computer' };
  }
  let st;
  /* `lstat`, so a link is refused rather than followed -- the escape this module
     family has shipped six times. */
  try { st = fs.lstatSync(given); } catch { return { ok: false, because: 'that folder is not there any more' }; }
  if (!st.isDirectory()) return { ok: false, because: 'that is not a folder' };

  let text;
  try { text = fs.readFileSync(path.join(given, 'CLAUDE.md'), 'utf8').slice(0, 4000); }
  catch { return { ok: false, because: 'that folder has no instructions in it, so there is no agent to connect' }; }
  const id = status.identityFromText(text);
  if (!id || !id.displayName) {
    return { ok: false, because: 'those instructions do not say who the agent is, so we cannot bring it in' };
  }

  /* 🔑 THE FOLDER'S OWN NAME IS THE AGENT'S NAME, not the display name from the
     file. It is what tmux and launchd will carry, it is already unique on this
     machine by virtue of being a directory, and it is what its owner has been
     calling it. A display name like "Casey Jones" is not a session name and
     inventing a slug from it would give the same agent two names on day one. */
  const name = path.basename(given);
  if (!create.nameUsable(name)) {
    return { ok: false, because: 'that folder\u2019s name cannot be used as an agent name' };
  }

  if (create.hasJob(name)) {
    return { ok: false, because: 'Kosmos already looks after an agent by that name' };
  }
  /* 🛑 AND NOT WHEN SOMETHING IS ALREADY RUNNING UNDER THAT NAME (#362). The
     add installs a job and starts it; on a folder whose agent is already up,
     started some other way, that is a second Claude in the same worker folder.
     Same test the found list uses, so the two cannot disagree. A roster we
     could not read refuses too: starting blind is the failure, not the
     refusal. */
  const running = runningUnderName(name);
  if (running === undefined) {
    return { ok: false, because: 'we could not check what is running on this computer, so we did not start it' };
  }
  if (running) {
    return { ok: false, because: 'an agent is already running under that name, started some other way. Kosmos will not start a second one' };
  }

  /* ⚠️ THE RECORD GOES FIRST, because `installJob` resolves the folder through
     it -- without it the job would be written for `<workers>/<name>`, which is
     not where this agent lives. */
  let before = {};
  try { before = store.readProfile(name); } catch { before = {}; }
  if (before && before.dir && before.dir !== given) {
    return { ok: false, because: 'an agent by that name is already connected to a different folder' };
  }
  try { store.writeProfile(name, { dir: given, displayName: id.displayName }); }
  catch { return { ok: false, because: 'we could not record where that agent lives' }; }

  const job = create.installJob(name, {});
  if (!job.ok) {
    /* Rolled back to what was there before, so a failed connect leaves nothing
       claiming an agent exists. */
    try { store.writeProfile(name, { dir: before.dir || null, displayName: before.displayName || null }); }
    catch { /* the job is the thing that matters and it was not written */ }
    return { ok: false, because: job.because || 'we could not set it up to run' };
  }

  return { ok: true, name, displayName: id.displayName, dir: given, started: job.started === true };
}

/**
 * Undo a connect.
 *
 * 🛑 IT REFUSES ANYTHING KOSMOS MADE ITSELF, and that guard is the whole reason
 * this is a separate verb. "Undo" on a row somebody just pressed and "remove the
 * agent I built here" are the same machine operation and completely different
 * acts, and the only thing telling them apart is whether the agent's folder was
 * recorded -- which only a connect does.
 *
 * 🔑 THE TEARDOWN IS `removal.remove`, NOT A COPY OF IT. That path already boots
 * the job out in the right order, refuses to kill a session it cannot prove is
 * ours, re-checks that the session really went, and never touches the folder.
 * Six of the defects this codebase has paid for were a second copy of a guarded
 * sequence with fewer guards; this is not going to be the seventh.
 *
 * ⚠️ WHAT IT LEAVES BEHIND, said rather than discovered: the agent lands on the
 * removed list, because that is what `remove` records. For an undone misclick
 * that is slightly more ceremony than the act deserved, and it is the honest
 * trade against reimplementing the teardown. Their folder, their instructions
 * and anything they had running before are untouched.
 */
function disconnect(name) {
  const create = require('./create');
  const store = require('./store');
  const removal = require('./remove');

  const key = String(name == null ? '' : name);
  if (!create.nameUsable(key)) return { ok: false, because: 'that is not an agent we can act on' };

  let profile = {};
  try { profile = store.readProfile(key) || {}; } catch { profile = {}; }
  if (!profile.dir) {
    /* ⚠️ TWO DIFFERENT REFUSALS, because they send a person to two different
       places. An agent Kosmos built has a page with a Remove on it. A name we
       have no record of adding has nothing to undo, and telling somebody it was
       "made in Kosmos" about an agent they made themselves is a false sentence
       in the one message meant to explain what happened. */
    if (create.hasJob(key)) {
      return { ok: false,
        because: 'that agent was made in Kosmos, so this is not an undo. Remove it from its own page.' };
    }
    return { ok: false,
      because: 'we have no record of adding that agent, so there is nothing to undo' };
  }

  /* Captured BEFORE the teardown, because whether the file was one Kosmos wrote
     is the thing that decides if this may delete it. */
  let job = null;
  try { job = removal.jobFor(key); } catch { job = null; }

  let out;
  try { out = removal.remove(key); }
  catch { return { ok: false, because: 'we could not undo that' }; }
  if (out && out.outcome === removal.OUTCOME.REFUSED) {
    return { ok: false, because: out.because || 'we could not undo that' };
  }
  const stopped = !(out && out.outcome === removal.OUTCOME.PARTIAL);

  /* 🛑 AND THE JOB FILE GOES, which `remove` deliberately leaves behind (its
     Restore button re-enables that label, so it needs the file). An undo has no
     Restore: the person is putting the machine back the way it was, and before
     the add there was no file. Leaving it would make the row un-re-addable --
     `connect` refuses a name that already has a job, so the next press would
     answer "Kosmos already looks after an agent by that name" about an agent
     they had just taken away.
     ⚠️ ONLY WHEN THE TEARDOWN FULLY LANDED, and only a file we wrote. Deleting
     the plist out from under a job launchd still has loaded leaves a live job
     with nothing on disk to disable, which is worse than the state it fixes. */
  if (stopped && job && job.ours && job.plist) {
    try { fs.rmSync(job.plist, { force: true }); } catch { /* best effort: the record and the profile are what matter */ }
  }

  /* 🛑 AND THE REMOVAL RECORD GOES TOO. `remove` files one, and the board hides
     every name on that list -- so without this, pressing Undo and then Add again
     succeeds at every step and produces no agent. Not `restore`, which would put
     back the launch job this just took away on purpose. */
  const cleared = removal.forget(key);

  /* ⚠️ THE FOLDER RECORD IS CLEARED LAST, and only after the job is gone.
     Clearing it first would leave `workerDir` pointing at the derived folder
     while a live launch job still names theirs -- an agent whose files and whose
     job disagree about where it lives. */
  try { store.writeProfile(key, { dir: null }); }
  catch { return { ok: false, because: 'we undid it, but could not forget where it lived' }; }

  const partial = !stopped || !cleared;
  return {
    ok: true,
    name: key,
    partial,
    /* Says which half fell short rather than one sentence for both: a session we
       could not stop and a list we could not edit need different actions. */
    because: !cleared
      ? 'we undid it, but could not take it off the removed list, so it may stay hidden'
      : (out && out.because) || '',
    /* Carried, not dropped: a dry run must not reach a screen looking like work.
       See `markDryRun` in the removal engine. */
    dryRun: out && out.dryRun === true,
  };
}

module.exports = { alreadyIn,
  runningUnderName, found, connect, disconnect };
