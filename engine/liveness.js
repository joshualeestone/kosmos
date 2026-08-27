'use strict';
/**
 * "This agent was still here at T." Liveness, and NOTHING ELSE.
 *
 * 🛑 WHY THIS IS NOT A STATE REPORT, AND THE DISTINCTION IS THE WHOLE POINT.
 * On a Mac the tmux pane does two jobs at once: it says WHICH agent this is,
 * and it says the agent is STILL RUNNING. Remove the pane -- a Windows agent,
 * or any runner that is not inside tmux -- and both jobs need replacing. The
 * launch token already replaces identity. This replaces liveness.
 *
 * ⚠️ AND IT MUST NOT GO THROUGH `selfreport.record`, WHICH REFUSES ANYTHING
 * WITHOUT A VALID STATE. A supervisor calling that every ten seconds would
 * have to assert `working`, and asserting `working` on a timer overwrites a
 * deliberate `blocked`. That is #900 and #1058 -- twice-fixed -- re-broken by
 * the very mechanism built to replace the pane.
 *
 * 🔑 SO: NO STATE HERE. Nothing in this module can change what an agent SAYS
 * it is doing. It records only that something holding that agent's credential
 * was alive at a moment, which is exactly what the pane's existence used to
 * mean and no more.
 *
 * ⇒ Keeping the two apart is what lets `status.reconcileReport` keep its rules
 * unchanged: rule 5 (a stale `working` decays to UNKNOWN) and rule 6 (`idle`,
 * `needs_you` and `blocked` never decay) were both written for a world where
 * the pane supplied liveness. Give liveness its own signal and both keep their
 * original meaning instead of needing carve-outs.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DIR = path.join(store.ROOT, 'liveness');
const FILE_MODE = 0o600;

/* Three heartbeats of grace at the supervisor's ten-second loop.
   ⚠️ NOT A GUESS AT "how long is an agent allowed to be quiet" -- that is the
   STATE question and it is not asked here. This is only "how long after a
   process dies should we still believe its last heartbeat", so it is bounded
   by the beat interval rather than by anything about the agent's work. A
   single missed beat is a slow disk; three is gone. */
const STALE_AFTER_MS = 35 * 1000;

function fileFor(sessionName) {
  return path.join(DIR, store.safeKey(sessionName) + '.json');
}

/**
 * Record that this agent was seen. Returns {seen:true} or a refusal with a
 * reason -- never throws at a caller, because the caller is a route.
 */
function seen(sessionName, atISO) {
  let file;
  try { file = fileFor(sessionName); } catch {
    return { seen: false, because: 'that agent name is not one we can keep a record under' };
  }
  const at = typeof atISO === 'string' && atISO ? atISO : new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) {
    return { seen: false, because: 'that is not a time we can read' };
  }
  try {
    fs.mkdirSync(DIR, { recursive: true });
    /* One line, rewritten. Unlike the report record this is not a history:
       only the latest beat means anything, and an append-only file of
       heartbeats would grow without ever being read past its tail. */
    fs.writeFileSync(file, JSON.stringify({ at }) + '\n', { mode: FILE_MODE });
  } catch (e) {
    return { seen: false, because: 'we could not write that down (' + (e && e.code || 'unknown') + ')' };
  }
  return { seen: true, at };
}

/**
 * When was this agent last seen?
 *
 * 🔑 THREE ANSWERS, NEVER TWO. `found:false` means we have no record at all --
 * which is what a Mac agent that has never heartbeated looks like, and is NOT
 * the same as "seen long ago". Collapsing those is the defect this fleet spent
 * 2026-08-27 finding in eight separate instruments.
 */
function read(sessionName) {
  let file;
  try { file = fileFor(sessionName); } catch { return { found: false, because: 'unreadable agent name' }; }
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { found: false, because: 'no heartbeat has ever been recorded for this agent' };
    return { found: false, because: 'we could not read the heartbeat record' };
  }
  let at;
  try { at = JSON.parse(raw).at; } catch { return { found: false, because: 'the heartbeat record is not readable' }; }
  const ms = Date.parse(at || '');
  if (!Number.isFinite(ms)) return { found: false, because: 'the heartbeat record carries no readable time' };
  return { found: true, at, ageMs: Date.now() - ms };
}

/**
 * Is this agent alive right now, on the heartbeat's evidence?
 * ⚠️ `null` for "we cannot tell" -- no record -- and it is deliberately NOT
 * `false`. A caller that treats no-record as dead would drop every Mac agent,
 * none of which heartbeat.
 */
function alive(sessionName, staleAfterMs) {
  const r = read(sessionName);
  if (!r.found) return null;
  return r.ageMs <= (Number.isFinite(staleAfterMs) ? staleAfterMs : STALE_AFTER_MS);
}

module.exports = { DIR, STALE_AFTER_MS, fileFor, seen, read, alive };
