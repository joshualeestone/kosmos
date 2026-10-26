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
 * THE RECORD: JSON lines in the board's data folder, newest last, at most KEEP_LINES. Agent names, account folders and
 * labels, and the decision's own reason (percentages and hours, or "its login has stopped working"): never an email,
 * and never the move's own sentence (it can name the account by its email). The holds, the watch on each moved agent
 * and the moves back still owed are rebuilt from it when the board starts, so a restart forgets none of them.
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
const BACK_MAX_MS = 24 * 60 * 60 * 1000;   // review 3: a move back still owed after this long is given up on (and recorded)
const LOGIN_SEEN_MS = 60 * 60 * 1000;      // review 3: how recent an agent's own refused request must be to move it off a stopped login

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
  } catch {
    try { fs.unlinkSync(`${file}.${process.pid}.tmp`); } catch { /* nothing left to remove */ }   // review 3
    return false;
  }
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
 * moves back owed, and the targets and agents held after a failed or refused move. Everything but the first two is
 * rebuilt from the record here (review 3: a board
 * restarts several times a day). A rebuilt watch still works: observed starts empty, and the first call it sees after
 * the restart is after the move.
 */
function create({ file, nowMs = Date.now() }) {
  const state = { lastKey: null, lastMovable: new Set(), watching: [], back: [], failed: new Map(), refused: new Map() };
  const watched = new Map();   // agent -> its watch, from the newest forward move, until a works line closes it
  const owed = new Map();      // agent -> the move back it is owed, until a move back (or giving up) closes it
  for (const l of readLines(file)) {
    if (!Number.isFinite(l.at)) continue;
    if (l.kind === 'works' && l.works === 'no' && nowMs - l.at < FAILED_HOLD_MS) state.failed.set(l.to, l.at);
    if (l.kind === 'move' && l.outcome === 'refused' && !l.back && nowMs - l.at < REFUSED_HOLD_MS) state.refused.set(l.agent, l.at);
    if (l.kind === 'move' && l.outcome === 'changed' && !l.back) {
      const movedAt = Number.isFinite(l.startedAt) ? l.startedAt : l.at;
      if (nowMs - movedAt <= WATCH_MS) watched.set(l.agent, { agent: l.agent, from: l.from, to: l.to, fromLabel: l.fromLabel, toLabel: l.toLabel, fromKind: l.fromKind || null, movedAt });
      else watched.delete(l.agent);
    }
    if (l.kind === 'works') {
      watched.delete(l.agent);
      if (l.works === 'no' && l.fromKind !== 'login' && nowMs - l.at < BACK_MAX_MS) owed.set(l.agent, { agent: l.agent, from: l.to, to: l.from, fromLabel: l.toLabel, toLabel: l.fromLabel, owedAt: l.at });
    }
    if (l.kind === 'move' && l.back) owed.delete(l.agent);
    if (l.kind === 'back-given-up') owed.delete(l.agent);
  }
  state.watching = [...watched.values()];
  state.back = [...owed.values()];

  /* The works-again check: the first real call each moved agent makes after its move. A refused one is moved back
     (review 2), unless the account it left had stopped working itself. */
  function check(deps, nowMs) {
    const still = [];
    for (const w of state.watching) {
      let seen = null;
      try { seen = deps.lastSeen(w.agent); } catch { seen = null; }
      if (seen && Number.isFinite(seen.at) && seen.at > w.movedAt) {
        const works = seen.outcome === 'ok' ? 'yes' : 'no';
        append(file, { kind: 'works', at: nowMs, agent: w.agent, from: w.from, to: w.to, fromLabel: w.fromLabel, toLabel: w.toLabel, fromKind: w.fromKind || null, works });
        if (works === 'no') {
          state.failed.set(w.to, nowMs);
          if (w.fromKind !== 'login') state.back.push({ agent: w.agent, from: w.to, to: w.from, fromLabel: w.toLabel, toLabel: w.fromLabel, owedAt: nowMs });
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
    /* Review 3: a 409 is the board saying no move may start now (one began since accountBusy() was asked, or the board
       is about to restart): nothing about this agent, so no hold and no line, and a move back stays owed. */
    if (started && started.status === 409) return null;
    const first = started && started.body && Array.isArray(started.body.agents) ? started.body.agents[0] : null;
    const base = { kind: 'move', agent: m.agent, from: m.from, to: m.to, fromLabel: m.fromLabel, toLabel: m.toLabel, why: m.why,
      fromKind: m.fromKind || null, startedAt: movedAt, ...extra };
    if (!started || started.status !== 202 || !first || first.outcome === 'refused') {
      if (!extra || !extra.back) state.refused.set(m.agent, nowMs);
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
    let rows;
    let list = [];
    try {
      list = deps.list();
      /* Review 3: fewer than two Claude subscription accounts is nothing to balance; stop before the agents walk. */
      if ((Array.isArray(list) ? list : []).filter((a) => a && a.dir && !a.apiKey).length < 2) { state.lastMovable = new Set(); return { did: 'nothing' }; }
      rows = ab.rowsFromReadings({ list, readUsage: deps.readUsage, agentsOn: deps.agentsOn, nowMs });
      const movable = ab.movableOnDemand(() => ab.movableFor(movableArgs(deps.roster())));
      decision = ab.decide({ rows, movable, nowMs });
    } catch { state.lastMovable = new Set(); return { did: 'unreadable' }; }
    /* Review 1: the re-check reads the projects again too (the tick's own read is cached for the decision). */
    const recheck = () => ab.movableFor(movableArgs(deps.roster(), deps.freshRecords));
    const label = (dir) => { try { return deps.labelOf(dir); } catch { return null; } };
    const kindOf = (dir) => (decision.atRisk.find((x) => x.from === dir) || {}).kind || null;
    const live = deps.movesOn() === true;
    /* Review 3: a stopped login moves an agent only when that agent's OWN last request was refused, within the hour. A
       401 or 403 from the usage endpoint (which Anthropic has not documented) is not proof on its own, and a second
       reading is no help: while usagepoll holds a refusal it sends nothing and rewrites the same one. */
    const loginConfirmed = (agent) => {
      let seen = null;
      try { seen = deps.lastSeen(agent); } catch { seen = null; }
      return !!seen && seen.outcome === '401' && Number.isFinite(seen.at) && nowMs - seen.at < LOGIN_SEEN_MS;
    };
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
    /* Review 1: a roster that cannot be read now is not "no longer idle": nothing is moved and nothing recorded. */
    let freeNow;
    const free = (agent) => {
      if (!freeNow) freeNow = recheck();   // throws when the roster cannot be read
      try { return freeNow(agent) === true; } catch { return false; }
    };
    /* A move back owed goes first, but never blocks the rest (review 3): one whose agent is not idle waits, one older than
       BACK_MAX_MS is given up on, and one whose agent is no longer on the account it was moved to (a person moved it,
       or it was removed) is dropped, since a move back would undo the person's choice. */
    for (const b of state.back.slice()) {
      const gone = () => { state.back = state.back.filter((x) => x !== b); };
      if (nowMs - b.owedAt > BACK_MAX_MS) {
        append(file, { kind: 'back-given-up', at: nowMs, agent: b.agent, from: b.from, to: b.to, fromLabel: b.fromLabel, toLabel: b.toLabel });
        gone(); continue;
      }
      let here = null;
      const isDefault = !!((Array.isArray(list) ? list : []).find((a) => a && a.dir === b.from) || {}).isDefault;
      try { here = deps.agentsOn(b.from, isDefault); } catch { here = null; }
      if (!here || !Array.isArray(here.names)) continue;   // cannot tell where it is: wait
      if (!here.names.includes(b.agent)) { gone(); continue; }
      try { if (!free(b.agent)) continue; } catch { return { did: 'unreadable' }; }
      const line = await move(deps, nowMs, b, { back: true });
      if (!line) return { did: 'nothing', because: 'busy' };   // a 409: still owed
      gone();
      return { did: line.outcome === 'refused' ? 'refused' : 'moved', agent: b.agent, outcome: line.outcome, back: true };
    }
    const held = (dir) => state.failed.has(dir) && nowMs - state.failed.get(dir) < FAILED_HOLD_MS;
    const passedOver = (agent) => state.refused.has(agent) && nowMs - state.refused.get(agent) < REFUSED_HOLD_MS;
    const next = decision.moves.find((x) => !held(x.to) && !passedOver(x.agent) && before.has(`${x.agent}\n${x.from}`)
      && (kindOf(x.from) !== 'login' || loginConfirmed(x.agent)));
    if (!next) return quiet;
    const m = { ...next, fromLabel: label(next.from), toLabel: label(next.to), fromKind: kindOf(next.from) };
    let stillFree;
    try { stillFree = free(m.agent); } catch { return { did: 'unreadable' }; }
    if (!stillFree) {
      append(file, { kind: 'skipped', at: nowMs, agent: m.agent, from: m.from, to: m.to, fromLabel: m.fromLabel, toLabel: m.toLabel, because: 'it was no longer idle' });
      return { did: 'skipped', agent: m.agent };
    }
    const line = await move(deps, nowMs, m);
    if (!line) return { did: 'nothing', because: 'busy' };
    return { did: line.outcome === 'refused' ? 'refused' : 'moved', agent: m.agent, outcome: line.outcome };
  }

  return { tick, check, state };
}

module.exports = { create, recent, append, readLines, movesOn, sweepOn, FILE, KEEP_LINES, RECENT, WATCH_MS, FAILED_HOLD_MS, REFUSED_HOLD_MS, BACK_MAX_MS, LOGIN_SEEN_MS };
