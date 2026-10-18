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
const launchidentity = require('./launchidentity');

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

/* #1765: the most the helper waits for Windows to say who owns the pipe it reached, before it
   writes anything (serverOwnerOf). Measured on the Windows box: about 0.35 to 0.55 s, almost all of
   it Windows PowerShell starting. This is its own phase, outside SAY_TIMEOUT_MS, so the
   conversation keeps its whole budget; say() waits this much longer for the helper on Windows. */
const OWNER_CHECK_TIMEOUT_MS = 4000;

/* The accounts a pipe Kosmos may write to can be owned by: this account (what a supervisor
   started by its logon task creates), and the two that can already read this account's channel
   key, so trusting them gives nothing away: Administrators (the owner Windows gives what an
   administrator's full token creates, as with UAC turned off) and SYSTEM. */
const TRUSTED_PIPE_OWNERS = ['S-1-5-32-544', 'S-1-5-18'];

/** How often, and for how long, a supervisor retries a pipe the PREVIOUS one still
    holds. Under `conhost --headless`, `/End` kills only the host; the old supervisor
    keeps the pipe until its host watch fires, about a second, and a restart's `/Run`
    lands inside that window. 30s is far past that and still bounded. */
const LISTEN_RETRY_MS = 250;
const LISTEN_RETRY_LIMIT = 120;

/* ⚠️ SAME KEY THE REST OF THE STORE USES. `store.safeKey` lowercases and strips,
   so two names that differ only in case or punctuation share one pipe -- which is
   exactly as true of their profile, their token and their avatar, and the create
   path refuses such a pair long before this. One key derivation, not a second. */
/* #1704: a pipe name is machine-wide too, so a named world's agent serves
   `kosmos-agent-<key>+<world>` (launchidentity.launchKey) and the default world's
   is unchanged. Built from the safe KEY, never `safeKey(launchKey(...))`, which
   would strip the separator. The supervisor and the board each use their own
   world here, and those are the same world by construction. */
function pipePath(name) { return PIPE_PREFIX + launchidentity.launchKey(store.safeKey(name), launchidentity.currentWorldId()); }

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

  /* 🛑 A LISTEN THAT FAILS ARRIVES AS AN 'error' EVENT, NOT A THROW (measured), and
     this used to swallow it: the supervisor ran its whole life with no channel,
     answering nobody, and said nothing. A pipe the previous supervisor still holds
     (EADDRINUSE, the restart case above) is retried until it frees; anything else
     is reported, because a supervisor that cannot be reached must say so. */
  const onProblem = typeof o.onProblem === 'function' ? o.onProblem : () => {};
  /* Injectable only so a test can prove close() cancels a retry and that giving
     up is reported, without waiting out the production 30s. */
  const retryMs = Number.isFinite(o.retryMs) ? o.retryMs : LISTEN_RETRY_MS;
  const retryLimit = Number.isFinite(o.retryLimit) ? o.retryLimit : LISTEN_RETRY_LIMIT;
  let closed = false;
  let retries = 0;
  let retryTimer = null;
  server.on('error', (e) => {
    if (closed) return;
    if (e && e.code === 'EADDRINUSE' && retries < retryLimit) {
      retries += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (closed) return;
        try { server.listen(at); } catch (err) { onProblem('we could not open its channel (' + ((err && err.code) || 'unknown') + ')'); }
      }, retryMs);
      return;
    }
    onProblem('we could not open its channel (' + ((e && e.code) || 'unknown') + ')');
  });

  try { server.listen(at); }
  catch (e) { return { ok: false, because: 'we could not open its channel (' + ((e && e.code) || 'unknown') + ')' }; }

  return {
    ok: true, pipe: at, server,
    close() {
      closed = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      try { server.close(); } catch { /* already gone */ }
    },
  };
}

/* ── who is answering (#1765) ───────────────────────────────────────────────── */

/**
 * 🛑 THE CLIENT CHECKS WHO HOLDS THE PIPE BEFORE IT WRITES ANYTHING. A named pipe's name is
 * machine-wide, and whoever creates `\\.\pipe\kosmos-agent-<key>` first holds it: while an agent's
 * supervisor is down, another account on this PC can create that name and wait. The board's
 * request carries the agent's channel key and the person's words, so writing it to that pipe would
 * hand both over. The token above proves the CALLER to the supervisor; this proves the SUPERVISOR's
 * side to the caller.
 *
 * HOW: Windows PowerShell 5.1 opens the same pipe name and reads the owner of its security
 * descriptor (NamedPipeClientStream.GetAccessControl), which Windows sets to the account that
 * created the pipe; an account cannot make it name somebody else without an administrator's
 * privileges. It also says which account it runs as, which is this helper's. Node itself has no way
 * to ask (no GetNamedPipeServerProcessId, no security descriptor on a net.Socket).
 *
 * 🔑 WHY A SECOND CONNECTION ANSWERS FOR THE FIRST. It runs while the helper's own connection is
 * open. A pipe name belongs to one creator for as long as any handle to it is open: libuv creates its
 * first instance with FILE_FLAG_FIRST_PIPE_INSTANCE, so a supervisor cannot join a name somebody else
 * holds, and the default security descriptor does not let another account add instances to a name
 * the supervisor holds. So both connections reach pipes the same account created. If the holder
 * closes its end between the two, the helper's own connection is dead and its write reaches nobody.
 *
 * ⚠️ WEAKEST PART: it costs a Windows PowerShell start per message (about half a second on the box),
 * while the board waits in say(). And the helper's connection is made before the check, with the
 * default impersonation level, as before this change: a holder without SeImpersonatePrivilege (an
 * ordinary account) gets only an identification token from it.
 *
 * Resolves `{ owner, me }` (two SIDs); rejects, with a sentence, when Windows does not answer in time
 * or in a shape it can read. The pipe's name rides in the environment, never the command line.
 */
const OWNER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$rights = [System.IO.Pipes.PipeAccessRights]::ReadData -bor [System.IO.Pipes.PipeAccessRights]::ReadPermissions',
  '$c = New-Object System.IO.Pipes.NamedPipeClientStream(".", $env:KOSMOS_PIPE_NAME, $rights, [System.IO.Pipes.PipeOptions]::None, [System.Security.Principal.TokenImpersonationLevel]::Anonymous, [System.IO.HandleInheritability]::None)',
  '$c.Connect([int] $env:KOSMOS_PIPE_CONNECT_MS)',
  'try { $owner = $c.GetAccessControl().GetOwner([System.Security.Principal.SecurityIdentifier]).Value } finally { $c.Dispose() }',
  '$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  "[Console]::Out.Write('{\"owner\":\"' + $owner + '\",\"me\":\"' + $me + '\"}')",
].join('\n');

const PIPE_ROOT = '\\\\.\\pipe\\';
const SID = /^S-1-[0-9]+(-[0-9]+)*$/;

/** The first line of what PowerShell said on stderr, without its position and category lines. */
function powershellReason(stderr) {
  const line = String(stderr || '').split(/\r?\n/).map((l) => l.trim())
    .find((l) => l && !/^(#< CLIXML|At line:|\+|CategoryInfo|FullyQualifiedErrorId)/.test(l));
  return line ? line.slice(0, 160) : null;
}

function serverOwnerOf(at, timeoutMs) {
  return new Promise((resolve, reject) => {
    const full = String(at || '');
    if (!full.toLowerCase().startsWith(PIPE_ROOT) || full.length === PIPE_ROOT.length) {
      reject(new Error('that is not a pipe Windows can say the owner of'));
      return;
    }
    const ps = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const env = { ...process.env, KOSMOS_PIPE_NAME: full.slice(PIPE_ROOT.length), KOSMOS_PIPE_CONNECT_MS: String(Math.max(500, timeoutMs - 1000)) };
    /* An inherited PowerShell 7 module path is what makes 5.1 load the wrong modules
       (engine/win32update.js authenticodeOf); nothing here needs one. */
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
    cp.execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', OWNER_SCRIPT], {
      encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024, env,
    }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed || err.signal || err.code === 'ETIMEDOUT') { reject(new Error('Windows did not say in time')); return; }
        if (err.code === 'ENOENT') { reject(new Error('Windows PowerShell is not where Windows keeps it')); return; }
        reject(new Error(powershellReason(stderr) || 'Windows PowerShell ended with code ' + err.code));
        return;
      }
      let j = null;
      try { j = JSON.parse(String(stdout).trim()); } catch { j = null; }
      if (!j || typeof j !== 'object' || typeof j.owner !== 'string' || typeof j.me !== 'string') {
        reject(new Error('Windows answered in a form Kosmos could not read'));
        return;
      }
      resolve({ owner: j.owner, me: j.me });
    });
  });
}

/** Null when the pipe's owner may be written to; otherwise the sentence the caller is told. Pure. */
function ownerRefusal(answer) {
  const a = answer || {};
  if (typeof a.me !== 'string' || !SID.test(a.me) || typeof a.owner !== 'string' || !SID.test(a.owner)) {
    return 'we could not confirm its channel belongs to you, so we did not type anything';
  }
  if (a.owner === a.me || TRUSTED_PIPE_OWNERS.includes(a.owner)) return null;
  return 'its channel is held by another account on this computer, so we did not type anything';
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
         killed process. #1765: on Windows the child also asks who holds the pipe
         first, in a phase with its own bound, so it is given that much longer. */
      timeout: timeout + 2000 + (process.platform === 'win32' ? OWNER_CHECK_TIMEOUT_MS : 0),
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

  /* #1765: on Windows, who holds the pipe is asked before a byte is written (serverOwnerOf). A test
     passes its own `checkServer`, or null for none. Off Windows there is no named pipe to ask about:
     the address is a unix socket, which only a test uses. */
  const checkServer = o.checkServer !== undefined ? o.checkServer
    : (process.platform === 'win32' ? (where) => serverOwnerOf(where, OWNER_CHECK_TIMEOUT_MS) : null);
  const send = () => {
    sock.write(JSON.stringify({ v: 1, token: got.secret, type: 'say', text: String(text) }) + '\n');
    wrote = true;
  };
  sock.on('connect', () => {
    if (!checkServer) { send(); return; }
    /* The conversation's own deadline waits while Windows is asked: the check has its own bound
       (OWNER_CHECK_TIMEOUT_MS), and nothing has been written, so every way this ends is a
       definite no. */
    sock.setTimeout(0);
    let asked;
    try { asked = Promise.resolve(checkServer(at)); } catch (e) { asked = Promise.reject(e); }
    asked.then((answer) => {
      if (settled) return;
      const refused = ownerRefusal(answer);
      if (refused) { finish({ ok: false, because: refused }); return; }
      sock.setTimeout(timeout);
      send();
    }, (e) => {
      if (settled) return;
      finish({ ok: false, because: 'we could not confirm its channel belongs to you (' + String((e && e.message) || 'no answer').slice(0, 160) + '), so we did not type anything' });
    });
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
  PIPE_PREFIX, MAX_REQUEST_BYTES, SAY_TIMEOUT_MS, OWNER_CHECK_TIMEOUT_MS, TRUSTED_PIPE_OWNERS,
  pipePath, secretPath, ensureSecret, sameSecret, serve, say, clientMain, serverOwnerOf, ownerRefusal,
};
