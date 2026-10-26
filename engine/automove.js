'use strict';
/**
 * kosmos#7152 slice 3: usage auto-balance on a timer. Each tick reads the cheap rows (no live check), runs slice 2's
 * decision (engine/autobalance.js), records it when it CHANGES, and, only when moves are switched on, makes the FIRST
 * move through the board's own account move (engine/accountmove.js), then watches whether the moved agent works.
 *
 * Plan: .claude/plans/automove-7152.md. The board wires it (server.js, the sweep beside slice 1's usage poll); every
 * effect is a dep, so a test drives it with no files but the record's.
 *
 * 🛑 ONE MOVE PER TICK, and none while any account move runs. The decision is made fresh every tick, so the target is
 * picked again before each move, and idleness is read again from a NEW roster just before the move (slice 2's roster
 * was a few seconds old by the time its answer was sent).
 *
 * THE RECORD: JSON lines in the board's data folder, newest last, at most KEEP_LINES. Agent names and account folders
 * and labels only: never an email, and never the move's own sentence (it can name the account by its email).
 */

const fs = require('node:fs');
const path = require('node:path');
const ab = require('./autobalance');

const FILE = 'autobalance-record.jsonl';
const KEEP_LINES = 500;
const RECENT = 10;
const WATCH_MS = 24 * 60 * 60 * 1000;      // a moved agent is watched for its first real call this long
const FAILED_HOLD_MS = 6 * 60 * 60 * 1000; // a target where an automatic move did not work is not used again this long

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
   file. Never throws: a record that cannot be written must not stop the sweep. */
function append(file, entry) {
  try {
    const lines = readLines(file);
    lines.push(entry);
    const keep = lines.slice(-KEEP_LINES);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, keep.map((l) => JSON.stringify(l)).join('\n') + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

/* The newest RECENT moves and decisions, newest first, for Settings. */
function recent(file, n = RECENT) {
  return readLines(file).filter((l) => l.kind === 'move' || l.kind === 'decision' || l.kind === 'works' || l.kind === 'skipped')
    .slice(-n).reverse();
}

/* What a decision is, for "has it changed": the moves, the held accounts and the accounts at risk. */
function keyOf(d) {
  return JSON.stringify({ m: d.moves.map((x) => [x.agent, x.from, x.to]), h: d.held.map((x) => x.from), r: d.atRisk.map((x) => [x.from, x.kind]) });
}

/**
 * One sweep's state: the last decision recorded, the moves being watched, the targets held after a failed move.
 * In memory: a restarted board records its first decision again (one line), and stops watching earlier moves (their
 * record keeps 'not-yet'; observed is in memory too, so a restarted board could not tell anyway).
 */
function create({ file }) {
  const state = { lastKey: null, watching: [], failed: new Map() };

  /* The works-again check: the first real call each moved agent makes after its move. */
  function check(deps, nowMs) {
    const still = [];
    for (const w of state.watching) {
      let seen = null;
      try { seen = deps.lastSeen(w.agent); } catch { seen = null; }
      if (seen && Number.isFinite(seen.at) && seen.at > w.movedAt) {
        const works = seen.outcome === 'ok' ? 'yes' : 'no';
        append(file, { kind: 'works', at: nowMs, agent: w.agent, from: w.from, to: w.to, fromLabel: w.fromLabel, toLabel: w.toLabel, works });
        if (works === 'no') state.failed.set(w.to, nowMs);
        continue;
      }
      if (nowMs - w.movedAt > WATCH_MS) {
        append(file, { kind: 'works', at: nowMs, agent: w.agent, from: w.from, to: w.to, fromLabel: w.fromLabel, toLabel: w.toLabel, works: 'not-seen' });
        continue;
      }
      still.push(w);
    }
    state.watching = still;
  }

  /**
   * deps: list() (accounts.list), readUsage(dir, nowMs), isRefusal(state), agentsOn(dir, isDefault), roster() (a NEW
   * board roster read, or null when it cannot be read), records() (every project), readCommitment(session),
   * settingOn() (true only when the switch reads on), movesOn() (moves switched on), accountBusy(), boardRestarting(),
   * startMove({ dir, names }) (accountmove.start with the board's deps), lastSeen(agent) ({ outcome, at } or null),
   * tell(agent, text), labelOf(dir); optional isGuide/guideName (movableFor's).
   * Resolves to what it did, for the log and tests: { did: 'off' | 'nothing' | 'recorded' | 'moved' | 'refused' |
   * 'skipped' | 'unreadable', ... }.
   */
  async function tick(deps, nowMs = Date.now()) {
    check(deps, nowMs);
    if (deps.settingOn() !== true) return { did: 'off' };
    let decision;
    let rows;
    try {
      rows = ab.rowsFromReadings({ list: deps.list(), readUsage: deps.readUsage, isRefusal: deps.isRefusal, agentsOn: deps.agentsOn, nowMs });
      const movableArgs = (cards) => ({ cards, records: deps.records, readCommitment: deps.readCommitment,
        ...(deps.isGuide ? { isGuide: deps.isGuide } : {}), ...(deps.guideName ? { guideName: deps.guideName } : {}) });
      const movable = ab.movableOnDemand(() => ab.movableFor(movableArgs(deps.roster())));
      decision = ab.decide({ rows, movable, nowMs });
      decision.recheck = () => ab.movableFor(movableArgs(deps.roster()));
    } catch { return { did: 'unreadable' }; }
    const label = (dir) => { try { return deps.labelOf(dir); } catch { return null; } };
    const live = deps.movesOn() === true;
    const key = keyOf(decision);
    let recorded = false;
    if (key !== state.lastKey) {
      state.lastKey = key;
      if (decision.moves.length || decision.held.length || decision.atRisk.length) {
        append(file, { kind: 'decision', at: nowMs, live,
          moves: decision.moves.map((m) => ({ agent: m.agent, from: m.from, to: m.to, fromLabel: label(m.from), toLabel: label(m.to), why: m.why })),
          held: decision.held.map((h) => ({ from: h.from, fromLabel: label(h.from), why: h.why })),
          atRisk: decision.atRisk.map((x) => ({ from: x.from, fromLabel: label(x.from), why: x.why, kind: x.kind })) });
        recorded = true;
      }
    }
    if (!live) return { did: recorded ? 'recorded' : 'nothing' };
    if (deps.accountBusy() || deps.boardRestarting()) return { did: 'nothing', because: 'busy' };
    const held = (dir) => state.failed.has(dir) && nowMs - state.failed.get(dir) < FAILED_HOLD_MS;
    const m = decision.moves.find((x) => !held(x.to));
    if (!m) return { did: recorded ? 'recorded' : 'nothing' };
    const fromLabel = label(m.from);
    const toLabel = label(m.to);
    /* Idle again, from a roster read now: an agent that took a turn since the decision is not moved. */
    let stillFree = false;
    try { stillFree = decision.recheck()(m.agent) === true; } catch { stillFree = false; }
    if (!stillFree) {
      append(file, { kind: 'skipped', at: nowMs, agent: m.agent, from: m.from, to: m.to, fromLabel, toLabel, because: 'it was no longer idle' });
      return { did: 'skipped', agent: m.agent };
    }
    let started;
    try { started = deps.startMove({ dir: m.to, names: [m.agent] }); } catch { started = null; }
    const first = started && started.body && Array.isArray(started.body.agents) ? started.body.agents[0] : null;
    if (!started || started.status !== 202 || !first || first.outcome === 'refused') {
      append(file, { kind: 'move', at: nowMs, agent: m.agent, from: m.from, to: m.to, fromLabel, toLabel, why: m.why, outcome: 'refused' });
      return { did: 'refused', agent: m.agent };
    }
    try { await started.done; } catch { /* the move's record says how it went */ }
    let outcome = 'partial';
    try {
      const after = deps.readMove ? deps.readMove(started.body.id) : null;
      const a = after && Array.isArray(after.agents) ? after.agents[0] : null;
      outcome = a && a.outcome === 'changed' ? 'changed' : 'partial';
    } catch { outcome = 'partial'; }
    const movedAt = Date.now();
    append(file, { kind: 'move', at: movedAt, agent: m.agent, from: m.from, to: m.to, fromLabel, toLabel, why: m.why, outcome });
    if (outcome === 'changed') {
      state.watching.push({ agent: m.agent, from: m.from, to: m.to, fromLabel, toLabel, movedAt });
      try {
        deps.tell(m.agent, `Kosmos moved this agent from ${fromLabel || 'its account'} to ${toLabel || 'another account'}, because ${m.why}.`);
      } catch { /* telling is best-effort; the record has it */ }
    }
    return { did: 'moved', agent: m.agent, outcome };
  }

  return { tick, check, state };
}

module.exports = { create, recent, append, readLines, movesOn, sweepOn, FILE, KEEP_LINES, RECENT, WATCH_MS, FAILED_HOLD_MS };
