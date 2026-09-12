'use strict';
/**
 * #1704 PR2 (plan §5, "keep running: nothing sent is lost"): an agent's sends
 * that its Kosmos could not take, kept in the agent's OWN Kosmos until that
 * Kosmos is the one open again.
 *
 * 🛑 THE DEFECT THIS EXISTS FOR. On a world switch the person may keep a
 * Kosmos's agents running (Josh's decision 2). Board tokens are per world, so a
 * kept-running agent's `kosmos reply` reached the board serving ANOTHER Kosmos,
 * which refused it as a stranger's, and the answer the person was waiting for
 * was gone. Every agent-side request now names its world (`x-kosmos-world`,
 * launchidentity.WORLD_HEADER); a board serving another world answers 421
 * `{wrongWorld:true}`; and the client keeps the send here instead of losing it.
 *
 * 🔑 THE AGENT'S OWN STORE, NOT THE BOARD'S. The client runs inside the agent's
 * process tree, whose environment already points store.ROOT at the agent's world
 * (on Windows the boot shim applies it; on the Mac the supervisor hands each pane
 * KOSMOS_WORLD and the world's store roots, #2874). So `<store.ROOT>/outbox/` is
 * exactly the store the right board drains once it is serving that world again.
 * store.ROOT is read at each call, never frozen at require.
 *
 * WHAT IS KEPT: a reply, a msg or a post. A report is NOT kept -- a state the
 * agent was in while its Kosmos was closed is stale by the time it opens -- and
 * a reaction toggles room state the agent can no longer see, so both are
 * refused by the clients instead.
 *
 * ⚠️ `from` IS DECIDED AT KEEP TIME, in the agent's process, from the same
 * credentials its live sends present: the launch token first
 * (sendertoken.resolveName), else the tmux session its pane is in, named the way
 * the board names it and only when that name is an agent in this store. It is
 * not a credential check at drain time: the drain only checks that the name is
 * an agent in the Kosmos it drains. That is the same-account trust the
 * board.token class already rests on (see the plan's "weakest part").
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');
const securewrite = require('./securewrite');
const launchidentity = require('./launchidentity');

/* Under store.ROOT, beside the other per-world records. */
const OUTBOX_DIRNAME = 'outbox';

/* The sends worth keeping for later: the ones a person or a colleague is waiting
   to read. See the header for why report and react are not among them. */
const KEPT_VERBS = Object.freeze(['reply', 'msg', 'post']);

/* A kept-running agent is prompted by nobody while its Kosmos is closed, so a
   real outbox holds a handful of entries. 500 bounds an agent stuck in a loop
   without ever refusing a real one. */
const MAX_ENTRIES = 500;

/* The same bound, in bytes: 500 entries at the per-entry ceiling below would be
   48 MiB, far past what a closed Kosmos should hold on disk for one person. */
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

/* A msg body may be up to messages.MAX_BODY (64 KiB) before the board calls it a
   document; the rest is the JSON envelope around it. */
const MAX_ENTRY_BYTES = 96 * 1024;

/* How long a kept msg or post that cannot be placed is retried before it is
   given up (logged, and a msg leaves a refused row for its sender). A switch
   back is hours or days; a week bounds an entry the board will refuse forever
   (a marker in the text, a project that is gone). */
const OUTBOX_RETRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/* How many sends one drain pass hands to delivery. A msg or a post is tmux work
   on the board's one thread, and a Codex recipient adds chat's blocking
   CODEX_ENTER_GAP_MS pause per send, all right as the person reopens the Kosmos;
   a full outbox (500) in one pass could hold every request for many seconds
   (review round 1). 20 keeps a pass short. A pass that stops at the cap returns
   where it stopped (`next`), and the board runs the rest from there on the next
   turn of its event loop (server.js startOutboxDrain), so entries still waiting
   for a retry cannot starve newer ones. */
const MAX_DELIVERIES_PER_PASS = 20;

/* Owner-only, as every other secret-bearing store write: an entry holds the
   agent's words. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/* `<13-digit ms>-<8 hex>`, so a plain sort is send order and nothing else in the
   directory (securewrite's `.tmp` temps included) is ever read as an entry. */
const ENTRY_ID_RE = /^\d{13}-[0-9a-f]{8}$/;
const ENTRY_FILE_SUFFIX = '.json';

/* A session name as the board keys it. Checked at keep and again at drain, so a
   hand-written file cannot put anything else in a log line or a thread key. */
const SENDER_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

/* The sentences the agent-side clients print on a 421. One copy: the Windows CLI
   reads these, the Node keep entry below prints `kept`, and install/kosmos's
   shell copies of `staleReport` and `notOpen` are pinned equal by a test. */
const WRONG_WORLD_SENTENCES = Object.freeze({
  kept: 'Kept. Your Kosmos is not the one open right now; it will be there when it is.',
  staleReport: 'Not recorded: your Kosmos is not the one open right now, and this report would be out of date by the time it is.',
  notOpen: 'Your Kosmos is not the one open right now, so that could not be done. Try again once it is open.',
});

const NO_SENDER = 'We could not tell which agent this is from, so it was not kept. Send it again once your Kosmos is open.';

/* Review round 1: a person typing `kosmos reply` in their OWN tmux window meets
   the same 421 an agent does (every call names a Kosmos, `default` without
   KOSMOS_WORLD). Keeping it under their window's name printed "Kept." for a send
   the drain then drops as not an agent. Before this branch the pane route
   refused it with a sentence; this is that refusal. */
const NOT_AN_AGENT_WINDOW = 'This window is not one of your agents, so nothing was kept. The Kosmos open right now is a different one; send this from an agent, or from the Kosmos that is open.';

function outboxDir() { return path.join(store.ROOT, OUTBOX_DIRNAME); }

function entryFile(id) { return path.join(outboxDir(), id + ENTRY_FILE_SUFFIX); }

function isEntryName(name) {
  return name.endsWith(ENTRY_FILE_SUFFIX) && ENTRY_ID_RE.test(name.slice(0, -ENTRY_FILE_SUFFIX.length));
}

function validEntry(e) {
  return Boolean(e) && typeof e === 'object'
    && KEPT_VERBS.includes(e.verb)
    && typeof e.from === 'string' && SENDER_NAME_RE.test(e.from)
    && Boolean(e.body) && typeof e.body === 'object' && !Array.isArray(e.body)
    && typeof e.at === 'string' && !Number.isNaN(Date.parse(e.at));
}

/* How many entries the outbox holds and their total size. ENOENT is an empty
   outbox; any other failure throws for the caller to report. */
function heldNow() {
  let names;
  try { names = fs.readdirSync(outboxDir()); } catch (e) {
    if (e && e.code === 'ENOENT') return { count: 0, bytes: 0 };
    throw e;
  }
  let count = 0;
  let bytes = 0;
  for (const name of names) {
    if (!isEntryName(name)) continue;
    count += 1;
    try { bytes += fs.statSync(path.join(outboxDir(), name)).size; } catch (e) {
      if (!(e && e.code === 'ENOENT')) throw e;   // drained between the list and the stat
    }
  }
  return { count, bytes };
}

/**
 * Keep one send for later. `{verb, body, from, at}`: `body` is the JSON the client
 * sent the route, `at` defaults to now. Returns `{ ok:true, id }` or
 * `{ ok:false, because }` (a person-facing sentence).
 */
function keep(send) {
  const { verb, body, from, at } = send || {};
  if (!KEPT_VERBS.includes(verb)) return { ok: false, because: 'Only a reply, a message or a post can be kept for later.' };
  if (typeof from !== 'string' || !SENDER_NAME_RE.test(from)) return { ok: false, because: NO_SENDER };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, because: 'There was nothing to keep.' };
  const keptAt = (typeof at === 'string' && !Number.isNaN(Date.parse(at)))
    ? new Date(Date.parse(at)).toISOString() : new Date().toISOString();
  const json = JSON.stringify({ verb, body, from, at: keptAt });
  const size = Buffer.byteLength(json);
  if (size > MAX_ENTRY_BYTES) {
    return { ok: false, because: 'That is too long to keep for later, so it was not kept. Put it in a file and send the path once your Kosmos is open.' };
  }
  let held;
  try { held = heldNow(); } catch (e) {
    return { ok: false, because: 'We could not look at what is already kept (' + ((e && e.code) || 'unknown') + '), so this was not kept.' };
  }
  if (held.count >= MAX_ENTRIES || held.bytes + size > MAX_TOTAL_BYTES) {
    return { ok: false, because: 'Your Kosmos is not the one open right now, and it is already holding as much as it can keep for you (' + MAX_ENTRIES + ' sends), so this one was not kept. Send it again once your Kosmos is open.' };
  }
  const id = String(Date.now()).padStart(13, '0') + '-' + crypto.randomBytes(4).toString('hex');
  try {
    securewrite.secureDir(outboxDir(), DIR_MODE);
    securewrite.writeSecret(entryFile(id), json, FILE_MODE);
  } catch (e) {
    return { ok: false, because: 'We could not keep it (' + ((e && e.code) || 'unknown') + '), so it was not kept.' };
  }
  return { ok: true, id };
}

/**
 * Every kept entry, oldest first: `{ id, entry }`, or `{ id, entry:null, because }`
 * for a file that is not a readable entry (the drain drops and logs those).
 * Throws when the directory itself cannot be read (not ENOENT).
 */
function list() {
  let names;
  try { names = fs.readdirSync(outboxDir()); } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const name of names.filter(isEntryName).sort()) {
    const id = name.slice(0, -ENTRY_FILE_SUFFIX.length);
    let text;
    try { text = fs.readFileSync(entryFile(id), 'utf8'); } catch (e) {
      if (e && e.code === 'ENOENT') continue;   // removed since the readdir
      out.push({ id, entry: null, because: 'it could not be read (' + ((e && e.code) || 'unknown') + ')' });
      continue;
    }
    let entry;
    try { entry = JSON.parse(text); } catch {
      out.push({ id, entry: null, because: 'it is not JSON' });
      continue;
    }
    if (!validEntry(entry)) { out.push({ id, entry: null, because: 'it is not the shape of a kept send' }); continue; }
    out.push({ id, entry });
  }
  return out;
}

/** Remove one entry. Already gone is success. */
function remove(id) {
  if (typeof id !== 'string' || !ENTRY_ID_RE.test(id)) return { ok: false, because: 'that is not a kept send' };
  try { fs.unlinkSync(entryFile(id)); return { ok: true }; } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true };
    return { ok: false, because: 'we could not remove it (' + ((e && e.code) || 'unknown') + ')' };
  }
}

/**
 * Which agent is keeping this, decided in the agent's own process from the same
 * credentials its live sends present. `{ ok:true, name }` or `{ ok:false, because }`.
 * The name is always the bare name the board files the agent under (its profile,
 * its roster card, its thread), so the drain's "is this an agent here" check and
 * the delivery see the same name.
 *
 * 1. The launch token (Windows, and Mac agents minted since #1077), through
 *    sendertoken.resolveName against this world's token store. The supervisor
 *    mints it under the bare roster name already (#2874: the session without
 *    `+<world>`, then without `-discord`). A token that is presented and does not
 *    resolve is a refusal, never a fall back to the pane: the no-downgrade rule
 *    server.js's resolveAgentSender keeps.
 * 2. Else the tmux session of TMUX_PANE, through the same messages.paneSession the
 *    pane route uses (the Mac), named by launchidentity.agentNameFromSession in
 *    this process's own world -- the rule status.parsePanes names roster cards by,
 *    so `angel-discord` is `angel` and a named world's `ava+qa` is `ava` (review
 *    round 2) -- and kept only when that name has a profile in THIS store: a
 *    person's own tmux window is not an agent, and neither is another Kosmos's
 *    session (review round 1). The pane route's own tie is the roster, which a
 *    board serving another Kosmos cannot give; the profile is this Kosmos's record
 *    of its agents.
 * 3. Else nobody: refused with a sentence.
 *
 * `seams` ({resolveName, paneSession}) is for tests; both default to the real
 * modules, required only on the arm that needs them.
 */
function resolveKeepSender(env, seams) {
  const e = env || process.env;
  const s = seams || {};
  const token = require('./kosmos-report-hook').agentToken(e);
  if (token) {
    const resolveName = s.resolveName || ((t) => require('./sendertoken').resolveName(t));
    const found = resolveName(token);
    if (found && found.ok && SENDER_NAME_RE.test(String(found.key))) return { ok: true, name: String(found.key) };
    return { ok: false, because: NO_SENDER };
  }
  const pane = String(e.TMUX_PANE || '').trim();
  if (pane) {
    const paneSession = s.paneSession || ((p) => require('./messages').paneSession(p));
    const found = paneSession(pane);
    if (!(found && found.ok && found.session)) return { ok: false, because: NO_SENDER };
    const name = launchidentity.agentNameFromSession(String(found.session), launchidentity.currentWorldId(e));
    if (name === null || !SENDER_NAME_RE.test(name)) return { ok: false, because: NOT_AN_AGENT_WINDOW };
    if (Object.keys(store.readProfile(name)).length === 0) return { ok: false, because: NOT_AN_AGENT_WINDOW };
    return { ok: true, name };
  }
  return { ok: false, because: NO_SENDER };
}

/** The client side of a 421: work out who is sending, then keep it. */
function keepFromClient(send) {
  const { verb, body, env, seams, at } = send || {};
  const sender = resolveKeepSender(env, seams);
  if (!sender.ok) return sender;
  return keep({ verb, body, from: sender.name, at });
}

/* Ids this process delivered or dropped but could not delete. Skipped (and the
   delete retried) on later drains, so an unlink that keeps failing cannot deliver
   the same reply every minute. A restart forgets it, which can cost one duplicate. */
const settledButNotRemoved = new Set();
/* The last retry reason logged per id, so a stuck entry logs when its reason
   changes rather than every minute for a week. */
const lastRetryReason = new Map();

/**
 * One drain pass: deliver what this Kosmos has kept, through the caller's
 * delivery functions. Each `deliverX(entry)` returns `{ outcome: 'delivered' |
 * 'dropped' | 'retry', because }`; `knownAgent(name)` says whether a name is an
 * agent in this Kosmos. A `from` that is not is dropped. `onExpired(entry,
 * because)` hears an entry given up after OUTBOX_RETRY_MAX_AGE_MS. `log(line)`
 * defaults to stderr; no line carries a send's text.
 *
 * At most `maxDeliveries` (default MAX_DELIVERIES_PER_PASS) entries are handed to
 * a deliverer per pass, starting after the id `after` when given. A pass that
 * stops at the cap returns `next`, the id to continue after; otherwise `next` is
 * null. Returns `{ delivered, dropped, waiting, next }`.
 */
function drain(handlers) {
  const h = handlers || {};
  const log = h.log || ((line) => process.stderr.write('Kosmos outbox: ' + line + '\n'));
  const now = typeof h.now === 'function' ? h.now() : Date.now();
  const cap = (Number.isInteger(h.maxDeliveries) && h.maxDeliveries > 0) ? h.maxDeliveries : MAX_DELIVERIES_PER_PASS;
  const after = typeof h.after === 'string' ? h.after : '';
  const deliverers = { reply: h.deliverReply, msg: h.deliverMsg, post: h.deliverPost };
  const summary = { delivered: 0, dropped: 0, waiting: 0, next: null };

  const finish = (id, dropLine) => {
    if (dropLine) { summary.dropped += 1; log('dropped ' + dropLine); }
    lastRetryReason.delete(id);
    const gone = remove(id);
    if (gone.ok) { settledButNotRemoved.delete(id); return; }
    settledButNotRemoved.add(id);
    log('could not remove ' + id + ' after it was settled (' + gone.because + '); it will not be delivered again by this board');
  };

  let listed;
  try { listed = list(); } catch (e) {
    log('could not read the outbox at ' + outboxDir() + ' (' + ((e && e.code) || (e && e.message) || 'unknown') + '); nothing was delivered this time');
    return summary;
  }
  let handed = 0;
  let lastHanded = null;
  for (const { id, entry, because } of listed) {
    if (after && id <= after) continue;
    if (settledButNotRemoved.has(id)) { finish(id, null); continue; }
    if (!entry) { finish(id, id + ': ' + because); continue; }
    const tag = entry.verb + ' ' + id + ' from ' + entry.from;
    if (typeof h.knownAgent !== 'function' || !h.knownAgent(entry.from)) {
      finish(id, tag + ': ' + entry.from + ' is not an agent in this Kosmos');
      continue;
    }
    const deliver = deliverers[entry.verb];
    if (typeof deliver !== 'function') { finish(id, tag + ': this board cannot deliver a ' + entry.verb); continue; }
    if (handed >= cap) { summary.next = lastHanded; break; }
    handed += 1;
    lastHanded = id;
    let verdict;
    try { verdict = deliver(entry) || {}; } catch (e) {
      verdict = { outcome: 'retry', because: 'delivering it failed (' + ((e && e.message) || e) + ')' };
    }
    if (verdict.outcome === 'delivered') { summary.delivered += 1; finish(id, null); continue; }
    if (verdict.outcome === 'dropped') { finish(id, tag + ': ' + (verdict.because || 'it cannot be delivered')); continue; }
    const why = verdict.because || 'it could not be delivered yet';
    if (now - Date.parse(entry.at) > OUTBOX_RETRY_MAX_AGE_MS) {
      if (typeof h.onExpired === 'function') {
        try { h.onExpired(entry, why); } catch (e) { log('could not note the give-up of ' + tag + ' (' + ((e && e.message) || e) + ')'); }
      }
      finish(id, tag + ': still not delivered after ' + Math.round(OUTBOX_RETRY_MAX_AGE_MS / 86400000) + ' days (' + why + ')');
      continue;
    }
    summary.waiting += 1;
    if (lastRetryReason.get(id) !== why) {
      lastRetryReason.set(id, why);
      log('kept ' + tag + ' for another try: ' + why);
    }
  }
  return summary;
}

/**
 * install/kosmos's way in, on a 421: `node outbox.js keep <verb> <body-file>`.
 * The body arrives in a file, never on argv (#1970): it is the agent's words. The
 * file is deleted as soon as it is read; the shell's own `rm -f` is the backstop
 * for a process killed before that. Prints one sentence to `out` (the shell
 * `say`s it) and returns the exit code: 0 kept, 1 not kept, 2 usage.
 */
function runKeepCommand(argv, io) {
  const o = io || {};
  const out = o.out || ((s) => process.stdout.write(s + '\n'));
  const [command, verb, bodyFile] = Array.isArray(argv) ? argv : [];
  if (command !== 'keep' || !verb || !bodyFile) {
    out('Usage: node outbox.js keep <' + KEPT_VERBS.join('|') + '> <body-file>');
    return 2;
  }
  let text;
  try { text = fs.readFileSync(bodyFile, 'utf8'); } catch (e) {
    out('We could not read what to keep (' + ((e && e.code) || 'unknown') + '), so it was not kept.');
    return 1;
  }
  try { fs.unlinkSync(bodyFile); } catch { /* the shell's rm -f after this process is the backstop */ }
  let body;
  try { body = JSON.parse(text); } catch {
    out('What was handed over to keep is not something we can read, so it was not kept.');
    return 1;
  }
  const kept = keepFromClient({ verb, body, env: o.env || process.env, seams: o.seams });
  if (!kept.ok) { out(kept.because); return 1; }
  out(WRONG_WORLD_SENTENCES.kept);
  return 0;
}

module.exports = {
  keep, list, remove, drain, keepFromClient, resolveKeepSender, runKeepCommand, outboxDir,
  KEPT_VERBS, WRONG_WORLD_SENTENCES, MAX_ENTRIES, MAX_TOTAL_BYTES, MAX_ENTRY_BYTES, OUTBOX_RETRY_MAX_AGE_MS,
  MAX_DELIVERIES_PER_PASS,
};

if (require.main === module) {
  process.exitCode = runKeepCommand(process.argv.slice(2));
}
