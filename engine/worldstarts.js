'use strict';

/**
 * Starting a Kosmos's agents when that Kosmos is opened: the ones a world switch
 * PAUSED (#1704, plan world-agents-1704 section 4) and the ones an import COPIED in
 * (#1704 PR4, section 6). One record, one resume, two reasons.
 *
 * Josh's decision: the switch dialog ASKS EACH TIME. "Keep them running" changes
 * nothing here. "Pause this Kosmos's agents" stops them, remembers them, and
 * starts them again the next time the board boots into this Kosmos. And an agent
 * imported into a Kosmos "runs when its Kosmos is opened": at once if that Kosmos
 * is the one open, otherwise when its board next boots.
 *
 * 🔑 THE RECORD LIVES IN THE STORE OF THE KOSMOS WHOSE AGENTS IT NAMES,
 * `<store>/world-starts.json`. At pause time the booted world is the one being
 * LEFT; at boot time it is the one being OPENED; so those two use `store.ROOT`. An
 * import writes into the TARGET Kosmos's store (`recordFileIn`), which is
 * `store.ROOT` itself when the target is the open one. Each Kosmos only ever starts
 * its own agents.
 *
 * 🔑 A PAUSE IS NOT A REMOVAL. It reuses remove.js's per-platform acts (the job's
 * disable/stop and the session end, in that order), and never writes the removed
 * list, so a paused agent is never shown or treated as removed. Disable is the part
 * that makes a pause stick: without it the logon trigger (RunAtLoad on a Mac) would
 * start the agent again while another Kosmos is the one showing.
 *
 * 🔑 AN IMPORTED AGENT HAS NO JOB YET. Its start is `create.installJob` (the same
 * door "Set them to start at login" and a connected folder go through), handed the
 * runner, model and account read from the SOURCE Kosmos's job at import time and
 * kept on the entry, because the target has no job to read them from. A Claude
 * folder is trusted first, exactly as createAgent trusts the folder it makes: the
 * copy's folder is new, and nothing on the Mac adopt path answers that prompt.
 *
 * ⚠️ WRITE-AHEAD. An agent's entry is written BEFORE anything is stopped, so there
 * is no instant at which an agent is stopped and nothing remembers to start it.
 * An entry comes back out only for an agent that is provably still set to start on
 * its own, or has been started.
 *
 * ⚠️ GATED BY LIVE EXECUTION HERE, not only below. `engine/win32job.js` shells
 * schtasks without consulting the gate, so this module checks
 * `liveExecutionAllowed()` itself before it touches any job, folder trust or start.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const remove = require('./remove');
const create = require('./create');
const win32job = require('./win32job');
const disruption = require('./disruption');
const liveExec = require('./live-execution');

/** The record's file name, inside the store of the Kosmos it belongs to. */
const RECORD_FILENAME = 'world-starts.json';

/** The record of the Kosmos whose store is `storeRoot` (see the header). */
function recordFileIn(storeRoot) { return path.join(storeRoot, RECORD_FILENAME); }

/** The booted world's own record. */
const RECORD_FILE = recordFileIn(store.ROOT);

/**
 * The two answers the switch dialog offers, as the route accepts them. The route
 * and the page both key on these; the route validates against this object.
 */
const AGENT_CHOICES = Object.freeze({ PAUSE: 'pause', KEEP: 'keep' });

/**
 * What a switch request that does not say means. `keep` is the behaviour every
 * switch had before the choice existed, so a page loaded before this change
 * switches exactly as it always did.
 */
const DEFAULT_AGENT_CHOICE = AGENT_CHOICES.KEEP;

/** Why an entry is in the record: a switch paused it, or an import copied it in. */
const WHY_PAUSED = 'paused';
const WHY_IMPORTED = 'imported';
const EVERY_WHY = new Set([WHY_PAUSED, WHY_IMPORTED]);

/**
 * The disruption cause written while a PAUSED agent is taken down or brought back.
 * `disruption.CAUSES` has no pause cause, and an unknown cause is stored as
 * 'restart' anyway, which the board renders as "Restarting".
 * ⚠️ THAT LABEL IS NOT ALWAYS TRUE, and the gaps are stated rather than hidden:
 *  - true at a boot resume, and during a switch whose board restarts itself (the
 *    page reloads onto the other Kosmos within seconds);
 *  - NOT true on a board that cannot restart itself: the paused agents of the
 *    Kosmos being left read "Restarting" for up to `disruption.WINDOW_MS` (180s)
 *    although nothing brings them back until that Kosmos is opened again;
 *  - NOT true of a resume of an agent that was in fact still running (an entry
 *    left behind when a record write failed): it paints "Restarting" briefly
 *    over a running agent.
 * A pause-specific cause and its board copy are a separate card. An IMPORTED
 * agent's first start is not a restart, so it writes none.
 */
const DISRUPTION_CAUSE = 'restart';

/** Sentinel: the record is there and could not be read. NOT the same as absent. */
const UNREADABLE = Symbol('world-starts-unreadable');

/* Test seam: which platform's acts to use when a caller does not say. The route
   never passes one, so the route test states the Mac arm through this and drives
   it with remove.setRunner from any host. */
let platformOverride = null;
function setPlatformForTests(platform) { platformOverride = platform || null; }
function platformFor(opts) { return (opts && opts.platform) || platformOverride || process.platform; }

/* ── the record ──────────────────────────────────────────────────────────── */

/**
 * The entries, keeping "we could not read it" as its own answer. A writer that
 * started from an empty list after a failed read would drop every OTHER recorded
 * agent, and those are then never started again -- so writers refuse instead.
 */
function readRecordForWrite(file = RECORD_FILE) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    return UNREADABLE;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return UNREADABLE;
    return parsed.entries.filter((e) => e && typeof e.name === 'string' && e.name);
  } catch {
    return UNREADABLE;
  }
}

/** Written beside and renamed, so a reader never sees half a record. */
function writeRecord(entries, file = RECORD_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.new`;
  fs.writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * #1704 PR4: note that an agent just copied into the Kosmos whose store is
 * `storeRoot` should start when that Kosmos is opened. `entry` is `{name, from,
 * runner, model, configDir}`: the launch spec read from the source's job, which
 * the target has no other way to learn. An earlier entry of the same name is
 * replaced (an import is refused on a name already in the target, so that is only
 * ever a leftover). Returns `{ok: true}` or `{ok: false, because}`; the importer
 * takes the copy back out on a refusal, so no agent is ever copied in with nothing
 * set to start it.
 */
function recordImport(storeRoot, entry) {
  const file = recordFileIn(storeRoot);
  const existing = readRecordForWrite(file);
  if (existing === UNREADABLE) {
    return { ok: false, code: 'UNREADABLE', because: 'we could not read the list of agents waiting to start there' };
  }
  const next = { name: entry.name, why: WHY_IMPORTED, at: new Date().toISOString(), from: entry.from, runner: entry.runner };
  if (entry.model) next.model = entry.model;
  if (entry.configDir) next.configDir = entry.configDir;
  try {
    writeRecord(existing.filter((e) => e.name !== entry.name).concat([next]), file);
  } catch (err) {
    return { ok: false, code: (err && err.code) || 'unknown', because: `we could not note that it should start there (${(err && err.code) || 'unknown'})` };
  }
  return { ok: true };
}

/**
 * Review round 3 (10): take these names off the booted Kosmos's list of agents to
 * start -- called by remove.js when an agent is removed, so a removed agent is not
 * listed as waiting and a restore cannot start it on the strength of an old entry.
 * An unreadable list is left alone: the start pass still skips removed names.
 */
function forgetEntries(names) {
  const drop = new Set(names || []);
  const existing = readRecordForWrite();
  if (existing === UNREADABLE || !existing.some((e) => drop.has(e.name))) return;
  writeRecord(existing.filter((e) => !drop.has(e.name)));
}

/**
 * The imported agents of the Kosmos whose store is `storeRoot` that have not
 * started yet, `[{name, because}]`, where `because` is the plain sentence of why
 * one is still waiting (null when it has simply not been opened since). The
 * settings pane shows these, so an import into a Kosmos whose agents may not run
 * yet stays visibly waiting rather than silently absent. An unreadable record
 * lists none: this is a display, not an act.
 */
/* world-guard-lift-1704: the sentences a pre-lift board wrote on the starts it HELD
   because a named Kosmos could not run agents. That rule is gone, so an entry still
   carrying one is simply waiting for its Kosmos to open: it is read with no reason,
   and its next start attempt (the boot, or a no-op switch) rewrites or clears it. */
const PRE_LIFT_HOLD_SENTENCES = Object.freeze([
  'Agents do not run in a named Kosmos yet',
  'Kosmos is running a named world, which does not run agents yet',
]);
function reasonStillTrue(because) {
  if (typeof because !== 'string' || !because) return null;
  return PRE_LIFT_HOLD_SENTENCES.some((s) => because.startsWith(s)) ? null : because;
}

function importsWaitingIn(storeRoot) {
  const got = readRecordForWrite(recordFileIn(storeRoot));
  if (got === UNREADABLE) return [];
  /* Review round 3 (10): an agent the person removed there is not waiting for
     anything, whatever its entry says; the start pass drops it. */
  const removed = remove.removedNamesIn(storeRoot);
  const gone = new Set(removed.ok ? removed.names : []);
  return got.filter((e) => e.why === WHY_IMPORTED && !gone.has(e.name))
    .map((e) => ({ name: e.name, because: reasonStillTrue(e.because) }));
}

/* ── the gate ────────────────────────────────────────────────────────────── */

/* What a person is told when live execution refuses, per act. A resume's refusal
   must not say "nothing was changed": an imported agent's copy is already in
   place, and it is only the START that did not happen. */
const GATE_REFUSALS = Object.freeze({
  pause: 'Kosmos is not allowed to start or stop agents from here, so nothing was changed',
  resume: 'Kosmos is not allowed to start agents from here, so it has not been started yet',
});

/**
 * Null when live execution is armed; otherwise the refusal, with nothing done.
 *
 * `refuseOrWarn` warns on stderr in production and THROWS in a test process. The
 * throw exists to stop a test believing a fiction; this module does not fake
 * success either way, so the throw's message is carried on the refusal (as
 * `detail`) rather than unwinding the switch route that called us.
 */
function liveExecutionRefusal(action, names) {
  if (liveExec.liveExecutionAllowed()) return null;
  let detail = 'live execution is not armed in this process';
  try {
    liveExec.refuseOrWarn('engine/worldstarts.js', action, names);
  } catch (err) {
    detail = String((err && err.message) || err);
  }
  return { because: GATE_REFUSALS[action] || GATE_REFUSALS.resume, detail };
}

/** Runs one platform act; a throw is a failed act, never an unwound caller. */
function actSucceeded(act) {
  try {
    return act() !== false;
  } catch {
    return false;
  }
}

/**
 * What state is this agent's launch job in -- 'off', 'on', or 'unknown'?
 *   'off'     ALREADY switched off: a half-finished removal, or switched off by hand
 *             in Login Items / Task Scheduler. Such an agent is not paused and not
 *             recorded: a record would make the resume switch it back on and start it,
 *             overriding somebody else's choice. (Review round 1; the alternative,
 *             recording it as "was off" and leaving it off at resume, writes an entry
 *             nothing acts on.)
 *   'on'      live, or not ours to judge: pause it, the behaviour before this check.
 *   'unknown' we could not read its state. #2977: the old code FAILED SOFT to "not off"
 *             here ("A look that fails is still 'not off', as it always was"), which
 *             pauses-and-records the agent -- and the matching resume then switches an
 *             OFF agent ON, overriding the person's choice, on the narrow window where
 *             the read fails (Windows: jobFor's LIST read succeeds, then taskEnabled's
 *             XML read fails ~20ms later). 'unknown' is now its own answer and the
 *             caller LEAVES the agent exactly as it is: not paused, not recorded. An off
 *             agent stays off; an on agent keeps running through the switch. Not-pausing
 *             an on agent is the lesser harm than switching an off one on.
 * Mac: launchd's per-user overrides, one probe for the fleet (`create.disabledJobsResult`,
 * passed in as `macOff`; its `ok:false` IS the unknown). Windows: the task's own
 * definition via `win32job.taskEnabled`, whose `known:false` IS the unknown (its XML
 * read would not answer, or the definition was not a shape it could read).
 * Both answer for THIS Kosmos only: `disabledJobs` names this world's agents, and the
 * task name is this world's key.
 */
function switchedOffOnMac(platform) { return platform === 'win32' ? null : create.disabledJobsResult(); }
function jobSwitchState(name, platform, macOff) {
  if (platform === 'win32') {
    /* The task's own definition, not the LIST text (win32-agent-job-read round 2):
       a pause decides from this, and the LIST text calls an agent named
       `disabled-bot` switched off and every task on a non-English Windows on. */
    const st = win32job.taskEnabled(name);
    if (st.known === false) return 'unknown';
    return (st.registered === true && st.enabled === false) ? 'off' : 'on';
  }
  if (!macOff || macOff.ok === false) return 'unknown';
  return macOff.jobs.has(name) ? 'off' : 'on';
}

/* ── pause ───────────────────────────────────────────────────────────────── */

/**
 * Pause the agents of the Kosmos being left.
 *
 * `agents` is `[{name, session, tied}]`: the board's machine name, the session the
 * roster tied to it (null when it is not running), and whether the roster could
 * tie that session to the name at all.
 *
 * Returns `{paused: [names], notPaused: [{name, because}], stoppedNow: [names],
 * refused?}`. Every agent in `notPaused` is still running, or was never ours to
 * stop. `paused` includes agents an earlier pause of this Kosmos already stopped;
 * `stoppedNow` is only what this call stopped, which is all an undo may start.
 */
function pauseForSwitch(agents, opts = {}) {
  const platform = platformFor(opts);
  const paused = [];
  /* Only what THIS call stopped (review round 3). `paused` also names agents an
     earlier pause of this Kosmos already stopped, and a caller undoing THIS call
     (the switch route's rollback) must not start those. */
  const stoppedNow = [];
  const notPaused = [];
  const candidates = [];

  for (const agent of agents || []) {
    const name = String((agent && agent.name) || '');
    if (!agent || !agent.tied) {
      notPaused.push({ name, because: `something is running under ${name}'s name and we cannot confirm it is this agent, so we left it running` });
      continue;
    }
    const unsafe = remove.unsafeToActOn(name);
    if (unsafe) { notPaused.push({ name, because: unsafe }); continue; }
    candidates.push({ name, session: agent.session || null });
  }
  if (candidates.length === 0) return { paused, notPaused, stoppedNow };

  const refusal = liveExecutionRefusal('pause', candidates.map((c) => c.name));
  if (refusal) {
    for (const c of candidates) notPaused.push({ name: c.name, because: refusal.because });
    return { paused, notPaused, stoppedNow, refused: refusal.detail };
  }

  /* Read before anything is decided: it is the base of the write-ahead below, and
     it tells an agent THIS Kosmos already paused (switched off by us) from one
     somebody else switched off. */
  const existing = readRecordForWrite();
  if (existing === UNREADABLE) {
    for (const c of candidates) notPaused.push({ name: c.name, because: 'we could not read the list of paused agents, so nothing was paused' });
    return { paused, notPaused, stoppedNow };
  }
  /* Review round 2: an entry carrying a `because` is HELD FOR RETRY, not a confirmed
     pause -- its stop failed and so did the undo, so the agent is switched off but
     may still be running. It skips the switched-off check below (which would call
     it paused, or "already switched off") and takes the normal path: a fresh stop,
     with the write-ahead rewriting its entry without the old `because`, which the
     outcome of that attempt then sets again or clears. */
  const pausedEntries = existing.filter((e) => e.why === WHY_PAUSED);
  const heldForRetry = new Set(pausedEntries.filter((e) => e.because).map((e) => e.name));
  const alreadyPaused = new Set(pausedEntries.filter((e) => !e.because).map((e) => e.name));
  const macOff = switchedOffOnMac(platform);

  const withJobs = [];
  for (const c of candidates) {
    let job = null;
    try { job = remove.jobFor(c.name, platform); } catch { job = null; }
    /* `ours === false` is remove.jobFor's legacy `com.<name>.discord` candidate,
       which jobFor offers in Kosmos 1 only: a launchd job some other tool wrote.
       Pausing it would disable a job we did not write, and this Kosmos's boot
       would then start it again on its behalf. */
    if (!job || job.ours === false) {
      notPaused.push({ name: c.name, because: `${c.name} was not started by Kosmos, so we could not pause it and it keeps running` });
      continue;
    }
    if (!heldForRetry.has(c.name)) {
      const sw = jobSwitchState(c.name, platform, macOff);
      if (sw === 'unknown') {
        // #2977: we could not read whether it was switched on, so we must not guess.
        // Leave it exactly as it is -- neither paused nor recorded -- so the matching
        // resume cannot switch an already-off agent on. An on agent keeps running
        // through the switch, which is the lesser harm.
        notPaused.push({ name: c.name, because: `we could not tell whether ${c.name} was switched on, so we left it as it was` });
        continue;
      }
      if (sw === 'off') {
        // An earlier pause of this same Kosmos (a board that could not restart
        // itself, paused twice): it IS paused, and its entry stands as written.
        if (alreadyPaused.has(c.name)) paused.push(c.name);
        else notPaused.push({ name: c.name, because: `${c.name} was already switched off, so we left it off` });
        continue;
      }
    }
    withJobs.push({ ...c, job });
  }
  if (withJobs.length === 0) return { paused, notPaused, stoppedNow };

  /* Write-ahead: every agent about to be stopped is on record first. */
  const pausing = new Set(withJobs.map((c) => c.name));
  const at = new Date().toISOString();
  let entries = existing.filter((e) => !pausing.has(e.name))
    .concat(withJobs.map((c) => ({ name: c.name, why: WHY_PAUSED, at })));
  try {
    writeRecord(entries);
  } catch (err) {
    for (const c of withJobs) notPaused.push({ name: c.name, because: `we could not write down which agents were paused (${(err && err.code) || 'unknown'}), so nothing was paused` });
    return { paused, notPaused, stoppedNow };
  }

  const ops = remove.jobOps(platform);
  const sessions = remove.sessionOps(platform);
  const dropEntry = (name) => { entries = entries.filter((e) => e.name !== name); };
  const noteEntry = (name, because) => { entries = entries.map((e) => (e.name === name ? { ...e, because } : e)); };

  for (const c of withJobs) {
    /* Disable FIRST: a login between the stop and the disable would bring it back
       (remove.js documents the same window). */
    if (!actSucceeded(() => ops.disable(c.name, c.job))) {
      if (heldForRetry.has(c.name)) {
        /* Review round 3: a HELD entry's job is already switched off (the earlier
           undo failed), so a failed disable changed nothing -- it is still off.
           Put its earlier entry back, `because` and all, so the next boot still
           sets it to start; dropping it would leave it off at every login. */
        const prior = existing.find((e) => e.name === c.name);
        entries = entries.map((e) => (e.name === c.name ? prior : e));
        notPaused.push({ name: c.name, because: `we could not stop ${c.name}, so it keeps running` });
        continue;
      }
      dropEntry(c.name);
      notPaused.push({ name: c.name, because: `we could not stop ${c.name} from starting on its own, so it keeps running` });
      continue;
    }
    disruption.begin(c.name, DISRUPTION_CAUSE);
    const stopped = actSucceeded(() => ops.stopNow(c.name, c.job))
      && (!c.session || actSucceeded(() => sessions.end(c.session)));
    if (stopped) { paused.push(c.name); stoppedNow.push(c.name); continue; }

    /* Still running, and now set not to start on its own. Put that back; if even
       that fails the entry stays, so the next boot of this Kosmos sets it to
       start again rather than leaving it off at every login from now on. */
    disruption.clear(c.name);
    if (actSucceeded(() => ops.enable(c.name, c.job))) {
      dropEntry(c.name);
    } else {
      noteEntry(c.name, 'it could not be stopped, and could not be set to start on its own again; this Kosmos does that when it next opens');
    }
    notPaused.push({ name: c.name, because: `we could not stop ${c.name}, so it keeps running` });
  }

  try {
    writeRecord(entries);
  } catch (err) {
    /* The write-ahead record is still on disk, so an agent left running is also
       listed as paused. Its resume is then a re-enable and start of an agent
       that is already running, which also paints "Restarting" over it for a
       moment (see DISRUPTION_CAUSE). Said on stderr, since nobody else will see it. */
    process.stderr.write(`Kosmos paused ${paused.length} agent(s) but could not update its list of them (${(err && err.code) || 'unknown'}); the list may name agents that kept running.\n`);
  }
  return { paused, notPaused, stoppedNow };
}

/* ── start ───────────────────────────────────────────────────────────────── */

/**
 * The first start of an imported agent, which has no job yet: trust its folder
 * for Claude (createAgent's own call and arguments, #1629/#2129), then
 * `create.installJob` with the launch spec kept on the entry. Returns the sentence
 * of why it did not start, or null when it did. An installJob that registered
 * the job but could not start it now still leaves a job that starts at login, and
 * the entry stays so the next pass starts it through the enable-and-start path.
 */
function firstStartOfImport(entry, platform) {
  const runner = entry.runner === 'codex' ? 'codex' : 'claude';
  const configDir = typeof entry.configDir === 'string' && entry.configDir ? entry.configDir : null;
  if (runner !== 'codex') {
    try {
      require('./trust').trustFolder(create.workerDir(entry.name), { configDir, createIfAbsent: true, agentDefaultAccount: !configDir });
    } catch (err) {
      /* Not a failed start -- an agent that asks once is not one -- but SAID (review
         round 3, item 5), so a trust prompt that parks the agent can be traced to the
         write that failed. The code only: never the account folder. */
      process.stderr.write(`Kosmos could not pre-answer the folder-trust question for ${entry.name} (${(err && err.code) || 'unknown'}); it may ask once when it starts.\n`);
    }
  }
  let out;
  try {
    out = create.installJob(entry.name, {
      platform,
      ...(runner === 'codex' ? { runner: 'codex' } : {}),
      ...(entry.model ? { model: entry.model } : {}),
      ...(configDir ? { configDir } : {}),
    });
  } catch (err) {
    return `we could not set ${entry.name} up to start (${String((err && err.message) || err)})`;
  }
  if (!out || !out.ok) return `we could not set ${entry.name} up to start: ${(out && out.because) || 'no reason was given'}`;
  if (out.started === false) return `we could not start ${entry.name} now; it starts at your next login`;
  return null;
}

/**
 * Start the recorded agents of the booted Kosmos -- optionally only `onlyNames`,
 * and only entries whose reason is in `opts.whys` (default: every reason).
 *
 * Every act goes through the agent's world-keyed launch identity (remove.jobFor ->
 * create.serviceLabel / win32job.taskName), so a named Kosmos starts only its own.
 *
 * Returns `{resumed: [names], held: [{name, because}], cleared: [names]}`.
 * `cleared` names removed agents, whose entries are dropped and who are NOT
 * started. For a PAUSED agent the removal now owns it, and restore re-enables its
 * job. An IMPORTED agent never had a job, so restore has nothing to re-enable: it
 * stays copied and unstarted, which the importer refuses up front (a name on the
 * target's removed list is taken) and the import route reports when it happens
 * anyway -- a cleared import must never read as "Added".
 */
function resumeEntries(onlyNames, opts = {}) {
  const platform = platformFor(opts);
  const whys = opts.whys || EVERY_WHY;
  const resumed = [];
  const held = [];
  const cleared = [];

  const existing = readRecordForWrite();
  if (existing === UNREADABLE) {
    return { resumed, held, cleared, because: 'we could not read the list of agents waiting to start' };
  }
  const targets = existing.filter((e) => whys.has(e.why) && (!onlyNames || onlyNames.has(e.name)));
  /* Before the gate and the refusal: nothing waiting is the normal case, and it
     must cost nothing and say nothing. */
  if (targets.length === 0) return { resumed, held, cleared };

  let entries = existing;
  const writeBack = () => {
    try {
      writeRecord(entries);
    } catch (err) {
      process.stderr.write(`Kosmos could not update its list of agents waiting to start (${(err && err.code) || 'unknown'}); an agent already started may be started again at the next boot.\n`);
    }
  };

  const gate = liveExecutionRefusal('resume', targets.map((t) => t.name));
  if (gate) {
    for (const t of targets) held.push({ name: t.name, because: gate.because });
    return { resumed, held, cleared, refused: gate.detail };
  }

  /* The ACTING read of the removed list (remove.removedNames), not the fail-open
     query (isRemoved): an unreadable list answered "nothing is removed" there, and
     this would then start an agent the person had removed. So an unreadable list
     starts nothing, and every entry waits for the next pass. */
  const removed = remove.removedNames();
  if (!removed.ok) {
    const because = 'we could not read the list of removed agents, so we started none of them';
    for (const t of targets) held.push({ name: t.name, because });
    return { resumed, held, cleared, because };
  }
  const removedSet = new Set(removed.names);

  const ops = remove.jobOps(platform);
  for (const t of targets) {
    if (removedSet.has(t.name)) {
      entries = entries.filter((e) => e.name !== t.name);
      cleared.push(t.name);
      continue;
    }
    let job = null;
    try { job = remove.jobFor(t.name, platform); } catch { job = null; }
    let because = null;
    if (!job && t.why === WHY_IMPORTED) {
      because = firstStartOfImport(t, platform);
    } else if (!job) {
      because = `we could not find how Kosmos starts ${t.name}`;
    } else if (job.ours === false) {
      /* remove.jobFor's legacy `com.<name>.discord` candidate (Kosmos 1 only): a
         launchd job some other tool wrote. The pause never records one, so an
         entry meets it only if this agent's own plist went since; starting the
         other tool's job instead would be acting on its behalf. */
      because = `${t.name} is started by something other than Kosmos, so we left it alone`;
    } else if (!actSucceeded(() => ops.enable(t.name, job))) {
      because = `we could not set ${t.name} to start on its own again`;
    } else if (!actSucceeded(() => ops.startNow(t.name, job))) {
      because = `we could not start ${t.name} now; it starts at your next login`;
    }
    if (because) {
      entries = entries.map((e) => (e.name === t.name ? { ...e, because } : e));
      held.push({ name: t.name, because });
      continue;
    }
    if (t.why === WHY_PAUSED) disruption.begin(t.name, DISRUPTION_CAUSE);
    entries = entries.filter((e) => e.name !== t.name);
    resumed.push(t.name);
  }
  writeBack();
  return { resumed, held, cleared };
}

/** Every recorded agent of the booted Kosmos: paused ones and imported ones. */
function resumePaused(opts) { return resumeEntries(null, opts); }

/**
 * Only these PAUSED names: the switch route's rollback, undoing its own pause when
 * the switch itself then failed. The board is still serving the Kosmos those
 * agents were running in a moment ago, so it is an undo rather than a start.
 */
function resumeNames(names, opts) {
  return resumeEntries(new Set(names || []), { ...(opts || {}), whys: new Set([WHY_PAUSED]) });
}

/**
 * #1704 PR4: only these IMPORTED names, when they were just copied into the
 * Kosmos this board is serving ("if it is the one open, they start now"). The
 * same resume as a boot, with no gate beyond live execution (world-guard-lift-1704).
 */
function startImported(names, opts) {
  return resumeEntries(new Set(names || []), { ...(opts || {}), whys: new Set([WHY_IMPORTED]) });
}

/**
 * The boot half: called once the real board is listening, after live execution
 * is armed. Says on stderr what it could not do, since a boot has nobody watching.
 */
function drainAtBoot(opts) {
  const result = resumePaused(opts);
  if (result.because) process.stderr.write(`Kosmos could not start this Kosmos's waiting agents: ${result.because}.\n`);
  if (result.resumed.length) process.stdout.write(`Kosmos started ${result.resumed.length} waiting agent(s): ${result.resumed.join(', ')}\n`);
  if (result.held.length) {
    process.stderr.write(`Kosmos left ${result.held.length} agent(s) waiting for now. First: ${result.held[0].name} - ${result.held[0].because}\n`);
  }
  return result;
}

module.exports = {
  AGENT_CHOICES,
  DEFAULT_AGENT_CHOICE,
  RECORD_FILE,
  recordFileIn,
  recordImport,
  importsWaitingIn,
  forgetEntries,
  pauseForSwitch,
  resumePaused,
  resumeNames,
  startImported,
  drainAtBoot,
  setPlatformForTests,
};
