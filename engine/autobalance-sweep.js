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
const GAP_TICKS = 3;                // review 20: a gap writes nothing for this many ticks, then is written, named

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
    try { const j = JSON.parse(line); if (j && typeof j === 'object') out.push(j); } catch { /* one bad line is skipped, and dropped at the next write */ }
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

/* The newest RECENT decisions Settings draws, newest first: only those with a usage move in them. A decision with an
   account at risk and nothing that could move is recorded but not drawn, and so is a move off a stopped login (review
   12): it stays in the file as evidence of the login problem, but slice 3b moves for usage only, so drawing it would
   show a move that will never happen. Throws when the record cannot be read (the route answers it as empty). */
function recent(file, n = RECENT) {
  const now = Date.now();
  return readLines(file).filter((l) => l.kind === 'decision' && objects(l.moves).some((m) => m.kind !== 'login') && Number.isFinite(l.at) && l.at <= now + CLOCK_SLACK_MS)   // review 10: as create() distrusts it
    .slice(-n).reverse();
}

/* What a decision is, for "has it changed": the moves, the held accounts and the accounts at risk. Built from the
   decision or from its record line alike, so a restart does not record the same decision again. */
function keyOf(d) {
  /* Review 17: each list sorted, so the order entries arrive in never makes one decision look like two. */
  const sorted = (xs) => xs.map((x) => JSON.stringify(x)).sort();
  const dirs = (xs) => (Array.isArray(xs) ? xs : []).filter((x) => typeof x === 'string').sort();
  return JSON.stringify({ m: sorted(objects(d.moves).map((x) => [x.agent, x.from, x.to])), h: sorted(objects(d.held).map((x) => x.from)),
    r: sorted(objects(d.atRisk).map((x) => [x.from, x.kind])), u: dirs(d.unmeasured) });   // review 20: what was not measured is part of it
}

/**
 * One sweep: the last decision recorded, rebuilt from the record's newest decision line (a line stamped in the future
 * is not trusted). Reads only; nothing is written until a tick has something new to say.
 */
function create({ file, nowMs = Date.now() }) {
  /* last: the newest decision line (moves, held, atRisk, unmeasured). gapTicks: ticks in a row that were a gap.
     lastDid: what the last tick did, for Settings (review 20). */
  const state = { lastKey: null, last: null, writeFailed: false, gapTicks: 0, lastDid: null };
  for (const l of readLines(file)) {
    if (l.kind === 'decision' && Number.isFinite(l.at) && l.at <= nowMs + CLOCK_SLACK_MS) {
      state.lastKey = keyOf(l);
      state.last = { moves: objects(l.moves), held: objects(l.held), atRisk: objects(l.atRisk),
        unmeasured: (Array.isArray(l.unmeasured) ? l.unmeasured : []).filter((x) => typeof x === 'string') };
    }
  }

  /**
   * deps: list() (accounts.list), readUsage(dir, nowMs), agentsOn(dir, isDefault), roster() (the board roster, or null
   * when it cannot be read), records() (every project), readCommitment(session), settingOn() (true only when the switch
   * reads on), labelOf(dir); optional sameLogin(rec, account) (rowsFromReadings'), isGuide/guideName (movableFor's).
   * Resolves to { did: 'off' | 'nothing' | 'recorded' | 'cleared' | 'gap' | 'unreadable' }. state.writeFailed says the last write failed.
   */
  async function tick(deps, nowMs = Date.now()) {
    const r = await step(deps, nowMs);
    state.lastDid = r.did;
    return r;
  }

  async function step(deps, nowMs) {
    if (deps.settingOn() !== true) return { did: 'off' };
    let decision;
    let rows = [];
    try {
      const list = deps.list();
      /* Fewer than two Claude subscription accounts (slice 2's eligible rule) is nothing to balance; stop before the
         agents walk. */
      if (ab.eligible((Array.isArray(list) ? list : []).map((a) => (a && !a.apiKey ? { provider: 'anthropic', dir: a.dir } : null))).length < 2) {
        return { did: 'nothing' };
      }
      rows = ab.rowsFromReadings({ list, readUsage: deps.readUsage, agentsOn: deps.agentsOn, nowMs, ...(deps.sameLogin ? { sameLogin: deps.sameLogin } : {}) });
      const movable = ab.movableOnDemand(() => ab.movableFor({ cards: deps.roster(), records: deps.records, readCommitment: deps.readCommitment,
        ...(deps.isGuide ? { isGuide: deps.isGuide } : {}), ...(deps.guideName ? { guideName: deps.guideName } : {}) }));
      decision = ab.decide({ rows, movable, nowMs });
    } catch (err) { return { did: 'unreadable', because: String((err && err.message) || err) }; }   // review 17: the board logs why
    /* Review 14, 16, 18, 20: WHEN IT CANNOT MEASURE, IT SAYS SO. An account is in a gap when it cannot be read now (no
       figure still fresh, no refused login) and the last recorded decision named it (at risk, the target of a
       would-move, or already unmeasured); a decision is also in a gap when an account at risk has an agent list that
       may be short. For GAP_TICKS ticks in a row such a gap writes nothing (most gaps are a blip). After that the
       decision is written with the unmeasured accounts named (`unmeasured`, part of its key), so a gap is never a
       silent hole: slice 1 never renews an idle account's expired token, so a gap can last for days (review 20). The
       line is true as written: with those accounts unmeasured, this is the decision. It stays the decision while they
       stay unmeasured, and the next line, once they are measured again, says what changed. Reviews 16 and 17 tried
       carrying the unmeasured account's old entries instead; that kept old reasons alive past their reset. */
    const unmeasured = new Set(rows.filter((r) => r.measured === false).map((r) => r.dir));
    const named = state.last ? [...state.last.atRisk.map((x) => x.from), ...state.last.moves.map((x) => x.to), ...(state.last.unmeasured || [])] : [];
    const gapDirs = [...new Set(named.filter((dir) => unmeasured.has(dir)))];
    if (gapDirs.length || decision.short.length) {
      state.gapTicks += 1;
      if (state.gapTicks < GAP_TICKS) {
        return { did: 'gap', because: gapDirs.length ? 'an account the last decision named could not be measured' : 'an account at risk has an agent list that may be short' };
      }
    } else state.gapTicks = 0;
    decision = { ...decision, unmeasured: gapDirs };
    const key = keyOf(decision);
    /* Review 17: the record already holds this decision, so there is nothing a failed write left unsaid. */
    if (key === state.lastKey) { state.writeFailed = false; return { did: 'nothing' }; }
    /* Review 10: the end of a risk is written too (an empty decision), so a board restart rebuilds "nothing at risk"
       and a risk that comes back is recorded again. Only a first tick with nothing at risk writes nothing. */
    const empty = !(decision.moves.length || decision.held.length || decision.atRisk.length || decision.unmeasured.length);
    if (empty && state.lastKey === null) { state.lastKey = key; state.last = null; return { did: 'nothing' }; }
    const label = (dir) => { try { return deps.labelOf(dir); } catch { return null; } };
    const kindOf = (dir) => (decision.atRisk.find((x) => x.from === dir) || {}).kind || null;
    const written = append(file, { kind: 'decision', at: nowMs,
      ...(decision.unmeasured.length ? { unmeasured: decision.unmeasured } : {}), ...(decision.short.length ? { short: decision.short } : {}),
      moves: decision.moves.map((m) => ({ agent: m.agent, from: m.from, to: m.to, fromLabel: label(m.from), toLabel: label(m.to), why: m.why, kind: kindOf(m.from) })),
      held: decision.held.map((h) => ({ from: h.from, fromLabel: label(h.from), why: h.why })),
      atRisk: decision.atRisk.map((x) => ({ from: x.from, fromLabel: label(x.from), why: x.why, kind: x.kind })) });
    state.writeFailed = !written;   // review 10: the board says so (once) and stops saying it records
    if (!written) return { did: 'nothing', because: 'write-failed' };   // tried again next tick
    state.lastKey = key;
    state.last = { moves: decision.moves, held: decision.held, atRisk: decision.atRisk, unmeasured: decision.unmeasured };
    return { did: empty ? 'cleared' : 'recorded' };
  }

  return { tick, state };
}

module.exports = { create, recent, append, readLines, sweepOn, keyOf, FILE, KEEP_LINES, RECENT, CLOCK_SLACK_MS, GAP_TICKS };
