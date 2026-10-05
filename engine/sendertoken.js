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
const securewrite = require('./securewrite');
const { withFileLock } = require('./filelock');

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

/* #1787: the temp-then-rename writer, the symlink refusal and the directory
   tightening now live in `engine/securewrite.js`, extracted from THIS file after
   #1776 so that three more call sites could use one implementation rather than a
   fourth copy. `refuseSymlinkTarget` is NOT re-exported
   here: this module no longer calls it, and re-exporting a function it does not use
   would imply an ownership it does not have. Its arms call the owning module. */
function writeTokens(sessionName, tokens) {
  const file = fileFor(sessionName);
  /* The directory is tightened BEFORE anything is written, not after: chmodding
     afterwards leaves the fresh secret sitting in a world-readable directory for
     the duration of the write. */
  securewrite.secureDir(DIR, 0o700);
  securewrite.writeSecret(file, JSON.stringify({ tokens }), FILE_MODE);
}

/* 🛑 #1782: mint AND retire are READ-MODIFY-WRITE on one session file, and
   `writeSecret` makes each WRITE atomic but NOT the read-and-write. Two
   PROCESSES that interleave between the read and the write lose a token: the
   second write is built from a list that predates the first, so a live agent's
   token vanishes from the file while that agent is still using it. This module
   exists to make duplicate launches visible, so a silently-lost token is exactly
   the case it must not produce. Same-process callers cannot hit it (`writeSecret`
   is synchronous), but two processes are a real launch pattern.
   ✅ A per-session lock serializes the whole critical section across processes. */
/* The per-session lock now lives in engine/filelock.js (kosmos#1823). chat.js's
   withThreadLock (round 19) and this module's withSessionLock (#1782, transcribed
   from it after a blind pass caught three recovery-path bugs the first hand-rolled
   version had) were two copies of one primitive; #1823 extracted it to a shared
   leaf module both delegate to. filelock.js couldn't be chat.js or this module --
   chat.js is required fleet-wide via status.js, which requires this module, so a
   lock in either would be circular; a leaf breaks the cycle. */

const LOCK_BUSY = 'the sender-token store is busy (ELOCKBUSY)';

/* Hold an exclusive per-session lock while running `fn`; returns `{ ok:true, value }`
   or `{ ok:false, because }`. See engine/filelock.js for the lock mechanics
   (rename-steal, age-staleness, owner-token release, umask chmod). */
function withSessionLock(sessionName, fn) {
  securewrite.secureDir(DIR, 0o700);          // the lock lives inside the 0700 store dir
  // Delegates to the shared primitive (kosmos#1823). `fileFor` gives the store
  // path; withFileLock appends `.lock`. The AGENT_WORKFORCE_LOCK_MS override and
  // all the recovery logic now live in engine/filelock.js.
  return withFileLock(fileFor(sessionName), fn, {
    busy: LOCK_BUSY,
    cannotAccess: 'we could not get exclusive access to that agent\'s tokens',
  });
}

/**
 * A token for ONE launch of this agent. Returns `{ ok, token, instance }`.
 * Appends: previously minted tokens keep working, which is the point.
 *
 * #4530: `opts.launcher` names WHAT launched this run (the Mac supervisor passes
 * `supervisor:<tmux session>`), recorded on the token so `retireLauncher` can later
 * drop that launcher's earlier runs. Minting never drops anything itself: a launch
 * that mints and then loses the race for its session must not have cut off the run
 * that won it (review of #4530, W2).
 */
function mint(sessionName, opts = {}) {
  try { fileFor(sessionName); } catch {
    return { ok: false, because: 'that is not a name we can key a token on' };
  }
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const instance = crypto.randomBytes(INSTANCE_BYTES).toString('hex');
  const launcher = (opts && typeof opts.launcher === 'string' && opts.launcher) ? opts.launcher : null;
  let held;
  try {
    /* #1782: read and write under the lock, so a concurrent launch cannot build
       its write from a list that predates ours and drop this token. */
    held = withSessionLock(sessionName, () => {
      const tokens = readTokens(sessionName);
      /* #4792: the agent's own name, exactly as given. The file is keyed by safeKey, which is lossy ("Mara" and
         "mara" share one file), so without this a token could only say which KEY it was for. */
      tokens.push({ token, instance, name: String(sessionName), mintedAt: new Date().toISOString(), ...(launcher ? { launcher } : {}) });
      writeTokens(sessionName, tokens.slice(-MAX_LIVE));
    });
  } catch (e) {
    /* The CODE, not the message. The extracted writer's refusals read "refusing to
       write a secret through a symlink at <absolute path>", and this string is shown
       to the operator. The three token-door sites already report the code for exactly
       this reason; this was the fourth and it was inverted. */
    return { ok: false, because: 'we could not keep the token for that agent' + ((e && e.code) ? ' (' + e.code + ')' : '') };
  }
  if (!held.ok) return { ok: false, because: held.because };   // the store was busy; we did not write
  return { ok: true, token, instance };
}

/* The whole-file unlink, WITHOUT the lock. `retire` calls this while it already
   holds the lock; `revoke` (public) takes the lock around it. */
function revokeUnlocked(sessionName) {
  try { fs.unlinkSync(fileFor(sessionName)); return { ok: true }; } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true };
    return { ok: false, because: 'we could not remove that agent\'s tokens' };
  }
}

/* #4844: whose tokens may one name's untagged SWEEP take, when the file is shared? Returns a predicate for the
   tokens that are NOT this agent's (kept), or null for "take them all", today's rule. Only narrows when the file holds
   named tokens for more than one name AND one of those names is exactly `sessionName`. Tokens with no name (minted
   before #4792, unattributable) are taken as before.
   🛑 FOR THE SWEEP ONLY, NEVER FOR revoke. The sweep's name comes from the supervisor's token_roster_name, the same
   function that names its mint, so the spelling always matches. revoke's callers do not have that: a paneless
   (Windows or remote) agent is removed and created under its KEY spelling (status.js lists it by key) while its
   tokens carry the typed name, so a narrowed revoke kept the removed agent's own tokens and revoked a bystander's
   (review 1, measured). revoke stays whole-key: its cross-name cost is an over-revoke the other agent recovers from by
   relaunching or being re-issued, never a removed agent that can still speak. */
function othersTokens(held, sessionName) {
  let key;
  try { key = store.safeKey(sessionName); } catch { return null; }
  const names = new Set();
  for (const t of held) { const n = tokenName(t, key); if (n) names.add(n); }
  /* `names.size < 2` is only a short-cut (with one name, the predicate below keeps nothing anyway). The second arm
     (this name absent) is defensive: the kept run always carries this name today. Both are tested. */
  if (names.size < 2 || !names.has(String(sessionName))) return null;
  return (t) => { const n = tokenName(t, key); return n !== null && n !== String(sessionName); };
}

/** Drop EVERY token for an agent. A deleted or recreated agent stops speaking.
 *  #1782: under the lock, so a straggler `mint` cannot land its write between the
 *  read and this unlink and resurrect a token the recreate meant to erase -
 *  `create.js` uses `revoke` as exactly that new-agent security gate.
 *  #4844: deliberately WHOLE-KEY, also taking another name's tokens under the same key; see othersTokens for why a
 *  narrowed revoke is unsafe. */
function revoke(sessionName) {
  let held;
  try { held = withSessionLock(sessionName, () => revokeUnlocked(sessionName)); }
  catch { return { ok: false, because: 'we could not remove that agent\'s tokens' }; }
  if (!held.ok) return { ok: false, because: held.because };
  return held.value;
}

/** Drop ONE run's token, leaving the agent's other live runs alone. */
function retire(sessionName, instance) {
  let held;
  try {
    /* #1782: retire is read-modify-write too - filtering one instance out of the
       list and rewriting it. Under the lock, so a concurrent mint/retire cannot
       lose an update the same way. Calls `revokeUnlocked` (not `revoke`) because
       it already holds the lock. */
    held = withSessionLock(sessionName, () => {
      const left = readTokens(sessionName).filter((t) => t.instance !== instance);
      if (left.length === 0) return revokeUnlocked(sessionName);
      writeTokens(sessionName, left);
      return { ok: true };
    });
  } catch { return { ok: false, because: 'we could not retire that run' }; }
  if (!held.ok) return { ok: false, because: held.because };   // busy; carries ELOCKBUSY
  return held.value;
}

/**
 * #4530: drop every token ONE launcher minted for this agent except `keepInstance`.
 * The Mac supervisor calls it once its own run's session exists and is claimed: a
 * session of that name is unique, so every other run that launcher started there has
 * ended, and until now each stayed a valid credential (up to MAX_LIVE; Scorpion had 18).
 * Without `opts.untagged`, tokens with another launcher or none (a remote agent's, an adoption's,
 * anything minted before #4530) are untouched, so this is not the rotation #1000 had: runs from
 * different launchers still coexist and `live()` still shows them.
 *
 * `opts.untagged` (#4530, Scorpion with Kano): also drop tokens with NO launcher. Every Mac
 * run minted before #4530 is untagged (106 on one fleet Mac, 0 tagged), and without this
 * they stay valid until MAX_LIVE newer runs push them out. The supervisor asks for it only
 * on its LAUNCH path (no session of that name existed, so those runs have ended) and only
 * when the -discord twin, which shares this token file, has no session: never when adopting
 * a live run, whose own pre-#4530 token is untagged. Remote agents' tokens are tagged
 * `remote` from #4530 on, so this never reaches them.
 * #4844: with `untagged`, another name's NAMED tokens under the same key are kept (othersTokens); unnamed ones are not.
 */
function retireLauncher(sessionName, launcher, keepInstance, opts = {}) {
  if (typeof launcher !== 'string' || !launcher) return { ok: false, because: 'name the launcher whose runs to retire' };
  let held;
  try {
    held = withSessionLock(sessionName, () => {
      const all = readTokens(sessionName);
      const untagged = !!(opts && opts.untagged);
      /* #4844: the untagged sweep never takes another agent's NAMED tokens when that agent shares this key (on a Mac,
         adopt mints with no launcher). Narrowed only when the file names this agent among others (othersTokens);
         tokens with no name are swept as before. revoke deliberately does NOT narrow: see othersTokens. */
      const theirs = untagged ? othersTokens(all, sessionName) : null;
      const left = all.filter((t) => t.instance === keepInstance
        || (theirs !== null && theirs(t))
        || (t.launcher !== launcher && !(untagged && !t.launcher)));
      if (left.length === all.length) return { ok: true, retired: 0 };
      if (left.length === 0) { const r = revokeUnlocked(sessionName); return r.ok ? { ok: true, retired: all.length } : r; }
      writeTokens(sessionName, left);
      return { ok: true, retired: all.length - left.length };
    });
  } catch { return { ok: false, because: 'we could not retire that launcher\'s runs' }; }
  if (!held.ok) return { ok: false, because: held.because };
  return held.value;
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
 * #5333: is this run's token still on file? For the board to tell a person that a RUNNING agent has lost its link
 * (its session carries the run's instance, @kosmos_token_instance, and the token behind it is gone, so every verb the
 * agent runs is refused). Three answers, because "we could not read the store" must never read as "gone":
 *   'held'     the file holds a token with this instance
 *   'gone'     the file is readable and does not, or there is no file for this agent in a store that exists
 *   'unknown'  the file is there and cannot be read or parsed, is in the old single-token shape, no instance was
 *              given, or there is no token store at all (a board that has never minted)
 * Instances are labels, not secrets (the supervisor stamps them on the session), so nothing here touches a token.
 */
function instanceState(sessionName, instance) {
  if (typeof instance !== 'string' || !/^[0-9a-f]+$/.test(instance)) return 'unknown';
  let raw;
  /* A store directory that does not exist at all says this board has never minted anything (a second board on another
     data root, sharing the tmux server), not that a token was removed: unknown, never lost. */
  try { fs.statSync(DIR); } catch { return 'unknown'; }
  try { raw = fs.readFileSync(fileFor(sessionName), 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? 'gone' : 'unknown'; }
  let kept;
  try { kept = JSON.parse(raw); } catch { return 'unknown'; }
  if (!kept || typeof kept !== 'object' || !Array.isArray(kept.tokens)) return 'unknown';
  return kept.tokens.some((t) => t && typeof t.token === 'string' && t.instance === instance) ? 'held' : 'gone';
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

/* #4792: the name a token was minted for, or null for a token minted before names were kept (or one whose name does
   not key to the file it sits in, which only a hand-edited store could hold: read as unnamed, never trusted). */
function tokenName(t, key) {
  if (!t || typeof t.name !== 'string' || !t.name) return null;
  try { return store.safeKey(t.name) === key ? t.name : null; } catch { return null; }
}

/* #4792: true when the file for this key holds named tokens for more than one name ("Mara" and "mara"). Then the
   KEY no longer says which agent, so nothing may be resolved by key alone (a paneless row, the paneless fallback). */
function namesClash(held, key) {
  const names = new Set();
  for (const t of held) { const n = tokenName(t, key); if (n) names.add(n); }
  return names.size > 1;
}

/* #4763: marks a refusal made because more than one of our running agents shares the token's key. */
const CLASH = Symbol('kosmos.sendertoken.clash');
const CLASH_LOGGED = new Set();
/* #4792: its own set, cleared by nothing: a key whose named tokens clash stays clashed until a token file changes,
   and one twin resolving must not re-arm the other's refusal into a log line per request (review 2). */
const NAMED_CLASH_LOGGED = new Set();

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
    /* #4738: whose row it is FIRST, and a name that cannot be keyed (a stranger's tmux session named "!!") is simply
       not this agent. Keying every row before that check threw "invalid agent name" for the whole roster, so one such
       session sorted ahead of the agents broke every agent's token, with a message that blamed the agent. */
    const keyOf = (name) => { try { return store.safeKey(name); } catch { return null; } };
    /* #4792: a token that carries its agent's name answers for THAT agent only. A row with a tmux session must have
       exactly that name, so "Mara"'s token never resolves as pane agent "mara", running or stopped. A row with no
       session (status.js: a paneless or never-run agent, listed with the KEY as its sessionName) is matched by key,
       and only while no other name has tokens in this file: the board knows such an agent only by its key, so the
       card stays under the key (its messages are addressed and delivered by it). ⚠️ Residual: such a row cannot
       tell remote "Kip" from a stopped "kip" that holds no tokens; see the plan. `session` and not `paneless`:
       paneRoster() rows carry no `paneless` field, and both producers carry `session`. A token minted before names
       were kept has none and falls through below. */
    const named = tokenName(hit, key);
    if (named !== null) {
      const twins = namesClash(held, key);
      const rows = Array.isArray(roster)
        ? roster.filter((a) => a && a.isNamedOurs === true && a.sessionName && (a.session
          ? a.sessionName === named
          : !twins && keyOf(a.sessionName) === key))
        : [];
      if (rows.length !== 1) {
        /* #4792 review 2: a PANE row under this key with another name has shown it is not this token's agent (its
           own token would have matched it). Marked like a clash so the paneless fallback cannot admit this token
           by the key that row keeps alive. A legitimate agent loses nothing: its own row would have matched. */
        const paneTwin = Array.isArray(roster) && roster.some((a) => a && a.isNamedOurs === true && a.session
          && a.sessionName && a.sessionName !== named && keyOf(a.sessionName) === key);
        /* Two names under one key with no row of their own: both go mute, so log it once per key. */
        if (twins && !NAMED_CLASH_LOGGED.has(key)) {
          NAMED_CLASH_LOGGED.add(key);
          console.warn(`[sendertoken] #4792: tokens for more than one name are filed under the key "${key}"; each is refused unless its own pane row is running, until one is removed or renamed`);
        }
        return { ok: false, because: NO_MATCH, ...((twins || paneTwin) ? { [CLASH]: true } : {}) };
      }
      return { ok: true, card: rows[0], instance: hit.instance || null };
    }
    /* #4792: an older token in a file where two names now hold tokens: the key no longer says whose it is. Refused
       here as on the key-only paths (the paneless fallback, the token-only reads, the outbox), marked so the
       fallback does not re-admit it. */
    if (namesClash(held, key)) return { ok: false, because: NO_MATCH, [CLASH]: true };
    const cards = Array.isArray(roster)
      ? roster.filter((a) => a && a.isNamedOurs === true && a.sessionName && keyOf(a.sessionName) === key)
      : [];
    /* A token matching a file but no tied roster row is the revoked or stale
       case, and it must read the same as a token we never issued. Saying "that
       agent is gone" would confirm the token was once real.
       #4763: safeKey is lossy ("Mara" and "mara", "ma.ra" and "mara" share a key, and so one token file), so two
       running agents of ours can both match. Taking the first let one agent's token speak as the other. With
       more than one, NO agent is resolved: the answer is the same as a token we never issued, never a guess.
       Creating an agent and POST /api/agent-token refuse a key clash with a RUNNING pane agent (and, since #4845, the
       token route refuses any created agent's key at issuance); this covers a
       clash they cannot see (a session made outside Kosmos, or two made while one was stopped and now both
       running). It covers ONLY two ROWS: with one of them stopped, or with a remote twin whose paneless row
       dedupes against the pane row, there is one row and the other's token (same file, no owner field)
       resolves as it. #4792 closes that for tokens that carry their name (above); this is the path for older ones.
       The refusal carries CLASH (a Symbol: never serialized, so the words stay NO_MATCH) so the caller's
       paneless fallback, which resolves by key alone, does not re-admit the token as the key. */
    if (cards.length > 1) {
      /* Both agents go mute at once and the answer is NO_MATCH by design, so the operator's only trace is here.
         Once per clash: every request from either agent would otherwise log it; one clean resolve re-arms it. */
      if (!CLASH_LOGGED.has(key)) {
        CLASH_LOGGED.add(key);
        console.warn(`[sendertoken] #4763: ${cards.length} agents of ours are filed under the token key "${key}" (${cards.map((c) => c.sessionName).join(', ')}); their tokens are refused until one is renamed or stopped`);
      }
      return { ok: false, because: NO_MATCH, [CLASH]: true };
    }
    if (cards.length !== 1) return { ok: false, because: NO_MATCH };
    CLASH_LOGGED.delete(key);   // the clash (if there was one) is over, so a later one logs again
    const card = cards[0];
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
    /* The filename IS the safeKey'd session name. #4792: `name` is the agent's own name when the token carries it
       (null for an older token: the caller has only the key). `twins` says this file holds named tokens for more
       than one name, so the KEY alone does not say which agent: a caller that resolves by key must refuse. */
    return { ok: true, key, name: tokenName(hit, key), twins: namesClash(held, key), instance: hit.instance || null };
  }
  return no;
}

/**
 * #4491: the agents that launch with KOSMOS_AGENT_TOKEN_ONLY=1, so their CLIs, report hook and bridges present
 * their own token alone and never read the board token. Read by the Mac supervisor's launch (bin/agent-supervisor.sh)
 * only: a Windows launch or an adopted agent does not read it yet. The pilot setting, one agent first: a file beside the
 * token store, `{ "agents": ["<roster name>", ...] }`, matched EXACTLY (not by safeKey, which two names can
 * share, #4792). Under the agent's OWN store root: a named-world agent reads its world's file, not the default's.
 * Anything else (no file, unreadable, a wrong shape) is false, today's behaviour: the switch only
 * ever narrows an agent, so failing toward off is failing toward what every agent does now.
 */
function tokenOnlyFile() { return path.join(store.ROOT, 'agent-token-only.json'); }
function tokenOnlyFor(name) {
  if (typeof name !== 'string' || !name) return false;
  let j;
  try { j = JSON.parse(fs.readFileSync(tokenOnlyFile(), 'utf8')); } catch { return false; }
  return !!(j && Array.isArray(j.agents) && j.agents.some((a) => a === name));
}

module.exports = {
  mint, revoke, retire, retireLauncher, live, instanceState, keys, resolve, resolveName, tokenOnlyFor, tokenOnlyFile, CLASH, DIR, MAX_LIVE,
  NO_MATCH };   // #5333: exported so the CLIs' recovery hint is pinned to the one sentence (cli.token-refused-5333.test.js)
