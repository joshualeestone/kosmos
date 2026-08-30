'use strict';

/**
 * The connect routes, driven against the real server.
 *
 * A separate file from `server.test.js` for the same reason as
 * `server.projects.test.js`: that file's blocks are a standing merge hazard,
 * and this feature can add a file instead of a conflict.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE, plus one this feature adds: the
 * Claude config. `subscription` fixes its path at load and the real file is
 * the operator's live account -- and `connect.start()` DECIDES things by
 * reading it, so an unsandboxed run would decide from the operator's reality.
 * DRY_RUN is armed so nothing here can run a real program.
 *
 *   node --test server.connect.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects'); // sandboxed whole (#634)
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
/* Both sandbox knobs travel together (#527): the scoped check resolves
   the DEFAULT account's record through accounts, whose HOME is its own
   seam; without this, a future default-dir scoped check in this file
   would read the operator's real ~/.claude.json while believing itself
   sandboxed. */
process.env.AGENT_WORKFORCE_HOME = HOME;
// The two sandbox seams travel together (launchSignin warns loudly otherwise,
// and a warning that fires on every green run trains people to ignore it).
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
// `/bin/echo` exists and is executable, which is all "Claude is installed"
// means to `start` -- so no test here ever reaches the download path.
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
/* ⚠️ A FAKE TMUX, NOT /bin/echo (#332). echo stubbed the writes and printed
   its arguments to the reads, which the parser refused, so every read fell
   through to the real tmux on the PATH and these tests measured the
   operator's live fleet. The fake answers reads from fixtures (none set here:
   an empty board) and echoes everything else, so write-side receipts hold. */
process.env.AGENT_WORKFORCE_TMUX_BIN = require('node:path').join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const connect = require('./engine/connect');
const accounts = require('./engine/accounts');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await connect.cancel().catch(() => {});
  connect.resetForTests();
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function req(p, options) {
  const res = await fetch(base + p, options);
  return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
}
const json = (r) => JSON.parse(r.body);

async function post(p, body, origin) {
  return req(p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: origin || base },
    body: JSON.stringify(body || {}),
  });
}

const CONNECTED_CONFIG = {
  oauthAccount: {
    organizationType: 'claude_max',
    billingType: 'stripe_subscription',
    organizationRateLimitTier: 'default_claude_max_20x',
  },
};

test('the state route answers idle before anything has happened', async () => {
  const got = await req('/api/connect');
  assert.match(got.type, /application\/json/);
  assert.equal(got.status, 200);
  assert.equal(json(got).phase, 'idle');
});

test('the state route never 500s, even when the engine itself throws', async () => {
  /**
   * ⚠️ Same contract as /api/machine: a state question always gets an answer.
   * Proven by making the engine throw, not by trusting the catch to be there.
   */
  const real = connect.state;
  connect.state = () => { throw new Error('engine on fire'); };
  try {
    const got = await req('/api/connect');
    assert.equal(got.status, 200, 'a state question was answered with an error status');
    // `unsure`, not `stuck`: the page paints stuck as a failed ATTEMPT, and
    // an engine crash is "we cannot tell", which is a third answer.
    assert.equal(json(got).phase, 'unsure');
    assert.match(json(got).tail, /engine on fire/, 'the reason was swallowed');
  } finally {
    connect.state = real;
  }
});

test('every connect write is a POST behind the cross-site guard', async () => {
  // ⚠️ /start DOWNLOADS AND RUNS SOFTWARE. Without the guard, any website you
  // visit could make this machine fetch and execute a binary.
  for (const p of ['/api/connect/start', '/api/connect/code', '/api/connect/cancel']) {
    const cross = await post(p, {}, 'https://example.com');
    assert.equal(cross.status, 403, `${p} accepted a cross-site POST`);
  }
});

test('a code with no flow running is refused with the reason', async () => {
  const got = await post('/api/connect/code', { code: 'abCD1234#efGH5678' });
  assert.equal(got.status, 409);
  assert.match(json(got).error, /not running/);
});

test('the page and the engine agree on which phases are active', () => {
  /**
   * ⚠️ `frConnActive` is a hand copy of the engine's ACTIVE_PHASES (one-file
   * page, no imports). The drift consequence is named in both comments: a
   * phase added to the engine and missed in the page becomes a panel-less
   * state whose watcher stops polling -- a frozen screen. This is the test
   * those comments ask for.
   */
  const raw = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const m = raw.match(/function frConnActive[\s\S]*?return \[([\s\S]*?)\]\.includes/);
  assert.ok(m, 'frConnActive (or its list) vanished from the page');
  const pageList = m[1].match(/'[^']+'/g).map((s) => s.slice(1, -1)).sort();
  assert.deepEqual(pageList, [...connect.ACTIVE_PHASES].sort(),
    'the page and the engine disagree about which phases are live');
});

test('a live record from ANOTHER process is reported as it stands, not as interrupted', () => {
  /**
   * ⚠️ "Another pid" is not "a dead pid". pid 1 (launchd) is definitionally
   * alive, so a mid-flight record carrying it must keep its phase; only a
   * pid the kernel says is gone earns the interrupted verdict.
   */
  connect.resetForTests();
  const file = connect.STATE_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({
      phase: 'downloading', progress: { got: 5, total: 10 }, pid: 1,
      updatedAt: new Date().toISOString(),
    }));
    assert.equal(connect.state().phase, 'downloading',
      'a live flow in another process was declared interrupted from pid inequality alone');

    // ⚠️ But a live pid with an HOUR-stale record is a recycled pid, not a
    // flow: without the freshness bound, that record renders as live progress
    // nobody is moving, forever.
    fs.writeFileSync(file, JSON.stringify({
      phase: 'downloading', progress: { got: 5, total: 10 }, pid: 1,
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }));
    assert.equal(connect.state().phase, 'interrupted',
      'an hour-dead record with a recycled pid was reported as live progress');

    // ⚠️ And NO timestamp fails CLOSED. The first version leaned on
    // Date.parse coercion and would have failed OPEN into "live forever" if
    // the parse ever changed; the comment records the rule, this pins it.
    fs.writeFileSync(file, JSON.stringify({
      phase: 'downloading', progress: { got: 5, total: 10 }, pid: 1,
    }));
    assert.equal(connect.state().phase, 'interrupted',
      'a live-pid record with no timestamp at all was treated as a live foreign flow');

    fs.writeFileSync(file, JSON.stringify({
      phase: 'downloading', progress: { got: 5, total: 10 }, pid: 999999999,
      updatedAt: new Date().toISOString(),
    }));
    // CONTROL: the dead-pid case still earns the verdict.
    assert.equal(connect.state().phase, 'interrupted');
  } finally {
    fs.rmSync(file, { force: true });
    connect.resetForTests();
  }
});

test('cancel refuses to destroy a LIVE flow belonging to another process', () => {
  /**
   * ⚠️ `state()` deliberately reports a second server's live flow as it
   * stands; a cancel posted to the WRONG server must then refuse to kill
   * that flow's session and clobber its record -- the reporting side and the
   * destructive side must agree about whose flow it is. pid 1 is
   * definitionally alive; the fresh timestamp makes it a live flow.
   */
  connect.resetForTests();
  const file = connect.STATE_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record = {
    phase: 'downloading', progress: { got: 5, total: 10 }, pid: 1,
    updatedAt: new Date().toISOString(),
  };
  return (async () => {
    try {
      fs.writeFileSync(file, JSON.stringify(record));
      const st = await connect.cancel();
      assert.equal(st.phase, 'downloading',
        'cancel on the non-owning server reported it had cancelled a flow it does not own');
      const after = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(after.phase, 'downloading',
        'cancel on the non-owning server clobbered the owner\'s live record');

      // CONTROL: the same record from a DEAD pid is the orphan case, and
      // cancel must clean that one.
      fs.writeFileSync(file, JSON.stringify({ ...record, pid: 999999999 }));
      const st2 = await connect.cancel();
      assert.equal(st2.phase, 'idle', 'the orphan case stopped being cleanable');
    } finally {
      // the second cancel rewrote the file to idle; remove it for later tests
      fs.rmSync(file, { force: true });
      connect.resetForTests();
    }
  })();
});

test('start also refuses to clobber a LIVE flow belonging to another process', async () => {
  /**
   * ⚠️ Start is a write path too: without the same refusal cancel carries, a
   * start on the non-owning server wrote IDLE over the owner's live record
   * and then killed the shared-named session out from under it.
   */
  connect.resetForTests();
  const file = connect.STATE_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record = {
    phase: 'signin-awaiting-code', url: 'https://claude.com/oauth?x=1', pid: 1,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(file, JSON.stringify(record));
    const st = await connect.start();
    assert.equal(st.phase, 'signin-awaiting-code',
      'start on the non-owning server did not report the owner\'s flow');
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(after.phase, 'signin-awaiting-code',
      'start on the non-owning server clobbered the owner\'s live record');
    assert.equal(after.pid, 1, 'the record changed hands');
  } finally {
    fs.rmSync(file, { force: true });
    connect.resetForTests();
  }
});

test('a code posted to the non-owning server is refused with the TRUE sentence', () => {
  /**
   * ⚠️ state() on this server reports the other server's live paste prompt,
   * so the UI renders a paste box here -- and "the sign-in is not running"
   * would then be a false sentence. The refusal must say where the code
   * actually goes.
   */
  connect.resetForTests();
  const file = connect.STATE_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({
      phase: 'signin-awaiting-code', url: 'https://claude.com/oauth?x=1', pid: 1,
      updatedAt: new Date().toISOString(),
    }));
    const put = connect.submitCode('abCD1234#efGH5678');
    assert.equal(put.ok, false);
    assert.match(put.because, /another Kosmos window/,
      'the refusal claims the sign-in is not running while state() reports it running');
    // CONTROL: with no record at all, the plain not-running sentence returns.
    fs.rmSync(file, { force: true });
    assert.match(connect.submitCode('abCD1234#efGH5678').because, /not running/);
  } finally {
    fs.rmSync(file, { force: true });
    connect.resetForTests();
  }
});

test('a malformed code is a 400; asking at the wrong moment stays a 409', async () => {
  // The state conflict, through the real engine: nothing is running.
  const conflict = await post('/api/connect/code', { code: 'abCD1234#efGH5678' });
  assert.equal(conflict.status, 409);

  // The format refusal is only reachable with a flow parked at awaiting-code,
  // which the DRY_RUN harness cannot reach -- so the ROUTE MAPPING is tested
  // by handing it the engine's format verdict directly. The verdict itself
  // (bad charset => kind: 'format') is pinned in engine/connect.test.js.
  const real = connect.submitCode;
  connect.submitCode = () => ({ ok: false, kind: 'format', because: 'that does not look like a sign-in code' });
  try {
    const bad = await post('/api/connect/code', { code: 'nope;`$(x)`' });
    assert.equal(bad.status, 400, 'a malformed code was answered as a state conflict');
    assert.match(json(bad).error, /does not look like/);
  } finally {
    connect.submitCode = real;
  }
});

test('a body that is not JSON is a 400, not a crash', async () => {
  const got = await req('/api/connect/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: 'not json {',
  });
  assert.equal(got.status, 400);
  assert.match(json(got).error, /could not read/);
});

test('start on an already-connected machine answers connected and runs nothing', async () => {
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(CONNECTED_CONFIG));
  try {
    const got = await post('/api/connect/start');
    assert.equal(got.status, 200, got.body);
    assert.equal(json(got).phase, 'connected');
    assert.equal(json(got).plan, 'Claude Max 20x');
  } finally {
    fs.rmSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, { force: true });
    connect.resetForTests();
  }
});

/**
 * #1585: THE ROUTE SUITE COULD NOT SEE THE #1560 GUARD. Measured before writing
 * this: replacing connect.js's `live.state === NONE` branch with `if (false)`
 * left every test in THIS file green, while it correctly reds
 * engine/connect.test.js. The engine suite drives the guard through
 * `subscription.setRunner`; the route suite never did, so a paid-plan file plus
 * a signed-out world was never exercised at the /api/connect/start layer. These
 * two tests are the route-layer mirror of the engine's #1560 pair. The seam is
 * `subscription.setRunner` (the same seam the /api/accounts live tests below
 * use).
 */
test('#1585: a connected-looking FILE does not answer connected through the route when the world says signed out', async () => {
  const subscription = require('./engine/subscription');
  // The paid-plan file alone answers connected, proven by the test above.
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(CONNECTED_CONFIG));
  // Force the LIVE check to report signed-out. The #1560 guard must then run
  // the sign-in the person asked for rather than refusing it on the file alone.
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: false }), err: null }));
  try {
    const got = await post('/api/connect/start');
    assert.equal(got.status, 200, got.body);
    assert.notEqual(json(got).phase, 'connected',
      'the file said connected and the person is signed out: the route must run the sign-in, not answer connected (was: ' + json(got).phase + ')');
  } finally {
    subscription.setRunner(null);
    fs.rmSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, { force: true });
    connect.resetForTests();
  }
});

test('#1585 CONTROL: when the world agrees the file, the route still answers connected', async () => {
  // Without this arm the test above is satisfied by a change that simply never
  // reports connected, which would break every genuinely connected person. This
  // is the arm that must stay green, so the guard is not free to answer "not
  // connected" always.
  const subscription = require('./engine/subscription');
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(CONNECTED_CONFIG));
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true }), err: null }));
  try {
    const got = await post('/api/connect/start');
    assert.equal(got.status, 200, got.body);
    assert.equal(json(got).phase, 'connected',
      'the file and the live check both say connected: the route must answer connected');
    assert.equal(json(got).plan, 'Claude Max 20x');
  } finally {
    subscription.setRunner(null);
    fs.rmSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, { force: true });
    connect.resetForTests();
  }
});

test('#1585 CONTROL: an UNVERIFIABLE live check keeps connected rather than forcing a sign-in through the route', async () => {
  // The third live state matters and is load-bearing (connect.js reads NONE,
  // not "!== CONNECTED"). checkLive answers UNKNOWN when it cannot reach Claude
  // Code at all, which is a statement about our instrument, not the person.
  // Treating that as signed-out would push a genuinely connected customer into
  // a sign-in every time the probe was flaky: this card's harm from the other
  // side. So the route must still answer connected on an unverifiable check.
  const subscription = require('./engine/subscription');
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(CONNECTED_CONFIG));
  subscription.setRunner(async () => { throw new Error('claude is not reachable'); });
  try {
    const got = await post('/api/connect/start');
    assert.equal(got.status, 200, got.body);
    assert.equal(json(got).phase, 'connected',
      'an unverifiable live check must not be read as positive evidence the file is wrong (was: ' + json(got).phase + ')');
  } finally {
    subscription.setRunner(null);
    fs.rmSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, { force: true });
    connect.resetForTests();
  }
});

test('#1492: start with accountDir signs in to an EXISTING account instead of making a second one', async () => {
  /* Josh's sister, first outside install: her Claude login expired, Settings
     correctly said not connected, and the ONLY affordance was "add a provider".
     That route is `another:true` below, which picks a FREE spot and makes a NEW
     record -- so an expired token became a duplicate account and she could not
     move her agent onto either.

     ⭐ The engine could always do this: `connect.start()` has taken a configDir
     since it was written and `another:true` already uses it. What was missing
     was a way to ASK for a directory that already exists. */
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(CONNECTED_CONFIG));
  const work1 = path.join(process.env.HOME, '.claude-work1');
  const work2 = path.join(process.env.HOME, '.claude-work2');
  try {
    // Make one extra account the ordinary way, so there is something to go back to.
    await post('/api/connect/start', { another: true });
    await post('/api/connect/cancel');
    assert.ok(fs.existsSync(work1), 'the fixture never made the first work account');
    /* 🛑 AND GIVE IT AN IDENTITY, because that is her actual state. `list()`
       reports an account only when `identityOf()` finds an `oauthAccount`, so a
       PREPARED-but-never-signed-in directory is not an account yet. Hers was: it
       existed, Settings named it, and only the TOKEN had expired. A fixture
       without this tests a directory nobody could have been looking at. */
    fs.writeFileSync(path.join(work1, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: 'expired@example.com' } }), 'utf8');
    assert.ok(accounts.list().some((a) => a.dir === work1),
      'the fixture account is not one the engine reports, so this would test the wrong refusal');

    const got = await post('/api/connect/start', { accountDir: work1 });
    assert.equal(got.status, 200, got.body);
    assert.equal(json(got).configDir, work1,
      'signing in again did not target the account that was asked for');

    /* 🛑 THE ASSERTION THE CARD IS ABOUT. Re-authenticating must not leave a
       second record behind, which is the whole defect. */
    assert.ok(!fs.existsSync(work2),
      'signing in again to an existing account created ANOTHER account, which is the duplicate this card exists to stop');
  } finally {
    fs.rmSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, { force: true });
    fs.rmSync(work1, { recursive: true, force: true });
    fs.rmSync(work2, { recursive: true, force: true });
    await post('/api/connect/cancel');
    connect.resetForTests();
  }
});

test('#1492: a non-canonical path still names the account it points at', async () => {
  /* Same reason as #1486: `accounts.list()` stores a resolved dir, so comparing
     an unresolved request would miss an account that is genuinely here and send
     the person straight back to the duplicate-making route. Built by
     CONCATENATION because path.join would normalise it away. */
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(CONNECTED_CONFIG));
  const work1 = path.join(process.env.HOME, '.claude-work1');
  try {
    await post('/api/connect/start', { another: true });
    await post('/api/connect/cancel');
    fs.writeFileSync(path.join(work1, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: 'expired@example.com' } }), 'utf8');
    const wobbly = work1 + '/../' + path.basename(work1) + '/';
    assert.notEqual(wobbly, work1, 'the fixture normalised itself');
    const got = await post('/api/connect/start', { accountDir: wobbly });
    assert.equal(got.status, 200, got.body);
    assert.equal(json(got).configDir, work1);
  } finally {
    fs.rmSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, { force: true });
    fs.rmSync(work1, { recursive: true, force: true });
    await post('/api/connect/cancel');
    connect.resetForTests();
  }
});

test('#1492 CONTROL: an unknown folder is REFUSED, never quietly made into an account', async () => {
  /* Without this the mode above would be a back door that creates accounts from
     any string, which is the very defect it exists to remove, arriving under a
     helpful name. */
  const stranger = path.join(process.env.HOME, '.claude-not-an-account');
  const got = await post('/api/connect/start', { accountDir: stranger });
  assert.equal(got.status, 400, got.body);
  assert.match(json(got).error, /do not know that account/);
  assert.ok(!fs.existsSync(stranger), 'an unknown folder was created by asking to sign in to it');
});

test('#1492 CONTROL: asking for both a new account and an existing one is refused', async () => {
  const work1 = path.join(process.env.HOME, '.claude-work1');
  const got = await post('/api/connect/start', { another: true, accountDir: work1 });
  assert.equal(got.status, 400, got.body);
  assert.match(json(got).error, /not both/);
});

test('#248: start with another:true points the flow at a fresh prepared work account', async () => {
  /* The global machine is CONNECTED, which is exactly when a person adds a
     second account; without the scoped flow this would answer connected
     and run nothing. */
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(CONNECTED_CONFIG));
  try {
    const got = await post('/api/connect/start', { another: true });
    assert.equal(got.status, 200, got.body);
    const st = json(got);
    const workDir = path.join(process.env.HOME, '.claude-work1');
    assert.equal(st.configDir, workDir, 'the flow does not name the fresh account directory');
    assert.notEqual(st.phase, 'connected',
      'the second-account flow early-exited on the GLOBAL account');
    /* Prepared from birth: the directory exists and its memory is the one
       shared tree, so the account is right before anybody signs in to it. */
    assert.ok(fs.existsSync(workDir), 'the work directory was never made');
    const projects = path.join(workDir, 'projects');
    assert.ok(fs.lstatSync(projects).isSymbolicLink(), 'the shared-memory link was not wired');
    /* And the plain start still answers for the global account with no
       directory, byte for byte the call it always was. */
    await post('/api/connect/cancel');
    const plain = await post('/api/connect/start');
    assert.equal(json(plain).phase, 'connected');
    assert.equal(json(plain).configDir, null);
  } finally {
    fs.rmSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, { force: true });
    fs.rmSync(path.join(process.env.HOME, '.claude-work1'), { recursive: true, force: true });
    await post('/api/connect/cancel');
    connect.resetForTests();
  }
});

/* --------------------------------------------------------------------------
   The connect painter, RUN rather than grepped -- same harness discipline as
   server.test.js's first-run render tests.
   -------------------------------------------------------------------------- */

function pageFunction(name, prelude = '') {
  const raw = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const start = script.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  let depth = 0; let end = -1;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  // eslint-disable-next-line no-new-func
  return new Function(`${prelude}\n${script.slice(start, end)}\nreturn ${name};`)();
}

function connectHarness(st) {
  const raw = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const tables = ['FR_SAY', 'FR_GLYPH', 'FR_CONN_SAY'].map((n) => {
    const m = script.match(new RegExp('const ' + n + ' = \\{[^}]*\\};'));
    assert.ok(m, n + ' vanished from the page');
    return m[0];
  }).join('\n');
  const realEsc = pageFunction('esc');
  const realRow = pageFunction('frCheckRow', 'const esc = ' + realEsc.toString() + ';\n' + tables);
  const realMB = pageFunction('frMB');
  const realBefore = pageFunction('frConnBefore');
  const realProgress = pageFunction('frConnPaintProgress',
    'const frMB = ' + realMB.toString() + ';\n'
    + 'const document = { getElementById: () => null };');
  const realPaintUrl = pageFunction('frConnPaintUrl',
    'const esc = ' + realEsc.toString() + ';\n'
    + 'const document = { getElementById: () => null };');

  const prelude = `
    const esc = ${realEsc.toString()};
    ${tables}
    const frCheckRow = ${realRow.toString()};
    const frMB = ${realMB.toString()};
    const frConnBefore = ${realBefore.toString()};
    let FR_CONN_LAST = null;
    let FR_STEP = 3;
    const __els = {};
    const document = { getElementById: (id) => (__els[id] = __els[id] || { innerHTML: '', textContent: '', style: {}, onclick: null, onkeydown: null }) };
    const frConnPaintProgress = ${realProgress.toString()};
    const frConnPaintUrl = ${realPaintUrl.toString()};
    let __actions = null;
    /* ⚠️ THIS STUB MUST MIRROR THE REAL frActions, INCLUDING ITS GUARD. The page
       gained "no primary means no action yet" for the screen that searches for
       agents already on this computer: it paints before it has an answer, and
       any button it offered then would be a guess. This copy still dereferenced
       primary.label, so FIVE tests died with "Cannot read properties of null"
       on a product that was correct -- and a red suite refuses a cut.
       📌 A stub is a copy of a contract, and it goes stale silently. */
    function frActions(primary, alt) {
      __actions = { primary: primary && primary.label, alt: alt && alt.label };
    }
    function frGo() {}
    function frRecheck() {}
    function frConnectStart() {}
    function frConnCancel() {}
    function frConnSubmitCode() {}
    globalThis.__els = __els;
    globalThis.__actions = () => __actions;
  `;
  const paint = pageFunction('frPaintConnect', prelude);
  paint(st);
  return { paint, els: globalThis.__els, actions: globalThis.__actions() };
}

test('every phase the server can answer renders a panel with a way onward', () => {
  const phases = {
    downloading: /Downloading Claude/,
    installing: /Setting Claude up/,
    'signin-launching': /Getting the sign-in ready/,
    'signin-browser-open': /Your browser has opened/,
    'signin-awaiting-code': /put it here/,
    'signin-completing': /Finishing the sign-in/,
    stuck: /could not finish connecting/,
    interrupted: /interrupted/,
  };
  for (const [phase, wants] of Object.entries(phases)) {
    const { els, actions } = connectHarness({ phase, because: 'x', progress: { got: 0, total: null } });
    assert.match(els['fr-sub'].innerHTML, wants, `phase ${phase} did not render its panel`);
    assert.ok(actions && (actions.primary || actions.alt),
      `phase ${phase} left the person short of a way onward`);
  }
});

test('what the terminal said is shown escaped, never executed', () => {
  /**
   * ⚠️ The tail is CAPTURED TERMINAL OUTPUT -- whatever the CLI printed,
   * including anything an error message quotes back. It goes to innerHTML, so
   * an unescaped tail is script injection into the page that manages every
   * agent on the machine.
   */
  const { els } = connectHarness({
    phase: 'stuck',
    because: 'a <b>reason</b> with markup',
    tail: '<script>alert(1)</script> & <img src=x onerror=y>',
  });
  const out = els['fr-sub'].innerHTML;
  assert.ok(!out.includes('<script>alert'), 'the pane tail reached the page unescaped');
  assert.ok(!out.includes('<img src=x'), 'the pane tail reached the page unescaped');
  assert.ok(out.includes('&lt;script&gt;'), 'the tail is not shown at all, which hides what happened');
  assert.ok(!out.includes('<b>reason</b>'), 'the because sentence reached the page unescaped');
});

test('the sign-in URL lands in the href escaped', () => {
  const { els } = connectHarness({
    phase: 'signin-awaiting-code',
    url: 'https://claude.com/oauth?a=1&state="><script>x</script>',
  });
  // The link lives in its own in-place-updatable container now.
  const out = els['fr-conn-url'].innerHTML;
  assert.ok(out.includes('href="https://claude.com/oauth?a=1&amp;state=&quot;&gt;'),
    'the URL was not escaped into the href');
  assert.ok(!out.includes('"><script>'), 'the URL broke out of its attribute');
});

test('a URL that arrives after the phase painted still surfaces, without a rebuild', () => {
  /**
   * ⚠️ The terminal prints the URL a capture-tick after the paste prompt
   * sometimes; the engine writes it late for exactly that case, and the
   * page's repaint key deliberately ignores it (a rebuild would empty the
   * code input mid-typing). The targeted updater is what reconciles the two:
   * link appears, panel untouched.
   */
  const h = connectHarness({ phase: 'signin-awaiting-code', url: null });
  assert.equal(h.els['fr-conn-url'].innerHTML, '', 'a link rendered before any URL existed');
  h.els['fr-sub'].innerHTML = 'SENTINEL: unchanged means untouched';
  h.paint({ phase: 'signin-awaiting-code', url: 'https://claude.com/oauth?late=1' });
  assert.ok(h.els['fr-conn-url'].innerHTML.includes('href="https://claude.com/oauth?late=1"'),
    'the late URL never surfaced; the fallback link is missing for the whole phase');
  assert.equal(h.els['fr-sub'].innerHTML, 'SENTINEL: unchanged means untouched',
    'the late URL rebuilt the panel, which empties the code input mid-typing');
});

test('a repaint on the same phase does not rebuild the screen under the person', () => {
  /**
   * ⚠️ The poll runs every second and a person may be halfway through typing
   * the code -- an innerHTML rebuild empties the input under their cursor.
   */
  const h = connectHarness({ phase: 'signin-awaiting-code', url: null });
  h.els['fr-sub'].innerHTML = 'SENTINEL: unchanged means untouched';
  h.paint({ phase: 'signin-awaiting-code', url: null });
  assert.equal(h.els['fr-sub'].innerHTML, 'SENTINEL: unchanged means untouched',
    'polling the same phase rebuilt the panel, which empties the code input mid-typing');
});

test('download progress is honest: a real total gets a bar, no total gets a count', () => {
  const h = connectHarness({ phase: 'downloading', progress: { got: 50000000, total: 100000000 } });
  assert.equal(h.els['fr-conn-fill'].style.width, '50%');
  assert.match(h.els['fr-conn-prog'].textContent, /50MB of 100MB/);

  const bare = connectHarness({ phase: 'downloading', progress: { got: 50000000, total: null } });
  assert.equal(bare.els['fr-conn-fill'].style.width, '0%',
    'with no Content-Length the bar pretended to know how far along it is');
  assert.match(bare.els['fr-conn-prog'].textContent, /50MB so far/);
});

test('start, poll, cancel: the flow is drivable through the routes alone', async () => {
  /**
   * DRY_RUN makes every subprocess a no-op that reports ok, so the driver
   * launches and then sits looking at a blank pane -- which is exactly enough
   * to prove the routes drive the engine: start answers with a live phase,
   * the poll sees it, cancel ends it.
   */
  connect.setTickInterval(15);
  /* The binary-present branch must be reached on the probe's own merits, not on
     the dry-run fake that #1568/#1571 taught start() to distrust. An injected
     runner is a deliberate test control: run() returns it before it consults
     DRY_RUN, so `claude --version` comes back a real ok and haveBinary stays
     true. Every other subprocess is the same no-op the dry-run comment above
     describes, so the flow still launches and sits at a blank pane. */
  connect.setRunner((file, args) => ({ ok: true, stdout: '' }));
  try {
    const started = await post('/api/connect/start');
    assert.equal(started.status, 200, started.body);
    assert.notEqual(json(started).phase, 'idle', 'start answered but nothing started');

    const polled = await req('/api/connect');
    assert.ok(String(json(polled).phase).startsWith('signin'),
      `expected a sign-in phase mid-flight, got ${json(polled).phase}`);

    const cancelled = await post('/api/connect/cancel');
    assert.equal(cancelled.status, 200);
    assert.equal(json(cancelled).phase, 'idle');
    assert.equal(json(await req('/api/connect')).phase, 'idle',
      'cancel answered idle but the state route still shows a flow');
  } finally {
    await connect.cancel().catch(() => {});
    connect.setTickInterval(700);
    connect.setRunner(null);
    connect.resetForTests();
  }
});

test('a dry-run probe does not score the binary as working (#1568/#1571)', async () => {
  /* The sandbox guard (engine/sandbox.js) names AGENT_WORKFORCE_DRY_RUN=1 as a
     remedy for a live tmux, and under it run() returns { ok:true, dryRun:true }
     WITHOUT executing. start() must NOT trust that un-run --version as a working
     binary: with a bin present (/bin/echo passes X_OK) but no injected runner,
     the probe comes back dry-run, so haveBinary is refused and the flow takes
     the install path rather than skipping it on a launcher it never invoked.
     Before the #1568 fix this went straight to a sign-in phase. */
  connect.resetForTests();          // no injected runner: a genuine dry-run probe
  connect.setTickInterval(15);
  try {
    await connect.start();
    const phase = connect.state().phase;
    assert.ok(
      phase === connect.PHASE.DOWNLOADING || phase === connect.PHASE.INSTALLING || phase === connect.PHASE.STUCK,
      `dry-run probe was trusted as a working binary (#1568): expected the install path, got ${phase}`,
    );
    assert.ok(!String(phase).startsWith('signin'),
      `dry-run probe skipped the install and went to sign-in (#1568): ${phase}`);
  } finally {
    await connect.cancel().catch(() => {});
    connect.setTickInterval(700);
    connect.resetForTests();
  }
});

test('the stuck screen offers the Terminal way out only when there is something to run', () => {
  /**
   * 🛑 #205. This note was concatenated for EVERY stuck cause, and three of the
   * five mean the program it names was never installed: the download failed, the
   * binary is not where it should be, or the install step — which is also the
   * PATH step — did not finish. **So the screen where somebody is most stuck
   * told them to open a Terminal and type a command that answers `command not
   * found`.**
   *
   * ⚠️ A STRANGER WALKS THIS PATH TONIGHT. Josh is demoing to people who will
   * install it themselves, so a dead end on step 3 of six is a first impression
   * rather than a screenshot.
   *
   * 📌 THE FLAG IS ASKED OF THE DISK BY THE ENGINE, never inferred from which
   * cause fired — branching on the cause would derive the binary's existence
   * from the code path we happened to take.
   */
  /* This file has `pageFunction` (a callable) but no source-slicer; the
     assertions here are about the SHAPE of the branch rather than its output,
     and rendering it would need most of the first-run DOM stubbed. Sliced the
     same brace-matched way, anchored with the paren so a longer-named sibling
     cannot capture it. */
  const raw = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const at = script.indexOf('function frPaintConnect(');
  assert.ok(at > -1, 'frPaintConnect vanished from the page');
  let depth = 0; let end = -1;
  for (let k = script.indexOf('{', at); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  const src = script.slice(at, end);

  assert.match(src, /st && st\.canRunClaude/,
    'the note is unconditional again, so a person with nothing installed is told to run it');

  /* Both arms present, and only the offered one names the command. */
  assert.match(src, /open Terminal, type <b>claude<\/b>/,
    'the way out vanished entirely, including for the cases where it works');
  assert.match(src, /carry on and connect later from Settings/,
    'the no-binary case has no way forward at all, which is where it started');

  /* 🔑 THE SENTENCE THAT MUST SURVIVE BOTH ARMS. "Nothing is broken by this" is
     true whether or not there is a fallback, and it is doing the most work for
     somebody stuck part way through setup. */
  /* ⚠️ MATCHED WITHOUT THE CLOSING QUOTE. This pinned `try again'` and so was
     really asserting where the JS string ENDED, which changed the moment both
     arms started leading into the same Settings clause (#996). The sentence is
     what must survive, not its punctuation. */
  assert.match(src, /Nothing is broken by this\. You can try again/,
    'the reassurance was moved inside a branch, so one of the two paths loses it');
});

test('the port-collision message names what was seen, and the escape clears the OTLP range', () => {
  /**
   * 🛑 KOSMOS BINDS 4317, WHICH IS THE OPENTELEMETRY OTLP/gRPC DEFAULT. Found by
   * Shredder on an independent walk of the install, verified in source by
   * Splinter, and it matters tonight specifically: Josh is demoing to somebody
   * who already runs agents, which makes a collector on 4317 materially likelier
   * than average.
   *
   * ⚠️ TWO THINGS WENT WRONG AT ONCE, AND EVERY STEP BEFORE THEM SUCCEEDED.
   * The install finished, the browser correctly did not open, and the last
   * paragraph asserted a cause it could not know — *"often another account's
   * Kosmos"* — sending a person to look for a second Kosmos that does not exist.
   * Then it suggested `PORT + 1`, which is **4318, the OTLP/HTTP default**: on
   * the machine most likely to have 4317 taken, the escape hatch pointed at the
   * second-most-likely-occupied port on the box.
   *
   * 📌 A SOURCE READ, said plainly: driving a real install against a held port
   * belongs in `tools/test-install.sh`, and this pins the two properties that
   * were actively harmful so they cannot come back quietly.
   */
  /* ⚠️ COMMENT LINES STRIPPED FIRST, for the reason this file keeps re-learning:
     the comment that RECORDS a removed phrase contains that phrase, so an
     unstripped check reads the explanation as the defect. It then punishes
     writing the explanation down, which is the opposite of what it is for.
     Whole-line only — a '#' inside a printf string is part of the message. */
  const setup = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8')
    .split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

  assert.ok(!setup.includes('often another'),
    'the message asserts a cause again; it can see the port is busy, not who has it');
  /* 🛑 THIS TEST USED TO REQUIRE THE OTLP SENTENCE AND NOW FORBIDS IT, which is
     a reversal worth stating rather than a quiet edit. It was written when the
     default port WAS 4317, where naming the collector was the single most
     useful thing the message could say. The default is 16180 now: 16180 is the
     default for nothing, so the same sentence became a confident wrong cause —
     the exact defect this test's neighbour above ("often another") exists to
     prevent. The claim did not change; the value under it did.
     🔑 A test that pins an explanation pins it relative to a value. When the
     value moves, the test is the thing that keeps the stale copy alive. */
  assert.ok(!/OpenTelemetry|collector/i.test(setup),
    'the install messages name a cause that stopped being true when the port moved off 4317');

  /* 🛑 THE ESCAPE MUST NOT BE PORT+1. */
  assert.ok(!setup.includes('_alt=$((PORT + 1))'),
    'the suggested port is 4318 again, which is the other OpenTelemetry default');
  assert.ok(setup.includes('_alt=16181'), 'the escape no longer clears the OTLP range');

  /* And the sentence that has to survive either way: the install DID work. */
  assert.ok(setup.includes('Kosmos is installed, but something else is already answering'),
    'a person whose port is busy is no longer told the install itself succeeded');
});

test('a first-time installer meets the port precondition before anything is downloaded', () => {
  /**
   * 🛑 A COLLISION USED TO BE DISCOVERED AT THE VERY END OF A FIRST INSTALL:
   * every step succeeded, the browser correctly refused to open, and the last
   * paragraph was the whole product the person ever saw. Now it is checked
   * beside the macOS floor, before the folders are made and long before the
   * tmux download — three seconds instead of a full run.
   *
   * ⚠️ FRESH INSTALLS ONLY, AND THAT IS THE LOAD-BEARING PART. On an update our
   * own board is legitimately answering until the pause stops it, so running
   * this early would abort every update with "a Kosmos board is already
   * running" — true, and exactly the wrong thing to do about it. Splinter
   * corrected his own reading of that block, which is what surfaced it: the
   * check inside the update gate is a POST-condition of `kosmos stop`, not a
   * pre-check that had been misfiled.
   */
  const setup = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');

  const early = setup.indexOf('_portbody="$(curl');
  const mkdirAt = setup.indexOf('mkdir -p "$KOSMOS_HOME" "$BIN_DIR"');
  const download = setup.indexOf('step "Setting up the pieces Kosmos needs."');
  assert.ok(early > -1, 'the early port precondition is gone');
  assert.ok(early < mkdirAt, 'the precondition runs after the folders are made');
  assert.ok(early < download, 'the precondition runs after the download starts, which is the whole point');

  /* It must be inside a fresh-install gate, or every update dies on our own board. */
  const gate = setup.lastIndexOf('if [ "$FRESH_INSTALL" = "yes" ]; then', early);
  assert.ok(gate > -1 && gate < early,
    'the early check is not gated to fresh installs, so an update would abort on its own board');

  /* And the update path keeps its own check AFTER the stop, where it means
     "the stop did not work" rather than "somebody else is here". */
  const updGate = setup.indexOf('if [ "$FRESH_INSTALL" = "no" ] && [ -x "$KOSMOS_HOME/bin/kosmos" ]; then');
  const stop = setup.indexOf('"$KOSMOS_HOME/bin/kosmos" stop', updGate);
  const verify = setup.indexOf('_pausebody="$(curl', updGate);
  assert.ok(updGate > -1 && verify > stop, 'the update no longer verifies that its pause worked');

  /* 🛑 AND THE UNINSTALL MUST NOT HAVE ONE. An earlier version of this change
     put the verification into the uninstall path by matching the first `kosmos
     stop` in the file — which would abort `--uninstall` whenever a board was
     still answering, breaking the reversibility this installer is built on.
     `bash -n` passed it; only reading the placement caught it. */
  const uninstallStop = setup.indexOf('"$KOSMOS_HOME/bin/kosmos" stop');
  assert.ok(uninstallStop < updGate, 'expected the uninstall stop to come first in the file');
  const between = setup.slice(uninstallStop, updGate);
  assert.ok(!between.includes('_pausebody="$(curl'),
    'the uninstall path verifies the port, so a running board would abort an uninstall');

  /* Same reversal as above, on the early notice: no named cause on 16180.
     ⚠️ AGAINST THE CODE, NOT THE FILE. `setup` here is raw, comments and all,
     and the comment recording WHY the OTLP sentence was dropped contains the
     word — so this fired on the explanation of the fix. Third time this exact
     shape has bitten in two days, so the stripper is the answer rather than a
     cleverer pattern, and it is proved below rather than trusted. */
  const code = setup.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert.ok(/^\s*#.*OpenTelemetry/m.test(setup),
    'the premise: a comment mentioning OTLP is what this stripper has to survive');
  assert.ok(!/OpenTelemetry|collector/i.test(code),
    'the early notice names a cause that stopped being true when the port moved');

  /**
   * 🛑 AND IT WARNS RATHER THAN ABORTS. An earlier version of this change made
   * an occupied port a hard stop, and `tools/test-install.sh` caught it: the
   * considered design is that such an install EXITS 0, says so, and does not
   * open a browser onto the stranger's board. Aborting would leave somebody
   * with nothing installed over a port they can change with one word.
   */
  const arm = setup.slice(early, setup.indexOf('esac', early));
  assert.ok(!arm.includes('die "'),
    'a busy port aborts the install again; it should say so and finish');
  assert.ok(arm.includes('this install will finish'),
    'the early notice does not tell a person the install still completes');
});

test('every copy of the default port agrees, and none of them sits in the ephemeral range', () => {
  /**
   * 🛑 WAS THREE COPIES OF ONE FACT; now four independent formulas, plus
   * one pinned literal each has to agree on (#910). The primary/first
   * macOS account (uid 501 -- pinned so the single most common Kosmos
   * install changes zero observable bytes) still gets the literal
   * unchanged port; a change to any of the four computing sites
   * (`server.js` is a consumer, not a computing site: it always reads
   * whatever PORT `install/kosmos`'s `cmd_start` already resolved and
   * passed it, and only its own bare-`node server.js` dev fallback ever
   * reaches its own `|| 16180`) is invisible until somebody starts the
   * board a way that reaches a different copy -- then the icon opens one
   * port and the board is listening on another.
   *
   * 🔑 MOVED OFF 4317 because that is the OpenTelemetry OTLP/gRPC default, so
   * the people likeliest to collide with Kosmos were the people already running
   * agents -- this product's own audience. Josh picked 16180, the golden ratio:
   * unregistered, nothing clustered near it, and memorable enough to type.
   *
   * ⚠️ AND DELIBERATELY NOT IN 49152-65535, which was the tempting answer since
   * nothing ships a default there. MEASURED on macOS: that range IS the
   * ephemeral pool (`net.inet.ip.portrange.first: 49152`), so a fixed listener
   * in it collides at random, occasionally, and only sometimes -- an intermittent
   * failure nobody can reproduce, which is worse than the deterministic one it
   * would replace. The derived range for non-primary accounts (16181-20179)
   * stays inside the same safe registered band, checked below too.
   */
  const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
  const strip = (s) => s.split('\n').filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l)).join('\n');

  const fromServer = /process\.env\.PORT \|\| (\d+)/.exec(strip(read('server.js')));
  const fromLauncher = /_kosmos_default_port=(\d+)/.exec(strip(read('install/kosmos')));
  const fromSetup = /_kosmos_default_port=(\d+)/.exec(strip(read('install/setup.sh')));
  // postinstall uses its own variable names (_KOSMOS_PAGE_PORT, not
  // _kosmos_default_port) since it computes the page's port as root, ahead
  // of the board it hands off to -- same fact, differently-named copy.
  const fromPostinstall = /_KOSMOS_PAGE_PORT=(\d+)$/m.exec(strip(read('install/pkg-scripts/postinstall')));
  // main.swift's pinned literal, read as text (this is a JS test, it cannot
  // compile or run Swift) -- the ONLY thing this catches is the primary-
  // account (uid 501) literal drifting; a drift in the Swift SIDE of the
  // non-primary formula still needs tools/test-install.sh's compiled-binary
  // --kosmos-app-port-selftest check, which this fast unit-test suite does
  // not run. Still worth having here: a plain `yarn test`/`node --test`
  // (no built bundle required) now catches the cheapest, most consequential
  // drift -- the one that would move the single most common Kosmos install.
  const fromSwift = /if uid == 501 \{ return (\d+) \}/.exec(strip(read('native-app/main.swift')));
  assert.ok(fromServer && fromLauncher && fromSetup && fromPostinstall && fromSwift, 'one of the five pinned-primary defaults could not be found');

  const ports = [fromServer[1], fromLauncher[1], fromSetup[1], fromPostinstall[1], fromSwift[1]].map(Number);
  assert.equal(new Set(ports).size, 1,
    'the five copies of the pinned-primary default port disagree: ' + ports.join(', ')
    + ' -- the icon and the board would open different ports for the primary account');

  const port = ports[0];
  assert.equal(port, 16180, 'the pinned-primary default moved off the literal every real install already uses');
  assert.notEqual(port, 4317, 'back on the OpenTelemetry OTLP/gRPC default');
  assert.notEqual(port, 4318, 'on the OpenTelemetry OTLP/HTTP default');
  assert.ok(port >= 1024 && port < 49152,
    'the default is in macOS\'s ephemeral range (49152+), where the kernel hands out '
    + 'ports at random -- a fixed listener there fails intermittently');

  /* #910: all THREE shell formulas that compute a NON-primary account's
     port must also agree with each other, and the whole derived range
     they can produce (16181-20179 for realistic uids) must stay clear
     of the ephemeral pool the same way the pinned literal does.
     Variable-name-agnostic on purpose: install/kosmos and install/setup.sh
     name theirs _kosmos_uid/_kosmos_default_port, postinstall names its
     own CONSOLE_UID/_KOSMOS_PAGE_PORT (it computes as root, ahead of the
     board) -- the shape (16180 + 1 + (UID % N)) is the fact that must
     hold, not the identifier spelling it. */
  const formulaOf = (src) => {
    const m = /=\$\(\(16180 \+ 1 \+ \([A-Za-z_][A-Za-z0-9_]* % (\d+)\)\)\)/.exec(strip(src));
    return m ? Number(m[1]) : null;
  };
  const modLauncher = formulaOf(read('install/kosmos'));
  const modSetup = formulaOf(read('install/setup.sh'));
  const modPostinstall = formulaOf(read('install/pkg-scripts/postinstall'));
  assert.ok(modLauncher !== null && modSetup !== null && modPostinstall !== null, 'the non-primary derivation formula could not be found in one of the three shell files');
  assert.equal(modLauncher, modSetup, 'install/kosmos and install/setup.sh use different moduli for the non-primary derivation');
  assert.equal(modLauncher, modPostinstall, 'install/pkg-scripts/postinstall uses a different modulus for the non-primary derivation -- the installing page would poll a port the board never binds');
  // The `+ 1` in the formula (16180 + 1 + (uid % mod)) is what keeps the
  // smallest possible result at 16181, never back onto the pinned-primary
  // 16180 -- structural, not something worth re-deriving in a separate
  // assertion here; the shell test-install.sh suite already pins a live
  // uid (502) through the real formula and checks the same property.
  const maxDerived = 16180 + 1 + (modLauncher - 1);
  assert.ok(maxDerived < 49152, 'the widest possible derived port reaches into the ephemeral range');
});

/* ---- the shelf's one read (#805) ---------------------------------------- */
test('/api/connections answers every built door from the engines, and a connected token door is reported connected', async () => {
  const tokendoors = require('./engine/tokendoors');
  const hetzner = tokendoors.byName('Hetzner');
  hetzner.setFetcher(async () => ({ ok: true, status: 200, body: { server: { id: 1 } } }));
  try {
    const before = json(await req('/api/connections'));
    assert.ok(before.doors, 'no doors object');
    for (const [route, st] of Object.entries(before.doors)) {
      assert.ok(st.connected === true || st.connected === false || st.connected === null, route + ' answered a fourth thing: ' + JSON.stringify(st));
    }
    assert.equal(before.doors['/api/svc/hetzner'].connected, false, 'nothing is held yet');
    assert.ok('/api/github' in before.doors && '/api/cloudflare' in before.doors && '/api/vercel' in before.doors, 'a named door is missing from the shelf');
    assert.equal(Object.keys(before.doors).length, 3 + Object.keys(tokendoors.routes()).length, 'the shelf and the page inventory disagree on how many doors there are');
    const c = await hetzner.connect('hetzner-token-long-enough-to-be-real-0123456789');
    assert.equal(c.connected, true, JSON.stringify(c));
    const after = json(await req('/api/connections'));
    assert.equal(after.doors['/api/svc/hetzner'].connected, true, 'the door says Connected and the shelf does not');
    /* A door whose check throws is could-not-check, not nothing. */
    hetzner.setFetcher(async () => { throw new Error('the verifier died'); });
    const broken = json(await req('/api/connections'));
    assert.equal(broken.doors['/api/svc/hetzner'].connected, null);
  } finally {
    await hetzner.forget().catch(() => {});
    hetzner.setFetcher(null);
  }
});

/* ---- #881: GET /api/accounts, end to end through the real route -------- */
test('GET /api/accounts confirms each Claude account live, through the real route', async () => {
  /* Vertical slice, not just the engine functions: iteration 1's review
     found no test anywhere exercised server.js's own route wiring
     (async, calling accounts.listLive() instead of list()) -- this hits
     the real, listening server the way a browser would. */
  const subscription = require('./engine/subscription');
  fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'route-881@example.com' } }));
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true }), err: null }));
  try {
    const got = json(await req('/api/accounts'));
    assert.ok(Array.isArray(got.accounts), 'no accounts array in the response');
    const row = got.accounts.find((a) => a.email === 'route-881@example.com');
    assert.ok(row, 'the fixture account did not come back through the route');
    assert.equal(row.provider, 'anthropic');
    assert.equal(row.connection.state, subscription.STATE.CONNECTED, 'the route did not carry the live connection through');
    assert.equal(row.connection.checkedLive, true);
  } finally {
    subscription.setRunner(null);
    fs.rmSync(path.join(HOME, '.claude.json'), { force: true });
    fs.rmSync(path.join(HOME, '.claude'), { recursive: true, force: true });
  }
});

/* ---- #960: GET /api/accounts, OpenAI rows through the real route ------- */
test('GET /api/accounts confirms each OpenAI account live too, through the real route', async () => {
  const openaiAccounts = require('./engine/openaiaccounts');
  const subscription = require('./engine/subscription');
  const dir = path.join(HOME, '.codex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-route960keyROUT' }));
  openaiAccounts.setFetcher(async () => ({ status: 200, body: { data: [] } }));
  try {
    const got = json(await req('/api/accounts'));
    assert.ok(Array.isArray(got.accounts), 'no accounts array in the response');
    const row = got.accounts.find((a) => a.provider === 'openai' && a.keyTail === 'ROUT');
    assert.ok(row, 'the fixture OpenAI account did not come back through the route');
    assert.equal(row.connection.state, subscription.STATE.CONNECTED, 'the route did not carry the live OpenAI connection through');
    assert.equal(row.connection.checkedLive, true);
  } finally {
    openaiAccounts.setFetcher(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HEAD /api/accounts answers without paying for a live check', async () => {
  /* Caught in challenge-loop iteration 7: the new HEAD short-circuit
     (server.js, added so a HEAD does not pay accounts.listLive()'s real
     per-account subprocess cost) had no test of its own -- only
     incidental confidence from the GET tests. This exercises it
     directly: an injected runner that would fail the test if it were
     ever actually called proves the live check is genuinely skipped,
     not just fast. Extended for #960: the OpenAI fetcher must be
     skipped too, now that GET pays for a real network call on that side
     as well. */
  const subscription = require('./engine/subscription');
  const openaiAccounts = require('./engine/openaiaccounts');
  let calledClaude = false;
  let calledOpenai = false;
  subscription.setRunner(async () => { calledClaude = true; return { stdout: JSON.stringify({ loggedIn: true }), err: null }; });
  openaiAccounts.setFetcher(async () => { calledOpenai = true; return { status: 200, body: {} }; });
  try {
    const got = await req('/api/accounts', { method: 'HEAD' });
    assert.equal(got.status, 200);
    assert.match(got.type, /application\/json/);
    assert.equal(got.body, '', 'a HEAD response must carry no body');
    assert.equal(calledClaude, false, 'HEAD must not invoke the Claude live check at all');
    assert.equal(calledOpenai, false, 'HEAD must not invoke the OpenAI live check at all');
  } finally { subscription.setRunner(null); openaiAccounts.setFetcher(null); }
});

test('#996: the first-run wizard never INSTRUCTS anybody to open a Terminal', () => {
  /**
   * 🛑 THE NORTH STAR THIS IS MEASURED AGAINST: someone non-technical gets from
   * nothing to a working agent without a Terminal. This sentence fired at the
   * least technical moment in the product -- step 3 of six, first run, after a
   * failure -- so for the person it was written for it was a wall with a
   * helpful sign on it.
   *
   * ⭐ IT ASSERTS THE SHAPE, NOT THE ABSENCE OF A WORD. Deleting the hatch
   * would trade a non-technical person's problem for a technical one's. What
   * must be true is that the plain sentence carries no command and the command
   * sits behind a CLOSED disclosure that names the tool it needs.
   */
  const { els } = connectHarness({ phase: 'stuck', because: 'x', canRunClaude: true,
    progress: { got: 0, total: null } });
  const html = els['fr-sub'].innerHTML;
  const note = html.slice(html.indexOf('fr-note'));
  const upToHatch = note.slice(0, note.indexOf('fr-hatch') > -1 ? note.indexOf('fr-hatch') : note.length);
  assert.doesNotMatch(upToHatch, /Terminal/,
    'the plain sentence tells a first-run person to open a Terminal again');
  assert.match(note, /carry on and connect later from Settings/,
    'the branch with a runnable Claude stopped offering the in-app way forward');

  /* The hatch is present, and CLOSED: a <details> with no `open` attribute. An
     opened one is the same instruction with extra steps. */
  assert.match(note, /<details class="fr-hatch"><summary>/,
    'the escape hatch was deleted rather than moved behind a disclosure');
  assert.doesNotMatch(note, /<details class="fr-hatch"[^>]*\sopen/,
    'the hatch renders already open, so it is still addressing everybody');
  assert.match(note, /open Terminal, type <b>claude<\/b>/,
    'the hatch no longer contains the command it exists to carry');
});

test('#996: and it is not offered at all when there is nothing to run', () => {
  /* Three of the five stuck causes mean Claude was never installed, so the
     command would answer `command not found` at the worst possible moment
     (#205). The engine asks the DISK; this pins that the answer is used. */
  const { els } = connectHarness({ phase: 'stuck', because: 'x', canRunClaude: false,
    progress: { got: 0, total: null } });
  const html = els['fr-sub'].innerHTML;
  assert.doesNotMatch(html, /Terminal/,
    'a person with no Claude on disk was told to type a command that cannot run');
  assert.match(html, /carry on and connect later from Settings/);
});
