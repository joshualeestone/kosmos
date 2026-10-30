'use strict';
/**
 * kosmos#7548 (#7152 slice 3b): usage auto-balance's MOVING half. The sweep (engine/autobalance-sweep.js) records what
 * Kosmos would move; this makes ONE such move per tick through the board's own account move (engine/accountmove.js),
 * then watches whether the moved agent works on its new account.
 *
 * 🛑 OFF UNLESS AGENT_WORKFORCE_AUTOMOVE=1 (the card's call, comment 6521685101): a day of recorded decisions never
 * exercised a move, so moving stays an operator's switch. AGENT_WORKFORCE_AUTOMOVE_OFF=1 is the brake. Both are read
 * from the board's environment, which does not change while it runs, so either takes effect at a board restart.
 *
 * Plan: .claude/plans/automove-3b-7548.md, with the twelve rules it must satisfy; each is named below where it lands.
 * The board wires it (server.js automoveDeps(), run after the sweep's tick); every effect is a dep, so a test drives
 * it with no files but the record's.
 *
 * ONE RECORD. Its lines go into the sweep's own record (FILE, readLines, appendAll are the sweep's), so a person reads
 * one history: the sweep's `decision` lines and this module's `move`, `works`, `skipped` and `released` lines, plus
 * the account-move routes' `person` lines (personMoved). Agent names, account folders and labels, and the decision's
 * own reason: never an email, and never the move's own sentence (it can name the account by its email).
 *
 * 🛑 THE DECISION IT ACTS ON IS ITS OWN. It runs decide() fresh, with skipTarget (held and unproven targets), so the
 * mover never picks a target it holds, and the sweep's record stays the rule Settings shows.
 *
 * ⚠️ WEAKEST PREMISE, unchanged: an agent at its prompt with a background SHELL job reads idle, and a restart kills the
 * job. Two idle ticks narrow it; they do not close it. That is why moves are off unless switched on.
 */

const ab = require('./autobalance');
const sweep = require('./autobalance-sweep');

const DAY_MS = 24 * 60 * 60 * 1000;
const WATCH_MS = DAY_MS;          // a moved agent is watched for its first real call this long
const FAILED_HOLD_MS = DAY_MS;    // rule 5: a target where a move did not work, or was not seen to, is not used again this long
const REST_MS = DAY_MS;           // rules 7 and 8: an agent a person moved or stopped, or Kosmos moved, is left alone this long
const REFUSED_HOLD_MS = 60 * 60 * 1000;   // an agent whose move was refused before its account was written: passed over this long
const REFUSED_TIMES = 3;          // refused this many times in a day, it is passed over for the day
/* Rule 2's "previous tick": the sweep's period is engine/usagepoll.js's POLL_MS (10 minutes), so a reading older than
   two and a half periods is not the previous tick's (review round 4: a tick hours late moved on one idle reading). */
const PREVIOUS_TICK_MS = 25 * 60 * 1000;
const SKIP_SAID_MS = 60 * 60 * 1000;   // a "no longer idle" line for one agent at most once an hour

function movesOn(env = process.env) { return env.AGENT_WORKFORCE_AUTOMOVE === '1' && env.AGENT_WORKFORCE_AUTOMOVE_OFF !== '1'; }

/**
 * Rule 7: a person's move wins for a day. The account-move routes call this for every agent whose account they wrote,
 * so the mover holds it: without it, a person's move left no trace the mover reads, and the next tick could undo it.
 * Never throws (the route's move is not this line); false when it could not be written. Writes nothing while moves are
 * off (review round 1): the mover is inert unless switched on, routes included. So a person's move made while moves are
 * off is not held once they are switched on; switching on is an operator's act and takes a board restart.
 */
function personMoved(file, names, to, nowMs = Date.now(), env = process.env) {
  if (!movesOn(env)) return true;
  let wrote = false;
  try {
    /* Trimmed as engine/create.js cleanName trims the routes' names, so the line names the agent the move did. */
    const agents = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string').map((n) => n.trim()).filter(Boolean);
    if (!agents.length) return true;
    wrote = sweep.appendAll(file, agents.map((agent) => ({ kind: 'person', at: nowMs, agent, ...(typeof to === 'string' ? { to } : {}) })));
  } catch { wrote = false; }
  /* Review round 2: a person's move the record could not keep is still a person's move. The mover cannot tell whose it
     was, so it moves nobody for a day (personMissedAt); the routes' own move is not refused for it. */
  if (!wrote) personMissedAt = nowMs;
  return wrote;
}
let personMissedAt = null;

/**
 * The mover's state, rebuilt from the record (rule 10: a board restarts several times a day): the moves being watched,
 * the held targets, the resting agents and the refusals. A `started` line with no ending is ended here as `unknown`
 * (the board stopped mid-move), stamped with the move's own time, and the agent rests and is watched. Throws when the
 * record cannot be read, so the board leaves the mover off rather than forgetting every hold.
 */
function create({ file, nowMs = Date.now() }) {
  const state = { lastMovable: new Set(), lastMovableAt: null, watching: [], failed: new Map(), resting: new Map(), refused: new Map(),
    refusedTimes: new Map(), skippedAt: new Map(), unrecordedAt: null };
  const watched = new Map();   // agent -> its watch, from its newest move, until a works or released line closes it
  const open = new Map();      // agent -> a 'started' line with no ending yet
  const rest = (agent, at) => { if (!state.resting.has(agent) || state.resting.get(agent) < at) state.resting.set(agent, at); };
  const refuse = (agent, at) => {
    state.refused.set(agent, at);
    /* Review round 3: each refusal's time, so the count is of the last day, not of the board's whole run. */
    state.refusedTimes.set(agent, [...(state.refusedTimes.get(agent) || []), at]);
  };
  for (const l of sweep.readLines(file)) {
    if (!Number.isFinite(l.at) || l.at > nowMs + sweep.CLOCK_SLACK_MS) continue;   // a line from the future is not trusted
    if (typeof l.agent !== 'string' || !l.agent) continue;   // decisions, and a line that names no agent
    const fresh = (ms) => nowMs - l.at < ms;
    if (l.kind === 'person' && fresh(REST_MS)) rest(l.agent, l.at);   // rule 7
    if (l.kind === 'works' && (l.works === 'no' || l.works === 'not-seen') && fresh(FAILED_HOLD_MS)) state.failed.set(l.to, l.at);
    if (l.kind === 'works' && l.works === 'no' && fresh(REST_MS)) rest(l.agent, l.at);
    if (l.kind === 'released' && fresh(REST_MS)) rest(l.agent, l.at);
    if (l.kind === 'move') {
      /* Rules 7 and 8: a person's Stop wins, and a moved agent rests, partial and unknown included. */
      if (l.outcome !== 'started' && l.outcome !== 'refused' && fresh(REST_MS)) rest(l.agent, l.at);
      if (l.outcome === 'refused' && fresh(DAY_MS)) refuse(l.agent, l.at);
      const movedAt = Number.isFinite(l.startedAt) ? Math.min(l.startedAt, l.at) : l.at;   // never later than the line itself
      if (l.outcome === 'started') open.set(l.agent, l); else open.delete(l.agent);
      if ((l.outcome === 'started' || l.outcome === 'changed' || l.outcome === 'unknown' || l.outcome === 'partial') && nowMs - movedAt <= WATCH_MS) {
        watched.set(l.agent, { agent: l.agent, from: l.from, to: l.to, fromLabel: l.fromLabel, toLabel: l.toLabel, movedAt, uncertain: l.outcome !== 'changed' });
      } else watched.delete(l.agent);
    }
    if (l.kind === 'works' || l.kind === 'released') watched.delete(l.agent);
  }
  for (const l of open.values()) {
    sweep.append(file, { kind: 'move', at: l.at, agent: l.agent, from: l.from, to: l.to, fromLabel: l.fromLabel, toLabel: l.toLabel, why: l.why,
      startedAt: l.startedAt, outcome: 'unknown', because: 'the board stopped before the move finished' });
    if (nowMs - l.at < REST_MS) rest(l.agent, l.at);
  }
  state.watching = [...watched.values()];

  /* Rule 7, while the board runs: the routes write `person` lines between ticks, so each tick reads them again. Throws
     when the record cannot be read: a mover that cannot see a person's move must not move. */
  function readPeople(nowMs) {
    for (const l of sweep.readLines(file)) {
      if (l.kind !== 'person' || typeof l.agent !== 'string' || !l.agent) continue;
      if (!Number.isFinite(l.at) || l.at > nowMs + sweep.CLOCK_SLACK_MS || nowMs - l.at >= REST_MS) continue;
      rest(l.agent, l.at);
    }
  }

  const line = (w, extra) => ({ at: extra.at, agent: w.agent, from: w.from, to: w.to, fromLabel: w.fromLabel, toLabel: w.toLabel, ...extra });

  /* The works-again check: the first real call each moved agent makes after its move. A watch whose agent is no longer
     on the account it was moved to (a person moved it) is closed with a `released` line and the agent rests. On a
     refused first call the target is held a day and the person is told in their thread with the agent (rule 5); Kosmos
     does not move it back (rule 4). */
  async function check(deps, nowMs) {
    const still = [];
    for (const w of state.watching) {
      let here = null;
      try { here = deps.agentsOn(w.to, deps.isDefaultDir ? deps.isDefaultDir(w.to) : false); } catch { here = null; }
      if (here && Array.isArray(here.names) && here.complete === true && !here.names.includes(w.agent)) {
        sweep.append(file, line(w, { kind: 'released', at: nowMs, because: 'it is no longer on the account Kosmos moved it to' }));
        rest(w.agent, nowMs);
        continue;
      }
      /* Rule 9: after a partial or unknown move the agent may still run on its OLD account (it lands at its next
         restart), and a sighting is keyed by agent alone, so it says nothing about the target until its session has
         restarted since the move. */
      /* Review round 1: a CHANGED move waits for the restart too, when the board can read a session's start. The account
         is written before the restart, so the OLD session's last call could otherwise read as the new account's first. */
      const restarts = typeof deps.sessionStart === 'function';
      if (restarts && !Number.isFinite(w.since)) {
        let s = null;
        try { s = await deps.sessionStart(w.agent); } catch { s = null; }
        /* tmux reads whole seconds: a restart in the move's own second reads as the start of that second. */
        if (Number.isFinite(s) && s >= Math.floor(w.movedAt / 1000) * 1000) { w.uncertain = false; w.since = s; }
      }
      let seen = null;
      if (restarts ? Number.isFinite(w.since) : !w.uncertain) { try { seen = deps.lastSeen(w.agent); } catch { seen = null; } }
      const after = Math.max(w.movedAt, Number.isFinite(w.since) ? w.since : 0);
      if (seen && Number.isFinite(seen.at) && seen.at > after) {
        const works = seen.outcome === 'ok' ? 'yes' : 'no';
        sweep.append(file, line(w, { kind: 'works', at: nowMs, works }));
        if (works === 'no') {
          state.failed.set(w.to, nowMs);
          rest(w.agent, nowMs);
          try {
            deps.tell(w.agent, `Kosmos moved this agent to ${w.toLabel || 'another account'}, and its first request there was refused. `
              + `Move it back in Settings, AI Models, if it needs to work now. Kosmos will not move agents to ${w.toLabel || 'that account'} for a day.`);
          } catch { /* telling is best-effort; the record and Settings have it */ }
        }
        continue;
      }
      if (nowMs - w.movedAt > WATCH_MS) {
        /* Not seen to work in a day is not proof that it works, so the target waits a day before the next one. */
        sweep.append(file, line(w, { kind: 'works', at: nowMs, works: 'not-seen' }));
        state.failed.set(w.to, nowMs);
        continue;
      }
      still.push(w);
    }
    state.watching = still;
  }

  const watch = (m, movedAt, uncertain) => {
    state.watching = state.watching.filter((w) => w.agent !== m.agent);   // one watch per agent
    state.watching.push({ agent: m.agent, from: m.from, to: m.to, fromLabel: m.fromLabel, toLabel: m.toLabel, movedAt, uncertain: uncertain === true });
  };

  /* One move through the board's account move (rule 1). Resolves to the line that ends it, or null for a 409. */
  async function move(deps, nowMs, m) {
    const movedAt = Date.now();   // before the move, so a first call made as the restart finishes counts
    const base = { kind: 'move', agent: m.agent, from: m.from, to: m.to, fromLabel: m.fromLabel, toLabel: m.toLabel, why: m.why, startedAt: movedAt };
    let started;
    try { started = deps.startMove({ dir: m.to, names: [m.agent] }); }
    catch (err) {
      /* Rule 11: accountmove says whether an account write had begun when it threw. Before it, nothing changed: a
         refusal. After it (or when it cannot say), the agent may be on its new account: unknown, rests, watched. */
      if (err && err.wroteAccount === false) {
        refuse(m.agent, nowMs);
        const refused = { ...base, at: nowMs, outcome: 'refused' };
        sweep.append(file, refused);
        return refused;
      }
      const unknown = { ...base, at: nowMs, outcome: 'unknown' };
      sweep.append(file, unknown);
      rest(m.agent, nowMs);
      watch(m, movedAt, true);
      return unknown;
    }
    /* A 409 is the board saying no move may start now: nothing about this agent, so no hold and no line. */
    if (started && started.status === 409) return null;
    const first = started && started.body && Array.isArray(started.body.agents) ? started.body.agents[0] : null;
    if (!started || started.status !== 202 || !first || first.outcome === 'refused') {
      refuse(m.agent, nowMs);
      const refused = { ...base, at: nowMs, outcome: 'refused' };
      sweep.append(file, refused);
      return refused;
    }
    /* Said BEFORE the restarts run, so a board that stops mid-move still knows, on its next start, that this agent may
       be on its new account (create() ends it as unknown and watches it). */
    /* Review round 4: a move whose lines the record did not keep is forgotten at a restart (its rest, its watch), so
       every move stops for a day, as for a person's move the record could not keep. */
    if (!sweep.append(file, { ...base, at: Date.now(), outcome: 'started' })) state.unrecordedAt = nowMs;
    try { await started.done; } catch { /* the move's record says how it went */ }
    let outcome = 'partial';
    try {
      const after = deps.readMove ? deps.readMove(started.body.id) : null;
      const a = after && Array.isArray(after.agents) ? after.agents[0] : null;
      outcome = a && (a.outcome === 'changed' || a.outcome === 'stopped') ? a.outcome : 'partial';   // a stop puts it back
    } catch { outcome = 'partial'; }
    const ended = { ...base, at: Date.now(), outcome };
    if (!sweep.append(file, ended)) state.unrecordedAt = nowMs;
    /* A partial move is saved on the target and lands there at its next restart, so it is watched (and the target
       unproven) too (rule 9). Rules 7 and 8: every ending rests the agent a day. */
    if (outcome === 'changed' || outcome === 'partial') watch(m, movedAt, outcome === 'partial');
    rest(m.agent, Date.now());
    if (outcome === 'changed') {
      try { deps.tell(m.agent, `Kosmos moved this agent from ${m.fromLabel || 'its account'} to ${m.toLabel || 'another account'}, because ${m.why}.`); }
      catch { /* telling is best-effort; the record has it */ }
    }
    return ended;
  }

  /**
   * deps: the sweep's (list, readUsage, agentsOn, roster, records, readCommitment, settingOn, labelOf, optional
   * sameLogin, isGuide, guideName), plus movesOn(), isDefaultDir(dir) (optional), freshRoster() (a NEW roster read, or
   * null), freshRecords() (a new read of every project), accountBusy(), boardRestarting(), startMove({ dir, names }),
   * readMove(id), lastSeen(agent) ({ outcome, at } or null), sessionStart(agent) (optional: its session's start, ms,
   * or null), tell(agent, text).
   * Resolves to { did: 'off' | 'nothing' | 'moved' | 'refused' | 'unknown' | 'skipped' | 'unreadable', ... }.
   */
  /* Review round 4: one tick at a time. A tick that ran past the board's backstop would otherwise run beside the next
     one, and check()'s rewrite of the watches would drop the watch a move had just added (rule 6). */
  let running = false;
  async function tick(deps, nowMs = Date.now()) {
    if (running) return { did: 'nothing', because: 'busy' };
    running = true;
    try { return await step(deps, nowMs); } finally { running = false; }
  }

  async function step(deps, nowMs) {
    if (deps.movesOn() !== true || deps.settingOn() !== true) { state.lastMovable = new Set(); return { did: 'off' }; }
    try { readPeople(nowMs); } catch (err) { state.lastMovable = new Set(); return { did: 'unreadable', because: `the record: ${String((err && err.message) || err)}` }; }
    if (Number.isFinite(state.unrecordedAt) && nowMs - state.unrecordedAt < REST_MS) {
      state.lastMovable = new Set();
      return { did: 'unreadable', because: 'a move the record could not keep, so Kosmos moves nobody for a day' };
    }
    if (Number.isFinite(personMissedAt) && nowMs - personMissedAt < REST_MS) {
      state.lastMovable = new Set();
      return { did: 'unreadable', because: 'a person\'s move could not be recorded, so Kosmos moves nobody for a day' };
    }
    await check(deps, nowMs);
    const heldTarget = (dir) => state.failed.has(dir) && nowMs - state.failed.get(dir) < FAILED_HOLD_MS;
    const unproven = (dir) => state.watching.some((w) => w.to === dir);   // rule 6
    const movableArgs = (cards, records, strict = false) => ({ cards, records: records || deps.records, readCommitment: deps.readCommitment, strict,
      ...(deps.isGuide ? { isGuide: deps.isGuide } : {}), ...(deps.guideName ? { guideName: deps.guideName } : {}) });
    let decision;
    try {
      const list = deps.list();
      if (ab.eligible((Array.isArray(list) ? list : []).map((a) => (a && !a.apiKey ? { provider: 'anthropic', dir: a.dir } : null))).length < 2) {
        state.lastMovable = new Set();
        return { did: 'nothing' };
      }
      const rows = ab.rowsFromReadings({ list, readUsage: deps.readUsage, agentsOn: deps.agentsOn, nowMs, ...(deps.sameLogin ? { sameLogin: deps.sameLogin } : {}) });
      const movable = ab.movableOnDemand(() => ab.movableFor(movableArgs(deps.roster())));
      decision = ab.decide({ rows, movable, nowMs, skipTarget: (dir) => heldTarget(dir) || unproven(dir) });
    } catch (err) { state.lastMovable = new Set(); return { did: 'unreadable', because: String((err && err.message) || err) }; }
    const label = (dir) => { try { return deps.labelOf(dir); } catch { return null; } };
    const kindOf = (dir) => (decision.atRisk.find((x) => x.from === dir) || {}).kind || null;
    const before = Number.isFinite(state.lastMovableAt) && nowMs - state.lastMovableAt <= PREVIOUS_TICK_MS ? state.lastMovable : new Set();
    state.lastMovable = new Set(decision.moves.map((x) => `${x.agent}\n${x.from}`));
    state.lastMovableAt = nowMs;
    if (deps.accountBusy() || deps.boardRestarting()) return { did: 'nothing', because: 'busy' };
    const passedOver = (agent) => {
      if (state.resting.has(agent) && nowMs - state.resting.get(agent) < REST_MS) return true;   // rules 7 and 8
      if (!state.refused.has(agent)) return false;
      const since = nowMs - state.refused.get(agent);
      const inDay = (state.refusedTimes.get(agent) || []).filter((t) => nowMs - t < DAY_MS).length;
      return inDay >= REFUSED_TIMES ? since < DAY_MS : since < REFUSED_HOLD_MS;
    };
    /* Rule 3: usage only. A move off an account whose login has stopped stays a would-move line in the sweep's record.
       Rule 2: movable on the previous tick too. Held and unproven targets are skipTarget's, inside decide(). */
    const next = decision.moves.find((x) => kindOf(x.from) === 'usage' && !passedOver(x.agent) && before.has(`${x.agent}\n${x.from}`));
    if (!next) return { did: 'nothing' };
    const m = { ...next, fromLabel: label(next.from), toLabel: label(next.to) };
    /* Rule 2: idleness read again from a NEW roster and NEW projects just before the move. Rule 12: only a re-check
       that answers "not free" is "no longer idle"; one that cannot be made (a roster or project that cannot be read, a
       check that throws) writes nothing and moves nothing. */
    let stillFree;
    try { stillFree = ab.movableFor(movableArgs(deps.freshRoster(), deps.freshRecords, true))(m.agent); }
    catch (err) { return { did: 'unreadable', because: `the re-check: ${String((err && err.message) || err)}` }; }
    if (stillFree !== true) {
      /* Review round 4: seen working, so this tick is not an idle one for rule 2. */
      state.lastMovable.delete(`${m.agent}\n${m.from}`);
      const said = state.skippedAt.get(m.agent);
      if (Number.isFinite(said) && nowMs - said < SKIP_SAID_MS) return { did: 'skipped', agent: m.agent };
      state.skippedAt.set(m.agent, nowMs);
      sweep.append(file, { kind: 'skipped', at: nowMs, agent: m.agent, from: m.from, to: m.to, fromLabel: m.fromLabel, toLabel: m.toLabel, because: 'it was no longer idle' });
      return { did: 'skipped', agent: m.agent };
    }
    /* Review round 2: a person can move the agent while this tick awaits (the session-start reads in check()), and the
       route writes its person line then. Read them again last, so the decision never undoes a move made meanwhile. */
    try { readPeople(nowMs); } catch (err) { return { did: 'unreadable', because: `the record: ${String((err && err.message) || err)}` }; }
    if (passedOver(m.agent)) return { did: 'nothing' };
    /* Review round 2: no move the record cannot keep. Without its lines a restart forgets the move, its rest and its
       watch (rules 8 and 10), so a record that cannot be written (a full disk, a read-only folder) moves nobody. */
    if (!sweep.appendAll(file, [])) return { did: 'unreadable', because: 'the record could not be written' };
    const ended = await move(deps, nowMs, m);
    if (!ended) return { did: 'nothing', because: 'busy' };
    return { did: ended.outcome === 'refused' ? 'refused' : ended.outcome === 'unknown' ? 'unknown' : 'moved', agent: m.agent, outcome: ended.outcome };
  }

  return { tick, check, state };
}

module.exports = { create, movesOn, personMoved, resetPersonMissedForTests: () => { personMissedAt = null; }, DAY_MS, WATCH_MS, FAILED_HOLD_MS, REST_MS, REFUSED_HOLD_MS, REFUSED_TIMES, PREVIOUS_TICK_MS, SKIP_SAID_MS };
