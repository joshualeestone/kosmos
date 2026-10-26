'use strict';
/**
 * kosmos#7152 slice 3: usage auto-balance on a timer, RECORDING ONLY. Each tick reads the cheap rows (no live check),
 * runs slice 2's decision (engine/autobalance.js) and writes it to a record when it CHANGES, so a person (and the PM)
 * can read a day of what Kosmos would have moved, and why, before anything moves on its own.
 *
 * 🛑 NOTHING HERE MOVES AN AGENT. Moving is slice 3b, built on branch automove-live-7152 and split out after eight review
 * rounds found every warning of rounds 4 to 8 in the moving half (a person's own move, a Stop, partial and unknown
 * moves, holds that had to survive a restart). The plan says what 3b must satisfy before it ships.
 *
 * Plan: .claude/plans/automove-7152.md. The board wires it (server.js autobalanceSweepDeps(), the sweep beside slice
 * 1's usage poll); every effect is a dep, so a test drives it with no files but the record's.
 *
 * THE RECORD: JSON lines in the board's data folder, newest last, at most KEEP_LINES. Agent names, account folders and
 * labels, and the decision's own reason (percentages and hours, or "its login has stopped working"): never an email.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ab = require('./autobalance');

const FILE = 'autobalance-record.jsonl';
const KEEP_LINES = 500;
const RECENT = 10;
const CLOCK_SLACK_MS = 60 * 1000;   // a record line stamped further ahead than this is not trusted

/* AGENT_WORKFORCE_AUTOBALANCE_SWEEP_OFF=1 is the operator's brake on the sweep (the setting is the person's). */
function sweepOn(env = process.env) { return env.AGENT_WORKFORCE_AUTOBALANCE_SWEEP_OFF !== '1'; }

/* Review 9: only a record that does not exist yet is an empty one. Any other read failure THROWS, so create() leaves the
   sweep off and append() refuses to write, rather than either taking a record it could not read for an empty one and
   replacing 500 lines of history with one. */
function readLines(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { if (err && err.code === 'ENOENT') return []; throw err; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); if (j && typeof j === 'object') out.push(j); } catch { /* one bad line is skipped */ }
  }
  return out;
}

/* Append one entry, keeping the newest KEEP_LINES. Written whole and renamed into place, so a reader never sees half a
   file, under a temp name unique to the write. Never throws: a record that cannot be written must not stop the sweep. */
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
    try { fs.unlinkSync(tmp); } catch { /* nothing left to remove */ }
    return false;
  }
}

const objects = (x) => (Array.isArray(x) ? x : []).filter((y) => y && typeof y === 'object');   // an odd line must not throw

/* The newest RECENT decisions Settings draws, newest first: only those with a move in them. A decision with an account at
   risk and nothing that could move (none idle, or no account able to take them) is recorded but not drawn: the record
   is of what Kosmos would have moved. Throws when the record cannot be read (the route answers it as empty). */
function recent(file, n = RECENT) {
  const now = Date.now();
  return readLines(file).filter((l) => l.kind === 'decision' && objects(l.moves).length && !(Number.isFinite(l.at) && l.at > now + CLOCK_SLACK_MS))   // review 10: as create() distrusts it
    .slice(-n).reverse();
}

/* What a decision is, for "has it changed": the moves, the held accounts and the accounts at risk. Built from the
   decision or from its record line alike, so a restart does not record the same decision again. */
function keyOf(d) {
  return JSON.stringify({ m: objects(d.moves).map((x) => [x.agent, x.from, x.to]), h: objects(d.held).map((x) => x.from),
    r: objects(d.atRisk).map((x) => [x.from, x.kind]) });
}

/**
 * One sweep: the last decision recorded, rebuilt from the record's newest decision line (a line stamped in the future
 * is not trusted). Reads only; nothing is written until a tick has something new to say.
 */
function create({ file, nowMs = Date.now() }) {
  const state = { lastKey: null, writeFailed: false };
  for (const l of readLines(file)) {
    if (l.kind === 'decision' && Number.isFinite(l.at) && l.at <= nowMs + CLOCK_SLACK_MS) state.lastKey = keyOf(l);
  }

  /**
   * deps: list() (accounts.list), readUsage(dir, nowMs), agentsOn(dir, isDefault), roster() (the board roster, or null
   * when it cannot be read), records() (every project), readCommitment(session), settingOn() (true only when the switch
   * reads on), labelOf(dir); optional sameLogin(rec, account) (rowsFromReadings'), isGuide/guideName (movableFor's).
   * Resolves to { did: 'off' | 'nothing' | 'recorded' | 'cleared' | 'unreadable' }. state.writeFailed says the last write failed.
   */
  async function tick(deps, nowMs = Date.now()) {
    if (deps.settingOn() !== true) return { did: 'off' };
    let decision;
    try {
      const list = deps.list();
      /* Fewer than two Claude subscription accounts (slice 2's eligible rule) is nothing to balance; stop before the
         agents walk. */
      if (ab.eligible((Array.isArray(list) ? list : []).map((a) => (a && !a.apiKey ? { provider: 'anthropic', dir: a.dir } : null))).length < 2) {
        return { did: 'nothing' };
      }
      const rows = ab.rowsFromReadings({ list, readUsage: deps.readUsage, agentsOn: deps.agentsOn, nowMs, ...(deps.sameLogin ? { sameLogin: deps.sameLogin } : {}) });
      const movable = ab.movableOnDemand(() => ab.movableFor({ cards: deps.roster(), records: deps.records, readCommitment: deps.readCommitment,
        ...(deps.isGuide ? { isGuide: deps.isGuide } : {}), ...(deps.guideName ? { guideName: deps.guideName } : {}) }));
      decision = ab.decide({ rows, movable, nowMs });
    } catch { return { did: 'unreadable' }; }
    const key = keyOf(decision);
    if (key === state.lastKey) return { did: 'nothing' };
    /* Review 10: the end of a risk is written too (an empty decision), so a board restart rebuilds "nothing at risk"
       and a risk that comes back is recorded again. Only a first tick with nothing at risk writes nothing. */
    const empty = !(decision.moves.length || decision.held.length || decision.atRisk.length);
    if (empty && state.lastKey === null) { state.lastKey = key; return { did: 'nothing' }; }
    const label = (dir) => { try { return deps.labelOf(dir); } catch { return null; } };
    const kindOf = (dir) => (decision.atRisk.find((x) => x.from === dir) || {}).kind || null;
    const written = append(file, { kind: 'decision', at: nowMs,
      moves: decision.moves.map((m) => ({ agent: m.agent, from: m.from, to: m.to, fromLabel: label(m.from), toLabel: label(m.to), why: m.why, kind: kindOf(m.from) })),
      held: decision.held.map((h) => ({ from: h.from, fromLabel: label(h.from), why: h.why })),
      atRisk: decision.atRisk.map((x) => ({ from: x.from, fromLabel: label(x.from), why: x.why, kind: x.kind })) });
    state.writeFailed = !written;   // review 10: the board says so (once) and stops saying it records
    if (!written) return { did: 'nothing', because: 'write-failed' };   // tried again next tick
    state.lastKey = key;
    return { did: empty ? 'cleared' : 'recorded' };
  }

  return { tick, state };
}

module.exports = { create, recent, append, readLines, sweepOn, keyOf, FILE, KEEP_LINES, RECENT, CLOCK_SLACK_MS };
