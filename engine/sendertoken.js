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
/* ⭐ THIS LOCK IS chat.js's PROVEN `withThreadLock` (round 19), TRANSCRIBED
   rather than reinvented. A first hand-rolled version reintroduced three bugs
   chat.js had already fixed and a blind pass caught them: a `rmdir` break that
   two waiters can BOTH win (each demolishing the other's fresh lock and walking
   into the section together); a crash between `mkdir` and writing the owner that
   leaves an owner-less lock no liveness check can break, wedging the session
   forever; and no age fallback for either. The two file locks should be ONE
   shared primitive, but that must touch chat.js (required fleet-wide via
   status.js, which requires THIS module - so extracting it here would be
   circular), so it is filed as its own reviewed change: kosmos#1823. */
const LOCK_WAIT_MS = 2000;        // total wait for a live holder before failing safe
const LOCK_STALE_MS = 10 * 1000;  // the section is two file ops; a lock older than this is debris, broken not waited
const LOCK_SPIN_MS = 20;

const PARK = new Int32Array(new SharedArrayBuffer(4));
function pauseMs(ms) {
  try { Atomics.wait(PARK, 0, 0, ms); }
  catch { const end = Date.now() + ms; while (Date.now() < end) { /* no SharedArrayBuffer: bounded spin */ } }
}

const LOCK_BUSY = 'the sender-token store is busy (ELOCKBUSY)';

/* Run `fn` holding an exclusive per-session lock; returns `{ ok:true, value }`,
   or `{ ok:false, because }` when the lock cannot be taken. It NEVER throws for
   the lock itself - a `fn` throw propagates through the release. The lock is a
   DIRECTORY (`mkdirSync` is atomic, EEXIST if held).

   🛑 A stale lock is STOLEN BY RENAME, not `rmdir`. Two waiters can both measure
   one as stale; with `rmdir` both remove it and both proceed - the second
   demolishing the first's fresh lock and entering the section beside it, the
   exact interleave this prevents, through the path that repairs it. `rename` of a
   path succeeds ONCE; the loser gets ENOENT and loops. Rename also copes with a
   non-empty lock dir a crash can leave, which `rmdir` cannot.
   🛑 Staleness is by AGE, not owner liveness, so a crash between `mkdir` and the
   owner write - an owner-less lock no liveness check could break - is collected. */
function withSessionLock(sessionName, fn) {
  securewrite.secureDir(DIR, 0o700);          // the lock lives inside the 0700 store dir
  const lock = fileFor(sessionName) + '.lock';
  const waitMs = Number(process.env.AGENT_WORKFORCE_LOCK_MS);
  const until = Date.now() + (Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : LOCK_WAIT_MS);
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (e) {
      if (!e || e.code !== 'EEXIST') return { ok: false, because: 'we could not get exclusive access to that agent\'s tokens' };
      if (Date.now() > until) return { ok: false, because: LOCK_BUSY };
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { age = Infinity; }
      if (age > LOCK_STALE_MS) {
        const aside = `${lock}.${process.pid}.${Date.now()}.stale`;
        try { fs.renameSync(lock, aside); }
        catch { pauseMs(LOCK_SPIN_MS); continue; }   // someone else won the steal, or it vanished
        try { fs.rmSync(aside, { recursive: true, force: true, maxRetries: 5 }); } catch { /* debris, not fatal */ }
        continue;
      }
      pauseMs(LOCK_SPIN_MS);
    }
  }
  /* 🛑 THE LOCK DIR AND ITS owner FILE MUST BE OWNER-ACCESSIBLE WHATEVER THE UMASK.
     `mkdirSync`/`writeFileSync` take their mode from the process umask, and a
     restrictive one (the #1761 umask test sets 0o600) leaves the dir without owner
     WRITE (the owner file cannot be created) and the owner file without owner READ
     (the release's `readFileSync` below then throws, `ours` is false, the lock is
     NOT removed, and the session wedges: the next op finds a fresh un-releasable
     lock). Passing a `mode` does not help - it is masked by the same umask. So
     chmod both back to owner-only after creating them; best-effort, since a chmod
     failure only means the release cannot prove ownership and leaves the lock for
     the staleness rule. */
  const ownerFile = path.join(lock, 'owner');
  try { fs.chmodSync(lock, 0o700); } catch { /* best-effort */ }
  /* A token in the lock makes ownership checkable, so a holder whose section
     outlived LOCK_STALE_MS and was stolen does not delete the SUCCESSOR's lock on
     the way out. Losing the marker (an unwritable dir) only means we cannot prove
     the lock is ours, so we leave it for the staleness rule to collect. */
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  let marked = false;
  try { fs.writeFileSync(ownerFile, token); fs.chmodSync(ownerFile, 0o600); marked = true; } catch { marked = false; }
  try {
    return { ok: true, value: fn() };
  } finally {
    let ours = marked;
    if (marked) { try { ours = fs.readFileSync(ownerFile, 'utf8') === token; } catch { ours = false; } }
    if (ours) { try { fs.rmSync(lock, { recursive: true, force: true, maxRetries: 5 }); } catch { /* already gone */ } }
  }
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
  let held;
  try {
    /* #1782: read and write under the lock, so a concurrent launch cannot build
       its write from a list that predates ours and drop this token. */
    held = withSessionLock(sessionName, () => {
      const tokens = readTokens(sessionName);
      tokens.push({ token, instance, mintedAt: new Date().toISOString() });
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

/** Drop EVERY token for an agent. A deleted or recreated agent stops speaking.
 *  #1782: under the lock, so a straggler `mint` cannot land its write between the
 *  read and this unlink and resurrect a token the recreate meant to erase -
 *  `create.js` uses `revoke` as exactly that new-agent security gate. */
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

module.exports = {
  mint, revoke, retire, live, keys, resolve, resolveName, DIR, MAX_LIVE };
