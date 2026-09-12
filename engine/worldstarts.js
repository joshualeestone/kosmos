'use strict';

/**
 * Pausing a Kosmos's agents on a world switch, and bringing them back when that
 * Kosmos is opened again (#1704, plan world-agents-1704 section 4).
 *
 * Josh's decision: the switch dialog ASKS EACH TIME. "Keep them running" changes
 * nothing here. "Pause this Kosmos's agents" stops them, remembers them, and
 * starts them again the next time the board boots into this Kosmos.
 *
 * 🔑 THE RECORD LIVES IN THE BOOTED WORLD'S STORE, `<store.ROOT>/world-starts.json`.
 * At pause time the booted world is the one being LEFT; at boot time it is the
 * one being OPENED. So one path serves both halves, with no cross-world path
 * arithmetic, and each Kosmos only ever resumes its own agents.
 *
 * 🔑 A PAUSE IS NOT A REMOVAL. It reuses remove.js's per-platform acts (the job's
 * disable/stop and the session end, in that order), and never writes the removed
 * list, so a paused agent is never shown or treated as removed. Disable is the part
 * that makes a pause stick: without it the logon trigger (RunAtLoad on a Mac) would
 * start the agent again while another Kosmos is the one showing.
 *
 * ⚠️ WRITE-AHEAD. An agent's entry is written BEFORE anything is stopped, so there
 * is no instant at which an agent is stopped and nothing remembers to start it.
 * An entry comes back out only for an agent that is provably still set to start on
 * its own.
 *
 * ⚠️ GATED BY LIVE EXECUTION HERE, not only below. `engine/win32job.js` shells
 * schtasks without consulting the gate, so this module checks
 * `liveExecutionAllowed()` itself before it touches any job.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const remove = require('./remove');
const create = require('./create');
const win32job = require('./win32job');
const disruption = require('./disruption');
const liveExec = require('./live-execution');

/** Where the record lives: the booted world's store (see the header). */
const RECORD_FILE = path.join(store.ROOT, 'world-starts.json');

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

/** Why an entry is in the record. PR4 adds 'imported'; only 'paused' is acted on here. */
const WHY_PAUSED = 'paused';

/**
 * The disruption cause written while an agent is taken down or brought back.
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
 * A pause-specific cause and its board copy are a separate card.
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
 * started from an empty list after a failed read would drop every OTHER paused
 * agent, and those are then never started again -- so writers refuse instead.
 */
function readRecordForWrite() {
  let raw;
  try {
    raw = fs.readFileSync(RECORD_FILE, 'utf8');
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
function writeRecord(entries) {
  fs.mkdirSync(path.dirname(RECORD_FILE), { recursive: true });
  const tmp = `${RECORD_FILE}.${process.pid}.new`;
  fs.writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, RECORD_FILE);
}

/* ── the gate ────────────────────────────────────────────────────────────── */

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
  return {
    because: 'Kosmos is not allowed to start or stop agents from here, so nothing was changed',
    detail,
  };
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
 * Is this agent's launch job ALREADY switched off -- a half-finished removal, or
 * switched off by hand in Login Items / Task Scheduler? Such an agent is not
 * paused and not recorded: a record would make the resume switch it back on and
 * start it, overriding somebody else's choice. (Review round 1; the alternative,
 * recording it as "was off" and leaving it off at resume, writes an entry nothing
 * acts on.)
 * Mac: launchd's per-user overrides, one probe for the fleet
 * (`create.disabledJobs`, passed in as `macOff`). Windows: the task's own state.
 * Both fail soft to "not off", which pauses it -- the behaviour before this check.
 */
function switchedOffOnMac(platform) { return platform === 'win32' ? null : create.disabledJobs(); }
function jobIsSwitchedOff(name, platform, macOff) {
  if (platform === 'win32') {
    const st = win32job.status(name);
    return st.registered === true && st.enabled === false;
  }
  return macOff.has(name);
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
    /* `ours === false` is remove.jobFor's `com.<name>.discord` candidate: a
       launchd job some other tool wrote. Pausing it would disable a job we did
       not write, and this Kosmos's boot would then start it again on its behalf. */
    if (!job || job.ours === false) {
      notPaused.push({ name: c.name, because: `${c.name} was not started by Kosmos, so we could not pause it and it keeps running` });
      continue;
    }
    if (!heldForRetry.has(c.name) && jobIsSwitchedOff(c.name, platform, macOff)) {
      // An earlier pause of this same Kosmos (a board that could not restart
      // itself, paused twice): it IS paused, and its entry stands as written.
      if (alreadyPaused.has(c.name)) paused.push(c.name);
      else notPaused.push({ name: c.name, because: `${c.name} was already switched off, so we left it off` });
      continue;
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

/* ── resume ──────────────────────────────────────────────────────────────── */

/**
 * Start again the paused agents of the booted Kosmos, optionally only `onlyNames`.
 *
 * `opts.spawnRefusal` is server.js's `namedWorldSpawnRefusal`, passed IN rather
 * than re-derived here: "may agents start in the booted world" has one answer
 * (#2849), and while it refuses, every entry is held with its sentence so the
 * agents come back at the first boot after the rule is lifted.
 *
 * Returns `{resumed: [names], held: [{name, because}], cleared: [names]}`.
 * `cleared` names removed agents, whose entries are dropped because the removal
 * now owns them (restore re-enables them).
 */
function resumeEntries(onlyNames, opts = {}) {
  const platform = platformFor(opts);
  const resumed = [];
  const held = [];
  const cleared = [];

  const existing = readRecordForWrite();
  if (existing === UNREADABLE) {
    return { resumed, held, cleared, because: 'we could not read the list of paused agents' };
  }
  const targets = existing.filter((e) => e.why === WHY_PAUSED && (!onlyNames || onlyNames.has(e.name)));
  /* Before the gate and the refusal: no paused agents is the normal case, and it
     must cost nothing and say nothing. */
  if (targets.length === 0) return { resumed, held, cleared };

  let entries = existing;
  const writeBack = () => {
    try {
      writeRecord(entries);
    } catch (err) {
      process.stderr.write(`Kosmos could not update its list of paused agents (${(err && err.code) || 'unknown'}); an agent already started may be started again at the next boot.\n`);
    }
  };

  const refused = typeof opts.spawnRefusal === 'function' ? opts.spawnRefusal() : null;
  if (refused) {
    const because = String(refused.error || 'agents cannot start in this Kosmos yet');
    const names = new Set(targets.map((t) => t.name));
    entries = entries.map((e) => (names.has(e.name) ? { ...e, because } : e));
    for (const t of targets) held.push({ name: t.name, because });
    writeBack();
    return { resumed, held, cleared };
  }

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
    if (!job) {
      because = `we could not find how Kosmos starts ${t.name}`;
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
    disruption.begin(t.name, DISRUPTION_CAUSE);
    entries = entries.filter((e) => e.name !== t.name);
    resumed.push(t.name);
  }
  writeBack();
  return { resumed, held, cleared };
}

/** Every paused agent of the booted Kosmos. */
function resumePaused(opts) { return resumeEntries(null, opts); }

/**
 * Only these names: the switch route's rollback, undoing its own pause when the
 * switch itself then failed. The board is still serving the Kosmos those agents
 * were running in a moment ago, so it is an undo rather than a start.
 */
function resumeNames(names, opts) { return resumeEntries(new Set(names || []), opts); }

/**
 * The boot half: called once the real board is listening, after live execution
 * is armed. Says on stderr what it could not do, since a boot has nobody watching.
 */
function drainAtBoot(opts) {
  const result = resumePaused(opts);
  if (result.because) process.stderr.write(`Kosmos could not bring back this Kosmos's paused agents: ${result.because}.\n`);
  if (result.resumed.length) process.stdout.write(`Kosmos started ${result.resumed.length} paused agent(s) again: ${result.resumed.join(', ')}\n`);
  if (result.held.length) {
    process.stderr.write(`Kosmos left ${result.held.length} paused agent(s) off for now. First: ${result.held[0].name} - ${result.held[0].because}\n`);
  }
  return result;
}

module.exports = {
  AGENT_CHOICES,
  DEFAULT_AGENT_CHOICE,
  RECORD_FILE,
  pauseForSwitch,
  resumePaused,
  resumeNames,
  drainAtBoot,
  setPlatformForTests,
};
