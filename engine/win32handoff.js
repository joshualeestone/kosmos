'use strict';
/**
 * #570: a board started BY HAND from the unpacked Windows zip hands itself to its
 * logon task, instead of serving from the launcher's hidden console (or its
 * --console window).
 *
 * 🛑 THE WINDOW WAS THE BOARD. `Kosmos.exe` ran server.js in the foreground of
 * the console it opened, so closing that window killed the board -- the class of
 * defect #2714 removed from every Scheduled Task, left standing on the one window a
 * person is most likely to close. And from the first logon on, the task's headless
 * board is already serving, so every later double-click printed "port 16180 is
 * already in use ... Kosmos stopped" over a board that was working fine. Measured
 * on the Windows box with a 0.6.55 zip; the plan has the numbers.
 *
 * 🔑 SO THE HAND-STARTED BOARD STARTS THE TASK AND LEAVES. The task already exists
 * (`win32board.ensureInstalled` registered or refreshed it a moment earlier in the
 * same boot), it runs headless, and it is what a logon starts anyway -- so after
 * this there is one way the board runs on Windows, whichever way it was started.
 * Exiting 0 lets the launcher exit with it (closing its --console window, if it has
 * one); its opener is already waiting to put the board in the browser.
 *
 * ⚠️ WHAT IT CANNOT CONFIRM, IT LEAVES TO THE LAUNCHER, which is the behaviour
 * before this module: this board serves from the launcher's hidden console (or its
 * --console window), and a GUI Kosmos.exe shows a box that stays the person's handle
 * on it once this board is listening (HANDOFF_CHECK_FOR_SERVING_AFTER_MS). All inside
 * a budget that ends before the opener
 * gives up (see HANDOFF_BUDGET_MS), so a fallback still gets the browser signed in.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

/**
 * 🛑 ONE BUDGET FOR THE WHOLE HAND-OFF, MEASURED FROM PROCESS START, because the
 * browser opener does not wait for us. `tools/kosmos-open-board.js` waits 20s for
 * a board and then opens the PLAIN url, which an enforcing Windows board answers
 * with the #2007 403. So whatever this does -- succeed, replace an older board, or
 * give up and serve from the launcher -- a board must be answering before then.
 * ⚠️ THE BUDGET IS NOT THE WORST CASE, and the difference is spelled out so it is
 * not rediscovered: a probe already in flight at the deadline can take
 * PROBE_TIMEOUT_MS (no wait starts one past its own end), and the fallback's
 * port-release wait has a floor of MIN_PORT_RELEASE_WAIT_MS (below) that the
 * budget does not cut. Worst case from process start: 12 + 2 (a last probe) + 2
 * (the release floor) + 2 (its last probe) = 18s, plus the `/End` spawn, inside
 * the opener's 20s. Measured on the box: boot to the hand-off
 * about 2s, `/Run` to a listening board 1.2s, a whole update 8.9s from the
 * double-click -- so 12s still covers the update, grace included.
 */
const HANDOFF_BUDGET_MS = 12000;

/* The update case ends an OLDER board that the launcher's opener may be signing
   the browser in to at this very moment: it minted a single-use boot nonce there,
   and the browser redeems it a beat later. The cookie that redemption sets is the
   durable one, so it keeps working on the new board -- but only if the old board
   is still up to redeem it. NOT MEASURED: an allowance for a browser that is
   already running (the box's Edge took the url in well under a second by eye). A
   browser that loses the race either finds no board for a second or two (after
   `/End`, before the new board listens) or reaches the new board with a nonce it
   never minted -- nonces live in the minting board's memory. Either way the page
   is not signed in, and a relaunch of Kosmos signs it in. */
const OLD_BOARD_GRACE_MS = 3000;

/* Whatever the budget says, an ended board gets this long to let go of the port
   before this one tries to bind it: serving here into a port still held would only
   die on EADDRINUSE. win32board.restart measured the port staying bound about a
   second after `/End`. This floor is why the worst case exceeds the budget (see
   HANDOFF_BUDGET_MS). */
const MIN_PORT_RELEASE_WAIT_MS = 2000;

/* A task board still booting can answer AFTER our `/Run` as another board -- an
   older build, or the world it was booting into -- and the second round replaces
   it. Two rounds, never a loop. */
const MAX_ROUNDS = 2;

/* One probe's budget, and the gap between probes while waiting. */
const PROBE_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 300;

/**
 * When Kosmos.exe starts asking whether the board it started is serving from it: the
 * arithmetic spelled out at HANDOFF_BUDGET_MS, as one value (tools/windows/
 * KosmosLauncher.cs, CheckForServingAfterMs, pinned equal by
 * tools.win-launcher-native.test.js).
 * ⚠️ NOT A WORST CASE. Every schtasks call in the hand-off is a synchronous spawn with
 * its own timeout, so a `/Run` that starts just inside the budget can still be confirmed
 * after this, and a slow first boot can pass it before the hand-off begins. So the
 * launcher never decides on time alone: from this mark it polls for positive proof and
 * shows its box only on it -- this board LISTENING (which start() reaches only after the
 * hand-off decided to serve here), or its serve-here signal (SERVE_HERE_SIGNAL_ENV),
 * which the same decision writes. Time never shows the box.
 */
const HANDOFF_CHECK_FOR_SERVING_AFTER_MS = HANDOFF_BUDGET_MS + PROBE_TIMEOUT_MS + MIN_PORT_RELEASE_WAIT_MS + PROBE_TIMEOUT_MS;

/**
 * 🔑 #2983: the POSITIVE "this board is serving from the launcher's console" proof.
 * The launcher (tools/windows/KosmosLauncher.cs) mints a unique path, puts it in
 * this environment variable, and starts server.js; this module writes the file the
 * instant handOffToTask decides to serve here (see signalServingHere), and the
 * launcher waits for it to exist.
 * ⚠️ WHY A SIGNAL AND NOT A TIMER. The launcher's other proof, the board's TCP
 * listener, cannot be read on a box where every GetExtendedTcpTable read fails, so
 * the launcher used to fall back to a time past which a successful hand-off was
 * ASSUMED to have exited. That assumption was wrong: on the "a same-identity board
 * is already serving" path server.js runs ensureInstalled (two schtasks calls) and
 * two roster syncs BEFORE the hand-off, ~72s worst case, so the timer fired a false
 * box during a slow-but-successful launch. This file is written ONLY on the
 * serve-here decision -- never while a hand-off is still being tried, never when one
 * succeeds (serve:false, and the process then exits) -- so it can never fire falsely,
 * however slow the boot. ONE spelling, pinned equal to the C# ServeHereSignalEnvVar
 * by tools.win-launcher-native.test.js.
 */
const SERVE_HERE_SIGNAL_ENV = 'KOSMOS_SERVE_HERE_SIGNAL';

/**
 * Write the serve-here signal, if the launcher asked for one. `env` defaults to the
 * real process environment, which is where the launcher sets the variable (server.js
 * passes only its LAUNCH_ENV_OVERRIDES to handOffToTask, never the whole environment,
 * so this reads process.env directly). The pid is the content so a paranoid launcher
 * could match its child; the launcher's unique path already makes mere existence
 * proof enough. Never throws: a board that cannot write the signal still serves, and
 * the launcher's listener proof stands.
 */
function signalServingHere(env) {
  const at = (env || process.env)[SERVE_HERE_SIGNAL_ENV];
  if (!at) return;
  try { fs.writeFileSync(at, String(process.pid)); } catch { /* the launcher's listener proof stands */ }
}

/**
 * 🔑 THE RUNNING BOARD'S IDENTITY COMES FROM A HEADER, NEVER FROM THE PAGE.
 * server.js reads `web/index.html` per request, so a new zip unpacked over the
 * running install -- the folder Explorer's Extract All offers by default -- makes
 * the OLD board serve the NEW page. The header is `boardIdentity` -- the build
 * and the booted world -- as the process computed it at start, so it names the
 * code, and the world, that is actually answering.
 * ⚠️ A board without the header predates this module, so it is never taken for
 * this one: a task board without it is replaced once.
 * GET / needs no token, so any caller can ask; the version is on the page anyway.
 */
const BOARD_IDENTITY_HEADER = 'x-kosmos-board';

/**
 * 🔑 #2973: WHETHER THE ANSWERING BOARD WAS STARTED BY ITS LOGON TASK, SAID BY THE BOARD.
 * The hand-off may end only the TASK's board, and it used to ask Task Scheduler whether
 * the task was running. That answer is not trustworthy: the localized status word
 * cannot be read in every language, and the Last Result code stops saying "running" as
 * soon as any `/Run` is ignored by IgnoreNew (measured, review round 1). The board
 * knows the fact outright (win32board.startedByTask, the marker its task's boot shim
 * stamps), and the hand-off already asks it who it is. So it says this too, on the same
 * response, and the hand-off reads it without schtasks or a locale.
 * `'1'` started by the task, `'0'` not. A board that predates this header sends
 * neither, and reads as null (see startedByTaskFromHeader).
 */
const BOARD_STARTED_BY_TASK_HEADER = 'x-kosmos-board-started-by-task';

/* The header's value for THIS process. ONE writer (server.js's GET /) and ONE reader
   (startedByTaskFromHeader), so the two spellings cannot drift. win32board is required
   when asked, never with this module. */
function boardStartedByTaskHeaderValue(env) {
  return require('./win32board').startedByTask(env) ? '1' : '0';
}

/* true / false from a board that sends the header; null from one that predates it (or
   sends something that is not ours), which the hand-off answers the old way. */
function startedByTaskFromHeader(value) {
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}

/**
 * Which build this app is: its package.json version, plus the commit the zip was
 * built from when it runs from the bundle. The version alone is not enough:
 * Windows zips are cut from main between version bumps, so two 0.6.55 zips can
 * carry different code. Both sides of the comparison call THIS function -- the
 * running board once at start for its header, the launching board for itself --
 * so there is one derivation. Never throws.
 */
function buildIdentity(appDir) {
  let version = '';
  try { version = String(JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version || ''); } catch { /* unreadable: no identity */ }
  if (!version) return null;
  let sha = '';
  /* The manifest sits at the bundle ROOT, beside runtime\node.exe. A source
     checkout has no runtime\node.exe, so a stray ../manifest.json beside a repo is
     never read. */
  const root = path.resolve(appDir, '..');
  try {
    if (fs.existsSync(path.join(root, 'runtime', 'node.exe'))) {
      sha = String(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).source_sha || '');
    }
  } catch { /* no manifest: the version alone */ }
  return /^[0-9a-f]{7,40}$/.test(sha) ? version + '+' + sha.slice(0, 12) : version;
}

/**
 * What an answering board must match to be "this one": the build AND the Kosmos
 * world it booted into. A board of this very build serving ANOTHER world (a world
 * switch whose restart never happened) is not the board this launch would serve,
 * and calling it "already running" would land the person on the wrong world's
 * data. Both sides call this with their own booted world (worldenv.bootedWorld()),
 * the running board once at start for its header and the launching one for
 * itself. Round 4 of the review found the gap once named worlds could hand off.
 */
function boardIdentity(build, worldId) {
  return build ? String(build) + '@' + String(worldId || '') : null;
}

/**
 * THIS boot's world attempt: taken back while a hand-off is tried, put back if
 * this board ends up serving after all.
 *
 * 🛑 THE TASK'S BOARD READS IT BEFORE WE ARE DONE. worldenv's bootstrap records
 * an attempt for a named world (#2528) that only `listening` clears. If it is
 * still on disk when `/Run` starts the task, the task's board counts it as a
 * failed boot -- and for a world that has never served, ONE is enough to abandon
 * it for the default world (measured on a sandbox registry in review round 5).
 * So it is retracted before the task can run, and restored only if this board
 * goes on to serve in its window, where a crash must still count.
 * Retract, not clear: attempts earlier boots really made still count. Seams:
 * `worldenv`, `guard`. Never throws.
 */
function thisBootsWorldAttempt(deps) {
  const d = deps || {};
  let taken = false;
  const withGuard = (fn) => {
    try {
      const we = d.worldenv || require('./worldenv');
      const guard = d.guard || require('./worldbootguard');
      return fn(guard, we.bootedBaseDir(), we.bootedWorld());
    } catch { return false; /* fail-open, as at the bind */ }
  };
  return {
    retract() { taken = Boolean(withGuard((g, base, id) => g.retractAttempt(base, id))); },
    restore() { if (taken) { withGuard((g, base, id) => g.recordAttempt(base, id)); taken = false; } },
  };
}

/**
 * Why a probe got the answer it did (win32-installer-native, round 3 finding 1; round 6 finding 1).
 *   answered           the port answered over HTTP
 *   refused            the connection was refused (ECONNREFUSED): the only proof that no board listens there
 *   timed-out          nothing came back within PROBE_TIMEOUT_MS. With a connect limit (the uninstall's and
 *                      the move's looks, probeBoardOnEveryAddress) the connection WAS made first. Without one
 *                      (the launcher's hand-off, the board restart) the one limit covers the connect as well,
 *                      so this is also a connect that did not finish, or a refusal slower than 2 s, which
 *                      Windows gives on this PC's own non-loopback addresses
 *   connect-timed-out  with a connect limit only: the connection was not made within CONNECT_TIMEOUT_MS
 *   unidentified       the every-address look only (round 7, finding 1): an HTTP answer without a Kosmos
 *                      identity from a bind host address. The real board answers a look there before routing
 *                      it (a 400 for a Host it does not route, a 403 from its remote guard), without the
 *                      identity header, so any HTTP answer there may be a board. `answering` is false for it.
 *   error              any other failure to look: a reset, an unreachable address, a reply that is not HTTP
 * With a connect limit a look also ends, as `timed-out`, by CONNECT_TIMEOUT_MS + PROBE_TIMEOUT_MS in all.
 * `answering` is false for every outcome but answered, as it always was, so the hand-off and the board
 * restart read a slow board as they always did. See boardMayBeOpen.
 */
const PROBE_OUTCOMES = Object.freeze({ ANSWERED: 'answered', REFUSED: 'refused', TIMED_OUT: 'timed-out', CONNECT_TIMED_OUT: 'connect-timed-out', UNIDENTIFIED: 'unidentified', ERROR: 'error' });

/* Where the launcher's hand-off looks, and one of the two loopbacks the uninstall and the move look on. */
const BOARD_LOOPBACK_V4 = '127.0.0.1';
const BOARD_LOOPBACK_V6 = '::1';
/* The two looks every every-address look makes, whose Host a board always routes. */
const LOOPBACK_PROBES = new Set([BOARD_LOOPBACK_V4, BOARD_LOOPBACK_V6]);
/* Bind hosts the two loopback probes already cover: loopback itself, and the wildcards, which accept
   loopback connections. */
const BIND_HOSTS_COVERED_BY_LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::']);
/* How long a name in KOSMOS_BIND_HOST may take to resolve before the probes go on without it. An unknown
   name answered ENOTFOUND in 67 ms on this box; 5 s leaves a slow resolver room, and keeps the uninstall
   from waiting on DNS for ever. */
const BIND_HOST_LOOKUP_TIMEOUT_MS = 5000;
/* Round 6, finding 1: how long the uninstall's and the move's looks give a connection to be made, before
   PROBE_TIMEOUT_MS starts counting the answer. Measured on this PC: a closed port on its own non-loopback
   addresses (LAN, Tailscale, link-local) is refused only after 2.02-2.04 s, because Windows retries the SYN
   after a reset, while loopback refuses in 1-2 ms. One 2 s limit on the connect and the answer together read
   every such refusal as a timeout, so a bind host of this PC's own address always looked open. 5 s is well
   above that. The launcher's hand-off does not use it (#2983). */
const CONNECT_TIMEOUT_MS = 5000;
/* The longest one every-address look can take: resolving a bind host name, then a connect and an answer on
   every address at once. The uninstall sizes its wait for an ended board from it. */
const EVERY_ADDRESS_LOOK_WORST_MS = BIND_HOST_LOOKUP_TIMEOUT_MS + CONNECT_TIMEOUT_MS + PROBE_TIMEOUT_MS;

/* Round 5, finding 4: only a refused connection proves nothing listens. Every other failure to connect
   (EADDRNOTAVAIL, ENETUNREACH, a reset) is a failed look, which may be a board: fail closed. ::1 cannot be
   switched off on Windows (KB 929852), so it refuses like any loopback. */
function outcomeOfFailedLook(err, timedOut, connectTimedOut) {
  if (connectTimedOut) return PROBE_OUTCOMES.CONNECT_TIMED_OUT;
  if (timedOut) return PROBE_OUTCOMES.TIMED_OUT;
  return err && err.code === 'ECONNREFUSED' ? PROBE_OUTCOMES.REFUSED : PROBE_OUTCOMES.ERROR;
}

/**
 * Is a board answering on this port, and which board is it? Never rejects. `host` defaults to 127.0.0.1,
 * the only address the launcher's hand-off asks (#2983).
 *
 * `options.connectTimeoutMs` (round 6, finding 1) splits the one limit in two: the connection gets that long
 * to be made, and PROBE_TIMEOUT_MS starts only once it is. Without it -- the hand-off and the board restart
 * -- one PROBE_TIMEOUT_MS covers the connect and the answer, exactly as before. `options.createConnection`
 * replaces the socket in a test.
 */
function probeBoard(port, host, options) {
  const connectLimit = options && options.connectTimeoutMs;
  return new Promise((resolve) => {
    let timedOut = false;
    let connectTimedOut = false;
    let connectTimer = null;
    let deadlineTimer = null;
    let settled = false;
    const settle = (answer) => { if (!settled) { settled = true; clearTimeout(connectTimer); clearTimeout(deadlineTimer); resolve(answer); } };
    const request = { host: host || BOARD_LOOPBACK_V4, port, path: '/' };
    if (!connectLimit) {
      request.timeout = PROBE_TIMEOUT_MS;
    } else if (options && typeof options.createConnection === 'function') {
      /* A test's socket. No `agent` with it: for `agent: false` Node's http builds a fresh Agent, which ignores
         createConnection and opens a real connection. */
      request.createConnection = options.createConnection;
    } else {
      /* Round 6, finding 1, measured: a look made right after a board went away reused the kept-alive socket of
         the look before it, and failed at once (`error`) instead of being refused. So a look with a connect
         limit always makes its own connection (`agent: false`: a fresh Agent that keeps nothing alive). */
      request.agent = false;
    }
    const req = http.get(request, (res) => {
      res.resume();
      const named = res.headers[BOARD_IDENTITY_HEADER];
      const startedByTask = startedByTaskFromHeader(res.headers[BOARD_STARTED_BY_TASK_HEADER]);
      res.on('end', () => settle({ answering: true, outcome: PROBE_OUTCOMES.ANSWERED, identity: typeof named === 'string' && named ? named : null, startedByTask }));
      /* With a connect limit, an answer cut off before its end (by the deadline below, or the board going) is not
         an answer. */
      if (connectLimit) res.on('close', () => settle({ answering: false, outcome: outcomeOfFailedLook(null, timedOut, connectTimedOut), identity: null, startedByTask: null }));
    });
    if (connectLimit) {
      /* Round 7, finding 3, measured: the answer limit is an idle timeout, so a listener that sends a byte every
         1.5 s kept one look alive for 16.6 s. So a look with a connect limit also ends, as `timed-out`, by
         CONNECT + ANSWER in all, which is what EVERY_ADDRESS_LOOK_WORST_MS counts. */
      deadlineTimer = setTimeout(() => { timedOut = true; req.destroy(new Error('look deadline')); }, connectLimit + PROBE_TIMEOUT_MS);
      req.on('socket', (socket) => {
        const limitTheAnswer = () => { clearTimeout(connectTimer); req.setTimeout(PROBE_TIMEOUT_MS); };
        if (!socket.connecting) { limitTheAnswer(); return; }
        connectTimer = setTimeout(() => { connectTimedOut = true; req.destroy(new Error('connect timeout')); }, connectLimit);
        socket.once('connect', limitTheAnswer);
      });
    }
    req.on('timeout', () => { timedOut = true; req.destroy(new Error('timeout')); });
    req.on('error', (err) => settle({
      answering: false,
      outcome: outcomeOfFailedLook(err, timedOut, connectTimedOut),
      identity: null,
      startedByTask: null,
    }));
  });
}

/**
 * For a caller about to take away what a running board depends on (the uninstall deleting its
 * folders, the move copying its folder): may a board be open on that port? ONE reading of a probe's
 * answer, shared by engine/win32uninstall.js and engine/win32relocate.js (convention 5).
 *
 * 🛑 ONLY A REFUSED CONNECTION MEANS NO BOARD. A busy board that answers after PROBE_TIMEOUT_MS read as
 * `answering: false`, and the uninstall ran under it (round 3, finding 1). A timeout, a failed look, or
 * no answer at all is a board that may be open. The hand-off does not use this: it still reads a
 * timeout as nobody there (#2983).
 */
function boardMayBeOpen(answer) {
  if (!answer) return true;
  if (answer.answering) return true;
  return answer.outcome !== PROBE_OUTCOMES.REFUSED;
}

/** An answer from a Kosmos board: it names its build, or says whether its task started it. */
function isKosmosBoardAnswer(answer) {
  return Boolean(answer && answer.answering && (answer.identity || typeof answer.startedByTask === 'boolean'));
}

/** An IP address as an interface lists it: IPv4-mapped IPv6 as IPv4, IPv6 in its canonical lower-case form. */
function canonicalAddress(bare) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
  if (mapped) return mapped[1];
  if (require('node:net').isIP(bare) !== 6) return bare;
  try { return new URL('http://[' + bare + ']/').hostname.slice(1, -1); } catch { return bare.toLowerCase(); }
}

/**
 * Round 5, findings 1 and 3: is this address one of this machine's own, so a board of this user could be
 * listening on it? Returns the spelling to probe it by, or null when it is not this machine's. Loopback
 * (127/8, ::1) always is. Anything else must be an address one of this machine's interfaces has, compared
 * without its zone, and a zone (`%14`, `%Ethernet 2`) must name that interface, by scope id or by name: the
 * same link-local address on another adapter is another address.
 *
 * Round 6, finding 1: a link-local address WITHOUT a zone (as a host name's lookup gives this PC's own) is
 * reached only through its interface, so it is probed with that interface's zone. Round 7, finding 5: every
 * interface that has it, since the same link-local address can be on two adapters and the board on either;
 * link-local is all of fe80::/10; and a scope id of 0 is no zone. Returns every spelling to probe it by, or
 * none when it is not this machine's. `interfaces` replaces os.networkInterfaces() in a test.
 */
function thisMachinesSpellings(address, interfaces) {
  const text = String(address);
  const at = text.indexOf('%');
  const bare = canonicalAddress(at < 0 ? text : text.slice(0, at));
  const zone = at < 0 ? null : text.slice(at + 1).toLowerCase();
  const kind = require('node:net').isIP(bare);
  if (kind === 0) return [];
  if ((kind === 4 && bare.startsWith('127.')) || bare === '::1') return [text];
  const all = interfaces || require('node:os').networkInterfaces();
  const spellings = [];
  for (const [name, list] of Object.entries(all)) {
    for (const i of list || []) {
      if (canonicalAddress(String(i.address)) !== bare) continue;
      if (zone !== null) {
        if (String(i.scopeid) === zone || name.toLowerCase() === zone) return [text];
        continue;
      }
      const spelling = isLinkLocalAddress(bare) && i.scopeid ? bare + '%' + i.scopeid : text;
      if (!spellings.includes(spelling)) spellings.push(spelling);
    }
  }
  return spellings;
}

/* fe80::/10, the link-local range: its first ten bits are 1111111010, so its first group is fe80 to febf. */
function isLinkLocalAddress(bare) {
  return /^fe[89ab][0-9a-f]:/i.test(bare);
}

/**
 * Round 5, findings 1 and 3: the addresses engine/bindhost.js's bindHost() names that a board of this user
 * could be listening on.
 *   - loopback, a wildcard, or nothing: none, because the two loopback probes cover them;
 *   - an IP literal: itself, zone kept, if it is this machine's own;
 *   - a name: every address dns.lookup gives, kept only when it is this machine's own.
 * A board cannot listen on an address this machine does not have (server.listen fails), so no other
 * address is ever probed, and no probe crosses the network to another machine. A name that does not
 * resolve, or does not resolve within BIND_HOST_LOOKUP_TIMEOUT_MS, adds nothing: a board could not have
 * bound it either. `lookup` replaces dns.lookup in a test.
 */
async function bindHostProbeAddresses(env, lookup, interfaces) {
  const bound = require('./bindhost').bindHost(env).replace(/^\[(.*)\]$/, '$1');
  if (!bound || BIND_HOSTS_COVERED_BY_LOOPBACK.has(bound.toLowerCase())) return [];
  let found = [bound];
  if (require('node:net').isIP(bound) === 0) {
    const resolve = typeof lookup === 'function' ? lookup : (name) => require('node:dns').promises.lookup(name, { all: true, verbatim: true });
    let timer = null;
    try {
      const results = await Promise.race([
        resolve(bound),
        new Promise((resolveTimeout) => { timer = setTimeout(() => resolveTimeout([]), BIND_HOST_LOOKUP_TIMEOUT_MS); }),
      ]);
      found = (results || []).map((result) => String(result.address));
    } catch {
      found = [];
    } finally {
      clearTimeout(timer);
    }
  }
  return found.flatMap((address) => thisMachinesSpellings(address, interfaces));
}

/**
 * Every address a Kosmos board of this user could be answering on (round 4, finding 1): both loopbacks,
 * and the bind host's own addresses (bindHostProbeAddresses). A wildcard bind accepts loopback
 * connections, so the loopbacks cover it. A board bound to an address set only in ANOTHER process's
 * environment cannot be seen from here; the board task's state is the backstop (the plan's known limits).
 */
async function boardProbeAddresses(env, lookup, interfaces) {
  const addresses = [BOARD_LOOPBACK_V4, BOARD_LOOPBACK_V6];
  for (const address of await bindHostProbeAddresses(env, lookup, interfaces)) {
    if (!addresses.some((known) => known.toLowerCase() === address.toLowerCase())) addresses.push(address);
  }
  return addresses;
}

/* Which of several looks says most about a board that may be open, most first. A board no task command
   can stop (it says its task did not start it, or is too old to say) outranks the task's own board, so it
   stops the removal with nothing changed at all (round 5, finding 2). A web page that is not Kosmos on one
   address never hides a timeout or a failed look on another. */
function opennessRank(answer) {
  if (isKosmosBoardAnswer(answer)) return answer.startedByTask === true ? 1 : 0;
  if ([PROBE_OUTCOMES.TIMED_OUT, PROBE_OUTCOMES.CONNECT_TIMED_OUT, PROBE_OUTCOMES.UNIDENTIFIED].includes(answer.outcome)) return 2;
  if (answer.answering) return 4;
  if (answer.outcome === PROBE_OUTCOMES.REFUSED) return 5;
  return 3;
}

/**
 * probeBoard on every address in boardProbeAddresses, all at once, so the look takes as long as its
 * slowest probe rather than their sum (plus resolving a bind host name, when there is one). The most open
 * answer wins, with the address it came from (`host`). The uninstall and the move read it with
 * boardMayBeOpen; the launcher's hand-off does not use it and still asks 127.0.0.1 alone (#2983).
 * `probeOne` replaces probeBoard, `lookup` replaces dns.lookup, and `interfaces` replaces os.networkInterfaces()
 * in a test.
 */
async function probeBoardOnEveryAddress(port, env, probeOne, lookup, interfaces) {
  const look = typeof probeOne === 'function' ? probeOne : probeBoard;
  const answers = await Promise.all((await boardProbeAddresses(env, lookup, interfaces)).map(async (host) => {
    let answer;
    try {
      answer = { ...(await look(port, host, { connectTimeoutMs: CONNECT_TIMEOUT_MS })), host };
    } catch {
      return { answering: false, outcome: PROBE_OUTCOMES.ERROR, identity: null, startedByTask: null, host };
    }
    /* Round 7, finding 1: on a bind host address the real board answers a look BEFORE routing it (a 400 for a
       Host it does not route, a 403 from its remote guard), and those answers carry no identity header. So
       there any HTTP answer without a Kosmos identity may be a board. On the two loopback probes a board
       always routes the look and names itself, so an answer without an identity there is not Kosmos. */
    if (!LOOPBACK_PROBES.has(host) && answer.answering && !isKosmosBoardAnswer(answer)) {
      return { answering: false, outcome: PROBE_OUTCOMES.UNIDENTIFIED, identity: null, startedByTask: null, host };
    }
    return answer;
  }));
  return answers.reduce((most, answer) => (opennessRank(answer) < opennessRank(most) ? answer : most));
}

/**
 * Round 4 finding 3, round 5 finding 5: why Kosmos cannot tell whether it is open, when its port gave no
 * answer, only a failed look. Shared by the uninstall and the move, which each add what to do next.
 * "Another program" only when the board task is KNOWN not to be registered: win32board.status() never
 * says a registered task is not running (`running` is true or null), so a registered task could still
 * be behind the port.
 */
function cannotTellIfOpenSentence(port, boardTask) {
  if (boardTask && boardTask.known && boardTask.registered === false) {
    return 'Another program is using port ' + port + ', so Kosmos cannot tell whether it is still open.';
  }
  return 'Kosmos could not tell whether it is still open.';
}

/* The logon task runs with the account's environment, not this launch's. A launch
   that asked for its own port or its own data folder would be handed to a board
   that serves neither -- and the hand-off would then end that working board as
   "not answering". Those launches serve from the launcher (its hidden console, or
   its --console window). */
function overriddenBy(env) {
  const e = env || {};
  if (e.PORT) return 'PORT';
  return Object.keys(e).find((k) => k.startsWith('AGENT_WORKFORCE_') && e[k]) || null;
}

/**
 * Should this boot hand off at all? Every "no" keeps today's behaviour: serve here.
 * `ensured` is win32board.ensureInstalled's answer from this same boot.
 */
function skipReason(o) {
  if (o.platform !== 'win32') return 'not Windows';
  if (o.byTask) return 'the logon task started this board';
  if (!o.bundle) return 'this board runs from a source checkout';
  if (!o.live) return 'live execution is not armed';
  const override = overriddenBy(o.env);
  if (override) return 'this launch sets ' + override + ', which the logon task would not use';
  const e = o.ensured;
  /* Only a task that was just registered or refreshed is known to be enabled AND to
     name this install. A task the person switched off or removed means they chose
     to run Kosmos from the launcher, and that is what they get. */
  if (!e || !e.ok || (e.action !== 'registered' && e.action !== 'refreshed')) {
    return 'the logon task is not ready (' + ((e && (e.action || e.because)) || 'unknown') + ')';
  }
  return null;
}

/**
 * The hand-off itself, once handOffToTask has decided one is due. Resolves to the
 * same shapes as handOffToTask; a throw is handled by the caller.
 */
async function attemptHandOff(o, deps) {
  const { board, probe, sleep, now } = deps;
  const port = o.port;
  /* server.js passes its BOARD_IDENTITY; without one nothing is ever "this one". */
  const mine = o.identity || null;
  const startedAt = o.startedAt !== undefined ? o.startedAt : now() - Math.round(process.uptime() * 1000);
  const deadline = startedAt + HANDOFF_BUDGET_MS;
  const left = () => Math.max(0, deadline - now());
  const isMine = (p) => p.answering && Boolean(mine) && p.identity === mine;
  /* Never STARTS a probe past `until`, so one wait overshoots by at most the
     probe already in flight (PROBE_TIMEOUT_MS) -- the figure the worst case in
     HANDOFF_BUDGET_MS is built from. */
  async function waitUntil(test, ms) {
    const until = now() + ms;
    for (;;) {
      const p = await probe(port);
      if (test(p)) return p;
      const rest = until - now();
      if (rest <= 0) return null;
      await sleep(Math.min(POLL_INTERVAL_MS, rest));
    }
  }
  const gone = (p) => !p.answering;
  const serveHere = (because) => ({ serve: true, attempted: true, because });

  const handedOff = { serve: false, exitCode: 0, say: 'Kosmos is running in the background now, and starts by itself when you log in.' };

  let ran = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0 && left() <= 0) break;
    const p = await probe(port);
    if (isMine(p)) return ran ? handedOff : { serve: false, exitCode: 0, say: 'Kosmos is already running. Your browser is opening it.' };
    if (p.answering) {
      /* Another board answers (another build, or another world). Only the TASK's
         board can be replaced from here:
         anything else on the port (a board in another window, or not a board at
         all) is somebody else's, and serving here reproduces today's message. */
      /* #2973: was the answering board started by the task? The board says so itself
         (BOARD_STARTED_BY_TASK_HEADER), and its word wins. Only a board that predates the
         header is looked up in Task Scheduler, whose `running` is true, false, or null
         when it could not tell. Only a board PROVEN to be the task's is ended from here;
         could-not-tell keeps the window. */
      const byTask = typeof p.startedByTask === 'boolean' ? p.startedByTask : board.status().running;
      if (byTask !== true) {
        return serveHere(byTask === false
          ? 'something the logon task did not start is already using port ' + port
          : 'we could not tell whether the logon task started what is already using port ' + port + ', so it was left running');
      }
      /* With no time left to start its replacement, a working older board is
         worth more than a window: keep it, and let this launch report the port. */
      if (left() <= 0) return serveHere('there was no time left to replace the older Kosmos that is running');
      await sleep(Math.min(OLD_BOARD_GRACE_MS, left()));
      const ended = board.end();
      if (!ended.ok) return serveHere(ended.because);
      if (!(await waitUntil(gone, Math.max(left(), MIN_PORT_RELEASE_WAIT_MS)))) return serveHere('the older Kosmos did not stop');
    }
    if (left() <= 0) break;
    const r = board.runNow();
    if (!r.ok) return serveHere(r.because);
    ran = true;
    /* `schtasks /Run` reports success for a run that started nothing (measured,
       win32board.taskXml), so only a board answering as THIS one is proof. Any
       other board answering instead is a task board that was still booting when we
       looked -- an older build, or another world -- and the next round replaces it. */
    const up = await waitUntil((q) => q.answering, left());
    if (!up) break;
    if (isMine(up)) return handedOff;
  }
  /* Not confirmed. End the task so a late start cannot take the port from the
     board about to serve here, then let it go. */
  if (!ran) return serveHere('there was no time left to start the background board');
  board.end();
  await waitUntil(gone, Math.max(left(), MIN_PORT_RELEASE_WAIT_MS));
  return serveHere('the background board did not answer in time');
}

/**
 * 🛑 #3016: THE OLDER-BUILD HAND-OFF. A double-clicked older Kosmos.exe reaches
 * here with `ensured.downgrade` set: its boot found a NEWER build already anchored
 * and win32anchor refused to re-point the fleet to this older one (Josh's rule:
 * "never downgrade; hand off to, or update to, the newest copy instead"). So this
 * NEVER ends or replaces the running board -- doing so would let the older build
 * take the fleet, the exact defect this guards. It hands the person to the newer
 * copy: if a board already answers (the newer fleet board the un-downgraded pointer
 * still names), leave it be; if none is up, `/Run` the task (which starts the newer
 * engine the pointer names) and leave once it answers. Only if the newer board will
 * not come up at all does it fall back to serving here.
 */
async function handOffToNewer(o, deps) {
  const { board, probe, sleep, now } = deps;
  const port = o.port;
  const startedAt = o.startedAt !== undefined ? o.startedAt : now() - Math.round(process.uptime() * 1000);
  const deadline = startedAt + HANDOFF_BUDGET_MS;
  const left = () => Math.max(0, deadline - now());
  const leave = { serve: false, exitCode: 0, say: 'You opened an older copy of Kosmos. The newer one already installed keeps running -- your browser is opening it.' };
  const serveHere = (because) => ({ serve: true, attempted: true, because });

  /* The newer fleet board is already serving in the normal case: leave it be. A
     non-Kosmos service on the port is not ours to open a browser to, and serving
     here would only meet the same port -- but we still must not take the fleet. */
  let p = await probe(port);
  if (p.answering) return isKosmosBoardAnswer(p) ? leave : serveHere('port ' + port + ' is in use by something that is not Kosmos');

  /* Nothing is up (a first boot, or the board is between restarts). Start the task,
     which runs the newer engine the kept pointer names, then leave once it answers.
     `/Run` reports success even when it starts nothing, so only an answering board
     is proof (win32board.taskXml). */
  const st = board.status();
  if (!(st && st.running === true)) {
    const r = board.runNow();
    if (!r.ok) return serveHere(r.because);
  }
  const until = now() + Math.max(left(), MIN_PORT_RELEASE_WAIT_MS);
  for (;;) {
    p = await probe(port);
    if (p.answering) return isKosmosBoardAnswer(p) ? leave : serveHere('port ' + port + ' is in use by something that is not Kosmos');
    if (now() >= until) break;
    await sleep(Math.min(POLL_INTERVAL_MS, until - now()));
  }
  return serveHere('a newer Kosmos is installed but did not answer in time');
}

/**
 * Hand this hand-started board to its logon task, or say why not.
 *
 * Resolves (never rejects) to one of:
 *   { serve: false, exitCode: 0, say }         the task's board is serving; leave
 *   { serve: true,  attempted: false, because } no hand-off was due; serve here
 *   { serve: true,  attempted: true,  because } one was tried and not confirmed
 *
 * `identity` is this process's boardIdentity, computed at start by server.js. The
 * rest are seams with real defaults: platform, env, bundle, byTask, live, board
 * (status/end/runNow), probe, sleep, now, startedAt, and `worlds` (the worldenv
 * and worldbootguard thisBootsWorldAttempt uses).
 */
async function handOffToTask(opts) {
  const o = opts || {};
  const result = await decideHandOff(o);
  /* #2983: one funnel for every serve:true outcome (skip, tried-and-unconfirmed,
     or a caught error), so the launcher's positive proof is written exactly when,
     and only when, this board is going to serve here. `o.signalEnv` is a test seam;
     the real board writes through process.env. */
  if (result && result.serve) signalServingHere(o.signalEnv);
  return result;
}

async function decideHandOff(o) {
  try {
    const board = o.board || require('./win32board');
    const probe = o.probe || probeBoard;
    const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = o.now || Date.now;
    /* 🛑 #3016: an older Kosmos.exe (ensured.downgrade) hands off to the NEWER copy
       instead of to a task of its own, and must not run skipReason's "is my task
       ready" gate -- there is no task for this older build to be ready. It still
       keeps to the launcher when this launch chose its own port or data folder, for
       overriddenBy's reason: the newer fleet board serves neither.
       🔑 THE INVARIANT THIS BRANCH RELIES ON: `ensured.downgrade` implies win32 AND a
       real bundle AND live execution armed. `downgrade` is set only by
       win32board.ensureInstalled, which returns early unless the platform is win32 and
       the root is a Kosmos build, and in production is called only from server.js's
       real-startup path, which has armed live execution before it runs. So `downgrade`
       can never be true off-win32, from source, or unarmed, and skipping those gates
       here is safe. If the condition that SETS downgrade ever loosens, restore the
       platform/bundle/live checks before the board.status()/runNow calls below, or
       they could fire in an unarmed context. */
    const downgrade = Boolean(o.ensured && o.ensured.downgrade);
    if (!downgrade) {
      const skip = skipReason({
        platform: o.platform || process.platform,
        env: o.env || process.env,
        byTask: o.byTask !== undefined ? o.byTask : board.startedByTask(),
        bundle: o.bundle !== undefined ? o.bundle : Boolean(board.bundleRoot()),
        live: o.live !== undefined ? o.live : require('./live-execution').liveExecutionAllowed(),
        ensured: o.ensured,
      });
      if (skip) return { serve: true, attempted: false, because: skip };
    } else {
      const override = overriddenBy(o.env || process.env);
      if (override) return { serve: true, attempted: false, because: 'this launch sets ' + override + ', so it keeps to the launcher; the newer Kosmos keeps running' };
    }

    /* This boot's world attempt comes off BEFORE the task can run (see
       thisBootsWorldAttempt), and goes back on if this board serves after all. */
    const attempt = thisBootsWorldAttempt(o.worlds);
    attempt.retract();
    const runHandOff = downgrade ? handOffToNewer : attemptHandOff;
    const result = await runHandOff(o, { board, probe, sleep, now })
      .catch((err) => ({ serve: true, attempted: true, because: 'the hand-off failed (' + String((err && err.message) || err) + ')' }));
    if (result.serve) attempt.restore();
    return result;
  } catch (err) {
    return { serve: true, attempted: true, because: 'the hand-off failed (' + String((err && err.message) || err) + ')' };
  }
}

/* probeBoard is also how the Windows updater (engine/win32apply.js) confirms which board came back
   after a swap, so there is one reading of the identity header. */
module.exports = {
  handOffToTask, buildIdentity, boardIdentity, probeBoard, boardMayBeOpen, probeBoardOnEveryAddress, cannotTellIfOpenSentence, PROBE_OUTCOMES, EVERY_ADDRESS_LOOK_WORST_MS, BOARD_IDENTITY_HEADER, HANDOFF_CHECK_FOR_SERVING_AFTER_MS,
  BOARD_STARTED_BY_TASK_HEADER, boardStartedByTaskHeaderValue, startedByTaskFromHeader, SERVE_HERE_SIGNAL_ENV, signalServingHere,
};
