'use strict';

/**
 * Which of your agents will still be here after you restart the computer.
 *
 * 🛑 THE ANSWER WAS NOT AVAILABLE ANYWHERE, and on Josh's machine it was one
 * out of sixteen. Measured 2026-08-22, after the first real reboot:
 *
 *   ~/work/workers/          16 folders
 *   ~/Library/LaunchAgents/   1 job      com.kosmos.agent.anna
 *   tmux ls                   1 session  anna
 *
 * ⚠️ AN AGENT WITH NO JOB IS NOT BROKEN AND DOES NOT LOOK BROKEN. It runs, it
 * answers, it draws exactly the same card as a registered one. The difference
 * only appears at the next login, and by then the session that was holding it
 * up is gone. **Nobody could have found this out except by restarting**, which
 * is how Josh found it out.
 *
 * ⚠️ WHAT IS NOT AT RISK, because it changes how urgent this is rather than how
 * serious: nothing was deleted. The folders, the instructions, the history and
 * the profiles are all on disk. These agents are STOPPED and UNREGISTERED, not
 * lost, and nothing decays while somebody works out what to do.
 *
 * 🔑 THE ROSTER COMES FROM WHAT KOSMOS ITSELF WROTE, never from "there is a
 * folder here". `~/work/workers` is a plain directory a person may keep their
 * own things in — on this fleet's own Mac it holds worker checkouts that are
 * not Kosmos agents at all — and writing launchd jobs for whatever is sitting
 * in it would start strangers' processes at every login. A profile under the
 * product's own data directory is a record only this product writes, so it is
 * the evidence used, and the failure direction is to do nothing.
 */

const fs = require('node:fs');
const path = require('node:path');
const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const store = require('./store');

/**
 * What this agent is called by the person who made it.
 *
 * 🛑 THE PANEL PRINTED THE MACHINE NAME, and Josh met it head on: the list read
 * `ava, bob, brigitte…` while his board showed **Ava**, **Brigitte** and
 * **Scarlett**. The same agents, in two vocabularies, on one screen. He
 * reasonably read it as Scarlett being missing from a list she was in.
 *
 * 🔑 THE RULE THIS BREAKS IS ALREADY WRITTEN DOWN, in `create.js`: act on the
 * machine name, speak the display name. Every value this module ACTS on stays
 * the slug; this is only for the sentence.
 *
 * ⚠️ THROUGH `status.readIdentity`, which is the board's own reader, so a name
 * cannot differ between the card and the panel that names the card. It prefers
 * the stored record over the instruction file, handles the overrides, and falls
 * back to the slug — three behaviours a local `readProfile().displayName` would
 * have to grow one at a time, wrongly, in a second place.
 */
function shownName(name) {
  try {
    const id = status.readIdentity(name);
    const shown = id && typeof id.displayName === 'string' ? id.displayName.trim() : '';
    return shown || name;
  } catch {
    /* A name we cannot look up is still a name. The slug is what the machine
       calls it, which is worse to read and never wrong. */
    return name;
  }
}

/** Names Kosmos has written a profile for: its own record that an agent exists. */
function known() {
  let files;
  try { files = fs.readdirSync(store.PROFILES); } catch (err) {
    /* ⚠️ "NOTHING HAS EVER BEEN WRITTEN" IS NOT "WE COULD NOT LOOK", and this
       module would have shipped saying the second on every fresh machine: the
       directory does not exist until the first profile is written. That is the
       exact distinction the rest of this product is built on, inverted, in the
       one place where the wrong answer is a permanent alarming sentence on a
       board that has no agents to be alarmed about. */
    if (err && err.code === 'ENOENT') return { ok: true, names: [] };
    return { ok: false, names: [] };
  }
  const names = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    /* ⚠️ Filtered through `create.NAME_RE`, the writer's own rule, and NOT
       through `slugFor`: that only lowercases, so `..json` would round-trip
       unchanged and `..` is a path, not a name. A profile file whose name does
       not survive the rule is not something we can build a job from, and
       guessing at what it was meant to be is how a job ends up pointing into
       a folder belonging to something else. */
    .filter((n) => create.NAME_RE.test(n));
  return { ok: true, names: names.sort() };
}

/**
 * Every agent Kosmos knows about, and whether it survives a restart.
 *
 * ⚠️ THREE SEPARATE FACTS PER AGENT, deliberately not collapsed into a verdict.
 * A folder with no job is recoverable; a job with no folder is a job that fails
 * every thirty seconds forever; and a removed agent is neither, it is somebody's
 * decision. A single "healthy" boolean would hide which of the three you have.
 */
/**
 * The names holding a folder or a startup job ON DISK with no profile
 * behind them (#500). The survey enumerates from profiles, so without
 * this walk a profile-less leftover is not merely stale in the roster,
 * it is absent from the enumeration entirely, while create.js still
 * refuses its name: the name is unusable and nothing on any screen says
 * why.
 *
 * ⚠️ FAIL SOFT TO NOTHING, per root. An unreadable stray sweep must not
 * take the profile-backed roster down with it; contributing nothing
 * leaves exactly the blindness the product has today, which is the
 * inert direction. ENOENT is a fresh machine, not an error.
 *
 * ⚠️ THE ROOTS THEMSELVES, not workerDir(): that helper consults
 * recorded folders and would resolve a recorded name right out of the
 * root being walked. And names are gated through `create.NAME_RE`, the
 * writer's own rule, same as known() gates profile files.
 *
 * ⚠️ KNOWN LIMIT, deliberate: on the default case-insensitive macOS
 * filesystem a case-variant directory ("Casey") makes create's
 * existsSync refusal fire for "casey" while failing NAME_RE here, so
 * that hostage class stays invisible. Surfacing it under the slug would
 * draw a row whose removal then refuses (remove acts by EXACT spelling,
 * existsExactly, and rightly so), and a row whose control cannot work
 * is worse than the blindness. The class belongs to #514, where a
 * delete that names exact spellings can carry it.
 *
 * 🛑 A FOLDER IS OURS ONLY IF THE BIRTH RECORD SAYS SO. The workers root
 * is a plain directory: on this fleet's own Mac it holds worker
 * checkouts that are not Kosmos agents at all, and a walk that showed
 * every directory would put a Remove control under each of them. The
 * roster-from-records ruling stands; what #500 adds is the one case the
 * records DO vouch for with the state gone: `created.jsonl` is the
 * append-only receipt that answers "did Kosmos ever create this name"
 * after every deletable file is deleted (#157), and #170 put the id on
 * that line for exactly this kind of reconciliation. A `created` or
 * `partial` line is the tie; a stranger's checkout has none. A plist in
 * OUR label namespace (com.kosmos.agent.*) is ours by construction and
 * needs no second witness.
 */
/* A root that has never been written is an empty contribution, the same
   split known() makes: ENOENT is a fresh machine, anything else is
   could-not-look and sets the failed flag. */
function readRoot(dir) {
  try { return fs.readdirSync(dir); }
  catch (err) { if (err && err.code === 'ENOENT') return []; throw err; }
}

function strays(profileNames) {
  let failed = false;
  const have = new Set(profileNames);
  const born = new Map();
  try {
    for (const e of create.createdLog()) {
      if (e.outcome === create.OUTCOME.CREATED || e.outcome === create.OUTCOME.PARTIAL) {
        /* ⚠️ THE SLUG, not the name as typed: the birth line records the
           spelling the person used ("Casey"), the folder is made under
           slugFor ("casey"), and the tie must speak the folder's own
           language or capitalized creations never match their remains.
           The value is the LATEST such line's time: a line vouches for
           the folder its creation made, not for the name forever, so a
           directory that appeared long after every line (a checkout
           dropped under a once-used name) is not what any line made. */
        const slug = create.slugFor(String(e.name || ''));
        const at = Date.parse(e.at || '') || 0;
        if (!born.has(slug) || born.get(slug) < at) born.set(slug, at);
      }
    }
  } catch { /* no receipts, no folder ties; jobs still speak for themselves */ }
  const found = new Map();
  const note = (name, what) => {
    if (have.has(name) || !create.NAME_RE.test(name)) return;
    const cur = found.get(name) || { folder: false, job: false };
    cur[what] = true;
    found.set(name, cur);
  };
  try {
    for (const d of readRoot(create.WORKERS_DIR)) {
      try {
        if (!born.has(d)) continue;
        const st = fs.statSync(path.join(create.WORKERS_DIR, d));
        /* A day of slack covers clock skew and a slow creation; a
           directory born long after every line for its name is a later
           tenant, not the remains the line vouched for. birthtimeMs is
           0 on filesystems that cannot answer, and 0 passes: absence of
           the witness must not hide a genuine stray. */
        const bound = born.get(d) + 24 * 60 * 60 * 1000;
        if (st.isDirectory() && (st.birthtimeMs || 0) <= bound) note(d, 'folder');
      } catch { /* a vanished entry is not a stray */ }
    }
  } catch (err) { failed = failed || (err && err.code !== 'ENOENT'); }
  try {
    for (const f of readRoot(create.AGENTS_DIR)) {
      const m = /^com\.kosmos\.agent\.(.+)\.plist$/.exec(f);
      if (!m) continue;
      try {
        if (fs.statSync(path.join(create.AGENTS_DIR, f)).isFile()) note(m[1], 'job');
      } catch { /* a vanished entry is not a stray */ }
    }
  } catch (err) { failed = failed || (err && err.code !== 'ENOENT'); }
  /* found-nothing and could-not-look are different facts; the flag keeps
     the soft direction without manufacturing a confident absence. No
     screen reads it yet; #514's surface is where it lands. */
  return { found, failed };
}

function survey() {
  const k = known();
  const rem = remove.removedNames();
  if (!k.ok) {
    return { ok: false, because: 'we could not read what Kosmos knows about your agents', agents: [], missing: [] };
  }
  if (!rem.ok) {
    /* ⚠️ FAIL CLOSED. Without a readable removed list we cannot tell a
       forgotten agent from one somebody deliberately took off the board, and
       the wrong guess starts a process they stopped on purpose. */
    return { ok: false, because: 'we could not read which agents you have removed, so we are not going to change anything', agents: [], missing: [] };
  }
  const removed = new Set(rem.names);
  const agents = k.names.map((name) => ({
    name,
    /* ⚠️ ACT ON `name`, SPEAK `shownAs`. Both travel, and the caller must not
       have to choose: the panel printed the machine name and Josh read
       `ava, bob, brigitte` beside cards saying Ava, Brigitte and Scarlett. */
    shownAs: shownName(name),
    removed: removed.has(name),
    folder: fs.existsSync(create.workerDir(name)),
    job: fs.existsSync(create.plistPath(name)),
    /* #500: whether a profile stands behind the name. The stray rows
       below carry false, and everything that ACTS on a name (repair's
       `missing` here, and nothing else today) must require true. */
    profile: true,
  }));
  /* #500: what the disk holds that no profile accounts for. */
  const sweep = strays(k.names);
  for (const [name, on] of sweep.found) {
    agents.push({
      name,
      shownAs: shownName(name),
      removed: removed.has(name),
      folder: on.folder,
      job: on.job,
      profile: false,
    });
  }
  return {
    ok: true,
    because: null,
    straySweepFailed: sweep.failed,
    agents,
    /* The ones a repair would act on: known, not removed, on disk, no job.
       Machine names, because this is the list a repair ACTS on; the sentence
       naming them reads `shownAs` off `agents`.
       ⚠️ AND PROFILE-BACKED ONLY (#500). A stray folder with no profile
       must never be "repaired" into a launchd job: repair would resurrect
       an agent nobody registered, from nothing but a directory name. */
    missing: agents.filter((x) => !x.removed && x.folder && !x.job && x.profile).map((x) => x.name),
  };
}

/**
 * Give every agent that is missing one the job it never got.
 *
 * ⚠️ IT REPORTS PER AGENT AND NEVER IN AGGREGATE. "12 agents repaired" over a
 * run where three of them could not be started is the shape of sentence this
 * product keeps removing: the person needs to know WHICH, because the ones that
 * did not start are the ones they will go looking for.
 *
 * ⚠️ `model` is what the caller could read of what each agent last ran as, and
 * it is a live reading rather than a stored choice — the model an agent was
 * SET to run on lived only in the job that does not exist. Passing nothing is
 * honest and lands the agent on Claude's own default; what must not happen is
 * a sentence claiming we restored a choice we never had.
 */
function repair(opts) {
  const seen = survey();
  if (!seen.ok) return { ok: false, because: seen.because, results: [] };
  const modelFor = (opts && typeof opts.modelFor === 'function') ? opts.modelFor : () => null;
  const results = seen.missing.map((name) => {
    let model = null;
    /* A model we cannot read is not a reason to leave the agent unregistered.
       An agent that comes back on the default model is recoverable in one
       click; an agent that does not come back at all is not. */
    try { model = modelFor(name) || null; } catch { model = null; }
    const r = create.installJob(name, { model });
    return { name, shownAs: shownName(name), ...r };
  });
  return {
    ok: true,
    because: null,
    results,
    /* Counts for a headline, beside the list rather than instead of it. */
    installed: results.filter((r) => r.ok).length,
    started: results.filter((r) => r.ok && r.started).length,
  };
}

module.exports = { known, survey, repair };
