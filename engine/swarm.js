'use strict';

/**
 * Agent Swarms, the engine side (#3564; Josh 2026-09-24, mock approved 12:13).
 *
 * A swarm is ONE Kosmos agent (the lead): one name, one DM, one member in rooms.
 * Its helpers are Claude Code SUBAGENTS inside the lead's own session (the card's
 * "built-in fan-out"), so they are never sessions, board cards or room members, and
 * "one voice" holds by construction. Claude-only for v1.
 *
 * This module owns:
 *   - the swarm's settings (in the agent's profile) and their checks;
 *   - the lead's managed instruction block (N, isolation, claims, one verifier);
 *   - the METER: today's tokens and the helpers working now, read from Claude Code's
 *     own files. Measured on this Mac: each subagent writes
 *     `<session>/subagents/agent-*.jsonl` with per-message `usage` and timestamps,
 *     and a finished one ends with an assistant message whose `stop_reason` is
 *     `end_turn`. Nothing here is estimated.
 *
 * The contract with the UI is on #3564 (Renet, 2026-09-24 22:33).
 */

const fs = require('node:fs');
const path = require('node:path');
const projects = require('./projects');

const MIN_HELPERS = 2;
const MAX_HELPERS = 10;
const DEFAULT_HELPERS = 3;
/* A helper whose file has not moved for this long is not counted as working even if
   it never finished (a killed session leaves a file that never ends). */
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;
/* The reasons a swarm can be paused. */
const PAUSED_BECAUSE = Object.freeze(['person', 'limit', 'stopped']);

const START = projects.SWARM_START;
const END = projects.SWARM_END;

/* ---- settings ------------------------------------------------------------------ */

/**
 * Why a swarm's creation settings are refused, or null. `maxHelpers` may be absent
 * (the default applies); `dailyTokenLimit` is required: a swarm runs up to many
 * times the tokens of one agent, and a limit is how the person stays in charge.
 */
function createProblem({ provider, maxHelpers, dailyTokenLimit } = {}) {
  const prov = provider === undefined || provider === null || provider === '' ? 'anthropic' : String(provider);
  if (prov !== 'anthropic') return 'swarms run on Claude for now';
  if (maxHelpers !== undefined && maxHelpers !== null && !(Number.isInteger(maxHelpers) && maxHelpers >= MIN_HELPERS && maxHelpers <= MAX_HELPERS)) {
    return `the most helpers at once has to be a whole number from ${MIN_HELPERS} to ${MAX_HELPERS}`;
  }
  if (!(Number.isInteger(dailyTokenLimit) && dailyTokenLimit > 0)) return 'set a daily token limit for the swarm';
  return null;
}

/** The profile fields a new swarm is born with. */
function birthProfile({ maxHelpers, dailyTokenLimit }) {
  return {
    kind: 'swarm',
    swarm: {
      maxHelpers: Number.isInteger(maxHelpers) ? maxHelpers : DEFAULT_HELPERS,
      dailyTokenLimit,
      active: true,
      pausedBecause: null,
      pausedAt: null,
    },
  };
}

/** The swarm settings on a profile, or null for an ordinary agent. */
function settingsOf(profile) {
  if (!profile || profile.kind !== 'swarm' || !profile.swarm || typeof profile.swarm !== 'object') return null;
  const s = profile.swarm;
  return {
    maxHelpers: Number.isInteger(s.maxHelpers) && s.maxHelpers >= MIN_HELPERS && s.maxHelpers <= MAX_HELPERS ? s.maxHelpers : DEFAULT_HELPERS,
    dailyTokenLimit: Number.isInteger(s.dailyTokenLimit) && s.dailyTokenLimit > 0 ? s.dailyTokenLimit : null,
    active: s.active !== false,
    pausedBecause: s.active === false && PAUSED_BECAUSE.includes(s.pausedBecause) ? s.pausedBecause : null,
    pausedAt: s.active === false && typeof s.pausedAt === 'string' ? s.pausedAt : null,
  };
}

/** Why a settings patch is refused, or null. Any of the three keys, each checked. */
function patchProblem(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'we could not read those settings';
  const keys = Object.keys(patch);
  if (!keys.length) return 'we could not read those settings';
  for (const k of keys) {
    if (k === 'maxHelpers') {
      if (!(Number.isInteger(patch.maxHelpers) && patch.maxHelpers >= MIN_HELPERS && patch.maxHelpers <= MAX_HELPERS)) {
        return `the most helpers at once has to be a whole number from ${MIN_HELPERS} to ${MAX_HELPERS}`;
      }
    } else if (k === 'dailyTokenLimit') {
      if (!(Number.isInteger(patch.dailyTokenLimit) && patch.dailyTokenLimit > 0)) return 'the daily token limit has to be a whole number above zero';
    } else if (k === 'active') {
      if (typeof patch.active !== 'boolean') return 'active has to be true or false';
    } else {
      return 'we could not read those settings';
    }
  }
  return null;
}

/** The swarm block of a profile after a valid patch. Switching it back on clears the reason. */
function applyPatch(profile, patch) {
  const cur = settingsOf(profile);
  const next = { ...cur };
  if ('maxHelpers' in patch) next.maxHelpers = patch.maxHelpers;
  if ('dailyTokenLimit' in patch) next.dailyTokenLimit = patch.dailyTokenLimit;
  if ('active' in patch) {
    next.active = patch.active;
    next.pausedBecause = patch.active ? null : 'person';
    next.pausedAt = patch.active ? null : new Date().toISOString();
  }
  return next;
}

/** What the person is told when a message cannot go to a paused swarm. */
function pausedSentence(name, pausedBecause) {
  const who = String(name || 'This swarm');
  if (pausedBecause === 'limit') return `${who} paused itself at today's token limit. It starts again tomorrow, or switch it back on to send it work now.`;
  if (pausedBecause === 'stopped') return `${who} was stopped. Switch it back on to send it work.`;
  return `${who} is paused. Switch it back on to send it work.`;
}

/* ---- the lead's instructions --------------------------------------------------- */

/** The block for a lead that may run at most `maxHelpers` helpers at once. */
function blockBody(maxHelpers) {
  const n = Number.isInteger(maxHelpers) ? maxHelpers : DEFAULT_HELPERS;
  return [
    '## You are a swarm',
    '',
    'To the person you are one agent: one name, one conversation, one voice. You',
    `also have helpers only you can see: at most ${n} at once.`,
    '',
    '- When a request splits into parts that can run at the same time, give each',
    '  part to a helper with your subagent tool (Agent, called Task in older',
    `  versions), at most ${n} at once. When nothing splits, do it yourself with no`,
    '  helpers at all.',
    '- Any helper that changes files works in its own copy of them: start it with',
    '  isolation set to "worktree". Never let two helpers work in the same folder.',
    '- Give each helper exactly one part and say which. Two helpers never take the',
    '  same part.',
    '- You check and merge every helper\'s work yourself before you answer. Only you',
    '  speak: helpers never post in a room or message anyone.',
    '- If Kosmos tells you that you are paused, start no helpers, and say you are',
    '  paused until the person switches you back on.',
  ].join('\n');
}

/**
 * Rewrite a lead's block for `maxHelpers`, in its own instructions file. The same guard
 * sequence as dmfiles.tellAgent (the caller has already found the agent): never invents
 * an instructions file, refuses two blocks, never throws.
 *   { state: TOLD | COULD_NOT, because }
 */
function tellLead(sessionName, maxHelpers) {
  const instructions = require('./instructions');
  try {
    const current = instructions.read(sessionName);
    if (!current.exists) return { state: projects.TOLD.COULD_NOT, because: current.because || 'it has no instructions file yet, and we will not create one' };
    const found = projects.findBlock(current.text || '', START, END);
    if (found && found.ambiguous) {
      return { state: projects.TOLD.COULD_NOT, because: `its instructions contain ${found.pairs} Kosmos swarm blocks, so we cannot tell which is ours and did not change anything` };
    }
    const next = projects.spliceBlock(current.text || '', blockBody(maxHelpers), START, END);
    if (next === current.text) return { state: projects.TOLD.TOLD, because: null };
    instructions.write(sessionName, next, current.version, undefined, { who: 'kosmos', because: 'Kosmos told it how many helpers it may run' });
    return { state: projects.TOLD.TOLD, because: null };
  } catch (err) {
    return { state: projects.TOLD.COULD_NOT, because: (err && err.message) || 'we could not write to its instructions' };
  }
}

/* ---- the meter ------------------------------------------------------------------ */

/* Local midnight of `now`: "today" is the person's day, not UTC's. */
function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* The four token counts Claude reports, summed. One definition for the limit, the
   ratio and the display. */
function tokensOf(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  let t = 0;
  for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
    if (Number.isFinite(usage[k]) && usage[k] > 0) t += usage[k];
  }
  return t;
}

/* Per-file cache: a status tick must not re-read unchanged transcripts. Keyed on the
   path, valid while size and mtime match and the day has not turned. */
const fileCache = new Map();

/* One transcript file: tokens written since `since`, and whether it has finished
   (its last assistant message ended the turn). Never throws. */
function readFile(file, since) {
  let st;
  try { st = fs.statSync(file); } catch { return { tokens: 0, finished: true, mtimeMs: 0 }; }
  const hit = fileCache.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs && hit.since === since) return hit.value;
  let tokens = 0;
  let finished = false;
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { raw = ''; }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'assistant' || !j.message || typeof j.message !== 'object') continue;
    finished = j.message.stop_reason === 'end_turn';
    const at = Date.parse(j.timestamp || '');
    if (Number.isFinite(at) && at >= since) tokens += tokensOf(j.message.usage);
  }
  const value = { tokens, finished, mtimeMs: st.mtimeMs };
  fileCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, since, value });
  return value;
}

/**
 * Today's metering for a lead whose CURRENT transcript is `transcriptPath`. Every
 * session the lead ran today lives beside it (one folder per agent: each agent has
 * its own working directory), each with its helpers in `<session>/subagents/`.
 *   { tokensToday, leadTokens, helperTokens, activeHelpers }
 * activeHelpers counts only helpers of sessions written in the last ACTIVE_WINDOW_MS
 * that have not finished. Never throws; no transcript is all zeros.
 */
function meter(transcriptPath, now = Date.now()) {
  const out = { tokensToday: 0, leadTokens: 0, helperTokens: 0, activeHelpers: 0 };
  if (typeof transcriptPath !== 'string' || !transcriptPath) return out;
  const dir = path.dirname(transcriptPath);
  const since = startOfDay(now);
  let names;
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const file = path.join(dir, n);
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    const subDir = path.join(dir, n.slice(0, -'.jsonl'.length), 'subagents');
    if (st.mtimeMs >= since) out.leadTokens += readFile(file, since).tokens;
    let subs;
    try { subs = fs.readdirSync(subDir); } catch { subs = []; }
    for (const s of subs) {
      if (!s.endsWith('.jsonl')) continue;
      const sf = path.join(subDir, s);
      let sst;
      try { sst = fs.statSync(sf); } catch { continue; }
      if (sst.mtimeMs < since) continue;
      const r = readFile(sf, since);
      out.helperTokens += r.tokens;
      if (!r.finished && now - r.mtimeMs <= ACTIVE_WINDOW_MS) out.activeHelpers += 1;
    }
  }
  out.tokensToday = out.leadTokens + out.helperTokens;
  return out;
}

/**
 * The `swarm` field of a board card, or null for an ordinary agent. `transcriptFor`
 * is a function so an ordinary agent never pays for resolving its transcript.
 */
function cardField(profile, transcriptFor, now = Date.now()) {
  const s = settingsOf(profile);
  if (!s) return null;
  let t = null;
  try { t = transcriptFor(); } catch { t = null; }
  const m = meter(t, now);
  return {
    maxHelpers: s.maxHelpers,
    activeHelpers: m.activeHelpers,
    tokensToday: m.tokensToday,
    dailyTokenLimit: s.dailyTokenLimit,
    active: s.active,
    pausedBecause: s.pausedBecause,
    /* (lead + helpers) / lead, today: what "up to about N times one agent" really is.
       Null until the lead has spent anything today. */
    helperTokenRatio: m.leadTokens > 0 ? Math.round((m.tokensToday / m.leadTokens) * 10) / 10 : null,
  };
}

/** The settings after a pause for `because` ("limit" or "stopped") at `now`. */
function pausedFor(settings, because, now = Date.now()) {
  return { ...settings, active: false, pausedBecause: because, pausedAt: new Date(now).toISOString() };
}

/**
 * One pass of the daily-limit sweep over the board's cards. For each swarm:
 *   - active and at or over its limit: pause it ("limit"), interrupt it, and say so
 *     in its own DM thread;
 *   - paused by the limit on an EARLIER day: switch it back on (a new day's budget).
 * A pause by the person or by Stop now never lifts by itself. `deps` supplies
 * readProfile, writeProfile, interrupt(name), say(name, text). Never throws; returns
 * what it did, per swarm.
 */
function sweepOnce(cards, deps, now = Date.now()) {
  const did = [];
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || !c.swarm || !c.sessionName || c.isNamedOurs !== true) continue;
    const name = c.sessionName;
    try {
      const profile = deps.readProfile(name);
      const s = settingsOf(profile);
      if (!s) continue;
      if (s.active && s.dailyTokenLimit && c.swarm.tokensToday >= s.dailyTokenLimit) {
        deps.writeProfile(name, { swarm: pausedFor(s, 'limit', now) });
        const stopped = deps.interrupt(name);
        deps.say(name, `I paused myself at today's token limit (${s.dailyTokenLimit} tokens). I'll start again tomorrow, or switch me back on.`);
        did.push({ name, action: 'paused', stopped: Boolean(stopped && stopped.ok) });
      } else if (!s.active && s.pausedBecause === 'limit' && s.pausedAt && Date.parse(s.pausedAt) < startOfDay(now)) {
        deps.writeProfile(name, { swarm: { ...s, active: true, pausedBecause: null, pausedAt: null } });
        did.push({ name, action: 'resumed' });
      }
    } catch (err) {
      did.push({ name, action: 'error', because: String((err && err.message) || err) });
    }
  }
  return did;
}

function resetForTests() { fileCache.clear(); }

module.exports = {
  MIN_HELPERS, MAX_HELPERS, DEFAULT_HELPERS, ACTIVE_WINDOW_MS, PAUSED_BECAUSE, START, END,
  createProblem, birthProfile, settingsOf, patchProblem, applyPatch, pausedSentence,
  blockBody, tellLead, tokensOf, meter, cardField, pausedFor, sweepOnce, startOfDay, resetForTests,
};
