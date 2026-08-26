'use strict';

/**
 * A sender that has no pane, and WHICH RUN of it is speaking (#570).
 *
 * `/api/report` used to learn who is reporting by handing `from_pane` to tmux.
 * A Windows agent has no pane, and neither does an SDK runner that was never in
 * a terminal, so #1000 added this: Kosmos mints a token, hands it to the agent
 * the way it already hands `KOSMOS_PORT`, and the route maps token to agent
 * through a table we own.
 *
 * 🔑 THE PROPERTY, STATED HONESTLY, unchanged from #1000. The pane arm's real
 * guarantee is that AN AGENT CANNOT NAME ITSELF: there is no `from` field, the
 * name is derived, and the roster tie (`isNamedOurs`) decides. This keeps that
 * by the same means, an opaque handle plus a map we own. It is NOT a defence
 * against a process that can read another agent's environment, and the
 * `/api/report` comment says so beside the pane arm.
 *
 * ⭐ WHAT THIS FILE ADDS OVER #1000: ONE TOKEN PER LAUNCH, NOT PER AGENT.
 *
 * #1000 minted one token per agent, so two processes holding it were ONE agent
 * to the record: their reports interleaved into a single timeline with nothing
 * marking two actors, and two of them disagreeing would read as one agent
 * changing its mind. That is not hypothetical. On 2026-08-26 two live
 * `claudebot` sessions ran against one Discord credential for ten hours, and
 * the symptom was a third agent quoting messages the first had never sent. The
 * mechanism built to replace pane-scraping had the same blind spot as the
 * thing it replaced.
 *
 * So a token now carries an INSTANCE: which run of this agent is holding it.
 * Same agent resolution, same tie, same failure shape. What changes is that a
 * second live run becomes VISIBLE (`live()`) instead of silent.
 *
 * ⚠️ AND WHAT IT DOES NOT CATCH, so this is not read as more than it is. It
 * makes duplicate LAUNCHES visible, because Kosmos mints per launch. A process
 * that COPIES another's token still resolves as that instance, and nothing here
 * can tell them apart. The 08-26 incident was two sessions sharing one config
 * dir, which is the copy case, not the launch case. This would have caught it
 * only if both had been started by Kosmos.
 *
 * 🛑 SEMANTIC CHANGE FROM #1000, CALLED OUT BECAUSE IT MOVES A GUARANTEE.
 * `mint` no longer rotates. In #1000, minting again invalidated the previous
 * token, and that was what stopped a recreated agent inheriting the old one's
 * voice. Tokens now COEXIST by design, so that guarantee has moved to
 * `revoke()`, which drops every token for an agent. **A caller that recreates
 * or deletes an agent MUST call `revoke()`**; minting for it is no longer
 * enough. Nothing in the tree mints yet, so this breaks no live caller, but it
 * is a requirement on the creation path when it lands.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DIR = path.join(store.ROOT, 'sendertokens');

/* 32 bytes of CSPRNG. The point of a token over a pane id is that it cannot be
   guessed or enumerated, so the entropy is the feature. */
const TOKEN_BYTES = 32;

/* The instance is a label, not a secret: it names a run in a record a person
   reads. Short enough to sit in a log line, wide enough not to collide. */
const INSTANCE_BYTES = 6;

/* Owner-only. A token is an agent's ability to speak as itself. */
const FILE_MODE = 0o600;

/* A backstop, not a policy. Every launch appends, and an agent restarted in a
   loop would otherwise grow this file without limit. The OLDEST are dropped,
   because the newest run is the one still speaking. */
const MAX_LIVE = 32;

function fileFor(sessionName) {
  return path.join(DIR, store.safeKey(sessionName) + '.json');
}

/**
 * Read the stored tokens, tolerating #1000's single-token shape.
 *
 * ⚠️ MIGRATION, DELIBERATELY SILENT AND ONE-WAY. A `{ token, mintedAt }` file
 * is read as one instance-less entry rather than discarded, so an agent holding
 * a #1000 token keeps working. It is given the instance `legacy` so a reader
 * can see what it is instead of guessing at a null.
 */
function readTokens(sessionName) {
  let raw;
  try { raw = fs.readFileSync(fileFor(sessionName), 'utf8'); } catch { return []; }
  let kept;
  try { kept = JSON.parse(raw); } catch { return []; }
  if (!kept || typeof kept !== 'object') return [];
  if (Array.isArray(kept.tokens)) return kept.tokens.filter((t) => t && typeof t.token === 'string');
  if (typeof kept.token === 'string') return [{ token: kept.token, instance: 'legacy', mintedAt: kept.mintedAt || null }];
  return [];
}

function writeTokens(sessionName, tokens) {
  const file = fileFor(sessionName);
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ tokens }), { mode: FILE_MODE });
}

/**
 * A token for ONE launch of this agent. Returns `{ ok, token, instance }`.
 * Appends: previously minted tokens keep working, which is the point.
 */
function mint(sessionName) {
  try { fileFor(sessionName); } catch {
    return { ok: false, because: 'that is not a name we can key a token on' };
  }
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const instance = crypto.randomBytes(INSTANCE_BYTES).toString('hex');
  try {
    const tokens = readTokens(sessionName);
    tokens.push({ token, instance, mintedAt: new Date().toISOString() });
    writeTokens(sessionName, tokens.slice(-MAX_LIVE));
  } catch (e) {
    return { ok: false, because: 'we could not keep the token for that agent (' + (e && e.message ? e.message : 'no reason given') + ')' };
  }
  return { ok: true, token, instance };
}

/** Drop EVERY token for an agent. A deleted or recreated agent stops speaking. */
function revoke(sessionName) {
  try { fs.unlinkSync(fileFor(sessionName)); return { ok: true }; } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true };
    return { ok: false, because: 'we could not remove that agent\'s tokens' };
  }
}

/** Drop ONE run's token, leaving the agent's other live runs alone. */
function retire(sessionName, instance) {
  try {
    const left = readTokens(sessionName).filter((t) => t.instance !== instance);
    if (left.length === 0) return revoke(sessionName);
    writeTokens(sessionName, left);
    return { ok: true };
  } catch { return { ok: false, because: 'we could not retire that run' }; }
}

/**
 * Which runs of this agent currently hold a token.
 *
 * ⭐ THIS IS THE DETECTION. More than one means more than one live run, which
 * is the thing four external checks could not answer on 2026-08-26.
 */
function live(sessionName) {
  return readTokens(sessionName).map((t) => t.instance);
}

/* Constant-time compare, so a caller cannot learn a token a byte at a time.
   Length first: timingSafeEqual throws on a mismatch, and length is not the
   secret. */
function sameToken(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * Who is presenting this token, and which run of them. Returns
 * `{ ok, card, instance }` or `{ ok:false, because }`, the same contract
 * `messages.resolveSender` keeps.
 *
 * ⚠️ THE ROSTER TIE IS NOT OPTIONAL. A token whose agent is not a tied row
 * resolves to nothing: the token says WHICH row to look at, the roster decides
 * whether that row may speak.
 */
function resolve(token, roster) {
  const presented = String(token == null ? '' : token).trim();
  if (!presented) {
    return { ok: false, because: 'we cannot tell which agent is sending this (no sender token was presented)' };
  }
  let names;
  try {
    names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, because: 'we could not match that to one of your agents' };
    return { ok: false, because: 'we could not read the sender tokens, so we could not tell who this is from' };
  }
  for (const f of names) {
    const key = f.slice(0, -'.json'.length);
    let held;
    try { held = readTokens(key); } catch { continue; }
    const hit = held.find((t) => sameToken(t.token, presented));
    if (!hit) continue;
    const card = Array.isArray(roster)
      ? roster.find((a) => a && a.sessionName && store.safeKey(a.sessionName) === key && a.isNamedOurs === true)
      : null;
    /* A token matching a file but no tied roster row is the revoked or stale
       case, and it must read the same as a token we never issued. Saying "that
       agent is gone" would confirm the token was once real. */
    if (!card) return { ok: false, because: 'we could not match that to one of your agents' };
    return { ok: true, card, instance: hit.instance || null };
  }
  return { ok: false, because: 'we could not match that to one of your agents' };
}

module.exports = { mint, revoke, retire, live, resolve, DIR, MAX_LIVE };
