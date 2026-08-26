'use strict';

/**
 * A sender that has no pane (#570 item 2, contract on that card).
 *
 * `/api/report` learns who is reporting by handing `from_pane` to
 * `messages.resolveSender`, which asks tmux which session owns that pane.
 * That works because every agent we have ever run lives in a tmux pane. A
 * Windows agent does not have one, and neither does an SDK runner that was
 * never in a terminal, so the identity has to come from somewhere else.
 *
 * 🔑 THE PROPERTY WE ARE PRESERVING, STATED HONESTLY. The pane path's real
 * guarantee is that AN AGENT CANNOT NAME ITSELF: there is no `from` field, the
 * name is derived, and the roster tie (`isNamedOurs`) stops an untied pane
 * borrowing an agent's session name. That is the property worth keeping and
 * this module keeps it, by the same means: the caller presents an opaque
 * handle, never a name, and the map from handle to agent belongs to us.
 *
 * ⚠️ AND THE PART THE PANE PATH DOES NOT GIVE US, so that nothing here is
 * built on a stronger claim than the code supports. A pane id looks like `%7`,
 * is stable, and anything on this Mac can list them all with `tmux
 * list-panes`; the server binds loopback and has no auth (server.js). So a
 * local process can already report as any agent by naming its pane. A token
 * is strictly better on exactly that axis (unguessable, unlistable) and is
 * still not a defence against a process that can read the agent's own
 * environment. Whether THAT matters is the trust-boundary question on #570,
 * and it is a product decision, not this module's to assume.
 *
 * ⚠️ ONE RESOLVER CHAIN, NOT A SECOND IDENTITY SYSTEM. This is the token arm;
 * the pane arm stays exactly as it is. Both return the same `{ ok, card }`,
 * enforce the same tie, and fail with the same shape, because a Windows path
 * living beside a Mac path is two copies of one fact and they drift.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DIR = path.join(store.ROOT, 'sendertokens');

/* 32 bytes of CSPRNG, hex. The point of the token over the pane is that it
   cannot be guessed or enumerated, so the entropy is the feature. */
const TOKEN_BYTES = 32;

/* Owner-only. The token is the agent's ability to speak as itself, so it is
   kept the way a credential is kept, not the way a config file is. */
const FILE_MODE = 0o600;

function fileFor(sessionName) {
  return path.join(DIR, store.safeKey(sessionName) + '.json');
}

/**
 * Give this agent a fresh token, replacing any it had.
 *
 * 🔑 MINTING IS ROTATION. An agent that is recreated must not inherit the old
 * one's ability to speak, which is the revocation half of the contract: the
 * previous token stops resolving the moment this returns.
 */
function mint(sessionName) {
  let file;
  try { file = fileFor(sessionName); } catch {
    return { ok: false, because: 'that is not a name we can key a token on' };
  }
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ token, mintedAt: new Date().toISOString() }), { mode: FILE_MODE });
  } catch (e) {
    return { ok: false, because: 'we could not keep the token for that agent (' + (e && e.message ? e.message : 'no reason given') + ')' };
  }
  return { ok: true, token };
}

/** Drop this agent's token. A deleted agent must stop being able to speak. */
function revoke(sessionName) {
  try { fs.unlinkSync(fileFor(sessionName)); return { ok: true }; } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true };
    return { ok: false, because: 'we could not remove that agent\'s token' };
  }
}

/* Constant-time compare, so a caller cannot learn a token one byte at a time
   by measuring us. Length is compared first because timingSafeEqual throws on
   a length mismatch, and the length of a token is not the secret. */
function sameToken(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * Who is presenting this token. Returns `{ ok, card }` or `{ ok:false,
 * because }`, the same contract `messages.resolveSender` keeps.
 *
 * ⚠️ THE ROSTER TIE IS NOT OPTIONAL and is the reason this is not merely a
 * lookup: a token file that outlived its agent, or one belonging to a session
 * we do not own, resolves to nothing. The token says WHICH row to look at; the
 * roster still decides whether that row may speak.
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
    let kept;
    try { kept = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
    if (!kept || !sameToken(kept.token, presented)) continue;
    const key = f.slice(0, -'.json'.length);
    const card = Array.isArray(roster)
      ? roster.find((a) => a && a.sessionName && store.safeKey(a.sessionName) === key && a.isNamedOurs === true)
      : null;
    /* A token that matches a file but no tied roster row is the revoked or
       stale case, and it must read the same as a token we never issued.
       Saying "that agent is gone" would confirm the token was once real. */
    if (!card) return { ok: false, because: 'we could not match that to one of your agents' };
    return { ok: true, card };
  }
  return { ok: false, because: 'we could not match that to one of your agents' };
}

module.exports = { mint, revoke, resolve, DIR };
