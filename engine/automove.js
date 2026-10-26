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
 * idle reading is a moment, and a pane at its prompt can still have a background job or a person's unsent words), and
 * idleness is read again from a NEW roster just before the move.
 *
 * THE RECORD: JSON lines in the board's data folder, newest last, at most KEEP_LINES. Agent names and account folders
 * and labels only: never an email, and never the move's own sentence (it can name the account by its email). The
 * holds below are rebuilt from it when the board starts, so a restart does not forget them (review 2).
 */

const fs = require('node:fs');
const path = require('node:path');
const ab = require('./autobalance');

const FILE = 'autobalance-record.jsonl';
const KEEP_LINES = 500;
const RECENT = 10;
const WATCH_MS = 24 * 60 * 60 * 1000;      // a moved agent is watched for its first real call this long
const FAILED_HOLD_MS = 6 * 60 * 60 * 1000; // a target where an automatic move did not work is not used again this long
const REFUSED_HOLD_MS = 60 * 60 * 1000;    // review 1: an agent whose move was refused is passed over this long, so it cannot block the rest

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

/* The newest RECENT entries Settings draws, newest first. A decision made with moves on is not drawn (its move lines
   say what happened), so it is not counted either (review 2). */
function recent(file, n = RECENT) {
  return readLines(file).filter((l) => (l.kind === 'decision' && !l.live) || l.kind === 'move' || l.kind === 'works' || l.kind === 'skipped')
    .slice(-n).reverse();
}

/* What a decision is, for "has it changed": the moves, the held accounts and the accounts at risk. */
function keyOf(d) {
  return JSON.stringify({ m: d.moves.map((x) => [x.agent, x.from, x.to]), h: d.held.map((x) => x.from), r: d.atRisk.map((x) => [x.from, x.kind]) });
}

/**
 * One sweep's state: the last decision recorded, the agents movable on the last tick, the moves being watched, the
 * moves back owed, and the targets and agents held after a failed or refused move. The holds are rebuilt from the
 * record here; the watch is not (observed is in memory too, so a restarted board could not tell how it went).
 */
function create({ file, nowMs = Date.now() }) {
  const state = { lastKey: null, lastMovable: new Set(), watching: [], back: [], failed: new Map(), refused: new Map() };
  for (const l of readLines(file)) {
    if (!Number.isFinite(l.at)) continue;
    if (l.kind === 'works' && l.works === 'no' && nowMs - l.at < FAILED_HOLD_MS) state.failed.set(l.to, l.at);
    if (l.kind === 'move' && l.outcome === 'refused' && nowMs - l.at < REFUSED_HOLD_MS) state.refused.set(l.agent, l.at);
  }

  /* The works-again check: the first real call each moved agent makes after its move. A refused one is moved back
     (review 2), unless the account it left had stopped working itself. */
  function check(deps, nowMs) {
    const still = [];
    for (const w of state.watching) {
      let seen = null;
      try { seen = deps.lastSeen(w.agent); } catch { seen = null; }
      if (seen && Number.isFinite(seen.at) && seen.at > w.movedAt) {
        const works = seen.outcome === 'ok' ? 'yes' : 'no';
        append(file, { kind: 'works', at: nowMs, agent: w.agent, from: w.from, to: w.to, fromLabel: w.fromLabel, toLabel: w.toLabel, works });
        if (works === 'no') {
          state.failed.set(w.to, nowMs);
          if (w.fromKind !== 'login') state.back.push({ agent: w.agent, from: w.to, to: w.from, fromLabel: w.toLabel, toLabel: w.fromLabel });
        }
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

  /* One move through the board's account move. Resolves to the record line written. */
  async function move(deps, nowMs, m, extra) {
    const movedAt = Date.now();   // review 2: before the move, so a first call made as the restart finishes counts
    let started;
    try { started = deps.startMove({ dir: m.to, names: [m.agent] }); } catch { started = null; }
    const first = started && started.body && Array.isArray(started.body.agents) ? started.body.agents[0] : null;
    const base = { kind: 'move', agent: m.agent, from: m.from, to: m.to, fromLabel: m.fromLabel, toLabel: m.toLabel, why: m.why, ...extra };
    if (!started || started.status !== 202 || !first || first.outcome === 'refused') {
      state.refused.set(m.agent, nowMs);
      const line = { ...base, at: nowMs, outcome: 'refused' };
      append(file, line);
      return line;
    }
    try { await started.done; } catch { /* the move's record says how it went */ }
    let outcome = 'partial';
    try {
      const after = deps.readMove ? deps.readMove(started.body.id) : null;
      const a = after && Array.isArray(after.agents) ? after.agents[0] : null;
      outcome = a && (a.outcome === 'changed' || a.outcome === 'stopped') ? a.outcome : 'partial';   // review 2: a stop puts it back
    } catch { outcome = 'partial'; }
    const line = { ...base, at: Date.now(), outcome };
    append(file, line);
    if (outcome === 'changed') {
      if (!extra || !extra.back) state.watching.push({ agent: m.agent, from: m.from, to: m.to, fromLabel: m.fromLabel, toLabel: m.toLabel, fromKind: m.fromKind, movedAt });
      try {
        deps.tell(m.agent, extra && extra.back
          ? `Kosmos moved this agent back to ${m.toLabel || 'its account'}, because its first request on ${m.fromLabel || 'the other account'} was refused.`
          : `Kosmos moved this agent from ${m.fromLabel || 'its account'} to ${m.toLabel || 'another account'}, because ${m.why}.`);
      } catch { /* telling is best-effort; the record has it */ }
    }
    return line;
  }

  /**
   * deps: list() (accounts.list), readUsage(dir, nowMs), agentsOn(dir, isDefault), roster() (a NEW board roster read,
   * or null when it cannot be read), records() (every project; may be cached for the tick), freshRecords() (optional:
   * a new read, for the re-check just before a move), readCommitment(session), settingOn() (true only when the switch
   * reads on), movesOn() (moves switched on), accountBusy(), boardRestarting(), startMove({ dir, names })
   * (accountmove.start with the board's deps), readMove(id), lastSeen(agent) ({ outcome, at } or null),
   * tell(agent, text), labelOf(dir); optional isGuide/guideName (movableFor's).
   * Resolves to what it did, for the log and tests: { did: 'off' | 'nothing' | 'recorded' | 'moved' | 'refused' |
   * 'skipped' | 'unreadable', ... }.
   */
  async function tick(deps, nowMs = Date.now()) {
    check(deps, nowMs);
    if (deps.settingOn() !== true) { state.lastMovable = new Set(); return { did: 'off' }; }
    let decision;
    const movableArgs = (cards, records) => ({ cards, records: records || deps.records, readCommitment: deps.readCommitment,
      ...(deps.isGuide ? { isGuide: deps.isGuide } : {}), ...(deps.guideName ? { guideName: deps.guideName } : {}) });
    try {
      const rows = ab.rowsFromReadings({ list: deps.list(), readUsage: deps.readUsage, agentsOn: deps.agentsOn, nowMs });
      const movable = ab.movableOnDemand(() => ab.movableFor(movableArgs(deps.roster())));
      decision = ab.decide({ rows, movable, nowMs });
    } catch { state.lastMovable = new Set(); return { did: 'unreadable' }; }
    /* Review 1: the re-check reads the projects again too (the tick's own read is cached for the decision). */
    const recheck = () => ab.movableFor(movableArgs(deps.roster(), deps.freshRecords));
    const label = (dir) => { try { return deps.labelOf(dir); } catch { return null; } };
    const kindOf = (dir) => (decision.atRisk.find((x) => x.from === dir) || {}).kind || null;
    const live = deps.movesOn() === true;
    const before = state.lastMovable;
    state.lastMovable = new Set(decision.moves.map((x) => `${x.agent}\n${x.from}`));
    const key = keyOf(decision);
    let recorded = false;
    if (key !== state.lastKey) {
      if (decision.moves.length || decision.held.length || decision.atRisk.length) {
        recorded = append(file, { kind: 'decision', at: nowMs, live,
          moves: decision.moves.map((m) => ({ agent: m.agent, from: m.from, to: m.to, fromLabel: label(m.from), toLabel: label(m.to), why: m.why })),
          held: decision.held.map((h) => ({ from: h.from, fromLabel: label(h.from), why: h.why })),
          atRisk: decision.atRisk.map((x) => ({ from: x.from, fromLabel: label(x.from), why: x.why, kind: x.kind })) });
        if (recorded) state.lastKey = key;   // review 2: a write that failed is tried again next tick
      } else state.lastKey = key;
    }
    const quiet = { did: recorded ? 'recorded' : 'nothing' };
    if (!live) return quiet;
    if (deps.accountBusy() || deps.boardRestarting()) return { did: 'nothing', because: 'busy' };
    /* A move back is owed before any new move, and goes through the same idle re-check. */
    const owed = state.back[0] || null;
    const held = (dir) => state.failed.has(dir) && nowMs - state.failed.get(dir) < FAILED_HOLD_MS;
    const passedOver = (agent) => state.refused.has(agent) && nowMs - state.refused.get(agent) < REFUSED_HOLD_MS;
    const next = owed ? null : decision.moves.find((x) => !held(x.to) && !passedOver(x.agent) && before.has(`${x.agent}\n${x.from}`));
    if (!owed && !next) return quiet;
    const m = owed || { ...next, fromLabel: label(next.from), toLabel: label(next.to), fromKind: kindOf(next.from) };
    /* Review 1: a roster that cannot be read now is not "no longer idle": nothing is moved and nothing recorded. */
    let freeNow;
    try { freeNow = recheck(); } catch { return { did: 'unreadable' }; }
    let stillFree = false;
    try { stillFree = freeNow(m.agent) === true; } catch { stillFree = false; }
    if (!stillFree) {
      if (!owed) append(file, { kind: 'skipped', at: nowMs, agent: m.agent, from: m.from, to: m.to, fromLabel: m.fromLabel, toLabel: m.toLabel, because: 'it was no longer idle' });
      return { did: 'skipped', agent: m.agent };   // a move back waits for the agent to be idle, and is not recorded each tick
    }
    if (owed) state.back.shift();
    const line = await move(deps, nowMs, m, owed ? { back: true } : undefined);
    return { did: line.outcome === 'refused' ? 'refused' : 'moved', agent: m.agent, outcome: line.outcome, ...(owed ? { back: true } : {}) };
  }

  return { tick, check, state };
}

module.exports = { create, recent, append, readLines, movesOn, sweepOn, FILE, KEEP_LINES, RECENT, WATCH_MS, FAILED_HOLD_MS, REFUSED_HOLD_MS };
