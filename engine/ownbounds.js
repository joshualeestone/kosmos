'use strict';
/*
 * #5154 slice B: Kosmos's OTHER bounded helpers stop giving up SILENTLY.
 *
 * Slices A (engine/crashloop.js) and C (engine/stuckterminal.js) each raise a needs-you for a signal
 * Kosmos could already see (a crash loop; a recurring terminal pane state). This bounds the rest of the
 * ask: Kosmos's OWN PER-AGENT helpers already cap their retries and then give up with a LOG LINE ONLY --
 * nothing on the board says they stopped. The three:
 *   - quota     : the Gemini quota resume gave up after MAX_TRIES reached nothing (engine/agyquota.js).
 *   - nudge     : the idle-agent nudge gave up after MAX_TRIES (engine/agentnudge.js).
 *   - firstreply: the first-reply reminder gave up after MAX_TRIES (engine/firstreply-nudge.js).
 * (connlost-heal.js is NOT here: its give-up is already surfaced on the board today -- #5154, Renet.)
 *
 * DELIBERATELY NOT HERE -- the Assigner give-up. The Assigner's MAX_ASK_FAILS is keyed on a PROJECT (a task
 * nobody took), not on an agent: the session it asked last is not "the agent that needs you". Routing it to
 * THIS per-agent record would pin a needs-you on an innocent idle agent -- the exact false-alarm slices A/C
 * guard against. Its right surface is project-level; it is carved out as a companion follow-up (#5154).
 *
 * SIGNAL, NOT A SECOND DERIVATION (repo convention #5): each helper already DECIDES it has given up, inside
 * its own `plan`/`sweepOnce`. This module never re-derives that decision from tries counts or books -- the
 * helper calls `note(key, cls, evidence)` at its give-up branch (every sweep the give-up still holds) and
 * `recovered(key, cls)` when that same helper next SUCCEEDS for the agent. This module only remembers the
 * episode and raises ONE needs-you for it.
 *
 * TWO WAYS AN EPISODE ENDS, because a helper cannot always tell us it recovered. (1) The PROMPT path:
 * `recovered` is called when the helper plans the agent again and it is no longer giving up (it delivered,
 * or the stall cleared). (2) The BACKSTOP: an agent that gave up and then LEFT the helper's view entirely --
 * a nudge-stalled agent that started working drops out of the idle list and is never planned again, so no
 * `recovered` ever comes. Each `note` stamps `lastAt`; an episode not re-noted within STALE_MS is treated as
 * resolved (and pruned). Without this backstop a resolved give-up would linger as a needs-you on a now-healthy
 * agent -- the exact false alarm slices A/C exist to prevent. STALE_MS is set well above the SLOWEST helper's
 * sweep interval (the idle nudge, ~15 min) so a still-giving-up agent is always re-noted before it goes stale.
 *
 * SHAPE MIRRORS stuckterminal.js on purpose (so a reader who knows slice C knows this): a durable per-agent
 * record under store.ROOT/ownbounds/<key>.json, written atomically, reachable from create/remove/
 * delete-leftover (forget) and wiped at boot (clearAll). Durable rather than an in-memory Map for the SAME
 * reason as slice C: forget must be callable from those lifecycle modules, which cannot reach a server.js Map.
 * `dir()` reads store.ROOT at call time, never at require (convention #2): nothing here freezes the root.
 *
 * PRECEDENCE (the slice A/C rule): a Kosmos-raised item must NEVER mask the agent's OWN needs_you question.
 * The 60s sweep is handed an `excluded(key)` predicate (true when the agent is in its own needs_you) and
 * SUPPRESSES the tell for those agents without clearing the episode -- so the moment the agent's own
 * question is answered, the still-standing give-up surfaces.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

// The per-agent bounded helpers this routes. A `cls` not in here is ignored by note(), so a future helper
// cannot raise an unnamed item by accident. Spellings are the `cls` tokens server.js passes and the board
// reads. (The Assigner is NOT here -- see the header: its give-up is project-keyed, not per-agent.)
const CLASSES = Object.freeze(['quota', 'nudge', 'firstreply']);

// A give-up must have STOOD this long before it is raised. Deliberately small: the helper's own tries are the
// real bound (giving up already means several failed attempts over minutes), so this only debounces a give-up
// that `recovered` clears within a tick -- it never delays a genuine one by more than one sweep. False alarms
// are the chief risk (slice A/C), but here the conservatism lives in the helpers' MAX_TRIES, not a long clock.
const GRACE_MS = 60 * 1000;

// The staleness backstop (see the header): an episode not re-noted within this is treated as resolved. It MUST
// exceed the slowest helper sweep interval, or a still-stuck agent goes stale BETWEEN re-notes and re-raises
// (a duplicate push + a card that blinks off). The idle nudge runs at the heartbeat interval, whose MAX choice
// is 60 min (engine/heartbeat-setting.js INTERVAL_CHOICES = [5,10,15,30,60]) -- NOT the 15 min default. So this
// is 2 h: comfortably above a 60-min re-note gap with margin for a delayed sweep. The crisp clears (explicit
// recovered() and the IDLE_ONLY mootness) handle the common recovery; this only backstops a left-the-view agent.
const STALE_MS = 2 * 60 * 60 * 1000;

// Classes that ONLY apply to an idle agent: the idle-nudge and the first-reply nudge both fire only while the
// agent is idle (engine/agentnudge.js, firstreply-nudge.js gate on card.state idle). So the moment such an
// agent is no longer idle, its give-up is MOOT and clears crisply -- the sweep does not wait out STALE_MS.
// The quota resume is not idle-gated (a paused Antigravity agent is not "idle"), so it relies on recovered()
// + the staleness backstop. This is a mootness check on the live state, NOT a re-derivation of the give-up.
const IDLE_ONLY = Object.freeze({ nudge: true, firstreply: true, quota: false });

function isClass(cls) { return CLASSES.indexOf(cls) !== -1; }

/*
 * Is this class's give-up MOOT given the agent's current live `state`? A moot give-up is resolved and is
 * dropped from the /api/status read (peek) and cleared from disk by the 60s sweep. Two rules:
 *  - an IDLE_ONLY class (nudge/firstreply) is moot the instant the agent is no longer idle;
 *  - any other class (quota) is moot once the agent is demonstrably `working` again. This closes the residual
 *    where an agent gives up on the quota, then resumes straight to `working` (e.g. the person messages it) --
 *    it leaves agyquota's paused-state set, so the helper's `cleared` never fires, and without this the give-up
 *    would linger as a false needs-you on a visibly-working agent until the STALE_MS backstop. A quota give-up
 *    on an `idle` agent is NOT mooted here (an idle antigravity agent can still be quota-paused); that
 *    recovery stays with agyquota's `cleared`.
 * A null/empty state is never moot (fail toward KEEPING the signal, never toward discounting it).
 */
function isMoot(cls, state) {
  if (typeof state !== 'string' || state === '') return false;
  if (IDLE_ONLY[cls]) return state !== 'idle';
  return state === 'working';
}

function dir() { return path.join(store.ROOT, 'ownbounds'); }
function fileFor(key) { return path.join(dir(), store.safeKey(key) + '.json'); }

// The stored record for one agent: { <cls>: { sinceAt, lastAt, evidence } }, or {} (absent/unreadable/
// malformed). Only well-formed class entries survive the read; a junk entry is dropped, not thrown on.
// A pre-this-version entry with no lastAt is tolerated: lastAt defaults to sinceAt (it reads as one fresh
// episode and is re-stamped on the next note). Never throws.
function readRec(key) {
  let text;
  try { text = fs.readFileSync(fileFor(key), 'utf8'); } catch { return {}; }
  const out = {};
  try {
    const o = JSON.parse(text);
    if (o && typeof o === 'object') {
      for (const cls of CLASSES) {
        const e = o[cls];
        if (e && Number.isFinite(e.sinceAt) && typeof e.evidence === 'string') {
          out[cls] = { sinceAt: e.sinceAt, lastAt: Number.isFinite(e.lastAt) ? e.lastAt : e.sinceAt, evidence: e.evidence };
        }
      }
    }
  } catch { /* a malformed file reads as no record */ }
  return out;
}

// Write the record (or delete the file when it has no class entries). Atomic (store.saveFlushed = tmp+rename,
// flushed before the rename) so a concurrent 5s peek never reads a half-written file. Never throws: a board
// that cannot write its own data dir simply does not escalate.
function writeRec(key, rec) {
  try {
    const live = {};
    for (const cls of CLASSES) if (rec && rec[cls]) live[cls] = { sinceAt: rec[cls].sinceAt, lastAt: rec[cls].lastAt, evidence: rec[cls].evidence };
    if (Object.keys(live).length === 0) { try { fs.unlinkSync(fileFor(key)); } catch { /* already gone */ } return; }
    fs.mkdirSync(dir(), { recursive: true });
    store.saveFlushed(fileFor(key), JSON.stringify(live));
  } catch { /* never fatal */ }
}

/*
 * A helper has GIVEN UP on this agent. Called from server.js at the helper's give-up branch, every sweep the
 * give-up still holds. A NEW episode sets `sinceAt` to now; an episode already open keeps its original
 * `sinceAt` (the clock runs). Either way `lastAt` is stamped to now -- that stamp is the liveness signal the
 * staleness backstop reads, so it must advance each time. A give-up is a rare, transient state, so writing on
 * each note is cheap (unlike slice C's per-5s-per-agent read, this fires only for an agent that gave up).
 * Never throws.
 */
function note(key, cls, evidence, now) {
  if (!isClass(cls)) return;
  if (now === undefined) now = Date.now();
  const ev = typeof evidence === 'string' ? evidence : '';
  const rec = readRec(key);
  const prev = rec[cls];
  // Keep sinceAt only for an episode still LIVE (not stale); a stale prev is a finished episode, so a new
  // give-up after a long gap starts a fresh clock rather than inheriting an ancient sinceAt.
  const keepSince = prev && (now - prev.lastAt) < STALE_MS ? prev.sinceAt : now;
  rec[cls] = { sinceAt: keepSince, lastAt: now, evidence: ev };
  writeRec(key, rec);
}

/*
 * The helper SUCCEEDED for this agent (the nudge was delivered, the quota resumed, the Assigner placed work),
 * or the thing it was stuck on is gone: clear that class's episode. The explicit recovery signal -- the
 * counterpart to note. A class that was never open is a no-op. Never throws.
 */
function recovered(key, cls) {
  if (!isClass(cls)) return;
  const rec = readRec(key);
  if (!rec[cls]) return;
  delete rec[cls];
  writeRec(key, rec);
}

/*
 * The assessment the route/sweep and the board read, from a record. Pure. An entry is RAISED once it has stood
 * past GRACE_MS and is still LIVE (re-noted within STALE_MS -- a stale entry is a resolved episode the writers
 * have not pruned yet, so it never raises). Returns { raised, items: [{ cls, sinceAt, evidence, forMs }] },
 * items oldest-sinceAt first so the board shows the longest-standing give-up first; `stale` lists classes whose
 * entries have gone stale (the sweep prunes them). `raised` is false for an empty record.
 *
 * `state` is the agent's CURRENT live state, passed ONLY on the /api/status read path (peek). When supplied and
 * NOT 'idle', an IDLE_ONLY class (nudge/firstreply) is MOOT and excluded from `items` AT ONCE -- so the board
 * drops a nudge/firstreply give-up the instant the agent is no longer idle, rather than carrying it for up to a
 * 60s sweep (the exact brief false-alarm slice C's state-aware peek was built to avoid, stuckterminal.js). The
 * 60s sweep calls assess WITHOUT a state so it still SEES the item and clears it from disk (tellBounds's
 * IDLE_ONLY+row.state branch); this read-path filter never writes.
 */
function assess(rec, now, state) {
  if (now === undefined) now = Date.now();
  const stateKnown = typeof state === 'string' && state !== '';
  const items = [];
  const stale = [];
  for (const cls of CLASSES) {
    const e = rec && rec[cls];
    if (!e) continue;
    if (now - e.lastAt >= STALE_MS) { stale.push(cls); continue; }
    if (stateKnown && isMoot(cls, state)) continue;   // moot given the live state (idle-only off-idle; quota when working)
    const forMs = now - e.sinceAt;
    if (forMs >= GRACE_MS) items.push({ cls, sinceAt: e.sinceAt, evidence: e.evidence, forMs });
  }
  items.sort((a, b) => a.sinceAt - b.sinceAt);
  return { raised: items.length > 0, items, stale };
}

/* READ-ONLY assessment for /api/status (every 5s): the stored record, assessed against the agent's CURRENT
   `state` (so an idle-only give-up on a now-non-idle agent is mooted immediately), never written. Signature
   mirrors stuckterminal.peek(key, state, now). */
function peek(key, state, now) { return assess(readRec(key), now, state); }

/* Drop every class for one agent (a removed/recreated agent never inherits an old episode -- as
   stuckterminal.forget). Wired into engine/create.js, remove.js and delete-leftover.js beside its forget. */
function forget(key) { writeRec(key, {}); }

/* Wipe every record at board boot, so a RESTART re-derives give-ups from the live helpers rather than judging
   on a clock from before the downtime (the slice C choice; the record is a derived clock, not ground truth). */
function clearAll() {
  try { for (const f of fs.readdirSync(dir())) { try { fs.unlinkSync(path.join(dir(), f)); } catch { /* already gone */ } } }
  catch { /* no dir yet */ }
}

/* The safeKey'd names with a stored record (files in dir()), like stuckterminal.keys(). Never throws. */
function keys() {
  try { return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); }
  catch { return []; }
}

/*
 * The once-per-episode sweep (mirrors stuckterminal.tellStuck; unit-testable). The caller (server.js, 60s tick)
 * passes:
 *   - rows: the agents it runs this tick, each `{ key, shown, ownNeedsYou }` (only agents we started).
 *           `ownNeedsYou` true means the agent is in its OWN needs_you right now (precedence: suppress).
 *   - told: a Set tracking which (key + cls) episodes have already been pushed.
 *   - now: the clock.
 *   - tell(key, item, shown): the side effect (log + one phone push) for ONE raised class. At most once/episode.
 * Behaviour:
 *   - For each agent, for each RAISED class: if the agent is in its own needs_you, SUPPRESS (do not tell, do
 *     not mark told -- so it surfaces the moment that question clears). Otherwise tell once and remember.
 *   - A class no longer raised (recovered/forgotten) clears its told-mark, so a later give-up tells again.
 *   - Prune the record of any agent that has LEFT the roster (a world closed, a pause, a gone session with no
 *     remove event) -- ONLY on a good roster. The caller invokes this with rows === null on a FAILED snapshot
 *     and sweep() below then does nothing, so a transient read never wipes a live give-up (the slice C W3 rule).
 */
function tellBounds({ rows, told, now, tell }) {
  if (now === undefined) now = Date.now();
  const liveSafe = new Set();
  for (const row of rows || []) {
    if (!row || !row.key) continue;
    liveSafe.add(store.safeKey(row.key));
    const a = assess(readRec(row.key), now);
    // Backstop clear: an entry that went stale (the agent left the helper's view without a recovered()) is a
    // resolved episode -- drop it from disk so it stops counting and its told-mark clears below.
    for (const cls of a.stale) recovered(row.key, cls);
    const raised = [];
    for (const it of a.items) {
      // Mootness clear: a give-up that is moot given the agent's live state is resolved -- clear it crisply
      // rather than tell or wait out the staleness window (the chief false-alarm case: a healthy agent). Covers
      // an idle-only class off-idle AND a quota give-up on a now-working agent (isMoot).
      if (isMoot(it.cls, row.state)) { recovered(row.key, it.cls); continue; }
      raised.push(it);
    }
    const raisedClasses = new Set(raised.map((it) => it.cls));
    for (const it of raised) {
      const mark = row.key + '\u0000' + it.cls;
      if (row.ownNeedsYou) continue;                 // precedence: the agent's own question outranks ours
      if (told.has(mark)) continue;
      told.add(mark);
      try { tell(row.key, it, row.shown || row.key); } catch { /* a failed push is not retried this episode */ }
    }
    // Clear told-marks for this agent's classes that are no longer raised, so a future episode re-pushes.
    for (const cls of CLASSES) if (!raisedClasses.has(cls)) told.delete(row.key + '\u0000' + cls);
  }
  // On a GOOD roster only (sweep() skips on rows === null): forget records for agents no longer present.
  for (const dk of keys()) if (!liveSafe.has(dk)) { try { fs.unlinkSync(path.join(dir(), dk + '.json')); } catch { /* already gone */ } }
  // Prune told-marks for departed agents so the Set does not grow without bound (keyed by sessionName+cls).
  for (const mark of Array.from(told)) {
    const k = mark.split('\u0000')[0];
    if (!liveSafe.has(store.safeKey(k))) told.delete(mark);
  }
}

/*
 * The 60s sweep as the server drives it, from the RAW roster snapshot (mirrors stuckterminal.sweepRoster; the
 * null-skip invariant is pinned by a unit test here, not only by reading the single server.js caller).
 *   - roster NOT an array (a FAILED snapshot, null): do NOTHING, return false. A read we cannot trust must
 *     never prune a record.
 *   - roster [] (a genuinely empty, SUCCESSFUL snapshot): an ordinary sweep that prunes every record.
 *   - a good roster: tell/recover + prune departed, over our own named agents only.
 * Returns true when it swept, false when it skipped a failed read.
 */
function sweepRoster({ roster, told, now, tell }) {
  if (!Array.isArray(roster)) return false;
  tellBounds({
    rows: roster.filter((a) => a && a.sessionName && a.isNamedOurs)
                .map((a) => ({ key: a.sessionName, shown: a.name || a.sessionName, state: a.state, ownNeedsYou: a.state === 'needs_you' })),
    told, now, tell,
  });
  return true;
}

module.exports = { CLASSES, GRACE_MS, STALE_MS, IDLE_ONLY, isClass, isMoot, dir, fileFor, readRec, writeRec, note, recovered, assess, peek, forget, clearAll, keys, tellBounds, sweepRoster };
