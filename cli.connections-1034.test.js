'use strict';

/**
 * `kosmos connections` DRIVEN AS A PROGRAM (#1034 part 2).
 *
 * 🛑 WHY THIS FILE EXISTS. The verb's renderer is ~87 lines of node embedded in
 * a shell single-quoted string, and `test:shell` gives it `bash -n` only, which
 * PARSES it and runs nothing. Two separate challenge iterations on this branch
 * fixed real defects inside that block -- a stale `stuck` verdict printed in the
 * present tense beside a contradicting line, and a count that read "3 sign-ins"
 * when one worked -- and neither was held by anything afterwards.
 *
 * ⚠️ It also cannot be tested by reading: the shell string is where an
 * apostrophe silently ends the script, and the branching (count suppression,
 * pluralisation, stopped-versus-busy, the provider-scoped suppression, both
 * error arms) only exists at runtime.
 *
 * Shape borrowed from `cli.presents-token.test.js`, including its reject-do-not-
 * resolve-in-finally lesson: a swallowed assertion here would be the same defect
 * this file exists to prevent, one level up.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const fs = require('node:fs');
const os = require('node:os');

const CLI = path.join(__dirname, 'install', 'kosmos');

/**
 * 🛑 THE RENDERER DOES NOT RUN WITHOUT A RUNTIME, AND THAT IS WHY IT WAS NEVER
 * TESTED BY ACCIDENT. `install/kosmos` resolves node as
 * `$KOSMOS_HOME/runtime/bin/node`, which exists in a real install and NOT on a
 * developer box, so the verb falls back to printing raw JSON and every
 * assertion about wording passes over output the renderer never produced.
 * Measured: without this, the CLI emitted the payload verbatim and all seven
 * arms failed for the same uninformative reason.
 *
 * `KOSMOS_HOME` is overridable (`install/kosmos:41`), so the test supplies a
 * runtime pointing at the node already running it.
 */
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-1034-'));
fs.mkdirSync(path.join(FAKE_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(FAKE_HOME, 'runtime', 'bin', 'node'));
test.after(() => fs.rmSync(FAKE_HOME, { recursive: true, force: true }));

/* Serves the board's identity page (so `healthy` passes) and whatever verdict
   payload the arm asks for. */
function withBoard(payload, run) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/agent/connections')) {
      res.writeHead(payload.status || 200, { 'content-type': 'application/json' });
      return res.end(typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body));
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await run(server.address().port); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

function kosmos(port, extraEnv = {}) {
  /* `extraEnv` exists for ONE caller: the rc-28 timeout arm, which needs a
     shorter deadline than the hard-coded 40s to be driveable at all. Defaulted
     so every existing call site is unchanged. */
  return new Promise((resolve) => {
    execFile('bash', [CLI, 'connections'], { env: { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: FAKE_HOME, ...extraEnv } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: String(stdout), err: String(stderr) }));
  });
}

/**
 * The SAME invocation with no bundled runtime, so the degraded path is reachable.
 * `install/kosmos` resolves node as `$KOSMOS_HOME/runtime/bin/node`; pointing
 * KOSMOS_HOME at an empty dir makes that miss, which is the real shape on a
 * layout where the runtime is absent.
 */
function kosmosNoRuntime(port) {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-noruntime-'));
  return new Promise((resolve) => {
    execFile('bash', [CLI, 'connections'], { env: { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: bare } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: String(stdout), err: String(stderr) }));
  });
}

const P = (over = {}) => ({
  providers: [
    { id: 'anthropic', name: 'Claude', installed: true, signedIn: 'connected', howMany: 1, howManyWorking: 1, because: 'this computer has a working sign-in for it' },
    { id: 'openai', name: 'GPT', installed: false, signedIn: 'none', howMany: 0, howManyWorking: 0, because: 'the program it needs is not installed on this computer yet' },
  ],
  signin: { provider: 'anthropic', phase: 'idle', busy: false },
  services: [{ name: 'GitHub', connected: true, because: 'connected' }],
  ...over,
});

test('it prints a verdict per provider, in words rather than machine vocabulary', async () => {
  await withBoard({ body: P() }, async (port) => {
    const r = await kosmos(port);
    assert.equal(r.code, 0, `exited ${r.code}: ${r.err}`);
    assert.match(r.out, /Claude: connected/);
    assert.match(r.out, /GPT: not connected/);
    // the enums themselves must NOT reach a person
    assert.doesNotMatch(r.out, /: none \(/, 'the raw `none` enum reached the screen');
    assert.doesNotMatch(r.out, /: unknown \(/, 'the raw `unknown` enum reached the screen');
  });
});

test('a count that WORKS is distinguished from a count that EXISTS', async () => {
  const p = P();
  p.providers[0].howMany = 3; p.providers[0].howManyWorking = 1;
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.match(r.out, /1 of 3 sign-ins working/,
      'three accounts of which one works read as three working ones');
  });
});

test('no count at all is printed beside a verdict we could not check', async () => {
  const p = P();
  p.providers[0].signedIn = 'unknown'; p.providers[0].howMany = null; p.providers[0].howManyWorking = null;
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.match(r.out, /Claude: could not check/);
    /* ⚠️ ASSERT THE COUNT, NOT THE WORDS. A first version forbade "sign-in"
       anywhere on that line, which matches the `because` SENTENCE
       ("...check the sign-in on this computer...") and so failed on correct
       output. What must not appear is a NUMBER of sign-ins. */
    const line = r.out.split('\n').find((l) => l.includes('Claude:')) || '';
    assert.ok(line, 'control: no Claude line was printed at all');
    assert.doesNotMatch(line, /\d+ sign-ins?\b/,
      `a count was printed beside "could not check", which reads as a settled none: ${line}`);
    assert.doesNotMatch(line, /\d+ of \d+/, `a working-count was printed for an unreadable provider: ${line}`);
  });
});

test('a stuck sign-in speaks, in the past tense, and only for its own provider', async () => {
  const p = P();
  p.providers[0].signedIn = 'none';
  p.signin = { provider: 'anthropic', phase: 'stuck', busy: false };
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    /* ⚠️ ASSERTS THE PROVIDER IS NAMED, which is stronger than the wording this
       pinned before. An unqualified "a sign-in got stuck" beside a two-provider
       list is read against the wrong provider. */
    assert.match(r.out, /An earlier Claude sign-in got stuck/,
      'a stuck sign-in was dropped, or no longer says WHOSE sign-in it was');
  });

  // CONTROL: with that provider CONNECTED, the stale stuck line is suppressed,
  // or the CLI gives two accounts of one machine.
  const q = P();
  q.signin = { provider: 'anthropic', phase: 'stuck', busy: false };
  await withBoard({ body: q }, async (port) => {
    const r = await kosmos(port);
    assert.doesNotMatch(r.out, /got stuck/,
      'a stale stuck verdict printed beside a connected provider, contradicting the line above it');
  });
});

test('a sign-in in progress is described in words, and an unknown phase prints no token', async () => {
  const p = P({ signin: { provider: 'anthropic', phase: 'signin-awaiting-code', busy: true } });
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.match(r.out, /waiting for them to paste the code/);
    assert.doesNotMatch(r.out, /signin-awaiting-code/, 'the raw phase token reached the screen');
  });

  const q = P({ signin: { provider: 'anthropic', phase: 'some-new-phase-9271', busy: true } });
  await withBoard({ body: q }, async (port) => {
    const r = await kosmos(port);
    assert.match(r.out, /part way through/);
    assert.doesNotMatch(r.out, /some-new-phase-9271/, 'an unmapped phase token was printed at a person');
  });
});

test('a board that does not know the route yet gets a next step, not developer vocabulary', async () => {
  /* 🛑 BOTH SIDES ARE READ FROM SOURCE, AND NEITHER IS TYPED HERE. Supplying the
     literal myself made this a check containing a copy of the thing it verifies:
     reword the server and the CLI silently degrades to printing developer
     vocabulary at a person, while this test stays green.
     ⚠️ My first attempt extracted "the 404 message" from server.js and matched a
     DIFFERENT 404 ("that is not a name we can read"), because there are several.
     So the assertion is not about one line number: it is that the CLI's pattern
     corresponds to SOMETHING the server actually emits. That survives the 404s
     being reordered, and fails if either side is reworded independently. */
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const cliSrc = fs.readFileSync(CLI, 'utf8');

  const cliPat = cliSrc.match(/\/([^/\n]+)\/i\.test\(v\.error\)/);
  assert.ok(cliPat, 'install/kosmos no longer branches on the board error text');
  const cliRe = new RegExp(cliPat[1], 'i');

  const server404s = [...serverSrc.matchAll(/sendJson\(res, 404, \{ error: '([^']+)' \}\)/g)].map((m) => m[1]);
  assert.ok(server404s.length > 0, 'control: found no 404 sentences in server.js at all');

  const SERVER_404 = server404s.find((t) => cliRe.test(t));
  assert.ok(SERVER_404,
    `install/kosmos matches ${cliRe} but server.js emits none of ${JSON.stringify(server404s)}. `
    + 'One side was reworded without the other, so a version-skewed board will print '
    + 'developer vocabulary at a person.');

  await withBoard({ status: 404, body: { error: SERVER_404 } }, async (port) => {
    const r = await kosmos(port);
    assert.notEqual(r.code, 0, 'a 404 exited 0');
    assert.doesNotMatch(r.out, new RegExp(SERVER_404.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the raw server error string was printed at a person, with no next step');
    assert.match(r.out, /restart/i, 'no actionable next step was offered');
    /* ⚠️ And the next step must name a command that WORKS. Bare `kosmos` is what
       engine/connections.js:3 calls a measured lie on a stock install, because
       ~/.local/bin is not on a default macOS PATH. This verb's primary caller is
       an agent that was handed an absolute path, so the recovery it prints has
       to be resolvable too. Before this, the line said bare `kosmos restart` and
       nothing held it: measured, ZERO tests touched this path. */
    /* The path may be QUOTED (an install path can contain a space), so the
       assertion is about the path being RESOLVED, not about the exact spelling
       around it. It was written against the unquoted form and broke the moment
       the quoting was added, which is the pin-the-wording trap. */
    assert.match(r.out, /\/[^\s"]*kosmos"? restart/,
      'the restart advice is the bare command, which fails on a stock install');
  });
});

test('a body we cannot parse says so rather than crashing', async () => {
  await withBoard({ body: 'not json at all' }, async (port) => {
    const r = await kosmos(port);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /could not read/i);
  });
});

test('the embedded renderer contains no apostrophe, which would end the shell string', () => {
  /**
   * 🛑 I BROKE THIS FILE TWICE IN ONE HOUR THE SAME WAY. The renderer lives
   * inside `"$NODE" -e '...'`, a single-quoted shell string, so ONE apostrophe
   * in a comment ("the board's sentence") terminates it and the whole script
   * stops parsing. `bash -n` catches it, but only if somebody runs bash -n,
   * and the failure looks like a syntax error hundreds of lines away.
   *
   * A guard is cheaper than remembering. This is a property of the file, not of
   * my discipline.
   */
  const src = fs.readFileSync(CLI, 'utf8');
  const at = src.indexOf('cmd_connections()');
  assert.notEqual(at, -1, 'control: cmd_connections is gone from the CLI');
  const open = src.indexOf('"$NODE" -e \'', at);
  assert.notEqual(open, -1, 'control: the embedded node script is gone, so this guards nothing');
  const bodyStart = open + '"$NODE" -e \''.length;
  const close = src.indexOf('\'\n', bodyStart);
  assert.ok(close > bodyStart, 'control: could not find the end of the embedded script');
  const body = src.slice(bodyStart, close);
  assert.ok(body.length > 500, `control: embedded body implausibly short (${body.length})`);
  const apostrophes = (body.match(/'/g) || []).length;
  assert.equal(apostrophes, 0,
    `the embedded renderer contains ${apostrophes} apostrophe(s); one ends the shell string and the file stops parsing`);
});

test('an unknown sign-in phase is a THIRD answer, not silence', async () => {
  /**
   * The verb's header says "three answers, never two", and this section
   * collapsed to two: `phase: unknown` fell through both branches and printed
   * nothing, byte-identical to `idle`. So "no sign-in is going on" and "we could
   * not tell whether one is" were indistinguishable to the agent reading it.
   */
  const p = P({ signin: { provider: 'anthropic', phase: 'unknown', busy: false } });
  p.providers[0].signedIn = 'none';
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.match(r.out, /could not tell whether a Claude sign-in/i,
      'an unknown phase printed nothing, or no longer says WHOSE sign-in it was');
  });

  // control: idle must STAY silent, or the assertion above passes for everything
  const q = P({ signin: { provider: 'anthropic', phase: 'idle', busy: false } });
  q.providers[0].signedIn = 'none';
  await withBoard({ body: q }, async (port) => {
    const r = await kosmos(port);
    assert.doesNotMatch(r.out, /could not tell whether a/i,
      'an idle phase now claims we could not tell, which is the opposite error');
  });
});

test('a hostile or unknown wire value cannot print machine internals at a person', async () => {
  /**
   * The renderer indexes objects with values that arrive over the wire. A board
   * answering `signedIn: "constructor"` walked the prototype chain and printed
   * `function Object() { [native code] }` on screen -- the same class the engine
   * boundary closed one file away, in the verb whose job is refusing machine
   * vocabulary. The CLI does not control the board, so it must tolerate one.
   */
  const p = P();
  p.providers[0].signedIn = 'constructor';
  p.signin = { provider: 'anthropic', phase: 'toString', busy: false };
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.doesNotMatch(r.out, /native code|function Object|\[object /,
      'a prototype member reached the screen');
    assert.match(r.out, /Claude: could not check/,
      'an unrecognised verdict should degrade to could-not-check, not to a blank');
  });
});

test('a RENDERED field that is not a string cannot print [object Object] at a person', async () => {
  /**
   * 🛑 THE SIBLING TEST ABOVE PLANTS `signedIn`, WHICH IS AN INDEX INTO A LOOKUP
   * TABLE, SO `own()` ALREADY HANDLED IT. `name`, `because` and the three counts
   * are DIFFERENT: they are concatenated into the sentence directly, so nothing
   * on their path had to tolerate a non-string. Measured before the guard, exit 0:
   *
   *   [object Object]: connected ([object Object], 1 of [object Object] sign-ins working)
   *
   * That is the exact output the services loop has a guard against, arriving
   * through the provider row that did not have one. The services guard says it
   * exists "for the same reason as the guard above"; there was no guard above.
   */
  const p = P();
  p.providers[0].name = {};
  p.providers[0].because = {};
  p.providers[0].howMany = {};
  p.providers[0].howManyWorking = {};
  p.providers[0].howManyReadable = {};
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.equal(r.code, 0, `exited ${r.code}: ${r.err}`);
    assert.doesNotMatch(r.out, /\[object /,
      'a non-string rendered field reached the screen as machine vocabulary');
    /* POSITIVE CONTROL. Without this the assertion above also passes when the
       renderer prints nothing at all, which is the failure it is least able to
       tell apart from success. The UNPOISONED row must still be there. */
    assert.match(r.out, /GPT: not connected/,
      'the good row vanished, so the assertion above proved nothing');
  });
});

test('a bad COUNT beside a good name is caught by the numbers guard, not the strings one', async () => {
  /**
   * 🛑 WHY THIS IS A SECOND TEST AND NOT MORE FIELDS ON THE ONE ABOVE. That test
   * plants every field at once, so the strings guard `continue`s and the count
   * arithmetic is never reached. Measured: with the numbers guard reverted to
   * `!= null`, that test STILL PASSED, so the numbers guard was holding nothing.
   *
   * This is the reachable shape the numbers guard actually exists for: a board
   * that names the provider correctly and gets a COUNT wrong. Only that shape
   * reaches the arithmetic, and only this test can fail when the guard goes.
   */
  const p = P();
  p.providers[0].howMany = {};
  p.providers[0].howManyWorking = {};
  p.providers[0].howManyReadable = {};
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.equal(r.code, 0, `exited ${r.code}: ${r.err}`);
    assert.doesNotMatch(r.out, /\[object /,
      'a non-number count reached the screen as machine vocabulary');
    /* The row itself must SURVIVE. The counts are an embellishment on a sentence
       whose verdict is still knowable, so dropping the whole row over a bad count
       would lose true information to protect formatting. */
    assert.match(r.out, /Claude: connected/,
      'the row was dropped over a bad count, losing a verdict we could still state');
  });
});

test('a non-string name cannot reach the SIGN-IN sentences either', async () => {
  /**
   * 🛑 THE GUARD ON THE PROVIDER LOOP DID NOT COVER THIS, AND THE TEST ABOVE
   * COULD NOT HAVE FOUND IT. That guard is a `continue` INSIDE the loop, so it
   * protects the per-provider rows. `whoName` is computed OUT of the loop from
   * the same unvalidated field and feeds all three sign-in sentences.
   *
   * The sibling test pairs a non-string name with `phase: idle`, so it never
   * reaches these lines. This one pairs it with `stuck`. Measured before the fix:
   *
   *   An earlier [object Object] sign-in got stuck and did not finish.
   *
   * ⚠️ `||` did not save it because a non-string name is TRUTHY, so the fallback
   * was present and simply never applied. That is why the fix is `typeof` rather
   * than another fallback.
   */
  const p = P();
  p.providers[0].name = {};
  /* NOT connected, and that is required rather than incidental: the stuck branch
     is deliberately suppressed while the provider reads connected (a persisted
     stuck from a previous board process must not contradict a live connection).
     My first version of this test left it connected, so the branch was never
     reached and the CONTROL below caught it rather than the assertion. */
  p.providers[0].signedIn = 'none';
  p.signin = { provider: 'anthropic', phase: 'stuck', busy: false };
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.equal(r.code, 0, `exited ${r.code}: ${r.err}`);
    assert.doesNotMatch(r.out, /\[object /,
      'a non-string name reached a sign-in sentence');
    /* CONTROL. The assertion above also passes if the stuck sentence never printed
       at all, which is the outcome it is least able to tell apart from success.
       The sentence must be THERE, and naming the fallback. */
    assert.match(r.out, /An earlier Claude sign-in got stuck/,
      'the stuck sentence did not print, so the assertion above proved nothing');
  });
});

test('a section with nothing printable in it prints no header', async () => {
  /**
   * The services loop drops rows whose name or reason is not a string. The header
   * was gated on the RAW array length, so a board answering only malformed rows
   * printed "Other services:" with nothing underneath. An empty section reads as
   * one that failed to load, which is a different claim from having nothing to say.
   */
  const p = P();
  p.services = [{ name: {}, because: {} }, null];
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.equal(r.code, 0, `exited ${r.code}: ${r.err}`);
    assert.doesNotMatch(r.out, /Other services:/,
      'a header printed over a section with nothing in it');
    /* CONTROL, and it is the arm that matters: the SAME payload with one good row
       must still print the header. Without this, deleting the section entirely
       would also pass. */
  });
  const q = P();
  q.services = [{ name: {}, because: {} }, { name: 'GitHub', because: 'connected' }];
  await withBoard({ body: q }, async (port) => {
    const r = await kosmos(port);
    assert.match(r.out, /Other services:/,
      'control: one good row no longer prints the header, so the assertion above proved nothing');
    assert.match(r.out, /GitHub: connected/, 'control: the good row itself vanished');
  });
});

test('an UNRESOLVED sign-in provider is not attributed to Claude', async () => {
  /**
   * 🛑 THE COMMENT SAID "ONE RESOLVED ROW DRIVES BOTH" AND IT DID NOT. When
   * `signin.provider` matches no row, `whoRow` is undefined, so the NAME fell
   * back to "Claude" while `anyConnected` fell back to false. The two fallbacks
   * disagreed, which is the exact contradiction the comment claims to have fixed.
   *
   * Measured before the fix: "Claude: connected (...)" followed by "An earlier
   * Claude sign-in got stuck and did not finish." Two accounts of one computer.
   */
  const p = P();
  p.signin = { provider: 'gemini', phase: 'stuck', busy: false };
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.equal(r.code, 0, `exited ${r.code}: ${r.err}`);
    assert.match(r.out, /Claude: connected/, 'control: the connected row should still print');
    assert.doesNotMatch(r.out, /An earlier Claude sign-in got stuck/,
      'an unresolved provider was attributed to Claude, contradicting the row above it');
    /* CONTROL that the signal is not merely dropped: the stuck sentence must still
       be there, just unattributed. Silently swallowing it would also satisfy the
       assertion above and would lose a real thing the person needs to know. */
    assert.match(r.out, /An earlier sign-in got stuck/,
      'the stuck sentence vanished entirely, losing a signal rather than un-attributing it');
  });
});

test('with no runtime, a FAILED call still reports failure', async () => {
  /**
   * 🛑 IT PRINTED THE RAW BODY AND RETURNED 0. Losing the runtime is supposed to
   * cost FORMATTING, not the answer, and that trade is deliberate and stays. But
   * it was also costing the STATUS: a board answering {"error": ...} left the
   * degraded path with exit 0, so anything branching on the code saw a healthy
   * call, while the formatted path returned 1 for the same board.
   *
   * No test covered this path at all, which is how both halves stayed true.
   */
  await withBoard({ status: 404, body: { error: 'no such endpoint' } }, async (port) => {
    const r = await kosmosNoRuntime(port);
    assert.notEqual(r.code, 0,
      'a failed call reported success because the runtime was missing');
    /* CONTROL that the deliberate half survives: the raw body must STILL be
       printed. A fix that started swallowing the answer would also satisfy the
       assertion above, and would be the wrong trade. */
    assert.match(r.out, /no such endpoint/,
      'the raw body stopped being printed, which was the whole point of this path');
  });

  /* SECOND CONTROL: the same degraded path on a GOOD board must still exit 0, or
     the first assertion is satisfied by simply always failing. */
  await withBoard({ body: P() }, async (port) => {
    const r = await kosmosNoRuntime(port);
    assert.equal(r.code, 0,
      'control: a healthy call now reports failure, so the check is not about the error');
  });
});

test('the not-running and transport failure sentences exist and exit non-zero', async () => {
  /**
   * 🛑 NONE OF THE THREE FAILURE SENTENCES HAD A TEST, IN THE EXACT CODE WHERE A
   * SHIPPED BUG ONCE MADE TWO OF THEM UNREACHABLE. The comment at install/kosmos
   * records it: `body=$(curl ...); rc=$?` under `set -euo pipefail` exits at the
   * assignment, so both error sentences below it were dead and a transport
   * failure printed NOTHING while the happy path stayed green.
   *
   * The fix is held by nothing. That is the same shape as the bug: a defect on a
   * path no test drives, with a green suite above it.
   */

  // ARM 1: nothing listening at all. The board is not running.
  const dead = await new Promise((resolve) => {
    const srv = http.createServer(() => {});
    srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
  const notRunning = await kosmos(dead);
  assert.notEqual(notRunning.code, 0, 'a dead board exited 0');
  assert.match(notRunning.out + notRunning.err, /not running/i,
    'a dead board did not produce the not-running sentence');
  assert.doesNotMatch(notRunning.out + notRunning.err, /curl:|Connection refused|ECONNREFUSED/,
    'transport vocabulary reached a person in the verb whose job is refusing it');

  /* ARM 2: the TRANSPORT-FAILURE sentence, which is a different branch entirely.
     ⚠️ MY FIRST VERSION OF THIS ARM PROVED NOTHING. It simply dropped the
     connection, which fails `healthy()` (a curl of `/` looking for "Kosmos"), so
     it produced the NOT-RUNNING sentence and exercised the same branch as ARM 1.
     Measured: silencing the "did not answer" sentence left all 21 tests green.
     To reach it the board must PASS the health probe and then fail on the route. */
  const halfDead = await new Promise((resolve) => {
    const srv = http.createServer((q, r) => {
      if (q.url === '/') { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<title>Kosmos</title>'); return; }
      r.socket.destroy();
    });
    srv.listen(0, () => resolve({ port: srv.address().port, srv }));
  });
  const cut = await kosmos(halfDead.port);
  halfDead.srv.close();
  assert.notEqual(cut.code, 0, 'a board that died mid-answer exited 0');
  assert.doesNotMatch(cut.out + cut.err, /not running/i,
    'the health probe passed, so this must NOT be the not-running sentence: this arm '
    + 'is reaching the same branch as ARM 1 and proving nothing');
  assert.ok((cut.out + cut.err).trim().length > 0,
    'a board that died mid-answer printed NOTHING, which is the exact shipped bug this guards');
  assert.doesNotMatch(cut.out + cut.err, /curl:|\(52\)|\(56\)|Empty reply/,
    'raw transport vocabulary reached a person');

  // CONTROL: the same helper against a WORKING board must succeed, or these
  // assertions are satisfied by the CLI simply being broken.
  await withBoard({ body: P() }, async (port) => {
    const ok = await kosmos(port);
    assert.equal(ok.code, 0, 'control: a healthy board now fails, so the arms above prove nothing');
    assert.match(ok.out, /Claude: connected/, 'control: the healthy board printed no verdict');
  });
});

test('a malformed element prints a sentence, never a stack trace', async () => {
  /**
   * 🛑 THE GUARD CHECKED THE CONTAINER, NOT THE ELEMENTS. `providers: [null]`
   * passed `Array.isArray` and then threw on `.signedIn`, printing a TypeError and a
   * full stack with absolute paths, AFTER the header had already reached stdout. That
   * is the most machine-vocabulary output this verb can produce, in the verb whose job
   * is refusing it.
   * ⚠️ The sibling hostile-value test covers `signedIn` and `phase`, which are
   * both READ. These two paths RENDER a board-supplied value verbatim, and they were
   * exactly the two it did not reach.
   */
  const p = P();
  p.providers = [null];
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.doesNotMatch(r.out + r.err, /TypeError|at Socket|\/Users\//,
      'a stack trace or an absolute path reached the person: ' + (r.out + r.err).slice(0, 300));
    assert.match(r.out, /could not read/,
      'a malformed answer should say so in a sentence');
  });
});

test('a service row that is not strings is skipped rather than rendered as [object Object]', async () => {
  /**
   * ⚠️ The boundary allowlists these, so this is the CLI declining to trust a
   * board it does not control, for the same reason as the element check above: the CLI
   * updates independently of the running board, which is why the no-such-endpoint arm
   * exists at all.
   */
  const p = P();
  p.services = [{ name: {}, because: {} }, { name: 'GitHub', because: 'connected' }];
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.doesNotMatch(r.out, /\[object Object\]/,
      'an object was rendered at a person: ' + r.out.slice(0, 200));
    assert.match(r.out, /GitHub: connected/,
      'control: the well-formed row beside it was dropped too, so the filter is too wide');
  });
});

test('every sign-in sentence names WHOSE sign-in it is', async () => {
  /**
   * 🛑 `who` WAS COMPUTED AND NEVER PRINTED. The sentence sat unqualified beside
   * a two-provider list, so an agent helping somebody paste a GPT key read "a
   * sign-in is going on right now" and attached it to GPT while the flow
   * belonged to Claude. That is the two-accounts-of-what-to-do failure the
   * provider field was added to prevent, surviving one layer further out.
   */
  const cases = [
    ['signin-awaiting-code', true, /A Claude sign-in is going on/],
    ['stuck', false, /An earlier Claude sign-in got stuck/],
    ['unknown', false, /could not tell whether a Claude sign-in/],
  ];
  for (const [phase, busy, want] of cases) {
    const p = P({ signin: { provider: 'anthropic', phase, busy } });
    p.providers[0].signedIn = 'none';
    // eslint-disable-next-line no-await-in-loop
    await withBoard({ body: p }, async (port) => {
      const r = await kosmos(port);
      assert.match(r.out, want, `the ${phase} sentence does not name its provider`);
    });
  }
});

test('a row we could not read is not counted against the person', async () => {
  /**
   * `workingCount` filtered on CONNECTED, so an `unknown` row landed in the
   * denominator as not-working: two accounts of which one was merely unreadable
   * rendered "1 of 2 sign-ins working". That is a settled negative about a row
   * nobody looked at, which is the collapse the three-state rule refuses.
   */
  const p = P();
  p.providers[0].howMany = 2; p.providers[0].howManyWorking = 1; p.providers[0].howManyReadable = 1;
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.doesNotMatch(r.out, /1 of 2 sign-ins working/,
      'an unreadable row was counted as a failing one');
    assert.match(r.out, /we could not check/,
      'the unreadable row vanished entirely instead of being named');
  });
});

test("the CLI's spoken vocabulary stays in step with subscription.STATE", () => {
  /**
   * The renderer hard-codes the wire vocabulary twice -- `SAY` maps each state
   * to a sentence, and one branch compares `signedIn` to a bare string -- and
   * nothing tied either to `engine/subscription`, which OWNS those values
   * (`grep -ic subscription install/kosmos` = 0).
   *
   * 🛑 WHY THAT MATTERS AND WHY NO EXISTING TEST CATCHES IT. If a
   * `subscription.STATE` value is ever renamed, `engine/connectionverdict.test.js`
   * STAYS GREEN, because it asserts through the constants rather than through
   * their values. The CLI is the only layer holding the literals, so it would
   * silently render "could not check" for every provider and stop suppressing a
   * stale stuck line, with the whole suite passing.
   *
   * ⚠️ It fails toward `could not check`, which is the SAFE direction of the
   * card's three-state rule, so this is a guard against silent degradation, not
   * against a leak.
   *
   * ⭐ THE POINT OF THE SHAPE: neither side of the comparison is written here.
   * One side is read from `engine/subscription`, the other is extracted from the
   * CLI source. A test that spelled the expected values out would be a copy of
   * the thing it verifies, which is the defect this branch has already fixed
   * twice elsewhere and cannot fail by construction.
   */
  const { STATE } = require('./engine/subscription');
  const src = fs.readFileSync(CLI, 'utf8');

  const sayLine = src.match(/var SAY = \{([^}]*)\}/);
  assert.ok(sayLine, 'could not find the SAY map in install/kosmos -- it was renamed or reshaped, and this guard just went blind');
  const sayKeys = [...sayLine[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
  assert.ok(sayKeys.length > 0, 'extracted zero keys from SAY: the guard would pass vacuously');

  assert.deepEqual(sayKeys, [...Object.values(STATE)].sort(),
    'the CLI speaks a different set of states than subscription.STATE defines');

  const cmp = src.match(/signedIn === "([^"]+)"/);
  assert.ok(cmp, 'could not find the signedIn comparison in install/kosmos -- this guard just went blind');
  assert.equal(cmp[1], STATE.CONNECTED,
    'the CLI compares signedIn against a literal that is no longer STATE.CONNECTED');
});

test('a board that accepts the connection and never answers gets the TIMEOUT sentence, not the dead-board one', async () => {
  /**
   * The rc-28 arm was the one failure sentence in `cmd_connections` with no
   * test, flagged by two independent reviews. It was undriveable because the
   * curl deadline was hard-coded at 40 seconds; `KOSMOS_CONN_TIMEOUT` exists
   * only so this test can shorten it.
   *
   * 🛑 WHY AN UNTESTED SENTENCE HERE IS NOT A NIT. This file's own header
   * records that two of the three failure sentences in this same function once
   * shipped UNREACHABLE under `set -euo pipefail`, with the whole suite green
   * above them. An arm nothing drives is an arm nobody has seen run.
   *
   * ⚠️ The distinction it protects is not cosmetic either. Saying "Kosmos did
   * not answer" for a CLIENT-side deadline blames the board for our impatience
   * and sends the reader to the wrong place: the board is fine and still
   * running, which is what the timeout sentence says and the dead-board
   * sentence denies.
   */
  /* ⚠️ THE BOARD MUST BE HEALTHY AND HANG ONLY ON THE AGENT ROUTE. A server that
     hangs on everything never reaches this arm at all: `cmd_connections` probes
     `/` for liveness first and short-circuits to the "Kosmos is not running"
     sentence, which is a DIFFERENT arm that is already covered. My first version
     hung on both and asserted the timeout sentence against the dead-board one. */
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/agent/connections')) return; // accept, never answer
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const r = await kosmos(server.address().port, { KOSMOS_CONN_TIMEOUT: '1' });
    assert.match(r.out, /took longer than we waited/,
      'a hanging board did not produce the timeout sentence');
    assert.doesNotMatch(r.out, /Kosmos did not answer/,
      'a client-side deadline was reported as the board being dead, which sends the reader to the wrong place');
    assert.match(r.out, /The board is running/,
      'the timeout sentence dropped the half that tells the person their board is fine');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('every connect.PHASE is accounted for by the CLI, so a new phase cannot print silence', () => {
  /**
   * 🛑 THE FAILURE THIS CLOSES IS A SILENCE, WHICH IS WHY NOTHING ELSE CATCHES IT.
   * The renderer has three phase branches: `unknown`, `STOPPED` (terminal), and
   * `STEP` (in flight). A NEW phase added to `connect.PHASE` upstream that is not
   * in `ACTIVE_PHASES` matches none of them and prints NOTHING, byte-identical to
   * `idle`. No test fails, no sentence looks wrong, and the person is told nothing
   * is happening while something is.
   *
   * That is the same silence-collapse the `unknown` branch was added to close, and
   * `PHASES`/`BUSY_PHASES`/`SAY` are each already pinned to their source of truth.
   * `STOPPED` and `STEP` were the two copies with no guard at all.
   *
   * ⭐ IT ASSERTS COVERAGE, NOT EQUALITY. Silence is a legitimate answer for `idle`
   * and `connected`, so those are named here as DELIBERATE. A new phase forces
   * whoever adds it to make that choice explicitly instead of inheriting silence.
   */
  const connect = require('./engine/connect');
  const src = fs.readFileSync(CLI, 'utf8');

  const keysOf = (name, re) => {
    const m = src.match(re);
    assert.ok(m, `could not find the ${name} map in install/kosmos: it was renamed or reshaped, and this guard just went blind`);
    const keys = [...m[1].matchAll(/["']?([a-z-]+)["']?\s*:/g)].map((x) => x[1]);
    assert.ok(keys.length > 0, `extracted zero keys from ${name}: the guard would pass vacuously`);
    return keys;
  };

  const stopped = keysOf('STOPPED', /var STOPPED = \{([\s\S]*?)\};/);
  const step = keysOf('STEP', /var STEP = \{([\s\S]*?)\};/);

  /* Silence is correct for these two and only these two. */
  const DELIBERATELY_SILENT = ['idle', 'connected'];

  const spoken = new Set([...stopped, ...step, ...DELIBERATELY_SILENT]);
  const unaccounted = Object.values(connect.PHASE).filter((p) => !spoken.has(p));
  assert.deepEqual(unaccounted, [],
    `connect.PHASE has phases the CLI neither speaks nor deliberately silences: ${unaccounted.join(', ')}. `
    + 'Add each to STOPPED (terminal) or STEP (in flight), or to DELIBERATELY_SILENT here with a reason. '
    + 'Left alone it prints nothing, which the person reads as "no sign-in is happening".');

  /* The in-flight map is pinned exactly: a phase that IS active must have a
     sentence, and a sentence for a phase that is not active is dead code. */
  assert.deepEqual([...step].sort(), [...connect.ACTIVE_PHASES].sort(),
    'the CLI in-flight sentences and connect.ACTIVE_PHASES have drifted apart');

  /* Control: the extraction really reaches the maps, so the assertions above are
     not passing on empty sets. */
  assert.ok(stopped.includes('stuck') && stopped.includes('interrupted'),
    'the STOPPED extraction did not find the two phases known to be there, so it is not reading the map');
});

test('"connections" refuses arguments instead of paying for a sweep to ignore them', async () => {
  /**
   * The verb takes no options, and answering as though it did is expensive: the
   * sweep behind it is a subprocess per Claude account plus an authenticated
   * request per OpenAI account. `kosmos connections --help` used to pay all of
   * that and then print the report anyway.
   */
  const run = (arg) => new Promise((resolve) => {
    execFile('bash', [CLI, 'connections', arg],
      { env: { ...process.env, KOSMOS_PORT: '1', KOSMOS_HOME: FAKE_HOME } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: String(stdout) + String(stderr) }));
  });

  const r = await run('--bogus');
  assert.equal(r.code, 2, `expected exit 2 for an unexpected argument, got ${r.code}`);
  assert.match(r.out, /takes no options/, 'the refusal did not say why');
  assert.doesNotMatch(r.out, /is connected on this computer|sign-in is going on/,
    'it printed the report anyway, which means it paid for the sweep before refusing');

  /* ⚠️ --help IS ANSWERED, NOT REFUSED, and this arm exists because an earlier
     version of this very test pinned the opposite. Refusing a request for help
     with an error status is the one refusal that reads as the tool being broken
     rather than the caller being wrong, and it costs nothing to answer from the
     same branch. Both spellings, because -h alone is the easy one to forget. */
  for (const flag of ['--help', '-h']) {
    const h = await run(flag);
    assert.equal(h.code, 0, `${flag} exited ${h.code}: asking for help is not an error`);
    /* Case-insensitive deliberately: the help text opens the sentence with a
       capital and the refusal does not. A case-sensitive match here failed
       against text that plainly said the right thing, which is the most
       repeated false zero on this fleet. The CASE is not what is being tested. */
    assert.match(h.out, /takes no options/i, `${flag} did not say it takes no options`);
    assert.doesNotMatch(h.out, /sign-in is going on/,
      `${flag} printed the report, so it paid for the sweep to answer a help request`);
  }
});

test('every spelling of zero is refused by the connection deadline guard', () => {
  /**
   * 🛑 THE HOLE THIS CLOSES WAS IN A GUARD WHOSE OWN COMMENT SAID IT WAS CLOSED.
   * `KOSMOS_CONN_TIMEOUT` is read from the ambient environment in production, and
   * `curl -m 0` means NO TIMEOUT AT ALL. An earlier guard refused the literal "0"
   * and anything containing a non-digit; `00` is digits-only and is not
   * string-equal to "0", so it passed straight through and removed the 40s
   * ceiling, making the rc-28 "took longer than we waited" sentence unreachable.
   * The CLI would hang instead of saying so.
   *
   * ⭐ THE GUARD IS EXTRACTED FROM THE SHIPPED FILE AND RUN, NOT REIMPLEMENTED
   * HERE. A test that spelled the case-block out again would be a copy of the
   * thing it verifies and could not fail when the real one drifted.
   */
  const src = fs.readFileSync(CLI, 'utf8');
  const m = src.match(/local deadline=40\n([\s\S]*?\n  esac)/);
  assert.ok(m, 'could not find the deadline guard in install/kosmos: it moved or was reshaped, and this test just went blind');
  /* `local` is function-only syntax and this snippet runs at top level, so it is
     neutralised here rather than dropped from the real script: the shipped guard
     SHOULD declare its temporaries, and a test that forced it not to would be the
     test dictating the code. Comments go too, so a future emoji or apostrophe in
     one cannot break the extraction. */
  const guard = 'deadline=40\n' + m[1].replace(/^\s*#.*$/gm, '').replace(/\blocal\s+/g, '');
  assert.match(guard, /10#/, 'the extracted guard does not compare numerically, so a leading-zero spelling can still disable the ceiling');

  const run = (value) => {
    const script = `${value === null ? '' : `KOSMOS_CONN_TIMEOUT=${JSON.stringify(value)}\n`}${guard}\necho "$deadline"`;
    return require('node:child_process').execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();
  };

  for (const zero of ['0', '00', '000', '0000']) {
    assert.equal(run(zero), '40',
      `KOSMOS_CONN_TIMEOUT=${zero} disabled the 40s ceiling: curl reads it as "no timeout" and the CLI hangs instead of reporting a timeout`);
  }
  for (const junk of ['', 'abc', '4x', '-1']) {
    assert.equal(run(junk), '40', `a non-numeric value ${JSON.stringify(junk)} was accepted as a deadline`);
  }
  /* 🛑 THE HIGH SIDE, WHICH THE FIRST VERSION OF THIS GUARD LEFT WIDE OPEN.
     `curl -m 999999` is about 11.5 days, which removes the ceiling exactly as
     `-m 0` does and makes the timeout sentence unreachable by the same route.
     Same failure, opposite end. Zero spellings alone are not the hazard: any
     value outside a sane band is. */
  for (const huge of ['301', '3600', '999999']) {
    assert.equal(run(huge), '40',
      `KOSMOS_CONN_TIMEOUT=${huge} was accepted: a deadline that long is no ceiling at all, and the CLI hangs instead of reporting a timeout`);
  }
  assert.equal(run('300'), '300', 'the top of the band was rejected, so the band is narrower than it claims');
  /* CONTROL: a real value must still get through, or the guard is just a
     constant and the test above passes for the wrong reason. */
  assert.equal(run('7'), '7', 'a valid deadline was rejected, so the guard refuses everything and proves nothing');
  assert.equal(run(null), '40', 'an unset variable did not fall back to the ceiling');
});

test('a board with no readable providers says so and exits non-zero, instead of a heading over nothing', async () => {
  /**
   * 🛑 MEASURED BEFORE THE FIX: `providers: []` printed
   *      "What this computer is connected to:"
   *      <blank>
   *   and nothing else, AT EXIT 0. A person reads that as "connected to nothing";
   *   an agent branching on the exit status is told the call succeeded.
   *
   * ⚠️ THE SAME SCRIPT HAD ALREADY FIXED THIS ONE SCREEN BELOW, for services, with
   * the reason written down: an empty section "reads as a section that failed to
   * load rather than one with nothing to say". The providers half never got the
   * same treatment. Both arms below are the cases the container guard cannot see:
   * it catches a null element, not an empty list and not one whose every row the
   * string guard drops.
   *
   * 📌 Not reachable from our own board, since forAgent always returns exactly two
   * providers. Guarded because this block's whole job is tolerating a board it
   * does not control.
   */
  for (const [label, providers] of [
    ['an empty list', []],
    ['rows the string guard drops', [{}, { name: 42, because: null }]],
  ]) {
    await withBoard({ body: { providers, services: [] } }, async (port) => {
      const r = await kosmos(port);
      assert.notEqual(r.code, 0,
        `${label}: exited 0, so an agent branching on status is told this succeeded`);
      assert.match(r.out, /could not read/,
        `${label}: did not say the answer was unreadable`);
      assert.doesNotMatch(r.out, /What this computer is connected to/,
        `${label}: printed the heading with nothing under it, which reads as "connected to nothing"`);
    });
  }

  /* CONTROL: a well-formed row still renders, or the assertions above are
     satisfied by a CLI that refuses everything. */
  await withBoard({ body: P() }, async (port) => {
    const r = await kosmos(port);
    assert.equal(r.code, 0, 'a good payload was refused, so this test proves nothing');
    assert.match(r.out, /What this computer is connected to/, 'a good payload lost its heading');
  });
});

test('control characters in a wire string are neutralised before they reach an agent', async () => {
  /**
   * This output does not only land on a terminal. This branch splices the
   * connections verb into every agent instruction file, so the rendered text
   * lands in the context window of an agent: an escape sequence repaints a
   * screen, and instruction-shaped text arrives where instructions are read.
   *
   * Our own boundary allowlists every string it emits, so nothing from OUR board
   * carries these. That is the assumption this renderer refuses to make
   * everywhere else, which is why it type-guards and own-property-checks: the
   * board may be a different build than the CLI.
   */
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const NUL = String.fromCharCode(0);
  const p = P();
  p.providers[0].name = 'Claude' + ESC + '[2J';
  p.providers[0].because = 'fine' + BEL + NUL + 'x';
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    for (const [label, ch] of [['escape', ESC], ['bell', BEL], ['NUL', NUL]]) {
      assert.ok(!r.out.includes(ch), `a ${label} character reached the output, and this text lands in the context window of an agent`);
    }
    /* CONTROL: the surrounding words survive, so this strips control characters
       rather than dropping the row or blanking the field. */
    assert.match(r.out, /Claude/, 'the provider name was lost entirely rather than cleaned');
    assert.match(r.out, /fine/, 'the reason was lost entirely rather than cleaned');
  });
});

test('control characters are stripped from EVERY sentence, not only the provider rows', async () => {
  /**
   * 🛑 THE EARLIER CONTROL-CHARACTER TEST COULD NOT REACH THE PATHS THAT LEAKED.
   * It plants into providers[0].name and .because and asserts over the whole
   * output, but the shared fixture sets signin.phase to idle, so NONE of the
   * three sign-in sentences render, and no arm planted into v.error. The guard
   * was real, the test was real, and the fixture phase is what made them miss
   * each other. Both leaks sat green underneath.
   *
   * whoName is the specific hazard: it is computed OUTSIDE the provider loop
   * from the same unvalidated field the loop cleans, and it feeds three separate
   * console.log calls. This is the second time that field has slipped past a
   * guard that lived inside the loop.
   */
  const ESC = String.fromCharCode(27);
  const NUL = String.fromCharCode(0);
  const dirty = 'Cl' + ESC + '[2J' + NUL + 'aude';

  for (const [label, phase, busy] of [
    ['the stopped sentence', 'stuck', false],
    ['the unknown sentence', 'unknown', false],
    ['the in-flight sentence', 'signin-awaiting-code', true],
  ]) {
    const p = P({ signin: { provider: 'anthropic', phase, busy } });
    p.providers[0].name = dirty;
    p.providers[0].signedIn = 'none';
    p.providers[0].howMany = 0;
    p.providers[0].howManyWorking = 0;
    p.providers[0].howManyReadable = 0;
    await withBoard({ body: p }, async (port) => {
      const r = await kosmos(port);
      assert.ok(!r.out.includes(ESC), label + ': an escape character reached the output');
      assert.ok(!r.out.includes(NUL), label + ': a NUL reached the output');
      /* CONTROL: the sentence actually rendered, or the assertions above pass on
         output that never contained the field at all. */
      assert.match(r.out, /aude/, label + ': the sentence never rendered, so this arm proves nothing');
    });
  }

  /* The error branch prints a board-supplied string and is reached before any
     provider rendering, which is why the cleaner has to be declared above it. */
  await withBoard({ body: { error: 'boom' + ESC + '[2Jtail' } }, async (port) => {
    const r = await kosmos(port);
    assert.ok(!r.out.includes(ESC), 'the error branch printed an escape character');
    assert.match(r.out, /boom/, 'the error text was lost entirely rather than cleaned');
  });
});

test('a connected provider is never told we could not tell whether its sign-in is going on', async () => {
  /**
   * 🛑 THE COMPOSITION NO ARM COVERED. All three unknown-phase arms in this file
   * force providers[0].signedIn = none first, so the CONNECTED case had never
   * been exercised, and the contradiction below rendered green underneath them:
   *
   *     Claude: connected (this computer has a working sign-in for it, 1 sign-in)
   *     We could not tell whether a Claude sign-in is going on.
   *
   * A settled answer and an uncertainty about the same provider on one screen.
   *
   * ⚠️ HOW IT GOT THERE: the module now rewrites a stale terminal phase to
   * unknown when the provider reads connected. The record that used to arrive as
   * stuck, and be suppressed by the STOPPED gate, started arriving as unknown and
   * landing in a branch with no gate. The rule moved inward and only half its
   * scope moved with it, for the second time on this branch.
   */
  const p = P({ signin: { provider: 'anthropic', phase: 'unknown', busy: false } });
  p.providers[0].signedIn = 'connected';
  p.providers[0].howMany = 1;
  p.providers[0].howManyWorking = 1;
  p.providers[0].howManyReadable = 1;
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    assert.match(r.out, /connected/, 'the connected provider row did not render, so this arm proves nothing');
    assert.doesNotMatch(r.out, /could not tell whether/,
      'an uncertainty about a sign-in printed beside a settled connected answer for the same provider');
  });

  /* CONTROL: with nothing connected, the SAME unknown phase is real news and must
     still be said. Without this arm the assertion above is satisfied by a CLI
     that never prints the sentence at all. */
  const q = P({ signin: { provider: 'anthropic', phase: 'unknown', busy: false } });
  q.providers[0].signedIn = 'none';
  q.providers[0].howMany = 0;
  q.providers[0].howManyWorking = 0;
  q.providers[0].howManyReadable = 0;
  await withBoard({ body: q }, async (port) => {
    const r = await kosmos(port);
    assert.match(r.out, /could not tell whether/,
      'the uncertainty sentence was suppressed with nothing connected, which hides a real unknown');
  });
});

test('a working sign-in with the program MISSING says so, and a program we could not check does not', async () => {
  /**
   * 🛑 `installed` WAS EMITTED AND NEVER RENDERED. The boundary computes it as a
   * three-state field and the anthropic -> claude runner-key mapping exists purely
   * so it can be correct, but no consumer read it: a grep of install/kosmos for
   * `installed` returned 0 against a control of 7 for other provider fields.
   *
   * So the combination "a working sign-in exists but the runner binary is gone"
   * (a config surviving an uninstall, or the binary moved off disk) rendered as a
   * bare "connected", and the agent this branch recruits to run the verb was never
   * told the program was missing. The module's only not-installed sentence is
   * reachable when the state is `none`, because `connected` short-circuits above it.
   *
   * ⭐ THE THIRD ARM IS THE POINT. `installed: null` means we could not look, and a
   * confident "not installed" there would be the same collapse the counts and the
   * verdicts spend this whole branch refusing, one field over.
   */
  /* ⚠️ SCOPED TO THE CLAUDE LINE, NOT THE WHOLE OUTPUT. The shared fixture carries
     a SECOND provider (GPT) whose own row legitimately says the program is not
     installed, both via `installed: false` and inside its `because`. A first version
     of this test asserted over the whole output and failed on that row, which would
     have read as the fix being broken when it was the assertion aimed too wide. */
  const claudeLine = async (installed) => {
    const p = P();
    p.providers[0].signedIn = 'connected';
    p.providers[0].installed = installed;
    let out = '';
    await withBoard({ body: p }, async (port) => { out = (await kosmos(port)).out; });
    const line = out.split('\n').find((l) => /^\s*Claude:/.test(l));
    assert.ok(line, `the Claude row did not render at all, so this arm proves nothing. Output: ${JSON.stringify(out)}`);
    return line;
  };

  const missing = await claudeLine(false);
  assert.match(missing, /not installed on this computer/,
    'a connected provider whose program is GONE said nothing about it, so the person is told everything is fine');

  const present = await claudeLine(true);
  assert.doesNotMatch(present, /not installed on this computer/,
    'a provider whose program is present was told it was missing');

  const blind = await claudeLine(null);
  assert.doesNotMatch(blind, /not installed on this computer/,
    'a program we could not check was reported as definitely missing, which is a confident negative about something nobody looked at');
});

test('a fresh machine is told the program is missing ONCE, not twice', async () => {
  /**
   * 🛑 THE DUPLICATE LANDED IN THE CASE THIS CARD EXISTS FOR. saysFor() already
   * returns the not-installed sentence as `because` when the state is none and the
   * program is absent, which is the FRESH MACHINE. Appending the suffix there
   * printed it twice:
   *
   *   Claude: not connected (the program it needs is not installed on this
   *   computer yet). The program it needs is not installed on this computer yet
   *
   * ⚠️ AND 31 CLI TESTS RENDERED IT WITHOUT NOTICING. The GPT row in the shared
   * fixture is exactly none plus not-installed, so every test in this file printed
   * the duplicate and nothing asserted against it. The arm I had written covered
   * connected plus not-installed, where the suffix genuinely adds information, so
   * it confirmed the half that worked.
   */
  const p = P();
  p.providers[0].signedIn = 'none';
  p.providers[0].installed = false;
  p.providers[0].because = 'the program it needs is not installed on this computer yet';
  p.providers[0].howMany = 0; p.providers[0].howManyWorking = 0; p.providers[0].howManyReadable = 0;

  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    const line = r.out.split('\n').find((l) => /^\s*Claude:/.test(l));
    assert.ok(line, 'the Claude row did not render, so this arm proves nothing');
    const hits = (line.match(/not installed on this computer/g) || []).length;
    assert.equal(hits, 1,
      `the fresh-machine line said the program is missing ${hits} times: ${JSON.stringify(line)}`);
  });

  /* CONTROL: connected plus not-installed is the case the suffix EXISTS for, and it
     must still say it exactly once, from the suffix rather than from `because`. */
  const q = P();
  q.providers[0].signedIn = 'connected';
  q.providers[0].installed = false;
  await withBoard({ body: q }, async (port) => {
    const r = await kosmos(port);
    const line = r.out.split('\n').find((l) => /^\s*Claude:/.test(l));
    const hits = (line.match(/not installed on this computer/g) || []).length;
    assert.equal(hits, 1,
      `a connected provider with the program missing said it ${hits} times, so the suffix was lost or doubled: ${JSON.stringify(line)}`);
  });
});

test('the no-runtime path strips control characters from the raw body it prints', async () => {
  /**
   * When the bundled runtime is missing, the verb prints the board raw body rather
   * than inventing a sentence: losing the runtime should cost FORMATTING, not the
   * answer. But that output still lands in the context window of an agent, so the
   * same argument that put a control-character stripper in the renderer applies
   * here, and this path bypassed it.
   *
   * ⚠️ MY FIRST PROBE OF THIS NEVER REACHED THE PATH. I hand-rolled a fake board
   * and got the "Kosmos is not running" sentence instead, so the escape-absent
   * result was meaningless: the content control failed too, and that is the only
   * reason I noticed rather than recording a false pass. This uses the helper the
   * file already has for the degraded path.
   */
  const ESC = String.fromCharCode(27);
  /* 🛑 A STRING BODY, NOT AN OBJECT, AND THAT IS THE WHOLE TEST. An object body is
     JSON.stringify'd by the harness, and JSON ENCODES an escape as the six
     characters backslash-u-0-0-1-b, so a literal control byte never reaches the
     output and the assertion below cannot fail. My first version did exactly that
     and PASSED WITH THE STRIPPER DELETED. The perturbation is what caught it: the
     test looked right, ran the right path, and was measuring text that could not
     contain the thing it asserted about. */
  const body = 'boom' + ESC + '[2Jtail';
  await withBoard({ body }, async (port) => {
    const r = await kosmosNoRuntime(port);
    /* CONTROL FIRST: the raw body really did reach the output, or the assertion
       below is about text that was never printed. */
    assert.match(r.out, /boom/,
      `the degraded path did not print the raw body, so this arm proves nothing. Output: ${JSON.stringify(r.out.slice(0, 200))}`);
    assert.ok(!r.out.includes(ESC),
      'an escape character reached the output through the no-runtime path');
  });
});

test('a version-skewed board cannot produce a negative or nonsensical count', async () => {
  /**
   * 🛑 THE COMMENT CLAIMED COVERAGE IT DID NOT HAVE. It said "clamp BOTH ends" and
   * clamped only the numerator, so a board answering a negative readable count
   * rendered ", 0 of -1 sign-ins working, 2 we could not check": a NEGATIVE
   * denominator, and an unchecked count larger than the total.
   *
   * Unreachable from our own boundary. Every neighbouring guard in that block
   * exists for a board the CLI does not control, which is what made this the odd
   * omission rather than a policy difference.
   */
  const hostile = [
    { label: 'negative readable', howMany: 1, howManyWorking: 0, howManyReadable: -1 },
    { label: 'negative working', howMany: 2, howManyWorking: -3, howManyReadable: 2 },
    { label: 'working above readable', howMany: 3, howManyWorking: 9, howManyReadable: 2 },
  ];
  for (const h of hostile) {
    const p = P();
    p.providers[0].signedIn = 'connected';
    p.providers[0].howMany = h.howMany;
    p.providers[0].howManyWorking = h.howManyWorking;
    p.providers[0].howManyReadable = h.howManyReadable;
    await withBoard({ body: p }, async (port) => {
      const r = await kosmos(port);
      const line = r.out.split('\n').find((l) => /^\s*Claude:/.test(l)) || '';
      assert.doesNotMatch(line, /-\d/, `${h.label}: a negative number reached a person: ${JSON.stringify(line)}`);
      assert.doesNotMatch(line, /of -/, `${h.label}: a negative denominator was printed: ${JSON.stringify(line)}`);
    });
  }

  /* CONTROL: a sane skew still renders its real numbers, so the assertions above
     are not satisfied by a renderer that has stopped printing counts at all. */
  const ok = P();
  ok.providers[0].signedIn = 'connected';
  ok.providers[0].howMany = 3; ok.providers[0].howManyWorking = 1; ok.providers[0].howManyReadable = 3;
  await withBoard({ body: ok }, async (port) => {
    const r = await kosmos(port);
    assert.match(r.out, /1 of 3 sign-ins working/, 'a sane count stopped rendering, so this test proves nothing');
  });
});

test('a board that OMITS howManyWorking is not read as "all of them work"', async () => {
  /**
   * 🛑 BOTH w AND m FALL BACK TO howMany WHEN THEIR FIELD IS ABSENT, so an omitted
   * working count made w === m and printed ", 3 sign-ins working": every row
   * asserted to work, on a board that never said so. That is the exact conflation
   * the comment above the block records as the ORIGINAL defect, reintroduced
   * through the fallback rather than through the arithmetic.
   *
   * The typeof guards exist precisely so an omitted field means DID NOT SAY. The
   * fallback then turned did-not-say into a settled yes, which is the same
   * three-state collapse this branch refuses everywhere else, one field over.
   */
  const p = P();
  p.providers[0].signedIn = 'connected';
  p.providers[0].howMany = 3;
  delete p.providers[0].howManyWorking;
  delete p.providers[0].howManyReadable;
  await withBoard({ body: p }, async (port) => {
    const r = await kosmos(port);
    const line = r.out.split('\n').find((l) => /^\s*Claude:/.test(l)) || '';
    assert.ok(line, 'the Claude row did not render, so this arm proves nothing');
    assert.doesNotMatch(line, /sign-ins? working/,
      `a board that never said how many work was reported as all working: ${JSON.stringify(line)}`);
    /* CONTROL: the row still renders its verdict, so the assertion above is not
       satisfied by a CLI that dropped the provider entirely. */
    assert.match(line, /connected/, 'the verdict was lost along with the count');
  });

  /* CONTROL: a board that DOES say still gets its numbers, so the fix is
     "say nothing when not told" rather than "never say anything". */
  const q = P();
  q.providers[0].signedIn = 'connected';
  q.providers[0].howMany = 3; q.providers[0].howManyWorking = 1; q.providers[0].howManyReadable = 3;
  await withBoard({ body: q }, async (port) => {
    const r = await kosmos(port);
    assert.match(r.out, /1 of 3 sign-ins working/, 'a board that DID say lost its counts');
  });
});
