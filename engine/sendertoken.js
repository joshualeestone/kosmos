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

/* 🛑 ONE SENTENCE, FOUR CALLERS, AND IT IS A SECURITY PROPERTY RATHER THAN TIDINESS.
   A refusal must not disclose whether a token was ever real: never issued, issued then
   revoked, issued but the roster row is gone, and no such token here all have to read
   IDENTICALLY to whoever is asking. That held until now because four separate string
   literals happened to match.
   ⚠️ Nothing kept them in sync and nothing would have failed if they drifted. Editing
   any one of them to be more helpful is exactly the disclosure this prevents, and the
   suite would have stayed green while the property quietly died.
   Found reviewing #1112 section A, 2026-08-27: the claim was recorded as resting on
   "a returned string I control", singular. It was four. */
const NO_MATCH = 'we could not match that to one of your agents';

/* 🛑 THE SECOND HALF OF #1170, MISSED BY ITS OWN AUTHOR, ONE LINE FROM THE FIX.
   `resolve` and `resolveName` are two paths to one question, and the comment above
   `resolveName` says callers "work on this path exactly as they do on `resolve`".
   That promise was kept by TWO string literals that happened to match, which is the
   same defect #1170 removed from the refusal sentence four lines up.
   ⚠️ Lower stakes than NO_MATCH: this one discloses nothing a caller does not already
   know, since they are the one who sent nothing. It is the DRIFT that matters, not
   the disclosure. Two paths promising identical behaviour, with nothing enforcing it.
   Found 2026-08-27 by sweeping for the class after fixing one instance of it. */
const NO_TOKEN = 'we cannot tell which agent is sending this (no sender token was presented)';

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
  /* 🛑 THE DIRECTORY IS TIGHTENED BEFORE THE WRITE, NOT AFTER. The `mode:` options
     here apply ON CREATE ONLY: on a path that already exists they are SILENTLY
     IGNORED, which is the whole bug. Chmodding the directory afterwards would leave
     the fresh secret sitting in a world-readable directory for the duration of the
     write, on exactly the path this fix exists for, and would leave a window for a
     symlink plant in a loose directory. Same shape and same rationale as
     `engine/remote.js`, which already does mkdir-then-chmod on its state dir. */
  try { fs.chmodSync(DIR, 0o700); } catch { /* see the note below */ }
  fs.writeFileSync(file, JSON.stringify({ tokens }), { mode: FILE_MODE });
  /* ⚠️ BEST EFFORT, AND WHAT THAT COSTS, STATED HONESTLY. A fresh create is already
     0600 from the `mode:` above, so this chmod is redundant there. On a PRE-EXISTING
     loose path it is the only thing that tightens anything, and if it throws the
     token stays world-readable WITH NO SIGNAL. Not thrown because a failed chmod
     must not stop an agent minting, which is the same trade `remote.js` makes.
     📌 Do NOT reword this to say the mode option covers it. It does not, and an
     earlier version of this comment said exactly that: it asserted the false premise
     the fix removes. */
  try { fs.chmodSync(file, FILE_MODE); } catch { /* see the note above */ }
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

/**
 * Every agent this store currently holds a token for, by safeKey'd name.
 *
 * 🔑 WHY THE STORE AND NOT A NEW LIST. The token store is already a roster of
 * agents-by-credential, and unlike the pane roster it does not care how the
 * agent is run. `resolveName`'s comment says exactly this; that reading was
 * per-token, this one is the whole set. A second source of truth for "which
 * agents exist" is the thing this codebase has paid for twice.
 *
 * ⚠️ HELD TOKENS ONLY, so `retire` and `revoke` take an agent off this list
 * the moment they run. That is deliberate and it is what makes the credential
 * the off switch: a cut-off agent stops being listed here, so anything built
 * on this list loses it too rather than needing its own revocation check.
 *
 * ⚠️ RETURNS [] ON AN UNREADABLE STORE, and that is a claim this function is
 * NOT entitled to make. Callers that must tell "nobody" from "we could not
 * look" cannot use this; today's caller adds rows to a roster, so a failed
 * read costs it a row it never had rather than deleting one it did.
 */
function keys() {
  let names;
  try { names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of names) {
    const key = f.slice(0, -'.json'.length);
    let held;
    try { held = readTokens(key); } catch { continue; }
    if (held.length > 0) out.push(key);
  }
  return out;
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
    return { ok: false, because: NO_TOKEN };
  }
  let names;
  try {
    names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, because: NO_MATCH };
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
    if (!card) return { ok: false, because: NO_MATCH };
    return { ok: true, card, instance: hit.instance || null };
  }
  return { ok: false, because: NO_MATCH };
}

/**
 * Which agent does this token belong to, WITHOUT asking the roster?
 *
 * 🛑 WHY THIS EXISTS SEPARATELY FROM `resolve`. `resolve` ends by finding the
 * agent's CARD in the roster, and the roster is built from `tmux list-panes`.
 * That is correct for every caller that needs to know an agent is a live,
 * tied, listable member -- which is every caller today.
 *
 * ⚠️ IT IS EXACTLY WRONG FOR THE ONE CALLER THAT IS TRYING TO ESTABLISH THAT
 * AN AGENT EXISTS AT ALL. A machine with no tmux produces no panes, so no
 * cards, so a PERFECTLY VALID token resolves to nothing -- and the heartbeat
 * whose whole job is to say "I am here" cannot say it. Chicken and egg,
 * and this is the egg.
 *
 * 🔑 THE TOKEN STORE IS ALREADY A ROSTER OF AGENTS-BY-CREDENTIAL, and unlike
 * the pane roster it does not care how the agent is run. This exposes that
 * reading without inventing a second source of truth for it.
 *
 * ⚠️ THE DISCLOSURE PROPERTY OF `resolve` IS PRESERVED, DELIBERATELY. Its
 * comment says a known token with no card "must read the same as a token we
 * never issued", because a distinct message would confirm the token was once
 * real. Every refusal below is the SAME SENTENCE for the same reason: not
 * issued, retired, unreadable store -- one answer.
 *
 * 📌 A RETIRED TOKEN CANNOT PASS. `readTokens` returns only currently-held
 * tokens, so `retire`/`revoke` remain the way an agent is cut off, and they
 * work on this path exactly as they do on `resolve`.
 */
function resolveName(token) {
  const presented = String(token == null ? '' : token).trim();
  const no = { ok: false, because: NO_MATCH };
  if (!presented) {
    return { ok: false, because: NO_TOKEN };
  }
  let names;
  try { names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')); } catch { return no; }
  for (const f of names) {
    const key = f.slice(0, -'.json'.length);
    let held;
    try { held = readTokens(key); } catch { continue; }
    const hit = held.find((t) => sameToken(t.token, presented));
    if (!hit) continue;
    /* The filename IS the safeKey'd session name; that is the mapping `mint`
       wrote and the only name this store knows. */
    return { ok: true, key, instance: hit.instance || null };
  }
  return no;
}

module.exports = { mint, revoke, retire, live, keys, resolve, resolveName, DIR, MAX_LIVE };
