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

function kosmos(port) {
  return new Promise((resolve) => {
    execFile('bash', [CLI, 'connections'], { env: { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: FAKE_HOME } },
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
  await withBoard({ status: 404, body: { error: 'no such endpoint' } }, async (port) => {
    const r = await kosmos(port);
    assert.notEqual(r.code, 0, 'a 404 exited 0');
    assert.doesNotMatch(r.out, /no such endpoint/,
      'the raw server error string was printed at a person, with no next step');
    assert.match(r.out, /restart/i, 'no actionable next step was offered');
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
