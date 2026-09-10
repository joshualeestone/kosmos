'use strict';
/**
 * The road from the board to a Windows agent (#570, 7c-3).
 *
 * 🛑 WHAT WAS MISSING, EXACTLY. After 7c-2 a Windows agent is a STREAMING child
 * whose stdin the supervisor holds -- `win32supervisor` has `handle.send()`, and
 * calling it types at the agent. But the supervisor is a process the SCHEDULER
 * started; the board is a different process entirely, and it has no way to reach
 * that handle. The delivery mechanism existed and nothing could call it.
 *
 * 🔑 A LOCAL NAMED PIPE PER AGENT, which is this platform's unix socket. The
 * supervisor serves `\\.\pipe\kosmos-agent-<key>` for as long as it is up; the
 * board connects, presents a token, hands over one message, and is told what
 * happened. It is a REQUEST AND A REPLY, not a drop -- `chat.js` reports one of
 * three verdicts (placed, could_not, unconfirmed), and a channel that could only
 * post into a void could not tell them apart.
 *
 *      board  --(one json line: token + text)-->  supervisor
 *      board  <--(one json line: ok / because)--  supervisor  --> agent stdin
 *
 * ⚠️ A PIPE THAT IS NOT THERE IS THE HONEST ANSWER, NOT AN ERROR TO HIDE. Windows
 * destroys a named pipe when its server exits, so "the supervisor is down" arrives
 * as ENOENT on connect -- immediately, with no timeout to wait out. That is the
 * one failure this channel most needs to report well, and the platform gives it to
 * us cleanly. There is deliberately NO SPOOL: a message queued for a supervisor
 * that may never come back is a message the person was told was delivered.
 *
 * 🔑 THE TOKEN IS NOT DECORATION, and the reason is that the pipe's own access
 * control is not ours to be sure of. `\\.\pipe\` is machine-local, and both
 * processes run as the same person -- but libuv creates the pipe with a default
 * security descriptor this repo has not measured, and "probably only us" is not a
 * claim to put a person's messages behind. A shared secret in a file only that
 * person can read closes it independently of whatever the DACL turns out to be.
 * Compared in constant time, because a token compared with `===` leaks its prefix
 * to anything that can time a reply.
 *
 * ⚠️ AND THE CLIENT IS SYNCHRONOUS AND BOUNDED, THE SAME SHAPE `chat.js` ALREADY
 * BLOCKS IN. `deliver()` is straight-line synchronous code: it calls tmux through
 * `execFileSync` with a timeout and reads the answer. There is no synchronous
 * named-pipe read in Node with a deadline -- `fs.readSync` on a pipe blocks with
 * no way out, which on the board is the whole HTTP server -- so the client runs
 * OUT OF PROCESS, through the same bounded `execFileSync` the Mac path uses. This
 * file is both the library and that helper: `node win32channel.js say <name>`,
 * with the text on stdin.
 */

const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const store = require('./store');

/* One namespace, so a person listing pipes can see what these are and nothing
   else can collide with them by accident. */
const PIPE_PREFIX = '\\\\.\\pipe\\kosmos-agent-';

/* The wire is one line each way. A request bigger than this is not a message
   somebody typed -- chat.js caps a person's text at 2000 characters -- so it is
   refused rather than buffered, which is what stops a connection nobody
   authenticated from growing the supervisor's heap. */
const MAX_REQUEST_BYTES = 128 * 1024;

/* How long the board is willing to block. The Mac blocks on tmux the same way and
   for the same reason: a delivery has to answer the request that asked for it.
   Generous enough that a busy box does not manufacture failures, short enough that
   a wedged supervisor cannot hold the board. */
const SAY_TIMEOUT_MS = 8000;

/* ⚠️ SAME KEY THE REST OF THE STORE USES. `store.safeKey` lowercases and strips,
   so two names that differ only in case or punctuation share one pipe -- which is
   exactly as true of their profile, their token and their avatar, and the create
   path refuses such a pair long before this. One key derivation, not a second. */
function pipePath(name) { return PIPE_PREFIX + store.safeKey(name); }

function secretDir() { return path.join(store.ROOT, 'win32-channel'); }
function secretPath(name) { return path.join(secretDir(), store.safeKey(name) + '.key'); }

/**
 * The shared secret for one agent's channel, created if it is not there.
 *
 * 🔑 EITHER SIDE MAY CREATE IT, AND NEITHER MAY OVERWRITE IT. The supervisor
 * reaches this when it starts serving; the board reaches it when it first sends.
 * Which one is first depends on timing nobody controls, so the write is `wx` --
 * exclusive create -- and a loser of that race simply reads what the winner wrote.
 * A plain write would let a send rotate the secret out from under a supervisor
 * that is already serving, and the symptom would be an agent that stops answering
 * for no reason a log could explain.
 *
 * ⚠️ MODE 0600, AND ON WINDOWS THAT IS NOT THE WHOLE STORY. Node maps the mode to
 * a read-only flag rather than a DACL, so the real protection is that this lives
 * under the per-user data root, which another account cannot read. Stated so
 * nobody reads the mode as the guarantee.
 */
function ensureSecret(name) {
  let at;
  try { at = secretPath(name); }
  catch { return { ok: false, because: 'that is not a name we can open a channel for' }; }

  try {
    const have = fs.readFileSync(at, 'utf8').trim();
    if (have) return { ok: true, secret: have };
  } catch { /* not there yet, which is the ordinary first time */ }

  const minted = crypto.randomBytes(32).toString('base64url');
  try {
    fs.mkdirSync(secretDir(), { recursive: true });
    fs.writeFileSync(at, minted + '\n', { mode: 0o600, flag: 'wx' });
    return { ok: true, secret: minted };
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      /* Somebody else got there first between our read and our write. Theirs is
         the live one -- read it rather than insisting on ours. */
      try {
        const have = fs.readFileSync(at, 'utf8').trim();
        if (have) return { ok: true, secret: have };
      } catch { /* fall through to the honest failure */ }
    }
    return { ok: false, because: 'we could not set up the private channel to it (' + ((e && e.code) || 'unknown') + ')' };
  }
}

/** Constant-time equality over two secrets of any length. */
function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  /* ⚠️ LENGTH IS COMPARED FIRST AND SEPARATELY, because timingSafeEqual THROWS on
     a length mismatch rather than returning false. Length leaks; the bytes do not,
     and the bytes are the secret. */
  if (x.length !== y.length) return false;
  try { return crypto.timingSafeEqual(x, y); } catch { return false; }
}

/**
 * Serve the channel for one agent. Called by the supervisor, which is the process
 * that holds the agent's stdin -- and therefore the only process that could serve
 * this at all.
 *
 * `onSay(text, done)` is handed each authenticated message and calls
 * `done({ ok } | { ok:false, because, unsure? })` when it knows what happened;
 * `unsure` means the bytes may have reached the agent anyway. It is
 * asynchronous on purpose: the honest moment to answer is after the bytes have
 * reached the agent's pipe, not when they were handed to a stream.
 *
 * Returns { ok:true, close(), pipe } or { ok:false, because } -- never throws.
 */
function serve(name, opts) {
  const o = opts || {};
  const onSay = typeof o.onSay === 'function' ? o.onSay : null;
  if (!onSay) return { ok: false, because: 'a channel with nothing to deliver to is not a channel' };

  const got = o.secret ? { ok: true, secret: o.secret } : ensureSecret(name);
  if (!got.ok) return { ok: false, because: got.because };

  let at;
  try { at = o.pipe || pipePath(name); }
  catch { return { ok: false, because: 'that is not a name we can open a channel for' }; }

  /* How long a caller may sit silent before the supervisor gives up on it.
     Injectable only so a test can prove the timer stops once a message is handed
     over without waiting out the production value. */
  const idleMs = Number.isFinite(o.idleMs) ? o.idleMs : SAY_TIMEOUT_MS;

  const server = net.createServer((sock) => {
    let buf = '';
    let answered = false;
    /* 🛑 ONE MESSAGE PER CONNECTION. `answered` only turns true when `onSay`
       answers, and `buf` still holds the line already parsed, so without this a
       second chunk arriving while the write is pending would re-parse that same
       line and type it at the agent twice. */
    let handedOver = false;
    const answer = (payload) => {
      if (answered) return;
      answered = true;
      try { sock.end(JSON.stringify(payload) + '\n'); } catch { /* it is going anyway */ }
    };
    /* A caller that connects and says nothing must not hold a handle forever. */
    sock.setTimeout(idleMs, () => { answer({ ok: false, because: 'nothing arrived on the channel' }); });
    sock.on('error', () => { answered = true; });
    sock.on('data', (chunk) => {
      if (answered || handedOver) return;
      buf += chunk.toString('utf8');
      if (Buffer.byteLength(buf, 'utf8') > MAX_REQUEST_BYTES) {
        answer({ ok: false, because: 'that is more than a message' });
        return;
      }
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      let req;
      try { req = JSON.parse(buf.slice(0, nl)); }
      catch { answer({ ok: false, because: 'we could not make sense of what came down the channel' }); return; }

      /* 🛑 THE TOKEN IS CHECKED BEFORE ANYTHING IS READ OUT OF THE REQUEST, and
         before any work is done on its behalf. An unauthenticated caller learns
         only that it was refused. */
      if (!req || typeof req !== 'object' || !sameSecret(req.token, got.secret)) {
        answer({ ok: false, because: 'that is not a caller this agent answers' });
        return;
      }
      if (req.type === 'ping') { answer({ ok: true }); return; }
      if (req.type !== 'say' || typeof req.text !== 'string') {
        answer({ ok: false, because: 'we did not understand what was asked' });
        return;
      }
      /* 🛑 THE IDLE TIMER STOPS HERE, the moment the message is handed over. Its
         sentence, "nothing arrived", is true only BEFORE this line; after it the
         write to the agent may be queued and land late, and answering "not
         delivered" then is the duplicate-send this channel exists to prevent.
         From here the only answer is the one `onSay` gives; a caller that tires
         of waiting times out on its own side, where that is reported as unsure. */
      sock.setTimeout(0);
      handedOver = true;
      try {
        onSay(req.text, (r) => answer(r && r.ok ? { ok: true } : {
          ok: false,
          /* Relayed, never inferred: only the supervisor knows whether its write
             had started, and dropping this turns a maybe-delivered message into
             "not delivered" at the board. */
          ...(r && r.unsure ? { unsure: true } : {}),
          because: (r && r.because) || 'it did not take the message',
        }));
      }
      /* A throw from `onSay` broke at a point we cannot see -- possibly after its
         write began -- so it is unsure, the same reading chat.js gives a throw
         from `say()`. */
      catch (e) { answer({ ok: false, unsure: true, because: 'it broke while handing the message over (' + ((e && e.code) || 'unknown') + '), so we cannot tell whether it arrived' }); }
    });
  });

  server.on('error', () => { /* reported through the listen callback below */ });

  try { server.listen(at); }
  catch (e) { return { ok: false, because: 'we could not open its channel (' + ((e && e.code) || 'unknown') + ')' }; }

  return { ok: true, pipe: at, close() { try { server.close(); } catch { /* already gone */ } }, server };
}

/* ── the client half ────────────────────────────────────────────────────────── */

/**
 * Hand one message to the agent's supervisor and wait to be told what happened.
 *
 * 🛑 SYNCHRONOUS, BECAUSE `chat.js` IS. `deliver()` blocks on tmux through
 * `execFileSync` and reads the result inline; a promise here would mean rewriting
 * every caller of a delivery path whose whole value is that it reports one
 * outcome. So this blocks the same way, for a bounded time, and it blocks in a
 * CHILD -- there is no synchronous named-pipe read in Node that can be given a
 * deadline, and one without a deadline is the board's HTTP thread held by a
 * supervisor nobody can see.
 *
 * Returns { ok:true } or { ok:false, because, down?, unsure? } -- never throws.
 * `down` is true when the supervisor is not there at all, which is the one
 * failure a caller may want to word differently from a refusal. `unsure` is true
 * when the message may have arrived and only the answer was lost; every other
 * `ok:false` means nothing was typed.
 */
function say(name, text, opts) {
  const o = opts || {};
  const timeout = Number.isFinite(o.timeoutMs) ? o.timeoutMs : SAY_TIMEOUT_MS;
  const node = o.node || process.execPath;
  const helper = o.helper || __filename;

  /* The address seam, and the only reason it exists: every arm of this file has to
     be drivable from the fleet's Macs, which have no named pipes. A test hands a
     unix socket path here and the same client code runs. Production never sets it,
     so the pipe name stays derived in one place. */
  const argv = [helper, 'say', String(name)];
  if (o.pipe) argv.push(String(o.pipe));

  let out;
  try {
    out = cp.execFileSync(node, argv, {
      input: String(text),
      encoding: 'utf8',
      /* A little longer than the child's own deadline, so the child is the one
         that reports a timeout and it reports it as a sentence rather than as a
         killed process. */
      timeout: timeout + 2000,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: Object.assign({}, process.env, { KOSMOS_CHANNEL_TIMEOUT_MS: String(timeout) }),
    });
  } catch (e) {
    /* The child prints its verdict on stdout even when it exits non-zero, which is
       how a refusal keeps its sentence. Only a child that printed NOTHING is a
       failure we have to word ourselves. */
    out = (e && e.stdout) || '';
    if (!String(out).trim()) {
      /* ⚠️ ONLY A HELPER THAT NEVER STARTED IS A DEFINITE NO. One that ran and
         died without a verdict -- above all one killed at the deadline, which
         arrives with a signal and no status (chat.js's `spawnFailure` measured
         the same shapes) -- may already have handed the message over. Calling
         that "not delivered" is what makes somebody send it twice. */
      const neverRan = Boolean(e) && e.status == null && !e.signal;
      if (!neverRan) {
        /* Two shapes, two sentences. A signal is our own deadline killing it
           (measured: ETIMEDOUT + SIGTERM, status null). An exit status with no
           verdict is a helper that died on its own -- most likely before it
           wrote anything, but "most likely" is not "nothing typed", so it stays
           unsure and says what actually happened. */
        return {
          ok: false,
          unsure: true,
          because: e.signal
            ? 'it did not answer us in time, so we cannot tell whether it arrived'
            : 'the helper carrying the message stopped before it told us what happened, so we cannot tell whether it arrived',
        };
      }
      return { ok: false, because: 'we could not reach it to type anything (' + ((e && e.code) || 'no answer') + ')' };
    }
  }
  /* The helper RAN -- a never-started one returned above -- so it may have
     handed the message over before its verdict went wrong. */
  return readVerdict(String(out).trim().split('\n').pop(), true);
}

/**
 * Read one verdict line from the other side. The ONE reading for both places
 * that receive one -- `clientMain` from the supervisor, `say()` from the helper
 * -- because two copies of this guard is how a gap got fixed in one and not the
 * other, twice (review rounds 3-5).
 *
 * Only two shapes are verdicts, the two this file writes: `ok === true`, and
 * `ok === false` with a sentence, which carries its own `down` / `unsure`.
 * Anything else did not come from us, so we cannot know what happened: once the
 * request was handed over that is unsure, before it a definite no.
 */
function readVerdict(line, handedOver) {
  let v;
  try { v = JSON.parse(line); } catch { v = undefined; }
  const isObject = Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  if (isObject && v.ok === true) return { ok: true };
  if (isObject && v.ok === false && typeof v.because === 'string' && v.because) {
    return { ok: false, because: v.because, down: v.down === true, unsure: v.unsure === true };
  }
  return handedOver
    ? { ok: false, unsure: true, because: 'we could not make sense of what came back from its channel, so we cannot tell whether it arrived' }
    : { ok: false, because: 'we could not make sense of what came back from its channel' };
}

/**
 * The out-of-process client: connect, say one thing, print the verdict, exit.
 *
 * ⚠️ IT PRINTS A VERDICT ON EVERY PATH, including the ones where it also exits
 * non-zero. `say()` above reads stdout first and the exit code second, so a
 * refusal keeps the sentence somebody can act on rather than becoming "the helper
 * failed".
 */
function clientMain(name, text, opts) {
  const o = opts || {};
  const timeout = Number.isFinite(o.timeoutMs) ? o.timeoutMs : SAY_TIMEOUT_MS;
  /* The verdict goes to stdout for the helper's real caller; a test hands its own
     sink instead, which is what lets the client half be driven in-process (and
     from a Mac, against a unix socket, through `o.pipe`). */
  const done = typeof o.onDone === 'function' ? o.onDone : (payload) => {
    process.stdout.write(JSON.stringify(payload) + '\n');
    process.exitCode = payload && payload.ok ? 0 : 1;
  };

  const got = ensureSecret(name);
  if (!got.ok) { done({ ok: false, because: got.because }); return null; }

  let at;
  try { at = o.pipe || pipePath(name); }
  catch { done({ ok: false, because: 'that is not a name we can open a channel for' }); return null; }

  let settled = false;
  /* Set the moment the request is written. Before it, every failure is a
     definite "nothing typed"; after it, a broken channel may have delivered. */
  let wrote = false;
  const finish = (payload) => { if (settled) return; settled = true; done(payload); try { sock.destroy(); } catch { /* going anyway */ } };

  const sock = net.connect(at);
  /* 🔑 `unsure` IS SET ONLY AFTER THE REQUEST HAS BEEN WRITTEN (`wrote`), on each
     way the conversation can end from there: this timeout, a close, an error.
     From that point the supervisor may have typed it and only the answer was
     lost, and chat.js reports `unconfirmed` rather than `could_not`, because
     "not delivered" about a delivered message is how it gets sent twice. Before
     the write, the same three events are a definite no. */
  sock.setTimeout(timeout, () => finish(wrote
    ? { ok: false, unsure: true, because: 'it did not answer us in time, so we cannot tell whether it arrived' }
    : { ok: false, because: 'we could not get through to it in time, so we did not type anything' }));
  sock.on('error', (e) => {
    /* 🔑 ENOENT IS THE SUPERVISOR BEING DOWN, and Windows gives it to us at once:
       a named pipe stops existing when its server exits, so there is no stale
       socket file to time out against the way a unix socket would leave. */
    const down = e && (e.code === 'ENOENT' || e.code === 'ECONNREFUSED');
    if (!down && wrote) {
      finish({
        ok: false,
        unsure: true,
        because: 'its channel broke after we handed the message over (' + ((e && e.code) || 'unknown') + '), so we cannot tell whether it arrived',
      });
      return;
    }
    finish({
      ok: false,
      down: Boolean(down),
      because: down
        ? 'it is not running just now, so we did not type anything'
        : 'we could not reach it to type anything (' + ((e && e.code) || 'unknown') + ')',
    });
  });

  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    const nl = buf.indexOf('\n');
    if (nl === -1) return;
    /* The supervisor's own flags travel with its sentence; an answer we cannot
       read, once the request is written, came from a supervisor that may already
       have typed the message. */
    finish(readVerdict(buf.slice(0, nl), wrote));
  });
  sock.on('close', () => finish(wrote
    ? { ok: false, unsure: true, because: 'its channel closed before it told us what happened, so we cannot tell whether it arrived' }
    : { ok: false, because: 'its channel closed before we could hand anything over, so we did not type anything' }));

  sock.on('connect', () => {
    sock.write(JSON.stringify({ v: 1, token: got.secret, type: 'say', text: String(text) }) + '\n');
    wrote = true;
  });
  return sock;
}

/* istanbul ignore next -- the process wrapper; everything above is driven directly. */
if (require.main === module) {
  const verb = process.argv[2];
  const who = process.argv[3];
  const where = process.argv[4];
  if (verb !== 'say' || !who) {
    process.stdout.write(JSON.stringify({ ok: false, because: 'usage: win32channel.js say <agent> [pipe] (text on stdin)' }) + '\n');
    process.exitCode = 2;
  } else {
    let text = '';
    try { text = fs.readFileSync(0, 'utf8'); } catch { text = ''; }
    const ms = Number(process.env.KOSMOS_CHANNEL_TIMEOUT_MS);
    clientMain(who, text, { pipe: where || undefined, timeoutMs: Number.isFinite(ms) && ms > 0 ? ms : undefined });
  }
}

module.exports = {
  PIPE_PREFIX, MAX_REQUEST_BYTES, SAY_TIMEOUT_MS,
  pipePath, secretPath, ensureSecret, sameSecret, serve, say, clientMain,
};
