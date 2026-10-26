'use strict';
/**
 * kosmos#7152 slice 3: usage auto-balance on a timer. Each tick reads the cheap rows (no live check), runs slice 2's
 * decision (engine/autobalance.js), records it when it CHANGES, and, only when moves are switched on, makes ONE move
 * through the board's own account move (engine/accountmove.js), then watches whether the moved agent works.
 *
 * Plan: .claude/plans/automove-7152.md. The board wires it (server.js automoveDeps(), the sweep beside slice 1's usage
 * poll); every effect is a dep, so a test drives it with no files but the record's.
 *
 * 🛑 ONE MOVE PER TICK, and none while any account move runs. The decision is made fresh every tick, so the target is
 * picked again before each move. An agent is moved only when it was movable on the PREVIOUS tick too (review 2: one
 * idle reading is a moment), and idleness is read again from a NEW roster just before the move.
 *
 * 🛑 IT MOVES ONLY FOR USAGE. An account whose login has stopped is recorded (its would-move lines carry kind 'login', so
 * Settings can say they are not acted on) but never acted on, and an agent whose first request on its new account is
 * refused is NOT moved back: the target is held and the person is told (review 4: both moves needed an idle card, and a
 * refused agent's card reads auth_failed, so neither could have fired where it was needed; the plan says what replaces
 * them).
 *
 * 🛑 A PERSON'S MOVE WINS (review 6). An agent a person has moved off the account Kosmos put it on, or that Kosmos told
 * the person to move back, is left alone for a day: Kosmos never undoes a person's choice on the next tick.
 *
 * THE RECORD: JSON lines in the board's data folder, newest last, at most KEEP_LINES. Agent names, account folders and
 * labels, and the decision's own reason (percentages and hours, or "its login has stopped working"): never an email,
 * and never the move's own sentence (it can name the account by its email). The holds, the watch on each moved agent
 * and the last decision are rebuilt from it when the board starts, so a restart forgets none of them.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ab = require('./autobalance');

const FILE = 'autobalance-record.jsonl';
const KEEP_LINES = 500;
const RECENT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const WATCH_MS = DAY_MS;          // a moved agent is watched for its first real call this long
const FAILED_HOLD_MS = DAY_MS;    // a target where a move did not work, or was not seen to work in WATCH_MS, is not used again this long (review 4, 6)
const PERSON_HOLD_MS = DAY_MS;    // review 6: an agent a person moved, or was told to move, is left alone this long
const REFUSED_HOLD_MS = 60 * 60 * 1000;   // review 1: an agent whose move was refused is passed over this long, so it cannot block the rest
const REFUSED_TIMES = 3;          // review 6: refused this many times in a day, it is passed over for the day
const CLOCK_SLACK_MS = 60 * 1000; // review 4: a record line stamped further ahead than this is not trusted

/* Moves are the operator's to switch on for now (the plan's call): without AGENT_WORKFORCE_AUTOMOVE=1 every tick
   records "would move" only. AGENT_WORKFORCE_AUTOMOVE_OFF=1 is the brake on the whole sweep. */
function movesOn(env = process.env) { return env.AGENT_WORKFORCE_AUTOMOVE === '1' && env.AGENT_WORKFORCE_AUTOMOVE_OFF !== '1'; }
function sweepOn(env = process.env) { return env.AGENT_WORKFORCE_AUTOMOVE_OFF !== '1'; }

function readLines(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); if (j && typeof j === 'object') out.push(j); } catch { /* one bad line is skipped */ }
  }
  return out;
}

/* Append one entry, keeping the newest KEEP_LINES. Written whole and renamed into place, so a reader never sees half a
   file; the temp name is unique per write (review 4: two overlapping ticks of one process must not share it). Never
   throws: a record that cannot be written must not stop the sweep. */
function append(file, entry) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const lines = readLines(file);
    lines.push(entry);
    const keep = lines.slice(-KEEP_LINES);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, keep.map((l) => JSON.stringify(l)).join('\n') + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing left to remove */ }   // review 3
    return false;
  }
}

/* The newest RECENT entries Settings draws, newest first. Only entries the page draws a line for are counted (review 2
   and 4): a decision with no move in it draws nothing, and one made with moves on draws only its moves off a stopped
   login (review 5: never made, so said); a move that only started draws nothing (its ending line says how it went). */
function recent(file, n = RECENT) {
  return readLines(file).filter((l) => (l.kind === 'decision' && Array.isArray(l.moves) && l.moves.some((m) => !l.live || (m && m.kind === 'login')))
    || (l.kind === 'move' && l.outcome !== 'started') || l.kind === 'works' || l.kind === 'skipped' || l.kind === 'released')
    .slice(-n).reverse();
}

/* What a decision is, for "has it changed": the moves, the held accounts and the accounts at risk. Built from the
   decision or from its record line alike (review 6: so a restart does not record the same decision again). */
function keyOf(d) {
  const a = (x) => (Array.isArray(x) ? x : []);
  return JSON.stringify({ m: a(d.moves).map((x) => [x.agent, x.from, x.to]), h: a(d.held).map((x) => x.from), r: a(d.atRisk).map((x) => [x.from, x.kind]) });
}

/**
 * One sweep's state: the last decision recorded, the agents movable on the last tick, the moves being watched, and the
 * holds (targets after a failed move; agents after a refusal or a person's move). All but the movable set are rebuilt
 * from the record here (review 3: a board restarts several times a day). A rebuilt watch still works: observed starts
 * empty, and the first call it sees after the restart is after the move. A move whose line says only that it STARTED
 * (the board stopped before the restart finished) gets an 'unknown' ending written here (review 6), so Settings says
 * it, and is watched, since the agent may well be on its new account.
 */
function create({ file, nowMs = Date.now() }) {
  const state = { lastKey: null, lastMovable: new Set(), watching: [], failed: new Map(), refused: new Map(), refusedCount: new Map(), personHold: new Map() };
  const watched = new Map();   // agent -> its watch, from its newest forward move, until a works line closes it
  const open = new Map();      // agent -> a 'started' line with no ending yet
  for (const l of readLines(file)) {
    if (!Number.isFinite(l.at) || l.at > nowMs + CLOCK_SLACK_MS) continue;   // review 4: a line from the future is not trusted
    if (l.kind === 'decision') { state.lastKey = keyOf(l); continue; }
    if (typeof l.agent !== 'string' || !l.agent) continue;   // review 5: a line that names no agent
    const fresh = (ms) => nowMs - l.at < ms;
    if (l.kind === 'works' && (l.works === 'no' || l.works === 'not-seen') && fresh(FAILED_HOLD_MS)) state.failed.set(l.to, l.at);
    if (l.kind === 'works' && l.works === 'no' && fresh(PERSON_HOLD_MS)) state.personHold.set(l.agent, l.at);
    if (l.kind === 'released' && fresh(PERSON_HOLD_MS)) state.personHold.set(l.agent, l.at);
    if (l.kind === 'move' && (l.outcome === 'refused' || l.outcome === 'unknown') && fresh(DAY_MS)) {
      state.refused.set(l.agent, l.at);
      state.refusedCount.set(l.agent, (state.refusedCount.get(l.agent) || 0) + 1);
    }
    if (l.kind === 'move') {
      const movedAt = Number.isFinite(l.startedAt) ? Math.min(l.startedAt, l.at) : l.at;   // review 5: never later than the line itself
      if (l.outcome === 'started') open.set(l.agent, l); else open.delete(l.agent);
      /* Review 6: a partial move (saved on the target, lands there at its next restart) is watched too. */
      if ((l.outcome === 'started' || l.outcome === 'changed' || l.outcome === 'unknown' || l.outcome === 'partial') && nowMs - movedAt <= WATCH_MS) {
        watched.set(l.agent, { agent: l.agent, from: l.from, to: l.to, fromLabel: l.fromLabel, toLabel: l.toLabel, movedAt });
      } else watched.delete(l.agent);
    }
    if (l.kind === 'works' || l.kind === 'released') watched.delete(l.agent);
  }
  for (const l of open.values()) {
    append(file, { kind: 'move', at: nowMs, agent: l.agent, from: l.from, to: l.to, fromLabel: l.fromLabel, toLabel: l.toLabel, why: l.why,
      startedAt: l.startedAt, outcome: 'unknown', because: 'the board stopped before the move finished' });
  }
  state.watching = [...watched.values()];

  const holdPerson = (agent, nowMs) => state.personHold.set(agent, nowMs);

  /* The works-again check: the first real call each moved agent makes after its move. A watch whose agent is no longer
     on the account it was moved to (a person moved it) is closed with a 'released' line, and the agent is left alone for
     a day (review 6), so a later call is never blamed on that account and the person's choice is not undone. On a
     refused first call the target is held, and the agent's conversation says what happened and what to do: Kosmos does
     not move it back (see the header), and does not move it again for a day either. */
  function check(deps, nowMs) {
    const still = [];
    for (const w of state.watching) {
      let here = null;
      try { here = deps.agentsOn(w.to, deps.isDefaultDir ? deps.isDefaultDir(w.to) : false); } catch { here = null; }
      if (here && Array.isArray(here.names) && here.complete === true && !here.names.includes(w.agent)) {
        append(file, { kind: 'released', at: nowMs, agent: w.agent, from: w.from, to: w.to, fromLabel: w.fromLabel, toLabel: w.toLabel, because: 'it is no longer on the account Kosmos moved it to' });
        holdPerson(w.agent, nowMs);
        continue;
      }
      let seen = null;
      try { seen = deps.lastSeen(w.agent); } catch { seen = null; }
      if (seen && Number.isFinite(seen.at) && seen.at > w.movedAt) {
        const works = seen.outcome === 'ok' ? 'yes' : 'no';
        append(file, { kind: 'works', at: nowMs, agent: w.agent, from: w.from, to: w.to, fromLabel: w.fromLabel, toLabel: w.toLabel, works });
        if (works === 'no') {
          state.failed.set(w.to, nowMs);
          holdPerson(w.agent, nowMs);
          try {
            deps.tell(w.agent, `Kosmos moved this agent to ${w.toLabel || 'another account'}, and its first request there was refused. `
              + `Move it back in Settings, AI Models, if it needs to work now. Kosmos will not move agents to ${w.toLabel || 'that account'} for a day.`);
          } catch { /* telling is best-effort; the record and Settings have it */ }
        }
        continue;
      }
      if (nowMs - w.movedAt > WATCH_MS) {
        /* Review 6: not seen to work in a day is not proof that it works, so the target waits a day before the next one. */
        append(file, { kind: 'works', at: nowMs, agent: w.agent, from: w.from, to: w.to, fromLabel: w.fromLabel, toLabel: w.toLabel, works: 'not-seen' });
        state.failed.set(w.to, nowMs);
        continue;
      }
      still.push(w);
    }
    state.watching = still;
  }

  const watch = (m, movedAt) => {
    state.watching = state.watching.filter((w) => w.agent !== m.agent);   // review 4: one watch per agent
    state.watching.push({ agent: m.agent, from: m.from, to: m.to, fromLabel: m.fromLabel, toLabel: m.toLabel, movedAt });
  };
  const refuse = (agent, nowMs) => {
    state.refused.set(agent, nowMs);
    state.refusedCount.set(agent, (state.refusedCount.get(agent) || 0) + 1);
  };

  /* One move through the board's account move. Resolves to the line that ends it, or null for a 409. */
  async function move(deps, nowMs, m) {
    const movedAt = Date.now();   // review 2: before the move, so a first call made as the restart finishes counts
    const base = { kind: 'move', agent: m.agent, from: m.from, to: m.to, fromLabel: m.fromLabel, toLabel: m.toLabel, why: m.why, startedAt: movedAt };
    let started;
    try { started = deps.startMove({ dir: m.to, names: [m.agent] }); }
    catch {
      /* Review 5: the account move writes the account before anything else can throw, so a throw is NOT a refusal: the
         agent may be on its new account. Recorded as unknown, held like a refused agent, and watched. */
      const line = { ...base, at: nowMs, outcome: 'unknown' };
      append(file, line);
      refuse(m.agent, nowMs);
      watch(m, movedAt);
      return line;
    }
    /* Review 3: a 409 is the board saying no move may start now (one began since accountBusy() was asked, or the board
       is about to restart): nothing about this agent, so no hold and no line. */
    if (started && started.status === 409) return null;
    const first = started && started.body && Array.isArray(started.body.agents) ? started.body.agents[0] : null;
    if (!started || started.status !== 202 || !first || first.outcome === 'refused') {
      refuse(m.agent, nowMs);
      const line = { ...base, at: nowMs, outcome: 'refused' };
      append(file, line);
      return line;
    }
    /* Review 4: said BEFORE the restarts run, so a board that stops mid-move still knows, on its next start, that this
       agent may be on its new account (create() ends it as unknown and watches it). */
    append(file, { ...base, at: Date.now(), outcome: 'started' });
    try { await started.done; } catch { /* the move's record says how it went */ }
    let outcome = 'partial';
    try {
      const after = deps.readMove ? deps.readMove(started.body.id) : null;
      const a = after && Array.isArray(after.agents) ? after.agents[0] : null;
      outcome = a && (a.outcome === 'changed' || a.outcome === 'stopped') ? a.outcome : 'partial';   // review 2: a stop puts it back
    } catch { outcome = 'partial'; }
    const line = { ...base, at: Date.now(), outcome };
    append(file, line);
    /* Review 6: a partial move is saved on the target and lands there at its next restart, so it is watched (and the
       target unproven) too; only the person is not told it moved, since it has not yet. */
    if (outcome === 'changed' || outcome === 'partial') watch(m, movedAt);
    if (outcome === 'changed') {
      try { deps.tell(m.agent, `Kosmos moved this agent from ${m.fromLabel || 'its account'} to ${m.toLabel || 'another account'}, because ${m.why}.`); }
      catch { /* telling is best-effort; the record has it */ }
    }
    return line;
  }

  /**
   * deps: list() (accounts.list), readUsage(dir, nowMs), agentsOn(dir, isDefault), isDefaultDir(dir) (optional),
   * roster() (a NEW board roster read, or null when it cannot be read), records() (every project; may be cached for the
   * tick), freshRecords() (optional: a new read, for the re-check just before a move), readCommitment(session),
   * settingOn() (true only when the switch reads on), movesOn() (moves switched on), accountBusy(), boardRestarting(),
   * startMove({ dir, names }) (accountmove.start with the board's deps), readMove(id), lastSeen(agent) ({ outcome, at }
   * or null), tell(agent, text), labelOf(dir); optional isGuide/guideName (movableFor's).
   * Resolves to what it did, for the log and tests: { did: 'off' | 'nothing' | 'recorded' | 'moved' | 'refused' |
   * 'unknown' | 'skipped' | 'unreadable', ... }.
   */
  async function tick(deps, nowMs = Date.now()) {
    check(deps, nowMs);
    if (deps.settingOn() !== true) { state.lastMovable = new Set(); return { did: 'off' }; }
    const live = deps.movesOn() === true;
    /* Review 6: with moves on, a target the sweep holds (a failed move, or one moved there not yet seen to work) is left
       out of the decision itself, so the next-best account is chosen rather than nothing. */
    const heldTarget = (dir) => state.failed.has(dir) && nowMs - state.failed.get(dir) < FAILED_HOLD_MS;
    const unproven = (dir) => state.watching.some((w) => w.to === dir);
    const skipTarget = live ? (dir) => heldTarget(dir) || unproven(dir) : undefined;
    let decision;
    const movableArgs = (cards, records) => ({ cards, records: records || deps.records, readCommitment: deps.readCommitment,
      ...(deps.isGuide ? { isGuide: deps.isGuide } : {}), ...(deps.guideName ? { guideName: deps.guideName } : {}) });
    try {
      const list = deps.list();
      /* Review 3: fewer than two Claude subscription accounts (slice 2's eligible rule) is nothing to balance; stop
         before the agents walk. */
      if (ab.eligible((Array.isArray(list) ? list : []).map((a) => (a && !a.apiKey ? { provider: 'anthropic', dir: a.dir } : null))).length < 2) {
        state.lastMovable = new Set();
        return { did: 'nothing' };
      }
      const rows = ab.rowsFromReadings({ list, readUsage: deps.readUsage, agentsOn: deps.agentsOn, nowMs });
      const movable = ab.movableOnDemand(() => ab.movableFor(movableArgs(deps.roster())));
      decision = ab.decide({ rows, movable, nowMs, skipTarget });
    } catch { state.lastMovable = new Set(); return { did: 'unreadable' }; }
    /* Review 1: the re-check reads the projects again too (the tick's own read is cached for the decision). */
    const recheck = () => ab.movableFor(movableArgs(deps.roster(), deps.freshRecords));
    const label = (dir) => { try { return deps.labelOf(dir); } catch { return null; } };
    const kindOf = (dir) => (decision.atRisk.find((x) => x.from === dir) || {}).kind || null;
    const before = state.lastMovable;
    state.lastMovable = new Set(decision.moves.map((x) => `${x.agent}\n${x.from}`));
    const key = keyOf(decision);
    let recorded = false;
    if (key !== state.lastKey) {
      if (decision.moves.length || decision.held.length || decision.atRisk.length) {
        recorded = append(file, { kind: 'decision', at: nowMs, live,
          moves: decision.moves.map((m) => ({ agent: m.agent, from: m.from, to: m.to, fromLabel: label(m.from), toLabel: label(m.to), why: m.why, kind: kindOf(m.from) })),
          held: decision.held.map((h) => ({ from: h.from, fromLabel: label(h.from), why: h.why })),
          atRisk: decision.atRisk.map((x) => ({ from: x.from, fromLabel: label(x.from), why: x.why, kind: x.kind })) });
        if (recorded) state.lastKey = key;   // review 2: a write that failed is tried again next tick
      } else state.lastKey = key;
    }
    const quiet = { did: recorded ? 'recorded' : 'nothing' };
    if (!live) return quiet;
    if (deps.accountBusy() || deps.boardRestarting()) return { did: 'nothing', because: 'busy' };
    const passedOver = (agent) => {
      if (state.personHold.has(agent) && nowMs - state.personHold.get(agent) < PERSON_HOLD_MS) return true;   // review 6
      if (!state.refused.has(agent)) return false;
      const since = nowMs - state.refused.get(agent);
      return (state.refusedCount.get(agent) || 0) >= REFUSED_TIMES ? since < DAY_MS : since < REFUSED_HOLD_MS;   // review 6: backs off
    };
    /* Usage only (see the header): a move off an account whose login has stopped is recorded, never made. The target
       is already one the sweep does not hold (skipTarget above); the checks are kept here as well, as the last word. */
    const next = decision.moves.find((x) => kindOf(x.from) === 'usage' && !heldTarget(x.to) && !unproven(x.to) && !passedOver(x.agent) && before.has(`${x.agent}\n${x.from}`));
    if (!next) return quiet;
    const m = { ...next, fromLabel: label(next.from), toLabel: label(next.to) };
    /* Review 1: a roster that cannot be read now is not "no longer idle": nothing is moved and nothing recorded. */
    let freeNow;
    try { freeNow = recheck(); } catch { return { did: 'unreadable' }; }
    let stillFree = false;
    try { stillFree = freeNow(m.agent) === true; } catch { stillFree = false; }
    if (!stillFree) {
      append(file, { kind: 'skipped', at: nowMs, agent: m.agent, from: m.from, to: m.to, fromLabel: m.fromLabel, toLabel: m.toLabel, because: 'it was no longer idle' });
      return { did: 'skipped', agent: m.agent };
    }
    const line = await move(deps, nowMs, m);
    if (!line) return { did: 'nothing', because: 'busy' };
    return { did: line.outcome === 'refused' ? 'refused' : line.outcome === 'unknown' ? 'unknown' : 'moved', agent: m.agent, outcome: line.outcome };
  }

  return { tick, check, state };
}

module.exports = { create, recent, append, readLines, movesOn, sweepOn, FILE, KEEP_LINES, RECENT, WATCH_MS, FAILED_HOLD_MS, PERSON_HOLD_MS, REFUSED_HOLD_MS, REFUSED_TIMES, CLOCK_SLACK_MS };
